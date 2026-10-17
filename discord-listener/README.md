# Discord Boss 擊殺即時監聽器 (User Token 版)

本目錄為第三步（資料獲取雲端化）之專案，專門用於**完全取代本機的 Chrome 擴充套件 (`content.js`)**。

身為普通玩家（無伺服器管理員權限），本腳本可透過您個人帳號的 **User Token** 直接與 Discord 官方 Gateway (WebSocket) 建立長連線，在雲端 **7x24 小時秒級監聽** 目標頻道，一旦出現擊殺紀錄，即刻過濾並 POST 給第二步的 Cloudflare Worker。

---

## 🌟 核心特色

1. **秒級即時同步**：
   * 採用 Discord Gateway WebSocket 事件驅動，延遲在 **0 ~ 1 秒內**（非定時輪詢）。
2. **完整繼承 content.js 的過濾與解析規則**：
   * 包含傲慢之塔樓層比對、百鬼活動跳過、無效區域排除（奇岩競技場、奇怪的村落等）。
   * 自動判斷大隱龍與小隱龍類型。
3. **超極致輕量**：
   * 記憶體佔用小於 **30 MB**，連線 CPU 佔用接近 0%，極為適合運行在任何免費雲端微容器上。

---

## 🔑 如何取得個人 Discord User Token？

由於您是普通玩家，腳本需要您的 User Token 來代表您在雲端「閱讀」目標頻道：

1. 使用電腦瀏覽器（Chrome / Edge）打開 [Discord 網頁版](https://discord.com/app) 並登入帳號。
2. 按鍵盤 `F12` 打開「開發者工具」（Developer Tools），切換到 **「網路 (Network)」** 分頁。
3. 在上方篩選器中輸入 `/api` 或 `messages`。
4. 點擊 Discord 左側隨便一個伺服器或聊天頻道，此時 Network 列表中會出現多筆請求（例如 `messages`、`science` 或 `@me`）。
5. 點擊其中任一筆請求，在右側的 **「標頭 (Headers)」** 區塊中往下滾動，找到 **「Request Headers」**。
6. 找到 **`authorization`** 欄位，後方那一長串由英數字組成的字串即為您的 **User Token**（複製它）。

> ⚠️ **安全警告**：
> * Token 等同於您的帳號登入通行證，**請勿將 Token 公開洩漏給他人或上傳至公開的 GitHub 倉庫**！
> * 請務必將 Token 妥善存放在 `.env` 檔案中。

---

## 🚀 本地測試執行

1. **進入目錄並設定環境變數**：
   ```bash
   cd discord-listener
   cp .env.example .env
   ```
   打開 `.env` 檔案，填入您的 Token 與第二步的 Worker API 網址：
   ```env
   DISCORD_USER_TOKEN="你的_TOKEN_貼在這裡"
   TARGET_CHANNEL_ID="1527172467016335493"
   WORKER_API_URL="http://localhost:8787/api/boss-death" # 或填寫已部署的 Cloudflare Worker 網址
   ```

2. **安裝依賴並啟動**：
   ```bash
   npm install
   npm start
   ```
   看到 `🎉 [驗證成功]` 與 `🎯 [監聽中]` 即代表成功掛機！當頻道有 Boss 死亡訊息時，終端機會即時印出解析並自動推送給 Worker。

   啟動時預設只補抓「雲端最後一筆擊殺 (往前 10 分鐘緩衝)」之後的擊殺訊息。若需要完整回溯到重啟時間 / 7 天前，請改用：
   ```bash
   npm run start:full
   ```
   或設定環境變數 `FULL_SYNC=1` (例如 Fly.io：`fly secrets set FULL_SYNC=1`，用完記得 `fly secrets unset FULL_SYNC`)。

---

## 🔁 啟動回溯與重連說明

### 啟動時的歷史回溯
每次登入成功 (收到 `READY`) 後，listener 會自動補抓斷線期間漏掉的擊殺：

1. **重啟定位**：到重啟頻道找最後一筆重啟公告；若是雲端尚未記錄的新重啟，會通知 Worker 清除重啟前的擊殺。
2. **區間採集**：從擊殺頻道「當前時間」往回抓，回溯終點依模式而定：
   | 模式 | 回溯終點 |
   | --- | --- |
   | 預設 (`npm start`) | 雲端最後一筆擊殺時間往前 10 分鐘；雲端無紀錄時同完整回溯 |
   | 完整回溯 (`npm run start:full` / `--full-sync` / `FULL_SYNC=1`) | 最後一次重啟時間與 7 天前，取較晚者 |
3. **缺漏檢查**：與雲端比對，只推播雲端尚未有的擊殺 (依時間由舊到新)。

預設模式下，啟動 log 會出現類似以下訊息，代表已改為增量回溯：
```
⏱️ [截止條件] 雲端最後一筆擊殺為 2026-10-17T05:30:00.000Z，改為只回溯至 2026-10-17T05:20:00.000Z (含 10 分鐘緩衝)。
```
若懷疑雲端資料有缺漏 (例如雲端曾被手動清空或改動)，請使用完整回溯重新補齊。

### Gateway 重連 (Opcode 7 / Resume)
Discord 會不定期送出 **Opcode 7 (Reconnect)** 要求客戶端重連 (負載平衡、節點維護等)，屬於正常現象。listener 的處理方式：

- 收到 Opcode 7 時主動關閉舊連線，5 秒後連到 `resume_gateway_url` 並送出 **Opcode 6 (Resume)** 接回原 session，斷線期間的事件由 Discord 補送，不會重新回溯歷史訊息。
- Resume 成功會印出 `✅ [Resume 成功]`；主動關閉的舊連線只會印 `🔌 [連線關閉] 已主動關閉舊連線 (代碼: 1006)`。1006 是強制切斷連線的正常代碼，可忽略。
- 收到 **Opcode 9 (Invalid Session)**：`d` 為 `true` 時重試 Resume，否則重新 Identify (會重新觸發上述歷史回溯)。
- 關閉代碼 `4007` / `4009` (session 失效) 會改為重新 Identify；`4004`、`4010`~`4014` (Token 錯誤、權限不足等) 為無法恢復的錯誤，會停止重連，請檢查 Token。

---

## ☁️ 免費 7x24 雲端部署（本機完全關機）

若要做到本機電腦完全關機，可將本專案部署到以下免費的雲端平台：

### 推薦 1：Fly.io（最方便、支援 Docker）
Fly.io 提供免費的 3 個 256MB VM，適合掛載輕量 Node.js 腳本：
1. 安裝 Flyctl CLI 並登入：`brew install flyctl && fly auth login`
2. 在 `discord-listener` 目錄下執行：
   ```bash
   fly launch
   ```
3. 設定環境變數機密：
   ```bash
   fly secrets set DISCORD_USER_TOKEN="你的Token" WORKER_API_URL="https://你的Worker網址/api/boss-death"
   ```
4. 執行部署：`fly deploy`，即可 24 小時在雲端常駐運行。

### 推薦 2：Koyeb（免費微容器）
1. 將本資料夾推送到您個人的 **Private (私人)** GitHub 倉庫。
2. 登入 [Koyeb.com](https://www.koyeb.com/) 建立免費 App，來源選擇該 GitHub 倉庫。
3. 在 Koyeb 後台的「Environment Variables」填入 `DISCORD_USER_TOKEN` 與 `WORKER_API_URL`。
4. 點擊 Deploy 即可自動建置並 7x24 小時運行。
