/**
 * 在線使用者清單與即時狀態管理模組 (onlineUsers.js)
 * 
 * 核心功能：
 * 1. 右上角在線成員膠囊按鈕 (🟢 數字) 與浮動展開名單 (比照 Discord 成員列表風格)
 * 2. 顯示使用者 Discord 頭像、伺服器暱稱/全域名稱、在線 (🟢) 與閒置 (🌙) 狀態
 * 3. 透過 WebSocket (online_users_update) 即時雙向同步在線成員
 * 4. 支援分頁閒置偵測 (Idle Detection)，無操作或切換背景自動標記為閒置
 * 5. 離線與初始載入時自動透過 REST API (/api/online-users) 獲取最新狀態
 */

(function () {
    const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 分鐘無動作標記為閒置
    let currentUsers = [];
    let isDropdownOpen = false;
    let idleTimer = null;
    let myPresenceStatus = "online";

    // 取得 API 基礎位址
    function getApiBaseUrl() {
        if (typeof DiscordAuth !== "undefined" && DiscordAuth.getApiBaseUrl) {
            return DiscordAuth.getApiBaseUrl();
        }
        if (typeof DISCORD_AUTH_API_BASE !== "undefined" && DISCORD_AUTH_API_BASE) {
            return DISCORD_AUTH_API_BASE;
        }
        return "https://loa-boss-worker.f96003.workers.dev";
    }

    // 取得當前本機 Discord 使用者
    function getCurrentUser() {
        if (typeof DiscordAuth !== "undefined" && DiscordAuth.getUser) {
            const u = DiscordAuth.getUser();
            if (u) return u;
        }
        if (window.currentDiscordUser) {
            return window.currentDiscordUser;
        }
        try {
            return JSON.parse(localStorage.getItem("loa_boss_auth_user") || "null");
        } catch {
            return null;
        }
    }

    // 取得頭像網址 (支援自訂頭像與預設彩色頭像回退)
    function getAvatarUrl(user) {
        if (!user) return "https://cdn.discordapp.com/embed/avatars/0.png";
        if (user.avatar) {
            return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
        }
        try {
            const idx = (BigInt(user.id || 0) >> 22n) % 6n;
            return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
        } catch {
            return "https://cdn.discordapp.com/embed/avatars/0.png";
        }
    }

    // 注入專屬 CSS 樣式
    function injectStyles() {
        if (document.getElementById("discordOnlineStyles")) return;
        const style = document.createElement("style");
        style.id = "discordOnlineStyles";
        style.innerHTML = `
            /* 右上角在線膠囊按鈕 */
            .discord-online-pill {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                background: rgba(17, 20, 28, 0.88);
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 8px;
                padding: 4px 10px;
                cursor: pointer;
                user-select: none;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                box-sizing: border-box;
            }

            .discord-online-pill:hover {
                background: rgba(26, 30, 42, 0.95);
                border-color: rgba(251, 191, 36, 0.6);
            }

            .discord-online-pill.active {
                border-color: #f59e0b;
                box-shadow: 0 0 0 1px #f59e0b, 0 4px 12px rgba(245, 158, 11, 0.25);
                background: rgba(26, 30, 42, 0.98);
            }

            .discord-online-dot {
                width: 9px;
                height: 9px;
                background-color: #23a55a;
                border-radius: 50%;
                display: inline-block;
                box-shadow: 0 0 6px rgba(35, 165, 90, 0.8);
                flex-shrink: 0;
            }

            .discord-online-count {
                font-weight: 700;
                font-size: 14px;
                color: #f2f3f5;
                line-height: 1;
            }

            /* 下拉彈出選單容器 */
            .discord-online-dropdown {
                position: fixed;
                top: 44px;
                right: 12px;
                width: 260px;
                max-width: 90vw;
                background: #111318;
                border: 1px solid #232733;
                border-radius: 12px;
                box-shadow: 0 12px 36px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.04);
                z-index: 10001;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                overflow: hidden;
                display: none;
                animation: discordDropdownFadeIn 0.15s ease-out;
            }

            @keyframes discordDropdownFadeIn {
                from {
                    opacity: 0;
                    transform: translateY(-6px) scale(0.98);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            .discord-online-dropdown-header {
                padding: 10px 14px 8px 14px;
                font-size: 11px;
                font-weight: 700;
                color: #949ba4;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .discord-online-users-list {
                max-height: 380px;
                overflow-y: auto;
                padding: 6px 6px;
            }

            /* 自訂深色滾動條 */
            .discord-online-users-list::-webkit-scrollbar {
                width: 5px;
            }
            .discord-online-users-list::-webkit-scrollbar-track {
                background: transparent;
            }
            .discord-online-users-list::-webkit-scrollbar-thumb {
                background: #2b2d31;
                border-radius: 4px;
            }
            .discord-online-users-list::-webkit-scrollbar-thumb:hover {
                background: #3b3e45;
            }

            /* 成員項目 Row */
            .discord-member-row {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 6px 8px;
                border-radius: 6px;
                cursor: default;
                transition: background 0.12s ease;
            }

            .discord-member-row:hover {
                background: rgba(255, 255, 255, 0.06);
            }

            /* 頭像與狀態圓標 */
            .discord-member-avatar-wrap {
                position: relative;
                width: 34px;
                height: 34px;
                flex-shrink: 0;
            }

            .discord-member-avatar {
                width: 34px;
                height: 34px;
                border-radius: 50%;
                object-fit: cover;
                background-color: #2b2d31;
                display: block;
            }

            .discord-status-badge {
                position: absolute;
                bottom: -1px;
                right: -1px;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                box-sizing: border-box;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 2.5px solid #111318;
            }

            .discord-status-online {
                background-color: #23a55a;
            }

            .discord-status-idle {
                background-color: #111318;
                border: none;
            }

            .discord-status-idle svg {
                width: 12px;
                height: 12px;
                display: block;
            }

            /* 成員文字資訊 */
            .discord-member-info {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                justify-content: center;
            }

            .discord-member-name {
                font-size: 13.5px;
                font-weight: 500;
                color: #dbdee1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                line-height: 1.3;
            }

            .discord-member-row:hover .discord-member-name {
                color: #ffffff;
            }

            .discord-member-me-tag {
                font-size: 10px;
                color: #23a55a;
                margin-left: 5px;
                font-weight: 600;
            }

            .discord-online-empty {
                padding: 20px 10px;
                text-align: center;
                font-size: 13px;
                color: #80848e;
            }

            /* 右上角膠囊位置：避開右上角 90px 的設定按鈕區 */
            #discordHeaderBar {
                position: fixed;
                top: 8px;
                right: 104px;
                display: flex;
                align-items: center;
                gap: 8px;
                z-index: 10000;
            }

            @media (max-width: 600px) {
                #discordHeaderBar {
                    top: 6px;
                    right: 8px;
                }
                .discord-online-dropdown {
                    right: 8px;
                    top: 40px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // 建立並整合右上角 HeaderBar
    function setupDOM() {
        injectStyles();

        // 檢查是否已有 HeaderBar
        let bar = document.getElementById("discordHeaderBar");
        if (!bar) {
            bar = document.createElement("div");
            bar.id = "discordHeaderBar";
            document.body.appendChild(bar);
        }

        // 建立在線膠囊按鈕
        let pill = document.getElementById("discordOnlinePill");
        if (!pill) {
            pill = document.createElement("div");
            pill.id = "discordOnlinePill";
            pill.className = "discord-online-pill";
            pill.title = "點擊檢視在線成員清單";
            pill.innerHTML = `
                <span class="discord-online-dot"></span>
                <span class="discord-online-count" id="discordOnlineCount">0</span>
            `;
            bar.insertBefore(pill, bar.firstChild);

            pill.addEventListener("click", function (e) {
                e.stopPropagation();
                toggleDropdown();
            });
        }

        // 如果已有身分元件，將其移動至 HeaderBar 內部協同排列
        const userWidget = document.getElementById("discordUserStatusWidget");
        if (userWidget && userWidget.parentElement !== bar) {
            // 清理其 fixed 定位以融入 flex container
            userWidget.style.position = "static";
            userWidget.style.top = "auto";
            userWidget.style.right = "auto";
            bar.appendChild(userWidget);
        }

        // 建立下拉名單容器
        let dropdown = document.getElementById("discordOnlineDropdown");
        if (!dropdown) {
            dropdown = document.createElement("div");
            dropdown.id = "discordOnlineDropdown";
            dropdown.className = "discord-online-dropdown";
            dropdown.innerHTML = `
                <div class="discord-online-dropdown-header">
                    <span>在線成員 — <span id="discordDropdownCount">0</span></span>
                </div>
                <div class="discord-online-users-list" id="discordOnlineUsersList">
                    <div class="discord-online-empty">載入中...</div>
                </div>
                <div class="discord-online-dropdown-footer" id="discordDropdownFooter" style="padding: 8px 12px; background: rgba(0,0,0,0.3); border-top: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #8e9297;">
                    <span id="discordFooterUserName" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;"></span>
                    <button id="discordFooterLogoutBtn" type="button" style="background: none; border: none; color: #ed4245; cursor: pointer; text-decoration: underline; font-size: 11px; padding: 2px 4px;">登出</button>
                </div>
            `;
            document.body.appendChild(dropdown);

            // 避免點擊選單內部時關閉
            dropdown.addEventListener("click", function (e) {
                e.stopPropagation();
            });

            // 綁定選單內登出
            const logoutBtn = dropdown.querySelector("#discordFooterLogoutBtn");
            if (logoutBtn) {
                logoutBtn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    if (typeof DiscordAuth !== "undefined" && DiscordAuth.logout) {
                        DiscordAuth.logout();
                    } else {
                        const origBtn = document.getElementById("discordLogoutBtn");
                        if (origBtn) origBtn.click();
                    }
                });
            }
        }

        // 點擊頁面其他地方自動關閉下拉選單
        document.addEventListener("click", function (e) {
            if (isDropdownOpen) {
                closeDropdown();
            }
        });
    }

    // 切換下拉清單顯示/隱藏
    function toggleDropdown() {
        if (isDropdownOpen) {
            closeDropdown();
        } else {
            openDropdown();
        }
    }

    function openDropdown() {
        const dropdown = document.getElementById("discordOnlineDropdown");
        const pill = document.getElementById("discordOnlinePill");
        if (!dropdown || !pill) return;

        // 計算對齊位置
        const rect = pill.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 6) + "px";
        dropdown.style.right = (window.innerWidth - rect.right) + "px";

        dropdown.style.display = "block";
        pill.classList.add("active");
        isDropdownOpen = true;

        const myUser = getCurrentUser();
        const footerName = document.getElementById("discordFooterUserName");
        if (footerName) {
            const name = myUser ? (myUser.displayName || myUser.nickname || myUser.global_name || myUser.username || "已登入") : "已登入用戶";
            footerName.textContent = "👤 " + name;
        }

        renderUserList();
    }

    function closeDropdown() {
        const dropdown = document.getElementById("discordOnlineDropdown");
        const pill = document.getElementById("discordOnlinePill");
        if (dropdown) dropdown.style.display = "none";
        if (pill) pill.classList.remove("active");
        isDropdownOpen = false;
    }

    // 渲染在線使用者清單
    function renderUserList() {
        const listContainer = document.getElementById("discordOnlineUsersList");
        const countSpan = document.getElementById("discordDropdownCount");
        const pillCountSpan = document.getElementById("discordOnlineCount");

        const count = currentUsers.length;
        if (countSpan) countSpan.textContent = count;
        if (pillCountSpan) pillCountSpan.textContent = count;

        if (!listContainer) return;

        if (count === 0) {
            listContainer.innerHTML = `<div class="discord-online-empty">目前尚無其他在線成員</div>`;
            return;
        }

        const myUser = getCurrentUser();
        const myId = myUser ? String(myUser.id) : null;

        let html = "";
        currentUsers.forEach(user => {
            const isMe = myId && String(user.id) === myId;
            const displayName = user.displayName || user.nickname || user.global_name || user.username || "在線玩家";
            const avatarUrl = getAvatarUrl(user);
            const status = user.status || "online";

            let statusBadgeHtml = "";
            if (status === "idle") {
                // Discord 經典黃色月牙
                statusBadgeHtml = `
                    <span class="discord-status-badge discord-status-idle" title="閒置">
                        <svg viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M8.5 0.5C8.5 4.91828 4.91828 8.5 0.5 8.5C0.331458 8.5 0.164627 8.49479 0 8.48451C1.03713 9.42171 2.40822 10 3.91667 10C7.2764 10 10 7.2764 10 3.91667C10 2.40822 9.42171 1.03713 8.48451 0C8.49479 0.164627 8.5 0.331458 8.5 0.5Z" fill="#F0B232"/>
                        </svg>
                    </span>
                `;
            } else {
                // Discord 綠色實心在線圓點
                statusBadgeHtml = `<span class="discord-status-badge discord-status-online" title="在線"></span>`;
            }

            html += `
                <div class="discord-member-row" title="${displayName} (${status === 'idle' ? '閒置' : '在線'})">
                    <div class="discord-member-avatar-wrap">
                        <img class="discord-member-avatar" src="${avatarUrl}" alt="avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                        ${statusBadgeHtml}
                    </div>
                    <div class="discord-member-info">
                        <div class="discord-member-name">
                            ${displayName}
                            ${isMe ? '<span class="discord-member-me-tag">(你)</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;
    }

    // 更新在線清單資料 (由 WebSocket 推播或 REST API 回傳)
    function updateUsers(users, count) {
        let rawList = Array.isArray(users) ? [...users] : [];

        // 嚴格過濾：排除純信令訪客 ID (SPK_xxxx, HUB_xxxx)
        let list = rawList.filter(u => {
            if (!u || !u.id) return false;
            const id = String(u.id);
            const name = String(u.displayName || u.username || "");
            return !id.startsWith("SPK_") && !id.startsWith("HUB_") && !name.startsWith("SPK_") && !name.startsWith("HUB_");
        });

        const myUser = getCurrentUser();

        // 若當前使用者已登入，名單中未包含自己時自動補入，確保人數至少有自己
        if (myUser && myUser.id) {
            const hasMe = list.some(u => String(u.id) === String(myUser.id));
            if (!hasMe) {
                list.unshift({
                    id: String(myUser.id),
                    username: myUser.username || "自己",
                    global_name: myUser.global_name || "",
                    nickname: myUser.nickname || null,
                    displayName: myUser.displayName || myUser.nickname || myUser.global_name || myUser.username || "自己",
                    avatar: myUser.avatar || null,
                    status: myPresenceStatus || "online"
                });
            }
        }

        currentUsers = list;

        const pillCountSpan = document.getElementById("discordOnlineCount");
        const countToDisplay = currentUsers.length;
        if (pillCountSpan) pillCountSpan.textContent = countToDisplay;

        const countSpan = document.getElementById("discordDropdownCount");
        if (countSpan) countSpan.textContent = countToDisplay;

        if (isDropdownOpen) {
            renderUserList();
        }
    }

    // 發送狀態變更通知
    function setPresence(status) {
        if (myPresenceStatus === status) return;
        myPresenceStatus = status;

        if (window.wsClient && typeof window.wsClient.sendPresenceUpdate === "function") {
            window.wsClient.sendPresenceUpdate(status);
        }

        // 同步更新自己在本機名單的狀態視覺
        const myUser = getCurrentUser();
        if (myUser && currentUsers.length > 0) {
            const found = currentUsers.find(u => String(u.id) === String(myUser.id));
            if (found) {
                found.status = status;
                if (isDropdownOpen) renderUserList();
            }
        }
    }

    // 閒置計時器重置
    function resetIdleTimer() {
        if (myPresenceStatus === "idle") {
            setPresence("online");
        }
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            setPresence("idle");
        }, IDLE_TIMEOUT_MS);
    }

    // 啟動使用者操作監聽
    function initIdleDetection() {
        const events = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"];
        events.forEach(evt => {
            window.addEventListener(evt, resetIdleTimer, { passive: true });
        });

        document.addEventListener("visibilitychange", function () {
            if (document.hidden) {
                // 背景閒置 1 分鐘後切換為 idle
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    setPresence("idle");
                }, 60 * 1000);
            } else {
                resetIdleTimer();
            }
        });

        resetIdleTimer();
    }

    // 從 REST API 取得初始名單
    async function fetchInitialUsers() {
        try {
            const apiBase = getApiBaseUrl();
            const res = await fetch(`${apiBase}/api/online-users`);
            if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data.users)) {
                    updateUsers(data.users, data.count);
                }
            }
        } catch (err) {
            console.warn("無法取得初始在線成員名單:", err);
        }
    }

    // 模組主入口初始化
    function init() {
        setupDOM();
        initIdleDetection();
        fetchInitialUsers();

        // 定期定時保險輪詢 (每 60 秒一次，作為 WebSocket 斷線時的備援)
        setInterval(fetchInitialUsers, 60000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    // 導出全域管理者供 WebSocket 與外部調用
    window.OnlineUsersManager = {
        updateUsers,
        setPresence,
        open: openDropdown,
        close: closeDropdown,
        toggle: toggleDropdown,
        getUsers: () => currentUsers,
        refresh: fetchInitialUsers,
    };
})();
