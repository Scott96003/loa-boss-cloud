/**
 * 實現自動重連功能的 WebSocket 包裝器
 * @param {string} url - WebSocket 伺服器 URL
 * @param {function} onMessageHandler - 接收到訊息時的回呼函數
 * @param {string} role - 客戶端角色 ('A' 或 'B')
 */
class ReconnectWebSocket {
    constructor(url, onMessageHandler, role) {
        this.url = url;
        this.onMessageHandler = onMessageHandler;
        this.role = role;
        this.ws = null;
        this.reconnectInterval = 1000; // 首次重連間隔 1 秒
        this.maxReconnectInterval = 30000; // 最大重連間隔 30 秒
        this.timeoutId = null;
        this.connect();
    }

    connect() {
        if (this.ws) {
            this.ws.close(); // 確保舊連線已關閉
        }
        this.ws = new WebSocket(this.url);
        console.log(`[${this.role}] 嘗試連線到 ${this.url}`);

        this.ws.onopen = () => {
            console.log(`✅ [${this.role}] 連線成功!`);
            this.reconnectInterval = 1000; // 連線成功，重置間隔
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
            send_Sync_Boss_Data();
        };

        this.ws.onmessage = (event) => {
            this.onMessageHandler(event);
        };

        this.ws.onclose = () => {
            console.warn(`❌ [${this.role}] 連線中斷。將在 ${this.reconnectInterval / 1000} 秒後嘗試重連...`);
            this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error(`🚨 [${this.role}] 連線錯誤:`, error);
            // 錯誤發生時，也會觸發 onclose，因此主要在 onclose 中處理重連
        };
    }

    scheduleReconnect() {
        if (this.timeoutId) return; // 避免重複排程
        
        this.timeoutId = setTimeout(() => {
            this.connect();
            // 延遲指數增長，直到達到上限
            this.reconnectInterval = Math.min(this.maxReconnectInterval, this.reconnectInterval * 2);
            this.timeoutId = null;
        }, this.reconnectInterval);
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
            return true;
        }
        console.warn(`[${this.role}] 訊息傳送失敗: 連線尚未開啟。`);
        return false;
    }

    get readyState() {
        return this.ws ? this.ws.readyState : WebSocket.CLOSED;
    }
}

const WS_URL = 'wss://loa-boss-ws-server.onrender.com/ws';
// https://loa-boss-ws-server.onrender.com/ws
// 2. 客戶端 B 模擬 (接收方)
const jsonDisplay = document.getElementById('main-json-data'); // 確保 HTML 中有這個 ID
const chatLog = document.getElementById('chat-log'); // 確保 HTML 中有這個 ID
let localData = {};

const wsB = new ReconnectWebSocket(WS_URL, handleBMessage, 'B');

function handleBMessage(event) {
    try {
        const received = JSON.parse(event.data);
        console.log("收到", WS_URL, "訊息", received)
        const type = received.type;

        switch (type) {
            case 'Sync_Boss_Data':
                // 處理資料同步邏輯
                console.log('正在處理 Sync_Boss_Data 數據同步...');
                bossListData = received.bossListData;
                config.messageList = received.config.messageList;
                config.rebootTime = new Date(received.config.rebootTime);                
                reDrawBossList();
                reDrawMessage();
                refresh();
                console.log('正在處理 Sync_Boss_Data 數據同步...', "完成");
                break;
            case 'Boss_Death': // 正確: 處理聊天訊息\
                // 處理聊天訊息邏輯
                console.log('正在處理Boss_Death訊息...', received.deathInfo);                
                updateBossData(received.deathInfo);
                break;
            case 'Ack_Sync':
                break;
            default:
                console.log('收到未知訊息類型:', type);
                break;
        }
    } catch (e) {
        console.error("接收數據錯誤:", e, event);
    }
}

// 傳送主 JSON 數據更新
function send_Sync_Boss_Data() {
    const message = {
        type: 'Ack_Sync'
    };
    if (wsB.readyState === WebSocket.OPEN) {
        wsB.send(JSON.stringify(message));
        console.log("[B 發送] 同步請求");
    }
}


startClient('spoke');