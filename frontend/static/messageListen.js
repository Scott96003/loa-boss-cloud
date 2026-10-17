// 最近擊殺快取 (用於防抖去重，避免多重管道或多監聽器導致短時間內重複跳出兩次通報)
const _recentKillDedupeCache = new Map();

function _isDuplicateKillEvent(bossData) {
  if (!bossData || !bossData.death) return false;
  // 不使用 id (不同管道可能送 ID / ID+100000 / 缺漏)，改以正規化名稱 (去除「活動」前綴) + 時間 + 血盟判斷
  const normName = String(bossData.bossName || '').replace(/^活動/, '');
  const key = `${normName}_${bossData.death}_${bossData.emblem || ''}_${bossData.type || 0}`;
  const now = Date.now();
  if (_recentKillDedupeCache.has(key)) {
    const prevTime = _recentKillDedupeCache.get(key);
    if (now - prevTime < 30000) { // 30 秒內視為重複推播
      return true;
    }
  }
  _recentKillDedupeCache.set(key, now);
  if (_recentKillDedupeCache.size > 200) {
    for (const [k, t] of _recentKillDedupeCache.entries()) {
      if (now - t > 30000) _recentKillDedupeCache.delete(k);
    }
  }
  return false;
}

// 監聽來自 Background Script 的消息 (Step2)
function updateBossData(bossData) {
  if (_isDuplicateKillEvent(bossData)) {
    console.log("ℹ️ [防抖去重] 30秒內已處理過相同 Boss 擊殺推播，略過重複通報:", bossData.bossName, bossData.death, bossData.emblem);
    return;
  }

  bossListData.forEach(function (item, index) {
    // 活動boss id 增加100000
    let isActive = (parseInt(item.id) + 100000 == parseInt(bossData.id))

    // 找到相符的 id, 或是type = 1 or 2
    if ((item.id == bossData.id) ||
      (isActive && bossData.type == 0) ||
      ((bossData.type == 1) && (item.id == 1)) ||
      ((bossData.type == 2) && (item.id == 2))) {

      // 防呆,避免資料null或為空
      if ((bossListData[index].deathList === 'undefined') || (bossListData[index].deathList == null)) {
        bossListData[index].deathList = []
      }

      // 過濾不符合格式的資料
      bossListData[index].deathList = bossListData[index].deathList.filter(item => {
        if (item.hasOwnProperty('death') && item.hasOwnProperty('emblem')) {
          if (isValidDate(item.death)) {
            return true
          } else {
            console.log(bossListData[index])
            console.log(item)
            console.log('death 無法轉換時間')
          }
        }
        return false
      });

      // 該筆擊殺已存在 deathList (例如另一管道已先送達)，只更新時間不重複通報
      const alreadyRecorded = bossListData[index].deathList.some(
        d => d.death === bossData.death && (d.emblem || '') === (bossData.emblem || '')
      );
      if (alreadyRecorded) {
        console.log("ℹ️ [去重] 擊殺紀錄已存在，略過重複通報:", bossData.bossName, bossData.death, bossData.emblem);
        updateBossRemainingTime(parseInt(item.id));
        return;
      }

      const newDeathEntry = {
        death: bossData.death,
        bossName: bossData.bossName,
        emblem: bossData.emblem,
        type: bossData.type,
        isActive: isActive // 判斷是不是活動Boss , 活動Boss = ID+100000
      };


      bossListData[index].deathList.push(newDeathEntry)


      // 假设要处理的 boss 在 bossListData 数组中的索引是 index
      let boss = bossListData[index];

      // 使用一个辅助对象来记录已经见过的 deathList 条目
      let seenDeaths = {};



      const bossCount = getBossCount(boss)
      // 過濾不符合格式的資料
      boss.deathList = boss.deathList.filter(item => item.hasOwnProperty('death') && item.hasOwnProperty('emblem'));

      // 过滤并去除重复的 deathList 条目
      boss.deathList = boss.deathList.filter(item => {
        let deathKey = item.death;
        // 如果 seenDeaths 中不存在這個 key，則添加並保留此條目
        if (!seenDeaths.hasOwnProperty(deathKey)) {
          seenDeaths[deathKey] = true;
          return true; // 保留此條目
        }
        return false; // 過濾掉重複的條目
      });

      // 將日期字串轉換為日期物件並進行排序
      boss.deathList = boss.deathList.sort(function (a, b) {
        var a_deathTime = new Date(a.death).getTime();
        var b_deathTime = new Date(b.death).getTime();
        return b_deathTime - a_deathTime;
      });
      // 只取維修後的資料
      boss.deathList = boss.deathList.filter(item => {
        return new Date(item.death) > config.rebootTime
      })

      // 在這裡處理 response，更新 bossListData，然後再呼叫 findLostBoss
      boss.result = findLostBoss(boss);
      boss.respawnCount = boss.result.rebornCount;

      // 自動將 boss 的 death 與 emblem 同步為 deathList 中最新的一筆
      syncBossLatestDeathAndEmblem(boss);

      // 當接收到的死亡紀錄為最新紀錄或死亡時間更新時觸發通告
      const isLatest = (boss.death === newDeathEntry.death);
      if (isLatest || item.death == "" || (new Date(item.death) <= new Date(newDeathEntry.death))) {
        bossListData[index].death = boss.death;
        bossListData[index].emblem = boss.emblem;
        if (bossData.type == 0 && trackBossNames.includes(item.bossName)) {
          //發出死亡通告（僅限追蹤清單中的 Boss）
          queueKillAnnouncement(item.bossName);
        }
        // 增加死亡訊息
        addMessage(bossData);

        // 單獨更新數據
        updateBossRemainingTime(parseInt(boss.id));
        // 使用在 Loa Boss Time.js 中定義的節流版 refresh 函數
        throttledRefresh();

        // 檢查是否觸發龍門
        tracker.checkBossData(bossData);
      } else {
        updateBossRemainingTime(parseInt(boss.id));
      }
    }
  });
}

function addMessage(bossData) {
  var now = new Date();
  var seconds = now.getSeconds().toString().padStart(2, '0');

  var labels = [];
  if (bossData.type == 1) labels.push("小隱龍");
  if (bossData.type == 2) labels.push("大隱龍");
  var category = getMessageCategory(bossData.id);
  if (category) labels.push("[" + category + "]");

  var message = bossData.death + ":" + seconds;
  if (labels.length > 0) {
    message += " " + labels.join(" ") + " ";
  }
  message += "【" + bossData.bossName + "】被 " + bossData.emblem + " 擊殺";
  config.messageList.push(message);
  drawMessage(message);
  showfloatingMessage(message);
}