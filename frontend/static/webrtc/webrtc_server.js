startClient('hub');

function webRTC_handleMessage(peerId, received) {
    try {
        console.log("[WEBRTC] 收到 WebRTC 訊息", received)
        const type = received.type;
        
        switch (type) {
            case 'Ack_Sync':
                send_Sync_Boss_Data(peerId);
                break;
            case 'Sync_Boss_Data':
                break;
            case 'Boss_Death':
                break;
            default:
                console.log('[WEBRTC] 收到未知訊息類型:', type);
                break;
        }
    } catch (e) {
        console.error("[WEBRTC] 接收數據錯誤:", e, received);
    }
}

// 傳送主 JSON 數據更新
function send_Sync_Boss_Data(peerId) {
    // 這裡假設 bossListData 在當前作用域中可用
    const message = {
        type: 'Sync_Boss_Data',
        bossListData: bossListData,
        config: config,
        gateOpenTime: tracker.gateOpenTime,
        gateCloseTime: tracker.gateCloseTime
    };
    webrtcClient.sendWebRTCChatMessage(message, peerId);
}


// 傳送Boss死亡紀錄
function send_Boss_Death(deathInfo) {
    const message = {
        type: 'Boss_Death',
        deathInfo: deathInfo
    };
    webrtcClient.sendWebRTCChatMessage(message);
}