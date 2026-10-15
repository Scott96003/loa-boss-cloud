/**
 * 【核心函數】計算字串的顯示寬度 (Display Width)。
 * 全形字元 (如中文、全形符號) 算 2 寬度，半形字元算 1 寬度。
 * 這是實現表格對齊的基礎。
 * * @param {string | null | undefined} str - 要計算寬度的字串。
 * @returns {number} 顯示寬度。
 */
function getDisplayWidth(str) {
  if (str === null || str === undefined) return 0;
  const text = String(str);
  
  // 匹配常見中日韓文字和全形符號的 Unicode 範圍 (全局匹配 'g' 是關鍵)
  // 範圍: [\u4e00-\u9fff (漢字), \u3000-\u303f (CJK符號), \uff00-\uff5a (全形ASCII)]
  const fullWidthRegex = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uff5a]/g; 
  
  // 💡 優化：使用 match 一次性計算全形字元數量，比 for 迴圈中逐一 test 更高效。
  const fullWidthMatch = text.match(fullWidthRegex);
  const fullWidthCount = fullWidthMatch ? fullWidthMatch.length : 0;
  
  // 總寬度 = 全形數量 * 2 + (總字元數 - 全形數量) * 1
  return fullWidthCount * 2 + (text.length - fullWidthCount);
}

/**
 * 根據最大寬度限制，將長字串分割成多行。
 * * @param {string} text - 要處理的文字。
 * @param {number} maxWidth - 該欄位的最大顯示寬度。
 * @returns {string[]} 包含分行後所有子字串的陣列。
 */
function wrapText(text, maxWidth) {
    const textStr = String(text);
    if (maxWidth <= 0 || getDisplayWidth(textStr) <= maxWidth) {
        // 寬度限制無效或字串未超寬，直接返回
        return [textStr];
    }
    
    const lines = [];
    let currentLine = '';
    let currentWidth = 0;
    
    // 遍歷字串中的每一個字元，逐字元計算寬度並決定是否換行
    for (const char of textStr) {
        // 💡 優化建議：可以呼叫 getDisplayWidth(char) 確保寬度計算一致
        const charWidth = getDisplayWidth(char);
        
        // 檢查加入新字元後是否超過最大寬度
        if (currentWidth + charWidth > maxWidth) {
            
            // 處理單字元即超寬的極端情況（雖然不常見，但更健壯）
            if (currentWidth === 0 && charWidth > maxWidth) {
                // 如果是新行且第一個字元就超寬，則將其單獨成行並允許超寬
                lines.push(char);
                currentLine = '';
                currentWidth = 0;
                continue;
            }

            // 1. 將已經累積的行推入結果
            lines.push(currentLine);
            
            // 2. 重設行和寬度，並將**當前這個字元**作為新行的開頭
            currentLine = char;
            currentWidth = charWidth;
        } else {
            // 否則繼續將字元加入目前行
            currentLine += char;
            currentWidth += charWidth;
        }
    }
    
    // 將最後一行推入結果
    if (currentLine) {
        lines.push(currentLine);
    }
    
    return lines;
}


const MAX_NAME_WIDTH = 12; // 名稱和血盟欄位的最大寬度 (例如 12 寬度)

/**
 * 【主要函數】將資料轉換為適用於 Discord 訊息的等寬表格格式 (使用 > 引用區塊)。
 * * @param {Array<Object>} data - 要顯示的表格資料。
 * @param {boolean} 顯示重生間隔 - 是否包含 '區段' 欄位。
 * @returns {string} 格式化後的 Discord 訊息字串。
 */
function formatTableForDiscord(data, 顯示重生間隔 = true) {
  if (!data || data.length === 0) {
    return '沒有資料可顯示。';
  }

  // 1. 設定每一欄的標題、對應的資料鍵值，以及對齊方式
  const columns = [
    // 💡 修正：數量 (count) 欄位通常應該靠右對齊 (right)
    { key: 'count', header: '數量', align: 'right' }, 
    ...(顯示重生間隔 ? [{ key: 'spawnTime', header: '區段', align: 'left' }] : []),
    { key: 'name', header: '名稱', align: 'left', maxWidth: MAX_NAME_WIDTH},
    { key: 'guild', header: '血盟', align: 'left', maxWidth: MAX_NAME_WIDTH},
    { key: '已死亡', header: '已死亡', align: 'left' }
  ];

  // 2. 預處理資料：確保所有值都是字串，並格式化時間戳
  const processedData = data.map(item => ({
    ...item,
    spawnTime: String(item.spawnTime).replace(/~/g, '-'),
    count: String(item.count),
    name: String(item.name),
    guild: String(item.guild),
    // 轉換為 Discord 的相對時間戳格式 (R)
    已死亡: (() => {
      let d = null;
      if (item.death instanceof Date) {
        d = isNaN(item.death.getTime()) ? null : item.death;
      } else if (item.death && item.death !== "未知") {
        d = typeof parseSafeDate === 'function' ? parseSafeDate(item.death) : new Date(item.death);
      }
      return (d && !isNaN(d.getTime())) ? `<t:${Math.floor(d.getTime() / 1000)}:R>` : "未知";
    })() 
  }));

  // 3. 計算每一欄的最終顯示寬度 (columnWidths)
  const columnWidths = columns.map(col => getDisplayWidth(String(col.header))); // 預設為標題寬度

  processedData.forEach(item => {
    columns.forEach((col, i) => {
      const content = String(item[col.key]);
      let contentWidth = getDisplayWidth(content);

      // 考慮 maxWidth 限制：內容的有效寬度不得超過 maxWidth
      if (col.maxWidth) {
          contentWidth = Math.min(contentWidth, col.maxWidth);
      }
      
      // 最終欄寬取：(目前記錄的寬度) 和 (當前內容的有效寬度) 的最大值
      columnWidths[i] = Math.max(columnWidths[i], contentWidth);
    });
  });


  // 4. 填充文本函數 (內聯定義)
  const padText = (text, targetWidth, align = 'left') => {
    const textStr = String(text);
    const currentWidth = getDisplayWidth(textStr); 
    const paddingNeeded = targetWidth - currentWidth;
    
    if (paddingNeeded <= 0) {
        return textStr; // 超出寬度則不填充
    }

    const padding = ' '.repeat(paddingNeeded);

    if (align === 'right') {
      return padding + textStr;
    }
    return textStr + padding;
  };

  // 5. 格式化表頭
  // 💡 修正：原代碼的 `columnWidths[i] > MAX_NAME_WIDTH ? 12 : columnWidths[i]` 邏輯可能導致錯誤的寬度計算。
  // 優化後直接使用計算出的 columnWidths[i]，確保對齊。
  const formattedHeaders = columns
    .map((col, i) => padText(col.header, columnWidths[i], col.align))
    .join(' ');

  // 6. 格式化分隔線
  const separator = columnWidths
    // 分隔線長度與欄寬一致，且至少為 2
    .map(width => '='.repeat(Math.max(2, width))) 
    .join(' ');


  // 7. 格式化每一筆資料 (處理多行)
  const rowLines = [];
  processedData.forEach(item => {
      
      // 取得所有欄位分行後的結果 (Lines)
      const columnLines = columns.map(col => {
          const content = String(item[col.key]);
          if (col.maxWidth) {
              // 對有限寬度的欄位進行分行
              return wrapText(content, col.maxWidth); 
          } else {
              // 對無限寬度的欄位，維持單行
              return [content]; 
          }
      });
      
      // 找出該筆資料中，行數最多的是哪一欄 (決定總行數)
      const maxLines = columnLines.reduce((max, lines) => Math.max(max, lines.length), 1);
      
      // 遍歷每一行 (i = 0 是第一行，i = 1 是第二行...)
      for (let i = 0; i < maxLines; i++) {
          const lineParts = columnLines.map((lines, j) => {
              const col = columns[j];
              const targetWidth = columnWidths[j];
              
              // 獲取當前行的內容 (如果 i 超出 lines.length，則為空字串 '')
              const cellContent = lines[i] || ''; 
              
              // 💡 簡化：原代碼的 `if (i > 0 && !col.maxWidth)` 邏輯是多餘的，
              // 因為 `lines[i] || ''` 已經確保了非換行欄位的後續行內容是空字串，
              // 只需要用 `padText` 函數填充即可。
              const paddedText = padText(cellContent, targetWidth, col.align);
              
              return paddedText;
          });
          // 將格式化後的行推入結果，保持 Discord 引用區塊格式
          rowLines.push("> " + lineParts.join(' '));
      }
  });


  // 8. 組合最終的字串
  const tableString = `

> ${formattedHeaders}
> ${separator}
${rowLines.join('\n')}

  `.trim();

  return tableString;
}

// Webhook 佇列變數
const webhookQueue = []; 
let isProcessing = false; 
const RETRY_DELAY = 2000; // 失敗重試間隔 (2 秒)
const THROTTLE_INTERVAL = 1000; // 節流間隔 (1 秒，確保每秒最多一次發送)

/**
 * 將 Webhook 請求加入佇列並啟動處理流程。
 * 這是外部調用的主要函數。
 * * @param {string} webhookUrl - Discord Webhook URL。
 * @param {string} textContent - 要發送的訊息內容。
 * @returns {Promise<boolean>} 總是返回 true，因為發送是背景進行的。
 */
async function sendTextWebhook(webhookUrl, textContent) {
    if (webhookUrl == "") {
        return true;
    }
    // 1. 將新的請求物件 (包含重試次數) 放入佇列末尾
    webhookQueue.push({ webhookUrl, textContent, retryCount: 0 });
    console.log(`🔔 新請求已加入佇列。當前佇列長度: ${webhookQueue.length}`);
    
    // 2. 啟動處理流程 (如果目前沒有在跑的話，避免重複啟動)
    if (!isProcessing) {
        processWebhookQueue();
    }
    
    return true; 
}

/**
 * 核心處理函數：負責取出佇列中的請求、執行發送、處理重試和節流。
 */
async function processWebhookQueue() {
    // 設置標誌，表示處理流程正在運行中
    isProcessing = true; 

    // 只要佇列中還有待處理的請求，就持續運行
    while (webhookQueue.length > 0) {
        // 從佇列最前端取出要處理的請求
        const request = webhookQueue.shift(); 
        const { webhookUrl, textContent, retryCount } = request;

        try {
            console.log(`🚀 開始發送請求 (重試次數: ${retryCount})`);

            // ⚠️ 注意：瀏覽器環境發送 Webhook 可能受 CORS 限制。
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: textContent,
                    username: 'Boss監控機器人'
                })
            });

            if (response.ok) {
                console.log('✅ 文字訊息發送成功');
            } else {
                // 發送失敗 (例如 4xx 或 5xx 狀態碼)
                console.error(`❌ 發送失敗 (HTTP Status: ${response.status})。將於 ${RETRY_DELAY / 1000} 秒後重試...`);
                
                // 執行重試邏輯
                // 1. 增加重試計數
                request.retryCount = retryCount + 1;
                // 2. 等待 2 秒
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                // 3. 將請求放回佇列的**最前面**，確保優先處理
                webhookQueue.unshift(request);
            }
        } catch (error) {
            // 網路錯誤 (例如連線中斷)
            console.error('❌ 網路發送錯誤:', error.message, `。將於 ${RETRY_DELAY / 1000} 秒後重試...`);
            
            // 執行重試邏輯 (與上面相同)
            request.retryCount = retryCount + 1;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            webhookQueue.unshift(request);
        }

        // --- 核心節流機制 ---
        // 每次發送完畢後，等待 1 秒，確保每秒最多執行一次發送。
        // 無論成功或失敗，都必須執行等待，以控制流量。
        await new Promise(resolve => setTimeout(resolve, THROTTLE_INTERVAL));
    }
    
    // 佇列清空後，重設標誌
    isProcessing = false;
    console.log('✨ Webhook 佇列處理完畢。');
}


const 長老Boss = [45955,45956,45957,45958,45959,45960,45961,45962]
const 陣營Boss = [81082,45685,45674,45625,45753]
// const 奧塔Boss = [45513,45547,45606,45650,45652,45653,45654,45618,45672,45673]
const 奧塔Boss = [45606,45653,45654,45618,45672,45673]
const 奧塔AllBoss = [45513,45547,45606,45650,45652,45653,45654,45618,45672,45673]
const 野外Boss = [45614,45801,46142,46141,99085,99086,99065,45863]
// 合併多個陣列
const allDcCheckBoss = [...長老Boss, ...陣營Boss, ...奧塔AllBoss, ...野外Boss];

/**
 * 根據 Boss ID 處理資料並發送 Webhook 訊息。
 * * @param {number} id - Boss ID (大於 100000 為活動 Boss，0 為輪迴時間刷新)。
 * @param {boolean} test - 是否為測試模式 (true 只 console.log，false 發送 Webhook)。
 */
function SendToDC(id) {
    // 從 ID 中提取實際 Boss ID，並判斷是否為活動 Boss
    const fixId = id % 100000;
    const isActive = id > 100000;

    // 建立一個 Boss 類型與其對應的 Webhook URL 和 Boss ID 列表的映射
    const bossReportMap = [
        // 檢查是否為長老 Boss
        { checkList: 長老Boss, webhookUrl: WEBHook_URL.長老 },
        // 檢查是否為奧塔 Boss (使用您範例中的 奧塔AllBoss)
        { checkList: 奧塔AllBoss, webhookUrl: WEBHook_URL.奧塔 }, 
        // 檢查是否為陣營 Boss
        { checkList: 陣營Boss, webhookUrl: WEBHook_URL.陣營 },
        // 檢查是否為野外 Boss
        { checkList: 野外Boss, webhookUrl: WEBHook_URL.野外 },
        // 檢查是否在全部的 Boss清單
        { checkList: [...長老Boss, ...陣營Boss, ...奧塔Boss, ...野外Boss], webhookUrl: WEBHook_URL.all }
    ];

    // 只有在 Boss ID 在監控列表或為時間刷新 (fixId == 0) 時才執行
    if (!allDcCheckBoss.includes(fixId) && fixId !== 0) {
        return;
    }

    let titleMsg = "";
    
    // 查找被擊殺或輪迴時間刷新的 Boss 資料
    // 💡 優化：使用 find 替代 filter 提升效率，並確保找到單一結果
    const findDeathBoss = bossListData.find(item => parseInt(item.id) === fixId);

    if (fixId === 0) {
        // --- 情況一：重生輪迴時間刷新 ---
        titleMsg += "*** 重生輪迴時間刷新 ***\n";

        // 遍歷映射，找出所有匹配的類別並發送報告
        bossReportMap.forEach(({ checkList, webhookUrl }) => {            
            let bosses = bossListData.filter(item => checkList.includes(parseInt(item.id)));
            bosses = bosses.sort((a, b) => 
              Math.abs(parseInt(a.重生間隔.split('~')[0]) - config.lastRefreshBossTime) - 
              Math.abs(parseInt(b.重生間隔.split('~')[0]) - config.lastRefreshBossTime)
            );
            // 確保 bosses 存在且時間區段與上次刷新時間一致 (表示是新的區段開始)
            if (bosses.length > 0 && config.lastRefreshBossTime === parseInt(bosses[0].重生間隔.split('~')[0])) {
                sendTextWebhook(webhookUrl, titleMsg + makeListMsg(checkList) + "\n> 活動出現次數: " + msgFromActive(checkList));
            }
        });

    } else if (findDeathBoss) {
        // --- 情況二：Boss 被擊殺 ---
        // 格式化擊殺訊息標題
        titleMsg += `***[${isActive ? '活動 ' : ''}${findDeathBoss.bossName}] 被 ${findDeathBoss.emblem} 擊殺 ${findDeathBoss.death}***\n`;
        
        // 獲取被擊殺 Boss 的 ID (確保是數字類型，避免重複調用 parseInt)
        const killedBossId = parseInt(findDeathBoss.id);

        // 遍歷映射，找出所有匹配的類別並發送報告
        bossReportMap.forEach(({ checkList, webhookUrl }) => {
            if (checkList.includes(killedBossId)) {
                // 發送該類別 Boss 的清單報告，預設顯示重生間隔 (makeListMsg 第二個參數為 true/省略)
                sendTextWebhook(
                    webhookUrl, 
                    titleMsg + makeListMsg(checkList) + "\n> 活動出現次數: " + msgFromActive(checkList)
                );
                // 💡 注意：如果一個 Boss 可能屬於多個清單，程式碼會向所有匹配的 Webhook 發送。
                // 如果 Boss ID 是互斥的，可以在這裡加上 return 或 break，但這裡假設您允許重複發送。
            }
        });
    } else {
        // 找不到資料，通常在 fixId > 0 的情況下不應該發生
        return; 
    }
}

function makeListMsg(listID, 顯示重生間隔 = true) {
  // 假設 item.respawnCount, item.bossName, item.emblem, item.death, item.已死亡 (時間差字串) 
  // 都是在 bossListData 內
  const tableData = bossListData
    .filter(item => listID.includes(parseInt(item.id)))
    .map(item => {
      // 優先使用 getLatestDeathDate 抓取真正最新的死亡時間
      let latestDeathDate = null;
      if (typeof getLatestDeathDate === 'function') {
        latestDeathDate = getLatestDeathDate(item);
      }
      return {
        count: item.respawnCount, 
        name: item.bossName,
        spawnTime: item.重生間隔, 
        guild: item.emblem === 'Il一雲門集團一II' ? '雲門' : item.emblem, 
        death: latestDeathDate || item.death,
        已死亡: formatTimeDifference(item.已死亡)
      };
    });
    
  return formatTableForDiscord(tableData, 顯示重生間隔);
}

// --- 輪詢與時間判斷邏輯 ---
// ⚠️ 注意：輪迴時間刷新的 Webhook 推播已全面遷移至 Cloudflare Worker 後端 (Durable Object Alarm / Cron) 統一處理，
// 徹底避免多位成員同時開啟網頁造成 Discord 重複發送洗版，並確保無人開啟網頁時依然準時推播。
// 前端此處僅負責更新本機儀表板介面 (refresh)，不再由前端直接發送 Webhook。
setInterval(() => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  // 1. 找出所有監控 Boss 的重生結束小時 (去重並排序)
  const allTargetHours = [...new Set(
    bossListData
      .filter(item => allDcCheckBoss.includes(parseInt(item.id)))
      .map(item => parseInt(item.重生間隔.split('~')[1]))
  )].sort((a, b) => a - b);
  
  // 邊界檢查：如果沒有任何 Boss 資料
  if (allTargetHours.length === 0) {
      return; 
  }

  // 2. 找到下一個最近的小時
  const nextHourToday = allTargetHours.find(h => h >= hours);
  const newRange = nextHourToday !== undefined ? nextHourToday : allTargetHours[0];

  // 3. 判斷是否需要更新本機儀表板
  if (newRange !== config.lastRefreshBossTime) {
      config.lastRefreshBossTime = newRange;
      refresh(); 
      console.log('--- 本機介面更新：Boss 輪迴時間已切換至下一個小時 ---', newRange);
  }
  
}, 30 * 1000); // 30秒執行一次