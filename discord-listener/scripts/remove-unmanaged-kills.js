/**
 * 一次性清理腳本：刪除被誤寫入線上資料的「未列管 Boss」擊殺
 *
 * 背景：Worker 舊版以 Boss 名稱比對擊殺，傲慢之塔 46271「恐怖的吸血鬼」等同名但不在
 * Boss 清單上的擊殺被寫進了 45606 的 deathList 與訊息區。線上資料本身沒有存 id，
 * 因此改從 Discord 擊殺頻道的歷史訊息取得每筆擊殺的 id 來分辨。
 *
 * 流程：
 * 1. 讀取 Worker /api/boss-data，取得 Boss 清單 (清單 id 與活動版 id + 100000 為列管)
 * 2. 往回抓取 Discord 擊殺頻道直到保留期限 (重開機時間與 7 天前取較晚者)
 * 3. 找出 id 不在清單上的擊殺，排除與列管 Boss 同名同時間同血盟的紀錄 (無法分辨，保留)
 * 4. 與線上資料比對並列出會刪除的 deathList 與訊息區紀錄
 * 5. 加上 --apply 時才呼叫 /api/admin/remove-kills 實際刪除
 *
 * 用法 (於 discord-listener 目錄)：
 *   node scripts/remove-unmanaged-kills.js            # dry-run，只列出
 *   ADMIN_API_KEY=xxx node scripts/remove-unmanaged-kills.js --apply
 *
 * 需要 .env 中的 DISCORD_USER_TOKEN、TARGET_CHANNEL_ID、WORKER_API_URL
 */

import dotenv from "dotenv";
import https from "https";
import http from "http";

dotenv.config();

const DISCORD_USER_TOKEN = process.env.DISCORD_USER_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID || "1527172467016335493";
const WORKER_API_URL = process.env.WORKER_API_URL || "http://localhost:8787/api/boss-death";
const KEYWORD = process.env.KEYWORD || "LoA363 頭目擊殺記錄 Boss Kills";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const APPLY = process.argv.includes("--apply");

const WORKER_BASE = WORKER_API_URL.replace(/\/api\/boss-death$/, "");

function request(method, targetUrl, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = client.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        ...headers,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          // 非 JSON 回應
        }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseTaiwanDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(str)) {
    return new Date(str.replace(" ", "T") + "+08:00");
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// 與 Worker 的 normalizeKillBossName / parseKillMessage 規則相同
const normalizeName = (name) => String(name || "").replace(/[・．\s]/g, "").replace(/^活動/, "");
const keyOf = (bossName, death, emblem) =>
  `${normalizeName(bossName)}|${String(death || "").trim().slice(0, 16)}|${String(emblem || "").trim()}`;

function parseKillMessage(msg) {
  const m = String(msg).match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?::\d{2})?.*?【(.+?)】被 (.*) 擊殺\s*$/);
  return m ? { death: m[1], bossName: m[2], emblem: m[3] } : null;
}

// 解析擊殺 Embed (與 index.js parseBossEmbed 相同，但不套用 shouldSkipBoss，以取得所有擊殺)
function parseKillEmbed(embed) {
  const rawEmbedStr = JSON.stringify(embed);
  if (!rawEmbedStr.includes(KEYWORD)) return null;

  let localName = "";
  let death = "";
  let emblem = "未知血盟";
  for (const field of embed.fields || []) {
    const fieldName = (field.name || "").trim().replace(/[​-‍﻿]/g, "");
    const fieldValue = (field.value || "").trim();
    if (fieldName.includes("地點 Location")) localName = fieldValue;
    else if (fieldName.includes("時間 End at")) death = fieldValue;
    else if (fieldName.includes("血盟 Pledge")) emblem = fieldValue || "未知血盟";
  }

  const mobMatch = rawEmbedStr.match(/\/mob\/(\d+)\/([^)"\s\\]+)/);
  if (!mobMatch) return null;
  let bossName;
  try {
    bossName = decodeURIComponent(mobMatch[2]);
  } catch {
    bossName = mobMatch[2];
  }
  return { id: Number(mobMatch[1]), bossName, emblem, death, localName };
}

async function fetchKillHistory(cutoffDate) {
  const kills = [];
  let beforeId = null;
  for (let page = 0; page < 300; page++) {
    let url = `https://discord.com/api/v10/channels/${TARGET_CHANNEL_ID}/messages?limit=100`;
    if (beforeId) url += `&before=${beforeId}`;

    const res = await request("GET", url, { headers: { Authorization: DISCORD_USER_TOKEN } });
    if (res.status === 429) {
      const waitMs = Math.ceil(((res.json && res.json.retry_after) || 1) * 1000);
      console.log(`⏳ Discord 速率限制，等待 ${waitMs}ms...`);
      await sleep(waitMs);
      page--;
      continue;
    }
    if (res.status !== 200 || !Array.isArray(res.json)) {
      throw new Error(`讀取 Discord 頻道失敗 (HTTP ${res.status}): ${res.text.slice(0, 200)}`);
    }
    const messages = res.json;
    if (messages.length === 0) break;

    let reachedCutoff = false;
    for (const msg of messages) {
      if (new Date(msg.timestamp) < cutoffDate) {
        reachedCutoff = true;
        break;
      }
      for (const embed of msg.embeds || []) {
        const kill = parseKillEmbed(embed);
        if (kill) kills.push(kill);
      }
    }
    if (reachedCutoff) break;
    beforeId = messages[messages.length - 1].id;
    await sleep(300);
  }
  return kills;
}

async function main() {
  if (!DISCORD_USER_TOKEN) {
    console.error("❌ 請在 .env 設定 DISCORD_USER_TOKEN");
    process.exit(1);
  }

  console.log(`🔍 讀取線上資料: ${WORKER_BASE}/api/boss-data`);
  const cloudRes = await request("GET", `${WORKER_BASE}/api/boss-data`);
  if (cloudRes.status !== 200 || !cloudRes.json) {
    throw new Error(`讀取 Worker 資料失敗 (HTTP ${cloudRes.status})`);
  }
  const cloud = cloudRes.json;
  const bossList = cloud.bossListData || [];
  const validIds = new Set();
  bossList.forEach((b) => {
    validIds.add(Number(b.id));
    validIds.add(Number(b.id) + 100000);
  });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rebootDate = cloud.config && cloud.config.rebootTime ? new Date(cloud.config.rebootTime) : null;
  const cutoffDate = rebootDate && rebootDate > sevenDaysAgo ? rebootDate : sevenDaysAgo;
  // 多往回抓 1 小時，避免 Discord 訊息時間略晚於擊殺時間而漏掉邊界紀錄
  const fetchCutoff = new Date(cutoffDate.getTime() - 60 * 60 * 1000);

  console.log(`🔍 抓取 Discord 擊殺頻道歷史，直到 ${fetchCutoff.toISOString()}...`);
  const kills = await fetchKillHistory(fetchCutoff);
  console.log(`📦 共解析到 ${kills.length} 筆擊殺`);

  const managedKeys = new Set();
  const unmanaged = new Map();
  kills.forEach((k) => {
    const key = keyOf(k.bossName, k.death, k.emblem);
    if (validIds.has(k.id)) managedKeys.add(key);
    else unmanaged.set(key, k);
  });

  // 名稱、時間、血盟都和列管 Boss 的擊殺相同時無法分辨是哪一隻，保留不刪
  const ambiguous = [];
  const targets = new Map();
  unmanaged.forEach((k, key) => {
    if (managedKeys.has(key)) ambiguous.push(k);
    else targets.set(key, k);
  });

  const deathListHits = [];
  bossList.forEach((b) => {
    (b.deathList || []).forEach((dl) => {
      const k = targets.get(keyOf(dl.bossName || b.bossName, dl.death, dl.emblem));
      if (k) deathListHits.push({ bossId: b.id, bossName: b.bossName, death: dl.death, emblem: dl.emblem, sourceId: k.id });
    });
  });
  const messageHits = [];
  (cloud.messageList || []).forEach((msg) => {
    const parsed = parseKillMessage(msg);
    const k = parsed && targets.get(keyOf(parsed.bossName, parsed.death, parsed.emblem));
    if (k) messageHits.push({ msg, sourceId: k.id });
  });

  console.log(`\n=== 將從 Boss deathList 刪除 (${deathListHits.length} 筆) ===`);
  deathListHits
    .sort((a, b) => a.death.localeCompare(b.death))
    .forEach((h) => console.log(`  [${h.bossId} ${h.bossName}] ${h.death} ${h.emblem}  ← 實際為 id ${h.sourceId}`));

  console.log(`\n=== 將從訊息區刪除 (${messageHits.length} 筆) ===`);
  messageHits.forEach((h) => console.log(`  ${h.msg}  ← 實際為 id ${h.sourceId}`));

  if (ambiguous.length > 0) {
    console.log(`\n=== 無法分辨、保留不刪 (${ambiguous.length} 筆) ===`);
    ambiguous.forEach((k) => console.log(`  ${k.death} 【${k.bossName}】${k.emblem} (id ${k.id} 與列管 Boss 同名同時間同血盟)`));
  }

  const matchedKeys = new Set([
    ...deathListHits.map((h) => keyOf(h.bossName, h.death, h.emblem)),
    ...messageHits.map((h) => {
      const p = parseKillMessage(h.msg);
      return keyOf(p.bossName, p.death, p.emblem);
    }),
  ]);
  const records = [...matchedKeys].map((key) => {
    const [, death, emblem] = key.split("|");
    return { bossName: targets.get(key).bossName, death, emblem };
  });

  if (!APPLY) {
    console.log(`\nℹ️ dry-run 完成，未修改任何資料。確認無誤後加上 --apply 並設定 ADMIN_API_KEY 執行刪除。`);
    return;
  }
  if (records.length === 0) {
    console.log("\n✅ 沒有需要刪除的紀錄");
    return;
  }
  if (!ADMIN_API_KEY) {
    console.error("\n❌ --apply 需要環境變數 ADMIN_API_KEY");
    process.exit(1);
  }

  console.log(`\n🧹 呼叫 ${WORKER_BASE}/api/admin/remove-kills 刪除 ${records.length} 筆擊殺...`);
  const res = await request("POST", `${WORKER_BASE}/api/admin/remove-kills`, {
    headers: { Authorization: `Bearer ${ADMIN_API_KEY}` },
    body: { records },
  });
  if (res.status !== 200 || !res.json || !res.json.success) {
    throw new Error(`刪除失敗 (HTTP ${res.status}): ${res.text.slice(0, 300)}`);
  }
  console.log(`✅ 已刪除 deathList ${res.json.removedDeathList.length} 筆、訊息區 ${res.json.removedMessages.length} 筆`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
