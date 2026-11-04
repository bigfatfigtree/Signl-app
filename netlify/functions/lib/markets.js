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
// Build -59 (Jeff, 2026-10-30): Miami RESTORED as a full market.
// Jeff removed Miami in the 2026-10-23 reset above and reversed
// that call the same day as -52 ("add miami and all surrounding
// locations of metro area"): the Miami market below carries the
// full tri-county metro footprint - Miami-Dade, Broward and Palm
// Beach counties, 48 places people type - so a sign-up typing
// Fort Lauderdale or Boca Raton files into Miami exactly the way
// a Clarksville sign-up files into Nashville. The roster is 38
// markets; the country set is unchanged. Miami starts NOT live,
// like every unlaunched market (the live-flag default lives in
// router.js): it files and counts, it does not launch itself.
// Build -86 (Jeff, 2026-11-02): London becomes a full push
// market - "go hard with it just as much" as the US pump
// markets. The typed entry below has existed since 2026-10-18;
// this build's work is the surfaces around it (a real London
// claim-welcome photo, and a UK ad-labelling note in the claim
// and join forms mirroring the Dubai permit note). The entry
// itself is unchanged - same id, label, country and city list -
// so the resolver's pinned outcomes hold (bare "London" stays
// the Columbus/London tie; the United Kingdom hint picks this
// market) and London starts NOT live like every unlaunched
// market: creator founding sign-ups only, no launch date and
// no businesses promised anywhere on the creator surfaces.
// Build -117 (Jeff, 2026-11-03): New Zealand joins the roster —
// Auckland (removed in the 2026-10-23 reset) is restored and
// Wellington and Christchurch are added, each with its genuine
// metro-area list (the market contains its surrounding towns;
// the list entries are the area filter layer, the same pattern
// as London). The roster is 41 markets in 9 countries. The NZ
// markets carry no currency override: currency-by-market
// (Build -89) is an optional per-market entry, London is the
// only market that carries one, and Manchester ships without
// one — so NZ creators default to USD ($, $50 paid floor) like
// Manchester's do until Jeff approves an NZD price book and
// floor the way he approved GBP for London (Builds -89/-103).
// Area names that already file to another market's list stay
// out of the NZ lists (Henderson stays Las Vegas's pinned
// outcome; St Albans, Sydenham and Beckenham stay London's),
// except "Wellington" itself, which sits in Miami's city list
// as the Palm Beach town: the two-market tie is the designed
// outcome there, the same shape as bare "London" tying
// Columbus and London, and the New Zealand hint resolves it.

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
    id: "miami",
    name: "Miami",
    label: "Miami, Florida",
    country: "United States",
    cities: ["Miami", "Miami Beach", "Hialeah", "Miami Gardens", "Doral", "Coral Gables", "Kendall", "Homestead", "Florida City", "North Miami", "North Miami Beach", "Aventura", "Sunny Isles Beach", "Miami Lakes", "Hialeah Gardens", "Sweetwater", "Cutler Bay", "Pinecrest", "Palmetto Bay", "Miami Springs", "Opa-locka", "Key Biscayne", "Fort Lauderdale", "Hollywood", "Pembroke Pines", "Miramar", "Coral Springs", "Pompano Beach", "Davie", "Plantation", "Sunrise", "Weston", "Coconut Creek", "Margate", "Lauderhill", "Tamarac", "Deerfield Beach", "Cooper City", "West Palm Beach", "Boca Raton", "Delray Beach", "Boynton Beach", "Lake Worth Beach", "Palm Beach Gardens", "Jupiter", "Wellington", "Riviera Beach", "Greenacres"],
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
    // Build -88 (2026-11-02): London is ONE market (Jeff's ruling);
    // this typed list is its full neighbourhood + surrounding-towns
    // set — the race districts (Shoreditch/Spitalfields, Borough–
    // Bankside, Brixton, Dalston–Hackney Central–Stoke Newington,
    // Angel/Islington), the Tier 2/3 areas, the other inner areas,
    // and the surrounding towns. Every entry files to market
    // london via resolveTypedCity, and the same list feeds the
    // claim/join area picker: a London creator's home city stays
    // London and the picked entry is preserved as their area.
    id: "london",
    name: "London",
    label: "London, United Kingdom",
    country: "United Kingdom",
    // Build -89: currency-by-market. London creators set, see,
    // and are paid against GBP: £40 paid floor (US markets: $50).
    // No FX conversion anywhere — stored amounts are denominated
    // in the creator's home-market currency.
    currency: "GBP",
    currencySymbol: "£",
    paidFloor: 40,
    cities: ["London", "Shoreditch", "Spitalfields", "Borough", "Bankside", "Brixton", "Dalston", "Hackney Central", "Stoke Newington", "Angel", "Islington", "Peckham", "Camden Town", "Tooting", "Greenwich", "Clapham", "Soho", "Covent Garden", "Notting Hill", "Fitzrovia", "Marylebone", "Walthamstow", "Hackney", "Whitechapel", "Bethnal Green", "Hoxton", "Clerkenwell", "Bloomsbury", "Westminster", "Kensington", "Chelsea", "Hammersmith", "Fulham", "Battersea", "Wandsworth", "Putney", "Wimbledon", "Hampstead", "Highgate", "Kilburn", "Willesden", "Acton", "Chiswick", "Dulwich", "Herne Hill", "Streatham", "Balham", "Lewisham", "Deptford", "Stratford", "Isle of Dogs", "Tottenham", "Haringey", "Barnes", "Bermondsey", "Kennington", "Vauxhall", "Stockwell", "Camberwell", "Walworth", "Rotherhithe", "Bow", "Clapton", "Hackney Wick", "Leyton", "Leytonstone", "Forest Gate", "East Ham", "Barking", "Wood Green", "Finsbury Park", "Kentish Town", "West Hampstead", "Golders Green", "Hendon", "Finchley", "Muswell Hill", "Crouch End", "Stamford Hill", "Seven Sisters", "Southgate", "Chingford", "Blackheath", "Brockley", "Forest Hill", "Sydenham", "Crystal Palace", "East Dulwich", "Catford", "Eltham", "Woolwich", "Twickenham", "Kew", "Brentford", "Southall", "Ruislip", "Pinner", "Stanmore", "Edgware", "Barnet", "Mitcham", "Morden", "Croydon", "Bromley", "Romford", "Ilford", "Enfield", "Harrow", "Wembley", "Ealing", "Kingston upon Thames", "Richmond upon Thames", "Hounslow", "Uxbridge", "Watford", "Dartford", "Sutton", "St Albans", "Woking", "Slough", "Beckenham", "Orpington", "Hornchurch", "Dagenham", "Edmonton", "Epsom"],
  },
  {
    id: "manchester",
    name: "Manchester",
    label: "Manchester, United Kingdom",
    country: "United Kingdom",
    // Build -118: Manchester carries the identical GBP override
    // as London (Build -89) — every UK market prices in pounds:
    // £40 paid floor, GBP founding book (planBookFor("GBP")).
    currency: "GBP",
    currencySymbol: "£",
    paidFloor: 40,
    cities: ["Manchester", "Salford", "Stockport", "Bolton", "Bury", "Oldham", "Rochdale", "Altrincham", "Sale", "Stretford", "Ashton-under-Lyne", "Wigan", "Eccles", "Prestwich", "Middleton", "Hyde", "Stalybridge", "Wilmslow", "Macclesfield", "Denton"],
  },
  {
    // Build -127 (Jeff, 2026-11-04): Dublin joins the roster in
    // the expansion wave ("whatever it takes... i want all of
    // it... just go"). Dublin is ONE market: the city plus its
    // commuter belt (Swords, Tallaght, Blanchardstown, the
    // Dún Laoghaire coast, Bray/Greystones, and the Kildare and
    // Meath commuter towns). Dublin carries the EUR currency
    // override in the London shape (Build -89 pattern): €45
    // paid floor. Build -128 the same day added the EUR
    // founding book (EUR_PLANS below), so Dublin prices from
    // its own book; money is still Recorded-class only — no
    // Stripe prices exist for the EUR book. No market is live
    // for money (Jeff,
    // 2026-11-03): Dublin starts NOT live like every unlaunched
    // market — founding sign-ups only.
    id: "dublin",
    name: "Dublin",
    label: "Dublin, Ireland",
    country: "Ireland",
    currency: "EUR",
    currencySymbol: "€",
    paidFloor: 45,
    cities: ["Dublin", "Swords", "Tallaght", "Blanchardstown", "Dún Laoghaire", "Dundrum", "Blackrock", "Sandyford", "Lucan", "Clondalkin", "Ballyfermot", "Finglas", "Howth", "Malahide", "Rathfarnham", "Bray", "Greystones", "Naas", "Celbridge", "Leixlip", "Maynooth", "Skerries", "Balbriggan"],
  },
  {
    // Build -127 (Jeff, 2026-11-04): Amsterdam, Copenhagen and
    // Mexico City join the roster in the same expansion wave as
    // Dublin (Jeff's ruling the same day: every candidate city
    // is in, ranked by speed to sign-ups only). Each is ONE
    // market containing its metro and commuter towns, the
    // London pattern. Currency overrides mirror the London
    // shape: Amsterdam EUR with a €45 floor; Copenhagen DKK
    // with a kr 300 floor (Denmark is not in the euro — the
    // floor is the $50 canon at a clean local point); Mexico
    // City MXN with a $900 floor (same clean-point pattern).
    // Build -128 the same day added the EUR, DKK and MXN
    // founding books (below), so all three price from their
    // own books; money stays Recorded-class only — no Stripe
    // prices exist for these books. All three start NOT live
    // like every unlaunched market — founding sign-ups only,
    // payment gates untouched. The roster is 45 markets in 13
    // countries.
    id: "amsterdam",
    name: "Amsterdam",
    label: "Amsterdam, Netherlands",
    country: "Netherlands",
    currency: "EUR",
    currencySymbol: "€",
    paidFloor: 45,
    cities: ["Amsterdam", "Amstelveen", "Diemen", "Ouder-Amstel", "Zaandam", "Haarlem", "Hoofddorp", "Almere", "Purmerend", "Aalsmeer", "Uithoorn", "Badhoevedorp", "Weesp", "Muiden", "Naarden", "Bussum", "Hilversum"],
  },
  {
    id: "copenhagen",
    name: "Copenhagen",
    label: "Copenhagen, Denmark",
    country: "Denmark",
    currency: "DKK",
    currencySymbol: "kr",
    paidFloor: 300,
    cities: ["Copenhagen", "Frederiksberg", "Gentofte", "Hellerup", "Charlottenlund", "Lyngby", "Gladsaxe", "Søborg", "Herlev", "Ballerup", "Rødovre", "Hvidovre", "Tårnby", "Kastrup", "Dragør", "Albertslund", "Ishøj", "Vallensbæk", "Brøndby", "Høje-Taastrup", "Roskilde", "Køge"],
  },
  {
    id: "mexico-city",
    name: "Mexico City",
    label: "Mexico City, Mexico",
    country: "Mexico",
    currency: "MXN",
    currencySymbol: "$",
    paidFloor: 900,
    cities: ["Mexico City", "Ciudad de México", "CDMX", "Coyoacán", "Tlalpan", "Benito Juárez", "Miguel Hidalgo", "Cuauhtémoc", "Álvaro Obregón", "Azcapotzalco", "Iztapalapa", "Gustavo A. Madero", "Xochimilco", "Tláhuac", "Magdalena Contreras", "Cuajimalpa", "Ecatepec", "Naucalpan", "Tlalnepantla", "Nezahualcóyotl", "Chimalhuacán", "Coacalco", "Cuautitlán Izcalli", "Atizapán de Zaragoza", "Tultitlán", "Huixquilucan", "Tecámac"],
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
    // Build -128 (Jeff, 2026-11-04): Paris carries the EUR
    // override like Dublin and Amsterdam — €45 paid floor,
    // EUR_PLANS founding book. Paris shipped in the roster
    // without an override (USD default) until the expansion
    // ruling made currency config part of the market adds.
    currency: "EUR",
    currencySymbol: "€",
    paidFloor: 45,
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
    // Build -118: Canada prices in CAD. Converted from the USD
    // canon at USD/CAD 1.40 (spot 1.397, 2026-11-03): the $50
    // floor is CA$70 exactly; the founding book is CAD_PLANS.
    currency: "CAD",
    currencySymbol: "$",
    paidFloor: 70,
    cities: ["Toronto", "Mississauga", "Brampton", "Markham", "Vaughan", "Richmond Hill", "Oakville", "Burlington", "Milton", "Ajax", "Pickering", "Whitby", "Oshawa", "Newmarket", "Aurora", "Caledon", "Georgetown"],
  },
  {
    id: "montreal",
    name: "Montreal",
    label: "Montreal, Canada",
    country: "Canada",
    // Build -118: CAD, same override as Toronto (CA$70 floor,
    // CAD_PLANS founding book).
    currency: "CAD",
    currencySymbol: "$",
    paidFloor: 70,
    cities: ["Montreal", "Laval", "Longueuil", "Terrebonne", "Brossard", "Repentigny", "Saint-Jean-sur-Richelieu", "Boucherville", "Dollard-des-Ormeaux", "Blainville", "Châteauguay", "Saint-Eustache", "Mascouche", "Vaudreuil-Dorion", "Kirkland", "Pointe-Claire", "Sainte-Thérèse", "Mirabel", "La Prairie", "Candiac"],
  },
  {
    // Build -117 (2026-11-03): Auckland restored (it was on the
    // roster 2026-10-18 to 2026-10-23) as a full metro market:
    // the supercity suburbs plus the commutable fringe (the
    // Hibiscus Coast, Warkworth's southern neighbours, Pukekohe
    // and Waiuku). Area spellings are the plain typed forms so
    // the typed-city resolver matches what people type.
    id: "auckland",
    name: "Auckland",
    label: "Auckland, New Zealand",
    country: "New Zealand",
    // Build -118: NZ prices in NZD. Converted from the USD
    // canon at USD/NZD 1.78 (NZD/USD spot 0.5626, 2026-11-03):
    // NZ$90 paid floor; the founding book is NZD_PLANS.
    currency: "NZD",
    currencySymbol: "$",
    paidFloor: 90,
    cities: ["Auckland", "Auckland CBD", "Ponsonby", "Grey Lynn", "Westmere", "Herne Bay", "Parnell", "Remuera", "Kohimarama", "Mission Bay", "St Heliers", "Glendowie", "Meadowbank", "Orakei", "Stonefields", "Ellerslie", "Greenlane", "Penrose", "Onehunga", "Mount Eden", "Kingsland", "Sandringham", "Mount Albert", "Point Chevalier", "Waterview", "Mount Roskill", "Three Kings", "Lynfield", "Blockhouse Bay", "New Lynn", "Glen Eden", "Titirangi", "Laingholm", "Swanson", "Ranui", "Massey", "Westgate", "West Harbour", "Hobsonville", "Whenuapai", "Greenhithe", "Albany", "Takapuna", "Devonport", "Birkenhead", "Northcote", "Glenfield", "Browns Bay", "Torbay", "Long Bay", "Silverdale", "Milldale", "Orewa", "Whangaparaoa", "Red Beach", "Gulf Harbour", "Riverhead", "Kumeu", "Huapai", "Helensville", "Waimauku", "Muriwai", "Piha", "Howick", "Botany", "Flat Bush", "Dannemora", "East Tamaki", "Pakuranga", "Half Moon Bay", "Bucklands Beach", "Beachlands", "Maraetai", "Whitford", "Clevedon", "Manukau", "Otara", "Papatoetoe", "Mangere", "Mangere Bridge", "Otahuhu", "Papakura", "Takanini", "Drury", "Karaka", "Pukekohe", "Waiuku", "Tuakau"],
  },
  {
    // Build -117 (2026-11-03): Wellington is ONE market — the
    // city, Porirua, the Hutt Valley and the Kapiti Coast.
    id: "wellington",
    name: "Wellington",
    label: "Wellington, New Zealand",
    country: "New Zealand",
    // Build -118: NZD, same override as Auckland (NZ$90 floor,
    // NZD_PLANS founding book).
    currency: "NZD",
    currencySymbol: "$",
    paidFloor: 90,
    cities: ["Wellington", "Te Aro", "Thorndon", "Mount Victoria", "Oriental Bay", "Kelburn", "Aro Valley", "Mount Cook", "Newtown", "Berhampore", "Brooklyn", "Island Bay", "Lyall Bay", "Kilbirnie", "Hataitai", "Seatoun", "Wadestown", "Northland", "Karori", "Crofton Downs", "Ngaio", "Khandallah", "Johnsonville", "Tawa", "Grenada North", "Porirua", "Elsdon", "Aotea", "Titahi Bay", "Mana", "Plimmerton", "Pukerua Bay", "Paekakariki", "Raumati", "Paraparaumu", "Paraparaumu Beach", "Waikanae", "Otaki", "Petone", "Maungaraki", "Lower Hutt", "Moera", "Alicetown", "Eastbourne", "Days Bay", "Wainuiomata", "Stokes Valley", "Upper Hutt", "Heretaunga", "Silverstream", "Pinehaven", "Totara Park"],
  },
  {
    // Build -117 (2026-11-03): Christchurch is ONE market —
    // the city plus the Waimakariri and Selwyn commuter towns
    // and Banks Peninsula.
    id: "christchurch",
    name: "Christchurch",
    label: "Christchurch, New Zealand",
    country: "New Zealand",
    // Build -118: NZD, same override as Auckland (NZ$90 floor,
    // NZD_PLANS founding book).
    currency: "NZD",
    currencySymbol: "$",
    paidFloor: 90,
    cities: ["Christchurch", "Christchurch Central", "Riccarton", "Upper Riccarton", "Ilam", "Burnside", "Fendalton", "Merivale", "Mairehau", "Shirley", "Edgeware", "Papanui", "Bishopdale", "Belfast", "Redwood", "Harewood", "Avonhead", "Russley", "Yaldhurst", "Sockburn", "Hornby", "Wigram", "Halswell", "Hoon Hay", "Spreydon", "Addington", "St Martins", "Opawa", "Woolston", "Ferrymead", "Heathcote Valley", "Cashmere", "Mount Pleasant", "Redcliffs", "Sumner", "Lyttelton", "Governors Bay", "Diamond Harbour", "New Brighton", "South New Brighton", "Aranui", "Waimairi Beach", "Parklands", "Burwood", "Spencerville", "Templeton", "Prebbleton", "Lincoln", "Rolleston", "West Melton", "Darfield", "Kirwee", "Tai Tapu", "Leeston", "Burnham", "Rangiora", "Kaiapoi", "Woodend", "Pegasus", "Tuahiwi", "Ohoka", "Fernside", "Oxford", "Amberley", "Little River", "Akaroa"],
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

// Currency by market (Build -89): every market defaults to USD
// ($, $50 paid floor); a market entry may override with its own
// currency code, symbol, and paid floor. Overrides on file
// (Build -118): London + Manchester GBP £40; Toronto + Montreal
// CAD $70; Auckland + Wellington + Christchurch NZD $90.
// (Builds -127/-128): Dublin + Paris + Amsterdam EUR €45;
// Copenhagen DKK kr 300; Mexico City MXN $900.
const DEFAULT_CURRENCY = { code: "USD", symbol: "$", paidFloor: 50 };
function currencyForMarket(name) {
  if (!name) return { ...DEFAULT_CURRENCY };
  const m = MARKETS.find((x) => x.name === normalizeMarketName(name) || x.id === name);
  if (m && m.currency) {
    return { code: m.currency, symbol: m.currencySymbol || "$", paidFloor: typeof m.paidFloor === "number" ? m.paidFloor : DEFAULT_CURRENCY.paidFloor };
  }
  return { ...DEFAULT_CURRENCY };
}
function paidFloorForMarket(name) {
  return currencyForMarket(name).paidFloor;
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

// The minimum audience to join SIGNL (Jeff's ruling, 2026-11-01:
// "500 followers needs to be the minimum everywhere. Everywhere.").
// TOTAL followers, stacked across every platform the creator posts
// on (the same total the tiers run on). Plain-words statement used
// wherever joining requirements are described: "SIGNL starts at
// 500 total followers across your platforms."
const MIN_TOTAL_AUDIENCE = 500;

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
      "Paid bookings include the 90-day license: repost the post, run it as an ad",
      "Every license tracked in one library, with its end date",
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

// Build -103 (Tier 3 item 16): the London GBP founding price
// book — Jeff-approved 2026-11-02: £149/£269/£549 plus VAT, a
// £75 founding credit (first months £74/£194/£474), 3-month
// minimum, founding rate held while the plan stays active,
// unused visits roll one month. London is sold ONLY through
// SIGNL's UK launch partner (the partner remits VAT on the
// full price; these figures are ex-VAT). PLANS above stay the
// USD constants the public side reads — this book is ledger
// and Admin data, reached through planBookFor(currency). Plan
// ids are the SAME in both books: an id never names two
// different products, only two currencies of one product. No
// Stripe prices exist for this book and none may be created
// from it: London money enters as Recorded-class only.
const GBP_PLANS = [
  {
    id: "self-service",
    name: "Self-Service",
    priceMonthly: 149,
    foundingCredit: 75,
    firstMonthPriceMonthly: 74,
    minMonths: 3,
    visitsPerMonth: 5,
    vatNote: "Plus VAT. Sold through SIGNL's UK launch partner.",
    features: [
      "Book from the ranked local roster",
      "5 creator visits a month",
      "Comped visits, or paid at the creator's listed rate",
      "Counted results on every visit",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 269,
    foundingCredit: 75,
    firstMonthPriceMonthly: 194,
    minMonths: 3,
    visitsPerMonth: 10,
    vatNote: "Plus VAT. Sold through SIGNL's UK launch partner.",
    features: [
      "Everything in Self-Service",
      "10 creator visits a month",
      "Built for paid work and reuse",
      "License library with renewal tracking",
      "Priority access to top local creators",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    priceMonthly: 549,
    foundingCredit: 75,
    firstMonthPriceMonthly: 474,
    minMonths: 3,
    visitsPerMonth: 20,
    vatNote: "Plus VAT. Sold through SIGNL's UK launch partner.",
    features: [
      "Everything in Growth",
      "20 creator visits a month",
      "We run the campaigns for you",
      "Monthly results review with your team",
    ],
  },
];
// Build -118 (2026-11-03, Jeff: "make Canada England New
// Zealand translate to their currency"): the NZD and CAD
// founding books, converted from the USD canon at the spot
// rates of 2026-11-03 and rounded to clean local price points
// the London way (tiers end in 9, just under the straight
// conversion; floor and credit land on clean 5s/10s).
//   NZD — USD/NZD 1.78 (NZD/USD spot 0.5626): $50 floor ->
//   NZ$90 (89.0 at rate); $100 credit -> NZ$175 (178 at rate);
//   tiers $199/$349/$699 -> NZ$349 / NZ$619 / NZ$1,239
//   (354.2 / 621.2 / 1,244.2 at rate). First months are price
//   minus credit: NZ$174 / NZ$444 / NZ$1,064.
//   CAD — USD/CAD 1.40 (spot 1.397): $50 floor -> CA$70 and
//   $100 credit -> CA$140, both exact at rate; tiers ->
//   CA$279 / CA$489 / CA$979 (278.6 / 488.6 / 978.6 at rate).
//   First months: CA$139 / CA$349 / CA$839.
// Same contract as the GBP book: plan ids are shared across
// books, prices are ledger and Admin data, and NO Stripe
// prices exist for these books or may be created from them —
// no market is live for money (Jeff, 2026-11-03), and NZ /
// Canada money enters as Recorded-class only until a local
// partner rail exists.
const NZD_PLANS = [
  {
    id: "self-service",
    name: "Self-Service",
    priceMonthly: 349,
    foundingCredit: 175,
    firstMonthPriceMonthly: 174,
    minMonths: 3,
    visitsPerMonth: 5,
    vatNote: "Plus GST where it applies.",
    features: [
      "Book from the ranked local roster",
      "5 creator visits a month",
      "Comped visits, or paid at the creator's listed rate",
      "Counted results on every visit",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 619,
    foundingCredit: 175,
    firstMonthPriceMonthly: 444,
    minMonths: 3,
    visitsPerMonth: 10,
    vatNote: "Plus GST where it applies.",
    features: [
      "Everything in Self-Service",
      "10 creator visits a month",
      "Built for paid work and reuse",
      "License library with renewal tracking",
      "Priority access to top local creators",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    priceMonthly: 1239,
    foundingCredit: 175,
    firstMonthPriceMonthly: 1064,
    minMonths: 3,
    visitsPerMonth: 20,
    vatNote: "Plus GST where it applies.",
    features: [
      "Everything in Growth",
      "20 creator visits a month",
      "We run the campaigns for you",
      "Monthly results review with your team",
    ],
  },
];
const CAD_PLANS = [
  {
    id: "self-service",
    name: "Self-Service",
    priceMonthly: 279,
    foundingCredit: 140,
    firstMonthPriceMonthly: 139,
    minMonths: 3,
    visitsPerMonth: 5,
    vatNote: "Plus applicable taxes.",
    features: [
      "Book from the ranked local roster",
      "5 creator visits a month",
      "Comped visits, or paid at the creator's listed rate",
      "Counted results on every visit",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 489,
    foundingCredit: 140,
    firstMonthPriceMonthly: 349,
    minMonths: 3,
    visitsPerMonth: 10,
    vatNote: "Plus applicable taxes.",
    features: [
      "Everything in Self-Service",
      "10 creator visits a month",
      "Built for paid work and reuse",
      "License library with renewal tracking",
      "Priority access to top local creators",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    priceMonthly: 979,
    foundingCredit: 140,
    firstMonthPriceMonthly: 839,
    minMonths: 3,
    visitsPerMonth: 20,
    vatNote: "Plus applicable taxes.",
    features: [
      "Everything in Growth",
      "20 creator visits a month",
      "We run the campaigns for you",
      "Monthly results review with your team",
    ],
  },
];
// Build -128 (Jeff, 2026-11-04, expansion ruling: "Currency:
// do it properly NOW, per city, as part of the market adds"):
// the EUR, DKK and MXN founding books, converted from the USD
// canon at the spot rates of 2026-11-03/04 and rounded to
// clean local price points the London way (tiers end in 9,
// just under the straight conversion; floor and credit land
// on clean points).
//   EUR — USD/EUR 0.895 (ECB reference, 2026-11-03): $50
//   floor -> EUR 45 (44.8 at rate); $100 credit -> EUR 85;
//   tiers $199/$349/$699 -> EUR 179 / 309 / 619 (178.1 /
//   312.4 / 625.6 at rate). First months: 94 / 224 / 534.
//   Serves Dublin, Paris and Amsterdam.
//   DKK — USD/DKK 6.685 (ECB reference, 2026-11-03):
//   Denmark is NOT in the euro, so Copenhagen's proper local
//   book is kroner: $50 floor -> kr 300 (334.3 at rate, the
//   clean point under); $100 credit -> kr 650; tiers ->
//   kr 1,299 / 2,299 / 4,599 (1,330.3 / 2,333.1 / 4,672.6 at
//   rate). First months: 649 / 1,649 / 3,949.
//   MXN — USD/MXN 18.6 (2026-11-03): $50 floor -> $900
//   (930 at rate, the clean point under); $100 credit ->
//   $1,750; tiers -> $3,699 / 6,449 / 12,999 (3,701.4 /
//   6,491.4 / 13,001.4 at rate). First months: 1,949 /
//   4,699 / 11,249.
// Same contract as every non-USD book: plan ids are shared
// across books, prices are ledger and Admin data, and NO
// Stripe prices exist for these books or may be created from
// them — no market is live for money (Jeff, 2026-11-03), and
// EUR / DKK / MXN money enters as Recorded-class only until a
// local partner rail exists.
const EUR_PLANS = [
  {
    id: "self-service",
    name: "Self-Service",
    priceMonthly: 179,
    foundingCredit: 85,
    firstMonthPriceMonthly: 94,
    minMonths: 3,
    visitsPerMonth: 5,
    vatNote: "Plus VAT where it applies.",
    features: [
      "Book from the ranked local roster",
      "5 creator visits a month",
      "Comped visits, or paid at the creator's listed rate",
      "Counted results on every visit",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 309,
    foundingCredit: 85,
    firstMonthPriceMonthly: 224,
    minMonths: 3,
    visitsPerMonth: 10,
    vatNote: "Plus VAT where it applies.",
    features: [
      "Everything in Self-Service",
      "10 creator visits a month",
      "Built for paid work and reuse",
      "License library with renewal tracking",
      "Priority access to top local creators",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    priceMonthly: 619,
    foundingCredit: 85,
    firstMonthPriceMonthly: 534,
    minMonths: 3,
    visitsPerMonth: 20,
    vatNote: "Plus VAT where it applies.",
    features: [
      "Everything in Growth",
      "20 creator visits a month",
      "We run the campaigns for you",
      "Monthly results review with your team",
    ],
  },
];
const DKK_PLANS = [
  {
    id: "self-service",
    name: "Self-Service",
    priceMonthly: 1299,
    foundingCredit: 650,
    firstMonthPriceMonthly: 649,
    minMonths: 3,
    visitsPerMonth: 5,
    vatNote: "Plus VAT (moms) where it applies.",
    features: [
      "Book from the ranked local roster",
      "5 creator visits a month",
      "Comped visits, or paid at the creator's listed rate",
      "Counted results on every visit",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 2299,
    foundingCredit: 650,
    firstMonthPriceMonthly: 1649,
    minMonths: 3,
    visitsPerMonth: 10,
    vatNote: "Plus VAT (moms) where it applies.",
    features: [
      "Everything in Self-Service",
      "10 creator visits a month",
      "Built for paid work and reuse",
      "License library with renewal tracking",
      "Priority access to top local creators",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    priceMonthly: 4599,
    foundingCredit: 650,
    firstMonthPriceMonthly: 3949,
    minMonths: 3,
    visitsPerMonth: 20,
    vatNote: "Plus VAT (moms) where it applies.",
    features: [
      "Everything in Growth",
      "20 creator visits a month",
      "We run the campaigns for you",
      "Monthly results review with your team",
    ],
  },
];
const MXN_PLANS = [
  {
    id: "self-service",
    name: "Self-Service",
    priceMonthly: 3699,
    foundingCredit: 1750,
    firstMonthPriceMonthly: 1949,
    minMonths: 3,
    visitsPerMonth: 5,
    vatNote: "Plus IVA where it applies.",
    features: [
      "Book from the ranked local roster",
      "5 creator visits a month",
      "Comped visits, or paid at the creator's listed rate",
      "Counted results on every visit",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 6449,
    foundingCredit: 1750,
    firstMonthPriceMonthly: 4699,
    minMonths: 3,
    visitsPerMonth: 10,
    vatNote: "Plus IVA where it applies.",
    features: [
      "Everything in Self-Service",
      "10 creator visits a month",
      "Built for paid work and reuse",
      "License library with renewal tracking",
      "Priority access to top local creators",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    priceMonthly: 12999,
    foundingCredit: 1750,
    firstMonthPriceMonthly: 11249,
    minMonths: 3,
    visitsPerMonth: 20,
    vatNote: "Plus IVA where it applies.",
    features: [
      "Everything in Growth",
      "20 creator visits a month",
      "We run the campaigns for you",
      "Monthly results review with your team",
    ],
  },
];
const PLAN_BOOK = { USD: PLANS, GBP: GBP_PLANS, NZD: NZD_PLANS, CAD: CAD_PLANS, EUR: EUR_PLANS, DKK: DKK_PLANS, MXN: MXN_PLANS };
// London district race (Build -106, Tier 3 item 15b): the five
// Tier 1 districts from the London launch strategy, each mapped
// to its component areas exactly as they exist in the London
// cities list above. An area in no district is outside the race
// field: it counts toward the London market totals and is never
// force-filed into a district. Race rules: first district to 40
// approved founding creators AND 15 founding businesses wins;
// at the 8-week backstop the score is creators x1 + businesses x2.
const LONDON_RACE_DISTRICTS = [
  { id: "shoreditch-spitalfields", name: "Shoreditch/Spitalfields", areas: ["Shoreditch", "Spitalfields"] },
  { id: "borough-bankside", name: "Borough–Bankside", areas: ["Borough", "Bankside", "Bermondsey"] },
  { id: "brixton", name: "Brixton", areas: ["Brixton"] },
  { id: "dalston-hackney", name: "Dalston–Hackney Central–Stoke Newington", areas: ["Dalston", "Hackney Central", "Stoke Newington"] },
  { id: "angel-islington", name: "Angel/Islington", areas: ["Angel", "Islington"] },
];
const LONDON_RACE_TARGETS = { creators: 40, businesses: 15 };
const LONDON_RACE_WEEKS = 8;
const _raceAreaMap = new Map();
for (const d of LONDON_RACE_DISTRICTS) for (const a of d.areas) _raceAreaMap.set(a.toLowerCase(), d.id);
function londonDistrictForArea(area) {
  const key = String(area || "").trim().toLowerCase();
  return key ? (_raceAreaMap.get(key) || null) : null;
}
function planBookFor(currency) {
  return PLAN_BOOK[currency] || PLANS;
}
function planInBook(id, currency) {
  return planBookFor(currency).find((p) => p.id === id) || null;
}

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
  miami: ["FL"],
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
  "new zealand": "New Zealand",
  nz: "New Zealand",
  france: "France",
  ireland: "Ireland",
  "republic of ireland": "Ireland",
  eire: "Ireland",
  netherlands: "Netherlands",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
  denmark: "Denmark",
  danmark: "Denmark",
  mexico: "Mexico",
  "méxico": "Mexico",
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

module.exports = { MARKETS, MARKET_NAME_ALIASES, normalizeMarketName, currencyForMarket, paidFloorForMarket, DEFAULT_CURRENCY, MARKET_STATES, parseTypedCity, resolveTypedCity, TIERS, CREATOR_CATEGORIES, COMP_CATEGORIES, BUSINESS_CATEGORIES, PLANS, GBP_PLANS, NZD_PLANS, CAD_PLANS, PLAN_BOOK, planBookFor, planInBook, LONDON_RACE_DISTRICTS, LONDON_RACE_TARGETS, LONDON_RACE_WEEKS, londonDistrictForArea, PROFESSIONS, LEGACY_PROFESSIONS, REALTOR_PROFESSION, canonicalFromList, tierForFollowers, normalizeTierBand, MIN_TOTAL_AUDIENCE };
