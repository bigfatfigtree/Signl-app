// Maggie's conversational layer (Maggie Rebuild v1, Jeff,
// 2026-11-07).
//
// Why this exists: Jeff opened Maggie in Admin, typed "hey",
// and got the fallback "That one is not in my bag yet." The
// fact answerer (sigdata.js) only speaks when a question hits
// a record, and the canon bank only speaks to how-it-works
// topics — greetings, thanks, small talk, and "who are you"
// hit NOTHING in either, so a real conversation opener fell
// to a canned deflection. This layer is the missing front of
// the conversation: it claims ONLY whole messages that are
// purely conversational (a greeting is a greeting; "hey, how
// many creators in Nashville?" is a fact question and is never
// touched here), answers them in Maggie's voice, per role,
// with at most ONE true bright spot from the asker's own fact
// sheet, and returns null for everything else so the fact
// answerer, the clarify step, and the AI run exactly as
// before.
//
// Rules held here, same as everywhere Maggie speaks:
// - Facts come only from the asker's own scoped fact sheet
//   (the router builds it; admin's sheet is the platform
//   aggregates, which is Jeff's own scope). A bright spot is
//   stated only when the number behind it is real and > 0.
// - No em dashes, no hype, short plain sentences.
// - Role lanes stay separate: the greeting's offer names only
//   what Maggie does in the asker's own lane.

function norm(q) {
  return " " + String(q || "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9áéíóúüñ'\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
}
function bare(q) { return norm(q).trim(); }

const GREET_WORDS = new Set(["hi", "hello", "hey", "hiya", "howdy", "yo", "greetings", "morning", "afternoon", "evening", "hola", "buenas", "hello there", "hi there", "hey there", "good morning", "good afternoon", "good evening", "buenos dias", "buenas tardes", "buenas noches", "hey maggie", "hi maggie", "hello maggie", "hola maggie"]);
const THANKS = new Set(["thanks", "thank you", "thx", "ty", "thank you so much", "thanks so much", "thanks maggie", "thank you maggie", "gracias", "muchas gracias", "much appreciated", "appreciate it", "appreciate that", "perfect thanks", "great thanks", "ok thanks", "okay thanks", "thanks a lot"]);
const FAREWELL = new Set(["bye", "goodbye", "good bye", "good night", "goodnight", "see you", "see ya", "later", "gtg", "got to go", "talk later", "talk to you later", "thats all", "that's all", "that is all", "im done", "i'm done", "bye maggie"]);
const ACK = new Set(["ok", "okay", "k", "kk", "cool", "nice", "great", "awesome", "wow", "lol", "haha", "ha", "got it", "sounds good", "perfect", "sweet", "good", "right", "yes", "yeah", "yep", "yup", "sure", "fine", "alright", "all right", "makes sense", "understood", "fair", "fair enough"]);
const HOWAREYOU = new Set(["how are you", "how are you doing", "how is it going", "how's it going", "hows it going", "whats up", "what's up", "sup", "how do you feel", "are you ok", "are you okay", "you ok", "you okay", "how is your day", "hows your day", "how's your day"]);
const COMPLIMENT = new Set(["good job", "well done", "you are great", "you're great", "you are awesome", "you're awesome", "you are smart", "you're smart", "you are helpful", "you're helpful", "nice work", "you rock", "love you maggie", "you are the best", "you're the best", "smart bird", "good bird"]);

function isGreeting(q) { return GREET_WORDS.has(bare(q)); }
function isConversational(q) {
  const b = bare(q);
  return GREET_WORDS.has(b) || THANKS.has(b) || FAREWELL.has(b) || ACK.has(b) || HOWAREYOU.has(b) || COMPLIMENT.has(b)
    || IDENTITY_RE.test(b) || CAPABILITY_RE.test(b);
}

const IDENTITY_RE = /\b(who are you|what are you|your name|who is magpie|what is maggie|who is maggie|introduce yourself|are you a bot|are you a robot|are you an ai|are you ai|are you real|are you human|are you a real person|are you actually a bird|are you a bird)\b/;
const CAPABILITY_RE = /^(help|help me|i need help|what can you do|what can you do for me|what do you do|how can you help|how can you help me|how else can you help|how else can you help me|what can you help with|what can you help me with|what else can you help with|what else can you help me with|what can i ask|what can i ask you|what should i ask|what else can you do|what else can you do for me|what more can you do|anything else you can do|show me what you can do|menu|options|what are my options|get started|how do i get started)$/;

function fmtN(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }

// The one true bright spot in the asker's own sheet, or null.
// Only real, positive state is ever spoken; silence otherwise.
function brightSpot(role, f) {
  if (!f) return null;
  try {
    if (role === "admin") {
      if (f.waiting && f.waiting.total > 0) return `${fmtN(f.waiting.total)} ${plural(f.waiting.total, "application")} waiting on a decision`;
      if (f.creators && f.creators.claimsToday > 0) return `${fmtN(f.creators.claimsToday)} creator ${plural(f.creators.claimsToday, "claim")} landed today`;
      return null;
    }
    if (role === "creator") {
      if (f.profileComplete === false) {
        const n = (f.missingLabels || []).length;
        return n ? `your profile has ${fmtN(n)} ${plural(n, "step")} left to finish, and finishing it is what puts you in front of businesses` : "your profile is not finished yet, and finishing it is what puts you in front of businesses";
      }
      if (f.momentumPoints > 0) return `you are at ${fmtN(f.momentumPoints)} Momentum points`;
      return null;
    }
    if (role === "business") {
      if (f.applicantsWaiting > 0) return `${fmtN(f.applicantsWaiting)} ${plural(f.applicantsWaiting, "applicant")} waiting on your answer`;
      if (f.rosterInMarket > 0) return `${fmtN(f.rosterInMarket)} ${plural(f.rosterInMarket, "creator")} on your ${f.market || "market"} roster`;
      return null;
    }
    if (role === "partner") {
      if (f.totals && f.totals.creatorsAttributed > 0) return `${fmtN(f.totals.creatorsAttributed)} ${plural(f.totals.creatorsAttributed, "creator")} in through your links`;
      return null;
    }
  } catch (e) { return null; }
  return null;
}

const LANE_OFFER = {
  admin: "Ask me what needs you, or any number on the platform.",
  creator: "Ask me about your numbers, your offers, or what to do next.",
  business: "Ask me about your applicants, your campaigns, or finding creators.",
  partner: "Ask me about your funnel, your markets, or your money.",
  pilot_partner: "Ask me about your pilot: sign-ups, posts, and the report.",
};
const LANE_DO = {
  admin: "approvals waiting, counts by market, partner state, and compliance",
  creator: "your Momentum, your audience and local reach, offers in your market, and walking your profile to finished",
  business: "finding creators and ranking them for a campaign, drafting offers with you, and your applicants and results",
  partner: "your funnel by market, your packs, and what you have earned",
  pilot_partner: "your pilot's sign-ups, posts, and report",
};

// The next-step offer that pairs with the bright spot, or
// null when the spot carries no action. Maggie prompts; she
// does not just state (Jeff, 2026-11-07: "she doesn't prompt
// anything"). The yes-handler below answers these offers
// from the same fact sheet, so the promise is always kept.
function spotOffer(role, f) {
  if (!f) return null;
  try {
    if (role === "admin" && f.waiting && f.waiting.total > 0) return "Want me to pull up who is waiting?";
    if (role === "creator" && f.profileComplete === false) return "Want me to walk you through what is left?";
    if (role === "business" && f.applicantsWaiting > 0) return "Want me to pull them up?";
    if (role === "partner" && f.totals && f.totals.creatorsAttributed > 0) return "Want the breakdown by market?";
  } catch (e) { return null; }
  return null;
}

const YES_WORDS = new Set(["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "please", "yes please", "go ahead", "do it", "pull it up", "show me"]);

// A bare "yes" right after Maggie's offered next step keeps
// the promise from the asker's own fact sheet. Anything else
// falls through untouched.
function yesAnswer(role, facts, history) {
  const hist = Array.isArray(history) ? history : [];
  const prevSig = [...hist].reverse().find((h) => h && h.who === "sig" && typeof h.text === "string");
  if (!prevSig || !facts) return null;
  const pt = prevSig.text;
  if (/pull up who is waiting/i.test(pt) && role === "admin" && facts.waiting && (facts.waiting.list || []).length) {
    const names = facts.waiting.list.map((w) => `${w.label} (${w.waited})`).join("; ");
    const more = facts.waiting.total > facts.waiting.list.length ? ` Plus ${facts.waiting.total - facts.waiting.list.length} more in the queue.` : "";
    return { text: `Here is who is waiting: ${names}.${more} The Applications tab is where each one gets its decision.` };
  }
  if (/walk you through what is left/i.test(pt) && role === "creator" && facts.profileComplete === false && (facts.missingLabels || []).length) {
    return { text: `Here is what is left on your profile: ${facts.missingLabels.join(", ")}. Each one finishes on your Profile, and a finished profile is what puts you in front of businesses.` };
  }
  if (/pull them up/i.test(pt) && role === "business" && facts.applicantsWaiting > 0) {
    return { text: `You have ${fmtN(facts.applicantsWaiting)} ${plural(facts.applicantsWaiting, "applicant")} waiting on your answer. They sit under My Offers, in Applicants, and every applicant gets an answer within 2 business days.` };
  }
  if (/breakdown by market/i.test(pt) && role === "partner" && facts.totals && facts.totals.creatorsAttributed > 0) {
    return { text: `${fmtN(facts.totals.creatorsAttributed)} ${plural(facts.totals.creatorsAttributed, "creator")} came in through your links so far. The Markets tab holds the split by market, and Links holds the claim links doing it.` };
  }
  return null;
}

function greetingWord(q) {
  const b = bare(q);
  if (b.includes("morning") || b.includes("dias")) return "Good morning";
  if (b.includes("afternoon") || b.includes("tardes")) return "Good afternoon";
  if (b.includes("evening") || b.includes("night") || b.includes("noches")) return "Good evening";
  if (b === "hola" || b === "buenas" || b === "hola maggie") return "Hola";
  return "Hey";
}

function sigConverse(role, facts, question, history, who) {
  const b = bare(question);
  if (!b) return null;
  const lane = LANE_OFFER[role] ? role : "creator";
  const name = who && who.firstName ? String(who.firstName).trim() : "";
  const spot = brightSpot(role, facts);
  const hist = Array.isArray(history) ? history : [];
  const prevUser = [...hist].reverse().find((h) => h && h.who === "user" && typeof h.text === "string");

  if (GREET_WORDS.has(b)) {
    if (prevUser && GREET_WORDS.has(bare(prevUser.text))) {
      return { text: `Hey again${name ? ", " + name : ""}. ${LANE_OFFER[lane]}` };
    }
    const spotLine = spot ? ` Right now: ${spot}.` : "";
    const offer = spot ? spotOffer(role, facts) : null;
    return { text: `${greetingWord(question)}${name ? ", " + name : ""}. I am Maggie, and I keep an eye on your numbers so you do not have to.${spotLine} ${offer || LANE_OFFER[lane]}` };
  }
  if (YES_WORDS.has(b)) {
    const yes = yesAnswer(role, facts, hist);
    if (yes) return yes;
  }
  if (THANKS.has(b)) {
    const offer = spot ? spotOffer(role, facts) : null;
    return { text: `Any time${name ? ", " + name : ""}. ${spot ? `Still true right now: ${spot}. ` : ""}${offer || "Shout when you want the next step."}` };
  }
  if (FAREWELL.has(b)) {
    return { text: "Any time. I will be right here when you need me." };
  }
  if (HOWAREYOU.has(b)) {
    return { text: `All good here${name ? ", " + name : ""}. Watching the numbers is the whole job, and I like it. ${spot ? `On your side: ${spot}. ` : ""}What do you need?` };
  }
  if (COMPLIMENT.has(b)) {
    return { text: "Kind of you. I just read the records and tell it straight. What can I do for you?" };
  }
  if (IDENTITY_RE.test(b)) {
    const aiAsk = /bot|robot|an ai|are you ai|are you real|are you human|real person/.test(b);
    const lead = aiAsk ? "Fair question. I am an AI guide, yes. " : "";
    return { text: `${lead}I am Maggie, Magpie's in-app guide, named for the magpie the product is named for. I work from your real records, in your lane only: ${LANE_DO[lane]}. Ask in plain words and I answer straight, and when something needs doing I show you the step and confirm before anything is saved.` };
  }
  if (CAPABILITY_RE.test(b)) {
    const ro = role === "admin" ? " This console chat is read-only: I answer and point, and the tabs do the doing." : "";
    return { text: `Here is what I do in your lane: ${LANE_DO[lane]}. Ask in plain words, the way you would ask a person, and I will answer from your real records or walk you to the screen that does it.${ro}` };
  }
  if (ACK.has(b)) {
    return { text: "Good. I am here when you want the next step." };
  }
  return null;
}

module.exports = { sigConverse, isConversational, isGreeting, brightSpot };
