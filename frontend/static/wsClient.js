// 後端 Worker WebSocket：唯一資料來源 (Boss 擊殺、完整同步、伺服器重啟、在線名單)
// 前端只接收資料，不向任何人發送 Boss 資料
const WS_URL = (typeof WEBRTC_WS_URL_OVERRIDE !== 'undefined' && WEBRTC_WS_URL_OVERRIDE)
    ? WEBRTC_WS_URL_OVERRIDE
    : "wss://loa-boss-worker.f96003.workers.dev/ws";

const BossWsClient = (function() {

    function getCurrentUser() {
        if (typeof DiscordAuth !== 'undefined' && DiscordAuth.getUser) {
            const user = DiscordAuth.getUser();
            if (user) return user;
        }
        if (window.currentDiscordUser) return window.currentDiscordUser;
        try {
            return JSON.parse(localStorage.getItem("loa_boss_auth_user") || "null");
        } catch {
            return null;
        }
    }

    class WsClient {
        constructor(clientId, wsUrl) {
            this.clientId = clientId;
            this.wsUrl = wsUrl;
            this.ws = null;
            this.reconnectInterval = 3000;
            this.reconnectAttempts = 0;
            this.heartbeatInterval = null;
            this.HEARTBEAT_TIMEOUT = 25000; // 25 秒發送一次 PING
            this.missPong = 0;
            this.pendingUser = null;
            // 本分頁目前的在線狀態 (online / idle)，重連或重新回報身分時一併送出
            this.presenceStatus = 'online';
        }

        startConnection() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                return;
            }
            this._connectWebSocket();
        }

        _connectWebSocket() {
            console.log(`[WS] 嘗試連線: ${this.wsUrl}`);
            try {
                this.ws = new WebSocket(this.wsUrl);
            } catch (e) {
                console.log(`[WS] 建立失敗: ${e.message}`);
                this._scheduleReconnect();
                return;
            }

            this.ws.onopen = () => {
                this.reconnectAttempts = 0;
                // 註冊後伺服器會回傳 Sync_Boss_Data 與 online_users_update
                this.ws.send(JSON.stringify({
                    type: 'client_register',
                    senderId: this.clientId,
                    user: this.pendingUser || getCurrentUser(),
                    status: this.presenceStatus
                }));
                console.log(`[WS] 已連線，ID: ${this.clientId}`);
                this._startHeartbeat();
            };

            this.ws.onmessage = (event) => this._handleMessage(event);

            this.ws.onclose = () => {
                console.log("[WS] 連線已關閉");
                this._stopHeartbeat();
                this._scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                console.error("[WS] 錯誤:", err);
                this.ws.close();
            };
        }

        // 心跳附帶使用者身分，讓伺服器休眠喚醒後能自癒在線名單
        _startHeartbeat() {
            this._stopHeartbeat();
            this.heartbeatInterval = setInterval(() => {
                if (this.missPong > 2) {
                    console.log(`[WS] missPong 已超過 ${this.missPong} 次，重新建立連線...`);
                    this.ws.close();
                    return;
                }
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'ping',
                        senderId: this.clientId,
                        user: getCurrentUser(),
                        status: this.presenceStatus
                    }));
                    this.missPong += 1;
                }
            }, this.HEARTBEAT_TIMEOUT);
        }

        _stopHeartbeat() {
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
                this.missPong = 0;
            }
        }

        _scheduleReconnect() {
            if (!this.ws || this.ws.readyState !== WebSocket.CLOSED) {
                return;
            }
            this.reconnectAttempts++;
            console.log(`[WS] 將在 ${this.reconnectInterval / 1000} 秒後嘗試第 ${this.reconnectAttempts} 次重連...`);
            setTimeout(() => this._connectWebSocket(), this.reconnectInterval);
        }

        _handleMessage(event) {
            const signal = JSON.parse(event.data);
            if (signal.senderId === this.clientId) return;

            switch (signal.type) {
                case 'user_joined':
                case 'request_peer_presence': {
                    // 有新分頁上線時重新回報身分，確保伺服器與新用戶掌握完整在線名單
                    const myUser = getCurrentUser();
                    if (myUser) {
                        setTimeout(() => this.registerPresence(myUser), Math.floor(Math.random() * 200) + 50);
                    }
                    return;
                }
                case 'online_users_update':
                    if (window.OnlineUsersManager && typeof window.OnlineUsersManager.updateUsers === 'function') {
                        window.OnlineUsersManager.updateUsers(signal.users, signal.count);
                    }
                    return;
                case 'pong':
                    if (signal.targetId == this.clientId) {
                        this.missPong = 0;
                    }
                    return;
                case 'Boss_Death':
                case 'Sync_Boss_Data':
                case 'Server_Reboot':
                    handleServerMessage(signal);
                    return;
            }
        }

        // 發送使用者閒置/在線狀態變更
        sendPresenceUpdate(status) {
            this.presenceStatus = status === 'idle' ? 'idle' : 'online';
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'update_presence',
                    senderId: this.clientId,
                    status: status
                }));
            }
        }

        // 登入後補送身分資訊 (伺服器會廣播 online_users_update)
        registerPresence(user) {
            this.pendingUser = user;
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'user_presence',
                    senderId: this.clientId,
                    user: user,
                    status: this.presenceStatus
                }));
            }
        }
    }

    return WsClient;
})();

function handleServerMessage(received) {
    try {
        switch (received.type) {
            case 'Sync_Boss_Data':
                if (received.bossListData && Array.isArray(received.bossListData)) {
                    bossListData = received.bossListData;
                    bossListData.forEach(b => {
                        if (!b.deathList || !Array.isArray(b.deathList)) {
                            b.deathList = [];
                        }
                        if (b.death && b.death !== "未知" && b.deathList.length === 0) {
                            b.deathList.push({
                                death: b.death,
                                emblem: b.emblem || "",
                                bossName: b.bossName,
                                type: b.type || 0,
                                isActive: false
                            });
                        }
                        syncBossLatestDeathAndEmblem(b);
                    });
                    window.bossListData = bossListData;
                }
                if (received.config && Array.isArray(received.config.messageList)) {
                    config.messageList = received.config.messageList;
                }
                if (received.config && received.config.rebootTime) {
                    const parsedReboot = new Date(received.config.rebootTime);
                    // 只有在重開機時間早於當前時間時才採用，避免誤設為未來時間過濾掉擊殺
                    if (!isNaN(parsedReboot.getTime()) && parsedReboot < new Date()) {
                        config.rebootTime = parsedReboot;
                    }
                }
                if (received.gateOpenTime) {
                    tracker.gateOpenTime = new Date(received.gateOpenTime);
                }
                if (received.gateCloseTime) {
                    tracker.gateCloseTime = new Date(received.gateCloseTime);
                }
                reDrawBossList();
                reDrawMessage();
                refresh();
                if (typeof tracker !== 'undefined' && tracker.resetGatePeriod) {
                    tracker.resetGatePeriod();
                }
                console.log('[WS] Sync_Boss_Data 同步完成');
                break;
            case 'Server_Reboot':
                console.log('[WS] 收到伺服器重啟事件，同步清空舊歷史紀錄', received);
                if (received.rebootTime) {
                    config.rebootTime = new Date(received.rebootTime);
                    const rebootElem = document.getElementById("reboot_message");
                    if (rebootElem) {
                        rebootElem.innerHTML = "重新開機時間：" + config.rebootTime.toLocaleString('zh-tw', { hour12: false });
                    }
                }
                if (received.config && Array.isArray(received.config.messageList)) {
                    config.messageList = received.config.messageList;
                } else {
                    config.messageList = [];
                }
                try {
                    localStorage.setItem("messageList", JSON.stringify(config.messageList));
                    if (config.rebootTime) {
                        localStorage.setItem("rebootTime", config.rebootTime.toISOString());
                    }
                } catch {}

                if (received.bossListData && Array.isArray(received.bossListData)) {
                    bossListData = received.bossListData;
                    window.bossListData = bossListData;
                } else if (Array.isArray(bossListData)) {
                    bossListData.forEach(b => {
                        b.death = "";
                        b.emblem = "";
                        b.deathList = [];
                        b.respawnCount = 0;
                    });
                }
                reDrawBossList();
                reDrawMessage();
                refresh();
                break;
            case 'Boss_Death':
                console.log('[WS] 收到 Boss_Death', received.deathInfo);
                updateBossData(received.deathInfo);
                break;
        }
    } catch (e) {
        console.error("[WS] 處理伺服器訊息錯誤:", e, received);
    }
}

// 主動自 Cloudflare Worker API 獲取雲端最新 Boss 狀態
async function initFetchBossDataFromCloud() {
    try {
        const apiUrl = WS_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/ws$/, '/api/boss-data');
        const res = await fetch(apiUrl);
        if (res.ok) {
            const cloudData = await res.json();
            if (cloudData && Array.isArray(cloudData.bossListData) && cloudData.bossListData.length > 0) {
                console.log("[CLOUD_INIT] 成功自 Worker 載入最新 Boss 資料:", cloudData.bossListData.length, "隻");
                handleServerMessage({
                    type: 'Sync_Boss_Data',
                    bossListData: cloudData.bossListData,
                    config: cloudData.config || (typeof config !== 'undefined' ? config : { messageList: [], rebootTime: new Date() }),
                    gateOpenTime: cloudData.gateOpenTime || (typeof tracker !== 'undefined' ? tracker.gateOpenTime : new Date()),
                    gateCloseTime: cloudData.gateCloseTime || (typeof tracker !== 'undefined' ? tracker.gateCloseTime : new Date())
                });
            }
        }
    } catch (e) {
        console.warn("[CLOUD_INIT] 無法連線至 Worker API，使用本機預設值", e);
    }
}

// SPK_ 前綴讓伺服器辨識為未登入的連線，不列入在線成員
window.wsClient = new BossWsClient('SPK_' + Math.random().toString(36).substring(2, 9), WS_URL);
window.wsClient.startConnection();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFetchBossDataFromCloud);
} else {
    initFetchBossDataFromCloud();
}
