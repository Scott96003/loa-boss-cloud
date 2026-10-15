/**
 * Discord Gateway 即時監聽器 (User Token 版)
 * 
 * 作用：完全取代原本本機 Chrome 擴充套件 (content.js)
 * 1. 透過 Discord Gateway WebSocket 7x24 小時監聽目標頻道
 * 2. 收到 Boss 擊殺 Embed 後，即時解析資料並進行規則過濾 (shouldSkipBoss)
 * 3. 透過 HTTP POST 推送到 Cloudflare Worker (/api/boss-death)，秒級廣播給所有玩家
 */

import WebSocket from "ws";
import dotenv from "dotenv";
import http from "http";
import https from "https";

dotenv.config();

const DISCORD_USER_TOKEN = process.env.DISCORD_USER_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID || "1527172467016335493";
const REBOOT_CHANNEL_ID = process.env.REBOOT_CHANNEL_ID || "1527158850648543385";
const REBOOT_KEYWORD = process.env.REBOOT_KEYWORD || "伺服器重啟完成，滅光戒指數值已更新。";
const WORKER_API_URL = process.env.WORKER_API_URL || "http://localhost:8787/api/boss-death";
const WORKER_REBOOT_URL = WORKER_API_URL.replace("/api/boss-death", "/api/server-reboot");
const KEYWORD = process.env.KEYWORD || "LoA363 頭目擊殺記錄 Boss Kills";

let latestRebootTime = null;

if (!DISCORD_USER_TOKEN || DISCORD_USER_TOKEN === "your_discord_user_token_here") {
  console.error("❌ 錯誤：請先在 .env 檔案中設定您的 DISCORD_USER_TOKEN！");
  console.error("   詳細獲取步驟請參閱 README.md");
  process.exit(1);
}

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

let ws = null;
let heartbeatInterval = null;
let lastSequence = null;
let isReconnecting = false;

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

// --------------------------------------------------------------------------
// 1. 核心過濾規則 (原汁原味移植自 content.js)
// --------------------------------------------------------------------------

function shouldSkipBoss(localName, id, bossName) {
  const numId = Number(id);

  // 1. 排除指定無效區域
  const excludedAreas = [
    "奇怪的村落 Strange Village",
    "奇岩競技場 Giran Colosseum",
    "",
    "從前的說話之島 Memories Island"
  ];
  if (excludedAreas.includes(localName)) {
    return true;
  }

  // 2. 傲慢之塔 (非樓層)：只允許特定 ID
  if (localName === "傲慢之塔 Tower of Insolence" && ![46220, 146220, 46271].includes(numId)) {
    return true;
  }

  // 3. 傲慢之塔各樓層百鬼活動過濾：只有特定樓層且 ID 不符合時才跳過
  const TOI_EXCEPTIONS = {
    "傲慢之塔 10樓 Tower of Insolence 10F": [45513, 145513],
    "傲慢之塔 20樓 Tower of Insolence 20F": [45547, 145547],
    "傲慢之塔 30樓 Tower of Insolence 30F": [45606, 145606],
    "傲慢之塔 40樓 Tower of Insolence 40F": [45650, 145650],
    "傲慢之塔 50樓 Tower of Insolence 50F": [45652, 145652],
    "傲慢之塔 60樓 Tower of Insolence 60F": [45653, 145653],
    "傲慢之塔 70樓 Tower of Insolence 70F": [45654, 145654],
    "傲慢之塔 80樓 Tower of Insolence 80F": [45618, 145618],
    "傲慢之塔 90樓 Tower of Insolence 90F": [45672, 145672],
  };

  if (TOI_EXCEPTIONS[localName] && !TOI_EXCEPTIONS[localName].includes(numId)) {
    return true;
  }

  return false;
}

// --------------------------------------------------------------------------
// 2. 解析 Discord Embed 訊息
// --------------------------------------------------------------------------

function parseBossEmbed(embed) {
  const rawEmbedStr = JSON.stringify(embed);

  // 檢查是否包含關鍵字
  if (!rawEmbedStr.includes(KEYWORD)) {
    return null;
  }

  let localName = "";
  let timeText = "";
  let emblem = "未知血盟";

  // 解析 fields 欄位
  if (Array.isArray(embed.fields)) {
    for (const field of embed.fields) {
      const fieldName = (field.name || "").trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
      const fieldValue = (field.value || "").trim();

      if (fieldName.includes("地點 Location")) {
        localName = fieldValue;
      } else if (fieldName.includes("時間 End at")) {
        timeText = fieldValue;
      } else if (fieldName.includes("血盟 Pledge")) {
        emblem = fieldValue || "未知血盟";
      }
    }
  }

  // 從 Embed 中解析 Boss ID 與 名稱 (例如連結中的 /mob/45614/%E5%B7%A8%E8%9F%BB%E5%A5%B3%E7%9A%87)
  let id = 0;
  let bossName = "";

  const mobMatch = rawEmbedStr.match(/\/mob\/(\d+)\/([^)"\s\\]+)/);
  if (mobMatch) {
    id = mobMatch[1];
    try {
      bossName = decodeURIComponent(mobMatch[2]);
    } catch {
      bossName = mobMatch[2];
    }
  }

  if (!id || id === 0) {
    return null;
  }

  // 判斷隱龍類型 (0: 正常, 1: 小隱龍, 2: 大隱龍)
  let type = 0;
  if (localName === "Training Place for Death Knight") {
    type = 1;
  } else if (localName === "Dwarven Village") {
    type = 2;
  }

  // 檢查是否符合跳過條件
  if (shouldSkipBoss(localName, id, bossName)) {
    console.log(`[過濾] 跳過不符合條件的 Boss: ${bossName} (${id}) 地點: ${localName}`);
    return null;
  }

  return {
    id: Number(id),
    type: type,
    bossName: bossName,
    emblem: emblem,
    death: timeText
  };
}

// --------------------------------------------------------------------------
// 3. 推送資料給 Cloudflare Worker
// --------------------------------------------------------------------------

function postJson(targetUrl, data) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const isHttps = parsedUrl.protocol === "https:";
      const client = isHttps ? https : http;
      const payload = JSON.stringify(data);

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      };

      const req = client.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(body);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}: ${body}`));
          }
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      req.write(payload);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function getJson(targetUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const isHttps = parsedUrl.protocol === "https:";
      const client = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          ...headers,
        },
      };

      const req = client.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(body);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}: ${body}`));
          }
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function sendToCloudflareWorker(deathInfo) {
  try {
    console.log(`🚀 [推播] 正在發送 Boss 死亡資料至 Cloudflare Worker:`, deathInfo);
    const resData = await postJson(WORKER_API_URL, { deathInfo });
    console.log(`✅ [推播成功] Cloudflare Worker 回應:`, resData);
    return true;
  } catch (err) {
    console.error(`❌ [推播異常] 無法連線至 Cloudflare Worker:`, err.message);
    return false;
  }
}

async function sendRebootToCloudflareWorker(rebootTime, messageContent) {
  try {
    console.log(`🚨 [重啟推播] 正在發送伺服器重啟通知至 Cloudflare Worker，時間:`, rebootTime);
    const resData = await postJson(WORKER_REBOOT_URL, {
      rebootTime: rebootTime,
      message: messageContent
    });
    console.log(`✅ [重啟推播成功] Cloudflare Worker 回應:`, resData);
    latestRebootTime = new Date(rebootTime);
  } catch (err) {
    console.error(`❌ [重啟推播異常] 無法連線至 Cloudflare Worker:`, err.message);
  }
}

/**
 * 啟動時自動執行：
 * 1. 至重啟頻道找到最後一筆重啟公告，將此時間點之前的擊殺全數自雲端刪除
 * 2. 自擊殺頻道從當前時間往回推直到重啟時間，檢查是否有缺漏的擊殺並逐筆補齊推播
 */
async function fetchAndSyncHistoricalMessages() {
  try {
    // ------------------------------------------------------------------------
    // 步驟 1: 前往重啟公告頻道 (REBOOT_CHANNEL_ID) 尋找最後一筆重啟公告
    // ------------------------------------------------------------------------
    console.log(`🔍 [步驟 1/3: 重啟定位] 正在向重啟頻道 (${REBOOT_CHANNEL_ID}) 查詢最後一筆重啟公告...`);
    let foundRebootMsg = null;
    let rebootBeforeId = null;

    // 支援最多往回搜尋 5 頁 (共 500 則訊息)，確保能精確定位最後一筆重啟
    for (let page = 0; page < 5; page++) {
      let rebootUrl = `https://discord.com/api/v10/channels/${REBOOT_CHANNEL_ID}/messages?limit=100`;
      if (rebootBeforeId) {
        rebootUrl += `&before=${rebootBeforeId}`;
      }

      const msgs = await getJson(rebootUrl, {
        Authorization: DISCORD_USER_TOKEN,
      });

      if (!Array.isArray(msgs) || msgs.length === 0) break;

      // 由新到舊找出最新的一筆符合關鍵字的訊息
      const target = msgs.find(m => {
        const text = (m.content || "") + (Array.isArray(m.embeds) ? JSON.stringify(m.embeds) : "");
        return text.includes(REBOOT_KEYWORD);
      });

      if (target) {
        foundRebootMsg = target;
        break;
      }

      rebootBeforeId = msgs[msgs.length - 1].id;
    }

    if (foundRebootMsg) {
      const rebootTimeObj = parseTaiwanDate(foundRebootMsg.timestamp);
      console.log(`🚨 [重啟定位成功] 找到最後一筆伺服器重啟公告！`);
      console.log(`   原始時間: ${foundRebootMsg.timestamp}`);
      console.log(`   台灣時間: ${rebootTimeObj ? rebootTimeObj.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : ''}`);

      // 先向雲端查詢目前的 rebootTime，避免重複觸發 server-reboot 清空前端
      let needNotifyReboot = true;
      try {
        const bossDataApiUrl = WORKER_API_URL.replace("/api/boss-death", "/api/boss-data");
        const cloudData = await getJson(bossDataApiUrl);
        if (cloudData && cloudData.config && cloudData.config.rebootTime) {
          const cloudRebootDate = parseTaiwanDate(cloudData.config.rebootTime);
          if (cloudRebootDate && rebootTimeObj) {
            // 如果雲端重啟時間與此公告相同，或雲端記錄的時間更晚，代表該重啟公告雲端早已生效
            if (cloudRebootDate.getTime() >= rebootTimeObj.getTime()) {
              needNotifyReboot = false;
              latestRebootTime = cloudRebootDate;
              console.log(`ℹ️ [重啟定位] 雲端已記錄此重啟時間 (${cloudRebootDate.toISOString()})，無須重複觸發雲端清空與前端重置。`);
            }
          }
        }
      } catch (e) {
        console.warn(`⚠️ [重啟檢查] 無法取得雲端現有重啟時間: ${e.message}`);
      }

      if (needNotifyReboot) {
        // 步驟 1.1: 確實發現「全新」重啟公告，才通知 Cloudflare Worker 清除舊歷史擊殺
        console.log(`🧹 [雲端清空] 發現全新重啟公告，正在通知 Cloudflare Worker 刪除 ${foundRebootMsg.timestamp} 之前的歷史擊殺...`);
        await sendRebootToCloudflareWorker(foundRebootMsg.timestamp, foundRebootMsg.content || REBOOT_KEYWORD);
      }
    } else {
      console.log(`ℹ️ [重啟定位] 最近訊息中未發現重啟公告關鍵字，將使用系統既定重啟時間。`);
    }

    // ------------------------------------------------------------------------
    // 步驟 2: 自擊殺頻道「從當前時間往回推」，直到「7天內」或「伺服器重啟時間」(看哪個條件先)
    // ------------------------------------------------------------------------
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // 回溯截止時間：從現在往過去推，較晚的時間戳記會先遇到
    // 若重開機在 7 天內 (例如 2 天前)，先遇到重開機時間 -> 以重開機時間為截止點
    // 若重開機在 7 天以前 (例如 10 天前)，先遇到 7 天前 -> 以 7 天前為截止點
    let cutoffThreshold = sevenDaysAgo;
    if (latestRebootTime && latestRebootTime > sevenDaysAgo) {
      cutoffThreshold = latestRebootTime;
      console.log(`⏱️ [截止條件] 重開機時間 (${cutoffThreshold.toISOString()}) 晚於 7 天前，採用「重開機時間」為回溯終點。`);
    } else {
      console.log(`⏱️ [截止條件] 7 天前 (${cutoffThreshold.toISOString()}) 晚於重開機時間，採用「7 天前」為回溯終點。`);
    }

    console.log(`🔍 [步驟 2/3: 區間採集] 正在從擊殺頻道 (${TARGET_CHANNEL_ID}) 當前時間往回推，直到截止時間 (${cutoffThreshold.toISOString()})...`);

    let collectedKills = [];
    let killBeforeId = null;
    let reachedCutoffPoint = false;
    let pageCount = 0;

    while (!reachedCutoffPoint && pageCount < 150) {
      pageCount++;
      let killUrl = `https://discord.com/api/v10/channels/${TARGET_CHANNEL_ID}/messages?limit=100`;
      if (killBeforeId) {
        killUrl += `&before=${killBeforeId}`;
      }

      const messages = await getJson(killUrl, {
        Authorization: DISCORD_USER_TOKEN,
      });

      if (!Array.isArray(messages) || messages.length === 0) {
        break;
      }

      for (const msg of messages) {
        const msgTime = parseTaiwanDate(msg.timestamp);

        // 如果訊息發布時間早於截止時間，代表已經回推到達截止點，停止後續抓取
        if (msgTime && msgTime < cutoffThreshold) {
          reachedCutoffPoint = true;
          break;
        }

        // 解析 Embed
        if (Array.isArray(msg.embeds)) {
          for (const embed of msg.embeds) {
            const deathInfo = parseBossEmbed(embed);
            if (deathInfo) {
              const killTime = parseTaiwanDate(deathInfo.death);
              // 只要該擊殺時間在截止時間點之後，就收集；早於截止時間則略過
              if (killTime && killTime >= cutoffThreshold) {
                collectedKills.push(deathInfo);
              }
            }
          }
        }
      }

      killBeforeId = messages[messages.length - 1].id;
    }

    console.log(`📦 [採集完畢] 在截止時間至當前時間之間，共解析到 ${collectedKills.length} 筆 Boss 擊殺紀錄。`);

    // ------------------------------------------------------------------------
    // 步驟 3: 比對雲端現有資料，「是否有缺的，有缺的就補齊 並且推播」
    // ------------------------------------------------------------------------
    console.log(`🔍 [步驟 3/3: 缺漏檢查] 正在比對雲端資料庫是否有缺漏的擊殺紀錄...`);
    let missingKills = [];

    try {
      const bossDataApiUrl = WORKER_API_URL.replace("/api/boss-death", "/api/boss-data");
      const currentCloudData = await getJson(bossDataApiUrl);

      // 建立受管理 Boss 集合 (包含活動怪) 與既有紀錄集合
      const validBossMap = new Map();
      const cloudExistingRecordSet = new Set();
      if (currentCloudData && Array.isArray(currentCloudData.bossListData)) {
        currentCloudData.bossListData.forEach(b => {
          validBossMap.set(String(b.id), b.bossName);
          validBossMap.set(String(Number(b.id) + 100000), b.bossName);
          validBossMap.set(b.bossName, b.bossName);
          validBossMap.set(`活動${b.bossName}`, b.bossName);

          if (b.death && b.death !== "未知") {
            cloudExistingRecordSet.add(`${b.bossName}_${b.death}`);
          }
          if (Array.isArray(b.deathList)) {
            b.deathList.forEach(dl => {
              if (dl.death) {
                cloudExistingRecordSet.add(`${b.bossName}_${dl.death}`);
              }
            });
          }
        });
      }

      // 檢查收集到的擊殺中，哪些尚未存在於雲端
      collectedKills.forEach(kill => {
        // 歷史回溯補齊：只補齊系統受管理的 62 隻主要 Boss (包含活動怪)，略過未納管之雜怪
        const isManagedBoss = validBossMap.has(String(kill.id)) || validBossMap.has(kill.bossName);
        if (!isManagedBoss) {
          return;
        }

        const standardBossName = validBossMap.get(String(kill.id)) || kill.bossName;
        const key = `${standardBossName}_${kill.death}`;
        if (!cloudExistingRecordSet.has(key)) {
          missingKills.push(kill);
          // 加入 set 避免同批採集內的重複擊殺重複推播
          cloudExistingRecordSet.add(key);
        }
      });
    } catch (err) {
      console.warn(`⚠️ [比對提示] 無法取得雲端現有清單，將直接依序同步採集到的資料: ${err.message}`);
      missingKills = collectedKills;
    }

    if (missingKills.length > 0) {
      console.log(`🚀 [發現缺漏] 發現共有 ${missingKills.length} 筆擊殺尚未同步至雲端，開始逐筆補齊推播...`);

      // 依時間「由舊到新」排序，依序發送推播
      missingKills.sort((a, b) => {
        const da = parseTaiwanDate(a.death);
        const db = parseTaiwanDate(b.death);
        return (da && db) ? da - db : 0;
      });

      let pushedCount = 0;
      for (const kill of missingKills) {
        await sendToCloudflareWorker(kill);
        pushedCount++;
      }
      console.log(`🎉 [補齊完成] 成功補齊推播 ${pushedCount} 筆缺漏擊殺至 Cloudflare Worker 與前端！`);
    } else {
      console.log(`✅ [完整無缺] 經比對，重啟時間之後的所有擊殺在雲端皆已完整，無須重複補齊！`);
    }

  } catch (err) {
    console.error(`❌ [同步回溯異常]:`, err);
  }
}

// --------------------------------------------------------------------------
// 4. Discord Gateway WebSocket 連線管理
// --------------------------------------------------------------------------

function connectGateway() {
  console.log(`🔌 [連線] 正在連接 Discord Gateway (${GATEWAY_URL})...`);
  ws = new WebSocket(GATEWAY_URL);

  ws.on("open", () => {
    console.log("🟢 [連線成功] 已連線至 Discord Gateway，等待 Hello 握手...");
  });

  ws.on("message", async (raw) => {
    try {
      const payload = JSON.parse(raw.toString());
      const { op, d, s, t } = payload;

      if (s !== null) {
        lastSequence = s;
      }

      switch (op) {
        // Opcode 10: Hello 封包
        case 10: {
          const interval = d.heartbeat_interval;
          console.log(`💓 [心跳] 收到 Hello，心跳週期: ${interval} ms`);
          startHeartbeat(interval);
          sendIdentify();
          break;
        }

        // Opcode 11: Heartbeat ACK
        case 11: {
          // 心跳回應確認
          break;
        }

        // Opcode 0: Dispatch 事件
        case 0: {
          handleDispatchEvent(t, d);
          break;
        }

        // Opcode 7 或 9: 需重新連線
        case 7:
        case 9: {
          console.warn(`🔄 [重連] 收到 Opcode ${op}，準備重新建立連線...`);
          reconnect();
          break;
        }
      }
    } catch (e) {
      console.error("❌ 訊息處理錯誤:", e.message);
    }
  });

  ws.on("close", (code, reason) => {
    console.warn(`⚠️ [連線關閉] 代碼: ${code}, 原因: ${reason || "無"}`);
    reconnect();
  });

  ws.on("error", (err) => {
    console.error("❌ [連線錯誤]:", err.message);
  });
}

function startHeartbeat(interval) {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 1, d: lastSequence }));
    }
  }, interval);
}

function sendIdentify() {
  console.log("🔑 [驗證] 正在使用個人 Token 發送 Identify 封包...");
  const identifyPayload = {
    op: 2,
    d: {
      token: DISCORD_USER_TOKEN,
      capabilities: 16381,
      properties: {
        os: "Windows",
        browser: "Chrome",
        device: "",
        system_locale: "zh-TW",
        browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        browser_version: "120.0.0.0",
        os_version: "10",
        referrer: "",
        referring_domain: "",
        referrer_current: "",
        referring_domain_current: "",
        release_channel: "stable",
        client_build_number: 250000,
        client_event_source: null
      },
      presence: {
        status: "online",
        since: 0,
        activities: [],
        afk: false
      },
      compress: false,
      client_state: {
        guild_versions: {}
      }
    }
  };
  ws.send(JSON.stringify(identifyPayload));
}

// 已處理訊息 ID 與擊殺紀錄快取 (防重覆)
const processedMessageIds = new Set();
const recentPushedKills = new Map();

function handleDispatchEvent(eventType, eventData) {
  if (eventType === "READY") {
    console.log(`🎉 [驗證成功] 已成功登入 Discord 帳號: ${eventData.user.username}#${eventData.user.discriminator || "0"}`);
    console.log(`🎯 [監聽中] 正持續監聽擊殺頻道: ${TARGET_CHANNEL_ID}`);
    console.log(`🎯 [監聽中] 正持續監聽重啟頻道: ${REBOOT_CHANNEL_ID} (關鍵字: "${REBOOT_KEYWORD}")`);
    // 登入成功後，立刻非同步向 Discord API 檢查重啟與補齊歷史資料
    fetchAndSyncHistoricalMessages();
    return;
  }

  // 監聽新訊息事件
  if (eventType === "MESSAGE_CREATE") {
    if (eventData.id) {
      if (processedMessageIds.has(eventData.id)) {
        return; // 重複訊息直接略過
      }
      processedMessageIds.add(eventData.id);
      if (processedMessageIds.size > 1000) {
        const oldestId = processedMessageIds.values().next().value;
        processedMessageIds.delete(oldestId);
      }
    }

    // 1. 檢查是否為伺服器重啟公告頻道
    if (eventData.channel_id === REBOOT_CHANNEL_ID) {
      const content = eventData.content || "";
      const inEmbeds = Array.isArray(eventData.embeds) && eventData.embeds.some(e => JSON.stringify(e).includes(REBOOT_KEYWORD));
      if (content.includes(REBOOT_KEYWORD) || inEmbeds) {
        console.log(`🚨 [即時捕獲重啟] 偵測到伺服器重啟公告！時間: ${eventData.timestamp}`);
        sendRebootToCloudflareWorker(eventData.timestamp, content || REBOOT_KEYWORD);
      }
      return;
    }

    // 2. 檢查是否為目標 Boss 擊殺頻道
    if (eventData.channel_id === TARGET_CHANNEL_ID) {
      if (Array.isArray(eventData.embeds) && eventData.embeds.length > 0) {
        for (const embed of eventData.embeds) {
          const deathInfo = parseBossEmbed(embed);
          if (deathInfo) {
            const killKey = `${deathInfo.id}_${deathInfo.bossName}_${deathInfo.death}_${deathInfo.emblem || ''}`;
            const now = Date.now();
            if (recentPushedKills.has(killKey) && (now - recentPushedKills.get(killKey) < 30000)) {
              console.log(`⏳ [略過重複擊殺] 30秒內已推播過: ${deathInfo.bossName} (${deathInfo.death})`);
              continue;
            }
            // 過濾早於重啟時間的舊擊殺
            if (latestRebootTime) {
              const killTime = parseTaiwanDate(deathInfo.death);
              if (killTime && killTime < latestRebootTime) {
                console.log(`⏳ [過濾舊擊殺] ${deathInfo.bossName} (${deathInfo.death}) 早於重啟時間，略過推播。`);
                continue;
              }
            }
            // 先標記以擋下同時進來的重複訊息；推播失敗則移除標記，讓之後的重送可以重試
            recentPushedKills.set(killKey, now);
            if (recentPushedKills.size > 200) {
              for (const [k, t] of recentPushedKills.entries()) {
                if (now - t > 30000) recentPushedKills.delete(k);
              }
            }
            console.log(`🎯 [捕獲擊殺] 成功解析到 Boss 擊殺訊息:`, deathInfo);
            sendToCloudflareWorker(deathInfo).then(ok => {
              if (!ok) recentPushedKills.delete(killKey);
            });
          }
        }
      }
    }
  }
}

function reconnect() {
  if (isReconnecting) return;
  isReconnecting = true;

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (ws) {
    try {
      ws.terminate();
    } catch {}
  }

  console.log("⏳ 5 秒後嘗試重新連線...");
  setTimeout(() => {
    isReconnecting = false;
    connectGateway();
  }, 5000);
}

// 啟動連線
connectGateway();
