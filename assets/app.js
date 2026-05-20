/**
 * BBS Memo - Core Application Logic
 */

// ==========================================================================
// 1. Database Manager (IndexedDB)
// ==========================================================================
class DBManager {
  constructor(dbName = "BBSMemoDB", version = 1) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = (e) => {
        console.error("IndexedDB Open Error:", e);
        reject(e);
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        // Boards Store
        if (!db.objectStoreNames.contains("boards")) {
          const boardsStore = db.createObjectStore("boards", { keyPath: "id", autoIncrement: true });
          boardsStore.createIndex("order", "order", { unique: false });
        }

        // Threads Store
        if (!db.objectStoreNames.contains("threads")) {
          const threadsStore = db.createObjectStore("threads", { keyPath: "id", autoIncrement: true });
          threadsStore.createIndex("boardId", "boardId", { unique: false });
          threadsStore.createIndex("isArchived", "isArchived", { unique: false });
          threadsStore.createIndex("lastPostAt", "lastPostAt", { unique: false });
        }

        // Posts Store
        if (!db.objectStoreNames.contains("posts")) {
          const postsStore = db.createObjectStore("posts", { keyPath: "id", autoIncrement: true });
          postsStore.createIndex("threadId", "threadId", { unique: false });
          postsStore.createIndex("createdAt", "createdAt", { unique: false });
        }

        // Settings Store (key-value)
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }

        // NG List Store
        if (!db.objectStoreNames.contains("ng_list")) {
          const ngStore = db.createObjectStore("ng_list", { keyPath: "id", autoIncrement: true });
          ngStore.createIndex("type", "type", { unique: false });
        }
      };
    });
  }

  // --- Seed Data ---
  async seedIfNeeded() {
    const boards = await this.getAll("boards");
    if (boards.length === 0) {
      const defaultBoards = [
        { name: "仕事・タスク", description: "勉強や仕事の計画、期限付きのTODO管理用ボードです。", tags: ["タスク", "仕事", "勉強"], order: 0 },
        { name: "買い物・日常メモ", description: "買い物リストや今日のちょっとした日記・覚え書き用ボードです。", tags: ["買い物", "日常", "メモ"], order: 1 },
        { name: "AI相談・アイデア", description: "AIに壁打ち相手をしてもらいながら、アイデアをブレストするボードです。", tags: ["アイデア", "ブレスト", "AI"], order: 2 }
      ];

      for (const board of defaultBoards) {
        await this.add("boards", board);
      }
      console.log("Database seeded with default boards.");
    }
  }

  // --- Generic Helper Methods ---
  getStore(storeName, mode = "readonly") {
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  getAll(storeName) {
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e);
    });
  }

  get(storeName, key) {
    return new Promise((resolve, reject) => {
      const store = this.getStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e);
    });
  }

  add(storeName, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.add(value);
      
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = (e) => reject(e);
    });
  }

  put(storeName, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.put(value);

      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = (e) => reject(e);
    });
  }

  delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      store.delete(key);

      transaction.oncomplete = () => resolve(true);
      transaction.onerror = (e) => reject(e);
    });
  }

  clear(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      store.clear();

      transaction.oncomplete = () => resolve(true);
      transaction.onerror = (e) => reject(e);
    });
  }

  // --- IndexedDB Specialized Queries ---
  getThreadsByBoard(boardId) {
    return new Promise((resolve, reject) => {
      const store = this.getStore("threads");
      const index = store.index("boardId");
      const request = index.getAll(boardId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e);
    });
  }

  getPostsByThread(threadId) {
    return new Promise((resolve, reject) => {
      const store = this.getStore("posts");
      const index = store.index("threadId");
      const request = index.getAll(threadId);
      request.onsuccess = () => {
        // Sort by index / createdAt just in case
        const sorted = request.result.sort((a, b) => a.createdAt - b.createdAt);
        resolve(sorted);
      };
      request.onerror = (e) => reject(e);
    });
  }
}

// ==========================================================================
// 2. Constants & Settings Defaults
// ==========================================================================
const DEFAULT_SETTINGS = {
  theme: "normal",
  fontSize: "medium",
  defaultName: "名無しさん",
  defaultDropTime: "86400", // 1 day
  defaultCompress: "0.6", // 60% quality
  warnThreshold: 20, // 20% remaining
  aaFont: "'Mona', 'MS PGothic', 'Courier New', monospace",
  aiProvider: "gemini",
  aiModel: "gemini-2.0-flash",
  aiKey: "",
  aiEndpoint: "",
  aiDefaultName: "AI◆bot",
  aiDefaultPrompt: "あなたは2ch掲示板に長年住み着いているコテハン（固定ハンドルネーム）の住民です。煽り口調でありながら、ユーザーのタスクやメモに対して建設的なアドバイスを皮肉混じりに投稿してください。"
};

// Global App State
const state = {
  db: new DBManager(),
  settings: { ...DEFAULT_SETTINGS },
  currentView: "board-list",
  activeBoardId: null,
  activeThreadId: null,
  activeTimers: [],
  threadCountdownInterval: null,
  attachedFiles: [], // Elements: { name, type, size, data }
  searchHistory: [],
  showArchivedInBoard: false
};

// ==========================================================================
// 3. Application Lifecycle & Routing
// ==========================================================================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Open Database
    await state.db.open();
    await state.db.seedIfNeeded();

    // Load Settings
    await loadSettings();
    applySettingsToDOM();

    // Setup Event Listeners
    setupGlobalEventListeners();

    // Start Router
    window.addEventListener("hashchange", handleRouting);
    handleRouting(); // First load routing

    // Start Storage Dashboard recals
    updateStorageDashboard();
    
    // Check storage warnings on startup
    checkStorageWarningLimit();

  } catch (error) {
    console.error("Initialization Failed:", error);
    alert("データベースの起動に失敗しました。シークレットウィンドウの場合は IndexedDB が無効化されている可能性があります。");
  }
});

// Load Settings from DB
async function loadSettings() {
  try {
    const rawSettings = await state.db.getAll("settings");
    rawSettings.forEach(s => {
      state.settings[s.key] = s.value;
    });
    // Load search history from localStorage
    const savedHistory = localStorage.getItem("bbs_search_history");
    if (savedHistory) {
      state.searchHistory = JSON.parse(savedHistory);
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}

// Save a Single Setting Value
async function saveSetting(key, value) {
  state.settings[key] = value;
  await state.db.put("settings", { key, value });
}

// Apply settings to body / visual tags
function applySettingsToDOM() {
  // Apply theme class
  document.body.className = "";
  document.body.classList.add(`theme-${state.settings.theme}`);
  
  // Apply font size class
  document.body.classList.add(`font-${state.settings.fontSize}`);

  // Set visual settings input states
  document.getElementById("settings-theme").value = state.settings.theme;
  document.getElementById("settings-fontsize").value = state.settings.fontSize;
  document.getElementById("settings-default-name").value = state.settings.defaultName;
  document.getElementById("settings-default-droptime").value = state.settings.defaultDropTime;
  document.getElementById("settings-default-compress").value = state.settings.defaultCompress;
  document.getElementById("settings-warn-threshold").value = state.settings.warnThreshold;
  document.getElementById("settings-aa-font").value = state.settings.aaFont;
  
  // Set AI settings states
  document.getElementById("settings-ai-provider").value = state.settings.aiProvider;
  document.getElementById("settings-api-key").value = state.settings.aiKey;
  document.getElementById("settings-api-endpoint").value = state.settings.aiEndpoint || "";
  document.getElementById("settings-ai-model").value = state.settings.aiModel;
  document.getElementById("settings-ai-name").value = state.settings.aiDefaultName;
  document.getElementById("settings-ai-tone").value = state.settings.aiDefaultPrompt;

  toggleEndpointGroupVisibility();
}

function toggleEndpointGroupVisibility() {
  const provider = document.getElementById("settings-ai-provider").value;
  const endpointGroup = document.getElementById("settings-endpoint-group");
  if (provider === "openai-compat") {
    endpointGroup.classList.remove("hidden");
  } else {
    endpointGroup.classList.add("hidden");
  }
}

// SPA Router
async function handleRouting() {
  const hash = window.location.hash || "#/";
  
  // Clear any active page running intervals
  clearInterval(state.threadCountdownInterval);
  state.activeTimers.forEach(t => clearInterval(t));
  state.activeTimers = [];

  // Update navigation items active state
  document.querySelectorAll(".app-nav-bar .nav-item").forEach(item => item.classList.remove("active"));

  // Match views
  if (hash === "#/" || hash.startsWith("#/board")) {
    document.getElementById("nav-boards").classList.add("active");
    
    if (hash.startsWith("#/board/")) {
      // Thread list for specific Board
      const boardId = parseInt(hash.replace("#/board/", ""));
      state.activeBoardId = boardId;
      switchView("thread-list");
      await renderThreadList(boardId);
    } else {
      // Board List
      state.activeBoardId = null;
      switchView("board-list");
      await renderBoardList();
    }
  } else if (hash.startsWith("#/thread/")) {
    // Thread Detail
    const threadId = parseInt(hash.replace("#/thread/", ""));
    state.activeThreadId = threadId;
    switchView("thread-detail");
    await renderThreadDetail(threadId);
  } else if (hash === "#/search") {
    document.getElementById("nav-search").classList.add("active");
    switchView("search");
    await renderSearchPage();
  } else if (hash === "#/archive") {
    document.getElementById("nav-archive").classList.add("active");
    switchView("archive-list");
    await renderArchiveList();
  } else if (hash === "#/settings") {
    document.getElementById("nav-settings").classList.add("active");
    switchView("settings");
    await renderSettingsPage();
  }
}

function switchView(viewId) {
  state.currentView = viewId;
  document.querySelectorAll(".view-section").forEach(sec => {
    sec.classList.remove("active");
  });
  const activeSec = document.getElementById(`view-${viewId}`);
  if (activeSec) {
    activeSec.classList.add("active");
  }
  // Scroll to top
  window.scrollTo(0, 0);
}

// ==========================================================================
// 4. View Rendering & UI Generators
// ==========================================================================

// --- Board List View ---
async function renderBoardList() {
  const container = document.getElementById("board-grid");
  container.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div>`;

  try {
    const boards = await state.db.getAll("boards");
    const threads = await state.db.getAll("threads");

    // Order boards by custom order or id
    boards.sort((a, b) => (a.order || 0) - (b.order || 0));

    if (boards.length === 0) {
      container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-folder-open"></i> 板がありません。「新しい板を作る」から作成してください。</div>`;
      return;
    }

    container.innerHTML = "";
    boards.forEach(board => {
      const activeThreadsCount = threads.filter(t => t.boardId === board.id && !t.isArchived).length;
      
      const card = document.createElement("div");
      card.className = "board-card";
      card.onclick = () => window.location.hash = `#/board/${board.id}`;

      // Tags HTML
      let tagsHtml = "";
      if (board.tags && board.tags.length > 0) {
        tagsHtml = `<div class="board-tags">` + 
          board.tags.map(t => `<span class="tag-badge">${escapeHTML(t)}</span>`).join("") + 
          `</div>`;
      }

      card.innerHTML = `
        <div class="board-card-actions">
          <button class="board-action-btn edit-board-btn" title="編集" data-id="${board.id}"><i class="fa-solid fa-pen"></i></button>
          <button class="board-action-btn delete-board-btn delete" title="削除" data-id="${board.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="board-card-info">
          <h3>${escapeHTML(board.name)}</h3>
          <p>${escapeHTML(board.description || "説明はありません。")}</p>
        </div>
        <div class="board-card-footer">
          <span><i class="fa-solid fa-list-check"></i> スレッド: ${activeThreadsCount}</span>
          ${tagsHtml}
        </div>
      `;
      container.appendChild(card);

      // Bind actions to prevent event bubbling to board navigation
      const editBtn = card.querySelector(".edit-board-btn");
      editBtn.onclick = (e) => {
        e.stopPropagation();
        openEditBoardModal(board.id);
      };

      const deleteBtn = card.querySelector(".delete-board-btn");
      deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`板「${board.name}」を削除しますか？\n板内のすべてのスレッドおよび書き込みが永久に削除されます。`)) {
          await deleteBoardCascading(board.id);
        }
      };
    });

  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i> 読み込みエラーが発生しました。</div>`;
  }
}

// --- Thread List View ---
async function renderThreadList(boardId) {
  // Clear existing active list timers
  state.activeTimers.forEach(t => clearInterval(t));
  state.activeTimers = [];

  const grid = document.getElementById("thread-grid");
  grid.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div>`;

  const board = await state.db.get("boards", boardId);
  if (!board) {
    grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i> 板が見つかりませんでした。</div>`;
    return;
  }

  // Breadcrumbs & Board headers
  document.getElementById("thread-list-board-name").textContent = board.name;
  document.getElementById("thread-list-board-desc").textContent = board.description || "説明はありません。";
  
  const tagsContainer = document.getElementById("thread-list-board-tags");
  tagsContainer.innerHTML = "";
  if (board.tags && board.tags.length > 0) {
    board.tags.forEach(t => {
      const badge = document.createElement("span");
      badge.className = "tag-badge";
      badge.textContent = t;
      tagsContainer.appendChild(badge);
    });
  }

  // Set toggle archives button state
  const btnToggleArchived = document.getElementById("btn-toggle-archived-in-board");
  if (btnToggleArchived) {
    btnToggleArchived.innerHTML = `<i class="fa-solid fa-box-archive"></i> 過去ログ: ${state.showArchivedInBoard ? "表示中" : "非表示"}`;
    btnToggleArchived.classList.toggle("btn-primary", state.showArchivedInBoard);
    btnToggleArchived.classList.toggle("btn-secondary", !state.showArchivedInBoard);
  }

  // Get active/archived threads depending on setting
  let threads = await state.db.getThreadsByBoard(boardId);
  if (!state.showArchivedInBoard) {
    threads = threads.filter(t => !t.isArchived);
  }

  // Apply sorting (retrieved from session settings or default)
  const sortKey = sessionStorage.getItem("thread_sort_key") || "created_desc";
  sortThreads(threads, sortKey);
  updateSortLabel(sortKey);

  if (threads.length === 0) {
    grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-folder-open"></i> スレッドがありません。「新規スレ作成」から作成してください。</div>`;
    return;
  }

  grid.innerHTML = "";
  
  // Render thread items
  threads.forEach(thread => {
    const card = document.createElement("div");
    card.dataset.id = thread.id;
    card.onclick = () => window.location.hash = `#/thread/${thread.id}`;

    // --- Archived thread: static display, no countdown ---
    if (thread.isArchived) {
      card.className = "thread-card archived-in-list";

      // Tag list
      let tagsHtml = "";
      if (thread.tags && thread.tags.length > 0) {
        tagsHtml = `<div class="board-tags">` +
          thread.tags.map(t => `<span class="tag-badge">${escapeHTML(t)}</span>`).join("") +
          `</div>`;
      }

      card.innerHTML = `
        <div class="thread-card-header">
          <span class="thread-card-title">${escapeHTML(thread.title)}</span>
          <div class="archived-card-actions">
            <span class="badge-archived"><i class="fa-solid fa-box-archive"></i> 過去ログ</span>
            <button class="board-action-btn delete btn-delete-archived" title="この過去ログを削除" data-id="${thread.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div class="thread-card-meta">
          <div class="thread-card-meta-left">
            <span class="badge badge-count">${thread.postCount} / 1000 レス</span>
          </div>
          <div class="thread-card-meta-right">${tagsHtml}</div>
        </div>
      `;
      grid.appendChild(card);

      card.querySelector(".btn-delete-archived").onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`過去ログ「${thread.title}」を削除しますか？\n（全ての書き込みも消去されます）`)) {
          await deleteThreadCascading(thread.id);
          renderThreadList(boardId);
          updateStorageDashboard();
        }
      };

      return; // no timer needed
    }

    // --- Active thread: normal countdown ---
    card.className = "thread-card";

    // Elements for timing
    const elapsed = Date.now() - thread.lastPostAt;
    const limitMs = thread.dropTimeLimit * 1000;
    const remainingMs = Math.max(0, limitMs - elapsed);
    const remainingPct = Math.round((remainingMs / limitMs) * 100);

    let progressClass = "";
    if (remainingPct <= state.settings.warnThreshold) {
      progressClass = remainingPct <= 10 ? "alert" : "warn";
    }

    const timeString = formatRemainingTime(remainingMs);

    // AI & Attachment Icons
    const aiIcon = thread.aiEnabled ? `<span class="badge badge-ai" title="AI自動返信有効"><i class="fa-solid fa-robot"></i> AI</span>` : "";
    const fileIcon = thread.hasAttachment ? `<span class="badge" title="ファイル添付あり"><i class="fa-solid fa-paperclip"></i></span>` : "";

    // Tag list
    let tagsHtml = "";
    if (thread.tags && thread.tags.length > 0) {
      tagsHtml = `<div class="board-tags">` + 
        thread.tags.map(t => `<span class="tag-badge">${escapeHTML(t)}</span>`).join("") + 
        `</div>`;
    }

    card.innerHTML = `
      <div class="thread-card-header">
        <span class="thread-card-title">${escapeHTML(thread.title)}</span>
        <span class="thread-card-timer text-muted" id="timer-text-${thread.id}">${timeString}</span>
      </div>
      <div class="thread-card-meta">
        <div class="thread-card-meta-left">
          <span class="badge badge-count">${thread.postCount} / 1000 レス</span>
          ${aiIcon}
          ${fileIcon}
        </div>
        <div class="thread-card-meta-right">
          ${tagsHtml}
        </div>
      </div>
      <div class="thread-card-progress">
        <div class="thread-card-progress-bar ${progressClass}" id="timer-bar-${thread.id}" style="width: ${remainingPct}%;"></div>
      </div>
    `;
    grid.appendChild(card);

    // Background countdown loop for lists
    const intervalId = setInterval(async () => {
      const now = Date.now();
      const currentElapsed = now - thread.lastPostAt;
      const currentRemaining = Math.max(0, limitMs - currentElapsed);
      const currentPct = Math.round((currentRemaining / limitMs) * 100);
      
      const txtEl = document.getElementById(`timer-text-${thread.id}`);
      const barEl = document.getElementById(`timer-bar-${thread.id}`);

      if (currentRemaining <= 0) {
        // Thread fell!
        clearInterval(intervalId);
        await archiveThread(thread.id);
        if (state.currentView === "thread-list" && state.activeBoardId === boardId) {
          handleRouting(); // Reload active view
        }
        return;
      }

      if (txtEl) {
        txtEl.textContent = formatRemainingTime(currentRemaining);
      }
      if (barEl) {
        barEl.style.width = `${currentPct}%`;
        barEl.className = "thread-card-progress-bar";
        if (currentPct <= state.settings.warnThreshold) {
          barEl.classList.add(currentPct <= 10 ? "alert" : "warn");
        }
      }
    }, 1000);

    state.activeTimers.push(intervalId);
  });
}

// --- Thread Detail View ---
async function renderThreadDetail(threadId) {
  // Clear any existing thread detail countdown interval to prevent overlapping
  if (state.threadCountdownInterval) {
    clearInterval(state.threadCountdownInterval);
    state.threadCountdownInterval = null;
  }

  const postsContainer = document.getElementById("posts-container");
  postsContainer.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div>`;

  try {
    const thread = await state.db.get("threads", threadId);
    if (!thread) {
      postsContainer.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i> スレッドが見つかりませんでした。</div>`;
      return;
    }

    const board = await state.db.get("boards", thread.boardId);

    // Breadcrumbs crumbs
    const boardLink = document.getElementById("thread-detail-board-link");
    boardLink.href = `#/board/${thread.boardId}`;
    boardLink.textContent = board ? board.name : "板";
    document.getElementById("thread-detail-title-crumb").textContent = thread.title;

    // Header updates
    document.getElementById("thread-detail-title").textContent = thread.title;
    document.getElementById("thread-status-badge").textContent = board ? board.name : "一般板";
    
    const aiBadge = document.getElementById("thread-ai-badge");
    if (thread.aiEnabled) {
      aiBadge.classList.remove("hidden");
      aiBadge.title = `プロバイダ: ${thread.aiProvider.toUpperCase()}, 更新間隔: ${thread.aiInterval}分`;
    } else {
      aiBadge.classList.add("hidden");
    }

    const countBadge = document.getElementById("thread-post-count-badge");
    countBadge.textContent = `${thread.postCount} / 1000 レス`;

    // Render Posts list
    const posts = await state.db.getPostsByThread(threadId);
    const ngList = await state.db.getAll("ng_list");

    postsContainer.innerHTML = "";
    posts.forEach(post => {
      const isAboon = checkPostNG(post, ngList);
      const postCard = document.createElement("div");
      postCard.className = `post-item`;
      postCard.id = `post-${post.postNumber}`;
      postCard.dataset.num = post.postNumber;

      if (isAboon) {
        postCard.classList.add("abo-n");
        postCard.onclick = () => postCard.classList.toggle("abo-n");
        postCard.innerHTML = `
          <div class="post-header">
            <span class="post-num">${post.postNumber}</span>
            <span>あぼーん (NGワードまたはNGIDにより非表示。タップで展開)</span>
          </div>
          <div class="post-body hidden">${escapeHTML(post.content)}</div>
        `;
        postsContainer.appendChild(postCard);
        return;
      }

      // Headers formatting
      const isAI = post.email && post.email.includes("bot") || post.name.includes("◆bot");
      const nameClass = isAI ? "post-name ai-post" : "post-name";
      const emailHtml = post.email ? `[<span class="post-email">${escapeHTML(post.email)}</span>]` : "";
      
      const formattedDate = formatPostDate(post.createdAt);
      
      // Formatting body links/quotes
      const formattedBody = formatPostBody(post.content);

      // Attachments rendering
      let attachmentsHtml = "";
      if (post.attachments && post.attachments.length > 0) {
        attachmentsHtml = `<div class="post-attachments">`;
        post.attachments.forEach((file, index) => {
          if (file.type.startsWith("image/")) {
            attachmentsHtml += `
              <div class="post-attachment-card">
                <img src="${file.data}" alt="${escapeHTML(file.name)}" class="post-attachment-thumb" 
                     onclick="openImagePreview('${file.data}', '${escapeHTML(file.name)} (${formatBytes(file.size)})')">
                <div class="post-attachment-info">${escapeHTML(file.name)}</div>
              </div>
            `;
          } else {
            attachmentsHtml += `
              <a href="${file.data}" download="${escapeHTML(file.name)}" class="post-attachment-file-link">
                <i class="fa-solid fa-file-arrow-down"></i>
                <span>${escapeHTML(file.name)} (${formatBytes(file.size)})</span>
              </a>
            `;
          }
        });
        attachmentsHtml += `</div>`;
      }

      postCard.innerHTML = `
        <div class="post-header" oncontextmenu="registerNGID(event, '${post.ipOrId}')">
          <span class="post-num">${post.postNumber}</span>
          名前：<span class="${nameClass}">${escapeHTML(post.name)}</span> ${emailHtml}：
          <span class="post-date-id">${formattedDate} ID:${post.ipOrId}</span>
        </div>
        <div class="post-body">${formattedBody}</div>
        ${attachmentsHtml}
      `;
      
      // Double tap or longpress insertion of anchors
      postCard.addEventListener("dblclick", () => insertAnchorIntoForm(post.postNumber));
      // Standard mobile hold insertion
      let pressTimer;
      postCard.addEventListener("touchstart", () => {
        pressTimer = setTimeout(() => insertAnchorIntoForm(post.postNumber), 700);
      });
      postCard.addEventListener("touchend", () => clearTimeout(pressTimer));

      postsContainer.appendChild(postCard);
    });

    // 1000 Limit block
    const isThreadFallen = thread.isArchived || (thread.postCount >= 1000);
    const formContainer = document.getElementById("thread-post-form-container");
    const nextThreadBox = document.getElementById("next-thread-suggestion");

    if (isThreadFallen) {
      formContainer.classList.add("hidden");
      if (thread.postCount >= 1000) {
        nextThreadBox.classList.remove("hidden");
      } else {
        nextThreadBox.classList.add("hidden");
      }
    } else {
      formContainer.classList.remove("hidden");
      nextThreadBox.classList.add("hidden");
    }

    // Timer logic detail page
    const limitMs = thread.dropTimeLimit * 1000;
    const txtEl = document.getElementById("thread-timer-countdown");
    const barEl = document.getElementById("thread-timer-progress-bar");
    const pctEl = document.getElementById("thread-timer-percentage");

    if (thread.isArchived) {
      txtEl.textContent = "落ちました(過去ログ化)";
      barEl.style.width = "0%";
      barEl.className = "timer-progress-bar";
      pctEl.textContent = "0%";
    } else {
      state.threadCountdownInterval = setInterval(async () => {
        const elapsed = Date.now() - thread.lastPostAt;
        const remainingMs = Math.max(0, limitMs - elapsed);
        const remainingPct = Math.round((remainingMs / limitMs) * 100);

        if (remainingMs <= 0) {
          clearInterval(state.threadCountdownInterval);
          await archiveThread(thread.id);
          handleRouting(); // Reload view
          return;
        }

        txtEl.textContent = formatRemainingTime(remainingMs);
        barEl.style.width = `${remainingPct}%`;
        pctEl.textContent = `${remainingPct}%`;

        barEl.className = "timer-progress-bar";
        if (remainingPct <= state.settings.warnThreshold) {
          barEl.classList.add(remainingPct <= 10 ? "alert" : "warn");
        }
      }, 1000);
    }

  } catch (e) {
    console.error(e);
    postsContainer.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i> スレッドの取得中にエラーが発生しました。</div>`;
  }
}

// --- Archived List View ---
async function renderArchiveList() {
  const container = document.getElementById("archive-grid");
  container.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div>`;

  try {
    let threads = await state.db.getAll("threads");
    threads = threads.filter(t => t.isArchived);

    if (threads.length === 0) {
      container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-box-archive"></i> 過去ログはありません。</div>`;
      return;
    }

    container.innerHTML = "";
    // Sort archive descending (last active first)
    threads.sort((a, b) => b.lastPostAt - a.lastPostAt);

    for (const thread of threads) {
      const board = await state.db.get("boards", thread.boardId);
      const card = document.createElement("div");
      card.className = "thread-card archived";
      card.onclick = () => window.location.hash = `#/thread/${thread.id}`;

      let tagsHtml = "";
      if (thread.tags && thread.tags.length > 0) {
        tagsHtml = `<div class="board-tags">` + 
          thread.tags.map(t => `<span class="tag-badge">${escapeHTML(t)}</span>`).join("") + 
          `</div>`;
      }

      card.innerHTML = `
        <div class="thread-card-header">
          <span class="thread-card-title">【落ちました】 ${escapeHTML(thread.title)}</span>
          <div class="archived-card-actions">
            <span class="thread-card-timer text-muted">板: ${board ? escapeHTML(board.name) : "不明"}</span>
            <button class="board-action-btn delete btn-delete-archived-global" title="この過去ログを削除" data-id="${thread.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div class="thread-card-meta">
          <div class="thread-card-meta-left">
            <span class="badge badge-count">${thread.postCount} レス</span>
            <span class="badge">最終書込: ${new Date(thread.lastPostAt).toLocaleString()}</span>
          </div>
          <div class="thread-card-meta-right">
            ${tagsHtml}
          </div>
        </div>
        <div class="thread-card-progress">
          <div class="thread-card-progress-bar" style="width: 0%; background-color: var(--text-muted);"></div>
        </div>
      `;
      container.appendChild(card);

      card.querySelector(".btn-delete-archived-global").onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`過去ログ「${thread.title}」を削除しますか？\n（全ての書き込みも消去されます）`)) {
          await deleteThreadCascading(thread.id);
          renderArchiveList();
          updateStorageDashboard();
        }
      };
    }
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i> 過去ログ取得中にエラーが発生しました。</div>`;
  }
}

// --- Search View Render ---
async function renderSearchPage() {
  // Populate Board filters
  const filterBoard = document.getElementById("search-filter-board");
  filterBoard.innerHTML = `<option value="all">すべての板</option>`;
  
  const boards = await state.db.getAll("boards");
  boards.forEach(b => {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    filterBoard.appendChild(opt);
  });

  // Render history chips
  renderSearchHistoryChips();
}

function renderSearchHistoryChips() {
  const tagBox = document.getElementById("search-history-tags");
  tagBox.innerHTML = "";
  
  if (state.searchHistory.length === 0) {
    tagBox.innerHTML = `<span class="text-muted" style="font-size: 11px;">履歴はありません。</span>`;
    return;
  }

  state.searchHistory.forEach(history => {
    const chip = document.createElement("button");
    chip.className = "history-tag-btn";
    chip.textContent = history;
    chip.onclick = () => {
      document.getElementById("search-query").value = history;
      executeSearch();
    };
    tagBox.appendChild(chip);
  });
}

// --- Settings View Render ---
async function renderSettingsPage() {
  await updateStorageDashboard();
}

// Recalculate and display storage
async function updateStorageDashboard() {
  const detailsEl = document.getElementById("storage-details");
  const fillBar = document.getElementById("storage-bar-fill");
  
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usedBytes = estimate.usage || 0;
      const limitBytes = estimate.quota || 500 * 1024 * 1024; // fallback 500MB
      
      const pct = Math.round((usedBytes / limitBytes) * 100) || 0;
      
      detailsEl.textContent = `${formatBytes(usedBytes)} / ${formatBytes(limitBytes)} (${pct}%)`;
      fillBar.style.width = `${pct}%`;

      fillBar.className = "storage-bar-fill";
      if (pct >= 80) {
        fillBar.classList.add(pct >= 90 ? "alert" : "warn");
      }
    } catch (e) {
      detailsEl.textContent = "取得失敗";
      fillBar.style.width = "0%";
    }
  } else {
    detailsEl.textContent = "未対応ブラウザ";
    fillBar.style.width = "0%";
  }
}

// Display top warning banner if DB exceeds 80% space
async function checkStorageWarningLimit() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const pct = Math.round((estimate.usage || 0) / (estimate.quota || 1) * 100);
      const banner = document.getElementById("global-warning-banner");
      
      if (pct >= 80) {
        banner.classList.remove("hidden");
      } else {
        banner.classList.add("hidden");
      }
    } catch(e) {}
  }
}

// ==========================================================================
// 5. Actions, Submissions and Timer Controls
// ==========================================================================

// Sort lists in memory
function sortThreads(threads, key) {
  switch (key) {
    case "created_asc":
      threads.sort((a, b) => a.createdAt - b.createdAt);
      break;
    case "created_desc":
      threads.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case "lastpost_desc":
      threads.sort((a, b) => b.lastPostAt - a.lastPostAt);
      break;
    case "timer_asc":
      // Priority to the ones closing fast
      threads.sort((a, b) => {
        const ra = (a.dropTimeLimit * 1000) - (Date.now() - a.lastPostAt);
        const rb = (b.dropTimeLimit * 1000) - (Date.now() - b.lastPostAt);
        return ra - rb;
      });
      break;
    case "posts_desc":
      threads.sort((a, b) => b.postCount - a.postCount);
      break;
    case "posts_asc":
      threads.sort((a, b) => a.postCount - b.postCount);
      break;
    case "title_asc":
      threads.sort((a, b) => a.title.localeCompare(b.title, "ja"));
      break;
    default:
      threads.sort((a, b) => b.createdAt - a.createdAt);
  }
}

function updateSortLabel(key) {
  const labels = {
    created_asc: "作成日(古い順)",
    created_desc: "作成日(新しい順)",
    lastpost_desc: "最終書込(新)",
    timer_asc: "残り時間(少)",
    posts_desc: "レス数(多)",
    posts_asc: "レス数(少)",
    title_asc: "タイトル順"
  };
  const label = labels[key] || "作成日順";
  document.getElementById("current-sort-label").textContent = label;
}

// Handle Thread Archiving
async function archiveThread(threadId) {
  const thread = await state.db.get("threads", threadId);
  if (thread && !thread.isArchived) {
    thread.isArchived = true;
    await state.db.put("threads", thread);
    console.log(`Thread ${threadId} archived.`);
  }
}

// Formatting post content for 5ch links, anchors, and quote text
function formatPostBody(content) {
  // 1. Escape HTML first
  let html = escapeHTML(content);

  // 2. Format quotes (>Text)
  html = html.replace(/^(?:&gt;)([^&>].*)$/gm, '<span class="quote-text">&gt;$1</span>');

  // 3. Format Anchors (>>N)
  html = html.replace(/&gt;&gt;(\d+)/g, (match, num) => {
    return `<a class="anchor-link" onclick="scrollToPost(${num})">&gt;&gt;${num}</a>`;
  });

  // 4. Autolink URLs
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  html = html.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

  return html;
}

function scrollToPost(num) {
  const el = document.getElementById(`post-${num}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth" });
    el.classList.add("highlighted-post");
    setTimeout(() => el.classList.remove("highlighted-post"), 2000);
  } else {
    alert(`レス >>${num} は存在しません。`);
  }
}

function insertAnchorIntoForm(num) {
  const area = document.getElementById("post-body");
  if (area) {
    area.value += `>>${num}\n`;
    area.focus();
  }
}

// check word/ID NG match
function checkPostNG(post, ngList) {
  return ngList.some(ng => {
    if (ng.type === "word") {
      return post.content.includes(ng.value) || post.name.includes(ng.value);
    } else if (ng.type === "id") {
      return post.ipOrId === ng.value;
    }
    return false;
  });
}

// Register NGID via header right-click/longhold context menu
async function registerNGID(event, id) {
  event.preventDefault();
  if (id === "AI000000" || id.startsWith("AI")) {
    alert("AIのIDはNG登録できません。");
    return;
  }
  
  if (confirm(`ID: ${id} をNG登録しますか？\n（このIDの書き込みはすべて非表示になります）`)) {
    await state.db.add("ng_list", { type: "id", value: id, createdAt: Date.now() });
    alert("NGIDに登録しました。");
    if (state.currentView === "thread-detail") {
      renderThreadDetail(state.activeThreadId);
    }
  }
}

// Helper formats
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function formatRemainingTime(ms) {
  if (ms <= 0) return "落とされました";
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600) % 24;
  const d = Math.floor(seconds / 86400);

  let str = "";
  if (d > 0) str += `${d}日 `;
  str += `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return str;
}

function formatPostDate(timestamp) {
  const d = new Date(timestamp);
  const week = ["日", "月", "火", "水", "木", "金", "土"];
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  const w = week[d.getDay()];
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(2, '0').substring(0, 2);

  return `${y}/${m}/${date}(${w}) ${h}:${min}:${sec}.${ms}`;
}

function generateSessionID() {
  // Session random ID 8 characters
  let id = sessionStorage.getItem("user_bbs_id");
  if (!id) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    id = "";
    for (let i = 0; i < 8; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    sessionStorage.setItem("user_bbs_id", id);
  }
  return id;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ==========================================================================
// 6. Form Handlers & Modal Windows Controls
// ==========================================================================
function setupGlobalEventListeners() {
  
  // Header Actions Routing triggers
  document.getElementById("btn-header-search").onclick = () => window.location.hash = "#/search";
  document.getElementById("btn-header-archive").onclick = () => window.location.hash = "#/archive";
  document.getElementById("btn-header-settings").onclick = () => window.location.hash = "#/settings";
  document.getElementById("header-logo").onclick = () => window.location.hash = "#/";
  document.getElementById("btn-warning-action").onclick = () => {
    document.getElementById("global-warning-banner").classList.add("hidden");
    window.location.hash = "#/settings";
  };
  document.getElementById("btn-warning-close").onclick = () => {
    document.getElementById("global-warning-banner").classList.add("hidden");
  };

  // Nav Bottom Routing
  document.getElementById("nav-boards").onclick = (e) => { e.preventDefault(); window.location.hash = "#/"; };
  document.getElementById("nav-search").onclick = (e) => { e.preventDefault(); window.location.hash = "#/search"; };
  document.getElementById("nav-archive").onclick = (e) => { e.preventDefault(); window.location.hash = "#/archive"; };
  document.getElementById("nav-settings").onclick = (e) => { e.preventDefault(); window.location.hash = "#/settings"; };

  // --- Modal: Board Create ---
  const modalBoard = document.getElementById("modal-create-board");
  document.getElementById("btn-new-board").onclick = () => modalBoard.classList.add("active");
  document.getElementById("btn-close-board-modal").onclick = 
  document.getElementById("btn-cancel-board-modal").onclick = () => modalBoard.classList.remove("active");

  document.getElementById("form-create-board").onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById("board-name").value.trim();
    const description = document.getElementById("board-desc").value.trim();
    const tagsStr = document.getElementById("board-tags-input").value.trim();
    const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];

    const boards = await state.db.getAll("boards");
    const nextOrder = boards.length;

    await state.db.add("boards", { name, description, tags, order: nextOrder });
    modalBoard.classList.remove("active");
    document.getElementById("form-create-board").reset();
    renderBoardList();
  };

  // --- Modal: Board Edit ---
  const modalEditBoard = document.getElementById("modal-edit-board");
  document.getElementById("btn-close-edit-board-modal").onclick =
  document.getElementById("btn-cancel-edit-board-modal").onclick = () => modalEditBoard.classList.remove("active");

  document.getElementById("form-edit-board").onsubmit = async (e) => {
    e.preventDefault();
    const boardId = parseInt(document.getElementById("edit-board-id").value);
    const name = document.getElementById("edit-board-name").value.trim();
    const description = document.getElementById("edit-board-desc").value.trim();
    const tagsStr = document.getElementById("edit-board-tags-input").value.trim();
    const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];

    const board = await state.db.get("boards", boardId);
    if (!board) return;
    await state.db.put("boards", { ...board, name, description, tags });
    modalEditBoard.classList.remove("active");
    renderBoardList();
  };

  // --- Toggle Archived Threads in Board ---
  document.getElementById("btn-toggle-archived-in-board").onclick = () => {
    state.showArchivedInBoard = !state.showArchivedInBoard;
    if (state.activeBoardId) renderThreadList(state.activeBoardId);
  };

  // --- Edit Board from Thread List view ---
  document.getElementById("btn-edit-board-from-list").onclick = () => {
    if (state.activeBoardId) openEditBoardModal(state.activeBoardId);
  };

  // --- Modal: Thread Create ---
  const modalThread = document.getElementById("modal-create-thread");
  document.getElementById("btn-new-thread").onclick = () => {
    if (!state.activeBoardId) return;
    document.getElementById("thread-board-id").value = state.activeBoardId;
    
    // Autofill defaults
    document.getElementById("thread-first-post-name").value = state.settings.defaultName;
    document.getElementById("thread-droptime").value = state.settings.defaultDropTime;
    document.getElementById("thread-ai-name-custom").placeholder = `${state.settings.aiDefaultName} (デフォルト)`;
    
    modalThread.classList.add("active");
  };
  
  document.getElementById("btn-close-thread-modal").onclick = 
  document.getElementById("btn-cancel-thread-modal").onclick = () => modalThread.classList.remove("active");

  // Thread creation AI toggle sub-fields
  document.getElementById("thread-ai-enabled").onchange = (e) => {
    const sub = document.getElementById("thread-ai-settings-sub");
    if (e.target.checked) {
      sub.classList.remove("hidden");
    } else {
      sub.classList.add("hidden");
    }
  };

  document.getElementById("form-create-thread").onsubmit = async (e) => {
    e.preventDefault();
    const boardId = parseInt(document.getElementById("thread-board-id").value);
    const title = document.getElementById("thread-title").value.trim();
    const dropTimeLimit = parseInt(document.getElementById("thread-droptime").value);
    const tagsStr = document.getElementById("thread-tags-input").value.trim();
    const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];

    const aiEnabled = document.getElementById("thread-ai-enabled").checked;
    const aiInterval = parseInt(document.getElementById("thread-ai-interval").value) || 30;
    const aiInfluence = document.getElementById("thread-ai-influence").value;
    const aiNameCustom = document.getElementById("thread-ai-name-custom").value.trim();
    const aiPromptCustom = document.getElementById("thread-ai-prompt-custom").value.trim();

    // First post parameters
    const authorName = document.getElementById("thread-first-post-name").value.trim() || state.settings.defaultName;
    const postBody = document.getElementById("thread-first-post-body").value.trim();

    if (!title || !postBody) return;

    // Create Thread object
    const threadData = {
      boardId,
      title,
      dropTimeLimit,
      aiEnabled,
      aiProvider: state.settings.aiProvider,
      aiModel: state.settings.aiModel,
      aiInterval: aiEnabled ? aiInterval : null,
      aiName: aiNameCustom || state.settings.aiDefaultName,
      aiTone: aiPromptCustom || state.settings.aiDefaultPrompt,
      aiDropInfluence: aiInfluence,
      tags,
      createdAt: Date.now(),
      lastPostAt: Date.now(),
      postCount: 1,
      isArchived: false,
      hasAttachment: false
    };

    const threadId = await state.db.add("threads", threadData);

    // Save initial post
    const postData = {
      threadId,
      postNumber: 1,
      name: authorName,
      email: "",
      content: postBody,
      createdAt: Date.now(),
      ipOrId: generateSessionID(),
      attachments: []
    };

    await state.db.add("posts", postData);

    modalThread.classList.remove("active");
    document.getElementById("form-create-thread").reset();
    document.getElementById("thread-ai-settings-sub").classList.add("hidden");

    // Route to new thread
    window.location.hash = `#/thread/${threadId}`;
  };

  // --- Sticky Post Reply Form Collapse (Mobile) ---
  document.getElementById("form-collapsible-btn").onclick = () => {
    const fields = document.getElementById("form-collapsible-fields");
    const icon = document.querySelector("#form-collapsible-btn i");
    fields.classList.toggle("hidden");
    if (fields.classList.contains("hidden")) {
      icon.className = "fa-solid fa-chevron-up";
    } else {
      icon.className = "fa-solid fa-chevron-down";
    }
  };

  // --- Attachments Handlers ---
  document.getElementById("btn-trigger-file-select").onclick = () => {
    document.getElementById("post-files").click();
  };

  document.getElementById("post-files").onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (state.attachedFiles.length + files.length > 4) {
      alert("添付できるファイルは最大4つまでです。");
      return;
    }

    const qualitySelect = document.getElementById("img-compress-quality");
    const compression = qualitySelect.value;

    for (const file of files) {
      // 10MB individual limit check before compression
      if (file.size > 10 * 1024 * 1024) {
        alert(`ファイル ${file.name} は10MB制限を超えています。`);
        continue;
      }

      try {
        let fileDataUrl = "";
        let finalSize = file.size;

        if (file.type.startsWith("image/") && compression !== "none") {
          // Perform Canvas Image Compression
          const compressed = await compressImage(file, parseFloat(compression));
          fileDataUrl = compressed.dataUrl;
          finalSize = compressed.size;
        } else {
          // Standard base64 conversion
          fileDataUrl = await readFileAsBase64(file);
        }

        state.attachedFiles.push({
          name: file.name,
          type: file.type,
          size: finalSize,
          data: fileDataUrl
        });

      } catch (err) {
        console.error(err);
        alert(`ファイル ${file.name} の読み込みに失敗しました。`);
      }
    }

    updateAttachedFilesUI();
  };

  // Post Submission
  document.getElementById("post-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!state.activeThreadId) return;

    const bodyEl = document.getElementById("post-body");
    const nameEl = document.getElementById("post-name");
    const emailEl = document.getElementById("post-email");

    const content = bodyEl.value.trim();
    let name = nameEl.value.trim() || state.settings.defaultName;
    const email = emailEl.value.trim();

    if (!content && state.attachedFiles.length === 0) return;

    // Check size limit (Total 15MB)
    const totalSize = state.attachedFiles.reduce((acc, f) => acc + f.size, 0);
    if (totalSize > 15 * 1024 * 1024) {
      alert("1回の投稿に添付できる合計容量は15MBまでです。画像圧縮率を高めるか添付ファイルを減らしてください。");
      return;
    }

    const thread = await state.db.get("threads", state.activeThreadId);
    if (thread.isArchived || thread.postCount >= 1000) {
      alert("このスレッドは落ちているため書き込めません。");
      return;
    }

    // Next post number
    const postNumber = thread.postCount + 1;

    // Save Post
    const postData = {
      threadId: state.activeThreadId,
      postNumber,
      name,
      email,
      content,
      createdAt: Date.now(),
      ipOrId: generateSessionID(),
      attachments: [...state.attachedFiles]
    };

    await state.db.add("posts", postData);

    // Update Thread Meta
    thread.postCount = postNumber;
    if (state.attachedFiles.length > 0) {
      thread.hasAttachment = true;
    }

    // Sage check
    const isSage = email.toLowerCase() === "sage";
    if (!isSage) {
      thread.lastPostAt = Date.now();
    }
    
    // Auto archive if reaches 1000 posts
    if (postNumber >= 1000) {
      thread.isArchived = true;
    }

    await state.db.put("threads", thread);

    // Reset Form Input states
    bodyEl.value = "";
    state.attachedFiles = [];
    updateAttachedFilesUI();
    document.getElementById("post-files").value = "";

    // Re-render Detail
    await renderThreadDetail(state.activeThreadId);

    // Trigger AI response if enabled
    if (thread.aiEnabled && !thread.isArchived) {
      triggerAIResponse(thread);
    }
  };

  // --- Sort Trigger ---
  document.getElementById("btn-sort-threads").onclick = () => {
    const current = sessionStorage.getItem("thread_sort_key") || "created_desc";
    const options = [
      { key: "created_desc", label: "作成日(新しい順)" },
      { key: "created_asc", label: "作成日(古い順)" },
      { key: "lastpost_desc", label: "最終書込(新)" },
      { key: "timer_asc", label: "残り時間(少)" },
      { key: "posts_desc", label: "レス数(多)" },
      { key: "posts_asc", label: "レス数(少)" },
      { key: "title_asc", label: "タイトル順" }
    ];

    let nextIdx = options.findIndex(o => o.key === current) + 1;
    if (nextIdx >= options.length) nextIdx = 0;
    
    const nextSort = options[nextIdx];
    sessionStorage.setItem("thread_sort_key", nextSort.key);
    
    if (state.activeBoardId) {
      renderThreadList(state.activeBoardId);
    }
  };

  // --- Modal 3: AA Converter Trigger ---
  // We can convert selected image to AA
  const modalAA = document.getElementById("modal-aa-converter");
  document.getElementById("btn-close-aa-modal").onclick = 
  document.getElementById("btn-cancel-aa-modal").onclick = () => modalAA.classList.remove("active");

  document.getElementById("aa-style-select").onchange = (e) => {
    const customGrp = document.getElementById("aa-custom-chars-group");
    if (e.target.value === "custom") {
      customGrp.classList.remove("hidden");
    } else {
      customGrp.classList.add("hidden");
    }
    regenerateAA();
  };

  document.getElementById("aa-custom-chars").oninput = () => regenerateAA();
  document.getElementById("aa-width-select").onchange = () => regenerateAA();
  document.getElementById("aa-invert").onchange = () => regenerateAA();

  document.getElementById("btn-insert-aa").onclick = () => {
    const aaText = document.getElementById("aa-result-text").textContent;
    const bodyText = document.getElementById("post-body");
    
    // Enwrap in standard markdown block or simple raw text with mona hint
    bodyText.value += `\n${aaText}\n`;
    modalAA.classList.remove("active");
  };

  // --- Modal 4: Image enlargement ---
  document.getElementById("btn-close-img-preview-btn").onclick = 
  document.getElementById("btn-close-img-preview-overlay").onclick = () => {
    document.getElementById("modal-image-preview").classList.remove("active");
  };

  // --- Search view trigger ---
  document.getElementById("btn-execute-search").onclick = () => executeSearch();
  document.getElementById("search-query").onkeydown = (e) => {
    if (e.key === "Enter") executeSearch();
  };

  // --- Archive view trigger ---
  document.getElementById("btn-clear-all-archives").onclick = async () => {
    if (confirm("本当にすべての過去ログスレッドを削除しますか？\n（この操作は元に戻せません）")) {
      const threads = await state.db.getAll("threads");
      const posts = await state.db.getAll("posts");

      const archivedThreads = threads.filter(t => t.isArchived);
      
      for (const t of archivedThreads) {
        // Delete thread posts
        const threadPosts = posts.filter(p => p.threadId === t.id);
        for (const p of threadPosts) {
          await state.db.delete("posts", p.id);
        }
        // Delete thread
        await state.db.delete("threads", t.id);
      }
      alert("すべての過去ログを消去しました。");
      renderArchiveList();
      updateStorageDashboard();
    }
  };

  // --- Settings UI Handlers ---
  document.getElementById("btn-toggle-key-visibility").onclick = () => {
    const el = document.getElementById("settings-api-key");
    const icon = document.querySelector("#btn-toggle-key-visibility i");
    if (el.type === "password") {
      el.type = "text";
      icon.className = "fa-solid fa-eye-slash";
    } else {
      el.type = "password";
      icon.className = "fa-solid fa-eye";
    }
  };

  document.getElementById("settings-ai-provider").onchange = (e) => {
    toggleEndpointGroupVisibility();
  };

  // Fetch model name dynamically
  document.getElementById("btn-fetch-models").onclick = async () => {
    const provider = document.getElementById("settings-ai-provider").value;
    const apiKey = document.getElementById("settings-api-key").value.trim();
    const endpoint = document.getElementById("settings-api-endpoint").value.trim();
    const btn = document.getElementById("btn-fetch-models");
    
    if (!apiKey && provider !== "openai-compat") {
      alert("APIキーが入力されていません。");
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 取得中...`;

    try {
      const models = await fetchAPIModels(provider, apiKey, endpoint);
      populateFetchedModels(models);
      alert("モデル一覧を取得しました。");
    } catch (e) {
      console.error(e);
      alert(`モデル取得エラー: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-rotate"></i> モデル取得`;
    }
  };

  document.getElementById("settings-fetched-models-select").onchange = (e) => {
    document.getElementById("settings-ai-model").value = e.target.value;
  };

  // Save Settings panel configuration
  document.querySelectorAll("#view-settings input, #view-settings select, #view-settings textarea").forEach(el => {
    if (el.id === "import-file") return;
    
    el.onchange = async () => {
      let key = "";
      let value = el.value;

      switch(el.id) {
        case "settings-theme": key = "theme"; break;
        case "settings-fontsize": key = "fontSize"; break;
        case "settings-default-name": key = "defaultName"; break;
        case "settings-default-droptime": key = "defaultDropTime"; break;
        case "settings-default-compress": key = "defaultCompress"; break;
        case "settings-warn-threshold": key = "warnThreshold"; value = parseInt(value) || 20; break;
        case "settings-aa-font": key = "aaFont"; break;
        case "settings-ai-provider": key = "aiProvider"; break;
        case "settings-api-key": key = "aiKey"; break;
        case "settings-api-endpoint": key = "aiEndpoint"; break;
        case "settings-ai-model": key = "aiModel"; break;
        case "settings-ai-name": key = "aiDefaultName"; break;
        case "settings-ai-tone": key = "aiDefaultPrompt"; break;
      }

      if (key) {
        await saveSetting(key, value);
        applySettingsToDOM();
      }
    };
  });

  // Storage recals
  document.getElementById("btn-recalculate-storage").onclick = () => {
    updateStorageDashboard();
  };

  // Factory Reset
  document.getElementById("btn-factory-reset").onclick = async () => {
    if (confirm("本当にすべてのデータを消去しますか？\n（この操作は元に戻せません。登録した設定、板、スレッドがすべて消去されます）")) {
      if (confirm("最後の警告：すべての板、スレ、設定データを完全にリセットします。実行しますか？")) {
        await state.db.clear("boards");
        await state.db.clear("threads");
        await state.db.clear("posts");
        await state.db.clear("settings");
        await state.db.clear("ng_list");
        localStorage.removeItem("bbs_search_history");
        
        alert("データを完全にリセットしました。ページをリロードします。");
        window.location.hash = "#/";
        window.location.reload();
      }
    }
  };

  // Clear search history
  document.getElementById("btn-delete-search-history").onclick = () => {
    state.searchHistory = [];
    localStorage.removeItem("bbs_search_history");
    renderSearchHistoryChips();
    alert("検索履歴を削除しました。");
  };

  // --- Data Export & Import Handlers ---
  document.getElementById("btn-export-all").onclick = () => exportAllDataZip();
  document.getElementById("btn-trigger-import").onclick = () => document.getElementById("import-file").click();
  document.getElementById("import-file").onchange = (e) => importDataZip(e);

  // --- Next Thread (Part 2) Handler ---
  document.getElementById("btn-create-next-thread").onclick = async () => {
    if (!state.activeThreadId) return;
    
    try {
      const origThread = await state.db.get("threads", state.activeThreadId);
      if (!origThread) return;

      // Calculate next title suffix
      const nextTitle = incrementTitleNumber(origThread.title);

      // Create new thread object
      const nextThreadData = {
        boardId: origThread.boardId,
        title: nextTitle,
        dropTimeLimit: origThread.dropTimeLimit,
        aiEnabled: origThread.aiEnabled,
        aiProvider: origThread.aiProvider,
        aiModel: origThread.aiModel,
        aiInterval: origThread.aiInterval,
        aiName: origThread.aiName,
        aiTone: origThread.aiTone,
        aiDropInfluence: origThread.aiDropInfluence,
        tags: [...origThread.tags],
        createdAt: Date.now(),
        lastPostAt: Date.now(),
        postCount: 1,
        isArchived: false,
        hasAttachment: false
      };

      const newThreadId = await state.db.add("threads", nextThreadData);

      // Add default first post for continuation
      const firstPost = {
        threadId: newThreadId,
        postNumber: 1,
        name: state.settings.defaultName,
        email: "",
        content: `スレッド 「${origThread.title}」 が1000レス到達したため、次スレッドを作成しました。\n\n引き続きメモ・タスクを管理しましょう。`,
        createdAt: Date.now(),
        ipOrId: generateSessionID(),
        attachments: []
      };

      await state.db.add("posts", firstPost);

      // Hide suggestions block
      document.getElementById("next-thread-suggestion").classList.add("hidden");

      // Redirect
      window.location.hash = `#/thread/${newThreadId}`;

    } catch (e) {
      console.error(e);
      alert("次スレの作成に失敗しました。");
    }
  };

  // --- Modal: Thread Edit ---
  const modalEditThread = document.getElementById("modal-edit-thread");
  document.getElementById("btn-close-edit-thread-modal").onclick =
  document.getElementById("btn-cancel-edit-thread-modal").onclick = () => modalEditThread.classList.remove("active");

  // btn-edit-thread is inside the thread detail view; use event delegation
  document.getElementById("btn-edit-thread").onclick = () => {
    if (!state.activeThreadId) return;
    openEditThreadModal(state.activeThreadId);
  };

  // AI toggle sub-fields for Edit Thread modal
  document.getElementById("edit-thread-ai-enabled").onchange = (e) => {
    const sub = document.getElementById("edit-thread-ai-settings-sub");
    sub.classList.toggle("hidden", !e.target.checked);
  };

  document.getElementById("form-edit-thread").onsubmit = async (e) => {
    e.preventDefault();
    const threadId = parseInt(document.getElementById("edit-thread-id").value);
    const title = document.getElementById("edit-thread-title").value.trim();
    const dropTimeLimit = parseInt(document.getElementById("edit-thread-droptime").value);
    const tagsStr = document.getElementById("edit-thread-tags-input").value.trim();
    const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];

    const aiEnabled = document.getElementById("edit-thread-ai-enabled").checked;
    const aiInterval = parseInt(document.getElementById("edit-thread-ai-interval").value) || 30;
    const aiDropInfluence = document.getElementById("edit-thread-ai-influence").value;
    const aiNameCustom = document.getElementById("edit-thread-ai-name-custom").value.trim();
    const aiPromptCustom = document.getElementById("edit-thread-ai-prompt-custom").value.trim();

    const thread = await state.db.get("threads", threadId);
    if (!thread) return;

    const updatedThread = {
      ...thread,
      title,
      dropTimeLimit,
      tags,
      aiEnabled,
      aiInterval: aiEnabled ? aiInterval : thread.aiInterval,
      aiDropInfluence: aiEnabled ? aiDropInfluence : thread.aiDropInfluence,
      aiName: aiNameCustom || thread.aiName,
      aiTone: aiPromptCustom || thread.aiTone
    };

    await state.db.put("threads", updatedThread);
    modalEditThread.classList.remove("active");

    // If AI was enabled, reschedule
    if (aiEnabled && updatedThread.postCount < 1000 && !updatedThread.isArchived) {
      triggerAIResponse(updatedThread);
    }

    // Refresh the thread detail view
    renderThreadDetail(threadId);
  };
}

// Nextスレ Title suffix incrementing logic
function incrementTitleNumber(title) {
  // Regex to look for space/numbers at the end (e.g. "Title 2", "Title 23")
  const match = title.match(/^(.*?)\s*(\d+)$/);
  if (match) {
    const base = match[1];
    const num = parseInt(match[2]);
    return `${base} ${num + 1}`;
  }
  // Otherwise append " 2"
  return `${title} 2`;
}

// Update Attached files section in form
function updateAttachedFilesUI() {
  const box = document.getElementById("file-attachment-preview");
  const list = document.getElementById("preview-files-list");
  const counter = document.getElementById("attached-files-counter");

  if (state.attachedFiles.length === 0) {
    box.classList.add("hidden");
    counter.textContent = "0 / 4 ファイル";
    return;
  }

  box.classList.remove("hidden");
  list.innerHTML = "";
  counter.textContent = `${state.attachedFiles.length} / 4 ファイル`;

  state.attachedFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "preview-file-item";
    
    // Add AA button if image
    let aaBtnHtml = "";
    if (file.type.startsWith("image/")) {
      aaBtnHtml = `<button type="button" class="btn btn-secondary btn-sm" onclick="openAACoverter(${index})" style="padding: 1px 4px; font-size: 9px;"><i class="fa-solid fa-font"></i> AA変換</button>`;
    }

    item.innerHTML = `
      <span class="preview-filename">${escapeHTML(file.name)} (${formatBytes(file.size)})</span>
      ${aaBtnHtml}
      <button type="button" onclick="removeAttachedFile(${index})">&times;</button>
    `;
    list.appendChild(item);
  });
}

function removeAttachedFile(idx) {
  state.attachedFiles.splice(idx, 1);
  updateAttachedFilesUI();
}

// --- Image file Base64 Helper ---
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}

// --- Image Compression via Canvas API ---
function compressImage(file, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Limit dimensions to 1600px max width/height to avoid excessive storage
        let width = img.width;
        let height = img.height;
        const maxDim = 1600;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        
        // Approximate bytes size
        const head = dataUrl.indexOf(",") + 1;
        const sizeBytes = Math.round((dataUrl.length - head) * 0.75);

        resolve({ dataUrl, size: sizeBytes });
      };
      img.onerror = (err) => reject(err);
      img.src = e.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// --- AA Converter Modal Launch ---
let activeAAFileIndex = null;
function openAACoverter(idx) {
  activeAAFileIndex = idx;
  const modal = document.getElementById("modal-aa-converter");
  modal.classList.add("active");
  regenerateAA();
}

function regenerateAA() {
  if (activeAAFileIndex === null) return;
  const file = state.attachedFiles[activeAAFileIndex];
  if (!file) return;

  const style = document.getElementById("aa-style-select").value;
  const customChars = document.getElementById("aa-custom-chars").value;
  const width = parseInt(document.getElementById("aa-width-select").value) || 60;
  const invert = document.getElementById("aa-invert").checked;
  const resultPre = document.getElementById("aa-result-text");

  resultPre.textContent = "AA変換中...";

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // standard character aspect ratio (height is about 1.8-2x width, so scale down canvas height)
    const charAspectRatio = 1.9;
    const w = width;
    const h = Math.round((img.height * w) / (img.width * charAspectRatio));

    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const pixels = imgData.data;

    let chars = " .:-=+*#%@"; // Standard symbol light-to-dark
    if (style === "dot") {
      chars = " ░▒▓█";
    } else if (style === "custom" && customChars) {
      chars = customChars;
    }

    if (invert) {
      chars = chars.split("").reverse().join("");
    }

    let asciiStr = "";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const offset = (y * w + x) * 4;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];
        
        // Luminance formula
        const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        
        // Map brightness to chars
        const charIndex = Math.floor((brightness / 255) * (chars.length - 1));
        asciiStr += chars[charIndex];
      }
      asciiStr += "\n";
    }

    resultPre.textContent = asciiStr;
  };
  img.src = file.data;
}

// --- Image Preview Enlargement Modal ---
function openImagePreview(dataUrl, caption) {
  const modal = document.getElementById("modal-image-preview");
  const img = document.getElementById("img-preview-src");
  const cap = document.getElementById("img-preview-caption");

  img.src = dataUrl;
  cap.textContent = caption;
  modal.classList.add("active");
}

// ==========================================================================
// 7. Full Text Search
// ==========================================================================
async function executeSearch() {
  const queryInput = document.getElementById("search-query");
  const query = queryInput.value.trim().toLowerCase();
  const resultsContainer = document.getElementById("search-results-container");
  const countEl = document.getElementById("search-results-count");

  if (!query) {
    resultsContainer.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-info"></i> キーワードを入力してください。</div>`;
    countEl.textContent = "";
    return;
  }

  // Save history
  if (!state.searchHistory.includes(query)) {
    state.searchHistory.unshift(query);
    if (state.searchHistory.length > 10) state.searchHistory.pop();
    localStorage.setItem("bbs_search_history", JSON.stringify(state.searchHistory));
    renderSearchHistoryChips();
  }

  resultsContainer.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> 検索中...</div>`;

  try {
    const boardFilter = document.getElementById("search-filter-board").value;
    const statusFilter = document.getElementById("search-filter-status").value;
    const typeFilter = document.getElementById("search-filter-type").value;

    const threads = await state.db.getAll("threads");
    const posts = await state.db.getAll("posts");

    const matchedResults = [];

    // Filter threads
    const filteredThreads = threads.filter(t => {
      if (boardFilter !== "all" && t.boardId !== parseInt(boardFilter)) return false;
      if (statusFilter === "active" && t.isArchived) return false;
      if (statusFilter === "archived" && !t.isArchived) return false;
      return true;
    });

    const threadIds = filteredThreads.map(t => t.id);

    // Filter posts belonging to active matching threads
    const targetPosts = posts.filter(p => threadIds.includes(p.threadId));

    targetPosts.forEach(post => {
      const thread = threads.find(t => t.id === post.threadId);
      let matchLocation = "";
      let matches = false;

      // Filter by type
      if (typeFilter === "all" || typeFilter === "title") {
        if (thread.title.toLowerCase().includes(query)) {
          matches = true;
          matchLocation = `スレタイトル一致: ${thread.title}`;
        }
      }

      if (!matches && (typeFilter === "all" || typeFilter === "body")) {
        if (post.content.toLowerCase().includes(query)) {
          matches = true;
          matchLocation = getSnippet(post.content, query);
        }
      }

      if (!matches && typeFilter === "id") {
        if (post.ipOrId.toLowerCase() === query) {
          matches = true;
          matchLocation = `ID完全一致: ID:${post.ipOrId}`;
        }
      }

      if (!matches && typeFilter === "name") {
        if (post.name.toLowerCase().includes(query)) {
          matches = true;
          matchLocation = `投稿者名一致: ${post.name}`;
        }
      }

      if (!matches && typeFilter === "filename") {
        if (post.attachments && post.attachments.length > 0) {
          const hasFile = post.attachments.some(f => f.name.toLowerCase().includes(query));
          if (hasFile) {
            matches = true;
            matchLocation = `添付ファイル名一致: ` + post.attachments.map(f => f.name).join(", ");
          }
        }
      }

      if (matches) {
        matchedResults.push({
          post,
          thread,
          matchLocation
        });
      }
    });

    // Render results
    if (matchedResults.length === 0) {
      resultsContainer.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-question"></i> 一致する書き込みが見つかりませんでした。</div>`;
      countEl.textContent = "（0件）";
      return;
    }

    countEl.textContent = `（${matchedResults.length}件）`;
    resultsContainer.innerHTML = "";

    matchedResults.forEach(res => {
      const item = document.createElement("div");
      item.className = "search-result-item";
      item.onclick = () => {
        window.location.hash = `#/thread/${res.thread.id}`;
        // Auto scroll delay to element
        setTimeout(() => scrollToPost(res.post.postNumber), 500);
      };

      const dateStr = new Date(res.post.createdAt).toLocaleString();
      const snippetHtml = highlightKeyword(res.matchLocation, query);

      item.innerHTML = `
        <div class="search-result-header">
          <span>スレ: ${escapeHTML(res.thread.title)}</span>
          <span>レス ${res.post.postNumber} | ${dateStr}</span>
        </div>
        <div class="search-result-title">名前：${escapeHTML(res.post.name)} ID:${res.post.ipOrId}</div>
        <div class="search-result-match">${snippetHtml}</div>
      `;
      resultsContainer.appendChild(item);
    });

  } catch (e) {
    console.error(e);
    resultsContainer.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i> 検索中にエラーが発生しました。</div>`;
  }
}

// Slice text query snippets for preview
function getSnippet(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 40);
  let snippet = text.substring(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

// Escape html + wrap matching text in highlights class
function highlightKeyword(text, keyword) {
  const escaped = escapeHTML(text);
  const escapedKw = escapeHTML(keyword);
  const regex = new RegExp(`(${escapedKw})`, "gi");
  return escaped.replace(regex, '<span class="search-highlight">$1</span>');
}

// ==========================================================================
// 8. Dynamic Fetch Models from API Settings
// ==========================================================================
async function fetchAPIModels(provider, apiKey, endpoint) {
  let url = "";
  let headers = { "Content-Type": "application/json" };

  if (provider === "gemini") {
    // Gemini models retrieval
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  } else if (provider === "anthropic") {
    // Anthropic models
    url = endpoint || "https://api.anthropic.com/v1/models";
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (provider === "openai") {
    url = "https://api.openai.com/v1/models";
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (provider === "openai-compat") {
    const base = endpoint || "http://localhost:11434/v1";
    url = `${base}/models`;
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
  }

  // Make direct fetch call
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`API returned status ${response.status}`);
  }

  const data = await response.json();
  const modelList = [];

  if (provider === "gemini" && data.models) {
    data.models.forEach(m => {
      // filter generateContent capabilities
      if (m.supportedGenerationMethods.includes("generateContent")) {
        modelList.push(m.name.replace("models/", ""));
      }
    });
  } else if (provider === "openai" && data.data) {
    data.data.forEach(m => {
      if (m.id.includes("gpt") || m.id.includes("o1") || m.id.includes("o3")) {
        modelList.push(m.id);
      }
    });
  } else if (provider === "openai-compat" && data.data) {
    data.data.forEach(m => {
      modelList.push(m.id);
    });
  } else if (provider === "anthropic" && data.data) {
    data.data.forEach(m => {
      modelList.push(m.id);
    });
  } else {
    // fallback lists
    return ["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet", "gemini-2.0-flash", "deepseek-chat"];
  }

  return modelList;
}

function populateFetchedModels(models) {
  const container = document.getElementById("fetched-models-dropdown-group");
  const select = document.getElementById("settings-fetched-models-select");
  
  select.innerHTML = "";
  if (models.length === 0) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  models.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  });
  
  // Set first as default model selection
  document.getElementById("settings-ai-model").value = models[0];
}

// ==========================================================================
// 9. AI Response Client (Gemini, Claude, GPT, OpenAI-Compat)
// ==========================================================================
let aiTimers = {}; // Key: threadId, Value: Timer timeout ID

async function triggerAIResponse(thread) {
  // Clear any existing Scheduled AI response on this thread to avoid double-processing
  if (aiTimers[thread.id]) {
    clearTimeout(aiTimers[thread.id]);
  }

  if (!state.settings.aiKey && thread.aiProvider !== "openai-compat") {
    console.warn("AI Key not set. AI post ignored.");
    return;
  }

  // Calculate reply interval
  let minutes = 2; // Default fallback
  if (thread.aiInterval === "random") {
    minutes = Math.floor(Math.random() * (60 - 5 + 1)) + 5; // 5 to 60 mins random
  } else if (thread.aiInterval) {
    minutes = parseInt(thread.aiInterval);
  }

  const delayMs = minutes * 60 * 1000;
  console.log(`AI Scheduled to respond in ${minutes} minutes on Thread ID: ${thread.id}`);

  aiTimers[thread.id] = setTimeout(async () => {
    try {
      const activeThread = await state.db.get("threads", thread.id);
      // Double check active state
      if (!activeThread || activeThread.isArchived || activeThread.postCount >= 1000) return;

      // Retrieve full chat history
      const posts = await state.db.getPostsByThread(thread.id);
      
      // Call LLM API
      const replyText = await callLLMAPI(activeThread, posts);
      if (!replyText) return;

      // Next post writing
      const nextNum = activeThread.postCount + 1;
      const isSage = activeThread.aiDropInfluence === "sage";

      const aiPost = {
        threadId: activeThread.id,
        postNumber: nextNum,
        name: activeThread.aiName || state.settings.aiDefaultName,
        email: isSage ? "sage" : "",
        content: replyText,
        createdAt: Date.now(),
        ipOrId: "AI" + String(activeThread.id).padStart(6, "0"),
        attachments: []
      };

      await state.db.add("posts", aiPost);

      // Update active thread metadata
      activeThread.postCount = nextNum;
      if (!isSage) {
        activeThread.lastPostAt = Date.now();
      }
      if (nextNum >= 1000) {
        activeThread.isArchived = true;
      }
      await state.db.put("threads", activeThread);

      // Re-render Detail page if currently viewing the thread
      if (state.currentView === "thread-detail" && state.activeThreadId === activeThread.id) {
        renderThreadDetail(activeThread.id);
      }

    } catch (e) {
      console.error("AI writing failed:", e);
    }
  }, delayMs);
}

// Call configured Large Language Model
async function callLLMAPI(thread, posts) {
  const provider = thread.aiProvider || state.settings.aiProvider;
  const model = thread.aiModel || state.settings.aiModel;
  const key = state.settings.aiKey;
  const customEndpoint = state.settings.aiEndpoint;
  
  // Format Context prompt
  const systemPrompt = `System instructions: ${thread.aiTone || state.settings.aiDefaultPrompt}
  
現在、あなたは電子掲示板のスレッド内で他の住民と会話しています。
返信にはレスアンカー（例: >>1 や >>3）を使って特定の相手に繋げることができます。
返信は短く、掲示板への書き込みらしく、簡潔に返してください（長文は不要です。200文字以下が望ましい）。

スレッドの会話履歴:`;

  // Format historical conversation context
  let historyText = "";
  posts.slice(-20).forEach(p => {
    historyText += `\n>>${p.postNumber} 名前: ${p.name} (ID: ${p.ipOrId})\n${p.content}\n---`;
  });

  const fullPrompt = `${systemPrompt}\n${historyText}\n\nあなたの返信を生成してください。余計な説明文や挨拶は一切省き、掲示板のレス本文のみを出力してください。`;

  let reply = "";

  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }]
      })
    });
    if (!response.ok) throw new Error(`Gemini API returned ${response.status}`);
    const data = await response.json();
    reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  } else if (provider === "openai" || provider === "openai-compat") {
    const base = provider === "openai" ? "https://api.openai.com/v1" : (customEndpoint || "http://localhost:11434/v1");
    const url = `${base}/chat/completions`;
    
    const headers = { "Content-Type": "application/json" };
    if (key) {
      headers["Authorization"] = `Bearer ${key}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: "You are a Japanese anonymous board user acting out your character traits." },
          { role: "user", content: fullPrompt }
        ],
        max_tokens: 250
      })
    });
    if (!response.ok) throw new Error(`OpenAI API returned ${response.status}`);
    const data = await response.json();
    reply = data.choices?.[0]?.message?.content || "";

  } else if (provider === "anthropic") {
    // Anthropic direct call
    const url = customEndpoint || "https://api.anthropic.com/v1/messages";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 250,
        messages: [{ role: "user", content: fullPrompt }]
      })
    });
    if (!response.ok) throw new Error(`Anthropic API returned ${response.status}`);
    const data = await response.json();
    reply = data.content?.[0]?.text || "";
  }

  return reply.trim();
}

// ==========================================================================
// 10. Backup Data Export & Import (ZIP Packages)
// ==========================================================================

async function exportAllDataZip() {
  const btn = document.getElementById("btn-export-all");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> エクスポート中...`;

  try {
    const boards = await state.db.getAll("boards");
    const threads = await state.db.getAll("threads");
    const posts = await state.db.getAll("posts");
    const ngList = await state.db.getAll("ng_list");
    const settings = await state.db.getAll("settings");

    const dataJson = {
      version: "1.0.0",
      timestamp: Date.now(),
      boards,
      threads,
      posts: posts.map(p => {
        // Strip out attachments large base64 data to export it separately in folders
        const pCopy = { ...p };
        if (pCopy.attachments && pCopy.attachments.length > 0) {
          pCopy.attachments = pCopy.attachments.map(att => ({
            name: att.name,
            type: att.type,
            size: att.size
            // data omitted here, stored separately in zip file
          }));
        }
        return pCopy;
      }),
      ngList,
      settings
    };

    const zip = new JSZip();
    zip.file("data.json", JSON.stringify(dataJson, null, 2));

    // Storing files individually inside a separate directory
    const filesFolder = zip.folder("files");
    
    for (const post of posts) {
      if (post.attachments && post.attachments.length > 0) {
        for (const att of post.attachments) {
          if (!att.data) continue;
          
          // Split Base64 header and extract body
          const commaIdx = att.data.indexOf(",");
          const base64Body = att.data.substring(commaIdx + 1);
          
          const filename = `${post.id}_${att.name}`;
          filesFolder.file(filename, base64Body, { base64: true });
        }
      }
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const downloadUrl = URL.createObjectURL(zipBlob);
    
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `bbs_memo_export_${new Date().toISOString().substring(0, 10)}.zip`;
    a.click();
    
    URL.revokeObjectURL(downloadUrl);
    alert("全データのエクスポートが完了しました。");

  } catch (e) {
    console.error(e);
    alert("エクスポート中にエラーが発生しました。");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-file-export"></i> 全データをエクスポート (ZIP)`;
  }
}

async function importDataZip(event) {
  const file = event.target.files[0];
  if (!file) return;

  const mode = confirm("データをマージしますか？\n（[OK]を押すとマージ、[キャンセル]を押すと既存データを全削除して上書きインポートします）");
  const clearDb = !mode;

  try {
    const zip = await JSZip.loadAsync(file);
    const dataJsonFile = zip.file("data.json");
    if (!dataJsonFile) {
      alert("不適切なZIPファイルです。data.json が見つかりません。");
      return;
    }

    const jsonText = await dataJsonFile.async("text");
    const imported = JSON.parse(jsonText);

    if (clearDb) {
      // Complete reset
      await state.db.clear("boards");
      await state.db.clear("threads");
      await state.db.clear("posts");
      await state.db.clear("settings");
      await state.db.clear("ng_list");
    }

    // Restore Settings
    if (imported.settings) {
      for (const s of imported.settings) {
        await state.db.put("settings", s);
      }
    }

    // Restore Boards
    if (imported.boards) {
      for (const b of imported.boards) {
        await state.db.put("boards", b);
      }
    }

    // Restore Threads
    if (imported.threads) {
      for (const t of imported.threads) {
        await state.db.put("threads", t);
      }
    }

    // Restore NG List
    if (imported.ngList) {
      for (const ng of imported.ngList) {
        await state.db.put("ng_list", ng);
      }
    }

    // Restore Posts with Attachment folder files
    if (imported.posts) {
      for (const p of imported.posts) {
        // Look up file attachments inside ZIP
        if (p.attachments && p.attachments.length > 0) {
          for (const att of p.attachments) {
            const filename = `files/${p.id}_${att.name}`;
            const zipFile = zip.file(filename);
            if (zipFile) {
              const base64Body = await zipFile.async("base64");
              att.data = `data:${att.type};base64,${base64Body}`;
            }
          }
        }
        await state.db.put("posts", p);
      }
    }

    alert("データのインポートが完了しました。アプリをリロードします。");
    window.location.hash = "#/";
    window.location.reload();

  } catch (e) {
    console.error(e);
    alert("インポート中にエラーが発生しました。ファイルの整合性を確認してください。");
  } finally {
    document.getElementById("import-file").value = "";
  }
}

// ==========================================================================
// 11. Board & Thread Edit / Delete Helpers
// ==========================================================================

async function openEditBoardModal(boardId) {
  const board = await state.db.get("boards", boardId);
  if (!board) return;

  document.getElementById("edit-board-id").value = board.id;
  document.getElementById("edit-board-name").value = board.name;
  document.getElementById("edit-board-desc").value = board.description || "";
  document.getElementById("edit-board-tags-input").value = (board.tags || []).join(", ");

  document.getElementById("modal-edit-board").classList.add("active");
}

async function openEditThreadModal(threadId) {
  const thread = await state.db.get("threads", threadId);
  if (!thread) return;

  document.getElementById("edit-thread-id").value = thread.id;
  document.getElementById("edit-thread-title").value = thread.title;
  document.getElementById("edit-thread-tags-input").value = (thread.tags || []).join(", ");

  // Set drop time selection
  const dropSel = document.getElementById("edit-thread-droptime");
  const opt = [...dropSel.options].find(o => parseInt(o.value) === thread.dropTimeLimit);
  if (opt) opt.selected = true;

  // AI fields
  const aiEnabled = !!thread.aiEnabled;
  document.getElementById("edit-thread-ai-enabled").checked = aiEnabled;
  const aiSub = document.getElementById("edit-thread-ai-settings-sub");
  aiSub.classList.toggle("hidden", !aiEnabled);

  if (aiEnabled) {
    // Interval
    const intSel = document.getElementById("edit-thread-ai-interval");
    const intOpt = [...intSel.options].find(o => o.value === String(thread.aiInterval));
    if (intOpt) intOpt.selected = true;

    // AI drop influence
    const infSel = document.getElementById("edit-thread-ai-influence");
    const infOpt = [...infSel.options].find(o => o.value === thread.aiDropInfluence);
    if (infOpt) infOpt.selected = true;

    document.getElementById("edit-thread-ai-name-custom").value = thread.aiName || "";
    document.getElementById("edit-thread-ai-prompt-custom").value = thread.aiTone || "";
  }

  document.getElementById("modal-edit-thread").classList.add("active");
}

async function deleteBoardCascading(boardId) {
  try {
    const threads = await state.db.getAll("threads");
    const posts = await state.db.getAll("posts");

    const boardThreads = threads.filter(t => t.boardId === boardId);
    for (const thread of boardThreads) {
      const threadPosts = posts.filter(p => p.threadId === thread.id);
      for (const p of threadPosts) {
        await state.db.delete("posts", p.id);
      }
      await state.db.delete("threads", thread.id);
    }

    await state.db.delete("boards", boardId);
    renderBoardList();
    updateStorageDashboard();
  } catch (err) {
    console.error(err);
    alert("板の削除中にエラーが発生しました。");
  }
}

async function deleteThreadCascading(threadId) {
  try {
    const posts = await state.db.getAll("posts");
    const threadPosts = posts.filter(p => p.threadId === threadId);
    for (const p of threadPosts) {
      await state.db.delete("posts", p.id);
    }
    await state.db.delete("threads", threadId);
  } catch (err) {
    console.error(err);
    alert("スレッドの削除中にエラーが発生しました。");
  }
}
