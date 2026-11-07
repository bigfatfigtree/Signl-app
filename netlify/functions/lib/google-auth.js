// Google sign-in (Build -123, Jeff, 2026-11-04: "Yes Google sign
// in as well. And yes instagram link and all social linking your
// profile for verification and connection is what should be
// built").
//
// One Google OAuth 2.0 authorization-code flow, three doors:
//   signin — the sign-in screen's "Continue with Google"
//   apply  — the join/claim entry points' "Continue with Google"
//   link   — Settings → Connected accounts, for an account that
//            already exists (the router binds the state to the
//            signed-in user; a link state can only ever complete
//            for that same user)
// The flow itself lives here; every account decision (match by
// Google subject, match by verified email, never duplicate, never
// bypass application approval) lives in the router, next to the
// register/login handlers it extends.
//
// ENV GATE — exactly like the other rails (Stripe, Square, Meta):
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET turn the lane on, and
// GOOGLE_REDIRECT_URI may override the redirect (default
// {APP_URL}/api/auth/google/callback). With the env absent,
// googleConfigured() is false: the client hides the button, start
// bounces back /?google=unavailable, and email/password plus the
// sign-in link work exactly as they always have. Flipping it on
// is Jeff's Google Cloud step (one web OAuth client, the redirect
// URI registered, the YouTube Data API enabled for the sibling
// YouTube connect in lib/platform-connect.js, which reads its
// own GOOGLE_OAUTH_* env pair).
//
// SECURITY SHAPE: authorization-code flow with PKCE (S256) and a
// single-use, 10-minute state record that also carries the OIDC
// nonce. The ID token is verified for real — RS256 signature
// against Google's JWKS, issuer, audience, expiry, nonce — never
// trusted on arrival. Only the Google subject id + email are ever
// stored on the user record (router side); tokens from the
// exchange are used once and discarded.
//
// APPLY PREFILL: a Google identity with no Magpie account does not
// get an account created for it by the callback (an application
// needs a market, a handle, the Terms — the form's job). The
// callback instead issues a short-lived prefill token (30
// minutes, SHA-256 hash at rest, the pwreset pattern): the client
// lands back on the join form with name/email prefilled, and the
// register call that follows consumes the token and links the
// Google identity to the account it creates.
//
// TEST SEAMS (unset in production): GOOGLE_SIGNIN_AUTH_URL /
// GOOGLE_SIGNIN_TOKEN_URL / GOOGLE_SIGNIN_JWKS_URL override the
// Google endpoints so the verify suite can run the whole flow,
// ID-token verification included, against a local stub.

const crypto = require("crypto");
const store = require("./store");

const GOOGLE_SCOPE = "openid email profile";
const STATE_TTL_MS = 1000 * 60 * 10;
const PREFILL_TTL_MS = 1000 * 60 * 30;

function appBaseUrl() {
  return (process.env.APP_URL || "https://app.magpielocal.com").replace(/\/+$/, "");
}

// One Google Cloud project serves sign-in and YouTube connect:
// the sign-in pair falls back to the platform pair
// (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) when
// unset, mirroring platform-connect.js.
function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || "";
}
function googleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
}

function googleConfigured() {
  return !!(googleClientId() && googleClientSecret());
}

function googleRedirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return `${appBaseUrl()}/api/auth/google/callback`;
}

function googleAuthUrlBase() {
  return process.env.GOOGLE_SIGNIN_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
}
function googleTokenUrl() {
  return process.env.GOOGLE_SIGNIN_TOKEN_URL || "https://oauth2.googleapis.com/token";
}
function googleJwksUrl() {
  return process.env.GOOGLE_SIGNIN_JWKS_URL || "https://www.googleapis.com/oauth2/v3/certs";
}

// ---------- OAuth state (single-use, short-lived, PKCE-bound) ----------

function pkceChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

async function createGoogleState({ mode, userId }) {
  const token = crypto.randomBytes(24).toString("hex");
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const nonce = crypto.randomBytes(16).toString("hex");
  await store.set(`gstate:${token}`, {
    mode: mode || "signin",
    userId: userId || null,
    codeVerifier,
    nonce,
    createdAt: Date.now(),
  });
  return { token, codeVerifier, nonce };
}

async function consumeGoogleState(token) {
  if (!token || typeof token !== "string") return null;
  const rec = await store.get(`gstate:${token}`);
  if (!rec) return null;
  await store.del(`gstate:${token}`);
  if (Date.now() - (rec.createdAt || 0) > STATE_TTL_MS) return null;
  return rec;
}

function buildGoogleAuthUrl(stateToken, codeVerifier, nonce) {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: stateToken,
    nonce: nonce || "",
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
  });
  return `${googleAuthUrlBase()}?${params.toString()}`;
}

// ---------- code exchange ----------

async function exchangeGoogleCode(code, codeVerifier) {
  const res = await fetch(googleTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }).toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.id_token) {
    throw new Error(`Google token request failed (HTTP ${res.status})`);
  }
  return data; // { access_token, id_token, expires_in, ... } — the router keeps only the verified identity.
}

// ---------- ID token verification (RS256 against Google's JWKS) ----------

let jwksCache = { url: null, keys: [], fetchedAt: 0 };

async function fetchJwks(force) {
  const url = googleJwksUrl();
  if (!force && jwksCache.url === url && jwksCache.keys.length && Date.now() - jwksCache.fetchedAt < 1000 * 60 * 60) {
    return jwksCache.keys;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google JWKS request failed (HTTP ${res.status})`);
  const data = await res.json().catch(() => null);
  const keys = data && Array.isArray(data.keys) ? data.keys : [];
  if (!keys.length) throw new Error("Google JWKS response carried no keys");
  jwksCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}

function b64urlJson(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

// Verifies the ID token end to end and returns the identity the
// router is allowed to act on. Throws on anything off: the
// callback treats every throw the same way (back to sign-in with
// a plain error), so a forged or stale token can never become a
// session, a link, or a prefill.
async function verifyGoogleIdToken(idToken, expectedNonce) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed Google ID token");
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (!header || header.alg !== "RS256" || !header.kid) throw new Error("Unexpected Google ID token header");
  let keys = await fetchJwks(false);
  let jwk = keys.find((k) => k && k.kid === header.kid);
  if (!jwk) { keys = await fetchJwks(true); jwk = keys.find((k) => k && k.kid === header.kid); }
  if (!jwk) throw new Error("Google ID token signing key not found");
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  const signature = Buffer.from(parts[2], "base64url");
  if (!crypto.verify("RSA-SHA256", signed, key, signature)) throw new Error("Google ID token signature did not verify");
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") throw new Error("Google ID token issuer mismatch");
  if (payload.aud !== googleClientId()) throw new Error("Google ID token audience mismatch");
  if (!payload.exp || Date.now() >= payload.exp * 1000) throw new Error("Google ID token expired");
  if (expectedNonce && payload.nonce !== expectedNonce) throw new Error("Google ID token nonce mismatch");
  if (!payload.sub || !payload.email) throw new Error("Google ID token carried no identity");
  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    // Account matching by email is only ever allowed on a
    // Google-verified address (the router enforces it).
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : "",
  };
}

// ---------- apply prefill tokens (hash at rest, the pwreset pattern) ----------

function prefillHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

async function issueGooglePrefill(identity) {
  const token = crypto.randomBytes(32).toString("hex");
  const created = new Date().toISOString();
  await store.set(`glink:${prefillHash(token)}`, {
    sub: identity.sub,
    email: identity.email,
    name: identity.name || "",
    createdAt: created,
    expiresAt: new Date(Date.now() + PREFILL_TTL_MS).toISOString(),
  });
  return token;
}

async function peekGooglePrefill(token) {
  if (!token || typeof token !== "string") return null;
  const rec = await store.get(`glink:${prefillHash(token)}`);
  if (!rec) return null;
  if (Date.now() > Date.parse(rec.expiresAt)) {
    await store.del(`glink:${prefillHash(token)}`);
    return null;
  }
  return rec;
}

async function consumeGooglePrefill(token) {
  const rec = await peekGooglePrefill(token);
  if (!rec) return null;
  await store.del(`glink:${prefillHash(token)}`);
  return rec;
}

module.exports = {
  appBaseUrl,
  googleConfigured,
  googleRedirectUri,
  buildGoogleAuthUrl,
  createGoogleState,
  consumeGoogleState,
  exchangeGoogleCode,
  verifyGoogleIdToken,
  issueGooglePrefill,
  peekGooglePrefill,
  consumeGooglePrefill,
};
