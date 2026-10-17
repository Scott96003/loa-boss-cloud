// 1. 全域變數：用於儲存計時器 ID
let saveTimer = null;
// 2. 常數：設定延遲時間 (30 秒 = 30,000 毫秒)
const DEBOUNCE_DELAY = 30000;
// 3. 新增常數：設定要保留的最大訊息數量
const MAX_MESSAGES = 50;
/**
 * 實際執行存檔的邏輯 (只會被計時器觸發)
 */
function actualSaveLogic() {
    console.log("✅ 執行延遲存檔：30 秒內無操作，觸發實體存檔。");

    // 假設 bossListData、messageList、rebootTime 已定義
    saveBossListToDB(bossListData);
    // ----------------------------------------------------
    // 【關鍵優化點】: 截取最新的 50 筆訊息
    // 假設 messageList 是一個 Array，且新訊息是附加在陣列尾部。
    if (config.messageList.length > MAX_MESSAGES) {
        // 使用 slice 截取陣列的最後 MAX_MESSAGES 筆資料
        // 例如：長度 100，slice(-50) 會取出索引 50 到 99 的資料
        config.messageList = config.messageList.slice(-MAX_MESSAGES);
        console.log(`⚠️ messageList 長度超過 ${MAX_MESSAGES} 筆，已截取最新的 ${MAX_MESSAGES} 筆進行存檔。`);
    }
    // ----------------------------------------------------
    localStorage.setItem("messageList", JSON.stringify(config.messageList));
    localStorage.setItem("rebootTime", config.rebootTime.toISOString());
    localStorage.setItem("voiceCount", config.voiceCount);
    console.log("trackBossNames", trackBossNames);
    localStorage.setItem("trackBossNames", JSON.stringify(trackBossNames));

    // 存檔完成後，將計時器設為 null，表示目前沒有存檔正在排程中
    saveTimer = null;
    console.log("⭐ 存檔完成，等待下一次操作。");
}

/**
 * 用戶調用的函數：負責排程存檔
 */
function saveToLocalStorage(setTime = DEBOUNCE_DELAY) {
    // 步驟 1: 清除前一個計時器 (重設延遲時間)
    if (saveTimer) {
        clearTimeout(saveTimer);
        console.log("⏳ 檢測到新請求，清除上一個計時器，重新開始 30 秒倒數。");
    }

    // 步驟 2: 設置一個新的計時器
    // 這表示：「在 30 秒後執行 actualSaveLogic」
    saveTimer = setTimeout(actualSaveLogic, setTime);

    console.log("🔔 資料更新，已排程存檔。若 " + setTime / 1000 + " 秒內沒有新的請求，將執行存檔。");
}


/**
 * 載入或初始化 columnConfig。
 */
function loadColumnConfig() {
    const savedConfigString = localStorage.getItem(CONFIG_STORAGE_KEY);

    if (savedConfigString) {
        try {
            const savedKeys = JSON.parse(savedConfigString);

            // 重新建構配置陣列：保持原始配置的完整屬性，但使用已儲存的順序
            const configMap = new Map(defaultColumnConfig.map(c => [c.key, c]));
            columnConfig = savedKeys
                .map(key => configMap.get(key))
                .filter(config => config !== undefined); // 過濾掉已移除的舊欄位

            // 確保所有 defaultConfig 中的新欄位被加入到最後（如果未儲存過）
            const existingKeys = new Set(columnConfig.map(c => c.key));
            defaultColumnConfig.forEach(defaultCol => {
                if (!existingKeys.has(defaultCol.key)) {
                    columnConfig.push(defaultCol);
                }
            });

            console.log("已從 localStorage 載入欄位順序。");
            return;
        } catch (e) {
            console.error("解析儲存的配置失敗，使用預設配置。", e);
        }
    }

    // 如果沒有儲存，或者解析失敗，則使用預設配置的副本
    columnConfig = [...defaultColumnConfig];
    console.log("使用預設欄位順序。");
}

/**
 * 儲存當前 columnConfig 的順序到 localStorage。
 */
function saveColumnConfig() {
    // 只儲存 key 陣列以減少儲存大小，並在載入時重建
    const keysToSave = columnConfig.map(config => config.key);
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(keysToSave));
}