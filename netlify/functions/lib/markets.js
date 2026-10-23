// SIGNL markets and their published city lists.
// The 11 founding markets (US metros) come from the Service schema
// (areaServed) published on joinsignl.com/cities.html and
// joinsignl.com/businesses.html (2026-10-17). On 2026-10-18 Jeff made
// SIGNL universal: 12 more US cities plus London, Manchester, and
// Dubai (a core market) were added as single-city markets, and later
// the same day 13 more core markets from Bella Hausen's focus list:
// Abu Dhabi, Riyadh, Doha, Astana, Bishkek, Sydney, Melbourne, Perth,
// Auckland, Singapore, Hong Kong, Beijing, and Shanghai. Every
// market carries a country; the sign-up picker groups by country.
// On 2026-10-23 Jeff reset the roster to 37 public cities and
// renamed the Hampton Roads market to Virginia Beach (its anchor
// city); coverage did NOT shrink: the Virginia Beach market still
// covers the full Hampton Roads metro city list below, and stored
// records carrying the legacy name "Hampton Roads" are normalized
// to "Virginia Beach" by normalizeMarketName wherever markets are
// matched, counted or displayed. New markets added the same day:
// Philadelphia, Pittsburgh, Cincinnati, Columbus, New Orleans,
// Orlando, Houston, San Antonio, Las Vegas, Detroit, San Juan,
// Paris, Barcelona, Lisbon, Toronto, Montreal. Removed the same
// day: Charlottesville, Roanoke, Greensboro, Wilmington, Miami,
// Abu Dhabi, Riyadh, Doha, Astana, Bishkek, Sydney, Melbourne,
// Perth, Auckland, Singapore, Hong Kong, Beijing, Shanghai.
// A creator's "local audience" is measured against the city list of
// their market. Do not edit these lists without updating the website.

const MARKETS = [
  {
    id: "hampton-roads",
    name: "Virginia Beach",
    label: "Virginia Beach, Virginia (all of Hampton Roads)",
    country: "United States",
    cities: ["Virginia Beach", "Norfolk", "Chesapeake", "Portsmouth", "Suffolk", "Newport News", "Hampton", "Williamsburg", "Poquoson", "Yorktown"],
  },
  {
    id: "richmond",
    name: "Richmond",
    label: "Richmond, Virginia",
    country: "United States",
    cities: ["Richmond", "Petersburg", "Colonial Heights", "Hopewell", "Ashland", "Mechanicsville", "Glen Allen", "Midlothian", "Chester", "Bon Air", "Tuckahoe", "Lakeside", "Highland Springs", "Sandston", "Powhatan", "Goochland"],
  },
  {
    id: "washington-dc",
    name: "Washington DC",
    label: "Washington DC metro",
    country: "United States",
    cities: ["Washington DC", "Arlington", "Alexandria", "Fairfax", "Falls Church", "Vienna", "McLean", "Tysons", "Reston", "Herndon", "Ashburn", "Leesburg", "Manassas", "Springfield", "Annandale", "Bethesda", "Silver Spring", "Rockville", "Gaithersburg", "Frederick", "Chevy Chase", "Takoma Park", "College Park", "Hyattsville", "Greenbelt", "Bowie"],
  },
  {
    id: "raleigh",
    name: "Raleigh",
    label: "Raleigh, North Carolina (the Triangle)",
    country: "United States",
    cities: ["Raleigh", "Cary", "Apex", "Wake Forest", "Garner", "Holly Springs", "Fuquay-Varina", "Morrisville", "Knightdale", "Wendell", "Zebulon", "Rolesville", "Clayton", "Durham", "Chapel Hill", "Carrboro"],
  },
  {
    id: "charlotte",
    name: "Charlotte",
    label: "Charlotte, North Carolina",
    country: "United States",
    cities: ["Charlotte", "Concord", "Gastonia", "Rock Hill", "Fort Mill", "Huntersville", "Cornelius", "Davidson", "Mooresville", "Matthews", "Mint Hill", "Pineville", "Indian Trail", "Monroe", "Waxhaw", "Harrisburg", "Kannapolis", "Belmont", "Mount Holly", "Lake Wylie"],
  },
  {
    id: "baltimore",
    name: "Baltimore",
    label: "Baltimore, Maryland",
    country: "United States",
    cities: ["Baltimore", "Towson", "Columbia", "Annapolis", "Glen Burnie", "Dundalk", "Ellicott City", "Owings Mills", "Catonsville", "Essex", "Randallstown", "Pikesville", "Severna Park", "Pasadena", "Bel Air", "Aberdeen", "Havre de Grace", "Westminster", "Eldersburg", "Reisterstown", "Parkville", "Middle River"],
  },
  {
    id: "atlanta",
    name: "Atlanta",
    label: "Atlanta, Georgia",
    country: "United States",
    cities: ["Atlanta", "Decatur", "Marietta", "Sandy Springs", "Roswell", "Alpharetta", "Johns Creek", "Brookhaven", "Dunwoody", "Chamblee", "Tucker", "Norcross", "Duluth", "Smyrna", "Vinings", "Kennesaw", "Woodstock", "Acworth", "East Point", "College Park", "Peachtree Corners", "Snellville", "Lawrenceville", "Stockbridge"],
  },
  {
    id: "nashville",
    name: "Nashville",
    label: "Nashville, Tennessee",
    country: "United States",
    cities: ["Nashville"],
  },
  {
    id: "austin",
    name: "Austin",
    label: "Austin, Texas",
    country: "United States",
    cities: ["Austin"],
  },
  {
    id: "dallas",
    name: "Dallas",
    label: "Dallas, Texas",
    country: "United States",
    cities: ["Dallas"],
  },
  {
    id: "chicago",
    name: "Chicago",
    label: "Chicago, Illinois",
    country: "United States",
    cities: ["Chicago"],
  },
  {
    id: "los-angeles",
    name: "Los Angeles",
    label: "Los Angeles, California",
    country: "United States",
    cities: ["Los Angeles"],
  },
  {
    id: "san-diego",
    name: "San Diego",
    label: "San Diego, California",
    country: "United States",
    cities: ["San Diego"],
  },
  {
    id: "seattle",
    name: "Seattle",
    label: "Seattle, Washington",
    country: "United States",
    cities: ["Seattle"],
  },
  {
    id: "tampa",
    name: "Tampa",
    label: "Tampa, Florida",
    country: "United States",
    cities: ["Tampa"],
  },
  {
    id: "phoenix",
    name: "Phoenix",
    label: "Phoenix, Arizona",
    country: "United States",
    cities: ["Phoenix"],
  },
  {
    id: "denver",
    name: "Denver",
    label: "Denver, Colorado",
    country: "United States",
    cities: ["Denver"],
  },
  {
    id: "minneapolis",
    name: "Minneapolis",
    label: "Minneapolis, Minnesota",
    country: "United States",
    cities: ["Minneapolis"],
  },
  {
    id: "philadelphia",
    name: "Philadelphia",
    label: "Philadelphia, Pennsylvania",
    country: "United States",
    cities: ["Philadelphia"],
  },
  {
    id: "pittsburgh",
    name: "Pittsburgh",
    label: "Pittsburgh, Pennsylvania",
    country: "United States",
    cities: ["Pittsburgh"],
  },
  {
    id: "cincinnati",
    name: "Cincinnati",
    label: "Cincinnati, Ohio",
    country: "United States",
    cities: ["Cincinnati"],
  },
  {
    id: "columbus",
    name: "Columbus",
    label: "Columbus, Ohio",
    country: "United States",
    cities: ["Columbus"],
  },
  {
    id: "new-orleans",
    name: "New Orleans",
    label: "New Orleans, Louisiana",
    country: "United States",
    cities: ["New Orleans"],
  },
  {
    id: "orlando",
    name: "Orlando",
    label: "Orlando, Florida",
    country: "United States",
    cities: ["Orlando"],
  },
  {
    id: "houston",
    name: "Houston",
    label: "Houston, Texas",
    country: "United States",
    cities: ["Houston"],
  },
  {
    id: "san-antonio",
    name: "San Antonio",
    label: "San Antonio, Texas",
    country: "United States",
    cities: ["San Antonio"],
  },
  {
    id: "las-vegas",
    name: "Las Vegas",
    label: "Las Vegas, Nevada",
    country: "United States",
    cities: ["Las Vegas"],
  },
  {
    id: "detroit",
    name: "Detroit",
    label: "Detroit, Michigan",
    country: "United States",
    cities: ["Detroit"],
  },
  {
    id: "san-juan",
    name: "San Juan",
    label: "San Juan, Puerto Rico",
    country: "Puerto Rico",
    cities: ["San Juan"],
  },
  {
    id: "london",
    name: "London",
    label: "London, United Kingdom",
    country: "United Kingdom",
    cities: ["London"],
  },
  {
    id: "manchester",
    name: "Manchester",
    label: "Manchester, United Kingdom",
    country: "United Kingdom",
    cities: ["Manchester"],
  },
  {
    id: "dubai",
    name: "Dubai",
    label: "Dubai, United Arab Emirates",
    country: "United Arab Emirates",
    cities: ["Dubai"],
  },
  {
    id: "paris",
    name: "Paris",
    label: "Paris, France",
    country: "France",
    cities: ["Paris"],
  },
  {
    id: "barcelona",
    name: "Barcelona",
    label: "Barcelona, Spain",
    country: "Spain",
    cities: ["Barcelona"],
  },
  {
    id: "lisbon",
    name: "Lisbon",
    label: "Lisbon, Portugal",
    country: "Portugal",
    cities: ["Lisbon"],
  },
  {
    id: "toronto",
    name: "Toronto",
    label: "Toronto, Canada",
    country: "Canada",
    cities: ["Toronto"],
  },
  {
    id: "montreal",
    name: "Montreal",
    label: "Montreal, Canada",
    country: "Canada",
    cities: ["Montreal"],
  },
];

const MARKET_NAME_ALIASES = { "Hampton Roads": "Virginia Beach" };

// Stored records created before the 2026-10-23 rename carry the
// legacy market name. Every match, count and display of a market
// name goes through this so legacy and canonical records behave
// as one market. No stored record is rewritten.
function normalizeMarketName(name) {
  if (typeof name !== "string") return name;
  const t = name.trim();
  return MARKET_NAME_ALIASES[t] || t;
}

const TIERS = [
  { id: "Neighbors", label: "Neighbors", min: 500, max: 2000, blurb: "Everyday locals. Comp-only visits." },
  { id: "Locals", label: "Locals", min: 2000, max: 15000, blurb: "Established local voices. Comp visits, first in line for more." },
  { id: "Headliners", label: "Headliners", min: 15000, max: Infinity, blurb: "Top local creators. Comp visits plus first in line for paid cash campaigns." },
];

function tierForFollowers(n) {
  if (n >= 15000) return "Headliners";
  if (n >= 2000) return "Locals";
  if (n >= 500) return "Neighbors";
  return "Neighbors";
}

// The 15k+ band was renamed Creators -> Headliners (Jeff, 2026-10-19).
// Records stored before the rename still carry "Creators"; normalize
// wherever a stored band is read so legacy records behave identically.
function normalizeTierBand(b) {
  return b === "Creators" ? "Headliners" : b;
}

// What creators create in (profile builder, launch spec 2026-10-18).
const CREATOR_CATEGORIES = [
  "Food & Drink", "Nightlife", "Beauty & Grooming", "Fitness & Wellness",
  "Health & Wellness", "Retail & Shopping", "Attractions & Events",
  "Local Services", "Other",
];

// What the creator does off-platform (profile builder, Jeff,
// 2026-10-22: the realtor layer). Optional everyday-language
// self-description; it never gates completeness, offers, or tiers.
// "Real estate agent" is the one value with product behavior: it
// flags the profile as a realtor profile (neighborhood tags,
// brokerage attribution, listing proof sheet).
const PROFESSIONS = [
  "Food & drink", "Beauty & style", "Fitness & wellness",
  "Family & parenting", "Real estate agent",
  "Photographer / videographer", "Student", "Other",
];
const REALTOR_PROFESSION = "Real estate agent";

// What creators would accept as a comp (profile builder).
const COMP_CATEGORIES = [
  "Restaurant meals", "Drinks & nightlife", "Beauty services",
  "Fitness classes & passes", "Health & wellness services",
  "Retail products", "Attractions & experiences",
  "Local services", "Other",
];

const BUSINESS_CATEGORIES = [
  "Restaurant", "Bar", "Coffee & Bakery", "Salon & Barbershop",
  "Fitness Studio", "Retail", "Attraction", "Local Services", "Other",
];

// Three plans (Jeff, 2026-10-19). All 3-month minimum, then month to
// month. Content rights follow the VISIT, never the plan (rights
// model adopted 2026-10-21): a comp visit is native sharing only on
// every plan; a paid visit adds repost rights and ad use for 6
// months from the post date. Managed is hand-held, with more visits
// and the quarterly hero feature.
const PLANS = [
  {
    id: "self-service",
    name: "Self-Service",
    priceMonthly: 299,
    minMonths: 3,
    visitsPerMonth: 8,
    features: [
      "Browse the local roster and send comp offers",
      "Up to 8 creator visits per month",
      "Post tracking and results dashboard",
      "Share comp-visit posts natively, with the creator tagged",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 599,
    minMonths: 3,
    visitsPerMonth: 20,
    features: [
      "Browse the local roster and send comp offers",
      "Up to 20 creator visits per month",
      "Post tracking and results dashboard",
      "Paid visits: book specific creators at their listed rate",
      "Paid visits include repost rights and ad use for 6 months",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    priceMonthly: 999,
    minMonths: 3,
    visitsPerMonth: 30,
    features: [
      "A SIGNL coordinator runs everything for you",
      "Up to 30 creator visits per month",
      "Campaign calendar and creator scheduling handled",
      "A monthly paid creator budget your coordinator spends for you",
      "Quarterly hero creator feature",
      "Paid bookings and their repost and ad rights, handled for you, plus a monthly report",
    ],
  },
];

module.exports = { MARKETS, MARKET_NAME_ALIASES, normalizeMarketName, TIERS, CREATOR_CATEGORIES, COMP_CATEGORIES, BUSINESS_CATEGORIES, PLANS, PROFESSIONS, REALTOR_PROFESSION, tierForFollowers, normalizeTierBand };
