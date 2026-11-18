const BASE = "http://127.0.0.1:9016";
let cookie = "";
const call = async (m, p, b) => {
  const res = await fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const line of sc) { const pair = line.split(";")[0]; if (pair.includes("=")) cookie = pair; }
  return { status: res.status, data: await res.json().catch(() => null) };
};
await call("POST", "/api/auth/login", { email: "biz@qa138.dev", password: "<MASKED_SECRET_001>" });
const disc = await call("GET", "/api/discover?market=" + encodeURIComponent("Hampton Roads"));
const ids = (disc.data.creators || []).map((c) => c.userId);
console.log("discover creators:", ids.length);
for (const id of ids) { const f = await call("POST", "/api/favorites", { creatorId: id }); console.log("fav", id.slice(0, 8), f.status); }
