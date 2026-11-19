"use strict";

(() => {
  const form = document.getElementById("joinForm");
  const codeInput = document.getElementById("code");
  const submit = document.getElementById("submit");
  const status = document.getElementById("status");
  const result = document.getElementById("result");
  const stationName = document.getElementById("stationName");
  const stationMeta = document.getElementById("stationMeta");
  const enter = document.getElementById("enter");

  function normalize(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[\s_-]/g, "")
      .replace(/[IL]/g, "1")
      .replace(/O/g, "0")
      .replace(/U/g, "V");
  }

  function setStatus(text, tone = "") {
    status.textContent = text || "";
    status.dataset.tone = tone;
  }

  async function resolveCode(raw) {
    const code = normalize(raw);
    if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(code)) {
      setStatus("请输入 16 位邀请码", "error");
      return;
    }
    submit.disabled = true;
    setStatus("正在查找电台…");
    result.classList.add("hidden");
    try {
      const response = await fetch("/v1/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(data.message || "找不到这个邀请码", "error");
        return;
      }
      const station = data.station || {};
      const stationUrl = data.join && data.join.station_url;
      stationName.textContent = station.name || "未命名电台";
      stationMeta.textContent = [
        station.description,
        station.station_id,
      ].filter(Boolean).join(" · ");
      if (stationUrl) {
        enter.href = stationUrl;
        enter.classList.remove("hidden");
      } else {
        enter.classList.add("hidden");
      }
      setStatus("");
      result.classList.remove("hidden");
      history.replaceState(null, "", `/j#${encodeURIComponent(code)}`);
    } catch (_) {
      setStatus("网络错误，请稍后重试", "error");
    } finally {
      submit.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    resolveCode(codeInput.value);
  });

  const initial = normalize(decodeURIComponent(location.hash.slice(1)));
  if (initial) {
    codeInput.value = initial;
    resolveCode(initial);
  }
})();
