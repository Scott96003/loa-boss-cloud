// 設定是否為debug模式
let debug = true;

// 後端 Worker API 網址 (Discord 驗證服務端點)
// 支援彈性切換本地開發 (localhost:8787) 與雲端 Cloudflare Worker
const USE_LOCAL_WORKER = (typeof localStorage !== "undefined" && localStorage.getItem("loa_use_local_worker") === "true") || (window.location.port === '8787');

const DISCORD_AUTH_API_BASE = USE_LOCAL_WORKER
    ? 'http://localhost:8787'
    : 'https://loa-boss-worker.f96003.workers.dev';

const WEBRTC_WS_URL_OVERRIDE = USE_LOCAL_WORKER
    ? 'ws://localhost:8787/ws'
    : 'wss://loa-boss-worker.f96003.workers.dev/ws';

