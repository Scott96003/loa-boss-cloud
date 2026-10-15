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


// const WEBHook_URL = {
//     all: "",//"https://discord.com/api/webhooks/1423523526886822029/VxlrpOgGG1lVyhr2DuKe6ZBipErl-aIxmh4mOruJvrrP0dnxvwuWfWYV6pjA1ey777iU",
//     長老: "",//"https://discord.com/api/webhooks/1430753158732316714/x9UXdEmpVOXZYFToK58bcOfz62IZ8xmQqJm4rECDqja363yXaLaOYqeqBR8qjl1hxAe8",
//     奧塔: "",//"https://discord.com/api/webhooks/1430767884837064764/cTiNEj5d6FHELphrtzJqI0i5E7M6vu-VDqE41CclfeCLNzzWUgQ1aNlgEXCgqVLoD-jw",
//     陣營: "",//"https://discord.com/api/webhooks/1430767972716118087/SsPrEejt32ufFv8yV7ds6otXC0XOOyeyqS7fjXGrWvJakV4m5JUDktYO-pAZ_GhgsjvR",
//     野外: "",//"https://discord.com/api/webhooks/1430860797642276935/0y_EQ4Nm9M_4QG-ERiH8BWu2oX8sLOY-FB4AsrxbSyqrqTCATJmHDKP7g6hrMbqgjICA",
//     龍門: ""//"https://discord.com/api/webhooks/1429656269811351603/ZPbySp5UDlwi46Rjs_Ll_RIkqsg_Tciwd3TsctFr7Jk3pOT7hpE_gxzA484uesRBLNSN"
// }



// const WEBHook_URL = {
//     all: "https://discord.com/api/webhooks/1431150352714960967/huFaG-ZgoOuKuKny451W7vModhKAhAuAMLIJ_S2v_GszL1rownQkztNVIbN_xGUm1VOe",
//     長老: "https://discord.com/api/webhooks/1431150384612638820/jIr8rxc43G6JRKlTancorbRPIcqRgNfyrNDXCsJT4fAVei1ahEmjzpQtd9evX2Gpv0jw",
//     奧塔: "https://discord.com/api/webhooks/1431150421178847262/ryk0u-ED8mUMGkSgVM433Z2UAFZM6fq3FB2Sw8nfdwLpjOWNt_x2vpejJB_9VZuwEiv5",
//     陣營: "https://discord.com/api/webhooks/1431150448106278914/WBW6zQMLAZF9LeSpafW6JVgerNMDB_hWJ7NOa8DWZ45-xx4FeYuNjIWuEh7iv6v5O_AJ",
//     野外: "https://discord.com/api/webhooks/1431150472466792458/saAMhqDZSb9kLrdaNHW9yL7GfudyRvVD70I67RV77O-bUU1TORSg0EbZaWtr1StvWiXa",
//     龍門: "https://discord.com/api/webhooks/1423613676425969795/aqm87n5Gwa0TR-SU0_IPib77aN-jG3OzEGUNZX-ehzKL0Jq43Un_Qoq9clN5J1wpZbFQ"
// }

const WEBHook_URL = {
    all: "",
    長老: "https://discord.com/api/webhooks/1508790867232817153/mImf5VH_bxNnYsSGjM7iX_s_aUoiGgbAc_yQ5p1UdJturAgiXhBxVw5MUHnEb09dNe7S",
    奧塔: "",
    陣營: "",
    野外: "",
    龍門: "https://discord.com/api/webhooks/1429656269811351603/ZPbySp5UDlwi46Rjs_Ll_RIkqsg_Tciwd3TsctFr7Jk3pOT7hpE_gxzA484uesRBLNSN"
}

