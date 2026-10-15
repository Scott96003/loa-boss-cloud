# 程式碼審查報告（詳細版）

- 審查日期：2026-10-15
- 範圍：工作目錄中尚未提交的變更（`git diff HEAD`，共 13 個檔案）
- 狀態：僅審查，尚未修改任何程式碼

## 背景：這次變更做了什麼

1. **輪迴刷新通知搬到後端**：原本由每個開著網頁的前端在整點切換時呼叫 `SendToDC(0)` 發 Discord Webhook；現在改由 Cloudflare Worker 的 Durable Object（Alarm + Cron）執行 `checkAndTriggerRespawnCycle()` 統一發送，前端只更新畫面。
2. **死亡紀錄同步**：新增 `syncBossLatestDeathAndEmblem()`，讓 Boss 的 `death`／`emblem` 永遠等於 `deathList` 中最新的一筆（前後端各一份）。
3. **防重複**：discord-listener、後端 `handleBossDeath`、前端 `messageListen.js` 都加了去重邏輯。

以下問題大多集中在第 1 點「搬到後端」時，前後端行為沒有完全對齊。

## 摘要

| # | 嚴重度 | 類別 | 檔案 | 問題 |
|---|---|---|---|---|
| 1 | 🔴 高 | 安全 | `cloudflare-worker/src/bossRoom.js:1373` | Discord Webhook URL（含密鑰）寫死在原始碼 |
| 2 | 🔴 高 | 正確性 | `cloudflare-worker/src/bossRoom.js:1376` | 奧塔／陣營／野外／all 頻道的輪迴刷新通知會靜默停止 |
| 3 | 🟠 中 | 正確性 | `cloudflare-worker/src/bossRoom.js:1428` | Discord 表格「已死亡」欄位永遠空白 |
| 4 | 🟠 中 | 正確性 | `cloudflare-worker/src/bossRoom.js:1007` | 前端 `Sync_Boss_Data` 覆寫伺服器的 `lastRefreshBossTime` |
| 5 | 🟡 低 | 正確性 | `cloudflare-worker/src/bossRoom.js:1407` | 以 `id % 100000` 過濾，活動 Boss 列會被重複列入 |
| 6 | 🟡 低 | 效能 | `cloudflare-worker/wrangler.toml:18` | Alarm 與 Cron 重複執行同一個檢查 |
| 7 | 🟡 低 | 正確性 | `discord-listener/index.js:671` | 推播成功前就標記為「已推播」，失敗無法重試 |
| 8 | 🟡 低 | 正確性 | `frontend/static/messageListen.js:143` | 後備邏輯取到最舊而非最新的死亡紀錄 |
| 9 | ⚪ 整理 | 重用 | `frontend/static/init.js:207` | 同步最新死亡紀錄的邏輯複製貼上了 3 次 |
| 10 | ⚪ 整理 | 重用 | `cloudflare-worker/src/bossRoom.js:1415` | `sendRespawnCycleWebhook` 重新實作 `getLatestDeathRecord` |

---

## 1. 🔴 Discord Webhook URL（含密鑰）寫死在原始碼

**位置：** [bossRoom.js:1373](cloudflare-worker/src/bossRoom.js:1373)

```js
const defaultElderUrl = "https://discord.com/api/webhooks/1508790867.../<token>";
...
{ name: "長老", checkList: ELDER_BOSS_IDS, webhookUrl: this.env.DISCORD_WEBHOOK_ELDER || defaultElderUrl },
```

**為什麼是問題：**
Discord Webhook URL 本身就是「帳號＋密碼」。URL 後半段的 token 就是授權憑證，**任何人拿到這串網址就能以這個 Webhook 的身分對頻道發任何訊息**（包括 @everyone、假公告、釣魚連結），不需要登入、也不需要任何權限。

**會在什麼情況發生：**
- 這份程式碼一旦 `git commit`，token 會永久留在 git 歷史中；之後就算刪掉那一行，用 `git log -p` 仍然看得到。
- 若 repo 推到 GitHub（尤其是公開 repo），GitHub 與第三方爬蟲會在幾分鐘內掃到 Discord token。
- 任何有 repo 讀取權限的協作者都能取得。

**補充：** `frontend/static/config.js` 中也有多組 Webhook URL（部分已註解）。由於前端檔案是公開提供給瀏覽器的，這些 URL 任何訪客打開開發者工具都看得到——這也是把通知搬到後端的好理由，但前提是後端不能再寫死。

**建議修正：**
1. 刪除 `defaultElderUrl`，只讀環境變數：
   ```bash
   cd cloudflare-worker
   wrangler secret put DISCORD_WEBHOOK_ELDER
   ```
2. 這個 token 已經出現在工作目錄中，若已推送或分享過，請到 Discord 頻道設定 → 整合 → Webhook 刪除並重新建立。

---

## 2. 🔴 奧塔／陣營／野外／all 頻道的輪迴刷新通知會靜默停止

**位置：** [bossRoom.js:1376](cloudflare-worker/src/bossRoom.js:1376)、[sendMessageToDiscord.js:455](frontend/static/sendMessageToDiscord.js:455)

**前端（變更後）：**
```js
if (newRange !== config.lastRefreshBossTime) {
    config.lastRefreshBossTime = newRange;
    refresh();
    // SendToDC(0);  ← 已移除，不再發 Webhook
}
```

**後端（新增）：**
```js
{ name: "奧塔", checkList: TOWER_ALL_BOSS_IDS, webhookUrl: this.env.DISCORD_WEBHOOK_TOWER },
{ name: "陣營", checkList: CAMP_BOSS_IDS,      webhookUrl: this.env.DISCORD_WEBHOOK_CAMP },
{ name: "野外", checkList: WILD_BOSS_IDS,      webhookUrl: this.env.DISCORD_WEBHOOK_WILD },
{ name: "all",  checkList: [...],              webhookUrl: this.env.DISCORD_WEBHOOK_ALL }
...
for (const { name, checkList, webhookUrl } of bossReportMap) {
  if (!webhookUrl) continue;   // ← 沒設定就直接跳過，沒有任何 log
```

**為什麼是問題：**
發送責任從前端移到後端，但 Webhook 網址沒有一起搬過去。原本這五個頻道的網址都來自前端 `config.js` 的 `WEBHook_URL`；後端改讀 `env.DISCORD_WEBHOOK_*`，而 `wrangler.toml` 裡沒有定義這些變數，也沒有看到設定 secret 的步驟。

**實際會發生什麼：**
1. 部署新版 Worker 與新版前端。
2. 到了整點切換，後端執行 `checkAndTriggerRespawnCycle()`。
3. 長老：`env.DISCORD_WEBHOOK_ELDER` 未設定 → 退回寫死的 `defaultElderUrl` → **有發送**。
4. 奧塔、陣營、野外、all：`webhookUrl` 為 `undefined` → `continue` → **完全不發送**。
5. 前端也不再發送 → 這四個頻道從此收不到「重生輪迴時間刷新」。
6. 因為是 `continue` 而不是錯誤，Worker 日誌裡**看不到任何警告**，很難察覺。

**建議修正：**
- 部署前設定所有 secret：
  ```bash
  wrangler secret put DISCORD_WEBHOOK_TOWER
  wrangler secret put DISCORD_WEBHOOK_CAMP
  wrangler secret put DISCORD_WEBHOOK_WILD
  wrangler secret put DISCORD_WEBHOOK_ALL
  ```
- 缺少設定時印出警告，例如 `console.warn(\`[WEBHOOK] ${name} 未設定 Webhook，略過\`)`。

---

## 3. 🟠 Discord 表格「已死亡」欄位永遠空白

**位置：** [bossRoom.js:1428](cloudflare-worker/src/bossRoom.js:1428)

**表格欄位定義（`formatTableForDiscord`）：**
```js
const columns = [
  { key: 'count',     header: '數量' },
  { key: 'spawnTime', header: '區段' },
  { key: 'name',      header: '名稱' },
  { key: 'guild',     header: '血盟' },
  { key: '已死亡',    header: '已死亡' }   // ← 讀取 row['已死亡']
];
```

**後端產生的資料（`sendRespawnCycleWebhook`）：**
```js
return {
  count: ...,
  name: item.bossName,
  spawnTime: ...,
  guild: ...,
  death: latestDeath        // ← 只有 death，沒有 已死亡
};
```

**舊前端的版本（`makeListMsg`）：**
```js
return {
  ...
  death: latestDeathDate || item.death,
  已死亡: formatTimeDifference(item.已死亡)   // ← 前端有填這欄
};
```

**為什麼是問題：**
表格要讀的 key 是 `已死亡`，但資料裡只有 `death`，所以每一列的「已死亡」都是空字串。而 `death` 欄位又不在表格欄位中，等於算了也沒顯示。

**實際會發生什麼：**
搬到後端後，每一則「重生輪迴時間刷新」訊息中的「已死亡」欄全部空白，使用者無法從 Discord 看出每隻 Boss 死了多久。

**建議修正：**
在後端依 `latestDeath` 與 `now` 計算時間差，填入 `已死亡` 欄位（可移植前端的 `formatTimeDifference`）。

---

## 4. 🟠 前端 `Sync_Boss_Data` 覆寫伺服器的 `lastRefreshBossTime`

**位置：** [bossRoom.js:1007](cloudflare-worker/src/bossRoom.js:1007)、[websocket/get.js:33](frontend/static/websocket/get.js:33)

**後端收到同步時：**
```js
if (messageType === 'Sync_Boss_Data') {
  this.mainData.bossListData = data.bossListData;
  this.mainData.config = data.config;   // ← 整個 config 被前端版本取代
```

**前端每次 WebSocket 連線（含斷線重連）都會送：**
```js
this.ws.onopen = () => { ... send_Sync_Boss_Data(); };

function send_Sync_Boss_Data() {
  const message = { type: 'Sync_Boss_Data', bossListData, config };  // ← config 含 lastRefreshBossTime
```

**後端判斷是否要發通知：**
```js
const lastRefresh = this.mainData.config.lastRefreshBossTime;
if (newRange !== lastRefresh) { ...發送 Webhook... }
```

**為什麼是問題：**
`lastRefreshBossTime` 現在是後端用來判斷「輪迴是否已切換、要不要發通知」的唯一依據，但前端也在自己的 30 秒計時器中修改它，並在連線時整包送上來覆蓋後端。兩邊都在寫同一個值，誰最後寫入誰贏。

**情境 A — 漏發通知：**
1. 現在 11:59:50，後端與前端的 `lastRefreshBossTime` 都是 12。
2. 12:00:05 前端計時器先跑，把自己的值改成 18（下一個區段）。
3. 12:00:10 該使用者網路閃斷重連 → `send_Sync_Boss_Data()` → 後端 config 被改成 18。
4. 12:00:30 後端 Alarm 執行 → `newRange (18) === lastRefresh (18)` → **判定沒有切換，不發通知**。
5. 這個輪迴的刷新通知就永遠不會送出。

**情境 B — 重複發送：**
1. 使用者的分頁在背景放了很久，瀏覽器節流了 `setInterval`，前端值還停在舊的 12。
2. 後端已正常在 12:00 發過通知並記錄為 18。
3. 使用者切回分頁、WebSocket 重連 → 後端 config 被改回 12。
4. 下一次 Alarm → `18 !== 12` → **再發一次同樣的刷新通知**，Discord 出現重複訊息。

**建議修正：**
後端合併 config 時保留自己的值，例如：
```js
const serverLastRefresh = this.mainData.config?.lastRefreshBossTime;
this.mainData.config = { ...data.config, lastRefreshBossTime: serverLastRefresh };
```
或乾脆把它存成 config 以外的伺服器專用欄位（例如 `this.mainData.serverLastRefreshBossTime`）。

---

## 5. 🟡 以 `id % 100000` 過濾，活動 Boss 列會被重複列入

**位置：** [bossRoom.js:1407](cloudflare-worker/src/bossRoom.js:1407)

```js
// 後端
.filter(item => checkList.includes(Number(item.id) % 100000))

// 舊前端
.filter(item => checkList.includes(parseInt(item.id)))
```

**為什麼是問題：**
專案慣例是「活動 Boss 的 id = 原 id + 100000」。`% 100000` 會把活動版本也對應回原 Boss，所以 45955 與 145955 都會被選進去；舊前端只選 45955。

**實際會發生什麼：**
若 `bossListData` 中同時存在一般與活動版本的資料列：
- Discord 表格同一隻 Boss 會出現兩列。
- 「取最接近 newRange 的區段」排序時，活動列也參與比較，可能影響「是否發送」的判斷。

**建議修正：** 表格與目標小時計算改用 `Number(item.id)` 直接比對，與舊前端一致；只有統計活動次數（`calculateActiveStats`）才需要取餘數。

---

## 6. 🟡 Alarm 與 Cron 重複執行同一個檢查

**位置：** [wrangler.toml:18](cloudflare-worker/wrangler.toml:18)、[bossRoom.js](cloudflare-worker/src/bossRoom.js) 的 `alarm()`

```toml
[triggers]
crons = ["* * * * *"]     # 每分鐘
```
```js
async alarm() {
  await this.checkAndTriggerRespawnCycle();
  ...
  await this.storage.setAlarm(Date.now() + 30 * 1000);   // 每 30 秒
}
```

**為什麼是問題：**
兩套排程做完全一樣的事：Alarm 每 30 秒一次，Cron 每分鐘又透過 `/api/scheduled-check` 呼叫一次，合計每分鐘約 3 次，而且 Alarm 會一直自我重設，Durable Object 永遠不會休眠。

**影響：**
- Durable Object 依「請求數＋喚醒時間」計費，一天約 4,300 次無謂的喚醒。
- 實際上輪迴只在特定整點切換，99% 的檢查結果都是「沒變化」。
- 兩條路徑同時存在也讓除錯更困難（不確定是哪一個觸發的）。

**建議修正：** 只保留一種機制。例如只用 Alarm，並把下一次喚醒時間直接設在「下一個目標小時的整點 + 幾秒」，一天只需喚醒幾次。

---

## 7. 🟡 推播成功前就標記為「已推播」

**位置：** [discord-listener/index.js:671](discord-listener/index.js:671)

```js
const killKey = `${deathInfo.id}_${deathInfo.bossName}_${deathInfo.death}_${deathInfo.emblem || ''}`;
if (recentPushedKills.has(killKey) && (now - recentPushedKills.get(killKey) < 30000)) {
  continue;   // 視為重複
}
recentPushedKills.set(killKey, now);   // ← 在這裡就先記下

// 過濾早於重啟時間的舊擊殺
if (latestRebootTime) { ... }
// ...之後才 POST 到 Worker
```

**為什麼是問題：**
「已推播」應該在推播**成功**之後才記錄，但現在是在過濾與送出之前就記錄。

**實際會發生什麼：**
1. 擊殺訊息進來，寫入快取。
2. POST 到 Worker 時剛好失敗（Worker 重新部署、網路逾時、5xx）。
3. 30 秒內 Discord 重送同一筆（或訊息被編輯觸發再次處理）→ 被判定為重複而跳過。
4. 這筆擊殺**永遠不會**被記錄到後端。

**建議修正：** 等 Worker 回應成功後才 `recentPushedKills.set(...)`；或失敗時 `recentPushedKills.delete(killKey)`。

---

## 8. 🟡 後備邏輯取到最舊的死亡紀錄

**位置：** [messageListen.js:143](frontend/static/messageListen.js:143)

```js
// 上方已經：deathList 依時間「升冪」排序（舊 → 新）
if (typeof syncBossLatestDeathAndEmblem === "function") {
  syncBossLatestDeathAndEmblem(boss);
} else if (boss.deathList.length > 0) {
  boss.death  = boss.deathList[0].death;    // ← [0] 是最舊的一筆
  boss.emblem = boss.deathList[0].emblem || "";
}
```

**為什麼是問題：**
排序是舊到新，`[0]` 是最舊，`[length - 1]` 才是最新。這個後備分支的意圖是「同步為最新」，但實際做的是「倒退成最舊」。

**何時會觸發：**
平常 `dashboard.js` 比 `messageListen.js` 先載入，所以走不到後備分支。但若之後調整載入順序、頁面只載入部分腳本、或瀏覽器快取到舊版 `dashboard.js`（沒有這個函式），就會走到這裡，Boss 的死亡時間與擊殺血盟會被改成很久以前的資料。

**建議修正：** 改成 `boss.deathList[boss.deathList.length - 1]`，或直接移除後備分支，統一依賴共用函式。

---

## 9. ⚪ 同步最新死亡紀錄的邏輯複製貼上了 3 次

**位置：**
- [init.js:207](frontend/static/init.js:207)（載入雲端資料時）
- [init.js:305](frontend/static/init.js:305)（`reDrawBossList` 的後備分支）
- [webrtc_client.js:28](frontend/static/webrtc/webrtc_client.js:28)

每一處都內嵌了同一段約 15 行的程式：

```js
const sorted = [...b.deathList].filter(x => x && x.death).sort((a, b) => new Date(a.death) - new Date(b.death));
if (sorted.length > 0) {
  const latest = sorted[sorted.length - 1];
  const latestDate = new Date(latest.death);
  const curDate = b.death ? new Date(b.death) : new Date(0);
  if (isNaN(curDate.getTime()) || latestDate >= curDate) { ... }
}
```

**為什麼是問題：**
`dashboard.js` 已經有 `syncBossLatestDeathAndEmblem()` 做同樣的事，而且幾個版本**已經不一致**：

| 差異 | 共用函式 | 內嵌版本 |
|---|---|---|
| 日期解析 | `parseSafeDate()` | `new Date()` |
| `"2026-10-15 12:00"` 格式 | 正確視為台灣時間 | 依瀏覽器時區解析，部分瀏覽器回傳 Invalid Date |
| `"未知"` 死亡時間 | 會略過 | 不會略過 |

所以同一筆資料，走不同的程式路徑可能得到不同結果。日後要修正「最新死亡紀錄」的判斷，必須同時改四個地方。

**建議修正：** 三處都改成直接呼叫 `syncBossLatestDeathAndEmblem(b)`，並確保 `dashboard.js` 在這些檔案之前載入。

---

## 10. ⚪ `sendRespawnCycleWebhook` 重新實作 `getLatestDeathRecord`

**位置：** [bossRoom.js:1415](cloudflare-worker/src/bossRoom.js:1415)

```js
let latestDeath = item.death;
if (Array.isArray(item.deathList) && item.deathList.length > 0) {
  let latestDate = parseTaiwanDate(item.death);
  for (const dl of item.deathList) { ...找最新... }
}
```

**為什麼是問題：**
同一次變更已在同一個檔案新增 `getLatestDeathRecord()`，功能相同，卻又寫了一份迴圈，而且行為略有差異（這裡不排除 `"未知"`）。

**建議修正：**
```js
const latestDeath = getLatestDeathRecord(item)?.death ?? item.death;
```

---

## 建議修正順序

1. **立即**：#1（移除寫死的 Webhook，並視情況重新產生 token）。
2. **部署前**：#2（設定所有 Webhook secret）、#4（避免漏發／重複發送）、#3（補上已死亡欄位）。
3. **之後**：#5、#6、#7、#8。
4. **整理**：#9、#10。
