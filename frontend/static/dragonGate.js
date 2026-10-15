/**
 * 寫入 Cookie
 * @param {string} name - Cookie 名稱
 * @param {string} value - Cookie 值
 * @param {number} days - Cookie 過期天數
 */
function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    // 使用 encodeURIComponent 確保值中沒有特殊字元
    document.cookie = name + "=" + encodeURIComponent(value) + expires + "; path=/";
}

/**
 * 從 Cookie 讀取值
 * @param {string} name - Cookie 名稱
 * @returns {string | null} Cookie 值或 null
 */
function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
    return null;
}

class BossEventTracker {
    constructor() {
        this.gateOpenTime = null;
        this.gateCloseTime = null; // 該變數現在將保留上一次的關閉時間
        this.dragonIDs = [91516,91202,91605];
        // 閒置時間 COOLDOWN_MS 僅作為 GATE_DURATION_MS 存在
        this.GATE_DURATION_MS = 3 * 60 * 60 * 1000; 
    }

    resetGatePeriod() {
        let records = 抓取所有龍的死亡時間()
        if (records.length > 0) {
            const lastData = records[records.length - 1];
            this.gateOpenTime = lastData.gateOpenTime;
            this.gateCloseTime = lastData.gateCloseTime;
        }
    }


    // 檢查bossData 是否需要處理
    checkBossData(bossData) {
        if (this.dragonIDs.includes(parseInt(bossData.id))) {
            this.processBossDeath(bossData.death)
        }
    }
    /**
     * 將當前狀態儲存到 Cookie
     */
    saveToCookie() {
        // 將 Date 物件轉換為毫秒時間戳 (Number) 儲存，以確保精確
        const data = {
            open: this.gateOpenTime ? this.gateOpenTime.getTime() : null,
            close: this.gateCloseTime ? this.gateCloseTime.getTime() : null,
        };
        // 將物件轉換為 JSON 字串，並設定 365 天過期
        setCookie('DragonGateStatus', JSON.stringify(data), 365);
    }

    /**
     * 從 Cookie 載入狀態
     */
    loadFromCookie() {
        const cookieData = getCookie('DragonGateStatus');
        if (cookieData) {
            try {
                const data = JSON.parse(cookieData);
                
                // 將時間戳 (Number) 轉換回 Date 物件
                this.gateOpenTime = data.open ? new Date(data.open) : null;
                this.gateCloseTime = data.close ? new Date(data.close) : null;
                
                console.log("[Cookie 載入] 龍門狀態已成功載入。");
            } catch (e) {
                console.error("[Cookie 錯誤] 無法解析龍門狀態 Cookie。", e);
            }
        }
        // 如果沒有上次開門的時間
        if (this.gateCloseTime == null) {
            this.resetGatePeriod()
        }
    }

    /**
     * 處理新的 Boss 死亡時間 (需在更新數據後呼叫 saveToCookie())
     */
    processBossDeath(newDeathTimeInput) {
        const newDeathTime = new Date(newDeathTimeInput);

        // 1. 週期保護：判斷是否在龍門開啟期間 (忽略這次死亡)
        if (this.gateCloseTime && newDeathTime < this.gateCloseTime) {
            console.log("不在龍門開啟期間 (忽略這次死亡)", newDeathTime)
            return; 
        }
        console.log(`[🚨 週期重啟 🚨] 龍門關閉後接收到擊殺紀錄，立即開啟新的龍門週期。`);
        // 2. 觸發開啟或重啟週期 (包含首次擊殺和龍門關閉後的擊殺)
        // 龍門週期開始：以本次擊殺時間作為開啟時間
        this.gateOpenTime = newDeathTime; 
        this.gateCloseTime = new Date(this.gateOpenTime.getTime() + this.GATE_DURATION_MS);

        

        console.log(`開啟時間: ${this.gateOpenTime.toLocaleString()}，關閉時間: ${this.gateCloseTime.toLocaleString()}`);
        // 邏輯執行結束後，呼叫儲存
        this.saveToCookie();
        // Discord 龍門通知由 Cloudflare Worker 發送
    }
    /**
     * 根據「3 小時過濾分組」邏輯，分析並提取有效的 gateOpenTime，並包含對應的 emblem。
     *
     * @param {Array<Object>} dataList - 包含主要資料物件的列表，每個物件中含有 deathList 陣列。
     * (例如: [{"id": "...", "deathList": [{ "death": "...", "emblem": "...", ... }], ...}, ...])
     * @returns {Array<Object>} 包含所有有效 gateOpenTime 及其 emblem 的列表。
     * (格式: [{ time: Date, emblem: string, closeTime: Date }, ...])
     */
    analyzeDeathTimesWithEmblem(dataList) {
        if (!dataList || dataList.length === 0) {
            return [];
        }

        // 1. 扁平化並提取所有 'death' 時間和對應的 'emblem'
        let records = [];

        dataList.forEach(dataObject => {
            if (dataObject && Array.isArray(dataObject.deathList)) {
                dataObject.deathList.forEach(deathRecord => {
                    const timeString = deathRecord.death;

                    if (timeString) {
                        // 將 "YYYY-MM-DD HH:MM" 替換成 "YYYY/MM/DD HH:MM" 提高解析相容性
                        const dateStr = timeString.replace(/-/g, '/');
                        const dt = new Date(dateStr);

                        if (!isNaN(dt.getTime())) {
                            records.push({
                                time: dt,
                                emblem: deathRecord.emblem || 'N/A' // 如果沒有emblem則設為N/A
                            });
                        }
                    }
                });
            }
        });

        // 2. 將記錄由早到晚排序 (依據 time)
        records.sort((a, b) => a.time.getTime() - b.time.getTime());

        let resultGateOpenRecords = [];
        let i = 0;
        const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

        // 3. 執行 3 小時過濾邏輯
        while (i < records.length) {
            // 找到當前的 gateOpenTime 記錄
            const currentRecord = records[i];
            const gateOpenTime = currentRecord.time;

            // 計算 Gate Close Time
            const gateCloseTimeMs = gateOpenTime.getTime() + THREE_HOURS_MS;
            const gateCloseTime = new Date(gateCloseTimeMs);

            // 將有效記錄加入結果列表
            resultGateOpenRecords.push({
                gateOpenTime: gateOpenTime,
                emblem: currentRecord.emblem,
                gateCloseTime: gateCloseTime // 也把 closeTime 輸出方便檢視
            });
            
            // 過濾 3 小時區間內的資料
            let j = i + 1;
            
            // 檢查下一個時間是否在 gateCloseTimeMs 之前（不包含等於）
            while (j < records.length && records[j].time.getTime() < gateCloseTimeMs) {
                j++;
            }

            // 將索引移動到第一個不在 3 小時區間內的記錄
            i = j;
        }

        return resultGateOpenRecords;
    }
/**
     * 顯示目前的龍門狀態，以純文字形式輸出 (24 小時制)
     */
    displayStatus() {
        const currentTime = new Date();
        
        // 統一的時間格式設定
        const timeFormatOptions = {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        };
        const formatTime = (date) => date.toLocaleString('zh-TW', timeFormatOptions);
        
        let statusMessage = "";
        
        // A. 龍門週期開啟中 (檢查當前時間是否在 開啟 和 關閉 之間)
        if (this.gateOpenTime && currentTime < this.gateCloseTime) {
            
            const minutesToClose = Math.ceil((this.gateCloseTime.getTime() - currentTime.getTime()) / 60000);

            statusMessage = `
🚨 龍門開啟中 🚨
開啟時間: ${formatTime(this.gateOpenTime)}
關閉時間: ${formatTime(this.gateCloseTime)}
剩餘時間: 約 ${minutesToClose} 分鐘  <t:${this.gateCloseTime.getTime() / 1000}:R> 
            `.trim();
        
        } else {
            // B. 龍門已關閉
            statusMessage = `⚠️ 龍門已關閉。`;


            // 顯示上次關閉時間
            if (this.gateCloseTime) {
                statusMessage += `\n關閉時間: ${formatTime(this.gateCloseTime)}`;
            }
            if (this.gateOpenTime) {
                // 將開啟時間清除
                this.gateOpenTime = null;
                // 邏輯執行結束後，呼叫儲存
                this.saveToCookie();
            }
        }
        
        return statusMessage;
    }
}

function updateDragonGateDisplay() {
    const statusHTML = tracker.displayStatus(); // 假設 tracker 是 BossEventTracker 的實例
    const displayElement = document.getElementById('dragonGateStatusDisplay');
    if (displayElement) {
        // 使用 innerHTML 來渲染表格
        displayElement.innerHTML = statusHTML;
    }
}

function 抓取所有龍的死亡時間() {
    const resultRecords = tracker.analyzeDeathTimesWithEmblem(
        bossListData.filter((value) => {
            return (([91516,91202,91605].includes(parseInt(value.id)) == true) );
        })
    );
    return resultRecords
}


const tracker = new BossEventTracker();
// 在應用程式啟動時，第一時間載入狀態
tracker.loadFromCookie(); 

// 記得在應用程式的主循環或事件觸發後呼叫 updateDragonGateDisplay()
setInterval(updateDragonGateDisplay, 1000); 


    // 輔助函式：將 Date 物件格式化為 YYYY-MM-DD HH:MM 字串
    // function fdt(date) {
    //     const pad = (num) => (num < 10 ? '0' + num : num);
    //     return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    // }

    // // 執行函式
    // let resultRecords = tracker.analyzeDeathTimesWithEmblem(
    //     bossListData.filter((value) => {
    //         return (([91516,91202,91605].includes(parseInt(value.id)) == true) );
    //     })
    // );

    // // 輸出結果
    // console.log("--- 執行結果 (包含 Emblem) ---");
    // resultRecords.forEach((record, index) => {
    //     console.log(`有效 Gate Open Time ${index + 1}:`);
    //     console.log(`  時間: ${fdt(record.time)}`);
    //     console.log(`  Emblem: **${record.emblem}**`);
    //     console.log(`  Gate Close Time: ${fdt(record.closeTime)}\n`);
    // });