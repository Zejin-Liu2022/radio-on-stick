"use strict";

(() => {
  if (window.__radioAdminLoaded) return;
  window.__radioAdminLoaded = true;

  const $ = (id) => document.getElementById(id);
  const K_TOKEN = "radio.adminToken";
  const state = {
    token: "",
    data: null,
    tab: "tracks",
    busy: false,
    timer: null,
    dirty: false,
  };

  const el = (tag, className = "", text = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const icon = (paths) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon stroke-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const d of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  };

  const sessionGet = (key) => {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  };
  const sessionSet = (key, value) => {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch (_) { /* ignore */ }
  };

  async function api(path, options = {}) {
    const { timeout = 20_000, ...init } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(path, {
        cache: "no-store",
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${state.token}` },
        signal: controller.signal,
      });
      let data = {};
      try { data = await response.json(); } catch (_) { data = {}; }
      if (!response.ok) {
        const error = new Error(data.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  const errorText = (error, fallback = "操作失败") =>
    (error && error.data && error.data.message) || (error && error.message) || fallback;

  function setStatus(kind, text) {
    const node = $("adminStatus");
    if (!node) return;
    node.dataset.state = kind;
    node.textContent = text;
  }

  /* ---------- topbar button ---------- */
  function addTopbarButton() {
    if ($("adminOpenBtn")) return;
    const actions = document.querySelector(".top-actions");
    if (!actions) return;
    const button = el("button", "icon-btn admin-open-btn");
    button.id = "adminOpenBtn";
    button.type = "button";
    button.setAttribute("aria-label", "管理控制台");
    button.title = "管理控制台";
    button.appendChild(icon([
      "M12 3.5 19 6v5.1c0 4.1-2.6 7.7-7 9.4-4.4-1.7-7-5.3-7-9.4V6l7-2.5Z",
      "m9 12 2 2 4-4",
    ]));
    button.addEventListener("click", () => openConsole(true));
    actions.appendChild(button);
  }

  /* ---------- console shell ---------- */
  function buildConsole() {
    if ($("adminConsole")) return;
    const overlay = el("div", "admin-console hidden");
    overlay.id = "adminConsole";

    const backdrop = el("div", "admin-console-backdrop");
    backdrop.addEventListener("click", closeConsole);

    const card = el("section", "admin-console-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "adminConsoleTitle");

    const head = el("header", "admin-console-head");
    const heading = el("div", "admin-console-heading");
    heading.appendChild(el("p", "kicker", "SERVER ADMIN"));
    const title = el("h2", "", "管理控制台");
    title.id = "adminConsoleTitle";
    heading.appendChild(title);
    head.appendChild(heading);
    const headActions = el("div", "admin-console-head-actions");
    const status = el("span", "sync-pill", "未登录");
    status.id = "adminStatus";
    status.dataset.state = "offline";
    headActions.appendChild(status);
    const close = el("button", "icon-btn");
    close.type = "button";
    close.setAttribute("aria-label", "关闭管理控制台");
    close.title = "关闭";
    close.appendChild(icon(["m6 6 12 12M18 6 6 18"]));
    close.addEventListener("click", closeConsole);
    headActions.appendChild(close);
    head.appendChild(headActions);

    const login = el("div", "admin-login-view");
    login.id = "adminLoginView";
    login.appendChild(el("p", "admin-copy", "输入服务端 RADIO_ADMIN_TOKEN 后管理电台。"));
    const tokenInput = el("input", "admin-token-input");
    tokenInput.id = "adminToken";
    tokenInput.type = "password";
    tokenInput.placeholder = "管理 token";
    tokenInput.autocomplete = "current-password";
    login.appendChild(tokenInput);
    const loginRow = el("div", "admin-console-actions");
    const loginButton = el("button", "primary-btn", "登录");
    loginButton.id = "adminLoginBtn";
    loginButton.type = "button";
    loginRow.appendChild(loginButton);
    login.appendChild(loginRow);
    const loginStatus = el("p", "form-status");
    loginStatus.id = "adminLoginStatus";
    loginStatus.setAttribute("role", "status");
    login.appendChild(loginStatus);

    const panel = el("div", "admin-panel-view hidden");
    panel.id = "adminPanelView";
    const tabs = el("nav", "admin-console-tabs");
    tabs.setAttribute("role", "tablist");
    const tabDefs = [
      ["tracks", "曲目库"],
      ["policy", "准入与格式"],
      ["page", "页面与背景"],
      ["directory", "电台目录"],
      ["access", "访问与部署"],
      ["messages", "留言"],
    ];
    for (const [key, label] of tabDefs) {
      const button = el("button", "admin-console-tab", label);
      button.type = "button";
      button.dataset.tab = key;
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => switchTab(key));
      tabs.appendChild(button);
    }
    panel.appendChild(tabs);

    const body = el("div", "admin-console-body");
    body.id = "adminConsoleBody";
    panel.appendChild(body);

    card.appendChild(head);
    card.appendChild(login);
    card.appendChild(panel);
    overlay.appendChild(backdrop);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    tokenInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") login();
    });
  }

  function openConsole(showLogin = false) {
    buildConsole();
    const overlay = $("adminConsole");
    overlay.classList.remove("hidden");
    document.body.classList.add("admin-console-open");
    if (state.token) {
      loadState();
    } else {
      showLoginView();
      if (showLogin) setTimeout(() => $("adminToken")?.focus(), 80);
    }
  }

  function closeConsole() {
    $("adminConsole")?.classList.add("hidden");
    document.body.classList.remove("admin-console-open");
  }

  function showLoginView() {
    $("adminLoginView")?.classList.remove("hidden");
    $("adminPanelView")?.classList.add("hidden");
  }

  function showPanelView() {
    $("adminLoginView")?.classList.add("hidden");
    $("adminPanelView")?.classList.remove("hidden");
  }

  async function login() {
    const input = $("adminToken");
    const button = $("adminLoginBtn");
    if (!input || !button) return;
    const token = input.value.trim();
    if (!token) {
      setLoginStatus("请输入管理 token", "error");
      return;
    }
    state.token = token;
    button.disabled = true;
    setLoginStatus("正在验证…", "busy");
    try {
      const data = await api("/api/admin/state");
      sessionSet(K_TOKEN, token);
      state.data = data;
      showPanelView();
      setStatus("live", "已连接");
      renderAll();
      startPolling();
      setLoginStatus("");
    } catch (error) {
      state.token = "";
      sessionSet(K_TOKEN, null);
      setLoginStatus(errorText(error, "登录失败"), "error");
      setStatus("offline", "未登录");
      showLoginView();
    } finally {
      button.disabled = false;
    }
  }

  function setLoginStatus(text, tone = "") {
    const node = $("adminLoginStatus");
    if (!node) return;
    node.textContent = text;
    node.dataset.tone = tone;
  }

  async function loadState(force = false) {
    if (!state.token) return;
    try {
      state.data = await api("/api/admin/state");
      showPanelView();
      setStatus("live", "已连接");
      if (force || !state.dirty) {
        state.dirty = false;
        renderAll();
      }
      startPolling();
    } catch (error) {
      if (error.status === 401 || error.status === 503) {
        state.token = "";
        sessionSet(K_TOKEN, null);
        stopPolling();
        setStatus("offline", "登录失效");
        setLoginStatus(errorText(error, "登录失效"), "error");
        showLoginView();
      } else {
        setStatus("offline", "连接中断");
      }
    }
  }

  function startPolling() {
    if (state.timer) return;
    state.timer = setInterval(() => {
      if (!document.hidden && state.token && !$("adminConsole")?.classList.contains("hidden")) {
        loadState();
      }
    }, 5_000);
  }

  function stopPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  function switchTab(tab) {
    state.tab = tab;
    for (const button of document.querySelectorAll(".admin-console-tab")) {
      button.classList.toggle("active", button.dataset.tab === tab);
    }
    renderAll();
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function button(label, className, action) {
    const btn = el("button", className, label);
    btn.type = "button";
    if (action) btn.addEventListener("click", action);
    return btn;
  }

  function renderAll() {
    if (!state.data) return;
    renderTracks();
    renderPolicy();
    renderPage();
    renderDirectory();
    renderAccess();
    renderMessages();
    for (const button of document.querySelectorAll(".admin-console-tab")) {
      button.classList.toggle("active", button.dataset.tab === state.tab);
    }
  }

  function section(titleText, hint = "") {
    const wrap = el("section", "admin-section");
    const head = el("div", "admin-section-head");
    head.appendChild(el("h3", "", titleText));
    if (hint) head.appendChild(el("span", "admin-hint", hint));
    wrap.appendChild(head);
    return wrap;
  }

  function renderControl() {
    const body = $("adminConsoleBody");
    if (!body) return;
    clear(body);
    if (state.tab !== "control") {
      renderTabPlaceholder(body);
      return;
    }
    const now = state.data.now || {};
    const wrap = section("播放与队列");
    const nowBox = el("div", "admin-now");
    if (now.track) {
      nowBox.appendChild(el("strong", "", now.track.title || "未知曲目"));
      nowBox.appendChild(el("span", "", ` · ${now.track.artist || "未知歌手"} · ${now.paused ? "已暂停" : "播放中"}`));
    } else {
      nowBox.textContent = "当前没有播放";
    }
    wrap.appendChild(nowBox);

    const actions = el("div", "admin-console-actions");
    actions.appendChild(button(now.paused ? "恢复" : "暂停", "primary-btn", () =>
      adminAction(now.paused ? "/api/admin/resume" : "/api/admin/pause", now.paused ? "已恢复" : "已暂停"),
    ));
    actions.appendChild(button("切歌", "", () => adminAction("/api/admin/skip", "已切歌")));
    actions.appendChild(button("清空待播放", "ghost-btn", async () => {
      if (!window.confirm("清空所有待播放请求？")) return;
      await adminAction("/api/admin/clear-queue", "已清空待播放");
    }));
    wrap.appendChild(actions);

    const queue = Array.isArray(state.data.queue) ? state.data.queue : [];
    const queueTitle = el("h4", "admin-subhead", `队列（${queue.length}）`);
    wrap.appendChild(queueTitle);
    if (!queue.length) wrap.appendChild(el("p", "empty", "队列为空"));
    for (const item of queue) {
      const row = el("div", "admin-row");
      const copy = el("div", "admin-row-copy");
      copy.appendChild(el("span", "admin-row-title", item.title || "未知曲目"));
      copy.appendChild(el("span", "admin-row-sub", [
        item.artist || "未知歌手",
        item.status === "playing" ? "播放中" : "等待中",
        item.nickname ? `by ${item.nickname}` : "",
      ].filter(Boolean).join(" · ")));
      row.appendChild(copy);
      if (item.status === "pending") {
        const delQueue = button("移出", "ghost-btn", async () => {
          if (!window.confirm("从队列移出这首歌？")) return;
          try {
            await api("/api/admin/queue/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ queue_id: item.id }),
            });
            await loadState(true);
          } catch (error) { setStatus("offline", errorText(error)); }
        });
        row.appendChild(delQueue);
      }
      const delTrack = button("删除曲目", "danger-btn", () => deleteTrack(item.track_id, item.title));
      row.appendChild(delTrack);
      wrap.appendChild(row);
    }
    body.appendChild(wrap);
  }

  function renderTabPlaceholder(body) {
    if (state.tab === "tracks") return renderTracks(body);
    if (state.tab === "policy") return renderPolicy(body);
    if (state.tab === "page") return renderPage(body);
    if (state.tab === "directory") return renderDirectory(body);
    if (state.tab === "access") return renderAccess(body);
    if (state.tab === "messages") return renderMessages(body);
  }

  function renderTracks(body = $("adminConsoleBody")) {
    if (!body) return;
    if (state.tab !== "tracks") return;
    clear(body);
    const wrap = section("曲目库", "删除后不可恢复");
    const searchRow = el("form", "admin-search-row");
    const input = el("input", "admin-token-input");
    input.placeholder = "搜索歌名或歌手，加入播放列表";
    input.maxLength = 80;
    const searchButton = el("button", "primary-btn", "搜索");
    searchButton.type = "submit";
    searchRow.appendChild(input);
    searchRow.appendChild(searchButton);
    wrap.appendChild(searchRow);
    const status = el("p", "form-status");
    wrap.appendChild(status);
    const results = el("div", "admin-search-results");
    wrap.appendChild(results);
    searchRow.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      status.textContent = "正在搜索…";
      results.textContent = "";
      try {
        const data = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store" }).then((r) => r.json());
        const items = data.results || [];
        status.textContent = `找到 ${items.length} 首`;
        for (const item of items) {
          const row = el("div", "admin-row");
          const copy = el("div", "admin-row-copy");
          copy.appendChild(el("span", "admin-row-title", item.title || "未知曲目"));
          copy.appendChild(el("span", "admin-row-sub", [item.artist, item.source_label].filter(Boolean).join(" · ")));
          row.appendChild(copy);
          row.appendChild(button("加入播放列表", "primary-btn", async () => {
            try {
              await api("/api/admin/track", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ candidate_id: item.candidate_id }),
              });
              status.textContent = "已加入播放列表";
              await loadState(true);
            } catch (error) { status.textContent = errorText(error); }
          }));
          results.appendChild(row);
        }
      } catch (error) {
        status.textContent = errorText(error, "搜索失败");
      }
    });

    const queueActions = el("div", "admin-console-actions");
    queueActions.appendChild(button("清空待播放", "ghost-btn", async () => {
      if (!window.confirm("清空所有待播放请求？")) return;
      await adminAction("/api/admin/clear-queue", "已清空待播放");
    }));
    wrap.appendChild(queueActions);

    const tracks = Array.isArray(state.data.tracks) ? state.data.tracks : [];
    wrap.appendChild(el("h4", "admin-subhead", `全部曲目（${tracks.length}）`));
    if (!tracks.length) wrap.appendChild(el("p", "empty", "曲目库为空"));
    for (const track of tracks) {
      const row = el("div", "admin-row");
      const copy = el("div", "admin-row-copy");
      copy.appendChild(el("span", "admin-row-title", track.title || "未知曲目"));
      copy.appendChild(el("span", "admin-row-sub", [
        track.artist || "未知歌手",
        track.source || "",
        track.enabled ? "播放列表" : "未启用",
      ].filter(Boolean).join(" · ")));
      row.appendChild(copy);
      row.appendChild(button("删除", "danger-btn", () => deleteTrack(track.id, track.title)));
      wrap.appendChild(row);
    }
    body.appendChild(wrap);
  }

  function renderPolicy(body = $("adminConsoleBody")) {
    if (!body) return;
    if (state.tab !== "policy") return;
    clear(body);
    const policy = state.data.policy || {};
    const wrap = section("准入与格式", "保存后立即生效");
    const makeToggle = (key, labelText) => {
      const row = el("label", "admin-toggle-row");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(policy[key]);
      checkbox.id = `admin-${key}`;
      row.appendChild(checkbox);
      row.appendChild(el("span", "", labelText));
      wrap.appendChild(row);
      return checkbox;
    };
    const mp3Upload = makeToggle("mp3_upload_only", "只允许上传 MP3");
    const mp3Remote = makeToggle("mp3_remote_only", "第三方音源只允许 MP3");
    const requests = makeToggle("requests_enabled", "允许点歌");
    const uploads = makeToggle("uploads_enabled", "允许上传音频");
    const messages = makeToggle("messages_enabled", "允许留言");

    const maxRow = el("label", "admin-field");
    maxRow.appendChild(el("span", "", "最大同时听众人数（0 = 不限）"));
    const max = document.createElement("input");
    max.type = "number";
    max.min = "0";
    max.max = "10000";
    max.value = String(policy.max_listeners || 0);
    maxRow.appendChild(max);
    wrap.appendChild(maxRow);

    wrap.appendChild(el("p", "admin-note", "IP 准入由 Nginx 的 /etc/nginx/snippets/radio-allow.conf 管理（参考 Pigman02/radio-on-stick），升级会保留。这里只管理运行时限流、功能开关和 MP3 格式。第三方 MP3 限制会在音频无法确认为 MP3 时拒绝。"));

    const save = button("保存策略", "primary-btn", async () => {
      try {
        await api("/api/admin/policy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mp3_upload_only: mp3Upload.checked,
            mp3_remote_only: mp3Remote.checked,
            requests_enabled: requests.checked,
            uploads_enabled: uploads.checked,
            messages_enabled: messages.checked,
            max_listeners: Number(max.value) || 0,
          }),
        });
        setStatus("live", "策略已保存");
        await loadState(true);
      } catch (error) {
        setStatus("offline", errorText(error, "保存失败"));
      }
    });
    wrap.appendChild(save);
    body.appendChild(wrap);
  }

  function renderPage(body = $("adminConsoleBody")) {
    if (!body) return;
    if (state.tab !== "page") return;
    clear(body);
    const settings = state.data.settings || {};
    const wrap = section("页面与背景", "服务端背景只对未设置本机背景的客户端生效");
    const field = (labelText, id, value, multiline = false) => {
      const label = el("label", "admin-field");
      label.appendChild(el("span", "", labelText));
      const input = multiline ? document.createElement("textarea") : document.createElement("input");
      input.id = id;
      input.value = value || "";
      if (multiline) input.rows = 3;
      label.appendChild(input);
      wrap.appendChild(label);
      return input;
    };
    const station = field("电台名称", "adminStationName", settings.station_name);
    const subtitle = field("副标题", "adminSubtitle", settings.subtitle);
    const notice = field("公告", "adminNotice", settings.notice, true);
    const interval = field("背景轮换秒数", "adminBgInterval", settings.background_interval_sec);
    interval.type = "number";
    interval.min = "30";
    interval.max = "86400";
    wrap.appendChild(button("保存页面设置", "primary-btn", async () => {
      try {
        await api("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            station_name: station.value,
            subtitle: subtitle.value,
            notice: notice.value,
            background_interval_sec: Number(interval.value) || 300,
          }),
        });
        const nextName = station.value.trim() || "猫娘电台";
        const nextSubtitle = subtitle.value.trim();
        document.title = nextSubtitle ? `${nextName} - ${nextSubtitle}` : nextName;
        setStatus("live", "页面设置已保存");
        await loadState(true);
      } catch (error) { setStatus("offline", errorText(error, "保存失败")); }
    }));

    wrap.appendChild(el("h4", "admin-subhead", "服务端背景图库"));
    const uploadRow = el("div", "admin-console-actions");
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/jpeg,image/png,image/webp";
    uploadRow.appendChild(file);
    uploadRow.appendChild(button("上传背景", "primary-btn", async () => {
      if (!file.files || !file.files[0]) return;
      try {
        const response = await fetch("/api/admin/background", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.token}`, "Content-Type": file.files[0].type || "application/octet-stream" },
          body: file.files[0],
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.message || "上传失败"), { data });
        file.value = "";
        setStatus("live", "背景已上传");
        await loadState(true);
      } catch (error) { setStatus("offline", errorText(error, "上传失败")); }
    }));
    wrap.appendChild(uploadRow);

    const urlRow = el("div", "admin-search-row");
    const urlInput = el("input", "admin-token-input");
    urlInput.placeholder = "https://example.com/background.jpg";
    urlRow.appendChild(urlInput);
    urlRow.appendChild(button("添加图床", "ghost-btn", async () => {
      try {
        await api("/api/admin/background/url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urlInput.value.trim() }),
        });
        urlInput.value = "";
        setStatus("live", "图床地址已添加");
        await loadState(true);
      } catch (error) { setStatus("offline", errorText(error, "添加失败")); }
    }));
    wrap.appendChild(urlRow);

    const gallery = el("div", "bg-gallery");
    for (const item of state.data.backgrounds || []) {
      const thumb = el("div", "bg-thumb");
      const image = document.createElement("img");
      image.src = item.url;
      image.alt = "";
      thumb.appendChild(image);
      thumb.appendChild(el("span", "bg-type", item.type === "network" ? "图床" : "本地"));
      thumb.appendChild(button("×", "danger-btn", async () => {
        try {
          if (item.type === "network") {
            await api("/api/admin/background/url/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: item.url }) });
          } else {
            await api("/api/admin/background/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: item.name }) });
          }
          await loadState(true);
        } catch (error) { setStatus("offline", errorText(error, "删除失败")); }
      }));
      gallery.appendChild(thumb);
    }
    wrap.appendChild(gallery);
    body.appendChild(wrap);
  }

  function renderDirectory(body = $("adminConsoleBody")) {
    if (!body) return;
    if (state.tab !== "directory") return;
    clear(body);
    const directory = state.data.directory || {};
    const wrap = section("公共电台目录", "邀请码只显示给管理员");
    if (!directory.enabled) {
      wrap.appendChild(el("p", "admin-note", "Directory 未配置。请由服务器部署者在环境文件中设置 RADIO_DIRECTORY_URL / RADIO_DIRECTORY_REGISTER_TOKEN / RADIO_DIRECTORY_PUBLIC_URL。"));
      body.appendChild(wrap);
      return;
    }
    const enabled = el("p", "admin-note", directory.registered ? "已注册到 Directory" : "尚未注册成功");
    wrap.appendChild(enabled);
    const publicId = el("label", "admin-field");
    publicId.appendChild(el("span", "", "Station ID"));
    const publicInput = document.createElement("input");
    publicInput.value = directory.station_id || "";
    publicInput.readOnly = true;
    publicId.appendChild(publicInput);
    wrap.appendChild(publicId);

    const codeLabel = el("label", "admin-field");
    codeLabel.appendChild(el("span", "", "当前邀请码"));
    const codeInput = document.createElement("input");
    codeInput.value = directory.invite_code || "";
    codeInput.readOnly = true;
    codeInput.id = "adminDirectoryInvite";
    codeLabel.appendChild(codeInput);
    wrap.appendChild(codeLabel);

    const codeActions = el("div", "admin-console-actions");
    codeActions.appendChild(button("复制邀请码", "primary-btn", async () => {
      try {
        await navigator.clipboard.writeText(codeInput.value);
        setStatus("live", "邀请码已复制");
      } catch (_) {
        codeInput.select();
      }
    }));
    codeActions.appendChild(button("刷新注册", "ghost-btn", async () => {
      try {
        await api("/api/admin/directory/refresh", { method: "POST" });
        setStatus("live", "Directory 已刷新");
        await loadState(true);
      } catch (error) { setStatus("offline", errorText(error, "刷新失败")); }
    }));
    codeActions.appendChild(button("轮换邀请码", "danger-btn", async () => {
      if (!window.confirm("轮换后旧邀请码立即失效，继续？")) return;
      try {
        await api("/api/admin/directory/rotate", { method: "POST" });
        setStatus("live", "邀请码已轮换");
        await loadState(true);
      } catch (error) { setStatus("offline", errorText(error, "轮换失败")); }
    }));
    wrap.appendChild(codeActions);

    if (directory.last_error) {
      wrap.appendChild(el("p", "admin-note", `最近错误：${directory.last_error}`));
    }
    wrap.appendChild(el("p", "admin-note", "邀请码用于 Directory 定位本电台。管理员 token 不会发送到 Directory。"));
    body.appendChild(wrap);
  }

  function renderAccess(body = $("adminConsoleBody")) {
    if (!body) return;
    if (state.tab !== "access") return;
    clear(body);
    const settings = state.data.settings || {};
    const wrap = section("访问与部署", "仅管理端可见，不会修改 Nginx、TLS 或隧道");
    const field = (labelText, id, value, placeholder = "") => {
      const label = el("label", "admin-field");
      label.appendChild(el("span", "", labelText));
      const input = document.createElement("input");
      input.id = id;
      input.value = value || "";
      input.placeholder = placeholder;
      label.appendChild(input);
      wrap.appendChild(label);
      return input;
    };
    const publicUrl = field("公开访问地址", "adminPublicUrl", settings.public_url, "https://radio.example.com/");
    const lanUrl = field("校园内网地址", "adminLanUrl", settings.lan_url, "https://172.18.1.10:8443/");
    const tunnelUrl = field("备用隧道地址", "adminTunnelUrl", settings.tunnel_url, "https://xxxx.trycloudflare.com/");
    const note = document.createElement("textarea");
    note.id = "adminAccessNote";
    note.rows = 3;
    note.value = settings.access_note || "";
    note.placeholder = "例如：仅校园网、Safari 需安装 CA、管理端入口说明";
    const noteLabel = el("label", "admin-field");
    noteLabel.appendChild(el("span", "", "访问说明"));
    noteLabel.appendChild(note);
    wrap.appendChild(noteLabel);
    wrap.appendChild(el("p", "admin-note", "这里只记录部署信息。IP 白名单、TLS 证书、Cloudflare 隧道和 RADIO_ADMIN_TOKEN 必须留在服务器环境文件或 Nginx 配置中，不能由网页管理。"));
    wrap.appendChild(button("保存访问配置", "primary-btn", async () => {
      try {
        await api("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_url: publicUrl.value.trim(),
            lan_url: lanUrl.value.trim(),
            tunnel_url: tunnelUrl.value.trim(),
            access_note: note.value.trim(),
          }),
        });
        setStatus("live", "访问配置已保存");
        await loadState(true);
      } catch (error) { setStatus("offline", errorText(error, "保存失败")); }
    }));
    body.appendChild(wrap);
  }

  function renderMessages(body = $("adminConsoleBody")) {
    if (!body) return;
    if (state.tab !== "messages") return;
    clear(body);
    const wrap = section("留言管理");
    const messages = Array.isArray(state.data.messages) ? state.data.messages : [];
    if (!messages.length) wrap.appendChild(el("p", "empty", "还没有留言"));
    for (const item of messages) {
      const row = el("div", "admin-row");
      const copy = el("div", "admin-row-copy");
      copy.appendChild(el("span", "admin-row-title", item.nickname || "匿名"));
      copy.appendChild(el("span", "admin-row-sub", item.body || ""));
      row.appendChild(copy);
      row.appendChild(button("隐藏", "ghost-btn", async () => {
        try {
          await api("/api/admin/hide-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.id }),
          });
          await loadState(true);
        } catch (error) { setStatus("offline", errorText(error, "隐藏失败")); }
      }));
      wrap.appendChild(row);
    }
    body.appendChild(wrap);
  }

  async function deleteTrack(trackId, title) {
    if (!trackId) return;
    if (!window.confirm(`删除曲目「${title || trackId}」？`)) return;
    try {
      await api("/api/admin/track/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_id: trackId }),
      });
      setStatus("live", "曲目已删除");
      await loadState(true);
    } catch (error) {
      setStatus("offline", errorText(error, "删除失败"));
    }
  }

  async function adminAction(path, success) {
    try {
      await api(path, { method: "POST" });
      setStatus("live", success);
      await loadState(true);
    } catch (error) {
      setStatus("offline", errorText(error));
    }
  }

  /* ---------- boot ---------- */
  addTopbarButton();
  state.token = sessionGet(K_TOKEN) || "";
  buildConsole();
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest("#adminLoginBtn")) {
      event.preventDefault();
      login();
    }
  });
  if (state.token) {
    loadState();
  } else {
    openConsole(true);
  }
  document.addEventListener("input", (event) => {
    if (event.target && event.target.closest("#adminConsole")) state.dirty = true;
  });
  document.addEventListener("change", (event) => {
    if (event.target && event.target.closest("#adminConsole")) state.dirty = true;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("adminConsole")?.classList.contains("hidden")) {
      closeConsole();
    }
  });
})();
