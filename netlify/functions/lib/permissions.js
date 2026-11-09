// Team & permissions (Build -138, Admin expansion Area 4).
//
// Until now `user.role === "admin"` was the whole story: binary,
// all or nothing. This module is the permission layer that sits on
// the same user records. Jeff's account is super-admin and stays
// that way; a teammate is an admin-role user whose record carries
// an `adminPerms` snapshot:
//
//   adminPerms: {
//     super: false,
//     flags: { [flag]: true },        // only granted flags present
//     markets: null | ["Nashville"],  // null = all markets
//     statScopes: ["creators", ...],   // only meaningful with stats.view
//     template: "outreach_rep",        // the preset it started from
//     grantedBy, grantedAt
//   }
//
// Enforcement is at the data layer, never only in the client (the
// Sig-privacy pattern from Build -131): the router gates every
// admin route on the flag it names, and list/overview builders take
// the reader's market scope so an out-of-market record is never in
// the payload at all — not the real numbers with a warning on top.
//
// Legacy rule: an admin-role record with NO adminPerms predates
// this layer (in practice, Jeff's own account). It reads as
// super-admin here, and the router stamps the explicit snapshot
// onto the record the first time it sees one, so the legacy path
// is a migration, not a permanent back door. Teammates are always
// created WITH an adminPerms snapshot, so they never touch it.

const FLAGS = [
  "approvals",
  "creators.view",
  "requests",
  "outreach",
  "campaign",
  "marketing.draft",
  "marketing.approve",
  "social.view",
  "social.draft",
  "social.approve",
  "stats.view",
  "markets.view",
  "compliance.view",
  "events.view",
  "partners.view",
  "connections.view",
  "automations.manage",
  "connections.manage",
  "team.manage",
  "templates.view",
  "templates.edit",
  "learn.view",
  "learn.edit",
  "learn.publish",
  "messages.send",
];

// Plain words for the permissions grid: Jeff sets a person up in
// under a minute, reading sentences, never flag names.
const FLAG_LABELS = {
  "approvals": "Review applications (approve or reject)",
  "creators.view": "See the creators list and profiles",
  "requests": "Requests: platform messages and the Finish Engine",
  "outreach": "Outreach and recruiters",
  "campaign": "The founding outreach campaign",
  "marketing.draft": "Marketing: write campaign email drafts",
  "marketing.approve": "Marketing: approve and send campaign email",
  "social.view": "See the Social room",
  "social.draft": "Social: draft posts for the queue",
  "social.approve": "Social: approve drafts into the queue",
  "stats.view": "See Stats (only the parts named below)",
  "markets.view": "See Markets",
  "compliance.view": "See Compliance",
  "events.view": "See the Event Log",
  "partners.view": "See Partners",
  "connections.view": "See Automations and connections",
  "automations.manage": "Turn automations off or on, send test emails",
  "connections.manage": "Write the dated notes on the connections board",
  "team.manage": "Team: invite people and set permissions",
  "templates.view": "See Templates",
  "templates.edit": "Edit marketing and social templates",
  "learn.view": "See the Learn studio",
  "learn.edit": "Learn: write and edit article drafts",
  "learn.publish": "Learn: publish articles",
  "messages.send": "Messages: send in-app messages to segments and people",
};

// Stat subsets a stats.view grant can carry. Money is off in every
// shipped template except Jeff's own account (Jeff's call, spec
// decision 3); website is traffic only, never money.
const STAT_SCOPES = ["creators", "businesses", "markets", "money", "website"];
const STAT_SCOPE_LABELS = {
  creators: "Creator numbers (sign-ups, profiles, Momentum)",
  businesses: "Business numbers (sign-ups, campaigns)",
  markets: "Per-market counts",
  money: "Money (revenue, payouts, wallet totals)",
  website: "Website numbers (Google Analytics traffic)",
};

// Role templates: presets Jeff can tweak per person. A template is
// SNAPSHOTTED onto the person at invite time — later edits to a
// template never silently change a real person's access.
const ROLE_TEMPLATES = {
  outreach_rep: {
    label: "Outreach rep",
    blurb: "Brings creators in: outreach, the creators list, and requests, in the markets you pick.",
    flags: ["outreach", "creators.view", "requests"],
    statScopes: [],
  },
  social_manager: {
    label: "Social manager",
    blurb: "Runs the social queue: drafts posts, reads the Social room, sees audience growth numbers.",
    flags: ["social.view", "social.draft", "templates.view", "stats.view"],
    statScopes: ["creators"],
  },
  email_marketer: {
    label: "Email marketer",
    blurb: "Writes campaign email and the templates behind it; an approver still presses send.",
    flags: ["marketing.draft", "social.view", "templates.edit", "stats.view"],
    statScopes: ["creators"],
  },
  analyst: {
    label: "Read-only analyst",
    blurb: "Sees numbers and lists, sends nothing, approves nothing, anywhere.",
    flags: ["stats.view", "events.view", "creators.view", "markets.view"],
    statScopes: ["creators", "businesses", "markets"],
  },
  market_lead: {
    label: "Market lead",
    blurb: "Runs one market end to end: reviews, creators, requests, outreach, and that market's numbers.",
    flags: ["approvals", "creators.view", "requests", "outreach", "stats.view"],
    statScopes: ["creators", "businesses", "markets"],
  },
};

function permsOf(user) {
  if (!user || user.role !== "admin") return null;
  const p = user.adminPerms;
  if (!p) {
    // Legacy admin (pre-dates this layer): super, until the
    // router's migration stamps the explicit snapshot.
    return { super: true, flags: {}, markets: null, statScopes: STAT_SCOPES.slice(), template: null, legacy: true };
  }
  return {
    super: !!p.super,
    flags: p.flags || {},
    markets: Array.isArray(p.markets) ? p.markets : null,
    statScopes: Array.isArray(p.statScopes) ? p.statScopes : [],
    template: p.template || null,
    legacy: false,
  };
}

function isSuper(user) {
  const p = permsOf(user);
  return !!p && p.super;
}

function hasPerm(user, flag) {
  const p = permsOf(user);
  if (!p) return false;
  if (p.super) return true;
  return !!p.flags[flag];
}

// The reader's market scope: null = every market. A record with
// no market of its own is in scope (there is nothing to attribute
// it to another market with); a record WITH a market is in scope
// only when that market is on the reader's list.
function inMarketScope(user, market) {
  const p = permsOf(user);
  if (!p) return false;
  if (p.super || !p.markets) return true;
  if (!market) return true;
  return p.markets.includes(market);
}

function scopeMarkets(user) {
  const p = permsOf(user);
  return p ? p.markets : null;
}

function hasStatScope(user, scope) {
  const p = permsOf(user);
  if (!p) return false;
  if (p.super) return true;
  if (!p.flags["stats.view"]) return false;
  return p.statScopes.includes(scope);
}

// Which flag a client room (tab label) needs. Rooms not listed
// here (Home, Sig, Account) are every admin's own rooms. For rooms
// with draft/approve splits, ANY of the listed flags opens the
// room; the actions inside gate on their own flags.
const ROOM_FLAGS = {
  "Applications": ["approvals"],
  "Requests": ["requests"],
  "Markets": ["markets.view"],
  "Creators": ["creators.view"],
  "Recruiters": ["outreach"],
  "Outreach": ["outreach"],
  "Partners": ["partners.view"],
  "Event Log": ["events.view"],
  "Compliance": ["compliance.view"],
  "Campaign": ["campaign"],
  "Stats": ["stats.view"],
  "Marketing": ["marketing.draft", "marketing.approve"],
  "Learn": ["learn.view", "learn.edit", "learn.publish"],
  "Social": ["social.view", "social.draft", "social.approve"],
  "Automations": ["connections.view", "automations.manage"],
  "Templates": ["templates.view", "templates.edit"],
  "Team": ["team.manage"],
  "Messages": ["messages.send"],
};

function roomAllowed(user, tab) {
  const need = ROOM_FLAGS[tab];
  if (!need) return isSuper(user) || !!permsOf(user);
  return need.some((f) => hasPerm(user, f));
}

// The tab list a given admin may see, in rail order — the client
// filters its nav by the same rule the routes enforce.
function permittedTabs(user, allTabs) {
  return allTabs.filter((t) => roomAllowed(user, t));
}

function templateSnapshot(templateId) {
  const t = ROLE_TEMPLATES[templateId];
  if (!t) return null;
  const flags = {};
  for (const f of t.flags) flags[f] = true;
  return { flags, statScopes: t.statScopes.slice() };
}

module.exports = {
  FLAGS, FLAG_LABELS, STAT_SCOPES, STAT_SCOPE_LABELS, ROLE_TEMPLATES,
  permsOf, isSuper, hasPerm, inMarketScope, scopeMarkets, hasStatScope,
  ROOM_FLAGS, roomAllowed, permittedTabs, templateSnapshot,
};
