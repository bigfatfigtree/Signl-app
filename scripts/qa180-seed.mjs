// QA seed for Build -180 rendered checks: three fixture accounts
// on the dev server named by QA180_BASE.
//   chelsea@fixtures.dev / chelsea-pass-123 — DUAL (business approved + creator approved)
//   carol@fixtures.dev   / carol-pass-123   — creator only (add-side subject)
//   dana@fixtures.dev    / dana-pass-123    — business only, approved (claim-flow subject)
const BASE = process.env.QA180_BASE || "http://127.0.0.1:8961";
function client() {
  const jar = new Map();
  return async (method, p, body) => {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}
const admin = client();
const al = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
if (al.status !== 200) throw new Error("admin login failed " + al.status);

// Chelsea: business first (approved), then claim the creator side.
const biz = await client()("POST", "/api/auth/register", { role: "business", name: "Chelsea Fixture", email: "chelsea@fixtures.dev", password: "chelsea-pass-123", businessName: "Fixture Friday Furniture", category: "Retail", market: "Nashville", city: "Nashville", agreedTerms: true });
await admin("POST", "/api/admin/review", { userId: biz.data.user.id, decision: "approve" });
const claim = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "chelsea@fixtures.dev", password: "chelsea-pass-123", handle: "fixturefriday", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true });
await admin("POST", "/api/admin/review", { userId: claim.data.user.id, decision: "approve" });
console.log("chelsea dual ready:", biz.data.user.id, claim.data.user.id);

// Carol: creator only.
const carol = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "carol@fixtures.dev", password: "carol-pass-123", handle: "carolfixture", primaryPlatform: "tiktok", market: "Nashville", agreedTerms: true });
await admin("POST", "/api/admin/review", { userId: carol.data.user.id, decision: "approve" });
console.log("carol creator ready:", carol.data.user.id);

// Dana: business only, approved — her creator claim is still open.
const dana = await client()("POST", "/api/auth/register", { role: "business", name: "Dana Fixture", email: "dana@fixtures.dev", password: "dana-pass-123", businessName: "Dana Fixture Salon", category: "Beauty & Spas", market: "Nashville", city: "Nashville", agreedTerms: true });
await admin("POST", "/api/admin/review", { userId: dana.data.user.id, decision: "approve" });
console.log("dana business ready:", dana.data.user.id);
