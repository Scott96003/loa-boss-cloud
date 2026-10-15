// =========================================================
// 手機版死亡歷史紀錄：底部抽屜（Bottom Sheet）
// 桌機版請見 dashboard.js 的 showTooltip（滑鼠移入顯示）
// =========================================================

// 是否應使用底部抽屜（窄螢幕或沒有滑鼠 hover 的裝置）
function useDeathHistorySheet() {
  return window.matchMedia("(max-width: 600px), (hover: none)").matches;
}

function escapeHtml_dh(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// "YYYY-MM-DD HH:mm:ss" 在舊版 Safari 無法直接 new Date，先轉成 ISO 格式
function parseDeathTime_dh(value) {
  if (value instanceof Date) return value;
  var d = new Date(String(value || "").replace(" ", "T"));
  return isNaN(d.getTime()) ? new Date(value) : d;
}

function pad2_dh(n) {
  return n.toString().padStart(2, "0");
}

function dayLabel_dh(date) {
  var today = new Date();
  var yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  var week = ["日", "一", "二", "三", "四", "五", "六"];
  var label = (date.getMonth() + 1) + "/" + date.getDate();
  if (date.toDateString() === today.toDateString()) return label + "（今天）";
  if (date.toDateString() === yesterday.toDateString()) return label + "（昨天）";
  return label + "（" + week[date.getDay()] + "）";
}

// 依重生週期切出時間區段（與桌機 tooltip 相同的邏輯），由新到舊排序
function buildDeathSegments_dh(data) {
  const bossDurationHour = parseFloat(data.respawnTime) || 1;
  const segmentDuration = bossDurationHour * 60 * 60 * 1000;

  let earliestDate = (config && config.rebootTime) ? new Date(config.rebootTime) : null;
  const validDates = data.deathList
    .map(d => parseDeathTime_dh(d.death))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => a - b);
  if (validDates.length > 0 && (!earliestDate || validDates[0] < earliestDate)) {
    earliestDate = validDates[0];
  }
  const baseStart = earliestDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const startPoint = getSpawnTime(baseStart, bossDurationHour).getTime() - segmentDuration;

  const segments = [];
  let currentSegmentStart = new Date(startPoint);
  const currentTime = new Date();
  while (currentSegmentStart < currentTime) {
    const segmentEnd = new Date(currentSegmentStart.getTime() + segmentDuration);
    const matchingTimes = data.deathList
      .filter(dl => {
        const d = parseDeathTime_dh(dl.death);
        return d >= currentSegmentStart && d < segmentEnd;
      })
      .sort((a, b) => parseDeathTime_dh(b.death) - parseDeathTime_dh(a.death));
    segments.push({ start: currentSegmentStart, end: segmentEnd, deathList: matchingTimes });
    currentSegmentStart = segmentEnd;
  }

  segments.sort((a, b) => b.start - a.start);
  return segments.splice(0, 100);
}

function rebootRowHtml_dh(rebootTimeObj) {
  return "<div class='dh-reboot'><span>維修重開 " +
    (rebootTimeObj.getMonth() + 1) + "/" + rebootTimeObj.getDate() + " " +
    pad2_dh(rebootTimeObj.getHours()) + ":" + pad2_dh(rebootTimeObj.getMinutes()) +
    "</span></div>";
}

function buildDeathHistoryHtml_dh(data) {
  if (data.deathList.length === 0) {
    return "<div class='dh-empty'>尚無可顯示的死亡紀錄</div>";
  }

  const segments = buildDeathSegments_dh(data);
  const rebootTimeObj = (config && config.rebootTime) ? new Date(config.rebootTime) : new Date(0);

  let html = "";
  let currentDay = "";
  let shownAny = false;

  segments.forEach(function (segment) {
    const hasRecords = segment.deathList.length > 0;
    // 只要有擊殺紀錄，或者在維護時間之後，就顯示該區段
    if (!hasRecords && rebootTimeObj >= segment.end) return;
    shownAny = true;

    const dayKey = segment.start.toDateString();
    if (dayKey !== currentDay) {
      if (currentDay) html += "</section>";
      html += "<section class='dh-day'><h4 class='dh-day-title'>" + dayLabel_dh(segment.start) + "</h4>";
      currentDay = dayKey;
    }

    let needReboot = (rebootTimeObj >= segment.start && rebootTimeObj < segment.end);

    html += "<div class='dh-seg" + (hasRecords ? "" : " dh-seg-empty") + "'>";
    html += "<div class='dh-seg-time'>" + formatDateTime_Easy(segment.start, segment.end) + "</div>";
    html += "<div class='dh-seg-list'>";

    if (hasRecords) {
      segment.deathList.forEach(function (deathTime) {
        const d = parseDeathTime_dh(deathTime.death);
        if (needReboot && d < rebootTimeObj) {
          html += rebootRowHtml_dh(rebootTimeObj);
          needReboot = false;
        }
        let timeText = escapeHtml_dh(deathTime.death);
        if (!isNaN(d.getTime())) {
          timeText = pad2_dh(d.getHours()) + ":" + pad2_dh(d.getMinutes()) + ":" + pad2_dh(d.getSeconds());
          // 區段跨日時，標出實際日期
          if (d.toDateString() !== dayKey) {
            timeText = "<span class='dh-date'>" + (d.getMonth() + 1) + "/" + d.getDate() + "</span>" + timeText;
          }
        }
        html += "<div class='dh-entry" + (deathTime.isActive ? " dh-active" : "") + "'>";
        html += "<span class='dh-time'>" + timeText + "</span>";
        if (deathTime.emblem) {
          html += "<span class='dh-emblem'>" + escapeHtml_dh(deathTime.emblem) + "</span>";
        }
        if ([1, 2].includes(deathTime.type || 0)) {
          html += "<span class='dh-boss'>" + escapeHtml_dh(deathTime.bossName || "") + "</span>";
        }
        if (deathTime.isActive) {
          html += "<span class='dh-badge'>目前</span>";
        }
        html += "</div>";
      });
    } else {
      html += "<div class='dh-none'>未記錄</div>";
    }

    if (needReboot) {
      html += rebootRowHtml_dh(rebootTimeObj);
    }
    html += "</div></div>";
  });

  if (currentDay) html += "</section>";

  if (!shownAny) {
    // 若因時間過濾皆未顯示，直接列出最新記錄防呆
    html += "<section class='dh-day'>";
    data.deathList.slice(-5).reverse().forEach(function (dl) {
      html += "<div class='dh-entry'><span class='dh-time'>" + escapeHtml_dh(dl.death) + "</span>" +
        "<span class='dh-emblem'>" + escapeHtml_dh(dl.emblem || "") + "</span></div>";
    });
    html += "</section>";
  }
  return html;
}

// 顯示手機版死亡歷史抽屜（沿用舊函式名稱，dashboard.js 由此呼叫）
function showFullScreenView(event, data) {
  if (document.querySelector(".dh-root")) return;

  // 防呆：若 deathList 不存在或為空，但有 death 欄位，自動補入一筆
  if (!data.deathList || !Array.isArray(data.deathList)) {
    data.deathList = [];
  }
  if (data.deathList.length === 0 && data.death && data.death !== "未知" && String(data.death).trim() !== "") {
    data.deathList.push({
      death: data.death,
      emblem: data.emblem || "",
      bossName: data.bossName,
      type: data.type || 0,
      isActive: false
    });
  }

  const root = document.createElement("div");
  root.className = "dh-root";
  root.innerHTML =
    "<div class='dh-backdrop'></div>" +
    "<div class='dh-sheet' role='dialog' aria-modal='true' aria-label='" + escapeHtml_dh(data.bossName) + " 死亡紀錄'>" +
      "<div class='dh-grab'>" +
        "<div class='dh-handle'></div>" +
        "<div class='dh-header'>" +
          "<div class='dh-heading'>" +
            "<div class='dh-title'>" + escapeHtml_dh(data.bossName) + "</div>" +
            "<div class='dh-sub'>每 " + escapeHtml_dh(data.respawnTime) + "h 重生 · 共 " + data.deathList.length + " 筆紀錄</div>" +
          "</div>" +
          "<button class='dh-close' aria-label='關閉'>✕</button>" +
        "</div>" +
      "</div>" +
      "<div class='dh-body'>" + buildDeathHistoryHtml_dh(data) + "</div>" +
    "</div>";

  document.body.appendChild(root);
  const sheet = root.querySelector(".dh-sheet");
  const grab = root.querySelector(".dh-grab");
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  // 下一個 frame 再加 class，觸發滑入動畫
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { root.classList.add("dh-open"); });
  });

  let closed = false;
  function teardown() {
    if (closed) return;
    closed = true;
    window.removeEventListener("popstate", onPopState);
    document.removeEventListener("keydown", onKeyDown);
    document.body.style.overflow = prevOverflow;
    root.classList.remove("dh-open");
    sheet.style.transform = "";
    setTimeout(function () { root.remove(); }, 250);
  }

  // 手機的返回鍵／返回手勢只關閉抽屜，不離開頁面
  history.pushState({ deathHistorySheet: true }, "");
  function onPopState() { teardown(); }
  window.addEventListener("popstate", onPopState);

  function close() {
    if (closed) return;
    // 透過 history.back() 消掉剛才 push 的紀錄，popstate 會再呼叫 teardown
    if (history.state && history.state.deathHistorySheet) {
      history.back();
    } else {
      teardown();
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKeyDown);

  root.querySelector(".dh-backdrop").addEventListener("click", close);
  root.querySelector(".dh-close").addEventListener("click", close);

  // 拖曳標頭往下滑可關閉
  let startY = 0;
  let startTime = 0;
  let dragY = 0;
  let dragging = false;
  grab.addEventListener("touchstart", function (e) {
    if (e.target.closest(".dh-close")) return;
    dragging = true;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    dragY = 0;
    sheet.classList.add("dh-dragging");
  }, { passive: true });
  grab.addEventListener("touchmove", function (e) {
    if (!dragging) return;
    dragY = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = "translateY(" + dragY + "px)";
  }, { passive: true });
  grab.addEventListener("touchend", function () {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove("dh-dragging");
    const velocity = dragY / Math.max(1, Date.now() - startTime);
    if (dragY > 120 || velocity > 0.6) {
      close();
    } else {
      sheet.style.transform = "";
    }
  });
}
