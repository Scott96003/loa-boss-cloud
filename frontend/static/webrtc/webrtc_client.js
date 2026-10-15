startClient('spoke');

function webRTC_handleMessage(peerId, received) {
    try {
        
        console.log("[WEBRTC] 收到WEBRTC訊息", received)
        const type = received.type;

        switch (type) {
            case 'Sync_Boss_Data':
                // 處理資料同步邏輯
                console.log('[WEBRTC] 正在處理 Sync_Boss_Data 數據同步...');
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
                console.log('[WEBRTC] 正在處理 Sync_Boss_Data 數據同步...', "完成");
                break;
            case 'Server_Reboot':
                console.log('🚨 [WEBRTC] 收到伺服器重啟推播事件，正在同步清空舊歷史紀錄...', received);
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
                console.log('✅ [WEBRTC] 伺服器重啟完成，舊資料已全部清空，介面已刷新。');
                break;
            case 'Boss_Death': // 正確: 處理聊天訊息\
                // 處理聊天訊息邏輯
                console.log('[WEBRTC] 正在處理Boss_Death訊息...', received.deathInfo);                
                updateBossData(received.deathInfo);
                break;
            case 'Ack_Sync':
                break;
            default:
                console.log('[WEBRTC] 收到未知訊息類型:', type);
                break;
        }
    } catch (e) {
        console.error("[WEBRTC] 接收數據錯誤:", e, event);
    }
}

// 主動自 Cloudflare Worker API 獲取雲端最新 Boss 狀態
async function initFetchBossDataFromCloud() {
    try {
        if (typeof WebRTC_WS_URL === 'string' && WebRTC_WS_URL.includes("workers.dev")) {
            const apiUrl = WebRTC_WS_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/ws$/, '/api/boss-data');
            const res = await fetch(apiUrl);
            if (res.ok) {
                const cloudData = await res.json();
                if (cloudData && Array.isArray(cloudData.bossListData) && cloudData.bossListData.length > 0) {
                    console.log("[CLOUD_INIT] 成功自 Worker 載入最新 Boss 資料:", cloudData.bossListData.length, "隻");
                    webRTC_handleMessage('server', {
                        type: 'Sync_Boss_Data',
                        bossListData: cloudData.bossListData,
                        config: cloudData.config || (typeof config !== 'undefined' ? config : { messageList: [], rebootTime: new Date() }),
                        gateOpenTime: cloudData.gateOpenTime || (typeof tracker !== 'undefined' ? tracker.gateOpenTime : new Date()),
                        gateCloseTime: cloudData.gateCloseTime || (typeof tracker !== 'undefined' ? tracker.gateCloseTime : new Date())
                    });
                }
            }
        }
    } catch (e) {
        console.warn("[CLOUD_INIT] 無法連線至 Worker API，使用本機預設值", e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFetchBossDataFromCloud);
} else {
    initFetchBossDataFromCloud();
}