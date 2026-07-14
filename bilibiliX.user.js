// ==UserScript==
// @name         BilibiliX
// @namespace    https://github.com/local/bilibiliX
// @version      0.2.1
// @description  个人用 B 站首页/视频页重设计：居中搜索、关注动态视频流；全屏自动播放
// @author       you
// @match        *://www.bilibili.com/*
// @match        *://bilibili.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.bilibili.com
// ==/UserScript==

(function () {
  "use strict";

  const NS = "bx";
  const STATE = {
    route: "other",
    homeHero: true,
    autoplayTried: false,
    dynOffset: "",
    dynLoading: false,
    dynHasMore: true,
    dynReady: false,
    styleReady: false,
  };

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap");

:root {
  --bx-bg: #0e1014;
  --bx-bg-soft: #161a22;
  --bx-text: #e8eaef;
  --bx-muted: #8b93a7;
  --bx-accent: #00a1d6;
  --bx-line: rgba(255,255,255,0.08);
  --bx-radius: 14px;
  --bx-font: "Outfit", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
}

html.${NS}-on, body.${NS}-on {
  background: var(--bx-bg) !important;
  color: var(--bx-text) !important;
  font-family: var(--bx-font) !important;
}

html.${NS}-home, body.${NS}-home,
body.${NS}-home #i_cecream,
body.${NS}-home #app,
body.${NS}-home .bili-feed4,
body.${NS}-home .bili-feed4-layout,
body.${NS}-home .bg,
body.${NS}-home .bg-wrap {
  background: var(--bx-bg) !important;
  background-color: var(--bx-bg) !important;
}

/* ========== HOME ========== */
body.${NS}-home {
  overflow-x: hidden !important;
  overflow-y: auto !important;
  min-height: 100%;
}

body.${NS}-home .bili-header__banner,
body.${NS}-home .bili-header__channel,
body.${NS}-home .header-channel-fixed,
body.${NS}-home .banner-card,
body.${NS}-home .ad-report,
body.${NS}-home .palette-button-outer,
body.${NS}-home .fixed-sidenav-storage,
body.${NS}-home .download-client-entry,
body.${NS}-home .left-entry,
body.${NS}-home .right-entry,
body.${NS}-home .vip-wrap,
body.${NS}-home .locale-item,
body.${NS}-home .channel-icons,
body.${NS}-home .header-channel {
  display: none !important;
}

/* hide official recommend feed — replaced by following dynamics */
body.${NS}-home .recommended-container_floor-sticky,
body.${NS}-home .recommended-container,
body.${NS}-home .feed2,
body.${NS}-home .container.is-version8,
body.${NS}-home .feed-card,
body.${NS}-home .bili-feed4-layout,
body.${NS}-home .feed2-container,
body.${NS}-home .homepage-feed,
body.${NS}-home .feed2-wrap,
body.${NS}-home main > .feed2,
body.${NS}-home .bili-layout,
body.${NS}-home .bili-grid {
  display: none !important;
  height: 0 !important;
  max-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  border: none !important;
  background: transparent !important;
}

/* block search history / hot search / related suggest */
body.${NS}-home .search-panel,
body.${NS}-home .nav-search-panel,
body.${NS}-home .header-search-suggest,
body.${NS}-home .search-panel-container,
body.${NS}-home .suggestions,
body.${NS}-home .suggest-wrap,
body.${NS}-home .history,
body.${NS}-home .history-wrap,
body.${NS}-home .trending,
body.${NS}-home .trending-list,
body.${NS}-home .search-trending,
body.${NS}-home .search-history,
body.${NS}-home .i_wrapper.search-panel,
body.${NS}-home [class*="search-panel"],
body.${NS}-home [class*="SearchPanel"],
body.${NS}-home .nav-search .popover,
body.${NS}-home .center-search-container .popover,
body.${NS}-home .search-component-popover,
body.${NS}-home .bili-header .search-panel {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  height: 0 !important;
  overflow: hidden !important;
}

body.${NS}-home .bili-header {
  position: relative !important;
  z-index: 20 !important;
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
}

body.${NS}-home .bili-header__bar {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  height: auto !important;
  min-height: 0 !important;
}

body.${NS}-home.${NS}-home-hero .bili-header__bar {
  position: fixed !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100vh !important;
  max-width: none !important;
  margin: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  pointer-events: none !important;
  z-index: 30 !important;
}

body.${NS}-home.${NS}-home-hero .center-search-container,
body.${NS}-home.${NS}-home-hero #nav-searchform {
  pointer-events: auto !important;
  width: min(640px, 86vw) !important;
  max-width: 640px !important;
  margin: 0 auto !important;
  transform: translateY(-8vh);
  transition: transform .35s ease, width .35s ease, opacity .35s ease;
}

body.${NS}-home.${NS}-home-scrolled .bili-header__bar {
  position: sticky !important;
  top: 0 !important;
  inset: auto !important;
  height: 64px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: rgba(14,16,20,0.86) !important;
  backdrop-filter: blur(12px) !important;
  border-bottom: 1px solid var(--bx-line) !important;
  z-index: 40 !important;
  pointer-events: auto !important;
}

body.${NS}-home.${NS}-home-scrolled .center-search-container,
body.${NS}-home.${NS}-home-scrolled #nav-searchform {
  width: min(520px, 90vw) !important;
  transform: none !important;
}

/* only ONE outer pill — nested layers stay transparent (fixes double bar + white focus) */
body.${NS}-home .center-search-container {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
}

body.${NS}-home #nav-searchform {
  display: flex !important;
  align-items: center !important;
  width: 100% !important;
  max-width: 640px !important;
  height: 48px !important;
  padding: 0 8px 0 18px !important;
  box-sizing: border-box !important;
  background: var(--bx-bg-soft) !important;
  background-color: var(--bx-bg-soft) !important;
  border: 1px solid var(--bx-line) !important;
  border-radius: 999px !important;
  box-shadow: 0 12px 40px rgba(0,0,0,0.35) !important;
}

body.${NS}-home #nav-searchform:hover,
body.${NS}-home #nav-searchform:focus-within,
body.${NS}-home #nav-searchform.is-focus {
  background: #1c2230 !important;
  background-color: #1c2230 !important;
  border-color: rgba(0,161,214,0.45) !important;
}

body.${NS}-home .center-search__bar,
body.${NS}-home .nav-search-content,
body.${NS}-home #nav-searchform > div,
body.${NS}-home .nav-search-input,
body.${NS}-home input.nav-search-input {
  background: transparent !important;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  outline: none !important;
}

body.${NS}-home .nav-search-input,
body.${NS}-home input.nav-search-input {
  color: var(--bx-text) !important;
  caret-color: var(--bx-accent) !important;
  font-size: 16px !important;
  font-family: var(--bx-font) !important;
  flex: 1 !important;
  height: 100% !important;
  -webkit-text-fill-color: var(--bx-text) !important;
}

body.${NS}-home .nav-search-input:focus,
body.${NS}-home input.nav-search-input:focus,
body.${NS}-home .nav-search-input:hover,
body.${NS}-home input.nav-search-input:hover {
  background: transparent !important;
  background-color: transparent !important;
  color: var(--bx-text) !important;
  -webkit-text-fill-color: var(--bx-text) !important;
}

body.${NS}-home .nav-search-input::placeholder {
  color: var(--bx-muted) !important;
  -webkit-text-fill-color: var(--bx-muted) !important;
  opacity: 1 !important;
}

body.${NS}-home .nav-search-btn,
body.${NS}-home .nav-search-button,
body.${NS}-home #nav-searchform .nav-search-btn {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  width: 40px !important;
  height: 40px !important;
  border-radius: 999px !important;
  color: var(--bx-muted) !important;
  flex: 0 0 auto !important;
}

body.${NS}-home .nav-search-btn:hover,
body.${NS}-home .nav-search-button:hover {
  background: rgba(255,255,255,0.06) !important;
  color: var(--bx-text) !important;
}

/* kill autofill white flash */
body.${NS}-home input.nav-search-input:-webkit-autofill,
body.${NS}-home input.nav-search-input:-webkit-autofill:focus {
  -webkit-box-shadow: 0 0 0 1000px var(--bx-bg-soft) inset !important;
  -webkit-text-fill-color: var(--bx-text) !important;
  transition: background-color 99999s ease-out;
}

#${NS}-home-hero {
  height: 100vh;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 48px;
  box-sizing: border-box;
  pointer-events: none;
  background:
    radial-gradient(ellipse 70% 50% at 50% 40%, rgba(0,161,214,0.12), transparent 70%),
    var(--bx-bg);
}

#${NS}-home-hint {
  color: var(--bx-muted);
  font-size: 13px;
  letter-spacing: 0.12em;
  opacity: 0.85;
  animation: ${NS}-hint 2.2s ease-in-out infinite;
}

@keyframes ${NS}-hint {
  0%, 100% { transform: translateY(0); opacity: 0.55; }
  50% { transform: translateY(6px); opacity: 1; }
}

body.${NS}-home.${NS}-home-scrolled #${NS}-home-hero {
  height: 0 !important;
  min-height: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* always in document flow so the page can actually scroll */
#${NS}-dyn-feed {
  display: block !important;
  position: relative;
  z-index: 2;
  width: min(1280px, calc(100% - 40px));
  min-height: 70vh;
  margin: 0 auto 96px;
  padding: 8px 0 0;
  box-sizing: border-box;
  background: var(--bx-bg);
}

#${NS}-dyn-title {
  color: var(--bx-muted);
  font-size: 13px;
  letter-spacing: 0.08em;
  margin: 0 0 18px;
}

#${NS}-dyn-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 18px 14px;
}

@media (max-width: 1200px) {
  #${NS}-dyn-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  #${NS}-dyn-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  #${NS}-dyn-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.${NS}-card {
  display: block;
  text-decoration: none !important;
  color: inherit;
  border-radius: var(--bx-radius);
  overflow: hidden;
  background: transparent;
  transition: transform .2s ease;
}

.${NS}-card:hover {
  transform: translateY(-2px);
}

.${NS}-card-cover {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 10px;
  overflow: hidden;
  background: #1a1f2a;
}

.${NS}-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.${NS}-card-meta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 8px 8px 6px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #fff;
  background: linear-gradient(transparent, rgba(0,0,0,0.72));
}

.${NS}-card-title {
  margin: 8px 2px 4px;
  font-size: 14px;
  line-height: 1.4;
  color: var(--bx-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.8em;
}

.${NS}-card-sub {
  margin: 0 2px;
  font-size: 12px;
  color: var(--bx-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#${NS}-dyn-status {
  text-align: center;
  color: var(--bx-muted);
  font-size: 13px;
  padding: 28px 0 8px;
}

/* ========== VIDEO ========== */
body.${NS}-video {
  overflow-x: hidden !important;
}

body.${NS}-video .bili-header,
body.${NS}-video .bili-header__bar {
  display: none !important;
}

body.${NS}-video .ad-report,
body.${NS}-video .video-page-special-card,
body.${NS}-video .activity-m-v1,
body.${NS}-video .banner-card-v2-container,
body.${NS}-video .video-card-ad-wrap,
body.${NS}-video .slide-ad-exp,
body.${NS}-video .pop-live-small-mode,
body.${NS}-video .fixed-sidenav-storage,
body.${NS}-video .palette-button-outer,
body.${NS}-video .reply-notice,
body.${NS}-video .video-page-game-card-small,
body.${NS}-video .adblock-tips {
  display: none !important;
}

#${NS}-video-stage {
  position: relative;
  width: 100%;
  height: 100vh;
  min-height: 100vh;
  background: #000;
  z-index: 5;
}

body.${NS}-video #${NS}-video-stage #bilibili-player,
body.${NS}-video #${NS}-video-stage .bpx-player-container,
body.${NS}-video #${NS}-video-stage .player-wrap,
body.${NS}-video #${NS}-video-stage #playerWrap {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  border-radius: 0 !important;
}

body.${NS}-video #bilibili-player,
body.${NS}-video .bpx-player-container {
  width: 100% !important;
  height: 100% !important;
}

body.${NS}-video .bpx-player-video-area,
body.${NS}-video .bpx-player-primary-area,
body.${NS}-video .bpx-player-video-wrap {
  width: 100% !important;
  height: 100% !important;
}

#${NS}-video-scroll-hint {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 8;
  color: rgba(255,255,255,0.72);
  font-size: 12px;
  letter-spacing: 0.14em;
  pointer-events: none;
  animation: ${NS}-hint 2.2s ease-in-out infinite;
}

#${NS}-video-below {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.7fr);
  gap: 28px;
  width: min(1280px, calc(100% - 48px));
  margin: 0 auto;
  padding: 36px 0 96px;
  box-sizing: border-box;
}

@media (max-width: 960px) {
  #${NS}-video-below { grid-template-columns: 1fr; }
}

#${NS}-video-left,
#${NS}-video-right {
  min-width: 0;
}

body.${NS}-video .video-info-container,
body.${NS}-video #viewbox_report,
body.${NS}-video .video-desc-container,
body.${NS}-video .up-panel-container,
body.${NS}-video #comment,
body.${NS}-video #commentapp {
  width: 100% !important;
  max-width: none !important;
  background: transparent !important;
  color: var(--bx-text) !important;
}

body.${NS}-video .video-title,
body.${NS}-video .video-info-title,
body.${NS}-video h1 {
  color: var(--bx-text) !important;
  font-family: var(--bx-font) !important;
}

body.${NS}-video .recommend-list-v1,
body.${NS}-video .right-container,
body.${NS}-video #reco_list {
  width: 100% !important;
  max-width: none !important;
  position: static !important;
  top: auto !important;
}

body.${NS}-video .video-page-card-small,
body.${NS}-video .video-page-operator-card-small {
  background: var(--bx-bg-soft) !important;
  border-radius: 12px !important;
  overflow: hidden !important;
  margin-bottom: 12px !important;
}
`;

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------
  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function waitFor(selector, timeout = 15000) {
    return new Promise((resolve) => {
      const found = qs(selector);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = qs(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve(qs(selector));
      }, timeout);
    });
  }

  function pathOf(url) {
    try {
      return new URL(url || location.href).pathname;
    } catch {
      return location.pathname;
    }
  }

  function detectRoute(pathname) {
    const p = pathname || pathOf();
    if (p === "/" || p === "/index.html") return "home";
    if (/^\/video\//.test(p)) return "video";
    if (/^\/search/.test(p) || /^\/s\//.test(p)) return "search";
    return "other";
  }

  function setBodyRoute(route) {
    document.documentElement.classList.add(`${NS}-on`);
    document.body && document.body.classList.add(`${NS}-on`);
    ["home", "video", "search", "other"].forEach((r) => {
      document.documentElement.classList.toggle(`${NS}-${r}`, r === route);
      document.body && document.body.classList.toggle(`${NS}-${r}`, r === route);
    });
    STATE.route = route;
  }

  function ensureStyle() {
    if (STATE.styleReady) return;
    STATE.styleReady = true;
    if (typeof GM_addStyle === "function") {
      GM_addStyle(CSS);
    } else {
      const style = document.createElement("style");
      style.id = `${NS}-style`;
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatCount(n) {
    const num = Number(n) || 0;
    if (num >= 10000) return (num / 10000).toFixed(num >= 100000 ? 0 : 1) + "万";
    return String(num);
  }

  // ---------------------------------------------------------------------------
  // Search: kill history / hot / related + default keyword placeholder
  // ---------------------------------------------------------------------------
  function sanitizeSearch() {
    const input = qs(".nav-search-input, input#nav-searchform, #nav-searchform input");
    if (input) {
      input.setAttribute("placeholder", "搜索");
      input.removeAttribute("data-default");
      // stop site from writing hot words into placeholder
      if (!input.dataset.bxPlaceholderLock) {
        input.dataset.bxPlaceholderLock = "1";
        const lock = () => {
          if (input.placeholder && input.placeholder !== "搜索") {
            input.placeholder = "搜索";
          }
        };
        const obs = new MutationObserver(lock);
        obs.observe(input, { attributes: true, attributeFilter: ["placeholder"] });
        setInterval(lock, 1500);
      }
    }

    // remove panels if they get injected despite CSS
    qsa(
      [
        ".search-panel",
        ".nav-search-panel",
        ".header-search-suggest",
        ".search-panel-container",
        ".suggest-wrap",
        "[class*='search-panel']",
      ].join(",")
    ).forEach((el) => {
      if (el && document.body.classList.contains(`${NS}-home`)) {
        el.style.setProperty("display", "none", "important");
        el.setAttribute("hidden", "true");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Following dynamics API
  // ---------------------------------------------------------------------------
  function apiGet(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          withCredentials: true,
          anonymous: false,
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: "https://www.bilibili.com/",
          },
          onload(res) {
            try {
              resolve(JSON.parse(res.responseText));
            } catch (e) {
              reject(e);
            }
          },
          onerror: reject,
        });
        return;
      }
      fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
      })
        .then((r) => r.json())
        .then(resolve)
        .catch(reject);
    });
  }

  function extractVideoFromDynItem(item) {
    if (!item || !item.modules) return null;
    const major =
      item.modules.module_dynamic && item.modules.module_dynamic.major;
    if (!major) return null;

    // direct archive
    let archive = major.archive || null;
    // forward
    if (!archive && major.type === "MAJOR_TYPE_NONE" && item.orig) {
      return extractVideoFromDynItem(item.orig);
    }
    if (!archive && item.type === "DYNAMIC_TYPE_FORWARD" && item.orig) {
      return extractVideoFromDynItem(item.orig);
    }
    // pgc / other
    if (!archive && major.pgc) {
      const p = major.pgc;
      return {
        bvid: p.bvid || "",
        aid: p.aid || "",
        title: p.title || "",
        cover: p.cover || "",
        duration: p.duration || "",
        play: (p.stat && p.stat.play) || "",
        danmaku: (p.stat && p.stat.danmaku) || "",
        author: (item.modules.module_author && item.modules.module_author.name) || "",
        pub: (item.modules.module_author && item.modules.module_author.pub_time) || "",
        href: p.jump_url || (p.bvid ? `https://www.bilibili.com/video/${p.bvid}` : "#"),
      };
    }
    if (!archive) return null;

    const author = item.modules.module_author || {};
    const href = archive.bvid
      ? `https://www.bilibili.com/video/${archive.bvid}`
      : archive.jump_url || "#";

    return {
      bvid: archive.bvid || "",
      aid: archive.aid || "",
      title: archive.title || "",
      cover: (archive.cover || "").replace(/^http:/, "https:"),
      duration: archive.duration_text || archive.duration || "",
      play: (archive.stat && (archive.stat.play || archive.stat.view)) || "",
      danmaku: (archive.stat && archive.stat.danmaku) || "",
      author: author.name || "",
      pub: author.pub_time || author.pub_ts || "",
      href,
    };
  }

  function ensureDynFeedDom() {
    let feed = document.getElementById(`${NS}-dyn-feed`);
    if (feed) return feed;

    feed = document.createElement("section");
    feed.id = `${NS}-dyn-feed`;
    feed.innerHTML = `
      <h2 id="${NS}-dyn-title">关注动态 · 视频</h2>
      <div id="${NS}-dyn-grid"></div>
      <div id="${NS}-dyn-status">加载中…</div>
    `;

    const hero = document.getElementById(`${NS}-home-hero`);
    if (hero && hero.parentElement) {
      hero.parentElement.insertBefore(feed, hero.nextSibling);
    } else {
      document.body.appendChild(feed);
    }
    return feed;
  }

  function appendCards(videos) {
    const grid = document.getElementById(`${NS}-dyn-grid`);
    if (!grid) return;
    const frag = document.createDocumentFragment();
    videos.forEach((v) => {
      if (!v || !v.href || v.href === "#") return;
      const a = document.createElement("a");
      a.className = `${NS}-card`;
      a.href = v.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML = `
        <div class="${NS}-card-cover">
          <img src="${escapeHtml(v.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
          <div class="${NS}-card-meta">
            <span>${escapeHtml(formatCount(v.play))} · ${escapeHtml(formatCount(v.danmaku))}</span>
            <span>${escapeHtml(v.duration)}</span>
          </div>
        </div>
        <div class="${NS}-card-title">${escapeHtml(v.title)}</div>
        <div class="${NS}-card-sub">${escapeHtml(v.author)}${v.pub ? " · " + escapeHtml(v.pub) : ""}</div>
      `;
      frag.appendChild(a);
    });
    grid.appendChild(frag);
  }

  function setDynStatus(text) {
    const el = document.getElementById(`${NS}-dyn-status`);
    if (el) el.textContent = text;
  }

  async function loadDynPage(reset) {
    if (STATE.dynLoading) return;
    if (!reset && !STATE.dynHasMore) return;

    STATE.dynLoading = true;
    setDynStatus(reset ? "加载关注动态…" : "加载更多…");

    if (reset) {
      STATE.dynOffset = "";
      STATE.dynHasMore = true;
      const grid = document.getElementById(`${NS}-dyn-grid`);
      if (grid) grid.innerHTML = "";
    }

    const params = new URLSearchParams({
      timezone_offset: "-480",
      type: "video",
      page: "1",
      features: "itemOpusStyle",
    });
    if (STATE.dynOffset) params.set("offset", STATE.dynOffset);

    const url =
      "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?" +
      params.toString();

    try {
      const json = await apiGet(url);
      if (!json || json.code !== 0) {
        const msg =
          (json && (json.message || json.msg)) ||
          "无法获取动态（请确认已登录）";
        setDynStatus(msg);
        STATE.dynLoading = false;
        return;
      }

      const data = json.data || {};
      const items = data.items || [];
      const videos = items.map(extractVideoFromDynItem).filter(Boolean);

      appendCards(videos);
      STATE.dynOffset = data.offset || "";
      STATE.dynHasMore = !!data.has_more;

      if (!document.getElementById(`${NS}-dyn-grid`).children.length) {
        setDynStatus("暂无关注视频动态");
      } else {
        setDynStatus(STATE.dynHasMore ? "继续下滑加载更多" : "没有更多了");
      }
    } catch (e) {
      console.error("[BilibiliX] dyn feed", e);
      setDynStatus("动态加载失败，请刷新重试");
    } finally {
      STATE.dynLoading = false;
    }
  }

  function onDynScroll() {
    if (STATE.route !== "home") return;
    if (!document.body.classList.contains(`${NS}-home-scrolled`)) return;
    const status = document.getElementById(`${NS}-dyn-status`);
    if (!status) return;
    const rect = status.getBoundingClientRect();
    if (rect.top < window.innerHeight + 200) {
      loadDynPage(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Home
  // ---------------------------------------------------------------------------
  function setupHome() {
    setBodyRoute("home");
    document.body.classList.add(`${NS}-home-hero`);
    document.body.classList.remove(`${NS}-home-scrolled`);
    STATE.homeHero = true;
    STATE.dynReady = false;

    let hero = document.getElementById(`${NS}-home-hero`);
    if (!hero) {
      hero = document.createElement("div");
      hero.id = `${NS}-home-hero`;
      hero.innerHTML = `<div id="${NS}-home-hint">向下滑动 · 关注动态</div>`;
      // attach to body so site feed wrappers can't collapse / whiten our layout
      document.body.insertBefore(hero, document.body.firstChild);
    } else {
      const hint = document.getElementById(`${NS}-home-hint`);
      if (hint) hint.textContent = "向下滑动 · 关注动态";
      if (hero.parentElement !== document.body) {
        document.body.insertBefore(hero, document.body.firstChild);
      }
    }

    ensureDynFeedDom();
    const feed = document.getElementById(`${NS}-dyn-feed`);
    if (feed && feed.parentElement !== document.body) {
      document.body.appendChild(feed);
    }
    if (feed && hero && feed.previousElementSibling !== hero) {
      document.body.insertBefore(feed, hero.nextSibling);
    }

    sanitizeSearch();

    // preload following feed immediately so page height allows scrolling
    if (!STATE.dynReady) {
      STATE.dynReady = true;
      loadDynPage(true);
    }

    const onScroll = () => {
      const scrolled = window.scrollY > Math.min(120, window.innerHeight * 0.12);
      STATE.homeHero = !scrolled;
      document.body.classList.toggle(`${NS}-home-hero`, !scrolled);
      document.body.classList.toggle(`${NS}-home-scrolled`, scrolled);
      onDynScroll();
      sanitizeSearch();
    };

    window.removeEventListener("scroll", window[`${NS}HomeScroll`]);
    window[`${NS}HomeScroll`] = onScroll;
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (window[`${NS}SearchObs`]) window[`${NS}SearchObs`].disconnect();
    const searchObs = new MutationObserver(() => sanitizeSearch());
    searchObs.observe(document.body, { childList: true, subtree: true });
    window[`${NS}SearchObs`] = searchObs;
  }

  function teardownHome() {
    window.removeEventListener("scroll", window[`${NS}HomeScroll`]);
    if (window[`${NS}SearchObs`]) {
      window[`${NS}SearchObs`].disconnect();
      window[`${NS}SearchObs`] = null;
    }
    const hero = document.getElementById(`${NS}-home-hero`);
    const feed = document.getElementById(`${NS}-dyn-feed`);
    if (hero) hero.remove();
    if (feed) feed.remove();
    document.body &&
      document.body.classList.remove(`${NS}-home-hero`, `${NS}-home-scrolled`);
    STATE.dynReady = false;
    STATE.dynOffset = "";
    STATE.dynHasMore = true;
  }

  // ---------------------------------------------------------------------------
  // Video
  // ---------------------------------------------------------------------------
  function findPlayerRoot() {
    return (
      qs("#bilibili-player") ||
      qs("#playerWrap") ||
      qs(".player-wrap") ||
      qs(".bpx-player-container")
    );
  }

  function setupVideoStage() {
    const player = findPlayerRoot();
    if (!player) return false;

    let stage = document.getElementById(`${NS}-video-stage`);
    if (!stage) {
      stage = document.createElement("div");
      stage.id = `${NS}-video-stage`;
      const hint = document.createElement("div");
      hint.id = `${NS}-video-scroll-hint`;
      hint.textContent = "向下滑动 · 详情与推荐";
      stage.appendChild(hint);
      player.parentElement.insertBefore(stage, player);
    }

    if (!stage.contains(player)) {
      stage.insertBefore(player, stage.firstChild);
    }

    player.style.width = "100%";
    player.style.height = "100%";
    return true;
  }

  function collectVideoBelow() {
    let below = document.getElementById(`${NS}-video-below`);
    if (!below) {
      below = document.createElement("div");
      below.id = `${NS}-video-below`;
      below.innerHTML = `<div id="${NS}-video-left"></div><div id="${NS}-video-right"></div>`;
      const stage = document.getElementById(`${NS}-video-stage`);
      if (stage && stage.parentElement) {
        stage.parentElement.insertBefore(below, stage.nextSibling);
      } else {
        document.body.appendChild(below);
      }
    }

    const left = document.getElementById(`${NS}-video-left`);
    const right = document.getElementById(`${NS}-video-right`);

    [
      qs(".video-info-container"),
      qs("#viewbox_report"),
      qs(".up-panel-container"),
      qs(".video-desc-container"),
      qs(".video-tag-container"),
      qs("#commentapp"),
      qs("#comment"),
      qs(".left-container-under-player"),
    ]
      .filter(Boolean)
      .forEach((el) => {
        if (!left.contains(el) && !el.closest(`#${NS}-video-right`)) {
          left.appendChild(el);
        }
      });

    [
      qs(".recommend-list-v1"),
      qs("#reco_list"),
      qs(".right-container-inner"),
      qs(".right-container"),
    ]
      .filter(Boolean)
      .forEach((el) => {
        if (el.classList.contains("right-container") && el.querySelector(`#${NS}-video-below`)) {
          return;
        }
        if (!right.contains(el) && !el.closest(`#${NS}-video-left`)) {
          right.appendChild(el);
        }
      });
  }

  async function tryAutoplay() {
    if (STATE.autoplayTried) return;
    STATE.autoplayTried = true;

    const tryPlayMedia = async () => {
      const media =
        qs("#bilibili-player video") ||
        qs(".bpx-player-video-wrap video") ||
        qs("bwp-video");
      if (!media) return false;
      try {
        media.muted = false;
        const p = media.play();
        if (p && typeof p.then === "function") await p;
        return !media.paused;
      } catch {
        try {
          media.muted = true;
          const p = media.play();
          if (p && typeof p.then === "function") await p;
          return !media.paused;
        } catch {
          return false;
        }
      }
    };

    const clickPlay = () => {
      const btn =
        qs(".bpx-player-ctrl-play") ||
        qs(".bpx-player-dm-btn-play") ||
        qs(".bilibili-player-video-btn-start") ||
        qs(".bpx-player-cover");
      if (btn) btn.click();
    };

    await waitFor("#bilibili-player, .bpx-player-container", 12000);
    await waitFor(
      "#bilibili-player video, .bpx-player-video-wrap video, bwp-video",
      12000
    );

    clickPlay();
    const ok = await tryPlayMedia();
    if (!ok) {
      setTimeout(async () => {
        clickPlay();
        await tryPlayMedia();
      }, 800);
    }
  }

  async function setupVideo() {
    setBodyRoute("video");
    STATE.autoplayTried = false;

    await waitFor(
      "#bilibili-player, #playerWrap, .player-wrap, .bpx-player-container",
      15000
    );

    if (!setupVideoStage()) return;

    collectVideoBelow();
    setTimeout(collectVideoBelow, 1000);
    setTimeout(collectVideoBelow, 2500);
    tryAutoplay();

    if (window[`${NS}VideoObs`]) window[`${NS}VideoObs`].disconnect();
    const obs = new MutationObserver(() => {
      if (STATE.route !== "video") return;
      setupVideoStage();
      collectVideoBelow();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window[`${NS}VideoObs`] = obs;
  }

  function teardownVideo() {
    if (window[`${NS}VideoObs`]) {
      window[`${NS}VideoObs`].disconnect();
      window[`${NS}VideoObs`] = null;
    }
    const stage = document.getElementById(`${NS}-video-stage`);
    const below = document.getElementById(`${NS}-video-below`);
    if (stage) stage.remove();
    if (below) below.remove();
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------
  function applyRoute() {
    if (!document.body) return;
    const route = detectRoute();

    if (route === "home") {
      teardownVideo();
      setupHome();
    } else if (route === "video") {
      teardownHome();
      setupVideo();
    } else if (route === "search") {
      teardownHome();
      teardownVideo();
      setBodyRoute("search");
      document.documentElement.classList.remove(`${NS}-on`);
      document.body.classList.remove(`${NS}-on`);
    } else {
      teardownHome();
      teardownVideo();
      setBodyRoute("other");
      document.documentElement.classList.remove(`${NS}-on`);
      document.body.classList.remove(`${NS}-on`);
    }
  }

  function watchSpa() {
    let last = location.href;
    const tick = () => {
      if (location.href !== last) {
        last = location.href;
        applyRoute();
      }
    };
    const wrap = (type) => {
      const raw = history[type];
      history[type] = function () {
        const ret = raw.apply(this, arguments);
        window.dispatchEvent(new Event(`${NS}-nav`));
        return ret;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", () =>
      window.dispatchEvent(new Event(`${NS}-nav`))
    );
    window.addEventListener(`${NS}-nav`, () => setTimeout(applyRoute, 50));
    setInterval(tick, 800);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  ensureStyle();

  function boot() {
    ensureStyle();
    applyRoute();
    watchSpa();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  const early = detectRoute();
  if (early === "home" || early === "video") {
    document.documentElement.classList.add(`${NS}-on`, `${NS}-${early}`);
  }
})();
