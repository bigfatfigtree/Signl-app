#!/usr/bin/env node
// Build -203 fixture suite: the full UX compaction pass.
// Jeff (2026-11-18): "want everywhere compacted it can be.
// All dashboards including creators, businesses and partners."
// Build -199/-201 compacted Admin Stats and a few role stats;
// -203 extends the same kit to every dashboard: growable lists
// are capped behind the kit's Show all toggle, and the four
// record tables Jeff's 2026-10-25 order had kept stacked
// (Applications, Finish Engine roster, Events log, Admin
// creators list) are now capped at 12 rows behind Show all —
// Jeff explicitly superseded that order on 2026-11-18. The
// stacked record rendering itself, every row action, counting,
// pricing, data and artwork are unchanged: the caps only stamp
// .ux-extra + hidden on items past the cap, all still in the
// DOM one tap away. Rendered before/after number parity is
// proven in the build's QA record; this suite pins the wiring.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const fnSlice = (name, len = 9000) => { const i = appJs.indexOf(`function ${name}`); return i < 0 ? "" : appJs.slice(i, i + len); };

console.log("== source: build stamp consistency ==");
const bid = (buildJs.match(/exports\.BUILD_ID = "([^"]+)"/) || [])[1];
check("BUILD_ID present", !!bid);
check("BUILD_ID is the shipping stamp", bid === "2026.11.18-207", bid);
check("shell stamp matches BUILD_ID everywhere", !!bid && indexHtml.includes(`window.__SIGNL_BUILD__ = "${bid}"`) && (indexHtml.match(new RegExp(bid.replace(/\./g, "\\."), "g")) || []).length >= 5);

console.log("== source: the -203 cap helpers over the -199 kit ==");
check("uxMark203 / uxCap203 / uxGrid203 exist", appJs.includes("function uxMark203(html, hide)") && appJs.includes("function uxCap203(htmls, cap)") && appJs.includes("function uxGrid203(htmls, cap, gridCls)"));
check("helpers stamp the kit's hidden class", appJs.includes('class="$1 ux-extra"') && appJs.includes("ux-extra\" hidden"));
check("caps ride the kit's Show all button", appJs.includes("uxMoreBtn(list.length)"));
check("helpers fetch and count nothing", !/function ux(Mark203|Cap203|Grid203)\([\s\S]{0,900}?api\(/.test(appJs));
check("the -199 kit is still intact", appJs.includes("function uxMoreBtn(total)") && appJs.includes("function uxFold(btn)") && appJs.includes('"src197SetWin", "ux-seg199"'));

console.log("== source: the four record tables are capped (stacked rendering kept) ==");
check("applications table keeps its stacked markup (no ct199)", appJs.includes('<table class="apps-table">') && !appJs.includes("apps-table ct199"));
check("applications rows capped at 12 behind Show all", appJs.includes("uxMark203(row(u), i203 >= 12)") && fnSlice("adminAppListHtml187", 3000).includes("uxMoreBtn(list.length)"));
check("finish roster rows capped at 12", fnSlice("adminFinishPanelHtml", 5000).includes("ri203 >= 12") && fnSlice("adminFinishPanelHtml", 7000).includes("uxMoreBtn((d.roster || []).length)"));
check("events rows capped at 12 with a button slot", fnSlice("adminEventsRenderRows", 3000).includes("xi203 >= 12") && fnSlice("loadEvents", 3000).includes('id="ev-morebtn"') && fnSlice("loadEvents", 3000).includes("data-uxmore"));
check("events log keeps its stacked markup (no ct199)", !appJs.includes("ev-table ct199"));
check("admin creators rows capped at 12", fnSlice("adminCreators130RowsHtml", 4000).includes("ui203 >= 12") && fnSlice("adminCreators130RowsHtml", 4000).includes("uxMoreBtn(rows.length)"));
check("admin creators table keeps its stacked markup (no ct199)", !/adminCreators130RowsHtml[\s\S]{0,4000}ct199/.test(fnSlice("adminCreators130RowsHtml", 4000)));

console.log("== source: creator surfaces capped ==");
check("my applications capped at 8", fnSlice("loadMyApplications", 6000).includes("uxCap203(apps.map((a)") && fnSlice("loadMyApplications", 8000).includes("), 8);"));
check("my visits capped at 8", appJs.includes("uxCap203(rows.map((b) => visitsRowWrap(b, role, seg)), 8)"));
check("creator offers booked/done visits capped at 6", appJs.includes('uxCap203(rows.map((b) => visitsRowWrap(b, "creator", visitSegOf(b, "creator"))), 6)'));
check("find offers grids capped at 9", (appJs.match(/uxGrid203\(/g) || []).length >= 4 && appJs.includes('9, "mirror-grid"'));
check("wallet lists capped", appJs.includes("uxCap203(pendingBk.map(bkRow119), 8)") && appJs.includes("uxCap203(hist.map(histRow), 10)") && appJs.includes("uxCap203(couponBookings.map(couponRow), 8)"));

console.log("== source: business surfaces capped ==");
check("business offer list capped at 8", appJs.includes("uxCap203(rows.map((o) => offerCardHtml(o)), 8)"));
check("applicant stack capped at 8", appJs.includes("uxCap203(apps.map((a) => applicantCardHtml(o, a)), 8)"));
check("requests tab capped at 8", appJs.includes("uxCap203(rows.map(reqRowHtml), 8)"));
check("regulars capped at 8", appJs.includes("uxCap203(rows.map(regularRowHtml), 8)"));
check("content library capped at 8", fnSlice("libRowsHtml", 4000).includes("uxCap203(rows.map((r)") && fnSlice("libRowsHtml", 4000).includes("), 8)"));
check("settings referral panel folds shut (secondary panel)", appJs.includes('data-uxfold>\n    <div class="uxfold-bar"><h3 style="margin:0">Your referral program</h3>') && appJs.includes('onclick="saveMyReferralProgram()"'));

console.log("== source: partner surfaces capped ==");
check("partner creators capped at 8", fnSlice("partnerCreatorsHtml", 3000).includes("uxCap203(rows.map((c)") && fnSlice("partnerCreatorsHtml", 3000).includes("), 8)"));
check("partner businesses capped at 8", fnSlice("partnerBusinessesHtml", 3000).includes("uxCap203(rows.map((b)") && fnSlice("partnerBusinessesHtml", 3000).includes("), 8)"));
check("partner links capped at 6", fnSlice("partnerLinksHtml", 5000).includes("uxCap203(d.links.map((l)") && fnSlice("partnerLinksHtml", 5000).includes("), 6)"));
check("team seats capped at 8", appJs.includes("uxCap203(live.map(row), 8)") && appJs.includes('uxCap203(seats.filter((s) => s.status === "revoked").map(row), 8)'));

console.log("== source: admin + recruiter surfaces capped ==");
check("message thread list capped at 10", fnSlice("threadItemsHtml", 5000).includes("ti203 >= 10"));
check("admin conversations capped at 10", appJs.includes("threadRowsArr203") && appJs.includes("uxCap203(threadRowsArr203, 10)"));
check("sent-to-many campaigns capped at 6", appJs.includes("rowsArr203") && appJs.includes("uxCap203(rowsArr203, 6)"));
check("broadcast threads capped at 8", fnSlice("bc153DetailHtml", 5000).includes("uxCap203(d.threads.map((t)") && fnSlice("bc153DetailHtml", 5000).includes("), 8)"));
check("recruiter queue capped at 10", appJs.includes("uxCap203(rows.map(rcProspectCardHtml), 10)"));
check("cap call sites across the app", (appJs.match(/uxCap203\(/g) || []).length >= 24, String((appJs.match(/uxCap203\(/g) || []).length));

console.log("== source: protected surfaces untouched ==");
check("Maggie artwork wiring intact", appJs.includes("MAGGIE_CHAR") && appJs.includes("maggie-logo"));
check("no new request-path awaits in the helpers", !/async function ux(Mark203|Cap203|Grid203)/.test(appJs));

console.log(`\nverify-build203: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
