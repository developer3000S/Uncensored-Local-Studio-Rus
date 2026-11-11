import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// When the studio is embedded in the Open WebUI iframe it is served from the
// Open WebUI origin under /studio. All of its API calls are root-relative
// ("/api/...", "/v1/...", "/sdapi/..."), which on that origin collide with Open
// WebUI's own routes. Open WebUI proxies the same endpoints under /studio, so
// the path is rewritten in place. Standalone deployments are unaffected.
//
// The embedded mode is flagged on <html> so CSS can hide the studio's own
// sidebar: navigation lives in the Open WebUI sidebar section "AI Студия",
// and showing both sidebars side by side duplicates every entry.
const STUDIO_EMBEDDED =
  typeof window !== "undefined" && window.location.pathname.split("/")[1] === "studio";

if (STUDIO_EMBEDDED) {
  document.documentElement.classList.add("studio-embedded");

  const STUDIO_PREFIX = "/studio";
  const STUDIO_ROUTE = /^\/(api|v1|sdapi)(\/|$)/;

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(input, init) {
    if (typeof input === "string" && STUDIO_ROUTE.test(input)) {
      input = STUDIO_PREFIX + input;
    }
    return originalFetch.call(this, input, init);
  };

  // Model uploads use XHR for upload progress events.
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedXhrOpen(method, url, ...rest) {
    if (typeof url === "string" && STUDIO_ROUTE.test(url)) {
      url = STUDIO_PREFIX + url;
    }
    return originalXhrOpen.call(this, method, url, ...rest);
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
