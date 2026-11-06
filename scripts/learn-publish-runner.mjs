// Learn Studio publisher (Build -138, Area 7).
//
// The app enqueues publish jobs (Admin → Learn → Publish); this
// runner is the ops-side half that performs the repo steps of the
// EXISTING pipeline (signl-site/learn/INTEGRATION.md) and reports
// the result back. It never forks the pipeline: the article file
// follows the house pattern the generators read (h1, datePublished
// schema, photo band, audience label), articles-meta.json gets its
// one entry, and build-index.py + build-keep-reading.py do the
// magazine work — including the one-article-one-photo guard, which
// fails the job loudly if it ever trips.
//
// Usage:
//   SIGNL_APP_API=https://app.joinsignl.com/api \
//   SIGNL_VERIFY_TOKEN=... \
//   SIGNL_LEARN_SITE_DIR=~/workspace/signl-site \
//   node scripts/learn-publish-runner.mjs [--no-push] [--once]
//
// --no-push skips the git commit/push and the live check (drills).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const API = (process.env.SIGNL_APP_API || "https://app.joinsignl.com/api").replace(/\/+$/, "");
const TOKEN = process.env.SIGNL_VERIFY_TOKEN || "";
const SITE_DIR = process.env.SIGNL_LEARN_SITE_DIR || path.join(process.env.HOME, "workspace/signl-site");
const NO_PUSH = process.argv.includes("--no-push") || process.env.SIGNL_LEARN_NO_PUSH === "1";
const TOPICS = ["rates-and-pay", "comped-visits", "finding-work", "working-with-creators", "local-marketing", "the-local-scene"];

if (!TOKEN) { console.error("SIGNL_VERIFY_TOKEN is required"); process.exit(2); }

async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { "x-signl-verify-token": TOKEN, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${data.error || ""}`);
  return data;
}

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function articleHtml(siteDir, a) {
  const learnDir = path.join(siteDir, "learn");
  // The site chrome (head skeleton, header, footer) is sliced from
  // a live article at run time, so a studio article always wears
  // the site's current dress — never a runner-side copy of it.
  const templateName = fs.existsSync(path.join(learnDir, "net-90-is-not-a-payment-term.html"))
    ? "net-90-is-not-a-payment-term.html"
    : fs.readdirSync(learnDir).find((f) => f.endsWith(".html") && f !== "index.html");
  const tpl = fs.readFileSync(path.join(learnDir, templateName), "utf8");
  const url = `https://joinsignl.com/learn/${a.slug}.html`;
  const title = `${a.headline} | SIGNL`;
  const description = (a.dek || a.lede || "").slice(0, 300);
  let head = tpl.slice(0, tpl.indexOf("</head>") + "</head>".length);
  head = head
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  // Replace the Article schema with this article's own; drop the
  // template's FAQ schema (a studio article carries none in v1).
  const articleSchema = JSON.stringify({
    "@context": "https://schema.org", "@type": "Article", headline: a.headline, description,
    author: { "@type": "Person", name: a.authorLine === "named" ? "Jeff Rimmer" : "Jeff", jobTitle: "Founder, SIGNL" },
    publisher: { "@type": "Organization", name: "SIGNL", logo: { "@type": "ImageObject", url: "https://joinsignl.com/assets/logo.png" } },
    datePublished: a.date, dateModified: a.date, mainEntityOfPage: url, image: "https://joinsignl.com/assets/og-image.png",
  });
  head = head.replace(/<script type="application\/ld\+json">\{"@context": "https:\/\/schema.org", "@type": "Article"[\s\S]*?<\/script>/, `<script type="application/ld+json">${articleSchema}</script>`);
  head = head.replace(/<script type="application\/ld\+json">\{"@context": "https:\/\/schema.org", "@type": "FAQPage"[\s\S]*?<\/script>/, "");
  head = head.replace(/("position": 3, "name": ")[^"]*(", "item": ")[^"]*(")/, `$1${esc(a.headline)}$2${url}$3`);

  const bodyOpen = tpl.slice(tpl.indexOf("<body>"), tpl.indexOf('<main id="main">'));
  const tail = tpl.slice(tpl.indexOf("</main>") + "</main>".length);
  const audienceLabel = a.audience === "businesses" ? "For businesses · Learn" : a.audience === "both" ? "For creators and businesses · Learn" : "For creators · Learn";
  const bylineName = a.authorLine === "named" ? "Jeff Rimmer" : "Jeff";
  const dateLong = new Date(`${a.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const sections = (a.sections || []).map((s) => `
  <section class="block">
    <div class="wrap">
      ${s.heading ? `<div class="sec-head"><span class="label">${esc(s.heading)}</span></div>` : ""}
      ${(s.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join("\n      ")}
    </div>
  </section>`).join("");
  const main = `<main id="main">
  <section class="hero">
    <div class="photo-band band-top">
      <img src="../assets/photos/${esc(a.heroImage)}" alt="${esc(a.headline)}">
      <div class="band-cap">
        <div class="wrap">
          <div class="cap-big">${esc(a.headline)}</div>
          <div class="cap-small">${esc(a.dek || "")}</div>
        </div>
      </div>
    </div>
    <div class="wrap">
      <span class="label">${audienceLabel}</span>
      <h1>${esc(a.headline)}</h1>
      <p class="lede">${esc(a.lede || "")}</p>
      <p style="font-size:.92rem;color:var(--ink3);margin-bottom:28px">By ${bylineName}, Founder, SIGNL &middot; ${dateLong} &middot; <a href="index.html" class="tx-link">SIGNL Learn hub</a></p>
    </div>
  </section>
${sections}
  <section class="block" id="apply">
    <div class="wrap" style="max-width:800px">
      <span class="label">Get started</span>
      <h2 style="margin:16px 0 14px">Local reach, booked like it should be.</h2>
      <p class="lede" style="margin-bottom:28px">Creators get found by local businesses, ranked by local reach, not follower count. Businesses book the people their customers actually follow.</p>
      <div class="form-wrap" style="text-align:center">
        <p><a class="btn" href="https://app.joinsignl.com/claim">Join SIGNL</a></p>
      </div>
    </div>
  </section>
<!-- KEEP-READING v1 (generated by build-keep-reading.py — do not hand-edit) -->
<!-- /KEEP-READING -->
</main>`;
  return head + "\n" + bodyOpen + main + tail;
}

function heroInUse(siteDir, slug, heroImage) {
  if (!heroImage) return null;
  const learnDir = path.join(siteDir, "learn");
  for (const f of fs.readdirSync(learnDir)) {
    if (!f.endsWith(".html") || f === "index.html" || f === `${slug}.html`) continue;
    const html = fs.readFileSync(path.join(learnDir, f), "utf8");
    const m = html.match(/assets\/photos\/([A-Za-z0-9._-]+)/);
    if (m && m[1] === heroImage) return f;
  }
  return null;
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });
}

async function publish(job) {
  const a = job.article;
  const learnDir = path.join(SITE_DIR, "learn");
  const clash = heroInUse(SITE_DIR, a.slug, a.heroImage);
  if (clash) throw new Error(`That photo is already the face of ${clash}. Every article gets its own photo — pick another.`);
  fs.writeFileSync(path.join(learnDir, `${a.slug}.html`), articleHtml(SITE_DIR, a));
  const metaPath = path.join(learnDir, "articles-meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const entry = { audience: a.audience === "both" ? "creators" : (a.audience || "creators"), dek: a.dek || "" };
  if (TOPICS.includes(a.topic)) entry.topic = a.topic;
  meta[`${a.slug}.html`] = entry;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  run("python3", ["learn/build-index.py"], SITE_DIR);
  run("python3", ["learn/build-keep-reading.py"], SITE_DIR);
  if (!NO_PUSH) {
    run("git", ["add", `learn/${a.slug}.html`, "learn/articles-meta.json", "learn/index.html", "learn"], SITE_DIR);
    run("git", ["commit", "-m", `Learn: ${a.headline} (via Admin Learn Studio)`], SITE_DIR);
    run("git", ["push"], SITE_DIR);
    const res = await fetch(`https://joinsignl.com/learn/${a.slug}.html`, { method: "GET" });
    if (!res.ok) throw new Error(`The article file is pushed but the live page answered ${res.status} — check the deploy.`);
  }
  return `https://joinsignl.com/learn/${a.slug}.html`;
}

const { jobs } = await api("GET", "/internal/learn-jobs");
if (!jobs.length) { console.log("No queued Learn publish jobs."); process.exit(0); }
for (const job of jobs) {
  const claim = await api("POST", `/internal/learn-jobs/${job.id}/claim`);
  if (!claim.ok) { console.log(`Job ${job.id} (${job.slug}): locked by another publisher run — leaving it queued.`); continue; }
  try {
    const url = await publish(job);
    await api("POST", `/internal/learn-jobs/${job.id}/result`, { ok: true, url });
    console.log(`Published: ${url}${NO_PUSH ? " (no-push drill: files written locally only)" : ""}`);
  } catch (e) {
    await api("POST", `/internal/learn-jobs/${job.id}/result`, { ok: false, error: String(e && e.message || e).slice(0, 400) });
    console.log(`Job ${job.id} (${job.slug}) FAILED: ${String(e && e.message || e).slice(0, 300)}`);
  }
}
