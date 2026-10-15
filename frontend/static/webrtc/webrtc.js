// const WebRTC_WS_URL = 'wss://loa-boss-ws-server.onrender.com/ws';
// 必須使用 Punycode 格式
// const WebRTC_WS_URL = "wss://loabosstime.xn--ihqt9a492c9lev96b.online/ws";
const WebRTC_WS_URL = (typeof WEBRTC_WS_URL_OVERRIDE !== 'undefined' && WEBRTC_WS_URL_OVERRIDE)
    ? WEBRTC_WS_URL_OVERRIDE
    : "wss://loa-boss-worker.f96003.workers.dev/ws";
  
let MY_ROLE = null;
let MY_CLIENT_ID = null;
let webrtcClient = null;

// STUN 伺服器配置
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// 替換的 UI 函數集合 - 只保留 console.log
const UIManager = {
    appendMessage(msg) {
        // 去除 HTML 標籤後輸出到 Console
        console.log(`[LOG] ${msg.replace(/<[^>]*>?/gm, '')}`); 
    },

    updateWsStatus(status) {
        console.log(`[WS_STATUS] WebSocket 狀態更新: ${status}`);
    },
    
    updateSdpDisplay(type, sdp) {
        // 保持沉默
    },
    
    updatePeerStatus(peerId, iceState, dataChannelState) {
        console.log(`[P2P_STATUS] ID: ${peerId}, ICE: ${iceState}, DC: ${dataChannelState}`);
    }
};

// ----------------------------------------------------
// 2. WebRTC 客戶端模組 (核心邏輯，包含業務處理)
// ----------------------------------------------------

const WebRTCClientModule = (function() {
    // 固定的分塊大小 (建議值 16KB)
    const MAX_CHUNK_SIZE = 16 * 1024; 

    class WebRTCClient {
        constructor(clientId, wsUrl, config, role, uiManager) {
            this.clientId = clientId;
            this.wsUrl = wsUrl;
            this.config = config;
            this.role = role;
            this.ui = uiManager;
            this.ws = null;
            this.peerConnections = new Map();
            this.dataChannels = new Map();
            this.reconnectInterval = 3000;
            this.reconnectAttempts = 0;
            this.chunkBuffers = new Map(); 
            
            // 🎯 優化 1: 用於管理 disconnected 狀態的超時計時器
            this._disconnectTimers = new Map();
            // 🎯 新增：總連線建立超時（例如 20 秒）
            this.TOTAL_CONNECT_TIMEOUT = 20000;
            this.heartbeatInterval = null;
            this.HEARTBEAT_TIMEOUT = 25000; // 25 秒發送一次 PING
            this.missPong = 0;
        }

        // -----------------------------------------------------------------
        // 狀態獲取函數 
        // -----------------------------------------------------------------
        getWsStatus() {
            if (!this.ws) return 'Unavailable';
            switch (this.ws.readyState) {
                case WebSocket.CONNECTING: return 'Connecting';
                case WebSocket.OPEN: return 'Open';
                case WebSocket.CLOSING: return 'Closing';
                case WebSocket.CLOSED: return 'Closed';
                default: return 'Unknown';
            }
        }

        getP2PConnectionCount() {
            let count = 0;
            for (const channel of this.dataChannels.values()) {
                if (channel.readyState === 'open') {
                    count++;
                }
            }
            return count;
        }

        getP2PConnectionStatus() {
            const status = [];
            for (const [id, pc] of this.peerConnections.entries()) {
                const dc = this.dataChannels.get(id);
                status.push({
                    id: id,
                    ice: pc.iceConnectionState, 
                    dataChannel: dc ? dc.readyState : 'none'
                });
            }
            return status;
        }

        // --- WebSocket 連線與重連機制 (未修改) ---
        startConnection() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ui.appendMessage("WebSocket 已連線，無需重複啟動。");
                return;
            }
            this._connectWebSocket();
        }

        _connectWebSocket() {
            this.ui.updateWsStatus('connecting');
            this.ui.appendMessage(`嘗試連線到信令伺服器: ${this.wsUrl}`);
            
            try {
                this.ws = new WebSocket(this.wsUrl); 
            } catch (e) {
                this.ui.appendMessage(`WebSocket 建立失敗: ${e.message}`);
                this._scheduleReconnect();
                return;
            }

            this.ws.onopen = () => {
                this.reconnectAttempts = 0;
                this.ui.updateWsStatus('connected');
                
                let currentUser = this.pendingUser || null;
                if (!currentUser && typeof DiscordAuth !== 'undefined' && DiscordAuth.getUser) {
                    currentUser = DiscordAuth.getUser();
                }
                if (!currentUser && typeof window.currentDiscordUser !== 'undefined') {
                    currentUser = window.currentDiscordUser;
                }
                if (!currentUser) {
                    try {
                        currentUser = JSON.parse(localStorage.getItem("loa_boss_auth_user") || "null");
                    } catch {}
                }

                const registrationMessage = {
                    type: 'client_register', 
                    senderId: this.clientId,
                    user: currentUser || null
                };
                this.ws.send(JSON.stringify(registrationMessage));
                this.ui.appendMessage(`信令連線成功，ID: ${this.clientId} (${this.role.toUpperCase()}) 已發送註冊請求。`);

                if (this.role === 'hub') {
                    this.connectAllOnlineUsers();
                }
                // 所有角色 (hub 與 spoke) 均啟動心跳，確保持續維持在線身分與 WebSocket 連線
                this._startHeartbeat();
                // 向伺服器索取目前完整的在線成員列表
                this.getWsAllOnlineUsers();                
            };

            this.ws.onmessage = (event) => this._handleWebSocketMessage(event);

            this.ws.onclose = () => {
                this.ui.updateWsStatus('disconnected');
                this.ui.appendMessage("WebSocket 連線已關閉。");                
                this._stopHeartbeat(); // 停止心跳
                this._scheduleReconnect();
            };
            
            this.ws.onerror = (err) => {
                console.error("WebSocket 錯誤:", err);
                this.ui.updateWsStatus('disconnected');
                this.ws.close();
            };
        }

        // 新增心跳函數 (附帶使用者身分以實現伺服器休眠自癒)
        _startHeartbeat() {
            this._stopHeartbeat(); // 確保只運行一個計時器
            this.heartbeatInterval = setInterval(() => {
                if (this.missPong > 2) {
                    this.ui.appendMessage(`WebSocket missPong 已超過 ${this.missPong} 次，重新建立連線...`);          
                    this.ws.close();
                    return;
                }
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const currentUser = (typeof DiscordAuth !== 'undefined' && DiscordAuth.getUser)
                        ? DiscordAuth.getUser()
                        : (window.currentDiscordUser || (function() {
                            try { return JSON.parse(localStorage.getItem("loa_boss_auth_user") || "null"); } catch { return null; }
                        })());

                    const pingMessage = JSON.stringify({
                        type: 'ping',
                        senderId: this.clientId,
                        user: currentUser || null
                    });
                    this.ws.send(pingMessage);
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
            this.ui.appendMessage(`[${this.role.toUpperCase()}] WebSocket 連線中斷，將在 ${this.reconnectInterval / 1000} 秒後嘗試第 ${this.reconnectAttempts} 次重連以保持在線清單...`);
            setTimeout(() => this._connectWebSocket(), this.reconnectInterval);
        }


        // --- WebSocket 訊息處理 (未修改) ---

        async _handleWebSocketMessage(event) {
            const signal = JSON.parse(event.data);
            
            if (signal.senderId === this.clientId) return;
            
            // =======================================================
            // 💥 新增檢查：過濾掉來自 'server' 的信令訊息
            // =======================================================
            const peerId = signal.senderId;

            // 非WEBRTC 連線相關
            switch (signal.type) {
                case 'user_joined':
                    const newUserId = signal.newUserId;
                    this.ui.appendMessage(`[HUB] 偵測到新用戶 [${newUserId}] 上線`);
                    if (newUserId !== this.clientId) {
                        // 當有新用戶上線時，在線端自動向伺服器覆奏自己的身分，確保伺服器掌握所有人並將名單即時同步給該新用戶
                        const myUser = (typeof DiscordAuth !== 'undefined' && DiscordAuth.getUser)
                            ? DiscordAuth.getUser()
                            : (window.currentDiscordUser || (function() {
                                try { return JSON.parse(localStorage.getItem("loa_boss_auth_user") || "null"); } catch { return null; }
                            })());
                        if (myUser) {
                            setTimeout(() => {
                                this.registerPresence(myUser);
                            }, Math.floor(Math.random() * 200) + 50);
                        }

                        if (this.role === 'hub') {
                            if (newUserId.includes("SPK_")) {
                                this.ui.appendMessage(`[HUB] 偵測到新用戶 [${newUserId}] 上線，自動發起連線...`);
                                await this.sendSdpOffer(newUserId); 
                            }
                        }
                    }
                    break;
                case 'request_peer_presence':
                    if (signal.senderId !== this.clientId) {
                        const myUserForPing = (typeof DiscordAuth !== 'undefined' && DiscordAuth.getUser)
                            ? DiscordAuth.getUser()
                            : (window.currentDiscordUser || (function() {
                                try { return JSON.parse(localStorage.getItem("loa_boss_auth_user") || "null"); } catch { return null; }
                            })());
                        if (myUserForPing) {
                            this.registerPresence(myUserForPing);
                        }
                    }
                    break;
                case 'online_users_update':
                    if (window.OnlineUsersManager && typeof window.OnlineUsersManager.updateUsers === 'function') {
                        window.OnlineUsersManager.updateUsers(signal.users, signal.count);
                    }
                    break;
                case 'online_users_list':
                    const userIds = signal.users || [];
                    if (signal.members && window.OnlineUsersManager && typeof window.OnlineUsersManager.updateUsers === 'function') {
                        window.OnlineUsersManager.updateUsers(signal.members, signal.members.length);
                    }
                    this.ui.appendMessage(`[${this.role}] 收到 ${userIds.length} 個在線用戶 ID，開始建立連線...`);
                    if (this.role == 'hub') {
                                        
                        userIds.forEach(async (targetId) => {
                            const isConnectingOrOpen = this.dataChannels.has(targetId) && 
                                (this.dataChannels.get(targetId).readyState === 'open' || 
                                    this.dataChannels.get(targetId).readyState === 'connecting');
                                

                            if (targetId.includes("SPK_") && targetId !== this.clientId && !isConnectingOrOpen) {
                                console.log(`[HUB] 為目標 ${targetId} 自動發送 Offer...`);
                                await this.sendSdpOffer(targetId); 
                            }
                        });
                        return;
                    }

                    if (this.role == 'spoke') {
                        console.log(`[${this.role}] WS已連線使用者`, userIds)
                        return;
                    }
                    break;
                case 'ping':
                    // 如果 Hub 收到 Spoke 的 Ping，可考慮回覆 Pong，但這裡保持不變
                    break;
                case 'pong':
                    // 🎯 修正：收到 Pong，表示連線活躍，清除超時計時器
                    if (signal.targetId == this.clientId) {
                        console.log("正確收到pong 回應, 清除計時器");
                        this.missPong = 0;
                    }                    
                    break;
                case 'Boss_Death':
                case 'Sync_Boss_Data':
                    console.log(`[WS_DIRECT] 收到來自伺服器的全域廣播:`, signal.type);
                    if (typeof webRTC_handleMessage === 'function') {
                        webRTC_handleMessage(peerId || 'server', signal);
                    }
                    return;
            }
             
            // 以下是WEBRTC 連線需要判斷targetID 是否為自己
            if (signal.targetId !== this.clientId) {
                console.log(`[${this.role}] targetID 不是自己跳過`, signal)
                return;
            }
            // 以下是WEBRTC 連線需要判斷targetID 是否為自己
            if (peerId == 'server') {
                console.log(`[${this.role}] senderID 為 server 跳過 WEBRTC流程`, signal)
                return;
            }
            let pc = this._getOrCreatePeerConnection(peerId, false); 


            // WEBRTC 使用指令
            switch (signal.type) {
                case 'offer':
                    await pc.setRemoteDescription(new RTCSessionDescription(signal));
                    this.ui.updateSdpDisplay('remote', signal);
                    this._sendSdpAnswer(peerId); 
                    break;
                case 'answer':
                    if (pc.signalingState === 'stable' && pc.remoteDescription) return; 
                    await pc.setRemoteDescription(new RTCSessionDescription(signal));
                    this.ui.updateSdpDisplay('remote', signal);
                    break;
                case 'candidate':
                    if (signal.candidate) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                        } catch (e) {
                            console.error("添加 ICE 候選失敗:", e);
                        }
                    }
                    break;
            }
        }
        
        // 🎯 新增：單一清理函式
        _cleanupPeerConnection(id, reason) {
            const pc = this.peerConnections.get(id);
            const dc = this.dataChannels.get(id);

            if (this._disconnectTimers.has(id)) {
                 clearTimeout(this._disconnectTimers.get(id));
                 this._disconnectTimers.delete(id);
            }

            // 2. 關閉 DataChannel
            if (dc && dc.readyState !== 'closed') {
                // ⚠️ 移除 DataChannel 上的監聽器 (可選，但更嚴謹)
                dc.onopen = dc.onmessage = dc.onclose = dc.onerror = null;
                dc.close();
            }

            if (pc) {
                 // 關閉 PeerConnection 確保資源釋放
                 pc.close(); 
            }
            this.peerConnections.delete(id);
            this.dataChannels.delete(id);
            this.chunkBuffers.delete(id); 
            this.ui.appendMessage(`[P2P 清理] 與 [${id}] 的連線因 [${reason}] 移除。`);
            
            if (this.role === 'spoke' && this.dataChannels.size === 0) {
                 this._scheduleReconnect(); 
            }
        }
        
        // --- WebRTC 連線與協商 (已修改 oniceconnectionstatechange) ---
        
        _getOrCreatePeerConnection(id, isCaller) {
            if (this.peerConnections.has(id)) {
                return this.peerConnections.get(id);
            }

            const pc = new RTCPeerConnection(this.config);
            
            pc.onicecandidate = (event) => {
                if (event.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'candidate',
                        candidate: event.candidate,
                        senderId: this.clientId,
                        targetId: id
                    }));
                }
            };
            
            pc.oniceconnectionstatechange = () => {
                console.log(`[${id}] ICE Connection State: ${pc.iceConnectionState}`);
                const dcState = this.dataChannels.get(id) ? this.dataChannels.get(id).readyState : 'none';
                this.ui.updatePeerStatus(id, pc.iceConnectionState, dcState);

                // --- 1. 清除舊的 disconnected 超時計時器 ---
                // ... (這部分保持不變，清除的是 DISCONNECTED 狀態的計時器) ...
                if (this._disconnectTimers.has(id)) {
                    clearTimeout(this._disconnectTimers.get(id));
                    this._disconnectTimers.delete(id);
                }

                // --- 2. 處理立即清理狀態 (failed 或 closed) ---
                if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                    // ⚠️ 在清理連線前，清除所有相關定時器
                    this._clearTotalConnectTimer(id); // 🎯 新增：清除總計時器
                    this._cleanupPeerConnection(id, pc.iceConnectionState);
                    return; 
                }

                // --- 3. 處理已連線狀態 (connected/completed) ---
                if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                    this._clearTotalConnectTimer(id); // 🎯 新增：連線成功，清除總計時器
                    console.log(`[${id}] ICE Connected 穩定。`);
                    return;
                }

                // --- 4. 處理 disconnected 狀態 (啟動超時清理) ---
                if (pc.iceConnectionState === 'disconnected') {
                    // ... (這部分保持不變，啟動的是 DISCONNECTED 狀態的計時器) ...
                    // ...
                    this._cleanupPeerConnection(id, pc.iceConnectionState);
                }
            };
            
            if (!isCaller) {
                pc.ondatachannel = (event) => {
                    const channel = event.channel;
                    this.dataChannels.set(id, channel);
                    this._setupDataChannel(channel, id); 
                };
            }

            this.peerConnections.set(id, pc);
            // 🎯 啟動總超時計時器
            this._startTotalConnectTimer(id, pc);

            if (isCaller) {
                const channel = pc.createDataChannel('chat');
                this.dataChannels.set(id, channel);
                this._setupDataChannel(channel, id);
            }

            return pc;
        }
        // 🎯 新增：啟動連線總超時計時器
        _startTotalConnectTimer(id, pc) {
            // 確保只存在一個 total timer
            this._clearTotalConnectTimer(id); 

            this.ui.appendMessage(`[${id}] 啟動連線總超時計時器 (${this.TOTAL_CONNECT_TIMEOUT / 1000} 秒)...`);
            
            const timer = setTimeout(() => {
                // 檢查狀態：如果仍然在 new 或 checking，強制清理
                if (pc.iceConnectionState === 'new' || pc.iceConnectionState === 'checking') {
                    this._cleanupPeerConnection(id, 'Total Connection Timeout');
                }
                // 無論如何，確保計時器從 Map 中移除
                this._disconnectTimers.delete(id);
            }, this.TOTAL_CONNECT_TIMEOUT); 

            // 使用同一個 Map 儲存所有計時器，但用不同的 ID 命名，以區分 Total 和 Disconnected Timer
            this._disconnectTimers.set(`TOTAL_${id}`, timer);
        }
        // 🎯 新增：清除連線總超時計時器
        _clearTotalConnectTimer(id) {
            const timerId = `TOTAL_${id}`;
            if (this._disconnectTimers.has(timerId)) {
                clearTimeout(this._disconnectTimers.get(timerId));
                this._disconnectTimers.delete(timerId);
                this.ui.appendMessage(`[${id}] 總連線超時計時器已清除。`);
            }
        }
        // HUB 對 Spoke 發起 offer
        async sendSdpOffer(targetId) { 
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.ui.appendMessage("WebSocket 尚未連線，無法發送 Offer。");
                return;
            }
            
            if (!targetId) {
                console.error("錯誤：缺少目標 ID (targetId)。");
                return;
            }
            
            const isConnectingOrOpen = this.dataChannels.has(targetId) && 
                (this.dataChannels.get(targetId).readyState === 'open' || 
                 this.dataChannels.get(targetId).readyState === 'connecting');

            if (isConnectingOrOpen) {
                console.warn(`已與 ${targetId} 建立連線或正在連線中，跳過 Offer。`);
                return;
            }
            
            let pc = this._getOrCreatePeerConnection(targetId, true); 

            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.ui.updateSdpDisplay('local', offer);
                
                const offerWithId = { 
                    ...offer, 
                    senderId: this.clientId, 
                    targetId: targetId 
                }; 
                this.ws.send(JSON.stringify(offerWithId));
                console.log(`Offer 已傳送給 ${targetId}。`);
            } catch (error) {
                console.error("創建 Offer 失敗:", error);
            }
        }

        async _sendSdpAnswer(targetId) { 
            let pc = this._getOrCreatePeerConnection(targetId, false);
            try {
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.ui.updateSdpDisplay('local', answer);

                const answerWithId = { 
                    ...answer, 
                    senderId: this.clientId, 
                    targetId: targetId 
                };
                this.ws.send(JSON.stringify(answerWithId));
                console.log(`Answer 已傳送給 ${targetId}。`);
            } catch (error) {
                console.error("創建 Answer 失敗:", error);
            }
        }


        // --- DataChannel 訊息處理 (已修改 onclose) ---

        _setupDataChannel(channel, id) { 
            channel.onopen = () => {
                this.ui.appendMessage(`[P2P 成功連線] 數據通道已連線！與 [${id}]`);
                this.ui.updatePeerStatus(id, this.peerConnections.get(id).iceConnectionState, channel.readyState);
                
                if (this.role === 'spoke') {
                    this.ui.appendMessage(`[SPOKE] P2P 連線成功，維持 WebSocket 暢通以持續同步在線成員清單。`);
                }

                if (this.role  === 'spoke') {
                    // WEBRTC已連線, 請求同步資料
                    this.requestSync(id); 
                }
            };

            channel.onmessage = (event) => {
                const data = event.data;
                let parsedData;

                try {
                    parsedData = JSON.parse(data);
                    
                    if (parsedData && parsedData.chunked === true) {
                        this._handleIncomingChunk(id, parsedData);
                        return;
                    }
                    
                    if (parsedData && typeof parsedData === 'object') {
                            // 真正處理WebRTC 資料的地方
                            webRTC_handleMessage(id, parsedData); 
                    } else {
                         this.ui.appendMessage(`[${id}] 對方 (純數據): ${data}`);
                    }
                } catch (e) {
                    this.ui.appendMessage(`[${id}] 對方 (純數據): ${data}`);
                }
            };
            
            channel.onclose = () => {
                // 🎯 這裡改為調用單一清理函式
                this._cleanupPeerConnection(id, 'DataChannel Closed');
            }
            channel.onerror = (error) => {
                this.ui.appendMessage(`[P2P 中斷/錯誤] 與 [${id}] 的數據通道錯誤: ${error ? error.message : '未知錯誤'}`);
                // ⚠️ 新增：強制關閉 DataChannel
                if (channel.readyState !== 'closed') {
                    channel.close();
                }
            }
        }
        
        // 數據分塊重組邏輯 (未修改)
        _handleIncomingChunk(id, chunkMetadata) {
            const { chunkId, index, total, payload } = chunkMetadata;
            
            if (!this.chunkBuffers.has(id)) {
                this.chunkBuffers.set(id, new Map());
            }
            const peerBuffer = this.chunkBuffers.get(id);

            if (!peerBuffer.has(chunkId)) {
                peerBuffer.set(chunkId, {
                    totalChunks: total,
                    receivedCount: 0,
                    parts: new Array(total).fill(null),
                    timer: setTimeout(() => {
                        console.error(`[${id}] 數據塊 ${chunkId} 超時，連線可能已中斷或數據丟失。`);
                        peerBuffer.delete(chunkId);
                    }, 15000) 
                });
            }
            
            const buffer = peerBuffer.get(chunkId);
            
            if (buffer.parts[index] !== null) {
                console.warn(`[${id}] 警告：數據塊 ${chunkId} 的索引 ${index} 重複接收。`);
                return;
            }

            buffer.parts[index] = payload;
            buffer.receivedCount++;
            
            if (buffer.receivedCount === buffer.totalChunks) {
                clearTimeout(buffer.timer);
                
                const fullString = buffer.parts.join('');
                
                try {
                    const fullObject = JSON.parse(fullString);
                    const logContent = JSON.stringify(fullObject).substring(0, 100);
                    this.ui.appendMessage(`[${id}] 對方 (已重組數據): (Object) ${logContent}... (總長: ${fullString.length})`);
                    
                    webRTC_handleMessage(id, fullObject); 
                    
                } catch (e) {
                    console.error(`[${id}] 重組後的數據不是有效的 JSON:`, e);
                }
                
                peerBuffer.delete(chunkId);
            }
        }

        // --- 業務邏輯發送介面 (未修改) ---
        
        send_Sync_Boss_Data(targetId = null) {
            if (this.role !== 'hub') {
                console.warn('非 HUB 節點無法發送 Sync_Boss_Data。');
                return;
            }
            
            const message = {
                type: 'Sync_Boss_Data',
                bossListData: bossListData, 
                config: config               
            };
            this.sendWebRTCChatMessage(message, targetId);

            if (targetId) {
                this.ui.appendMessage(`[HUB] 單獨發送 Sync_Boss_Data 給 ${targetId}`);
            } else {
                this.ui.appendMessage(`[HUB] 廣播 Sync_Boss_Data`);
            }
        }
        
        sendBossDeath(deathInfo) {
            if (this.role !== 'hub') {
                console.warn('非 HUB 節點無法發送 Boss_Death。');
                return;
            }
            
            const message = {
                type: 'Boss_Death',
                deathInfo: deathInfo
            };
            
            this.sendWebRTCChatMessage(message);
            this.ui.appendMessage(`[HUB] 廣播 BOSS 死亡通知: ${deathInfo}`);
        }
        
        requestSync(targetHubId) {
            if (this.role !== 'spoke') {
                console.warn('非 SPOKE 節點無法請求同步。');
                return;
            }
            
            const message = {
                type: 'Ack_Sync',
                spokeId: this.clientId
            };
            
            if (this.dataChannels.has(targetHubId)) {
                this.sendWebRTCChatMessage(message, targetHubId);
                this.ui.appendMessage(`[SPOKE] 向 HUB (${targetHubId}) 請求同步數據 (Ack_Sync)。`);
            } else {
                console.error(`無法找到連線 ID: ${targetHubId}。`);
            }
        }

        // --- 通用發送函數 (未修改) ---

        // 行 739 (替換整個 sendWebRTCChatMessage 函式)
        sendWebRTCChatMessage(message, targetId = null) { 
            if (!message) {
                console.warn("訊息內容為空，跳過發送。");
                return;
            }

            let jsonString;
            try {
                if (typeof message === 'object') {
                    jsonString = JSON.stringify(message);
                } else {
                    jsonString = JSON.stringify({ type: 'text', content: message });
                }
            } catch (error) {
                 console.error("訊息序列化失敗：", error);
                 this.ui.appendMessage("錯誤：無法將訊息轉換為 JSON 格式。");
                 return;
            }
            
            const totalLength = jsonString.length;
            
            const chunkId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
            
            let sentCount = 0;
            
            if (this.dataChannels.size === 0) {
                this.ui.appendMessage("尚未與任何用戶連線成功。");
                return;
            }
            
            const channelsToSend = targetId 
                ? [[targetId, this.dataChannels.get(targetId)]]
                : Array.from(this.dataChannels.entries());

            channelsToSend.forEach(([peerId, channel]) => {
                if (channel && channel.readyState === 'open') {
                    
                    let offset = 0;
                    const totalChunks = Math.ceil(totalLength / MAX_CHUNK_SIZE);

                    while (offset < totalLength) {
                        const chunk = jsonString.substring(offset, offset + MAX_CHUNK_SIZE);
                        const index = Math.floor(offset / MAX_CHUNK_SIZE);
                        
                        const chunkPayload = JSON.stringify({
                            chunked: true,       
                            chunkId: chunkId,    
                            index: index,        
                            total: totalChunks,  
                            payload: chunk       
                        });
                        
                        try {
                             channel.send(chunkPayload); 
                        } catch (e) {
                             // 🎯 處理發送失敗的 DataChannel，並手動觸發清理
                             console.error(`[P2P 錯誤] 對 ${peerId} 發送失敗，強制執行清理。`, e.message);
                             this._cleanupPeerConnection(peerId, 'Send Error');
                             return; // 跳過剩餘的塊
                        }
                        
                        offset += MAX_CHUNK_SIZE;
                    }
                    
                    const logMsg = totalChunks > 1 
                        ? `發送大型數據 (共 ${totalChunks} 塊)`
                        : `發送小型指令 (1 塊，強制分塊)`;

                    console.log(`[P2P 發送] 對 ${peerId} ${logMsg}。`);

                    sentCount++;
                }
            });

            if (sentCount > 0) {
                this.ui.appendMessage(`我 (發送給 ${sentCount} 個連線): 訊息已通過分塊機制傳輸 (總長 ${totalLength})`);
            } else {
                this.ui.appendMessage(`沒有開放的 DataChannel 發送訊息給 ${targetId ? targetId : '所有連線'}。`);
            }
        }
        

        // 取得WS 上所有連線資訊
        getWsAllOnlineUsers() {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.ui.appendMessage("WebSocket 尚未連線，無法請求在線用戶。");
                return;
            }

            const request = {
                type: 'request_online_users',
                senderId: this.clientId
            };
            this.ws.send(JSON.stringify(request));

            // 同步廣播請求所有在線用戶回覆身分
            this.ws.send(JSON.stringify({
                type: 'request_peer_presence',
                senderId: this.clientId
            }));

            this.ui.appendMessage("[" + this.role + "] 已向伺服器請求在線用戶列表...");
        }

        // --- 額外功能 (未修改) ---
        connectAllOnlineUsers() {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.ui.appendMessage("WebSocket 尚未連線，無法請求在線用戶。");
                return;
            }
            
            if (this.role !== 'hub') {
                this.ui.appendMessage("只有 HUB 節點可以使用此功能。");
                return;
            }

            const request = {
                type: 'request_online_users',
                senderId: this.clientId
            };
            this.ws.send(JSON.stringify(request));
            this.ui.appendMessage("[HUB] 已向伺服器請求在線用戶列表...");
        }

        // 發送使用者閒置/在線狀態變更
        sendPresenceUpdate(status) {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'update_presence',
                    senderId: this.clientId,
                    status: status
                }));
            }
        }

        // 登入後補送身分資訊
        registerPresence(user) {
            this.pendingUser = user;
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'user_presence',
                    senderId: this.clientId,
                    user: user
                }));
                // 發送身分後主動向伺服器索取最新的在線用戶名單，確保自身與大家即時同步
                this.getWsAllOnlineUsers();
            }
        }
    }
    
    return WebRTCClient;
})();


// ----------------------------------------------------
// 3. 啟動腳本 (主要流程)
// ----------------------------------------------------

/**
 * 啟動連線客戶端，必須設定角色。
 * @param {string} role 'hub' 或 'spoke'
 */
function startClient(role) {
    if (webrtcClient && webrtcClient.ws && webrtcClient.ws.readyState === WebSocket.OPEN) {
        console.warn("客戶端已連線，請勿重複啟動。");
        return;
    }

    MY_ROLE = role;
    
    if (MY_ROLE === 'hub') {
        MY_CLIENT_ID = 'HUB_' + Math.random().toString(36).substring(2, 9);
    } else {
        MY_CLIENT_ID = 'SPK_' + Math.random().toString(36).substring(2, 9);
    }

    console.log(`[CLIENT_INIT] 角色設定為: ${MY_ROLE.toUpperCase()}, ID: ${MY_CLIENT_ID}`);

    // 實例化模組
    webrtcClient = new WebRTCClientModule(MY_CLIENT_ID, WebRTC_WS_URL, configuration, MY_ROLE, UIManager);
    window.webrtcClient = webrtcClient;
    webrtcClient.startConnection();
}

// ----------------------------------------------------
// 4. HTML 輸出與輔助函數 (未修改)
// ----------------------------------------------------

function getStatusBadgeHtml(statusText) {
    if (!statusText) return '<span style="color:#9e9e9e;">N/A</span>';
    
    let color = '#9e9e9e'; 
    
    switch(statusText.toLowerCase()) {
        case 'open':
        case 'connected':
        case 'completed':
            color = '#4CAF50'; 
            break;
        case 'connecting':
        case 'checking':
        case 'new':
        case 'disconnected': // disconnected 狀態使用橘色警示
            color = '#ff9800'; 
            break;
        case 'closed':
        case 'failed':
            color = '#f44336'; 
            break;
        default:
            color = '#2196F3'; 
    }
    
    return `<span style="padding: 2px 6px; border-radius: 3px; font-weight: bold; color: white; background-color: ${color}; white-space: nowrap;">${statusText}</span>`;
}


function getFormattedStatusHtml() {
    // 基礎字體設定為 14px
    const baseFontSize = '12px';
    const smallFontSize = '10px';

    if (!webrtcClient) {
        return `<div style="color: red; font-weight: bold; border: 1px solid #f44336; padding: 5px; border-radius: 5px; background-color: #ffebee; font-family: Arial, sans-serif; font-size: ${baseFontSize};">客戶端尚未啟動 (webrtcClient 為 null)。請先呼叫 startClient('hub') 或 startClient('spoke')。</div>`;
    }

    // 1. WebSocket 狀態
    const wsStatus = webrtcClient.getWsStatus();
    const wsHtml = `
        <div style="margin-bottom: 5px; font-size: ${baseFontSize};"> 
            <strong style="color: #333;">WebSocket 信令狀態: </strong> ${getStatusBadgeHtml(wsStatus)}
        </div>
    `;

    // 2. P2P 詳細列表
    const p2pDetails = webrtcClient.getP2PConnectionStatus();
    const p2pCount = webrtcClient.getP2PConnectionCount();

    let tableRows = '';
    if (p2pDetails.length === 0) {
        // 內邊距減少到 3px
        tableRows = `<tr><td colspan="3" style="text-align: center; padding: 3px; color: #478276ff; font-size: ${smallFontSize};">尚無 PeerConnection 存在</td></tr>`;
    } else {
        p2pDetails.forEach(peer => {
            tableRows += `
                <tr>
                    <td style="padding: 3px; border-bottom: 1px solid #eee; font-family: monospace; font-size: ${smallFontSize};">${peer.id}</td>
                    <td style="padding: 3px; border-bottom: 1px solid #eee; font-size: ${smallFontSize};">${getStatusBadgeHtml(peer.ice)}</td>
                    <td style="padding: 3px; border-bottom: 1px solid #eee; font-size: ${smallFontSize};">${getStatusBadgeHtml(peer.dataChannel)}</td>
                </tr>
            `;
        });
    }

    const p2pHtml = `
        <div style="margin-bottom: 5px; font-size: ${baseFontSize};"> 
            <strong style="color: #333;">活躍 P2P 連線數量: </strong> <span style="font-weight: bold; color: ${p2pCount > 0 ? '#4CAF50' : '#f44336'};">${p2pCount}</span>
        </div>
        <div>
            <strong style="color: #333; font-size: ${baseFontSize};">詳細 P2P 連線列表:</strong>
            <table style="width: 100%; border-collapse: collapse; font-size: ${smallFontSize}; margin-top: 3px; color: #6e59bbff"> 
                <thead>
                    <tr style="background-color: #e0e0e0;">
                        <th style="padding: 3px; text-align: left; border-bottom: 2px solid #ccccccff;">Peer ID</th>
                        <th style="padding: 3px; text-align: left; border-bottom: 2px solid #ccc;">ICE State</th>
                        <th style="padding: 3px; text-align: left; border-bottom: 2px solid #ccc;">DataChannel State</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;

    // 總結容器
    return `
        <div style="border: 1px solid #ccc; padding: 5px; border-radius: 5px; background-color: #f9f9f9; font-family: Arial, sans-serif; font-size: ${baseFontSize};"> 
            <h3 style="margin-top: 0; margin-bottom: 5px; border-bottom: 1px solid #ddd; padding-bottom: 3px; color: #007bff; font-size: 15px;">客戶端 ID: ${webrtcClient.clientId} (${webrtcClient.role.toUpperCase()})</h3>
            ${wsHtml}
            ${p2pHtml}
        </div>
    `;
}