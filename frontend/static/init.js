/**
 * 處理音量載入和設定
 */
function initializeVoiceSettings() {
    // 使用 ||= (空值合併運算子) 簡化預設值設定
    let voiceCount = localStorage.getItem("voiceCount") || 50;
    config.voiceCount = parseInt(voiceCount, 10); // 確保是數字

    const slider = document.getElementById("percentageSlider");
    const display = document.getElementById("percentageDisplay");

    // 檢查元素是否存在，避免錯誤
    if (slider && display) {
        slider.value = config.voiceCount;
        display.textContent = `${config.voiceCount}%`;
        const volumeBtnLabel = document.getElementById("volumeBtnLabel");
        if (volumeBtnLabel) volumeBtnLabel.textContent = `${config.voiceCount}%`;
    }
}

/**
 * 處理訊息列表載入和繪製
 */
function initializeMessageList() {
    const storedMessageList = localStorage.getItem("messageList");
    config.messageList = storedMessageList ? JSON.parse(storedMessageList) : [];

    reDrawMessage();
}

let renderedMessageStartIndex = 0;

function reDrawMessage() {
    const container = document.getElementById('messageContainer');
    if (!container) return;
    container.innerHTML = "";
    messageCount = 0;

    if (!Array.isArray(config.messageList) || config.messageList.length === 0) {
        return;
    }

    const total = config.messageList.length;
    // 預設渲染最新 500 筆，其餘可透過按鈕分批向上載入
    const initialBatchSize = 500;
    renderedMessageStartIndex = Math.max(0, total - initialBatchSize);

    // 如果還有更早的歷史紀錄，在頂端建立「載入更早歷史」按鈕
    if (renderedMessageStartIndex > 0) {
        const loadMoreBtn = document.createElement('div');
        loadMoreBtn.id = "loadMoreHistoryBtn";
        loadMoreBtn.style.cssText = "cursor:pointer; text-align:center; padding:6px 12px; margin-bottom:8px; background:rgba(255,255,255,0.08); color:#64b5f6; font-size:12px; border-radius:4px; border:1px dashed #64b5f6; user-select:none;";
        loadMoreBtn.textContent = `⬆️ 載入更早的擊殺紀錄 (已顯示 ${total - renderedMessageStartIndex} / 共 ${total} 筆，點此載入更多)`;
        
        loadMoreBtn.onclick = function() {
            loadEarlierMessages();
        };
        container.appendChild(loadMoreBtn);
    }

    // 建立 DocumentFragment 批次掛載，大幅減少 DOM 重排卡頓
    const fragment = document.createDocumentFragment();
    for (let i = renderedMessageStartIndex; i < total; i++) {
        const p = document.createElement('p');
        p.textContent = config.messageList[i];
        p.style.margin = "2px 0";
        fragment.appendChild(p);
        messageCount++;
    }
    container.appendChild(fragment);
    container.scrollTop = container.scrollHeight;
}

/**
 * 往上載入更早的歷史擊殺紀錄 (預設每次往前翻 200 筆)
 */
function loadEarlierMessages(batchSize = 200) {
    const container = document.getElementById('messageContainer');
    if (!container || renderedMessageStartIndex <= 0) return;

    const newStartIndex = Math.max(0, renderedMessageStartIndex - batchSize);
    const fragment = document.createDocumentFragment();

    for (let i = newStartIndex; i < renderedMessageStartIndex; i++) {
        const p = document.createElement('p');
        p.textContent = config.messageList[i];
        p.style.margin = "2px 0";
        fragment.appendChild(p);
        messageCount++;
    }

    const loadMoreBtn = document.getElementById("loadMoreHistoryBtn");
    if (loadMoreBtn && loadMoreBtn.nextSibling) {
        container.insertBefore(fragment, loadMoreBtn.nextSibling);
    } else {
        container.appendChild(fragment);
    }

    renderedMessageStartIndex = newStartIndex;
    const total = config.messageList.length;

    if (loadMoreBtn) {
        if (renderedMessageStartIndex === 0) {
            loadMoreBtn.textContent = `✅ 已顯示全部 ${total} 筆歷史擊殺紀錄 (7天內)`;
            loadMoreBtn.style.cursor = "default";
            loadMoreBtn.style.color = "#81c784";
            loadMoreBtn.style.border = "1px solid #81c784";
            loadMoreBtn.onclick = null;
        } else {
            loadMoreBtn.textContent = `⬆️ 載入更早的擊殺紀錄 (已顯示 ${total - renderedMessageStartIndex} / 共 ${total} 筆，點此載入更多)`;
        }
    }
}

/**
 * 取得「上一個星期二的 12:02:00」作為基準時間。
 * * 例如：如果今天是 2025/10/26 (日)，則會返回 2025/10/21 (二) 12:02:00。
 * 如果今天是 2025/10/21 (二) 15:00:00，則會返回 2025/10/21 (二) 12:02:00。
 * 如果今天是 2025/10/21 (二) 10:00:00，則會返回 2025/10/14 (二) 12:02:00。
 * * @returns {Date} 上個星期二 12:02 的 Date 物件。
 */
function getLastTuesdayAt1202() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 (日) 到 6 (六)

    // 星期二的數字是 2。計算需要倒退的天數。
    // 如果今天是星期三 (3)，則倒退 1 天。
    // 如果今天是星期二 (2)，需要檢查時間。
    // 如果今天是星期一 (1)，則倒退 6 天 (到上個星期二)。
    let daysToSubtract = dayOfWeek - 2;

    // 如果今天是星期日(0)或星期一(1)，需要跨越整個星期，所以要多減 7 天或 6 天。
    if (dayOfWeek === 0) {
        // 星期日 (0) 到星期二 (2) 需要倒退 5 天
        daysToSubtract = 5;
    } else if (dayOfWeek === 1) {
        // 星期一 (1) 到星期二 (2) 需要倒退 6 天
        daysToSubtract = 6;
    } else if (dayOfWeek >= 2) {
        // 星期二(2)到星期六(6)
        daysToSubtract = dayOfWeek - 2;
    }

    // 建立一個新的日期物件，並根據需要倒退天數
    const baseDate = new Date(now);
    baseDate.setDate(now.getDate() - daysToSubtract);

    // 設置為 12:02:00
    baseDate.setHours(12, 2, 0, 0);

    // 額外檢查：如果當前時間在星期二 12:02 之後，但算出來的日期是下一個星期二，
    // 或者如果今天是星期二，但計算結果是上上星期二，
    // 最簡單的方式是：如果計算出的時間比當前時間晚，則倒退一週。
    // 但因為上面的邏輯已經處理了大部分情況，只需處理「今天就是星期二但時間還沒到 12:02」的情況。
    if (dayOfWeek === 2) {
        // 只有當今天是星期二，並且當前時間早於 12:02 時，才需要倒退到上一個星期二
        if (now.getHours() < 12 || (now.getHours() === 12 && now.getMinutes() < 2)) {
            baseDate.setDate(baseDate.getDate() - 7);
        }
    }


    return baseDate;
}

/**
 * 處理重啟時間 (rebootTime) 的邏輯
 */
function initializeRebootTime() {
    // 獲取基準時間
    const lastTuesdayAt1202 = getLastTuesdayAt1202();
    const storedRebootTimeValue = localStorage.getItem("rebootTime");

    const storedRebootTime = new Date(storedRebootTimeValue || lastTuesdayAt1202);
    config.rebootTime = storedRebootTime;
    document.getElementById("reboot_message").innerHTML = "重新開機時間：" + config.rebootTime.toLocaleString('zh-tw', { hour12: false });
}

/**
 * 載入 Boss 資料並初始化表格與數據
 */
async function loadAndInitializeBossData() {
    let bossListData = defaultData; // 預設先使用 defaultData
    let maxDeathTime = null;

    // 1. 第一優先：直接向 Cloudflare Worker API 獲取雲端最新 Boss 完整狀態
    try {
        const cloudRes = await fetch("https://loa-boss-worker.f96003.workers.dev/api/boss-data");
        if (cloudRes.ok) {
            const cloudJson = await cloudRes.json();
            if (cloudJson && Array.isArray(cloudJson.bossListData) && cloudJson.bossListData.length > 0) {
                console.log("☁️ 成功自 Cloudflare Worker 載入雲端最新 Boss 資料！共", cloudJson.bossListData.length, "隻");
                bossListData = cloudJson.bossListData;
                
                // 防呆確保：每隻有死亡時間的 Boss 其 deathList 都至少有該筆紀錄供 Tooltip 顯示，並同步最新死亡紀錄
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
                reDrawBossList();

                // 同步伺服器最新重啟時間 (rebootTime)
                if (cloudJson.config && cloudJson.config.rebootTime) {
                    const cloudReboot = new Date(cloudJson.config.rebootTime);
                    if (!isNaN(cloudReboot.getTime())) {
                        config.rebootTime = cloudReboot;
                        const rebootElem = document.getElementById("reboot_message");
                        if (rebootElem) {
                            rebootElem.innerHTML = "重新開機時間：" + config.rebootTime.toLocaleString('zh-tw', { hour12: false });
                        }
                    }
                }

                // 同步下方擊殺紀錄 (messageList)
                if (Array.isArray(cloudJson.messageList) && cloudJson.messageList.length > 0) {
                    config.messageList = cloudJson.messageList;
                    reDrawMessage();
                } else {
                    // 若伺服器尚無列表，自動從死亡時間為當前的 Boss 整理出擊殺紀錄
                    const recentKills = bossListData
                        .filter(b => b.death && String(b.death).startsWith("2026"))
                        .sort((a, b) => new Date(a.death) - new Date(b.death))
                        .map(b => `${b.death}:00 【${b.bossName}】被 ${b.emblem || "未知血盟"} 擊殺`);
                    if (recentKills.length > 0) {
                        config.messageList = recentKills;
                        reDrawMessage();
                    }
                }

                maxDeathTime = bossListData.reduce((max, boss) => {
                    const currentDeath = new Date(boss.death);
                    return (currentDeath > max) ? currentDeath : max;
                }, new Date(bossListData[0].death));
                return maxDeathTime;
            }
        }
    } catch (e) {
        console.warn("無法連線至雲端 API，改由本地 IndexedDB 讀取...", e);
    }

    // 2. 第二順位：若離線，嘗試從本地 IndexedDB 讀取
    try {
        const persistedData = await loadBossListFromDB();

        if (persistedData && persistedData.length > 0) {
            bossListData = persistedData; // 成功載入則覆蓋預設資料
            console.log("✅ 已成功載入持久化資料。");
        } else {
            console.log("⚠️ 未載入到持久化資料，已使用預設資料。");
        }
    } catch (error) {
        console.error("⛔ 載入 Boss 清單時發生錯誤，使用預設資料。", error);
    }

    reDrawBossList();

    // 找到最後一筆死亡時間 (使用 reduce 簡化邏輯)
    if (bossListData.length > 0) {
        maxDeathTime = bossListData.reduce((max, boss) => {
            const currentDeath = new Date(boss.death);
            return (currentDeath > max) ? currentDeath : max;
        }, new Date(bossListData[0].death)); // 以第一個 death 作為初始值
    }

    // 將最終的 bossListData 存儲到全域/外部變數中
    window.bossListData = bossListData;

    return maxDeathTime; // 返回計算出的最大死亡時間
}

// 重新繪製
function reDrawBossList() {
    // 重新畫出所有數據
    const bossTableBody = document.querySelector("#bossList tbody");
    if (bossTableBody) {
        bossTableBody.innerHTML = ""; // 清空 table
    }

    // 使用 map 和 reduce 優化數據處理和最大死亡時間查找
    bossListData = bossListData.map(boss => {
        syncBossLatestDeathAndEmblem(boss);
        // 在新增資料時計算並附加結果
        boss.result = findLostBoss(boss);
        boss.respawnCount = boss.result.rebornCount;
        addBossTR(boss); // 繪製表格列

        return boss; // 返回更新後的 Boss 物件
    });
}

function initializeTrackBossNames() {
    const storedTrackBossNames = localStorage.getItem("trackBossNames");
    trackBossNames = storedTrackBossNames ? JSON.parse(storedTrackBossNames) : [];
}

/**
 * 主載入函數
 */
async function loadFromLocalStorage() {
    console.log("--- loadFromLocalStorage 啟動 ---");

    // 步驟 1: 初始化 UI 設定
    initializeVoiceSettings();
    initializeMessageList();
    initializeRebootTime();
    initializeTrackBossNames()

    config.lastRefreshBossTime = localStorage.getItem("lastRefreshBossTime") || 24;

    // 步驟 2: 載入並處理核心 Boss 資料
    const maxDeathTime = await loadAndInitializeBossData();

    // 步驟 3: 刷新介面
    refresh(); // 執行刷新數據的函數

    // 步驟 4: 判斷是否需要獲取歷史數據（僅限 Chrome Extension 環境，純 Web 環境已由 Worker 同步）
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        if (maxDeathTime) {
            console.log("最後死亡時間:", maxDeathTime.toLocaleString());

            const sevenDays = 7 * 24 * 60 * 60 * 1000; // 7 天的毫秒數
            const timeDifference = new Date() - maxDeathTime; // 現在時間與最後記錄時間的差值

            if (timeDifference > sevenDays) {
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                console.log(`⏳ 資料超過 7 天，從 ${sevenDaysAgo.toLocaleString()} 開始獲取舊資料。`);
                取得Boss歷史資料(sevenDaysAgo);
            } else {
                console.log(`⏳ 資料在 7 天內，從最後死亡時間 ${maxDeathTime.toLocaleString()} 開始獲取舊資料。`);
                取得Boss歷史資料(maxDeathTime);
            }
        } else {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            console.log("🚫 無任何 Boss 記錄，從 7 天前開始獲取舊資料。");
            取得Boss歷史資料(sevenDaysAgo);
        }
    } else {
        console.log("ℹ️ [雲端環境] 略過 Chrome Extension 分頁抓取，Boss 數據與擊殺紀錄已直接由 Cloudflare Worker 提供。");
    }

    console.log("--- loadFromLocalStorage 完成 ---");
}

function clearBossData(id) {
    bossListData.forEach(function (item) {
        item.death = ""
        item.emblem = ""
        item.deathList = []
    })
}

/**
 * 檢查並顯示公告，若已看過相同 ID 的公告則不再顯示
 */
function checkAndShowAnnouncement() {
    const currentAnnouncementId = "20231101_v1"; // 每次更新公告內容時請更改此 ID
    const lastSeenId = localStorage.getItem("lastSeenAnnouncementId");

    if (lastSeenId !== currentAnnouncementId) {
        const announcementMessage = "【系統公告】\n\n歡迎使用 Boss 計時器！\n已增加追蹤清單功能。\n若有任何使用問題，請聯繫管理員。";

        // 使用延遲確保頁面渲染完成後再彈出
        setTimeout(() => {
            alert(announcementMessage);
            localStorage.setItem("lastSeenAnnouncementId", currentAnnouncementId);
        }, 1000);
    }
}

// 初始化時執行公告檢查
checkAndShowAnnouncement();
