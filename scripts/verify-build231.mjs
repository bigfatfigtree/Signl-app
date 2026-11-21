#!/usr/bin/env node
// Build -231 verification:
//   Facebook creator community (live group "Magpie Creators"):
//   profile card + approval email, +10 Momentum once, idempotent.
// Run: node scripts/verify-build231.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8996;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "AdminPass123!";
const REAL_URL = "https://www.facebook.com/groups/1820148515703356";
const OLD_SLUG = "groups/magpiecreators";

let passed = 0, failed = 0, currentPart = "boot";
function part(n){ currentPart=n; }
function check(name, cond, extra=""){ if(cond){passed++; console.log(`  ok [${currentPart}] ${name}`);} else {failed++; console.error(`FAIL [${currentPart}] ${name}${extra?" :: "+String(extra).slice(0,300):""}`);} }

part("static pins");
const appJs = fs.readFileSync(path.join(root,"public/app.js"),"utf8");
const routerJs = fs.readFileSync(path.join(root,"netlify/functions/lib/router.js"),"utf8");
check("GROUP_URL const in router.js with real URL", routerJs.includes(`const GROUP_URL = "${REAL_URL}";`));
check("GROUP_URL const in app.js with real URL", appJs.includes(`const GROUP_URL = "${REAL_URL}";`));
check("old slug absent from router.js", !routerJs.includes(OLD_SLUG));
check("old slug absent from app.js", !appJs.includes(OLD_SLUG));
check("MOMENTUM_POINTS.communityJoin === 10 (source)", /communityJoin:\s*10/.test(routerJs));
check("card strings EN present", appJs.includes("Our brand new Facebook group for creators") && appJs.includes("Join the Magpie creator community") && appJs.includes("Join the group") && appJs.includes("I joined"));
check("card strings ES present", appJs.includes("recién estrenado") && appJs.includes("Únete a la comunidad de creadores de Magpie"));
check("joined line EN+ES present", appJs.includes("You're in · +10 Momentum") && appJs.includes("Ya estás dentro · +10 Momentum"));
check("approvalEmail source includes community line", routerJs.includes("We just opened our brand new Facebook group"));
check("no em dash in new email lines or card strings", (()=>{ const lines=[...routerJs.matchAll(/We just opened our brand new[^\n]*/g), ...routerJs.matchAll(/Once you are in, tap I joined[^\n]*/g)]; const card=[...appJs.matchAll(/Our brand new Facebook group[^\n]*/g), ...appJs.matchAll(/You're in · \+10 Momentum[^\n]*/g)]; return lines.length>=2 && card.length>=2 && [...lines,...card].every(m=>!m[0].includes("—")); })());
check("card wired into both profile assemblies", (appJs.match(/communityCard231Html\(u\)/g)||[]).length>=2);
check("build stamp 231", fs.readFileSync(path.join(root,"netlify/functions/lib/build.js"),"utf8").includes("2026.11.21-231") && fs.readFileSync(path.join(root,"public/index.html"),"utf8").includes("2026.11.21-231"));

part("in-process unit");
process.env.SIGNL_LOCAL="1";
const tmpUnit = fs.mkdtempSync(path.join(os.tmpdir(),"signl-231-unit-"));
process.env.SIGNL_LOCAL_DB = path.join(tmpUnit,"db.json");
const require231 = createRequire(path.join(root,"scripts","verify-build231.mjs"));
const router = require231("../netlify/functions/lib/router.js");
const fakeCreator = { id:"u231a", name:"Casey Creator", email:"c231@fixtures.dev", role:"creator", status:"approved", market:"Hampton Roads", city:"Norfolk", creator:{ handle:"c231", tierBand:"Locals", categories:["Food & Drink"], localAudiencePct:60, followerCount:3000 } };
const mail = router.approvalEmail(fakeCreator, 100);
check("approvalEmail text contains real group URL", mail.text.includes(REAL_URL), mail.text.slice(0,400));
check("approvalEmail text contains brand new Facebook group", mail.text.includes("brand new Facebook group"));
check("approvalEmail text has no em dash", !mail.text.includes("—"));
check("approvalEmail text has no old slug", !mail.text.includes(OLD_SLUG));
const mailUnlisted = router.approvalEmail({ ...fakeCreator, market:"Not listed yet", city:"Tulsa", creator:{...fakeCreator.creator, handle:"tulsa231"} }, 100);
check("approvalEmail (unlisted branch) also contains real URL + community line", mailUnlisted.text.includes(REAL_URL) && mailUnlisted.text.includes("brand new Facebook group") && !mailUnlisted.text.includes("—"));
// Momentum: summaryFor returns {signups, approved, points, campusCrew, campusLead} (no ledger); detailFor returns ledger.
const stamped = { ...fakeCreator, id:"u231b", createdAt:"2026-11-01T00:00:00.000Z", updatedAt:"2026-11-01T00:00:00.000Z", creator:{ ...fakeCreator.creator, communityJoinedAt:"2026-11-21T12:00:00.000Z" } };
const unstamped = { ...fakeCreator, id:"u231c", createdAt:"2026-11-01T00:00:00.000Z", updatedAt:"2026-11-01T00:00:00.000Z", creator:{ ...fakeCreator.creator } };
const mom = router.createMomentum({ users:[stamped, unstamped], bookings:[], posts:[], reviews:[], bizReviews:[] });
const detStamped = mom.detailFor(stamped);
const entry = (detStamped.ledger||[]).find(e=>e.kind==="community_joined");
check("ledger contains community_joined with 10 points", !!entry && entry.points===10, JSON.stringify(detStamped.ledger));
check("summaryFor stamped points = unstamped + 10", mom.summaryFor(stamped).points === mom.summaryFor(unstamped).points + 10, `${mom.summaryFor(unstamped).points} -> ${mom.summaryFor(stamped).points}`);
const detUn = mom.detailFor(unstamped);
check("unstamped creator has no community_joined entry", !(detUn.ledger||[]).some(e=>e.kind==="community_joined"));

// ---------- live HTTP ----------
part("live HTTP");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),"signl-231-"));
const dbFile = path.join(tmp,"db.json");
let server=null;
function startServer(){ server=spawn("node",["scripts/dev-server.mjs",String(PORT)],{cwd:root, env:{...process.env, SIGNL_LOCAL:"1", SIGNL_LOCAL_DB:dbFile, SIGNL_TEST_ALLOW_BUSINESS:"1", APP_URL:BASE, ADMIN_EMAIL, ADMIN_PASSWORD}, stdio:["ignore","pipe","pipe"]}); server.stderr.on("data",d=>process.stderr.write("[server] "+d)); }
async function stopServer(){ if(!server) return; server.kill("SIGTERM"); await new Promise(r=>setTimeout(r,400)); server=null; }
async function waitUp(){ for(let i=0;i<60;i++){ try{ const r=await fetch(`${BASE}/api/bootstrap`); if(r.ok) return; }catch(e){} await new Promise(r=>setTimeout(r,250)); } throw new Error("server did not come up"); }
function makeClient(){ const jar=new Map(); const ch=()=>[...jar.entries()].map(([k,v])=>`${k}=${v}`).join("; "); async function api(method,p,body){ const headers={"Content-Type":"application/json"}; const c=ch(); if(c) headers.Cookie=c; const res=await fetch(BASE+p,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}); const sc=res.headers.get("set-cookie"); if(sc) for(const part of sc.split(/,(?=[^;]+=)/)){ const m=part.trim().match(/^([^=]+)=([^;]*)/); if(m){ if(m[2]) jar.set(m[1],m[2]); else jar.delete(m[1]); } } const text=await res.text(); let data=null; try{data=JSON.parse(text);}catch(e){} return {status:res.status,data,text}; } return api; }
const uniq=()=>Math.random().toString(36).slice(2,9);
startServer(); await waitUp();
const admin=makeClient(); { const r=await admin("POST","/api/auth/login",{email:ADMIN_EMAIL,password:ADMIN_PASSWORD}); check("admin login", r.status===200); }
const creator=makeClient();
const cEmail=`c231-${uniq()}@fixtures.dev`;
const rYes=await creator("POST","/api/auth/register",{role:"creator", name:"Casey Creator", email:cEmail, password:"LongEnough1!", market:"Hampton Roads", city:"Norfolk", handle:`c231_${uniq()}`, categories:["Food & Drink"], followerCount:3000, localAudiencePct:60, agreedTerms:true, agreedPostCompliance:true});
check("creator registration succeeds (201)", rYes.status===201, JSON.stringify(rYes.data).slice(0,200));
const creatorId=rYes.data.user.id;
await admin("POST","/api/admin/review",{userId:creatorId, decision:"approve"});
// login fresh after approval
const creator2=makeClient(); await creator2("POST","/api/auth/login",{email:cEmail,password:"LongEnough1!"});
const g1=await creator2("GET","/api/me/community");
check("GET /me/community joined false, real URL, points 10", g1.status===200 && g1.data.community && g1.data.community.joined===false && g1.data.community.groupUrl===REAL_URL && g1.data.community.points===10, JSON.stringify(g1.data).slice(0,250));
const p1=await creator2("POST","/api/me/community");
check("POST /me/community awarded 10, joined true", p1.status===200 && p1.data.awarded===10 && p1.data.community.joined===true, JSON.stringify(p1.data).slice(0,250));
const db1=JSON.parse(fs.readFileSync(dbFile,"utf8"));
const stamp1=db1[`user:${creatorId}`].creator.communityJoinedAt;
check("db creator.communityJoinedAt is set", !!stamp1, stamp1);
check("POST response user carries communityJoinedAt", !!(p1.data.user && p1.data.user.creator && p1.data.user.creator.communityJoinedAt));
const p2=await creator2("POST","/api/me/community");
check("POST again awarded 0 (idempotent)", p2.status===200 && p2.data.awarded===0, JSON.stringify(p2.data).slice(0,200));
const db2=JSON.parse(fs.readFileSync(dbFile,"utf8"));
check("communityJoinedAt unchanged after repeat", db2[`user:${creatorId}`].creator.communityJoinedAt===stamp1);
// business 403
const biz=makeClient();
const rBiz=await biz("POST","/api/auth/register",{role:"business", name:"Biz Owner", email:`b231-${uniq()}@fixtures.dev`, password:"LongEnough1!", market:"Hampton Roads", city:"Norfolk", businessName:"Fixall Kitchen", category:"Restaurant", planId:"self-service", agreedTerms:true});
check("business registration succeeds", rBiz.status===201, JSON.stringify(rBiz.data).slice(0,200));
if(rBiz.data && rBiz.data.user) await admin("POST","/api/admin/review",{userId:rBiz.data.user.id, decision:"approve"});
const biz2=makeClient(); if(rBiz.data && rBiz.data.user) await biz2("POST","/api/auth/login",{email:rBiz.data.user.email,password:"LongEnough1!"});
const bp=await biz2("POST","/api/me/community");
check("business POST /me/community -> 403", bp.status===403, `${bp.status} ${JSON.stringify(bp.data).slice(0,150)}`);
const bg=await biz2("GET","/api/me/community");
check("business GET /me/community -> 403", bg.status===403, `${bg.status}`);
await stopServer();
console.log(`\nverify-build231: ${passed} passed, ${failed} failed`);
process.exit(failed?1:0);
