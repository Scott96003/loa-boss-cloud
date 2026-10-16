# LOA Boss Time - Cloudflare Worker 後端

本目錄為第二步（後端重構）之專案，用於**完全取代原先運行在本地電腦的 Python (FastAPI) 伺服器**。

透過 Cloudflare 的全球邊緣運算與 **Durable Objects (WebSocket)** 技術，本服務支援 7x24 小時不中斷運行，具備零維護、零伺服器費用（完全符合 Cloudflare 免費層級額度）等優勢。

---

## 🌟 重構特點

1. **向下完全相容**：
   * 支援原 FastAPI 的所有 WebSocket 訊息格式與協議（`client_register`、`ping`/`pong`、`request_online_users`）。
   * 完整相容 WebRTC 信令交換（`offer`、`answer`、`candidate`、`chat_message`）。
   * 支援原有的全域資料廣播（`Sync_Boss_Data`、`Boss_Death`）。

2. **原生持久化快取 (Persistence)**：
   * 原本 Python 伺服器若重啟，記憶體中的 Boss 狀態便會遺失；在 Cloudflare Durable Objects 下，收到的 `Sync_Boss_Data` 會自動持久化儲存。
   * **新玩家上線即刻有資料**：即使主控發布端暫時離線，新進來的玩家連線後，Worker 會直接回覆快取的最新 Boss 死亡時間。

3. **新增外部 REST API 介面**：
   * `GET /api/status`：查看即時線上人數與伺服器健康狀態。
   * `GET /api/boss-data`：以標準 JSON 直接取得目前最新 Boss 狀態。
   * `POST /api/boss-death`：供外部 Bot、Webhook 或排程爬蟲直接發送 Boss 死亡資訊，Worker 會立即推播給所有線上連線的玩家。

---

## 📂 目錄結構

```text
cloudflare-worker/
├── package.json          # 專案相依性配置 (Wrangler CLI)
├── wrangler.toml         # Cloudflare Worker 與 Durable Objects 綁定設定
├── README.md             # 本說明文件
└── src/
    ├── index.js          # Worker 路由入口 (HTTP / WebSocket 轉發)
    └── bossRoom.js       # Durable Object 核心 (取代原 ConnectionManager)
```

---

## 🚀 本地開發與測試

若您想在本地電腦進行模擬測試：

1. **進入目錄並安裝工具**：
   ```bash
   cd cloudflare-worker
   npm install
   ```

2. **啟動本地模擬伺服器**：
   ```bash
   npx wrangler dev --config wrangler.toml
   ```
   * 預設會啟動於 `http://localhost:8787`。
   * WebSocket 端點為：`ws://localhost:8787/ws`。

3. **測試 API**：
   * 狀態檢查：瀏覽器打開 `http://localhost:8787/api/status`。
   * 模擬發布 Boss 死亡：
     ```bash
     curl -X POST http://localhost:8787/api/boss-death \
       -H "Content-Type: application/json" \
       -d '{"deathInfo": {"bossName": "巨蟻女皇", "deathTime": "2026-10-15 08:00"}}'
     ```

---

## ☁️ 部署到 Cloudflare (全球免費上線)

當您準備好將後端部署至 Cloudflare 雲端時，僅需兩步：

1. **登入 Cloudflare 帳號**（首次使用只需執行一次）：
   ```bash
   npx wrangler login
   ```
   *(瀏覽器會自動彈出授權畫面，點擊確認即可)*

2. **一鍵部署**：
   ```bash
   npx wrangler deploy --config wrangler.toml
   ```
   部署完成後，Wrangler 會輸出一個專屬的網址，例如：
   `https://loa-boss-worker.<你的帳號子網域>.workers.dev`

---

## 🔗 前端切換方式

當後端 Worker 部署完成後，前端只需將 `frontend/static/webrtc/webrtc.js` 最上方的連線網址替換為 Worker 的 WebSocket 網址：

```javascript
// 原本指向本地電腦
// const WebRTC_WS_URL = "wss://loabosstime.有毒不要來.online:8443/ws";

// 改為 Cloudflare Worker 雲端網址
const WebRTC_WS_URL = "wss://loa-boss-worker.<你的帳號子網域>.workers.dev/ws";
```
如此一來，前端與後端就完全脫離本地電腦，隨時隨地連線上線！

---

## 🔐 Discord 身分與頻道權限驗證設定

本 Worker 已整合 Discord 登入與頻道檢視權限驗證（目標頻道：`1426495371332292608`，伺服器：`1198482702932914277`）。

### 1. 本地開發設定 (`.dev.vars`)
在 `cloudflare-worker` 目錄下建立 `.dev.vars`：
```ini
DISCORD_CLIENT_ID="你的 Application Client ID"
DISCORD_CLIENT_SECRET="你的 Client Secret"
DISCORD_BOT_TOKEN="你的 Bot Token"
AUTH_JWT_SECRET="隨機字串密鑰"
DISCORD_TARGET_GUILD_ID="1198482702932914277"
DISCORD_TARGET_CHANNEL_ID="1426495371332292608"
```

### 2. 雲端部署加密變數 (Wrangler Secret)
部署至 Cloudflare 後，請透過以下指令將金鑰設定為安全變數：
```bash
npx wrangler secret put DISCORD_CLIENT_ID --config wrangler.toml
npx wrangler secret put DISCORD_CLIENT_SECRET --config wrangler.toml
npx wrangler secret put DISCORD_BOT_TOKEN --config wrangler.toml
npx wrangler secret put AUTH_JWT_SECRET --config wrangler.toml
# 選填：管理 API (/api/admin/remove-kills) 密鑰，未設定則管理 API 停用
npx wrangler secret put ADMIN_API_KEY --config wrangler.toml
```

