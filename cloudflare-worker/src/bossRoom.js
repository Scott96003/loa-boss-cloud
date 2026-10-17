/**
 * BossRoom - Cloudflare Durable Object
 * 
 * 完整取代原本 Python FastAPI 的 ConnectionManager 與 WebRTC/WebSocket 伺服器功能。
 * 負責：
 * 1. 集中管理所有客戶端的 WebSocket 連線
 * 2. 處理 WebRTC 信令轉發 (Offer / Answer / ICE Candidate)
 * 3. 處理 Boss 擊殺全域廣播 (Boss_Death)；Sync_Boss_Data 只由伺服器發出
 * 4. 持久化最新 Boss 狀態 (即使發布者離線，新進來的玩家依然能立即取得最新資料)
 * 5. 提供 HTTP REST API 供外部直接查詢與注入 Boss 死亡資料
 */

import defaultBossList from "./defaultBossList.json";
import bossCategories from "./categories.json";

const P2P_SIGNALING_TYPES = new Set(['offer', 'answer', 'candidate', 'chat_message']);
const BROADCAST_MESSAGE_TYPES = new Set(['Boss_Death', 'Ack_Sync']);

function parseTaiwanDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  let str = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(str)) {
    return new Date(str.replace(" ", "T") + "+08:00");
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// Boss 分類設定 (categories.json)：button 為前端篩選按鈕，webhook 為輪迴刷新推播
// 新增分類或調整分類成員只需修改 categories.json
function getCategoryIds(name) {
  const category = bossCategories.find(c => c.name === name);
  if (!category) throw new Error(`categories.json 缺少「${name}」分類`);
  return category.ids;
}

// 魂塔長老另有擊殺即時推播與活動統計
const ELDER_BOSS_IDS = getCategoryIds("魂塔長老");
const WEBHOOK_CATEGORIES = bossCategories.filter(c => c.webhook);
// 所有有推播的分類 Boss，用來決定輪迴刷新的切換小時
const ALL_DC_CHECK_BOSS_IDS = [...new Set(WEBHOOK_CATEGORIES.flatMap(c => c.ids))];
// 前端篩選按鈕 (依 categories.json 順序)；showInMessage: false 的分類不作為擊殺訊息的類別
const BUTTON_CATEGORIES = bossCategories.filter(c => c.button).map(c => ({
  name: c.name,
  ids: c.ids,
  ...(c.showInMessage === false ? { showInMessage: false } : {})
}));

/**
 * 取得 Boss 在擊殺訊息顯示的類別：依 categories.json 順序第一個包含該 id 的按鈕分類
 */
function getMessageCategory(bossId) {
  const id = Number(bossId) % 100000;
  const category = BUTTON_CATEGORIES.find(c => c.showInMessage !== false && c.ids.includes(id));
  return category ? category.name : "";
}

/**
 * 組成擊殺訊息，例如「2026-10-17 09:54:00 [奧塔監視者] 【恐怖的吸血鬼】被 KenDelta 擊殺」
 * 沒有隱龍類型與類別時與舊格式相同
 */
function formatKillMessage({ death, type, bossId, bossName, emblem }) {
  const labels = [];
  if (type === 1) labels.push("小隱龍");
  if (type === 2) labels.push("大隱龍");
  const category = getMessageCategory(bossId);
  if (category) labels.push(`[${category}]`);
  const labelStr = labels.length > 0 ? ` ${labels.join(" ")} ` : "";
  return `${death}:00${labelStr}【${bossName}】被 ${emblem || "未知血盟"} 擊殺`;
}

// 龍門：擊殺任一隻龍後開啟 3 小時 (與前端 dragonGate.js 相同)
const DRAGON_GATE_BOSS_IDS = [91516, 91202, 91605];
const DRAGON_GATE_DURATION_MS = 3 * 60 * 60 * 1000;

// 設定計算輪迴的基礎時間 (台灣時間 2024-01-04 12:00:00)
const BASE_TIME = '2024-01-04T12:00:00+08:00';

/**
 * 取得指定 Date 在台灣時區 (UTC+8) 的小時 (0~23)
 */
function getTaiwanHours(date) {
  const d = parseTaiwanDate(date) || new Date(date);
  const twDate = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return twDate.getUTCHours();
}

/**
 * 根據時間和週期計算下一次出現的時間 (基準時間為 BASE_TIME)
 */
function getSpawnTime(currectTime, cycleHours) {
  const now = parseTaiwanDate(currectTime) || new Date();
  const baseDate = new Date(BASE_TIME);
  const timeDiffMs = now.getTime() - baseDate.getTime();
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
  const nextCycle = Math.ceil(timeDiffHours / cycleHours) * cycleHours;
  return new Date(baseDate.getTime() + nextCycle * 60 * 60 * 1000);
}

/**
 * 格式化時間區段字串 (如 12~19)
 */
function formatDateTime_Easy(date, date2) {
  const h1 = String(getTaiwanHours(date)).padStart(2, '0');
  const h2 = String(getTaiwanHours(date2)).padStart(2, '0');
  return `${h1}~${h2}`;
}

/**
 * 取得指定時間與週期對應的時間區段 (如 12~19)
 */
function getSpawnRange(currectTime, cycleHours) {
  const time2 = getSpawnTime(currectTime, cycleHours);
  const time1 = new Date(time2.getTime() - cycleHours * 60 * 60 * 1000);
  return formatDateTime_Easy(time1, time2);
}

/**
 * 取得 Boss 每一輪應有的擊殺需求次數 (數量)，由 defaultBossList.json 的 bossCount 欄位設定，預設 1
 */
function getBossCount(obj) {
  return Number(obj.bossCount) || 1;
}

/**
 * 是否為每輪數量不固定的 Boss (無法計算剩餘數量)
 */
function isUnfixedCount(obj) {
  return obj.countMode === "unfixed";
}

/**
 * 依據伺服器重開機時間計算 Boss 的存活數量 (findLostBoss)
 * 區段：從重開機後第一個重生時間起，每 respawnTime 小時一段，直到現在
 * 只回傳數量，不保留區段明細 (保留期 60 天時區段可達數千個，存檔與傳輸都不需要)
 */
function findLostBoss(bossData, rebootTimeInput, now = new Date()) {
  const bossDurationHour = parseFloat(bossData.respawnTime) || 1;
  const segmentDuration = bossDurationHour * 60 * 60 * 1000;
  const rebootTime = parseTaiwanDate(rebootTimeInput) || new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  const startMs = getSpawnTime(rebootTime, bossDurationHour).getTime();
  const nowMs = now.getTime();
  const segmentCount = startMs < nowMs ? Math.ceil((nowMs - startMs) / segmentDuration) : 0;
  const lastStart = startMs + (segmentCount - 1) * segmentDuration;
  const lastEnd = lastStart + segmentDuration;

  let dieCount = 0;
  let killedThisRound = 0;
  (bossData.deathList || []).forEach(dl => {
    const d = parseTaiwanDate(dl.death);
    if (!d) return;
    const t = d.getTime();
    if (t > rebootTime.getTime()) dieCount++;
    if (segmentCount > 0 && t >= lastStart && t < lastEnd) killedThisRound++;
  });

  // 數量不固定：無法推算剩餘數量，改統計本輪 (最新區段) 已擊殺數
  if (isUnfixedCount(bossData)) {
    return { rebornCount: 0, killedThisRound };
  }

  const bossCount = getBossCount(bossData);
  let aliveCount = (segmentCount * bossCount) - dieCount;
  if (aliveCount > 3) aliveCount = 3;
  if (aliveCount < 0) aliveCount = 0;

  return { rebornCount: aliveCount };
}

/**
 * 動態更新單一 Boss 的計算欄位 (重生間隔、result、respawnCount)
 */
function refreshBossComputedFields(boss, rebootTime, now = new Date()) {
  const cycleHours = parseFloat(boss.respawnTime) || 1;
  boss.重生間隔 = getSpawnRange(now, cycleHours);
  boss.result = findLostBoss(boss, rebootTime, now);
  boss.respawnCount = boss.result.rebornCount;
}

/**
 * 取得 Boss 在 deathList 中最新的一筆死亡紀錄物件
 */
function getLatestDeathRecord(bossData) {
  if (!bossData || !Array.isArray(bossData.deathList) || bossData.deathList.length === 0) {
    return null;
  }
  let latestItem = null;
  let latestDate = null;
  for (const item of bossData.deathList) {
    if (item && item.death && item.death !== "未知") {
      const d = parseTaiwanDate(item.death);
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
 * 自動將單一 Boss 的 death 與 emblem 同步為其 deathList 中最新的一筆
 */
function syncBossLatestDeathAndEmblem(bossData) {
  const latest = getLatestDeathRecord(bossData);
  if (latest) {
    const currentDeathDate = parseTaiwanDate(bossData.death);
    const latestDate = parseTaiwanDate(latest.death);
    // 若目前死亡時間為空、未知，或最新紀錄晚於等於當前死亡時間，同步之
    if (!currentDeathDate || (latestDate && latestDate.getTime() >= currentDeathDate.getTime())) {
      bossData.death = latest.death;
      if (latest.emblem !== undefined && latest.emblem !== null) {
        bossData.emblem = latest.emblem;
      }
    }
  }
}

/**
 * 固定時間比對字串，避免以回應時間推測密鑰
 */
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const bufA = enc.encode(String(a));
  const bufB = enc.encode(String(b));
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < bufB.length; i++) {
    diff |= (bufA[i] ?? 0) ^ bufB[i];
  }
  return diff === 0;
}

/**
 * 正規化 Boss 名稱 (去除空白、間隔號與「活動」前綴)，用於比對同一隻 Boss 的紀錄
 */
function normalizeKillBossName(name) {
  return String(name || '').replace(/[・．\s]/g, '').replace(/^活動/, '');
}

/**
 * 解析訊息區字串，例如「2026-10-17 03:59:00【恐怖的吸血鬼】被 度估酒鑒 擊殺」
 */
function parseKillMessage(msg) {
  const m = String(msg).match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?::\d{2})?.*?【(.+?)】被 (.*) 擊殺\s*$/);
  return m ? { death: m[1], bossName: m[2], emblem: m[3] } : null;
}


/**
 * 取得下一個整點 (+5 秒) 的時間戳記；台灣時區為 UTC+8，整點邊界與 UTC 相同
 */
function getNextHourBoundary(nowMs = Date.now()) {
  const HOUR_MS = 60 * 60 * 1000;
  return Math.floor(nowMs / HOUR_MS) * HOUR_MS + HOUR_MS + 5 * 1000;
}

/**
 * 以台灣時區、24 小時制格式化時間 (與前端龍門訊息格式相同)
 */
function formatTaiwanDateTime(date) {
  return new Date(date).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}

/**
 * 將毫秒時間差格式化為「X 天 HH:MM」(與前端 formatTimeDifference 相同)
 */
function formatTimeDifference(timeDiff) {
  const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
  return (days > 0 ? `${days} 天 ` : '') +
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * 產生 Discord 表格的單列資料 (含最新死亡時間與已死亡時間差)
 */
function buildDiscordTableRow(item, now, spawnTime, rebootTime) {
  const latest = getLatestDeathRecord(item);
  const currentDate = parseTaiwanDate(item.death);
  const latestDeath = latest && (!currentDate || parseTaiwanDate(latest.death) > currentDate)
    ? latest.death
    : item.death;
  const sinceDate = parseTaiwanDate(latestDeath) || parseTaiwanDate(rebootTime);
  const elapsed = sinceDate ? Math.max(0, now.getTime() - sinceDate.getTime()) : 0;
  return {
    count: isUnfixedCount(item)
      ? `已擊殺 ${(item.result && item.result.killedThisRound) || 0}`
      : (item.respawnCount !== undefined ? item.respawnCount : 0),
    name: item.bossName,
    spawnTime,
    guild: item.emblem === 'Il一雲門集團一II' ? '雲門' : (item.emblem || '未知'),
    death: latestDeath,
    elapsedMs: elapsed,
    已死亡: formatTimeDifference(elapsed)
  };
}

/**
 * 計算字串顯示寬度 (全形=2, 半形=1)
 */
function getDisplayWidth(str) {
  if (str === null || str === undefined) return 0;
  const text = String(str);
  const fullWidthRegex = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uff5a]/g;
  const fullWidthMatch = text.match(fullWidthRegex);
  const fullWidthCount = fullWidthMatch ? fullWidthMatch.length : 0;
  return fullWidthCount * 2 + (text.length - fullWidthCount);
}

/**
 * 將長字串依最大顯示寬度進行分行
 */
function wrapText(text, maxWidth) {
  const textStr = String(text);
  if (maxWidth <= 0 || getDisplayWidth(textStr) <= maxWidth) {
    return [textStr];
  }
  const lines = [];
  let currentLine = '';
  let currentWidth = 0;
  for (const char of textStr) {
    const charWidth = getDisplayWidth(char);
    if (currentWidth + charWidth > maxWidth) {
      if (currentWidth === 0 && charWidth > maxWidth) {
        lines.push(char);
        currentLine = '';
        currentWidth = 0;
        continue;
      }
      lines.push(currentLine);
      currentLine = char;
      currentWidth = charWidth;
    } else {
      currentLine += char;
      currentWidth += charWidth;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * 填充文字以符合欄寬對齊
 */
function padText(text, targetWidth, align = 'left') {
  const textStr = String(text);
  const currentWidth = getDisplayWidth(textStr);
  const paddingNeeded = targetWidth - currentWidth;
  if (paddingNeeded <= 0) return textStr;
  const padding = ' '.repeat(paddingNeeded);
  return align === 'right' ? padding + textStr : textStr + padding;
}

/**
 * 將 Boss 清單資料格式化為 Discord 引用區塊等寬表格
 */
function formatTableForDiscord(data, 顯示重生間隔 = true) {
  if (!data || data.length === 0) {
    return '沒有資料可顯示。';
  }

  const columns = [
    { key: 'count', header: '數量', align: 'right' },
    ...(顯示重生間隔 ? [{ key: 'spawnTime', header: '區段', align: 'left' }] : []),
    { key: 'name', header: '名稱', align: 'left', maxWidth: 12 },
    { key: 'guild', header: '血盟', align: 'left', maxWidth: 12 },
    { key: '已死亡', header: '已死亡', align: 'left' }
  ];

  const processedData = data.map(item => ({
    ...item,
    spawnTime: String(item.spawnTime || '').replace(/~/g, '-'),
    count: String(item.count || 0),
    name: String(item.name || ''),
    guild: String(item.guild || ''),
    已死亡: item.death && item.death !== "未知"
      ? (() => {
          const d = parseTaiwanDate(item.death);
          return d ? `<t:${Math.floor(d.getTime() / 1000)}:R>` : "未知";
        })()
      : "未知"
  }));

  const columnWidths = columns.map(col => getDisplayWidth(String(col.header)));

  processedData.forEach(item => {
    columns.forEach((col, i) => {
      const content = String(item[col.key]);
      let contentWidth = getDisplayWidth(content);
      if (col.maxWidth) {
        contentWidth = Math.min(contentWidth, col.maxWidth);
      }
      columnWidths[i] = Math.max(columnWidths[i], contentWidth);
    });
  });

  const formattedHeaders = columns
    .map((col, i) => padText(col.header, columnWidths[i], col.align))
    .join(' ');

  const separator = columnWidths
    .map(width => '='.repeat(Math.max(2, width)))
    .join(' ');

  const rowLines = [];
  processedData.forEach(item => {
    const columnLines = columns.map(col => {
      const content = String(item[col.key]);
      return col.maxWidth ? wrapText(content, col.maxWidth) : [content];
    });

    const maxLines = columnLines.reduce((max, lines) => Math.max(max, lines.length), 1);

    for (let i = 0; i < maxLines; i++) {
      const lineParts = columnLines.map((lines, j) => {
        const col = columns[j];
        const targetWidth = columnWidths[j];
        const cellContent = lines[i] || '';
        return padText(cellContent, targetWidth, col.align);
      });
      rowLines.push("> " + lineParts.join(' '));
    }
  });

  return `> ${formattedHeaders}\n> ${separator}\n${rowLines.join('\n')}`;
}

/**
 * 計算指定分類 Boss 的活動次數比例
 */
function calculateActiveStats(bossListData, ids) {
  const filtered = (bossListData || []).filter(item => ids.includes(Number(item.id) % 100000));
  const sum = filtered.reduce((acc, cur) => acc + (Array.isArray(cur.deathList) ? cur.deathList.length : 0), 0);
  const sumActive = filtered.reduce((acc, cur) => {
    const activeCount = (Array.isArray(cur.deathList) ? cur.deathList : []).reduce((a, v) => a + (v.isActive ? 1 : 0), 0);
    return acc + activeCount;
  }, 0);
  const pct = sum > 0 ? ((sumActive / sum) * 100).toFixed(2) : "0.00";
  return `${sumActive}/${sum}(${pct}%)`;
}

// 擊殺明細保留天數 (伺服器長期不重開時，剩餘數量需要重開後的完整擊殺紀錄)
const RETENTION_DAYS = 60;
// 訊息區最多保留的筆數 (由 deathList 產生，只影響顯示)
const MAX_MESSAGES = 10000;

// 存檔分開儲存，避免單一 key 超過 Durable Object 2 MB 上限：
// - STORAGE_META_KEY：mainData 去掉 deathList、訊息區與區段計算結果
// - STORAGE_DEATHS_PREFIX + id：每隻 Boss 的 deathList
// - LEGACY_STORAGE_KEY：舊版整份存檔，沒有 meta 時才讀取並搬移；搬移後保留不刪，
//   萬一 wrangler rollback 回舊版程式，仍可讀到搬移當下的資料
const STORAGE_META_KEY = "meta";
const STORAGE_DEATHS_PREFIX = "deaths:";
const LEGACY_STORAGE_KEY = "mainData";
const STORAGE_PUT_BATCH = 128;

/**
 * 由各 Boss 的 deathList 產生訊息區 (依時間排序，保留最新 MAX_MESSAGES 筆)
 */
function buildMessageList(bossListData) {
  const messages = new Set();
  (bossListData || []).forEach(b => {
    (b.deathList || []).forEach(dl => {
      if (!dl.death) return;
      messages.add(formatKillMessage({
        death: dl.death,
        type: dl.type,
        bossId: b.id,
        bossName: dl.bossName || b.bossName,
        emblem: dl.emblem
      }));
    });
  });
  return [...messages].sort((a, b) => a.slice(0, 16).localeCompare(b.slice(0, 16))).slice(-MAX_MESSAGES);
}

// 由 defaultBossList.json 維護的設定欄位，啟動時會同步到存檔 (死亡紀錄等執行期資料不受影響)
// areas：受限區域 (例如傲慢之塔各樓層)，discord-listener 在受限區域內只接受 areas 列有該區域的 Boss
const BOSS_DEFINITION_FIELDS = ["bossName", "respawnTime", "bossCount", "countMode", "areas"];

/**
 * 依 defaultBossList 同步存檔清單 (依 id 比對)
 * 1. 存檔沒有的 Boss 整筆補入
 * 2. 已存在的 Boss 同步設定欄位；JSON 拿掉的欄位也一併移除
 * 存檔有、但 defaultBossList 沒有的 Boss 保留不動
 * @returns {{ added: Array, updated: Array }}
 */
export function syncBossListWithDefaults(bossListData, defaults) {
  const savedById = new Map(bossListData.map(b => [String(b.id), b]));
  const added = [];
  const updated = [];
  defaults.forEach(def => {
    const saved = savedById.get(String(def.id));
    if (!saved) {
      const boss = structuredClone(def);
      bossListData.push(boss);
      added.push(boss);
      return;
    }
    let changed = false;
    BOSS_DEFINITION_FIELDS.forEach(field => {
      if (def[field] === undefined) {
        if (field in saved) {
          delete saved[field];
          changed = true;
        }
      } else if (JSON.stringify(saved[field]) !== JSON.stringify(def[field])) {
        saved[field] = structuredClone(def[field]);
        changed = true;
      }
    });
    if (changed) updated.push(saved);
  });
  return { added, updated };
}

export class BossRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;

    // 儲存活躍連線與用戶對應
    // WebSocket -> { userId: string, user: Object }
    this.sessions = new Map();
    // userId -> WebSocket
    this.userToWs = new Map();
    // userId -> { user: Object, sockets: Set<WebSocket> } (支援同帳號多分頁聚合管理)
    this.onlineUsers = new Map();

    // 核心狀態快取 (預設注入 62 隻 Boss 基礎資料)
    this.mainData = {
      status: "Online",
      users_online: 0,
      last_updated: new Date().toISOString(),
      bossListData: defaultBossList,
      config: {
        messageList: [],
        rebootTime: new Date().toISOString()
      },
      gateOpenTime: null,
      gateCloseTime: null,
      messageList: []
    };

    // 各 Boss deathList 上次寫入時的內容，用來判斷哪些 Boss 需要重新寫入
    this.savedDeathSignatures = new Map();

    // 初始化時從持久化儲存載入歷史資料
    this.state.blockConcurrencyWhile(async () => {
      await this.loadMainData();
      try {
        const currentAlarm = await this.storage.getAlarm();
        if (currentAlarm === null) {
          await this.storage.setAlarm(Date.now() + 30 * 1000);
        }
      } catch (err) {
        console.warn("[ALARM] 初始化 Alarm 失敗:", err);
      }
    });
  }

  /**
   * 從持久化儲存載入 mainData (分開儲存格式；尚未搬移時讀取舊版整份存檔並搬移)
   */
  async loadMainData() {
    let savedData = null;
    let fromLegacy = false;

    const meta = await this.storage.get(STORAGE_META_KEY);
    if (meta && Array.isArray(meta.bossListData)) {
      const deaths = await this.storage.list({ prefix: STORAGE_DEATHS_PREFIX });
      meta.bossListData.forEach(b => {
        const key = STORAGE_DEATHS_PREFIX + b.id;
        b.deathList = Array.isArray(deaths.get(key)) ? deaths.get(key) : [];
        this.savedDeathSignatures.set(String(b.id), JSON.stringify(b.deathList));
      });
      savedData = meta;
    } else {
      const legacy = await this.storage.get(LEGACY_STORAGE_KEY);
      if (legacy && Array.isArray(legacy.bossListData) && legacy.bossListData.length > 0) {
        savedData = legacy;
        fromLegacy = true;
      }
    }

    if (!savedData || savedData.bossListData.length === 0) return;
    this.mainData = { ...this.mainData, ...savedData };

    // 存檔會整份取代預設清單，需補入新增的 Boss 並同步設定欄位
    const { added, updated } = syncBossListWithDefaults(this.mainData.bossListData, defaultBossList);
    if (added.length > 0) {
      console.log(`[BOSS_LIST] 補入新 Boss ${added.length} 隻: ${added.map(b => `${b.bossName}(${b.id})`).join(", ")}`);
    }
    if (updated.length > 0) {
      console.log(`[BOSS_LIST] 同步 Boss 設定 ${updated.length} 隻: ${updated.map(b => `${b.bossName}(${b.id})`).join(", ")}`);
    }

    // 訊息區與數量都由 deathList 重新產生
    this.mainData.messageList = buildMessageList(this.mainData.bossListData);
    if (!this.mainData.config) this.mainData.config = {};
    this.mainData.config.messageList = this.mainData.messageList;
    const rebootTime = this.mainData.config.rebootTime;
    const now = new Date();
    this.mainData.bossListData.forEach(b => refreshBossComputedFields(b, rebootTime, now));

    if (fromLegacy || added.length > 0 || updated.length > 0) {
      await this.saveMainData();
    }
    if (fromLegacy) {
      console.log(`[STORAGE] 已將舊版整份存檔搬移為分開儲存 (${this.mainData.bossListData.length} 隻 Boss)，舊存檔保留供回滾使用`);
    }
  }

  /**
   * 寫入 mainData：meta 每次寫入，deathList 只寫入有變動的 Boss
   */
  async saveMainData() {
    const { bossListData = [], messageList, config, ...rest } = this.mainData;
    const { messageList: _configMessages, ...configWithoutMessages } = config || {};
    const entries = {
      [STORAGE_META_KEY]: {
        ...rest,
        config: configWithoutMessages,
        bossListData: bossListData.map(({ deathList, result, ...boss }) => boss)
      }
    };

    const changedSignatures = new Map();
    bossListData.forEach(b => {
      const deathList = Array.isArray(b.deathList) ? b.deathList : [];
      const signature = JSON.stringify(deathList);
      if (this.savedDeathSignatures.get(String(b.id)) !== signature) {
        entries[STORAGE_DEATHS_PREFIX + b.id] = deathList;
        changedSignatures.set(String(b.id), signature);
      }
    });

    const keys = Object.keys(entries);
    for (let i = 0; i < keys.length; i += STORAGE_PUT_BATCH) {
      const batch = {};
      keys.slice(i, i + STORAGE_PUT_BATCH).forEach(k => { batch[k] = entries[k]; });
      await this.storage.put(batch);
    }
    changedSignatures.forEach((signature, id) => this.savedDeathSignatures.set(id, signature));
  }

  /**
   * Cloudflare Durable Object Alarm 定時喚醒處理
   */
  async alarm() {
    try {
      await this.checkAndTriggerRespawnCycle();
    } catch (err) {
      console.error("[ALARM] 執行輪迴排程檢查失敗:", err);
    }
    try {
      await this.checkDragonGateClose();
    } catch (err) {
      console.error("[ALARM] 執行龍門關閉檢查失敗:", err);
    }
    await this.scheduleNextAlarm();
  }

  /**
   * 排程下一次 Alarm：每個整點檢查輪迴，龍門開啟中則提前於關閉時間喚醒
   */
  async scheduleNextAlarm() {
    let next = getNextHourBoundary();
    if (this.mainData.gateOpenTime && this.mainData.gateCloseTime) {
      const closeMs = new Date(this.mainData.gateCloseTime).getTime();
      if (!isNaN(closeMs)) {
        next = Math.min(next, Math.max(closeMs, Date.now() + 1000));
      }
    }
    try {
      await this.storage.setAlarm(next);
    } catch (e) {
      console.warn("[ALARM] 排程下一次 Alarm 失敗:", e);
    }
  }

  /**
   * 恢復 Durable Object 休眠喚醒後的 WebSocket Sessions
   */
  rehydrateSessions() {
    try {
      const sockets = this.state.getWebSockets();
      for (const ws of sockets) {
        if (!this.sessions.has(ws)) {
          const attachment = ws.deserializeAttachment ? ws.deserializeAttachment() : null;
          if (attachment) {
            const { userId, clientId, user } = attachment;
            this.sessions.set(ws, {
              userId: userId || null,
              clientId: clientId || null,
              user: user || null
            });
            if (clientId) {
              this.userToWs.set(clientId, ws);
            }
            if (user && userId) {
              if (!this.onlineUsers.has(userId)) {
                this.onlineUsers.set(userId, {
                  user: user,
                  sockets: new Set()
                });
              }
              this.onlineUsers.get(userId).sockets.add(ws);
            }
          } else {
            this.sessions.set(ws, { userId: null, clientId: null, user: null });
          }
        }
      }
    } catch (err) {
      console.error("[REHYDRATE] 恢復連線狀態失敗:", err);
    }
  }

  /**
   * 決定單一連線的在線狀態：優先採用客戶端回報的狀態，否則沿用此連線原本的狀態
   */
  resolvePresenceStatus(reported, userStatus, sessionStatus) {
    for (const s of [reported, userStatus, sessionStatus]) {
      if (s === "idle" || s === "online") return s;
    }
    return "online";
  }

  /**
   * 彙總同帳號多個連線的狀態：任一連線為 online 即視為 online，全部閒置才是 idle
   */
  aggregatePresenceStatus(sockets) {
    for (const s of sockets) {
      if (this.sessions.get(s)?.user?.status !== "idle") return "online";
    }
    return "idle";
  }

  /**
   * 取得已去重的在線使用者清單 (依 online/idle 狀態與名稱排序)
   */
  getOnlineUsersList() {
    // 確保休眠喚醒後自動恢復在線名單
    this.rehydrateSessions();

    const list = [];
    for (const [uid, record] of this.onlineUsers.entries()) {
      if (record.sockets && record.sockets.size > 0) {
        const u = record.user || {};
        const idStr = String(u.id || uid);
        const nameStr = String(u.displayName || u.username || "");

        // 嚴格過濾：只納入已登入且具備真實身分的 Discord 成員
        // 排除純信令 spoke ID (SPK_xxxx, HUB_xxxx, 或無明確身分的訪客)
        if (idStr.startsWith("SPK_") || idStr.startsWith("HUB_") || nameStr.startsWith("SPK_") || nameStr.startsWith("HUB_")) {
          continue;
        }

        list.push({
          id: idStr,
          username: u.username || "",
          global_name: u.global_name || "",
          nickname: u.nickname || null,
          displayName: u.displayName || u.nickname || u.global_name || u.username || "在線成員",
          avatar: u.avatar || null,
          status: this.aggregatePresenceStatus(record.sockets),
          connectionsCount: record.sockets.size,
        });
      }
    }

    list.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "online" ? -1 : 1;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    return list;
  }

  /**
   * 廣播最新在線使用者名單給所有連線
   */
  broadcastOnlineUsers() {
    const users = this.getOnlineUsersList();
    const payload = JSON.stringify({
      type: "online_users_update",
      count: users.length,
      users: users,
      timestamp: new Date().toISOString()
    });
    this.broadcast(payload);
  }

  /**
   * 從各 Boss 的 deathList 與訊息區刪除指定擊殺 (以 Boss 名稱、時間、血盟比對)
   * @param {Array<{bossName: string, death: string, emblem: string}>} records - 要刪除的擊殺
   * @param {boolean} dryRun - 為 true 時只回報會刪除的紀錄，不修改資料
   */
  removeKillRecords(records, dryRun = false) {
    const keyOf = (bossName, death, emblem) =>
      `${normalizeKillBossName(bossName)}|${String(death || '').trim().slice(0, 16)}|${String(emblem || '').trim()}`;
    const targets = new Set(records.map(r => keyOf(r.bossName, r.death, r.emblem)));

    const removedDeathList = [];
    (this.mainData.bossListData || []).forEach(boss => {
      if (!Array.isArray(boss.deathList)) return;
      const kept = boss.deathList.filter(dl => {
        const hit = targets.has(keyOf(dl.bossName || boss.bossName, dl.death, dl.emblem));
        if (hit) removedDeathList.push({ bossId: boss.id, death: dl.death, emblem: dl.emblem, bossName: dl.bossName || boss.bossName });
        return !hit;
      });
      if (dryRun || kept.length === boss.deathList.length) return;

      boss.deathList = kept;
      // 若目前顯示的最新死亡正是被刪除的紀錄，先清空再以剩餘紀錄重新同步
      if (targets.has(keyOf(boss.bossName, boss.death, boss.emblem))) {
        boss.death = "";
        boss.emblem = "";
      }
      syncBossLatestDeathAndEmblem(boss);
      refreshBossComputedFields(boss, this.mainData.config?.rebootTime, new Date());
    });

    const removedMessages = [];
    const keptMessages = (this.mainData.messageList || []).filter(msg => {
      const parsed = parseKillMessage(msg);
      const hit = parsed && targets.has(keyOf(parsed.bossName, parsed.death, parsed.emblem));
      if (hit) removedMessages.push(msg);
      return !hit;
    });
    if (!dryRun) {
      this.mainData.messageList = keptMessages;
      if (this.mainData.config) this.mainData.config.messageList = keptMessages;
    }

    return { removedDeathList, removedMessages };
  }

  /**
   * 清理過期資料：
   * 1. 刪除超過 RETENTION_DAYS 天前的資料 (即使重開機時間更久以前，也只保留 RETENTION_DAYS 天)
   * 2. 刪除早於伺服器重啟時間的資料
   * 3. 取兩者「較晚/較接近現在」的時間點作為截止時間 (cutoffDate)
   * 4. messageList 上限 MAX_MESSAGES 筆
   */
  cleanupOldData(now = new Date()) {
    const retentionStart = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const rebootDate = (this.mainData.config && this.mainData.config.rebootTime)
      ? parseTaiwanDate(this.mainData.config.rebootTime)
      : null;

    // cutoffDate: 重開機時間 與 RETENTION_DAYS 天前 兩者看哪個比較靠近現在 (即兩者取較晚者)
    let cutoffDate = retentionStart;
    if (rebootDate && rebootDate > retentionStart) {
      cutoffDate = rebootDate;
    }

    let clearedBossCount = 0;
    let clearedMsgCount = 0;

    // 1. 清理 messageList 中早於 cutoffDate 的紀錄，並限制最多 MAX_MESSAGES 筆
    if (Array.isArray(this.mainData.messageList)) {
      const origLen = this.mainData.messageList.length;
      this.mainData.messageList = this.mainData.messageList.filter(msg => {
        const timeMatch = msg.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?)/);
        if (timeMatch) {
          const msgTime = parseTaiwanDate(timeMatch[1]);
          return msgTime && msgTime >= cutoffDate;
        }
        return false;
      });
      if (this.mainData.messageList.length > MAX_MESSAGES) {
        this.mainData.messageList = this.mainData.messageList.slice(-MAX_MESSAGES);
      }
      clearedMsgCount = origLen - this.mainData.messageList.length;
    } else {
      this.mainData.messageList = [];
    }

    if (this.mainData.config) {
      this.mainData.config.messageList = this.mainData.messageList;
    }

    // 2. 清理各 Boss 的 deathList 與過期 death
    if (this.mainData.bossListData && Array.isArray(this.mainData.bossListData)) {
      this.mainData.bossListData.forEach(boss => {
        if (Array.isArray(boss.deathList)) {
          boss.deathList = boss.deathList.filter(entry => {
            const entryTime = parseTaiwanDate(entry.death);
            return entryTime && entryTime >= cutoffDate;
          });
        } else {
          boss.deathList = [];
        }

        if (boss.death && boss.death !== "未知") {
          const bossDeathTime = parseTaiwanDate(boss.death);
          if (!bossDeathTime || bossDeathTime < cutoffDate) {
            boss.death = "";
            boss.emblem = "";
            clearedBossCount++;
          }
        }

        // 同步並重新依據最新的截止時間/重開機時間矯正 Boss 的區段與存活數
        syncBossLatestDeathAndEmblem(boss);
        refreshBossComputedFields(boss, cutoffDate, now);
      });
    }

    return { cutoffDate, clearedBossCount, clearedMsgCount };
  }

  /**
   * 處理進入 Durable Object 的 HTTP 請求 (包含 WebSocket 升級與 REST API)
   */
  async fetch(request) {
    const url = new URL(request.url);

    // 1. 處理 WebSocket 升級連線 (/ws)
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // 使用 Cloudflare WebSocket Hibernation API 接受連線
      this.state.acceptWebSocket(server);
      this.sessions.set(server, { userId: null, user: null });
      this.updateUserCount();

      return new Response(null, { status: 101, webSocket: client });
    }

    // 2. 處理 REST API 請求
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API: 查詢伺服器與線上狀態
    if (url.pathname === "/api/status") {
      const onlineList = this.getOnlineUsersList();
      return Response.json({
        ...this.mainData,
        users_online: onlineList.length,
        online_users: onlineList,
        registered_users: Array.from(this.userToWs.keys())
      }, { headers: corsHeaders });
    }

    // API: 取得當前在線成員名單
    if (url.pathname === "/api/online-users" && request.method === "GET") {
      const onlineList = this.getOnlineUsersList();
      return Response.json({
        success: true,
        count: onlineList.length,
        users: onlineList,
        timestamp: new Date().toISOString()
      }, { headers: corsHeaders });
    }

    // API: 取得當前最新 Boss 資料
    if (url.pathname === "/api/boss-data") {
      const { cutoffDate } = this.cleanupOldData();

      // 1. 防呆補齊與校正：確保每隻有死亡時間的 Boss 其 deathList 都至少有該筆資料，且 death/emblem 與 deathList 最新紀錄保持一致
      if (this.mainData.bossListData && Array.isArray(this.mainData.bossListData)) {
        let hasModified = false;
        this.mainData.bossListData.forEach(b => {
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
            hasModified = true;
          }
          const prevDeath = b.death;
          const prevEmblem = b.emblem;
          syncBossLatestDeathAndEmblem(b);
          if (b.death !== prevDeath || b.emblem !== prevEmblem) {
            hasModified = true;
          }
        });
        if (hasModified) {
          this.mainData.last_updated = new Date().toISOString();
          await this.saveMainData();
        }
      }

      // 2. 自動匯總：將每隻 Boss 的 deathList 歷史與現有 messageList 結合，生成有效區間內的完整擊殺清單
      const fullMessageMap = new Map();
      // 同一筆擊殺 (時間+Boss+血盟) 以 deathList 產生的訊息為準，避免與舊格式 (無類別) 的訊息重複
      const killKey = (death, bossName, emblem) => `${death}|${bossName}|${emblem}`;
      const generatedKills = new Set();

      if (this.mainData.bossListData && Array.isArray(this.mainData.bossListData)) {
        this.mainData.bossListData.forEach(b => {
          if (Array.isArray(b.deathList)) {
            b.deathList.forEach(dl => {
              if (dl.death) {
                const dlDate = parseTaiwanDate(dl.death);
                if (dlDate && dlDate >= cutoffDate) {
                  const bossName = dl.bossName || b.bossName;
                  const emblem = dl.emblem || "未知血盟";
                  const itemStr = formatKillMessage({ death: dl.death, type: dl.type, bossId: b.id, bossName, emblem });
                  fullMessageMap.set(itemStr, itemStr);
                  generatedKills.add(killKey(dl.death, bossName, emblem));
                }
              }
            });
          }
        });
      }

      (this.mainData.messageList || []).forEach(msg => {
        const parsed = parseKillMessage(msg);
        if (parsed && generatedKills.has(killKey(parsed.death, parsed.bossName, parsed.emblem))) return;
        fullMessageMap.set(msg, msg);
      });

      // 依照時間排序並保留最多 MAX_MESSAGES 筆
      const sortedMessageList = Array.from(fullMessageMap.values()).sort((a, b) => {
        const ta = a.slice(0, 16);
        const tb = b.slice(0, 16);
        return ta.localeCompare(tb);
      }).slice(-MAX_MESSAGES);

      this.mainData.messageList = sortedMessageList;

      const configObj = this.mainData.config || {
        messageList: sortedMessageList,
        rebootTime: "2026-10-13T04:02:00.000Z"
      };
      configObj.messageList = sortedMessageList;

      return Response.json({
        bossListData: this.mainData.bossListData,
        config: configObj,
        gateOpenTime: this.mainData.gateOpenTime,
        gateCloseTime: this.mainData.gateCloseTime,
        messageList: sortedMessageList,
        categories: BUTTON_CATEGORIES,
        last_updated: this.mainData.last_updated
      }, { headers: corsHeaders });
    }

    // API: 外部發送 Boss 死亡通知 (供外部 Bot / 爬蟲直接 POST 觸發)
    if (url.pathname === "/api/boss-death" && request.method === "POST") {
      try {
        const body = await request.json();
        const deathInfo = body.deathInfo || body;
        const result = await this.processBossDeath(deathInfo);
        return Response.json(result, {
          status: result.success ? 200 : 400,
          headers: corsHeaders
        });
      } catch (err) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    // API: 伺服器重啟通知 (將重啟時間之前的擊殺全數刪除、更新重啟時間並全域廣播)
    if (url.pathname === "/api/server-reboot" && request.method === "POST") {
      try {
        const body = await request.json();
        const rebootTimeStr = body.rebootTime || new Date().toISOString();
        const rebootDate = parseTaiwanDate(rebootTimeStr) || new Date();
        const reason = body.message || "伺服器重啟完成，滅光戒指數值已更新。";

        console.log(`[SERVER_REBOOT] 執行伺服器重啟作業，刪除早於此時間點的擊殺: ${rebootDate.toISOString()}`);

        // 1. 更新 config.rebootTime
        if (!this.mainData.config) {
          this.mainData.config = {};
        }
        this.mainData.config.rebootTime = rebootDate.toISOString();

        // 2. 執行過期與重啟前資料清理 (保留 RETENTION_DAYS 天內且晚於重開機時間)
        const { cutoffDate, clearedBossCount } = this.cleanupOldData();

        this.mainData.last_updated = new Date().toISOString();
        await this.saveMainData();

        // 4. 廣播給所有在線前端進行即時同步
        const rebootBroadcast = {
          type: "Server_Reboot",
          rebootTime: rebootDate.toISOString(),
          message: reason,
          bossListData: this.mainData.bossListData,
          config: this.mainData.config,
          timestamp: new Date().toISOString()
        };
        this.broadcast(JSON.stringify(rebootBroadcast));

        // 同步推送 Sync_Boss_Data
        const syncBroadcast = {
          type: "Sync_Boss_Data",
          bossListData: this.mainData.bossListData,
          config: this.mainData.config,
          gateOpenTime: this.mainData.gateOpenTime,
          gateCloseTime: this.mainData.gateCloseTime,
          serverCached: true
        };
        this.broadcast(JSON.stringify(syncBroadcast));

        return Response.json({
          success: true,
          message: `伺服器重啟完成，已刪除早於 ${rebootDate.toISOString()} 的 ${clearedBossCount} 隻 Boss 歷史擊殺`,
          rebootTime: rebootDate.toISOString(),
          clearedBossCount
        }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    // API: 管理用，刪除指定的錯誤擊殺紀錄 (需 ADMIN_API_KEY；body.dryRun 為 true 時只回報不寫入)
    if (url.pathname === "/api/admin/remove-kills" && request.method === "POST") {
      if (!this.env.ADMIN_API_KEY) {
        return Response.json({ success: false, error: "未設定 ADMIN_API_KEY，管理 API 停用" }, { status: 503, headers: corsHeaders });
      }
      const authHeader = request.headers.get("Authorization") || "";
      if (!timingSafeEqual(authHeader, `Bearer ${this.env.ADMIN_API_KEY}`)) {
        return Response.json({ success: false, error: "未授權" }, { status: 401, headers: corsHeaders });
      }

      try {
        const body = await request.json();
        if (!Array.isArray(body.records) || body.records.length === 0) {
          return Response.json({ success: false, error: "records 必須為非空陣列" }, { status: 400, headers: corsHeaders });
        }
        const result = this.removeKillRecords(body.records, Boolean(body.dryRun));

        if (!body.dryRun && (result.removedDeathList.length > 0 || result.removedMessages.length > 0)) {
          this.mainData.last_updated = new Date().toISOString();
          await this.saveMainData();
          this.broadcast(JSON.stringify({
            type: "Sync_Boss_Data",
            bossListData: this.mainData.bossListData,
            config: this.mainData.config,
            gateOpenTime: this.mainData.gateOpenTime,
            gateCloseTime: this.mainData.gateCloseTime,
            serverCached: true
          }));
        }

        console.log(`[ADMIN] remove-kills${body.dryRun ? " (dry-run)" : ""}: deathList ${result.removedDeathList.length} 筆、訊息 ${result.removedMessages.length} 筆`);
        return Response.json({ success: true, dryRun: Boolean(body.dryRun), ...result }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }

  /**
   * WebSocket 接收到訊息的事件回調 (Hibernation API)
   */
  async webSocketMessage(ws, message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      console.warn("[WS] 收到非 JSON 格式訊息:", message);
      return;
    }

    // 確保當前連線狀態已初始化或從 Attachment 恢復
    if (!this.sessions.has(ws)) {
      this.rehydrateSessions();
    }
    const currentSession = this.sessions.get(ws) || { userId: null, clientId: null, user: null };
    if (!this.sessions.has(ws)) {
      this.sessions.set(ws, currentSession);
    }

    const messageType = data.type;
    const senderId = data.senderId;
    const targetId = data.targetId;

    // 1. 客戶端註冊與在線狀態同步 (client_register / user_presence)
    if (messageType === 'client_register' || messageType === 'user_presence') {
      const user = data.user || null;
      const hasRealUser = user && user.id && !String(user.id).startsWith("SPK_") && !String(user.id).startsWith("HUB_");
      const effectiveId = hasRealUser ? String(user.id) : (senderId || `guest_${Math.random().toString(36).slice(2, 8)}`);

      if (senderId) {
        currentSession.userId = effectiveId;
        currentSession.clientId = senderId;
        this.userToWs.set(senderId, ws);
      }

      let userInfo = null;

      // 如果有真實 Discord 使用者資料，才列入在線成員追蹤
      if (hasRealUser) {
        userInfo = {
          id: effectiveId,
          username: user.username || "成員",
          global_name: user.global_name || "",
          nickname: user.nickname || null,
          displayName: user.displayName || user.nickname || user.global_name || user.username || "在線成員",
          avatar: user.avatar || null,
          status: this.resolvePresenceStatus(data.status, user.status, currentSession.user?.status),
        };
        currentSession.user = userInfo;

        // 保存狀態至 Cloudflare WebSocket Hibernation Attachment (休眠後仍可恢復)
        if (ws.serializeAttachment) {
          try {
            ws.serializeAttachment({
              clientId: senderId,
              userId: effectiveId,
              user: userInfo
            });
          } catch (e) {
            console.warn("無法序列化 WebSocket 附件:", e);
          }
        }

        // 聚合進 onlineUsers (支援同帳號開多個分頁)
        if (!this.onlineUsers.has(effectiveId)) {
          this.onlineUsers.set(effectiveId, {
            user: userInfo,
            sockets: new Set()
          });
        }
        const record = this.onlineUsers.get(effectiveId);
        record.sockets.add(ws);
        record.user = { ...record.user, ...userInfo };

        this.updateUserCount();
        console.log(`[REGISTER] Discord 成員 '${effectiveId}' (${userInfo.displayName}) 成功加入在線清單。`);

        // 廣播最新在線使用者名單給所有連線
        this.broadcastOnlineUsers();

        // 立即向發起註冊的連線本身回傳最新完整名單，避免客戶端因時序或覆蓋問題看不到他人
        try {
          const currentMembers = this.getOnlineUsersList();
          ws.send(JSON.stringify({
            type: "online_users_update",
            count: currentMembers.length,
            users: currentMembers,
            timestamp: new Date().toISOString()
          }));
        } catch {}
      } else {
        // 未登入的連線只作為信令通訊客戶端，不列入在線名單
        currentSession.user = null;
        if (ws.serializeAttachment) {
          try {
            ws.serializeAttachment({
              clientId: senderId,
              userId: null,
              user: null
            });
          } catch {}
        }
        console.log(`[REGISTER] 訪客/信令端點 '${senderId}' 已連線 (未登入，不列入在線成員清單)。`);
      }

      // 原本的 WebRTC / Sync 邏輯保留：
      if (messageType === 'client_register') {
        // 廣播有新用戶加入
        this.broadcast(JSON.stringify({
          type: "user_joined",
          senderId: "server",
          newUserId: senderId,
          user: userInfo
        }), ws);

        // 如果伺服器已經有儲存的最新 Boss 資料，主動推送給該新註冊用戶
        if (this.mainData.bossListData) {
          const syncMsg = {
            type: 'Sync_Boss_Data',
            bossListData: this.mainData.bossListData,
            config: this.mainData.config || {
              messageList: this.mainData.messageList || [],
              rebootTime: new Date().toISOString()
            },
            gateOpenTime: this.mainData.gateOpenTime,
            gateCloseTime: this.mainData.gateCloseTime,
            serverCached: true
          };
          ws.send(JSON.stringify(syncMsg));
        }
      }
      return;
    }

    // 2. 心跳檢測 (ping) - 具備自癒登入狀態能力
    if (messageType === 'ping') {
      if (data.user && (!currentSession || !currentSession.user)) {
        const u = data.user;
        const hasRealUser = u && u.id && !String(u.id).startsWith("SPK_") && !String(u.id).startsWith("HUB_");
        if (hasRealUser) {
          const effectiveId = String(u.id);
          const userInfo = {
            id: effectiveId,
            username: u.username || "成員",
            global_name: u.global_name || "",
            nickname: u.nickname || null,
            displayName: u.displayName || u.nickname || u.global_name || u.username || "在線成員",
            avatar: u.avatar || null,
            status: this.resolvePresenceStatus(data.status, u.status),
          };
          currentSession.user = userInfo;
          currentSession.userId = effectiveId;
          currentSession.clientId = senderId;
          if (senderId) this.userToWs.set(senderId, ws);
          if (!this.onlineUsers.has(effectiveId)) {
            this.onlineUsers.set(effectiveId, { user: userInfo, sockets: new Set() });
          }
          this.onlineUsers.get(effectiveId).sockets.add(ws);
          if (ws.serializeAttachment) {
            try {
              ws.serializeAttachment({ clientId: senderId, userId: effectiveId, user: userInfo });
            } catch {}
          }
          this.broadcastOnlineUsers();
        }
      }

      ws.send(JSON.stringify({
        type: "pong",
        senderId: "server",
        targetId: senderId
      }));
      return;
    }

    // 3. 更新在線狀態 (online / idle)
    if (messageType === 'update_presence' || messageType === 'update_status') {
      const status = data.status === 'idle' ? 'idle' : 'online';
      if (currentSession && currentSession.userId && this.onlineUsers.has(currentSession.userId)) {
        const record = this.onlineUsers.get(currentSession.userId);
        record.user.status = status;
        if (currentSession.user) {
          currentSession.user.status = status;
        }
        if (ws.serializeAttachment) {
          try {
            ws.serializeAttachment({
              clientId: currentSession.clientId,
              userId: currentSession.userId,
              user: currentSession.user
            });
          } catch {}
        }
        this.broadcastOnlineUsers();
      }
      return;
    }

    // 4. 請求在線使用者名單 (request_online_users)
    if (messageType === 'request_online_users') {
      const users = Array.from(this.userToWs.keys());
      const members = this.getOnlineUsersList();
      ws.send(JSON.stringify({
        type: "online_users_list",
        users: users,
        members: members,
        senderId: "server"
      }));
      return;
    }

    // 4. WebRTC P2P 信令轉發 (offer / answer / candidate / chat_message)
    if (P2P_SIGNALING_TYPES.has(messageType)) {
      if (!targetId) {
        console.warn(`[SIGNAL] 信令 ${messageType} 缺少 targetId`);
        return;
      }
      const targetWs = this.userToWs.get(targetId);
      if (targetWs) {
        targetWs.send(JSON.stringify(data));
      } else {
        console.warn(`[SIGNAL] 目標用戶 '${targetId}' 不在線或未註冊`);
      }
      return;
    }

    // 客戶端不得送出全量同步：Boss 清單由伺服器維護，避免舊版網頁整份覆蓋新 Boss
    if (messageType === 'Sync_Boss_Data') {
      console.warn('[WS_REJECT] 忽略客戶端送來的 Sync_Boss_Data');
      return;
    }

    // 5. 業務資料廣播 (Boss_Death / Ack_Sync)
    if (BROADCAST_MESSAGE_TYPES.has(messageType)) {
      // 若收到 Boss_Death，透過 processBossDeath 統一處理狀態更新、長老 Webhook 推播與廣播
      if (messageType === 'Boss_Death') {
        const deathInfo = data.deathInfo || data;
        await this.processBossDeath(deathInfo, ws);
        return;
      }

      // 廣播給所有連線 (除自身外)
      this.broadcast(JSON.stringify(data), ws);
      console.log(`[BCAST] 廣播訊息: ${messageType}`);
      return;
    }

    console.warn(`[WS_UNKNOWN] 收到未知的訊息類型: ${messageType}`);
  }

  /**
   * WebSocket 斷線事件
   */
  async webSocketClose(ws, code, reason, wasClean) {
    // 休眠喚醒後記憶體為空，先從 Attachment 還原，才能正確移除此連線
    if (!this.sessions.has(ws)) {
      this.rehydrateSessions();
    }
    const session = this.sessions.get(ws);
    if (session) {
      // 同一分頁重連時會沿用 clientId；只有對應仍指向此連線時才移除，避免刪掉新連線
      if (session.clientId && this.userToWs.get(session.clientId) === ws) {
        this.userToWs.delete(session.clientId);
      }
      if (session.userId && this.onlineUsers.has(session.userId)) {
        const record = this.onlineUsers.get(session.userId);
        record.sockets.delete(ws);
        if (record.sockets.size === 0) {
          this.onlineUsers.delete(session.userId);
          console.log(`[DISCONNECT] 用戶 '${session.userId}' 離線。`);
        }
      }
    }
    this.sessions.delete(ws);
    this.updateUserCount();
    this.broadcastOnlineUsers();
  }

  /**
   * WebSocket 異常事件
   */
  async webSocketError(ws, error) {
    ws.close(1011, "WebSocket 內部錯誤");
    this.webSocketClose(ws);
  }

  /**
   * 輔助函式：取得所有活躍的連線
   */
  getConnectedSockets() {
    return this.state.getWebSockets();
  }

  /**
   * 廣播訊息給所有或指定排除以外的 WebSocket 連線
   */
  broadcast(message, excludeWs = null) {
    for (const ws of this.getConnectedSockets()) {
      if (ws !== excludeWs) {
        try {
          ws.send(message);
        } catch {
          // 若發送失敗，由 Hibernation 系統或 close 事件進行回收
        }
      }
    }
  }

  /**
   * 更新線上人數計數
   */
  updateUserCount() {
    const uniqueCount = this.onlineUsers ? this.onlineUsers.size : 0;
    this.mainData.users_online = uniqueCount > 0 ? uniqueCount : this.getConnectedSockets().length;
    this.mainData.last_updated = new Date().toISOString();
  }

  /**
   * 發送魂塔長老專屬的 Discord Webhook 通知
   */
  async sendElderDiscordWebhook(deathInfo, matchedBoss) {
    const webhookUrl = this.env.DISCORD_WEBHOOK_ELDER;
    if (!webhookUrl) {
      console.log("ℹ️ [WEBHOOK] 未設定 DISCORD_WEBHOOK_ELDER 環境變數，略過長老 Webhook 推送。");
      return;
    }

    try {
      const isActive = Number(deathInfo.id) > 100000 || Boolean(deathInfo.isActive);
      const bossName = (matchedBoss && matchedBoss.bossName) || deathInfo.bossName || "長老";
      const emblem = (matchedBoss && matchedBoss.emblem) || deathInfo.emblem || "未知血盟";
      const deathTime = deathInfo.death || "";

      // 1. 擊殺標題
      const titleMsg = `***[${isActive ? '活動 ' : ''}${bossName}] 被 ${emblem} 擊殺 ${deathTime}***\n`;

      const rebootTime = (this.mainData.config && this.mainData.config.rebootTime)
        ? this.mainData.config.rebootTime
        : new Date(Date.now() - 7 * 24 * 3600 * 1000);

      const now = new Date();

      // 2. 匯總長老分類下的 8 隻 Boss 現狀，並即時動態重新計算各長老的最新區段與存活數量
      const elderBosses = (this.mainData.bossListData || [])
        .filter(item => ELDER_BOSS_IDS.includes(Number(item.id) % 100000));

      elderBosses.forEach(boss => {
        refreshBossComputedFields(boss, rebootTime, now);
      });

      // 排序：剩餘數量多者優先，數量相同時距離上次死亡最久者優先
      const elderData = elderBosses
        .map(item => buildDiscordTableRow(item, now, item.重生間隔 || getSpawnRange(now, 7), rebootTime))
        .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0) || b.elapsedMs - a.elapsedMs);

      // 3. 格式化等寬表格與活動統計字串
      const tableMsg = formatTableForDiscord(elderData, true);
      const activeMsg = `\n> 活動出現次數: ${calculateActiveStats(this.mainData.bossListData, ELDER_BOSS_IDS)}`;
      const fullContent = titleMsg + tableMsg + activeMsg;

      // 4. 發送至 Discord Webhook
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: fullContent,
          username: "魂塔長老監控"
        })
      });

      if (response.ok) {
        console.log(`✅ [WEBHOOK] 魂塔長老擊殺推播已發送至 Discord！(Boss: ${bossName})`);
      } else {
        const errorText = await response.text();
        console.error(`❌ [WEBHOOK] 發送失敗 (HTTP ${response.status}): ${errorText}`);
      }
    } catch (err) {
      console.error("❌ [WEBHOOK] 連線異常:", err.message);
    }
  }

  /**
   * 統一處理 Boss 死亡事件 (支援外部 REST API 與 WebSocket 來源)
   */
  async processBossDeath(deathInfo, sourceWs = null) {
    // 每次處理擊殺時，自動維護並清理超過 RETENTION_DAYS 天或早於重啟時間的舊資料
    const { cutoffDate } = this.cleanupOldData();
    const killDate = parseTaiwanDate(deathInfo.death);

    if (killDate && killDate < cutoffDate) {
      console.log(`[過濾舊擊殺] 擊殺時間 ${deathInfo.death} 早於有效保留時間 ${cutoffDate.toISOString()}`);
      return {
        success: false,
        message: `擊殺時間早於有效保留時間 (${cutoffDate.toISOString()})，已略過`
      };
    }

    const broadcastMsg = {
      type: "Boss_Death",
      deathInfo: deathInfo,
      timestamp: new Date().toISOString()
    };

    let matchedBoss = null;

    // 1. 同步更新記憶體與持久化狀態中的 Boss 死亡資料與 deathList
    if (this.mainData.bossListData && Array.isArray(this.mainData.bossListData)) {
      const normalizeName = (name) => String(name || '').replace(/[・．\s]/g, '').replace(/^活動/, '');
      const dNameNorm = normalizeName(deathInfo.bossName);

      const dId = Number(deathInfo.id);

      // 有 id 時只用 id 比對 (含活動版 +100000)，避免同名不同 id 的 Boss 被誤判為同一隻
      // (例如傲慢之塔 46271 與 30 樓 45606 皆名為「恐怖的吸血鬼」)；沒有 id 時才退回名稱比對
      matchedBoss = this.mainData.bossListData.find(b => {
        const bId = Number(b.id);
        if (dId) {
          return bId === dId || bId + 100000 === dId;
        }
        const bNameNorm = normalizeName(b.bossName);
        return b.bossName === deathInfo.bossName ||
               (`活動${b.bossName}` === deathInfo.bossName) ||
               (bNameNorm && dNameNorm && bNameNorm === dNameNorm);
      });

      // 不在 Boss 清單上的擊殺整筆略過：不寫入 deathList / 訊息區，也不廣播與推送 Webhook
      if (!matchedBoss) {
        console.log(`[略過未列管 Boss] ${deathInfo.bossName} (${deathInfo.id}) 不在 Boss 清單上`);
        return {
          success: false,
          message: "Boss 不在清單上，已略過",
          ignored: true
        };
      }

      if (matchedBoss) {
        if (!matchedBoss.deathList || !Array.isArray(matchedBoss.deathList)) {
          matchedBoss.deathList = [];
        }
        const deathEntry = {
          death: deathInfo.death,
          bossName: deathInfo.bossName,
          emblem: deathInfo.emblem || "",
          type: deathInfo.type || 0,
          isActive: Boolean(deathInfo.isActive || Number(deathInfo.id) > 100000)
        };
        const alreadyExists = matchedBoss.deathList.some(
          item => item.death === deathEntry.death && (item.emblem || '') === (deathEntry.emblem || '')
        );
        if (alreadyExists && matchedBoss.death === deathEntry.death) {
          console.log(`[略過重複擊殺] Boss ${deathInfo.bossName} 於 ${deathInfo.death} (${deathInfo.emblem}) 已記錄，略過重複推播與廣播。`);
          return {
            success: true,
            message: "擊殺紀錄已存在，略過重複廣播",
            duplicate: true
          };
        }
        if (!matchedBoss.deathList.some(item => item.death === deathEntry.death)) {
          matchedBoss.deathList.push(deathEntry);
        }
        matchedBoss.deathList.sort((a, b) => new Date(a.death) - new Date(b.death));
        syncBossLatestDeathAndEmblem(matchedBoss);
        refreshBossComputedFields(matchedBoss, this.mainData.config?.rebootTime, new Date());
      }

      // 2. 自動維護最新 MAX_MESSAGES 筆擊殺紀錄訊息 (供前端顯示)
      if (!this.mainData.messageList) this.mainData.messageList = [];
      const msgItem = formatKillMessage({
        death: deathInfo.death,
        type: deathInfo.type,
        bossId: matchedBoss ? matchedBoss.id : deathInfo.id,
        bossName: deathInfo.bossName,
        emblem: deathInfo.emblem
      });

      if (!this.mainData.messageList.includes(msgItem)) {
        this.mainData.messageList.push(msgItem);
      }
      if (this.mainData.messageList.length > MAX_MESSAGES) {
        this.mainData.messageList = this.mainData.messageList.slice(-MAX_MESSAGES);
      }

      if (!this.mainData.config) {
        this.mainData.config = {
          messageList: this.mainData.messageList,
          rebootTime: new Date().toISOString()
        };
      } else {
        this.mainData.config.messageList = this.mainData.messageList;
      }

      this.mainData.last_updated = new Date().toISOString();
      await this.saveMainData();
    }

    // 3. 廣播給所有線上的 WebSocket 用戶端 (若由某前端發送，排除該發送端)
    this.broadcast(JSON.stringify(broadcastMsg), sourceWs);

    // 4. 判斷是否為「魂塔長老」分類，若是則推送專屬 Discord Webhook
    const bossIdNum = Number(deathInfo.id || (matchedBoss && matchedBoss.id)) % 100000;
    const isElder = ELDER_BOSS_IDS.includes(bossIdNum) || (deathInfo.bossName && deathInfo.bossName.includes("長老"));

    if (isElder) {
      console.log(`🎯 [長老擊殺] 觸發魂塔長老 Discord Webhook 推播 (${deathInfo.bossName || bossIdNum})...`);
      this.sendElderDiscordWebhook(deathInfo, matchedBoss);
    }

    // 5. 擊殺龍時開啟新的龍門週期並推送龍門 Webhook
    if (DRAGON_GATE_BOSS_IDS.includes(bossIdNum) && killDate) {
      await this.processDragonGateKill(killDate);
    }

    return {
      success: true,
      message: "Boss 死亡訊息已推播至所有在線用戶端",
      broadcastMsg
    };
  }

  /**
   * 擊殺龍後開啟新的龍門週期 (龍門開啟期間的擊殺不重複開啟)
   */
  async processDragonGateKill(killDate) {
    const prevClose = this.mainData.gateCloseTime ? new Date(this.mainData.gateCloseTime) : null;
    if (prevClose && !isNaN(prevClose.getTime()) && killDate < prevClose) {
      console.log(`[龍門] 擊殺時間 ${killDate.toISOString()} 仍在上一個龍門週期內，略過。`);
      return;
    }

    const openTime = killDate;
    const closeTime = new Date(openTime.getTime() + DRAGON_GATE_DURATION_MS);
    const now = new Date();
    // 過晚收到的擊殺：龍門其實已關閉，只記錄週期、不推送通知
    const stillOpen = closeTime > now;

    this.mainData.gateOpenTime = stillOpen ? openTime.toISOString() : null;
    this.mainData.gateCloseTime = closeTime.toISOString();
    await this.saveMainData();

    if (!stillOpen) {
      console.log(`[龍門] 擊殺時間過舊，龍門已於 ${closeTime.toISOString()} 關閉，略過開啟通知。`);
      return;
    }

    const minutesToClose = Math.ceil((closeTime.getTime() - now.getTime()) / 60000);
    const content = [
      "🚨 龍門開啟中 🚨",
      `開啟時間: ${formatTaiwanDateTime(openTime)}`,
      `關閉時間: ${formatTaiwanDateTime(closeTime)}`,
      `剩餘時間: 約 ${minutesToClose} 分鐘  <t:${Math.floor(closeTime.getTime() / 1000)}:R>`
    ].join("\n");
    await this.sendDragonGateWebhook(content);
    await this.scheduleNextAlarm();
  }

  /**
   * 龍門關閉時間已到則推送關閉通知 (由 Alarm 呼叫)
   */
  async checkDragonGateClose() {
    if (!this.mainData.gateOpenTime || !this.mainData.gateCloseTime) return;
    const closeTime = new Date(this.mainData.gateCloseTime);
    if (isNaN(closeTime.getTime()) || closeTime > new Date()) return;

    this.mainData.gateOpenTime = null;
    await this.saveMainData();
    await this.sendDragonGateWebhook(`⚠️ 龍門已關閉。\n關閉時間: ${formatTaiwanDateTime(closeTime)}`);
  }

  /**
   * 發送龍門 Discord Webhook 通知
   */
  async sendDragonGateWebhook(content) {
    const webhookUrl = this.env.DISCORD_WEBHOOK_DRAGON;
    if (!webhookUrl) {
      console.log("ℹ️ [WEBHOOK] 未設定 DISCORD_WEBHOOK_DRAGON 環境變數，略過龍門 Webhook 推送。");
      return;
    }
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, username: "龍門監控" })
      });
      if (response.ok) {
        console.log("✅ [WEBHOOK] 龍門通知已發送至 Discord！");
      } else {
        console.error(`❌ [WEBHOOK] 龍門通知發送失敗 (HTTP ${response.status}): ${await response.text()}`);
      }
    } catch (err) {
      console.error("❌ [WEBHOOK] 龍門通知連線異常:", err.message);
    }
  }

  /**
   * 檢查並觸發「重生輪迴時間刷新」Webhook
   */
  async checkAndTriggerRespawnCycle() {
    const now = new Date();
    const twHours = getTaiwanHours(now);
    const twMinutes = new Date(now.getTime() + 8 * 60 * 60 * 1000).getUTCMinutes();

    if (!this.mainData.bossListData || this.mainData.bossListData.length === 0) {
      return { triggered: false, reason: "no_data" };
    }

    // 1. 找出所有監控 Boss 的重生結束小時 (去重並排序)
    const allTargetHours = [...new Set(
      this.mainData.bossListData
        .filter(item => ALL_DC_CHECK_BOSS_IDS.includes(Number(item.id)))
        .map(item => {
          const range = item.重生間隔 || getSpawnRange(now, parseFloat(item.respawnTime) || 1);
          return parseInt(range.split('~')[1], 10);
        })
        .filter(h => !isNaN(h))
    )].sort((a, b) => a - b);

    if (allTargetHours.length === 0) {
      return { triggered: false, reason: "no_target_hours" };
    }

    // 2. 決定下一個應切換的小時
    const nextHourToday = allTargetHours.find(h => h >= twHours);
    const newRange = nextHourToday !== undefined ? nextHourToday : allTargetHours[0];

    const lastRefresh = this.mainData.config ? this.mainData.config.lastRefreshBossTime : null;

    // 若第一次啟動且無 lastRefreshBossTime，先對齊當前輪迴小時
    if (lastRefresh === undefined || lastRefresh === null) {
      if (!this.mainData.config) this.mainData.config = {};
      this.mainData.config.lastRefreshBossTime = newRange;
      await this.saveMainData();
      return { triggered: false, initialized: true, newRange };
    }

    // 3. 判斷輪迴小時是否發生切換
    // 舊資料可能由前端 localStorage 寫入字串，統一轉成數字比較
    if (newRange !== Number(lastRefresh)) {
      console.log(`[RESPAWN_CYCLE] 觸發重生輪迴時間切換: ${lastRefresh} -> ${newRange} (台灣時間 ${twHours}:${twMinutes})`);

      if (!this.mainData.config) this.mainData.config = {};
      this.mainData.config.lastRefreshBossTime = newRange;

      // 更新所有 Boss 計算欄位
      const rebootTime = (this.mainData.config && this.mainData.config.rebootTime)
        ? this.mainData.config.rebootTime
        : new Date(Date.now() - 7 * 24 * 3600 * 1000);

      this.mainData.bossListData.forEach(b => {
        refreshBossComputedFields(b, rebootTime, now);
      });

      // 4. 定義推播分類映射 (Webhook URL 一律由 wrangler secret 提供)
      const bossReportMap = WEBHOOK_CATEGORIES.map(c => ({
        name: c.webhook.label || c.name,
        checkList: c.ids,
        webhookUrl: this.env[c.webhook.secret]
      }));

      const titleMsg = "*** 重生輪迴時間刷新 ***\n";

      for (const { name, checkList, webhookUrl } of bossReportMap) {
        if (!webhookUrl) {
          console.warn(`⚠️ [WEBHOOK] 未設定「${name}」分類的 Webhook secret，略過輪迴刷新推播。`);
          continue;
        }

        let bosses = this.mainData.bossListData.filter(item => checkList.includes(Number(item.id)));
        if (bosses.length === 0) continue;

        bosses.sort((a, b) => {
          const aStart = parseInt(String(a.重生間隔 || '').split('~')[0], 10) || 0;
          const bStart = parseInt(String(b.重生間隔 || '').split('~')[0], 10) || 0;
          return Math.abs(aStart - newRange) - Math.abs(bStart - newRange);
        });

        const firstStart = parseInt(String(bosses[0].重生間隔 || '').split('~')[0], 10);
        if (firstStart === newRange) {
          await this.sendRespawnCycleWebhook(webhookUrl, titleMsg, checkList, now, name);
        }
      }

      // 廣播給所有連線中的前端網頁
      const syncBroadcast = {
        type: "Sync_Boss_Data",
        bossListData: this.mainData.bossListData,
        config: this.mainData.config,
        gateOpenTime: this.mainData.gateOpenTime,
        gateCloseTime: this.mainData.gateCloseTime,
        senderId: "server"
      };
      this.broadcast(JSON.stringify(syncBroadcast));
      await this.saveMainData();

      return { triggered: true, newRange };
    }

    return { triggered: false, currentRange: lastRefresh, newRange };
  }

  /**
   * 發送重生輪迴時間刷新的 Webhook 通知
   */
  async sendRespawnCycleWebhook(webhookUrl, titleMsg, checkList, now = new Date(), categoryName = "") {
    try {
      const rebootTime = this.mainData.config ? this.mainData.config.rebootTime : null;
      const bosses = (this.mainData.bossListData || [])
        .filter(item => checkList.includes(Number(item.id)));

      const tableData = bosses.map(item =>
        buildDiscordTableRow(item, now, item.重生間隔 || getSpawnRange(now, parseFloat(item.respawnTime) || 1), rebootTime)
      );

      const tableMsg = formatTableForDiscord(tableData, true);
      const activeMsg = `\n> 活動出現次數: ${calculateActiveStats(this.mainData.bossListData, checkList)}`;
      const fullContent = titleMsg + tableMsg + activeMsg;

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: fullContent,
          username: `LOA Boss 輪迴監控 [${categoryName}]`
        })
      });

      if (!response.ok) {
        console.error(`❌ [WEBHOOK] 輪迴刷新 Webhook (${categoryName}) 發送失敗: HTTP ${response.status}`);
      } else {
        console.log(`✅ [WEBHOOK] 輪迴刷新 Webhook (${categoryName}) 發送成功！`);
      }
    } catch (err) {
      console.error(`❌ [WEBHOOK] 輪迴刷新 Webhook (${categoryName}) 異常:`, err);
    }
  }
}
