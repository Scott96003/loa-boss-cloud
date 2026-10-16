// bossListData 原始資料
var bossListData = [];
// 語音開關
var speakOpen = false;
// 獲取表格元素
var bossTable = document.getElementById("bossList");

// 用於控制語音音量的滑塊
var slider = document.getElementById("percentageSlider");
// 用於顯示音量百分比的元素
var display = document.getElementById("percentageDisplay");

// 訊息容器相關變數
const messageContainer = document.getElementById('messageContainer');
var toggleMessageContainerBtn = document.getElementById('toggleMessageContainer');
var messageCount = 0;

// 設定計算輪迴的基礎時間
const baseTime = '2024-01-04T12:00:00';

// 用於過濾顯示的 boss ID
var filterBossIDs = "";

// 追蹤的 boss
var trackBossNames = [];

// 設定檔物件
let config = {
  // 紀錄下次需要更新 boss 輪迴時間的區間，預設為 24
  lastRefreshBossTime: 24,
  // 設定重開機時間，預設為 '2024-01-04T12:00:00'
  rebootTime: new Date('2024-01-04T12:00:00'),
  // 訊息列表
  messageList: []
}

// 如果不是 debug 模式，則覆蓋 console.log，使其不執行任何操作
if (!debug) {
  console.log = function () { };
}

// 建立一個節流版本的 refresh 函數，延遲時間為 500 毫秒
// 這可以防止在短時間內收到大量更新時，過於頻繁地刷新整個 UI
const throttledRefresh = throttle(refresh, 500);

/**
 * 根據 boss 物件的 id 獲取需要擊殺的次數
 * @param {object} obj - boss 物件
 * @returns {number} - 需要擊殺的次數
 */
const getBossCount = (obj) => {
  let needBossCount = 1; // 假設初始值為 1

  // 根據 boss id 處理例外情況
  if (obj.id === "45545") {
    needBossCount = 2;
  }
  if (obj.id === "45640" || obj.id === "45516") {
    needBossCount = 3;
  }

  if (obj.id === "46220") {
    needBossCount = 4;
  }

  return needBossCount
};

/**
 * 將 boss 資料新增為表格的一行
 * @param {object} data - boss 資料
 */
function addBossTR(data) {
  if (typeof syncBossLatestDeathAndEmblem === "function") {
    syncBossLatestDeathAndEmblem(data);
  }
  if (!columnConfig || columnConfig.length === 0) {
    if (typeof loadColumnConfig === "function") {
      loadColumnConfig();
    } else if (typeof defaultColumnConfig !== "undefined") {
      columnConfig = [...defaultColumnConfig];
    }
  }
  var bossName = data.bossName;
  var respawnTime = parseInt(data.respawnTime);
  var deathTime = data.death; // 使用当前时间作为死亡时间
  var id = data.id || "請補充";


  var respawnDate = new Date(new Date(deathTime).getTime() + respawnTime * 3600000); // 计算预估出生时间
  var bossList = document.getElementById("bossList").getElementsByTagName("tbody")[0];
  var newRow = bossList.insertRow();

  // 設置 id 屬性
  newRow.setAttribute("id", "boss_" + data.id);

  // 遍歷欄位配置，動態建立儲存格
  columnConfig.forEach((config, index) => {
    var cell = newRow.insertCell(index);
    let cellContent = '';

    // 處理特殊類型和內容
    switch (config.type) {
      case 'data':
        cellContent = data[config.key] || '未知';
        break;
      case 'action':
        cellContent = "<button id='delete_" + data.bossName + "'>刪除</button>";
        var buttonName = "";
        if (trackBossNames.includes(data.bossName)) {
          buttonName = "停止追蹤";
        } else {
          buttonName = "追蹤";
        }
        cellContent += "<button class='trackBtn' id='track_" + encodeURIComponent(data.bossName) + "'>" + buttonName + "</button>";
        // 手機卡片模式用：開啟死亡歷史抽屜
        cellContent += "<button class='historyBtn' title='死亡歷史'>歷史</button>";
        // 手機卡片模式用：展開次要欄位與刪除按鈕
        cellContent += "<button class='moreBtn' title='更多'>⋯</button>";
        break;
      case 'computed':
        // 計算欄位初始設置為空，將由 refresh 函式更新
        cellContent = '';
        break;
    }

    cell.innerHTML = cellContent;

    // 標記欄位 key，供手機卡片版面以 CSS 定位各欄
    cell.setAttribute('data-col-key', config.key);

    // 設置 cell id 或 class 以便在 updateBossRemainingTime 中快速定位
    if (config.cellId) {
      cell.setAttribute('data-col-id', config.cellId);
    }

    // 設置可編輯性
    cell.setAttribute("contenteditable", config.editable ? "true" : "false");

    // 應用樣式
    if (config.style) {
      Object.keys(config.style).forEach(key => {
        cell.style[key] = config.style[key];
      });
    }

    // 應用特殊格式/事件
    if (config.format === 'tooltip' && config.key === 'death') {
      // 手機／觸控裝置：點擊開啟底部抽屜；桌機：滑鼠移入顯示 tooltip
      cell.addEventListener("click", function (event) {
        if (useDeathHistorySheet()) {
          hideTooltip();
          showFullScreenView(event, data);
        }
      });
      cell.addEventListener("mouseover", function (event) {
        if (!useDeathHistorySheet()) {
          showTooltip(event, data);
        }
      });
      cell.addEventListener("mouseout", function () {
        hideTooltip();
      });
    }

    // 設置刪除按鈕事件
    if (config.type === 'action') {
      var deleteBtn = document.getElementById("delete_" + data.bossName);
      if (deleteBtn) {
        deleteBtn.addEventListener("click", function () {
          deleteBoss(this);
        });
      }
      var trackBtn = document.getElementById("track_" + encodeURIComponent(data.bossName));
      if (trackBtn) {
        trackBtn.addEventListener("click", function () {
          trackBoss(this);
        });
      }
      var historyBtn = cell.querySelector(".historyBtn");
      if (historyBtn) {
        historyBtn.addEventListener("click", function (event) {
          showFullScreenView(event, data);
        });
      }
      var moreBtn = cell.querySelector(".moreBtn");
      if (moreBtn) {
        moreBtn.addEventListener("click", function () {
          newRow.classList.toggle("expanded");
        });
      }
    }

    // 將 ID 放入儲存格屬性中，以便於刪除時查找
    if (config.key === 'id') {
      cell.setAttribute('data-boss-id', data.id);
    }
  });
}

function trackBoss(btn) {
  console.log('追蹤 boss');
  var bossName = decodeURIComponent(btn.id.replace("track_", ""));
  if (trackBossNames.includes(bossName)) {
    trackBossNames.splice(trackBossNames.indexOf(bossName), 1);
    btn.textContent = "追蹤";
  } else {
    trackBossNames.push(bossName);
    btn.textContent = "停止追蹤";
  }
  saveToLocalStorage();
}

/**
 * 刷新數據，包括更新 boss 剩餘時間、排序、過濾和保存到本地存儲
 */
function refresh() {
  console.log('刷新數據');
  document.getElementById("reboot_message").innerHTML = "重新開機時間：" + config.rebootTime.toLocaleString('zh-tw', { hour12: false });
  updateBossRemainingTime();
  sortListByRespawnTime();
  filterTable(filterBossIDs);
  saveToLocalStorage();
}

/**
 * 根據重生時間對 boss 列表進行排序
 */
function sortListByRespawnTime() {
  // 動態排序條件陣列，按優先順序進行比較
  const sortingCriteria = [
    {
      name: '對比重生次數',
      compare: (a, b) => b.respawnCount - a.respawnCount
    },
    {
      name: '對比預估出生時間%',
      compare: (a, b) => {
        // 必須要重生次數不為 0 才判斷
        if (a.respawnCount > 0 && b.respawnCount > 0) {
          const now = Date.now();
          const getPercentage = (obj) => {
            const defaultRespawnTime = new Date(obj.DefaultRespawnTime).getTime();
            const respawnTimeInMs = parseInt(obj.respawnTime) * 3600000;
            return Math.abs(now - defaultRespawnTime) / respawnTimeInMs * 100;
          };
          return getPercentage(a) - getPercentage(b);
        } else {
          return 0;
        }
      }
    },
    {
      name: '對比死亡時間',
      compare: (a, b) => new Date(a.death) - new Date(b.death)
    }
  ];

  // 按動態條件進行排序
  console.log("按動態條件進行排序")
  bossListData.sort((a, b) => {
    for (let criterion of sortingCriteria) {
      const diff = criterion.compare(a, b);
      // 這邊必須要判斷不等於 0 才會跑下一個條件
      if (diff != 0) {
        return diff;
      }
    }
    return 0;
  });

  // 更新表格的順序
  const bossTableBody = document.getElementById("bossList").getElementsByTagName("tbody")[0];
  const newOrder = bossListData.map(boss => document.getElementById("boss_" + boss.id));

  // 移除現有所有行，並按新順序重新加入
  while (bossTableBody.firstChild) {
    bossTableBody.removeChild(bossTableBody.firstChild);
  }
  newOrder.forEach(row => {
    if (row) { // 確保元素存在
      bossTableBody.appendChild(row);
    }
  });

  setTimeout(() => {
    speakOpen = true;
  }, 5000);
}

/**
 * 刪除指定的 boss
 * @param {HTMLElement} button - 觸發刪除操作的按鈕
 */
function deleteBoss(button) {
  var row = button.parentNode.parentNode;

  // 使用儲存在 ID 儲存格上的屬性來取得 ID
  const idCell = row.querySelector('[data-boss-id]');
  var id = idCell ? idCell.getAttribute('data-boss-id') : null;

  // 由於 bossName 是可編輯的，這裡假設它在配置中的第二欄
  const bossNameCellIndex = columnConfig.findIndex(c => c.key === 'bossName');
  var bossName = row.cells[bossNameCellIndex].innerText;


  if (!id || !bossName) {
    alert("無法找到 Boss ID 或名稱，無法刪除。");
    return;
  }

  var confirmation = confirm("確定要刪除此 Boss [" + id + "]" + bossName + " 嗎？");
  if (confirmation) {
    bossListData = bossListData.filter(function (item) {
      return ((item.id !== id) || (item.bossName !== bossName));
    });
    saveToLocalStorage();
    sortListByRespawnTime();
  }
}

/**
 * 計算下一次 Boss 出生時間
 * @param {number} respawnTime - Boss 的重生時間（小時）
 * @returns {Date} - 下一次出生時間
 */
function getRebirthTime(respawnTime) {
  // 計算下一次 Boss 出生時間
  const nextSpawn = getSpawnTime(new Date(), respawnTime);
  return nextSpawn;
}

/**
 * 根據當前時間和週期計算下一次出現的時間
 * @param {Date} currectTime - 當前時間
 * @param {number} cycleHours - 週期（小時）
 * @returns {Date} - 下一次出現的時間
 */
function getSpawnTime(currectTime, cycleHours) {
  // 當前時間
  const now = currectTime;

  // 將基礎時間轉為 Date 物件
  const baseDate = new Date(baseTime);

  // 計算從基礎時間到當前時間的差距（毫秒）
  const timeDiffMs = now - baseDate;

  // 將差距轉換成小時
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

  // 計算下次預估的時間
  const nextCycle = Math.ceil(timeDiffHours / cycleHours) * cycleHours;

  // 計算下一次出現的時間
  const nextSpawnTime = new Date(baseDate.getTime() + nextCycle * 60 * 60 * 1000);

  return nextSpawnTime;
}

/**
 * 取得當前時間的時間區段
 * @param {Date} currectTime - 當前時間
 * @param {number} cycleHours - 週期（小時）
 * @returns {string} - 格式化後的時間區段
 */
function getSpawnRange(currectTime, cycleHours) {
  var time2 = getSpawnTime(currectTime, cycleHours);
  var time1 = time2 - (cycleHours * 60 * 60 * 1000);
  return formatDateTime_Easy(new Date(time1), new Date(time2));
}

/**
 * 更新 boss 剩餘時間及相關資訊
 * @param {number} [bossID=0] - 要更新的 boss ID，如果為 0 則更新所有 boss
 */
function updateBossRemainingTime(bossID = 0) {
  // 判斷是否需要重新排列
  var needSortList = false
  var now = new Date();

  bossListData.forEach(function (bossData) {

    // 如果有指定 bossID, 且判斷到 id 不相符, 就換下一個
    if (bossID != 0 && bossData.id != bossID) {
      return;
    }

    if (typeof syncBossLatestDeathAndEmblem === "function") {
      syncBossLatestDeathAndEmblem(bossData);
    }

    // 取得 row
    var row = document.getElementById("boss_" + bossData.id);
    if (!row) return; // 安全檢查

    // 計算重生時間相關邏輯
    var respawnTimeHours = parseInt(bossData.respawnTime);
    var respawnDate = getRebirthTime(respawnTimeHours); // 计算预估出生时间
    bossData.DefaultRespawnTime = respawnDate
    var percentage = ((Math.abs(now - respawnDate) / (respawnTimeHours * 3600000)) * 100);

    var lastRespawnTime = respawnDate - (respawnTimeHours * 60 * 60 * 1000);

    let oldFormattedInterval = bossData.重生間隔;
    let newFormattedInterval = formatDateTime_Easy(new Date(lastRespawnTime), new Date(respawnDate));

    bossData.重生間隔 = newFormattedInterval;

    if (oldFormattedInterval !== newFormattedInterval) {
      needSortList = true;
      bossData.result = findLostBoss(bossData);
      bossData.respawnCount = bossData.result.rebornCount;
    }

    // 更新表格中的儲存格
    const emblemCell = row.querySelector(':nth-child(' + (columnConfig.findIndex(c => c.key === 'emblem') + 1) + ')');
    const deathTimeCell = row.querySelector(':nth-child(' + (columnConfig.findIndex(c => c.key === 'death') + 1) + ')');

    if (deathTimeCell) deathTimeCell.innerText = bossData.death;
    if (emblemCell) emblemCell.innerText = bossData.emblem;

    const respawnRangeCell = row.querySelector('[data-col-id="respawn-range"]');
    if (respawnRangeCell) {
      respawnRangeCell.innerText = bossData.重生間隔 + "(" + (100 - percentage).toFixed(2) + "%)";
    }

    bossData.respawnCount = bossData.result.rebornCount
    const respawnCountCell = row.querySelector('[data-col-id="respawn-count"]');
    if (respawnCountCell) {
      respawnCountCell.innerText = bossData.respawnCount;
      respawnCountCell.style.textAlign = 'center';
      respawnCountCell.style.verticalAlign = 'middle';
    }

    getTimeDiff(bossData);
    const getDeathPer = (obj) => (obj.已死亡 ?? 0) / (obj.respawnTime * 3600 * 1000);
    let bossUpPer = getDeathPer(bossData).toFixed(2)
    const timeGapCell = row.querySelector('[data-col-id="time-gap"]');
    if (timeGapCell) {
      timeGapCell.innerText = formatTimeDifference(bossData.已死亡) + "(" + bossUpPer + ")";

      // 閃爍效果邏輯
      let respawnTimeInSeconds = bossData.respawnTime * 3600 * 1000;
      if (bossData.已死亡 > respawnTimeInSeconds) {
        timeGapCell.classList.add('blinking');
      } else {
        timeGapCell.classList.remove('blinking');
      }
    }

    const activeRateCell = row.querySelector('[data-col-id="active-rate"]');
    if (activeRateCell) {
      activeRateCell.innerHTML = msgFromActive([parseInt(bossData.id)]);
    }

    // 判斷 Boss 出現的機率並設定行樣式
    let bossUprate = Math.abs(100 - percentage) + (bossData.respawnCount > getBossCount(bossData) ? 50 : 0)
    // 重設進度顏色，但保留手機卡片的展開狀態
    row.className = row.classList.contains('expanded') ? 'expanded' : ''
    if (bossData.respawnCount > 0) {
      if (bossUprate >= 90) {
        if (!row.classList.contains('boss顏色-90')) {
          row.classList.add('boss顏色-90');
        }
      } else if (bossUprate >= 75) {
        if (!row.classList.contains('boss顏色-75')) {
          row.classList.add('boss顏色-75');
        }
      } else if (bossUprate >= 50) {
        if (!row.classList.contains('boss顏色-50')) {
          row.classList.add('boss顏色-50');
        }
      } else if (bossUprate >= 25) {
        if (!row.classList.contains('boss顏色-25')) {
          row.classList.add('boss顏色-25');
        }
      }
    }
  });

  // 如果數量有變動, 就要重新排列
  if (needSortList == true) {
    sortListByRespawnTime();
  }
}

/**
 * 計算目標活動王的數量
 * @param {Array<number>} bossIds - boss ID 列表
 * @returns {string} - 活動王數量及比例的訊息
 */
function msgFromActive(bossIds) {
  var obj = bossListData.filter(function (item) {
    return (bossIds.includes(parseInt(item.id)) == true);
  });
  const sum = obj.reduce((accumulator, currentValue) => {
    return accumulator + currentValue.deathList.length;
  }, 0);
  const sumActive = obj.reduce((accumulator, currentValue) => {
    const activeCount = currentValue.deathList.reduce((acc, value) => {
      return acc + (value.isActive == true ? 1 : 0);
    }, 0);
    return accumulator + activeCount;
  }, 0);
  return sumActive + "/" + sum + "(" + ((sumActive / sum) * 100).toFixed(2) + "%)"
}


/**
 * 找出缺失的時間區段
 * @param {object} bossData - boss 資料
 * @returns {object} - 包含重生次數和時間區段的物件
 */
function findLostBoss(bossData) {
  if (!bossData || !Array.isArray(bossData.deathList)) {
    if (bossData) bossData.deathList = [];
    return { rebornCount: 1, segments: [] };
  }
  const bossDurationHour = bossData.respawnTime;
  const deathTime = bossData.deathList;
  const segmentDuration = bossDurationHour * 60 * 60 * 1000;

  const startPoint = getSpawnTime(config.rebootTime, bossDurationHour);

  // 生成區段
  const segments = [];
  let currentSegmentStart = new Date(startPoint);

  const currentTime = new Date()

  while (currentSegmentStart < currentTime) {
    const segmentEnd = new Date(currentSegmentStart.getTime() + segmentDuration);
    let segmentTimes = bossData.deathList.filter(dl => new Date(dl.death) >= currentSegmentStart && new Date(dl.death) < segmentEnd);
    segments.push({ start: currentSegmentStart, end: segmentEnd, deathList: segmentTimes });

    currentSegmentStart = segmentEnd;
  }
  let matchingTimes = bossData.deathList.filter(dl => new Date(dl.death) > config.rebootTime);

  segments.sort((a, b) => b.start - a.start);

  var dieCount = matchingTimes.length
  var bossCount = getBossCount(bossData)
  var aliveCount = (segments.length * bossCount) - dieCount;

  if (aliveCount > 3) {
    aliveCount = 3;
  }

  return { rebornCount: aliveCount, segments: segments };
}

/**
 * 判斷日期是否在指定的區間內
 * @param {string|Date} date - 要判斷的日期
 * @param {string|Date} startDate - 開始日期
 * @param {string|Date} endDate - 結束日期
 * @returns {boolean} - 如果在區間內則返回 true，否則返回 false
 */
function isDateInRange(date, startDate, endDate) {
  const targetDate = new Date(date).getTime();
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return targetDate >= start && targetDate <= end;
}

/**
 * 格式化日期時間
 * @param {Date} date - 要格式化的日期
 * @returns {string} - 格式化後的日期時間字串
 */
function formatDateTime(date) {
  return date.getFullYear() + "-" + (date.getMonth() + 1).toString().padStart(2, '0') + "-" + date.getDate().toString().padStart(2, '0') + " " + date.getHours().toString().padStart(2, '0') + ":" + date.getMinutes().toString().padStart(2, '0') + ":" + date.getSeconds().toString().padStart(2, '0');
}

/**
 * 將 Date 轉換為 "小時~小時" 的格式
 * @param {Date} date - 開始日期
 * @param {Date} date2 - 結束日期
 * @returns {string} - 格式化後的時間區段字串
 */
function formatDateTime_Easy(date, date2) {
  var dateString1 = date.getHours().toString().padStart(2, '0');
  var dateString2 = date2.getHours().toString().padStart(2, '0');
  return dateString1 + "~" + dateString2;
}

/**
 * 格式化時間差
 * @param {number} timeDiff - 時間差（毫秒）
 * @returns {string} - 格式化後的時間差字串
 */
function formatTimeDifference(timeDiff) {
  var days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  var hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  var minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
  var formattedTime = "";

  if (days > 0) {
    formattedTime += days + " 天 ";
  }

  formattedTime += hours.toString().padStart(2, '0') + ":" +
    minutes.toString().padStart(2, '0');

  return formattedTime;
}

/**
 * 安全解析日期字串為 Date 物件 (相容 Safari 與各主流瀏覽器)
 * @param {string|Date} dateInput 
 * @returns {Date|null}
 */
function parseSafeDate(dateInput) {
  if (!dateInput) return null;
  if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? null : dateInput;
  const str = String(dateInput).trim();
  if (str === "未知" || str === "" || str === "undefined" || str === "null") return null;

  // 匹配 YYYY-MM-DD HH:mm(:ss)? 格式
  const match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = match[4] ? parseInt(match[4], 10) : 0;
    const minute = match[5] ? parseInt(match[5], 10) : 0;
    const second = match[6] ? parseInt(match[6], 10) : 0;
    const d = new Date(year, month, day, hour, minute, second);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 取得 Boss 最近一次（上次）死亡時間
 * @param {object} bossData - boss 資料
 * @returns {Date|null} - 最近一次死亡時間
 */
function getLatestDeathDate(bossData) {
  let latestDate = null;

  // 1. 優先檢查主要死亡時間屬性 (bossData.death)
  if (bossData.death && bossData.death !== "未知") {
    const d = parseSafeDate(bossData.death);
    if (d) {
      latestDate = d;
    }
  }

  // 2. 檢查 deathList 中的歷史記錄，找出最新的一筆
  if (Array.isArray(bossData.deathList) && bossData.deathList.length > 0) {
    for (const item of bossData.deathList) {
      if (item && item.death && item.death !== "未知") {
        const d = parseSafeDate(item.death);
        if (d) {
          if (!latestDate || d.getTime() > latestDate.getTime()) {
            latestDate = d;
          }
        }
      }
    }
  }

  return latestDate;
}

/**
 * 取得 Boss 在 deathList 中最新的一筆死亡紀錄物件
 * @param {object} bossData - boss 資料
 * @returns {object|null}
 */
function getLatestDeathRecord(bossData) {
  if (!bossData || !Array.isArray(bossData.deathList) || bossData.deathList.length === 0) {
    return null;
  }
  let latestItem = null;
  let latestDate = null;
  for (const item of bossData.deathList) {
    if (item && item.death && item.death !== "未知") {
      const d = parseSafeDate(item.death);
      if (d) {
        if (!latestDate || d.getTime() > latestDate.getTime()) {
          latestDate = d;
          latestItem = item;
        }
      }
    }
  }
  return latestItem;
}

/**
 * 同步單一 Boss 的 death 與 emblem 為 deathList 中最新的一筆
 * @param {object} bossData - boss 資料
 */
function syncBossLatestDeathAndEmblem(bossData) {
  const latest = getLatestDeathRecord(bossData);
  if (latest) {
    const currentDeathDate = parseSafeDate(bossData.death);
    const latestDate = parseSafeDate(latest.death);
    if (!currentDeathDate || (latestDate && latestDate.getTime() >= currentDeathDate.getTime())) {
      bossData.death = latest.death;
      if (latest.emblem !== undefined && latest.emblem !== null) {
        bossData.emblem = latest.emblem;
      }
    }
  }
}


/**
 * 取得 boss 的時間間隔
 * @param {object} bossData - boss 資料
 * @returns {Date} - 時間間隔的 Date 物件
 */
function getTimeGap(bossData) {
  if (bossData.deathList == null) {
    bossData.deathList = [];
  }
  bossData.deathList = bossData.deathList.filter(item => item && item.emblem !== undefined);
  const latestDeath = getLatestDeathDate(bossData);
  if (latestDeath) {
    const timeDifference = Math.max(0, new Date().getTime() - latestDeath.getTime());
    return new Date(timeDifference);
  } else {
    return new Date(0);
  }
}

/**
 * 取得 boss 的時間差（距離上次死亡經過的毫秒數）
 * @param {object} bossData - boss 資料
 */
function getTimeDiff(bossData) {
  if (bossData.deathList == null) {
    bossData.deathList = [];
  }
  bossData.deathList = bossData.deathList.filter(item => item && item.emblem !== undefined);

  const latestDeath = getLatestDeathDate(bossData);
  const now = new Date();

  if (latestDeath) {
    // 優先使用最近一次死亡時間計算時間差
    let timeDifference = now.getTime() - latestDeath.getTime();
    bossData.已死亡 = Math.max(0, timeDifference);
  } else {
    // 若無死亡記錄（如尚未擊殺過），以伺服器重開機時間計算
    const reboot = parseSafeDate(config.rebootTime);
    if (reboot) {
      let timeDifference = now.getTime() - reboot.getTime();
      bossData.已死亡 = Math.max(0, timeDifference);
    } else {
      bossData.已死亡 = 0;
    }
  }
}

/**
 * 檢查值是否為有效的日期
 * @param {*} value - 要檢查的值
 * @returns {boolean} - 如果是有效日期則返回 true，否則返回 false
 */
function isValidDate(value) {
  const date = new Date(value);
  return date instanceof Date && !isNaN(date);
}

/**
 * 比較兩個時間
 * @param {string} time1 - 時間 1
 * @param {string} time2 - 時間 2
 * @param {number} bossCount - boss 數量
 * @returns {number} - 1: time1 > time2, -1: time1 < time2, 0: time1 == time2
 */
function compareTime(time1, time2, bossCount) {
  const date1 = new Date(time1.replace(" ", "T"));
  const date2 = new Date(time2.replace(" ", "T"));

  if (bossCount === 1) {
    const hours1 = date1.getHours();
    const minutes1 = date1.getMinutes();
    const hours2 = date2.getHours();
    const minutes2 = date2.getMinutes();

    if (hours1 > hours2 || (hours1 === hours2 && minutes1 > minutes2)) {
      return 1;
    } else if (hours1 < hours2 || (hours1 === hours2 && minutes1 < minutes2)) {
      return -1;
    } else {
      return 0;
    }
  } else {
    if (date1 > date2) {
      return 1;
    } else if (date1 < date2) {
      return -1;
    } else {
      return 0;
    }
  }
}

/**
 * 檢查新的死亡紀錄是否重複
 * @param {object} boss - boss 物件
 * @param {string} newDeath - 新的死亡時間
 * @returns {boolean} - 如果不重複則返回 true，否則返回 false
 */
function check_Death(boss, newDeath) {
  const newDeathTime = new Date(newDeath.replace(" ", "T"));
  const currentTime = new Date();

  const isDuplicate = boss.deathList.some(entry => {
    const existingDeathTime = new Date(entry.death.replace(" ", "T"));

    const isSameHourMinute =
      newDeathTime.getHours() === existingDeathTime.getHours() &&
      newDeathTime.getMinutes() === existingDeathTime.getMinutes();


    const bossCount = getBossCount(boss)

    if (isSameHourMinute) {
      if (bossCount === 1) {
        return false
      }

      const timeDifferenceWithCurrent = Math.abs(currentTime - existingDeathTime);
      const timeDifferenceWithNew = Math.abs(newDeathTime - existingDeathTime);
      return timeDifferenceWithCurrent > 30 * 1000 || timeDifferenceWithNew < 5 * 1000;
    }
    return false;
  });

  return !isDuplicate;
}

/**
 * 使用瀏覽器的語音合成功能朗讀文字
 * @param {string} text - 要朗讀的文字
 */
function speak(text) {
  if (!speakOpen) {
    return;
  }
  var slider = document.getElementById("percentageSlider");
  if (text.trim() !== '') {
    var synth = window.speechSynthesis;
    var utterance = new SpeechSynthesisUtterance(text);

    // 取得所有可用語音
    var voices = synth.getVoices();

    // 尋找特定的語音（例如中文女聲）
    // 你可以嘗試尋找名稱包含 "Mei-Jia" (系統), "Ting-Ting" (系統) 或 "Google 國語" (Chrome)
    var selectedVoice = voices.find(voice =>
      voice.name.includes("Mei-Jia") ||
      voice.name.includes("Ting-Ting") ||
      (voice.lang === 'zh-TW' && voice.name.includes("Google"))
    );

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    var volume = slider.value / 100;
    utterance.volume = volume; // 設定音量
    if (volume <= 0) {
      return;
    }
    synth.speak(utterance);
  } else {
    console.log("請輸入要說的文字");
  }
}

/**
 * 顯示懸浮提示框
 * @param {MouseEvent} event - 滑鼠事件
 * @param {object} data - boss 資料
 */
function showTooltip(event, data) {
  var tooltip = document.createElement("div");
  tooltip.className = "tooltip";

  var msg = "<div style='font-weight: bold; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 2px;'>" + data.bossName + " 的死亡紀錄:</div>";

  // 防呆：若 deathList 不存在或為空，但有 death 欄位，自動補入一筆
  if (!data.deathList || !Array.isArray(data.deathList)) {
    data.deathList = [];
  }
  if (data.deathList.length === 0 && data.death && data.death !== '未知' && String(data.death).trim() !== '') {
    data.deathList.push({
      death: data.death,
      emblem: data.emblem || '',
      bossName: data.bossName,
      type: data.type || 0,
      isActive: false
    });
  }

  // 若完全沒有任何紀錄，依然顯示提示框告知使用者
  if (data.deathList.length === 0) {
    msg += "<div style='color: #ccc; padding: 4px 2px; font-size: 12px;'>尚無可顯示的死亡紀錄</div>";
    tooltip.innerHTML = msg;
    positionAndShowTooltip(tooltip, event);
    return;
  }

  const bossDurationHour = parseFloat(data.respawnTime) || 1;
  const segmentDuration = bossDurationHour * 60 * 60 * 1000;
  
  // 取得歷史區段的起始時間點 (從伺服器重開機時間或最早的死亡紀錄開始推算)
  let earliestDate = (config && config.rebootTime) ? new Date(config.rebootTime) : null;
  if (data.deathList && data.deathList.length > 0) {
    const validDates = data.deathList
      .map(d => new Date(d.death))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a - b);
    if (validDates.length > 0) {
      if (!earliestDate || validDates[0] < earliestDate) {
        earliestDate = validDates[0];
      }
    }
  }
  const baseStart = earliestDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const startPoint = getSpawnTime(baseStart, bossDurationHour).getTime() - segmentDuration;

  // 生成區段
  const segments = [];
  let currentSegmentStart = new Date(startPoint);
  const currentTime = new Date();

  while (currentSegmentStart < currentTime) {
    const segmentEnd = new Date(currentSegmentStart.getTime() + segmentDuration);
    let matchingTimes = data.deathList.filter(dl => {
      const d = new Date(dl.death);
      return d >= currentSegmentStart && d < segmentEnd;
    });
    segments.push({ start: currentSegmentStart, end: segmentEnd, deathList: matchingTimes });
    currentSegmentStart = segmentEnd;
  }

  segments.sort((a, b) => b.start - a.start);
  // 放寬歷史區段上限至 100 個區間，確保 13、14 號紀錄能完整展現
  const 需要顯示的 = segments.splice(0, 100);

  const rebootTimeObj = (config && config.rebootTime) ? new Date(config.rebootTime) : new Date(0);

  msg += "<table style='font-size: 12px; border-collapse: collapse;'>";
  let hasShownAnySegment = false;

  需要顯示的.forEach(function (segment) {
    const hasRecords = segment.deathList && segment.deathList.length > 0;
    // 只要有擊殺紀錄，或者在維護時間之後，就顯示該區段
    if (hasRecords || rebootTimeObj < segment.end) {
      hasShownAnySegment = true;
      var needReboot = (rebootTimeObj >= segment.start && rebootTimeObj < segment.end);

      msg += "<tr>";
      msg += "<td style='vertical-align: top; padding-right: 8px; color: #a9c7df; white-space: nowrap;'>" + 
             segment.start.getDate() + "(" + formatDateTime_Easy(segment.start, segment.end) + ")</td>";
      msg += "<td>";
      
      if (hasRecords) {
        segment.deathList.forEach(function (deathTime) {
          if (needReboot == true) {
            if (new Date(deathTime.death) < rebootTimeObj) {
              msg += "<div style='color: #ffeb3b;'>重新開機 " + (config.rebootTime || "") + "</div>";
              needReboot = false;
            }
          }
          if (deathTime.isActive) {
            msg += "<div style='color: #ff5252;'>";
          } else {
            msg += "<div>";
          }
          msg += (deathTime.death || '') + " " + (deathTime.emblem || '');
          if ([1, 2].includes(deathTime.type || 0)) {
            msg += " " + (deathTime.bossName || "");
          }
          if (deathTime.isActive) {
            msg += "<span style='margin-left: 6px; padding: 0 5px; font-size: 10px; line-height: 16px; color: #fff; background: #ed4245; border-radius: 8px; display: inline-block; vertical-align: 1px;'>活動</span>";
          }
          msg += "</div>";
        });
      } else {
        msg += "<div style='color: #777;'>無擊殺記錄</div>";
      }

      if (needReboot == true) {
        msg += "<div style='color: #ffeb3b;'>重新開機 " + (config.rebootTime || "") + "</div>";
      }
      msg += "</td>";
      msg += "</tr>";
    }
  });

  if (!hasShownAnySegment && data.deathList.length > 0) {
    // 若因時間過濾皆未顯示，直接列出最新記錄防呆
    data.deathList.slice(-5).reverse().forEach(dl => {
      msg += `<tr><td colspan='2' style='color:#fff;'>${dl.death} ${dl.emblem || ''}</td></tr>`;
    });
  }

  msg += "</table>";
  tooltip.innerHTML = msg;
  positionAndShowTooltip(tooltip, event);
}

function positionAndShowTooltip(tooltip, event) {
  var topPos = event.clientY + window.scrollY + 10;
  var leftPos = event.clientX + window.scrollX + 10;
  tooltip.style.top = topPos + "px";
  tooltip.style.left = leftPos + "px";

  document.body.appendChild(tooltip);

  var tooltipRect = tooltip.getBoundingClientRect();
  var windowHeight = window.innerHeight;
  var windowWidth = window.innerWidth;

  if (event.clientY > (windowHeight / 2)) {
    topPos -= Math.max(tooltipRect.height + 15, windowHeight / 4);
  }
  if (event.clientX > (windowWidth / 2)) {
    leftPos -= Math.max(tooltipRect.width + 15, 200);
  }

  tooltip.style.top = Math.max(10, topPos) + "px";
  tooltip.style.left = Math.max(10, leftPos) + "px";
}

/**
 * 隱藏懸浮提示框
 */
function hideTooltip() {
  var tooltips = document.querySelectorAll(".tooltip");
  tooltips.forEach(function (tooltip) {
    tooltip.parentNode.removeChild(tooltip);
  });
}

/**
 * 顯示浮動訊息
 * @param {string} msg - 要顯示的訊息
 */
function showfloatingMessage(msg) {
  var message = document.getElementById('floatingMessage');
  message.style.display = 'block';
  message.innerText = msg;
  setTimeout(function () {
    message.style.display = 'none';
  }, 10000);
}

/**
 * 在訊息容器中繪製訊息
 * @param {string} message - 要繪製的訊息
 */
function drawMessage(message) {
  var p = document.createElement('p');
  const container = document.getElementById('messageContainer');
  if (!container) return;
  p.textContent = message;
  p.style.margin = "2px 0";
  container.appendChild(p);
  messageCount++;

  // 訊息區收起時，在切換按鈕上標示有新訊息
  if (container.classList.contains('hidden')) {
    const toggleBtn = document.getElementById('toggleMessageContainer');
    if (toggleBtn) toggleBtn.classList.add('has-unread');
  }

  // 同步維護 config.messageList (最多保留 10,000 筆)
  if (Array.isArray(config.messageList)) {
    if (!config.messageList.includes(message)) {
      config.messageList.push(message);
    }
    if (config.messageList.length > 10000) {
      config.messageList = config.messageList.slice(-10000);
    }
  }

  container.scrollTop = container.scrollHeight;
}

/**
 * 過濾表格
 * @param {string} bossIDs - 要過濾的 boss ID，以逗號分隔
 */
function filterTable(bossIDs) {
  filterBossIDs = bossIDs;
  var table, tr, td, i, txtValue;
  console.log("bossIDs", bossIDs);
  var bossIdArray = bossIDs.split(',').map(name => name.trim().toLowerCase());
  table = document.getElementById("bossList");
  tr = table.getElementsByTagName("tr");

  const idColumnIndex = columnConfig.findIndex(config => config.key === 'id');

  if (idColumnIndex === -1) {
    console.error("錯誤：columnConfig 中找不到 'id' 欄位配置。無法執行過濾。");
    return;
  }

  for (i = 1; i < tr.length; i++) {
    if (bossIDs === "") {
      tr[i].style.display = "";
    } else {
      td = tr[i].getElementsByTagName("td")[idColumnIndex];

      if (td) {
        txtValue = td.textContent || td.innerText;
        if (bossIdArray.some(id => txtValue.trim() == id)) {
          tr[i].style.display = "";
        } else {
          tr[i].style.display = "none";
        }
      }
    }
  }
}

// 若在 Chrome 擴充套件環境中，才定時檢查 DC 的 Boss 頁面是否開啟
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
  setInterval(() => {
    checkDC的Boss頁面是否有開啟();
  }, 5000);
}

/**
 * 檢查 DC 的 Boss 頁面是否開啟，如果沒有則開啟新分頁（僅限 Chrome Extension 環境）
 */
function checkDC的Boss頁面是否有開啟() {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ url: 'https://discord.com/channels/1527158850183233606/1527172467016335493' }, (tabs) => {
      if (tabs.length === 0) {
        console.log("找不到符合條件的標籤頁，開啟一個新分頁並跳轉...");
        chrome.tabs.create({ url: 'https://discord.com/channels/1527158850183233606/1527172467016335493', active: true }, function (tab) {
          console.log("新分頁已開啟並跳轉", tab);
        });
      }
    });
  }
}

/**
 * 取得 Boss 歷史資料
 * @param {Date} [myDayTime] - 指定的日期時間，如果沒有則預設為一天前
 */
function 取得Boss歷史資料(myDayTime) {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ url: 'https://discord.com/channels/1527158850183233606/1527172467016335493' }, (tabs) => {
      tabs.forEach((tab) => {
        var dayTime = (function () {
          if (myDayTime) {
            return new Date(myDayTime);
          } else {
            let currentDate = new Date();
            currentDate.setDate(currentDate.getDate() - 1);
            return currentDate;
          }
        })();

        checkDC的Boss頁面是否有開啟();
        chrome.tabs.update(tab.id, { active: true });

        const sendData = {
          action: 'getData',
          dayTime: dayTime
        };

        console.log("準備發送取得舊資料的message, 時間:", dayTime);
        console.log("對", tab.url, "傳送資料:", sendData);
        chrome.tabs.sendMessage(tab.id, sendData, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Loa Boss Time.js 發送訊息到 ", tab.url, " 失敗,", chrome.runtime.lastError, "Data:", sendData);
          } else {
            console.log("Loa Boss Time.js 發送訊息到 ", tab.url, " 成功，回應:", response);
          }
        });
      });
    });
  } else {
    console.log("ℹ️ [雲端環境] 歷史擊殺資料已由 Cloudflare Worker 持久化同步。");
    if (typeof loadAndInitializeBossData === 'function') {
      loadAndInitializeBossData();
    }
  }
}

/**
 * 節流函數
 * @param {Function} func - 要節流的函數
 * @param {number} [delay=1000] - 延遲時間（毫秒）
 * @returns {Function} - 節流後的函數
 */
function throttle(func, delay = 1000) {
  let inThrottle;
  return function (...args) {
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, delay);
    }
  };
}
