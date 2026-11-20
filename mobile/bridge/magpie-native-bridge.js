/*!
 * Magpie native bridge — magpie-native-bridge.js  (PROPOSED web-side asset)
 * ---------------------------------------------------------------------------
 * Loaded by the WEB app (public/index.html) this file lets the single web
 * codebase feature-detect the Capacitor native shell and call native plugins.
 * In a normal browser it is a harmless no-op: window.MagpieNative exists,
 * MagpieNative.isNative === false, and every method falls back to web APIs
 * or resolves quietly. One codebase, both worlds.
 *
 * HOW IT WORKS (remote-URL mode)
 * The shell loads https://app.magpielocal.com in a Capacitor WebView.
 * Capacitor itself injects its own bridge into EVERY page the WebView loads
 * (including remote pages): that injection creates window.Capacitor and lazy
 * proxies at Capacitor.Plugins.<PluginName> for every plugin installed in the
 * native app. This file only wraps those proxies in a stable Magpie API —
 * the web app never imports @capacitor/* packages and needs no build step.
 *
 * WEB-SIDE ADOPTION (one line, batched by Brenda — do not ship piecemeal):
 *   <script src="/native-bridge.js" defer></script>   in public/index.html,
 *   with this file copied to public/native-bridge.js.
 * Load order: anywhere before app code that calls MagpieNative; `defer`
 * alongside app.js is fine because every call below is defensive.
 *
 * BACKEND NOTE: push-token delivery expects POST /api/devices/push-token
 * (auth: the signed-in user's normal session). That endpoint does NOT exist
 * yet — see mobile/README.md "Web-side changes needed". Until it ships, the
 * token is kept in localStorage and re-sent on every launch, so no token is
 * lost once the endpoint lands.
 */
(function () {
  "use strict";
  if (window.MagpieNative) return; // double-load guard

  var Cap = window.Capacitor || null;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());
  var platform = isNative && typeof Cap.getPlatform === "function" ? Cap.getPlatform() : "web";

  function plugin(name) {
    if (!isNative || !Cap.Plugins || !Cap.Plugins[name]) return null;
    return Cap.Plugins[name];
  }
  function noop() {}

  /* ------------------------------------------------ push notifications */
  var pushToken = null;
  try { pushToken = localStorage.getItem("magpie.pushToken") || null; } catch (e) {}

  function deliverTokenToBackend(token, plat) {
    try { localStorage.setItem("magpie.pushToken", token); localStorage.setItem("magpie.pushPlatform", plat); } catch (e) {}
    // Same-origin, cookie/session-authenticated like every other /api call.
    // 404 until the backend endpoint ships — caught and ignored on purpose.
    fetch("/api/devices/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ token: token, platform: plat })
    }).catch(noop);
  }

  var pushWired = false;
  function initPush() {
    var Push = plugin("PushNotifications");
    if (!Push || pushWired) return;
    pushWired = true;
    Push.addListener("registration", function (t) {
      pushToken = t && t.value ? t.value : pushToken;
      if (pushToken) deliverTokenToBackend(pushToken, platform);
    });
    Push.addListener("registrationError", noop);
    // Foreground receipt: hand off to the app if it wants to react.
    Push.addListener("pushNotificationReceived", function (n) {
      window.dispatchEvent(new CustomEvent("magpie:push-received", { detail: n }));
    });
    // Tapped notification: deep-route into the SPA when the payload carries
    // a path (backend sets data.path, e.g. "/#/offers" style or "/c/<handle>").
    Push.addListener("pushNotificationActionPerformed", function (action) {
      var path = action && action.notification && action.notification.data && action.notification.data.path;
      window.dispatchEvent(new CustomEvent("magpie:push-open", { detail: { path: path || null, notification: action && action.notification } }));
      if (path && typeof window.magpieNativeRoute === "function") window.magpieNativeRoute(path);
    });
    Push.requestPermissions().then(function (res) {
      if (res && res.receive === "granted") Push.register();
    }).catch(noop);
  }

  /* ------------------------------------------------------------- share */
  function share(opts) {
    opts = opts || {};
    var Share = plugin("Share");
    if (Share) return Share.share({ title: opts.title || "Magpie", text: opts.text || "", url: opts.url || location.href, dialogTitle: opts.dialogTitle || "Share" });
    if (navigator.share) return navigator.share({ title: opts.title, text: opts.text, url: opts.url || location.href });
    return Promise.reject(new Error("share-unavailable"));
  }

  /* ------------------------------------------------------------ camera */
  // Returns a Blob-ready data URL. The web app feeds it into its EXISTING
  // upload flow exactly as it would a file input — no new upload path.
  function takePhoto() {
    var Camera = plugin("Camera");
    if (!Camera) return Promise.reject(new Error("camera-unavailable"));
    return Camera.getPhoto({ quality: 85, allowEditing: false, resultType: "dataUrl", source: "PROMPT", width: 1600 }).then(function (r) {
      return r && r.dataUrl ? r.dataUrl : null;
    });
  }

  /* ------------------------------------------------- app / deep links */
  function initAppEvents() {
    var App = plugin("App");
    if (!App) return;
    // Universal links / app links (app.magpielocal.com) opened the app:
    // hand the path to the SPA router if it exposes one.
    App.addListener("appUrlOpen", function (data) {
      if (!data || !data.url) return;
      window.dispatchEvent(new CustomEvent("magpie:deep-link", { detail: { url: data.url } }));
      try {
        var u = new URL(data.url);
        if (typeof window.magpieNativeRoute === "function") window.magpieNativeRoute(u.pathname + u.search + u.hash);
      } catch (e) {}
    });
    App.addListener("appStateChange", function (state) {
      window.dispatchEvent(new CustomEvent("magpie:app-state", { detail: state }));
      // Re-send the push token on foreground: covers the window before the
      // backend endpoint existed and any token rotation we missed.
      if (state && state.isActive && pushToken) deliverTokenToBackend(pushToken, platform);
    });
    // Android hardware back: let the SPA vote first; default = Capacitor.
    App.addListener("backButton", function (ev) {
      window.dispatchEvent(new CustomEvent("magpie:back-button", { detail: ev }));
    });
  }

  /* ------------------------------------------- splash + status bar */
  function hideSplash() {
    var Splash = plugin("SplashScreen");
    if (Splash) Splash.hide().catch(noop);
  }
  function initStatusBar() {
    var Bar = plugin("StatusBar");
    if (!Bar) return;
    // Plain default until the design stream lands: dark text on white.
    Bar.setStyle({ style: "LIGHT" }).catch(noop); // LIGHT = light bar, dark glyphs
    Bar.setBackgroundColor({ color: "#FFFFFF" }).catch(noop);
  }

  window.MagpieNative = {
    isNative: isNative,
    platform: platform,
    capacitor: Cap,
    share: share,
    takePhoto: takePhoto,
    hideSplash: hideSplash,
    initPush: initPush,
    getPushToken: function () { return pushToken; }
  };

  if (isNative) {
    initAppEvents();
    initStatusBar();
    // Splash: config already sets launchAutoHide with a minimal duration;
    // hide again on full load as a belt-and-braces so signed-in users are
    // never held on splash by the shell.
    if (document.readyState === "complete") hideSplash();
    else window.addEventListener("load", hideSplash);
    // Push is requested lazily by the app (better grant rates after sign-in):
    // the app calls MagpieNative.initPush() post-login. If it never does,
    // wire it on first foreground so tokens still arrive.
    document.addEventListener("resume", initPush, false);
  }
})();
