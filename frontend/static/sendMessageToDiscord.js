const 長老Boss = [45955,45956,45957,45958,45959,45960,45961,45962]
const 陣營Boss = [81082,45685,45674,45625,45753]
// const 奧塔Boss = [45513,45547,45606,45650,45652,45653,45654,45618,45672,45673]
const 奧塔Boss = [45606,45653,45654,45618,45672,45673]
const 奧塔AllBoss = [45513,45547,45606,45650,45652,45653,45654,45618,45672,45673]
const 野外Boss = [45614,45801,46142,46141,99085,99086,99065,45863]
// 合併多個陣列
const allDcCheckBoss = [...長老Boss, ...陣營Boss, ...奧塔AllBoss, ...野外Boss];

// --- 輪詢與時間判斷邏輯 ---
// ⚠️ 注意：輪迴時間刷新的 Webhook 推播已全面遷移至 Cloudflare Worker 後端 (Durable Object Alarm / Cron) 統一處理，
// 徹底避免多位成員同時開啟網頁造成 Discord 重複發送洗版，並確保無人開啟網頁時依然準時推播。
// 前端此處僅負責更新本機儀表板介面 (refresh)，不再由前端直接發送 Webhook。
setInterval(() => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  // 1. 找出所有監控 Boss 的重生結束小時 (去重並排序)
  const allTargetHours = [...new Set(
    bossListData
      .filter(item => allDcCheckBoss.includes(parseInt(item.id)))
      .map(item => parseInt(item.重生間隔.split('~')[1]))
  )].sort((a, b) => a - b);
  
  // 邊界檢查：如果沒有任何 Boss 資料
  if (allTargetHours.length === 0) {
      return; 
  }

  // 2. 找到下一個最近的小時
  const nextHourToday = allTargetHours.find(h => h >= hours);
  const newRange = nextHourToday !== undefined ? nextHourToday : allTargetHours[0];

  // 3. 判斷是否需要更新本機儀表板
  if (newRange !== config.lastRefreshBossTime) {
      config.lastRefreshBossTime = newRange;
      refresh(); 
      console.log('--- 本機介面更新：Boss 輪迴時間已切換至下一個小時 ---', newRange);
  }
  
}, 30 * 1000); // 30秒執行一次