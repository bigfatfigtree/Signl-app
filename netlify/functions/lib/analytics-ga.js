// GA4 Data API read path for the Admin Stats "Website" section
// (Build -138, Area 5 of the admin-expansion spec).
//
// GA4 property G-0V1YPFCTSD has been installed on the site and the app
// since 2026-10-21 and is collecting standard page data. This module is
// the read side: it calls the GA4 Data API (runReport) server-side only,
// using a Google service account, and aggregates the rows into the small
// set of numbers the Stats "Website" section shows.
//
// Env contract (Netlify env, set through the secure env entry):
//   GA4_PROPERTY_ID          numeric GA4 property id (NOT the G- measurement id)
//   GA_SERVICE_ACCOUNT_JSON  the service account key JSON, stringified
// The service account needs Viewer access on the GA property. If either
// var is unset (or the JSON does not parse), the module reports an honest
// not_connected state — it never fabricates numbers.
//
// Zero new dependencies: Node >= 18 global fetch + node:crypto only.
// The OAuth2 token comes from the service-account JWT bearer flow
// (RS256-signed JWT exchanged at Google's token endpoint); no SDK.
//
// Caching: successful reports are stored in the app store under
// gacache:{sha1(from|to|compare|group)} and served for 1 hour so Stats
// never hammers the Data API. On any live-read failure, a cached report
// (any age) is returned with stale: true and its ORIGINAL asOf — a failed
// read never dresses a stale value up as current, and never invents one.

const crypto = require("crypto");
const store = require("./store");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const NOT_CONNECTED_NOTE =
  "Website numbers aren't connected yet — they need the analytics hookup " +
  "(a Google service account with Viewer access on the GA property).";

// In-memory access-token cache (per function instance). Google tokens
// live ~1 hour; we keep a 60s safety margin so a token never expires
// mid-request.
let tokenCache = { token: null, expiresAt: 0 };

function readServiceAccount() {
  const raw = process.env.GA_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function configured() {
  if (!process.env.GA4_PROPERTY_ID) return false;
  return readServiceAccount() !== null;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.expiresAt > now + 60) {
    return tokenCache.token;
  }

  // JWT bearer flow: sign a short-lived JWT with the service account's
  // private key, then exchange it for an access token. The JSON key file
  // stores the PEM with literal "\n" escapes, so unescape before signing.
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = header + "." + claims;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer
    .sign(String(sa.private_key).replace(/\\n/g, "\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = unsigned + "." + signature;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error("GA token exchange failed: HTTP " + res.status);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("GA token exchange returned no token");
  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600),
  };
  return tokenCache.token;
}

// The group filter is applied server-side as a GA dimensionFilter, so the
// API does the grouping — this module never re-counts rows client-side to
// decide which group a page belongs to (spec, Area 5).
function groupFilter(group) {
  const beginsLearn = {
    filter: {
      fieldName: "pagePath",
      stringFilter: { matchType: "BEGINS_WITH", value: "/learn/" },
    },
  };
  switch (group) {
    case "learn":
      return beginsLearn;
    case "marketing":
      return {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "hostName",
                stringFilter: { matchType: "EXACT", value: "joinsignl.com" },
              },
            },
            { notExpression: beginsLearn },
          ],
        },
      };
    case "app":
      return {
        filter: {
          fieldName: "hostName",
          stringFilter: { matchType: "EXACT", value: "app.joinsignl.com" },
        },
      };
    case "all":
    default:
      return null;
  }
}

async function runReport(token, from, to, group) {
  const body = {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [
      { name: "hostName" },
      { name: "pagePath" },
      { name: "sessionDefaultChannelGroup" },
    ],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "newUsers" },
      { name: "screenPageViews" },
      { name: "conversions" },
    ],
    // One call returns every row for the range; 100k is far above what
    // this property produces, and aggregation happens below.
    limit: "100000",
  };
  const filter = groupFilter(group);
  if (filter) body.dimensionFilter = filter;

  const url =
    DATA_API +
    "/properties/" +
    encodeURIComponent(process.env.GA4_PROPERTY_ID) +
    ":runReport";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error("GA runReport failed: HTTP " + res.status);
  }
  return res.json();
}

// Rows arrive as dimensionValues [hostName, pagePath, channel] and
// metricValues [sessions, totalUsers, newUsers, screenPageViews,
// conversions], all strings. Aggregate into the section's totals plus
// the top-5 pages (by views) and top-5 sources (by sessions).
function aggregate(reportJson) {
  const totals = {
    sessions: 0,
    users: 0,
    newUsers: 0,
    pageViews: 0,
    conversions: 0,
  };
  const byPage = new Map();
  const bySource = new Map();

  for (const row of reportJson.rows || []) {
    const dims = row.dimensionValues || [];
    const mets = (row.metricValues || []).map((m) => parseInt(m.value, 10) || 0);
    const pagePath = (dims[1] && dims[1].value) || "";
    const channel = (dims[2] && dims[2].value) || "(unknown)";
    const [sessions, users, newUsers, pageViews, conversions] = mets;

    totals.sessions += sessions;
    totals.users += users;
    totals.newUsers += newUsers;
    totals.pageViews += pageViews;
    totals.conversions += conversions;

    byPage.set(pagePath, (byPage.get(pagePath) || 0) + pageViews);
    bySource.set(channel, (bySource.get(channel) || 0) + sessions);
  }

  const topPages = [...byPage.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);
  const topSources = [...bySource.entries()]
    .map(([source, sessions]) => ({ source, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5);

  return { totals, topPages, topSources };
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// The previous period of equal length, ending the day before `from`.
function previousRange(from, to) {
  const fromD = new Date(from + "T00:00:00Z");
  const toD = new Date(to + "T00:00:00Z");
  const days = Math.round((toD - fromD) / 86400000) + 1;
  const prevTo = new Date(fromD.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { from: toISODate(prevFrom), to: toISODate(prevTo) };
}

// Percent change, one decimal; null when the previous value is 0
// (a change from zero has no honest percentage).
function pctChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

async function getWebsiteReport({ from, to, compare, group } = {}) {
  if (!configured()) {
    return {
      connected: false,
      state: "not_connected",
      note: NOT_CONNECTED_NOTE,
      asOf: null,
    };
  }

  const cacheKey =
    "gacache:" +
    crypto
      .createHash("sha1")
      .update([from, to, compare, group].join("|"))
      .digest("hex");

  let cached = null;
  try {
    cached = await store.get(cacheKey);
  } catch (e) {
    cached = null; // a broken cache must not break the live read
  }
  if (
    cached &&
    cached.asOf &&
    cached.report &&
    Date.now() - Date.parse(cached.asOf) < CACHE_TTL_MS
  ) {
    return cached.report;
  }

  try {
    const sa = readServiceAccount();
    const token = await getAccessToken(sa);

    const current = aggregate(await runReport(token, from, to, group));
    const report = {
      connected: true,
      asOf: new Date().toISOString(),
      range: { from, to },
      totals: current.totals,
      topPages: current.topPages,
      topSources: current.topSources,
    };

    if (compare === "prev") {
      const prev = previousRange(from, to);
      const previous = aggregate(await runReport(token, prev.from, prev.to, group));
      report.previous = { totals: previous.totals };
      report.deltas = {};
      for (const key of Object.keys(report.totals)) {
        report.deltas[key] = pctChange(report.totals[key], previous.totals[key]);
      }
    }

    try {
      await store.set(cacheKey, { asOf: report.asOf, report });
    } catch (e) {
      // Cache write failure is not a read failure — return the live report.
    }
    return report;
  } catch (err) {
    // Live read failed. Serve the cached report if one exists, clearly
    // marked stale with its original read time; otherwise admit the
    // check failed. Never invent numbers either way.
    if (cached && cached.report) {
      return { ...cached.report, stale: true, asOf: cached.asOf };
    }
    return {
      connected: false,
      state: "check_failed",
      note: "Could not check just now",
      asOf: null,
    };
  }
}

module.exports = { configured, getWebsiteReport };
