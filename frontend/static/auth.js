/**
 * 前端 Discord 驗證與權限防護模組 (auth.js)
 * 
 * 核心流程：
 * 1. 偵測頁面載入時的 URL query 是否帶有 Discord 授權碼 (?code=...)
 * 2. 自動向 Cloudflare Worker 後端驗證使用者是否具備指定頻道檢視權限
 * 3. 儲存驗證通過的 Token 與 使用者資訊，自動維持登入狀態
 * 4. 提供無權限時的強制遮罩防護與即時狀態回饋
 */

(function () {
    const STORAGE_KEY_TOKEN = "loa_boss_auth_token";
    const STORAGE_KEY_USER = "loa_boss_auth_user";

    // 取得當前重導向網址 (移除 query 與 hash)
    function getCleanRedirectUri() {
        return window.location.origin + window.location.pathname;
    }

    // 取得後端 API 基礎位址
    function getApiBaseUrl() {
        if (typeof DISCORD_AUTH_API_BASE !== "undefined" && DISCORD_AUTH_API_BASE) {
            return DISCORD_AUTH_API_BASE;
        }
        return "https://loa-boss-worker.f96003.workers.dev";
    }

    // 建立並注入驗證遮罩與樣式 (相容靜態 DOM 與動態注入)
    function injectAuthUI() {
        if (document.getElementById("discordAuthOverlay")) {
            const btn = document.getElementById("btnDiscordLogin");
            if (btn && !btn.dataset.bound) {
                btn.dataset.bound = "true";
                btn.addEventListener("click", redirectToDiscordOAuth);
            }
            const logoutBtn = document.getElementById("discordLogoutBtn");
            if (logoutBtn && !logoutBtn.dataset.bound) {
                logoutBtn.dataset.bound = "true";
                logoutBtn.addEventListener("click", logout);
            }
            const btnDev = document.getElementById("btnDevMockLogin");
            if (btnDev && !btnDev.dataset.bound) {
                btnDev.dataset.bound = "true";
                btnDev.addEventListener("click", () => devMockLogin());
            }

            // 本地環境下如果尚未有本地測試按鈕，自動追加
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
            if (isLocal && !document.getElementById("btnDevMockLogin")) {
                const modal = document.querySelector("#discordAuthOverlay .auth-modal-card");
                if (modal) {
                    const devBox = document.createElement("div");
                    devBox.id = "devMockLoginContainer";
                    devBox.style.marginTop = "16px";
                    devBox.style.borderTop = "1px dashed rgba(245, 158, 11, 0.4)";
                    devBox.style.paddingTop = "14px";
                    devBox.innerHTML = `
                        <div style="font-size:12px; color:#f59e0b; font-weight:600; margin-bottom:8px;">💡 本地測試專用模式</div>
                        <button id="btnDevMockLogin" type="button" style="display:flex; align-items:center; justify-content:center; gap:8px; width:100%; background:#202225; color:#f59e0b; border:2px solid #f59e0b; border-radius:6px; padding:12px 14px; font-size:14px; font-weight:700; cursor:pointer; transition:all 0.2s; box-shadow: 0 4px 12px rgba(245,158,11,0.2);">
                            <span>🛠️</span> <span>本地快速測試登入 (免跳轉 Discord)</span>
                        </button>
                        <div style="font-size:11px; color:#8e9297; margin-top:6px;">點擊即可輸入暱稱進入系統，直接驗證在線人員清單。</div>
                    `;
                    modal.appendChild(devBox);
                    const newBtnDev = document.getElementById("btnDevMockLogin");
                    if (newBtnDev) {
                        newBtnDev.addEventListener("click", () => devMockLogin());
                    }
                }
            }
            return;
        }

        // 注入專屬 CSS 樣式
        const style = document.createElement("style");
        style.innerHTML = `
            #discordAuthOverlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(10, 10, 15, 0.96);
                backdrop-filter: blur(12px);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                color: #f2f2f2;
            }

            .auth-modal-card {
                background: #18191c;
                border: 1px solid #2f3136;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
                border-radius: 12px;
                padding: 32px 28px;
                max-width: 440px;
                width: 90%;
                text-align: center;
                box-sizing: border-box;
            }

            .auth-modal-icon {
                width: 64px;
                height: 64px;
                margin: 0 auto 16px auto;
                background: #5865f2;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 15px rgba(88, 101, 242, 0.4);
            }

            .auth-modal-title {
                font-size: 22px;
                font-weight: 700;
                margin-bottom: 8px;
                color: #ffffff;
            }

            .auth-modal-desc {
                font-size: 14px;
                color: #b9bbbe;
                line-height: 1.6;
                margin-bottom: 24px;
            }

            .auth-channel-badge {
                display: inline-block;
                background: #202225;
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 13px;
                color: #5865f2;
                font-family: monospace;
                margin-bottom: 20px;
                border: 1px solid #36393f;
            }

            .btn-discord-login {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                width: 100%;
                background-color: #5865f2;
                color: #ffffff;
                border: none;
                border-radius: 6px;
                padding: 12px 20px;
                font-size: 15px;
                font-weight: 600;
                cursor: pointer;
                transition: background-color 0.2s, transform 0.1s;
                box-sizing: border-box;
            }

            .btn-discord-login:hover {
                background-color: #4752c4;
                transform: translateY(-1px);
            }

            .btn-discord-login:active {
                transform: translateY(1px);
            }

            .auth-status-box {
                margin-top: 16px;
                padding: 10px 14px;
                border-radius: 6px;
                font-size: 13px;
                display: none;
                line-height: 1.4;
            }

            .auth-status-info {
                background: rgba(88, 101, 242, 0.15);
                border: 1px solid #5865f2;
                color: #8ea1e1;
            }

            .auth-status-error {
                background: rgba(237, 66, 69, 0.15);
                border: 1px solid #ed4245;
                color: #f04747;
            }

            /* 右上角使用者身分列 */
            #discordUserStatusWidget {
                position: fixed;
                top: 8px;
                right: 12px;
                display: none;
                align-items: center;
                gap: 10px;
                background: rgba(24, 25, 28, 0.85);
                backdrop-filter: blur(8px);
                border: 1px solid #36393f;
                border-radius: 30px;
                padding: 4px 12px 4px 6px;
                z-index: 10000;
                font-size: 13px;
                color: #dcddde;
            }

            .discord-avatar-img {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                border: 1px solid #5865f2;
                object-fit: cover;
            }

            .discord-logout-link {
                color: #ed4245;
                cursor: pointer;
                font-size: 12px;
                text-decoration: underline;
                margin-left: 6px;
            }

            .discord-logout-link:hover {
                color: #ff6b6e;
            }

            .spinner {
                display: inline-block;
                width: 14px;
                height: 14px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                border-top-color: #fff;
                animation: spin 0.8s linear infinite;
                margin-right: 6px;
                vertical-align: middle;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);

        // 注入遮罩 DOM
        const overlay = document.createElement("div");
        overlay.id = "discordAuthOverlay";
        overlay.innerHTML = `
            <div class="auth-modal-card">
                <div class="auth-modal-icon">
                    <svg width="34" height="26" viewBox="0 0 71 55" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M60.1 4.9C55.4 2.7 50.4 1.1 45.1 0.2C45 0.2 44.9 0.3 44.8 0.4C44.1 1.6 43.4 3.1 42.9 4.3C37.2 3.4 31.6 3.4 26 4.3C25.5 3.1 24.8 1.6 24.1 0.4C24 0.3 23.9 0.2 23.8 0.2C18.5 1.1 13.5 2.7 8.8 4.9C8.7 4.9 8.6 5 8.6 5.1C-0.8 19.1 -1.7 32.7 1 46.1C1 46.2 1.1 46.3 1.2 46.4C7.4 51 13.4 53.7 19.3 55.5C19.5 55.6 19.6 55.5 19.7 55.4C21.1 53.5 22.3 51.5 23.4 49.3C23.5 49.1 23.4 48.9 23.2 48.8C21.2 48.1 19.3 47.1 17.5 46C17.3 45.9 17.3 45.6 17.5 45.5C17.9 45.2 18.2 44.9 18.6 44.6C18.7 44.5 18.9 44.5 19 44.5C31.5 50.2 45.1 50.2 57.4 44.5C57.5 44.5 57.7 44.5 57.8 44.6C58.2 44.9 58.5 45.2 58.9 45.5C59.1 45.6 59.1 45.9 58.9 46C57.1 47.1 55.2 48.1 53.2 48.8C53 48.9 52.9 49.1 53 49.3C54.1 51.5 55.3 53.5 56.7 55.4C56.8 55.5 56.9 55.6 57.1 55.5C63 53.7 69 51 75.2 46.4C75.3 46.3 75.4 46.2 75.4 46.1C78.4 31.6 74.4 18.1 60.3 5.1C60.3 5 60.2 4.9 60.1 4.9ZM24.5 37.8C20.9 37.8 17.9 34.5 17.9 30.4C17.9 26.3 20.8 23 24.5 23C28.2 23 31.2 26.3 31.1 30.4C31.1 34.5 28.2 37.8 24.5 37.8ZM46.9 37.8C43.3 37.8 40.3 34.5 40.3 30.4C40.3 26.3 43.2 23 46.9 23C50.6 23 53.6 26.3 53.5 30.4C53.5 34.5 50.6 37.8 46.9 37.8Z" fill="white"/>
                    </svg>
                </div>
                <div class="auth-modal-title">LOA-BOSS 監控系統</div>
                <div class="auth-modal-desc">
                    本系統需要 Discord 登入授權。<br>
                    您的 Discord 帳號必須擁有檢視指定頻道的權限方可進入使用。
                </div>
                <div class="auth-channel-badge">
                    # 頻道權限驗證已啟用
                </div>
                <button id="btnDiscordLogin" class="btn-discord-login">
                    <svg width="20" height="16" viewBox="0 0 71 55" fill="none">
                        <path d="M60.1 4.9C55.4 2.7 50.4 1.1 45.1 0.2C45 0.2 44.9 0.3 44.8 0.4C44.1 1.6 43.4 3.1 42.9 4.3C37.2 3.4 31.6 3.4 26 4.3C25.5 3.1 24.8 1.6 24.1 0.4C24 0.3 23.9 0.2 23.8 0.2C18.5 1.1 13.5 2.7 8.8 4.9C8.7 4.9 8.6 5 8.6 5.1C-0.8 19.1 -1.7 32.7 1 46.1C1 46.2 1.1 46.3 1.2 46.4C7.4 51 13.4 53.7 19.3 55.5C19.5 55.6 19.6 55.5 19.7 55.4C21.1 53.5 22.3 51.5 23.4 49.3C23.5 49.1 23.4 48.9 23.2 48.8C21.2 48.1 19.3 47.1 17.5 46C17.3 45.9 17.3 45.6 17.5 45.5C17.9 45.2 18.2 44.9 18.6 44.6C18.7 44.5 18.9 44.5 19 44.5C31.5 50.2 45.1 50.2 57.4 44.5C57.5 44.5 57.7 44.5 57.8 44.6C58.2 44.9 58.5 45.2 58.9 45.5C59.1 45.6 59.1 45.9 58.9 46C57.1 47.1 55.2 48.1 53.2 48.8C53 48.9 52.9 49.1 53 49.3C54.1 51.5 55.3 53.5 56.7 55.4C56.8 55.5 56.9 55.6 57.1 55.5C63 53.7 69 51 75.2 46.4C75.3 46.3 75.4 46.2 75.4 46.1C78.4 31.6 74.4 18.1 60.3 5.1C60.3 5 60.2 4.9 60.1 4.9ZM24.5 37.8C20.9 37.8 17.9 34.5 17.9 30.4C17.9 26.3 20.8 23 24.5 23C28.2 23 31.2 26.3 31.1 30.4C31.1 34.5 28.2 37.8 24.5 37.8ZM46.9 37.8C43.3 37.8 40.3 34.5 40.3 30.4C40.3 26.3 43.2 23 46.9 23C50.6 23 53.6 26.3 53.5 30.4C53.5 34.5 50.6 37.8 46.9 37.8Z" fill="white"/>
                    </svg>
                    使用 Discord 帳號登入
                </button>
                <div id="authStatusBox" class="auth-status-box"></div>
                ${(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') ? `
                <div id="devMockLoginContainer" style="margin-top: 16px; border-top: 1px dashed rgba(255,255,255,0.15); padding-top: 14px;">
                    <button id="btnDevMockLogin" type="button" style="display:flex; align-items:center; justify-content:center; gap:8px; width:100%; background:#202225; color:#f59e0b; border:1px solid #f59e0b; border-radius:6px; padding:10px 14px; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.2s;">
                        <span>🛠️</span> <span>本地快速測試登入 (免跳轉 Discord)</span>
                    </button>
                    <div style="font-size:11px; color:#8e9297; margin-top:6px;">僅於本機開發環境顯示，可自訂暱稱測試在線名單。</div>
                </div>
                ` : ''}
            </div>
        `;
        document.body.appendChild(overlay);

        // 注入右上角狀態元件
        const widget = document.createElement("div");
        widget.id = "discordUserStatusWidget";
        widget.innerHTML = `
            <img id="discordUserAvatar" class="discord-avatar-img" src="" alt="avatar">
            <span id="discordUserName" style="font-weight: 600;"></span>
            <span style="color: #43b581; font-size: 11px;">(已驗證)</span>
            <span id="discordLogoutBtn" class="discord-logout-link">登出</span>
        `;
        document.body.appendChild(widget);

        // 綁定事件
        document.getElementById("btnDiscordLogin").addEventListener("click", redirectToDiscordOAuth);
        document.getElementById("discordLogoutBtn").addEventListener("click", logout);

        const btnDev = document.getElementById("btnDevMockLogin");
        if (btnDev) {
            btnDev.addEventListener("click", () => devMockLogin());
        }
    }

    // 本機快速模擬身分登入 (方便測試多帳號即時連線)
    function devMockLogin(name) {
        const defaultNames = ["18zhao", "Purplepower 雞雞野人", "Ranger (Zsh)", "Ed", "fox", "TIM", "SLEEP"];
        const randomDefault = defaultNames[Math.floor(Math.random() * defaultNames.length)];
        const username = name || prompt("【本地測試模式】請輸入在線測試暱稱：", randomDefault) || randomDefault;
        const mockUser = {
            id: "dev_" + Math.random().toString(36).substring(2, 9),
            username: username,
            global_name: username,
            nickname: username,
            displayName: username,
            avatar: null
        };
        localStorage.setItem(STORAGE_KEY_TOKEN, "dev_mock_jwt_token_" + mockUser.id);
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(mockUser));
        window.currentDiscordUser = mockUser;
        hideOverlay(mockUser);
    }

    // 顯示訊息於遮罩狀態框
    function setAuthStatus(message, type = "info") {
        const box = document.getElementById("authStatusBox");
        if (!box) return;
        box.style.display = "block";
        box.className = `auth-status-box auth-status-${type}`;
        box.innerHTML = message;
    }

    // 隱藏狀態訊息
    function clearAuthStatus() {
        const box = document.getElementById("authStatusBox");
        if (box) box.style.display = "none";
    }

    // 顯示遮罩
    // 顯示遮罩
    function showOverlay() {
        document.body.classList.remove("authenticated");
        const overlay = document.getElementById("discordAuthOverlay");
        if (overlay) overlay.style.display = "flex";
        const widget = document.getElementById("discordUserStatusWidget");
        if (widget) widget.style.display = "none";
        const main = document.getElementById("mainAppContent");
        if (main) main.style.display = "none";
    }

    // 隱藏遮罩並顯示主畫面與右上角狀態
    function hideOverlay(user) {
        document.body.classList.add("authenticated");
        const overlay = document.getElementById("discordAuthOverlay");
        if (overlay) overlay.style.display = "none";
        const main = document.getElementById("mainAppContent");
        if (main) main.style.display = "block";

        const widget = document.getElementById("discordUserStatusWidget");
        if (widget && user) {
            widget.style.display = "flex";
            const avatarImg = document.getElementById("discordUserAvatar");
            const nameSpan = document.getElementById("discordUserName");

            const displayName = user.displayName || user.nickname || user.global_name || user.username || "Discord 用戶";
            nameSpan.textContent = displayName;

            if (user.avatar) {
                avatarImg.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
            } else {
                avatarImg.src = "https://cdn.discordapp.com/embed/avatars/0.png";
            }

            // 同步向在線管理者與 WebSocket 註冊在線身分，獲取伺服器完整的在線名單
            if (window.webrtcClient && typeof window.webrtcClient.registerPresence === "function") {
                window.webrtcClient.registerPresence(user);
            }
            if (window.OnlineUsersManager && typeof window.OnlineUsersManager.refresh === "function") {
                window.OnlineUsersManager.refresh();
            }
        }
    }

    // 跳轉至 Discord OAuth2 授權頁面
    async function redirectToDiscordOAuth() {
        if (window.location.protocol === 'file:') {
            alert("【本地預覽模式提示】\n\nDiscord 官方 OAuth2 安全機制不支援本地檔案協定 (file://)。\n\n請直接點擊下方金黃色按鈕：\n【🛠️ 本地快速測試登入 (免跳轉 Discord)】\n即可立即進入頁面驗證在線清單！");
            return;
        }

        const btn = document.getElementById("btnDiscordLogin");
        if (btn) btn.disabled = true;
        setAuthStatus('<span class="spinner"></span> 正在載入 Discord 授權設定...', "info");

        try {
            const apiBase = getApiBaseUrl();
            const res = await fetch(`${apiBase}/api/auth/config`);
            if (!res.ok) {
                throw new Error("無法取得後端認證設定");
            }
            const config = await res.json();
            if (!config.clientId) {
                throw new Error("後端尚未設定 DISCORD_CLIENT_ID 環境變數，請先配置 Cloudflare Worker。");
            }

            const redirectUri = getCleanRedirectUri();
            const discordUrl = `https://discord.com/oauth2/authorize?client_id=${config.clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify`;

            window.location.href = discordUrl;
        } catch (err) {
            console.error("初始化 Discord 登入失敗:", err);
            setAuthStatus(`❌ 錯誤: ${err.message}`, "error");
            if (btn) btn.disabled = false;
        }
    }

    // 處理授權碼換取 Token
    async function handleAuthCode(code) {
        showOverlay();
        const btn = document.getElementById("btnDiscordLogin");
        if (btn) btn.disabled = true;

        setAuthStatus('<span class="spinner"></span> 正在核對身分與頻道權限，請稍候...', "info");

        try {
            const apiBase = getApiBaseUrl();
            const redirectUri = getCleanRedirectUri();

            const res = await fetch(`${apiBase}/api/auth/discord/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    code: code,
                    redirect_uri: redirectUri,
                }),
            });

            const data = await res.json();

            // 清理網址上的 ?code= 避免使用者重整時重複發送
            window.history.replaceState({}, document.title, window.location.pathname);

            if (res.ok && data.success) {
                localStorage.setItem(STORAGE_KEY_TOKEN, data.token);
                localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data.user));
                window.currentDiscordUser = data.user;
                setAuthStatus("✅ 權限驗證通過！即將進入系統...", "info");
                setTimeout(() => {
                    hideOverlay(data.user);
                }, 600);
            } else {
                const reason = data.reason || "權限不足，無法存取此系統";
                setAuthStatus(`❌ 登入失敗: ${reason}`, "error");
                if (btn) btn.disabled = false;
            }
        } catch (err) {
            console.error("驗證過程發生錯誤:", err);
            setAuthStatus(`❌ 連線錯誤: ${err.message}`, "error");
            if (btn) btn.disabled = false;
        }
    }

    // 校驗本機儲存的 Token
    async function verifyLocalToken() {
        const token = localStorage.getItem(STORAGE_KEY_TOKEN);
        if (!token) {
            showOverlay();
            return;
        }

        // 若為本地測試 Mock 身分憑證，直接在本地放行避免被雲端 API 判定無效
        if (token.startsWith("dev_mock_jwt_token_")) {
            try {
                const user = JSON.parse(localStorage.getItem(STORAGE_KEY_USER) || "null");
                if (user) {
                    window.currentDiscordUser = user;
                    hideOverlay(user);
                    return;
                }
            } catch {}
        }

        try {
            const apiBase = getApiBaseUrl();
            const res = await fetch(`${apiBase}/api/auth/verify`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    window.currentDiscordUser = data.user;
                    hideOverlay(data.user);
                    return;
                }
            }

            // 若驗證未通過，清理儲存並顯示遮罩
            localStorage.removeItem(STORAGE_KEY_TOKEN);
            localStorage.removeItem(STORAGE_KEY_USER);
            showOverlay();
            setAuthStatus("登入憑證已失效，請重新登入。", "error");
        } catch (err) {
            console.warn("無法與驗證伺服器連線，先使用快取身分或提示重試:", err);
            // 若為網路斷線，可根據需求決定是否保留
            showOverlay();
            setAuthStatus("無法連線至認證伺服器，請檢查網路連線。", "error");
        }
    }

    // 登出函式
    function logout() {
        if (!confirm("確定要登出 Discord 帳號嗎？")) return;
        localStorage.removeItem(STORAGE_KEY_TOKEN);
        localStorage.removeItem(STORAGE_KEY_USER);
        window.currentDiscordUser = null;
        showOverlay();
        clearAuthStatus();
        const btn = document.getElementById("btnDiscordLogin");
        if (btn) btn.disabled = false;
    }

    // 模組主入口初始化
    function initAuth() {
        injectAuthUI();

        // 檢查網址是否有 code 參數
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
            handleAuthCode(code);
        } else {
            verifyLocalToken();
        }
    }

    // DOM 載入後執行
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAuth);
    } else {
        initAuth();
    }

    // 導出全域物件供外部存取
    window.DiscordAuth = {
        logout,
        getApiBaseUrl,
        devLogin: devMockLogin,
        getToken: () => localStorage.getItem(STORAGE_KEY_TOKEN),
        getUser: () => window.currentDiscordUser,
    };
})();
