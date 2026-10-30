// Build identity (stuck-nav fix, 2026-10-28): the server stamps
// every /api/* response with this id (x-signl-build header, set
// in netlify/functions/api.js), and the app shell carries the
// same id inline in public/index.html (window.__SIGNL_BUILD__,
// plus the ?v= asset URLs). When a signed-in tab outlives a
// deploy, its next API response reports a newer build than the
// code it is running, and the client reloads itself once into
// the fresh, consistent asset set instead of limping on in a
// mixed state until a manual refresh. Bump this id (and the
// matching one in index.html) on any deploy that changes client
// or server behavior; both live in the same commit, so a bump
// is one search-and-replace.
exports.BUILD_ID = "2026.10.30-49";
