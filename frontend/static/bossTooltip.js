// 顯示手機全螢幕內容的函數
function showFullScreenView(event, data) {
  // 1. 建立全螢幕 Modal 容器
  var fullScreenModal = document.createElement("div");
  // 使用特殊的 class 名稱來應用全螢幕樣式
  fullScreenModal.className = "full-screen-modal"; 

  // 2. 建立標頭（包含返回按鈕）
  var header = document.createElement("div");
  header.className = "modal-header";

  // 3. 建立返回按鈕
  var backButton = document.createElement("button");
  backButton.className = "modal-back-button";
  backButton.innerHTML = "返回"; // 或者使用 '<' 符號，視您的設計而定
  
  // 點擊返回按鈕時，移除整個 Modal
  backButton.onclick = function() {
    fullScreenModal.remove();
  };

  // 4. 建立內容區域
  var contentArea = document.createElement("div");
  contentArea.className = "modal-content";
  
  // 將您原本計算和生成的內容放入 contentArea
  
  var msg = "";

  const bossDurationHour = data.respawnTime;
  const segmentDuration = bossDurationHour * 60 * 60 * 1000; // 每個區段的持續時間（5小時，轉換為毫秒）
  if (data.deathList.length == 0) {
    // 即使沒有資料，也顯示 Modal，只是內容區域是空的或顯示提示
    msg += "<div>沒有可顯示的死亡紀錄。</div>"; 
    // 不 return; 繼續執行後面的步驟以顯示空 Modal 讓使用者可以按返回
    // 您可以根據需求決定這裡是否要直接 return; 
  } else {
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

    // 生成區段直到當前時間
    const currentTime = new Date();
    while (currentSegmentStart < currentTime) {
        const segmentEnd = new Date(currentSegmentStart.getTime() + segmentDuration);
        let matchingTimes = data.deathList.filter(dl => new Date(dl.death) >= currentSegmentStart &&  new Date(dl.death) < segmentEnd);
        segments.push({ start: currentSegmentStart, end: segmentEnd, deathList: matchingTimes});

        currentSegmentStart = segmentEnd; // 更新為下一個區段的開始時間
    }

    segments.sort((a,b) => b.start - a.start);

    const 需要顯示的 = segments.splice(0, 100);

    msg += "<table>";
    需要顯示的.forEach(function(segment) {
      // 只顯示到維修的資料
      if (config.rebootTime < segment.end) {
        var needReboot = (config.rebootTime >= segment.start &&  config.rebootTime < segment.end)

        msg += "<tr>";
        // 使用更適合手機畫面的時間格式，這裡保留您的原函數 (formatDateTime_Easy)
        msg += "<td style='vertical-align: top;'>" + segment.start.getDate() + "(" + formatDateTime_Easy(segment.start, segment.end) + ")</td>";
        msg += "<td>";
        segment.deathList.forEach(function(deathTime) {
          if (needReboot == true) {
            if (new Date(deathTime.death) < config.rebootTime) {
              msg += "<div style='color: yellow;'>重新開機" + config.rebootTime+ "</div>";
              needReboot = false
            }
          }
          if (deathTime.isActive) {
            msg += "<div style='color: red;'>";
          } else {
            msg += "<div>";
          }
          msg += deathTime.death;

          msg += deathTime.emblem;
          if ([1,2].includes(deathTime.type || 0)) {
            msg += " " + (deathTime.bossName || "null");
          }
          msg += "</div>";  
          
        })
        //如果紀錄都刷完,還沒顯示
        if (needReboot == true) {
          msg += "<div style='color: yellow;'>重新開機" +config.rebootTime+"</div>";
        }
        msg += "</td>";
        msg += "</tr>"
      }
    })
    msg += "</table>";
  }
  // 將生成的內容放入內容區域
  contentArea.innerHTML = msg;

  // 5. 組合元素：Header 放入 Modal，Button 放入 Header，內容放入 Modal
  header.appendChild(backButton);
  // 您可以在 Header 裡新增標題，例如：
  var title = document.createElement("span");
  title.className = "modal-title";
  title.textContent = data.bossName + "的死亡紀錄";
  header.appendChild(title);
  
  fullScreenModal.appendChild(header);
  fullScreenModal.appendChild(contentArea);
  
  // 6. 將 Modal 放入 body
  document.body.appendChild(fullScreenModal);
}