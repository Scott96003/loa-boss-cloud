# LOA Boss Cloud 部署文件

本文件說明如何從零開始，把整套系統部署到「盡量免費」的雲端環境，以及日後如何更新、監控與排除問題。

| 元件 | 目錄 | 部署平台 | 方案 |
| --- | --- | --- | --- |
| 後端 API / WebSocket | `cloudflare-worker/` | Cloudflare Workers + Durable Objects | Workers Free |
| 前端靜態網頁 | `frontend/`（設定檔在根目錄 `wrangler.jsonc`） | Cloudflare Workers Static Assets | Workers Free |
| Discord 擊殺監聽器 | `discord-listener/` | Google Cloud Compute Engine | Always Free `e2-micro` |

> `discord-listener/README.md` 內提到的 Fly.io / Koyeb 為早期方案，目前正式環境以本文件的 GCP 方案為準。

---

## 目錄

1. [系統架構](#1-系統架構)
2. [事前準備](#2-事前準備)
3. [部署順序總覽](#3-部署順序總覽)
4. [Discord 開發者設定](#4-discord-開發者設定)
5. [部署後端：cloudflare-worker](#5-部署後端cloudflare-worker)
6. [部署前端：frontend](#6-部署前端frontend)
7. [部署監聽器：discord-listener（GCP 免費 VM）](#7-部署監聽器discord-listenergcp-免費-vm)
8. [部署後驗證清單](#8-部署後驗證清單)
9. [日常更新流程](#9-日常更新流程)
10. [免費額度與費用控管](#10-免費額度與費用控管)
11. [疑難排解](#11-疑難排解)
12. [附錄：環境變數一覽](#12-附錄環境變數一覽)

---

## 1. 系統架構

```text
                ┌──────────────────────────────┐
  Discord 頻道   │  Discord Gateway (WebSocket) │
  (擊殺紀錄)  ──▶│                              │
                └──────────────┬───────────────┘
                               │ User Token 長連線
                               ▼
                ┌──────────────────────────────┐
                │ discord-listener (Node.js)   │  GCP e2-micro（systemd 常駐）
                │  解析擊殺／伺服器重啟訊息      │
                └──────────────┬───────────────┘
                               │ HTTPS POST
                               │  /api/boss-death
                               │  /api/server-reboot
                               ▼
┌───────────────────────────────────────────────────────────┐
│ loa-boss-worker（Cloudflare Worker）                       │
│  ├─ /api/auth/*   Discord OAuth2 登入、頻道權限驗證          │
│  ├─ /api/*        轉交 Durable Object                       │
│  └─ /ws           WebSocket（Hibernation）                  │
│        └─ BossRoom Durable Object（SQLite 儲存、整點 Alarm） │
│              └─ Discord Webhook 推播（長老／塔／營地／野外／龍門）│
└──────────────────────────────▲────────────────────────────┘
                               │ HTTPS / WSS
                ┌──────────────┴───────────────┐
                │ loa-boss-web（靜態前端）       │  Cloudflare Static Assets
                │  瀏覽器載入 frontend/*        │
                └──────────────────────────────┘
```

資料流重點：

- **listener → worker**：listener 只需要「對外連線」，不需要開任何對內連接埠。
- **frontend → worker**：前端在 `frontend/static/config.js` 寫死 Worker 網址，部署前務必確認。
- **worker → Discord**：OAuth 換 token、Bot 查頻道權限、Webhook 推播。

---

## 2. 事前準備

### 帳號

- [Cloudflare](https://dash.cloudflare.com/) 帳號（免費即可）。
- [Google Cloud](https://console.cloud.google.com/) 帳號，需綁定信用卡（Always Free 仍需開啟帳單帳戶）。
- [Discord Developer Portal](https://discord.com/developers/applications) 存取權。
- 一個能讀取擊殺頻道的 Discord 帳號（listener 用其 User Token）。

### 本機工具

```bash
node --version   # 建議 v20 以上
npm --version
git --version
```

- Wrangler 不需全域安裝，透過 `npx wrangler` 使用即可。
- GCP 部分可以全程在網頁主控台的 **Cloud Shell / SSH 按鈕** 操作；若要在本機操作，安裝 gcloud CLI：

```bash
brew install --cask google-cloud-sdk
```

### 登入 Cloudflare

```bash
npx wrangler login
```

瀏覽器會跳出授權頁面，按允許即可。可用以下指令確認登入身分與帳號 ID：

```bash
npx wrangler whoami
```

---

## 3. 部署順序總覽

彼此有依賴關係，請依序進行：

1. **Discord 開發者設定**：取得 Client ID / Secret / Bot Token。
2. **cloudflare-worker**：部署後取得 Worker 網址（例：`https://loa-boss-worker.<子網域>.workers.dev`）。
3. **frontend**：把 Worker 網址寫進 `config.js` 後部署，取得前端網址。
4. **回到 Discord**：把前端網址加入 OAuth2 Redirect URI。
5. **discord-listener**：在 GCP VM 上設定 `WORKER_API_URL` 指向 Worker 並啟動。
6. **驗證**：依第 8 節清單逐項確認。

---

## 4. Discord 開發者設定

### 4.1 建立 Application 與 Bot

1. 前往 Discord Developer Portal → **New Application**。
2. **OAuth2** 頁面：
   - 複製 **Client ID** → 之後設為 `DISCORD_CLIENT_ID`。
   - **Reset Secret** 取得 **Client Secret** → `DISCORD_CLIENT_SECRET`。
3. **Bot** 頁面：
   - **Reset Token** 取得 Bot Token → `DISCORD_BOT_TOKEN`。
   - Bot 必須被邀請進目標伺服器（`DISCORD_TARGET_GUILD_ID`），並能看到目標頻道，Worker 才能判斷使用者是否有該頻道的檢視權限。

### 4.2 OAuth2 Redirect URI

前端用 `window.location.origin + window.location.pathname` 當作 `redirect_uri`（見 `frontend/static/auth.js`），所以**使用者實際開啟的每一個網址路徑都要註冊**，否則 Discord 會回 `Invalid OAuth2 redirect_uri`。

在 **OAuth2 → Redirects** 加入（依實際網址替換）：

```text
https://loa-boss-web.<子網域>.workers.dev/
https://loa-boss-web.<子網域>.workers.dev/index.html
http://localhost:8090/
http://localhost:8090/index.html
```

若有綁自訂網域，也要把自訂網域的網址一併加入。

### 4.3 Webhook（選填）

在各 Discord 頻道 → 編輯頻道 → 整合 → Webhook 建立，取得網址後於第 5.3 節設定。對應關係：

| Secret 名稱 | 用途 |
| --- | --- |
| `DISCORD_WEBHOOK_ELDER` | 魂塔長老 |
| `DISCORD_WEBHOOK_TOWER` | 塔類 Boss |
| `DISCORD_WEBHOOK_CAMP` | 營地類 Boss |
| `DISCORD_WEBHOOK_WILD` | 野外類 Boss |
| `DISCORD_WEBHOOK_TOWER_WATCHER` | 奧塔監視者類 Boss |
| `DISCORD_WEBHOOK_ALL` | 全部 Boss |
| `DISCORD_WEBHOOK_DRAGON` | 龍門開啟／關閉 |

沒設定的 Webhook 會直接略過，不影響其他功能。

---

## 5. 部署後端：cloudflare-worker

> ⚠️ 本節所有 `wrangler` 指令都要在 `cloudflare-worker/` 目錄執行，並加上 `--config wrangler.toml`（或用 `npm run deploy`、`npm run dev`）。
> Wrangler 尋找設定檔時會優先採用上層目錄的 `wrangler.jsonc`，不加 `--config` 會改成部署／設定根目錄的前端 `loa-boss-web`，Worker 本身卻沒有更新。

### 5.1 安裝相依套件

```bash
cd cloudflare-worker
npm ci
```

### 5.2 確認 `wrangler.toml`

```toml
name = "loa-boss-worker"
main = "src/index.js"
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [{ name = "BOSS_ROOM", class_name = "BossRoom" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["BossRoom"]
```

- `new_sqlite_classes` 代表使用 **SQLite 型 Durable Object**，這是 Workers 免費方案唯一可用的 Durable Object 類型，**請勿改成 `new_classes`**。
- `[[migrations]]` 的 `tag` 一旦部署過就不要修改或刪除；未來若新增／更名 DO 類別，要追加新的 migration（`v2`…）。
- 整點刷新由 Durable Object Alarm 處理，**不需要** Cron Trigger。

### 5.3 設定 Secrets

所有機密一律用 `wrangler secret put`，不要寫進 `wrangler.toml` 或程式碼。每條指令執行後會提示貼上數值：

```bash
# 必填：登入驗證
npx wrangler secret put DISCORD_CLIENT_ID --config wrangler.toml
npx wrangler secret put DISCORD_CLIENT_SECRET --config wrangler.toml
npx wrangler secret put DISCORD_BOT_TOKEN --config wrangler.toml
npx wrangler secret put AUTH_JWT_SECRET --config wrangler.toml

# 選填：目標伺服器／頻道（未設定則使用程式內預設值）
npx wrangler secret put DISCORD_TARGET_GUILD_ID --config wrangler.toml
npx wrangler secret put DISCORD_TARGET_CHANNEL_ID --config wrangler.toml

# 選填：Webhook 推播
npx wrangler secret put DISCORD_WEBHOOK_ELDER --config wrangler.toml
npx wrangler secret put DISCORD_WEBHOOK_TOWER --config wrangler.toml
npx wrangler secret put DISCORD_WEBHOOK_CAMP --config wrangler.toml
npx wrangler secret put DISCORD_WEBHOOK_WILD --config wrangler.toml
npx wrangler secret put DISCORD_WEBHOOK_TOWER_WATCHER --config wrangler.toml
npx wrangler secret put DISCORD_WEBHOOK_ALL --config wrangler.toml
npx wrangler secret put DISCORD_WEBHOOK_DRAGON --config wrangler.toml
```

`AUTH_JWT_SECRET` 請用高強度隨機字串，可用以下指令產生：

```bash
openssl rand -base64 48
```

> 更換 `AUTH_JWT_SECRET` 會讓所有已登入使用者的憑證失效，需要重新登入。

確認已設定的 secrets（只會列出名稱，不會顯示值）：

```bash
npx wrangler secret list --config wrangler.toml
```

> 第一次部署前若 Worker 尚不存在，`secret put` 會詢問是否建立，回答 `y` 即可；也可以先執行 5.4 部署，再回來設 secrets。

### 5.4 部署

```bash
npx wrangler deploy --config wrangler.toml
```

成功後會輸出網址，例如：

```text
https://loa-boss-worker.f96003.workers.dev
```

### 5.5 驗證

```bash
WORKER=https://loa-boss-worker.<子網域>.workers.dev

curl -s $WORKER/api/status
curl -s $WORKER/api/auth/config     # clientId 不應為空字串
curl -s $WORKER/api/boss-data | head -c 500
```

### 5.6 本地開發（參考）

```bash
cp .dev.vars.example .dev.vars   # 填入測試值，.dev.vars 已被 .gitignore 排除
npx wrangler dev --config wrangler.toml                 # http://localhost:8787
```

---

## 6. 部署前端：frontend

前端以 **Workers Static Assets** 部署，設定檔是專案根目錄的 `wrangler.jsonc`：

```jsonc
{
  "name": "loa-boss-web",
  "compatibility_date": "2026-10-12",
  "assets": { "directory": "./frontend" }
}
```

純靜態資源請求在免費方案中**不計入** Workers 請求次數。

### 6.1 修改 Worker 網址

編輯 `frontend/static/config.js`，確認雲端網址指向第 5 節部署的 Worker：

```js
const DISCORD_AUTH_API_BASE = USE_LOCAL_WORKER
    ? 'http://localhost:8787'
    : 'https://loa-boss-worker.<子網域>.workers.dev';

const WEBRTC_WS_URL_OVERRIDE = USE_LOCAL_WORKER
    ? 'ws://localhost:8787/ws'
    : 'wss://loa-boss-worker.<子網域>.workers.dev/ws';
```

同檔案的 `let debug = true;` 會輸出較多除錯訊息，正式環境可視需要改為 `false`。

### 6.2 部署

在**專案根目錄**執行（不是 `frontend/` 內）：

```bash
cd /path/to/loa-boss-cloud
npx wrangler deploy
```

成功後輸出網址，例如：

```text
https://loa-boss-web.<子網域>.workers.dev
```

### 6.3 本地預覽（參考）

```bash
node serve.cjs   # http://localhost:8090
```

在瀏覽器 Console 執行以下指令可讓前端改連本地 Worker（再執行一次並設為 `false` 即可切回雲端）：

```js
localStorage.setItem('loa_use_local_worker', 'true')
```

### 6.4 自訂網域（選填）

若網域已託管在 Cloudflare：Workers & Pages → `loa-boss-web` → **Settings → Domains & Routes → Add → Custom Domain**。綁定後記得把新網址加進第 4.2 節的 Redirect URI。

### 6.5 完成後回到 Discord

把前端的正式網址加入 OAuth2 Redirects（第 4.2 節），否則登入會失敗。

---

## 7. 部署監聽器：discord-listener（GCP 免費 VM）

### 7.1 為什麼選這個方案

listener 是**需要 7×24 常駐的 WebSocket 長連線程式**，不能跑在會自動休眠或有請求時間上限的 Serverless（Cloud Run、Cloud Functions）。GCP 的 Always Free 方案提供：

| 項目 | 免費額度 |
| --- | --- |
| VM | 每月 1 台 `e2-micro`（限 `us-west1`、`us-central1`、`us-east1`） |
| 磁碟 | 30 GB **標準永久磁碟（Standard persistent disk）** |
| 網路輸出 | 每月 1 GB（北美出發，中國與澳洲目的地除外） |

listener 記憶體約 30 MB、流量極小，完全在額度內。

> ⚠️ 以下三點設錯就會產生費用，建立 VM 時請特別注意：
> 1. **區域**只能選 `us-west1`（奧勒岡）、`us-central1`（愛荷華）、`us-east1`（南卡羅來納）。
> 2. **機型**必須是 `e2-micro`。
> 3. **開機磁碟類型**必須改成「**標準永久磁碟**」（主控台預設是「平衡永久磁碟」，會收費），大小 ≤ 30 GB。
>
> 免費額度條款會變動，以 [Google Cloud Free Tier 官方說明](https://cloud.google.com/free/docs/free-cloud-features#compute) 為準。外部 IPv4 位址的計費規則也曾調整過，建議依第 10 節設定預算警示，第一個月結束後檢查帳單。

延遲考量：listener 與 Discord、Cloudflare 之間的連線都在美國骨幹上，選美國區域對擊殺通知延遲影響極小（通常 < 1 秒）。

### 7.2 建立 VM（主控台操作）

1. 進入 **Compute Engine → VM 執行個體 → 建立執行個體**（第一次使用需先啟用 Compute Engine API）。
2. 設定：

| 欄位 | 值 |
| --- | --- |
| 名稱 | `loa-discord-listener` |
| 區域 / 可用區 | `us-west1` / `us-west1-b`（或另外兩個免費區域） |
| 機器系列 / 類型 | E2 / `e2-micro` |
| 開機磁碟 | Debian 12，**標準永久磁碟**，10 GB |
| 防火牆 | **不要**勾選允許 HTTP / HTTPS（listener 不需要對內連線） |
| 網路 → 外部 IPv4 | 臨時（Ephemeral）。listener 需要對外連線，沒有外部 IP 就得額外付費使用 Cloud NAT |

3. 按 **建立**。

### 7.2（替代）用 gcloud 建立

```bash
gcloud config set project <你的專案 ID>

gcloud compute instances create loa-discord-listener \
  --zone=us-west1-b \
  --machine-type=e2-micro \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=10GB \
  --boot-disk-type=pd-standard
```

### 7.3 連線到 VM

主控台 VM 列表點 **SSH** 按鈕；或在本機：

```bash
gcloud compute ssh loa-discord-listener --zone=us-west1-b
```

以下 7.4 ~ 7.8 皆在 **VM 內** 執行。

### 7.4 系統初始化

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates

# 時區設為台灣（只影響 log 顯示時間，方便對照）
sudo timedatectl set-timezone Asia/Taipei
```

`e2-micro` 只有 1 GB 記憶體，建議加 1 GB swap，避免 `apt upgrade` 或 `npm ci` 時 OOM：

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

### 7.5 安裝 Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

> 直接用 systemd 跑 Node 比 Docker 省約 100 MB 記憶體，在 1 GB 的機器上比較穩。專案內的 `Dockerfile` 仍保留給其他平台使用。

### 7.6 取得程式碼

建立專用帳號（不用 root 跑服務）並放到 `/opt/loa`：

```bash
sudo useradd --system --create-home --home-dir /opt/loa --shell /usr/sbin/nologin loa
```

**方式 A：從 GitHub clone**（repo 為 private 時需先設定 [Deploy Key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) 或改用方式 B）

```bash
sudo -u loa git clone https://github.com/Scott96003/loa-boss-cloud.git /opt/loa/loa-boss-cloud
```

**方式 B：從本機上傳**（在**本機**執行）

```bash
cd /path/to/loa-boss-cloud
tar czf /tmp/listener.tgz --exclude=node_modules --exclude=.env discord-listener
gcloud compute scp /tmp/listener.tgz loa-discord-listener:/tmp/ --zone=us-west1-b
```

接著在 VM 內：

```bash
sudo mkdir -p /opt/loa/loa-boss-cloud
sudo tar xzf /tmp/listener.tgz -C /opt/loa/loa-boss-cloud
sudo chown -R loa:loa /opt/loa
```

安裝套件：

```bash
cd /opt/loa/loa-boss-cloud/discord-listener
sudo -u loa npm ci --omit=dev
```

### 7.7 設定環境變數

```bash
cd /opt/loa/loa-boss-cloud/discord-listener
sudo -u loa cp .env.example .env
sudo -u loa nano .env
sudo chmod 600 .env
```

內容範例：

```ini
DISCORD_USER_TOKEN="<你的 User Token>"
TARGET_CHANNEL_ID="1527172467016335493"
WORKER_API_URL="https://loa-boss-worker.<子網域>.workers.dev/api/boss-death"
KEYWORD="LoA363 頭目擊殺記錄 Boss Kills"

# 選填：伺服器重啟偵測（未設定時使用程式內預設值）
# REBOOT_CHANNEL_ID="1527158850648543385"
# REBOOT_KEYWORD="伺服器重啟完成，滅光戒指數值已更新。"
```

- `WORKER_API_URL` **必須以 `/api/boss-death` 結尾**，程式會自動把它替換成 `/api/server-reboot`、`/api/boss-data` 來呼叫其他 API。
- User Token 取得方式見 `discord-listener/README.md`。Token 等同帳號密碼，`.env` 權限設 `600`，不要提交到 Git。
- 使用 User Token 屬於 Discord 服務條款的灰色地帶，請自行評估帳號風險。

先手動跑一次確認可以連線：

```bash
sudo -u loa node index.js
```

看到 `🎉 [驗證成功]` 與 `🎯 [監聽中]` 就代表正常，按 `Ctrl+C` 結束，進入下一步。

### 7.8 設定 systemd 常駐

```bash
sudo tee /etc/systemd/system/loa-listener.service > /dev/null <<'EOF'
[Unit]
Description=LOA Boss Discord Listener
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=loa
WorkingDirectory=/opt/loa/loa-boss-cloud/discord-listener
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
# 防止記憶體洩漏拖垮整台機器
MemoryMax=300M

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now loa-listener
sudo systemctl status loa-listener
```

- 程式內建 Gateway 斷線 5 秒後重連；systemd 的 `Restart=always` 則負責程式整個崩潰時的重啟。
- VM 重開機後會自動啟動（`enable`）。

### 7.9 查看 Log

```bash
# 即時追蹤
sudo journalctl -u loa-listener -f

# 最近 200 行
sudo journalctl -u loa-listener -n 200 --no-pager

# 今天的紀錄
sudo journalctl -u loa-listener --since today
```

限制 journal 大小，避免長期佔滿磁碟：

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' | sudo tee /etc/systemd/journald.conf.d/size.conf
sudo systemctl restart systemd-journald
```

### 7.10 自動安全更新（建議）

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## 8. 部署後驗證清單

| # | 檢查項目 | 方法 | 預期結果 |
| --- | --- | --- | --- |
| 1 | Worker 存活 | `curl $WORKER/api/status` | 回傳 JSON |
| 2 | OAuth 設定 | `curl $WORKER/api/auth/config` | `clientId` 有值 |
| 3 | 前端載入 | 瀏覽器開前端網址 | 頁面正常、Console 無紅字 |
| 4 | WebSocket | 開發者工具 → Network → WS | `/ws` 連線狀態 101 且持續連著 |
| 5 | Discord 登入 | 前端點登入 | 跳轉 Discord 授權後回到前端並顯示使用者 |
| 6 | listener 運作 | `journalctl -u loa-listener -n 50` | 有 `驗證成功`、`監聽中` |
| 7 | 端到端 | 等待頻道出現擊殺紀錄 | listener log 顯示推送成功，前端即時更新 |
| 8 | Webhook | 觸發一次對應 Boss 死亡 | 對應 Discord 頻道收到通知 |

想在不等真實擊殺的情況下測試第 7 項，可手動 POST（**會寫入正式資料並推播 Webhook**，請用測試環境或確認後再做）：

```bash
curl -X POST $WORKER/api/boss-death \
  -H "Content-Type: application/json" \
  -d '{"deathInfo": {"bossName": "巨蟻女皇", "deathTime": "2026-10-15 08:00"}}'
```

---

## 9. 日常更新流程

### 9.1 更新 Worker

```bash
cd cloudflare-worker
npx wrangler deploy --config wrangler.toml
```

- 部署是原子性的，幾秒內全球生效；Durable Object 內的資料**不會**因部署而清除。
- 部署會讓既有 WebSocket 連線中斷一次，前端會自動重連。
- 出問題時回滾：

```bash
npx wrangler deployments list --config wrangler.toml
npx wrangler rollback --config wrangler.toml            # 回到上一個版本
```

- 存檔格式：`meta`（Boss 設定、設定值）＋ `deaths:<id>`（每隻 Boss 的擊殺明細），擊殺明細保留到伺服器重開機或最多 60 天。訊息區與剩餘數量都由擊殺明細即時產生，不另外儲存。
- 舊版整份存檔 `mainData` 在第一次搬移後保留不刪。回滾到分開儲存之前的版本時，舊版程式會讀到搬移當下的資料（之後的擊殺不會出現）。

### 9.2 更新前端

```bash
cd /path/to/loa-boss-cloud
npx wrangler deploy
```

瀏覽器可能有快取，驗證時用強制重新整理（`Cmd+Shift+R`）。

### 9.3 更新 listener

方式 A（git）：

```bash
gcloud compute ssh loa-discord-listener --zone=us-west1-b
cd /opt/loa/loa-boss-cloud
sudo -u loa git pull
cd discord-listener
sudo -u loa npm ci --omit=dev
sudo systemctl restart loa-listener
sudo journalctl -u loa-listener -n 30 --no-pager
```

方式 B（上傳）：重複第 7.6 節方式 B 的打包上傳與解壓（`.env` 已排除，不會被覆蓋），再執行上面的 `npm ci` 與 `restart`。

### 9.5 新增 Boss 或分類

Boss 與分類設定都在 `cloudflare-worker/src/`，改完後依 9.1 部署 Worker 即可。

- **新增 Boss**：在 `defaultBossList.json` 加一筆。可用欄位：
  - `bossCount`：每輪隻數，預設 1。
  - `countMode: "unfixed"`：每輪隻數不固定，數量欄改顯示「已擊殺 N」。
  - `areas`：受限區域名稱 (Discord 擊殺訊息的地點，例如 `傲慢之塔 30樓 Tower of Insolence 30F`)。只要某個區域出現在任一 Boss 的 `areas`，listener 在該區域就只接受 `areas` 列有它的 Boss；listener 每 10 分鐘向 Worker 更新一次。
- **調整分類**：修改 `categories.json`，每個分類列出自己的 `ids`：
  - `button: true`：會出現在前端的篩選按鈕。
  - `webhook`：參與輪迴刷新推播；`secret` 為 Webhook 的 secret 名稱，`label` 為推播顯示名稱（預設用 `name`）。新的 secret 需另外 `wrangler secret put`。Alarm 每個整點檢查一次：分類內任一隻 Boss 的區段換了就推播。各分類上次推播的區段記錄在 `config.lastRespawnRanges`（以 secret 名稱為 key），新分類第一次只記錄、不推播。
- Worker 啟動時會依 id 同步存檔：補入新 Boss，並同步既有 Boss 的 `bossName`、`respawnTime`、`bossCount`、`countMode`、`areas`；死亡紀錄不受影響。從 JSON 移除的 Boss 不會從存檔刪除。

### 9.4 更換 Discord User Token

User Token 在變更密碼、登出所有裝置時會失效，listener log 會出現驗證失敗。更新步驟：

```bash
sudo -u loa nano /opt/loa/loa-boss-cloud/discord-listener/.env
sudo systemctl restart loa-listener
```

---

## 10. 免費額度與費用控管

### 10.1 Cloudflare Workers Free

| 項目 | 免費額度（每日） | 本專案的使用情況 |
| --- | --- | --- |
| Worker 請求 | 100,000 次 | API 呼叫、WebSocket 建立連線 |
| Durable Object 請求 | 100,000 次 | WebSocket 收到的訊息以 20:1 折算 |
| Durable Object 執行時間 | 13,000 GB-s | 已使用 WebSocket Hibernation（`acceptWebSocket`），閒置連線不計時 |
| Durable Object 儲存 | 5 GB（總量）；單一 key 上限 2 MB | 擊殺明細保留 60 天約 3 MB，每隻 Boss 分開一個 key（最大約 250 KB） |
| Durable Object 寫入 | 100,000 列 | 每筆擊殺寫入 2 列（meta + 該 Boss 的 deathList） |
| Durable Object 讀取 | 5,000,000 列 | 物件喚醒時讀取約 73 列（meta + 每隻 Boss 一列） |
| 靜態資源請求 | 不限、不計費 | 前端頁面、JS、CSS |

- 免費方案超量時**不會扣款**，而是當日請求被拒絕（回 1027 / 429 錯誤），隔天 UTC 0 點重置。
- 用量查看：Cloudflare Dashboard → Workers & Pages → `loa-boss-worker` → **Metrics**。
- 主要風險是前端心跳（ping）過於頻繁。線上人數 × 每分鐘訊息數 × 1440 ÷ 20 應遠低於 100,000。

### 10.2 GCP

1. **設定預算警示**：Billing → 預算與快訊 → 建立預算，金額設 `1 USD`，在 50% / 90% / 100% 時寄信通知。
2. 第一個月結束後到 **Billing → 報表** 確認費用為 0，若有費用依 SKU 找出來源（常見為磁碟類型、區域選錯或外部 IP）。
3. **不要**建立第二台 VM、快照或額外磁碟，都會超出免費額度。
4. 免費試用的 300 USD 抵免額到期後，Always Free 仍持續有效，但需要升級為付費帳戶，否則 VM 會被停止。

---

## 11. 疑難排解

### 前端

| 症狀 | 可能原因 | 處理 |
| --- | --- | --- |
| 登入時 Discord 顯示 `Invalid OAuth2 redirect_uri` | 目前網址未註冊 | 把網址列的 origin + 路徑（不含 `?` 與 `#`）加入 Redirects |
| 登入後顯示無權限 | 帳號看不到目標頻道，或 Bot 不在伺服器 | 確認 Bot 已加入 `DISCORD_TARGET_GUILD_ID` 且能看到該頻道 |
| WebSocket 一直斷線重連 | `config.js` Worker 網址錯誤，或當日額度用盡 | 檢查 Console 與 Worker Metrics |
| 改了程式但畫面沒變 | 瀏覽器快取 | 強制重新整理 |

### Worker

```bash
cd cloudflare-worker
npx wrangler tail --config wrangler.toml          # 即時查看正式環境 log（含 console.log）
```

| 症狀 | 可能原因 | 處理 |
| --- | --- | --- |
| 部署失敗提到 Durable Object migration | 修改了既有 migration tag | 恢復原 tag，新變更改用新的 migration |
| `/api/auth/config` 的 `clientId` 為空 | 未設定 secret | `npx wrangler secret put DISCORD_CLIENT_ID --config wrangler.toml` |
| Webhook 沒推播 | 未設定或 Webhook 已被刪除 | `npx wrangler secret list --config wrangler.toml` 確認，重新設定 |

### listener

| 症狀 | 可能原因 | 處理 |
| --- | --- | --- |
| 啟動即結束，提示缺少 Token | `.env` 未設定或路徑錯 | 確認 `WorkingDirectory` 下有 `.env` |
| Gateway 驗證失敗 / 4004 | User Token 失效 | 依 9.4 節更換 |
| 推送 Worker 失敗 | `WORKER_API_URL` 錯誤或 Worker 故障 | VM 上 `curl` 該網址的 `/api/status` 測試 |
| 服務一直重啟 | 程式錯誤 | `journalctl -u loa-listener -n 200` 看錯誤堆疊 |
| SSH 連不上 | VM 記憶體耗盡卡住 | 主控台對 VM 按「重設」，並確認已設定 swap |

---

## 12. 附錄：環境變數一覽

### cloudflare-worker（`wrangler secret put`；本地開發用 `.dev.vars`）

| 名稱 | 必填 | 說明 |
| --- | --- | --- |
| `DISCORD_CLIENT_ID` | ✅ | Discord Application Client ID |
| `DISCORD_CLIENT_SECRET` | ✅ | Discord Application Client Secret |
| `DISCORD_BOT_TOKEN` | ✅ | 用來查詢使用者頻道權限的 Bot Token |
| `AUTH_JWT_SECRET` | ✅ | 簽發登入憑證用的密鑰 |
| `DISCORD_TARGET_GUILD_ID` | | 目標伺服器 ID，預設 `1198482702932914277` |
| `DISCORD_TARGET_CHANNEL_ID` | | 目標頻道 ID，預設 `1426495371332292608` |
| `DISCORD_WEBHOOK_ELDER` | | 魂塔長老推播 |
| `DISCORD_WEBHOOK_TOWER` | | 塔類推播 |
| `DISCORD_WEBHOOK_CAMP` | | 營地類推播 |
| `DISCORD_WEBHOOK_WILD` | | 野外類推播 |
| `DISCORD_WEBHOOK_TOWER_WATCHER` | | 奧塔監視者類推播 |
| `DISCORD_WEBHOOK_ALL` | | 全部 Boss 推播 |
| `DISCORD_WEBHOOK_DRAGON` | | 龍門開啟／關閉推播 |

### discord-listener（`.env`）

| 名稱 | 必填 | 預設值 | 說明 |
| --- | --- | --- | --- |
| `DISCORD_USER_TOKEN` | ✅ | — | 監聽用的 Discord 個人帳號 Token |
| `WORKER_API_URL` | ✅ | `http://localhost:8787/api/boss-death` | Worker 擊殺 API，必須以 `/api/boss-death` 結尾 |
| `TARGET_CHANNEL_ID` | | `1527172467016335493` | 擊殺紀錄頻道 |
| `KEYWORD` | | `LoA363 頭目擊殺記錄 Boss Kills` | 觸發解析的關鍵字 |
| `REBOOT_CHANNEL_ID` | | `1527158850648543385` | 伺服器重啟公告頻道 |
| `REBOOT_KEYWORD` | | `伺服器重啟完成，滅光戒指數值已更新。` | 重啟公告關鍵字 |

### frontend（寫在 `frontend/static/config.js`）

| 名稱 | 說明 |
| --- | --- |
| `DISCORD_AUTH_API_BASE` | Worker HTTP 網址 |
| `WEBRTC_WS_URL_OVERRIDE` | Worker WebSocket 網址（`wss://…/ws`） |
| `debug` | 是否輸出除錯訊息 |
