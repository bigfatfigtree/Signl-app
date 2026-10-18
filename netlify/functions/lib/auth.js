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
//   ADMIN_EMAIL     (default jeff@joinsignl.com)
//   ADMIN_PASSWORD  (required to enable admin sign-in; never stored in code)
async function ensureAdmin(logEvent) {
  const email = (process.env.ADMIN_EMAIL || "jeff@joinsignl.com").toLowerCase();
  const existing = await store.get(`email:${email}`);
  if (existing) return;
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
  destroySession,
  sessionCookie,
  clearCookie,
  parseCookies,
  ensureAdmin,
};
