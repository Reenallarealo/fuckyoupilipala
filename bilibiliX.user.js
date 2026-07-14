// ==UserScript==
// @name         BilibiliX
// @namespace    https://github.com/local/bilibiliX
// @version      1.1.0
// @description  个人用 B 站：首页重设计 + 搜索页精简 + 视频页宽屏暗色 + 匿名模式（阻断观看上报）
// @author       you
// @match        *://www.bilibili.com/*
// @match        *://bilibili.com/*
// @match        *://search.bilibili.com/*
// @match        *://live.bilibili.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.bilibili.com
// ==/UserScript==

(function () {
  "use strict";

  const NS = "bx";

  // ---------------------------------------------------------------------------
  // Anti-FOUC：必须在巨型 CSS 字符串构建之前执行
  // ---------------------------------------------------------------------------
  function peekRoute() {
    const host = location.hostname || "";
    if (host === "search.bilibili.com" || /\.search\.bilibili\.com$/.test(host)) {
      return "search";
    }
    const path = location.pathname || "/";
    if (path === "/" || path === "/index.html") return "home";
    if (/^\/video\//.test(path)) return "video";
    if (/^\/search/.test(path) || /^\/s\//.test(path)) return "search";
    return "other";
  }

  function stampRouteClasses(route) {
    const themed = route === "home" || route === "video";
    const nodes = [document.documentElement];
    if (document.body) nodes.push(document.body);
    nodes.forEach((node) => {
      ["home", "video", "search", "other"].forEach((r) => {
        node.classList.toggle(`${NS}-${r}`, r === route);
      });
      node.classList.toggle(`${NS}-on`, themed);
    });
  }

  const BOOT_ROUTE = peekRoute();
  if (BOOT_ROUTE !== "other") {
    document.documentElement.classList.add(`${NS}-booting`);
    stampRouteClasses(BOOT_ROUTE);
    const crit = document.createElement("style");
    crit.id = `${NS}-critical`;
    crit.textContent = `
html.${NS}-booting {
  background: #0e1014 !important;
  color-scheme: dark;
}
html.${NS}-booting body {
  visibility: hidden !important;
  background: #0e1014 !important;
}
html.${NS}-search.${NS}-booting {
  background: #ffffff !important;
  color-scheme: light;
}
html.${NS}-search.${NS}-booting body {
  background: #ffffff !important;
}
html.${NS}-home .bili-header__banner,
html.${NS}-home .bili-header__channel,
html.${NS}-home .header-channel-fixed,
html.${NS}-home .recommended-container_floor-sticky,
html.${NS}-home .recommended-container,
html.${NS}-home .feed2,
html.${NS}-home .bili-feed4-layout,
html.${NS}-home .feed-card,
html.${NS}-video .bili-header .mini-header,
html.${NS}-video .bili-header__bar.mini-header,
html.${NS}-video .fixed-sidenav-storage,
html.${NS}-search .bili-header__bar,
html.${NS}-search .bili-header,
html.${NS}-search #bili-header-container,
html.${NS}-search .mini-header {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;
    document.documentElement.appendChild(crit);
    if (!document.body) {
      const mo = new MutationObserver(() => {
        if (document.body) {
          stampRouteClasses(BOOT_ROUTE);
          mo.disconnect();
        }
      });
      mo.observe(document.documentElement, { childList: true });
    }
  }

  const CONFIG = {
    homeBarH: 72,
    homeSearchH: 48,
    watchDebounce: 250,
    watchRetries: [400, 1200, 3000],
    dmRetries: [500, 1500, 3000],
    spaPollMs: 2500,
    bootFailsafeMs: 2500,
    anonStorageKey: `${NS}-anon-mode`,
    /** 匿名模式：只拦「写历史 / 写进度 / 推荐反馈」，不拦 view/playurl/reply */
    anonBlockPaths: [
      // heartbeat / history
      "/x/click-interface/web/heartbeat",
      "/x/click-interface/heartbeat",
      "/x/v2/history/report",
      "/x/v1/medialist/history",
      // live report
      "/xlive/web-room/v1/index/roomEntryAction",
      "/xlive/app-ucenter/v1/like_info_v3/like/likeReportV3",
      // recommend feedback
      "/x/feed/dislike",
      "/x/v2/feed/dislike",
    ],
    commentRoots:
      "bili-comments, #comment, #commentapp, .bili-comment, .reply-wrap",
  };

  const STATE = {
    route: "other",
    anonMode: false,
    autoplayTried: false,
    dynOffset: "",
    dynLoading: false,
    dynHasMore: true,
    scrollP: 0,
    scrollTarget: 0,
    rafHome: 0,
  };

  /** 运行时句柄（不挂 window） */
  const RUNTIME = {
    homeScroll: null,
    homeResize: null,
    playerRO: null,
    watchers: new Map(),
    anonHooked: false,
  };

  // ---------------------------------------------------------------------------
  // 匿名模式 A：尽早劫持网络，短路观看上报（须在巨型 CSS 构建前）
  // ---------------------------------------------------------------------------
  const ANON_FAKE_JSON = JSON.stringify({
    code: 0,
    message: "0",
    ttl: 1,
    data: {},
  });

  function readAnonMode() {
    try {
      if (typeof GM_getValue === "function") {
        return !!GM_getValue(CONFIG.anonStorageKey, false);
      }
    } catch (_) {}
    return false;
  }

  function writeAnonMode(on) {
    STATE.anonMode = !!on;
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(CONFIG.anonStorageKey, STATE.anonMode);
      }
    } catch (_) {}
    document.documentElement.classList.toggle(`${NS}-anon`, STATE.anonMode);
  }

  function resolveRequestUrl(input) {
    try {
      if (typeof input === "string") return new URL(input, location.href).href;
      if (input && typeof input.url === "string") {
        return new URL(input.url, location.href).href;
      }
    } catch (_) {}
    return String(input || "");
  }

  function isAnonBlockedUrl(url) {
    if (!STATE.anonMode || !url) return false;
    let path = "";
    let href = "";
    try {
      const u = new URL(url, location.href);
      path = u.pathname || "";
      href = u.href;
    } catch (_) {
      href = String(url);
      path = href;
    }
    return CONFIG.anonBlockPaths.some(
      (rule) => path.includes(rule) || href.includes(rule)
    );
  }

  function fakeAnonResponse() {
    return new Response(ANON_FAKE_JSON, {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json;charset=utf-8" },
    });
  }

  function installAnonNetworkHooks() {
    if (RUNTIME.anonHooked) return;
    RUNTIME.anonHooked = true;

    const rawFetch = window.fetch;
    if (typeof rawFetch === "function") {
      window.fetch = function bxAnonFetch(input, init) {
        const url = resolveRequestUrl(input);
        if (isAnonBlockedUrl(url)) {
          return Promise.resolve(fakeAnonResponse());
        }
        return rawFetch.apply(this, arguments);
      };
    }

    const xhrProto = XMLHttpRequest.prototype;
    const rawOpen = xhrProto.open;
    const rawSend = xhrProto.send;
    xhrProto.open = function bxAnonXhrOpen(method, url) {
      try {
        this[`${NS}AnonUrl`] = resolveRequestUrl(url);
      } catch (_) {
        this[`${NS}AnonUrl`] = String(url || "");
      }
      return rawOpen.apply(this, arguments);
    };
    xhrProto.send = function bxAnonXhrSend(body) {
      if (!isAnonBlockedUrl(this[`${NS}AnonUrl`])) {
        return rawSend.apply(this, arguments);
      }
      const xhr = this;
      const finish = () => {
        try {
          Object.defineProperty(xhr, "readyState", {
            configurable: true,
            get: () => 4,
          });
          Object.defineProperty(xhr, "status", {
            configurable: true,
            get: () => 200,
          });
          Object.defineProperty(xhr, "statusText", {
            configurable: true,
            get: () => "OK",
          });
          Object.defineProperty(xhr, "responseText", {
            configurable: true,
            get: () => ANON_FAKE_JSON,
          });
          Object.defineProperty(xhr, "response", {
            configurable: true,
            get: () => ANON_FAKE_JSON,
          });
          Object.defineProperty(xhr, "responseURL", {
            configurable: true,
            get: () => String(xhr[`${NS}AnonUrl`] || ""),
          });
        } catch (_) {}
        try {
          if (typeof xhr.onreadystatechange === "function") {
            xhr.onreadystatechange(new Event("readystatechange"));
          }
        } catch (_) {}
        try {
          xhr.dispatchEvent(new Event("readystatechange"));
        } catch (_) {}
        try {
          if (typeof xhr.onload === "function") {
            xhr.onload(new Event("load"));
          }
        } catch (_) {}
        try {
          xhr.dispatchEvent(new Event("load"));
        } catch (_) {}
        try {
          xhr.dispatchEvent(new Event("loadend"));
        } catch (_) {}
      };
      queueMicrotask(finish);
    };
  }

  function syncAnonTitle() {
    try {
      const raw = document.title.replace(/^\[匿名\]\s*/, "");
      document.title = STATE.anonMode ? `[匿名] ${raw}` : raw;
    } catch (_) {}
  }

  function registerAnonMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("切换匿名模式（阻断观看上报）", () => {
      writeAnonMode(!STATE.anonMode);
      try {
        console.info(
          `[BilibiliX] 匿名模式 ${STATE.anonMode ? "已开启" : "已关闭"}` +
            "（不写历史/进度；点赞投币等主动互动仍会影响推荐）"
        );
      } catch (_) {}
      syncAnonTitle();
    });
  }

  STATE.anonMode = readAnonMode();
  if (STATE.anonMode) {
    document.documentElement.classList.add(`${NS}-anon`);
  }
  installAnonNetworkHooks();
  registerAnonMenu();

  /** 仅对评论相关自定义元素强制 open shadow，避免影响全站 */
  const COMMENT_SHADOW_HOST_RE =
    /^(bili-comments|bili-comment-|bili-rich-text|bili-text-button|bili-checkbox|bili-icon)/i;

  function isCommentShadowHost(el) {
    const name = (el && el.tagName ? el.tagName : "").toLowerCase();
    return (
      name === "bili-comments" ||
      name.startsWith("bili-comment") ||
      COMMENT_SHADOW_HOST_RE.test(name)
    );
  }

  try {
    const rawAttach = Element.prototype.attachShadow;
    if (!rawAttach[`${NS}Patched`]) {
      Element.prototype.attachShadow = function attachShadow(init) {
        const open = isCommentShadowHost(this);
        const root = rawAttach.call(
          this,
          open ? { ...init, mode: "open" } : init
        );
        if (open && STATE.route === "video") {
          queueMicrotask(() => injectCommentShadowStyle(root));
        }
        return root;
      };
      Element.prototype.attachShadow[`${NS}Patched`] = true;
    }
  } catch (_) {}

  /** 表驱动隐藏：selectors 已含完整前缀 */
  function cssHide(selectors, mode) {
    const soft = `  display: none !important;`;
    const hard = `  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
  background: transparent !important;`;
    const sticky = `  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
  box-shadow: none !important;`;
    const body =
      mode === "hard" ? hard : mode === "sticky" ? sticky : soft;
    return `${selectors.join(",\n")} {\n${body}\n}`;
  }

  function both(route, sels) {
    const out = [];
    sels.forEach((s) => {
      out.push(`html.${NS}-${route} ${s}`);
      out.push(`body.${NS}-${route} ${s}`);
    });
    return out;
  }

  function bodyOnly(route, sels) {
    return sels.map((s) => `body.${NS}-${route} ${s}`);
  }

  const CSS_HIDE_SEARCH = [
    cssHide(
      both("search", [
        ".bili-header__bar.mini-header",
        ".bili-header__bar",
        ".mini-header",
        "#bili-header-container",
        ".bili-header",
      ]),
      "hard"
    ),
    cssHide(
      both("search", [
        "#bili-header-container .vui_button.vui_button--active-shrink",
        ".bili-header .vui_button.vui_button--active-shrink",
        ".bili-header__bar .vui_button.vui_button--active-shrink",
      ]),
      "soft"
    ),
    cssHide(
      both("search", [".bili-footer", "footer.bili-footer"]),
      "hard"
    ),
    cssHide(
      both("search", [
        ".search-fixed-header",
        ".search-sticky-header",
        ".search-input-container .search-fixed-header",
      ]),
      "sticky"
    ),
  ].join("\n\n");

  const CSS_HIDE_HOME = [
    cssHide(
      both("home", [
        ".bili-header__banner",
        ".bili-header__channel",
        ".header-channel-fixed",
        ".banner-card",
        ".ad-report",
        ".palette-button-outer",
        ".fixed-sidenav-storage",
        ".download-client-entry",
        ".left-entry",
        ".right-entry",
        ".vip-wrap",
        ".locale-item",
        ".channel-icons",
        ".header-channel",
      ]),
      "soft"
    ),
    cssHide(
      both("home", [
        ".recommended-container_floor-sticky",
        ".recommended-container",
        ".feed2",
        ".container.is-version8",
        ".feed-card",
        ".bili-feed4-layout",
        ".feed2-container",
        ".homepage-feed",
        ".feed2-wrap",
        "main > .feed2",
        ".bili-layout",
        ".bili-grid",
      ]),
      "hard"
    ),
    cssHide(
      both("home", [
        ".search-panel",
        ".nav-search-panel",
        ".header-search-suggest",
        ".search-panel-container",
        ".suggestions",
        ".suggest-wrap",
        ".history",
        ".history-wrap",
        ".trending",
        ".trending-list",
        ".search-trending",
        ".search-history",
        ".i_wrapper.search-panel",
        '[class*="search-panel"]',
        '[class*="SearchPanel"]',
        ".nav-search .popover",
        ".center-search-container .popover",
        ".search-component-popover",
        ".bili-header .search-panel",
      ]),
      "sticky"
    ),
  ].join("\n\n");

  const CSS_HIDE_VIDEO_CHROME = [
    cssHide(
      both("video", [
        ".ad-report",
        ".ad-feedback-menu-reference",
        ".video-page-special-card",
        ".activity-m-v1",
        ".banner-card-v2-container",
        ".video-card-ad-wrap",
        ".slide-ad-exp",
        ".pop-live-small-mode",
        ".video-page-game-card-small",
        ".adblock-tips",
        ".bpx-player-top-left",
        ".bpx-player-top-issue",
        ".video-toolbar-right",
        ".bili-comments-bottom-fixed-wrapper",
        ".fixed-reply-box",
        ".reply-box.fixed",
        ".main-reply-box.fixed",
      ]),
      "soft"
    ),
    cssHide(
      both("video", [
        ".fixed-sidenav-storage",
        ".fixed-sidenav-storage-item",
        ".palette-button-outer",
        ".palette-button-wrap",
        ".back-to-top",
        ".vip-report-container",
        ".customer-service",
        '[class*="fixed-sidenav"]',
      ]),
      "sticky"
    ),
  ].join("\n\n");

  // 新版评论区 Shadow DOM：只藏「随屏固定」输入条，页面内输入区保持原样
  // 参考 Evolved：.bili-comments-bottom-fixed-wrapper
  const COMMENT_SHADOW_CSS = `
:host(bili-comments-header-renderer) .bili-comments-bottom-fixed-wrapper {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  height: 0 !important;
  overflow: hidden !important;
}
`;

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  const CSS = `
:root {
  --bx-bg: #0e1014;
  --bx-bg-soft: #161a22;
  --bx-text: #e8eaef;
  --bx-muted: #8b93a7;
  --bx-accent: #00a1d6;
  --bx-line: rgba(255,255,255,0.08);
  --bx-radius: 14px;
  --bx-font: "Outfit", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  --bx-home-bar-h: ${CONFIG.homeBarH}px;
  --bx-home-search-h: ${CONFIG.homeSearchH}px;
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

/* 首页隐藏：顶栏杂讯 / 推荐流 / 热搜（表驱动） */
${CSS_HIDE_HOME}

body.${NS}-home .bili-header {
  position: relative !important;
  z-index: 1 !important;
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: visible !important;
  pointer-events: none !important;
}

/* original header bar hidden — search lives in #bx-search-host */
body.${NS}-home .bili-header__bar {
  display: none !important;
}

/* ========== custom centered search host ========== */
#${NS}-search-host {
  position: fixed !important;
  left: 50% !important;
  top: 42vh !important;
  right: auto !important;
  bottom: auto !important;
  transform: translateX(-50%) !important;
  width: min(640px, 86vw) !important;
  max-width: 640px !important;
  margin: 0 !important;
  z-index: 2147483000 !important;
  pointer-events: none !important;
  will-change: top, width;
}

#${NS}-search-host #nav-searchform,
#${NS}-search-host .center-search-container {
  pointer-events: auto;
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
}

#${NS}-search-backdrop {
  position: fixed !important;
  left: 0 !important;
  right: 0 !important;
  top: 0 !important;
  height: var(--bx-home-bar-h) !important;
  z-index: 2147482900 !important;
  pointer-events: none !important;
  background: rgba(14,16,20,0);
  backdrop-filter: blur(0px);
  border-bottom: 1px solid transparent;
}

#${NS}-search-backdrop.${NS}-show {
  background: rgba(14,16,20,0.88);
  border-bottom-color: var(--bx-line);
  backdrop-filter: blur(12px);
}

body.${NS}-home .center-search-container {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  position: relative !important;
  left: auto !important;
  right: auto !important;
  flex: none !important;
  width: 100% !important;
}

body.${NS}-home #nav-searchform {
  position: relative !important;
  display: flex !important;
  align-items: center !important;
  width: 100% !important;
  height: var(--bx-home-search-h) !important;
  padding: 0 6px 0 18px !important;
  box-sizing: border-box !important;
  background: var(--bx-bg-soft) !important;
  background-color: var(--bx-bg-soft) !important;
  border: 1px solid var(--bx-line) !important;
  border-radius: 999px !important;
  box-shadow: 0 12px 40px rgba(0,0,0,0.35) !important;
  left: auto !important;
  right: auto !important;
  margin: 0 !important;
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
body.${NS}-home #nav-searchform > .nav-search-content,
body.${NS}-home .nav-search-input,
body.${NS}-home input.nav-search-input {
  background: transparent !important;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  outline: none !important;
  position: static !important;
}

body.${NS}-home .nav-search-content {
  flex: 1 1 auto !important;
  display: flex !important;
  align-items: center !important;
  min-width: 0 !important;
  height: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
}

body.${NS}-home .nav-search-input,
body.${NS}-home input.nav-search-input {
  color: var(--bx-text) !important;
  caret-color: var(--bx-accent) !important;
  font-size: 16px !important;
  font-family: var(--bx-font) !important;
  flex: 1 1 auto !important;
  width: 100% !important;
  height: 100% !important;
  -webkit-text-fill-color: var(--bx-text) !important;
  padding: 0 !important;
  margin: 0 !important;
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

/* flatten absolute icons that cause overlap */
body.${NS}-home .nav-search-btn,
body.${NS}-home .nav-search-button,
body.${NS}-home #nav-searchform .nav-search-btn,
body.${NS}-home .nav-search-clean,
body.${NS}-home .nav-search-clear,
body.${NS}-home .clear-icon,
body.${NS}-home .search-clear {
  position: static !important;
  left: auto !important;
  right: auto !important;
  top: auto !important;
  transform: none !important;
  margin: 0 0 0 4px !important;
  flex: 0 0 auto !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 36px !important;
  height: 36px !important;
  min-width: 36px !important;
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 999px !important;
  color: var(--bx-muted) !important;
}

body.${NS}-home .nav-search-btn:hover,
body.${NS}-home .nav-search-button:hover {
  background: rgba(255,255,255,0.06) !important;
  color: var(--bx-text) !important;
}

/* hide decorative / duplicate trailing icons except clear + search */
body.${NS}-home #nav-searchform .nav-search-img,
body.${NS}-home #nav-searchform img.nav-search-img,
body.${NS}-home #nav-searchform .bili-icon-search-activity {
  display: none !important;
}

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
    radial-gradient(ellipse 70% 50% at 50% 42%, rgba(0,161,214,0.12), transparent 70%),
    var(--bx-bg);
  transition: none;
}

#${NS}-home-hint {
  color: var(--bx-muted);
  font-size: 13px;
  letter-spacing: 0.12em;
  opacity: 0.85;
  animation: ${NS}-hint 2.2s ease-in-out infinite;
  transition: opacity .2s ease;
}

@keyframes ${NS}-hint {
  0%, 100% { transform: translateY(0); opacity: 0.55; }
  50% { transform: translateY(6px); opacity: 1; }
}

/* always in document flow so the page can actually scroll */
#${NS}-dyn-feed {
  display: block !important;
  position: relative !important;
  z-index: 2 !important;
  width: min(860px, calc(100% - 40px)) !important;
  max-width: 860px !important;
  min-height: 70vh !important;
  margin: 0 auto 120px !important;
  padding: 88px 0 0 !important;
  box-sizing: border-box !important;
  background: var(--bx-bg) !important;
  opacity: 1 !important;
  transform: none !important;
}

#${NS}-dyn-title {
  color: var(--bx-muted) !important;
  font-size: 13px !important;
  letter-spacing: 0.08em !important;
  margin: 0 0 18px !important;
}

/* FORCE single-column list — override any leftover grid rules */
#${NS}-dyn-grid,
#${NS}-dyn-feed #${NS}-dyn-grid {
  display: flex !important;
  flex-direction: column !important;
  flex-wrap: nowrap !important;
  grid-template-columns: none !important;
  grid-auto-flow: row !important;
  gap: 12px !important;
  width: 100% !important;
}

#${NS}-dyn-grid > *,
#${NS}-dyn-grid > .${NS}-card {
  width: 100% !important;
  max-width: 100% !important;
  grid-column: auto !important;
}

.${NS}-card,
a.${NS}-card {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: center !important;
  gap: 18px !important;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  text-decoration: none !important;
  color: inherit !important;
  padding: 10px 12px !important;
  margin: 0 !important;
  border-radius: 14px !important;
  background: rgba(255,255,255,0.03) !important;
  border: 1px solid rgba(255,255,255,0.06) !important;
  float: none !important;
}

.${NS}-card:hover {
  background: rgba(255,255,255,0.055) !important;
  border-color: rgba(0,161,214,0.35) !important;
}

.${NS}-card-cover {
  position: relative !important;
  flex: 0 0 220px !important;
  width: 220px !important;
  min-width: 220px !important;
  max-width: 220px !important;
  height: auto !important;
  aspect-ratio: 16 / 10 !important;
  border-radius: 10px !important;
  overflow: hidden !important;
  background: #1a1f2a !important;
}

.${NS}-card-cover img {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  display: block !important;
}

.${NS}-card-meta {
  position: absolute !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  padding: 6px 8px !important;
  display: flex !important;
  justify-content: space-between !important;
  gap: 8px !important;
  font-size: 11px !important;
  color: #fff !important;
  background: linear-gradient(transparent, rgba(0,0,0,0.72)) !important;
}

.${NS}-card-body {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  gap: 8px !important;
  padding: 4px 8px 4px 0 !important;
}

.${NS}-card-title {
  margin: 0 !important;
  font-size: 17px !important;
  font-weight: 600 !important;
  line-height: 1.45 !important;
  color: var(--bx-text) !important;
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  white-space: normal !important;
}

.${NS}-card-up,
.${NS}-card-time {
  margin: 0 !important;
  font-size: 13px !important;
  color: var(--bx-muted) !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

.${NS}-card-up {
  color: #a8b0c2 !important;
}

@media (max-width: 640px) {
  .${NS}-card-cover {
    flex-basis: 132px !important;
    width: 132px !important;
    min-width: 132px !important;
    max-width: 132px !important;
  }
  .${NS}-card-title { font-size: 15px !important; }
}

#${NS}-dyn-status {
  text-align: center !important;
  color: var(--bx-muted) !important;
  font-size: 13px !important;
  padding: 28px 0 8px !important;
}

/* ========== SEARCH：顶栏 / 页脚 / 吸顶搜索（表驱动） ========== */
${CSS_HIDE_SEARCH}

/* ========== VIDEO：原版结构 + 宽屏 + 暗色（参考 Evolved：body.dark + 变量 + 白底补丁） ========== */
html.${NS}-video,
body.${NS}-video,
html.${NS}-video.dark,
body.${NS}-video.dark {
  --bx-layout-padding: 30px;
  --bx-navbar-height: 64px;
  --bx-reserve-height: 0px;
  --bx-player-height: calc(100vh - var(--bx-reserve-height));
  --bx-player-height-record: var(--bx-player-height);
  --bx-panel: #1c1d21;
  --bx-panel-2: #23252b;
  --bx-border: rgba(255,255,255,0.08);

  /* 对齐官方设计 token，让新版组件跟着变暗 */
  --bg1: #17181a !important;
  --bg2: #1f2022 !important;
  --bg3: #2a2b2e !important;
  --Wh0: #17181a !important;
  --Wh0_u: #17181a !important;
  --Ga0: #0d0d0e !important;
  --Ga1: #141516 !important;
  --Ga2: #1c1d1f !important;
  --Ga3: #232527 !important;
  --Ga4: #2f3134 !important;
  --Ga5: #3f4145 !important;
  --Ga7: #7a818b !important;
  --Ga8: #9499a0 !important;
  --Ga10: #e7e9eb !important;
  --text1: #e7e9eb !important;
  --text2: #a2a7ae !important;
  --text3: #7a818b !important;
  --text_white: #ffffff !important;
  --line_light: rgba(255,255,255,0.08) !important;
  --line_regular: rgba(255,255,255,0.12) !important;
  --graph_bg_thin: #2a2b2e !important;
  --graph_bg_regular: #232527 !important;
  --graph_bg_thick: #3f4145 !important;
  --graph_white: #2a2b2e !important;
  --brand_blue: #00a1d6 !important;
  color-scheme: dark !important;
  background: #0e1014 !important;
  color: #e7e9eb !important;
}

/* 删除顶栏 */
body.${NS}-video .bili-header__bar.mini-header,
body.${NS}-video .bili-header__bar,
body.${NS}-video .mini-header {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
}

body.${NS}-video #biliMainHeader,
body.${NS}-video .bili-header {
  margin-top: var(--bx-player-height-record) !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  pointer-events: none !important;
}

/* 页面容器 */
body.${NS}-video #app,
body.${NS}-video .video-container-v1,
body.${NS}-video .left-container,
body.${NS}-video .right-container,
body.${NS}-video .plp-l,
body.${NS}-video .plp-r {
  background: transparent !important;
  background-color: transparent !important;
}

body.${NS}-video .video-container-v1 {
  display: flex !important;
  align-items: flex-start !important;
  gap: 28px !important;
}

/* 标题强制可见 */
body.${NS}-video .video-title,
body.${NS}-video .video-info-title,
body.${NS}-video h1,
body.${NS}-video #viewbox_report h1,
body.${NS}-video .tit,
body.${NS}-video .first-line-title {
  color: #f1f2f3 !important;
  opacity: 1 !important;
  visibility: visible !important;
  display: block !important;
  height: auto !important;
  max-height: none !important;
  font-size: 22px !important;
  line-height: 1.4 !important;
  white-space: normal !important;
  -webkit-line-clamp: unset !important;
}

body.${NS}-video .video-data span,
body.${NS}-video .video-info-detail,
body.${NS}-video .video-info-detail-list,
body.${NS}-video .copyright,
body.${NS}-video .pubdate,
body.${NS}-video .up-name,
body.${NS}-video .up-description,
body.${NS}-video .desc-info,
body.${NS}-video .desc-info-text {
  color: #a2a7ae !important;
}

/* —— 白底组件全面压暗 —— */
body.${NS}-video .tag-panel .tag,
body.${NS}-video .video-tag-container .tag-link,
body.${NS}-video .tag-panel a,
body.${NS}-video .s_tag .tag-item,
body.${NS}-video .s_tag a {
  background: var(--bx-panel-2) !important;
  color: #c9cdd4 !important;
  border-color: var(--bx-border) !important;
}

/* 下方独立弹幕发送条：整段隐藏 */
body.${NS}-video .bpx-player-sending-area {
  display: none !important;
  height: 0 !important;
  max-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  border: none !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 只加高可拖进度条（好点），按钮 / 高能图保持原样 */
body.${NS}-video .bpx-player-progress {
  height: 20px !important;
  min-height: 20px !important;
  padding: 7px 0 !important;
  box-sizing: border-box !important;
  display: flex !important;
  align-items: center !important;
  cursor: pointer !important;
}

body.${NS}-video .bpx-player-progress .bui-track,
body.${NS}-video .bpx-player-progress .bui-track-video-progress,
body.${NS}-video .bpx-player-progress .bui-bar-wrap,
body.${NS}-video .bpx-player-progress .bui-bar,
body.${NS}-video .bpx-player-progress-schedule,
body.${NS}-video .bpx-player-progress-schedule-wrap {
  height: 6px !important;
  min-height: 6px !important;
}

body.${NS}-video .bpx-player-progress .bui-thumb,
body.${NS}-video .bpx-player-progress .bui-dot {
  width: 14px !important;
  height: 14px !important;
}

/* 底栏三区：下方留弹性空白，避免贴底 */
body.${NS}-video .bpx-player-control-bottom {
  display: flex !important;
  align-items: center !important;
  min-height: 46px !important;
  gap: 4px !important;
  padding-bottom: clamp(10px, 1.4vh, 18px) !important;
  box-sizing: border-box !important;
}

body.${NS}-video .bpx-player-control-bottom-left {
  display: flex !important;
  align-items: center !important;
  flex: 0 0 auto !important;
  min-width: auto !important;
  gap: 2px !important;
}

body.${NS}-video .bpx-player-control-bottom-center {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex: 1 1 auto !important;
  min-width: 0 !important;
  padding: 0 8px !important;
  overflow: hidden !important;
}

body.${NS}-video .bpx-player-control-bottom-right {
  display: flex !important;
  align-items: center !important;
  flex: 0 0 auto !important;
  min-width: auto !important;
}

/* 左侧：弹幕设置 + 弹幕开关（从下方发送区挪来） */
body.${NS}-video #${NS}-dm-ctrl-host {
  display: inline-flex !important;
  align-items: center !important;
  flex: 0 0 auto !important;
  gap: 2px !important;
  margin-left: 6px !important;
  height: 32px !important;
}

body.${NS}-video #${NS}-dm-ctrl-host .bpx-player-dm-setting,
body.${NS}-video #${NS}-dm-ctrl-host .bpx-player-dm-switch,
body.${NS}-video #${NS}-dm-ctrl-host .bpx-player-ctrl-btn,
body.${NS}-video #${NS}-dm-ctrl-host .bui-button,
body.${NS}-video #${NS}-dm-ctrl-host > * {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  visibility: visible !important;
  opacity: 1 !important;
  width: 32px !important;
  min-width: 32px !important;
  max-width: 40px !important;
  height: 32px !important;
  margin: 0 !important;
  padding: 0 !important;
  flex: 0 0 32px !important;
  position: relative !important;
  overflow: visible !important;
  font-size: 0 !important;
  color: #fff !important;
  fill: #fff !important;
}

body.${NS}-video #${NS}-dm-ctrl-host svg,
body.${NS}-video #${NS}-dm-ctrl-host .bpx-common-svg-icon,
body.${NS}-video #${NS}-dm-ctrl-host .bui-switch,
body.${NS}-video #${NS}-dm-ctrl-host i {
  width: 22px !important;
  height: 22px !important;
  max-width: 22px !important;
  max-height: 22px !important;
  font-size: 18px !important;
  transform: none !important;
  scale: 1 !important;
}

/* 中间：单层输入条（不再套整颗 inputbar，避免双胶囊 + 大 A） */
body.${NS}-video #${NS}-dm-send-host {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: center !important;
  flex: 1 1 auto !important;
  min-width: 160px !important;
  max-width: 380px !important;
  width: min(380px, 32vw) !important;
  height: 30px !important;
  max-height: 30px !important;
  margin: 0 auto !important;
  padding: 0 4px 0 12px !important;
  gap: 6px !important;
  overflow: hidden !important;
  position: relative !important;
  z-index: 6 !important;
  pointer-events: auto !important;
  box-sizing: border-box !important;
  background: rgba(20, 22, 26, 0.9) !important;
  border: 1px solid rgba(255,255,255,0.16) !important;
  border-radius: 6px !important;
  box-shadow: none !important;
}

body.${NS}-video #${NS}-dm-send-host::before,
body.${NS}-video #${NS}-dm-send-host::after {
  content: none !important;
  display: none !important;
}

/* 宿主内只应有 input + 发送；其它一律干掉占位 */
body.${NS}-video #${NS}-dm-send-host > :not(input):not(textarea):not(.bpx-player-dm-btn-send):not(.bpx-player-video-btn-dm-send):not(button.bpx-player-dm-btn-send) {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  position: absolute !important;
  left: -9999px !important;
}

body.${NS}-video #${NS}-dm-send-host input,
body.${NS}-video #${NS}-dm-send-host textarea,
body.${NS}-video #${NS}-dm-send-host .bpx-player-dm-input {
  display: block !important;
  flex: 1 1 auto !important;
  min-width: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  outline: none !important;
  background: transparent !important;
  box-shadow: none !important;
  color: #fff !important;
  caret-color: #00a1d6 !important;
  font-size: 13px !important;
  line-height: 30px !important;
  text-align: left !important;
  text-indent: 0 !important;
  letter-spacing: normal !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  position: static !important;
  left: auto !important;
  transform: none !important;
}

body.${NS}-video #${NS}-dm-send-host input::placeholder,
body.${NS}-video #${NS}-dm-send-host textarea::placeholder,
body.${NS}-video #${NS}-dm-send-host .bpx-player-dm-input::placeholder {
  color: rgba(255,255,255,0.5) !important;
  text-align: left !important;
  text-indent: 0 !important;
}

body.${NS}-video #${NS}-dm-send-host .bpx-player-dm-btn-send,
body.${NS}-video #${NS}-dm-send-host .bpx-player-video-btn-dm-send,
body.${NS}-video #${NS}-dm-send-host > button {
  display: inline-flex !important;
  flex: 0 0 auto !important;
  align-items: center !important;
  justify-content: center !important;
  position: static !important;
  left: auto !important;
  width: auto !important;
  height: 24px !important;
  min-width: 48px !important;
  margin: 0 2px 0 0 !important;
  padding: 0 10px !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  line-height: 24px !important;
  opacity: 1 !important;
  overflow: visible !important;
  pointer-events: auto !important;
  z-index: 2 !important;
}

/* 评论区：仅轻量暗色（新版在 Shadow DOM，吸底条见表驱动隐藏） */
body.${NS}-video #comment,
body.${NS}-video #commentapp,
body.${NS}-video .bili-comment,
body.${NS}-video .reply-wrap,
body.${NS}-video .comment-container,
body.${NS}-video .bili-comment-container {
  background: transparent !important;
  color: #e7e9eb !important;
}

body.${NS}-video .reply-item .root-reply,
body.${NS}-video .reply-item .reply-content,
body.${NS}-video .reply-content .reply-content-inner,
body.${NS}-video .sub-reply-item .reply-content,
body.${NS}-video .reply-info,
body.${NS}-video .sub-reply-list,
body.${NS}-video .view-more,
body.${NS}-video .reply-list,
body.${NS}-video .user-name,
body.${NS}-video .sub-user-name,
body.${NS}-video .reply-item .user-name {
  color: #d5d7db !important;
  background: transparent !important;
}

/* 右侧栏：统一底色，避免 UP 与弹幕列表之间露出灰条 */
body.${NS}-video .right-container,
body.${NS}-video .right-container-inner,
body.${NS}-video .plp-r {
  background: transparent !important;
  background-color: transparent !important;
}

body.${NS}-video .right-container-inner {
  display: flex !important;
  flex-direction: column !important;
  gap: 0 !important;
}

/* 右侧顶栏弹性留白：随视口伸缩，拉开 UP 与视频，不用硬 margin 硬推 */
body.${NS}-video .right-container-inner::before {
  content: "" !important;
  display: block !important;
  flex: 0 0 clamp(20px, 3.2vh, 42px) !important;
  width: 100% !important;
  height: clamp(20px, 3.2vh, 42px) !important;
  min-height: 20px !important;
  max-height: 42px !important;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  pointer-events: none !important;
}

body.${NS}-video .up-panel-container,
body.${NS}-video #danmukuBox,
body.${NS}-video .danmaku-box,
body.${NS}-video .danmaku-wrap,
body.${NS}-video .player-auxiliary,
body.${NS}-video .player-auxiliary-area,
body.${NS}-video .bui-collapse-wrap,
body.${NS}-video .bui-collapse-header,
body.${NS}-video .bui-collapse-body,
body.${NS}-video .base-video-sections,
body.${NS}-video .base-video-sections-v1,
body.${NS}-video .video-sections-content-list,
body.${NS}-video .video-pod,
body.${NS}-video .video-pod__header,
body.${NS}-video .video-pod__body,
body.${NS}-video .multi-page,
body.${NS}-video .multi-page-v1,
body.${NS}-video .recommend-list-v1,
body.${NS}-video #reco_list {
  background: var(--bx-panel) !important;
  background-color: var(--bx-panel) !important;
  color: #e7e9eb !important;
  border-color: var(--bx-border) !important;
}

/* UP 卡：顶部间距交给弹性空白，这里只保留下边距 */
body.${NS}-video .up-panel-container {
  margin: 0 0 10px !important;
  padding: 14px 12px 12px !important;
  border: 1px solid var(--bx-border) !important;
  border-radius: 10px !important;
  box-sizing: border-box !important;
  overflow: hidden !important;
}

body.${NS}-video .up-panel-container .up-info,
body.${NS}-video .up-panel-container .up-detail,
body.${NS}-video .up-panel-container .btn-panel,
body.${NS}-video .up-panel-container .membersinfo-name,
body.${NS}-video .up-panel-container .staff-mirror,
body.${NS}-video .up-panel-container .up-name,
body.${NS}-video .up-panel-container .avatar {
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
}

body.${NS}-video .up-panel-container .up-info {
  display: flex !important;
  align-items: flex-start !important;
  gap: 10px !important;
}

body.${NS}-video .up-panel-container .btn-panel,
body.${NS}-video .up-panel-container .up-info .btn {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 8px !important;
  margin-top: 10px !important;
  margin-bottom: 0 !important;
  padding-bottom: 0 !important;
  border: none !important;
  box-shadow: none !important;
}

body.${NS}-video .up-panel-container .follow-btn,
body.${NS}-video .up-panel-container .default-btn,
body.${NS}-video .up-panel-container .elect-btn {
  height: 30px !important;
  line-height: 30px !important;
  border-radius: 6px !important;
}

/* 弹幕盒贴紧，去掉站点为宽屏预留的巨大 margin / 灰缝 */
body.${NS}-video #danmukuBox,
body.${NS}-video .danmaku-box {
  margin-top: 0 !important;
  margin-bottom: 10px !important;
  border: 1px solid var(--bx-border) !important;
  border-radius: 10px !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
}

body.${NS}-video .bui-collapse-header,
body.${NS}-video .video-pod__header,
body.${NS}-video .video-sections-head_first-line,
body.${NS}-video .video-sections-head_second-line {
  background: var(--bx-panel) !important;
  color: #e7e9eb !important;
}

body.${NS}-video .video-pod__list .video-pod__item,
body.${NS}-video .video-section-list .video-episode-card,
body.${NS}-video .multi-page .list-box li {
  background: transparent !important;
  color: #c9cdd4 !important;
  border-color: var(--bx-border) !important;
}

body.${NS}-video .video-pod__list .video-pod__item:hover,
body.${NS}-video .multi-page .list-box li:hover {
  background: rgba(255,255,255,0.04) !important;
}

body.${NS}-video .recommend-list-v1,
body.${NS}-video #reco_list {
  background: var(--bx-panel) !important;
  background-color: var(--bx-panel) !important;
  color: #e7e9eb !important;
  border: 1px solid var(--bx-border) !important;
  border-radius: 10px !important;
  padding: 10px 8px !important;
  box-sizing: border-box !important;
}

body.${NS}-video .video-page-card-small,
body.${NS}-video .video-page-operator-card-small {
  background: transparent !important;
  color: #e7e9eb !important;
}

body.${NS}-video .video-page-card-small .title,
body.${NS}-video .video-page-operator-card-small .title,
body.${NS}-video .video-page-card-small .name,
body.${NS}-video .video-page-card-small .upname a,
body.${NS}-video .video-page-card-small .playinfo {
  color: #e7e9eb !important;
}

body.${NS}-video .video-page-card-small .upname,
body.${NS}-video .video-page-card-small .playinfo,
body.${NS}-video .video-page-card-small .name {
  color: #a2a7ae !important;
}

body.${NS}-video .video-page-card-small .pic,
body.${NS}-video .video-page-card-small img,
body.${NS}-video .video-page-operator-card-small img {
  opacity: 1 !important;
  visibility: visible !important;
  background: #2a2b2e !important;
}

/* 工具栏 / 三连（左侧保留；右侧条见表驱动隐藏） */
body.${NS}-video .video-toolbar-container,
body.${NS}-video .video-toolbar-left,
body.${NS}-video .video-like,
body.${NS}-video .video-coin,
body.${NS}-video .video-fav,
body.${NS}-video .video-share {
  color: #c9cdd4 !important;
  background: transparent !important;
}

body.${NS}-video .video-toolbar-container {
  justify-content: flex-start !important;
}

body.${NS}-video .up-panel-container,
body.${NS}-video .follow-btn,
body.${NS}-video .default-btn {
  color: #e7e9eb !important;
}

body.${NS}-video .follow-btn.not-follow,
body.${NS}-video .default-btn.follow-btn {
  background: #00a1d6 !important;
  color: #fff !important;
  border: none !important;
}

/* 广告 / 顶条 / 右侧工具条（表驱动） */
${CSS_HIDE_VIDEO_CHROME}

/* 播放器贴顶铺满宽度 */
body.${NS}-video #playerWrap.player-wrap,
body.${NS}-video #bilibili-player-wrap,
body.${NS}-video .player-wrap {
  position: absolute !important;
  left: 0 !important;
  right: 0 !important;
  top: 0 !important;
  height: auto !important;
  padding-right: 0 !important;
  z-index: 5 !important;
  max-width: none !important;
  width: 100% !important;
}

body.${NS}-video #bilibili-player {
  height: auto !important;
  width: auto !important;
  max-width: none !important;
  box-shadow: none !important;
  margin: 0 !important;
}

body.${NS}-video #bilibili-player .bpx-player-container {
  box-shadow: none !important;
}

body.${NS}-video .bpx-player-container:not(:fullscreen) .bpx-player-video-wrap > video,
body.${NS}-video .bpx-player-container:not(:fullscreen) .bpx-player-video-wrap bwp-video {
  max-height: var(--bx-player-height-record) !important;
}

body.${NS}-video .bpx-player-container:not([data-screen="mini"]) .bpx-player-video-area:has(>.bpx-state-loading) video,
body.${NS}-video .bpx-player-video-wrap > video:not([src]) {
  height: var(--bx-player-height) !important;
}

body.${NS}-video .video-container-v1,
body.${NS}-video .left-container,
body.${NS}-video .main-container,
body.${NS}-video .playlist-container--left {
  position: static !important;
}

body.${NS}-video .video-container-v1,
body.${NS}-video .main-container,
body.${NS}-video .playlist-container {
  padding-left: var(--bx-layout-padding) !important;
  padding-right: var(--bx-layout-padding) !important;
  max-width: none !important;
  min-width: 0 !important;
  width: auto !important;
  box-sizing: border-box !important;
}

body.${NS}-video .left-container,
body.${NS}-video .plp-l,
body.${NS}-video .playlist-container--left {
  flex: 1 1 auto !important;
  width: auto !important;
  max-width: none !important;
  min-width: 0 !important;
}

body.${NS}-video .right-container,
body.${NS}-video .plp-r {
  flex: 0 0 400px !important;
  width: 400px !important;
  max-width: 420px !important;
}

body.${NS}-video .plp-r {
  position: sticky !important;
  padding-top: 0 !important;
  top: 12px !important;
}

body.${NS}-video #app {
  width: 100% !important;
  max-width: 100% !important;
}

body.${NS}-video #viewbox_report,
body.${NS}-video .video-info-container {
  height: auto !important;
  background: transparent !important;
}

body.${NS}-video .recommend-list-v1,
body.${NS}-video #reco_list,
body.${NS}-video .video-page-card-small,
body.${NS}-video .video-page-operator-card-small {
  visibility: visible !important;
  opacity: 1 !important;
}

body.${NS}-video .bpx-player-ctrl-wide,
body.${NS}-video .bpx-player-ctrl-web {
  display: none !important;
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

  /**
   * 统一 DOM 观察 + debounce + 重试；route 不匹配时不执行
   * @param {string} id
   * @param {{ route?: string, run: Function, debounce?: number, retries?: number[], root?: Element|Function }} opts
   */
  function watchUntil(id, opts) {
    stopWatch(id);
    const debounceMs = opts.debounce != null ? opts.debounce : CONFIG.watchDebounce;
    const retries = opts.retries || CONFIG.watchRetries;
    const entry = { obs: null, timers: [], debounceTimer: 0 };

    const safeRun = () => {
      if (opts.route && STATE.route !== opts.route) return;
      try {
        opts.run();
      } catch (e) {
        console.error(`[BilibiliX] watch:${id}`, e);
      }
    };

    const schedule = () => {
      if (entry.debounceTimer) return;
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = 0;
        safeRun();
      }, debounceMs);
    };

    const bindObs = () => {
      const root =
        typeof opts.root === "function" ? opts.root() : opts.root || document.body;
      if (!root) {
        entry.timers.push(setTimeout(bindObs, 120));
        return;
      }
      entry.obs = new MutationObserver(schedule);
      entry.obs.observe(root, { childList: true, subtree: true });
    };

    safeRun();
    bindObs();
    retries.forEach((ms) => {
      entry.timers.push(setTimeout(safeRun, ms));
    });
    RUNTIME.watchers.set(id, entry);
  }

  function stopWatch(id) {
    const entry = RUNTIME.watchers.get(id);
    if (!entry) return;
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = 0;
    }
    entry.timers.forEach((t) => clearTimeout(t));
    if (entry.obs) {
      try {
        entry.obs.disconnect();
      } catch (_) {}
    }
    RUNTIME.watchers.delete(id);
  }

  function detectRoute(pathname) {
    if (pathname) {
      const host = location.hostname || "";
      if (host === "search.bilibili.com" || /\.search\.bilibili\.com$/.test(host)) {
        return "search";
      }
      if (pathname === "/" || pathname === "/index.html") return "home";
      if (/^\/video\//.test(pathname)) return "video";
      if (/^\/search/.test(pathname) || /^\/s\//.test(pathname)) return "search";
      return "other";
    }
    return peekRoute();
  }

  function setBodyRoute(route) {
    stampRouteClasses(route);
    STATE.route = route;
  }

  function clearBooting() {
    const html = document.documentElement;
    if (!html.classList.contains(`${NS}-booting`)) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        html.classList.remove(`${NS}-booting`);
      });
    });
  }

  function loadFonts() {
    if (document.getElementById(`${NS}-fonts`)) return;
    const link = document.createElement("link");
    link.id = `${NS}-fonts`;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap";
    (document.head || document.documentElement).appendChild(link);
  }

  function ensureStyle() {
    let style = document.getElementById(`${NS}-style`);
    if (!style) {
      style = document.createElement("style");
      style.id = `${NS}-style`;
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== CSS) {
      style.textContent = CSS;
    }
  }

  // 递归 Evolved shadowRootStyles：把样式塞进每一层 open shadowRoot
  // 对齐 Evolved：只往评论相关 open shadowRoot 注入
  function injectCommentShadowStyle(shadowRoot) {
    if (!shadowRoot || STATE.route !== "video") return;
    const id = `${NS}-comment-shadow`;
    let style = shadowRoot.getElementById
      ? shadowRoot.getElementById(id)
      : shadowRoot.querySelector(`#${id}`);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      shadowRoot.appendChild(style);
    }
    if (style.textContent !== COMMENT_SHADOW_CSS) {
      style.textContent = COMMENT_SHADOW_CSS;
    }
  }

  function walkShadowRoots(root, visit) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) {
        visit(el.shadowRoot);
        walkShadowRoots(el.shadowRoot, visit);
      }
    });
  }

  function patchAllCommentShadows() {
    if (STATE.route !== "video" || !document.body) return;
    // 只扫评论根，不再全页 walk
    qsa(CONFIG.commentRoots).forEach((host) => {
      if (host.shadowRoot) {
        injectCommentShadowStyle(host.shadowRoot);
        walkShadowRoots(host.shadowRoot, injectCommentShadowStyle);
      }
      walkShadowRoots(host, injectCommentShadowStyle);
    });
  }

  function watchCommentShadows() {
    watchUntil("commentShadow", {
      route: "video",
      run: patchAllCommentShadows,
      root: () =>
        qs("bili-comments") ||
        qs("#commentapp") ||
        qs("#comment") ||
        document.body,
    });
  }

  function teardownCommentShadows() {
    stopWatch("commentShadow");
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

    // belt-and-suspenders: force list layout even if old CSS still hangs around
    grid.style.setProperty("display", "flex", "important");
    grid.style.setProperty("flex-direction", "column", "important");
    grid.style.setProperty("grid-template-columns", "none", "important");

    const frag = document.createDocumentFragment();
    videos.forEach((v) => {
      if (!v || !v.href || v.href === "#") return;
      const a = document.createElement("a");
      a.className = `${NS}-card`;
      a.href = v.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.cssText =
        "display:flex!important;flex-direction:row!important;align-items:center!important;" +
        "gap:18px!important;width:100%!important;box-sizing:border-box!important;" +
        "text-decoration:none!important;color:inherit!important;padding:10px 12px!important;" +
        "border-radius:14px!important;background:rgba(255,255,255,0.03)!important;" +
        "border:1px solid rgba(255,255,255,0.06)!important;float:none!important;";
      a.innerHTML = `
        <div class="${NS}-card-cover" style="flex:0 0 220px;width:220px;min-width:220px;aspect-ratio:16/10;border-radius:10px;overflow:hidden;position:relative;background:#1a1f2a;">
          <img src="${escapeHtml(v.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;display:block;" />
          <div class="${NS}-card-meta" style="position:absolute;left:0;right:0;bottom:0;padding:6px 8px;display:flex;justify-content:space-between;font-size:11px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.72));">
            <span>${escapeHtml(formatCount(v.play))}播放</span>
            <span>${escapeHtml(v.duration)}</span>
          </div>
        </div>
        <div class="${NS}-card-body" style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:8px;">
          <div class="${NS}-card-title" style="margin:0;font-size:17px;font-weight:600;line-height:1.45;color:#e8eaef;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(v.title)}</div>
          <div class="${NS}-card-up" style="margin:0;font-size:13px;color:#a8b0c2;">${escapeHtml(v.author || "未知UP")}</div>
          <div class="${NS}-card-time" style="margin:0;font-size:13px;color:#8b93a7;">${escapeHtml(v.pub || "")}</div>
        </div>
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
    const status = document.getElementById(`${NS}-dyn-status`);
    if (!status) return;
    const rect = status.getBoundingClientRect();
    if (rect.top < window.innerHeight + 240) {
      loadDynPage(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Home search host + smooth scroll progress
  // ---------------------------------------------------------------------------
  function ensureSearchChrome() {
    let backdrop = document.getElementById(`${NS}-search-backdrop`);
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = `${NS}-search-backdrop`;
    }
    // keep chrome at the very top of body so it never sits under the feed in flow
    if (backdrop.parentElement !== document.body || document.body.firstChild !== backdrop) {
      document.body.insertBefore(backdrop, document.body.firstChild);
    }

    let host = document.getElementById(`${NS}-search-host`);
    if (!host) {
      host = document.createElement("div");
      host.id = `${NS}-search-host`;
    }
    if (host.parentElement !== document.body || backdrop.nextSibling !== host) {
      document.body.insertBefore(host, backdrop.nextSibling);
    }

    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("left", "50%", "important");
    host.style.setProperty("z-index", "2147483000", "important");
    host.style.setProperty("pointer-events", "none", "important");
    host.style.setProperty("margin", "0", "important");
    host.style.setProperty("right", "auto", "important");
    host.style.setProperty("bottom", "auto", "important");

    const wrap = qs(".center-search-container");
    const form = qs("#nav-searchform");
    const node = (wrap && wrap.contains(form) ? wrap : null) || form || wrap;
    if (node && !host.contains(node)) {
      host.appendChild(node);
    }

    // kill duplicate search UIs outside our host (site may re-inject)
    qsa("#nav-searchform, .center-search-container").forEach((el) => {
      if (!host.contains(el)) {
        el.style.setProperty("display", "none", "important");
        el.setAttribute("data-bx-dup", "1");
      }
    });

    qsa(
      ".nav-search-btn, .nav-search-button, .nav-search-clean, .nav-search-clear, .clear-icon",
      host
    ).forEach((el) => {
      el.style.setProperty("position", "static", "important");
      el.style.setProperty("right", "auto", "important");
      el.style.setProperty("left", "auto", "important");
    });

    const formEl = host.querySelector("#nav-searchform, form");
    if (formEl) formEl.style.setProperty("pointer-events", "auto", "important");

    return host;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function applyHomeScrollVisual(p) {
    const host = document.getElementById(`${NS}-search-host`);
    const backdrop = document.getElementById(`${NS}-search-backdrop`);
    const hint = document.getElementById(`${NS}-home-hint`);
    if (!host) return;

    const e = 1 - Math.pow(1 - p, 2.4);
    // 吸顶后按顶栏高度垂直居中
    const dockTopPx = Math.max(0, (CONFIG.homeBarH - CONFIG.homeSearchH) / 2);
    const heroTopPx = window.innerHeight * 0.42;
    const topPx = lerp(heroTopPx, dockTopPx, e);
    const widthPx = lerp(
      Math.min(640, window.innerWidth * 0.86),
      Math.min(560, window.innerWidth * 0.9),
      e
    );

    host.style.setProperty("top", `${topPx}px`, "important");
    host.style.setProperty("width", `${widthPx}px`, "important");
    host.style.setProperty("transform", "translateX(-50%)", "important");
    host.style.setProperty("position", "fixed", "important");

    if (backdrop) {
      const show = p > 0.45;
      backdrop.style.background = show ? "rgba(14,16,20,0.9)" : "rgba(14,16,20,0)";
      backdrop.style.borderBottomColor = show ? "rgba(255,255,255,0.08)" : "transparent";
      backdrop.style.backdropFilter = show ? "blur(12px)" : "blur(0px)";
      backdrop.classList.toggle(`${NS}-show`, show);
    }
    if (hint) {
      hint.style.opacity = String(Math.max(0, 1 - p * 1.35));
      hint.style.animation = p > 0.15 ? "none" : "";
    }

    const scrolled = p > 0.08;
    document.body.classList.toggle(`${NS}-home-hero`, !scrolled);
    document.body.classList.toggle(`${NS}-home-scrolled`, scrolled);
  }

  function tickHomeScroll() {
    if (STATE.route !== "home") {
      STATE.rafHome = 0;
      return;
    }
    const range = Math.max(280, window.innerHeight * 0.75);
    STATE.scrollTarget = Math.min(1, Math.max(0, window.scrollY / range));
    // smooth follow — prevents one-wheel jump from 0 → 1
    STATE.scrollP += (STATE.scrollTarget - STATE.scrollP) * 0.14;
    if (Math.abs(STATE.scrollTarget - STATE.scrollP) < 0.001) {
      STATE.scrollP = STATE.scrollTarget;
    }
    applyHomeScrollVisual(STATE.scrollP);
    onDynScroll();
    STATE.rafHome = requestAnimationFrame(tickHomeScroll);
  }

  function startHomeScrollLoop() {
    if (STATE.rafHome) cancelAnimationFrame(STATE.rafHome);
    STATE.rafHome = requestAnimationFrame(tickHomeScroll);
  }

  function stopHomeScrollLoop() {
    if (STATE.rafHome) cancelAnimationFrame(STATE.rafHome);
    STATE.rafHome = 0;
    STATE.scrollP = 0;
    STATE.scrollTarget = 0;
  }

  function updateHomeScrollProgress() {
    const range = Math.max(280, window.innerHeight * 0.75);
    STATE.scrollTarget = Math.min(1, Math.max(0, window.scrollY / range));
  }

  function teardownSearchChrome() {
    const host = document.getElementById(`${NS}-search-host`);
    const backdrop = document.getElementById(`${NS}-search-backdrop`);
    if (host) {
      const form = host.querySelector("#nav-searchform, .center-search-container");
      const slot = qs(".bili-header__bar") || qs(".bili-header");
      if (form && slot && !slot.contains(form)) {
        slot.appendChild(form);
      }
      host.remove();
    }
    if (backdrop) backdrop.remove();
    qsa('[data-bx-dup="1"]').forEach((el) => {
      el.style.removeProperty("display");
      el.removeAttribute("data-bx-dup");
    });
  }
  function setupHome() {
    setBodyRoute("home");
    document.body.classList.add(`${NS}-home-hero`);
    ensureStyle();

    // already mounted with new list cards — just keep chrome alive
    const existingGrid = document.getElementById(`${NS}-dyn-grid`);
    if (
      existingGrid &&
      existingGrid.querySelector(`.${NS}-card-body`) &&
      document.getElementById(`${NS}-search-host`)
    ) {
      ensureSearchChrome();
      sanitizeSearch();
      startHomeScrollLoop();
      return;
    }

    document.body.classList.remove(`${NS}-home-scrolled`);

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
    ensureSearchChrome();
    ensureStyle();
    startHomeScrollLoop();

    // always rebuild list cards (inline styles) so old 5-col DOM cannot linger
    loadDynPage(true);

    const onScroll = () => {
      updateHomeScrollProgress();
      sanitizeSearch();
      ensureSearchChrome();
    };

    if (RUNTIME.homeScroll) {
      window.removeEventListener("scroll", RUNTIME.homeScroll);
    }
    if (RUNTIME.homeResize) {
      window.removeEventListener("resize", RUNTIME.homeResize);
    }
    RUNTIME.homeScroll = onScroll;
    RUNTIME.homeResize = onScroll;
    window.addEventListener("scroll", RUNTIME.homeScroll, { passive: true });
    window.addEventListener("resize", RUNTIME.homeResize, { passive: true });
    onScroll();

    watchUntil("homeSearch", {
      route: "home",
      run: () => {
        sanitizeSearch();
        ensureSearchChrome();
      },
    });
  }

  function teardownHome() {
    if (RUNTIME.homeScroll) {
      window.removeEventListener("scroll", RUNTIME.homeScroll);
      RUNTIME.homeScroll = null;
    }
    if (RUNTIME.homeResize) {
      window.removeEventListener("resize", RUNTIME.homeResize);
      RUNTIME.homeResize = null;
    }
    stopHomeScrollLoop();
    stopWatch("homeSearch");
    teardownSearchChrome();
    const hero = document.getElementById(`${NS}-home-hero`);
    const feed = document.getElementById(`${NS}-dyn-feed`);
    if (hero) hero.remove();
    if (feed) feed.remove();
    document.body &&
      document.body.classList.remove(`${NS}-home-hero`, `${NS}-home-scrolled`);
    STATE.dynOffset = "";
    STATE.dynHasMore = true;
  }

  // ---------------------------------------------------------------------------
  // Video：不搬 DOM，只挂宽屏高度同步 + 自动播放
  // ---------------------------------------------------------------------------
  function measurePlayerBlockHeight() {
    const container = qs(".bpx-player-container");
    if (!container || container.dataset.screen === "mini") return 0;
    return Math.round(container.getBoundingClientRect().height || 0);
  }

  function applyPlayerHeightRecord() {
    if (STATE.route !== "video") return;
    const height = measurePlayerBlockHeight();
    if (height > 0 && height <= window.innerHeight + 40) {
      document.documentElement.style.setProperty(
        "--bx-player-height-record",
        `${height}px`
      );
    }
  }

  function syncPlayerHeightRecord() {
    const container = qs(".bpx-player-container");
    if (!container) return;
    if (RUNTIME.playerRO) {
      try {
        RUNTIME.playerRO.disconnect();
      } catch (_) {}
    }
    applyPlayerHeightRecord();
    const ro = new ResizeObserver(() => applyPlayerHeightRecord());
    ro.observe(container);
    RUNTIME.playerRO = ro;
    setTimeout(applyPlayerHeightRecord, 400);
    setTimeout(applyPlayerHeightRecord, 1200);
  }

  // 布局：左[弹幕设置|开关] 中[输入+发送] 右[原控件]；下方发送区隐藏
  function integrateDanmakuSendbar() {
    if (STATE.route !== "video") return false;

    const sendingArea = qs(".bpx-player-sending-area");
    const controlLeft = qs(".bpx-player-control-bottom-left");
    const controlCenter = qs(".bpx-player-control-bottom-center");
    if (!sendingArea || !controlLeft || !controlCenter) return false;

    const scope = qs("#bilibili-player") || document;
    const dmSetting =
      sendingArea.querySelector(".bpx-player-dm-setting") ||
      scope.querySelector(".bpx-player-dm-setting");
    const dmSwitch =
      sendingArea.querySelector(".bpx-player-dm-switch") ||
      scope.querySelector(".bpx-player-dm-switch");
    const inputbar =
      sendingArea.querySelector(".bpx-player-video-inputbar") ||
      sendingArea.querySelector(".bpx-player-video-inputbar-wrap");
    if (!inputbar) return false;

    // 左侧挂弹幕设置 / 开关
    let ctrlHost = document.getElementById(`${NS}-dm-ctrl-host`);
    if (!ctrlHost) {
      ctrlHost = document.createElement("div");
      ctrlHost.id = `${NS}-dm-ctrl-host`;
    }
    if (!controlLeft.contains(ctrlHost)) {
      const time = controlLeft.querySelector(".bpx-player-ctrl-time");
      if (time && time.nextSibling) {
        controlLeft.insertBefore(ctrlHost, time.nextSibling);
      } else {
        controlLeft.appendChild(ctrlHost);
      }
    }
    if (dmSetting && !ctrlHost.contains(dmSetting)) {
      ctrlHost.appendChild(dmSetting);
    }
    if (dmSwitch && !ctrlHost.contains(dmSwitch)) {
      ctrlHost.appendChild(dmSwitch);
    }

    // 中间：只挂「真实 input + 发送按钮」，不要整颗 inputbar（会带大 A + 双层壳）
    let sendHost = document.getElementById(`${NS}-dm-send-host`);
    if (!sendHost) {
      sendHost = document.createElement("div");
      sendHost.id = `${NS}-dm-send-host`;
    }
    if (!controlCenter.contains(sendHost)) {
      controlCenter.innerHTML = "";
      controlCenter.appendChild(sendHost);
    }

    const dmInput =
      inputbar.querySelector("input.bpx-player-dm-input") ||
      inputbar.querySelector(".bpx-player-dm-input") ||
      inputbar.querySelector("input") ||
      inputbar.querySelector("textarea");
    const dmSend =
      inputbar.querySelector(".bpx-player-dm-btn-send") ||
      inputbar.querySelector(".bpx-player-video-btn-dm-send") ||
      sendingArea.querySelector(".bpx-player-dm-btn-send");

    if (dmInput && dmInput.parentElement !== sendHost) {
      sendHost.appendChild(dmInput);
    }
    if (dmSend && dmSend.parentElement !== sendHost) {
      sendHost.appendChild(dmSend);
    }

    // 清空宿主里除 input/发送 以外的节点（含大 A）
    [...sendHost.children].forEach((el) => {
      const isInput =
        el.matches &&
        (el.matches("input") ||
          el.matches("textarea") ||
          el.classList.contains("bpx-player-dm-input"));
      const isSend =
        el.classList &&
        (el.classList.contains("bpx-player-dm-btn-send") ||
          el.classList.contains("bpx-player-video-btn-dm-send") ||
          (el.tagName === "BUTTON" && /发送/.test(el.textContent || "")));
      if (!isInput && !isSend) el.remove();
    });

    // 强制从左侧输入
    if (dmInput) {
      dmInput.style.setProperty("text-align", "left", "important");
      dmInput.style.setProperty("text-indent", "0", "important");
      dmInput.style.setProperty("padding-left", "0", "important");
      dmInput.style.setProperty("width", "100%", "important");
    }

    // 原 inputbar 留在发送区里一起隐藏
    inputbar.setAttribute("data-bx-inputbar-emptied", "1");

    sendingArea.style.setProperty("display", "none", "important");
    sendingArea.setAttribute("data-bx-dm-hidden", "1");
    applyPlayerHeightRecord();
    return !!(dmSetting || dmSwitch);
  }

  function watchDanmakuSendbar() {
    watchUntil("danmakuSendbar", {
      route: "video",
      run: integrateDanmakuSendbar,
      retries: CONFIG.dmRetries,
      root: () => qs("#bilibili-player") || document.body,
    });
  }

  function teardownDanmakuSendbar() {
    stopWatch("danmakuSendbar");
    const area =
      qs('.bpx-player-sending-area[data-bx-dm-hidden="1"]') ||
      qs(".bpx-player-sending-area");
    const sendHost = document.getElementById(`${NS}-dm-send-host`);
    const ctrlHost = document.getElementById(`${NS}-dm-ctrl-host`);
    if (area) {
      if (ctrlHost) {
        while (ctrlHost.firstChild) area.appendChild(ctrlHost.firstChild);
      }
      if (sendHost) {
        while (sendHost.firstChild) area.appendChild(sendHost.firstChild);
      }
      area.style.removeProperty("display");
      area.removeAttribute("data-bx-dm-hidden");
    }
    if (sendHost) sendHost.remove();
    if (ctrlHost) ctrlHost.remove();
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

  function enableVideoDarkMode() {
    // 对齐 Bilibili-Evolved：挂 body.dark，并尽量打开官方 theme_style
    document.documentElement.classList.add("dark");
    document.body.classList.add("dark", "integrated-dark");
    document.documentElement.setAttribute("lab-style", "dark");
    document.documentElement.style.colorScheme = "dark";

    try {
      document.cookie =
        "theme_style=dark; path=/; domain=.bilibili.com; max-age=31536000";
    } catch (_) {}

    let themeMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeMeta) {
      themeMeta = document.createElement("meta");
      themeMeta.name = "theme-color";
      document.head.appendChild(themeMeta);
    }
    if (!themeMeta.dataset.bxLight) {
      themeMeta.dataset.bxLight = themeMeta.content || "";
    }
    themeMeta.content = "#0e1014";

    let schemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (!schemeMeta) {
      schemeMeta = document.createElement("meta");
      schemeMeta.name = "color-scheme";
      document.head.appendChild(schemeMeta);
    }
    schemeMeta.content = "dark";
  }

  function disableVideoDarkMode() {
    document.documentElement.classList.remove("dark");
    document.body.classList.remove("dark", "integrated-dark");
    if (document.documentElement.getAttribute("lab-style") === "dark") {
      document.documentElement.removeAttribute("lab-style");
    }
    // 不强制清 cookie，避免影响用户在 B 站其它页的深色偏好
  }

  async function setupVideo() {
    setBodyRoute("video");
    STATE.autoplayTried = false;
    ensureStyle();
    enableVideoDarkMode();

    await waitFor(
      "#bilibili-player, #playerWrap, .player-wrap, .bpx-player-container",
      15000
    );

    syncPlayerHeightRecord();
    watchDanmakuSendbar();
    watchCommentShadows();
    tryAutoplay();
  }

  function teardownVideo() {
    if (RUNTIME.playerRO) {
      try {
        RUNTIME.playerRO.disconnect();
      } catch (_) {}
      RUNTIME.playerRO = null;
    }
    teardownDanmakuSendbar();
    teardownCommentShadows();
    document.documentElement.style.removeProperty("--bx-player-height-record");
    disableVideoDarkMode();
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
    } else {
      teardownHome();
      teardownVideo();
      setBodyRoute("other");
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
    // 事件为主；低频轮询仅兜底（站点偶发不走 history API）
    setInterval(tick, CONFIG.spaPollMs);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  ensureStyle();
  loadFonts();
  if (BOOT_ROUTE !== "other") {
    STATE.route = BOOT_ROUTE;
  }

  // 完整 CSS 就绪后，body 一出现就揭开（不必干等 DOMContentLoaded）
  function armEarlyReveal() {
    if (BOOT_ROUTE === "other") return;
    const go = () => {
      if (!document.body) return false;
      stampRouteClasses(BOOT_ROUTE);
      clearBooting();
      return true;
    };
    if (go()) return;
    const mo = new MutationObserver(() => {
      if (go()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true });
  }
  armEarlyReveal();

  function boot() {
    ensureStyle();
    if (BOOT_ROUTE !== "other") stampRouteClasses(BOOT_ROUTE);
    if (STATE.anonMode) {
      document.documentElement.classList.add(`${NS}-anon`);
    }
    syncAnonTitle();
    applyRoute();
    watchSpa();
    clearBooting();
  }

  // 极端情况（脚本中途异常）避免页面一直不可见
  setTimeout(() => {
    document.documentElement.classList.remove(`${NS}-booting`);
  }, CONFIG.bootFailsafeMs);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
