"use strict";

const $ = (id) => document.getElementById(id);
const IS_ADMIN_PAGE = location.pathname === "/admin" || location.pathname === "/admin/";
// iPadOS may present a desktop UA; maxTouchPoints distinguishes it from a Mac.
const IS_IOS_SAFARI =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if (IS_ADMIN_PAGE) document.documentElement.classList.add("admin-mode");

const audioA = $("audio");
const audioB = $("audioB");
let audio = audioA;
const bgLayerA = $("bgLayerA");
const bgLayerB = $("bgLayerB");
const stationName = $("stationName");
const stationSubtitle = $("stationSubtitle");
const noticeBar = $("noticeBar");
const syncStatus = $("syncStatus");
const listenerCount = $("listenerCount");
const nicknameBtn = $("nicknameBtn");
const themeToggle = $("themeToggle");
const bgPickerBtn = $("bgPickerBtn");
const bgLocalInput = $("bgLocalInput");
const bgLocalModal = $("bgLocalModal");
const bgLocalGallery = $("bgLocalGallery");
const bgLocalStatus = $("bgLocalStatus");
const bgLocalAdd = $("bgLocalAdd");
const bgLocalReset = $("bgLocalReset");
const bgLocalSave = $("bgLocalSave");
const libraryBtn = $("libraryBtn");
const libraryBadge = $("libraryBadge");
const title = $("title");
const artist = $("artist");
const album = $("album");
const positionEl = $("position");
const durationEl = $("duration");
const progressTrack = $("progressTrack");
const progressFill = $("progressFill");
const playBtn = $("playBtn");
const voteSkipBtn = $("voteSkipBtn");
const voteInfo = $("voteInfo");
const muteBtn = $("muteBtn");
const volumeEl = $("volume");
const audioMode = $("audioMode");
const sourceBadge = $("sourceBadge");
const cover = $("cover");
const coverButton = $("coverButton");
const stage = $("stage");
const pages = $("pages");
const playbackPage = $("playbackPage");
const chatPage = $("chatPage");
const chatBtn = $("chatBtn");
const currentLyric = $("currentLyric");
const currentLyricText = $("currentLyricText");
const currentLyricTrans = $("currentLyricTrans");
const nextTrackInfo = $("nextTrackInfo");
const nextCover = $("nextCover");
const nextTitle = $("nextTitle");
const nextArtist = $("nextArtist");
const trackMeta = document.querySelector(".track-meta");
const lyricsScroll = $("lyricsScroll");
const lyricsEl = $("lyrics");
const translationToggle = $("translationToggle");
const lyricsPanel = $("lyricsPanel");
const playlistList = $("playlistList");
const playlistCount = $("playlistCount");
const historyList = $("historyList");
const viewQueueBtn = $("viewQueueBtn");
const viewHistoryBtn = $("viewHistoryBtn");
const queueHistorySwitch = $("queueHistorySwitch");
const searchResultsPanel = $("searchResultsPanel");
const queuePanel = $("queuePanel");
const historyPanel = $("historyPanel");
const drawer = $("libraryDrawer");
const drawerBackdrop = $("drawerBackdrop");
const searchCancelBtn = $("searchCancelBtn");
const searchForm = $("searchForm");
const searchInput = $("searchInput");
const searchBtn = $("searchBtn");
const searchStatus = $("searchStatus");
const searchResults = $("searchResults");
const uploadBtn = $("uploadBtn");
const uploadInput = $("uploadInput");
const messageForm = $("messageForm");
const messageInput = $("messageInput");
const messageBtn = $("messageBtn");
const messageStatus = $("messageStatus");
const messageList = $("messageList");
const toast = $("toast");

const nicknameModal = $("nicknameModal");
const nicknameInput = $("nicknameInput");
const nicknameSave = $("nicknameSave");
const nicknameStatus = $("nicknameStatus");
const listenersModal = $("listenersModal");
const listenersList = $("listenersList");
const listenersSummary = $("listenersSummary");
const listenersClose = $("listenersClose");

const state = {
  now: null,
  seq: null,
  audioRev: null,
  audioKey: null,
  sources: [],
  sourceIndex: 0,
  clockOffset: 0,
  userWantsPlay: false,
  pendingSeekMs: 0,
  lastLoadedSeq: null,
  lyricsTrackId: null,
  lyricsLines: [],
  lyricEls: [],
  lastLyricIndex: -1,
  lyricsManualAt: 0,
  lyricsManualTimer: null,
  lyricProgrammaticUntil: 0,
  lastPositionSec: -1,
  lastReportKey: null,
  stalledTimer: null,
  pollTimer: null,
  connection: "connecting",
  audioState: "idle",
  serverPaused: false,
  sidebarLoading: false,
  showTranslation: true,
  nickname: "",
  uiConfig: null,
  backgrounds: [],
  bgIntervalSec: 300,
  bgKey: "",
  bgUrl: "",
  bgKind: "config",
  coverUrl: "",
  trackCoverUrl: "",
  localBackgrounds: [],
  localBgIndex: 0,
  localBgTimer: null,
  bgActive: 0,
  bgTimer: null,
  searchResults: [],
  historyItems: [],
  activeTrackIds: [],
  viewMode: "queue",
  searchActive: false,
  page: "playback",
  lyricsOpen: false,
  currentLyricIndex: -1,
  currentLyricToken: 0,
  pendingRequest: null,
  searchBusy: false,
  requestBusy: false,
  requestTs: Date.now() - 5000,
  messageBusy: false,
  messageTs: Date.now() - 5000,
  lastMessageCount: -1,
  preloadAudio: null,
  preloadKey: "",
  preloadCover: null,
  frameId: null,
  lastMediaPositionAt: 0,
};

// Local/owner playback can request ?direct=1 to avoid P2P entirely and
// pull audio straight from this server's /native endpoint.
const LOCAL_DIRECT = new URLSearchParams(location.search).get("direct") === "1";
const mesh = LOCAL_DIRECT ? null : window.RadioMesh || null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setupMarquee(element, force = false) {
  if (!element) return;
  const text = String(element.textContent || "").trim();
  if (!text) {
    element.classList.remove("marquee");
    element.dataset.marqueeText = "";
    element.style.removeProperty("--marquee-distance");
    element.style.removeProperty("--marquee-duration");
    return;
  }
  // Re-rendering a track must not restart an already-running marquee.  This
  // was why a long title only moved a few pixels and then snapped back.
  if (!force && element.dataset.marqueeText === text) return;
  element.dataset.marqueeText = text;
  if (element.classList.contains("hidden") || element.clientWidth < 2) {
    element.classList.remove("marquee");
    return;
  }
  element.classList.remove("marquee");
  element.style.removeProperty("--marquee-distance");
  element.style.removeProperty("--marquee-duration");
  requestAnimationFrame(() => {
    if (element.dataset.marqueeText !== text) return;
    const overflow = Math.max(0, element.scrollWidth - element.clientWidth);
    if (overflow < 4) return;
    element.style.setProperty("--marquee-distance", `-${overflow}px`);
    element.style.setProperty("--marquee-duration", `${Math.max(5, overflow / 22)}s`);
    element.classList.add("marquee");
  });
}

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (_) {
    /* ignore */
  }
}

function cookieGet(name) {
  try {
    const prefix = `${encodeURIComponent(name)}=`;
    for (const part of document.cookie.split(";")) {
      const value = part.trim();
      if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
    }
  } catch (_) {
    /* ignore */
  }
  return "";
}

function cookieSet(name, value, maxAge = 31_536_000) {
  try {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
  } catch (_) {
    /* ignore */
  }
}

async function fetchJSON(url, options = {}) {
  const { timeout = 15000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { cache: "no-store", ...init, signal: controller.signal });
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }
    if (!response.ok) {
      const error = new Error((data && data.message) || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function errorText(error, fallback = "操作失败") {
  return (error && error.data && error.data.message) || (error && error.message) || fallback;
}

function setPill(kind, text) {
  syncStatus.dataset.state = kind;
  syncStatus.textContent = text;
}

function refreshStatus() {
  if (state.connection === "offline") {
    setPill("offline", navigator.onLine ? "连接中断" : "离线");
    return;
  }
  if (state.serverPaused) {
    setPill("buffering", "电台已暂停");
    return;
  }
  if (state.audioState === "error") {
    setPill("offline", "音频不可用");
    return;
  }
  if (!state.userWantsPlay && audio.paused) {
    setPill(state.now && state.now.track ? "live" : "connecting", state.now && state.now.track ? "已同步" : "待开播");
    return;
  }
  if (state.audioState === "buffering") {
    setPill("buffering", "缓冲中");
    return;
  }
  if (!state.now || !state.now.track) {
    setPill("connecting", "待开播");
    return;
  }
  setPill("live", "已同步");
}

function updateListenerUI(now) {
  const listeners = now && Number.isFinite(Number(now.listeners)) ? Number(now.listeners) : 0;
  listenerCount.textContent = `${listeners} 人`;
  listenerCount.setAttribute("aria-label", `查看在听的人，共 ${listeners} 人`);
  listenerCount.title = `查看在听的人（${listeners} 人）`;
}

function renderListeners(data) {
  const items = Array.isArray(data && data.items) ? data.items : [];
  const count = Number(data && data.listeners) || items.length;
  listenersSummary.textContent = `${count} 人在听`;
  listenersList.textContent = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "还没有人在听";
    listenersList.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "listener-row";
    const dot = document.createElement("span");
    dot.className = "listener-dot";
    const name = document.createElement("span");
    name.className = "listener-name";
    name.textContent = item.nickname || "匿名";
    row.appendChild(dot);
    row.appendChild(name);
    if (state.nickname && item.nickname === state.nickname) {
      const me = document.createElement("span");
      me.className = "listener-me";
      me.textContent = "我";
      row.appendChild(me);
    }
    listenersList.appendChild(row);
  }
}

async function refreshListeners() {
  const suffix = state.nickname
    ? `?nickname=${encodeURIComponent(state.nickname)}`
    : "";
  try {
    const data = await fetchJSON(`/api/listeners${suffix}`, { timeout: 8_000 });
    renderListeners(data);
  } catch (_) {
    listenersSummary.textContent = "暂时无法获取在听列表";
    listenersList.textContent = "";
  }
}

function openListenersModal() {
  showModal(listenersModal);
  refreshListeners();
  clearInterval(state.listenersTimer);
  state.listenersTimer = setInterval(refreshListeners, 5_000);
}

function closeListenersModal() {
  hideModal(listenersModal);
  clearInterval(state.listenersTimer);
  state.listenersTimer = null;
}

function updateVoteUI(now) {
  const hasTrack = Boolean(now && now.track);
  const vote = (now && now.vote) || {};
  const votes = Number(vote.votes) || 0;
  const needed = Number(vote.needed) || 1;
  voteInfo.textContent = hasTrack ? String(votes) : "0";
  voteInfo.classList.toggle("hidden", !hasTrack || votes <= 0);
  const label = vote.voted
    ? "已投票，等待其他人"
    : `投票切歌，达到 ${needed} 票切换下一首`;
  voteSkipBtn.disabled = !hasTrack || Boolean(vote.voted);
  voteSkipBtn.title = label;
  voteSkipBtn.setAttribute("aria-label", label);
  voteSkipBtn.classList.toggle("voted", Boolean(vote.voted));
}

async function voteSkip() {
  if (!state.now || !state.now.track) return;
  voteSkipBtn.disabled = true;
  try {
    const data = await fetchJSON("/api/vote-skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      timeout: 10_000,
    });
    if (data.now) applyNow(data.now);
    if (data.switched) {
      loadSidebar();
      pollSoon();
    }
  } catch (error) {
    voteSkipBtn.title = errorText(error, "投票失败");
    pollNow();
  }
}

function sourceLabel(source) {
  if (source === "netease") return "网易云音乐";
  if (source === "qq") return "QQ音乐";
  if (source === "bilibili") return "哔哩哔哩";
  if (source === "upload") return "本地上传";
  if (source === "local") return "本地";
  return source || "未知来源";
}

function fmtTime(ms, estimated = false) {
  if (!Number.isFinite(ms) || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const prefix = estimated ? "~" : "";
  if (hours > 0) {
    return `${prefix}${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${prefix}${minutes}:${String(seconds).padStart(2, "0")}`;
}

function fmtRelative(timestamp) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function currentPosition(now = state.now) {
  if (!now || !now.track) return 0;
  if (now.paused) return Math.max(0, Number(now.position_ms) || 0);
  const live = Date.now() + state.clockOffset - Number(now.started_at_ms || 0);
  return clamp(live, 0, Number(now.duration_ms) || Number.MAX_SAFE_INTEGER);
}

/* ---------- config, theme, background ---------- */

function applyTheme(value, persist = true) {
  const theme = value === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (persist) storageSet("radio.theme", theme);
  const sun = themeToggle.querySelector(".icon-sun");
  const moon = themeToggle.querySelector(".icon-moon");
  if (sun) sun.classList.toggle("hidden", theme !== "light");
  if (moon) moon.classList.toggle("hidden", theme === "light");
  const label = theme === "light" ? "切换到深色模式" : "切换到浅色模式";
  themeToggle.setAttribute("aria-label", label);
  themeToggle.title = label;
}

function loadTheme() {
  const stored = storageGet("radio.theme");
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
    return;
  }
  const query =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: light)");
  applyTheme(query && query.matches ? "light" : "dark", false);
  if (query && query.addEventListener) {
    query.addEventListener("change", (event) => {
      if (!storageGet("radio.theme")) {
        applyTheme(event.matches ? "light" : "dark", false);
      }
    });
  }
}

function applyConfig(config) {
  state.uiConfig = config;
  stationName.textContent = config.station_name || "猫娘电台";
  stationSubtitle.textContent = config.subtitle || "";
  // The top bar stays compact; the subtitle lives in the browser tab as
  // "Station - Subtitle" and follows renames automatically.
  const stationTitle = config.station_name || "猫娘电台";
  const stationTagline = String(config.subtitle || "").trim();
  document.title = stationTagline ? `${stationTitle} - ${stationTagline}` : stationTitle;
  const notice = String(config.notice || "").trim();
  if (notice) {
    noticeBar.textContent = notice;
    noticeBar.classList.remove("hidden");
  } else {
    noticeBar.textContent = "";
    noticeBar.classList.add("hidden");
  }

  state.backgrounds = Array.isArray(config.backgrounds) ? config.backgrounds : [];
  state.bgIntervalSec = clamp(Number(config.background_interval_sec) || 300, 30, 86400);

  if (state.bgKind === "local" || (state.bgKind === "cover" && state.coverUrl)) {
    return;
  }
  if (!state.backgrounds.length) {
    clearBackgroundLayers();
  } else if (!state.bgUrl || !state.backgrounds.some((item) => item.url === state.bgUrl)) {
    applyRandomBackground();
  }
  setupBackgroundTimer();
}

async function loadConfig() {
  try {
    applyConfig(await fetchJSON("/api/config"));
  } catch (_) {
    /* config is best-effort */
  }
}

function applyRandomBackground(force = false) {
  if (state.bgKind === "cover" || state.bgKind === "local" || !state.backgrounds.length) return;
  let index = Math.floor(Math.random() * state.backgrounds.length);
  if (state.backgrounds.length > 1 && state.backgrounds[index].url === state.bgUrl) {
    index = (index + 1) % state.backgrounds.length;
  }
  if (!force && state.backgrounds[index].url === state.bgUrl) return;
  applyBackground(state.backgrounds[index]);
}

function applyBackground(item, kind = "config") {
  if (!item || !item.url) return;
  const layer = state.bgActive === 0 ? bgLayerB : bgLayerA;
  const other = state.bgActive === 0 ? bgLayerA : bgLayerB;
  layer.style.backgroundImage = `url("${item.url.replace(/"/g, "%22")}")`;
  layer.classList.toggle("cover", kind === "cover");
  layer.classList.toggle("local", kind === "local");
  other.classList.remove("cover", "local");
  layer.classList.add("active");
  other.classList.remove("active");
  state.bgActive = state.bgActive === 0 ? 1 : 0;
  state.bgUrl = item.url;
  state.bgKind = kind;
}

function applyCoverBackground(url) {
  if (state.bgKind === "local") return;
  if (!url || url.endsWith("/placeholder.svg")) {
    restoreConfigBackground();
    return;
  }
  if (state.bgKind === "cover" && state.coverUrl === url) return;
  state.coverUrl = url;
  applyBackground({ url }, "cover");
  clearInterval(state.bgTimer);
  state.bgTimer = null;
}

function restoreConfigBackground() {
  if (state.bgKind === "local" || state.bgKind !== "cover") return;
  state.coverUrl = "";
  state.bgKind = "config";
  if (state.backgrounds.length) {
    state.bgUrl = "";
    applyRandomBackground(true);
  } else {
    clearBackgroundLayers();
  }
  setupBackgroundTimer();
}

function clearBackgroundLayers() {
  bgLayerA.classList.remove("active");
  bgLayerB.classList.remove("active");
  bgLayerA.style.backgroundImage = "";
  bgLayerB.style.backgroundImage = "";
  state.bgUrl = "";
}

function setupBackgroundTimer() {
  if (state.bgKind === "cover" || state.bgKind === "local") return;
  const key = `${state.bgIntervalSec}:${state.backgrounds.map((item) => item.url).join("|")}`;
  if (key === state.bgKey && state.bgTimer) return;
  state.bgKey = key;
  clearInterval(state.bgTimer);
  state.bgTimer = null;
  if (state.backgrounds.length > 1) {
    state.bgTimer = setInterval(() => applyRandomBackground(), state.bgIntervalSec * 1000);
  }
}

/* ---------- per-client local backgrounds (IndexedDB) ---------- */

const LOCAL_BG_DB = "radio-local-backgrounds";
const LOCAL_BG_STORE = "backgrounds";
const LOCAL_BG_MAX = 5;
const LOCAL_BG_INTERVAL_MS = 45_000;

function openLocalBgDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("当前浏览器不支持本地背景存储"));
      return;
    }
    const request = indexedDB.open(LOCAL_BG_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_BG_STORE)) {
        db.createObjectStore(LOCAL_BG_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地背景库"));
  });
}

function localBgRequest(mode, callback) {
  return openLocalBgDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_BG_STORE, mode);
        const store = tx.objectStore(LOCAL_BG_STORE);
        let result;
        try {
          result = callback(store);
        } catch (error) {
          reject(error);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(result && result.result !== undefined ? result.result : result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("本地背景操作失败"));
        };
      }),
  );
}

async function readLocalBgRecords() {
  const db = await openLocalBgDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_BG_STORE, "readonly");
    const request = tx.objectStore(LOCAL_BG_STORE).getAll();
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result : [];
      rows.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      resolve(rows);
    };
    request.onerror = () => reject(request.error || new Error("读取本地背景失败"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("读取本地背景失败"));
    };
  });
}

async function writeLocalBgRecord(record) {
  return localBgRequest("readwrite", (store) => store.put(record));
}

async function deleteLocalBgRecord(id) {
  return localBgRequest("readwrite", (store) => store.delete(id));
}

async function clearLocalBgRecords() {
  return localBgRequest("readwrite", (store) => store.clear());
}

function revokeLocalBgUrls() {
  for (const item of state.localBackgrounds) {
    if (item.url) URL.revokeObjectURL(item.url);
  }
}

function stopLocalBgTimer() {
  if (state.localBgTimer) {
    clearInterval(state.localBgTimer);
    state.localBgTimer = null;
  }
}

function applyLocalBgAt(index) {
  if (!state.localBackgrounds.length) return;
  const next = (index + state.localBackgrounds.length) % state.localBackgrounds.length;
  state.bgKind = "local";
  state.localBgIndex = next;
  applyBackground({ url: state.localBackgrounds[next].url }, "local");
  bgPickerBtn.classList.add("active");
}

function startLocalBgCycle() {
  stopLocalBgTimer();
  bgPickerBtn.classList.toggle("active", state.localBackgrounds.length > 0);
  if (!state.localBackgrounds.length) return;
  applyLocalBgAt(Math.min(state.localBgIndex, state.localBackgrounds.length - 1));
  if (state.localBackgrounds.length > 1) {
    state.localBgTimer = setInterval(() => {
      if (!document.hidden) applyLocalBgAt(state.localBgIndex + 1);
    }, LOCAL_BG_INTERVAL_MS);
  }
}

function restoreAfterLocalBg() {
  stopLocalBgTimer();
  state.bgKind = "config";
  bgPickerBtn.classList.remove("active");
  if (state.trackCoverUrl) {
    applyCoverBackground(state.trackCoverUrl);
    return;
  }
  if (state.backgrounds.length) {
    state.bgUrl = "";
    applyRandomBackground(true);
  } else {
    clearBackgroundLayers();
  }
  setupBackgroundTimer();
}

function setLocalBackgrounds(records) {
  stopLocalBgTimer();
  revokeLocalBgUrls();
  state.localBackgrounds = records.slice(-LOCAL_BG_MAX).map((row) => ({
    id: String(row.id),
    createdAt: Number(row.createdAt || 0),
    url: URL.createObjectURL(row.blob),
  }));
  if (state.localBackgrounds.length) {
    startLocalBgCycle();
  } else {
    restoreAfterLocalBg();
  }
}

function renderLocalBgGallery() {
  bgLocalGallery.textContent = "";
  if (!state.localBackgrounds.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "还没有本地背景";
    bgLocalGallery.appendChild(empty);
    return;
  }
  for (const item of state.localBackgrounds) {
    const card = document.createElement("div");
    card.className = "bg-local-thumb";
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = "";
    card.appendChild(img);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "bg-local-remove";
    remove.setAttribute("aria-label", "删除这张背景");
    remove.title = "删除这张背景";
    remove.appendChild(makeIcon(["m6 6 12 12M18 6 6 18"], true));
    remove.addEventListener("click", async () => {
      try {
        await deleteLocalBgRecord(item.id);
        await loadLocalBackgrounds();
        setBgLocalStatus("已删除", "ok");
      } catch (error) {
        setBgLocalStatus(error.message || "删除失败", "error");
      }
    });
    card.appendChild(remove);
    bgLocalGallery.appendChild(card);
  }
}

function setBgLocalStatus(text, tone = "") {
  bgLocalStatus.textContent = text;
  bgLocalStatus.dataset.tone = tone;
}

function openBgLocalModal() {
  renderLocalBgGallery();
  setBgLocalStatus("");
  bgLocalModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeBgLocalModal() {
  bgLocalModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function loadLocalBackgrounds() {
  try {
    const records = await readLocalBgRecords();
    setLocalBackgrounds(records);
    if (!bgLocalModal.classList.contains("hidden")) renderLocalBgGallery();
  } catch (error) {
    setBgLocalStatus(error.message || "本地背景不可用", "error");
  }
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片无法读取"));
    };
    image.src = url;
  });
}

async function compressBackgroundFile(file) {
  if (!file.type || !file.type.startsWith("image/")) {
    throw new Error("只能选择图片文件");
  }
  if (file.size > 24 * 1024 * 1024) {
    throw new Error("单张图片不能超过 24MB");
  }
  const image = await loadImageFile(file);
  const maxWidth = 1920;
  const maxHeight = 1200;
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法处理图片");
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.84),
  );
  if (!blob) throw new Error("图片压缩失败");
  if (blob.size > 3 * 1024 * 1024) throw new Error("压缩后仍然过大");
  return blob;
}

async function addLocalBackgroundFiles(files) {
  const available = LOCAL_BG_MAX - state.localBackgrounds.length;
  if (available <= 0) {
    setBgLocalStatus("最多只能保存 5 张本地背景", "error");
    return;
  }
  const selected = Array.from(files || []).slice(0, available);
  if (!selected.length) return;
  setBgLocalStatus("正在处理图片…", "busy");
  let added = 0;
  for (const file of selected) {
    try {
      const blob = await compressBackgroundFile(file);
      await writeLocalBgRecord({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        blob,
        createdAt: Date.now(),
      });
      added += 1;
    } catch (error) {
      setBgLocalStatus(error.message || "有一张图片无法添加", "error");
    }
  }
  bgLocalInput.value = "";
  await loadLocalBackgrounds();
  if (added) {
    setBgLocalStatus(
      `已添加 ${added} 张，本地背景会每 45 秒平滑切换`,
      "ok",
    );
    if (state.localBackgrounds.length) bgPickerBtn.classList.add("active");
  }
}

/* ---------- nickname ---------- */

function loadNickname() {
  state.nickname = (
    storageGet("radio.nickname") ||
    cookieGet("radio_nickname") ||
    ""
  ).trim();
  if (state.nickname) {
    storageSet("radio.nickname", state.nickname);
    cookieSet("radio_nickname", state.nickname);
  }
  updateNicknameUI();
}

function updateNicknameUI() {
  if (state.nickname) {
    nicknameBtn.setAttribute("aria-label", `昵称：${state.nickname}`);
    nicknameBtn.title = `昵称：${state.nickname}`;
  } else {
    nicknameBtn.setAttribute("aria-label", "设置昵称");
    nicknameBtn.title = "设置昵称";
  }
}

function openNicknameModal() {
  nicknameInput.value = state.nickname;
  nicknameStatus.textContent = "";
  showModal(nicknameModal);
  setTimeout(() => nicknameInput.focus(), 50);
}

function saveNickname() {
  const value = nicknameInput.value.trim().slice(0, 16);
  if (!value) {
    nicknameStatus.textContent = "昵称不能为空";
    nicknameStatus.dataset.tone = "error";
    return;
  }
  state.nickname = value;
  storageSet("radio.nickname", value);
  cookieSet("radio_nickname", value);
  updateNicknameUI();
  hideModal(nicknameModal);
  nicknameStatus.textContent = "";
  pollSoon();
  if (!listenersModal.classList.contains("hidden")) refreshListeners();
  if (state.pendingRequest) {
    const { payload, item } = state.pendingRequest;
    state.pendingRequest = null;
    submitRequest(payload, item, null);
  }
  if (state.pendingUpload) {
    const file = state.pendingUpload;
    state.pendingUpload = null;
    uploadLocalAudio(file);
  }
}

/* ---------- player ---------- */

function updatePlayButton() {
  const hasTrack = Boolean(state.now && state.now.track);
  const playing = hasTrack && state.userWantsPlay && !audio.paused && !state.serverPaused;
  playBtn.disabled = !hasTrack || state.serverPaused;
  playBtn.setAttribute("aria-label", playing ? "暂停" : "播放");
  playBtn.querySelector(".icon-play").classList.toggle("hidden", playing);
  playBtn.querySelector(".icon-pause").classList.toggle("hidden", !playing);
}

function setLivePill() {
  // The player card no longer carries a second "正在播放/播放中" label.
}


function renderTrack(now) {
  const track = now.track;
  title.textContent = track.title || "未知曲目";
  artist.textContent = track.artist || "--";
  album.textContent = track.album || "--";
  setupMarquee(title);
  durationEl.textContent = fmtTime(now.duration_ms, track.duration_estimated);
  sourceBadge.textContent = sourceLabel(track.source);
  const newCover = track.cover_url || "/placeholder.svg";
  if (cover.getAttribute("src") !== newCover) {
    cover.src = newCover;
  }
  state.trackCoverUrl = track.cover_url || "";
  if (state.bgKind !== "local") {
    if (state.trackCoverUrl) applyCoverBackground(state.trackCoverUrl);
    else restoreConfigBackground();
  }
  setLivePill();
}

function renderNext(next) {
  if (!next) {
    nextTrackInfo.classList.add("empty");
    return;
  }
  nextTrackInfo.classList.remove("empty");
  const image = next.cover_url || "/placeholder.svg";
  if (nextCover.getAttribute("src") !== image) nextCover.src = image;
  nextTitle.textContent = next.title || "未知曲目";
  nextArtist.textContent = [next.artist || "未知歌手", next.album || ""]
    .filter(Boolean)
    .join(" · ");
}

function clearTrack() {
  title.textContent = "等待开播";
  artist.textContent = "--";
  album.textContent = "--";
  positionEl.textContent = "00:00";
  durationEl.textContent = "--:--";
  progressFill.style.width = "0%";
  progressTrack.setAttribute("aria-valuenow", "0");
  sourceBadge.textContent = "待机";
  audioMode.textContent = "等待音频";
  state.trackCoverUrl = "";
  if (state.bgKind !== "local") restoreConfigBackground();
  state.audioState = "idle";
  state.lastPositionSec = -1;
  setLyricsEmpty("等待开播");
  updatePlayButton();
  refreshStatus();
}

function updateAudioMode() {
  if (mesh && mesh.isActive()) {
    audioMode.textContent = mesh.statusText() || "P2P";
    return;
  }
  if (!state.sources.length) {
    audioMode.textContent = "无可用音频";
    return;
  }
  if (state.sourceIndex === 0) {
    audioMode.textContent =
      state.now && state.now.audio && state.now.audio.direct
        ? "服务器直连"
        : "备用源";
  } else {
    audioMode.textContent = `备用源 ${state.sourceIndex}`;
  }
}

function loadDirectSource(positionMs) {
  if (mesh) mesh.stop();
  if (!state.sources.length) {
    updateAudioMode();
    return;
  }
  const url = state.sources[state.sourceIndex];
  state.pendingSeekMs = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  state.audioKey = `${state.seq}:${state.audioRev}:${state.sourceIndex}`;
  state.audioState = state.userWantsPlay ? "buffering" : "idle";
  refreshStatus();
  updateAudioMode();
  audio.src = url;
  audio.load();
}

function loadSource(positionMs) {
  if (!state.sources.length) {
    updateAudioMode();
    return false;
  }
  if (mesh && mesh.start(state.now, positionMs)) {
    state.pendingSeekMs = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
    state.audioKey = `${state.seq}:${state.audioRev}:${state.sourceIndex}`;
    state.audioState = state.userWantsPlay ? "buffering" : "idle";
    refreshStatus();
    updateAudioMode();
    return true;
  }
  loadDirectSource(positionMs);
  return false;
}

if (mesh) {
  mesh.setFallbackCallback(() => {
    if (!state.now || !state.now.track) return;
    const direct = (state.now.audio && state.now.audio.direct) || "";
    const alternates = (state.now.audio && state.now.audio.alternates) || [];
    state.sources = [direct, ...alternates].filter(Boolean);
    state.sourceIndex = 0;
    state.audioState = "buffering";
    loadDirectSource(currentPosition());
    if (state.userWantsPlay) attemptPlay();
  });
}

function attemptPlay() {
  if (!state.userWantsPlay || state.serverPaused) return;
  audio.play().catch((error) => {
    if (error && error.name === "AbortError") return;
    if (error && error.name === "NotAllowedError") {
      state.userWantsPlay = false;
      if (mesh) mesh.setWanted(false);
      state.audioState = "idle";
      updatePlayButton();
      refreshStatus();
      return;
    }
    tryNextSource("error");
  });
}

function seekToLive() {
  if (mesh && mesh.isActive()) {
    mesh.seekLive();
    return;
  }
  const live = currentPosition();
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const target = Math.min(live / 1000, Math.max(0, audio.duration - 0.35));
  if (Math.abs(audio.currentTime - target) > 0.8) {
    try {
      audio.currentTime = target;
    } catch (_) {
      /* ignore */
    }
  }
}

function audioKeyForCurrent() {
  return `${state.seq}:${state.audioRev}:${state.sourceIndex}`;
}

function ensureSourceLoaded(now = state.now) {
  if (!state.sources.length) return false;
  if (!audio.src || state.audioKey !== audioKeyForCurrent()) {
    loadSource(currentPosition(now));
    return true;
  }
  return false;
}

function unloadAudio() {
  if (mesh) mesh.stop();
  if (audio.src) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  state.audioKey = null;
}

function stopPreload() {
  if (state.preloadAudio) {
    state.preloadAudio.removeAttribute("src");
    state.preloadAudio.load();
    state.preloadAudio = null;
  }
  state.preloadCover = null;
  state.preloadKey = "";
}

function fadeToNewAudio(oldElement, newElement) {
  const target = clamp(Number(volumeEl.value), 0, 1);
  if (document.hidden) {
    // requestAnimationFrame is paused in a background tab.  Switch gains
    // immediately so audio never becomes silent while the user is away.
    newElement.muted = oldElement.muted;
    newElement.volume = target;
    oldElement.volume = 0;
    oldElement.pause();
    oldElement.removeAttribute("src");
    oldElement.load();
    return;
  }
  const started = performance.now();
  newElement.volume = 0;
  newElement.muted = oldElement.muted;
  const tick = (now) => {
    const progress = Math.min(1, (now - started) / 520);
    newElement.volume = clamp(target * progress, 0, 1);
    oldElement.volume = clamp(target * (1 - progress), 0, 1);
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      oldElement.pause();
      oldElement.removeAttribute("src");
      oldElement.load();
    }
  };
  requestAnimationFrame(tick);
}

function fallbackToSingleElement(element, url, wasMesh, positionMs = 0) {
  if (!element || !url) return false;
  const target = Math.max(0, Number(positionMs) || 0);
  try {
    if (wasMesh && mesh) mesh.stop();
    element.pause();
    element.src = url;
    element.load();
    element.volume = clamp(Number(volumeEl.value), 0, 1);
    state.audioKey = `${state.seq}:${state.audioRev}:${state.sourceIndex}`;
    state.audioState = "buffering";
    audio = element;
    state.userWantsPlay = true;
    const begin = () => {
      try {
        if (Number.isFinite(element.duration) && element.duration > 0) {
          element.currentTime = Math.min(target / 1000, Math.max(0, element.duration - 0.25));
        }
      } catch (_) {
        /* ignore */
      }
      element.play().catch((error) => {
        if (error && error.name === "NotAllowedError") {
          state.userWantsPlay = false;
          state.audioState = "idle";
        } else {
          state.audioState = "error";
        }
        updatePlayButton();
        refreshStatus();
      });
    };
    if (element.readyState >= 1) begin();
    else element.addEventListener("loadedmetadata", begin, { once: true });
    updateAudioMode();
    updatePlayButton();
    refreshStatus();
    return true;
  } catch (_) {
    return false;
  }
}

function adoptPreloaded(url, positionMs) {
  if (IS_IOS_SAFARI) {
    const wasMesh = Boolean(mesh && mesh.isActive());
    if (fallbackToSingleElement(audio, url, wasMesh, 0)) return true;
  }
  const pre = state.preloadAudio;
  if (!pre || !pre.src || pre.readyState < 2) return false;
  let expected = "";
  try {
    expected = new URL(url, location.href).href;
  } catch (_) {
    return false;
  }
  if (pre.src !== expected) return false;
  const old = audio;
  const wasMesh = Boolean(mesh && mesh.isActive());
  const target = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  audio = pre;
  state.preloadAudio = null;
  state.preloadKey = "";
  state.audioKey = `${state.seq}:${state.audioRev}:${state.sourceIndex}`;
  state.audioState = "buffering";
  audio.muted = old.muted;
  audio.volume = 0;
  try {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.min(target / 1000, Math.max(0, audio.duration - 0.25));
    }
  } catch (_) {
    /* ignore */
  }
  audio.play().then(() => {
    fadeToNewAudio(old, audio);
    if (wasMesh) {
      setTimeout(() => {
        if (mesh && mesh.isActive()) {
          mesh.stop();
          updateAudioMode();
        }
      }, 620);
    }
  }).catch((error) => {
    if (error && error.name === "NotAllowedError") {
      state.userWantsPlay = false;
      state.audioState = "idle";
      updatePlayButton();
      refreshStatus();
      return;
    }
    audio = old;
    state.audioKey = `${state.seq}:${state.audioRev}:${state.sourceIndex}`;
    loadDirectSource(target);
  });
  updateAudioMode();
  updatePlayButton();
  refreshStatus();
  return true;
}

function crossfadeToUrl(url, positionMs = 0) {
  if (!url) return false;
  if (IS_IOS_SAFARI) {
    const wasMesh = Boolean(mesh && mesh.isActive());
    return fallbackToSingleElement(audio, url, wasMesh, 0);
  }
  const old = audio;
  const expected = (() => {
    try {
      return new URL(url, location.href).href;
    } catch (_) {
      return "";
    }
  })();
  if (!expected) return false;
  let next = null;
  if (state.preloadAudio && state.preloadAudio.src === expected) {
    next = state.preloadAudio;
    state.preloadAudio = null;
    state.preloadKey = "";
  } else {
    stopPreload();
    next = old === audioA ? audioB : audioA;
    if (!next) return false;
    next.src = url;
    wireAudioElement(next);
    next.load();
  }
  const wasMesh = Boolean(mesh && mesh.isActive());
  state.audioKey = `${state.seq}:${state.audioRev}:${state.sourceIndex}`;
  state.audioState = "buffering";
  next.__crossfadeStarted = false;
  next.muted = old.muted;
  next.volume = 0;
  audio = next;
  const begin = () => {
    if (audio !== next || next.__crossfadeStarted) return;
    next.__crossfadeStarted = true;
    try {
      next.currentTime = Math.max(0, (Number(positionMs) || 0) / 1000);
    } catch (_) {
      /* ignore */
    }
    next.play().then(() => {
      if (audio !== next) return;
      fadeToNewAudio(old, next);
      if (wasMesh) {
        setTimeout(() => {
          if (mesh && mesh.isActive()) {
            mesh.stop();
            updateAudioMode();
          }
        }, 620);
      }
    }).catch(() => {
      if (!fallbackToSingleElement(old, url, wasMesh, 0)) {
        state.userWantsPlay = false;
        state.audioState = "idle";
        updatePlayButton();
        refreshStatus();
      }
    });
  };
  if (next.readyState >= 2) begin();
  else {
    next.addEventListener("canplay", begin, { once: true });
    next.addEventListener("error", () => {
      if (audio === next) {
        audio = old;
        state.audioKey = `${state.seq}:${state.audioRev}:${state.sourceIndex}`;
        loadDirectSource(0);
      }
    }, { once: true });
  }
  updateAudioMode();
  updatePlayButton();
  refreshStatus();
  return true;
}

function wireAudioElement(element) {
  if (!element || element.__radioWired) return;
  element.__radioWired = true;
  element.addEventListener("loadedmetadata", () => {
    if (element !== audio) return;
    if (state.pendingSeekMs > 0 && Number.isFinite(element.duration) && element.duration > 0) {
      try {
        element.currentTime = Math.min(state.pendingSeekMs / 1000, Math.max(0, element.duration - 0.35));
      } catch (_) {
        /* ignore */
      }
    }
    state.pendingSeekMs = 0;
    if (state.userWantsPlay && !state.serverPaused) attemptPlay();
  });
  element.addEventListener("playing", () => {
    if (element !== audio) return;
    clearStalledTimer();
    state.audioState = "live";
    refreshStatus();
    updatePlayButton();
  });
  element.addEventListener("waiting", () => {
    if (element !== audio || !state.userWantsPlay) return;
    state.audioState = "buffering";
    refreshStatus();
    startStalledTimer();
  });
  element.addEventListener("stalled", () => {
    if (element !== audio || !state.userWantsPlay) return;
    state.audioState = "buffering";
    refreshStatus();
    startStalledTimer();
  });
  element.addEventListener("pause", () => {
    if (element !== audio) return;
    updatePlayButton();
    updateMediaSession(state.now);
  });
  element.addEventListener("play", () => {
    if (element !== audio) return;
    updatePlayButton();
    updateMediaSession(state.now);
  });
  element.addEventListener("error", () => {
    if (element !== audio || !state.userWantsPlay || !element.src) return;
    tryNextSource("error");
  });
  element.addEventListener("ended", () => {
    if (element !== audio) return;
    clearStalledTimer();
    report("ended");
    pollSoon();
  });
}

function preloadNext(now = state.now) {
  const next = now && now.next;
  const url =
    next && next.audio
      ? next.audio.direct || (next.audio.alternates || [])[0] || ""
      : "";
  if (!state.userWantsPlay || !next || !url || now.paused) {
    stopPreload();
    return;
  }

  const key = `${next.id}:${url}`;
  const duration = Number(now.duration_ms) || 0;
  const position = now.paused
    ? Number(now.position_ms) || 0
    : Date.now() + state.clockOffset - Number(now.started_at_ms || 0);
  const remaining = duration - position;
  const preloadWindow = document.hidden ? 20_000 : 45_000;
  if (remaining > preloadWindow) {
    if (state.preloadKey && state.preloadKey !== key) stopPreload();
    return;
  }
  if (state.preloadKey === key) return;

  stopPreload();
  const element = audio === audioA ? audioB : audioA;
  if (!element) return;
  element.preload = "auto";
  element.src = url;
  wireAudioElement(element);
  element.load();
  state.preloadAudio = element;
  state.preloadKey = key;

  if (!document.hidden) {
    if (next.cover_url) {
      const image = new Image();
      image.src = next.cover_url;
      state.preloadCover = image;
    }
    if (next.lyrics_url) {
      fetch(next.lyrics_url, { cache: "force-cache" }).catch(() => {});
    }
  }
}

function tryNextSource(reason) {
  if (!state.userWantsPlay) return;
  if (mesh && mesh.isActive()) {
    mesh.fail(reason || "audio");
    return;
  }
  if (state.sourceIndex + 1 < state.sources.length) {
    state.sourceIndex += 1;
    state.audioState = "buffering";
    refreshStatus();
    loadSource(currentPosition());
    if (state.userWantsPlay) attemptPlay();
    return;
  }
  const key = `${state.seq}:${state.audioRev}`;
  if (state.lastReportKey !== key) {
    state.lastReportKey = key;
    report(reason === "stalled" ? "stalled" : "error");
  }
  state.audioState = "error";
  refreshStatus();
}

function startStalledTimer() {
  clearTimeout(state.stalledTimer);
  state.stalledTimer = setTimeout(() => {
    if (state.userWantsPlay && !audio.paused && !state.serverPaused) {
      tryNextSource("stalled");
    }
  }, 12_000);
}

function clearStalledTimer() {
  clearTimeout(state.stalledTimer);
  state.stalledTimer = null;
}

function applyNow(now) {
  const previousSeq = state.seq;
  const previousAudioKey = state.audioKey !== null ? `${state.seq}:${state.audioRev}` : null;
  const oldAudioElement = audio;
  const oldAudioWasActive = Boolean(
    oldAudioElement &&
    oldAudioElement.src &&
    !oldAudioElement.paused &&
    !oldAudioElement.ended
  );
  state.now = now;
  state.seq = now.seq;
  state.audioRev = now.audio_rev;
  state.serverPaused = Boolean(now.paused);
  updateListenerUI(now);
  if (mesh) mesh.update(now);

  if (!now.track) {
    if (mesh) mesh.stop();
    state.sources = [];
    state.sourceIndex = 0;
    state.audioKey = null;
    clearStalledTimer();
    if (audio.src) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    clearTrack();
    setLyricsOpen(false);
    updateVoteUI(now);
    // Never yank the reader out of chat just because the playlist is
    // momentarily empty; page changes remain user-driven.
    stopPreload();
    return;
  }

  const isNewTrack = now.seq !== previousSeq;
  const manualTrackSwitch = isNewTrack && oldAudioWasActive;
  const audioKey = `${now.seq}:${now.audio_rev}`;
  const isNewAudio = audioKey !== previousAudioKey;
  const direct = (now.audio && now.audio.direct) || "";
  const alternates = (now.audio && now.audio.alternates) || [];
  const sources = [direct, ...alternates].filter(Boolean);

  renderTrack(now);
  renderNext(now.next || null);
  if (isNewTrack) {
    playbackPage.classList.remove("track-switch");
    void playbackPage.offsetWidth;
    playbackPage.classList.add("track-switch");
  }

  if (isNewTrack) {
    setLyricsOpen(false);
    state.sources = sources;
    state.sourceIndex = 0;
    state.lyricsTrackId = now.track.id;
    state.lastReportKey = null;
    state.lastPositionSec = -1;
    clearStalledTimer();
    loadLyrics(now.lyrics_url, now.track.id);
    if (
      state.userWantsPlay &&
      sources.length &&
      (!(mesh && mesh.isActive()) || manualTrackSwitch) &&
      adoptPreloaded(sources[0], 0)
    ) {
      // The preloaded next track took over; no silence between tracks.
    } else if (
      state.userWantsPlay &&
      sources.length &&
      (!(mesh && mesh.isActive()) || manualTrackSwitch) &&
      crossfadeToUrl(sources[0], 0)
    ) {
      // A not-yet-ready direct source still overlaps the old audio.
    } else if (state.userWantsPlay && sources.length) {
      loadSource(currentPosition(now));
    } else {
      unloadAudio();
      state.audioState = sources.length ? "idle" : "error";
      updateAudioMode();
    }
  } else if (isNewAudio) {
    state.sources = sources;
    state.sourceIndex = 0;
    clearStalledTimer();
    if (
      state.userWantsPlay &&
      sources.length &&
      (!(mesh && mesh.isActive()) || manualTrackSwitch) &&
      adoptPreloaded(sources[0], currentPosition(now))
    ) {
      // Source refresh can also use the preloaded buffer.
    } else if (state.userWantsPlay && sources.length) {
      loadSource(currentPosition(now));
    } else {
      unloadAudio();
      state.audioState = sources.length ? "idle" : "error";
      updateAudioMode();
    }
  }

  if (state.serverPaused) {
    audio.pause();
    clearStalledTimer();
  } else if (state.userWantsPlay && !audio.src) {
    ensureSourceLoaded(now);
  } else if (state.userWantsPlay && audio.paused) {
    seekToLive();
    attemptPlay();
  }

  setLivePill();
  updatePlayButton();
  updateVoteUI(now);
  preloadNext(now);
  updateMediaSession(now);
  updateMediaSessionPosition(now);
  refreshStatus();
}

function applyReportSnapshot(data) {
  if (!data || typeof data !== "object" || !data.track) return;
  if (data.seq !== state.seq || data.audio_rev !== state.audioRev) {
    applyNow(data);
  }
}

async function report(event) {
  if (state.seq === null) return;
  try {
    const data = await fetchJSON("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seq: state.seq, event }),
      timeout: 10_000,
    });
    applyReportSnapshot(data);
  } catch (_) {
    /* reports are best-effort */
  }
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  const delay = document.hidden
    ? (state.userWantsPlay ? 3_000 : 15_000)
    : state.connection === "offline"
    ? 8_000
    : 1_500;
  state.pollTimer = setTimeout(pollNow, delay);
}

async function pollNow() {
  clearTimeout(state.pollTimer);
  const started = performance.now();
  try {
    const nicknameQuery = state.nickname
      ? `?nickname=${encodeURIComponent(state.nickname)}`
      : "";
    const data = await fetchJSON(`/now.json${nicknameQuery}`, { timeout: 8_000 });
    const finished = performance.now();
    const sample = data.server_time_ms + (finished - started) / 2 - Date.now();
    state.clockOffset = state.clockOffset ? state.clockOffset * 0.82 + sample * 0.18 : sample;
    state.connection = "online";
    applyNow(data);
  } catch (_) {
    state.connection = "offline";
    refreshStatus();
  } finally {
    schedulePoll();
  }
}

function pollSoon() {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(pollNow, 600);
}

/* ---------- lyrics ---------- */

function setLyricsEmpty(text) {
  lyricsEl.textContent = "";
  const empty = document.createElement("p");
  empty.className = "lyrics-empty";
  empty.textContent = text;
  lyricsEl.appendChild(empty);
  state.lyricsLines = [];
  state.lyricEls = [];
  state.lastLyricIndex = -1;
  state.currentLyricIndex = -1;
  currentLyricText.textContent = text;
  currentLyricTrans.textContent = "";
  currentLyricTrans.classList.add("hidden");
}

function parseLrc(text) {
  const lines = [];
  const pattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const times = [];
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(raw))) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      times.push((minutes * 60 + seconds + fraction) * 1000);
    }
    const content = raw.replace(pattern, "").trim();
    if (!content || !times.length) continue;
    for (const time of times) lines.push({ time, text: content });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

function nearestTranslation(translations, time) {
  let best = null;
  let bestDiff = 450;
  for (const line of translations) {
    const diff = Math.abs(line.time - time);
    if (diff < bestDiff) {
      best = line;
      bestDiff = diff;
    }
  }
  return best ? best.text : "";
}

function emptyLyricsMessage() {
  const track = state.now && state.now.track;
  return track && track.source === "upload" ? "纯音乐，请欣赏" : "暂无歌词";
}

function renderLyrics(lrc, translation) {
  const lines = parseLrc(lrc);
  const translations = parseLrc(translation);
  if (!lines.length) {
    setLyricsEmpty(emptyLyricsMessage());
    return;
  }
  state.lyricsLines = lines;
  state.lyricEls = [];
  state.lastLyricIndex = -1;
  state.currentLyricIndex = -1;
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "lyric-line";
    const text = document.createElement("span");
    text.className = "lyric-text";
    text.textContent = line.text;
    row.appendChild(text);
    const trans = nearestTranslation(translations, line.time);
    if (trans) {
      const sub = document.createElement("span");
      sub.className = "lyric-translation";
      sub.textContent = trans;
      row.appendChild(sub);
    }
    fragment.appendChild(row);
    state.lyricEls.push(row);
  }
  lyricsEl.textContent = "";
  lyricsEl.appendChild(fragment);
  lyricsEl.classList.toggle("hide-translation", !state.showTranslation);
  currentLyricText.textContent = "";
  currentLyricTrans.textContent = "";
  currentLyricTrans.classList.add("hidden");
}

async function loadLyrics(url, trackId) {
  if (!url) {
    setLyricsEmpty(emptyLyricsMessage());
    return;
  }
  setLyricsEmpty("歌词加载中…");
  try {
    const data = await fetchJSON(url, { timeout: 10_000 });
    if (state.lyricsTrackId !== trackId) return;
    renderLyrics(data.lrc, data.translation);
  } catch (_) {
    if (state.lyricsTrackId === trackId) setLyricsEmpty("歌词暂不可用");
  }
}

function updateLyrics(positionMs) {
  if (!state.lyricEls.length) return;
  let index = -1;
  for (let i = 0; i < state.lyricsLines.length; i += 1) {
    if (state.lyricsLines[i].time <= positionMs + 60) index = i;
    else break;
  }
  if (index === state.lastLyricIndex) return;
  for (const row of state.lyricEls) row.classList.remove("active");
  state.lastLyricIndex = index;
  const active = state.lyricEls[index];
  if (active) {
    active.classList.add("active");
    if (Date.now() - state.lyricsManualAt >= 4500) {
      const top = active.offsetTop - lyricsScroll.clientHeight * 0.42 + active.clientHeight / 2;
      scrollLyricsTo(top, "smooth");
    }
  }
  syncCurrentLyric(index, true);
}

function syncCurrentLyric(index, animate = false) {
  if (index === undefined) index = state.lastLyricIndex;
  const line = index >= 0 ? state.lyricsLines[index] : null;
  const row = index >= 0 ? state.lyricEls[index] : null;
  const translation = row ? row.querySelector(".lyric-translation") : null;
  currentLyricText.textContent = line ? line.text : "♪";
  currentLyricTrans.textContent =
    translation && state.showTranslation ? translation.textContent : "";
  currentLyricTrans.classList.toggle("hidden", !currentLyricTrans.textContent);
  setupMarquee(currentLyricText);
  setupMarquee(currentLyricTrans);
  if (animate || index !== state.currentLyricIndex) {
    state.currentLyricIndex = index;
    currentLyric.classList.remove("lyric-swap");
    void currentLyric.offsetWidth;
    currentLyric.classList.add("lyric-swap");
  }
}

function refreshCurrentLyric(instant = false) {
  syncCurrentLyric(state.lastLyricIndex, true);
  const active = state.lyricEls[state.lastLyricIndex];
  if (active) {
    const top = active.offsetTop - lyricsScroll.clientHeight * 0.42 + active.clientHeight / 2;
    scrollLyricsTo(top, instant ? "auto" : "smooth");
  }
}

function scrollLyricsTo(top, behavior) {
  state.lyricProgrammaticUntil = Date.now() + (behavior === "smooth" ? 1200 : 150);
  lyricsScroll.scrollTo({ top: Math.max(0, top), behavior });
}

function markLyricsManualScroll() {
  if (!state.lyricsOpen) return;
  state.lyricsManualAt = Date.now();
  clearTimeout(state.lyricsManualTimer);
  state.lyricsManualTimer = setTimeout(() => {
    if (!state.lyricsOpen) return;
    state.lyricsManualAt = 0;
    refreshCurrentLyric();
  }, 3000);
}

/* ---------- playlist / messages ---------- */

function checkButton(label = "已在队列") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-action checked";
  button.disabled = true;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.appendChild(makeIcon(["m5 12.5 4.2 4.2L19 7"], true));
  return button;
}

function makeIcon(paths, stroke = false) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", stroke ? "icon stroke-icon" : "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const data of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.appendChild(path);
  }
  return svg;
}

function rowAction(label, paths, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `row-action ${className}`.trim();
  button.setAttribute("aria-label", label);
  button.title = label;
  button.appendChild(makeIcon(paths, true));
  return button;
}

function updateLibraryBadge(count) {
  const value = Number(count) || 0;
  playlistCount.textContent = String(value);
  playlistCount.classList.toggle("hidden", value <= 0);
  libraryBadge.textContent = String(value);
  libraryBadge.classList.toggle("hidden", value <= 0);
}

function renderPlaylist(items) {
  playlistList.textContent = "";
  // The pending view is requests only.  Rotating playlist tracks are not
  // history and must not appear here; history has its own tab.
  const visible = items.filter((item) => item.status === "pending");
  updateLibraryBadge(visible.length);
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "队列里还没有歌";
    playlistList.appendChild(empty);
    return;
  }

  for (const [index, item] of visible.slice(0, 80).entries()) {
    const row = document.createElement("div");
    row.className = "playlist-item";

    const idx = document.createElement("span");
    idx.className = "playlist-index";
    idx.textContent = String(index + 1).padStart(2, "0");
    row.appendChild(idx);

    const image = document.createElement("img");
    image.className = "playlist-cover";
    image.src = item.cover_url || "/placeholder.svg";
    image.alt = "";
    image.onerror = () => {
      if (!image.src.endsWith("/placeholder.svg")) image.src = "/placeholder.svg";
    };
    row.appendChild(image);

    const copy = document.createElement("div");
    copy.className = "playlist-copy";
    const name = document.createElement("span");
    name.className = "playlist-title";
    name.textContent = item.title || "未知曲目";
    const sub = document.createElement("span");
    sub.className = "playlist-sub";
    const parts = [item.artist || "未知歌手"];
    if (item.nickname && item.status === "pending") parts.push(item.nickname);
    sub.textContent = parts.join(" · ");
    copy.appendChild(name);
    copy.appendChild(sub);
    row.appendChild(copy);

    const side = document.createElement("div");
    side.className = "playlist-side";

    const duration = document.createElement("span");
    duration.className = "playlist-duration";
    duration.textContent = fmtTime(item.duration_ms, item.duration_estimated);
    side.appendChild(duration);

    if (item.status === "pending" && item.queue_id) {
      const pins = Number(item.priority) || 0;
      const pinnedByMe = Boolean(item.pinned_by_me);
      const pin = rowAction(pinnedByMe ? "取消置顶" : "置顶", [
        "M12 19V5",
        "M6 11l6-6 6 6",
        "M5 21h14",
      ], pinnedByMe ? "active" : "");
      if (pins > 0) {
        const badge = document.createElement("span");
        badge.className = "action-badge";
        badge.textContent = String(pins);
        pin.appendChild(badge);
      }
      pin.addEventListener("click", async () => {
        pin.disabled = true;
        try {
          await fetchJSON("/api/queue/pin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queue_id: item.queue_id }),
            timeout: 10_000,
          });
          await loadSidebar();
          pollSoon();
        } catch (error) {
          pin.disabled = false;
          setSearchStatus(errorText(error, "置顶失败"), "error");
        }
      });
      if (item.can_cancel) {
        const cancel = rowAction("取消点歌", ["m6 6 12 12M18 6 6 18"], "danger");
        cancel.addEventListener("click", async () => {
          cancel.disabled = true;
          try {
            await fetchJSON("/api/queue/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ queue_id: item.queue_id }),
              timeout: 10_000,
            });
            await loadSidebar();
            pollSoon();
          } catch (error) {
            cancel.disabled = false;
            setSearchStatus(errorText(error, "取消失败"), "error");
          }
        });
        side.appendChild(cancel);
      }
      side.appendChild(pin);
    } else if (item.status === "upcoming") {
      const add = rowAction("点歌", ["M12 5v14M5 12h14"], "add");
      add.addEventListener("click", () => requestTrack(item.id, item));
      side.appendChild(add);
    }

    row.appendChild(side);
    playlistList.appendChild(row);
  }
}

function setPage(page) {
  const next = page === "chat" ? "chat" : "playback";
  state.page = next;
  const inChat = next === "chat";
  pages.classList.toggle("chat", inChat);
  const chatIcon = chatBtn.querySelector(".icon-chat");
  const upIcon = chatBtn.querySelector(".icon-up");
  if (chatIcon) chatIcon.classList.toggle("hidden", inChat);
  if (upIcon) upIcon.classList.toggle("hidden", !inChat);
  const label = inChat ? "返回播放" : "进入聊天";
  chatBtn.setAttribute("aria-label", label);
  chatBtn.title = label;
  if (inChat) {
    requestAnimationFrame(() => {
      messageList.scrollTop = messageList.scrollHeight;
    });
  }
}

function setLyricsOpen(open) {
  state.lyricsOpen = Boolean(open);
  playbackPage.classList.toggle("lyrics-open", state.lyricsOpen);
  coverButton.setAttribute(
    "aria-label",
    state.lyricsOpen ? "收起完整歌词" : "展开歌词",
  );
  if (state.lyricsOpen) {
    state.lyricsManualAt = 0;
    clearTimeout(state.lyricsManualTimer);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => refreshCurrentLyric(true));
    });
  } else {
    clearTimeout(state.lyricsManualTimer);
    state.lyricsManualAt = 0;
  }
}

function onPageWheel(event) {
  if (
    !drawer.classList.contains("hidden") ||
    !nicknameModal.classList.contains("hidden") ||
    !listenersModal.classList.contains("hidden")
  ) {
    return;
  }
  if (state.page === "playback") {
    if (event.deltaY <= 0) return;
    if (event.target.closest("#lyricsScroll")) return;
    event.preventDefault();
    setPage("chat");
  } else {
    if (event.deltaY >= 0) return;
    if (event.target.closest("#messageList") && messageList.scrollTop > 0) return;
    event.preventDefault();
    setPage("playback");
  }
}

let touchStartY = null;
let touchAllowed = false;
function onTouchStart(event) {
  if (
    !drawer.classList.contains("hidden") ||
    !nicknameModal.classList.contains("hidden") ||
    !listenersModal.classList.contains("hidden")
  ) {
    return;
  }
  const target = event.target;
  touchAllowed = true;
  if (state.page === "playback" && target.closest("#lyricsScroll")) touchAllowed = false;
  if (
    state.page === "chat" &&
    target.closest("#messageList") &&
    messageList.scrollTop > 0
  ) {
    touchAllowed = false;
  }
  touchStartY = event.touches[0].clientY;
}
function onTouchMove(event) {
  if (touchStartY === null || !touchAllowed) return;
  const dy = event.touches[0].clientY - touchStartY;
  if (Math.abs(dy) < 10) return;
  if (state.page === "chat" && dy < 0) return;
  if (state.page === "playback" && dy > 0) return;
  const base = state.page === "chat" ? -100 : 0;
  const height = stage.clientHeight || window.innerHeight;
  const percent = clamp(base + (dy / height) * 100, -100, 0);
  event.preventDefault();
  pages.style.transition = "none";
  pages.style.transform = `translateY(${percent}%)`;
}
function onTouchEnd(event) {
  if (touchStartY === null || !touchAllowed) {
    touchStartY = null;
    return;
  }
  const dy = event.changedTouches[0].clientY - touchStartY;
  touchStartY = null;
  const height = stage.clientHeight || window.innerHeight;
  let next = state.page;
  if (Math.abs(dy) > Math.max(48, height * 0.08)) {
    if (state.page === "playback" && dy < 0) next = "chat";
    else if (state.page === "chat" && dy > 0) next = "playback";
  }
  pages.style.transition = "";
  pages.style.transform = "";
  setPage(next);
}

function updateViewButtons() {
  for (const [button, mode] of [
    [viewQueueBtn, "queue"],
    [viewHistoryBtn, "history"],
  ]) {
    const active = !state.searchActive && state.viewMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

function showCurrentList() {
  if (state.searchActive) {
    searchResultsPanel.classList.remove("hidden");
    queuePanel.classList.add("hidden");
    historyPanel.classList.add("hidden");
    queueHistorySwitch.classList.add("hidden");
    return;
  }
  searchResultsPanel.classList.add("hidden");
  queueHistorySwitch.classList.remove("hidden");
  queuePanel.classList.toggle("hidden", state.viewMode !== "queue");
  historyPanel.classList.toggle("hidden", state.viewMode !== "history");
}

function setSearchMode(active) {
  state.searchActive = Boolean(active);
  updateViewButtons();
  showCurrentList();
}

function cancelSearch(clear = true) {
  if (clear) {
    searchInput.value = "";
    state.searchResults = [];
    searchResults.textContent = "";
  }
  setSearchStatus("");
  setSearchMode(false);
  setView(state.viewMode);
}

function setView(mode) {
  state.viewMode = mode === "history" ? "history" : "queue";
  if (state.searchActive) cancelSearch(false);
  updateViewButtons();
  showCurrentList();
}

let drawerTimer = null;
function openDrawer(mode = "queue") {
  clearTimeout(drawerTimer);
  cancelSearch();
  setView("queue");
  drawer.classList.remove("hidden");
  drawerBackdrop.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
  requestAnimationFrame(() => {
    drawer.classList.add("is-open");
    drawerBackdrop.classList.add("is-open");
  });
  loadSidebar();
}

function closeDrawer() {
  drawer.classList.remove("is-open");
  drawerBackdrop.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
  setSearchStatus("");
  clearTimeout(drawerTimer);
  drawerTimer = setTimeout(() => {
    if (drawer.classList.contains("is-open")) return;
    drawer.classList.add("hidden");
    drawerBackdrop.classList.add("hidden");
    // Reopening always starts at the initial queue/search state.
    cancelSearch();
    setView("queue");
    searchInput.blur();
    playlistList.scrollTop = 0;
    historyList.scrollTop = 0;
  }, 380);
}

function renderHistory(items) {
  state.historyItems = items;
  historyList.textContent = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "还没有点歌记录";
    historyList.appendChild(empty);
    return;
  }

  for (const [index, item] of items.slice(0, 40).entries()) {
    const row = document.createElement("div");
    row.className = "playlist-item history-item";
    row.dataset.historyId = String(item.id);

    const idx = document.createElement("span");
    idx.className = "playlist-index";
    idx.textContent = String(index + 1).padStart(2, "0");
    row.appendChild(idx);

    const image = document.createElement("img");
    image.className = "playlist-cover";
    image.src = item.cover_url || "/placeholder.svg";
    image.alt = "";
    image.onerror = () => {
      if (!image.src.endsWith("/placeholder.svg")) image.src = "/placeholder.svg";
    };
    row.appendChild(image);

    const copy = document.createElement("div");
    copy.className = "playlist-copy";
    const name = document.createElement("span");
    name.className = "playlist-title";
    name.textContent = item.title || "未知曲目";
    const sub = document.createElement("span");
    sub.className = "playlist-sub";
    sub.textContent = [item.artist || "未知歌手", fmtRelative(item.created_at)]
      .filter(Boolean)
      .join(" · ");
    copy.appendChild(name);
    copy.appendChild(sub);
    row.appendChild(copy);

    const side = document.createElement("div");
    side.className = "playlist-side";
    const duration = document.createElement("span");
    duration.className = "playlist-duration";
    duration.textContent = fmtTime(item.duration_ms, item.duration_estimated);
    side.appendChild(duration);
    const add = rowAction("再次点歌", ["M12 5v14M5 12h14"], "add");
    add.addEventListener("click", () => requestTrack(item.track_id || item.id, item));
    side.appendChild(add);
    row.appendChild(side);
    historyList.appendChild(row);
  }
}

function renderMessages(items) {
  const wasNearBottom =
    messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 48;
  const previousScrollTop = messageList.scrollTop;
  const previousHeight = messageList.scrollHeight;
  const previousCount = state.lastMessageCount;
  const ordered = items.slice().reverse();
  state.lastMessageCount = ordered.length;

  messageList.textContent = "";
  if (!ordered.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "还没有留言";
    messageList.appendChild(empty);
    return;
  }

  for (const item of ordered) {
    const row = document.createElement("div");
    row.className = "message-item";

    const name = document.createElement("span");
    name.className = "message-name";
    name.textContent = item.nickname || "匿名";

    const body = document.createElement("span");
    body.className = "message-body";
    body.textContent = item.body || "";

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = fmtRelative(item.created_at);

    row.appendChild(name);
    row.appendChild(body);
    row.appendChild(time);
    messageList.appendChild(row);
  }

  const shouldStickToBottom = wasNearBottom || previousCount < 0 || ordered.length !== previousCount;
  requestAnimationFrame(() => {
    if (shouldStickToBottom) {
      messageList.scrollTop = messageList.scrollHeight;
    } else {
      messageList.scrollTop = previousScrollTop + (messageList.scrollHeight - previousHeight);
    }
  });
}

async function loadSidebar() {
  if (state.sidebarLoading) return;
  state.sidebarLoading = true;
  try {
    const data = await fetchJSON("/api/state", { timeout: 8_000 });
    const active = new Set();
    const current = data.now && data.now.track;
    if (current && current.id) active.add(String(current.id));
    for (const item of data.queue || []) {
      if (item && item.track_id) active.add(String(item.track_id));
    }
    state.activeTrackIds = [...active];
    renderPlaylist(data.upcoming || []);
    renderHistory(data.history || []);
    renderMessages(data.messages || []);
  } catch (_) {
    /* sidebar is best-effort */
  } finally {
    state.sidebarLoading = false;
  }
}

/* ---------- search / song request ---------- */

let toastTimer = null;
function showToast(text, duration = 2000) {
  if (!text) return;
  toast.textContent = text;
  toast.classList.remove("hidden");
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 220);
  }, duration);
}

function setSearchStatus(text, tone = "") {
  searchStatus.textContent = text;
  if (tone) searchStatus.dataset.tone = tone;
  else delete searchStatus.dataset.tone;
}

function renderPublicSearchResults(results) {
  state.searchResults = results;
  searchResults.textContent = "";
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有找到匹配的歌曲";
    searchResults.appendChild(empty);
    return;
  }
  for (const item of results) {
    const row = document.createElement("div");
    row.className = "search-result";
    row.dataset.candidateId = item.candidate_id;

    const image = document.createElement("img");
    image.className = "search-cover";
    image.src = item.cover_url || "/placeholder.svg";
    image.alt = "";
    image.onerror = () => {
      if (!image.src.endsWith("/placeholder.svg")) image.src = "/placeholder.svg";
    };
    row.appendChild(image);

    const copy = document.createElement("span");
    copy.className = "search-copy";
    const name = document.createElement("span");
    name.className = "search-title";
    name.textContent = item.title || "未知曲目";
    const sub = document.createElement("span");
    sub.className = "search-sub";
    sub.textContent = [item.artist || "未知歌手", item.album || ""].filter(Boolean).join(" · ");
    copy.appendChild(name);
    copy.appendChild(sub);
    row.appendChild(copy);

    const side = document.createElement("span");
    side.className = "search-side";
    const source = document.createElement("span");
    source.className = "search-source";
    source.textContent = item.source_label || sourceLabel(item.source);
    const duration = document.createElement("span");
    duration.className = "search-duration";
    duration.textContent = fmtTime(item.duration_ms, item.duration_estimated);
    const queued = Boolean(item.queued) || (
      item.track_id && state.activeTrackIds.includes(String(item.track_id))
    );
    side.appendChild(source);
    side.appendChild(duration);
    if (queued) {
      side.appendChild(checkButton());
    } else {
      const add = rowAction("点歌", ["M12 5v14M5 12h14"], "add");
      add.addEventListener("click", () => requestCandidate(item, add));
      side.appendChild(add);
    }
    row.appendChild(side);
    searchResults.appendChild(row);
  }
}

async function performSearch(event) {
  event.preventDefault();
  if (state.searchBusy) return;
  const query = searchInput.value.trim();
  if (!query) {
    setSearchStatus("请输入歌名或歌手", "error");
    searchInput.focus();
    return;
  }
  setSearchMode(true);
  state.searchResults = [];
  searchResults.textContent = "";
  state.searchBusy = true;
  searchBtn.disabled = true;
  setSearchStatus("正在搜索…", "busy");
  try {
    const isUrl = /^https?:\/\//i.test(query);
    const isBiliId = /^(?:BV[0-9A-Za-z]{10}|av\d+)$/i.test(query);
    const data = await fetchJSON(`/api/search?q=${encodeURIComponent(query)}`, {
      timeout: isUrl || isBiliId ? 65_000 : 25_000,
    });
    renderPublicSearchResults(data.results || []);
    setSearchStatus(`找到 ${(data.results || []).length} 首`, "ok");
  } catch (error) {
    searchResults.textContent = "";
    state.searchResults = [];
    const retry = error.data && error.data.retry_after ? `，${error.data.retry_after} 秒后可再试` : "";
    setSearchStatus(`${errorText(error, "搜索失败")}${retry}`, "error");
  } finally {
    state.searchBusy = false;
    searchBtn.disabled = false;
  }
}

function requestCandidate(item, button) {
  submitRequest(
    { candidate_id: item.candidate_id, nickname: state.nickname, ts: state.requestTs },
    item,
    button,
  );
}

function requestTrack(trackId, item, button) {
  if (!trackId) return;
  submitRequest(
    { track_id: trackId, nickname: state.nickname, ts: state.requestTs },
    item,
    button,
  );
}

async function submitRequest(payload, item, button) {
  if (state.requestBusy) return;
  if (!state.nickname) {
    state.pendingRequest = { payload, item };
    openNicknameModal();
    setSearchStatus("先设置昵称，再点一次 +", "error");
    return;
  }
  state.requestBusy = true;
  if (button) button.disabled = true;
  setSearchStatus("正在加入队列…", "busy");
  try {
    const data = await fetchJSON("/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, nickname: state.nickname, ts: state.requestTs }),
      timeout: 25_000,
    });
    state.requestTs = Date.now();
    setSearchStatus("");
    showToast("点歌成功");
    if (button && button.isConnected) button.replaceWith(checkButton());
    if (data.track && data.track.id) {
      state.activeTrackIds = [...new Set([...state.activeTrackIds, String(data.track.id)])];
    }
    loadSidebar();
    pollSoon();
  } catch (error) {
    const retry = error.data && error.data.retry_after ? `，${error.data.retry_after} 秒后可再试` : "";
    setSearchStatus(`${errorText(error, "点歌失败")}${retry}`, "error");
    if (error.status === 410) {
      renderPublicSearchResults([]);
    }
    if (button) button.disabled = false;
  } finally {
    state.requestBusy = false;
    if (button) button.disabled = false;
  }
}

/* ---------- local audio upload ---------- */

const UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
const UPLOAD_EXTENSIONS = new Set([
  "mp3",
  "aac",
  "m4a",
  "mp4",
  "ogg",
  "oga",
  "opus",
  "webm",
  "wav",
  "flac",
]);

function uploadExtension(name) {
  const parts = String(name || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function readAudioDuration(file) {
  return new Promise((resolve) => {
    const probe = new Audio();
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (duration) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        /* ignore */
      }
      probe.removeAttribute("src");
      resolve(Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0);
    };
    const timer = setTimeout(() => finish(0), 7000);
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => finish(probe.duration), { once: true });
    probe.addEventListener("error", () => finish(0), { once: true });
    probe.src = url;
    try {
      probe.load();
    } catch (_) {
      finish(0);
    }
  });
}

async function uploadLocalAudio(file) {
  if (state.uploadBusy || !file) return;
  if (!state.nickname) {
    state.pendingUpload = file;
    openNicknameModal();
    return;
  }
  if (file.size <= 0) {
    setSearchStatus("文件为空", "error");
    return;
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    setSearchStatus("文件超过 64MB", "error");
    return;
  }
  const extension = uploadExtension(file.name);
  if (!UPLOAD_EXTENSIONS.has(extension)) {
    setSearchStatus("不支持该音频扩展名", "error");
    return;
  }
  state.uploadBusy = true;
  uploadBtn.disabled = true;
  setSearchStatus("正在读取音频信息…", "busy");
  try {
    const durationMs = await readAudioDuration(file);
    const title = file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "本地音频";
    setSearchStatus("正在上传并加入队列…", "busy");
    const data = await fetchJSON("/api/upload", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
        "X-Title": encodeURIComponent(title),
        "X-Nickname": encodeURIComponent(state.nickname),
        "X-Duration-Ms": String(durationMs || 0),
      },
      body: file,
      timeout: 120_000,
    });
    setView("queue");
    setSearchStatus("");
    showToast("上传成功");
    loadSidebar();
    pollSoon();
  } catch (error) {
    const retry = error.data && error.data.retry_after ? `，${error.data.retry_after} 秒后可再试` : "";
    setSearchStatus(`${errorText(error, "上传失败")}${retry}`, "error");
  } finally {
    state.uploadBusy = false;
    uploadBtn.disabled = false;
    uploadInput.value = "";
  }
}

/* ---------- messages ---------- */

function setMessageStatus(text, tone = "") {
  messageStatus.textContent = text;
  if (tone) messageStatus.dataset.tone = tone;
  else delete messageStatus.dataset.tone;
}

async function submitMessage(event) {
  event.preventDefault();
  if (state.messageBusy) return;
  if (!state.nickname) {
    openNicknameModal();
    return;
  }
  const body = messageInput.value.trim();
  if (!body) {
    setMessageStatus("请输入留言内容", "error");
    messageInput.focus();
    return;
  }
  state.messageBusy = true;
  messageBtn.disabled = true;
  setMessageStatus("正在发送…", "busy");
  try {
    await fetchJSON("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: state.nickname,
        body,
        ts: state.messageTs,
      }),
      timeout: 15_000,
    });
    messageInput.value = "";
    state.messageTs = Date.now();
    setMessageStatus("留言已发送", "ok");
    loadSidebar();
  } catch (error) {
    const retry = error.data && error.data.retry_after ? `，${error.data.retry_after} 秒后可再试` : "";
    setMessageStatus(`${errorText(error, "发送失败")}${retry}`, "error");
  } finally {
    state.messageBusy = false;
    messageBtn.disabled = false;
  }
}

/* ---------- modals ---------- */

function updateModalState() {
  const open = [...document.querySelectorAll(".modal")].some(
    (element) => !element.classList.contains("hidden")
  );
  document.body.classList.toggle("modal-open", open);
}

function showModal(element) {
  element.classList.remove("hidden");
  updateModalState();
}

function hideModal(element) {
  element.classList.add("hidden");
  updateModalState();
}

/* ---------- media session / render loop ---------- */

function absoluteUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch (_) {
    return "";
  }
}

function updateMediaSession(now = state.now) {
  if (!("mediaSession" in navigator)) return;
  const track = now && now.track;
  try {
    if (!track) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }
    if (typeof MediaMetadata === "function") {
      const cover = absoluteUrl(track.cover_url || "");
      const artwork = /^https?:/i.test(cover)
        ? [{ src: cover, sizes: "300x300" }]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || "",
        artist: track.artist || "",
        album: track.album || "",
        artwork,
      });
    }
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  } catch (_) {
    /* media session is best-effort */
  }
}

function updateMediaSessionPosition(now = state.now) {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!now || !now.track) return;
  const timestamp = Date.now();
  if (timestamp - state.lastMediaPositionAt < 5_000) return;
  const duration = Number(now.duration_ms) || 0;
  const useLocal = Boolean(audio.src) && audio.readyState > 0;
  const position = useLocal ? audio.currentTime * 1000 : currentPosition(now);
  if (duration <= 0 || !Number.isFinite(position)) return;
  state.lastMediaPositionAt = timestamp;
  try {
    navigator.mediaSession.setPositionState({
      duration: duration / 1000,
      playbackRate: 1,
      position: clamp(position / 1000, 0, duration / 1000),
    });
  } catch (_) {
    /* ignore unsupported position state */
  }
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const register = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (_) {
      /* unsupported action */
    }
  };
  register("play", () => {
    if (!state.now || !state.now.track || state.serverPaused) return;
    state.userWantsPlay = true;
    if (!ensureSourceLoaded()) {
      seekToLive();
      attemptPlay();
    }
    updatePlayButton();
  });
  register("pause", () => {
    state.userWantsPlay = false;
    audio.pause();
    stopPreload();
    updatePlayButton();
  });
  register("seekto", (details) => {
    if (typeof details.seekTime !== "number") return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      audio.currentTime = clamp(details.seekTime, 0, audio.duration - 0.1);
    } catch (_) {
      /* ignore */
    }
  });
}

function startFrame() {
  if (state.frameId !== null || document.hidden) return;
  state.frameId = requestAnimationFrame(frame);
}

function frame() {
  state.frameId = null;
  if (document.hidden) return;
  const now = state.now;
  if (now && now.track) {
    const meshPosition = mesh && mesh.isActive() ? mesh.positionMs() : null;
    const useLocal = Boolean(audio.src) && audio.readyState > 0;
    const position =
      meshPosition !== null
        ? Math.max(0, meshPosition)
        : useLocal
        ? Math.max(0, audio.currentTime * 1000)
        : currentPosition(now);
    const duration = Number(now.duration_ms) || 0;
    const percent = duration > 0 ? clamp((position / duration) * 100, 0, 100) : 0;
    progressFill.style.width = `${percent.toFixed(2)}%`;
    progressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
    const seconds = Math.floor(position / 1000);
    if (seconds !== state.lastPositionSec) {
      state.lastPositionSec = seconds;
      positionEl.textContent = fmtTime(position);
    }
    updateLyrics(position);
    updateMediaSessionPosition(now);
  }
  state.frameId = requestAnimationFrame(frame);
}

/* ---------- events ---------- */

playBtn.addEventListener("click", () => {
  if (!state.now || !state.now.track || state.serverPaused) return;
  if (!audio.paused) {
    state.userWantsPlay = false;
    if (mesh) mesh.setWanted(false);
    audio.pause();
    stopPreload();
    updatePlayButton();
    return;
  }
  if (!state.sources.length) {
    state.audioState = "error";
    refreshStatus();
    return;
  }
  state.userWantsPlay = true;
  if (mesh) mesh.setWanted(true);
  if (ensureSourceLoaded()) {
    preloadNext();
    updatePlayButton();
    return;
  }
  seekToLive();
  attemptPlay();
  preloadNext();
  updatePlayButton();
});

voteSkipBtn.addEventListener("click", voteSkip);

muteBtn.addEventListener("click", () => {
  audio.muted = !audio.muted;
  muteBtn.setAttribute("aria-label", audio.muted ? "取消静音" : "静音");
  muteBtn.style.color = audio.muted ? "var(--faint)" : "";
});

volumeEl.addEventListener("input", () => {
  audio.volume = clamp(Number(volumeEl.value), 0, 1);
  storageSet("radio.volume", volumeEl.value);
});

for (const eventName of ["wheel", "touchstart", "pointerdown"]) {
  lyricsScroll.addEventListener(eventName, markLyricsManualScroll, { passive: true });
}
lyricsScroll.addEventListener("scroll", () => {
  if (Date.now() < state.lyricProgrammaticUntil) return;
  markLyricsManualScroll();
}, { passive: true });

translationToggle.addEventListener("click", () => {
  state.showTranslation = !state.showTranslation;
  translationToggle.setAttribute("aria-pressed", String(state.showTranslation));
  lyricsEl.classList.toggle("hide-translation", !state.showTranslation);
  currentLyricTrans.classList.toggle(
    "hidden",
    !state.showTranslation || !currentLyricTrans.textContent,
  );
  refreshCurrentLyric();
  setupMarquee(currentLyricTrans, true);
});

chatBtn.addEventListener("click", () =>
  setPage(state.page === "chat" ? "playback" : "chat")
);
coverButton.addEventListener("click", () => {
  if (window.matchMedia("(orientation: portrait)").matches) {
    setLyricsOpen(!state.lyricsOpen);
  }
});
currentLyric.addEventListener("click", () => {
  if (window.matchMedia("(orientation: portrait)").matches) {
    setLyricsOpen(true);
  }
});
trackMeta.addEventListener("click", () => {
  if (state.lyricsOpen) setLyricsOpen(false);
});
lyricsPanel.addEventListener("click", (event) => {
  if (state.lyricsOpen && !event.target.closest("button")) {
    setLyricsOpen(false);
  }
});
stage.addEventListener("wheel", onPageWheel, { passive: false });
stage.addEventListener("touchstart", onTouchStart, { passive: true });
stage.addEventListener("touchmove", onTouchMove, { passive: false });
stage.addEventListener("touchend", onTouchEnd, { passive: true });
window.addEventListener("resize", () => {
  if (window.matchMedia("(orientation: landscape)").matches && state.lyricsOpen) {
    setLyricsOpen(false);
  }
});

nicknameBtn.addEventListener("click", openNicknameModal);
bgPickerBtn.addEventListener("click", () => {
  if (state.localBackgrounds.length) openBgLocalModal();
  else bgLocalInput.click();
});
bgLocalInput.addEventListener("change", () => {
  if (bgLocalInput.files && bgLocalInput.files.length) {
    addLocalBackgroundFiles(bgLocalInput.files);
  }
});
bgLocalAdd.addEventListener("click", () => bgLocalInput.click());
bgLocalSave.addEventListener("click", closeBgLocalModal);
bgLocalReset.addEventListener("click", async () => {
  try {
    await clearLocalBgRecords();
    await loadLocalBackgrounds();
    renderLocalBgGallery();
    setBgLocalStatus("已恢复歌曲封面背景", "ok");
  } catch (error) {
    setBgLocalStatus(error.message || "恢复失败", "error");
  }
});
bgLocalModal.addEventListener("click", (event) => {
  if (event.target === bgLocalModal) closeBgLocalModal();
});
themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});
listenerCount.addEventListener("click", openListenersModal);
listenersClose.addEventListener("click", closeListenersModal);
nicknameSave.addEventListener("click", saveNickname);
nicknameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveNickname();
});

searchForm.addEventListener("submit", performSearch);
libraryBtn.addEventListener("click", () => {
  if (!drawer.classList.contains("is-open")) openDrawer("queue");
  else closeDrawer();
});
drawerBackdrop.addEventListener("click", closeDrawer);
searchCancelBtn.addEventListener("click", () => {
  // This arrow only leaves search mode; the drawer itself is closed by
  // the backdrop, the library button or Escape.
  cancelSearch();
});
viewQueueBtn.addEventListener("click", () => setView("queue"));
viewHistoryBtn.addEventListener("click", () => setView("history"));
searchInput.addEventListener("input", () => {
  setSearchStatus("");
  state.searchResults = [];
  searchResults.textContent = "";
  if (!state.searchActive && searchInput.value.trim()) setSearchMode(true);
});
uploadBtn.addEventListener("click", () => uploadInput.click());
uploadInput.addEventListener("change", () => {
  const file = uploadInput.files && uploadInput.files[0];
  if (file) uploadLocalAudio(file);
});
messageForm.addEventListener("submit", submitMessage);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!bgLocalModal.classList.contains("hidden")) {
    closeBgLocalModal();
    return;
  }
  if (!listenersModal.classList.contains("hidden")) {
    closeListenersModal();
    return;
  }
  if (!drawer.classList.contains("hidden")) {
    closeDrawer();
    return;
  }
  if (!nicknameModal.classList.contains("hidden") && state.nickname) {
    hideModal(nicknameModal);
  }
});

wireAudioElement(audioA);
wireAudioElement(audioB);

cover.addEventListener("error", () => {
  if (!cover.src.endsWith("/placeholder.svg")) cover.src = "/placeholder.svg";
});

window.addEventListener("online", () => {
  state.connection = "connecting";
  pollNow();
});

window.addEventListener("offline", () => {
  state.connection = "offline";
  refreshStatus();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state.frameId !== null) {
      cancelAnimationFrame(state.frameId);
      state.frameId = null;
    }
    schedulePoll();
    return;
  }
  startFrame();
  pollNow();
  loadSidebar();
  updateMediaSession(state.now);
});

function registerAppShell() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* installability is best-effort */
  });
}

function loadAdminExtension() {
  if (document.getElementById("adminExtensionScript")) return;
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "/admin.css?v=8";
  style.id = "adminExtensionStyle";
  document.head.appendChild(style);
  const script = document.createElement("script");
  script.src = "/admin.js?v=21";
  script.id = "adminExtensionScript";
  document.body.appendChild(script);
}

/* ---------- init ---------- */

loadNickname();
if (!state.nickname && !IS_ADMIN_PAGE) {
  requestAnimationFrame(() => openNicknameModal());
}
loadTheme();
let marqueeResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(marqueeResizeTimer);
  marqueeResizeTimer = setTimeout(() => {
    setupMarquee(title, true);
    setupMarquee(currentLyricText, true);
    setupMarquee(currentLyricTrans, true);
  }, 220);
});
loadLocalBackgrounds();
setView("queue");
setPage("playback");
setLyricsOpen(false);

const savedVolume = storageGet("radio.volume");
if (savedVolume !== null) volumeEl.value = savedVolume;
const initialVolume = Number(volumeEl.value);
audio.volume = clamp(Number.isFinite(initialVolume) ? initialVolume : 0.8, 0, 1);

updatePlayButton();
refreshStatus();
setLyricsEmpty("等待开播");
setupMediaSession();
startFrame();
loadConfig();
pollNow();
loadSidebar();

// Do not force the nickname dialog on every visit.  It opens only when
// the user taps the profile button or starts an action that needs it.
if (IS_ADMIN_PAGE) loadAdminExtension();
registerAppShell();

setInterval(() => {
  if (!document.hidden) loadSidebar();
}, 12_000);
setInterval(() => {
  if (!document.hidden) loadConfig();
}, 5_000);
