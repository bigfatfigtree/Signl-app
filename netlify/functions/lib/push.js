// Push delivery (Build -230, Jeff's fix-all order, 2026-11-21).
//
// THE GAP THIS CLOSES: the native shell has registered device
// tokens since Build -218 (POST /api/me/push/devices writes
// pushdevice:{userId}:{tokenHash} records), but nothing on the
// server ever sent to them. Every in-app notification now also
// fans out here, from the one funnel every event already uses
// (notifyUser in lib/router.js), so the dispatch events are the
// events themselves: new offers and match alerts, applications
// and selections, check-in, post live, payment milestones, and
// the Build -229 cancel/move events. There is no second list to
// keep in sync: if it writes an in-app note, it pushes.
//
// TRANSPORT: Firebase Cloud Messaging HTTP v1 for the Firebase
// project "Magpie" (project id magpielocal, the project in
// mobile/android/app/google-services.json and
// mobile/ios/App/App/GoogleService-Info.plist). The OAuth2 access
// token comes from a service-account JWT bearer grant, the same
// shape lib/analytics-ga.js uses for GA. FCM delivers to Android
// tokens directly and to iOS tokens through APNs under the hood,
// so no separate APNs .p8 is needed on this route.
//
// ENV GATE (the one Jeff step): FIREBASE_SERVICE_ACCOUNT_JSON
// holds the service account key JSON, stringified, for a service
// account on project magpielocal with the Firebase Cloud
// Messaging sender role. Until it lands, pushConfigured() is
// false, dispatch is a recorded no-op, and the in-app note (the
// guaranteed record) is unaffected. Setting the env var is the
// only step: no code change, no flag to flip by hand.
//
// NON-BLOCKING RULE: dispatchPush() never awaits the network on
// the request path. It starts the sends, tracks them in a pending
// set (tests drain it with flushPush()), and swallows every
// error: push is best-effort, the in-app note is the record.
//
// DEAD TOKENS: an FCM UNREGISTERED /
// registration-token-not-registered answer prunes that device
// record, so a dead token is asked once, never again.
//
// TEST SEAMS (unset in production): FCM_ENDPOINT overrides the
// messages:send URL and FCM_TOKEN_URL overrides the OAuth token
// URL, so the verify suite can run the whole path, JWT grant
// included, against a local stub. PUSH_TEST_TOKEN_URL is not a
// thing: there is deliberately no test-send endpoint.

const crypto = require("crypto");
const store = require("./store");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "magpielocal";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function tokenUrl() {
  return process.env.FCM_TOKEN_URL || "https://oauth2.googleapis.com/token";
}
function fcmEndpoint() {
  return process.env.FCM_ENDPOINT || `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
}

function readServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    return sa && sa.client_email && sa.private_key ? sa : null;
  } catch (e) {
    return null;
  }
}

function pushConfigured() {
  return readServiceAccount() !== null;
}

// Same hash the device route in router.js keys records by.
function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 24);
}

let tokenCache = { token: null, expiresAt: 0 };

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.expiresAt > now + 60) return tokenCache.token;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: sa.client_email, scope: FCM_SCOPE, aud: tokenUrl(), iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claims}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(String(sa.private_key).replace(/\\n/g, "\n")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }).toString(),
  });
  if (!res.ok) throw new Error(`FCM token exchange failed: HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data || !data.access_token) throw new Error("FCM token exchange returned no token");
  tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return tokenCache.token;
}

function isDeadTokenError(status, bodyText) {
  return /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT.*registration token/i.test(String(bodyText || ""));
}

async function sendToDevice(userId, device, note) {
  const sa = readServiceAccount();
  if (!sa) return { sent: false, reason: "not_configured" };
  const accessToken = await getAccessToken(sa);
  const data = {};
  for (const [k, v] of Object.entries(note.data || {})) {
    if (v === null || v === undefined) continue;
    data[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  data.kind = String(note.kind || "");
  data.noteId = String(note.id || "");
  const payload = {
    message: {
      token: device.token,
      notification: { title: "Magpie", body: String(note.text || "").slice(0, 240) },
      data,
      android: { priority: "HIGH" },
      apns: { payload: { aps: { sound: "default" } } },
    },
  };
  const res = await fetch(fcmEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { sent: true };
  const bodyText = await res.text().catch(() => "");
  if (isDeadTokenError(res.status, bodyText)) {
    await store.del(`pushdevice:${userId}:${tokenHash(device.token)}`);
    return { sent: false, reason: "dead_token_pruned" };
  }
  return { sent: false, reason: `fcm_http_${res.status}` };
}

const pending = new Set();
function track(p) {
  pending.add(p);
  p.then(() => pending.delete(p), () => pending.delete(p));
  return p;
}

// Fire-and-forget fan-out for one in-app notification record.
// Reads the user's device records with ONE bounded list (the
// store's list fetches values with bounded concurrency; it is
// never a serial per-key scan), then sends to each device in
// parallel. Returns immediately; delivery settles in the
// background and can never fail the caller's request.
function dispatchPush(userId, note) {
  if (!userId || !note) return;
  if (!pushConfigured()) return; // gated until the credential lands
  const work = (async () => {
    try {
      const rows = await store.list(`pushdevice:${userId}:`);
      const devices = rows.map((r) => r.value).filter((d) => d && d.token);
      if (!devices.length) return;
      await Promise.all(devices.map((d) => sendToDevice(userId, d, note).catch(() => null)));
    } catch (e) { /* best-effort: the in-app note is the record */ }
  })();
  track(work);
}

// Test seam: resolves when every in-flight dispatch has settled.
async function flushPush() {
  while (pending.size) await Promise.allSettled([...pending]);
}

module.exports = { pushConfigured, dispatchPush, flushPush, tokenHash, PROJECT_ID };
