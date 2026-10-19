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
// A creator's "local audience" is measured against the city list of
// their market. Do not edit these lists without updating the website.

const MARKETS = [
  {
    id: "hampton-roads",
    name: "Hampton Roads",
    label: "Hampton Roads, Virginia",
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
    id: "charlottesville",
    name: "Charlottesville",
    label: "Charlottesville, Virginia",
    country: "United States",
    cities: ["Charlottesville", "Crozet", "Scottsville", "Palmyra", "Lake Monticello", "Ruckersville", "Stanardsville", "Earlysville", "Keswick", "Gordonsville"],
  },
  {
    id: "roanoke",
    name: "Roanoke",
    label: "Roanoke, Virginia",
    country: "United States",
    cities: ["Roanoke", "Salem", "Vinton", "Cave Spring", "Hollins", "Daleville", "Troutville", "Fincastle", "Rocky Mount"],
  },
  {
    id: "atlanta",
    name: "Atlanta",
    label: "Atlanta, Georgia",
    country: "United States",
    cities: ["Atlanta", "Decatur", "Marietta", "Sandy Springs", "Roswell", "Alpharetta", "Johns Creek", "Brookhaven", "Dunwoody", "Chamblee", "Tucker", "Norcross", "Duluth", "Smyrna", "Vinings", "Kennesaw", "Woodstock", "Acworth", "East Point", "College Park", "Peachtree Corners", "Snellville", "Lawrenceville", "Stockbridge"],
  },
  {
    id: "greensboro",
    name: "Greensboro",
    label: "Greensboro, North Carolina (the Triad)",
    country: "United States",
    cities: ["Greensboro", "Winston-Salem", "High Point", "Burlington", "Kernersville", "Clemmons", "Thomasville", "Lexington", "Asheboro", "Archdale", "Jamestown", "Oak Ridge", "Summerfield", "Randleman"],
  },
  {
    id: "wilmington",
    name: "Wilmington",
    label: "Wilmington, North Carolina",
    country: "United States",
    cities: ["Wilmington", "Wrightsville Beach", "Carolina Beach", "Kure Beach", "Leland", "Hampstead", "Surf City", "Topsail Beach", "Southport", "Shallotte", "Ocean Isle Beach", "Burgaw"],
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
    id: "miami",
    name: "Miami",
    label: "Miami, Florida",
    country: "United States",
    cities: ["Miami"],
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
    id: "abu-dhabi",
    name: "Abu Dhabi",
    label: "Abu Dhabi, United Arab Emirates",
    country: "United Arab Emirates",
    cities: ["Abu Dhabi"],
  },
  {
    id: "riyadh",
    name: "Riyadh",
    label: "Riyadh, Saudi Arabia",
    country: "Saudi Arabia",
    cities: ["Riyadh"],
  },
  {
    id: "doha",
    name: "Doha",
    label: "Doha, Qatar",
    country: "Qatar",
    cities: ["Doha"],
  },
  {
    id: "astana",
    name: "Astana",
    label: "Astana, Kazakhstan",
    country: "Kazakhstan",
    cities: ["Astana"],
  },
  {
    id: "bishkek",
    name: "Bishkek",
    label: "Bishkek, Kyrgyzstan",
    country: "Kyrgyzstan",
    cities: ["Bishkek"],
  },
  {
    id: "sydney",
    name: "Sydney",
    label: "Sydney, Australia",
    country: "Australia",
    cities: ["Sydney"],
  },
  {
    id: "melbourne",
    name: "Melbourne",
    label: "Melbourne, Australia",
    country: "Australia",
    cities: ["Melbourne"],
  },
  {
    id: "perth",
    name: "Perth",
    label: "Perth, Australia",
    country: "Australia",
    cities: ["Perth"],
  },
  {
    id: "auckland",
    name: "Auckland",
    label: "Auckland, New Zealand",
    country: "New Zealand",
    cities: ["Auckland"],
  },
  {
    id: "singapore",
    name: "Singapore",
    label: "Singapore",
    country: "Singapore",
    cities: ["Singapore"],
  },
  {
    id: "hong-kong",
    name: "Hong Kong",
    label: "Hong Kong",
    country: "Hong Kong",
    cities: ["Hong Kong"],
  },
  {
    id: "beijing",
    name: "Beijing",
    label: "Beijing, China",
    country: "China",
    cities: ["Beijing"],
  },
  {
    id: "shanghai",
    name: "Shanghai",
    label: "Shanghai, China",
    country: "China",
    cities: ["Shanghai"],
  },
];

const TIERS = [
  { id: "Neighbors", label: "Neighbors", min: 500, max: 2000, blurb: "Everyday locals. Comp-only visits." },
  { id: "Locals", label: "Locals", min: 2000, max: 15000, blurb: "Established local voices. Comp visits, first in line for more." },
  { id: "Creators", label: "Creators", min: 15000, max: Infinity, blurb: "Top local creators. Comp visits plus first in line for paid cash campaigns." },
];

function tierForFollowers(n) {
  if (n >= 15000) return "Creators";
  if (n >= 2000) return "Locals";
  if (n >= 500) return "Neighbors";
  return "Neighbors";
}

// What creators create in (profile builder, launch spec 2026-10-18).
const CREATOR_CATEGORIES = [
  "Food & Drink", "Nightlife", "Beauty & Grooming", "Fitness & Wellness",
  "Health & Wellness", "Retail & Shopping", "Attractions & Events",
  "Local Services", "Other",
];

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
// month. Content rights follow the plan: Self-Service shares creator
// posts natively only; Growth adds own-feed reposts and ad use while
// the account is active; Managed is Growth's rights, hand-held, with
// more visits and the quarterly hero feature.
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
      "Share creator posts natively, with the creator tagged",
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
      "Repost creator posts on your own feed",
      "Run creator posts as ads while your account is active",
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
      "Growth content rights (own-feed reposts + ads while active) and a monthly report",
    ],
  },
];

module.exports = { MARKETS, TIERS, CREATOR_CATEGORIES, COMP_CATEGORIES, BUSINESS_CATEGORIES, PLANS, tierForFollowers };
