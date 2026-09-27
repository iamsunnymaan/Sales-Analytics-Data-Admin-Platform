// Site Status page — the Site Code picker card (GET /api/site-status/site-codes, SiteStatusService):
// every real distinct Site_Code from site_master, in a dropdown. Site_Master's PK is (Site_Code,
// Brand), so a Site_Code can carry more than one Brand row — GET /api/site-status/brands?siteCode=
// tells us whether to auto-pick the lone brand or ask via a second dropdown before loading the detail
// view below.
//
// The detail view itself (profile grid, KPI row, Sales Trend chart, Product Snapshot, Monthly History
// table, recent Primary/Secondary transactions) is merged in from the former standalone
// SiteDetailPage — GET /api/site-detail (SiteDetailService) plus its own trend-range/product-level
// endpoints, called directly here instead of loading a separate document in an iframe. loadSiteDetail()
// re-injects SITE_DETAIL_CONTENT_TEMPLATE into #siteDetailContent on every call so repeated site
// switches in one page session always start from fresh, listener-free DOM (see that constant's own
// comment) rather than accumulating duplicate handlers on persistent elements.
//
// Deep link: this page's own Geo Map popup's district click-through (GeoMap.js, wireGeoMapModal below)
// navigates here with ?siteCode=&brand= (same tab, full reload — see that popup's own header comment
// on why that's fine) — initSiteCodePicker() below picks up those params on load and drives the same
// picker + loadSiteDetail() flow a manual selection would.
//
// Every loadSiteDetail() call (manual picker, deep link, or a store-list-card row click) also drives
// updateGeoMapContext() with that site's own Site_Master State — the minimized state map + store-list
// row above the picker always reflects whichever site is currently loaded, not just deep-linked ones.
import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { buildCsvLine, downloadCsv, initDownloadPopup } from "/components/ExcelDownloadButton/ExcelDownloadButton.js";
import { initSearchBar } from "/components/SearchBar/SearchBar.js";
import { initStatusFilter } from "/components/StatusFilter/StatusFilter.js";
import { initSalesTypeFilter } from "/components/SalesTypeFilter/SalesTypeFilter.js";
import { initReCallableFyYearFilter } from "/components/FyYearFilter/FyYearFilter.js";
import { initSalesDateFilter } from "/components/SalesDateFilter/SalesDateFilter.js";
import { formatMoney, formatMoneyFull, formatDelta, formatDeltaSigned } from "/Shared/js/format.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating, reapplyFeatureGating } from "/Shared/js/feature-guard.js";

initSidebar();
initQuickAccessPanel();
// Reveals this page's static Section-gated elements (Site Picker, Geo Map & Compare — see this
// file's data-permission attributes in SiteStatusPage.html) once the session's real permission set
// resolves. Site Detail's own Section (page:site-insights.site-detail) lives in
// SITE_DETAIL_CONTENT_TEMPLATE's outer #siteDetailContent instead — freshly injected on every
// loadSiteDetail() call, long after this fetch already resolved — so loadSiteDetail awaits this
// same promise (never re-fetches) to decide whether to reveal it; see that function's own usage.
const pagePermissionsPromise = applyPagePermissions();
// Sequenced after pagePermissionsPromise resolves — see Dashboard.js's own comment on why
// (permission-gating's unconditional `hidden` assignment must never resolve after, and silently
// undo, a feature-based hide on an element carrying both attributes).
const pageFeaturesPromise = pagePermissionsPromise.then(() => applyFeatureGating());

// Cross-block-scope handoff for the Sales Trend/Product Snapshot sections below, same convention
// PrimarySalesPage.js uses (see its own header comment) — each of those sections keeps its own `{
// ... }` block scope so their internal helper names (e.g. formatFullAmount) can't collide with this
// file's other top-level functions, and exposes only its init function here instead of on `window`.
const Page = {};

// ==================== Status toggle pill (All/Active/Inactive/Upcoming) ====================
// Below the Site Code card, per explicit request — scopes the Site Code dropdown itself, the Geo Map
// popup (+ its mini-map/store-list context row), and the Compare modal, all off this one shared
// value (site_master.Operational_Status, keyword-matched server-side by OperationalStatusFilter —
// same convention this file's own resolveSalesTypeFlags uses for Sales_Type). "active" is the
// default per explicit request. See the initStatusFilter call (bottom of file) for the wiring that
// fans a change out to all three.
let siteStatusFilter = "active";

// Appends "status=<siteStatusFilter>" to `url` (via ? or &, whichever it doesn't already have) — every
// fetch this toggle scopes uses this instead of building its own query string by hand.
function withStatusParam(url) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}status=${encodeURIComponent(siteStatusFilter)}`;
}

// Status pill options — real options fetched from GET /api/site-status/statuses (site_master.
// Operational_Status, keyword-matched server-side by OperationalStatusFilter — see
// SiteStatusService.getAvailableStatuses's own header comment), same fetch-then-render-then-
// "Not Available" convention PrimarySalesPage.js's own loadStatusPillOptions/renderStatusPill already
// use, instead of the pill's All/Active/Inactive/Upcoming buttons being hardcoded straight into
// SiteStatusPage.html.
async function loadStatusPillOptions() {
    try {
        const res = await fetch("/api/site-status/statuses");
        if (!res.ok) {
            return [];
        }
        const statuses = await res.json();
        return Array.isArray(statuses) ? statuses : [];
    } catch {
        return [];
    }
}

// Renders into #siteStatusFilterToggle itself. An empty `statuses` (Site_Master has no usable data
// right now, or the DB isn't connected) shows "Not Available" instead of the pill, and leaves
// siteStatusFilter at its default ("active") since there's nothing to select. Otherwise "active"
// stays the default selection (per explicit request) whenever the real options include it.
function renderStatusPill(statuses) {
    const toggle = document.getElementById("siteStatusFilterToggle");
    if (!toggle) {
        return;
    }
    if (!statuses.length) {
        toggle.innerHTML = `<span class="site-status-filter-item brand-header-empty">Not Available</span>`;
        return;
    }
    const options = [{ value: "all", label: "All" }, ...statuses.map((s) => ({ value: s.toLowerCase(), label: s }))];
    const defaultValue = options.some((opt) => opt.value === siteStatusFilter) ? siteStatusFilter : "all";
    if (defaultValue !== siteStatusFilter) {
        siteStatusFilter = defaultValue;
    }
    toggle.innerHTML = options
        .map((opt) => `<button type="button" class="site-status-filter-item${opt.value === defaultValue ? " active" : ""}" data-status="${opt.value}">${opt.label}</button>`)
        .join("");
}

// Site Code card's own Sales Type toggle (All/Primary/Secondary, per explicit request) — scopes
// only the Site Code dropdown itself (site_master.Sales_Type, keyword-matched server-side by
// SiteSalesTypeFilter, same convention siteStatusFilter/OperationalStatusFilter above uses), not
// the Geo Map popup or Compare modal (those stay Status-only, unlike siteStatusFilter which scopes
// all three) — see initSiteCodePicker's own loadSiteCodes. "all" is the default per explicit
// request.
let siteSalesTypeFilter = "all";

// Maps a real site_master.Sales_Type value ("Primary Sales", "Secondary Sales") to the short code
// SiteSalesTypeFilter/loadSiteCodes already accept ("primary"/"secondary") — same fix Dashboard.js's
// own salesTypeToCode applies for its Sales Type pill.
function salesTypeToCode(label) {
    const normalized = label.trim().toLowerCase();
    if (normalized === "primary sales") {
        return "primary";
    }
    if (normalized === "secondary sales") {
        return "secondary";
    }
    return normalized;
}

// Sales Type pill options — real options fetched from GET /api/site-status/sales-types (site_master.
// Sales_Type), same fetch-then-render-then-"Not Available" convention loadStatusPillOptions/
// renderStatusPill above already use, instead of the pill's All/Primary/Secondary buttons being
// hardcoded straight into SiteStatusPage.html.
async function loadSalesTypePillOptions() {
    try {
        const res = await fetch("/api/site-status/sales-types");
        if (!res.ok) {
            return [];
        }
        const types = await res.json();
        return Array.isArray(types) ? types : [];
    } catch {
        return [];
    }
}

// Renders into #siteStatusSalesTypeToggle itself. An empty `types` (site_master has no usable
// Sales_Type data right now, or the DB isn't connected) shows "Not Available" instead of the pill,
// and leaves siteSalesTypeFilter at its default ("all") since there's nothing to select.
function renderSalesTypePill(types) {
    const toggle = document.getElementById("siteStatusSalesTypeToggle");
    if (!toggle) {
        return;
    }
    if (!types.length) {
        toggle.innerHTML = `<span class="site-status-filter-item brand-header-empty">Not Available</span>`;
        return;
    }
    const options = [{ value: "all", label: "All" }, ...types.map((t) => ({ value: salesTypeToCode(t), label: t.replace(/ Sales$/i, "") }))];
    toggle.innerHTML = options
        .map((opt, i) => `<button type="button" class="site-status-filter-item brand-header-item${i === 0 ? " active" : ""}" data-sales-type="${opt.value}">${opt.label}</button>`)
        .join("");
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Shared by every <th> on this page (Monthly History, Primary/Secondary Transactions, Product
// Ranking/Research, Compare modal's own tables) — top-level (not inside any section's own `{ ... }`
// block, see this file's own header comment on that convention) so every section can call it. Keyword
// match against the header's own label text rather than a per-table lookup table, since the same
// words (Sales/Target/Qty/...) repeat with different prefixes (Primary Sales/Secondary Sales/Total
// Sales/...) across every table on this page.
function thIconClass(label) {
    const l = String(label ?? "").toLowerCase();
    if (l === "#") return "bi-hash";
    if (l.includes("date") || l.includes("month")) return "bi-calendar3";
    if (l.includes("article") || l.includes("site code")) return "bi-upc-scan";
    if (l.includes("description") || l.includes("name") || l.includes("store")) return "bi-shop";
    if (l.includes("category")) return "bi-diagram-3";
    if (l.includes("product")) return "bi-box-seam";
    if (l.includes("qty")) return "bi-box-seam";
    if (l.includes("mrp")) return "bi-tag";
    if (l.includes("variance")) return "bi-arrow-left-right";
    if (l.includes("achievement")) return "bi-trophy";
    if (l.includes("target")) return "bi-bullseye";
    if (l.includes("contrib")) return "bi-pie-chart";
    if (l.includes("vs lm") || l.includes("vs ly")) return "bi-graph-up-arrow";
    if (l.includes("sales")) return "bi-cash-stack";
    if (l === "sites") return "bi-shop-window";
    if (l.includes("brand")) return "bi-bookmark-star";
    if (l.includes("city")) return "bi-building";
    if (l.includes("state")) return "bi-geo-alt";
    return "bi-columns-gap";
}

function thWithIcon(label) {
    return `<i class="bi ${thIconClass(label)} site-status-th-icon"></i><span class="site-status-th-label">${escapeHtml(label)}</span>`;
}

function money(value, opts) {
    return formatMoney(value, opts).replace("₹", "");
}

const PROFILE_FIELDS = [
    ["Site Code", "Site_Code"],
    ["Store Name", "Store_Name"],
    ["Brand", "Brand"],
    ["City", "City"],
    ["State", "State"],
    ["Region", "Region"],
    ["Channel", "Channel"],
    ["Sub Channel", "Sub_Channel"],
    ["Partner", "Partner"],
    ["RM", "RM"],
    ["AM", "AM"],
    ["CM", "CM"],
    ["SM", "SM"],
    ["Opening Date", "Opening_Date"],
    ["Operational Status", "Operational_Status"],
    ["Sales Type", "Sales_Type"],
];

function formatDate(isoDate) {
    if (!isoDate) return "—";
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return "—";
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return `${day}-${month}-${d.getUTCFullYear()}`;
}

// A site's real sale channel (site_master.Sales_Type, values "Primary Sales"/"Secondary Sales" — see
// database/migrations/2026-09-04_set_site_master_sales_type.sql) is one or the other, never both — per
// explicit request, every Primary-only section (Monthly History's Primary columns, the Primary
// Transactions table, the trend chart's Primary series) is hidden for a Secondary site and vice versa.
// An unset/unrecognized value (nullable column, or a future third type) falls back to showing both
// rather than hiding data outright.
function resolveSalesTypeFlags(profile) {
    const raw = String(profile.Sales_Type ?? "").toLowerCase();
    const isPrimary = raw.includes("primary");
    const isSecondary = raw.includes("secondary");
    if (!isPrimary && !isSecondary) {
        return { showPrimary: true, showSecondary: true };
    }
    return { showPrimary: isPrimary, showSecondary: isSecondary };
}

function renderProfileGrid(profile) {
    const wrap = document.getElementById("siteDetailProfileGrid");
    wrap.innerHTML = PROFILE_FIELDS.map(([label, key]) => {
        let value = profile[key];
        if (key === "Opening_Date") value = value ? formatDate(value) : "—";
        return `
            <div class="site-detail-profile-field">
                <span class="site-detail-profile-label">${escapeHtml(label)}</span>
                <span class="site-detail-profile-value">${escapeHtml(value ?? "—")}</span>
            </div>`;
    }).join("");
}


function formatQty(value) {
    return Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// ==================== Monthly History (FY table) ====================
// "Same as dashboard" per explicit request — full parity with Dashboard.js's own "1. Overview" table:
// same rolling FY-window/month-grid/Year Filter approach (buildDashboardFyMonths/
// getCurrentFyStartYear2Digit/initDashboardFyYearFilter), same two-tier header (group row + Target/
// Actual/Achi./Vs Last Year sub-header), same current-month highlight/"See Total" YTD row/projection-
// month Actual-mirrors-Target display, same complete-FY Total row — all copied here (renamed
// monthlyFy*/MONTHLY_FY_* to avoid colliding with this file's own other top-level names) per this
// codebase's own per-page-own-copy convention. UNLIKE that table, every month's real Sales/Target here
// already arrived in one shot with the rest of getSiteDetail's payload (SiteDetailService#
// loadMonthlyHistory returns every month this site has EVER had a real row for, not scoped to any one
// FY) — so switching the Year Filter just re-slices that same in-memory array (monthlyFyRawRows below)
// into a fresh Apr-Mar 12-month grid, no new fetch needed, and "Vs Last Year" is a lookup one calendar
// year back into that same array (monthlyFyLastYearKey) rather than a second API call.
const MONTHLY_FY_MONTH_NAMES = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

// Jan-Mar (month 0-2) still belongs to the FY that started the PREVIOUS April — computed from the
// real current date (not hardcoded) so a new FY appears automatically the moment the calendar rolls
// into it, same reasoning Dashboard.js's own getCurrentFyStartYear2Digit gives.
function monthlyFyCurrentStartYear2Digit() {
    const now = new Date();
    const calendarYear2Digit = now.getFullYear() % 100;
    return now.getMonth() < 3 ? calendarYear2Digit - 1 : calendarYear2Digit;
}

// Same rotation Dashboard.js's own getCurrentFyMonthIndex uses: Apr(3)->0 .. Mar(2)->11.
function monthlyFyCurrentMonthIndex() {
    const jsMonth = new Date().getMonth();
    return (jsMonth + 9) % 12;
}

function monthlyFyKeyFor(startYear2Digit) {
    const start = ((startYear2Digit % 100) + 100) % 100;
    return `20${String(start).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function monthlyFyLabelFor(startYear2Digit) {
    const start = ((startYear2Digit % 100) + 100) % 100;
    return `FY ${String(start).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// "Apr-26".."Mar-27" for fyStartYear2Digit=26, each paired with the "YYYY-MM" key
// loadMonthlyHistory's own rows are matched against (row.month, an ISO first-of-month date, sliced
// to its first 7 characters).
function buildMonthlyFyMonths(fyStartYear2Digit) {
    const fullStartYear = 2000 + fyStartYear2Digit;
    return MONTHLY_FY_MONTH_NAMES.map((name, i) => {
        const year = i < 9 ? fullStartYear : fullStartYear + 1; // Apr(0)..Dec(8) start year, Jan(9)..Mar(11) rolls to the next
        const monthNum = i < 9 ? i + 4 : i - 8;
        return { label: `${name}-${String(year % 100).padStart(2, "0")}`, key: `${year}-${String(monthNum).padStart(2, "0")}` };
    });
}

// Same calendar month, one year earlier — "2026-04" -> "2025-04" — Dashboard.js's own
// dashboardFyMonthKeyLastYear, renamed here to avoid colliding with that file (never loaded together,
// but keeps this file's own monthlyFy* naming convention).
function monthlyFyLastYearKey(key) {
    const [y, m] = key.split("-");
    return `${Number(y) - 1}-${m}`;
}

// Rolling window: current FY + the 2 before it, same as Dashboard.js's own DASHBOARD_FY_KEYS — as
// real time advances into a new FY, this window (and the dropdown built from it) shifts forward
// automatically on next page load.
const MONTHLY_FY_CURRENT_START_YEAR = monthlyFyCurrentStartYear2Digit();
const MONTHLY_FY_WINDOW_SIZE = 3;
const MONTHLY_FY_KEYS = Array.from({ length: MONTHLY_FY_WINDOW_SIZE }, (_, i) => monthlyFyKeyFor(MONTHLY_FY_CURRENT_START_YEAR - i));

// Group/sub-header cells — plain text (no icon), matching Dashboard.js's own dashboard-fy-overview-*
// thead styling exactly (that table's header is uppercase/plain, unlike this page's thWithIcon
// convention every other table here uses).
function monthlyFyGroupHeaderCell(label, groupClass) {
    return `<th colspan="4" class="dashboard-fy-overview-group-header ${groupClass}">${escapeHtml(label)}</th>`;
}

function monthlyFySubHeaderCell(label, groupClass) {
    return `<th class="${groupClass}">${escapeHtml(label)}</th>`;
}

// Same shape as Dashboard.js's own achiPct/renderAchiCell — bar + percentage + a variance-amount
// span (e.g. "/ +1.2 L"), full un-abbreviated tooltip on hover, per explicit request that this card
// be a faithful visual copy of Dashboard's own FY table (Vs Last Year still gets its own separate
// column here too, matching that table).
function monthlyFyAchiPct(sales, target) {
    const t = Number(target ?? 0);
    const s = Number(sales ?? 0);
    return t > 0 ? (s / t) * 100 : null;
}

function monthlyFyRenderAchiCell(sales, target) {
    const pct = monthlyFyAchiPct(sales, target);
    const barWidth = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
    const pctLabel = pct == null ? "—" : `${pct.toFixed(1)}%`;
    const variance = target ? Number(sales ?? 0) - Number(target ?? 0) : null;
    const varianceLabel = variance == null ? "—" : monthlyFySignedVariance(variance);
    const varianceCls = variance == null ? "" : ` ${monthlyFyTrendClass(variance)}`;
    return `
        <span class="dashboard-achi-cell">
            <span class="dashboard-achi-track">
                <span class="dashboard-achi-fill" style="width:${barWidth.toFixed(1)}%"></span>
            </span>
            <span class="dashboard-achi-pct">${pctLabel}</span>
            <span class="dashboard-achi-variance${varianceCls}" title="${escapeHtml(variance == null ? "" : formatMoneyFull(variance))}">/ ${varianceLabel}</span>
        </span>`;
}

function monthlyFyTrendClass(value) {
    return Number(value ?? 0) >= 0 ? "positive" : "negative";
}

function monthlyFyGrowthPct(current, previous) {
    if (!current || !previous) {
        return null;
    }
    return ((current - previous) / previous) * 100;
}

// Signed money string ("+₹1,234"/"-₹1,234"/"₹0") for monthlyFyRenderYoyVariance below — money() itself
// only signs negatives, same reasoning Dashboard.js's own formatVariance gives.
function monthlyFySignedVariance(value) {
    if (value === null || value === undefined) {
        return "—";
    }
    const num = Number(value);
    const sign = num > 0 ? "+" : (num < 0 ? "-" : "");
    return `${sign}${money(Math.abs(num), { round: false })}`;
}

// "Vs Last Year" cell — variance amount (Cr/L abbreviated) plus growth % AND the real Last Year
// figure itself, same shape/classes as Dashboard.js's own renderYoyVariance: "variance (growth%) /
// last year value" — the last-year figure sits in its own .dashboard-delta-lastyear span so it keeps
// a fixed muted color instead of inheriting the surrounding positive/negative trend color, same
// reasoning that function's own comment gives. "—" when either side has no real data, same reasoning
// that function's own comment gives (current=0 only means "no sale this month yet", not "sales
// really dropped to zero").
function monthlyFyRenderYoyVariance(current, previous) {
    if (!current || !previous) {
        return "—";
    }
    const diff = current - previous;
    return `<span class="dashboard-delta ${monthlyFyTrendClass(diff)}" title="Last Year: ${escapeHtml(formatMoneyFull(previous))}">${monthlyFySignedVariance(diff)} (${formatDelta(monthlyFyGrowthPct(current, previous))}) / <span class="dashboard-delta-lastyear">${money(previous, { round: false })}</span></span>`;
}

// Target/Actual cell — abbreviated Cr/L (money()), full un-abbreviated amount in the title attribute
// for a long hover, same convention Dashboard.js's own fyMoneyCell uses. allowDash draws "—" (not
// "0") when this site has no real row at all for this month, distinguishing "no data yet" from "the
// real figure is actually zero".
function monthlyFyMoneyCell(value, allowDash) {
    if (allowDash && !value) {
        return "<td>—</td>";
    }
    return `<td title="${escapeHtml(formatMoneyFull(value))}">${money(value, { round: false })}</td>`;
}

// The full flat monthlyHistory array from getSiteDetail (every month this site has ever had a real
// row for, most recent first) plus which Primary/Secondary columns to show — captured once per
// loadSiteDetail() call (see that function's own wiring) and re-sliced by renderMonthlyHistoryForFy
// on every Year Filter change, no re-fetch needed.
let monthlyFyRawRows = [];
let monthlyFySalesFlags = { showPrimary: true, showSecondary: true };

function renderMonthlyHistoryForFy(fyStartYear2Digit) {
    const thead = document.getElementById("siteDetailMonthlyTableHead");
    const body = document.getElementById("siteDetailMonthlyBody");
    if (!thead || !body) {
        return;
    }
    const { showPrimary, showSecondary } = monthlyFySalesFlags;

    const groupRow = [`<th rowspan="2" class="dashboard-fy-overview-month-col">Month</th>`];
    const subRow = [];
    if (showPrimary) {
        groupRow.push(monthlyFyGroupHeaderCell("Primary Sales", "dashboard-fy-overview-group-primary"));
        ["Target", "Sales", "Achi.", "Vs Last Year"].forEach((l) => subRow.push(monthlyFySubHeaderCell(l, "dashboard-fy-overview-group-primary")));
    }
    if (showSecondary) {
        groupRow.push(monthlyFyGroupHeaderCell("Secondary Sales", "dashboard-fy-overview-group-secondary"));
        ["Target", "Sales", "Achi.", "Vs Last Year"].forEach((l) => subRow.push(monthlyFySubHeaderCell(l, "dashboard-fy-overview-group-secondary")));
    }
    thead.innerHTML = `<tr>${groupRow.join("")}</tr><tr>${subRow.join("")}</tr>`;

    const byMonthKey = new Map(monthlyFyRawRows.map((row) => [String(row.month).slice(0, 7), row]));
    const isCurrentFy = fyStartYear2Digit === MONTHLY_FY_CURRENT_START_YEAR;
    const currentMonthIdx = isCurrentFy ? monthlyFyCurrentMonthIndex() : null;
    const months = buildMonthlyFyMonths(fyStartYear2Digit);

    let primaryTargetTotal = 0, secondaryTargetTotal = 0;
    let primaryActualTotal = 0, secondaryActualTotal = 0;
    let primaryActualTotalLY = 0, secondaryActualTotalLY = 0;
    let ytdPrimaryTarget = 0, ytdSecondaryTarget = 0;
    let ytdPrimaryActual = 0, ytdSecondaryActual = 0;
    let ytdPrimaryActualLY = 0, ytdSecondaryActualLY = 0;
    let ytdRowHtml = "";

    const bodyRows = months.map(({ label, key }, i) => {
        const type = currentMonthIdx == null ? "actual"
            : i === currentMonthIdx ? "current"
            : i < currentMonthIdx ? "actual"
            : "projection";
        const row = byMonthKey.get(key) ?? null;
        const lyRow = byMonthKey.get(monthlyFyLastYearKey(key)) ?? null;

        const realPrimaryTarget = row?.primaryTarget != null ? Number(row.primaryTarget) : 0;
        const realSecondaryTarget = row?.secondaryTarget != null ? Number(row.secondaryTarget) : 0;
        const realPrimaryActual = Number(row?.primarySales ?? 0);
        const realSecondaryActual = Number(row?.secondarySales ?? 0);
        const realPrimaryActualLY = Number(lyRow?.primarySales ?? 0);
        const realSecondaryActualLY = Number(lyRow?.secondarySales ?? 0);

        // Months after the current one show Actual = Target (an "on-plan" stand-in), same convention
        // Dashboard.js's own renderDashboardFyOverviewTable uses — see that function's own comment.
        const displayPrimaryActual = type === "projection" ? realPrimaryTarget : realPrimaryActual;
        const displaySecondaryActual = type === "projection" ? realSecondaryTarget : realSecondaryActual;

        if (showPrimary) {
            primaryTargetTotal += realPrimaryTarget;
            primaryActualTotal += displayPrimaryActual;
            primaryActualTotalLY += realPrimaryActualLY;
        }
        if (showSecondary) {
            secondaryTargetTotal += realSecondaryTarget;
            secondaryActualTotal += displaySecondaryActual;
            secondaryActualTotalLY += realSecondaryActualLY;
        }
        if (type !== "projection") {
            if (showPrimary) {
                ytdPrimaryTarget += realPrimaryTarget;
                ytdPrimaryActual += realPrimaryActual;
                ytdPrimaryActualLY += realPrimaryActualLY;
            }
            if (showSecondary) {
                ytdSecondaryTarget += realSecondaryTarget;
                ytdSecondaryActual += realSecondaryActual;
                ytdSecondaryActualLY += realSecondaryActualLY;
            }
        }

        const monthCell = type === "current"
            ? `<span class="dashboard-fy-overview-month-cell">
                   <span class="dashboard-fy-overview-month-text">${label}</span>
                   <button type="button" class="dashboard-fy-see-total-btn" aria-expanded="false">See Total</button>
               </span>`
            : label;

        if (type === "current") {
            const ytdCells = [];
            if (showPrimary) {
                ytdCells.push(
                    monthlyFyMoneyCell(ytdPrimaryTarget, false),
                    monthlyFyMoneyCell(ytdPrimaryActual, false),
                    `<td>${monthlyFyRenderAchiCell(ytdPrimaryActual, ytdPrimaryTarget)}</td>`,
                    `<td>${monthlyFyRenderYoyVariance(ytdPrimaryActual, ytdPrimaryActualLY)}</td>`,
                );
            }
            if (showSecondary) {
                ytdCells.push(
                    monthlyFyMoneyCell(ytdSecondaryTarget, false),
                    monthlyFyMoneyCell(ytdSecondaryActual, false),
                    `<td>${monthlyFyRenderAchiCell(ytdSecondaryActual, ytdSecondaryTarget)}</td>`,
                    `<td>${monthlyFyRenderYoyVariance(ytdSecondaryActual, ytdSecondaryActualLY)}</td>`,
                );
            }
            ytdRowHtml = `
                <tr class="dashboard-fy-row--ytd" id="siteDetailMonthlyYtdRow" hidden>
                    <td class="dashboard-fy-overview-month-col">${months[0].label} – ${label} (YTD)</td>
                    ${ytdCells.join("")}
                </tr>`;
        }

        const cells = [`<td class="dashboard-fy-overview-month-col">${monthCell}</td>`];
        if (showPrimary) {
            cells.push(
                monthlyFyMoneyCell(realPrimaryTarget, true),
                monthlyFyMoneyCell(displayPrimaryActual, true),
                `<td>${monthlyFyRenderAchiCell(displayPrimaryActual, realPrimaryTarget)}</td>`,
                `<td>${monthlyFyRenderYoyVariance(displayPrimaryActual, realPrimaryActualLY)}</td>`,
            );
        }
        if (showSecondary) {
            cells.push(
                monthlyFyMoneyCell(realSecondaryTarget, true),
                monthlyFyMoneyCell(displaySecondaryActual, true),
                `<td>${monthlyFyRenderAchiCell(displaySecondaryActual, realSecondaryTarget)}</td>`,
                `<td>${monthlyFyRenderYoyVariance(displaySecondaryActual, realSecondaryActualLY)}</td>`,
            );
        }
        return `<tr class="dashboard-fy-row--${type}">${cells.join("")}</tr>${type === "current" ? ytdRowHtml : ""}`;
    }).join("");

    const totalCells = [`<td class="dashboard-fy-overview-month-col">Total</td>`];
    if (showPrimary) {
        totalCells.push(
            monthlyFyMoneyCell(primaryTargetTotal, false),
            monthlyFyMoneyCell(primaryActualTotal, false),
            `<td>${monthlyFyRenderAchiCell(primaryActualTotal, primaryTargetTotal)}</td>`,
            `<td>${monthlyFyRenderYoyVariance(primaryActualTotal, primaryActualTotalLY)}</td>`,
        );
    }
    if (showSecondary) {
        totalCells.push(
            monthlyFyMoneyCell(secondaryTargetTotal, false),
            monthlyFyMoneyCell(secondaryActualTotal, false),
            `<td>${monthlyFyRenderAchiCell(secondaryActualTotal, secondaryTargetTotal)}</td>`,
            `<td>${monthlyFyRenderYoyVariance(secondaryActualTotal, secondaryActualTotalLY)}</td>`,
        );
    }
    body.innerHTML = `${bodyRows}<tr class="dashboard-fy-row--total">${totalCells.join("")}</tr>`;
}

// Wired fresh on every loadSiteDetail() call (this section's ids live inside the re-injected
// SITE_DETAIL_CONTENT_TEMPLATE, same as Page.initSalesTrend/initProductSnapshot elsewhere on this
// page) — but unlike those two, this section's own "click outside to close"/Escape handlers sit on
// `document`, which ISN'T re-created per call, so without cleanup they'd silently pile up one extra
// pair per site switch. components/FyYearFilter/FyYearFilter.js's initReCallableFyYearFilter
// handles that cleanup internally (keyed by idPrefix) — this function just keeps rebuilding the
// menu/label/title/table for the page-specific FY key format on every call, same as before.
// CSV-text counterparts of monthlyFyRenderAchiCell/monthlyFyRenderYoyVariance above — same "—" for
// no-target/no-previous-year convention, just plain text instead of the on-screen bar+span markup.
// Mirrors Dashboard.js's own fyAchiCsvText/fyVsLyCsvText.
function monthlyFyAchiCsvText(sales, target) {
    const pct = monthlyFyAchiPct(sales, target);
    return pct == null ? "—" : `${pct.toFixed(1)}%`;
}

function monthlyFyVsLyCsvText(current, previous) {
    if (!current || !previous) {
        return "—";
    }
    return formatDelta(monthlyFyGrowthPct(current, previous));
}

// Exports whichever FY the Year Filter currently has selected — every FY's data already sits in
// monthlyFyRawRows from the one getSiteDetail fetch (see this section's own header comment), so this
// just re-walks the exact same months/type/display-value logic renderMonthlyHistoryForFy above uses,
// producing CSV-safe plain-text cells instead of that function's HTML.
function buildMonthlyFyCsvLines(fyStartYear2Digit) {
    const { showPrimary, showSecondary } = monthlyFySalesFlags;
    const header = ["Month"];
    if (showPrimary) header.push("Primary Target", "Primary Sales", "Primary Achi %", "Primary Vs LY %");
    if (showSecondary) header.push("Secondary Target", "Secondary Sales", "Secondary Achi %", "Secondary Vs LY %");
    const lines = [buildCsvLine(header)];

    const byMonthKey = new Map(monthlyFyRawRows.map((row) => [String(row.month).slice(0, 7), row]));
    const isCurrentFy = fyStartYear2Digit === MONTHLY_FY_CURRENT_START_YEAR;
    const currentMonthIdx = isCurrentFy ? monthlyFyCurrentMonthIndex() : null;
    const months = buildMonthlyFyMonths(fyStartYear2Digit);

    let primaryTargetTotal = 0, secondaryTargetTotal = 0;
    let primaryActualTotal = 0, secondaryActualTotal = 0;
    let primaryActualTotalLY = 0, secondaryActualTotalLY = 0;

    months.forEach(({ label, key }, i) => {
        const type = currentMonthIdx == null ? "actual"
            : i === currentMonthIdx ? "current"
            : i < currentMonthIdx ? "actual"
            : "projection";
        const row = byMonthKey.get(key) ?? null;
        const lyRow = byMonthKey.get(monthlyFyLastYearKey(key)) ?? null;

        const realPrimaryTarget = row?.primaryTarget != null ? Number(row.primaryTarget) : 0;
        const realSecondaryTarget = row?.secondaryTarget != null ? Number(row.secondaryTarget) : 0;
        const realPrimaryActual = Number(row?.primarySales ?? 0);
        const realSecondaryActual = Number(row?.secondarySales ?? 0);
        const realPrimaryActualLY = Number(lyRow?.primarySales ?? 0);
        const realSecondaryActualLY = Number(lyRow?.secondarySales ?? 0);

        const displayPrimaryActual = type === "projection" ? realPrimaryTarget : realPrimaryActual;
        const displaySecondaryActual = type === "projection" ? realSecondaryTarget : realSecondaryActual;

        if (showPrimary) {
            primaryTargetTotal += realPrimaryTarget;
            primaryActualTotal += displayPrimaryActual;
            primaryActualTotalLY += realPrimaryActualLY;
        }
        if (showSecondary) {
            secondaryTargetTotal += realSecondaryTarget;
            secondaryActualTotal += displaySecondaryActual;
            secondaryActualTotalLY += realSecondaryActualLY;
        }

        const cells = [label];
        if (showPrimary) {
            cells.push(
                formatMoneyFull(realPrimaryTarget, { nullDash: true }),
                formatMoneyFull(displayPrimaryActual, { nullDash: true }),
                monthlyFyAchiCsvText(displayPrimaryActual, realPrimaryTarget),
                monthlyFyVsLyCsvText(displayPrimaryActual, realPrimaryActualLY),
            );
        }
        if (showSecondary) {
            cells.push(
                formatMoneyFull(realSecondaryTarget, { nullDash: true }),
                formatMoneyFull(displaySecondaryActual, { nullDash: true }),
                monthlyFyAchiCsvText(displaySecondaryActual, realSecondaryTarget),
                monthlyFyVsLyCsvText(displaySecondaryActual, realSecondaryActualLY),
            );
        }
        lines.push(buildCsvLine(cells));
    });

    const totalCells = ["Total"];
    if (showPrimary) {
        totalCells.push(
            formatMoneyFull(primaryTargetTotal, { nullDash: true }),
            formatMoneyFull(primaryActualTotal, { nullDash: true }),
            monthlyFyAchiCsvText(primaryActualTotal, primaryTargetTotal),
            monthlyFyVsLyCsvText(primaryActualTotal, primaryActualTotalLY),
        );
    }
    if (showSecondary) {
        totalCells.push(
            formatMoneyFull(secondaryTargetTotal, { nullDash: true }),
            formatMoneyFull(secondaryActualTotal, { nullDash: true }),
            monthlyFyAchiCsvText(secondaryActualTotal, secondaryTargetTotal),
            monthlyFyVsLyCsvText(secondaryActualTotal, secondaryActualTotalLY),
        );
    }
    lines.push(buildCsvLine(totalCells));
    return lines;
}

function wireMonthlyFyYearFilter(siteCode) {
    const menu = document.getElementById("siteDetailMonthlyFyYearFilterMenu");
    const label = document.getElementById("siteDetailMonthlyFyYearFilterLabel");
    const titleEl = document.getElementById("siteDetailMonthlyFyTitle");
    const downloadBtn = document.getElementById("siteDetailMonthlyFyDownloadBtn");
    if (!menu) {
        return;
    }

    let displayedFyKey = MONTHLY_FY_KEYS[0];

    function fyStartYearFromKey(fyKey) {
        return Number(fyKey.slice(2, 4));
    }

    // Renames the section title to "FY - Monthly History (FY 26-27)" — per explicit request, replacing
    // the old static "Monthly History — Sales vs Target" — so the title itself always names whichever
    // FY the table currently shows, instead of needing a separate "Financial Year" field the way
    // Dashboard's own version has room for. Also sets the Filter button's own label — redundant with
    // (but identical to) what initReCallableFyYearFilter's own click handler already sets from the
    // clicked item's textContent, but this is the only thing that sets it on the very first render,
    // before any click has happened.
    function selectFy(fyKey) {
        displayedFyKey = fyKey;
        const fyLabelText = monthlyFyLabelFor(fyStartYearFromKey(fyKey));
        if (label) {
            label.textContent = fyLabelText;
        }
        if (titleEl) {
            titleEl.textContent = `FY - Monthly History (${fyLabelText})`;
        }
        renderMonthlyHistoryForFy(fyStartYearFromKey(fyKey));
    }

    menu.innerHTML = MONTHLY_FY_KEYS
        .map((key, i) => `<button type="button" class="dashboard-fy-year-filter-item${i === 0 ? " active" : ""}" data-fy="${key}">${monthlyFyLabelFor(fyStartYearFromKey(key))}</button>`)
        .join("");
    selectFy(MONTHLY_FY_KEYS[0]);

    downloadBtn?.addEventListener("click", () => {
        const lines = buildMonthlyFyCsvLines(fyStartYearFromKey(displayedFyKey));
        downloadCsv(lines, `site-${siteCode}-fy-monthly-history-${displayedFyKey}-${new Date().toISOString().slice(0, 10)}.csv`);
    });

    // "See Total" toggle for the current month's own row — delegated on the tbody (not bound
    // per-button) since renderMonthlyHistoryForFy rebuilds every <tr>, button included, on every Year
    // Filter change. Safe to attach fresh on every wireMonthlyFyYearFilter() call — #siteDetailMonthlyBody
    // itself is destroyed along with its listeners when SITE_DETAIL_CONTENT_TEMPLATE gets re-injected
    // on the next site switch, no leak risk.
    const monthlyBody = document.getElementById("siteDetailMonthlyBody");
    monthlyBody?.addEventListener("click", (event) => {
        const seeTotalBtn = event.target.closest(".dashboard-fy-see-total-btn");
        if (!seeTotalBtn) {
            return;
        }
        const ytdRow = document.getElementById("siteDetailMonthlyYtdRow");
        if (!ytdRow) {
            return;
        }
        const opening = ytdRow.hidden;
        ytdRow.hidden = !opening;
        seeTotalBtn.textContent = opening ? "Hide Total" : "See Total";
        seeTotalBtn.setAttribute("aria-expanded", String(opening));
    });

    initReCallableFyYearFilter({ idPrefix: "siteDetailMonthlyFyYearFilter", onSelect: selectFy });
}

// The detail view's full markup — everything the old standalone SiteDetailPage.html had inside its own
// #siteDetailContent, minus that outer wrapper (which stays static in SiteStatusPage.html and is never
// itself replaced). Re-injected into #siteDetailContent on every loadSiteDetail() call rather than
// being static HTML, so the Sales Trend chart-type toggle/date filter and Product Snapshot filter/
// level controls always get brand-new elements to wire their event listeners onto — picking a second,
// third, etc. site in the same page load never re-wires (and so double-fires) a handler onto an
// element left over from a previous site's render.
const SITE_DETAIL_CONTENT_TEMPLATE = `
    <div class="site-detail-header">
        <div class="site-detail-header-text">
            <h1 class="site-detail-title" id="siteDetailStoreName">—</h1>
            <span class="site-detail-subtitle" id="siteDetailSiteCode">—</span>
        </div>
        <!-- Single shared Filter for both "2. Daily Sales Trends" and "3. Product Snapshot" below —
             per explicit request, replaces each section's own separate copy. Wired once in
             loadSiteDetail via Page.initSalesDateFilter, whose onFilterChange fans out to both
             initSalesTrend's and initProductSnapshot's own setDateRange handles. -->
        <div class="daily-trend-filter-cluster site-detail-header-filter">
            <!-- Same look/format as PrimarySalesPage.css's own .ta-overview-range-label ("01-Sep-2026
                 to 14-Sep-2026 (14 of 30 days)"), copied here per this codebase's per-page-own-copy
                 convention — sits right next to the shared Filter button, updated by
                 updateSiteDetailRangeLabel() on every onFilterChange (loadSiteDetail below). -->
            <span class="ta-overview-range-label" id="siteDetailRangeLabel"></span>
            <div class="sales-date-filter" id="siteDetailSharedDateFilter" data-feature="feature:date-filter">
                <div class="sales-date-filter-mode-toggle" id="siteDetailSharedDateFilterModeToggle">
                    <button type="button" class="sales-date-filter-mode-btn" data-mode="filter"><i class="bi bi-funnel"></i> Filter</button>
                </div>
            </div>
            <div class="sales-date-filter-body" id="siteDetailSharedDateFilterBody"></div>
            <button type="button" class="sales-date-filter-clear" id="siteDetailSharedDateFilterClearBtn" title="Clear date filter">
                <i class="bi bi-x-circle"></i>
            </button>
        </div>
    </div>

    <!-- Monthly History FY table + Profile card side by side, both left-hugging (not stretched to
         fill the row) — per explicit request, moved the FY table up from its own full-width section
         further down the page to sit right next to the profile card instead, and later swapped to
         come FIRST (left) with the profile card second (right). See .site-detail-top-row's own CSS
         comment in SiteStatusPage.css for the row layout itself. -->
    <div class="site-detail-top-row">
    <!-- "Same as dashboard" per explicit request — reuses Dashboard.css's own "1. Overview" (Financial
         Year table) class names verbatim (dashboard-fy-overview-*/dashboard-fy-year-filter-*/
         dashboard-achi-*/dashboard-delta), copied into SiteStatusPage.css per this codebase's own
         per-page-own-copy convention (Dashboard.css itself is never loaded on this page, so there's no
         collision). Unlike that table, every month's real Sales/Target already arrived in one shot with
         the rest of getSiteDetail's payload (SiteDetailService#loadMonthlyHistory returns every month
         this site has ever had a real row for) — so the Year Filter below just re-slices that same
         in-memory array into a fresh Apr-Mar 12-month grid (see wireMonthlyFyYearFilter/
         renderMonthlyHistoryForFy in SiteStatusPage.js), no new fetch needed. -->
    <div class="dashboard-fy-overview-card" id="siteDetailMonthlyFyCard">
        <div class="dashboard-fy-overview-header">
            <div class="dashboard-fy-overview-field">
                <span class="dashboard-fy-overview-value" id="siteDetailMonthlyFyTitle">FY - Monthly History</span>
            </div>
            <!-- Groups Year Filter + Download together so they hug the header's right edge as one
                 unit instead of .dashboard-fy-overview-header's own justify-content: space-between
                 spreading all three fields apart individually — same
                 .dashboard-fy-overview-header-actions wrapper/reasoning Dashboard.css's own "1.
                 Overview" header uses (copied into SiteStatusPage.css per this codebase's own
                 per-page-own-copy convention, Dashboard.css itself is never loaded on this page). -->
            <div class="dashboard-fy-overview-header-actions">
            <div class="dashboard-fy-overview-field dashboard-fy-overview-year-filter">
                <span class="dashboard-fy-overview-label">Year Filter</span>
                <div class="dashboard-fy-year-filter" id="siteDetailMonthlyFyYearFilter" data-feature="feature:fy-year-filter">
                    <button type="button" class="dashboard-fy-year-filter-btn" id="siteDetailMonthlyFyYearFilterBtn" aria-expanded="false">
                        <i class="bi bi-funnel"></i>
                        <span id="siteDetailMonthlyFyYearFilterLabel">—</span>
                        <i class="bi bi-chevron-down dashboard-fy-year-filter-caret"></i>
                    </button>
                    <div class="dashboard-fy-year-filter-menu" id="siteDetailMonthlyFyYearFilterMenu" hidden></div>
                </div>
            </div>
            <!-- Same plain click-to-download convention Dashboard.js's own "3. Partner Wise" table
                 uses (no range popup — see that button's own header comment in index.html) rather than
                 "1. Overview"'s own FY-picker popup: every FY's data is already sitting in
                 monthlyFyRawRows from the one getSiteDetail fetch, so there's no separate fetch a popup
                 would need to kick off — this just exports whichever FY the table's Year Filter
                 currently has selected. See downloadMonthlyFyCsv in SiteStatusPage.js. -->
            <button type="button" class="product-snapshot-download-btn" id="siteDetailMonthlyFyDownloadBtn" title="Download CSV" data-feature="feature:excel-download">
                <i class="bi bi-download"></i>
            </button>
            </div>
        </div>

        <div class="dashboard-fy-overview-table-wrap" id="siteDetailMonthlyTableWrap">
            <table class="dashboard-fy-overview-table">
                <thead id="siteDetailMonthlyTableHead"></thead>
                <tbody id="siteDetailMonthlyBody"></tbody>
            </table>
        </div>
    </div>

    <div class="site-detail-card">
        <div class="site-detail-profile-grid" id="siteDetailProfileGrid"></div>
    </div>
    </div>

    <div class="section-container">
    <div class="section-header">
    <div class="site-detail-section-title">2. Daily Sales Trends</div>
    </div>

    <div class="section-content">
    <div class="daily-trend-card" id="siteTrendCard">
        <div class="daily-trend-header">
            <div class="daily-trend-header-text">
                <span class="daily-trend-title">Sales Trend</span>
                <span class="daily-trend-mode-badge" id="siteTrendModeBadge">—</span>
            </div>
            <div class="daily-trend-header-actions">
                <!-- Same Target toggle Dashboard.js's own "2. Daily Sales Trends" section has
                     (#dailyTrendTargetToggle in index.html) — starts active/on since the Target line
                     used to always be drawn unconditionally here too; this only adds the ability to
                     hide it, not a new default-off behavior. See initSalesTrend's own state.showTarget
                     below. -->
                <button type="button" class="daily-trend-compare-toggle active" id="siteTrendTargetToggle" aria-pressed="true" title="Overlay Sales Target for the same period">
                    <i class="bi bi-bullseye"></i> Target
                </button>
                <button type="button" class="daily-trend-compare-toggle" id="siteTrendVsLastYearToggle" aria-pressed="false" title="Overlay last year's Total Sales for the same period">
                    <i class="bi bi-calendar2-week"></i> Vs Last Year
                </button>
                <div class="daily-trend-chart-type-toggle" id="siteTrendChartTypeToggle">
                    <button type="button" class="daily-trend-chart-type-btn active" data-chart-type="line">Graph</button>
                    <button type="button" class="daily-trend-chart-type-btn" data-chart-type="bar">Bar Graph</button>
                </div>
            </div>
        </div>

        <div class="daily-trend-selection-summary" id="siteTrendSelectionSummary">—</div>

        <div class="daily-trend-chart-scroll" id="siteTrendChartScroll">
            <div class="daily-trend-chart" id="siteTrendChart"></div>
        </div>
    </div>
    </div>
    </div>

    <div class="section-container">
    <div class="section-header">
    <div class="product-snapshot-section-title">
        <span>3. Product Snapshot</span>
    </div>
    </div>

    <div class="section-content">
    <div class="product-snapshot-card" id="siteProductSnapshotCard">
        <div class="product-snapshot-panel product-snapshot-panel-01">
            <div class="product-snapshot-panel-header">
                <span class="product-snapshot-panel-title-group">
                    <span class="product-snapshot-panel-title">Product Ranking</span>
                    <i class="bi bi-arrow-clockwise section-loading-spinner" id="siteProductSnapshotSpinner" aria-hidden="true"></i>
                </span>
                <div class="product-snapshot-panel-actions">
                    <button type="button" class="product-snapshot-filter-toggle" id="siteProductSnapshotFilterToggle" aria-expanded="false">
                        <i class="bi bi-funnel"></i>
                        <span>Filter</span>
                        <i class="bi bi-chevron-down product-snapshot-filter-toggle-caret"></i>
                    </button>
                    <button type="button" class="product-snapshot-research-btn" id="siteProductResearchBtn">
                        <i class="bi bi-search"></i>
                        <span>Product Research</span>
                    </button>
                    <div class="product-snapshot-download-wrap">
                        <button type="button" class="product-snapshot-download-btn" id="siteProductSnapshotRankingDownloadBtn" title="Download CSV" aria-expanded="false" data-feature="feature:excel-download">
                            <i class="bi bi-download"></i>
                        </button>
                        <div class="product-snapshot-download-popup" id="siteProductSnapshotDownloadPopupA" hidden>
                            <span class="product-snapshot-download-popup-title">Download Product Ranking</span>
                            <select class="product-snapshot-download-range" id="siteProductSnapshotDownloadRangeA" title="Rows to download">
                                <option value="current">Current Display (10)</option>
                                <option value="range">Custom Range</option>
                            </select>
                            <input type="number" class="product-snapshot-download-range-input" id="siteProductSnapshotDownloadRangeInputA" min="1" step="1" placeholder="e.g. 30" title="How many rows to download" hidden>
                            <button type="button" class="product-snapshot-download-confirm-btn" id="siteProductSnapshotDownloadConfirmA">
                                <i class="bi bi-download"></i>
                                <span>Download</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="product-snapshot-panel-controls" id="siteProductSnapshotFilterBody" hidden>
                <div class="product-snapshot-level-toggle" id="siteProductSnapshotLevelToggle">
                    <button type="button" class="product-snapshot-level-btn active" data-level="product">Products</button>
                    <button type="button" class="product-snapshot-level-btn" data-level="category">Category</button>
                    <button type="button" class="product-snapshot-level-btn" data-level="subcategory">Sub-category</button>
                </div>
                <select class="product-snapshot-panel-filter" id="siteProductSnapshotSortBy"></select>
            </div>
            <div class="product-snapshot-table-wrap scroll-hidden" id="siteProductSnapshotBody"></div>
        </div>
    </div>
    </div>
    </div>

    <!-- Product Research modal — opened by the button above. Same Category -> Sub-category ->
         Product tree Primary Sales' own Product Research popup shows, scoped to this one site
         (renderTable/flattenTree in SiteStatusPage.js, fed by GET /api/site-detail/product-level's
         own "tree" field, SiteDetailProductLevelService#buildResearchTree). Lives inside this
         re-injected template (not static in SiteStatusPage.html like the Geo Map modal) since its
         data is per-site — a fresh copy every loadSiteDetail() call, same reasoning the rest of this
         template already follows. -->
    <div class="site-status-product-research-modal-backdrop" id="siteProductResearchBackdrop">
        <div class="site-status-product-research-modal" role="dialog" aria-modal="true" aria-labelledby="siteProductResearchTitle">
            <div class="site-status-geo-map-modal-header">
                <span class="site-status-geo-map-modal-title" id="siteProductResearchTitle">Product Research</span>
                <div class="site-status-product-research-modal-header-actions">
                    <button type="button" class="product-snapshot-download-btn region-summary-download-btn" id="siteProductResearchDownloadBtn" title="Download CSV" data-feature="feature:excel-download">
                        <i class="bi bi-download"></i>
                    </button>
                    <button type="button" class="site-status-geo-map-modal-close" id="siteProductResearchClose" aria-label="Close">&times;</button>
                </div>
            </div>
            <div class="site-status-product-research-modal-body scroll-hidden">
                <div class="product-snapshot-table-wrap" id="siteProductResearchTableWrap"></div>
            </div>
        </div>
    </div>

`;

// ==================== Sales Date Filter ====================
// Now components/SalesDateFilter/SalesDateFilter.js's initSalesDateFilter, imported above.
Page.initSalesDateFilter = initSalesDateFilter;

// ==================== Shared Filter range label ====================
// #siteDetailRangeLabel (site-detail-header-filter, next to the shared Filter button) — same
// look/format as PrimarySalesPage.js's own formatRangeLabel ("01-Sep-2026 to 14-Sep-2026 (14 of 30
// days)"), copied here per this codebase's per-page-own-copy convention. Driven by the same
// from/to the shared Filter's onFilterChange already reports to Sales Trend/Product Snapshot (see
// loadSiteDetail's own Page.initSalesDateFilter call below) — a cleared filter falls back to the
// same current-FY range initSalesTrend's own setDateRange defaults to (see that section's own
// currentFinancialYearMonthRange — duplicated inline here, not called directly, since that helper
// lives inside the Sales Trend section's own `{ ... }` block scope), so the label never disagrees
// with what's actually driving those two sections. Kept top-level (outside every section's own
// block) so loadSiteDetail's onFilterChange callback can reach it.
const RANGE_LABEL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRangeDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    return `${day}-${RANGE_LABEL_MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function daysBetweenInclusive(from, to) {
    return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

function lastDayOfMonthDate(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// A range whose end month is the current calendar month shows days-elapsed-of-days-in-that-month
// (e.g. "14 of 30 days") instead of the plain day count — same MTD-pacing read PrimarySalesPage.js's
// own formatRangeLabel gives its Insights card; any other range just shows its real day count.
function formatRangeLabel(periodFrom, periodTo, today) {
    const fromStr = formatRangeDate(periodFrom);
    const includesCurrentMonth = periodTo.getFullYear() === today.getFullYear() && periodTo.getMonth() === today.getMonth();
    if (includesCurrentMonth) {
        const cutoff = periodTo > today ? today : periodTo;
        return `${fromStr} to ${formatRangeDate(cutoff)} (${cutoff.getDate()} of ${lastDayOfMonthDate(periodTo)} days)`;
    }
    return `${fromStr} to ${formatRangeDate(periodTo)} (${daysBetweenInclusive(periodFrom, periodTo)} days)`;
}

function updateSiteDetailRangeLabel(from, to) {
    const el = document.getElementById("siteDetailRangeLabel");
    if (!el) {
        return;
    }
    let range;
    if (from && to) {
        range = { from, to };
    } else {
        const now = new Date();
        const fyStartYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
        range = { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
    }
    const periodFrom = new Date(`${range.from}T00:00:00`);
    const periodTo = new Date(`${range.to}T00:00:00`);
    el.textContent = formatRangeLabel(periodFrom, periodTo, new Date());
}

// ==================== Sales Trend ====================
// Site Status's own version of Primary Sales' "Daily Sales Trends" section (initDailyTrendGraph in
// PrimarySalesPage.js) — same Filter/Graph-Bar-Graph/mode-badge/selection-summary UX, same
// day/month/year granularity 1:1 off the active SalesDateFilter rangeType, backed by GET
// /api/site-detail/trend-range (SiteDetailTrendService) for the one currently-picked site+brand. No
// brand pill / Compare toggle — this section is always locked to one fixed site+brand, so there's
// nothing to switch between (a "brand" dimension only makes sense across multiple site_master rows).
// Two real series (Primary Sales, Secondary Sales) instead of Primary Sales page's single "Sales"
// line, since this page already presents those two separately everywhere else (KPI row, Monthly
// History table); Target is their combined target, one dashed overlay line, same as the original.
{
// Same helper Secondary/Primary Sales pages' own Daily Sales Trends use for their area-fill
// gradients — own copy per this codebase's "each page owns its copy" convention.
function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
let TREND_THEME_STYLE = getComputedStyle(document.documentElement);
let TREND_AXIS_COLOR, TREND_GRID_COLOR, TREND_PRIMARY_COLOR, TREND_SECONDARY_COLOR, TREND_TARGET_COLOR, TREND_LAST_YEAR_COLOR;
function resolveTrendColors() {
    TREND_THEME_STYLE = getComputedStyle(document.documentElement);
    TREND_AXIS_COLOR = TREND_THEME_STYLE.getPropertyValue("--color-text-secondary").trim() || "#66756F";
    TREND_GRID_COLOR = TREND_THEME_STYLE.getPropertyValue("--color-border").trim() || "#DCE7E2";
    TREND_PRIMARY_COLOR = TREND_THEME_STYLE.getPropertyValue("--color-success").trim() || "#16803C";
    TREND_SECONDARY_COLOR = TREND_THEME_STYLE.getPropertyValue("--color-primary").trim() || "#7C3AED";
    TREND_TARGET_COLOR = TREND_THEME_STYLE.getPropertyValue("--color-text-secondary").trim() || "#595f5c";
    // "Last Year" overlay line — a distinct warm accent so it doesn't get confused with the green
    // Primary line, purple Secondary line, or the neutral dashed Target line.
    TREND_LAST_YEAR_COLOR = TREND_THEME_STYLE.getPropertyValue("--color-warning").trim() || "#D97706";
}
resolveTrendColors();

const TREND_GRANULARITY_LABEL = { day: "Daily", month: "Monthly", year: "Yearly" };
const TREND_PERIOD_LABEL = { day: "Date", month: "Month", year: "Year" };

// The chart attaches "resize"/"theme-changed" listeners on `window` (not on any element inside
// #siteDetailContent), so replacing that container's innerHTML on the next loadSiteDetail() call
// does NOT clean those up by itself — activeTrendCleanup tracks the previous call's teardown so
// initSalesTrend can run it before wiring up the new site's chart, instead of leaking a listener
// (each capturing an increasingly stale/disposed chart instance) on every site switch.
let activeTrendCleanup = null;

// Financial year runs Apr-Mar; recomputed off today's date every call so the default range rolls
// forward on its own once the next FY starts, instead of staying pinned to a hardcoded year.
function currentFinancialYearMonthRange() {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-12
    const fyStartYear = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
}

function initSalesTrend(siteCode, brand, salesTypeFlags) {
    if (activeTrendCleanup) {
        activeTrendCleanup();
        activeTrendCleanup = null;
    }

    const { showPrimary, showSecondary } = salesTypeFlags;
    const card = document.getElementById("siteTrendCard");
    const chartTypeToggle = document.getElementById("siteTrendChartTypeToggle");
    const targetToggle = document.getElementById("siteTrendTargetToggle");
    const vsLastYearToggle = document.getElementById("siteTrendVsLastYearToggle");
    const chartDom = document.getElementById("siteTrendChart");
    const modeBadge = document.getElementById("siteTrendModeBadge");
    const selectionSummary = document.getElementById("siteTrendSelectionSummary");

    if (!card) {
        return { setDateRange() {} };
    }

    const chart = (chartDom && typeof window.echarts !== "undefined") ? window.echarts.init(chartDom) : null;
    // showTarget starts true (unlike showLastYear) — the Target line used to always be drawn
    // unconditionally here, same reasoning Dashboard.js's own state.showTarget default gives.
    const state = { chartType: "line", from: null, to: null, granularity: "day", showLastYear: false, showTarget: true };
    let currentData = null;
    let requestSeq = 0;

    function formatFullAmount(value) {
        return Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // null when comparison is 0 and current isn't — growth is undefined/infinite, not 0.
    function growthPct(current, comparison) {
        const cur = Number(current ?? 0);
        const cmp = Number(comparison ?? 0);
        if (cmp === 0) {
            return cur === 0 ? 0 : null;
        }
        return ((cur - cmp) / cmp) * 100;
    }

    // Same up/down color convention as the Secondary/Primary Sales pages' own Daily Sales Trends
    // tooltip, for a raw Sales - Target amount plus its own % of Target together — UI/UX parity's
    // own "Sales Variance" row. Per explicit request: the ▲/▼ arrow glyph is removed — just the
    // explicit +/− sign in front of the number now.
    function formatVariance(value, pct) {
        if (value === null || value === undefined) {
            return '<span style="color:#9CA3AF;">— N/A</span>';
        }
        const isUp = value >= 0;
        const color = isUp ? "#4ADE80" : "#F87171";
        const sign = isUp ? "+" : "−";
        const pctLabel = pct === null || pct === undefined ? "N/A" : `${sign}${Math.abs(pct).toFixed(1)}%`;
        return `<span style="color:${color};font-weight:600;">${formatFullAmount(Math.abs(value))} (${pctLabel})</span>`;
    }

    function formatPeriod(dateStr, granularity) {
        if (!dateStr) {
            return "";
        }
        if (granularity === "year") {
            return dateStr;
        }
        if (granularity === "month") {
            const [y, m] = dateStr.split("-").map(Number);
            return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
        }
        const [y, m, d] = dateStr.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    }

    function formatFullDate(dateStr) {
        const [y, m, d] = dateStr.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    }

    function formatSelectedPeriod(period, granularity) {
        if (!period || !period.from || !period.to) {
            return "—";
        }
        if (granularity === "month" && period.from.slice(0, 7) === period.to.slice(0, 7)) {
            const [y, m] = period.from.split("-").map(Number);
            return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
        }
        if (period.from === period.to) {
            return formatFullDate(period.from);
        }
        return `${formatFullDate(period.from)} – ${formatFullDate(period.to)}`;
    }

    function updateSelectionSummary() {
        if (!selectionSummary) {
            return;
        }
        if (!currentData) {
            selectionSummary.textContent = "—";
            return;
        }
        const unitLabel = { day: "day", month: "month", year: "year" }[state.granularity] || "period";
        const count = (currentData.labels || []).length;
        const countLabel = `${count} ${unitLabel}${count === 1 ? "" : "s"}`;
        const periodLabel = formatSelectedPeriod(currentData.period, state.granularity);
        const parts = [
            `Selected: <strong>${periodLabel}</strong>`,
            `<strong>${countLabel}</strong>`,
        ];
        selectionSummary.innerHTML = parts.map((p) => `<span class="daily-trend-selection-summary-part">${p}</span>`).join("");
    }

    function tooltipFormatter(params) {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0];
        if (!first || !currentData) {
            return "";
        }
        const idx = first.dataIndex;
        const periodField = TREND_PERIOD_LABEL[state.granularity] || "Period";
        const periodValue = formatPeriod((currentData.dates || [])[idx], state.granularity) || first.name;
        const primaryVal = (currentData.primaryData || [])[idx];
        const secondaryVal = (currentData.secondaryData || [])[idx];
        const totalVal = Number((currentData.totalData || [])[idx] ?? 0);
        const targetVal = Number((currentData.target || [])[idx] ?? 0);
        const variance = totalVal - targetVal;
        const variancePct = growthPct(totalVal, targetVal);
        const lines = [`<div>${periodField}: <strong>${periodValue}</strong></div>`];
        if (showPrimary) lines.push(`<div>Primary Sales: <strong>${formatFullAmount(primaryVal)}</strong></div>`);
        if (showSecondary) lines.push(`<div>Secondary Sales: <strong>${formatFullAmount(secondaryVal)}</strong></div>`);
        lines.push(`<div>Total Sales: <strong>${formatFullAmount(totalVal)}</strong></div>`);
        lines.push(`<div>Target: <strong>${formatFullAmount(targetVal)}</strong></div>`);
        lines.push(`<div>Sales Variance: ${formatVariance(variance, variancePct)}</div>`);
        // Last Year row — only when the Vs Last Year toggle is on, matching whatever
        // currentData.lastYear (combined Total Sales one year earlier, see SiteDetailTrendService)
        // is drawing as its own dotted overlay line below.
        if (state.showLastYear) {
            const lastYearVal = Number((currentData.lastYear || [])[idx] ?? 0);
            const vsLastYearVariance = totalVal - lastYearVal;
            const vsLastYearPct = growthPct(totalVal, lastYearVal);
            lines.push(`<div>Last Year Total: <strong>${formatFullAmount(lastYearVal)}</strong></div>`);
            lines.push(`<div>vs Last Year: ${formatVariance(vsLastYearVariance, vsLastYearPct)}</div>`);
        }
        return `<div style="font-size:8px;line-height:1.2;min-width:125px;">${lines.join("")}</div>`;
    }

    function renderChart() {
        if (!chart) {
            return;
        }
        const labels = currentData ? currentData.labels : [];
        const primaryData = currentData ? currentData.primaryData : [];
        const secondaryData = currentData ? currentData.secondaryData : [];
        const target = currentData ? (currentData.target || []) : [];
        const isBar = state.chartType === "bar";
        chart.resize();

        const series = [];
        if (showPrimary) {
            series.push({
                name: "Primary Sales",
                type: state.chartType,
                data: primaryData,
                smooth: !isBar,
                showSymbol: !isBar,
                symbol: "circle",
                symbolSize: 6,
                connectNulls: false,
                itemStyle: { color: TREND_PRIMARY_COLOR },
                // Colored area fill down to the chart's bottom axis, same translucent-gradient
                // treatment Secondary/Primary Sales pages' own Daily Sales Trends series use, for
                // UI/UX parity — low opacity keeps both series' fills visible where they overlap.
                areaStyle: isBar ? undefined : {
                    color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: hexToRgba(TREND_PRIMARY_COLOR, 0.32) },
                        { offset: 1, color: hexToRgba(TREND_PRIMARY_COLOR, 0.02) },
                    ]),
                },
                lineStyle: isBar ? undefined : { width: 2, color: TREND_PRIMARY_COLOR },
                barWidth: isBar ? "35%" : undefined,
                z: 2,
            });
        }
        if (showSecondary) {
            series.push({
                name: "Secondary Sales",
                type: state.chartType,
                data: secondaryData,
                smooth: !isBar,
                showSymbol: !isBar,
                symbol: "circle",
                symbolSize: 6,
                connectNulls: false,
                itemStyle: { color: TREND_SECONDARY_COLOR },
                areaStyle: isBar ? undefined : {
                    color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: hexToRgba(TREND_SECONDARY_COLOR, 0.32) },
                        { offset: 1, color: hexToRgba(TREND_SECONDARY_COLOR, 0.02) },
                    ]),
                },
                lineStyle: isBar ? undefined : { width: 2, color: TREND_SECONDARY_COLOR },
                barWidth: isBar ? "35%" : undefined,
                z: 2,
            });
        }
        if (!isBar && state.showTarget) {
            series.push({
                name: "Target",
                type: "line",
                data: target,
                smooth: false,
                showSymbol: false,
                symbol: "none",
                connectNulls: true,
                itemStyle: { color: TREND_TARGET_COLOR },
                lineStyle: { width: 2, color: TREND_TARGET_COLOR, type: "dashed" },
                z: 3,
            });
        }
        // "Vs Last Year" overlay — combined Total Sales (Primary+Secondary) from a year ago
        // (currentData.lastYear, see SiteDetailTrendService); only drawn once the user opts in via
        // #siteTrendVsLastYearToggle (state.showLastYear). Drawn as a thin dotted "line" even in Bar
        // Graph mode — echarts happily mixes a line series onto a bar chart's category axis.
        if (state.showLastYear) {
            series.push({
                name: "Last Year",
                type: "line",
                data: currentData ? (currentData.lastYear || []) : [],
                smooth: false,
                showSymbol: isBar,
                symbol: "circle",
                symbolSize: 5,
                connectNulls: true,
                itemStyle: { color: TREND_LAST_YEAR_COLOR },
                lineStyle: { width: 2, color: TREND_LAST_YEAR_COLOR, type: "dotted" },
                z: 4,
            });
        }
        const legendData = [];
        if (showPrimary) legendData.push("Primary Sales");
        if (showSecondary) legendData.push("Secondary Sales");
        if (!isBar && state.showTarget) legendData.push("Target");
        if (state.showLastYear) legendData.push("Last Year");

        chart.setOption({
            animationDuration: 400,
            animationEasing: "cubicOut",
            tooltip: {
                trigger: "axis",
                formatter: tooltipFormatter,
                backgroundColor: "rgba(20, 20, 20, 0.82)",
                borderWidth: 0,
                padding: 5,
                textStyle: { color: "#fff", fontSize: 8 },
                extraCssText: "box-shadow: 0 4px 14px rgba(0,0,0,0.25); border-radius: 6px;",
                confine: true,
            },
            legend: {
                bottom: 0,
                data: legendData,
                textStyle: { color: TREND_AXIS_COLOR, fontSize: 9 },
                itemWidth: 12,
                itemHeight: 7,
            },
            grid: { left: 8, right: 20, top: 18, bottom: 38, containLabel: true },
            xAxis: {
                type: "category",
                data: labels,
                boundaryGap: isBar,
                axisLine: { lineStyle: { color: TREND_GRID_COLOR } },
                axisLabel: {
                    color: TREND_AXIS_COLOR,
                    fontSize: 9,
                    rotate: state.granularity === "day" && labels.length > 10 ? 45 : 0,
                    interval: "auto",
                },
            },
            yAxis: {
                type: "value",
                boundaryGap: [0, 0],
                axisLine: { lineStyle: { color: TREND_GRID_COLOR } },
                splitLine: { lineStyle: { color: TREND_GRID_COLOR } },
                axisLabel: { color: TREND_AXIS_COLOR, fontSize: 9 },
            },
            series,
        }, { notMerge: true });
    }

    async function load() {
        if (!chart) {
            return;
        }
        const requestId = ++requestSeq;
        try {
            const params = new URLSearchParams({ siteCode, brand, granularity: state.granularity });
            if (state.from) {
                params.set("from", state.from);
            }
            if (state.to) {
                params.set("to", state.to);
            }
            const response = await fetch(`/api/site-detail/trend-range?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }
            const data = await response.json();
            if (requestId !== requestSeq) {
                return;
            }
            currentData = data;

            if (modeBadge) {
                modeBadge.textContent = TREND_GRANULARITY_LABEL[state.granularity] || "—";
            }
            updateSelectionSummary();
            renderChart();
        } catch (error) {
            // Leave the chart as-is on a transient failure rather than blanking the section.
        }
    }

    if (chartTypeToggle) {
        chartTypeToggle.querySelectorAll(".daily-trend-chart-type-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (btn.dataset.chartType === state.chartType) {
                    return;
                }
                chartTypeToggle.querySelectorAll(".daily-trend-chart-type-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                state.chartType = btn.dataset.chartType;
                renderChart();
            });
        });
    }

    if (targetToggle) {
        targetToggle.addEventListener("click", () => {
            state.showTarget = !state.showTarget;
            targetToggle.classList.toggle("active", state.showTarget);
            targetToggle.setAttribute("aria-pressed", String(state.showTarget));
            // currentData already carries `target` from every load() — toggling this just changes
            // what renderChart() draws, no re-fetch needed.
            renderChart();
        });
    }

    if (vsLastYearToggle) {
        vsLastYearToggle.addEventListener("click", () => {
            state.showLastYear = !state.showLastYear;
            vsLastYearToggle.classList.toggle("active", state.showLastYear);
            vsLastYearToggle.setAttribute("aria-pressed", String(state.showLastYear));
            // currentData already carries `lastYear` from every load() — toggling this just changes
            // what renderChart() draws, no re-fetch needed.
            renderChart();
        });
    }

    if (chart) {
        const resizeHandler = () => chart.resize();
        const themeHandler = () => {
            resolveTrendColors();
            renderChart();
        };
        window.addEventListener("resize", resizeHandler);
        window.addEventListener("theme-changed", themeHandler);
        activeTrendCleanup = () => {
            window.removeEventListener("resize", resizeHandler);
            window.removeEventListener("theme-changed", themeHandler);
            chart.dispose();
        };
    }

    // Driven by the shared Filter in .site-detail-header (see SITE_DETAIL_CONTENT_TEMPLATE's own
    // #siteDetailSharedDateFilter and its Page.initSalesDateFilter wiring in loadSiteDetail) —
    // fanned out to this section's own setDateRange alongside Product Snapshot's.
    function setDateRange(from, to, meta) {
        if (from && to) {
            state.from = from;
            state.to = to;
            const rangeType = meta && meta.rangeType;
            state.granularity = rangeType === "year" ? "year" : rangeType === "month" ? "month" : "day";
        } else {
            // Filter closed/cleared — default to the current financial year (Apr-Mar) by month,
            // instead of an unbounded day-level view. Auto-rolls to the next FY once it starts.
            const fy = currentFinancialYearMonthRange();
            state.from = fy.from;
            state.to = fy.to;
            state.granularity = "month";
        }
        load();
    }

    return { setDateRange };
}
Page.initSalesTrend = initSalesTrend;
}

// ==================== 3. Product Snapshot ====================
// Site Status's own version of Primary Sales' "3. Product Snapshot" section — same Product Ranking
// panel (Top 10/Below 10 by Value/Qty at Product/Category/Sub-category level, with real vs-Last-Year/
// vs-Last-Month growth and a Contrib Δ LY column) and Product Research popup, backed by
// GET /api/site-detail/product-level (SiteDetailProductLevelService) for just this one currently-
// picked site — real Primary_Sales/Secondary_Sales data, whichever table this site's own
// Site_Code actually has rows in (see that service's own header comment; a site is never both). No
// brand-quantity badge (Primary's own compares ABH vs Kylie — a single site only ever has one
// brand, so there'd be nothing to compare).
{
// ==================== Product Research tree ====================
// "Product Research" button opens a popup with the real Category -> Sub-category -> Product tree for
// this one site (GET /api/site-detail/product-level's own "tree" field,
// SiteDetailProductLevelService#buildResearchTree) — same expand/collapse tree UI, delta/tooltip
// helpers, and CSV export as Primary Sales' own Product Research popup (PrimarySalesPage.js), copied
// here per this codebase's per-page-own-copy convention rather than shared.
function trendClass(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return value >= 0 ? "positive" : "negative";
}

function renderDelta(value) {
    if (value === null || value === undefined) {
        return "—";
    }
    return `<span class="product-snapshot-delta ${trendClass(value)}">${formatDelta(value, { nullDash: true })}</span>`;
}

// EAN/HSN/Tax (dbo.Product_Master) shown as a hover tooltip on the product name cell rather than
// dedicated table columns — the same tree table is shared across Category/Sub-category/Product
// levels, and only Product-level rows have these fields.
function productTooltip(row) {
    const parts = [];
    if (row.ean) parts.push(`EAN: ${row.ean}`);
    if (row.hsn) parts.push(`HSN: ${row.hsn}`);
    if (row.tax != null) parts.push(`Tax: ${Number(row.tax).toFixed(1)}%`);
    return parts.join(" | ");
}

// Turns the backend's nested Category -> Sub-category -> Product "tree" into the flat id/parent/level
// row list the expand/collapse table below operates on.
function flattenResearchTree(tree) {
    const rows = [];
    (tree ?? []).forEach((category, ci) => {
        const categoryId = `c${ci}`;
        rows.push({
            id: categoryId, level: 0, index: category.index, name: category.name,
            salesValue: category.salesValue, salesQty: category.salesQty, contribPct: category.contribPct,
            contribDeltaLYPct: category.contribDeltaLYPct, vsLastYearPct: category.vsLastYearPct,
            vsLastMonthPct: category.vsLastMonthPct,
        });
        (category.subCategories ?? []).forEach((sub, si) => {
            const subId = `${categoryId}-s${si}`;
            rows.push({
                id: subId, level: 1, parent: categoryId, index: sub.index, name: sub.name,
                salesValue: sub.salesValue, salesQty: sub.salesQty, contribPct: sub.contribPct,
                contribDeltaLYPct: sub.contribDeltaLYPct, vsLastYearPct: sub.vsLastYearPct,
                vsLastMonthPct: sub.vsLastMonthPct,
            });
            (sub.products ?? []).forEach((product, pi) => {
                rows.push({
                    id: `${subId}-p${pi}`, level: 2, parent: subId, index: product.index,
                    name: product.description ?? product.articleCode ?? "—",
                    salesValue: product.salesValue, salesQty: product.salesQty, contribPct: product.contribPct,
                    contribDeltaLYPct: product.contribDeltaLYPct, vsLastYearPct: product.vsLastYearPct,
                    vsLastMonthPct: product.vsLastMonthPct,
                    ean: product.ean, hsn: product.hsn, tax: product.tax,
                });
            });
        });
    });
    return rows;
}

function researchRowHasChildren(rowId, rows) {
    return rows.some((row) => row.parent === rowId);
}

function renderResearchTable(wrap, rows) {
    if (!rows.length) {
        wrap.innerHTML = `<div class="product-snapshot-empty">No data available.</div>`;
        return;
    }

    // Tree starts fully collapsed — only top-level Category rows are visible until the user clicks a
    // row's chevron to reveal its children.
    const collapsed = new Set(rows.filter((row) => researchRowHasChildren(row.id, rows)).map((row) => row.id));

    function isVisible(row) {
        let current = row;
        while (current.parent) {
            if (collapsed.has(current.parent)) {
                return false;
            }
            current = rows.find((r) => r.id === current.parent);
        }
        return true;
    }

    function updateVisibility() {
        rows.forEach((row) => {
            const tr = wrap.querySelector(`tr[data-row-id="${row.id}"]`);
            if (tr) {
                tr.hidden = !isVisible(row);
            }
        });
    }

    const bodyRows = rows.map((row) => {
        const expandable = researchRowHasChildren(row.id, rows);
        const toggle = expandable
            ? `<i class="bi bi-chevron-right product-snapshot-toggle collapsed" data-toggle-id="${row.id}"></i>`
            : `<span class="product-snapshot-toggle-spacer"></span>`;
        const tooltip = row.level === 2 ? productTooltip(row) : "";
        return `
            <tr data-row-id="${row.id}" data-level="${row.level}">
                <td class="product-snapshot-col-name">
                    <span class="product-snapshot-name-cell" style="padding-left:${row.level * 1.1}rem" ${tooltip ? `title="${escapeHtml(tooltip)}"` : ""}>
                        ${toggle}
                        <span class="product-snapshot-name-text">${escapeHtml(row.name)}</span>
                    </span>
                </td>
                <td>${escapeHtml(formatMoney(row.salesValue, { nullDash: true, round: false }))}</td>
                <td>${row.contribPct == null ? "—" : `${Number(row.contribPct).toFixed(1)}%`}</td>
                <td>${row.contribDeltaLYPct == null ? "—" : renderDelta(row.contribDeltaLYPct)}</td>
                <td>${renderDelta(row.vsLastMonthPct)}</td>
                <td>${renderDelta(row.vsLastYearPct)}</td>
            </tr>`;
    }).join("");

    wrap.innerHTML = `
        <table class="product-snapshot-table">
            <thead>
                <tr>
                    <th>${thWithIcon("Name")}</th>
                    <th>${thWithIcon("Sales")}</th>
                    <th>${thWithIcon("Contrib %")}</th>
                    <th>${thWithIcon("Contrib Δ LY")}</th>
                    <th>${thWithIcon("vs LM")}</th>
                    <th>${thWithIcon("vs LY")}</th>
                </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>`;

    wrap.querySelectorAll(".product-snapshot-toggle").forEach((toggle) => {
        toggle.addEventListener("click", () => {
            const id = toggle.dataset.toggleId;
            const row = rows.find((r) => r.id === id);
            const opening = collapsed.has(id);

            // Accordion at the top level: expanding one category auto-closes any other currently
            // open category, so only one category's sub-category/product detail is visible at a time.
            if (opening && row?.level === 0) {
                rows
                    .filter((r) => r.level === 0 && r.id !== id && !collapsed.has(r.id))
                    .forEach((r) => {
                        collapsed.add(r.id);
                        wrap.querySelector(`.product-snapshot-toggle[data-toggle-id="${r.id}"]`)?.classList.add("collapsed");
                    });
            }

            if (opening) {
                collapsed.delete(id);
                toggle.classList.remove("collapsed");
            } else {
                collapsed.add(id);
                toggle.classList.add("collapsed");
            }
            updateVisibility();
        });
    });

    updateVisibility();
}

// Client-side CSV export of the Product Research popup's whole Category -> Sub-category -> Product
// tree (whatever's currently loaded, expanded/collapsed state doesn't matter — every row exports
// regardless). Per explicit request, each hierarchy level gets its own column (Category/
// Sub-Category/Product) instead of one combined "Category > Sub-category > Product" text column —
// a row's own ancestor path (row.level tells us how deep it is) fills the columns up to and
// including its own level, the rest stay blank.
function downloadResearchCsv(rows) {
    if (!rows.length) {
        return;
    }
    const header = ["Category", "Sub-Category", "Product", "Sales", "Contrib %", "Contrib Δ LY %", "vs LM %", "vs LY %"];
    const lines = [header.join(",")];
    rows.forEach((row) => {
        const path = [row.name];
        let current = row;
        while (current.parent) {
            current = rows.find((r) => r.id === current.parent);
            if (!current) {
                break;
            }
            path.unshift(current.name);
        }
        const levelCells = [path[0] ?? "", path[1] ?? "", path[2] ?? ""];
        const cells = [
            ...levelCells,
            formatMoneyFull(row.salesValue, { nullDash: true }),
            row.contribPct == null ? "—" : `${Number(row.contribPct).toFixed(1)}%`,
            formatDeltaSigned(row.contribDeltaLYPct, { nullDash: true }),
            formatDeltaSigned(row.vsLastMonthPct, { nullDash: true }),
            formatDeltaSigned(row.vsLastYearPct, { nullDash: true }),
        ];
        lines.push(buildCsvLine(cells));
    });
    downloadCsv(lines, `product-research-${new Date().toISOString().slice(0, 10)}.csv`);
}

// Product Ranking panel columns — same set/order/icons (via thWithIcon's own keyword matching) as
// Primary Sales' own Product Snapshot ranking table.
const PRODUCT_SNAPSHOT_COLUMNS = ["#", "Name", "Sales", "Qty", "Contrib", "Contrib Δ LY", "vs LM", "vs LY"];

const PRODUCT_SNAPSHOT_LEVEL_LABELS = {
    product: "Products",
    category: "Category",
    subcategory: "Sub-category",
};

// Same Top 10/Below 10 x Value/Qty combo Primary Sales' own ranking select offers — unlike Primary's
// version (which has separate server-side-capped topByValue/bottomByValue/topByQty/bottomByQty
// arrays for Product level only, see PrimarySalesProductLevelService's own TOP_N), this page's
// products/categories/subCategories are already the FULL, uncapped list for just this one site (see
// SiteDetailProductLevelService's own header comment on why that's cheap enough here) — every level
// sorts/slices client-side the same way.
function productSnapshotLevelMetricOptions(level) {
    const name = PRODUCT_SNAPSHOT_LEVEL_LABELS[level];
    return [
        { value: "top10-value", label: `Top 10 ${name} by Value` },
        { value: "top10-qty", label: `Top 10 ${name} by Qty` },
        { value: "bottom10-value", label: `Below 10 ${name} by Value` },
        { value: "bottom10-qty", label: `Below 10 ${name} by Qty` },
    ];
}

// Client-side CSV export of the Product Ranking panel's currently-ranked rows — same shape/BOM
// convention as downloadResearchCsv above, adapted to RankedRow's own field names (sales/qty/
// contributionPct, not salesValue/salesQty/contribPct).
function downloadRankingCsv(rows) {
    if (!rows.length) {
        return;
    }
    const header = ["Name", "Sales", "Qty", "Contrib %", "Contrib Δ LY %", "vs LM %", "vs LY %"];
    const lines = [header.join(",")];
    rows.forEach((row) => {
        const cells = [
            row.name ?? "—",
            formatMoneyFull(row.sales, { nullDash: true }),
            Number(row.qty ?? 0).toLocaleString("en-IN"),
            row.contributionPct == null ? "—" : `${Number(row.contributionPct).toFixed(1)}%`,
            formatDeltaSigned(row.contribDeltaLYPct, { nullDash: true }),
            formatDeltaSigned(row.vsLastMonthPct, { nullDash: true }),
            formatDeltaSigned(row.vsLastYearPct, { nullDash: true }),
        ];
        lines.push(buildCsvLine(cells));
    });
    downloadCsv(lines, `site-product-ranking-${new Date().toISOString().slice(0, 10)}.csv`);
}

function initProductSnapshot(siteCode, brand) {
    const card = document.getElementById("siteProductSnapshotCard");
    const spinner = document.getElementById("siteProductSnapshotSpinner");
    const filterToggle = document.getElementById("siteProductSnapshotFilterToggle");
    const filterBody = document.getElementById("siteProductSnapshotFilterBody");
    const levelToggle = document.getElementById("siteProductSnapshotLevelToggle");
    const metricSelect = document.getElementById("siteProductSnapshotSortBy");
    const bodyWrap = document.getElementById("siteProductSnapshotBody");
    const downloadBtn = document.getElementById("siteProductSnapshotRankingDownloadBtn");
    const downloadPopup = document.getElementById("siteProductSnapshotDownloadPopupA");
    const downloadRangeSelect = document.getElementById("siteProductSnapshotDownloadRangeA");
    const downloadRangeInput = document.getElementById("siteProductSnapshotDownloadRangeInputA");
    const downloadConfirmBtn = document.getElementById("siteProductSnapshotDownloadConfirmA");

    if (!card || !bodyWrap) {
        return { setDateRange() {} };
    }

    const ON_SCREEN_LIMIT = 10;
    const state = { from: null, to: null };
    let currentResponse = null;
    let currentRows = [];

    // `limit` caps how many rows come back — ON_SCREEN_LIMIT for the table, a larger value when the
    // download range select asks for more. Every level sources from the same already-fetched,
    // already-full list (see PRODUCT_SNAPSHOT_LEVEL_LABELS's own comment) — no separate query.
    function rankedRows(level, metricValue, limit) {
        if (!currentResponse) {
            return [];
        }
        const [order, metric] = metricValue.split("-");
        const ascending = order === "bottom10";
        const source = level === "category" ? currentResponse.categories ?? []
            : level === "subcategory" ? currentResponse.subCategories ?? []
            : currentResponse.products ?? [];
        const sortKey = metric === "value" ? "sales" : "qty";
        return [...source]
            .sort((a, b) => (ascending ? Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0) : Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0)))
            .slice(0, limit);
    }

    function populateMetricSelect(level) {
        if (!metricSelect) {
            return;
        }
        const previous = metricSelect.value;
        const options = productSnapshotLevelMetricOptions(level);
        metricSelect.innerHTML = options.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join("");
        if (options.some((opt) => opt.value === previous)) {
            metricSelect.value = previous;
        }
    }

    function renderResult() {
        const level = levelToggle?.querySelector(".product-snapshot-level-btn.active")?.dataset.level ?? "product";
        const metricValue = metricSelect ? metricSelect.value : "top10-value";
        const option = productSnapshotLevelMetricOptions(level).find((opt) => opt.value === metricValue);
        const label = option ? option.label : metricValue;
        const rows = rankedRows(level, metricValue, ON_SCREEN_LIMIT);
        currentRows = rows;

        if (!rows.length) {
            bodyWrap.innerHTML = `
                <table class="product-snapshot-table">
                    <thead>
                        <tr>${PRODUCT_SNAPSHOT_COLUMNS.map((col) => `<th>${thWithIcon(col)}</th>`).join("")}</tr>
                    </thead>
                    <tbody>
                        <tr><td class="product-snapshot-empty" colspan="${PRODUCT_SNAPSHOT_COLUMNS.length}">No data available for ${escapeHtml(label)}.</td></tr>
                    </tbody>
                </table>`;
            return;
        }

        const bodyRows = rows.map((row, index) => `
            <tr>
                <td class="product-snapshot-col-rank">${index + 1}</td>
                <td class="product-snapshot-col-name"><span class="product-snapshot-name-text" title="${escapeHtml(row.name ?? "—")}">${escapeHtml(row.name ?? "—")}</span></td>
                <td>${formatMoney(row.sales, { nullDash: true, round: false })}</td>
                <td>${Number(row.qty ?? 0).toLocaleString("en-IN")}</td>
                <td>${row.contributionPct == null ? "—" : `${Number(row.contributionPct).toFixed(1)}%`}</td>
                <td>${row.contribDeltaLYPct == null ? "—" : renderDelta(row.contribDeltaLYPct)}</td>
                <td>${renderDelta(row.vsLastMonthPct)}</td>
                <td>${renderDelta(row.vsLastYearPct)}</td>
            </tr>`).join("");

        bodyWrap.innerHTML = `
            <table class="product-snapshot-table">
                <thead>
                    <tr>${PRODUCT_SNAPSHOT_COLUMNS.map((col) => `<th>${thWithIcon(col)}</th>`).join("")}</tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>`;
    }

    // Product Research modal — the Category -> Sub-category -> Product tree (renderResearchTable/
    // flattenResearchTree above), kept in sync every refresh() so it's never stale if the popup
    // happens to already be open when the user switches something.
    const researchBtn = document.getElementById("siteProductResearchBtn");
    const researchBackdrop = document.getElementById("siteProductResearchBackdrop");
    const researchClose = document.getElementById("siteProductResearchClose");
    const researchDownloadBtn = document.getElementById("siteProductResearchDownloadBtn");
    const researchTableWrap = document.getElementById("siteProductResearchTableWrap");
    let latestResearchRows = [];

    async function refresh() {
        card.classList.add("is-loading");
        try {
            const params = new URLSearchParams({ siteCode, brand });
            if (state.from && state.to) {
                params.set("from", state.from);
                params.set("to", state.to);
            }
            const response = await fetch(`/api/site-detail/product-level?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }
            currentResponse = await response.json();
            renderResult();
        } catch (error) {
            bodyWrap.innerHTML = `<div class="product-snapshot-empty">Failed to load product data.</div>`;
            currentResponse = null;
            renderResult();
        } finally {
            card.classList.remove("is-loading");
        }
        latestResearchRows = flattenResearchTree(currentResponse?.tree);
        if (researchTableWrap) {
            renderResearchTable(researchTableWrap, latestResearchRows);
        }
    }

    // "Product Research" button: opens the Category -> Sub-category -> Product tree in a popup —
    // same open/close pattern (backdrop click, close button) every other modal on this page uses.
    if (researchBtn && researchBackdrop) {
        researchBtn.addEventListener("click", () => {
            researchBackdrop.classList.add("is-open");
        });
        researchClose?.addEventListener("click", () => {
            researchBackdrop.classList.remove("is-open");
        });
        researchBackdrop.addEventListener("click", (event) => {
            if (event.target === researchBackdrop) {
                researchBackdrop.classList.remove("is-open");
            }
        });
    }

    researchDownloadBtn?.addEventListener("click", () => downloadResearchCsv(latestResearchRows));

    if (filterToggle && filterBody) {
        filterToggle.addEventListener("click", () => {
            const isOpen = !filterBody.hidden;
            filterBody.hidden = isOpen;
            filterToggle.classList.toggle("active", !isOpen);
            filterToggle.setAttribute("aria-expanded", String(!isOpen));
        });
    }

    const levelButtons = levelToggle ? Array.from(levelToggle.querySelectorAll(".product-snapshot-level-btn")) : [];
    levelButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.classList.contains("active")) {
                return;
            }
            levelButtons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            populateMetricSelect(btn.dataset.level);
            renderResult();
        });
    });

    metricSelect?.addEventListener("change", renderResult);

    // Download icon only opens/closes the range-picker popup — the actual CSV download happens from
    // the popup's own confirm button below, same two-step pattern Primary Sales' own ranking
    // download uses.
    const downloadPopupHandle = initDownloadPopup({ triggerBtn: downloadBtn, popupEl: downloadPopup });

    if (downloadRangeSelect && downloadRangeInput) {
        downloadRangeSelect.addEventListener("change", () => {
            downloadRangeInput.hidden = downloadRangeSelect.value !== "range";
        });
    }

    downloadConfirmBtn?.addEventListener("click", () => {
        const rangeValue = downloadRangeSelect ? downloadRangeSelect.value : "current";
        let rows;
        if (rangeValue === "current") {
            rows = currentRows;
        } else {
            const level = levelToggle?.querySelector(".product-snapshot-level-btn.active")?.dataset.level ?? "product";
            const metricValue = metricSelect ? metricSelect.value : "top10-value";
            const parsed = Math.floor(Number(downloadRangeInput?.value));
            const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : ON_SCREEN_LIMIT;
            rows = rankedRows(level, metricValue, limit);
        }
        downloadRankingCsv(rows);
        downloadPopupHandle.close();
    });

    void spinner; // reserved for a future loading-state refinement — is-loading already dims the panel
    const initialLevel = levelButtons.find((b) => b.classList.contains("active"))?.dataset.level ?? "product";
    populateMetricSelect(initialLevel);
    refresh();

    // Driven by the shared Filter in .site-detail-header (see SITE_DETAIL_CONTENT_TEMPLATE's own
    // #siteDetailSharedDateFilter and its Page.initSalesDateFilter wiring in loadSiteDetail) — mode
    // "filter" applies the picked range, anything else (cleared/untouched) falls back to
    // /api/site-detail/product-level's own current-calendar-month default, same convention
    // Dashboard.js's own initDashboardProductSnapshot uses for its Overview filter.
    function setDateRange(from, to, meta) {
        if (meta && meta.mode === "filter" && from && to) {
            state.from = from;
            state.to = to;
        } else {
            state.from = null;
            state.to = null;
        }
        refresh();
    }

    return { setDateRange };
}
Page.initProductSnapshot = initProductSnapshot;
}

// ==================== Site Code / Brand picker + detail load ====================

// Fetches/renders one (siteCode, brand)'s full detail view — the merged-in former standalone
// SiteDetailPage's own main(), turned into a re-callable function so switching sites in the picker
// above doesn't need a page/iframe reload.
async function loadSiteDetail(siteCode, brand) {
    const loadingEl = document.getElementById("siteDetailLoading");
    const errorEl = document.getElementById("siteDetailError");
    const contentEl = document.getElementById("siteDetailContent");

    contentEl.hidden = true;
    errorEl.hidden = true;
    loadingEl.hidden = false;

    let data;
    try {
        const res = await fetch(`/api/site-detail?siteCode=${encodeURIComponent(siteCode)}&brand=${encodeURIComponent(brand)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        loadingEl.hidden = true;
        errorEl.hidden = false;
        errorEl.textContent = "Failed to load site details.";
        return;
    }

    if (!data.found) {
        loadingEl.hidden = true;
        errorEl.hidden = false;
        errorEl.textContent = "Site not found.";
        return;
    }

    // Fresh markup every load (see SITE_DETAIL_CONTENT_TEMPLATE's own comment) — must happen before
    // any of the getElementById calls below, all of which target ids this template defines.
    contentEl.innerHTML = SITE_DETAIL_CONTENT_TEMPLATE;
    // Same promise pagePermissionsPromise's top-level call already started — awaiting it here never
    // triggers a second /api/auth/me fetch, just waits for that one to resolve if it hasn't yet.
    const sitePermissions = await pagePermissionsPromise;
    // Feature-gates this freshly-injected chunk's own data-feature elements (Date Filter/FY Year
    // Filter/download buttons) off the SAME resolved feature set the page-level applyFeatureGating()
    // call already fetched once — no new network request per site switch. Awaits pageFeaturesPromise
    // itself (not just pagePermissionsPromise, which it's chained off) so reapplyFeatureGating never
    // runs before that chained fetch has actually completed on this page's very first load.
    await pageFeaturesPromise;
    reapplyFeatureGating(contentEl);

    document.title = `${data.profile.Store_Name ?? data.profile.Site_Code} - Site Insights`;
    document.getElementById("siteDetailStoreName").textContent = data.profile.Store_Name ?? data.profile.Site_Code;
    document.getElementById("siteDetailSiteCode").textContent = `Site ${data.profile.Site_Code} · ${data.profile.Brand}`;

    const salesTypeFlags = resolveSalesTypeFlags(data.profile);

    renderProfileGrid(data.profile);
    updateGeoMapContext(data.profile.State);
    monthlyFyRawRows = data.monthlyHistory;
    monthlyFySalesFlags = salesTypeFlags;
    wireMonthlyFyYearFilter(data.profile.Site_Code);

    loadingEl.hidden = true;
    // #siteDetailContent itself carries data-permission="page:site-insights.site-detail" in the
    // HTML (SiteStatusPage.html) — checked explicitly here so a session that lacks this Section's
    // permission never has the whole detail view force-unhidden regardless of a successful fetch.
    contentEl.hidden = !sitePermissions.has("page:site-insights.site-detail");

    // Wired up only after contentEl is unhidden — ECharts measures its container's real pixel size
    // at init(), which is still 0x0 while a `hidden` ancestor keeps it out of layout.
    const salesTrend = Page.initSalesTrend(siteCode, brand, salesTypeFlags);
    const productSnapshot = Page.initProductSnapshot(siteCode, brand);

    // One shared Filter — in .site-detail-header, top-right — now drives both "2. Daily Sales
    // Trends" and "3. Product Snapshot" (per explicit request, replacing each section's own
    // separate copy). Called after both initSalesTrend/initProductSnapshot above so their handles
    // already exist before this fires its own synchronous initial onFilterChange call. Scoped to
    // this one site+brand's real years, same yearsApiUrl both previously used independently.
    Page.initSalesDateFilter({
        idPrefix: "siteDetailSharedDateFilter",
        monthDefaultMode: "year",
        yearsApiUrl: `/api/site-detail/trend-years?siteCode=${encodeURIComponent(siteCode)}&brand=${encodeURIComponent(brand)}`,
        onFilterChange: (column, from, to, meta) => {
            salesTrend.setDateRange(from, to, meta);
            productSnapshot.setDateRange(from, to, meta);
            updateSiteDetailRangeLabel(from, to);
        },
    });
}

async function initSiteCodePicker() {
    const select = document.getElementById("siteStatusSiteCodeSelect");
    const brandField = document.getElementById("siteStatusBrandField");
    const brandSelect = document.getElementById("siteStatusBrandSelect");
    if (!select) {
        return { reloadForStatus() {} };
    }

    function hideBrandPicker() {
        brandField.hidden = true;
        brandSelect.innerHTML = "";
    }

    function hideDetail() {
        document.getElementById("siteDetailLoading").hidden = true;
        document.getElementById("siteDetailError").hidden = true;
        const contentEl = document.getElementById("siteDetailContent");
        contentEl.hidden = true;
        contentEl.innerHTML = "";
        const contextRow = document.getElementById("siteStatusContextRow");
        if (contextRow) contextRow.hidden = true;
    }

    async function fetchBrands(siteCode) {
        const res = await fetch(`/api/site-status/brands?siteCode=${encodeURIComponent(siteCode)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function onSiteCodeChange() {
        const siteCode = select.value;
        hideBrandPicker();
        hideDetail();

        if (!siteCode) {
            return;
        }

        try {
            const brands = await fetchBrands(siteCode);
            if (brands.length <= 1) {
                if (brands.length === 1) {
                    loadSiteDetail(siteCode, brands[0]);
                }
                return;
            }

            brandSelect.innerHTML = `<option value="">Select a brand…</option>` +
                brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
            brandField.hidden = false;
        } catch (err) {
            // Site Code dropdown stays selected; Brand field/detail view simply won't appear.
        }
    }

    select.addEventListener("change", () => {
        syncSiteCodeSelectTitle();
        onSiteCodeChange();
    });
    brandSelect.addEventListener("change", () => {
        if (brandSelect.value) {
            loadSiteDetail(select.value, brandSelect.value);
        } else {
            hideDetail();
        }
    });

    // Fetches the Status+Sales-Type-toggle-scoped Site Code list and repopulates the dropdown —
    // used for the initial page load, every initStatusFilter/initSalesTypeFilter onChange (see
    // below), and re-rendered (no re-fetch) on every search-bar keystroke via renderSiteCodeOptions.
    // A previously-selected code that no longer matches gets deselected and the whole detail view
    // (+ the Geo Map context row it drives) hidden, same as clearing the dropdown by hand would —
    // per explicit request, the picker only ever offers/shows codes the toggles (and search) allow.
    let siteCodes = [];
    let siteCodeSearchQuery = "";
    const countEl = document.getElementById("siteStatusCodeCount");

    function siteCodeOptionLabel(entry) {
        return entry.Store_Name ? `${entry.Site_Code} - ${entry.Store_Name}` : entry.Site_Code;
    }

    // Keeps the select's own title in sync with whatever's actually selected — the closed select's
    // text is ellipsis-truncated (SiteStatusPage.css's #siteStatusSiteCodeSelect, narrowed per
    // explicit request), so this is what a hover on the closed control reveals the full "Code - Store
    // Name" through, same job each <option>'s own title (set in renderSiteCodeOptions below) does for
    // hovering a row inside the OPEN dropdown.
    function syncSiteCodeSelectTitle() {
        const selectedOption = select.options[select.selectedIndex];
        select.title = selectedOption ? selectedOption.textContent : "";
    }

    // Client-side narrowing of the already-fetched `siteCodes` by siteCodeSearchQuery (matches
    // Site_Code or Store_Name, case-insensitive) — no separate search endpoint, same
    // already-fetched-data convention every other page's own search bar uses. Shared by
    // renderSiteCodeOptions (the real <select>'s own contents) and renderSearchResultsDropdown
    // (the floating match list) below, so the two always agree on what counts as a match.
    function getFilteredSiteCodes() {
        const query = siteCodeSearchQuery.toLowerCase();
        return query
            ? siteCodes.filter((entry) => entry.Site_Code.toLowerCase().includes(query) ||
                  (entry.Store_Name || "").toLowerCase().includes(query))
            : siteCodes;
    }

    function renderSiteCodeOptions() {
        const previousValue = select.value;
        const filtered = getFilteredSiteCodes();

        select.innerHTML = `<option value="">Select a site code…</option>` +
            filtered.map((entry) => `<option value="${escapeHtml(entry.Site_Code)}" title="${escapeHtml(siteCodeOptionLabel(entry))}">${escapeHtml(siteCodeOptionLabel(entry))}</option>`).join("");

        if (previousValue && filtered.some((entry) => entry.Site_Code === previousValue)) {
            select.value = previousValue;
        } else if (previousValue) {
            select.value = "";
            hideBrandPicker();
            hideDetail();
        }
        syncSiteCodeSelectTitle();
    }

    // Floating match list shown under the search input as the user types (see this element's own
    // header comment in SiteStatusPage.html for why it's plain DOM rather than the native Site Code
    // <select>'s own showPicker() popup). Picking a row sets the real select's value and runs the
    // exact same onSiteCodeChange() flow a manual pick from that select would.
    const searchInputEl = document.getElementById("siteStatusSearchInput");
    const searchResultsEl = document.getElementById("siteStatusSearchResults");
    let searchResultHighlight = -1;

    function renderSearchResultsDropdown() {
        if (!searchResultsEl) return;
        if (!siteCodeSearchQuery) {
            searchResultsEl.hidden = true;
            searchResultsEl.innerHTML = "";
            searchResultHighlight = -1;
            return;
        }

        const filtered = getFilteredSiteCodes();
        searchResultHighlight = filtered.length ? 0 : -1;
        searchResultsEl.innerHTML = filtered.length
            ? filtered.slice(0, 50).map((entry, i) =>
                  `<button type="button" class="site-status-search-result-item${i === 0 ? " is-active" : ""}" data-site-code="${escapeHtml(entry.Site_Code)}">${escapeHtml(siteCodeOptionLabel(entry))}</button>`).join("")
            : `<div class="site-status-search-result-empty">No matching site codes</div>`;
        searchResultsEl.hidden = false;
    }

    function highlightSearchResult(items) {
        items.forEach((item, i) => item.classList.toggle("is-active", i === searchResultHighlight));
    }

    function pickSiteCodeFromSearch(code) {
        if (!code || !searchResultsEl) return;
        select.value = code;
        searchResultsEl.hidden = true;
        syncSiteCodeSelectTitle();
        onSiteCodeChange();
    }

    async function loadSiteCodes() {
        try {
            const res = await fetch(`${withStatusParam("/api/site-status/site-codes")}&salesType=${encodeURIComponent(siteSalesTypeFilter)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            siteCodes = await res.json();
            if (countEl) {
                countEl.textContent = `${siteCodes.length} site code${siteCodes.length === 1 ? "" : "s"}`;
            }
        } catch (err) {
            siteCodes = [];
            select.innerHTML = `<option value="">Failed to load site codes</option>`;
            if (countEl) countEl.textContent = "";
            return;
        }
        renderSiteCodeOptions();
    }

    // Previously auto-opened the native Site Code <select> (via showPicker()) on every keystroke so
    // the already-filtered dropdown popped up as you typed. That native OS-level popup swallows
    // every further keystroke (even ones sent right back to this input) until it's closed, which
    // truncated typing to just the first character or two for anyone not typing at benchmark speed.
    // Replaced with the floating match list above instead (renderSearchResultsDropdown) — plain page
    // DOM, so it can stay open and re-render live on every keystroke without ever taking focus away
    // from the input.
    initSearchBar({
        inputId: "siteStatusSearchInput",
        onQuery: (query) => {
            siteCodeSearchQuery = query;
            renderSiteCodeOptions();
            renderSearchResultsDropdown();
        },
    });

    searchInputEl?.addEventListener("focus", () => {
        if (siteCodeSearchQuery) renderSearchResultsDropdown();
    });

    searchInputEl?.addEventListener("blur", () => {
        if (searchResultsEl) searchResultsEl.hidden = true;
    });

    searchInputEl?.addEventListener("keydown", (e) => {
        if (!searchResultsEl || searchResultsEl.hidden) return;
        const items = Array.from(searchResultsEl.querySelectorAll(".site-status-search-result-item"));
        if (!items.length) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            searchResultHighlight = Math.min(searchResultHighlight + 1, items.length - 1);
            highlightSearchResult(items);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            searchResultHighlight = Math.max(searchResultHighlight - 1, 0);
            highlightSearchResult(items);
        } else if (e.key === "Enter") {
            e.preventDefault();
            const target = items[searchResultHighlight] || items[0];
            pickSiteCodeFromSearch(target.dataset.siteCode);
        } else if (e.key === "Escape") {
            searchResultsEl.hidden = true;
        }
    });

    // mousedown (not click) + preventDefault so picking a row never blurs the input first — the
    // blur handler above would otherwise hide this list out from under the click before its own
    // click event even fires.
    searchResultsEl?.addEventListener("mousedown", (e) => {
        const btn = e.target.closest(".site-status-search-result-item");
        if (!btn) return;
        e.preventDefault();
        pickSiteCodeFromSearch(btn.dataset.siteCode);
    });

    renderSalesTypePill(await loadSalesTypePillOptions());
    initSalesTypeFilter("siteStatusSalesTypeToggle", (newValue) => {
        siteSalesTypeFilter = newValue;
        loadSiteCodes();
    });

    await loadSiteCodes();

    // Deep link from this page's own Geo Map popup's district click-through (GeoMap.js) — navigates
    // here (full reload) with ?siteCode=&brand= instead of opening the old standalone SiteDetailPage
    // in a new tab. Reuses the exact same picker flow a manual selection would: preselect the Site
    // Code, then either let onSiteCodeChange's own single-brand auto-load fire, or (multiple brands)
    // preselect the Brand dropdown too and load directly, since GeoMap.js always already knows the
    // real brand.
    const urlParams = new URLSearchParams(window.location.search);
    const initialSiteCode = urlParams.get("siteCode");
    const initialBrand = urlParams.get("brand");
    if (initialSiteCode && siteCodes.some((entry) => entry.Site_Code === initialSiteCode)) {
        select.value = initialSiteCode;
        await onSiteCodeChange();
        if (initialBrand && !brandField.hidden) {
            brandSelect.value = initialBrand;
            if (brandSelect.value === initialBrand) {
                loadSiteDetail(initialSiteCode, initialBrand);
            }
        }
    }

    return { reloadForStatus: loadSiteCodes };
}

// ==================== Geo Map popup ====================
// "Geo Map" card (SiteStatusPage.html, right after the Site Code/Brand picker) opens a popup showing
// the same India map the Dashboard page used to show in its own "4. Geo Map" section — moved here in
// full per explicit request, nothing geo-map-related left on Dashboard (see GeoMap.js's own header
// comment). GeoMap.js — a d3/topojson-based module plus ~900KB of bundled map/city JSON — is
// dynamically imported the first time the card is clicked rather than loaded up front, so a Site
// Status visit that never opens the map pays none of that cost; later clicks just show the
// already-built popup instead of re-fetching or re-rendering.
// Returns a { refresh() } handle — the initStatusFilter call (bottom of file) calls it whenever the
// Status toggle changes, so a Geo Map popup that's currently open re-renders against the new status
// instead of staying stuck on whatever was loaded at open time. GeoMap.js's own getGeoData caches its
// fetch per status (see that file's own header comment), so this is cheap on every status the user
// has already visited this page load and only a real fetch the first time each one is picked.
function wireGeoMapModal() {
    const openBtn = document.getElementById("siteStatusGeoMapToggleCard");
    const backdrop = document.getElementById("siteStatusGeoMapModalBackdrop");
    const closeBtn = document.getElementById("siteStatusGeoMapModalClose");
    if (!openBtn || !backdrop) {
        return { refresh() {} };
    }

    let modulePromise = null;
    function loadModule() {
        if (!modulePromise) {
            modulePromise = import("/pages/SiteStatusPage/GeoMap.js");
        }
        return modulePromise;
    }

    function render() {
        loadModule().then((mod) => mod.initGeoMap(siteStatusFilter));
    }

    function open() {
        backdrop.classList.add("is-open");
        render();
    }

    function close() {
        backdrop.classList.remove("is-open");
    }

    openBtn.addEventListener("click", open);
    closeBtn?.addEventListener("click", close);
    // Click on the dimmed backdrop itself (not the modal panel) closes it too, same convention every
    // other popup modal in this app uses.
    backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
            close();
        }
    });

    return {
        refresh() {
            if (backdrop.classList.contains("is-open")) {
                render();
            }
        },
    };
}

// ==================== Geo Map context row (mini-map + store list) ====================
// Updated every time loadSiteDetail() resolves (called at the bottom of that function, with the
// freshly-loaded site's own Site_Master State) — not just for sites reached via a Geo Map deep-link,
// so picking a Site Code from the dropdown above updates these two cards exactly the same way as
// arriving via the map or clicking another store in the list below. Store-list card on the left
// listing every real site_master row in that state (GET /api/site-status/stores-by-state) — clicking a
// row re-loads the site detail view below in place via the same loadSiteDetail() the picker itself
// uses, which in turn refreshes these two cards again for whatever state that store belongs to. Mini
// map on the right (GeoMap.js's renderStateSnapshot, dynamically imported — same lazy-load reasoning
// as the popup itself, see wireGeoMapModal above) — its has-site districts still click through to the
// full popup's own site-list popup (full reload) instead.
function renderStoreListRows(bodyEl, stores) {
    if (!stores.length) {
        bodyEl.innerHTML = `<div class="geo-map-site-popup-empty">No stores found.</div>`;
        return;
    }
    bodyEl.innerHTML = stores.map((s) => `
        <button type="button" class="geo-map-site-popup-row" data-site-code="${escapeHtml(s.Site_Code)}" data-brand="${escapeHtml(s.Brand)}">
            <span class="geo-map-site-popup-code">${escapeHtml(s.Site_Code)}</span>
            <span class="geo-map-site-popup-name">${escapeHtml(s.Store_Name ?? "—")}</span>
            <span class="geo-map-site-popup-meta">${escapeHtml(s.Brand ?? "—")} · ${escapeHtml(s.City ?? "—")} · ${escapeHtml(s.Region ?? "—")}</span>
        </button>`).join("");
    bodyEl.querySelectorAll(".geo-map-site-popup-row").forEach((btn) => {
        btn.addEventListener("click", () => {
            const siteCode = btn.dataset.siteCode;
            const brand = btn.dataset.brand;
            const select = document.getElementById("siteStatusSiteCodeSelect");
            const brandField = document.getElementById("siteStatusBrandField");
            const brandSelect = document.getElementById("siteStatusBrandSelect");
            if (select && Array.from(select.options).some((o) => o.value === siteCode)) {
                select.value = siteCode;
            }
            if (brandField) brandField.hidden = true;
            if (brandSelect) brandSelect.innerHTML = "";
            loadSiteDetail(siteCode, brand);
        });
    });
}

// Remembers the last state this row rendered for — refreshGeoMapContextForStatus (bottom of file,
// called by the initStatusFilter call) uses this to re-run updateGeoMapContext against the new
// status without loadSiteDetail firing again, whenever the row is currently visible.
let lastGeoMapContextState = null;

// Called from loadSiteDetail() with that site's own Site_Master State — every site load (manual
// picker, Geo Map deep-link, or clicking another store in this same list) drives this. A missing State
// (nullable column) hides the row rather than showing it empty/stale.
async function updateGeoMapContext(state) {
    const row = document.getElementById("siteStatusContextRow");
    if (!row) {
        return;
    }
    lastGeoMapContextState = state;
    if (!state) {
        row.hidden = true;
        return;
    }

    const stateNameEl = document.getElementById("siteStatusStoreListStateName");
    const mapStateNameEl = document.getElementById("siteStatusMiniMapStateName");
    const countEl = document.getElementById("siteStatusStoreListCount");
    const districtCountEl = document.getElementById("siteStatusMiniMapDistrictCount");
    const bodyEl = document.getElementById("siteStatusStoreListBody");

    row.hidden = false;
    stateNameEl.textContent = state;
    if (mapStateNameEl) mapStateNameEl.textContent = state;
    countEl.textContent = "";
    if (districtCountEl) districtCountEl.textContent = "";
    bodyEl.innerHTML = `<div class="geo-map-site-popup-loading">Loading stores…</div>`;

    import("/pages/SiteStatusPage/GeoMap.js").then((mod) => mod.renderStateSnapshot("siteStatusMiniMapCard", state, siteStatusFilter));

    try {
        const res = await fetch(withStatusParam(`/api/site-status/stores-by-state?state=${encodeURIComponent(state)}`));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const stores = await res.json();
        countEl.textContent = `${stores.length} store${stores.length === 1 ? "" : "s"}`;
        renderStoreListRows(bodyEl, stores);
    } catch (err) {
        bodyEl.innerHTML = `<div class="geo-map-site-popup-empty">Failed to load stores.</div>`;
    }
}

// the initStatusFilter call's onChange calls this after the Site Code picker's own reload settles —
// if that reload hid the context row (the previously-loaded site no longer matches the new status),
// lastGeoMapContextState is stale and must NOT retrigger it; only refresh while the row is still
// actually visible (the loaded site is still valid under the new filter).
function refreshGeoMapContextForStatus() {
    const row = document.getElementById("siteStatusContextRow");
    if (row && !row.hidden && lastGeoMapContextState) {
        updateGeoMapContext(lastGeoMapContextState);
    }
}

// ==================== Compare modal ====================
// "Compare" button below the Geo Map one (SiteStatusPage.html) opens a modal with three tabs, each
// backed by SiteCompareController — all-time Sales/Target/Achievement % (same all-time convention the
// site detail view's own "Total" KPI card uses, no date-range picker here): every real State, the
// Sites within one picked State, or a hand-picked list of Stores from a searchable checklist. Each
// tab's own data is fetched once and cached in these module-level variables (compareStatesLoaded,
// compareStateOptionsLoaded, compareAllStores) — reopening the modal or re-switching tabs never
// re-fetches unless the underlying pick changes (a different State, a different Store selection).
function pctCell(row) {
    return row.achievementPct === null || row.achievementPct === undefined ? "—" : `${Number(row.achievementPct).toFixed(1)}%`;
}

const COMPARE_STATE_COLUMNS = [
    { label: "State", render: (r) => escapeHtml(r.state ?? "—") },
    { label: "Sites", render: (r) => escapeHtml(String(r.siteCount ?? "—")) },
    { label: "Total Sales", render: (r) => formatMoney(r.totalSales, { nullDash: true }) },
    { label: "Total Target", render: (r) => formatMoney(r.totalTarget, { nullDash: true }) },
    { label: "Achievement", render: pctCell },
];

const COMPARE_SITE_COLUMNS = [
    { label: "Site Code", render: (r) => escapeHtml(r.siteCode ?? "") },
    { label: "Store", render: (r) => escapeHtml(r.storeName ?? "") },
    { label: "Brand", render: (r) => escapeHtml(r.brand ?? "—") },
    { label: "City", render: (r) => escapeHtml(r.city ?? "—") },
    { label: "Total Sales", render: (r) => formatMoney(r.totalSales, { nullDash: true }) },
    { label: "Total Target", render: (r) => formatMoney(r.totalTarget, { nullDash: true }) },
    { label: "Achievement", render: pctCell },
];

function renderCompareTable(wrapEl, rows, columns) {
    if (!rows.length) {
        wrapEl.innerHTML = `<div class="site-status-compare-table-empty">No data to compare.</div>`;
        return;
    }
    const theadCells = columns.map((c) => `<th>${thWithIcon(c.label)}</th>`).join("");
    const bodyRows = rows.map((row) => {
        // The trailing summary row both per-row endpoints append (SiteCompareService#compareSites)
        // carries storeName:"Total" and no siteCode — flagged here purely for the highlight style.
        const isTotal = row.storeName === "Total" && row.siteCode == null;
        const cells = columns.map((c) => `<td>${c.render(row)}</td>`).join("");
        return `<tr${isTotal ? ' class="site-status-compare-total-row"' : ""}>${cells}</tr>`;
    }).join("");
    wrapEl.innerHTML = `
        <table class="product-snapshot-table">
            <thead><tr>${theadCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>`;
}

let compareStatesLoaded = false;
async function loadCompareStates() {
    if (compareStatesLoaded) return;
    const wrap = document.getElementById("siteStatusCompareStatesWrap");
    wrap.innerHTML = `<div class="site-status-compare-table-empty">Loading…</div>`;
    try {
        const res = await fetch(withStatusParam("/api/site-compare/states"));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        renderCompareTable(wrap, rows, COMPARE_STATE_COLUMNS);
        compareStatesLoaded = true;
    } catch (err) {
        wrap.innerHTML = `<div class="site-status-compare-table-empty">Failed to load comparison.</div>`;
    }
}

let compareStateOptionsLoaded = false;
async function ensureCompareStateOptions() {
    if (compareStateOptionsLoaded) return;
    const select = document.getElementById("siteStatusCompareStateSelect");
    try {
        const res = await fetch("/api/site-compare/states-list");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const states = await res.json();
        select.innerHTML = `<option value="">Select a state…</option>` +
            states.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
        compareStateOptionsLoaded = true;
    } catch (err) {
        select.innerHTML = `<option value="">Failed to load states</option>`;
    }
}

async function loadCompareSitesInState(state) {
    const wrap = document.getElementById("siteStatusCompareSitesInStateWrap");
    if (!state) {
        wrap.innerHTML = `<div class="site-status-compare-table-empty">Pick a state above to compare its sites.</div>`;
        return;
    }
    wrap.innerHTML = `<div class="site-status-compare-table-empty">Loading…</div>`;
    try {
        const res = await fetch(withStatusParam(`/api/site-compare/sites-in-state?state=${encodeURIComponent(state)}`));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        renderCompareTable(wrap, rows, COMPARE_SITE_COLUMNS);
    } catch (err) {
        wrap.innerHTML = `<div class="site-status-compare-table-empty">Failed to load comparison.</div>`;
    }
}

// Selected Stores tab — every real site_master row fetched once (compareAllStores), filtered
// client-side by the search box (same one-shot-fetch-then-filter convention GeoMap.js's own bundled
// data uses); compareSelectedKeys ("Site_Code|Brand") survives across search-filter changes and tab
// switches within one page session, same as compareStatesLoaded/compareStateOptionsLoaded above.
let compareAllStores = null;
const compareSelectedKeys = new Set();

function compareStoreKey(s) {
    return `${s.Site_Code}|${s.Brand}`;
}

function renderComparePickerList(filterText) {
    const listEl = document.getElementById("siteStatusComparePickerList");
    const term = (filterText ?? "").trim().toLowerCase();
    const filtered = !term ? compareAllStores : compareAllStores.filter((s) =>
        `${s.Site_Code} ${s.Store_Name} ${s.City}`.toLowerCase().includes(term));
    if (!filtered.length) {
        listEl.innerHTML = `<div class="site-status-compare-table-empty">No matching stores.</div>`;
        return;
    }
    listEl.innerHTML = filtered.map((s) => {
        const key = compareStoreKey(s);
        const checked = compareSelectedKeys.has(key) ? "checked" : "";
        return `
            <label class="site-status-compare-picker-row">
                <input type="checkbox" data-key="${escapeHtml(key)}" ${checked}>
                <span class="site-status-compare-picker-name">${escapeHtml(s.Store_Name ?? s.Site_Code)}</span>
                <span class="site-status-compare-picker-meta">${escapeHtml(s.Brand ?? "—")} · ${escapeHtml(s.City ?? "—")} · ${escapeHtml(s.State ?? "—")}</span>
            </label>`;
    }).join("");
    listEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.addEventListener("change", () => {
            if (cb.checked) {
                compareSelectedKeys.add(cb.dataset.key);
            } else {
                compareSelectedKeys.delete(cb.dataset.key);
            }
            updateCompareRunButton();
        });
    });
}

function updateCompareRunButton() {
    const runBtn = document.getElementById("siteStatusCompareRunBtn");
    document.getElementById("siteStatusCompareSelectedCount").textContent = String(compareSelectedKeys.size);
    runBtn.disabled = compareSelectedKeys.size === 0;
}

async function ensureCompareStorePicker() {
    if (compareAllStores) return;
    const listEl = document.getElementById("siteStatusComparePickerList");
    listEl.innerHTML = `<div class="site-status-compare-table-empty">Loading…</div>`;
    try {
        const res = await fetch(withStatusParam("/api/site-compare/stores-picker"));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        compareAllStores = await res.json();
        renderComparePickerList("");
    } catch (err) {
        compareAllStores = [];
        listEl.innerHTML = `<div class="site-status-compare-table-empty">Failed to load stores.</div>`;
    }
}

async function runCompareSelectedStores() {
    if (!compareSelectedKeys.size) return;
    const wrap = document.getElementById("siteStatusCompareSelectedStoresWrap");
    wrap.innerHTML = `<div class="site-status-compare-table-empty">Loading…</div>`;
    const sites = Array.from(compareSelectedKeys).map((key) => {
        const [siteCode, brand] = key.split("|");
        return { siteCode, brand };
    });
    try {
        const res = await fetch("/api/site-compare/stores", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sites),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        renderCompareTable(wrap, rows, COMPARE_SITE_COLUMNS);
    } catch (err) {
        wrap.innerHTML = `<div class="site-status-compare-table-empty">Failed to load comparison.</div>`;
    }
}

// Returns a { refresh() } handle — the initStatusFilter call (bottom of file) calls it whenever the
// Status toggle changes, so a Compare modal that's currently open re-fetches the active tab against
// the new status instead of staying stuck on whatever was loaded at open/tab-switch time.
function wireCompareModal() {
    const openBtn = document.getElementById("siteStatusCompareToggleCard");
    const backdrop = document.getElementById("siteStatusCompareModalBackdrop");
    const closeBtn = document.getElementById("siteStatusCompareModalClose");
    const tabsEl = document.getElementById("siteStatusCompareTabs");
    if (!openBtn || !backdrop) {
        return { refresh() {} };
    }

    const panels = {
        states: document.getElementById("siteStatusComparePanel-states"),
        sitesInState: document.getElementById("siteStatusComparePanel-sitesInState"),
        selectedStores: document.getElementById("siteStatusComparePanel-selectedStores"),
    };

    let currentTab = "states";

    function activateTab(tab) {
        currentTab = tab;
        tabsEl.querySelectorAll(".site-status-compare-tab-btn").forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.tab === tab);
        });
        Object.entries(panels).forEach(([key, el]) => { el.hidden = key !== tab; });

        if (tab === "states") {
            loadCompareStates();
        } else if (tab === "sitesInState") {
            ensureCompareStateOptions();
        } else if (tab === "selectedStores") {
            ensureCompareStorePicker();
        }
    }

    tabsEl.addEventListener("click", (event) => {
        const btn = event.target.closest(".site-status-compare-tab-btn");
        if (btn) activateTab(btn.dataset.tab);
    });

    document.getElementById("siteStatusCompareStateSelect")?.addEventListener("change", (event) => {
        loadCompareSitesInState(event.target.value);
    });

    initSearchBar({
        inputId: "siteStatusCompareStoreSearch",
        onQuery: (text) => {
            if (compareAllStores) renderComparePickerList(text);
        },
    });

    document.getElementById("siteStatusCompareRunBtn")?.addEventListener("click", runCompareSelectedStores);

    function open() {
        backdrop.classList.add("is-open");
        activateTab("states");
    }

    function close() {
        backdrop.classList.remove("is-open");
    }

    openBtn.addEventListener("click", open);
    closeBtn?.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
            close();
        }
    });

    return {
        refresh() {
            // Every Status-scoped tab's own cache flag/value reset so its loader (called via
            // activateTab below) actually refetches instead of no-op-ing on stale data.
            compareStatesLoaded = false;
            compareAllStores = null;
            if (!backdrop.classList.contains("is-open")) {
                return;
            }
            activateTab(currentTab);
            // activateTab's own "sitesInState" branch only (re)loads the State dropdown itself
            // (states-list isn't Status-scoped, see SiteCompareService's own getDistinctStates) — a
            // state already picked there needs its own comparison explicitly re-run against the new
            // status, same as loadCompareSitesInState's own change-listener above does.
            if (currentTab === "sitesInState") {
                const stateSelect = document.getElementById("siteStatusCompareStateSelect");
                if (stateSelect?.value) {
                    loadCompareSitesInState(stateSelect.value);
                }
            }
        },
    };
}

// Status toggle pill itself (SiteStatusPage.html's #siteStatusFilterToggle, below the Site Code
// card) now lives in components/StatusFilter/StatusFilter.js — a click there updates
// siteStatusFilter (below) then fans the change out to every Status-scoped piece of this page: the
// Site Code dropdown (siteCodePickerHandle.reloadForStatus, awaited first since it may hide the
// detail view/context row a still-open Geo Map/Compare modal or the context row itself would
// otherwise be refreshing against a site that's no longer selected), then the Geo Map popup, the
// Compare modal, and finally the mini-map/store-list context row (which must run last, after the
// picker reload has settled whether it's still visible at all — see refreshGeoMapContextForStatus's
// own header comment).
const geoMapModalHandle = wireGeoMapModal();
const compareModalHandle = wireCompareModal();
// Status pill options are fetched/rendered (renderStatusPill, above) BEFORE initSiteCodePicker runs —
// same sequencing PrimarySalesPage.js's own wirePage uses for its Brand/Status pills — so the picker's
// own initial fetch (withStatusParam) already sees whichever real siteStatusFilter value
// renderStatusPill settled on, instead of racing it.
loadStatusPillOptions().then((statuses) => {
    renderStatusPill(statuses);
    initSiteCodePicker().then((siteCodePickerHandle) => {
        initStatusFilter("siteStatusFilterToggle", async (newValue) => {
            siteStatusFilter = newValue;
            await siteCodePickerHandle.reloadForStatus();
            geoMapModalHandle.refresh();
            compareModalHandle.refresh();
            refreshGeoMapContextForStatus();
        });
    });
});
