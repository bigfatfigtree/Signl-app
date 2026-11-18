// QA seed for Build -138 rendered QA: boots fixtures over the API.
const BASE = "http://127.0.0.1:9016";
const PW = "<MASKED_SECRET_001>";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
function client() {
  let cookie = "";
  return async (method, p, body) => {
    const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; if (pair.includes("=")) cookie = pair; }
    const t = await res.text();
    try { return { status: res.status, data: JSON.parse(t) }; } catch { return { status: res.status, data: null }; }
  };
}
const admin = client();
await admin("POST", "/api/auth/login", { email: "admin@qa138.dev", password: "<MASKED_SECRET_004>" });
const approve = (id) => admin("POST", "/api/admin/review", { userId: id, decision: "approve" });

const bz = client();
const breg = await bz("POST", "/api/auth/register", { role: "business", name: "Bea Baker", email: "biz@qa138.dev", password: PW, market: "Hampton Roads", city: "Norfolk", businessName: "Tray Test Tacos", category: "Restaurant", planId: "self-service", agreedTerms: true });
await approve(breg.data.user.id);
await admin("POST", "/api/admin/businesses/activate", { userId: breg.data.user.id });
console.log("business:", breg.data.user.id);

const specs = [
  { tag: "alpha", name: "Alpha Avery", followers: 12380, pct: 84 },
  { tag: "bravo", name: "Bravo Blair", followers: 16353, pct: 85 },
  { tag: "charlie", name: "Charlie Chase", followers: 8000, pct: 62 },
];
for (const s of specs) {
  const c = client();
  const r = await c("POST", "/api/auth/register", { role: "creator", name: s.name, email: `${s.tag}@qa138.dev`, password: PW, market: "Hampton Roads", city: "Norfolk", handle: `${s.tag}qa`, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: s.followers, avgViews: 2000, localAudiencePct: s.pct, ...AGREE });
  await approve(r.data.user.id);
  await c("PATCH", "/api/me/profile", { paidRate: 120 });
  const fav = await bz("POST", "/api/favorites", { creatorId: r.data.user.id });
  console.log("creator:", s.tag, r.data.user.id, "fav:", fav.status, JSON.stringify(fav.data).slice(0, 80));
}
// Unlisted creator (Fargo), approved, complete profile.
const u = client();
const ureg = await u("POST", "/api/auth/register", { role: "creator", name: "Fargo Fran", email: "fran@qa138.dev", password: PW, market: "Not listed yet", customCity: "Fargo", customState: "ND", customCountry: "United States", handle: "franqa", categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 4000, avgViews: 900, localAudiencePct: 71, ...AGREE });
await approve(ureg.data.user.id);
console.log("unlisted creator:", ureg.data.user.id, ureg.data.user.market, ureg.data.user.city);
console.log("SEED DONE");
