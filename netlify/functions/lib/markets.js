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
// Build -52 (Jeff, 2026-10-30): the markets added after the founding
// seven (Nashville onward) shipped with a namesake-only city list,
// so a sign-up typing a metro town (Clarksville for Nashville) fell
// into the "Not listed yet" pool even though the town sits inside
// the market's area. Jeff's ruling: at sign-up, people go in the
// correct market regardless of the city they typed - if the city
// sits in a market's area, they ARE that market. Every market now
// carries its genuine metro-area city list (real commutable towns
// only), and the typed-city resolver below files against them.
// Dubai is the one short list by geography: a city-emirate whose
// metro is the Dubai-Sharjah-Ajman corridor. Town names that
// genuinely belong to two metros (Columbia MD/TN, Bellevue WA/KY,
// Aurora IL/CO/ON, Lakewood CA/CO/WA, Smyrna GA/TN) stay in both
// lists on purpose: the resolver's tie outcome and the one-tap
// candidate pick handle them, with state/country hints breaking
// the tie at intake.

const MARKETS = [
  {
    id: "hampton-roads",
    name: "Virginia Beach",
    label: "Virginia Beach (Hampton Roads)",
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
    cities: ["Nashville", "Clarksville", "Murfreesboro", "Franklin", "Hendersonville", "Smyrna", "Brentwood", "Gallatin", "Mt. Juliet", "Lebanon", "Spring Hill", "Columbia", "Dickson", "Goodlettsville", "La Vergne", "Nolensville", "Springfield", "White House", "Portland", "Ashland City", "Fairview", "Thompson's Station", "Greenbrier", "Pleasant View"],
  },
  {
    id: "austin",
    name: "Austin",
    label: "Austin, Texas",
    country: "United States",
    cities: ["Austin", "Round Rock", "Cedar Park", "Pflugerville", "Georgetown", "Leander", "San Marcos", "Kyle", "Buda", "Lakeway", "Bee Cave", "Dripping Springs", "Manor", "Elgin", "Taylor", "Hutto", "Liberty Hill", "West Lake Hills", "Sunset Valley"],
  },
  {
    id: "dallas",
    name: "Dallas",
    label: "Dallas, Texas",
    country: "United States",
    cities: ["Dallas", "Fort Worth", "Arlington", "Plano", "Irving", "Garland", "Grand Prairie", "McKinney", "Frisco", "Richardson", "Mesquite", "Carrollton", "Denton", "Lewisville", "Allen", "Flower Mound", "Mansfield", "Grapevine", "Coppell", "Rockwall", "Keller", "The Colony", "Duncanville", "Southlake", "Hurst"],
  },
  {
    id: "chicago",
    name: "Chicago",
    label: "Chicago, Illinois",
    country: "United States",
    cities: ["Chicago", "Evanston", "Skokie", "Oak Park", "Cicero", "Naperville", "Aurora", "Joliet", "Schaumburg", "Wheaton", "Downers Grove", "Elmhurst", "Oak Lawn", "Tinley Park", "Orland Park", "Bolingbrook", "Hoffman Estates", "Palatine", "Arlington Heights", "Waukegan", "Elgin", "Glenview", "Des Plaines", "Highland Park", "Gary", "Hammond"],
  },
  {
    id: "los-angeles",
    name: "Los Angeles",
    label: "Los Angeles, California",
    country: "United States",
    cities: ["Los Angeles", "Long Beach", "Santa Monica", "Pasadena", "Glendale", "Burbank", "Inglewood", "Torrance", "Pomona", "Downey", "West Covina", "El Monte", "Whittier", "Alhambra", "Culver City", "Beverly Hills", "Manhattan Beach", "Redondo Beach", "Compton", "Lakewood", "Norwalk", "Carson", "Santa Clarita", "Arcadia", "Monterey Park"],
  },
  {
    id: "san-diego",
    name: "San Diego",
    label: "San Diego, California",
    country: "United States",
    cities: ["San Diego", "Chula Vista", "Oceanside", "Escondido", "Carlsbad", "El Cajon", "Vista", "San Marcos", "Encinitas", "La Mesa", "Santee", "Poway", "National City", "Solana Beach", "Del Mar", "Coronado", "Imperial Beach", "Lemon Grove", "Fallbrook"],
  },
  {
    id: "seattle",
    name: "Seattle",
    label: "Seattle, Washington",
    country: "United States",
    cities: ["Seattle", "Bellevue", "Tacoma", "Everett", "Renton", "Kent", "Federal Way", "Redmond", "Kirkland", "Shoreline", "Burien", "Auburn", "Lakewood", "Lynnwood", "Bothell", "Edmonds", "Sammamish", "Issaquah", "Tukwila", "SeaTac", "Woodinville", "Marysville"],
  },
  {
    id: "tampa",
    name: "Tampa",
    label: "Tampa, Florida",
    country: "United States",
    cities: ["Tampa", "St. Petersburg", "Clearwater", "Brandon", "Largo", "Lakeland", "Palm Harbor", "Pinellas Park", "Plant City", "Dunedin", "Safety Harbor", "Seminole", "Tarpon Springs", "Wesley Chapel", "Riverview", "Valrico", "Temple Terrace", "Oldsmar", "New Port Richey", "Zephyrhills", "Spring Hill"],
  },
  {
    id: "phoenix",
    name: "Phoenix",
    label: "Phoenix, Arizona",
    country: "United States",
    cities: ["Phoenix", "Scottsdale", "Mesa", "Chandler", "Gilbert", "Glendale", "Tempe", "Peoria", "Surprise", "Goodyear", "Avondale", "Buckeye", "Queen Creek", "Apache Junction", "Fountain Hills", "Paradise Valley", "Cave Creek", "Sun City", "El Mirage", "Tolleson", "Maricopa"],
  },
  {
    id: "denver",
    name: "Denver",
    label: "Denver, Colorado",
    country: "United States",
    cities: ["Denver", "Aurora", "Lakewood", "Arvada", "Westminster", "Thornton", "Centennial", "Boulder", "Longmont", "Broomfield", "Littleton", "Englewood", "Parker", "Castle Rock", "Commerce City", "Brighton", "Northglenn", "Golden", "Wheat Ridge", "Greenwood Village", "Lone Tree", "Louisville"],
  },
  {
    id: "minneapolis",
    name: "Minneapolis",
    label: "Minneapolis, Minnesota",
    country: "United States",
    cities: ["Minneapolis", "St. Paul", "Bloomington", "Plymouth", "Brooklyn Park", "Maple Grove", "Woodbury", "Eden Prairie", "Burnsville", "Blaine", "Lakeville", "Minnetonka", "Apple Valley", "Edina", "St. Louis Park", "Shakopee", "Eagan", "Coon Rapids", "Richfield", "Roseville", "Fridley"],
  },
  {
    id: "philadelphia",
    name: "Philadelphia",
    label: "Philadelphia, Pennsylvania",
    country: "United States",
    cities: ["Philadelphia", "Camden", "Cherry Hill", "Wilmington", "Norristown", "Chester", "Upper Darby", "King of Prussia", "Conshohocken", "Ardmore", "Bryn Mawr", "Wayne", "Media", "West Chester", "Doylestown", "Lansdale", "Pottstown", "Phoenixville", "Bensalem", "Levittown", "Collingswood", "Haddonfield", "Moorestown", "Mount Laurel"],
  },
  {
    id: "pittsburgh",
    name: "Pittsburgh",
    label: "Pittsburgh, Pennsylvania",
    country: "United States",
    cities: ["Pittsburgh", "Monroeville", "Bethel Park", "Mount Lebanon", "Penn Hills", "Cranberry Township", "McCandless", "Moon Township", "Upper St. Clair", "Plum", "Murrysville", "Wexford", "Sewickley", "Canonsburg", "Washington", "Beaver", "New Kensington", "Carnegie", "Bridgeville", "West Mifflin"],
  },
  {
    id: "cincinnati",
    name: "Cincinnati",
    label: "Cincinnati, Ohio",
    country: "United States",
    cities: ["Cincinnati", "Covington", "Newport", "Florence", "Mason", "West Chester", "Fairfield", "Hamilton", "Springdale", "Blue Ash", "Sharonville", "Milford", "Loveland", "Lebanon", "Middletown", "Fort Thomas", "Bellevue", "Erlanger", "Independence", "Lawrenceburg", "Montgomery", "Madeira", "Norwood"],
  },
  {
    id: "columbus",
    name: "Columbus",
    label: "Columbus, Ohio",
    country: "United States",
    cities: ["Columbus", "Dublin", "Westerville", "Grove City", "Reynoldsburg", "Upper Arlington", "Hilliard", "Gahanna", "Pickerington", "Worthington", "Bexley", "Whitehall", "Delaware", "Powell", "New Albany", "Canal Winchester", "Marysville", "Lancaster", "Newark", "London"],
  },
  {
    id: "new-orleans",
    name: "New Orleans",
    label: "New Orleans, Louisiana",
    country: "United States",
    cities: ["New Orleans", "Metairie", "Kenner", "Gretna", "Harvey", "Marrero", "Westwego", "Chalmette", "Arabi", "Terrytown", "Belle Chasse", "Slidell", "Mandeville", "Covington", "Laplace", "Destrehan", "Luling", "River Ridge", "Harahan"],
  },
  {
    id: "orlando",
    name: "Orlando",
    label: "Orlando, Florida",
    country: "United States",
    cities: ["Orlando", "Winter Park", "Altamonte Springs", "Kissimmee", "Sanford", "Winter Garden", "Ocoee", "Apopka", "Oviedo", "Lake Mary", "Longwood", "Casselberry", "Maitland", "Winter Springs", "Clermont", "St. Cloud", "Celebration", "Davenport", "Haines City", "Mount Dora"],
  },
  {
    id: "houston",
    name: "Houston",
    label: "Houston, Texas",
    country: "United States",
    cities: ["Houston", "Pasadena", "Pearland", "League City", "Sugar Land", "The Woodlands", "Conroe", "Baytown", "Missouri City", "Friendswood", "Katy", "Humble", "Spring", "Tomball", "Atascocita", "Channelview", "Deer Park", "La Porte", "Stafford", "Bellaire", "Webster", "Alvin"],
  },
  {
    id: "san-antonio",
    name: "San Antonio",
    label: "San Antonio, Texas",
    country: "United States",
    cities: ["San Antonio", "New Braunfels", "Boerne", "Schertz", "Cibolo", "Converse", "Universal City", "Live Oak", "Selma", "Helotes", "Fair Oaks Ranch", "Leon Valley", "Alamo Heights", "Windcrest", "Floresville", "Seguin", "Bulverde", "Canyon Lake"],
  },
  {
    id: "las-vegas",
    name: "Las Vegas",
    label: "Las Vegas, Nevada",
    country: "United States",
    cities: ["Las Vegas", "Henderson", "North Las Vegas", "Boulder City", "Enterprise", "Spring Valley", "Paradise", "Summerlin South", "Sunrise Manor", "Winchester", "Whitney", "Pahrump"],
  },
  {
    id: "detroit",
    name: "Detroit",
    label: "Detroit, Michigan",
    country: "United States",
    cities: ["Detroit", "Warren", "Sterling Heights", "Livonia", "Dearborn", "Troy", "Westland", "Farmington Hills", "Rochester Hills", "Southfield", "Taylor", "Pontiac", "Royal Oak", "Novi", "St. Clair Shores", "Roseville", "Ferndale", "Birmingham", "Auburn Hills", "Canton", "Plymouth", "Clinton Township", "Shelby Township"],
  },
  {
    id: "san-juan",
    name: "San Juan",
    label: "San Juan, Puerto Rico",
    country: "Puerto Rico",
    cities: ["San Juan", "Bayamón", "Carolina", "Caguas", "Guaynabo", "Toa Baja", "Toa Alta", "Dorado", "Trujillo Alto", "Canóvanas", "Río Grande", "Gurabo", "Vega Baja", "Catano", "Loíza", "Juncos"],
  },
  {
    id: "london",
    name: "London",
    label: "London, United Kingdom",
    country: "United Kingdom",
    cities: ["London", "Croydon", "Bromley", "Romford", "Ilford", "Enfield", "Harrow", "Wembley", "Ealing", "Kingston upon Thames", "Richmond upon Thames", "Hounslow", "Uxbridge", "Watford", "Dartford", "Sutton", "St Albans", "Woking", "Slough"],
  },
  {
    id: "manchester",
    name: "Manchester",
    label: "Manchester, United Kingdom",
    country: "United Kingdom",
    cities: ["Manchester", "Salford", "Stockport", "Bolton", "Bury", "Oldham", "Rochdale", "Altrincham", "Sale", "Stretford", "Ashton-under-Lyne", "Wigan", "Eccles", "Prestwich", "Middleton", "Hyde", "Stalybridge", "Wilmslow", "Macclesfield", "Denton"],
  },
  {
    id: "dubai",
    name: "Dubai",
    label: "Dubai, United Arab Emirates",
    country: "United Arab Emirates",
    cities: ["Dubai", "Sharjah", "Ajman"],
  },
  {
    id: "paris",
    name: "Paris",
    label: "Paris, France",
    country: "France",
    cities: ["Paris", "Saint-Denis", "Boulogne-Billancourt", "Argenteuil", "Montreuil", "Nanterre", "Créteil", "Versailles", "Colombes", "Asnières-sur-Seine", "Aulnay-sous-Bois", "Rueil-Malmaison", "Aubervilliers", "Champigny-sur-Marne", "Issy-les-Moulineaux", "Levallois-Perret", "Noisy-le-Grand", "Neuilly-sur-Seine", "Antony", "Cergy", "Saint-Germain-en-Laye"],
  },
  {
    id: "barcelona",
    name: "Barcelona",
    label: "Barcelona, Spain",
    country: "Spain",
    cities: ["Barcelona", "L'Hospitalet de Llobregat", "Badalona", "Terrassa", "Sabadell", "Mataró", "Santa Coloma de Gramenet", "Sant Cugat del Vallès", "Cornellà de Llobregat", "Sant Boi de Llobregat", "Rubí", "Cerdanyola del Vallès", "Esplugues de Llobregat", "Granollers", "El Prat de Llobregat", "Gavà", "Castelldefels", "Viladecans", "Sant Adrià de Besòs"],
  },
  {
    id: "lisbon",
    name: "Lisbon",
    label: "Lisbon, Portugal",
    country: "Portugal",
    cities: ["Lisbon", "Amadora", "Oeiras", "Loures", "Cascais", "Sintra", "Almada", "Setúbal", "Barreiro", "Seixal", "Odivelas", "Vila Franca de Xira", "Mafra", "Montijo", "Palmela", "Sesimbra", "Moita", "Alcochete"],
  },
  {
    id: "toronto",
    name: "Toronto",
    label: "Toronto, Canada",
    country: "Canada",
    cities: ["Toronto", "Mississauga", "Brampton", "Markham", "Vaughan", "Richmond Hill", "Oakville", "Burlington", "Milton", "Ajax", "Pickering", "Whitby", "Oshawa", "Newmarket", "Aurora", "Caledon", "Georgetown"],
  },
  {
    id: "montreal",
    name: "Montreal",
    label: "Montreal, Canada",
    country: "Canada",
    cities: ["Montreal", "Laval", "Longueuil", "Terrebonne", "Brossard", "Repentigny", "Saint-Jean-sur-Richelieu", "Boucherville", "Dollard-des-Ormeaux", "Blainville", "Châteauguay", "Saint-Eustache", "Mascouche", "Vaudreuil-Dorion", "Kirkland", "Pointe-Claire", "Sainte-Thérèse", "Mirabel", "La Prairie", "Candiac"],
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
  if (MARKET_NAME_ALIASES[t]) return MARKET_NAME_ALIASES[t];
  // Display labels are presentation only, but a label pasted or
  // submitted as a market value (Jeff's "Virginia Beach
  // (Hampton Roads)", 2026-10-23) must still land on the
  // canonical market, never a phantom one.
  const byLabel = MARKETS.find((m) => m.label === t);
  if (byLabel) return byLabel.name;
  const bare = t.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (bare !== t) {
    if (MARKET_NAME_ALIASES[bare]) return MARKET_NAME_ALIASES[bare];
    if (MARKETS.some((m) => m.name === bare)) return bare;
  }
  return t;
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
// Lifestyle, Sports and Music added 2026-10-28 (Jeff): every surface
// (join chips, profile editing, Discover chips, preview) reads this
// one list through bootstrap, and every save path validates against
// it, so new values land everywhere at once. "Other" stays last.
const CREATOR_CATEGORIES = [
  "Food & Drink", "Nightlife", "Beauty & Grooming", "Fitness & Wellness",
  "Health & Wellness", "Retail & Shopping", "Attractions & Events",
  "Local Services", "Lifestyle", "Sports", "Music", "Other",
];

// What the creator does off-platform (profile builder, Jeff,
// 2026-10-22: the realtor layer). Optional everyday-language
// self-description; it never gates completeness, offers, or tiers.
// Reduced 2026-10-28 (Jeff) to the three values that carry product
// behavior or identity: "Real estate agent" flags a realtor profile
// (neighborhood tags, brokerage attribution, listing proof sheet),
// "Student" pairs with the university/campus fields, and
// "Photographer / videographer" is a creator-type role. The themes
// the old everyday values named are expressed through CREATOR_
// CATEGORIES now ("What you create in"), Family & parenting
// included via Lifestyle.
const PROFESSIONS = [
  "Real estate agent", "Student", "Photographer / videographer",
];
// Values retired from the offered list on 2026-10-28. They remain
// VALID stored values: cleanProfession keeps accepting them so a
// profile saved with one loads, displays and re-saves untouched.
// They are never offered to new selections (bootstrap ships only
// PROFESSIONS).
const LEGACY_PROFESSIONS = [
  "Food & drink", "Beauty & style", "Fitness & wellness",
  "Family & parenting", "Other",
];
const REALTOR_PROFESSION = "Real estate agent";

// What creators would accept as a comp (profile builder).
const COMP_CATEGORIES = [
  "Restaurant meals", "Drinks & nightlife", "Beauty services",
  "Fitness classes & passes", "Health & wellness services",
  "Retail products", "Attractions & experiences",
  "Local Services", "Other",
];

const BUSINESS_CATEGORIES = [
  "Restaurant", "Bar", "Coffee & Bakery", "Salon & Barbershop",
  "Fitness Studio", "Retail", "Attraction", "Local Services", "Other",
];

// Taxonomy string integrity (Jeff, 2026-10-28): category values
// must match the canonical lists byte-for-byte on every surface.
// COMP_CATEGORIES once spelled its last-but-one value "Local
// services" while the creator and business lists use "Local
// Services"; the comp list now uses the same spelling, and every
// write/read path canonicalizes through canonicalFromList, which
// matches case-insensitively (and collapses whitespace) so a
// legacy stored variant like "Local services" still validates,
// still saves as the canonical string, and still matches Discover
// filters instead of silently dropping or going unfilterable.
function canonicalFromList(value, list) {
  if (typeof value !== "string") return null;
  const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const v = norm(value);
  if (!v) return null;
  for (const item of list || []) if (norm(item) === v) return item;
  return null;
}

// Three plans (Jeff, 2026-10-19; FOUNDING structure locked
// 2026-10-26). Prices below are FOUNDING rates: a founding business
// keeps its rate while the plan stays active; later cohorts step
// up. Every plan carries the $100 founding credit on the first
// month (first month $99 / $249 / $599). All 3-month minimum, then
// month to month. No per-location charge. Unused visits roll into
// the next month and expire at the end of that month (one month of
// carry max; see planAllowanceFor in router.js). Content rights
// follow the VISIT and the LICENSE, never the plan (rights model
// adopted 2026-10-21, license standardized 2026-10-26): a comp
// visit is native sharing only on every plan; a paid booking
// includes one standard license of 90 days of repost + paid ad
// use; a comped post can be licensed the same way at the creator's
// listed licensing fee, with the creator's approval. Paid bookings
// and licensing are available on every plan; Growth is the tier
// built for paid work and reuse (license library, priority
// access). Managed is hand-held, with more visits and the
// quarterly hero feature.
const PLANS = [
  {
    id: "self-service",
    name: "Self-Service",
    priceMonthly: 199,
    foundingCredit: 100,
    firstMonthPriceMonthly: 99,
    minMonths: 3,
    visitsPerMonth: 5,
    features: [
      "Browse the roster, send comp offers",
      "Up to 5 visits / month",
      "Unused visits roll over one month",
      "Post tracking + results",
      "Share comp posts inside Instagram, creator tagged",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 349,
    foundingCredit: 100,
    firstMonthPriceMonthly: 249,
    minMonths: 3,
    visitsPerMonth: 10,
    features: [
      "Browse the roster, send comp offers",
      "Up to 10 visits / month",
      "Unused visits roll over one month",
      "Post tracking + results",
      "Paid bookings at creators' listed rates",
      "Paid bookings include the 90-day license",
      "Every license tracked in one library",
      "Priority access to the creators you license",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    priceMonthly: 699,
    foundingCredit: 100,
    firstMonthPriceMonthly: 599,
    minMonths: 3,
    visitsPerMonth: 20,
    features: [
      "A coordinator runs everything",
      "Up to 20 visits / month",
      "Unused visits roll over one month",
      "Calendar + scheduling handled",
      "Monthly paid budget, spent for you",
      "Quarterly hero creator feature",
      "Paid bookings + licenses handled · monthly report",
    ],
  },
];

// ---------- typed-city resolution (city -> metro) ----------
// The not-listed signup path takes a free-typed city ("Portsmouth,
// United States") and parks the record in the "Not listed yet"
// pool, even when the town already belongs to a market's published
// city list above (Portsmouth is a Virginia Beach market city).
// The resolver closes that gap: it normalizes the typed value,
// strips state/country suffixes, and matches it against every
// market's city list (and canonical name). Three outcomes:
//   unique    - exactly one market claims the town; the record is
//               filed under that metro and keeps the typed city as
//               its home city.
//   ambiguous - two or more markets claim the town (College Park
//               is in both the Washington DC and Atlanta lists);
//               the record stays unlisted with the candidates
//               stored, and the person picks. A state suffix or
//               hint that exactly one candidate sits in resolves
//               the tie (College Park, GA -> Atlanta).
//   none      - no market claims the town; the typed city stays
//               the demand signal for a future market, unchanged.
// State/country filtering is lenient by design: a filter that
// would empty the candidate pool is ignored rather than punishing
// a mistyped state, so resolution never does worse than the
// unfiltered match. One exception (Build -52): when the pool has
// narrowed to exactly ONE market - the auto-file case - an
// explicit state the market does not sit in, or an explicit
// country different from the market's, VETOES the match and the
// outcome is none. Clarksville is the case: it sits only in
// Nashville's list, so bare "Clarksville" files to Nashville,
// but "Clarksville, VA" is a different real town (Mecklenburg
// County) in no market's footprint, and filing that person into
// Nashville would be the mirror image of the bug -52 fixes. The
// veto never applies to an ambiguous pool: a tie never auto-files,
// and the person's own one-tap pick stays available exactly as
// designed.

// US states and territories a typed suffix or form hint can carry,
// as full name -> USPS code. The reverse lookup is derived.
const US_STATE_CODES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const US_STATE_BY_CODE = {};
for (const [name, code] of Object.entries(US_STATE_CODES)) US_STATE_BY_CODE[code] = name;

// The state(s) each market sits in, for tie-breaking only. Most
// SIGNL markets are single-state; Washington DC spans DC/MD/VA and
// Charlotte reaches into South Carolina (Rock Hill, Fort Mill).
// The Build -52 footprint lists added three more cross-state
// metros: Chicago reaches into Indiana (Gary, Hammond),
// Philadelphia into New Jersey and Delaware (Camden, Cherry Hill,
// Wilmington), and Cincinnati into Kentucky and Indiana
// (Covington, Newport, Lawrenceburg). International markets
// carry none: their country does the work.
const MARKET_STATES = {
  "hampton-roads": ["VA"],
  richmond: ["VA"],
  "washington-dc": ["DC", "MD", "VA"],
  raleigh: ["NC"],
  charlotte: ["NC", "SC"],
  baltimore: ["MD"],
  atlanta: ["GA"],
  nashville: ["TN"],
  austin: ["TX"],
  dallas: ["TX"],
  chicago: ["IL", "IN"],
  "los-angeles": ["CA"],
  "san-diego": ["CA"],
  seattle: ["WA"],
  tampa: ["FL"],
  phoenix: ["AZ"],
  denver: ["CO"],
  minneapolis: ["MN"],
  philadelphia: ["PA", "NJ", "DE"],
  pittsburgh: ["PA"],
  cincinnati: ["OH", "KY", "IN"],
  columbus: ["OH"],
  "new-orleans": ["LA"],
  orlando: ["FL"],
  houston: ["TX"],
  "san-antonio": ["TX"],
  "las-vegas": ["NV"],
  detroit: ["MI"],
  "san-juan": ["PR"],
};

const COUNTRY_ALIASES = {
  "united states": "United States",
  "united states of america": "United States",
  usa: "United States",
  us: "United States",
  america: "United States",
  "united kingdom": "United Kingdom",
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  canada: "Canada",
  france: "France",
  spain: "Spain",
  portugal: "Portugal",
  "united arab emirates": "United Arab Emirates",
  uae: "United Arab Emirates",
  "puerto rico": "Puerto Rico",
};

function normalizeCityKey(s) {
  return String(s || "").toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
}

function stateCodeOf(part) {
  if (!part) return null;
  const raw = String(part).trim();
  if (/^[A-Za-z]{2}$/.test(raw) && US_STATE_BY_CODE[raw.toUpperCase()]) return raw.toUpperCase();
  return US_STATE_CODES[normalizeCityKey(raw)] || null;
}

function countryNameOf(part) {
  if (!part) return null;
  return COUNTRY_ALIASES[normalizeCityKey(part)] || null;
}

// Splits a typed city value into its parts: the city itself plus
// any state and country the value or the form hints carry.
// "Portsmouth, United States" -> { city: "Portsmouth", country:
// "United States" }; "College Park, GA" -> { city: "College Park",
// state: "GA" }. The returned keys are every spelling worth trying
// against the city lists: the city as typed, the legacy-alias
// normalization of it (so a typed "Hampton Roads" still lands on
// Virginia Beach), and city + state code ("Washington" + "DC" ->
// "Washington DC", a listed city).
function parseTypedCity(raw, hints) {
  const h = hints || {};
  const parts = String(raw || "").split(",").map((p) => p.trim()).filter(Boolean);
  const city = parts.length ? parts[0] : "";
  let state = null;
  let country = null;
  for (const part of parts.slice(1)) {
    const c = countryNameOf(part);
    if (c) { country = country || c; continue; }
    const s = stateCodeOf(part);
    if (s) {
      state = state || s;
      if (s === "PR") country = country || "Puerto Rico";
    }
    // Anything else (a province, a county) is ignored: it cannot
    // disambiguate between SIGNL markets today.
  }
  if (!state) state = stateCodeOf(h.state);
  if (!country) country = countryNameOf(h.country);
  const keys = [];
  const push = (k) => { if (k && !keys.includes(k)) keys.push(k); };
  push(normalizeCityKey(city));
  push(normalizeCityKey(normalizeMarketName(city)));
  if (state) push(`${normalizeCityKey(city)} ${state.toLowerCase()}`);
  return { city, state, country, keys };
}

function matchCityInMarkets(cityKey, markets) {
  const hits = [];
  for (const m of markets) {
    const names = [m.name, ...(m.cities || [])];
    for (const n of names) {
      if (normalizeCityKey(normalizeMarketName(n)) === cityKey) {
        hits.push({ market: m, matchedCity: n });
        break;
      }
    }
  }
  return hits;
}

// resolveTypedCity(raw, hints, markets?) -> one of
//   { status: "unique", market, marketId, city, state, country }
//   { status: "ambiguous", markets: [names], matches: [{ market,
//     city }], city, state, country }
//   { status: "none", city }
// `city` on a unique result is the matched list spelling (what the
// confirmation copy names); on an ambiguous result it is the
// typed city as given.
function resolveTypedCity(raw, hints, markets) {
  const list = Array.isArray(markets) && markets.length ? markets : MARKETS;
  const parsed = parseTypedCity(raw, hints);
  if (!parsed.city) return { status: "none", city: "" };
  const byId = new Map();
  for (const key of parsed.keys) {
    for (const hit of matchCityInMarkets(key, list)) {
      if (!byId.has(hit.market.id)) byId.set(hit.market.id, hit);
    }
  }
  let pool = [...byId.values()];
  if (!pool.length) return { status: "none", city: parsed.city };
  if (parsed.country) {
    const byCountry = pool.filter((hit) => (hit.market.country || "United States") === parsed.country);
    if (byCountry.length) pool = byCountry;
  }
  if (parsed.state) {
    const byState = pool.filter((hit) => (MARKET_STATES[hit.market.id] || []).includes(parsed.state));
    if (byState.length) pool = byState;
  }
  if (pool.length === 1) {
    const hit = pool[0];
    // Build -52 veto (see the design note above): an explicit
    // state or country that contradicts the one surviving market
    // means the typed town is a same-named place elsewhere; the
    // record stays unlisted with its typed city as the demand
    // signal instead of being auto-filed into the wrong metro.
    if (parsed.country && (hit.market.country || "United States") !== parsed.country) {
      return { status: "none", city: parsed.city };
    }
    const homeStates = MARKET_STATES[hit.market.id] || [];
    if (parsed.state && homeStates.length && !homeStates.includes(parsed.state)) {
      return { status: "none", city: parsed.city };
    }
    return { status: "unique", market: hit.market.name, marketId: hit.market.id, city: hit.matchedCity, state: parsed.state, country: parsed.country };
  }
  return {
    status: "ambiguous",
    markets: pool.map((hit) => hit.market.name),
    matches: pool.map((hit) => ({ market: hit.market.name, city: hit.matchedCity })),
    city: parsed.city,
    state: parsed.state,
    country: parsed.country,
  };
}

module.exports = { MARKETS, MARKET_NAME_ALIASES, normalizeMarketName, MARKET_STATES, parseTypedCity, resolveTypedCity, TIERS, CREATOR_CATEGORIES, COMP_CATEGORIES, BUSINESS_CATEGORIES, PLANS, PROFESSIONS, LEGACY_PROFESSIONS, REALTOR_PROFESSION, canonicalFromList, tierForFollowers, normalizeTierBand };
