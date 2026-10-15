/**
 * BossRoom - Cloudflare Durable Object
 * 
 * 完整取代原本 Python FastAPI 的 ConnectionManager 與 WebRTC/WebSocket 伺服器功能。
 * 負責：
 * 1. 集中管理所有客戶端的 WebSocket 連線
 * 2. 處理 WebRTC 信令轉發 (Offer / Answer / ICE Candidate)
 * 3. 處理 Boss 擊殺與同步資料全域廣播 (Sync_Boss_Data, Boss_Death)
 * 4. 持久化最新 Boss 狀態 (即使發布者離線，新進來的玩家依然能立即取得最新資料)
 * 5. 提供 HTTP REST API 供外部直接查詢與注入 Boss 死亡資料
 */

import defaultBossList from "./defaultBossList.json";

const P2P_SIGNALING_TYPES = new Set(['offer', 'answer', 'candidate', 'chat_message']);
const BROADCAST_MESSAGE_TYPES = new Set(['Sync_Boss_Data', 'Boss_Death', 'Ack_Sync']);

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

// 魂塔長老分類之所有 Boss ID (共 8 隻)
const ELDER_BOSS_IDS = [45955, 45956, 45957, 45958, 45959, 45960, 45961, 45962];

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
 * 取得 Boss 每一輪應有的擊殺需求次數 (數量)
 */
function getBossCount(obj) {
  let needBossCount = 1;
  const idStr = String(obj.id);
  if (idStr === "45545") needBossCount = 2;
  if (idStr === "45640" || idStr === "45516") needBossCount = 3;
  if (idStr === "46220") needBossCount = 4;
  return needBossCount;
}

/**
 * 依據伺服器重開機時間計算 Boss 的時間區段與存活數量 (findLostBoss)
 */
function findLostBoss(bossData, rebootTimeInput, now = new Date()) {
  const bossDurationHour = parseFloat(bossData.respawnTime) || 1;
  const segmentDuration = bossDurationHour * 60 * 60 * 1000;
  const rebootTime = parseTaiwanDate(rebootTimeInput) || new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  const startPoint = getSpawnTime(rebootTime, bossDurationHour);
  const segments = [];
  let currentSegmentStart = new Date(startPoint);

  while (currentSegmentStart < now) {
    const segmentEnd = new Date(currentSegmentStart.getTime() + segmentDuration);
    const segmentTimes = (bossData.deathList || []).filter(dl => {
      const d = parseTaiwanDate(dl.death);
      return d && d >= currentSegmentStart && d < segmentEnd;
    });
    segments.push({ start: currentSegmentStart, end: segmentEnd, deathList: segmentTimes });
    currentSegmentStart = segmentEnd;
  }

  const matchingTimes = (bossData.deathList || []).filter(dl => {
    const d = parseTaiwanDate(dl.death);
    return d && d > rebootTime;
  });

  segments.sort((a, b) => b.start.getTime() - a.start.getTime());

  const dieCount = matchingTimes.length;
  const bossCount = getBossCount(bossData);
  let aliveCount = (segments.length * bossCount) - dieCount;
  if (aliveCount > 3) aliveCount = 3;
  if (aliveCount < 0) aliveCount = 0;

  return { rebornCount: aliveCount, segments };
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

    // 初始化時從持久化儲存載入歷史資料
    this.state.blockConcurrencyWhile(async () => {
      const savedData = await this.storage.get("mainData");
      if (savedData && savedData.bossListData && savedData.bossListData.length > 0) {
        this.mainData = { ...this.mainData, ...savedData };
      }
    });
  }

  /**
   * 取得已去重的在線使用者清單 (依 online/idle 狀態與名稱排序)
   */
  getOnlineUsersList() {
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
          status: u.status || "online",
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
   * 清理過期資料：
   * 1. 刪除超過 7 天前的資料 (即使重開機時間更久以前，也只保留 7 天)
   * 2. 刪除早於伺服器重啟時間的資料
   * 3. 取兩者「較晚/較接近現在」的時間點作為截止時間 (cutoffDate)
   * 4. messageList 上限放寬至 10,000 筆
   */
  cleanupOldData(now = new Date()) {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const rebootDate = (this.mainData.config && this.mainData.config.rebootTime)
      ? parseTaiwanDate(this.mainData.config.rebootTime)
      : null;

    // cutoffDate: 重開機時間 與 7天前 兩者看哪個比較靠近現在 (即兩者取較晚者)
    let cutoffDate = sevenDaysAgo;
    if (rebootDate && rebootDate > sevenDaysAgo) {
      cutoffDate = rebootDate;
    }

    let clearedBossCount = 0;
    let clearedMsgCount = 0;

    // 1. 清理 messageList 中早於 cutoffDate 的紀錄，並限制最多 10,000 筆
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
      if (this.mainData.messageList.length > 10000) {
        this.mainData.messageList = this.mainData.messageList.slice(-10000);
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

        // 重新依據最新的截止時間/重開機時間矯正 Boss 的區段與存活數
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

      // 1. 防呆補齊：確保每隻有死亡時間的 Boss 其 deathList 都至少有該筆資料
      if (this.mainData.bossListData && Array.isArray(this.mainData.bossListData)) {
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
          }
        });
      }

      // 2. 自動匯總：將每隻 Boss 的 deathList 歷史與現有 messageList 結合，生成有效區間內的完整擊殺清單
      const fullMessageMap = new Map();
      (this.mainData.messageList || []).forEach(msg => {
        fullMessageMap.set(msg, msg);
      });

      if (this.mainData.bossListData && Array.isArray(this.mainData.bossListData)) {
        this.mainData.bossListData.forEach(b => {
          if (Array.isArray(b.deathList)) {
            b.deathList.forEach(dl => {
              if (dl.death) {
                const dlDate = parseTaiwanDate(dl.death);
                if (dlDate && dlDate >= cutoffDate) {
                  let typeLabel = "";
                  if (dl.type === 1) typeLabel = " 小隱龍 ";
                  if (dl.type === 2) typeLabel = " 大隱龍 ";
                  const itemStr = `${dl.death}:00${typeLabel}【${dl.bossName || b.bossName}】被 ${dl.emblem || "未知血盟"} 擊殺`;
                  fullMessageMap.set(itemStr, itemStr);
                }
              }
            });
          }
        });
      }

      // 依照時間排序並保留最多 10,000 筆
      const sortedMessageList = Array.from(fullMessageMap.values()).sort((a, b) => {
        const ta = a.slice(0, 16);
        const tb = b.slice(0, 16);
        return ta.localeCompare(tb);
      }).slice(-10000);

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

        // 2. 執行過期與重啟前資料清理 (保留 7 天內且晚於重開機時間)
        const { cutoffDate, clearedBossCount } = this.cleanupOldData();

        this.mainData.last_updated = new Date().toISOString();
        await this.storage.put("mainData", this.mainData);

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
          message: `伺服器重啟完成，已刪除早於 ${rebootDate.toISOString()} 的 ${clearedCount} 隻 Boss 歷史擊殺`,
          rebootTime: rebootDate.toISOString(),
          clearedBossCount: clearedCount
        }, { headers: corsHeaders });
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

    const messageType = data.type;
    const senderId = data.senderId;
    const targetId = data.targetId;
    const currentSession = this.sessions.get(ws);

    // 1. 客戶端註冊 (client_register)
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
          status: user.status || "online",
        };
        currentSession.user = userInfo;

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

    // 2. 心跳檢測 (ping)
    if (messageType === 'ping') {
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

    // 5. 業務資料廣播 (Sync_Boss_Data / Boss_Death / Ack_Sync)
    if (BROADCAST_MESSAGE_TYPES.has(messageType)) {
      // 若收到全量同步資料，將其持久化保存
      if (messageType === 'Sync_Boss_Data') {
        this.mainData.bossListData = data.bossListData;
        this.mainData.config = data.config;
        this.mainData.gateOpenTime = data.gateOpenTime;
        this.mainData.gateCloseTime = data.gateCloseTime;
        this.mainData.last_updated = new Date().toISOString();
        // 寫入 Durable Object Storage
        this.storage.put("mainData", this.mainData);
        this.broadcast(JSON.stringify(data), ws);
        return;
      }

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
    const session = this.sessions.get(ws);
    if (session) {
      if (session.clientId) {
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

      // 排序：被擊殺的長老置頂於清單第一筆，其餘長老按 ELDER_BOSS_IDS 順序排列
      const killedBossId = Number(deathInfo.id) % 100000;
      const sortedElders = [];

      const killedElder = elderBosses.find(b => Number(b.id) % 100000 === killedBossId);
      if (killedElder) {
        sortedElders.push(killedElder);
      }

      ELDER_BOSS_IDS.forEach(id => {
        if (id !== killedBossId) {
          const elder = elderBosses.find(b => Number(b.id) % 100000 === id);
          if (elder) {
            sortedElders.push(elder);
          }
        }
      });

      const elderData = sortedElders.map(item => ({
        count: item.respawnCount !== undefined ? item.respawnCount : 0,
        name: item.bossName,
        spawnTime: item.重生間隔 || getSpawnRange(now, 7),
        guild: item.emblem === 'Il一雲門集團一II' ? '雲門' : (item.emblem || '未知'),
        death: item.death
      }));

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
    // 每次處理擊殺時，自動維護並清理超過 7 天或早於重啟時間的舊資料
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
      matchedBoss = this.mainData.bossListData.find(b => {
        const bId = Number(b.id);
        const dId = Number(deathInfo.id);
        return String(b.id) === String(deathInfo.id) ||
               (bId && dId && bId + 100000 === dId) ||
               b.bossName === deathInfo.bossName ||
               (`活動${b.bossName}` === deathInfo.bossName);
      });

      if (matchedBoss) {
        matchedBoss.death = deathInfo.death;
        if (deathInfo.emblem) matchedBoss.emblem = deathInfo.emblem;

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
        if (!matchedBoss.deathList.some(item => item.death === deathEntry.death)) {
          matchedBoss.deathList.push(deathEntry);
        }
        matchedBoss.deathList.sort((a, b) => new Date(a.death) - new Date(b.death));
        refreshBossComputedFields(matchedBoss, this.mainData.config?.rebootTime, new Date());
      }

      // 2. 自動維護最新 10,000 筆擊殺紀錄訊息 (供前端顯示)
      if (!this.mainData.messageList) this.mainData.messageList = [];
      let typeLabel = "";
      if (deathInfo.type === 1) typeLabel = " 小隱龍 ";
      if (deathInfo.type === 2) typeLabel = " 大隱龍 ";
      const msgItem = `${deathInfo.death}:00${typeLabel}【${deathInfo.bossName}】被 ${deathInfo.emblem || "未知血盟"} 擊殺`;

      if (!this.mainData.messageList.includes(msgItem)) {
        this.mainData.messageList.push(msgItem);
      }
      if (this.mainData.messageList.length > 10000) {
        this.mainData.messageList = this.mainData.messageList.slice(-10000);
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
      await this.storage.put("mainData", this.mainData);
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

    return {
      success: true,
      message: "Boss 死亡訊息已推播至所有在線用戶端",
      broadcastMsg
    };
  }
}
