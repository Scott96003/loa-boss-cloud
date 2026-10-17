// 如果您同時使用 Web Audio (例如播放背景音樂)
let audioContext;
/**
 * TTS 自動播報解鎖模組
 * 確保在行動裝置上，語音合成 (TTS) 功能能夠被用戶互動解鎖。
 */

let isTTSReady = false; // 全局旗標：指示語音是否已解鎖

// ----------------------------------------------------
// 1. 判斷是否為行動裝置
// ----------------------------------------------------

function isMobileDevice() {
    // 簡單檢查 User Agent 字串是否包含常見的行動裝置關鍵字
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    return /android|iphone|ipad|ipod|windows phone/i.test(userAgent) && !window.MSStream;
}

// ----------------------------------------------------
// 2. 語音解鎖函式
// ----------------------------------------------------

function unlockTTS() {
    if (isTTSReady) return;

    console.log("嘗試在用戶互動中解鎖 TTS...");

    // 播放一個靜音且極短的語音，以通過瀏覽器的 Autoplay Policy 檢查
    try {
        const unlockUtterance = new SpeechSynthesisUtterance(" ");
        // 設置音量為 0，用戶不會聽到
        unlockUtterance.volume = 0;
        // 立即呼叫 speak，這是必須在用戶手勢中同步執行的關鍵步驟
        speechSynthesis.speak(unlockUtterance);

        // 設置旗標為 true
        isTTSReady = true;
        console.log("✅ TTS 語音引擎已成功解鎖。");

    } catch (e) {
        // 如果瀏覽器不支持語音合成，則禁用功能
        console.error("TTS 語音合成初始化失敗:", e);
        isTTSReady = false;
    }

    // 隱藏疊層
    const overlay = document.getElementById('tts-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }

    // ⭐ 提示：如果您的應用程式有任何需要在 TTS 解鎖後才能執行的自動化流程，
    // 請在這裡呼叫它們！例如：
    // startAutomatedBossTimeChecks(); 
}

document.addEventListener("DOMContentLoaded", function () {
    // 获取表格元素
    bossTable = document.getElementById("bossList");

    slider = document.getElementById("percentageSlider");
    display = document.getElementById("percentageDisplay");

    // 手機版：訊息區預設收起，避免遮住表格
    var isNarrowScreen = window.matchMedia("(max-width: 600px)").matches;
    if (isNarrowScreen) {
        document.getElementById('messageContainer').classList.add('hidden');
    }

    // 訊息按鈕
    document.getElementById('toggleMessageContainer').addEventListener('click', function () {
        var container = document.getElementById('messageContainer');
        container.classList.toggle('hidden');
        if (!container.classList.contains('hidden')) {
            this.classList.remove('has-unread');
            container.scrollTop = container.scrollHeight;
        }
    });

    setupMessageSheet();

    // 手機版音量按鈕：點擊開關音量滑桿，點其他地方自動收起
    var volumeControl = document.getElementById('volumeControl');
    document.getElementById('toggleVolumeBtn').addEventListener('click', function (event) {
        event.stopPropagation();
        volumeControl.classList.toggle('open');
    });
    volumeControl.addEventListener('click', function (event) {
        event.stopPropagation();
    });
    document.addEventListener('click', function () {
        volumeControl.classList.remove('open');
    });

    // 手機版龍門橫幅：點擊展開詳細狀態
    document.getElementById('dragonGateStatusContainer').addEventListener('click', function () {
        this.classList.toggle('expanded');
    });


    // 監聽拉條值的變化
    slider.addEventListener("input", () => {
        config.voiceCount = parseInt(slider.value, 10);
        display.textContent = `${config.voiceCount}%`;
        document.getElementById("volumeBtnLabel").textContent = `${config.voiceCount}%`;
        // 音量為個人設定，調整後立即存檔，不等延遲存檔
        localStorage.setItem("voiceCount", config.voiceCount);
    });


    const overlay = document.getElementById('tts-overlay');
    const unlockButton = document.getElementById('tts-unlock-button');

    // 如果偵測到是行動裝置
    if (isMobileDevice()) {
        console.log("偵測到行動裝置，強制用戶點擊以解鎖 TTS。");

        // 顯示疊層
        if (overlay) {
            overlay.style.display = 'block';
        }

        // 綁定解鎖事件
        if (unlockButton) {
            // 點擊按鈕後執行解鎖，並確保只執行一次
            unlockButton.addEventListener('click', unlockTTS, { once: true });
        }
    } else {
        // 如果是桌面端，直接嘗試解鎖 (通常桌面瀏覽器比較寬鬆)
        // 或者您也可以選擇在這裡不執行任何操作，直到第一次需要語音時才啟動。
        console.log("偵測到桌面裝置或無法識別，直接嘗試初始化。");
        isTTSReady = true; // 假設桌面端會自動允許
    }
});

document.addEventListener("DOMContentLoaded", function () {
    var buttonsContainer = document.getElementById("filterButtons");
    buttonsContainer.addEventListener("click", function (event) {
        if (event.target.tagName === "BUTTON") {
            buttonsContainer.querySelectorAll("button.active").forEach(btn => btn.classList.remove("active"));
            event.target.classList.add("active");
        }
        if (event.target.id === "trackBossNamesBtn") {
            console.log("trackBossNamesBtn");
            toggleTrackBossNames();
            return;
        }
        if (event.target.tagName === "BUTTON") {
            var filterBossIDs = event.target.getAttribute("data-boss-name");
            filterTable(filterBossIDs);
        }
    });
});

/**
 * 依 Worker /api/boss-data 回傳的 categories 產生分類篩選按鈕
 * 插在「顯示全部」與「追蹤清單」之間，重複呼叫時會先移除舊的分類按鈕
 * @param {Array<{name: string, ids: Array<number>}>} categories
 */
function renderCategoryButtons(categories) {
    if (!Array.isArray(categories)) return;
    window.bossCategories = categories;
    const buttonsContainer = document.getElementById("filterButtons");
    if (!buttonsContainer) return;

    const activeName = buttonsContainer.querySelector("button.active[data-category]")?.dataset.category;
    buttonsContainer.querySelectorAll("button[data-category]").forEach(btn => btn.remove());

    const trackBtn = document.getElementById("trackBossNamesBtn");
    categories.forEach(category => {
        const btn = document.createElement("button");
        btn.dataset.category = category.name;
        btn.setAttribute("data-boss-name", category.ids.join(","));
        btn.textContent = category.name;
        if (category.name === activeName) btn.classList.add("active");
        buttonsContainer.insertBefore(btn, trackBtn);
    });
}

function toggleTrackBossNames() {
    console.log("trackBossNames", trackBossNames);
    var filterBossIDs = bossListData
        .filter(item => trackBossNames.includes(item.bossName))
        .map(item => item.id)
        .join(",");

    console.log("filterBossIDs", filterBossIDs);
    filterTable(filterBossIDs);
}

window.onload = function () {
    // 1. 載入已儲存的欄位順序
    loadColumnConfig();

    // 2. 根據載入的配置繪製表格標頭
    renderTableHeaders();
    console.log("window onload");
    loadFromLocalStorage();
    setInterval(updateBossRemainingTime, 60 * 1000); // 每秒更新剩余时间

    // 雲端架構下由 WebSocket 穩定傳輸，前端不再於前景顯示 P2P 除錯面板
    const webrtcElem = document.getElementById("webrtc_div");
    if (webrtcElem) {
        webrtcElem.style.display = 'none';
    }

    if (isMobileDevice()) {
        document.getElementById("dragonGateStatusContainer").classList.toggle('hidden');
        // 用 add 而非 toggle：DOMContentLoaded 已在窄螢幕先收起，toggle 會把它又打開
        document.getElementById("messageContainer").classList.add('hidden');
    }
};
/**
 * 手機版訊息抽屜：與死亡歷史抽屜相同的操作方式
 * （點遮罩、✕、下滑拖曳、手機返回鍵皆可關閉）。
 * 開關狀態仍以 #messageContainer 的 hidden class 為準，其他程式照舊切換即可。
 */
function setupMessageSheet() {
    var sheet = document.getElementById('messageSheet');
    var container = document.getElementById('messageContainer');
    if (!sheet || !container) return;

    var panel = sheet.querySelector('.msg-panel');
    var grab = sheet.querySelector('.msg-grab');
    var mobileQuery = window.matchMedia("(max-width: 600px)");
    var prevOverflow = "";

    function isOpen() {
        return !container.classList.contains('hidden');
    }

    function close() {
        container.classList.add('hidden');
    }

    // 依 hidden class 同步抽屜狀態、鎖定背景捲動與返回鍵紀錄
    function sync() {
        var open = isOpen() && mobileQuery.matches;
        if (open === sheet.classList.contains('open')) return;
        sheet.classList.toggle('open', open);
        panel.style.transform = "";
        if (open) {
            prevOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            history.pushState({ messageSheet: true }, "");
            container.scrollTop = container.scrollHeight;
        } else {
            document.body.style.overflow = prevOverflow;
            // 由 ✕、遮罩或按鈕關閉時，消掉開啟時 push 的紀錄
            if (history.state && history.state.messageSheet) {
                history.back();
            }
        }
    }

    new MutationObserver(sync).observe(container, { attributes: true, attributeFilter: ['class'] });
    mobileQuery.addEventListener('change', sync);

    window.addEventListener('popstate', function () {
        if (sheet.classList.contains('open')) close();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && sheet.classList.contains('open')) close();
    });
    sheet.querySelector('.msg-backdrop').addEventListener('click', close);
    sheet.querySelector('.msg-close').addEventListener('click', close);

    // 拖曳標頭往下滑可關閉
    var startY = 0;
    var startTime = 0;
    var dragY = 0;
    var dragging = false;
    grab.addEventListener('touchstart', function (e) {
        if (e.target.closest('.msg-close')) return;
        dragging = true;
        startY = e.touches[0].clientY;
        startTime = Date.now();
        dragY = 0;
        panel.classList.add('msg-dragging');
    }, { passive: true });
    grab.addEventListener('touchmove', function (e) {
        if (!dragging) return;
        dragY = Math.max(0, e.touches[0].clientY - startY);
        panel.style.transform = "translateY(" + dragY + "px)";
    }, { passive: true });
    grab.addEventListener('touchend', function () {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove('msg-dragging');
        var velocity = dragY / Math.max(1, Date.now() - startTime);
        if (dragY > 120 || velocity > 0.6) {
            close();
        } else {
            panel.style.transform = "";
        }
    });

    sync();
}
