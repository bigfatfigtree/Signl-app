// Auth: scrypt password hashing and opaque session tokens stored
// server-side. No third-party identity service.
const crypto = require("crypto");
const store = require("./store");

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  await store.set(`session:${token}`, {
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  });
  return token;
}

async function getSessionUser(token) {
  if (!token) return null;
  const session = await store.get(`session:${token}`);
  if (!session) return null;
  if (Date.now() > Date.parse(session.expiresAt)) {
    await store.del(`session:${token}`);
    return null;
  }
  const user = await store.get(`user:${session.userId}`);
  return user || null;
}

async function destroySession(token) {
  if (token) await store.del(`session:${token}`);
}

async function getSessionRecord(token) {
  if (!token) return null;
  const session = await store.get(`session:${token}`);
  if (!session) return null;
  if (Date.now() > Date.parse(session.expiresAt)) {
    await store.del(`session:${token}`);
    return null;
  }
  return session;
}

// View-as sessions (Build -67, Jeff, 2026-11-01): an admin looking
// at a real business's account exactly as the owner sees it. The
// session's userId is the BUSINESS's id, so every read renders the
// business's real data through the normal paths; the viewAs marker
// is what makes it safe: the router refuses every non-GET request
// on a view session server-side, and the exit path trades this
// token back for the admin's own (still-live) session token, which
// is carried inside the record and never reaches the client as
// data. Two hours, then it expires like any session.
const VIEW_SESSION_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours

// Build -126 generalises the same machinery to the two other
// preview targets Admin home offers: the approved TEST creator
// and the seeded DEMO partner. businessId/businessName stay on
// business views (Build -67's contract, pinned by its suite);
// every view also carries targetId/role/label so the banner and
// the audit log can speak plainly about any role.
async function createViewSession({ adminUser, adminToken, businessUser, targetUser, label, role }) {
  const target = targetUser || businessUser;
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const biz = businessUser ? businessUser.business || {} : {};
  const name = businessUser
    ? biz.businessName || businessUser.name || "Business"
    : label || target.name || "Account";
  const viewAs = {
    adminId: adminUser.id,
    adminEmail: adminUser.email,
    adminSessionToken: adminToken,
    targetId: target.id,
    role: role || target.role || "business",
    label: name,
    enteredAt: new Date(now).toISOString(),
  };
  if (businessUser) {
    viewAs.businessId = businessUser.id;
    viewAs.businessName = name;
  }
  await store.set(`session:${token}`, {
    userId: target.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + VIEW_SESSION_TTL_MS).toISOString(),
    viewAs,
  });
  return token;
}

// Revoke every session a user holds (password reset / password
// change: the credential changed, so every other device signs out).
// exceptToken keeps the caller's own session alive on a voluntary
// change; a reset passes nothing and revokes all of them.
async function revokeSessionsForUser(userId, exceptToken) {
  const sessions = await store.list("session:");
  let revoked = 0;
  for (const s of sessions) {
    if (s.value && s.value.userId === userId) {
      const token = s.key.slice("session:".length);
      if (exceptToken && token === exceptToken) continue;
      await store.del(s.key);
      revoked += 1;
    }
  }
  return revoked;
}

function sessionCookie(token, secure) {
  const parts = [
    `signl_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(secure) {
  const parts = ["signl_session=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// The one admin account. Created on first boot from env vars:
//   ADMIN_EMAIL     (default jeff@magpielocal.com)
//   ADMIN_PASSWORD  (required to enable admin sign-in; never stored in code)
// Perf (2026-10-28): once a warm container has seen the admin index
// record, skip the store read on later requests. The account is
// append-only in practice; a cold container still checks the store,
// so a fresh deploy behaves exactly as before.
let adminIndexSeen = false;
async function ensureAdmin(logEvent) {
  if (adminIndexSeen) return;
  const email = (process.env.ADMIN_EMAIL || "jeff@magpielocal.com").toLowerCase();
  const existing = await store.get(`email:${email}`);
  if (existing) { adminIndexSeen = true; return; }
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return; // Admin sign-in stays disabled until Jeff sets it.
  const { salt, hash } = hashPassword(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await store.set(`user:${id}`, {
    id,
    role: "admin",
    email,
    name: "Jeff Rimmer",
    passwordSalt: salt,
    passwordHash: hash,
    status: "approved",
    createdAt: now,
    updatedAt: now,
  });
  await store.set(`email:${email}`, { userId: id });
  adminIndexSeen = true;
  if (logEvent) {
    await logEvent({
      type: "admin_bootstrapped",
      actorId: id,
      actorRole: "admin",
      market: null,
      data: { email },
    });
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  getSessionRecord,
  createViewSession,
  destroySession,
  revokeSessionsForUser,
  sessionCookie,
  clearCookie,
  parseCookies,
  ensureAdmin,
};
