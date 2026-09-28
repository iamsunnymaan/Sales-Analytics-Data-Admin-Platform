import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

const MAP_DATA_URL = "/pages/SiteStatusPage/data/india-map.json";
const CITIES_DATA_URL = "/pages/SiteStatusPage/data/india-cities.json";
const NEIGHBOR_COUNTRIES_URL = "/pages/SiteStatusPage/data/neighbor-countries.json";
const SITE_CITIES_URL = "/api/dashboard/geo-map/site-cities";
const SITES_BY_CITY_URL = "/api/dashboard/geo-map/sites";
const SITE_STATUS_PAGE_URL = "/pages/SiteStatusPage/SiteStatusPage.html";
const GEO_MAP_CONTAINER_ID = "siteStatusGeoMapCard";


const EXCLUDED_STATE_NAMES = new Set([
    "Andaman and Nicobar Islands",
    "Lakshadweep",
    "Dadra and Nagar Haveli and Daman and Diu",
]);


const NEIGHBOR_COUNTRY_NAMES = ["Nepal", "Bangladesh", "Sri Lanka"];


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


function matchSiteCityToDistrictName(siteCityName, siteStateName, byNormalizedDistrictName) {
    const name = normalize(siteCityName);
    if (!name) return null;
    const candidates = byNormalizedDistrictName.get(name);
    if (!candidates || !candidates.length) return null;
    const state = normalize(siteStateName);
    return candidates.find((f) => normalize(f.properties.st_nm) === state) || candidates[0];
}


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


async function loadGeoData(status) {
    let topology, cities, siteCities, neighborTopology;
    const siteCitiesUrl = status ? `${SITE_CITIES_URL}?status=${encodeURIComponent(status)}` : SITE_CITIES_URL;
    try {
        [topology, cities, siteCities, neighborTopology] = await Promise.all([
            loadJson(MAP_DATA_URL),
            loadJson(CITIES_DATA_URL),

            loadJson(siteCitiesUrl).catch(() => []),

            loadJson(NEIGHBOR_COUNTRIES_URL).catch(() => null),
        ]);
    } catch (err) {
        return null;
    }


    const statesGeo = topojson.feature(topology, topology.objects.states);
    statesGeo.features = statesGeo.features.filter((f) => !EXCLUDED_STATE_NAMES.has(f.properties.st_nm));
    const districtsGeo = topojson.feature(topology, topology.objects.districts);
    districtsGeo.features = districtsGeo.features.filter((f) => !EXCLUDED_STATE_NAMES.has(f.properties.st_nm));

    const neighborCountriesGeo = neighborTopology
        ? topojson.feature(neighborTopology, neighborTopology.objects.countries)
        : { type: "FeatureCollection", features: [] };

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

    const coveredDistrictKeys = new Set();
    const districtToSiteCities = new Map();
    function addDistrictCity(key, cityName) {
        if (!districtToSiteCities.has(key)) districtToSiteCities.set(key, new Set());
        districtToSiteCities.get(key).add(cityName);
    }

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


    const coveredCities = cities.filter((c) => c.covered);

    return {
        statesGeo, districtsGeo, cities, coveredCities, coveredDistrictKeys, districtToSiteCities,
        neighborCountriesGeo, storeCountByState,
    };
}

function isDistrictCovered(coveredDistrictKeys, feature) {
    return coveredDistrictKeys.has(`${normalize(feature.properties.st_nm)}|${normalize(feature.properties.district)}`);
}


function isStateCovered(storeCountByState, stateName) {
    return (storeCountByState.get(normalize(stateName)) || 0) > 0;
}



function closeSitePopup(container) {
    const existing = container.querySelector(".geo-map-site-popup");
    if (existing) existing.remove();
}


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



function renderNeighborLayer(parentSelection, neighborCountriesGeo, path) {
    const layer = parentSelection.append("g").attr("class", "geo-map-neighbor-layer");
    layer.selectAll("path")
        .data(neighborCountriesGeo.features)
        .join("path")
        .attr("class", "geo-map-neighbor-fill")
        .attr("d", path);

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


    const stateIsClickable = onStateClick && statesToShow.length > 1;
    layer.append("g").attr("class", "geo-map-state-fill-layer")
        .selectAll("path")
        .data(statesToShow)
        .join("path")
        .attr("class", (d) => `geo-map-state-fill${isStateCovered(storeCountByState, d.properties.st_nm) ? " has-site" : ""}${stateIsClickable ? " clickable" : ""}`)
        .attr("d", path)
        .on("click", stateIsClickable ? (event, d) => onStateClick(d.properties.st_nm) : null);


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


    const labelLayer = layer.append("g").attr("class", "geo-map-label-layer");

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
