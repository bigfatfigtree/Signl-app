// SIGNL markets and their published city lists.
// Source of truth: the Service schema (areaServed) published on
// joinsignl.com/cities.html and joinsignl.com/businesses.html (2026-10-17).
// A creator's "local audience" is measured against the city list of
// their market. Do not edit these lists without updating the website.

const MARKETS = [
  {
    id: "hampton-roads",
    name: "Hampton Roads",
    label: "Hampton Roads, Virginia",
    cities: ["Virginia Beach", "Norfolk", "Chesapeake", "Portsmouth", "Suffolk", "Newport News", "Hampton", "Williamsburg", "Poquoson", "Yorktown"],
  },
  {
    id: "richmond",
    name: "Richmond",
    label: "Richmond, Virginia",
    cities: ["Richmond", "Petersburg", "Colonial Heights", "Hopewell", "Ashland", "Mechanicsville", "Glen Allen", "Midlothian", "Chester", "Bon Air", "Tuckahoe", "Lakeside", "Highland Springs", "Sandston", "Powhatan", "Goochland"],
  },
  {
    id: "washington-dc",
    name: "Washington DC",
    label: "Washington DC metro",
    cities: ["Washington DC", "Arlington", "Alexandria", "Fairfax", "Falls Church", "Vienna", "McLean", "Tysons", "Reston", "Herndon", "Ashburn", "Leesburg", "Manassas", "Springfield", "Annandale", "Bethesda", "Silver Spring", "Rockville", "Gaithersburg", "Frederick", "Chevy Chase", "Takoma Park", "College Park", "Hyattsville", "Greenbelt", "Bowie"],
  },
  {
    id: "raleigh",
    name: "Raleigh",
    label: "Raleigh, North Carolina (the Triangle)",
    cities: ["Raleigh", "Cary", "Apex", "Wake Forest", "Garner", "Holly Springs", "Fuquay-Varina", "Morrisville", "Knightdale", "Wendell", "Zebulon", "Rolesville", "Clayton", "Durham", "Chapel Hill", "Carrboro"],
  },
  {
    id: "charlotte",
    name: "Charlotte",
    label: "Charlotte, North Carolina",
    cities: ["Charlotte", "Concord", "Gastonia", "Rock Hill", "Fort Mill", "Huntersville", "Cornelius", "Davidson", "Mooresville", "Matthews", "Mint Hill", "Pineville", "Indian Trail", "Monroe", "Waxhaw", "Harrisburg", "Kannapolis", "Belmont", "Mount Holly", "Lake Wylie"],
  },
  {
    id: "baltimore",
    name: "Baltimore",
    label: "Baltimore, Maryland",
    cities: ["Baltimore", "Towson", "Columbia", "Annapolis", "Glen Burnie", "Dundalk", "Ellicott City", "Owings Mills", "Catonsville", "Essex", "Randallstown", "Pikesville", "Severna Park", "Pasadena", "Bel Air", "Aberdeen", "Havre de Grace", "Westminster", "Eldersburg", "Reisterstown", "Parkville", "Middle River"],
  },
  {
    id: "charlottesville",
    name: "Charlottesville",
    label: "Charlottesville, Virginia",
    cities: ["Charlottesville", "Crozet", "Scottsville", "Palmyra", "Lake Monticello", "Ruckersville", "Stanardsville", "Earlysville", "Keswick", "Gordonsville"],
  },
  {
    id: "roanoke",
    name: "Roanoke",
    label: "Roanoke, Virginia",
    cities: ["Roanoke", "Salem", "Vinton", "Cave Spring", "Hollins", "Daleville", "Troutville", "Fincastle", "Rocky Mount"],
  },
  {
    id: "atlanta",
    name: "Atlanta",
    label: "Atlanta, Georgia",
    cities: ["Atlanta", "Decatur", "Marietta", "Sandy Springs", "Roswell", "Alpharetta", "Johns Creek", "Brookhaven", "Dunwoody", "Chamblee", "Tucker", "Norcross", "Duluth", "Smyrna", "Vinings", "Kennesaw", "Woodstock", "Acworth", "East Point", "College Park", "Peachtree Corners", "Snellville", "Lawrenceville", "Stockbridge"],
  },
  {
    id: "greensboro",
    name: "Greensboro",
    label: "Greensboro, North Carolina (the Triad)",
    cities: ["Greensboro", "Winston-Salem", "High Point", "Burlington", "Kernersville", "Clemmons", "Thomasville", "Lexington", "Asheboro", "Archdale", "Jamestown", "Oak Ridge", "Summerfield", "Randleman"],
  },
  {
    id: "wilmington",
    name: "Wilmington",
    label: "Wilmington, North Carolina",
    cities: ["Wilmington", "Wrightsville Beach", "Carolina Beach", "Kure Beach", "Leland", "Hampstead", "Surf City", "Topsail Beach", "Southport", "Shallotte", "Ocean Isle Beach", "Burgaw"],
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
  "Retail & Shopping", "Attractions & Events", "Local Services", "Other",
];

// What creators would accept as a comp (profile builder).
const COMP_CATEGORIES = [
  "Restaurant meals", "Drinks & nightlife", "Beauty services",
  "Fitness classes & passes", "Retail products", "Attractions & experiences",
  "Local services", "Other",
];

const BUSINESS_CATEGORIES = [
  "Restaurant", "Bar", "Coffee & Bakery", "Salon & Barbershop",
  "Fitness Studio", "Retail", "Attraction", "Local Services", "Other",
];

const PLANS = [
  {
    id: "self-service",
    name: "Self-Service",
    priceMonthly: 299,
    minMonths: 3,
    features: [
      "Browse the local roster and send comp offers",
      "Up to 8 creator visits per month",
      "Post tracking and results dashboard",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    priceMonthly: 799,
    minMonths: 3,
    features: [
      "SIGNL coordinator runs everything for you",
      "Campaign calendar and creator scheduling handled",
      "Quarterly hero creator feature",
      "Extended content rights and monthly report",
    ],
  },
];

module.exports = { MARKETS, TIERS, CREATOR_CATEGORIES, COMP_CATEGORIES, BUSINESS_CATEGORIES, PLANS, tierForFollowers };
