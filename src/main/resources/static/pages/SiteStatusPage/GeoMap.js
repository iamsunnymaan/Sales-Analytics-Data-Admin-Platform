// Site Status page's Geo Map popup (SiteStatusPage.html/.js — the "Geo Map" toggle card after the
// Site Code picker opens #siteStatusGeoMapModalBackdrop and calls this module's initGeoMap() the
// first time) — #siteStatusGeoMapCard (initFilterMap): a political map of India (state + district
// boundaries only, thin lines, vector-effect: non-scaling-stroke), scoped by two cascading dropdowns
// (State -> District) — picking a State fits the map to it and shows its districts; picking a
// District narrows further to just that one. A state can also be picked by clicking it directly on
// the "All India" overview (onStateClick), and a "Back" button steps back up District -> State -> All
// India. Each change re-fits the projection to exactly the chosen scope; also fixed, no zoom/pan on
// top of that fit (removed per explicit request). No city markers/labels are drawn (removed per
// explicit request — first the "green dot" no-site cities, then the "red dot" has-site ones too). The
// City dropdown/solo-city map fit were removed per explicit request — coveredCities is still used
// elsewhere (the stat card's own city counts), just no longer as a map-scoping control.
//
// initGeoMap(status) is called lazily (dynamic import, see SiteStatusPage.js) the first time the
// popup opens, not at module load — the map card starts hidden (display:none) behind the toggle, and
// renderFilteredMap below sizes itself off the container's real clientWidth/clientHeight, which are
// both 0 while hidden. `status` is the Site Insight page's own Status toggle pill (All/Active/
// Inactive/Upcoming) — initGeoMap re-runs every time that toggle changes while the popup is open (see
// SiteStatusPage.js's wireGeoMapModal), each status's own underlying data fetch cached separately
// (getGeoData below) so re-visiting a status already seen this page load is free, only a genuinely
// new status re-fetches. Formerly lived on the Dashboard page (index.html's old "4. Geo Map"
// section) — moved here in full per explicit request, nothing left on Dashboard.
//
// Data: /pages/SiteStatusPage/data/india-map.json is a TopoJSON topology (objects: "states" [36
// states/UTs] and "districts" [726 districts], properties st_nm/district) sourced from
// udit-001/india-maps-data (public GitHub dataset, no explicit license — used here for this internal
// tool's own map visualization, not redistributed). /pages/SiteStatusPage/data/india-cities.json is a
// trimmed (n/s/d/lat/lon/r) list of India's 528 cities with 2011-census population >100k, from
// Vynex/indian-cities-geodata (Apache-2.0) — no longer used for on-map markers (see above), only to
// resolve the site_master City/State connection below (which census city a site's City/State names
// refer to), feeding the coveredCities count in the stat card.
//
// Connected to site_master (GET /api/dashboard/geo-map/site-cities, DashboardGeoMapService — route/
// service names kept as-is, an internal implementation detail, not tied to which page calls them):
// every distinct (City, State) site_master carries is matched to a census city from india-cities.json
// (exact name+alias, then a length-scaled fuzzy match for real typos in that table — see
// matchSiteCityTo* below), and district coverage is derived transitively from each matched city's own
// district field (site_master itself has no District column). Districts with a matched site render in
// the distinct "has-site" color (SiteStatusPage.css) and are clickable: GET
// /api/dashboard/geo-map/sites?city=... lists the real site_master rows for the real City name(s)
// that matched into that district, in a small popup (renderSitePopup below); picking one navigates
// (same tab, full reload) to this same page with ?siteCode=&brand= — the picker at the top recognizes
// those params and loads the site's detail view (profile/KPI/monthly-history/recent-transactions,
// backed by its own GET /api/site-detail, SiteDetailService) inline, same as picking that site
// manually there (the reload also closes this popup, which is fine — the site detail view below is
// the whole point of following that link). That page's own context row (SiteStatusPage.js's
// updateGeoMapContext) — a minimized rendering of just the loaded site's own State (renderStateSnapshot
// below, with the same has-site district click-through this popup itself uses) alongside a store-list
// card for every site_master row in that State — updates from the loaded site's own data on every
// load, not from anything carried in this URL.
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

const MAP_DATA_URL = "/pages/SiteStatusPage/data/india-map.json";
const CITIES_DATA_URL = "/pages/SiteStatusPage/data/india-cities.json";
const NEIGHBOR_COUNTRIES_URL = "/pages/SiteStatusPage/data/neighbor-countries.json";
const SITE_CITIES_URL = "/api/dashboard/geo-map/site-cities";
const SITES_BY_CITY_URL = "/api/dashboard/geo-map/sites";
const SITE_STATUS_PAGE_URL = "/pages/SiteStatusPage/SiteStatusPage.html";
const GEO_MAP_CONTAINER_ID = "siteStatusGeoMapCard";

// Removed per explicit request — these three (island territories + the Dadra/Nagar Haveli/Daman/Diu
// UT) have no site_master presence and clutter the map; excluded here rather than at the data-file
// level so india-map.json itself stays the unmodified upstream topology.
const EXCLUDED_STATE_NAMES = new Set([
    "Andaman and Nicobar Islands",
    "Lakshadweep",
    "Dadra and Nagar Haveli and Daman and Diu",
]);

// Neighboring countries shown for geographic context (added per explicit request) — trimmed from
// world-atlas's countries-50m topology (ISC license) down to just these three (see
// neighbor-countries.json's own generation; ~6KB vs. the ~750KB full world file). No site_master tie-
// in (not a market this dashboard tracks), so no click-through/coverage coloring — outline + label only.
const NEIGHBOR_COUNTRY_NAMES = ["Nepal", "Bangladesh", "Sri Lanka"];

// site_master's City/State are free-text (real typos live there — "Bareily", "Bhatinda", "Rourkel",
// "Visakhaptanam" — plus real name differences from the census dataset this map ships, which is
// 2011-census-based and so still uses several pre-rename names: "Gurgaon" (not "Gurugram"), "Mysore"
// (not "Mysuru"), "Allahabad" (not "Prayagraj"). Each entry below maps a name site_master might use
// to whichever spelling actually appears in india-cities.json (verified against that file directly,
// not guessed) — typos are instead caught by the length-scaled fuzzy match below.
const CITY_ALIASES = {
    bangalore: "bengaluru",
    trivandrum: "thiruvananthapuram",
    gurugram: "gurgaon",
    bombay: "mumbai",
    madras: "chennai",
    calcutta: "kolkata",
    poona: "pune",
    baroda: "vadodara",
    cochin: "kochi",
    mysuru: "mysore",
    prayagraj: "allahabad",
    gauhati: "guwahati",
};

// A matched census city's own `d` (district) field can still fail to resolve to any real
// india-map.json district even after CITY_ALIASES gets the city name itself matched — the district
// name is a second, independent place the same "2011 census vs. today" staleness shows up
// (Gurgaon's own district is now "Gurugram", same rename as the city), plus real spelling
// differences between this bundled dataset and the topology (Kalburgi/Kalaburagi), and a few census
// cities whose `d` field names a smaller town rather than the real enclosing district (Noida's real
// district is Gautam Buddha Nagar; Malegaon's is Nashik). Verified against this project's own
// bundled india-cities.json/india-map.json directly (every entry below was a real
// districtNameMatches miss, checked one by one), not guessed. Keyed by "state|census district name"
// since a district name isn't guaranteed unique across states (normalized the same way
// districtNameMatches itself normalizes both sides).
const DISTRICT_ALIASES = {
    "haryana|gurgaon": "gurugram",
    "odisha|khurda": "khordha",
    "uttar pradesh|allahabad": "prayagraj",
    "uttar pradesh|faizabad": "ayodhya",
    "uttar pradesh|noida": "gautam buddha nagar",
    "uttar pradesh|gautam budh nagar": "gautam buddha nagar",
    "uttar pradesh|raebareli": "rae bareli",
    "uttar pradesh|sant ravidas nagar": "bhadohi",
    "uttar pradesh|baghput": "baghpat",
    "karnataka|kalburgi": "kalaburagi",
    "karnataka|south canara": "dakshina kannada",
    "karnataka|davangere": "davanagere",
    "karnataka|bellary": "ballari",
    "karnataka|shimoga": "shivamogga",
    "karnataka|chikkamagallooru": "chikkamagaluru",
    "karnataka|ramnagar": "ramanagara",
    "punjab|mohali": "s.a.s. nagar",
    "punjab|firozpur": "ferozepur",
    "mizoram|aizwal": "aizawl",
    "tamil nadu|kanchipuram": "kancheepuram",
    "tamil nadu|thoothukudi": "thoothukkudi",
    "telangana|mahbubnagar": "mahabubnagar",
    "meghalaya|east khassi hills": "east khasi hills",
    "gujarat|palanpur": "banaskantha",
    "rajasthan|beawar": "ajmer",
    "maharashtra|malegaon": "nashik",
    "west bengal|midnapore east": "purba medinipur",
};

function normalize(str) {
    return String(str ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Caps how many edits a fuzzy match may differ by, scaled to name length — a flat cap (e.g. always
// allow 2) lets short names like "Goa" (3) or "Kurla" (5) collide with an unrelated city ("Agra",
// "Korba") that merely happens to be nearby in edit distance. Longer names can afford a looser cap
// since 2 edits is a much smaller fraction of them (this is what actually catches real typos like
// "Bareily" -> "Bareilly" or "Visakhaptanam" -> "Visakhapatnam").
function maxFuzzyDistance(len) {
    if (len <= 4) return 0;
    if (len <= 6) return 1;
    return 2;
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

// Matches one site_master (City, State) pair to a census city from the bundled dataset: exact
// normalized name (+ alias) first, preferring a state match when the name is ambiguous; otherwise a
// length-scaled edit-distance fallback (catches typos) again preferring a state match. Returns the
// matched census city object (the actual bundled object, so callers can mark it covered by
// reference) or null.
function matchSiteCityToCensusCity(siteCityName, siteStateName, censusCities, byNormalizedName) {
    const name = normalize(siteCityName);
    if (!name) return null;
    const aliased = CITY_ALIASES[name] || name;
    const state = normalize(siteStateName);

    const exact = byNormalizedName.get(aliased);
    if (exact && exact.length) {
        const stateMatch = exact.find((c) => normalize(c.s) === state);
        return stateMatch || exact[0];
    }

    const maxDist = maxFuzzyDistance(aliased.length);
    if (maxDist === 0) return null;
    let best = null;
    let bestDist = maxDist + 1;
    let bestStateMatches = false;
    for (const c of censusCities) {
        const dist = levenshtein(aliased, normalize(c.n));
        if (dist > maxDist) continue;
        const stateMatches = normalize(c.s) === state;
        if (dist < bestDist || (dist === bestDist && stateMatches && !bestStateMatches)) {
            best = c;
            bestDist = dist;
            bestStateMatches = stateMatches;
        }
    }
    return best;
}

// Fallback for site cities that aren't in the 528-city dataset at all (e.g. "Thane" — genuinely
// absent from that list despite its size) but whose name IS itself a real district name (many
// Indian cities and their home district share a name). No lat/lon is available this way, so it can
// only contribute district coverage, not a city marker.
function matchSiteCityToDistrictName(siteCityName, siteStateName, byNormalizedDistrictName) {
    const name = normalize(siteCityName);
    if (!name) return null;
    const candidates = byNormalizedDistrictName.get(name);
    if (!candidates || !candidates.length) return null;
    const state = normalize(siteStateName);
    return candidates.find((f) => normalize(f.properties.st_nm) === state) || candidates[0];
}

// A census city's own `d` (district) field is sometimes a combined string (e.g. Siliguri's is
// "Darjeeling; Jalpaiguri") since the source dataset ties a city to whichever district the source
// considered primary, not always a single clean topojson district name — this substring check in
// both directions handles that without needing to split/parse every district field up front. Falls
// back to DISTRICT_ALIASES (state-scoped) when neither side is a substring of the other — the same
// old-name/typo/wrong-grain staleness CITY_ALIASES fixes for city names, one level down.
function districtNameMatches(censusDistrictField, topoDistrictName, stateName) {
    const a = normalize(censusDistrictField);
    const b = normalize(topoDistrictName);
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const aliased = DISTRICT_ALIASES[`${normalize(stateName)}|${a}`];
    return aliased != null && aliased === b;
}

async function loadJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to load ${url}: ${res.status}`);
    }
    return res.json();
}

// Loads the shared topology/cities/site-coverage data. Returns null (never throws) if the core
// map/city data can't load — the caller shows its own error message. status ("all"/"active"/
// "inactive"/"upcoming", the Site Insight page's own Status toggle pill) scopes siteCities down to
// site_master rows matching it (OperationalStatusFilter, server-side) — every has-site district/
// state/city highlight on the map, plus its store counts, flow from this one filtered fetch.
async function loadGeoData(status) {
    let topology, cities, siteCities, neighborTopology;
    const siteCitiesUrl = status ? `${SITE_CITIES_URL}?status=${encodeURIComponent(status)}` : SITE_CITIES_URL;
    try {
        [topology, cities, siteCities, neighborTopology] = await Promise.all([
            loadJson(MAP_DATA_URL),
            loadJson(CITIES_DATA_URL),
            // Best-effort: a real political map is still worth showing even if the site_master join
            // fails for some reason, so this one alone doesn't take the whole map down with it.
            loadJson(siteCitiesUrl).catch(() => []),
            // Same best-effort treatment — the neighboring-country outlines are context, not core
            // data, so a failed fetch here shouldn't take India's own map down with it either.
            loadJson(NEIGHBOR_COUNTRIES_URL).catch(() => null),
        ]);
    } catch (err) {
        return null;
    }

    // Andaman/Lakshadweep/Dadra-Nagar-Haveli-Daman-Diu excluded per explicit request (see
    // EXCLUDED_STATE_NAMES) — filtered out of both layers up front so nothing downstream (fitSize,
    // coverage matching, dropdowns) ever sees them.
    const statesGeo = topojson.feature(topology, topology.objects.states);
    statesGeo.features = statesGeo.features.filter((f) => !EXCLUDED_STATE_NAMES.has(f.properties.st_nm));
    const districtsGeo = topojson.feature(topology, topology.objects.districts);
    districtsGeo.features = districtsGeo.features.filter((f) => !EXCLUDED_STATE_NAMES.has(f.properties.st_nm));

    const neighborCountriesGeo = neighborTopology
        ? topojson.feature(neighborTopology, neighborTopology.objects.countries)
        : { type: "FeatureCollection", features: [] };
    // Fixed display order (Nepal, Bangladesh, Sri Lanka — NEIGHBOR_COUNTRY_NAMES) regardless of
    // whatever order the source topology happened to list them in.
    neighborCountriesGeo.features.sort((a, b) =>
        NEIGHBOR_COUNTRY_NAMES.indexOf(a.properties.name) - NEIGHBOR_COUNTRY_NAMES.indexOf(b.properties.name));

    const byNormalizedName = new Map();
    for (const c of cities) {
        const key = normalize(c.n);
        if (!byNormalizedName.has(key)) byNormalizedName.set(key, []);
        byNormalizedName.get(key).push(c);
    }
    const byNormalizedDistrictName = new Map();
    for (const f of districtsGeo.features) {
        const key = normalize(f.properties.district);
        if (!byNormalizedDistrictName.has(key)) byNormalizedDistrictName.set(key, []);
        byNormalizedDistrictName.get(key).push(f);
    }
    // districtToSiteCities: "state|district" -> the real site_master City name(s) (verbatim, as
    // that table spells them — not the census name) that matched into that district. Feeds the
    // click-through popup: clicking a has-site district asks the backend for real site_master rows
    // in exactly these City names (GET /api/dashboard/geo-map/sites?city=...).
    const coveredDistrictKeys = new Set();
    const districtToSiteCities = new Map();
    function addDistrictCity(key, cityName) {
        if (!districtToSiteCities.has(key)) districtToSiteCities.set(key, new Set());
        districtToSiteCities.get(key).add(cityName);
    }
    // storeCountByState: normalized official (topojson st_nm) state name -> total site_master row
    // count (getSiteCities' own site_count, summed across every site_master City that matched into
    // that state) — feeds the bottom-right "site_master coverage" stat panel. Same match-or-
    // district-fallback resolution as district coverage above, so a site_master City that resolves to
    // neither a census city nor a real district name is left uncounted here too, consistently.
    const storeCountByState = new Map();
    function addStoreCount(stateName, count) {
        const key = normalize(stateName);
        storeCountByState.set(key, (storeCountByState.get(key) || 0) + count);
    }
    for (const sc of siteCities) {
        const siteCount = Number(sc.site_count) || 0;
        const match = matchSiteCityToCensusCity(sc.City, sc.State, cities, byNormalizedName);
        if (match) {
            match.covered = true;
            addStoreCount(match.s, siteCount);
            // A matched census city's own `d` (district) field is sometimes a combined string (see
            // districtNameMatches's own comment) that would never exact-match any single real
            // topojson district name — resolve it to the real district(s) it actually refers to
            // (there can be more than one) instead of keying coverage on the raw combined string.
            const resolvedDistricts = districtsGeo.features.filter((f) =>
                normalize(f.properties.st_nm) === normalize(match.s) && districtNameMatches(match.d, f.properties.district, match.s));
            if (resolvedDistricts.length) {
                for (const rd of resolvedDistricts) {
                    const key = `${normalize(rd.properties.st_nm)}|${normalize(rd.properties.district)}`;
                    coveredDistrictKeys.add(key);
                    addDistrictCity(key, sc.City);
                }
            } else {
                const key = `${normalize(match.s)}|${normalize(match.d)}`;
                coveredDistrictKeys.add(key);
                addDistrictCity(key, sc.City);
            }
            continue;
        }
        const districtMatch = matchSiteCityToDistrictName(sc.City, sc.State, byNormalizedDistrictName);
        if (districtMatch) {
            const key = `${normalize(districtMatch.properties.st_nm)}|${normalize(districtMatch.properties.district)}`;
            coveredDistrictKeys.add(key);
            addDistrictCity(key, sc.City);
            addStoreCount(districtMatch.properties.st_nm, siteCount);
        }
    }

    // Only cities with a real site_master match render as markers on either card — the green
    // "no site here" dots (and their name labels) are intentionally not shown, per explicit request.
    const coveredCities = cities.filter((c) => c.covered);

    return {
        statesGeo, districtsGeo, cities, coveredCities, coveredDistrictKeys, districtToSiteCities,
        neighborCountriesGeo, storeCountByState,
    };
}

function isDistrictCovered(coveredDistrictKeys, feature) {
    return coveredDistrictKeys.has(`${normalize(feature.properties.st_nm)}|${normalize(feature.properties.district)}`);
}

// A state counts as "has-site" iff storeCountByState (loadGeoData) carries a nonzero total for it —
// built from the exact same match-or-district-fallback resolution as district coverage, so this stays
// consistent with which districts render "has-site" within it.
function isStateCovered(storeCountByState, stateName) {
    return (storeCountByState.get(normalize(stateName)) || 0) > 0;
}

// --- Click-through: has-site district -> site list popup -> Site Status page (same tab) -----------
// Called once per rendered svg — the map rebuilds its svg on every dropdown change, so this gets
// re-wired each time.

function closeSitePopup(container) {
    const existing = container.querySelector(".geo-map-site-popup");
    if (existing) existing.remove();
}

// Returns { bodyEl, setCount } — setCount fills in the header's site-code count badge once the
// async site fetch resolves (unknown, so left blank, at shell-render time).
function renderSitePopupShell(container, title) {
    closeSitePopup(container);
    const popup = document.createElement("div");
    popup.className = "geo-map-site-popup";
    popup.innerHTML = `
        <div class="geo-map-site-popup-header">
            <span class="geo-map-site-popup-title">${escapeHtml(title)}</span>
            <span class="geo-map-site-popup-count"></span>
            <button type="button" class="geo-map-site-popup-close" aria-label="Close">&times;</button>
        </div>
        <div class="geo-map-site-popup-body"></div>
    `;
    popup.querySelector(".geo-map-site-popup-close").addEventListener("click", () => popup.remove());
    container.appendChild(popup);
    const countEl = popup.querySelector(".geo-map-site-popup-count");
    return {
        bodyEl: popup.querySelector(".geo-map-site-popup-body"),
        setCount: (n) => { countEl.textContent = `${n} site code${n === 1 ? "" : "s"}`; },
    };
}

function renderSiteList(bodyEl, sites) {
    if (!sites.length) {
        bodyEl.innerHTML = `<div class="geo-map-site-popup-empty">No sites found.</div>`;
        return;
    }
    bodyEl.innerHTML = sites.map((s) => `
        <button type="button" class="geo-map-site-popup-row" data-site-code="${escapeHtml(s.Site_Code)}" data-brand="${escapeHtml(s.Brand)}">
            <span class="geo-map-site-popup-code">${escapeHtml(s.Site_Code)}</span>
            <span class="geo-map-site-popup-name">${escapeHtml(s.Store_Name ?? "—")}</span>
            <span class="geo-map-site-popup-meta">${escapeHtml(s.Brand ?? "—")} · ${escapeHtml(s.City ?? "—")} · ${escapeHtml(s.Region ?? "—")}</span>
        </button>`).join("");
    bodyEl.querySelectorAll(".geo-map-site-popup-row").forEach((btn) => {
        btn.addEventListener("click", () => {
            const url = `${SITE_STATUS_PAGE_URL}?siteCode=${encodeURIComponent(btn.dataset.siteCode)}&brand=${encodeURIComponent(btn.dataset.brand)}`;
            window.location.href = url;
        });
    });
}

// Makes every currently-rendered has-site district path in `svg` clickable: opens a small popup
// (anchored in `container`, which is the card element — always position:relative) listing the real
// site_master sites located there, each row navigating (same tab) to that site's detail view on the
// Site Status page. status scopes this click-through list the same as the has-site coloring itself
// (data was already fetched/matched for this same status — see loadGeoData) — kept as its own param
// here too since the actual site rows come from a separate backend call (SITES_BY_CITY_URL) that
// needs telling explicitly, not implied by which districts happen to render "has-site".
function wireDistrictClicks(container, svg, data, status) {
    svg.selectAll(".geo-map-district-boundary.has-site")
        .on("click", async (event, d) => {
            event.stopPropagation();
            const key = `${normalize(d.properties.st_nm)}|${normalize(d.properties.district)}`;
            const cityNames = Array.from(data.districtToSiteCities.get(key) || []);
            if (!cityNames.length) return;
            const { bodyEl, setCount } = renderSitePopupShell(container, `${d.properties.district}, ${d.properties.st_nm}`);
            bodyEl.innerHTML = `<div class="geo-map-site-popup-loading">Loading sites…</div>`;
            try {
                const qs = cityNames.map((c) => `city=${encodeURIComponent(c)}`).join("&")
                    + (status ? `&status=${encodeURIComponent(status)}` : "");
                const sites = await loadJson(`${SITES_BY_CITY_URL}?${qs}`);
                setCount(sites.length);
                renderSiteList(bodyEl, sites);
            } catch (err) {
                bodyEl.innerHTML = `<div class="geo-map-site-popup-empty">Failed to load sites.</div>`;
            }
        });
}

// --- Color-key legend ------------------------------------------------------------------------------
// Small always-visible legend pinned to the map's bottom-right corner — explains what each fill on
// the map means (has-site vs. no-site state/district, neighboring-country outline). Static (doesn't
// change with selection), so it's created once and never updated.

function createLegend(container) {
    const el = document.createElement("div");
    el.className = "geo-map-legend";
    el.innerHTML = `
        <div class="geo-map-legend-item">
            <span class="geo-map-legend-swatch has-site"></span>
            <span>Has site</span>
        </div>
        <div class="geo-map-legend-item">
            <span class="geo-map-legend-swatch no-site"></span>
            <span>No site</span>
        </div>
        <div class="geo-map-legend-item">
            <span class="geo-map-legend-swatch neighbor"></span>
            <span>Neighboring country</span>
        </div>
    `;
    container.appendChild(el);
    return el;
}

// --- Shared: neighboring-country context layer ----------------------------------------------------
// Nepal/Bangladesh/Sri Lanka outlines, added per explicit request purely for geographic context — no
// site_master tie-in, so no click handler and no coverage coloring, just a muted fill/border/label
// (Dashboard.css's own geo-map-neighbor-* rules). Appended first so every India layer painted after
// it sits on top at the (rare) pixel where a border overlaps.

function renderNeighborLayer(parentSelection, neighborCountriesGeo, path) {
    const layer = parentSelection.append("g").attr("class", "geo-map-neighbor-layer");
    layer.selectAll("path")
        .data(neighborCountriesGeo.features)
        .join("path")
        .attr("class", "geo-map-neighbor-fill")
        .attr("d", path);
    // Anchor+inner-text split, matching the state/district labels' own markup shape (translate on
    // the outer <g>, plain text on the inner element).
    layer.selectAll("g")
        .data(neighborCountriesGeo.features)
        .join("g")
        .attr("class", "geo-map-label-anchor")
        .attr("transform", (d) => {
            const [x, y] = path.centroid(d);
            return `translate(${x},${y})`;
        })
        .append("text")
        .attr("class", "geo-map-label-inner geo-map-neighbor-label")
        .text((d) => d.properties.name);
    return layer;
}

// --- State / District filter map -----------------------------------------------------------------

function initFilterMap(containerId, data, status) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { statesGeo, districtsGeo } = data;
    const stateNames = Array.from(new Set(statesGeo.features.map((f) => f.properties.st_nm))).sort();

    container.innerHTML = `
        <div class="geo-map-filter-bar">
            <button type="button" class="geo-map-back-btn" data-role="back" aria-label="Back" disabled>&larr; Back</button>
            <select class="geo-map-filter-select" data-role="state" aria-label="State">
                <option value="">All India</option>
                ${stateNames.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
            </select>
            <select class="geo-map-filter-select" data-role="district" aria-label="District" disabled>
                <option value="ALL">All Districts</option>
            </select>
        </div>
        <div class="geo-map-filter-map-wrap"></div>
    `;

    const backBtn = container.querySelector('[data-role="back"]');
    const stateSelect = container.querySelector('[data-role="state"]');
    const districtSelect = container.querySelector('[data-role="district"]');
    const mapWrap = container.querySelector(".geo-map-filter-map-wrap");

    function districtsForState(stateName) {
        return districtsGeo.features
            .filter((f) => f.properties.st_nm === stateName)
            .slice()
            .sort((a, b) => a.properties.district.localeCompare(b.properties.district));
    }

    function refreshDistrictOptions() {
        const stateName = stateSelect.value;
        if (!stateName) {
            districtSelect.innerHTML = `<option value="ALL">All Districts</option>`;
            districtSelect.disabled = true;
            districtSelect.value = "ALL";
            return;
        }
        const districts = districtsForState(stateName);
        districtSelect.innerHTML = `<option value="ALL">All Districts</option>` +
            districts.map((f) => `<option value="${escapeHtml(f.properties.district)}">${escapeHtml(f.properties.district)}</option>`).join("");
        districtSelect.disabled = false;
        districtSelect.value = "ALL";
    }

    // One step back up District -> State -> All India, whichever is currently the most specific
    // pick — mirrors what clearing just that one dropdown would do, without the user having to know
    // which dropdown that is.
    function updateBackButton() {
        backBtn.disabled = !stateSelect.value && districtSelect.value === "ALL";
    }

    function goBack() {
        if (districtSelect.value !== "ALL") {
            districtSelect.value = "ALL";
            rerender();
        } else if (stateSelect.value) {
            selectState("");
        }
    }

    function rerender() {
        renderFilteredMap(mapWrap, data, {
            state: stateSelect.value || null,
            district: districtSelect.value,
        }, selectState, status);
        updateBackButton();
    }

    // Shared by the State dropdown's own change handler and clicking a state directly on the map
    // (renderFilteredMap's onStateClick, only wired in the "All India" overview) — both just move the
    // dropdown to that state and re-fit/rerender to it.
    function selectState(stateName) {
        stateSelect.value = stateName;
        refreshDistrictOptions();
        rerender();
    }

    backBtn.addEventListener("click", goBack);
    stateSelect.addEventListener("change", () => selectState(stateSelect.value));
    districtSelect.addEventListener("change", rerender);

    rerender();
}

// --- State stat popup card -------------------------------------------------------------------------
// A small always-visible card pinned over the bottom of the map — not the full-cover click-through
// .geo-map-site-popup (that one only appears on a has-site district click and fills the whole map
// area), just reusing its card look (rounded, shadowed, card-bg) at a much smaller footprint. Shows
// two lines for the current scope: the raw map totals (every district/city in the topology/census
// data, regardless of site_master) and the real site_master coverage (districts/cities with a
// matched site, plus total store count via storeCountByState). No selected state (stateName null)
// falls back to an All India aggregate.

function computeStateStats(data, stateName) {
    const { districtsGeo, coveredDistrictKeys, coveredCities, cities, storeCountByState } = data;
    if (stateName) {
        const totalDistricts = districtsGeo.features.filter((f) => f.properties.st_nm === stateName).length;
        const totalCities = cities.filter((c) => c.s === stateName).length;
        const coveredDistricts = districtsGeo.features
            .filter((f) => f.properties.st_nm === stateName && isDistrictCovered(coveredDistrictKeys, f)).length;
        const coveredCitiesCount = coveredCities.filter((c) => c.s === stateName).length;
        const storeCount = storeCountByState.get(normalize(stateName)) || 0;
        return { label: stateName, totalDistricts, totalCities, coveredDistricts, coveredCitiesCount, storeCount };
    }
    let storeCount = 0;
    for (const v of storeCountByState.values()) storeCount += v;
    return {
        label: "All India",
        totalDistricts: districtsGeo.features.length,
        totalCities: cities.length,
        coveredDistricts: coveredDistrictKeys.size,
        coveredCitiesCount: coveredCities.length,
        storeCount,
    };
}

function renderStateStatPanels(mapWrap, data, stateName) {
    const s = computeStateStats(data, stateName);

    const card = document.createElement("div");
    card.className = "geo-map-stat-card";
    card.innerHTML = `
        <div class="geo-map-stat-card-title">${escapeHtml(s.label)}</div>
        <div class="geo-map-stat-card-row">
            <span class="geo-map-stat-card-label">Map</span>
            District: ${s.totalDistricts}, City: ${s.totalCities}
        </div>
        <div class="geo-map-stat-card-row">
            <span class="geo-map-stat-card-label">Sites</span>
            District: ${s.coveredDistricts}, City: ${s.coveredCitiesCount}, Store: ${s.storeCount}
        </div>
    `;
    mapWrap.appendChild(card);
}

function renderFilteredMap(mapWrap, data, selection, onStateClick, status) {
    const { statesGeo, districtsGeo, coveredDistrictKeys, neighborCountriesGeo, storeCountByState } = data;
    mapWrap.innerHTML = "";
    const width = mapWrap.clientWidth || 300;
    const height = mapWrap.clientHeight || 300;
    if (!width || !height) return;

    const selectedStateFeature = selection.state
        ? statesGeo.features.find((f) => f.properties.st_nm === selection.state)
        : null;
    const selectedDistrictFeature = (selection.state && selection.district && selection.district !== "ALL")
        ? districtsGeo.features.find((f) => f.properties.st_nm === selection.state && f.properties.district === selection.district)
        : null;

    let fitFeature, statesToShow, districtsToShow;

    if (selectedDistrictFeature) {
        fitFeature = selectedDistrictFeature;
        districtsToShow = [selectedDistrictFeature];
        statesToShow = selectedStateFeature ? [selectedStateFeature] : [];
    } else if (selectedStateFeature) {
        fitFeature = selectedStateFeature;
        statesToShow = [selectedStateFeature];
        districtsToShow = districtsGeo.features.filter((f) => f.properties.st_nm === selection.state);
    } else {
        // "All India" (no state picked) — fit includes the neighboring countries too (Sri Lanka in
        // particular would otherwise render half cut-off).
        fitFeature = { type: "FeatureCollection", features: [...statesGeo.features, ...neighborCountriesGeo.features] };
        statesToShow = statesGeo.features;
        districtsToShow = [];
    }

    const projection = d3.geoMercator().fitSize([width, height], fitFeature);
    const path = d3.geoPath(projection);

    const svg = d3.select(mapWrap)
        .append("svg")
        .attr("class", "dashboard-geo-map-svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const layer = svg.append("g");
    renderNeighborLayer(layer, neighborCountriesGeo, path);

    // In the "All India" overview (statesToShow.length > 1, i.e. no state picked yet), clicking a
    // state's own fill drills straight into it — same as picking it from the State dropdown. Once a
    // state is already selected (statesToShow is just that one feature), this no longer applies;
    // narrowing further from there is what the District dropdown is for.
    const stateIsClickable = onStateClick && statesToShow.length > 1;
    layer.append("g").attr("class", "geo-map-state-fill-layer")
        .selectAll("path")
        .data(statesToShow)
        .join("path")
        .attr("class", (d) => `geo-map-state-fill${isStateCovered(storeCountByState, d.properties.st_nm) ? " has-site" : ""}${stateIsClickable ? " clickable" : ""}`)
        .attr("d", path)
        .on("click", stateIsClickable ? (event, d) => onStateClick(d.properties.st_nm) : null);

    // "is-visible" (not toggled here, always on) — scope is already narrowed by the dropdowns above.
    layer.append("g").attr("class", "geo-map-district-layer is-visible")
        .selectAll("path")
        .data(districtsToShow)
        .join("path")
        .attr("class", (d) => `geo-map-district-boundary${isDistrictCovered(coveredDistrictKeys, d) ? " has-site" : ""}`)
        .attr("d", path);

    layer.append("g").attr("class", "geo-map-state-border-layer")
        .selectAll("path")
        .data(statesToShow)
        .join("path")
        .attr("class", "geo-map-state-boundary")
        .attr("d", path);

    // Labels use the anchor+inner-text split (translate on the outer <g>, plain scale on the inner
    // <text>) mainly so state and district labels can share one flat selector elsewhere in this file.
    const labelLayer = layer.append("g").attr("class", "geo-map-label-layer");
    // Only states with a real site_master site get a name label, via isStateCovered/storeCountByState.
    labelLayer.selectAll("g.geo-map-state-label-anchor")
        .data(statesToShow.filter((d) => isStateCovered(storeCountByState, d.properties.st_nm)))
        .join("g")
        .attr("class", "geo-map-label-anchor geo-map-state-label-anchor")
        .attr("transform", (d) => {
            const [x, y] = path.centroid(d);
            return `translate(${x},${y})`;
        })
        .append("text")
        .attr("class", "geo-map-label-inner geo-map-state-label")
        .text((d) => d.properties.st_nm);

    labelLayer.selectAll("g.geo-map-district-label-anchor")
        .data(districtsToShow)
        .join("g")
        .attr("class", "geo-map-label-anchor geo-map-district-label-anchor")
        .attr("transform", (d) => {
            const [x, y] = path.centroid(d);
            return `translate(${x},${y})`;
        })
        .append("text")
        .attr("class", "geo-map-label-inner geo-map-district-label")
        .text((d) => d.properties.district);

    createLegend(mapWrap);
    wireDistrictClicks(mapWrap, svg, data, status);
    renderStateStatPanels(mapWrap, data, selection.state);
}

// --- Bootstrap -------------------------------------------------------------------------------------
// Exported (not self-invoked) — SiteStatusPage.js dynamically imports this module and calls
// initGeoMap() the first time the Geo Map toggle opens the popup, per this file's own header comment.
// initFilterMap itself is idempotent-safe to call twice (rebuilds container.innerHTML fresh each
// time), but callers should still only invoke initGeoMap() once per page load — no need to re-fetch
// the topology/cities/site-coverage data on every reopen.

// Cached across calls within one page load, per Status ("all"/"active"/"inactive"/"upcoming", the
// Site Insight page's own toggle pill) — both initGeoMap (the popup) and renderStateSnapshot (the
// Site Status page's own minimized-map context row, see SiteStatusPage.js's updateGeoMapContext) can
// end up calling this in the same session; the underlying topology/cities/site-coverage fetch is the
// same regardless of which caller triggered it for a given status, so there's no reason to redo it
// twice for that same status — but a different status IS a genuinely different fetch (loadGeoData's
// own siteCities call is status-scoped server-side), hence one cached promise per status rather than
// the single shared one this used to be.
const geoDataPromiseByStatus = new Map();
function getGeoData(status) {
    const key = status || "all";
    if (!geoDataPromiseByStatus.has(key)) {
        geoDataPromiseByStatus.set(key, loadGeoData(status));
    }
    return geoDataPromiseByStatus.get(key);
}

export async function initGeoMap(status) {
    const data = await getGeoData(status);
    if (!data) {
        const el = document.getElementById(GEO_MAP_CONTAINER_ID);
        if (el) el.innerHTML = `<span class="dashboard-geo-map-error">Map data unavailable</span>`;
        return;
    }
    initFilterMap(GEO_MAP_CONTAINER_ID, data, status);
}

// Minimized rendering of a single state — just its own district boundaries with the same has-site
// coloring the full popup map uses, for the Site Status page's own context row (SiteStatusPage.js's
// wireGeoMapContextRow) that shows which state a Geo Map deep-link's site came from, alongside a
// store-list card for that same state. No filter bar/legend/stat card (redundant at this size, scope
// is already fixed to one state), but a has-site district click still opens the exact same site-list
// popup the full map's own district click does (wireDistrictClicks/renderSiteList below) — same
// click-through, just no dropdown chrome around it.
export async function renderStateSnapshot(containerId, stateName, status) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const data = await getGeoData(status);
    if (!data) {
        container.innerHTML = `<span class="dashboard-geo-map-error">Map data unavailable</span>`;
        return;
    }

    const { statesGeo, districtsGeo, coveredDistrictKeys } = data;
    const stateFeature = statesGeo.features.find((f) => f.properties.st_nm === stateName);
    if (!stateFeature) {
        container.innerHTML = `<span class="dashboard-geo-map-error">State not found</span>`;
        return;
    }
    const districtsToShow = districtsGeo.features.filter((f) => f.properties.st_nm === stateName);

    // "X of Y districts" have at least one real site_master row matched into them (has-site, same
    // green highlight the map below draws) — shown next to the state name in this card's own header,
    // same convention the Stores card's header uses for its own store count.
    const districtCountEl = document.getElementById("siteStatusMiniMapDistrictCount");
    if (districtCountEl) {
        const coveredCount = districtsToShow.filter((f) => isDistrictCovered(coveredDistrictKeys, f)).length;
        districtCountEl.textContent = `${coveredCount} of ${districtsToShow.length} districts`;
    }

    container.innerHTML = "";
    const width = container.clientWidth || 160;
    const height = container.clientHeight || 160;

    const projection = d3.geoMercator().fitSize([width, height], stateFeature);
    const path = d3.geoPath(projection);

    const svg = d3.select(container)
        .append("svg")
        .attr("class", "dashboard-geo-map-svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const layer = svg.append("g");

    layer.append("g").attr("class", "geo-map-district-layer is-visible")
        .selectAll("path")
        .data(districtsToShow)
        .join("path")
        .attr("class", (d) => `geo-map-district-boundary${isDistrictCovered(coveredDistrictKeys, d) ? " has-site" : ""}`)
        .attr("d", path);

    layer.append("path")
        .attr("class", "geo-map-state-boundary")
        .attr("d", path(stateFeature));

    wireDistrictClicks(container, svg, data, status);
}
