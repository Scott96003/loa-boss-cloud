// 全域變數：定義原始預設配置
const defaultColumnConfig = [

  { key: 'bossName', header: '頭目名稱', type: 'data', editable: true },
  { key: 'respawnCount', header: '剩餘數目', type: 'computed', editable: false, cellId: 'respawn-count' },
  { key: 'death', header: '死亡時間', type: 'data', editable: false, format: 'tooltip' },
  { key: 'emblem', header: '擊殺血盟', type: 'data', editable: false },
  { key: '重生間隔', header: '預估出生時間', type: 'computed', editable: false, cellId: 'respawn-range' },
  { key: '已死亡', header: '距離上次死亡/機率', type: 'computed', editable: false, style: { textAlign: 'center' }, cellId: 'time-gap' },
  { key: 'respawnTime', header: '間隔(h)', type: 'data', editable: false, style: { textAlign: 'center' } },
  { key: 'id', header: 'ID', type: 'data', editable: false, style: { textAlign: 'center' } },
  { key: '活動機率', header: '活動機率', type: 'computed', cellId: 'active-rate'  },
  { key: 'action', header: '操作', type: 'action' } // 刪除按鈕
];

// 全域變數：用於儲存當前使用的配置
var columnConfig = []; 
const CONFIG_STORAGE_KEY = 'bossListColumnConfig';

let draggedHeader = null;

function handleHeaderDragStart(e) {
  draggedHeader = this;
  e.dataTransfer.effectAllowed = 'move';
  // 透過 dataTransfer 傳遞 key
  e.dataTransfer.setData('text/plain', this.getAttribute('data-col-key')); 
  this.classList.add('dragging');
}

function handleHeaderDragEnter(e) {
  e.preventDefault(); 
  if (this !== draggedHeader) {
    this.classList.add('drag-over');
  }
}

function handleHeaderDragOver(e) {
  e.preventDefault(); 
  e.dataTransfer.dropEffect = 'move';
  if (this !== draggedHeader && !this.classList.contains('drag-over')) {
     this.classList.add('drag-over');
  }
}

function handleHeaderDragLeave(e) {
  this.classList.remove('drag-over');
}

function handleHeaderDrop(e) {
  e.stopPropagation(); 
  
  if (draggedHeader !== this) {
    const parentRow = this.parentNode;
    const targetKey = this.getAttribute('data-col-key');
    const draggedKey = draggedHeader.getAttribute('data-col-key');
    
    // 1. 在 DOM 中重新排列 th 元素
    const targetIndex = Array.from(parentRow.children).indexOf(this);
    const draggedIndex = Array.from(parentRow.children).indexOf(draggedHeader);

    if (draggedIndex < targetIndex) {
      parentRow.insertBefore(draggedHeader, this.nextSibling);
    } else {
      parentRow.insertBefore(draggedHeader, this);
    }
    
    // 2. 更新 columnConfig 陣列
    updateColumnConfigOrder(draggedKey, targetKey);
    
    // 3. 重新繪製 tbody 的內容以匹配新的順序
    reRenderTableBody(); 
    
    // 4. 儲存新的順序
    saveColumnConfig(); 
  }
  this.classList.remove('drag-over');
}

function handleHeaderDragEnd(e) {
  this.classList.remove('dragging');
  // 移除所有標頭的 drag-over 狀態
  const headers = document.querySelectorAll('#bossList th');
  headers.forEach(th => th.classList.remove('drag-over'));
  draggedHeader = null;
}


/**
 * 根據 DOM 拖曳結果，更新 columnConfig 陣列的順序。
 */
function updateColumnConfigOrder(draggedKey, targetKey) {
    const draggedItem = columnConfig.find(c => c.key === draggedKey);
    
    // 移除被拖曳的項目
    columnConfig = columnConfig.filter(c => c.key !== draggedKey);
    
    // 找到目標 key 的索引
    const targetIndex = columnConfig.findIndex(c => c.key === targetKey);

    // 重新插入被拖曳的項目
    // 由於我們是依據 DOM 順序來判斷插入位置，這裡可以直接根據 DOM 順序來重新建構 columnConfig
    const headerRow = document.querySelector('#bossList thead tr');
    const newOrderedKeys = Array.from(headerRow.children).map(th => th.getAttribute('data-col-key'));
    
    const configMap = new Map(defaultColumnConfig.map(c => [c.key, c]));
    columnConfig = newOrderedKeys
        .map(key => configMap.get(key))
        .filter(config => config !== undefined);
        
    console.log("columnConfig 陣列順序已更新。");
}


/**
 * 重新繪製表格 body，確保 cell 順序符合新的 columnConfig。
 * (需要先清空 tbody，然後用 bossListData 重新畫出所有列)
 */
function reRenderTableBody() {
    const bossTableBody = document.getElementById("bossList").getElementsByTagName("tbody")[0];
    
    // 1. 清空 tbody
    bossTableBody.innerHTML = ''; 
    
    // 2. 依據 bossListData 陣列的順序，使用新的 columnConfig 重新繪製所有列
    bossListData.forEach(data => {
        addBossTR(data); // addBossTR 會使用當前的 columnConfig
    });

    // 3. 確保 computed/動態內容被重新計算和更新 (例如剩餘時間、重生次數)
    updateBossRemainingTime();
}

/**
 * 根據 columnConfig 動態生成表格標頭 (<thead>)。
 */
/**
 * 根據 columnConfig 動態生成表格標頭 (<thead>) 並新增拖曳功能。
 */
function renderTableHeaders() {
    const bossTable = document.getElementById("bossList");
    if (!bossTable) return;

    let currentThead = bossTable.querySelector('thead');
    if (currentThead) {
        bossTable.removeChild(currentThead);
    }
    
    const newThead = document.createElement('thead');
    const newTr = document.createElement('tr');

    columnConfig.forEach(config => {
        const th = document.createElement('th');
        th.textContent = config.header;
        th.setAttribute('data-col-key', config.key); // 儲存 key 以便識別
        
        // --- 新增拖曳屬性 ---
        th.setAttribute("draggable", "true"); 
        th.classList.add("draggable-header"); 
        th.style.cursor = 'grab';

        // --- 新增拖曳事件監聽器 ---
        th.addEventListener('dragstart', handleHeaderDragStart);
        th.addEventListener('dragenter', handleHeaderDragEnter);
        th.addEventListener('dragover', handleHeaderDragOver);
        th.addEventListener('dragleave', handleHeaderDragLeave);
        th.addEventListener('drop', handleHeaderDrop);
        th.addEventListener('dragend', handleHeaderDragEnd);
        
        newTr.appendChild(th);
    });

    newThead.appendChild(newTr);
    
    const tbody = bossTable.querySelector('tbody');
    if (tbody) {
        bossTable.insertBefore(newThead, tbody);
    } else {
        bossTable.appendChild(newThead);
    }
}