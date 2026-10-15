const DB_NAME = 'MyBossAppDB';
const STORE_NAME = 'bossListStore'; // 儲存資料的「表」名稱

let db; // 全域變數來儲存資料庫連線

function openDatabase() {
    return new Promise((resolve, reject) => {
        // 請求打開資料庫，版本號是 1
        const request = indexedDB.open(DB_NAME, 1);

        request.onerror = (event) => {
            console.error("IndexedDB 打開失敗:", event.target.errorCode);
            reject("Database error");
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log("IndexedDB 連線成功。");
            resolve(db);
        };

        // 只有在資料庫第一次建立或版本號升級時才會執行
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            // 建立一個物件儲存空間 (Object Store)，類似於資料庫中的「表」
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' }); // 使用 id 作為唯一鍵
                console.log("Object Store 已建立。");
            }
        };
    });
}

// 儲存函式：將記憶體中的 bossListData 寫入硬碟
async function saveBossListToDB(data) {
    if (!db) await openDatabase(); // 確保資料庫已開啟

    return new Promise((resolve, reject) => {
        // 1. 建立交易 (Transaction)
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        // 2. 準備要儲存的物件 (為它加上一個固定的 id)
        const dataToStore = {
            id: 1, // 使用固定的 ID 確保每次都覆蓋同一筆資料
            content: data, // 儲存您的實際資料
            timestamp: new Date().getTime()
        };

        // 3. 執行 put (如果存在則更新，不存在則新增)
        const request = store.put(dataToStore);

        request.onsuccess = () => {
            console.log("✅ 資料已成功儲存到 IndexedDB。");
            resolve();
        };

        request.onerror = (event) => {
            console.error("❌ 儲存失敗:", event.target.error);
            reject(event.target.error);
        };
    });
}

// 讀取函式：從硬碟讀取資料到記憶體的 bossListData 變數
async function loadBossListFromDB() {
    if (!db) await openDatabase(); // 確保資料庫已開啟

    return new Promise((resolve, reject) => {
        // 1. 建立唯讀交易
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);

        // 2. 根據 ID 取得資料
        const request = store.get(1); // 取得 ID 為 1 的紀錄

        request.onsuccess = (event) => {
            const result = event.target.result;
            if (result && result.content) {
                // 將讀取到的資料設定給全域變數
                bossListData = result.content;
                console.log("資料已從 IndexedDB 載入。");
                resolve(bossListData);
            } else {
                console.log("IndexedDB 中沒有找到資料，使用預設值。");
                resolve(null);
            }
        };

        request.onerror = (event) => {
            console.error("❌ 讀取失敗:", event.target.error);
            reject(event.target.error);
        };
    });
}