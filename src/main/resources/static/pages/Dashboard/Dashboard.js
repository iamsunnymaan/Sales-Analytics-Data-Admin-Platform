import { formatMoney, formatMoneyFull, formatDelta, formatDeltaSigned } from "/Shared/js/format.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating } from "/Shared/js/feature-guard.js";
import { buildCsvLine, downloadCsv, initDownloadPopup } from "/components/ExcelDownloadButton/ExcelDownloadButton.js";
import { initFyYearFilter } from "/components/FyYearFilter/FyYearFilter.js";
import { initSalesDateFilter } from "/components/SalesDateFilter/SalesDateFilter.js";
import { initBrandHeader } from "/components/BrandFilter/BrandFilter.js";
import { initChannelHeader } from "/components/ChannelFilter/ChannelFilter.js";
import { initSalesTypeFilter } from "/components/SalesTypeFilter/SalesTypeFilter.js";
import { initStatusFilter } from "/components/StatusFilter/StatusFilter.js";

// Reveals this page's Section/Feature-gated elements (Filter Header, Overview, Daily Sales Trends,
// "3. Partner Wise Target Vs Achievement", and their own view/export/change-filters/compare features
// — see index.html's data-permission attributes) once the session's real permission set resolves;
// every one of them ships `hidden` in the static HTML itself, so there's no flash of content this
// session doesn't hold permission for. New, wholly independent per-user "Features" system (not the
// old, removed Permission-tree "Feature" level — see AuthBootstrapSeeder's own header comment on that
// unrelated history). Hides the same 10 shared-widget elements' data-feature containers this
// session's own account has had a Feature explicitly turned off for — see Shared/js/feature-guard.js's
// own header comment for why this is default-ALLOW, the opposite of applyPagePermissions' default-
// deny. Sequenced to run only AFTER applyPagePermissions resolves (not fired in parallel) because
// applyPagePermissions sets `hidden` unconditionally from its own permission check on any
// [data-permission] element — an element carrying BOTH attributes (e.g. Explorer's export panel)
// would have a feature-based hide silently undone if permission-gating's own (unrelated) assignment
// ran second; this order guarantees feature-gating's hide is always the last word.
applyPagePermissions().then(() => applyFeatureGating());

function money(value, opts) {
    return formatMoney(value, opts).replace("₹", "");
}

function moneyFull(value, opts) {
    return formatMoneyFull(value, opts).replace("₹", "");
}

// ==================== 1. Overview (Financial Year table) ==================== //
// Target, Actual, Vs Target, and Vs Last Year are all wired to real per-month data for both Primary
// Sales (Primary_Sales/Primary_Sales_Target) and Secondary Sales (Secondary_Sales/
// Secondary_Sales_Target), fetched fresh on every Year Filter change (see
// renderDashboardFyOverviewTable below) — every month key the backend returns is pre-seeded to 0
// (DashboardOverviewService's own seededMonths), so a month with no real rows yet shows a real 0
// rather than a placeholder number; a failed fetch (network error) falls back to 0 too, same
// convention. FY 26-27 (the "current" FY, computed from today's real date) keeps its Actual/Current/
// Projection month split; past FYs render every month as Actual, since a fully elapsed year has no
// "current" or "projection" month.
const DASHBOARD_FY_MONTH_NAMES = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

// Apr..Mar month labels + row type for one financial year, e.g. fyStartYear=26 => "Apr-26".."Mar-27".
function buildDashboardFyMonths(fyStartYear, currentMonthIndex) {
    return DASHBOARD_FY_MONTH_NAMES.map((name, i) => {
        const year = i < 9 ? fyStartYear : fyStartYear + 1; // Apr(0)..Dec(8) is the start year, Jan(9)..Mar(11) rolls to the next
        const label = `${name}-${String(year).padStart(2, "0")}`;
        const type = currentMonthIndex == null ? "actual"
            : i === currentMonthIndex ? "current"
            : i < currentMonthIndex ? "actual"
            : "projection";
        return { month: label, type };
    });
}

// Computed from the real current date (not hardcoded) so a new FY automatically appears — and
// becomes the default selection — the moment the calendar actually rolls into it (April), instead
// of needing a manual code change "when the new season comes" every year, per explicit request.
function getCurrentFyStartYear2Digit() {
    const now = new Date();
    const calendarYear2Digit = now.getFullYear() % 100;
    // Jan-Mar (month 0-2) still belongs to the FY that started the PREVIOUS April.
    return now.getMonth() < 3 ? calendarYear2Digit - 1 : calendarYear2Digit;
}

function getCurrentFyMonthIndex() {
    const jsMonth = new Date().getMonth(); // 0=Jan..11=Dec
    return (jsMonth + 9) % 12; // rotates so Apr(3)->0 .. Mar(2)->11
}

const DASHBOARD_FY_CURRENT_START_YEAR = getCurrentFyStartYear2Digit();
const DASHBOARD_FY_CURRENT_MONTH_INDEX = getCurrentFyMonthIndex();

function fyKeyFor(startYear2Digit) {
    const start = ((startYear2Digit % 100) + 100) % 100;
    return `20${String(start).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function fyLabelFor(startYear2Digit) {
    const start = ((startYear2Digit % 100) + 100) % 100;
    return `FY ${String(start).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// fyKeyFor's own "yyyy-yy" key (e.g. "2026-27") -> the same Apr 1..Mar 31 date range
// currentFinancialYearMonthRange builds for "the current FY" — used to push whichever FY the Year
// Filter just picked into Daily Sales Trends too (see the Year Filter's own menu click handler
// below), so that section's date range always matches "1. Overview"'s instead of staying pinned to
// today's real FY regardless of what's selected up there.
function dashboardFyKeyToMonthRange(fyKey) {
    const fyStartYear = Number(fyKey.split("-")[0]);
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
}

// Single source of truth for switching "1. Overview" to a given FY — updates the Year Filter
// button's own label + active menu item and re-renders the table. Used by the Year Filter's own menu
// click handler below so the dropdown's displayed selection always matches whichever FY the table is
// actually showing. Returns false (and changes nothing) when fyKey falls outside DASHBOARD_FY_KEYS'
// rolling 3-FY window, which the dropdown itself has no entry for.
// Set once wireDailyTrend (further down this file) finishes creating it — lets the "Filter Header"
// section's own pill/Year Filter/Sales Date Filter handlers push their current selection into this
// chart too. Declared this early (well before wireDailyTrend's own async IIFE) because the Sales
// Date Filter's onFilterChange below fires once synchronously on page load, before wireDailyTrend's
// "await loadBrandPillOptions()" has had a chance to resolve — referencing dailyTrendGraph there
// needs the `let` binding to already exist (even if still null) or it'd throw a
// temporal-dead-zone ReferenceError instead of just no-op-ing via the optional chaining below.
let dailyTrendGraph = null;

// Rolling window: current FY + the 2 before it — as real time advances into a new FY, this whole
// window (and the dropdown built from it below) shifts forward automatically on next page load.
const DASHBOARD_FY_WINDOW_SIZE = 3;
const DASHBOARD_FY_KEYS = Array.from({ length: DASHBOARD_FY_WINDOW_SIZE }, (_, i) => fyKeyFor(DASHBOARD_FY_CURRENT_START_YEAR - i));
const DASHBOARD_FY_CURRENT_KEY = DASHBOARD_FY_KEYS[0];

const DASHBOARD_FY_OVERVIEW_DATA = {};
DASHBOARD_FY_KEYS.forEach((key, i) => {
    const startYear = DASHBOARD_FY_CURRENT_START_YEAR - i;
    const isCurrentFy = i === 0;
    DASHBOARD_FY_OVERVIEW_DATA[key] = {
        label: fyLabelFor(startYear),
        months: buildDashboardFyMonths(startYear, isCurrentFy ? DASHBOARD_FY_CURRENT_MONTH_INDEX : null),
    };
});

// Real GET /api/dashboard/overview/{primary,secondary}-target + /overview/primary-actual?
// fyStartYear=... — every other field in this table is still frontend placeholder data (see this
// section's own header comment above). Vs Target/Vs Last Year % are recomputed from whichever of
// their two inputs are real, so a column never shows a % that doesn't match what's on screen.
let dashboardFyOverviewRequestSeq = 0;

// This section's own Sales Type/Brand/Channel/Status filter row state — "all" for every one of them
// is the default (matches the original brand/channel/status-agnostic behavior). salesType controls
// which column group(s) stay visible (see the .dashboard-fy-hide-primary/-secondary classes toggled
// in initDashboardFyOverviewFilter below); brand/channel/status just narrow the fetched numbers. Also
// tracks whichever FY key is currently on screen, so a filter change re-renders that same FY instead
// of needing its own copy of the Year Filter's own selection state.
let dashboardFyOverviewSalesType = "all";
let dashboardFyOverviewBrand = "all";
let dashboardFyOverviewChannel = "all";
let dashboardFyOverviewStatus = "all";
let dashboardFyOverviewCurrentKey = DASHBOARD_FY_CURRENT_KEY;

// Generic fetch for any of this section's own /overview/* endpoints — they all return the same
// { "yyyy-MM": number } shape, whether the metric itself is a Target or an Actual Sales total.
async function fetchDashboardFyOverviewMetric(endpoint, fyStartYear, requestId) {
    try {
        const params = new URLSearchParams({
            fyStartYear: String(fyStartYear),
            brand: dashboardFyOverviewBrand,
            channel: dashboardFyOverviewChannel,
            status: dashboardFyOverviewStatus,
        });
        const res = await fetch(`/api/dashboard/overview/${endpoint}?${params.toString()}`);
        if (!res.ok || requestId !== dashboardFyOverviewRequestSeq) {
            return null;
        }
        return await res.json();
    } catch {
        return null;
    }
}

// Real current-month Primary_Sales_Projection total (GET /overview/primary-projection) — a single
// number, not a per-month map like fetchDashboardFyOverviewMetric's endpoints, since Primary_Sales_
// Projection only ever holds the real current month's own submissions (see TopProjectionService's own
// truncateOnStartup). Used by renderDashboardFyOverviewTable's current-month row as a stand-in for
// Primary Actual whenever nobody's uploaded this month's real Primary_Sales rows yet.
async function fetchDashboardPrimaryProjectionTotal(requestId) {
    try {
        const params = new URLSearchParams({
            brand: dashboardFyOverviewBrand,
            channel: dashboardFyOverviewChannel,
        });
        const res = await fetch(`/api/dashboard/overview/primary-projection?${params.toString()}`);
        if (!res.ok || requestId !== dashboardFyOverviewRequestSeq) {
            return null;
        }
        return await res.json();
    } catch {
        return null;
    }
}

// "Apr-26" -> "2026-04", keyed the same way the backend returns it (DashboardOverviewService's own
// getMonthlyTargetTotals).
function dashboardFyMonthLabelToKey(month) {
    const [monthName, yy] = month.split("-");
    const idx = DASHBOARD_FY_MONTH_NAMES.indexOf(monthName);
    const mm = idx < 9 ? idx + 4 : idx - 8;
    return `20${yy}-${String(mm).padStart(2, "0")}`;
}

// Same calendar month, one year earlier — "2026-04" -> "2025-04" — used to look up each month's own
// entry in the FY-1 target map fetched alongside the current FY's own.
function dashboardFyMonthKeyLastYear(monthKey) {
    const [y, m] = monthKey.split("-");
    return `${Number(y) - 1}-${m}`;
}

// null (not 0) when either side is missing real data — renderDelta/formatDelta's own nullDash
// option turns that into "—" instead of a misleading "+100%"/"-100%" (current=0 only means "no
// target entered for this month yet", not "target really dropped to zero").
function growthPct(current, previous) {
    if (!current || !previous) {
        return null;
    }
    return ((current - previous) / previous) * 100;
}

// Signed money string ("+₹1,234" / "-₹1,234" / "₹0") for renderYoyVariance below — formatMoney
// itself only signs negatives, so the "+" here is added explicitly.
function formatVariance(value) {
    if (value === null || value === undefined) {
        return "—";
    }
    const num = Number(value);
    const sign = num > 0 ? "+" : (num < 0 ? "-" : "");
    return `${sign}${money(Math.abs(num), { round: false })}`;
}

// "Vs Last Year" cell content — the variance AMOUNT (abbreviated Cr/L, this file's own money())
// alongside the growth % AND the real Last Year figure itself, combined into one cell here instead
// of two/three separate rows: "variance (growth%) / last year value". Per explicit request, the
// Last Year value now rides along in this same cell instead of being a separate column. "—" only
// when `previous` itself has no real data — there's genuinely nothing to show. When `previous` IS
// real but `current` isn't yet (no actual/projection landed for this side so far — e.g. a partner
// with no sales rows yet this month), the variance/growth% portion alone falls back to "—" (there's
// no meaningful "up/down vs last year" to report yet), but the real Last Year figure itself still
// shows — per explicit request ("show the last year ... if actual sale value exist or not"; this
// used to hide a real, on-screen Last Year number any time the current side was still 0, across
// every "Vs LY"/"Vs Last Year" column that calls this shared helper). The Last Year figure sits in
// its own .dashboard-delta-lastyear span (per explicit request) so it keeps a fixed muted color
// instead of inheriting the surrounding positive/negative trend color, which read as the Last Year
// amount itself being "up" or "down".
function renderYoyVariance(current, previous) {
    if (!previous) {
        return "—";
    }
    if (!current) {
        return `<span class="dashboard-delta" title="Last Year: ${escapeAttr(formatMoneyFull(previous))}">— / <span class="dashboard-delta-lastyear">${money(previous, { round: false })}</span></span>`;
    }
    const diff = current - previous;
    return `<span class="dashboard-delta ${trendClass(diff)}" title="Last Year: ${escapeAttr(formatMoneyFull(previous))}">${formatVariance(diff)} (${formatDelta(growthPct(current, previous))}) / <span class="dashboard-delta-lastyear">${money(previous, { round: false })}</span></span>`;
}

// On-screen Target/Actual cell — abbreviated Cr/L (this file's own ₹-stripped money()), with the
// full, un-abbreviated rupee amount in the title attribute so a long hover reveals the real number.
// allowDash mirrors the "—" (not "0") distinction the month rows already draw between "no data
// entered yet" and "the real figure is actually zero" — the Total row never wants that dash.
function fyMoneyCell(value, allowDash, groupClass = "") {
    const cls = groupClass ? ` class="${groupClass}"` : "";
    if (allowDash && !value) {
        return `<td${cls}>—</td>`;
    }
    return `<td${cls} title="${escapeAttr(formatMoneyFull(value))}">${money(value, { round: false })}</td>`;
}

// ==================== 1. Overview CSV download ==================== //
// Per explicit request: a Download button next to the Year Filter, asking which FY to export —
// independent of whichever FY the table itself currently has selected. Uses full, un-abbreviated
// money() in the CSV even though the on-screen table abbreviates.
function fyAchiCsvText(actual, target) {
    const pct = achiPct(actual, target);
    return pct == null ? "—" : `${pct.toFixed(1)}%`;
}

function fyVsLyCsvText(current, previous) {
    if (!current || !previous) {
        return "—";
    }
    return formatDeltaSigned(growthPct(current, previous));
}

async function downloadDashboardFyOverviewCsv(fyKey) {
    const data = DASHBOARD_FY_OVERVIEW_DATA[fyKey];
    if (!data) {
        return;
    }
    const fyStartYear = 2000 + Number(fyKey.split("-")[0].slice(-2));
    const requestId = ++dashboardFyOverviewRequestSeq;
    const [primaryTargets, secondaryTargets, primaryActuals, secondaryActuals, primaryActualsLY, secondaryActualsLY] = await Promise.all([
        fetchDashboardFyOverviewMetric("primary-target", fyStartYear, requestId),
        fetchDashboardFyOverviewMetric("secondary-target", fyStartYear, requestId),
        fetchDashboardFyOverviewMetric("primary-actual", fyStartYear, requestId),
        fetchDashboardFyOverviewMetric("secondary-actual", fyStartYear, requestId),
        fetchDashboardFyOverviewMetric("primary-actual", fyStartYear - 1, requestId),
        fetchDashboardFyOverviewMetric("secondary-actual", fyStartYear - 1, requestId),
    ]);
    if (requestId !== dashboardFyOverviewRequestSeq) {
        return; // a newer FY selection/download has since started its own fetch
    }

    const header = ["Month", "Primary Target", "Primary Sales", "Primary Achi %", "Primary Vs LY %", "Secondary Target", "Secondary Sales", "Secondary Achi %", "Secondary Vs LY %"];
    const lines = [header.join(",")];
    let primaryTargetTotal = 0;
    let secondaryTargetTotal = 0;
    let primaryActualTotal = 0;
    let secondaryActualTotal = 0;
    let primaryActualTotalLY = 0;
    let secondaryActualTotalLY = 0;

    data.months.forEach(({ month, type }) => {
        const monthKey = dashboardFyMonthLabelToKey(month);
        const lastYearKey = dashboardFyMonthKeyLastYear(monthKey);
        const primaryTarget = primaryTargets && primaryTargets[monthKey] != null ? Number(primaryTargets[monthKey]) : 0;
        const secondaryTarget = secondaryTargets && secondaryTargets[monthKey] != null ? Number(secondaryTargets[monthKey]) : 0;
        const primaryActual = primaryActuals && primaryActuals[monthKey] != null ? Number(primaryActuals[monthKey]) : 0;
        const secondaryActual = secondaryActuals && secondaryActuals[monthKey] != null ? Number(secondaryActuals[monthKey]) : 0;
        const primaryActualLY = primaryActualsLY && primaryActualsLY[lastYearKey] != null ? Number(primaryActualsLY[lastYearKey]) : 0;
        const secondaryActualLY = secondaryActualsLY && secondaryActualsLY[lastYearKey] != null ? Number(secondaryActualsLY[lastYearKey]) : 0;
        // Same complete-FY display convention the on-screen table uses for months after the current
        // one — see renderDashboardFyOverviewTable's own comment: real actual for elapsed months,
        // that month's own Target as an on-plan stand-in for the rest, and the Total row below sums
        // THIS figure (not the strictly-real actual) so it matches what the Actual column shows.
        const displayPrimaryActual = type === "projection" ? primaryTarget : primaryActual;
        const displaySecondaryActual = type === "projection" ? secondaryTarget : secondaryActual;
        primaryTargetTotal += primaryTarget;
        secondaryTargetTotal += secondaryTarget;
        primaryActualTotal += displayPrimaryActual;
        secondaryActualTotal += displaySecondaryActual;
        primaryActualTotalLY += primaryActualLY;
        secondaryActualTotalLY += secondaryActualLY;
        const cells = [
            month,
            moneyFull(primaryTarget, { nullDash: true }),
            moneyFull(displayPrimaryActual),
            fyAchiCsvText(displayPrimaryActual, primaryTarget),
            fyVsLyCsvText(displayPrimaryActual, primaryActualLY),
            moneyFull(secondaryTarget, { nullDash: true }),
            moneyFull(displaySecondaryActual),
            fyAchiCsvText(displaySecondaryActual, secondaryTarget),
            fyVsLyCsvText(displaySecondaryActual, secondaryActualLY),
        ];
        lines.push(buildCsvLine(cells));
    });

    const totalCells = [
        "Total",
        moneyFull(primaryTargetTotal),
        moneyFull(primaryActualTotal),
        fyAchiCsvText(primaryActualTotal, primaryTargetTotal),
        fyVsLyCsvText(primaryActualTotal, primaryActualTotalLY),
        moneyFull(secondaryTargetTotal),
        moneyFull(secondaryActualTotal),
        fyAchiCsvText(secondaryActualTotal, secondaryTargetTotal),
        fyVsLyCsvText(secondaryActualTotal, secondaryActualTotalLY),
    ];
    lines.push(buildCsvLine(totalCells));

    downloadCsv(lines, `dashboard-overview-${fyKey}.csv`);
}

async function renderDashboardFyOverviewTable(fyKey) {
    const body = document.getElementById("dashboardFyOverviewBody");
    const data = DASHBOARD_FY_OVERVIEW_DATA[fyKey];
    if (!body || !data) {
        return;
    }
    dashboardFyOverviewCurrentKey = fyKey;
    // "Financial Year" field (.dashboard-fy-overview-field, not the Year Filter one) — reflects
    // whichever FY is currently selected, e.g. "Apr-25 to Mar-26", instead of the static
    // "April to March" placeholder text index.html ships with.
    const rangeLabel = document.getElementById("dashboardFyOverviewRangeLabel");
    if (rangeLabel) {
        rangeLabel.textContent = `${data.months[0].month} to ${data.months[data.months.length - 1].month}`;
    }

    const fyStartYear = 2000 + Number(fyKey.split("-")[0].slice(-2));
    const requestId = ++dashboardFyOverviewRequestSeq;
    // Both Primary Sales' and Secondary Sales' own "Vs Last Year" compare real Actual Sales this
    // month vs the same calendar month last year (real sales data, not Target) — per explicit
    // request, now that both Actual columns are real. Vs Last Year / Vs Target for both groups are
    // no longer placeholder anywhere in this table.
    const isCurrentFy = fyKey === DASHBOARD_FY_CURRENT_KEY;
    const [primaryTargets, secondaryTargets, primaryTargetsLY, secondaryTargetsLY, primaryActuals, secondaryActuals, primaryActualsLY, secondaryActualsLY, primaryProjectionTotalRaw] = await Promise.all([
        fetchDashboardFyOverviewMetric("primary-target", fyStartYear, requestId),
        fetchDashboardFyOverviewMetric("secondary-target", fyStartYear, requestId),
        fetchDashboardFyOverviewMetric("primary-target", fyStartYear - 1, requestId),
        fetchDashboardFyOverviewMetric("secondary-target", fyStartYear - 1, requestId),
        fetchDashboardFyOverviewMetric("primary-actual", fyStartYear, requestId),
        fetchDashboardFyOverviewMetric("secondary-actual", fyStartYear, requestId),
        fetchDashboardFyOverviewMetric("primary-actual", fyStartYear - 1, requestId),
        fetchDashboardFyOverviewMetric("secondary-actual", fyStartYear - 1, requestId),
        // Only meaningful for the real current FY's own "current" row below — Primary_Sales_Projection
        // only ever holds the real current month's own data anyway, so skip the fetch entirely for any
        // other FY selection.
        isCurrentFy ? fetchDashboardPrimaryProjectionTotal(requestId) : Promise.resolve(null),
    ]);
    if (requestId !== dashboardFyOverviewRequestSeq) {
        return; // a newer FY selection has since started its own fetch — don't overwrite its render
    }
    const primaryProjectionTotal = primaryProjectionTotalRaw != null ? Number(primaryProjectionTotalRaw) : 0;

    let primaryTargetTotal = 0;
    let secondaryTargetTotal = 0;
    let primaryActualTotal = 0;
    let secondaryActualTotal = 0;
    let primaryActualTotalLY = 0;
    let secondaryActualTotalLY = 0;
    // Apr (FY start) through the LAST COMPLETE month (i.e. stops one short of the current month, see
    // the `type === "actual"` guard below) — snapshotted the moment the "current" row is reached, so
    // the "See Total" button can show a real Year-to-Date subtotal without a second fetch. Per explicit
    // request, this always excludes the current (still in-progress) month itself, even though that
    // month already has a real (partial) Actual figure of its own — YTD is specifically "what's fully
    // landed so far", a different question from "how's this month trending". Stays null for every FY
    // except whichever one is the real current FY (the only one with a "current" row at all — see
    // buildDashboardFyMonths), which is exactly when this feature makes sense.
    let ytdPrimaryTarget = 0;
    let ytdSecondaryTarget = 0;
    let ytdPrimaryActual = 0;
    let ytdSecondaryActual = 0;
    let ytdPrimaryActualLY = 0;
    let ytdSecondaryActualLY = 0;
    let ytdRowHtml = "";
    // The "See Total" button now lives on the PREVIOUS (last complete) month's own row — per explicit
    // request — not the current month's row: clicking it reveals/hides #dashboardFyOverviewYtdRow,
    // inserted directly after that same row (i.e. directly above the current-month row). -1 (no
    // button/row at all) for any FY without a "current" row (a past FY, see buildDashboardFyMonths) or
    // where the current month IS the FY's first (April — there's no completed month yet to report).
    const currentMonthIdx = data.months.findIndex((m) => m.type === "current");
    const lastCompleteMonthIdx = currentMonthIdx > 0 ? currentMonthIdx - 1 : -1;
    const monthRows = data.months.map(({ month, type }, monthIdx) => {
        const monthKey = dashboardFyMonthLabelToKey(month);
        const lastYearKey = dashboardFyMonthKeyLastYear(monthKey);
        const realPrimaryTarget = primaryTargets && primaryTargets[monthKey] != null ? Number(primaryTargets[monthKey]) : 0;
        const realSecondaryTarget = secondaryTargets && secondaryTargets[monthKey] != null ? Number(secondaryTargets[monthKey]) : 0;
        const realPrimaryActual = primaryActuals && primaryActuals[monthKey] != null ? Number(primaryActuals[monthKey]) : 0;
        const realSecondaryActual = secondaryActuals && secondaryActuals[monthKey] != null ? Number(secondaryActuals[monthKey]) : 0;
        const realPrimaryActualLY = primaryActualsLY && primaryActualsLY[lastYearKey] != null ? Number(primaryActualsLY[lastYearKey]) : 0;
        const realSecondaryActualLY = secondaryActualsLY && secondaryActualsLY[lastYearKey] != null ? Number(secondaryActualsLY[lastYearKey]) : 0;
        // Months after the current one (type "projection") have no real Actual yet — per explicit
        // request, they display the same value as that month's own Target instead of "—" (an
        // "on-plan" stand-in for a sale that hasn't happened). Per later explicit requests: the bottom
        // Total row sums this same complete-FY figure (real actual for elapsed months + target
        // stand-in for the rest) rather than only actual-to-date, and each projection month's own Vs
        // Last Year now compares THIS display figure too (not "—") — so eyeballing the Actual/Vs LY
        // columns and the Total row underneath them all agree. The YTD subtotal ("See Total") stays
        // real-only on purpose: it's specifically an actual-attained-so-far figure, a different
        // question from "what does the complete year look like".
        //
        // The CURRENT month is a third case: real Primary_Sales rows for it may not exist yet (nobody's
        // uploaded this month's actual sales), in which case realPrimaryActual is a real 0 (seededMonths'
        // own zero-fill), not a genuine "sales were zero". Per explicit request, that's when the real
        // submitted Primary_Sales_Projection total for this month stands in instead — a forward-looking
        // estimate rather than a bare 0 — flagged via isPrimaryProjected so the cell can be styled
        // differently on screen (distinguishing a real Actual from this estimate). The moment real
        // Primary_Sales rows DO show up for the current month (realPrimaryActual > 0), this falls right
        // back to displaying that real figure instead, same as any other month.
        const isPrimaryProjected = type === "current" && realPrimaryActual <= 0;
        const displayPrimaryActual = type === "projection" ? realPrimaryTarget
            : isPrimaryProjected ? primaryProjectionTotal
            : realPrimaryActual;
        const displaySecondaryActual = type === "projection" ? realSecondaryTarget : realSecondaryActual;
        primaryTargetTotal += realPrimaryTarget;
        secondaryTargetTotal += realSecondaryTarget;
        primaryActualTotal += displayPrimaryActual;
        secondaryActualTotal += displaySecondaryActual;
        primaryActualTotalLY += realPrimaryActualLY;
        secondaryActualTotalLY += realSecondaryActualLY;
        if (type === "actual") {
            ytdPrimaryTarget += realPrimaryTarget;
            ytdSecondaryTarget += realSecondaryTarget;
            ytdPrimaryActual += realPrimaryActual;
            ytdSecondaryActual += realSecondaryActual;
            ytdPrimaryActualLY += realPrimaryActualLY;
            ytdSecondaryActualLY += realSecondaryActualLY;
        }
        // "See Total" — only the previous/last-complete month's own row gets this (per explicit
        // request; moved off the current month's row). By this point in the walk every "actual" month
        // up to and including this one has already been folded into the ytd* accumulators above (this
        // IS the last one, so they're already final) — clicking it reveals #dashboardFyOverviewYtdRow,
        // a hidden row built right here and inserted directly after this same row (i.e. directly above
        // the current-month row) — see initDashboardFySeeTotal's delegated click handler for the
        // show/hide toggle itself.
        const monthCell = monthIdx === lastCompleteMonthIdx
            ? `<span class="dashboard-fy-overview-month-cell">
                   <span class="dashboard-fy-overview-month-text">${month}</span>
                   <button type="button" class="dashboard-fy-see-total-btn" aria-expanded="false">See Total</button>
               </span>`
            : month;
        if (monthIdx === lastCompleteMonthIdx) {
            ytdRowHtml = `
                <tr class="dashboard-fy-row--ytd" id="dashboardFyOverviewYtdRow" hidden>
                    <td class="dashboard-fy-overview-month-col">${data.months[0].month} – ${month} (YTD)</td>
                    ${fyMoneyCell(ytdPrimaryTarget, false, "dashboard-fy-overview-group-primary")}
                    ${fyMoneyCell(ytdPrimaryActual, false, "dashboard-fy-overview-group-primary")}
                    <td class="dashboard-fy-overview-group-primary">${renderAchiCell(ytdPrimaryActual, ytdPrimaryTarget)}</td>
                    <td class="dashboard-fy-overview-group-primary">${renderYoyVariance(ytdPrimaryActual, ytdPrimaryActualLY)}</td>
                    ${fyMoneyCell(ytdSecondaryTarget, false, "dashboard-fy-overview-group-secondary")}
                    ${fyMoneyCell(ytdSecondaryActual, false, "dashboard-fy-overview-group-secondary")}
                    <td class="dashboard-fy-overview-group-secondary">${renderAchiCell(ytdSecondaryActual, ytdSecondaryTarget)}</td>
                    <td class="dashboard-fy-overview-group-secondary">${renderYoyVariance(ytdSecondaryActual, ytdSecondaryActualLY)}</td>
                </tr>`;
        }
        // isPrimaryProjected marks the Primary Actual/Achi/Vs LY cells with .dashboard-fy-cell--projected
        // (distinct color, see Dashboard.css) so this row visibly reads as "estimated" rather than a
        // confirmed Actual, per explicit request — same displayPrimaryActual value feeds all three, so
        // they either all carry the flag together or none do.
        //
        // Per explicit request: for the CURRENT month specifically, Achi% and Vs Last Year no longer
        // touch the Primary_Sales_Projection stand-in at all — ONLY the raw Actual money cell shows it
        // (still styled via primaryActualCellClass). Achi/Vs Last Year for the current month always
        // compare the real Primary_Sales-to-date figure (realPrimaryActual, genuinely 0 until real rows
        // land) against Target/Last Year instead, so there's no more "estimate vs Target"/"estimate vs
        // Last Year" reading. Every OTHER month type is untouched: "projection" (future) months still
        // use their own Target as an Achi/Vs-LY stand-in, same long-standing convention as before.
        const primaryActualCellClass = `dashboard-fy-overview-group-primary${isPrimaryProjected ? " dashboard-fy-cell--projected" : ""}`;
        const primaryAchiVsLyInput = type === "current" ? realPrimaryActual : displayPrimaryActual;
        return `
            <tr class="dashboard-fy-row--${type}">
                <td class="dashboard-fy-overview-month-col">${monthCell}</td>
                ${fyMoneyCell(realPrimaryTarget, true, "dashboard-fy-overview-group-primary")}
                ${fyMoneyCell(displayPrimaryActual, true, primaryActualCellClass)}
                <td class="dashboard-fy-overview-group-primary">${renderAchiCell(primaryAchiVsLyInput, realPrimaryTarget)}</td>
                <td class="dashboard-fy-overview-group-primary">${renderYoyVariance(primaryAchiVsLyInput, realPrimaryActualLY)}</td>
                ${fyMoneyCell(realSecondaryTarget, true, "dashboard-fy-overview-group-secondary")}
                ${fyMoneyCell(displaySecondaryActual, true, "dashboard-fy-overview-group-secondary")}
                <td class="dashboard-fy-overview-group-secondary">${renderAchiCell(displaySecondaryActual, realSecondaryTarget)}</td>
                <td class="dashboard-fy-overview-group-secondary">${renderYoyVariance(displaySecondaryActual, realSecondaryActualLY)}</td>
            </tr>${monthIdx === lastCompleteMonthIdx ? ytdRowHtml : ""}`;
    }).join("");
    const totalRow = `
        <tr class="dashboard-fy-row--total">
            <td class="dashboard-fy-overview-month-col">Total</td>
            ${fyMoneyCell(primaryTargetTotal, false, "dashboard-fy-overview-group-primary")}
            ${fyMoneyCell(primaryActualTotal, false, "dashboard-fy-overview-group-primary")}
            <td class="dashboard-fy-overview-group-primary">${renderAchiCell(primaryActualTotal, primaryTargetTotal)}</td>
            <td class="dashboard-fy-overview-group-primary">${renderYoyVariance(primaryActualTotal, primaryActualTotalLY)}</td>
            ${fyMoneyCell(secondaryTargetTotal, false, "dashboard-fy-overview-group-secondary")}
            ${fyMoneyCell(secondaryActualTotal, false, "dashboard-fy-overview-group-secondary")}
            <td class="dashboard-fy-overview-group-secondary">${renderAchiCell(secondaryActualTotal, secondaryTargetTotal)}</td>
            <td class="dashboard-fy-overview-group-secondary">${renderYoyVariance(secondaryActualTotal, secondaryActualTotalLY)}</td>
        </tr>`;
    body.innerHTML = monthRows + totalRow;
}

(function initDashboardFyYearFilterSection() {
    const menu = document.getElementById("dashboardFyYearFilterMenu");
    const label = document.getElementById("dashboardFyYearFilterLabel");
    if (!menu || !label) {
        return;
    }

    // Menu items + the button's own default label are built from DASHBOARD_FY_KEYS (computed from
    // today's real date above) rather than hardcoded in index.html, so the dropdown always starts on
    // the real current FY and this rolling window shifts forward on its own once a year — no
    // hardcoded HTML markup to go stale. The open/close/select/outside-click/Escape mechanics
    // themselves are components/FyYearFilter/FyYearFilter.js's initFyYearFilter, wired below.
    menu.innerHTML = DASHBOARD_FY_KEYS
        .map((key, i) => `<button type="button" class="dashboard-fy-year-filter-item${i === 0 ? " active" : ""}" data-fy="${key}">${DASHBOARD_FY_OVERVIEW_DATA[key].label}</button>`)
        .join("");
    label.textContent = DASHBOARD_FY_OVERVIEW_DATA[DASHBOARD_FY_CURRENT_KEY].label;
    renderDashboardFyOverviewTable(DASHBOARD_FY_CURRENT_KEY);
    updateDashboardPartnerYtdLabel(DASHBOARD_FY_CURRENT_KEY);
    updateDashboardPartnerCurrentMonthLabel();
    updateDashboardPartnerProjectionInfoTooltip();

    // Download button + popup — asks which FY to export (own <select>, independent of whichever FY
    // the Year Filter above currently has the table showing) before calling
    // downloadDashboardFyOverviewCsv. Same funnel-button-opens-a-panel interaction as the Year Filter
    // itself, just reusing the app's existing .product-snapshot-download-* popup classes.
    const downloadBtn = document.getElementById("dashboardFyOverviewDownloadBtn");
    const downloadPopup = document.getElementById("dashboardFyOverviewDownloadPopup");
    const downloadSelect = document.getElementById("dashboardFyOverviewDownloadYearSelect");
    const downloadConfirmBtn = document.getElementById("dashboardFyOverviewDownloadConfirmBtn");
    if (downloadSelect) {
        downloadSelect.innerHTML = DASHBOARD_FY_KEYS
            .map((key) => `<option value="${key}">${DASHBOARD_FY_OVERVIEW_DATA[key].label}</option>`)
            .join("");
    }

    const downloadPopupHandle = initDownloadPopup({ triggerBtn: downloadBtn, popupEl: downloadPopup });

    downloadConfirmBtn?.addEventListener("click", () => {
        downloadDashboardFyOverviewCsv(downloadSelect ? downloadSelect.value : DASHBOARD_FY_CURRENT_KEY);
        downloadPopupHandle.close();
    });

    initFyYearFilter({
        idPrefix: "dashboardFyYearFilter",
        onSelect: (fyKey) => {
            renderDashboardFyOverviewTable(fyKey);
            // Keeps "2. Daily Sales Trends" showing the same FY "1. Overview" just switched to (see
            // dailyTrendGraph's own header comment) — rangeType "month" matches the granularity
            // setDateRange's own "filter closed" branch already uses for a whole-FY view.
            const fyRange = dashboardFyKeyToMonthRange(fyKey);
            dailyTrendGraph?.setDateRange(fyRange.from, fyRange.to, { rangeType: "month" });
            // Keeps "3. Partner Wise Target Vs Achievement"'s own "YTD ..." group header AND its real
            // Target/Achi/Vs LY figures in sync too (dashboardFyOverviewCurrentKey is already updated
            // by renderDashboardFyOverviewTable above by the time loadDashboardPartners reads it) — see
            // updateDashboardPartnerYtdLabel's and loadDashboardPartners' own header comments.
            updateDashboardPartnerYtdLabel(fyKey);
            loadDashboardPartners();
        },
    });
})();

// Single source of truth for changing any one of the Sales Type/Brand/Channel/Status filters — used
// by the filter row's own pill buttons (each wired via the shared BrandFilter/ChannelFilter/
// SalesTypeFilter/StatusFilter components' own onChange callback, see initDashboardFyOverviewFilter
// below). Also the single place that pushes this same selection into "2. Daily Sales Trends" (see
// dailyTrendGraph.setFilters' own header comment) and "3. Partner Wise Target Vs Achievement" (see
// loadDashboardPartners' own header comment) so every section stays in lockstep no matter which of
// the four pills actually changed. Status's own active-class toggling is handled internally by
// initStatusFilter itself (its buttons carry .site-status-filter-item, not .brand-header-item, so the
// generic querySelectorAll below is a harmless no-op for it) — left in place unconditionally since it
// costs nothing to run for a type it doesn't match.
function setDashboardFyOverviewFilter(type, value) {
    if (type === "salesType") {
        dashboardFyOverviewSalesType = value;
        const tableWrap = document.getElementById("dashboardFyOverviewTableWrap");
        tableWrap?.classList.toggle("dashboard-fy-hide-secondary", value === "primary");
        tableWrap?.classList.toggle("dashboard-fy-hide-primary", value === "secondary");
    } else if (type === "brand") {
        dashboardFyOverviewBrand = value;
    } else if (type === "channel") {
        dashboardFyOverviewChannel = value;
    } else if (type === "status") {
        dashboardFyOverviewStatus = value;
    }
    const toggle = document.getElementById(`dashboardFyOverview${type[0].toUpperCase()}${type.slice(1)}Toggle`);
    toggle?.querySelectorAll(".brand-header-item").forEach((b) => {
        b.classList.toggle("active", b.dataset[type] === value);
    });
    dailyTrendGraph?.setFilters({ salesType: dashboardFyOverviewSalesType, brand: dashboardFyOverviewBrand, channel: dashboardFyOverviewChannel, status: dashboardFyOverviewStatus });
    renderDashboardFyOverviewTable(dashboardFyOverviewCurrentKey);
    loadDashboardPartners();
}

// Sales Type / Brand / Channel filter row — populates all three pills' options from real
// Site_Master values (Sales_Type/Brand/Channel columns respectively; reusing loadBrandPillOptions/
// brandNameToCode/salesTypeToCode, the same helpers the Daily Sales Trends section's own Brand pill
// uses further down this file — function declarations are hoisted, so calling them here before their
// own textual definition is safe) and wires all three groups to re-fetch + re-render whichever FY is
// currently on screen (dashboardFyOverviewCurrentKey, kept in sync by renderDashboardFyOverviewTable
// itself). Sales Type additionally toggles which column-group stays visible via a class on the table
// wrap — see the .dashboard-fy-hide-primary/-secondary rules in Dashboard.css.
// Status pill options — local twin of loadBrandPillOptions/renderBrandPill (PrimarySalesPage.js's own
// loadStatusPillOptions/renderStatusPill convention), fetched from GET /api/dashboard/statuses instead
// of the pill's All/Active/Inactive/Upcoming buttons being hardcoded straight into index.html.
async function loadStatusPillOptions() {
    try {
        const res = await fetch("/api/dashboard/statuses");
        if (!res.ok) {
            return [];
        }
        const statuses = await res.json();
        return Array.isArray(statuses) ? statuses : [];
    } catch {
        return [];
    }
}

// Renders into #dashboardFyOverviewStatusToggle itself (that id IS the .site-status-filter-pill
// container) — data-status is lowercased (matching OperationalStatusFilter's case-insensitive
// vocabulary) so initStatusFilter's own querySelectorAll(".site-status-filter-item") below finds real
// buttons once this replaces the "Loading…" placeholder. An empty `statuses` (Site_Master has no
// usable data right now, or the DB isn't connected — see DashboardOverviewService.getAvailableStatuses)
// shows the same "Not Available" state Brand/Channel/Sales Type already fall back to below.
function renderStatusPill(toggle, statuses) {
    if (!statuses.length) {
        toggle.innerHTML = `<span class="site-status-filter-item brand-header-empty">Not Available</span>`;
        return;
    }
    const options = [{ value: "all", label: "All" }, ...statuses.map((s) => ({ value: s.toLowerCase(), label: s }))];
    toggle.innerHTML = options
        .map((opt, i) => `<button type="button" class="site-status-filter-item${i === 0 ? " active" : ""}" data-status="${opt.value}">${opt.label}</button>`)
        .join("");
}

(async function initDashboardFyOverviewFilter() {
    const salesTypeToggle = document.getElementById("dashboardFyOverviewSalesTypeToggle");
    const brandToggle = document.getElementById("dashboardFyOverviewBrandToggle");
    const channelToggle = document.getElementById("dashboardFyOverviewChannelToggle");
    const statusToggle = document.getElementById("dashboardFyOverviewStatusToggle");
    const tableWrap = document.getElementById("dashboardFyOverviewTableWrap");
    if (!salesTypeToggle || !brandToggle || !channelToggle || !statusToggle || !tableWrap) {
        return;
    }

    const [salesTypes, brands, channels, statuses] = await Promise.all([
        fetch("/api/dashboard/sales-types").then((res) => (res.ok ? res.json() : [])).catch(() => []),
        loadBrandPillOptions(),
        fetch("/api/dashboard/channels").then((res) => (res.ok ? res.json() : [])).catch(() => []),
        loadStatusPillOptions(),
    ]);

    // All four pills' real options come from Site_Master (Sales_Type/Brand/Channel/Operational_Status
    // columns) — an empty list here means Site_Master has no usable data for that column right now (not
    // connected/not imported yet), so show the same "Not Available" state renderBrandPill already
    // uses for Daily Sales Trends' own brand pill, instead of silently leaving just a lone "All"
    // button with no explanation that real options failed to load.
    if (Array.isArray(salesTypes) && salesTypes.length) {
        salesTypeToggle.innerHTML = [{ value: "all", label: "All" }, ...salesTypes.map((t) => ({ value: salesTypeToCode(t), label: t }))]
            .map((opt, i) => `<button type="button" class="brand-header-item${i === 0 ? " active" : ""}" data-sales-type="${opt.value}">${opt.label}</button>`)
            .join("");
    } else {
        salesTypeToggle.innerHTML = `<span class="brand-header-item brand-header-empty">Not Available</span>`;
    }
    if (brands.length) {
        brandToggle.innerHTML = [{ value: "all", label: "All" }, ...brands.map((b) => ({ value: brandNameToCode(b), label: b }))]
            .map((opt, i) => `<button type="button" class="brand-header-item${i === 0 ? " active" : ""}" data-brand="${opt.value}">${opt.label}</button>`)
            .join("");
    } else {
        brandToggle.innerHTML = `<span class="brand-header-item brand-header-empty">Not Available</span>`;
    }
    if (Array.isArray(channels) && channels.length) {
        channelToggle.innerHTML = [{ value: "all", label: "All" }, ...channels.map((c) => ({ value: c, label: c }))]
            .map((opt, i) => `<button type="button" class="brand-header-item${i === 0 ? " active" : ""}" data-channel="${escapeAttr(opt.value)}">${opt.label}</button>`)
            .join("");
    } else {
        channelToggle.innerHTML = `<span class="brand-header-item brand-header-empty">Not Available</span>`;
    }
    renderStatusPill(statusToggle, statuses);

    // All three pills' own click-wiring now goes through the shared components — persist:false for
    // Brand/Channel since this pill's options are re-fetched fresh every load and were never meant to
    // survive a reload (unlike Primary/Secondary Sales' own Brand/Channel pills, which do persist);
    // Sales Type never persisted either. Called AFTER the innerHTML population above (not before,
    // like the old delegated-listener approach could) since each shared init does a one-time
    // querySelectorAll(".brand-header-item") at call time and needs the real buttons already in the
    // DOM.
    initSalesTypeFilter("dashboardFyOverviewSalesTypeToggle", (salesType) => setDashboardFyOverviewFilter("salesType", salesType));
    initBrandHeader({
        headerId: "dashboardFyOverviewBrandToggle",
        storageKey: "dashboard-fy-overview-selected-brand",
        defaultBrand: "all",
        persist: false,
        onBrandChange: (brand) => setDashboardFyOverviewFilter("brand", brand),
    });
    initChannelHeader({
        headerId: "dashboardFyOverviewChannelToggle",
        storageKey: "dashboard-fy-overview-selected-channel",
        defaultChannel: "all",
        persist: false,
        onChannelChange: (channel) => setDashboardFyOverviewFilter("channel", channel),
    });
    // Status pill — real options fetched above (renderStatusPill), same convention Sales Type/Brand/
    // Channel already follow. initStatusFilter's own querySelectorAll(".site-status-filter-item") runs
    // AFTER renderStatusPill has replaced the "Loading…" placeholder with real buttons, same ordering
    // initBrandHeader/initChannelHeader above already rely on.
    initStatusFilter("dashboardFyOverviewStatusToggle", (status) => setDashboardFyOverviewFilter("status", status));
})();

// "See Total" toggle for the previous/last-complete month's own row — delegated on the tbody (not
// bound per-button) since renderDashboardFyOverviewTable rebuilds every <tr>, button included, on
// every FY change/refresh; a direct listener would be destroyed along with the old button each time.
// #dashboardFyOverviewYtdRow is rebuilt fresh (and re-hidden) on every render too, so this toggle's
// own on/off state deliberately doesn't persist across an FY switch — there's nothing to persist, it's
// a new row with new numbers.
(function initDashboardFySeeTotal() {
    const body = document.getElementById("dashboardFyOverviewBody");
    if (!body) {
        return;
    }
    body.addEventListener("click", (event) => {
        const btn = event.target.closest(".dashboard-fy-see-total-btn");
        if (!btn) {
            return;
        }
        const ytdRow = document.getElementById("dashboardFyOverviewYtdRow");
        if (!ytdRow) {
            return;
        }
        const opening = ytdRow.hidden;
        ytdRow.hidden = !opening;
        btn.textContent = opening ? "Hide Total" : "See Total";
        btn.setAttribute("aria-expanded", String(opening));
    });
})();

// ==================== 3. Partner Wise Target Vs Achievement ==================== //
// Partner column is real (GET /api/dashboard/partners — distinct Site_Master.Partner values, scoped by
// the "Filter Header" section's own Sales Type/Brand/Channel/Status pills — see
// setDashboardFyOverviewFilter's own call into loadDashboardPartners below). The "YTD ..." group's own
// Target/Achi/Vs LY are now ALSO real — GET /api/dashboard/partner-overview/{target,actual},
// scoped by those same four Filter Header pills AND whichever FY the Year Filter currently has selected
// (see loadDashboardPartners' own header comment for the exact window) — per explicit request, shown
// "correct as in 1. Overview": same fyMoneyCell Cr/L-abbreviated money cells + the same
// renderAchiCell/renderYoyVariance progress-bar/variance chips "1. Overview" itself uses (per a later
// explicit request replacing this table's old plain VS Target/Vs LY delta chips), and the same simple
// direct-table-sum convention (no Site_Master combo-matching). The old "VS Target" column is gone —
// Achi. (a renderAchiCell progress bar, inserted right after Sales/Projection/Forecast) already
// carries that same target-comparison, just styled like "1. Overview"'s own Achi. column instead of
// as a bare delta chip. The "Current Month ..." group is now ALSO real (renamed from "Will Do" to
// "Projection" alongside this) — real per-Partner Target/Actual for the real current calendar month
// (GET /api/dashboard/partner-overview/{target,actual} again, this time with from=to=that one month),
// plus GET /api/dashboard/partner-overview/projection for the real Primary_Sales_Projection stand-in
// a partner's own Projection cell substitutes in once its real Primary Sales actual is 0 so far this
// month — same "1. Overview" current-month convention (see loadDashboardPartners' and
// renderDashboardPartnerRow's own header comments for the exact rule). Full Year Projection's own
// Target/Forecast/Vs LY went real across a run of later explicit requests too (Target: real Target
// summed across the whole FY; Forecast: Apr-Aug Actual + Sep Projection/Actual + Oct-Mar Target; Vs
// LY: real Actual summed across the WHOLE prior FY) — every figure on this entire table is now real,
// no frontend-mock data left anywhere in it.

// "YTD ..." group header — dynamic per whichever FY the "Filter Header" section's own Year Filter has
// selected (called from initDashboardFyYearFilterSection on load and from initFyYearFilter's own
// onSelect on every change, same trigger "1. Overview" itself reacts to). Reuses DASHBOARD_FY_OVERVIEW_
// DATA's own months array (already built once at module load, see buildDashboardFyMonths above) rather
// than recomputing anything — every month up to (but never including) the real current calendar month
// carries type "actual" there; the current month itself is "current" and every month after it is
// "projection", so filtering to type === "actual" always yields exactly "FY start .. last COMPLETE
// month" — deliberately stopping one short of the current month, which the "Current Month" group to
// its right already covers on its own. For any FY other than the real current one, EVERY month is
// "actual" (buildDashboardFyMonths only marks a "current"/"projection" split for the live FY), so this
// naturally spans the whole elapsed year, e.g. "YTD Apr-25 to Mar-26" for FY 25-26.
function updateDashboardPartnerYtdLabel(fyKey) {
    const header = document.getElementById("dashboardPartnerYtdGroupHeader");
    const data = DASHBOARD_FY_OVERVIEW_DATA[fyKey];
    if (!header || !data) {
        return;
    }
    const completedMonths = data.months.filter((m) => m.type === "actual");
    header.textContent = completedMonths.length
        ? `YTD ${completedMonths[0].month} to ${completedMonths[completedMonths.length - 1].month}`
        : `YTD ${data.months[0].month}`;
}

// "yyyy-MM" for the REAL current calendar month — independent of whichever FY "1. Overview"'s own
// Year Filter has selected (unlike the YTD group above, the "Current Month ..." group always tracks
// today's real month, never a past/future FY's own "current" row).
function dashboardCurrentCalendarMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// "Current Month ..." group header — "Current Month: Sep-2026", per explicit request (previously a
// static "Current Month Sep" in index.html, no year, never updated). FY-independent (see
// dashboardCurrentCalendarMonthKey's own comment), so this only needs setting once on load, unlike
// updateDashboardPartnerYtdLabel above which re-runs on every Year Filter change.
function updateDashboardPartnerCurrentMonthLabel() {
    const header = document.getElementById("dashboardPartnerCurrentGroupHeader");
    if (!header) {
        return;
    }
    const now = new Date();
    const monthAbbr = now.toLocaleString("en-US", { month: "short" });
    header.textContent = `Current Month: ${monthAbbr}-${now.getFullYear()}`;
}

// "Full Year Projection" group's own info-icon tooltip — per explicit request, the formula text now
// tracks the real current FY's own month spans instead of staying hardcoded to whichever month it was
// written in (previously a static "Apr-Aug Actual + Current Month Projection + Oct-Mar Target", which
// silently went stale the moment the calendar moved past September). Reuses
// DASHBOARD_FY_OVERVIEW_DATA[DASHBOARD_FY_CURRENT_KEY]'s own months array (buildDashboardFyMonths) —
// the same "actual"/"current"/"projection" type split "1. Overview" itself walks — so the three spans
// here always agree with what's on screen elsewhere: every month up to the last COMPLETE one is
// "Actual", the real current month is "Projection/Actual Sales" (matching the Current Month group's
// own current.display convention — real Actual once it lands, the real Primary_Sales_Projection
// stand-in until then), and every month after it is "Target". FY-independent same as
// updateDashboardPartnerCurrentMonthLabel above, so this only needs setting once on load.
function updateDashboardPartnerProjectionInfoTooltip() {
    const icon = document.getElementById("dashboardPartnerProjectionInfoIcon");
    const data = DASHBOARD_FY_OVERVIEW_DATA[DASHBOARD_FY_CURRENT_KEY];
    if (!icon || !data) {
        return;
    }
    const monthRangeLabel = (months) => (months.length > 1 ? `${months[0].month} to ${months[months.length - 1].month}` : months[0].month);
    const completedMonths = data.months.filter((m) => m.type === "actual");
    const currentMonth = data.months.find((m) => m.type === "current");
    const remainingMonths = data.months.filter((m) => m.type === "projection");
    const parts = [];
    if (completedMonths.length) {
        parts.push(`${monthRangeLabel(completedMonths)} Actual`);
    }
    if (currentMonth) {
        parts.push(`${currentMonth.month} Projection/Actual Sales`);
    }
    if (remainingMonths.length) {
        parts.push(`${monthRangeLabel(remainingMonths)} Target`);
    }
    icon.title = `Full Year Projection Forecast = ${parts.join(" + ")}`;
}

// ytd.target/ytd.achi/ytd.achiLY and current.target/current.display/current.actualLY are all real
// money amounts (rupees, not Cr/L-scaled) — rendered via fyMoneyCell, the exact same
// Cr/L-abbreviated-with-full-tooltip cell "1. Overview" itself uses, per explicit request ("show the
// values correct as like we have in the 1. Overview section" / the later, identical ask for Current
// Month). Achi./Vs LY reuse "1. Overview"'s own renderAchiCell/renderYoyVariance (progress bar +
// %/variance chip, muted last-year figure) instead of the old plain VS Target/Vs LY delta chips.
// current.display — real Actual if a partner's real Primary Sales actual has landed this month,
// otherwise the real Primary_Sales_Projection stand-in (current.isProjected) — feeds the money cell,
// Achi. AND Vs LY (per explicit request: "achi calculation if projection exist or actual sales
// exist"); current.actualLY (the "previous" side) is ALWAYS the real actual for the same calendar
// month last year, never a projection — Primary_Sales_Projection only ever holds the CURRENT month's
// own data anyway (see TopProjectionService's own header comment), so there is no "last year
// projection" to accidentally show, satisfying the later explicit request ("show the actual sale of
// the last year not the projection value") without needing current.actual instead of current.display
// here. Using current.actual instead was tried and reverted — renderYoyVariance's own null-safe
// guard treats a 0 current as "no data at all" and renders a bare "—", which was hiding a partner's
// real, on-screen last-year figure any time this month's real actual hadn't landed yet, even though a
// real submitted Projection (current.display) was available and should have unblocked it (per
// explicit follow-up: "we have data of the last year sale then why u not show us"). Vs LY shares the
// same .dashboard-fy-cell--projected italic/info-color styling (currentDisplayClass) as the money
// cell/Achi. when isProjected, so it's visually clear the comparison itself is projection-based.
// fullYear.target/forecast/actualLY are now ALL real, per a run of explicit requests — Target: real
// Primary_Sales_Target + Secondary_Sales_Target summed across the WHOLE real current FY (Apr..Mar);
// Forecast: renderDashboardPartnerTable's own real "Apr-Aug Actual (ytd.achi) + Sep Projection/Actual
// (current.display) + Oct-Mar Target (remainingTargetMap)" sum — the exact formula the group's own
// info-icon tooltip already describes; actualLY: real Actual Sales summed across the WHOLE prior FY
// (FY 25-26, Apr-25..Mar-26 — loadDashboardPartners' own lastFyActualMap fetch), per explicit request
// ("show use last year fy 25 to 26 of sales"). Every group on this table is now fully real except
// nothing — Full Year Projection was the last one still carrying a mock figure (Vs LY's own pct).
function renderDashboardPartnerRow(partner, metrics) {
    const { ytd, current, fullYear } = metrics;
    const currentDisplayClass = `dashboard-partner-group-current${current.isProjected ? " dashboard-fy-cell--projected" : ""}`;
    return `
        <tr>
            <td class="dashboard-partner-name-col">${escapeAttr(partner)}</td>
            ${fyMoneyCell(ytd.target, true, "dashboard-partner-group-ytd")}
            ${fyMoneyCell(ytd.achi, true, "dashboard-partner-group-ytd")}
            <td class="dashboard-partner-group-ytd">${renderAchiCell(ytd.achi, ytd.target)}</td>
            <td class="dashboard-partner-group-ytd">${renderYoyVariance(ytd.achi, ytd.achiLY)}</td>
            ${fyMoneyCell(current.target, true, "dashboard-partner-group-current")}
            ${fyMoneyCell(current.display, true, currentDisplayClass)}
            <td class="${currentDisplayClass}">${renderAchiCell(current.display, current.target)}</td>
            <td class="${currentDisplayClass}">${renderYoyVariance(current.display, current.actualLY)}</td>
            ${fyMoneyCell(fullYear.target, true, "dashboard-partner-group-projection")}
            ${fyMoneyCell(fullYear.forecast, true, "dashboard-partner-group-projection")}
            <td class="dashboard-partner-group-projection">${renderAchiCell(fullYear.forecast, fullYear.target)}</td>
            <td class="dashboard-partner-group-projection">${renderYoyVariance(fullYear.forecast, fullYear.actualLY)}</td>
        </tr>`;
}

// Latest rendered rows/totals for "3. Partner Wise Target Vs Achievement" — populated by
// renderDashboardPartnerTable below on every real render, read by downloadDashboardPartnerCsv (its
// own header-button handler) so a download always exports exactly what's on screen right now,
// without a second round of fetches or its own separate "which filter" popup — this table has no
// filter knobs of its own, everything comes from the "Filter Header" section above it.
let dashboardPartnerLatestRows = [];
let dashboardPartnerLatestTotals = null;

// ytdTargetMap/ytdActualMap/ytdActualLYMap are Partner-name-keyed real-money maps (see
// loadDashboardPartners below) — a Partner absent from a map (no Target/Sales rows for this window)
// is treated as 0, same convention every other real-data map on this page already follows. The
// current* maps are the same shape for the real current calendar month instead of the YTD window —
// currentPrimaryActualMap/currentProjectionMap only exist to compute each partner's own
// current.isProjected flag (see renderDashboardPartnerRow's own header comment); includesPrimaryProjection
// is loadDashboardPartners' own precomputed "does the current Sales Type filter even allow a Primary
// Sales Projection stand-in" check, same for every partner so it's computed once, not per-row.
// fullYearTargetMap is the same real-money-map shape too, just summed across the WHOLE real current FY
// (Apr..Mar) instead of a YTD/one-month window — backs Full Year Projection's own real Target column.
// remainingTargetMap is the same shape again, summed across the FY's own remaining months (the month
// after the real current one through Mar) — the "Oct-Mar Target" leg of Forecast's own real sum below.
// lastFyActualMap is the same shape once more, summed across the WHOLE prior FY (FY 25-26,
// Apr-25..Mar-26 when the real current FY is 26-27) — backs Full Year Projection's own real Vs LY.
function renderDashboardPartnerTable(partners, ytdTargetMap, ytdActualMap, ytdActualLYMap,
                                      currentTargetMap, currentActualMap, currentActualLYMap,
                                      currentPrimaryActualMap, currentProjectionMap, includesPrimaryProjection,
                                      fullYearTargetMap, remainingTargetMap, lastFyActualMap) {
    const body = document.getElementById("dashboardPartnerBody");
    if (!body) {
        return;
    }
    // Captured here (not re-fetched) so the header's own download button always exports exactly
    // what's on screen — every real per-partner ytd/current/fullYear figure this render pass computes,
    // reset on every call so a stale prior filter's rows can never leak into a later download.
    dashboardPartnerLatestRows = [];
    dashboardPartnerLatestTotals = null;
    if (!partners.length) {
        body.innerHTML = `<tr><td colspan="13" class="dashboard-fy-row--loading">Not Available</td></tr>`;
        return;
    }

    const totals = {
        ytd: { target: 0, achi: 0, achiLY: 0 },
        current: { target: 0, display: 0, actualLY: 0 },
        fullYear: { target: 0, forecast: 0, actualLY: 0 },
    };
    let rowsHtml = "";
    partners.forEach((partner) => {
        // Lowercased lookup key — MUST match DashboardOverviewService#collectPartnerTotals' own
        // lowercasing (see its header comment: the same logical Partner is spelled with different
        // casing across tables, e.g. "Nykaa-Offline" in Secondary_Sales_Target vs "Nykaa-offline" in
        // Site_Master/Primary_Sales_Target — an exact-case lookup here was silently reading that
        // partner's Secondary Target as 0, undercounting this table's own Total row against
        // "1. Overview"'s by exactly that partner's real Target amount).
        const partnerKey = partner.toLowerCase();
        const ytd = {
            target: ytdTargetMap[partnerKey] != null ? Number(ytdTargetMap[partnerKey]) : 0,
            achi: ytdActualMap[partnerKey] != null ? Number(ytdActualMap[partnerKey]) : 0,
            achiLY: ytdActualLYMap[partnerKey] != null ? Number(ytdActualLYMap[partnerKey]) : 0,
        };
        const currentTarget = currentTargetMap[partnerKey] != null ? Number(currentTargetMap[partnerKey]) : 0;
        const currentActual = currentActualMap[partnerKey] != null ? Number(currentActualMap[partnerKey]) : 0;
        const currentActualLY = currentActualLYMap[partnerKey] != null ? Number(currentActualLYMap[partnerKey]) : 0;
        const currentPrimaryActual = currentPrimaryActualMap[partnerKey] != null ? Number(currentPrimaryActualMap[partnerKey]) : 0;
        const currentProjectionValue = currentProjectionMap[partnerKey] != null ? Number(currentProjectionMap[partnerKey]) : 0;
        const needsProjection = includesPrimaryProjection && currentPrimaryActual <= 0 && currentProjectionValue > 0;
        const current = {
            target: currentTarget,
            actualLY: currentActualLY,
            display: currentActual + (needsProjection ? currentProjectionValue : 0),
            isProjected: needsProjection,
        };
        const remainingTarget = remainingTargetMap[partnerKey] != null ? Number(remainingTargetMap[partnerKey]) : 0;
        const fullYear = {
            target: fullYearTargetMap[partnerKey] != null ? Number(fullYearTargetMap[partnerKey]) : 0,
            // Real Forecast = Apr-Aug Actual (ytd.achi) + Sep Projection/Actual (current.display) +
            // Oct-Mar Target (remainingTarget) — per explicit request, the exact same formula the
            // group's own info-icon tooltip describes (updateDashboardPartnerProjectionInfoTooltip).
            forecast: ytd.achi + current.display + remainingTarget,
            actualLY: lastFyActualMap[partnerKey] != null ? Number(lastFyActualMap[partnerKey]) : 0,
        };
        totals.ytd.target += ytd.target;
        totals.ytd.achi += ytd.achi;
        totals.ytd.achiLY += ytd.achiLY;
        totals.current.target += current.target;
        totals.current.display += current.display;
        totals.current.actualLY += current.actualLY;
        totals.fullYear.target += fullYear.target;
        totals.fullYear.forecast += fullYear.forecast;
        totals.fullYear.actualLY += fullYear.actualLY;
        dashboardPartnerLatestRows.push({ partner, ytd, current, fullYear });
        rowsHtml += renderDashboardPartnerRow(partner, { ytd, current, fullYear });
    });
    dashboardPartnerLatestTotals = totals;

    const totalRow = `
        <tr class="dashboard-partner-row--total">
            <td class="dashboard-partner-name-col">Total: ${partners.length}</td>
            ${fyMoneyCell(totals.ytd.target, false, "dashboard-partner-group-ytd")}
            ${fyMoneyCell(totals.ytd.achi, false, "dashboard-partner-group-ytd")}
            <td class="dashboard-partner-group-ytd">${renderAchiCell(totals.ytd.achi, totals.ytd.target)}</td>
            <td class="dashboard-partner-group-ytd">${renderYoyVariance(totals.ytd.achi, totals.ytd.achiLY)}</td>
            ${fyMoneyCell(totals.current.target, false, "dashboard-partner-group-current")}
            ${fyMoneyCell(totals.current.display, false, "dashboard-partner-group-current")}
            <td class="dashboard-partner-group-current">${renderAchiCell(totals.current.display, totals.current.target)}</td>
            <td class="dashboard-partner-group-current">${renderYoyVariance(totals.current.display, totals.current.actualLY)}</td>
            ${fyMoneyCell(totals.fullYear.target, false, "dashboard-partner-group-projection")}
            ${fyMoneyCell(totals.fullYear.forecast, false, "dashboard-partner-group-projection")}
            <td class="dashboard-partner-group-projection">${renderAchiCell(totals.fullYear.forecast, totals.fullYear.target)}</td>
            <td class="dashboard-partner-group-projection">${renderYoyVariance(totals.fullYear.forecast, totals.fullYear.actualLY)}</td>
        </tr>`;
    body.innerHTML = rowsHtml + totalRow;
}

let dashboardPartnerRequestSeq = 0;

// Real per-Partner YTD Target/Achi map — GET /api/dashboard/partner-overview/{target,actual} — scoped
// by the same "Filter Header" Sales Type/Brand/Channel/Status pills every other fetch on this page
// respects. `fromKey`/`toKey` are "yyyy-MM" month keys (dashboardFyMonthLabelToKey's own output
// format) — reused for both this-year (Target/Achi) and last-year (Vs LY) calls, see
// loadDashboardPartners below. Returns {} (not a rejected promise) on any failure so the table falls
// back to zeros instead of throwing.
async function fetchDashboardPartnerYtdMap(endpoint, fromKey, toKey, requestId) {
    try {
        const params = new URLSearchParams({
            from: fromKey,
            to: toKey,
            salesType: dashboardFyOverviewSalesType,
            brand: dashboardFyOverviewBrand,
            channel: dashboardFyOverviewChannel,
            status: dashboardFyOverviewStatus,
        });
        const res = await fetch(`/api/dashboard/partner-overview/${endpoint}?${params.toString()}`);
        if (!res.ok || requestId !== dashboardPartnerRequestSeq) {
            return {};
        }
        return await res.json();
    } catch {
        return {};
    }
}

// Real per-Partner PRIMARY-ONLY Actual Sales for one month — always salesType=primary regardless of
// whichever Sales Type the "Filter Header" section currently has selected. Used only to check whether
// a partner's real Primary Sales has landed yet this month (see loadDashboardPartners' own header
// comment on why the Current Month group needs this separately from its own combined currentActualMap
// — mirrors "1. Overview"'s own isPrimaryProjected check, which also only ever looks at Primary's own
// real actual, never a combined Primary+Secondary figure).
async function fetchDashboardPartnerPrimaryActualMap(monthKey, requestId) {
    try {
        const params = new URLSearchParams({
            from: monthKey,
            to: monthKey,
            salesType: "primary",
            brand: dashboardFyOverviewBrand,
            channel: dashboardFyOverviewChannel,
            status: dashboardFyOverviewStatus,
        });
        const res = await fetch(`/api/dashboard/partner-overview/actual?${params.toString()}`);
        if (!res.ok || requestId !== dashboardPartnerRequestSeq) {
            return {};
        }
        return await res.json();
    } catch {
        return {};
    }
}

// Real per-Partner Primary_Sales_Projection total for the current calendar month — GET
// /api/dashboard/partner-overview/projection, scoped by Brand/Channel only (that table has no Sales
// Type/Status column of its own to filter by, see DashboardController's own endpoint comment).
async function fetchDashboardPartnerProjectionMap(requestId) {
    try {
        const params = new URLSearchParams({
            brand: dashboardFyOverviewBrand,
            channel: dashboardFyOverviewChannel,
        });
        const res = await fetch(`/api/dashboard/partner-overview/projection?${params.toString()}`);
        if (!res.ok || requestId !== dashboardPartnerRequestSeq) {
            return {};
        }
        return await res.json();
    } catch {
        return {};
    }
}

// Fetches this section's own Partner list AND its "YTD ..." group's real Target/Achi/Vs-LY-basis
// figures, scoped by whichever Sales Type/Brand/Channel/Status the "Filter Header" section currently
// has selected (dashboardFyOverviewSalesType/Brand/Channel/Status — same shared state "1. Overview"
// and Daily Sales Trends already read from) AND whichever FY the Year Filter currently has selected
// (dashboardFyOverviewCurrentKey, already up to date by the time this runs — see
// initDashboardFyYearFilterSection's onSelect, which sets it via renderDashboardFyOverviewTable before
// calling this). Called once on page load, again every time setDashboardFyOverviewFilter changes any
// of those four, and again on every Year Filter change. The YTD window itself is the exact same
// FY-start..last-COMPLETE-month span updateDashboardPartnerYtdLabel's own header text describes (every
// month of type "actual"), so the numbers on screen always match the label above them; last year's Vs
// LY window is that same span shifted back one calendar year (dashboardFyMonthKeyLastYear on both
// ends).
async function loadDashboardPartners() {
    const requestId = ++dashboardPartnerRequestSeq;
    const params = new URLSearchParams({
        salesType: dashboardFyOverviewSalesType,
        brand: dashboardFyOverviewBrand,
        channel: dashboardFyOverviewChannel,
        status: dashboardFyOverviewStatus,
    });
    let partners = [];
    try {
        const res = await fetch(`/api/dashboard/partners?${params.toString()}`);
        if (res.ok) {
            const data = await res.json();
            partners = Array.isArray(data) ? data : [];
        }
    } catch {
        // fall through with the empty default above
    }

    const fyData = DASHBOARD_FY_OVERVIEW_DATA[dashboardFyOverviewCurrentKey];
    const completedMonths = fyData ? fyData.months.filter((m) => m.type === "actual") : [];
    let ytdTargetMap = {};
    let ytdActualMap = {};
    let ytdActualLYMap = {};
    if (completedMonths.length) {
        const fromKey = dashboardFyMonthLabelToKey(completedMonths[0].month);
        const toKey = dashboardFyMonthLabelToKey(completedMonths[completedMonths.length - 1].month);
        const fromKeyLY = dashboardFyMonthKeyLastYear(fromKey);
        const toKeyLY = dashboardFyMonthKeyLastYear(toKey);
        [ytdTargetMap, ytdActualMap, ytdActualLYMap] = await Promise.all([
            fetchDashboardPartnerYtdMap("target", fromKey, toKey, requestId),
            fetchDashboardPartnerYtdMap("actual", fromKey, toKey, requestId),
            fetchDashboardPartnerYtdMap("actual", fromKeyLY, toKeyLY, requestId),
        ]);
    }

    // "Current Month ..." group — always the REAL current calendar month (dashboardCurrentCalendarMonthKey),
    // independent of whichever FY the Year Filter has selected for "1. Overview"/YTD above.
    // includesPrimaryProjection mirrors "1. Overview"'s own isPrimaryProjected rule
    // (renderDashboardFyOverviewTable): the real Primary_Sales_Projection stand-in only ever applies
    // when Primary Sales is part of whichever Sales Type the "Filter Header" currently has selected —
    // currentPrimaryActualMap exists purely so renderDashboardPartnerTable can check, per partner,
    // whether Primary's own real actual has landed yet this month, independent of currentActualMap's
    // combined (Primary+Secondary, per the current Sales Type filter) figure.
    const currentMonthKey = dashboardCurrentCalendarMonthKey();
    const currentMonthKeyLY = dashboardFyMonthKeyLastYear(currentMonthKey);
    const includesPrimaryProjection = dashboardFyOverviewSalesType === "all" || dashboardFyOverviewSalesType === "primary";

    // "Full Year Projection" group's own Target — real per-Partner Target summed across the WHOLE
    // real current FY (Apr..Mar), per explicit request ("show the correct target acc to full fy
    // year"). Always the real current FY (DASHBOARD_FY_CURRENT_KEY/DASHBOARD_FY_OVERVIEW_DATA), same
    // FY-independent-of-the-Year-Filter convention the Current Month group above already follows —
    // this is "this FY's own forecast", not whichever FY the Year Filter has YTD showing.
    const fyMonths = DASHBOARD_FY_OVERVIEW_DATA[DASHBOARD_FY_CURRENT_KEY].months;
    const fullYearFromKey = dashboardFyMonthLabelToKey(fyMonths[0].month);
    const fullYearToKey = dashboardFyMonthLabelToKey(fyMonths[fyMonths.length - 1].month);

    // Forecast's own "Oct-Mar Target" leg (see renderDashboardPartnerTable's own fullYear.forecast
    // sum) — every month after the real current one through Mar (type "projection", same split
    // buildDashboardFyMonths already computes for "1. Overview"). Empty for the one edge case where
    // the real current month IS the FY's last (Mar) — nothing left to sum, remainingTargetMap stays
    // {} and every lookup into it below simply reads as 0, same convention every other map here uses.
    const remainingMonths = fyMonths.filter((m) => m.type === "projection");
    const remainingTargetMapPromise = remainingMonths.length
        ? fetchDashboardPartnerYtdMap("target", dashboardFyMonthLabelToKey(remainingMonths[0].month), dashboardFyMonthLabelToKey(remainingMonths[remainingMonths.length - 1].month), requestId)
        : Promise.resolve({});

    // Full Year Projection's own Vs LY — real Actual Sales summed across the WHOLE prior FY (FY
    // 25-26, Apr-25..Mar-26 when the real current FY is 26-27), per explicit request ("show use last
    // year fy 25 to 26 of sales"). Same fullYearFromKey/fullYearToKey window shifted back one
    // calendar year on both ends (dashboardFyMonthKeyLastYear), same convention every other Vs LY
    // window on this page already uses.
    const lastFyFromKey = dashboardFyMonthKeyLastYear(fullYearFromKey);
    const lastFyToKey = dashboardFyMonthKeyLastYear(fullYearToKey);

    const [currentTargetMap, currentActualMap, currentActualLYMap, currentPrimaryActualMap, currentProjectionMap, fullYearTargetMap, remainingTargetMap, lastFyActualMap] = await Promise.all([
        fetchDashboardPartnerYtdMap("target", currentMonthKey, currentMonthKey, requestId),
        fetchDashboardPartnerYtdMap("actual", currentMonthKey, currentMonthKey, requestId),
        fetchDashboardPartnerYtdMap("actual", currentMonthKeyLY, currentMonthKeyLY, requestId),
        includesPrimaryProjection ? fetchDashboardPartnerPrimaryActualMap(currentMonthKey, requestId) : Promise.resolve({}),
        includesPrimaryProjection ? fetchDashboardPartnerProjectionMap(requestId) : Promise.resolve({}),
        fetchDashboardPartnerYtdMap("target", fullYearFromKey, fullYearToKey, requestId),
        remainingTargetMapPromise,
        fetchDashboardPartnerYtdMap("actual", lastFyFromKey, lastFyToKey, requestId),
    ]);

    if (requestId !== dashboardPartnerRequestSeq) {
        return; // a newer Filter Header/FY change has since started its own fetch
    }
    renderDashboardPartnerTable(partners, ytdTargetMap, ytdActualMap, ytdActualLYMap,
        currentTargetMap, currentActualMap, currentActualLYMap, currentPrimaryActualMap, currentProjectionMap,
        includesPrimaryProjection, fullYearTargetMap, remainingTargetMap, lastFyActualMap);
}

loadDashboardPartners();

// "3. Partner Wise Target Vs Achievement" header's own download button — per explicit request, a
// plain click-to-download (no "which range" popup like "1. Overview"'s own download button, since
// this table has no filter knobs of its own: every figure already comes from the "Filter Header"
// section's Sales Type/Brand/Channel/Status pills and whichever FY the Year Filter has selected, so
// there's nothing left to ask). Exports dashboardPartnerLatestRows/-Totals — whatever
// renderDashboardPartnerTable most recently rendered — using the same fyAchiCsvText/fyVsLyCsvText
// full-precision-money CSV conventions "1. Overview"'s own downloadDashboardFyOverviewCsv already
// uses, so Achi./Vs LY read the same way in both files.
function downloadDashboardPartnerCsv() {
    const header = ["Partner",
        "YTD Target", "YTD Sales", "YTD Achi %", "YTD Vs LY %",
        "Current Month Target", "Current Month Projection/Actual", "Current Month Achi %", "Current Month Vs LY %",
        "Full Year Target", "Full Year Forecast", "Full Year Achi %", "Full Year Vs LY %"];
    const lines = [header.join(",")];
    dashboardPartnerLatestRows.forEach(({ partner, ytd, current, fullYear }) => {
        lines.push(buildCsvLine([
            partner,
            moneyFull(ytd.target, { nullDash: true }), moneyFull(ytd.achi), fyAchiCsvText(ytd.achi, ytd.target), fyVsLyCsvText(ytd.achi, ytd.achiLY),
            moneyFull(current.target, { nullDash: true }), moneyFull(current.display), fyAchiCsvText(current.display, current.target), fyVsLyCsvText(current.display, current.actualLY),
            moneyFull(fullYear.target, { nullDash: true }), moneyFull(fullYear.forecast), fyAchiCsvText(fullYear.forecast, fullYear.target), fyVsLyCsvText(fullYear.forecast, fullYear.actualLY),
        ]));
    });
    if (dashboardPartnerLatestTotals) {
        const t = dashboardPartnerLatestTotals;
        lines.push(buildCsvLine([
            "Total",
            moneyFull(t.ytd.target), moneyFull(t.ytd.achi), fyAchiCsvText(t.ytd.achi, t.ytd.target), fyVsLyCsvText(t.ytd.achi, t.ytd.achiLY),
            moneyFull(t.current.target), moneyFull(t.current.display), fyAchiCsvText(t.current.display, t.current.target), fyVsLyCsvText(t.current.display, t.current.actualLY),
            moneyFull(t.fullYear.target), moneyFull(t.fullYear.forecast), fyAchiCsvText(t.fullYear.forecast, t.fullYear.target), fyVsLyCsvText(t.fullYear.forecast, t.fullYear.actualLY),
        ]));
    }
    downloadCsv(lines, "dashboard-partner-performance.csv");
}

document.getElementById("dashboardPartnerDownloadBtn")?.addEventListener("click", downloadDashboardPartnerCsv);

function escapeAttr(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function achiPct(sales, target) {
    const t = Number(target ?? 0);
    const s = Number(sales ?? 0);
    return t > 0 ? (s / t) * 100 : null;
}

function renderAchiCell(sales, target) {
    const pct = achiPct(sales, target);
    const barWidth = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
    const pctLabel = pct == null ? "—" : `${pct.toFixed(1)}%`;
    const variance = target ? Number(sales ?? 0) - Number(target ?? 0) : null;
    const varianceLabel = variance == null ? "—" : formatVariance(variance);
    const varianceCls = variance == null ? "" : ` ${trendClass(variance)}`;
    return `
        <span class="dashboard-achi-cell">
            <span class="dashboard-achi-track">
                <span class="dashboard-achi-fill" style="width:${barWidth.toFixed(1)}%"></span>
            </span>
            <span class="dashboard-achi-pct">${pctLabel}</span>
            <span class="dashboard-achi-variance${varianceCls}" title="${escapeAttr(variance == null ? "" : formatMoneyFull(variance))}">/ ${varianceLabel}</span>
        </span>`;
}

function trendClass(value) {
    return Number(value ?? 0) >= 0 ? "positive" : "negative";
}

function renderDelta(value) {
    return `<span class="dashboard-delta ${trendClass(value)}">${formatDelta(value, { nullDash: true })}</span>`;
}

const SECONDARY_OVERVIEW_BRAND_COLORS = { abh: "#7C3AED", kylie: "#DB2777" };
const SECONDARY_OVERVIEW_FALLBACK_COLOR_VARS = ["--achi-brand-1", "--achi-brand-2", "--achi-brand-3", "--achi-brand-4"];

function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveSecondaryOverviewBrandColors(brands) {
    const styles = getComputedStyle(document.documentElement);
    const colorByBrand = {};
    let fallbackIndex = 0;
    brands.forEach((brand) => {
        const key = brand.trim().toLowerCase();
        if (SECONDARY_OVERVIEW_BRAND_COLORS[key]) {
            colorByBrand[brand] = SECONDARY_OVERVIEW_BRAND_COLORS[key];
            return;
        }
        const varName = SECONDARY_OVERVIEW_FALLBACK_COLOR_VARS[fallbackIndex % SECONDARY_OVERVIEW_FALLBACK_COLOR_VARS.length];
        fallbackIndex++;
        colorByBrand[brand] = styles.getPropertyValue(varName).trim() || "#2A78D6";
    });
    return colorByBrand;
}

function overviewHeaderCell(columnLabel, icon, value, iconColor) {
    const colorStyle = iconColor ? ` style="color:${iconColor}"` : "";
    const valueHtml = value == null ? "" : `<span class="secondary-overview-header-value">${value}</span>`;
    return `<span class="secondary-overview-header-cell">
        <span class="secondary-overview-header-icon-wrap">
            <i class="bi ${icon} secondary-overview-header-icon" aria-hidden="true"${colorStyle}></i>
            <span class="secondary-overview-header-icon-label">${columnLabel}</span>
        </span>
        ${valueHtml}
    </span>`;
}

const SECONDARY_OVERVIEW_METRIC_ROWS = [
    { label: "Month Target", key: "monthTarget", format: (v) => money(v, { nullDash: true }) },
    { label: "Actual Sales", key: "actualSales", format: (v) => money(v) },
    { label: "% Vs Target", key: "pctVsTargetPct", format: (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}%`) },
    { label: "Vs LY", key: "vsLastYearPct", format: (v) => renderDelta(v) },
    { label: "SOB", key: "sobPct", format: (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}%`) },
];

function renderDashboardOverviewTable(brands, channels, cells) {
    const wrap = document.getElementById("dashboardOverviewTableWrap");
    if (!wrap) {
        return;
    }
    if (!brands.length || !channels.length) {
        wrap.innerHTML = `<div class="secondary-overview-empty">Not Available</div>`;
        return;
    }

    const groups = [...brands, "Total"];
    const subColumns = [...channels, "Total"];
    const colorByBrand = resolveSecondaryOverviewBrandColors(brands);

    const cellByKey = new Map();
    cells.forEach((cell) => cellByKey.set(`${cell.brand}|${cell.channel}`, cell));

    function groupSubClasses(group, sub, subIndex, isGrandTotal) {
        const classes = [];
        if (subIndex === 0) {
            classes.push("secondary-overview-group-divider");
        }
        if (sub === "Total") {
            classes.push("secondary-overview-col-total");
        }
        if (isGrandTotal) {
            classes.push("secondary-overview-grandtotal-col");
            if (sub === "Total") {
                classes.push("secondary-overview-grandtotal-total-col");
            }
        }
        return classes;
    }

    const headerRow1 = groups
        .map((group) => {
            const isGrandTotal = group === "Total";
            const classes = ["secondary-overview-brand-header", "secondary-overview-group-divider"];
            if (isGrandTotal) {
                classes.push("secondary-overview-brand-grandtotal", "secondary-overview-grandtotal-col");
            }
            const iconColor = isGrandTotal ? "#FFFFFF" : colorByBrand[group];
            return `<th colspan="${subColumns.length}" class="${classes.join(" ")}">${overviewHeaderCell("Brand", "bi-shop", group, iconColor)}</th>`;
        })
        .join("");

    const headerRow2 = groups
        .map((group) => {
            const isGrandTotal = group === "Total";
            return subColumns
                .map((sub, subIndex) => `<th class="${groupSubClasses(group, sub, subIndex, isGrandTotal).join(" ")}">${overviewHeaderCell("Channel", "bi-diagram-2-fill", sub, null)}</th>`)
                .join("");
        })
        .join("");

    const bodyRows = SECONDARY_OVERVIEW_METRIC_ROWS
        .map((metric) => {
            const dataCells = groups
                .map((group) => {
                    const isGrandTotal = group === "Total";
                    const tint = isGrandTotal ? null : hexToRgba(colorByBrand[group], 0.06);
                    return subColumns
                        .map((sub, subIndex) => {
                            const cell = cellByKey.get(`${group}|${sub}`);
                            const value = cell ? cell[metric.key] : null;
                            const classes = groupSubClasses(group, sub, subIndex, isGrandTotal);
                            const style = tint ? ` style="background-color:${tint}"` : "";
                            return `<td class="${classes.join(" ")}"${style}>${metric.format(value)}</td>`;
                        })
                        .join("");
                })
                .join("");
            return `<tr><td class="secondary-overview-metric-label">${metric.label}</td>${dataCells}</tr>`;
        })
        .join("");

    wrap.innerHTML = `<table class="secondary-overview-table">
        <thead>
            <tr>
                <th rowspan="2" class="secondary-overview-metric-header">${overviewHeaderCell("Metric", "bi-list-columns", null, null)}</th>
                ${headerRow1}
            </tr>
            <tr>${headerRow2}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
    </table>`;
}

let dashboardOverviewRequestSeq = 0;

async function loadDashboardOverview(from, to) {
    const requestId = ++dashboardOverviewRequestSeq;
    const section = document.getElementById("dashboardOverviewSection");
    section?.classList.add("is-loading");
    const params = new URLSearchParams();
    if (from) {
        params.set("from", from);
    }
    if (to) {
        params.set("to", to);
    }
    let data = { brands: [], channels: [], cells: [] };
    try {
        const res = await fetch(`/api/secondary-sales/overview?${params.toString()}`);
        if (res.ok) {
            data = await res.json();
        }
    } catch {
        // fall through with the empty default above
    }
    if (requestId !== dashboardOverviewRequestSeq) {
        return;
    }
    section?.classList.remove("is-loading");
    renderDashboardOverviewTable(data.brands || [], data.channels || [], data.cells || []);
}

// ==================== Sales Date Filter (Daily Sales Trends' own instance) ====================
// Now components/SalesDateFilter/SalesDateFilter.js's initSalesDateFilter, imported above.

// ==================== 2. Daily Sales Trends ====================
// Reference component reused wherever possible per explicit request — this whole section (colors,
// brand pill helpers, initDailyTrendGraph) is copied verbatim from SecondarySalesPage.js's own
// "2. Daily Sales Trends", pointed at this page's own /api/dashboard endpoints instead. The only
// real behavioral difference is server-side: DashboardDailyTrendService combines BOTH
// Primary_Sales+Secondary_Sales (Sales) and Primary_Sales_Target+Secondary_Sales_Target (Target)
// per real Brand, so every number this chart shows is the combined total across both sales
// channels — see that service's own header comment. hexToRgba already exists above (identical
// implementation), reused as-is instead of redefined.
async function loadBrandPillOptions() {
    try {
        const res = await fetch("/api/dashboard/brands");
        if (!res.ok) {
            return [];
        }
        const brands = await res.json();
        return Array.isArray(brands) ? brands : [];
    } catch {
        return [];
    }
}

// Maps a real Site_Master.Brand value ("Anastasia Beverly hills", "Kylie Cosmetics") to the short
// code every brand-filtered endpoint's BrandFilter.normalize() actually accepts ("abh"/"kylie") —
// same fix as Secondary/Primary Sales pages' own copy of this function.
function brandNameToCode(label) {
    const normalized = label.trim().toLowerCase();
    if (normalized === "anastasia beverly hills") {
        return "abh";
    }
    if (normalized === "kylie cosmetics") {
        return "kylie";
    }
    return normalized;
}

// Maps a real Site_Master.Sales_Type value ("Primary Sales", "Secondary Sales") to the short code
// every salesType-filtered endpoint here already accepts ("primary"/"secondary") — same fix
// brandNameToCode above applies for Brand, used by the Filter Header's own Sales Type pill
// (initDashboardFyOverviewFilter) now that its options come from Site_Master instead of being
// hardcoded in index.html.
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

function renderBrandPill(headerId, brands) {
    // :not(#dailyTrendSalesTypeToggle) — Dashboard's own #dailyTrendBrandHeader now holds 2
    // .brand-header-pill elements (Sales Type + Brand, Sales Type sits first per explicit request);
    // this exclusion keeps the Brand pill correctly targeted regardless of their DOM order. A no-op
    // on every other page's own headerId, which never has that id present.
    const pill = document.querySelector(`#${headerId} .brand-header-pill:not(#dailyTrendSalesTypeToggle)`);
    if (!pill) {
        return;
    }
    if (!brands.length) {
        pill.innerHTML = `<span class="brand-header-item brand-header-empty">Not Available</span>`;
        return;
    }
    const options = [{ value: "all", label: "All" }, ...brands.map((b) => ({ value: brandNameToCode(b), label: b }))];
    pill.innerHTML = options
        .map((opt, i) => `<button type="button" class="brand-header-item${i === 0 ? " active" : ""}" data-brand="${opt.value}">${opt.label}</button>`)
        .join("");
}

let DAILY_TREND_THEME_ROOT_STYLE = getComputedStyle(document.documentElement);
let DAILY_TREND_AXIS_COLOR, DAILY_TREND_GRID_LINE_COLOR, DAILY_TREND_LINE_COLOR, DAILY_TREND_TARGET_COLOR,
    DAILY_TREND_POS_LABEL_COLOR, DAILY_TREND_NEG_LABEL_COLOR, DAILY_TREND_NA_LABEL_COLOR, DAILY_TREND_LAST_YEAR_COLOR;
function resolveDailyTrendColors() {
    DAILY_TREND_THEME_ROOT_STYLE = getComputedStyle(document.documentElement);
    DAILY_TREND_AXIS_COLOR = (DAILY_TREND_THEME_ROOT_STYLE.getPropertyValue("--color-text-secondary").trim()) || "#66756F";
    DAILY_TREND_GRID_LINE_COLOR = (DAILY_TREND_THEME_ROOT_STYLE.getPropertyValue("--color-border").trim()) || "#DCE7E2";
    DAILY_TREND_LINE_COLOR = (DAILY_TREND_THEME_ROOT_STYLE.getPropertyValue("--color-success").trim()) || "#16803C";
    DAILY_TREND_TARGET_COLOR = (DAILY_TREND_THEME_ROOT_STYLE.getPropertyValue("--color-text-secondary").trim()) || "#595f5c";
    DAILY_TREND_POS_LABEL_COLOR = (DAILY_TREND_THEME_ROOT_STYLE.getPropertyValue("--color-success").trim()) || "#16803C";
    DAILY_TREND_NEG_LABEL_COLOR = (DAILY_TREND_THEME_ROOT_STYLE.getPropertyValue("--color-danger").trim()) || "#DC2626";
    DAILY_TREND_NA_LABEL_COLOR = (DAILY_TREND_THEME_ROOT_STYLE.getPropertyValue("--color-text-secondary").trim()) || "#9CA3AF";
    // "Last Year" overlay line — a distinct warm accent so it doesn't get confused with the green
    // Sales line or the neutral dashed Target line.
    DAILY_TREND_LAST_YEAR_COLOR = (DAILY_TREND_THEME_ROOT_STYLE.getPropertyValue("--color-warning").trim()) || "#D97706";
}
resolveDailyTrendColors();
const DAILY_TREND_CRORE = 10000000;
const DAILY_TREND_LAKH = 100000;

const DAILY_TREND_GRANULARITY_LABEL = { day: "Daily", month: "Monthly", year: "Yearly" };
const DAILY_TREND_PERIOD_LABEL = { day: "Date", month: "Month", year: "Year" };
const DAILY_TREND_BRAND_LABEL = { all: "All Brands", abh: "ABH", kylie: "Kylie" };
const DAILY_TREND_SALES_TYPE_LABEL = { all: "All Sales", primary: "Primary Sales", secondary: "Secondary Sales" };
// Real, individually-comparable brands for Compare mode ("By Brand") — same ABH/Kylie identity
// colors used throughout the app.
const DAILY_TREND_COMPARE_BRANDS = [
    { key: "abh", label: "ABH", color: "#7C3AED" },
    { key: "kylie", label: "Kylie", color: "#DB2777" },
];
// Compare mode's other dimension ("By Sales Type") — same green/blue convention SiteStatusPage.js's
// own Sales Trend chart uses for Primary/Secondary Sales (TREND_PRIMARY_COLOR/TREND_SECONDARY_COLOR),
// kept as fixed hex here since this list (like DAILY_TREND_COMPARE_BRANDS above) is built once at
// module scope, not through a theme-resolving function.
const DAILY_TREND_COMPARE_SALES_TYPES = [
    { key: "primary", label: "Primary Sales", color: "#16A34A" },
    { key: "secondary", label: "Secondary Sales", color: "#2563EB" },
];

function resolveTrendLineColor(brand) {
    const compareBrand = DAILY_TREND_COMPARE_BRANDS.find((b) => b.key === brand);
    return compareBrand ? compareBrand.color : DAILY_TREND_LINE_COLOR;
}

// Financial year runs Apr-Mar; recomputed off today's date every call so the default range rolls
// forward on its own once the next FY starts, instead of staying pinned to a hardcoded year.
function currentFinancialYearMonthRange() {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-12
    const fyStartYear = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
}

function initDailyTrendGraph(options = {}) {
    const { apiBase = "/api/dashboard" } = options;

    const card = document.getElementById("dailyTrendCard");
    const brandHeader = document.getElementById("dailyTrendBrandHeader");
    const salesTypeToggle = document.getElementById("dailyTrendSalesTypeToggle");
    const chartTypeToggle = document.getElementById("dailyTrendChartTypeToggle");
    const compareToggle = document.getElementById("dailyTrendCompareToggle");
    const compareModeToggle = document.getElementById("dailyTrendCompareModeToggle");
    const targetToggle = document.getElementById("dailyTrendTargetToggle");
    const vsLastYearToggle = document.getElementById("dailyTrendVsLastYearToggle");
    const chartDom = document.getElementById("dailyTrendChart");
    const modeBadge = document.getElementById("dailyTrendModeBadge");
    const selectionSummary = document.getElementById("dailyTrendSelectionSummary");

    if (!card) {
        return { load() {}, setDateRange() {} };
    }

    const chart = (chartDom && typeof window.echarts !== "undefined") ? window.echarts.init(chartDom) : null;
    // #dailyTrendSectionContainer (an ancestor) ships `hidden` by default (see index.html's
    // data-permission="page:dashboard.daily-trends") until applyPagePermissions confirms the
    // session holds it — echarts sizes itself to that container at init time, so a chart created
    // while it's still `display: none` draws at 0x0 and stays blank even once revealed, unless
    // told to remeasure. Cheap to call unconditionally on every permissions-applied event; a
    // no-permission session never reveals the container so this is a harmless no-op for them.
    if (chart) {
        document.addEventListener("permissions-applied", () => chart.resize());
    }
    // Compare defaults OFF per a later explicit request — the "Filter Header" section's own Sales
    // Type/Brand/Channel/Year Filter now drive this chart directly (see setFilters below, called
    // from setDashboardFyOverviewFilter), and Compare's "By Sales Type" mode would otherwise override
    // whatever Sales Type that row picks on every fetch (compareItems always fetches Primary AND
    // Secondary regardless of state.salesType — see load()'s own overrides below), making the Sales
    // Type pill look connected but do nothing visibly. compareMode stays "salesType" as its own
    // dormant default in case Compare is ever re-enabled.
    // showTarget starts true (unlike showLastYear) — the Target line used to always be drawn
    // unconditionally in single-series line mode, so this toggle only adds the ABILITY to hide it,
    // not a new default-off behavior; see dailyTrendTargetToggle's own markup comment in index.html.
    const state = { chartType: "line", brand: "all", salesType: "all", channel: "all", status: "all", from: null, to: null, granularity: "day", compare: false, compareMode: "salesType", showLastYear: false, showTarget: true };
    let currentData = null;
    let currentCompareData = null;
    let requestSeq = 0;

    function trimNum(n) {
        return Number(n.toFixed(2)).toString();
    }

    function formatIndianAmount(value) {
        const num = Number(value ?? 0);
        if (num === 0) {
            return "0";
        }
        const sign = num < 0 ? "-" : "";
        const abs = Math.abs(num);
        if (abs >= DAILY_TREND_CRORE) {
            return `${sign}${trimNum(abs / DAILY_TREND_CRORE)} Cr`;
        }
        if (abs >= DAILY_TREND_LAKH) {
            return `${sign}${trimNum(abs / DAILY_TREND_LAKH)} Lakh`;
        }
        return `${sign}${trimNum(abs / 1000)} K`;
    }

    function formatFullAmount(value) {
        return Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function growthPct(current, comparison) {
        const cur = Number(current ?? 0);
        const cmp = Number(comparison ?? 0);
        if (cmp === 0) {
            return cur === 0 ? 0 : null;
        }
        return ((cur - cmp) / cmp) * 100;
    }

    // Per explicit request: the ▲/▼ arrow glyph is removed — just the explicit +/− sign in front of
    // the number now.
    function formatGrowth(value) {
        if (value === null || value === undefined) {
            return '<span style="color:#9CA3AF;">— N/A</span>';
        }
        const isUp = value >= 0;
        const color = isUp ? "#4ADE80" : "#F87171";
        const sign = isUp ? "+" : "−";
        return `<span style="color:${color};font-weight:600;">${sign}${Math.abs(value).toFixed(1)}%</span>`;
    }

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

    function updateSelectionSummary() {
        if (!selectionSummary) {
            return;
        }
        if (!currentData) {
            selectionSummary.textContent = "—";
            return;
        }
        const brandLabel = (state.compare && state.compareMode === "brand")
            ? DAILY_TREND_COMPARE_BRANDS.map((b) => b.label).join(" vs ")
            : (DAILY_TREND_BRAND_LABEL[state.brand] || "All Brands");
        const salesTypeLabel = (state.compare && state.compareMode === "salesType")
            ? DAILY_TREND_COMPARE_SALES_TYPES.map((s) => s.label).join(" vs ")
            : (DAILY_TREND_SALES_TYPE_LABEL[state.salesType] || "All Sales");
        const filterPart = `(brand: <strong>${brandLabel}</strong>, salesType: <strong>${salesTypeLabel}</strong>)`;
        selectionSummary.innerHTML = `<span class="daily-trend-selection-summary-part">${filterPart}</span>`;
    }

    function tooltipFormatter(params) {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0];
        if (!first || !currentData) {
            return "";
        }
        const idx = first.dataIndex;
        const periodField = DAILY_TREND_PERIOD_LABEL[state.granularity] || "Period";
        const periodValue = formatPeriod((currentData.dates || [])[idx], state.granularity) || first.name;

        if (state.compare && currentCompareData) {
            let totalSales = 0;
            let totalTarget = 0;
            const rows = currentCompareData.map((brandData) => {
                const salesVal = Number((brandData.data || [])[idx] ?? 0);
                const targetVal = Number((brandData.target || [])[idx] ?? 0);
                totalSales += salesVal;
                totalTarget += targetVal;
                const variance = salesVal - targetVal;
                const variancePct = growthPct(salesVal, targetVal);
                // Last Year row — only when the Vs Last Year toggle is on, matching whatever this
                // same brandData.lastYear (already returned by /trend-range for every compare item,
                // see load()'s compareItems fetch) is drawing as its own dotted overlay line below.
                const lastYearRow = state.showLastYear
                    ? (() => {
                        const lastYearVal = Number((brandData.lastYear || [])[idx] ?? 0);
                        const vsLastYearGrowth = growthPct(salesVal, lastYearVal);
                        return `<div>Last Year: <strong>${formatFullAmount(lastYearVal)}</strong> (${formatGrowth(vsLastYearGrowth)})</div>`;
                    })()
                    : "";
                return `
                    <div style="margin-top:3px;padding-top:2px;border-top:1px solid rgba(255,255,255,0.15);">
                        <div><span style="color:${brandData.color};">●</span> <strong>${brandData.label}</strong></div>
                        <div>Sales: <strong>${formatFullAmount(salesVal)}</strong></div>
                        <div>Target: <strong>${formatFullAmount(targetVal)}</strong></div>
                        <div>Sales Variance: ${formatVariance(variance, variancePct)}</div>
                        ${lastYearRow}
                    </div>`;
            }).join("");

            const totalVariance = totalSales - totalTarget;
            const totalVariancePct = growthPct(totalSales, totalTarget);
            const totalLabel = currentCompareData.map((b) => b.label).join(" + ");
            const totalRow = `
                <div style="margin-top:3px;padding-top:2px;border-top:1px solid rgba(255,255,255,0.35);">
                    <div><strong>Total (${totalLabel})</strong></div>
                    <div>Sales: <strong>${formatFullAmount(totalSales)}</strong></div>
                    <div>Target: <strong>${formatFullAmount(totalTarget)}</strong></div>
                    <div>Sales Variance: ${formatVariance(totalVariance, totalVariancePct)}</div>
                </div>`;

            return `
                <div style="font-size:8px;line-height:1.2;min-width:135px;">
                    <div>${periodField}: <strong>${periodValue}</strong></div>
                    ${rows}
                    ${totalRow}
                </div>
            `;
        }

        const brandLabel = DAILY_TREND_BRAND_LABEL[state.brand] || "All Brands";
        const salesVal = (currentData.data || [])[idx];
        const targetVal = (currentData.target || [])[idx];
        const lastYearVal = (currentData.lastYear || [])[idx];
        const vsTargetGrowth = growthPct(salesVal, targetVal);
        const vsLastYearGrowth = growthPct(salesVal, lastYearVal);
        const periodUnit = (DAILY_TREND_PERIOD_LABEL[state.granularity] || "period").toLowerCase();
        return `
            <div style="font-size:8px;line-height:1.2;min-width:105px;">
                <div>${periodField}: <strong>${periodValue}</strong></div>
                <div>Brand: <strong>${brandLabel}</strong></div>
                <div>Sales Type: <strong>${DAILY_TREND_SALES_TYPE_LABEL[state.salesType] || "All Sales"}</strong></div>
                <div>Sales: <strong>${formatFullAmount(salesVal)}</strong></div>
                <div>Target: <strong>${formatFullAmount(targetVal)}</strong></div>
                <div>Sales vs Target: ${formatGrowth(vsTargetGrowth)}</div>
                <div>vs Last Year (same ${periodUnit}): ${formatGrowth(vsLastYearGrowth)}</div>
            </div>
        `;
    }

    function renderChart() {
        if (!chart) {
            return;
        }
        const labels = currentData ? currentData.labels : [];
        const data = currentData ? currentData.data : [];
        const target = currentData ? (currentData.target || []) : [];
        const isBar = state.chartType === "bar";
        chart.resize();

        let series;
        let legendData;

        if (state.compare && currentCompareData && currentCompareData.length) {
            series = currentCompareData.map((brandData) => ({
                name: brandData.label,
                type: state.chartType,
                data: brandData.data || [],
                smooth: !isBar,
                showSymbol: !isBar,
                symbol: "circle",
                symbolSize: 6,
                connectNulls: false,
                itemStyle: { color: brandData.color },
                areaStyle: isBar ? undefined : {
                    color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: hexToRgba(brandData.color, 0.32) },
                        { offset: 1, color: hexToRgba(brandData.color, 0.02) },
                    ]),
                },
                lineStyle: isBar ? undefined : { width: 2, color: brandData.color },
                z: 2,
            }));
            legendData = currentCompareData.map((brandData) => brandData.label);
            // Target overlay in Compare mode — one dashed line per compared brand/sales-type, reusing
            // that same item's own identity color (each brandData already carries `target`, used by
            // the tooltip's own Target row above). Previously Compare mode never drew a Target line at
            // all — this toggle now works in every chart mode, per explicit request (see
            // dailyTrendTargetToggle's own markup comment in index.html).
            if (state.showTarget) {
                currentCompareData.forEach((brandData) => {
                    series.push({
                        name: `${brandData.label} (Target)`,
                        type: "line",
                        data: brandData.target || [],
                        smooth: false,
                        showSymbol: false,
                        symbol: "none",
                        connectNulls: true,
                        itemStyle: { color: brandData.color },
                        lineStyle: { width: 2, color: brandData.color, type: "dashed", opacity: 0.7 },
                        z: 1,
                    });
                });
                legendData = legendData.concat(currentCompareData.map((brandData) => `${brandData.label} (Target)`));
            }
            // "Vs Last Year" overlay in Compare mode — one smoothed, softly area-filled line per
            // compared brand/sales-type (per explicit request: no longer a sharp/spiky straight-segment
            // line), reusing that same item's own identity color (each brandData already carries
            // `lastYear` since /trend-range returns it on every fetch, compare or not — see load()'s
            // compareItems mapping). Always drawn as a thin "line" even when the base chart is bars,
            // same as the single-series Last Year overlay below. The area fill uses a much lower peak
            // opacity (0.16) than Sales' own area (0.32) so it reads as a secondary/background layer
            // rather than competing with the real Sales area underneath it.
            if (state.showLastYear) {
                currentCompareData.forEach((brandData) => {
                    series.push({
                        name: `${brandData.label} (Last Year)`,
                        type: "line",
                        data: brandData.lastYear || [],
                        smooth: true,
                        showSymbol: false,
                        symbol: "none",
                        connectNulls: true,
                        itemStyle: { color: brandData.color },
                        lineStyle: { width: 2, color: brandData.color, type: "dotted", opacity: 0.7 },
                        areaStyle: {
                            color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                { offset: 0, color: hexToRgba(brandData.color, 0.16) },
                                { offset: 1, color: hexToRgba(brandData.color, 0.01) },
                            ]),
                        },
                        z: 1,
                    });
                });
                legendData = legendData.concat(currentCompareData.map((brandData) => `${brandData.label} (Last Year)`));
            }
        } else {
            const lineColor = resolveTrendLineColor(state.brand);
            const salesSeries = {
                name: "Sales",
                type: state.chartType,
                data,
                smooth: !isBar,
                showSymbol: !isBar,
                symbol: "circle",
                symbolSize: 6,
                connectNulls: false,
                itemStyle: { color: lineColor },
                areaStyle: isBar ? undefined : {
                    color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: hexToRgba(lineColor, 0.32) },
                        { offset: 1, color: hexToRgba(lineColor, 0.02) },
                    ]),
                },
                lineStyle: isBar ? undefined : { width: 2, color: lineColor },
                barWidth: isBar ? "50%" : undefined,
                z: 2,
            };

            if (isBar) {
                salesSeries.label = {
                    show: true,
                    position: "top",
                    distance: 4,
                    formatter: (params) => {
                        const idx = params.dataIndex;
                        const salesVal = data[idx];
                        const targetVal = target[idx];
                        const growth = growthPct(salesVal, targetVal);
                        const growthKey = growth === null ? "na" : growth >= 0 ? "pos" : "neg";
                        const growthLabel = growth === null ? "N/A" : `${growth >= 0 ? "+" : "−"}${Math.abs(growth).toFixed(1)}%`;
                        return `{val|${formatIndianAmount(salesVal)}}\n{${growthKey}|${growthLabel}}`;
                    },
                    rich: {
                        val: { color: DAILY_TREND_AXIS_COLOR, fontSize: 9, fontWeight: 700, lineHeight: 11, align: "center" },
                        pos: { color: DAILY_TREND_POS_LABEL_COLOR, fontSize: 8, fontWeight: 700, lineHeight: 10, align: "center" },
                        neg: { color: DAILY_TREND_NEG_LABEL_COLOR, fontSize: 8, fontWeight: 700, lineHeight: 10, align: "center" },
                        na: { color: DAILY_TREND_NA_LABEL_COLOR, fontSize: 8, fontWeight: 700, lineHeight: 10, align: "center" },
                    },
                };
            }

            series = [salesSeries];
            // Target overlay — toggled via #dailyTrendTargetToggle (state.showTarget, defaults true —
            // see its own state comment above). Per explicit request this toggle now "works in all
            // places in the graph card": previously this line was hard-gated to `!isBar` (never shown
            // in Bar Graph mode at all) — now it's drawn there too, same thin dashed "line over bars"
            // treatment the Last Year overlay below already uses in Bar Graph mode.
            if (state.showTarget) {
                series.push({
                    name: "Target",
                    type: "line",
                    data: target,
                    smooth: false,
                    showSymbol: isBar,
                    symbol: "circle",
                    symbolSize: 5,
                    connectNulls: true,
                    itemStyle: { color: DAILY_TREND_TARGET_COLOR },
                    lineStyle: { width: 2, color: DAILY_TREND_TARGET_COLOR, type: "dashed" },
                    z: 3,
                });
            }
            // "Vs Last Year" overlay — same-period Sales from a year ago (currentData.lastYear,
            // already fetched every load() regardless of this toggle since tooltipFormatter has
            // relied on it for the vs-Last-Year % all along); only drawn on-canvas once the user opts
            // in via #dailyTrendVsLastYearToggle (state.showLastYear). Drawn as a thin dotted "line"
            // even in Bar Graph mode (isBar) — echarts happily mixes a line series onto a bar chart's
            // category axis, and a second bar-per-category would crowd out the growth-% labels above
            // each Sales bar. Per explicit request: smoothed (no longer a sharp/spiky straight-segment
            // line) with a soft area fill underneath it, same gradient treatment Sales' own area uses
            // just at a much lower peak opacity (0.16 vs Sales' 0.32) so it reads as a background layer
            // rather than competing with the real Sales area.
            if (state.showLastYear) {
                series.push({
                    name: "Last Year",
                    type: "line",
                    data: currentData ? (currentData.lastYear || []) : [],
                    smooth: true,
                    showSymbol: isBar,
                    symbol: "circle",
                    symbolSize: 5,
                    connectNulls: true,
                    itemStyle: { color: DAILY_TREND_LAST_YEAR_COLOR },
                    lineStyle: { width: 2, color: DAILY_TREND_LAST_YEAR_COLOR, type: "dotted" },
                    areaStyle: {
                        color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: hexToRgba(DAILY_TREND_LAST_YEAR_COLOR, 0.16) },
                            { offset: 1, color: hexToRgba(DAILY_TREND_LAST_YEAR_COLOR, 0.01) },
                        ]),
                    },
                    z: 4,
                });
            }
            legendData = ["Sales"];
            if (state.showTarget) {
                legendData.push("Target");
            }
            if (state.showLastYear) {
                legendData.push("Last Year");
            }
        }

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
                textStyle: { color: DAILY_TREND_AXIS_COLOR, fontSize: 9 },
                itemWidth: 12,
                itemHeight: 7,
            },
            grid: { left: 8, right: 20, top: isBar ? 34 : 18, bottom: 38, containLabel: true },
            xAxis: {
                type: "category",
                data: labels,
                boundaryGap: isBar,
                axisLine: { lineStyle: { color: DAILY_TREND_GRID_LINE_COLOR } },
                axisLabel: {
                    color: DAILY_TREND_AXIS_COLOR,
                    fontSize: 9,
                    rotate: state.granularity === "day" && labels.length > 10 ? 45 : 0,
                    interval: "auto",
                },
            },
            yAxis: {
                type: "value",
                boundaryGap: isBar ? [0, "22%"] : [0, 0],
                axisLine: { lineStyle: { color: DAILY_TREND_GRID_LINE_COLOR } },
                splitLine: { lineStyle: { color: DAILY_TREND_GRID_LINE_COLOR } },
                axisLabel: { color: DAILY_TREND_AXIS_COLOR, fontSize: 9, formatter: (v) => formatIndianAmount(v) },
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
            const baseParams = { granularity: state.granularity, brand: state.brand, salesType: state.salesType, channel: state.channel, status: state.status };
            if (state.from) {
                baseParams.from = state.from;
            }
            if (state.to) {
                baseParams.to = state.to;
            }

            if (state.compare) {
                // "By Brand" varies brand (ABH vs Kylie) while keeping the currently selected Sales
                // Type filter fixed; "By Sales Type" varies salesType (Primary vs Secondary) while
                // keeping the currently selected Brand filter fixed — see state.compareMode, set by
                // #dailyTrendCompareModeToggle's own click handler below.
                const compareItems = state.compareMode === "salesType" ? DAILY_TREND_COMPARE_SALES_TYPES : DAILY_TREND_COMPARE_BRANDS;
                const results = await Promise.all(compareItems.map(async (item) => {
                    const overrides = state.compareMode === "salesType" ? { salesType: item.key } : { brand: item.key };
                    const params = new URLSearchParams({ ...baseParams, ...overrides });
                    const response = await fetch(`${apiBase}/trend-range?${params.toString()}`);
                    return { ...item, ...(response.ok ? await response.json() : {}) };
                }));
                if (requestId !== requestSeq) {
                    return;
                }
                currentCompareData = results;
                currentData = results[0] || null;
            } else {
                const params = new URLSearchParams(baseParams);
                const response = await fetch(`${apiBase}/trend-range?${params.toString()}`);
                if (!response.ok) {
                    throw new Error(`Request failed with status ${response.status}`);
                }
                const data = await response.json();
                if (requestId !== requestSeq) {
                    return;
                }
                currentData = data;
                currentCompareData = null;
            }

            if (modeBadge) {
                modeBadge.textContent = DAILY_TREND_GRANULARITY_LABEL[state.granularity] || "—";
            }
            updateSelectionSummary();
            renderChart();
        } catch (error) {
            // Leave the chart as-is on a transient failure rather than blanking the section.
        }
    }

    // Scoped to just the Brand pill (:not(#dailyTrendSalesTypeToggle), same reasoning as
    // renderBrandPill's own comment above) — not brandHeader.querySelectorAll, which would also
    // sweep up #dailyTrendSalesTypeToggle's own .brand-header-item buttons now that both pills share
    // #dailyTrendBrandHeader.
    const brandPillEl = brandHeader ? brandHeader.querySelector(".brand-header-pill:not(#dailyTrendSalesTypeToggle)") : null;
    if (brandPillEl) {
        brandPillEl.querySelectorAll(".brand-header-item").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (btn.dataset.brand === state.brand) {
                    return;
                }
                brandPillEl.querySelectorAll(".brand-header-item").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                state.brand = btn.dataset.brand;
                load();
            });
        });
    }

    if (salesTypeToggle) {
        initSalesTypeFilter("dailyTrendSalesTypeToggle", (salesType) => {
            state.salesType = salesType;
            load();
        });
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

    // Dims/disables just the pill Compare mode is currently varying (Brand pill for "By Brand",
    // Sales Type pill for "By Sales Type") — the other pill stays usable as an extra filter on top of
    // whichever dimension is being compared (e.g. "By Brand" compare still respects the Sales Type
    // pill's current selection, see load()'s own baseParams/overrides above).
    function updateCompareModeClasses() {
        brandHeader?.classList.toggle("compare-mode-brand", state.compare && state.compareMode === "brand");
        brandHeader?.classList.toggle("compare-mode-salesType", state.compare && state.compareMode === "salesType");
    }
    // Applies the dimming immediately for Compare's always-on default state (see state.compare/
    // state.compareMode above) instead of only reacting to later toggle clicks.
    updateCompareModeClasses();

    if (compareToggle) {
        compareToggle.addEventListener("click", () => {
            state.compare = !state.compare;
            compareToggle.classList.toggle("active", state.compare);
            compareToggle.setAttribute("aria-pressed", String(state.compare));
            if (compareModeToggle) {
                compareModeToggle.hidden = !state.compare;
            }
            updateCompareModeClasses();
            load();
        });
    }

    if (targetToggle) {
        targetToggle.addEventListener("click", () => {
            state.showTarget = !state.showTarget;
            targetToggle.classList.toggle("active", state.showTarget);
            targetToggle.setAttribute("aria-pressed", String(state.showTarget));
            // Target is already fetched on every load() (tooltipFormatter's Target row has always
            // used it) — toggling this just changes what renderChart() draws, no re-fetch needed.
            renderChart();
        });
    }

    if (vsLastYearToggle) {
        vsLastYearToggle.addEventListener("click", () => {
            state.showLastYear = !state.showLastYear;
            vsLastYearToggle.classList.toggle("active", state.showLastYear);
            vsLastYearToggle.setAttribute("aria-pressed", String(state.showLastYear));
            // currentData.lastYear is already fetched on every load() (tooltipFormatter has always
            // used it) — toggling this just changes what renderChart() draws, no re-fetch needed.
            renderChart();
        });
    }

    if (compareModeToggle) {
        compareModeToggle.querySelectorAll(".daily-trend-chart-type-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (btn.dataset.compareMode === state.compareMode) {
                    return;
                }
                compareModeToggle.querySelectorAll(".daily-trend-chart-type-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                state.compareMode = btn.dataset.compareMode;
                updateCompareModeClasses();
                load();
            });
        });
    }

    if (chart) {
        window.addEventListener("resize", () => {
            chart.resize();
        });
        window.addEventListener("theme-changed", () => {
            resolveDailyTrendColors();
            renderChart();
        });
    }

    return {
        load,
        // Driven by the "Filter Header" section's own Sales Type/Brand/Channel/Status pills — called
        // from setDashboardFyOverviewFilter (further up this file) on every pill change, always with
        // all four current values together rather than a partial patch, so this chart never drifts
        // out of sync with whichever combination is actually active up there. Also re-syncs this
        // section's own (now hidden) pill button active classes, purely so they'd still show the
        // right state if that bar were ever unhidden again.
        setFilters({ salesType, brand, channel, status }) {
            state.salesType = salesType;
            state.brand = brand;
            state.channel = channel;
            state.status = status;
            salesTypeToggle?.querySelectorAll(".brand-header-item").forEach((b) => {
                b.classList.toggle("active", b.dataset.salesType === salesType);
            });
            brandPillEl?.querySelectorAll(".brand-header-item").forEach((b) => {
                b.classList.toggle("active", b.dataset.brand === brand);
            });
            load();
        },
        setDateRange(from, to, meta) {
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
        },
    };
}

(async function wireDailyTrend() {
    const brandPillOptions = await loadBrandPillOptions();
    renderBrandPill("dailyTrendBrandHeader", brandPillOptions);

    const dailyTrend = initDailyTrendGraph({ apiBase: "/api/dashboard" });
    dailyTrendGraph = dailyTrend;

    initSalesDateFilter({
        idPrefix: "dailyTrendDateFilter",
        yearsApiUrl: "/api/dashboard/comparison2/years",
        monthDefaultMode: "year",
        onFilterChange: (column, from, to, meta) => {
            dailyTrend.setDateRange(from, to, meta);
        },
    });
})();
