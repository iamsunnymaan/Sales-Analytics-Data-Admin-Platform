// Team Performance page — "Filter Header" (Date Filter) driving "Team Report" below. Wires up the
// shared Sidebar + Quick Access Panel, same as every other page's own bottom-of-file init calls.
import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { buildCsvLine, downloadCsv, initDownloadPopup } from "/components/ExcelDownloadButton/ExcelDownloadButton.js";
import { initStatusFilter } from "/components/StatusFilter/StatusFilter.js";
import { initScopedFyYearFilter } from "/components/FyYearFilter/FyYearFilter.js";
import { initSalesDateFilter } from "/components/SalesDateFilter/SalesDateFilter.js";
import { initSalesTypeFilter } from "/components/SalesTypeFilter/SalesTypeFilter.js";
import { formatMoney, formatMoneyFull, formatDelta, formatDeltaSigned } from "/Shared/js/format.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating } from "/Shared/js/feature-guard.js";

initSidebar();
initQuickAccessPanel();
// Reveals Filter Header/Team Report's own data-permission elements immediately. Person Details/
// Daily Sales/Person Sitemaster Report start `hidden` for an unrelated reason too (no person picked
// yet) — openPersonDetails/initTeamSiteReport's own setPerson below await this same promise (never
// re-fetch) before ever unhiding those, so the two "still hidden" reasons never race each other.
const pagePermissionsPromise = applyPagePermissions();
// Sequenced after pagePermissionsPromise resolves (not fired in parallel) — see Dashboard.js's own
// comment on why: permission-gating's unconditional `hidden` assignment on a [data-permission]
// element must never resolve after (and silently undo) a feature-based hide on that same element.
pagePermissionsPromise.then(() => applyFeatureGating());

// ==================== Filter Header ====================
// Date Filter — same control Dashboard.js's/SiteStatusPage.js's own "Filter Header"/date-filter
// sections use, copied here per this codebase's per-page-own-copy convention (not centralized).
// Tracks its own current selection here and triggers "Team Report"'s own loadTeamReport() below —
// whenever it isn't actively set (mode "filter" with a real from/to), "Team Report" falls back to
// the real current calendar MONTH instead (see getTeamPerformanceEffectiveRange/
// currentMonthDateRange), per explicit request — not the FY (the FY Year Filter dropdown that used
// to let a user pick a different FY here was removed; "Person Details"' own FY card still shows a
// full FY, but via its own scoped FY Filter now — see initTeamPersonFyYearFilter).
const teamPerformanceFilters = { from: null, to: null, dateMeta: null };

// Status toggle pill (All/Active/Inactive/Upcoming) — same #siteStatusFilterToggle
// pattern/OperationalStatusFilter classification Site Insight page's own Status field uses
// (SiteStatusPage.html/.js), same shared components/StatusFilter/StatusFilter.js widget. "active"
// matches this page's own previous hardcoded-Active-only behavior, so a fresh page load looks
// identical to before this toggle existed. Wired into every section on this page (see the
// initStatusFilter call's own onChange, further down this file) — Team Report, Person Sitemaster
// Report, and Person Details/Daily Sales whenever a person is open.
let teamStatusFilter = "active";

// Status pill options — real options fetched from GET /api/team-performance/statuses (site_master.
// Operational_Status, keyword-matched server-side by OperationalStatusFilter), same fetch-then-render-
// then-"Not Available" convention SiteStatusPage.js's own loadStatusPillOptions/renderStatusPill
// already use, instead of the pill's All/Active/Inactive/Upcoming buttons being hardcoded straight
// into TeamPerformancePage.html.
async function loadStatusPillOptions() {
    try {
        const res = await fetch("/api/team-performance/statuses");
        if (!res.ok) {
            return [];
        }
        const statuses = await res.json();
        return Array.isArray(statuses) ? statuses : [];
    } catch {
        return [];
    }
}

// Renders into #teamPerformanceStatusFilterToggle itself. An empty `statuses` (Site_Master has no
// usable data right now, or the DB isn't connected) shows "Not Available" instead of the pill, and
// leaves teamStatusFilter at its default ("active") since there's nothing to select. Otherwise
// "active" stays the default selection whenever the real options include it.
function renderStatusPill(statuses) {
    const toggle = document.getElementById("teamPerformanceStatusFilterToggle");
    if (!toggle) {
        return;
    }
    if (!statuses.length) {
        toggle.innerHTML = `<span class="site-status-filter-item brand-header-empty">Not Available</span>`;
        return;
    }
    const options = [{ value: "all", label: "All" }, ...statuses.map((s) => ({ value: s.toLowerCase(), label: s }))];
    const defaultValue = options.some((opt) => opt.value === teamStatusFilter) ? teamStatusFilter : "all";
    if (defaultValue !== teamStatusFilter) {
        teamStatusFilter = defaultValue;
    }
    toggle.innerHTML = options
        .map((opt) => `<button type="button" class="site-status-filter-item${opt.value === defaultValue ? " active" : ""}" data-status="${opt.value}">${opt.label}</button>`)
        .join("");
}

// Maps a real site_master.Sales_Type value ("Primary Sales", "Secondary Sales") to the short code
// this page's own salesType already uses ("primary"/"secondary") — same fix Dashboard.js's own
// salesTypeToCode applies.
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

// Sales Type pill options — real options fetched from GET /api/team-performance/sales-types
// (site_master.Sales_Type), same fetch-then-render-then-"Not Available" convention
// loadStatusPillOptions above already uses, instead of the pill's Primary/Secondary buttons being
// hardcoded straight into TeamPerformancePage.html.
async function loadSalesTypePillOptions() {
    try {
        const res = await fetch("/api/team-performance/sales-types");
        if (!res.ok) {
            return [];
        }
        const types = await res.json();
        return Array.isArray(types) ? types : [];
    } catch {
        return [];
    }
}

// Set once initTeamReportSection (further down this file) finishes — lets the Filter Header's own
// FY/Date Filter handlers push their current effective range into it. Declared this early (well
// before that section's own definition) because the Sales Date Filter's onFilterChange below fires
// once synchronously during setup, before initTeamReportSection has run — referencing it there needs
// the `let` binding to already exist (even if still null) or it'd throw a temporal-dead-zone
// ReferenceError instead of just no-op-ing via the optional chaining below. initTeamReportSection
// computes its own correct initial range directly from teamPerformanceFilters once it does run, so
// this early no-op call costs nothing.
let teamReportSectionHandle = null;

// Same early-reference reasoning as teamReportSectionHandle above, for "Person Sitemaster Report"
// (see initTeamSiteReport further down this file) — its own Target/Sales period is driven by the
// Filter Header's own Date Filter, same as "Team Report", but it's also person-scoped (setPerson,
// called from openPersonDetails below whenever a name is clicked, same trigger "Person Details"/
// "Daily Sales" use).
let teamSiteReportSectionHandle = null;

// Same early-reference reasoning as teamReportSectionHandle above, for "Person Details"/"Daily
// Sales" (initPersonDetailsSection, defined near the bottom of this file) — openPersonDetails below
// can fire before that section has initialized. Note "Person Details"/"Daily Sales" no longer react
// to this page's own Filter Header Date Filter at all (per explicit request) — they're driven
// entirely by "Person Details"' own scoped FY Filter instead (see initTeamPersonFyYearFilter).
let personSectionHandle = null;

// The real current FY, computed fresh on every page load — same reasoning Dashboard.js's own
// DASHBOARD_FY_KEYS comment gives, so this shifts forward automatically once a new FY starts
// instead of ever going stale.
function getCurrentFyStartYear2Digit() {
    const now = new Date();
    const calendarYear2Digit = now.getFullYear() % 100;
    // Jan-Mar (month 0-2) still belongs to the FY that started the PREVIOUS April.
    return now.getMonth() < 3 ? calendarYear2Digit - 1 : calendarYear2Digit;
}

function fyKeyFor(startYear2Digit) {
    const start = ((startYear2Digit % 100) + 100) % 100;
    return `20${String(start).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function fyLabelFor(startYear2Digit) {
    const start = ((startYear2Digit % 100) + 100) % 100;
    return `FY ${String(start).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// ==================== Filter Header range label ====================
// #teamPerformanceRangeLabel (team-performance-date-filter-cluster, next to the Filter button) —
// same look/format as PrimarySalesPage.js's own formatRangeLabel ("01-Sep-2026 to 14-Sep-2026 (14
// of 30 days)"), copied here per this codebase's per-page-own-copy convention (same copy
// SiteStatusPage.js's own updateSiteDetailRangeLabel carries). Driven by getTeamPerformanceEffectiveRange
// (declared further down, but hoisted — same "Date Filter wins, else the real current FY" layering
// "Team Report" itself uses) so the label always matches whatever's actually driving that section.
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

function updateTeamPerformanceRangeLabel() {
    const el = document.getElementById("teamPerformanceRangeLabel");
    if (!el) {
        return;
    }
    const range = getTeamPerformanceEffectiveRange();
    const periodFrom = new Date(`${range.from}T00:00:00`);
    const periodTo = new Date(`${range.to}T00:00:00`);
    el.textContent = formatRangeLabel(periodFrom, periodTo, new Date());
}

// Always the real current FY now — the page-level FY Year Filter dropdown that used to let a user
// pick a different one here was removed per explicit request, so there's no longer a "selected" FY
// to track for "Team Report"/"Daily Sales" (see currentMonthDateRange for their own current fallback
// instead). "Person Details"' own FY card still needs one, but scoped to just that card — see
// TEAM_PERSON_FY_KEYS/initTeamPersonFyYearFilter below.
const TEAM_PERFORMANCE_FY_CURRENT_KEY = fyKeyFor(getCurrentFyStartYear2Digit());

// "2026-27" -> "FY 26-27" for any FY key, not just the real current one — used by the Person FY
// card's own FY Filter (menu items + selected label) below.
function fyLabelForKey(fyKey) {
    const startYear = Number(String(fyKey).split("-")[0]);
    return fyLabelFor(startYear % 100);
}

// Rolling window (current FY + the 2 before it) for the Person FY card's own FY Filter dropdown —
// same DASHBOARD_FY_WINDOW_SIZE=3 idea Dashboard.js's own Year Filter uses, scoped to just this one
// card (per explicit request) instead of the whole page.
const TEAM_PERSON_FY_WINDOW_SIZE = 3;
const TEAM_PERSON_FY_KEYS = Array.from(
    { length: TEAM_PERSON_FY_WINDOW_SIZE },
    (_, i) => fyKeyFor(getCurrentFyStartYear2Digit() - i),
);

// ==================== Sales Date Filter ====================
// Now components/SalesDateFilter/SalesDateFilter.js's initSalesDateFilter, imported above.
initSalesDateFilter({
    idPrefix: "teamPerformanceDateFilter",
    onFilterChange: (column, from, to, meta) => {
        teamPerformanceFilters.from = from;
        teamPerformanceFilters.to = to;
        teamPerformanceFilters.dateMeta = meta;
        // Fires synchronously once during setup (mode: null, before the Filter panel is ever opened,
        // before initTeamReportSection has even run yet) — teamReportSectionHandle is still null at
        // that point, so this safely no-ops via the optional chaining; initTeamReportSection computes
        // its own correct initial range directly from teamPerformanceFilters once it does run.
        const range = getTeamPerformanceEffectiveRange();
        teamReportSectionHandle?.setDateRange(range.from, range.to);
        teamSiteReportSectionHandle?.setDateRange(range.from, range.to);
        updateTeamPerformanceRangeLabel();
    },
});

// Status toggle pill (#teamPerformanceStatusFilterToggle) now lives in
// components/StatusFilter/StatusFilter.js — a click there fans the change out to every section on
// this page: "Team Report" (teamReportSectionHandle), "Person Sitemaster Report"
// (teamSiteReportSectionHandle — a no-op via its own internal guard if no person is currently
// open), and "Person Details"/"Daily Sales" (personSectionHandle — also a no-op internally if no
// person is open).
loadStatusPillOptions().then((statuses) => {
    renderStatusPill(statuses);
    initStatusFilter("teamPerformanceStatusFilterToggle", (status) => {
        teamStatusFilter = status;
        teamReportSectionHandle?.setStatus(status);
        teamSiteReportSectionHandle?.setStatus(status);
        personSectionHandle?.setStatus(status);
    });
});

// ==================== Team Report ====================
// Exact frontend architecture mirror of PrimarySalesPage.js's own "4. Reports"
// (getBrandHierarchy/getFlatSummary + initReportsSection/renderBrandHierarchyTable/
// renderReportsTable) — an "All Report" hierarchy tree (RM -> AM -> CM -> SM) plus three flat
// single-level tabs (AM/CM/SM — RM excluded, same reasoning Primary's own Brand tab is excluded
// there), per explicit request. Every function/const below is a direct rename of Primary's own
// (brandTree -> positionTree, brand -> rm for the achi-bar color-slot concept) — see
// TeamPerformanceReportService's own header comment for the backend side of this mirror.
function pad2(n) {
    return String(n).padStart(2, "0");
}

function lastDayOfMonthNum(year, month) {
    return new Date(year, month, 0).getDate();
}

// The real current calendar month's own [1st, last day] range — "Team Report"'s own fallback
// whenever the Date Filter isn't actively set, per explicit request (was the real current FY before
// — see getTeamPerformanceEffectiveRange's own comment).
function currentMonthDateRange() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDayOfMonthNum(y, m))}` };
}

// "2026-27" -> Apr 1 2026..Mar 31 2027 — used by "Daily Sales" (initTeamPersonDailyTrend) to fetch
// whichever FY the Person FY card's own FY Filter currently has selected.
function fyKeyToDateRange(fyKey) {
    const fyStartYear = Number(String(fyKey).split("-")[0]);
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
}

// Date Filter wins whenever it's actively set (mode "filter" with a real from/to); otherwise falls
// back to the real current calendar MONTH (currentMonthDateRange), per explicit request — not the
// FY (no picker left on this page's own Filter Header to choose a different FY; "Person Details"'
// own FY card still shows a full FY, but via its own scoped FY Filter — see
// initTeamPersonFyYearFilter).
function getTeamPerformanceEffectiveRange() {
    if (teamPerformanceFilters.dateMeta && teamPerformanceFilters.dateMeta.mode === "filter"
        && teamPerformanceFilters.from && teamPerformanceFilters.to) {
        return { from: teamPerformanceFilters.from, to: teamPerformanceFilters.to };
    }
    return currentMonthDateRange();
}

function teamPerformanceReportMoney(value, opts) {
    return formatMoney(value, opts).replace("₹", "");
}

// Escapes a real RM/AM/CM/SM name (or the synthetic "Uncategorized" bucket) for safe use inside an
// HTML attribute (data-person-name) — names are free-text site_master columns, not app-controlled.
function escapePersonName(name) {
    return String(name).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function reportsTrendClass(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return value >= 0 ? "positive" : "negative";
}

function renderReportsDelta(value) {
    if (value === null || value === undefined) {
        return "—";
    }
    return `<span class="product-snapshot-delta ${reportsTrendClass(value)}">${formatDelta(value, { nullDash: true })}</span>`;
}

function reportsColumns(firstLabel) {
    return [firstLabel, "Sites", "Mnt", "Sales", "Achi.", "Vs LM", "Vs LY"];
}

// One icon per Reports column header, plus one per tree level (RM/AM/CM/SM — reused by the flat
// tabs' own row icons too, see POSITION_TREE_LEVEL_ICONS).
const REPORTS_COLUMN_ICONS = {
    "RM": "bi-diagram-3-fill",
    "AM": "bi-signpost-split-fill",
    "CM": "bi-building",
    "SM": "bi-shop",
    "Sites": "bi-buildings",
    "Mnt": "bi-bullseye",
    "Sales": "bi-cash-stack",
    "Achi.": "bi-graph-up-arrow",
    "Vs LM": "bi-calendar3",
    "Vs LY": "bi-arrow-left-right",
};

function reportsHeaderCell(label) {
    return `<span class="product-snapshot-header-cell">
        <i class="bi ${REPORTS_COLUMN_ICONS[label] || "bi-list-columns"} product-snapshot-header-icon" aria-hidden="true"></i>
        <span class="product-snapshot-header-icon-label">${label}</span>
    </span>`;
}

// 7-column widths — first column wider for the name/tree indentation.
const REPORTS_TABLE_COLGROUP = `<colgroup>
    <col style="width:24%"><col style="width:10%"><col style="width:12%"><col style="width:12%">
    <col style="width:14%"><col style="width:14%"><col style="width:14%">
</colgroup>`;

function reportsAchiPct(sales, target) {
    const t = Number(target ?? 0);
    const s = Number(sales ?? 0);
    return t > 0 ? (s / t) * 100 : null;
}

// `rmSlot` (0-3, or undefined) colors the fill via .channel-report-achi-fill[data-brand-slot] in the
// stylesheet — omitted for rows that don't belong to one single RM (the Total row, and every row in
// the RM-less flat tabs), which fall back to a neutral color instead.
function renderReportsAchiCell(sales, target, rmSlot) {
    const pct = reportsAchiPct(sales, target);
    const barWidth = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
    const pctLabel = pct == null ? "—" : `${pct.toFixed(1)}%`;
    const slotAttr = rmSlot == null ? "" : ` data-brand-slot="${rmSlot}"`;
    return `
        <span class="channel-report-achi-cell">
            <span class="channel-report-achi-track">
                <span class="channel-report-achi-fill" style="width:${barWidth.toFixed(1)}%"${slotAttr}></span>
            </span>
            <span class="channel-report-achi-pct">${pctLabel}</span>
        </span>`;
}

// Per-tab row-tint class for renderFlatTable's own <table> — each flat tab's data rows get one
// solid color (AM/CM/SM) instead of the base .product-snapshot-table rule's even/odd zebra stripe,
// same tint family renderPositionHierarchyTable's own data-level rule uses.
const FLAT_REPORT_TABLE_CLASS = {
    "AM": "report-flat-table--am",
    "CM": "report-flat-table--cm",
    "SM": "report-flat-table--sm",
};

function countFlatRows(rows) {
    return (rows ?? []).filter((row) => row.name !== "Total").length;
}

// One icon per hierarchy level (0=RM, 1=AM, 2=CM, 3=SM) so the tree reads at a glance without
// having to check indentation alone.
const POSITION_TREE_LEVEL_ICONS = ["bi-diagram-3-fill", "bi-signpost-split-fill", "bi-building", "bi-shop"];
const POSITION_TREE_LEVEL_LABELS = ["RM", "AM", "CM", "SM"];

// Achi. bar color slots (0-3, matching --achi-brand-1..4 in the stylesheet) — one per RM, in fixed
// first-seen order, so every AM/CM/SM row under an RM shares that RM's color rather than being
// colored by its own level/category.
const REPORT_RM_COLOR_SLOTS = 4;

function assignRmColorSlots(rows) {
    const slotByRm = new Map();
    rows.forEach((row) => {
        if (row.rm && !slotByRm.has(row.rm)) {
            slotByRm.set(row.rm, slotByRm.size % REPORT_RM_COLOR_SLOTS);
        }
    });
    return slotByRm;
}

// `rows` is a flat list of {name, sites, target, sales, vsLastMonthPct, vsLastYearPct} objects
// (AM/CM/SM tabs, real per TeamPerformanceReportService.get*Summaries) — every column is real.
// `firstLabel` doubles as the POSITION_TREE_LEVEL_LABELS lookup key so every flat tab shows the
// exact same icon-on-top/label-underneath row icon the "All Report" hierarchy tree uses for that
// same level, instead of one generic icon shared by all three tabs.
function renderFlatTable(wrap, firstLabel, rows) {
    const level = POSITION_TREE_LEVEL_LABELS.indexOf(firstLabel);
    // getFlatPositionSummary (backend) always appends its own trailing {name: "Total", ...} row,
    // even when site_master itself has zero rows — countFlatRows excludes that row, so this only
    // fires when site_master genuinely has nothing.
    const bodyRows = !countFlatRows(rows)
        ? `<tr><td colspan="${reportsColumns(firstLabel).length}" class="product-snapshot-table-empty">
            <div class="reports-empty-state">
                <i class="bi bi-inbox reports-empty-state-icon" aria-hidden="true"></i>
                <p class="reports-empty-state-title">No data available</p>
            </div>
        </td></tr>`
        : rows.map((row) => {
            const isTotal = row.name === "Total";
            const rowIcon = isTotal
                ? '<i class="bi bi-calculator channel-report-row-icon" aria-hidden="true"></i>'
                : `<span class="brand-tree-row-icon-wrap">
                        <i class="bi ${POSITION_TREE_LEVEL_ICONS[level]} brand-tree-row-icon" data-level="${level}" aria-hidden="true"></i>
                        <span class="brand-tree-row-icon-label">${POSITION_TREE_LEVEL_LABELS[level]}</span>
                   </span>`;
            // data-person-level/-name let the click delegation in initTeamReportSection open "Person
            // Details" for this row — omitted on the Total row (not a real person) and on the
            // "Uncategorized" bucket's synthetic name, same reasoning it's excluded everywhere else.
            const personAttrs = isTotal ? "" : ` data-person-level="${firstLabel.toLowerCase()}" data-person-name="${escapePersonName(row.name)}"`;
            return `
        <tr data-level="0"${isTotal ? ' class="channel-report-total-row"' : ""}>
            <td class="product-snapshot-col-name">
                <span class="product-snapshot-name-cell">
                    ${rowIcon}
                    <span class="product-snapshot-name-text"${personAttrs}>${row.name}</span>
                </span>
            </td>
            <td>${row.sites ?? 0}</td>
            <td>${teamPerformanceReportMoney(row.target, { nullDash: true, round: false })}</td>
            <td>${teamPerformanceReportMoney(row.sales, { round: false })}</td>
            <td>${renderReportsAchiCell(row.sales, row.target)}</td>
            <td>${renderReportsDelta(row.vsLastMonthPct)}</td>
            <td>${renderReportsDelta(row.vsLastYearPct)}</td>
        </tr>`;
        }).join("");

    const tableClass = `product-snapshot-table ${FLAT_REPORT_TABLE_CLASS[firstLabel] || ""}`.trim();
    wrap.innerHTML = `
        <table class="${tableClass}">
            ${REPORTS_TABLE_COLGROUP}
            <thead>
                <tr>${reportsColumns(firstLabel).map((col) => `<th>${reportsHeaderCell(col)}</th>`).join("")}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>`;
}

// Turns the backend's nested {name, sites, target, sales, children:[...]} tree into a flat
// id/parent/level row list an expand/collapse table can render as one flat <table> with per-row
// indentation. Each row carries `rm`: its own name at level 0, or its level-0 ancestor's name at
// every level below that (so an AM/CM/SM row's Achi. bar can be colored by the RM it rolls up to).
// The bottom Total row (level 0, name "Total") gets rm: null since it spans every RM, not just one.
function flattenPositionTree(tree) {
    const rows = [];
    function walk(node, id, level, parent, rm) {
        const rowRm = level === 0 ? (node.name === "Total" ? null : node.name) : rm;
        rows.push({
            id, level, parent, name: node.name, sites: node.sites, target: node.target, sales: node.sales,
            vsLastMonthPct: node.vsLastMonthPct, vsLastYearPct: node.vsLastYearPct, rm: rowRm,
        });
        (node.children ?? []).forEach((child, ci) => walk(child, `${id}-${level}${ci}`, level + 1, id, rowRm));
    }
    (tree ?? []).forEach((rm, ri) => walk(rm, `r${ri}`, 0, null, null));
    return rows;
}

function positionTreeHasChildren(rowId, rows) {
    return rows.some((row) => row.parent === rowId);
}

// A row's full ancestor path (["RM", "AM", "CM", "SM"]) by walking `parent` back up `rows` — needed
// here because a flat CSV loses the on-screen table's indentation. Flat-tab rows have no
// `parent`/`level` at all (single level) and never reach this — see downloadTeamReportCsv.
function reportsRowPathArray(row, rows) {
    const path = [row.name];
    let current = row;
    while (current.parent != null) {
        current = rows.find((r) => r.id === current.parent);
        if (!current) {
            break;
        }
        path.unshift(current.name);
    }
    return path;
}

const REPORTS_LEVEL_COLUMNS = ["RM", "AM", "CM", "SM"];

// Client-side CSV export for the Team Report download popup — `sections` is one or more
// {label, rows} pairs.
function downloadTeamReportCsv(sections) {
    const nonEmpty = sections.filter((s) => s.rows && s.rows.length);
    if (!nonEmpty.length) {
        return;
    }
    const header = [...REPORTS_LEVEL_COLUMNS, "Sites", "Mnt", "Sales", "Achi %", "Vs LM %", "Vs LY %"];
    const lines = [header.join(",")];
    nonEmpty.forEach(({ label, rows }) => {
        rows.forEach((row) => {
            const achiPct = reportsAchiPct(row.sales, row.target);
            let levelCells;
            if (row.level != null) {
                const path = reportsRowPathArray(row, rows);
                levelCells = REPORTS_LEVEL_COLUMNS.map((_, i) => path[i] ?? "");
            } else {
                levelCells = REPORTS_LEVEL_COLUMNS.map((col) => (col === label ? row.name : ""));
            }
            const cells = [
                ...levelCells,
                row.sites ?? 0,
                formatMoneyFull(row.target, { nullDash: true }),
                formatMoneyFull(row.sales),
                achiPct == null ? "—" : `${achiPct.toFixed(1)}%`,
                formatDeltaSigned(row.vsLastMonthPct, { nullDash: true }),
                formatDeltaSigned(row.vsLastYearPct, { nullDash: true }),
            ];
            lines.push(buildCsvLine(cells));
        });
    });
    downloadCsv(lines, `team-report-${new Date().toISOString().slice(0, 10)}.csv`);
}

// Total row count per hierarchy level (RM/AM/CM/SM) for the header's count strip — the bottom Total
// row (level 0, name "Total") is excluded, it isn't a real RM.
function computeHierarchyCounts(rows) {
    const counts = { rm: 0, am: 0, cm: 0, sm: 0 };
    (rows ?? []).forEach((row) => {
        if (row.level === 0 && row.name === "Total") {
            return;
        }
        if (row.level === 0) counts.rm++;
        else if (row.level === 1) counts.am++;
        else if (row.level === 2) counts.cm++;
        else if (row.level === 3) counts.sm++;
    });
    return counts;
}

function renderReportsCounts(el, counts) {
    if (!el) {
        return;
    }
    if (!counts) {
        el.innerHTML = "";
        return;
    }
    el.innerHTML = `
        <span class="reports-section-count"><span class="reports-section-count-label">RM:</span>${counts.rm}</span>
        <span class="reports-section-count"><span class="reports-section-count-label">AM:</span>${counts.am}</span>
        <span class="reports-section-count"><span class="reports-section-count-label">CM:</span>${counts.cm}</span>
        <span class="reports-section-count"><span class="reports-section-count-label">SM:</span>${counts.sm}</span>`;
}

// AM/CM/SM tabs each only carry their own flat dimension's rows — no info about the other levels to
// compute real counts for — so only that one tab's own distinct-value count is shown here.
function renderSingleReportsCount(el, label, count) {
    if (!el) {
        return;
    }
    el.innerHTML = `<span class="reports-section-count"><span class="reports-section-count-label">${label}:</span>${count}</span>`;
}

// Every node starts collapsed and can be expanded/collapsed independently of its siblings.
function renderPositionHierarchyTable(wrap, rows) {
    // getPositionHierarchy (backend) always appends its own trailing {name: "Total", level: 0, ...}
    // RM node, even when site_master itself has zero rows — excluding that node here means this
    // only fires when site_master genuinely has nothing.
    const hasRealRows = rows.some((row) => !(row.level === 0 && row.name === "Total"));
    if (!hasRealRows) {
        wrap.innerHTML = `
            <div class="reports-empty-state">
                <i class="bi bi-inbox reports-empty-state-icon" aria-hidden="true"></i>
                <p class="reports-empty-state-title">No data available</p>
            </div>`;
        return;
    }

    const collapsed = new Set(rows.filter((row) => positionTreeHasChildren(row.id, rows)).map((row) => row.id));

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

    const rmColorSlots = assignRmColorSlots(rows);

    const bodyRows = rows
        .map((row) => {
            const expandable = positionTreeHasChildren(row.id, rows);
            const toggle = expandable
                ? `<i class="bi bi-chevron-right product-snapshot-toggle collapsed" data-toggle-id="${row.id}"></i>`
                : `<span class="product-snapshot-toggle-spacer"></span>`;
            const isTotal = row.level === 0 && row.name === "Total";
            const levelIcon = isTotal
                ? '<i class="bi bi-calculator channel-report-row-icon" aria-hidden="true"></i>'
                : `<span class="brand-tree-row-icon-wrap">
                        <i class="bi ${POSITION_TREE_LEVEL_ICONS[row.level]} brand-tree-row-icon" data-level="${row.level}" aria-hidden="true"></i>
                        <span class="brand-tree-row-icon-label">${POSITION_TREE_LEVEL_LABELS[row.level]}</span>
                   </span>`;
            const rmSlot = row.rm ? rmColorSlots.get(row.rm) : null;
            // Same data-person-level/-name click target renderFlatTable's own rows carry — see that
            // function's own comment.
            const personAttrs = isTotal ? "" : ` data-person-level="${POSITION_TREE_LEVEL_LABELS[row.level].toLowerCase()}" data-person-name="${escapePersonName(row.name)}"`;
            return `
                <tr data-row-id="${row.id}" data-level="${row.level}"${isTotal ? ' class="channel-report-total-row"' : ""}>
                    <td class="product-snapshot-col-name">
                        <span class="product-snapshot-name-cell" style="padding-left:${row.level * 1.1}rem">
                            ${toggle}
                            ${levelIcon}
                            <span class="product-snapshot-name-text"${personAttrs}>${row.name}</span>
                        </span>
                    </td>
                    <td>${row.sites ?? 0}</td>
                    <td>${teamPerformanceReportMoney(row.target, { nullDash: true, round: false })}</td>
                    <td>${teamPerformanceReportMoney(row.sales, { round: false })}</td>
                    <td>${renderReportsAchiCell(row.sales, row.target, rmSlot)}</td>
                    <td>${renderReportsDelta(row.vsLastMonthPct)}</td>
                    <td>${renderReportsDelta(row.vsLastYearPct)}</td>
                </tr>`;
        })
        .join("");

    wrap.innerHTML = `
        <table class="product-snapshot-table brand-hierarchy-table">
            ${REPORTS_TABLE_COLGROUP}
            <thead>
                <tr>${reportsColumns("RM").map((col) => `<th>${reportsHeaderCell(col)}</th>`).join("")}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>`;

    wrap.querySelectorAll(".product-snapshot-toggle").forEach((toggle) => {
        toggle.addEventListener("click", () => {
            const id = toggle.dataset.toggleId;
            const opening = collapsed.has(id);
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

// Every flat (single-level) Reports tab besides "All Report" — one tab per hierarchy level (AM/CM/SM;
// the standalone RM tab is intentionally not wired here, same as Primary's own version — RM-level
// rows are still visible via the "All Report" hierarchy tree), each backed by its own
// TeamPerformanceReportService#get*Summaries endpoint.
const FLAT_REPORT_TABS = {
    am: { label: "AM", endpoint: "/api/team-performance/reports/am" },
    cm: { label: "CM", endpoint: "/api/team-performance/reports/cm" },
    sm: { label: "SM", endpoint: "/api/team-performance/reports/sm" },
};

function initTeamReportSection() {
    const card = document.getElementById("teamPerformanceReportCard");
    if (!card) {
        return { setDateRange() {}, setStatus() {} };
    }

    const tableWrap = document.getElementById("teamPerformanceReportTableWrap");
    const tabToggle = document.getElementById("teamPerformanceReportTabToggle");
    const salesTypeToggle = document.getElementById("teamPerformanceSalesTypeToggle");
    const countsEl = document.getElementById("teamPerformanceReportCounts");
    if (!tableWrap) {
        return { setDateRange() {}, setStatus() {} };
    }

    // Clicking any RM/AM/CM/SM name (either tree) opens "Person Details" below — see
    // openPersonDetails further down this file. Delegated so it keeps working across every
    // re-render (renderActiveTab replaces tableWrap's innerHTML wholesale on every tab/filter
    // change) without needing to re-attach a listener per row.
    tableWrap.addEventListener("click", (event) => {
        const nameEl = event.target.closest(".product-snapshot-name-text[data-person-level]");
        if (!nameEl) {
            return;
        }
        openPersonDetails(nameEl.dataset.personLevel, nameEl.dataset.personName);
    });

    // Secondary active by default, per explicit request — mirrors whichever
    // `.brand-header-item.active[data-sales-type]` TeamPerformancePage.html ships with, so the
    // JS default can never silently drift out of sync with the markup's own default.
    let salesType = salesTypeToggle?.querySelector(".brand-header-item.active")?.dataset.salesType || "secondary";
    let activeTab = "all";
    let treeRows = null;
    let treeRequestSeq = 0;
    const flatRows = { am: null, cm: null, sm: null };
    const flatRequestSeq = { am: 0, cm: 0, sm: 0 };
    // Driven by the Filter Header's Year/Date Filter above — starts on that filter's own current
    // effective range (rather than null/null, the backend's own current-month-to-date fallback) so
    // the very first render already matches whichever FY/date the header shows.
    const initialRange = getTeamPerformanceEffectiveRange();
    let currentFrom = initialRange.from;
    let currentTo = initialRange.to;
    // Filter Header's own Status toggle pill (#teamPerformanceStatusFilterToggle) — see
    // the initStatusFilter call/setStatus below.
    let currentStatus = teamStatusFilter;

    let pendingRequests = 0;
    function beginLoading() {
        pendingRequests++;
        card.classList.add("is-loading");
    }
    function endLoading() {
        pendingRequests = Math.max(0, pendingRequests - 1);
        if (pendingRequests === 0) {
            card.classList.remove("is-loading");
        }
    }

    // Shown instead of the table while a tab's data is still in flight — `null` (not yet fetched,
    // see treeRows/flatRows below) is a distinct state from "fetch resolved to zero real rows", so
    // this never gets mistaken for (or shows alongside) the real "No data available" empty state.
    function renderLoadingState() {
        tableWrap.innerHTML = `
            <div class="reports-empty-state">
                <i class="bi bi-arrow-repeat reports-loading-icon" aria-hidden="true"></i>
                <p class="reports-empty-state-title">Loading…</p>
            </div>`;
    }

    function renderActiveTab() {
        if (activeTab === "all") {
            if (treeRows === null) {
                renderLoadingState();
                renderReportsCounts(countsEl, null);
                loadTree();
                return;
            }
            renderPositionHierarchyTable(tableWrap, treeRows);
            renderReportsCounts(countsEl, computeHierarchyCounts(treeRows));
            return;
        }
        const config = FLAT_REPORT_TABS[activeTab];
        if (flatRows[activeTab] === null) {
            renderLoadingState();
            renderReportsCounts(countsEl, null);
            loadFlatTab(activeTab);
            return;
        }
        renderFlatTable(tableWrap, config.label, flatRows[activeTab]);
        renderSingleReportsCount(countsEl, config.label, countFlatRows(flatRows[activeTab]));
    }

    function withRange(url) {
        const params = { salesType, status: currentStatus };
        if (currentFrom) params.from = currentFrom;
        if (currentTo) params.to = currentTo;
        const qs = new URLSearchParams(params).toString();
        return qs ? `${url}?${qs}` : url;
    }

    async function loadTree() {
        const requestId = ++treeRequestSeq;
        beginLoading();
        let tree = [];
        try {
            const res = await fetch(withRange("/api/team-performance/reports/hierarchy"));
            if (!res.ok) {
                throw new Error("Failed to load position hierarchy data");
            }
            tree = await res.json();
        } catch (err) {
            tree = [];
        }
        endLoading();
        if (requestId !== treeRequestSeq) {
            return;
        }
        treeRows = flattenPositionTree(tree);
        if (activeTab === "all") {
            renderPositionHierarchyTable(tableWrap, treeRows);
            renderReportsCounts(countsEl, computeHierarchyCounts(treeRows));
        }
    }

    async function loadFlatTab(tab) {
        const config = FLAT_REPORT_TABS[tab];
        const requestId = ++flatRequestSeq[tab];
        beginLoading();
        let rows = [];
        try {
            const res = await fetch(withRange(config.endpoint));
            if (!res.ok) {
                throw new Error(`Failed to load ${config.label} report data`);
            }
            rows = await res.json();
        } catch (err) {
            rows = [];
        }
        endLoading();
        if (requestId !== flatRequestSeq[tab]) {
            return;
        }
        flatRows[tab] = rows ?? [];
        if (activeTab === tab) {
            renderFlatTable(tableWrap, config.label, flatRows[tab]);
            renderSingleReportsCount(countsEl, config.label, countFlatRows(flatRows[tab]));
        }
    }

    tabToggle?.querySelectorAll(".position-header-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.tab;
            if (tab === activeTab) {
                return;
            }
            activeTab = tab;
            tabToggle.querySelectorAll(".position-header-item").forEach((b) => b.classList.toggle("active", b === btn));
            renderActiveTab();
        });
    });

    // Primary/Secondary sales-type pill — real options fetched from
    // GET /api/team-performance/sales-types (site_master.Sales_Type), same fetch-then-render
    // convention the Status pill above uses, instead of the pill's Primary/Secondary buttons being
    // hardcoded straight into TeamPerformancePage.html. Not awaited here (initTeamReportSection stays
    // synchronous, same return shape callers already expect — see teamReportSectionHandle's own
    // header comment) — renderActiveTab already ran once above with the "secondary" fallback default
    // (salesTypeToggle's own querySelector finding nothing in the still-"Loading…" placeholder), so
    // this only needs to re-render/refetch if the real options settle on a different default.
    if (salesTypeToggle) {
        loadSalesTypePillOptions().then((types) => {
            if (!types.length) {
                salesTypeToggle.innerHTML = `<span class="brand-header-item brand-header-empty">Not Available</span>`;
                return;
            }
            const options = types.map((t) => ({ value: salesTypeToCode(t), label: t }));
            const defaultValue = options.some((opt) => opt.value === salesType) ? salesType : options[0].value;
            const defaultChanged = defaultValue !== salesType;
            salesType = defaultValue;
            salesTypeToggle.innerHTML = options
                .map((opt) => `<button type="button" class="brand-header-item${opt.value === defaultValue ? " active" : ""}" data-sales-type="${opt.value}">${opt.label}</button>`)
                .join("");
            // Invalidates every tab's cache (same "new range invalidates everything" rule
            // setDateRange below already uses) so the currently active tab refetches immediately and
            // the other three refetch lazily on next click.
            initSalesTypeFilter("teamPerformanceSalesTypeToggle", (type) => {
                salesType = type;
                treeRows = null;
                flatRows.am = null;
                flatRows.cm = null;
                flatRows.sm = null;
                renderActiveTab();
            });
            if (defaultChanged) {
                treeRows = null;
                flatRows.am = null;
                flatRows.cm = null;
                flatRows.sm = null;
                renderActiveTab();
            }
        });
    }

    // Download button opens a small popup with a scope select — "Active Tab" or "All Tabs" — and its
    // own confirm button, same pattern PrimarySalesPage.js's own Reports download uses.
    const downloadBtn = document.getElementById("teamPerformanceReportDownloadBtn");
    const downloadPopup = document.getElementById("teamPerformanceReportDownloadPopup");
    const downloadScope = document.getElementById("teamPerformanceReportDownloadScope");
    const downloadConfirmBtn = document.getElementById("teamPerformanceReportDownloadConfirm");

    const downloadPopupHandle = initDownloadPopup({ triggerBtn: downloadBtn, popupEl: downloadPopup });

    downloadConfirmBtn?.addEventListener("click", () => {
        const scope = downloadScope ? downloadScope.value : "active";
        if (scope === "both") {
            downloadTeamReportCsv([
                { label: "All Report", rows: treeRows ?? [] },
                { label: "AM", rows: flatRows.am ?? [] },
                { label: "CM", rows: flatRows.cm ?? [] },
                { label: "SM", rows: flatRows.sm ?? [] },
            ]);
        } else if (activeTab === "all") {
            downloadTeamReportCsv([{ label: "All Report", rows: treeRows ?? [] }]);
        } else {
            downloadTeamReportCsv([{ label: FLAT_REPORT_TABS[activeTab].label, rows: flatRows[activeTab] ?? [] }]);
        }
        downloadPopupHandle.close();
    });

    renderActiveTab();

    return {
        // Driven by the Filter Header's own Year/Date Filter (see teamReportSectionHandle's own
        // comment near the top of this file) — a new range invalidates every tab's cache so the
        // currently active one refetches immediately and the other three refetch lazily on next
        // click, same as a fresh page load.
        setDateRange(from, to) {
            currentFrom = from;
            currentTo = to;
            treeRows = null;
            flatRows.am = null;
            flatRows.cm = null;
            flatRows.sm = null;
            renderActiveTab();
        },
        // Filter Header's own Status toggle pill (see the initStatusFilter call's own onChange) —
        // same cache-invalidate-then-render-active-tab shape setDateRange above uses.
        setStatus(status) {
            currentStatus = status;
            treeRows = null;
            flatRows.am = null;
            flatRows.cm = null;
            flatRows.sm = null;
            renderActiveTab();
        },
    };
}

teamReportSectionHandle = initTeamReportSection();

// ==================== Person Sitemaster Report ====================
// Renamed from a page-wide "Site Master Report" section, per explicit request — now scoped to just
// whichever RM/AM/CM/SM person "Person Details" is currently showing (see initTeamSiteReport's own
// setPerson further down). Same shape/leaderboard convention as PrimarySalesPage.js's own "5.
// Site_Master Primary_Sale Report" (Rank/Site_Code/Brand/Store_Name/City/State/Region/MNT/Sales/
// Achi%/Vs LY, ranked by real Sales descending, one grand-total row) — backed by GET
// /api/team-performance/reports/site-master?level=&name=&from=&to= (TeamPerformanceReportService#
// getSiteMasterReport). Unlike that page (scoped to one sales type), this lists every one of that
// person's own active site_master rows regardless of Sales_Type (Primary AND Secondary) — see that
// method's own header comment. Reuses this page's own teamPerformanceReportMoney/renderReportsDelta/
// escapePersonName (module-top-level, already used by "Team Report" above) instead of a fresh copy —
// no block-scoping trap here, unlike the historical bug PrimarySalesReportsService's own header
// comment documents for that page's own "5." section.
const TEAM_SITE_REPORT_COLGROUP = `<colgroup>
    <col style="width:5%"><col style="width:10%"><col style="width:9%"><col style="width:8%">
    <col style="width:10%"><col style="width:10%"><col style="width:9%"><col style="width:10%">
    <col style="width:10%"><col style="width:10%"><col style="width:9%">
</colgroup>`;

const TEAM_SITE_REPORT_COLUMNS = [
    { label: "Rank", icon: "bi-trophy-fill" },
    { label: "Site_Code", icon: "bi-upc-scan" },
    { label: "Brand", icon: "bi-shop" },
    { label: "Store_Name", icon: "bi-building" },
    { label: "City", icon: "bi-geo-alt-fill" },
    { label: "State", icon: "bi-map-fill" },
    { label: "Region", icon: "bi-compass-fill" },
    { label: "MNT", icon: "bi-bullseye" },
    { label: "Sales", icon: "bi-cash-stack" },
    { label: "Achi%", icon: "bi-graph-up-arrow" },
    { label: "Vs LY", icon: "bi-arrow-left-right" },
];

function teamSiteReportHeaderCell(icon, label) {
    return `<span class="team-performance-site-report-header-cell">
        <i class="bi ${icon} team-performance-site-report-header-icon" aria-hidden="true"></i>
        <span class="team-performance-site-report-header-icon-label">${label}</span>
    </span>`;
}

function teamSiteReportAchiPct(sales, target) {
    const t = Number(target ?? 0);
    const s = Number(sales ?? 0);
    return t > 0 ? (s / t) * 100 : null;
}

function renderTeamSiteReportAchiCell(sales, target) {
    const pct = teamSiteReportAchiPct(sales, target);
    const barWidth = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
    const pctLabel = pct == null ? "—" : `${pct.toFixed(1)}%`;
    return `
        <span class="team-performance-site-report-achi-cell">
            <span class="team-performance-site-report-achi-track">
                <span class="team-performance-site-report-achi-fill" style="width:${barWidth.toFixed(1)}%"></span>
            </span>
            <span class="team-performance-site-report-achi-pct">${pctLabel}</span>
        </span>`;
}

// Client-side CSV export — keeps the full ₹ amount (formatMoneyFull, not stripped), same convention
// "Team Report"'s own downloadTeamReportCsv above already uses on this page.
function downloadTeamSiteReportCsv(rows) {
    if (!rows.length) {
        return;
    }
    const header = ["Rank", "Site_Code", "Brand", "Store_Name", "City", "State", "Region", "MNT", "Sales", "Achi %", "Vs LY %"];
    const lines = [header.join(",")];
    rows.forEach((row) => {
        const isTotal = row.rank == null;
        const pct = teamSiteReportAchiPct(row.sales, row.target);
        const pctText = pct == null ? "—" : `${pct.toFixed(1)}%`;
        const deltaText = formatDeltaSigned(row.vsLastYearPct, { nullDash: true });
        const mntValue = formatMoneyFull(row.target, { nullDash: true });
        const salesValue = formatMoneyFull(row.sales);
        const cells = [
            isTotal ? `Total: ${row.totalCount ?? 0}` : row.rank,
            row.siteCode ?? "",
            isTotal ? `Brand: ${row.brandCount ?? 0}` : (row.brand ?? ""),
            row.storeName ?? "",
            isTotal ? `City: ${row.cityCount ?? 0}` : (row.city ?? ""),
            isTotal ? `State: ${row.stateCount ?? 0}` : (row.state ?? ""),
            isTotal ? `Region: ${row.regionCount ?? 0}` : (row.region ?? ""),
            isTotal ? `MNT: ${mntValue}` : mntValue,
            isTotal ? `Sales: ${salesValue}` : salesValue,
            isTotal ? `Achi%: ${pctText}` : pctText,
            isTotal ? `Vs LY: ${deltaText}` : deltaText,
        ];
        lines.push(buildCsvLine(cells));
    });
    downloadCsv(lines, `team-site-master-report-${new Date().toISOString().slice(0, 10)}.csv`);
}

function renderTeamSiteReportTable(wrap, rows) {
    // The backend always appends its own grand-total row (rank: null) even when zero real sites
    // matched — same convention Primary's own "5. Site_Master Primary_Sale Report" uses (see
    // getSiteMasterReport's own header comment). Real "no data" here means no RANKED row at all;
    // showing just that lone all-zero Total row would be misleading, so it's excluded too.
    const realRows = rows.filter((row) => row.rank != null);
    const bodyRows = !realRows.length
        ? `<tr><td colspan="${TEAM_SITE_REPORT_COLUMNS.length}" class="team-performance-site-report-table-empty">
            <div class="reports-empty-state">
                <i class="bi bi-inbox reports-empty-state-icon" aria-hidden="true"></i>
                <p class="reports-empty-state-title">No data available</p>
            </div>
        </td></tr>`
        : rows.map((row) => {
            const isTotal = row.rank == null;
            const rankCell = isTotal
                ? `<i class="bi bi-calculator team-performance-site-report-row-icon" aria-hidden="true"></i>`
                : row.rank;
            const nameCell = isTotal
                ? `<span class="team-performance-site-report-name-cell"><span>Total: ${row.totalCount ?? 0}</span></span>`
                : `<span class="team-performance-site-report-name-cell">
                        <span class="team-performance-site-report-row-icon-wrap">
                            <i class="bi bi-shop team-performance-site-report-row-icon" aria-hidden="true"></i>
                            <span class="team-performance-site-report-row-icon-label">Site</span>
                        </span>
                        <span>${row.siteCode}</span>
                   </span>`;
            const brandCell = isTotal ? `Brand: ${row.brandCount ?? 0}` : (row.brand ?? "—");
            const cityCell = isTotal ? `City: ${row.cityCount ?? 0}` : (row.city ?? "—");
            const stateCell = isTotal ? `State: ${row.stateCount ?? 0}` : (row.state ?? "—");
            const regionCell = isTotal ? `Region: ${row.regionCount ?? 0}` : (row.region ?? "—");
            const mntValue = teamPerformanceReportMoney(row.target, { nullDash: true, round: false });
            const salesValue = teamPerformanceReportMoney(row.sales, { round: false });
            const storeName = row.storeName ?? "—";
            return `
        <tr${isTotal ? ' class="team-performance-site-report-total-row"' : ""}>
            <td>${rankCell}</td>
            <td>${nameCell}</td>
            <td>${brandCell}</td>
            <td class="team-performance-site-report-store-name-cell" title="${escapePersonName(storeName)}">${storeName}</td>
            <td>${cityCell}</td>
            <td>${stateCell}</td>
            <td>${regionCell}</td>
            <td>${isTotal ? `MNT: ${mntValue}` : mntValue}</td>
            <td>${isTotal ? `Sales: ${salesValue}` : salesValue}</td>
            <td>${isTotal ? "Achi%: " : ""}${renderTeamSiteReportAchiCell(row.sales, row.target)}</td>
            <td>${isTotal ? "Vs LY: " : ""}${renderReportsDelta(row.vsLastYearPct)}</td>
        </tr>`;
        }).join("");

    wrap.innerHTML = `
        <table class="team-performance-site-report-table">
            ${TEAM_SITE_REPORT_COLGROUP}
            <thead>
                <tr>${TEAM_SITE_REPORT_COLUMNS.map((col) => `<th>${teamSiteReportHeaderCell(col.icon, col.label)}</th>`).join("")}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>`;
}

// "Person Sitemaster Report" — renamed from a page-wide section, per explicit request: now shown
// only once a person is picked (setPerson, called from openPersonDetails' own open() below, same
// trigger "Person Details"/"Daily Sales" use), scoped to just that RM/AM/CM/SM person's own sites
// (level+name, same real site_master column filter this drill-down's other endpoints already use).
// Still driven by the Filter Header's own Date Filter above for its own Target/Sales period (same
// effective range "Team Report" uses, see getTeamPerformanceEffectiveRange's own comment) —
// independent of "Person Details"' own scoped FY Filter, which only affects that card + Daily Sales.
function initTeamSiteReport() {
    const sectionContainer = document.getElementById("teamPerformanceSiteReportSectionContainer");
    const card = document.getElementById("teamPerformanceSiteReportCard");
    const wrap = document.getElementById("teamPerformanceSiteReportTableWrap");
    const downloadBtn = document.getElementById("teamPerformanceSiteReportDownloadBtn");
    if (!sectionContainer || !card || !wrap) {
        return { setDateRange() {}, setPerson() {}, setStatus() {} };
    }
    let siteReportRows = [];
    let periodFrom = null;
    let periodTo = null;
    let currentLevel = null;
    let currentName = null;
    // Filter Header's own Status toggle pill (#teamPerformanceStatusFilterToggle) — see
    // the initStatusFilter call/setStatus below.
    let currentStatus = teamStatusFilter;
    let requestSeq = 0;
    downloadBtn?.addEventListener("click", () => downloadTeamSiteReportCsv(siteReportRows));

    // No-ops until a person has actually been picked (currentLevel/currentName both set by
    // setPerson) — same "nothing to show yet" gate Person Details' own loadFyOverview implicitly
    // gets from its section starting `hidden`, made explicit here since this function can also be
    // called by the Filter Header's own Date Filter before any person is ever clicked.
    function refresh() {
        if (!currentLevel || !currentName) {
            return;
        }
        const requestId = ++requestSeq;
        card.classList.add("is-loading");
        const params = new URLSearchParams({ level: currentLevel, name: currentName, status: currentStatus });
        if (periodFrom && periodTo) {
            params.set("from", periodFrom);
            params.set("to", periodTo);
        }
        fetch(`/api/team-performance/reports/site-master?${params.toString()}`)
            .then((res) => {
                if (!res.ok) {
                    throw new Error("Failed to load Person Sitemaster Report data");
                }
                return res.json();
            })
            .then((rows) => {
                if (requestId !== requestSeq) {
                    return;
                }
                siteReportRows = rows ?? [];
                renderTeamSiteReportTable(wrap, siteReportRows);
            })
            .catch(() => {
                if (requestId !== requestSeq) {
                    return;
                }
                renderTeamSiteReportTable(wrap, []);
            })
            .finally(() => {
                if (requestId === requestSeq) {
                    card.classList.remove("is-loading");
                }
            });
    }

    function setDateRange(from, to) {
        periodFrom = from || null;
        periodTo = to || null;
        refresh();
    }

    // Called by openPersonDetails' own open() (see initPersonDetailsSection below) whenever a name
    // is clicked in "Team Report" — unhides this section (starts `hidden` in the markup, same as
    // "Person Details"/"Daily Sales", for the unrelated "no person picked yet" reason) and
    // (re)fetches for that person, but only once the session's real permission set confirms it
    // actually holds "page:team-insights.person-sitemaster-report" — awaits the same promise every
    // other gated reveal on this page does, never a second /api/auth/me fetch.
    async function setPerson(level, name) {
        currentLevel = level;
        currentName = name;
        const permissions = await pagePermissionsPromise;
        sectionContainer.hidden = !permissions.has("page:team-insights.person-sitemaster-report");
        refresh();
    }

    // Filter Header's own Status toggle pill — same "no-op until a person is picked" gate refresh()
    // already enforces.
    function setStatus(status) {
        currentStatus = status;
        refresh();
    }

    const initialRange = getTeamPerformanceEffectiveRange();
    periodFrom = initialRange.from;
    periodTo = initialRange.to;
    return { setDateRange, setPerson, setStatus };
}

teamSiteReportSectionHandle = initTeamSiteReport();

// ==================== Person Details + Daily Sales ====================
// Shown once a name is clicked anywhere in "Team Report" above (see the tableWrap click delegation
// inside initTeamReportSection, which calls openPersonDetails below). Left: an FY card, exact same
// Month x Primary/Secondary Target/Sales/Achi./Vs Last Year table design as Dashboard's own "1.
// Overview" (index.html/Dashboard.js's renderDashboardFyOverviewTable) — defaults to the real
// current FY (TEAM_PERFORMANCE_FY_CURRENT_KEY), with its own scoped FY Filter dropdown
// (initTeamPersonFyYearFilter) to view a different one. Right: a
// Person card (persona identity + assigned site-code list/count). Below both: a Daily Sales ECharts
// graph, same frontend idea as Primary Sales page's own Daily Trend Graph, combining this person's
// Primary+Secondary Sales.
const PERSON_LEVEL_LABELS = { rm: "RM", am: "AM", cm: "CM", sm: "SM" };

// HTML-attribute escaping for the money tooltips below (title="...") — same escapeAttr Dashboard.js
// carries its own copy of, per this codebase's per-page-own-copy convention.
function escapeAttr(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Signed abbreviated money ("+1.5 Cr" / "-30,000") for the Achi./Vs Last Year cells below — same
// formatVariance Dashboard.js's own "1. Overview" FY table uses, ported here since this page's own
// teamPerformanceReportMoney (already ₹-stripped) doesn't sign positives on its own.
function personFormatVariance(value) {
    if (value === null || value === undefined) {
        return "—";
    }
    const num = Number(value);
    const sign = num > 0 ? "+" : (num < 0 ? "-" : "");
    return `${sign}${teamPerformanceReportMoney(Math.abs(num), { round: false })}`;
}

// On-screen Target/Sales cell — abbreviated Cr/L (teamPerformanceReportMoney), full un-abbreviated
// rupee amount in the title attribute so a long hover reveals the real number — same fyMoneyCell
// Dashboard.js's own "1. Overview" FY table uses. allowDash mirrors that table's own "no data
// entered yet" (—) vs "the real figure is actually zero" distinction; the Total/YTD rows never want
// that dash.
function personFyMoneyTd(value, allowDash, groupClass) {
    const cls = groupClass ? ` class="${groupClass}"` : "";
    if (allowDash && !value) {
        return `<td${cls}>—</td>`;
    }
    return `<td${cls} title="${escapeAttr(formatMoneyFull(value))}">${teamPerformanceReportMoney(value, { round: false })}</td>`;
}

// Same "previous is 0" null-growth rule GrowthMath.growthPct (backend) uses — mirrored here since
// Achi./Vs Last Year are computed client-side from the raw target/sales/lastYearSales this page's
// own /person/fy-overview response carries (see PersonFyOverviewResponse's own header comment).
function personGrowthPct(current, previous) {
    const cur = Number(current ?? 0);
    const prev = Number(previous ?? 0);
    if (prev !== 0) {
        return ((cur - prev) / prev) * 100;
    }
    return cur === 0 ? 0 : null;
}

// Achi. cell — progress bar + % + a variance-amount span (e.g. "/ +1.2 L"), full tooltip on hover —
// same renderAchiCell Dashboard.js's own "1. Overview" FY table uses (this page's own personAchiCell
// used to be a plain bar+% with no variance span; per explicit request this card is now a faithful
// visual copy of Dashboard's own FY table).
function personAchiCell(sales, target) {
    const t = Number(target ?? 0);
    const s = Number(sales ?? 0);
    const pct = t > 0 ? (s / t) * 100 : null;
    const barWidth = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
    const pctLabel = pct == null ? "—" : `${pct.toFixed(1)}%`;
    const variance = t ? s - t : null;
    const varianceLabel = variance == null ? "—" : personFormatVariance(variance);
    const varianceCls = variance == null ? "" : ` ${variance >= 0 ? "positive" : "negative"}`;
    return `
        <span class="dashboard-achi-cell">
            <span class="dashboard-achi-track"><span class="dashboard-achi-fill" style="width:${barWidth.toFixed(1)}%"></span></span>
            <span class="dashboard-achi-pct">${pctLabel}</span>
            <span class="dashboard-achi-variance${varianceCls}" title="${escapeAttr(variance == null ? "" : formatMoneyFull(variance))}">/ ${varianceLabel}</span>
        </span>`;
}

// "Vs Last Year" cell — the variance AMOUNT alongside the growth % AND the real Last Year figure
// itself, all in one cell — same renderYoyVariance Dashboard.js's own "1. Overview" FY table uses
// (this page's own personDeltaCell used to show just the bare growth %; per explicit request this
// card is now a faithful visual copy of Dashboard's own FY table). "—" when either side is missing
// real data. The Last Year figure sits in its own .dashboard-delta-lastyear span so it keeps a fixed
// muted color instead of inheriting the surrounding positive/negative trend color.
function personYoyVarianceCell(current, previous) {
    const cur = Number(current ?? 0);
    const prev = Number(previous ?? 0);
    if (!cur || !prev) {
        return "—";
    }
    const diff = cur - prev;
    const cls = diff >= 0 ? "positive" : "negative";
    return `<span class="dashboard-delta ${cls}" title="Last Year: ${escapeAttr(formatMoneyFull(prev))}">${personFormatVariance(diff)} (${formatDelta(personGrowthPct(cur, prev))}) / <span class="dashboard-delta-lastyear">${teamPerformanceReportMoney(prev, { round: false })}</span></span>`;
}

// "2026-04" -> "Apr-26", same short-month + 2-digit-year shape the rest of this app's own Daily
// Sales axis labels use (see SiteDetailTrendService's own DAY_LABEL_FORMAT comment).
function personMonthLabel(yearMonthStr) {
    const [year, month] = yearMonthStr.split("-").map(Number);
    return `${new Date(year, month - 1, 1).toLocaleString("en-US", { month: "short" })}-${String(year).slice(2)}`;
}

// Apr(0)..Mar(11) index of the real current calendar month within its own FY — same
// getCurrentFyMonthIndex Dashboard.js's own "1. Overview" FY table uses, ported here for the same
// Actual/Current/Projection month split (see personFyMonthType below).
function getCurrentFyMonthIndex() {
    const jsMonth = new Date().getMonth();
    return (jsMonth + 9) % 12;
}

// Every month of a FULLY ELAPSED FY (any FY other than the real current one — this card's FY Filter
// only ever offers the real current FY + the 2 before it, never a future one) renders "actual"; the
// real current FY additionally splits into Actual (already happened)/Current (this month)/Projection
// (hasn't happened yet) — same buildDashboardFyMonths split Dashboard.js's own "1. Overview" FY table
// uses, driving both this row's own CSS tint (.dashboard-fy-row--actual/-current/-projection) and
// renderPersonFyTable's own "show Target as an on-plan stand-in for Sales" rule for Projection months.
function personFyMonthType(fyKey, index) {
    if (fyKey !== TEAM_PERFORMANCE_FY_CURRENT_KEY) {
        return "actual";
    }
    const currentIndex = getCurrentFyMonthIndex();
    if (index === currentIndex) {
        return "current";
    }
    return index < currentIndex ? "actual" : "projection";
}

// Exact frontend architecture mirror of Dashboard.js's own renderDashboardFyOverviewTable (money-cell
// tooltips, Achi. variance span, combined Vs Last Year cell, Actual/Current/Projection row tinting,
// the current month's own "See Total" button revealing a YTD subtotal row) — per explicit request,
// this card is now a faithful visual + behavioral copy of Dashboard's own "1. Overview" FY table,
// scoped to just this one person's own assigned sites instead of the whole business.
function renderPersonFyTable(tbody, data) {
    if (!data || !data.months || !data.months.length) {
        tbody.innerHTML = `<tr class="dashboard-fy-row--loading"><td colspan="9">No data available</td></tr>`;
        return;
    }

    let pTargetTotal = 0, sTargetTotal = 0, pSalesTotal = 0, sSalesTotal = 0, pLastYearTotal = 0, sLastYearTotal = 0;
    // YTD (Apr..current month) subtotal — snapshotted the moment the "current" row is reached below
    // (Projection months never contribute), same "See Total" idea Dashboard's own table uses. Stays
    // all-zero (and its own row never renders) for any FY other than the real current one, which is
    // exactly when this feature makes sense.
    let ytdPTarget = 0, ytdSTarget = 0, ytdPSales = 0, ytdSSales = 0, ytdPLastYear = 0, ytdSLastYear = 0;
    let ytdRowHtml = "";

    const monthRows = data.months.map((ym, i) => {
        const type = personFyMonthType(data.fyKey, i);
        const pTarget = Number(data.primaryTarget[i] ?? 0);
        const sTarget = Number(data.secondaryTarget[i] ?? 0);
        const realPSales = Number(data.primarySales[i] ?? 0);
        const realSSales = Number(data.secondarySales[i] ?? 0);
        const pLastYear = Number(data.primaryLastYearSales[i] ?? 0);
        const sLastYear = Number(data.secondaryLastYearSales[i] ?? 0);
        // Projection months (haven't happened yet) have no real Sales — per explicit request, they
        // display that month's own Target instead (an "on-plan" stand-in), same as Dashboard's table.
        const displayPSales = type === "projection" ? pTarget : realPSales;
        const displaySSales = type === "projection" ? sTarget : realSSales;

        pTargetTotal += pTarget;
        sTargetTotal += sTarget;
        pSalesTotal += displayPSales;
        sSalesTotal += displaySSales;
        pLastYearTotal += pLastYear;
        sLastYearTotal += sLastYear;

        if (type !== "projection") {
            ytdPTarget += pTarget;
            ytdSTarget += sTarget;
            ytdPSales += realPSales;
            ytdSSales += realSSales;
            ytdPLastYear += pLastYear;
            ytdSLastYear += sLastYear;
        }

        const monthLabel = personMonthLabel(ym);
        const monthCell = type === "current"
            ? `<span class="dashboard-fy-overview-month-cell">
                   <span class="dashboard-fy-overview-month-text">${monthLabel}</span>
                   <button type="button" class="dashboard-fy-see-total-btn" aria-expanded="false">See Total</button>
               </span>`
            : monthLabel;

        if (type === "current") {
            ytdRowHtml = `
                <tr class="dashboard-fy-row--ytd" id="teamPerformancePersonFyYtdRow" hidden>
                    <td class="dashboard-fy-overview-month-col">${personMonthLabel(data.months[0])} – ${monthLabel} (YTD)</td>
                    ${personFyMoneyTd(ytdPTarget, false, "dashboard-fy-overview-group-primary")}
                    ${personFyMoneyTd(ytdPSales, false, "dashboard-fy-overview-group-primary")}
                    <td class="dashboard-fy-overview-group-primary">${personAchiCell(ytdPSales, ytdPTarget)}</td>
                    <td class="dashboard-fy-overview-group-primary">${personYoyVarianceCell(ytdPSales, ytdPLastYear)}</td>
                    ${personFyMoneyTd(ytdSTarget, false, "dashboard-fy-overview-group-secondary")}
                    ${personFyMoneyTd(ytdSSales, false, "dashboard-fy-overview-group-secondary")}
                    <td class="dashboard-fy-overview-group-secondary">${personAchiCell(ytdSSales, ytdSTarget)}</td>
                    <td class="dashboard-fy-overview-group-secondary">${personYoyVarianceCell(ytdSSales, ytdSLastYear)}</td>
                </tr>`;
        }

        return `
            <tr class="dashboard-fy-row--${type}">
                <td class="dashboard-fy-overview-month-col">${monthCell}</td>
                ${personFyMoneyTd(pTarget, true, "dashboard-fy-overview-group-primary")}
                ${personFyMoneyTd(displayPSales, true, "dashboard-fy-overview-group-primary")}
                <td class="dashboard-fy-overview-group-primary">${personAchiCell(displayPSales, pTarget)}</td>
                <td class="dashboard-fy-overview-group-primary">${personYoyVarianceCell(displayPSales, pLastYear)}</td>
                ${personFyMoneyTd(sTarget, true, "dashboard-fy-overview-group-secondary")}
                ${personFyMoneyTd(displaySSales, true, "dashboard-fy-overview-group-secondary")}
                <td class="dashboard-fy-overview-group-secondary">${personAchiCell(displaySSales, sTarget)}</td>
                <td class="dashboard-fy-overview-group-secondary">${personYoyVarianceCell(displaySSales, sLastYear)}</td>
            </tr>${type === "current" ? ytdRowHtml : ""}`;
    }).join("");

    const totalRow = `
        <tr class="dashboard-fy-row--total">
            <td class="dashboard-fy-overview-month-col">Total</td>
            ${personFyMoneyTd(pTargetTotal, false, "dashboard-fy-overview-group-primary")}
            ${personFyMoneyTd(pSalesTotal, false, "dashboard-fy-overview-group-primary")}
            <td class="dashboard-fy-overview-group-primary">${personAchiCell(pSalesTotal, pTargetTotal)}</td>
            <td class="dashboard-fy-overview-group-primary">${personYoyVarianceCell(pSalesTotal, pLastYearTotal)}</td>
            ${personFyMoneyTd(sTargetTotal, false, "dashboard-fy-overview-group-secondary")}
            ${personFyMoneyTd(sSalesTotal, false, "dashboard-fy-overview-group-secondary")}
            <td class="dashboard-fy-overview-group-secondary">${personAchiCell(sSalesTotal, sTargetTotal)}</td>
            <td class="dashboard-fy-overview-group-secondary">${personYoyVarianceCell(sSalesTotal, sLastYearTotal)}</td>
        </tr>`;
    tbody.innerHTML = monthRows + totalRow;
}

// "See Total" toggle for the current month's own row — delegated on the tbody (not bound per-button)
// since renderPersonFyTable rebuilds every <tr>, button included, on every person/FY change — same
// initDashboardFySeeTotal Dashboard.js's own "1. Overview" FY table uses. #teamPerformancePersonFy
// YtdRow is rebuilt fresh (and re-hidden) on every render too, so this toggle's own on/off state
// deliberately doesn't persist across a change — there's nothing to persist, it's a new row.
(function initTeamPersonFySeeTotal() {
    const body = document.getElementById("teamPerformancePersonFyBody");
    if (!body) {
        return;
    }
    body.addEventListener("click", (event) => {
        const btn = event.target.closest(".dashboard-fy-see-total-btn");
        if (!btn) {
            return;
        }
        const ytdRow = document.getElementById("teamPerformancePersonFyYtdRow");
        if (!ytdRow) {
            return;
        }
        const opening = ytdRow.hidden;
        ytdRow.hidden = !opening;
        btn.textContent = opening ? "Hide Total" : "See Total";
        btn.setAttribute("aria-expanded", String(opening));
    });
})();

// A person's assigned sites (site_master.Sales_Type, same real classification
// SiteStatusPage.js's own resolveSalesTypeFlags reads) are Primary-only, Secondary-only, or a mix
// of both — per explicit request, the FY card below shows only the column group(s) that person
// actually has. No sites yet / an unrecognized value falls back to showing both, same "don't hide
// data we can't classify" convention resolveSalesTypeFlags uses.
function resolvePersonSalesTypeFlags(sites) {
    const hasPrimary = (sites || []).some((site) => String(site.salesType ?? "").toLowerCase().includes("primary"));
    const hasSecondary = (sites || []).some((site) => String(site.salesType ?? "").toLowerCase().includes("secondary"));
    if (!hasPrimary && !hasSecondary) {
        return { showPrimary: true, showSecondary: true };
    }
    return { showPrimary: hasPrimary, showSecondary: hasSecondary };
}

// Toggles which column group(s) (.dashboard-fy-overview-group-primary/-secondary, both the thead's
// own group header/sub-headers and every tbody row's own cells — see renderPersonFyTable) are
// visible on the FY card, scoped under #teamPerformancePersonFyCard so this never touches
// Dashboard.js's/SiteStatusPage.js's own same-named classes elsewhere.
function applyPersonSalesTypeVisibility(flags) {
    const card = document.getElementById("teamPerformancePersonFyCard");
    if (!card) {
        return;
    }
    card.classList.toggle("hide-primary-group", !flags.showPrimary);
    card.classList.toggle("hide-secondary-group", !flags.showSecondary);
}

// Same fixed identity colors the Person FY card's own Primary/Secondary Sales column-group headers
// use (see .dashboard-fy-overview-group-primary/-secondary in TeamPerformancePage.css) — Compare
// mode below splits the single combined Sales line into these same two series, so the two views
// read as the same two categories at a glance instead of picking arbitrary new colors.
const TEAM_DAILY_TREND_COMPARE_TYPES = [
    { key: "primary", label: "Primary Sales", color: "#16A34A" },
    { key: "secondary", label: "Secondary Sales", color: "#2563EB" },
];
const TEAM_DAILY_TREND_GRANULARITY_LABEL = { day: "Daily", month: "Monthly", year: "Yearly" };
const TEAM_DAILY_TREND_PERIOD_LABEL = { day: "Date", month: "Month", year: "Year" };

// LINE_COLOR is a plain hex string (from the CSS var read below) — fades it to a given alpha for
// the Sales line's own area-fill gradient stops, same helper PrimarySalesPage.js's own
// initDailyTrendGraph uses, ported here rather than shared since nothing else on this page needs it.
function teamDailyTrendHexToRgba(hex, alpha) {
    const clean = String(hex).replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ECharts-based Daily Sales graph — full frontend parity with Primary Sales page's own Daily Trend
// Graph (PrimarySalesPage.js's initDailyTrendGraph), per explicit request: Vs Last Year toggle,
// Compare toggle (there: brand vs brand; here: Primary vs Secondary Sales — a person has no Brand
// of their own, so this page's own real per-person split dimension stands in for it), dark rich
// tooltip, Bar Graph per-bar growth labels. No independent brand/date filter bar of its own (Primary's
// own copy dropped that too) — always shows that FY's own 12 months (Apr-Mar, state.fyKey), driven
// entirely by "Person Details"' own scoped FY Filter (setFyKey, see initTeamPersonFyYearFilter) — not
// this page's own Filter Header Date Filter, per explicit request.
function initTeamPersonDailyTrend() {
    const chartDom = document.getElementById("teamPerformanceDailyTrendChart");
    const modeBadge = document.getElementById("teamPerformanceDailyTrendModeBadge");
    const summaryEl = document.getElementById("teamPerformanceDailyTrendSelectionSummary");
    const typeToggle = document.getElementById("teamPerformanceDailyTrendChartTypeToggle");
    const compareToggle = document.getElementById("teamPerformanceDailyTrendCompareToggle");
    const targetToggle = document.getElementById("teamPerformanceDailyTrendTargetToggle");
    const vsLastYearToggle = document.getElementById("teamPerformanceDailyTrendVsLastYearToggle");
    const titleEl = document.getElementById("teamPerformanceDailyTrendTitle");
    if (!chartDom || typeof window.echarts === "undefined") {
        return { setPerson() {}, refresh() {}, setStatus() {} };
    }

    const chart = window.echarts.init(chartDom);
    // showTarget starts true (unlike showLastYear) — the Target line used to always be drawn
    // unconditionally here, same reasoning Dashboard.js's own state.showTarget default gives.
    const state = {
        chartType: "line", level: null, name: null, compare: false, showLastYear: false, showTarget: true,
        // Which FY this chart shows — driven by "Person Details"' own FY card FY Filter (see
        // setFyKey below), not the page's Filter Header Date Filter (that one only drives "Team
        // Report" now — see getTeamPerformanceEffectiveRange's own comment).
        fyKey: TEAM_PERFORMANCE_FY_CURRENT_KEY,
        // Filter Header's own Status toggle pill (#teamPerformanceStatusFilterToggle) — see
        // the initStatusFilter call/setStatus below.
        status: teamStatusFilter,
    };
    let currentData = null;
    let requestSeq = 0;

    // Theme-aware colors, re-resolved on "theme-changed" (dispatched by QuickAccessPanel.js's theme
    // toggle) — same pattern PrimarySalesPage.js's own resolveDailyTrendColors uses, so switching
    // theme repaints this chart immediately instead of leaving it stuck on stale colors.
    let axisColor, gridLineColor, salesColor, targetColor, posColor, negColor, naColor, lastYearColor;
    function resolveColors() {
        const root = getComputedStyle(document.documentElement);
        axisColor = root.getPropertyValue("--color-text-secondary").trim() || "#66756F";
        gridLineColor = root.getPropertyValue("--color-border").trim() || "#DCE7E2";
        salesColor = root.getPropertyValue("--color-success").trim() || "#16803C";
        targetColor = root.getPropertyValue("--color-text-secondary").trim() || "#595f5c";
        posColor = root.getPropertyValue("--color-success").trim() || "#16803C";
        negColor = root.getPropertyValue("--color-danger").trim() || "#DC2626";
        naColor = root.getPropertyValue("--color-text-secondary").trim() || "#9CA3AF";
        lastYearColor = root.getPropertyValue("--color-warning").trim() || "#D97706";
    }
    resolveColors();

    // Always monthly (12 points, Apr-Mar) — this chart shows the same FY the Person FY card above it
    // is currently showing (state.fyKey, set by that card's own FY Filter), per explicit request, so
    // "month" is the only granularity that ever makes sense here now.
    function resolveGranularity() {
        return "month";
    }

    // Short axis/label amount ("1.5 Cr") — reuses this page's own teamPerformanceReportMoney (same
    // Cr/Lakh abbreviation every other card here already uses) instead of duplicating
    // PrimarySalesPage.js's own separate formatIndianAmount.
    function shortAmount(value) {
        return teamPerformanceReportMoney(value, { round: false });
    }

    // Full comma-grouped amount for tooltip precision — reuses formatMoneyFull (imported), same
    // convention this page's own CSV export already uses.
    function fullAmount(value) {
        return formatMoneyFull(value).replace("₹", "");
    }

    // "2026-04-05"/"2026-04"/"2026" -> the full, unambiguous period shown on hover ("05 Apr 2026" /
    // "April 2026" / "2026") — mirrors PrimarySalesPage.js's own formatPeriod.
    function formatPeriod(dateStr, granularity) {
        if (!dateStr) return "";
        if (granularity === "year") return dateStr;
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

    // The overall selected window (backend's `period.from`/`period.to`) formatted the way a user
    // would describe their own selection — mirrors PrimarySalesPage.js's own formatSelectedPeriod.
    function formatSelectedPeriod(period, granularity) {
        if (!period || !period.from || !period.to) return "—";
        if (granularity === "month" && period.from.slice(0, 7) === period.to.slice(0, 7)) {
            const [y, m] = period.from.split("-").map(Number);
            return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
        }
        if (period.from === period.to) return formatFullDate(period.from);
        return `${formatFullDate(period.from)} – ${formatFullDate(period.to)}`;
    }

    // Colored % for the tooltip's dark background — brighter tints than the app's normal
    // --color-success/--color-danger (tuned for light card backgrounds) so they stay readable here,
    // same convention PrimarySalesPage.js's own formatGrowth uses.
    function formatGrowthTooltip(value) {
        if (value === null || value === undefined) {
            return '<span style="color:#9CA3AF;">— N/A</span>';
        }
        const isUp = value >= 0;
        const color = isUp ? "#4ADE80" : "#F87171";
        const sign = isUp ? "+" : "−";
        return `<span style="color:${color};font-weight:600;">${sign}${Math.abs(value).toFixed(1)}%</span>`;
    }

    // Right-aligned summary line under the header — spells out every input this chart currently
    // reads (period, point count, the person it's scoped to, Vs Last Year/Compare state) all at
    // once, same idea as PrimarySalesPage.js's own updateSelectionSummary (there: Brand/Channel
    // instead of Person, since this page has no Brand/Channel dimension of its own).
    function updateSelectionSummary(granularity) {
        if (!summaryEl) return;
        if (!currentData) {
            summaryEl.textContent = "—";
            return;
        }
        const unitLabel = { day: "day", month: "month", year: "year" }[granularity] || "period";
        const count = (currentData.labels || []).length;
        const countLabel = `${count} ${unitLabel}${count === 1 ? "" : "s"}`;
        const periodLabel = formatSelectedPeriod(currentData.period, granularity);
        const compareLabel = state.compare ? "Yes (Primary vs Secondary)" : "No";
        const parts = [
            `Selected: <strong>${periodLabel}</strong>`,
            `<strong>${countLabel}</strong>`,
            `Person: <strong>${state.name || "—"}</strong>`,
            `Vs Last Year: <strong>${state.showLastYear ? "Yes" : "No"}</strong>`,
            `Compare: <strong>${compareLabel}</strong>`,
        ];
        summaryEl.innerHTML = parts.map((p) => `<span class="daily-trend-selection-summary-part">${p}</span>`).join("");
    }

    function tooltipFormatter(params) {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0];
        if (!first || !currentData) return "";
        const idx = first.dataIndex;
        const granularity = currentData.granularity || "month";
        const periodField = TEAM_DAILY_TREND_PERIOD_LABEL[granularity] || "Period";
        const periodValue = formatPeriod((currentData.dates || [])[idx], granularity) || first.name;

        // Compare mode: one block per sales type (Sales/Target/Sales Variance, both real per this
        // page's own /person/trend-range response) plus a combined Total row — mirrors
        // PrimarySalesPage.js's own Compare-mode tooltip (there: one block per brand).
        if (state.compare) {
            // No per-sales-type Last Year row here — /person/trend-range only ever returns one
            // combined `lastYear` array (not split by sales type), same reason Compare mode has no
            // per-type Target row either.
            let totalSales = 0;
            const rows = TEAM_DAILY_TREND_COMPARE_TYPES.map((type) => {
                const salesVal = Number((currentData[type.key] || [])[idx] ?? 0);
                totalSales += salesVal;
                return `
                    <div style="margin-top:3px;padding-top:2px;border-top:1px solid rgba(255,255,255,0.15);">
                        <div><span style="color:${type.color};">●</span> <strong>${type.label}</strong></div>
                        <div>Sales: <strong>${fullAmount(salesVal)}</strong></div>
                    </div>`;
            }).join("");
            const totalRow = `
                <div style="margin-top:3px;padding-top:2px;border-top:1px solid rgba(255,255,255,0.35);">
                    <div><strong>Total</strong></div>
                    <div>Sales: <strong>${fullAmount(totalSales)}</strong></div>
                </div>`;
            return `
                <div style="font-size:8px;line-height:1.2;min-width:135px;">
                    <div>${periodField}: <strong>${periodValue}</strong></div>
                    ${rows}
                    ${totalRow}
                </div>`;
        }

        const salesVal = (currentData.total || [])[idx];
        const targetVal = (currentData.target || [])[idx];
        const lastYearVal = (currentData.lastYear || [])[idx];
        const vsTargetGrowth = personGrowthPct(salesVal, targetVal);
        const vsLastYearGrowth = personGrowthPct(salesVal, lastYearVal);
        const periodUnit = (TEAM_DAILY_TREND_PERIOD_LABEL[granularity] || "period").toLowerCase();
        return `
            <div style="font-size:8px;line-height:1.2;min-width:105px;">
                <div>${periodField}: <strong>${periodValue}</strong></div>
                <div>Person: <strong>${state.name || "—"}</strong></div>
                <div>Sales: <strong>${fullAmount(salesVal)}</strong></div>
                <div>Target: <strong>${fullAmount(targetVal)}</strong></div>
                <div>Sales vs Target: ${formatGrowthTooltip(vsTargetGrowth)}</div>
                <div>vs Last Year (same ${periodUnit}): ${formatGrowthTooltip(vsLastYearGrowth)}</div>
            </div>`;
    }

    function renderEmpty() {
        chart.setOption({
            grid: { left: 52, right: 16, top: 24, bottom: 30 },
            xAxis: { type: "category", data: [] },
            yAxis: { type: "value" },
            series: [],
        }, true);
        if (modeBadge) modeBadge.textContent = "—";
        if (summaryEl) summaryEl.textContent = "Select a name in Team Report above";
    }

    function renderChart() {
        if (!currentData) {
            renderEmpty();
            return;
        }
        const isBar = state.chartType === "bar";
        const labels = currentData.labels || [];
        const target = currentData.target || [];
        chart.resize();

        let series;
        let legendData;

        if (state.compare) {
            // One series per sales type instead of the single combined Sales line — same color
            // every solid-fill data row on this page's Person FY card already uses for that sales
            // type, so Compare mode reads as the same two categories at a glance. No Target overlay
            // (a single combined target isn't meaningfully split per sales type — this page's own
            // /person/trend-range response only ever returns one combined `target` array) and no
            // per-bar value labels (2 series grouped per x-axis point would just collide) — same
            // reasoning PrimarySalesPage.js's own Compare mode uses for brands.
            series = TEAM_DAILY_TREND_COMPARE_TYPES.map((type) => ({
                name: type.label,
                type: state.chartType,
                data: currentData[type.key] || [],
                smooth: !isBar,
                showSymbol: !isBar,
                symbol: "circle",
                symbolSize: 6,
                connectNulls: false,
                itemStyle: { color: type.color },
                areaStyle: isBar ? undefined : {
                    color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: teamDailyTrendHexToRgba(type.color, 0.32) },
                        { offset: 1, color: teamDailyTrendHexToRgba(type.color, 0.02) },
                    ]),
                },
                lineStyle: isBar ? undefined : { width: 2, color: type.color },
                z: 2,
            }));
            legendData = TEAM_DAILY_TREND_COMPARE_TYPES.map((type) => type.label);
        } else {
            const salesSeries = {
                name: "Sales",
                type: state.chartType,
                data: currentData.total || [],
                smooth: !isBar,
                showSymbol: !isBar,
                symbol: "circle",
                symbolSize: 6,
                connectNulls: false,
                itemStyle: { color: salesColor },
                areaStyle: isBar ? undefined : {
                    color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: teamDailyTrendHexToRgba(salesColor, 0.32) },
                        { offset: 1, color: teamDailyTrendHexToRgba(salesColor, 0.02) },
                    ]),
                },
                lineStyle: isBar ? undefined : { width: 2, color: salesColor },
                barWidth: isBar ? "50%" : undefined,
                z: 2,
            };

            // Bar Graph mode only: every bar always shows its own short Sales value + growth-vs-Target
            // above it — same always-on (no click needed) two-line rich-text label
            // PrimarySalesPage.js's own Bar Graph mode uses.
            if (isBar) {
                salesSeries.label = {
                    show: true,
                    position: "top",
                    distance: 4,
                    formatter: (params) => {
                        const idx = params.dataIndex;
                        const salesVal = (currentData.total || [])[idx];
                        const targetVal = target[idx];
                        const growth = personGrowthPct(salesVal, targetVal);
                        const growthKey = growth === null ? "na" : growth >= 0 ? "pos" : "neg";
                        const growthLabel = growth === null ? "N/A" : `${growth >= 0 ? "+" : "−"}${Math.abs(growth).toFixed(1)}%`;
                        return `{val|${shortAmount(salesVal)}}\n{${growthKey}|${growthLabel}}`;
                    },
                    rich: {
                        val: { color: axisColor, fontSize: 9, fontWeight: 700, lineHeight: 11, align: "center" },
                        pos: { color: posColor, fontSize: 8, fontWeight: 700, lineHeight: 10, align: "center" },
                        neg: { color: negColor, fontSize: 8, fontWeight: 700, lineHeight: 10, align: "center" },
                        na: { color: naColor, fontSize: 8, fontWeight: 700, lineHeight: 10, align: "center" },
                    },
                };
            }

            series = [salesSeries];
            if (!isBar && state.showTarget) {
                series.push({
                    name: "Target", type: "line", data: target, smooth: false, showSymbol: false,
                    symbol: "none", connectNulls: true, itemStyle: { color: targetColor },
                    lineStyle: { width: 2, color: targetColor, type: "dashed" }, z: 3,
                });
            }
            legendData = ["Sales"];
            if (!isBar && state.showTarget) legendData.push("Target");
        }

        // "Vs Last Year" overlay — same-period Sales from a year ago, drawn as a thin dotted line
        // even in Bar Graph mode (a second bar-per-category would crowd out the growth-% labels
        // above each bar) — only drawn once the user opts in via the Vs Last Year toggle
        // (currentData.lastYear is already fetched on every load() regardless, the tooltip's own
        // Sales vs Target/vs Last Year rows rely on it too).
        if (state.showLastYear) {
            series.push({
                name: "Last Year", type: "line", data: currentData.lastYear || [], smooth: false,
                showSymbol: isBar, symbol: "circle", symbolSize: 5, connectNulls: true,
                itemStyle: { color: lastYearColor }, lineStyle: { width: 2, color: lastYearColor, type: "dotted" }, z: 4,
            });
            legendData.push("Last Year");
        }

        const isDay = currentData.granularity === "day";
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
            legend: { bottom: 0, data: legendData, textStyle: { color: axisColor, fontSize: 9 }, itemWidth: 12, itemHeight: 7 },
            grid: { left: 8, right: 20, top: isBar ? 34 : 18, bottom: 38, containLabel: true },
            xAxis: {
                type: "category",
                data: labels,
                boundaryGap: isBar,
                axisLine: { lineStyle: { color: gridLineColor } },
                axisLabel: {
                    color: axisColor,
                    fontSize: 9,
                    rotate: isDay && labels.length > 10 ? 45 : 0,
                    interval: "auto",
                },
            },
            yAxis: {
                type: "value",
                boundaryGap: isBar ? [0, "22%"] : [0, 0],
                axisLine: { lineStyle: { color: gridLineColor } },
                splitLine: { lineStyle: { color: gridLineColor } },
                axisLabel: { color: axisColor, fontSize: 9, formatter: (v) => shortAmount(v) },
            },
            series,
        }, { notMerge: true });
    }

    async function load() {
        if (!state.level || !state.name) {
            currentData = null;
            renderEmpty();
            return;
        }
        const requestId = ++requestSeq;
        const granularity = resolveGranularity();
        const range = fyKeyToDateRange(state.fyKey);
        const params = new URLSearchParams({
            level: state.level, name: state.name, granularity, from: range.from, to: range.to, status: state.status,
        });
        let data = null;
        try {
            const res = await fetch(`/api/team-performance/person/trend-range?${params.toString()}`);
            data = res.ok ? await res.json() : null;
        } catch (err) {
            data = null;
        }
        if (requestId !== requestSeq) {
            return;
        }
        if (!data) {
            currentData = null;
            renderEmpty();
            return;
        }
        currentData = data;
        if (modeBadge) {
            modeBadge.textContent = TEAM_DAILY_TREND_GRANULARITY_LABEL[granularity] || "—";
        }
        updateSelectionSummary(granularity);
        renderChart();
    }

    typeToggle?.querySelectorAll(".daily-trend-chart-type-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.dataset.chartType === state.chartType) {
                return;
            }
            state.chartType = btn.dataset.chartType;
            typeToggle.querySelectorAll(".daily-trend-chart-type-btn").forEach((b) => b.classList.toggle("active", b === btn));
            renderChart();
        });
    });

    // Compare toggle — every real sales type is shown at once instead of the single combined Sales
    // line. No re-fetch needed: /person/trend-range already returns primary/secondary/total in one
    // response regardless of this toggle, so flipping it just changes what renderChart() draws.
    compareToggle?.addEventListener("click", () => {
        state.compare = !state.compare;
        compareToggle.classList.toggle("active", state.compare);
        compareToggle.setAttribute("aria-pressed", String(state.compare));
        updateSelectionSummary(currentData ? currentData.granularity : resolveGranularity());
        renderChart();
    });

    targetToggle?.addEventListener("click", () => {
        state.showTarget = !state.showTarget;
        targetToggle.classList.toggle("active", state.showTarget);
        targetToggle.setAttribute("aria-pressed", String(state.showTarget));
        renderChart();
    });

    vsLastYearToggle?.addEventListener("click", () => {
        state.showLastYear = !state.showLastYear;
        vsLastYearToggle.classList.toggle("active", state.showLastYear);
        vsLastYearToggle.setAttribute("aria-pressed", String(state.showLastYear));
        updateSelectionSummary(currentData ? currentData.granularity : resolveGranularity());
        renderChart();
    });

    window.addEventListener("resize", () => chart.resize());
    window.addEventListener("theme-changed", () => {
        resolveColors();
        renderChart();
    });

    renderEmpty();

    return {
        // `fyKey` is whichever FY the Person FY card's own FY Filter currently has selected (see
        // initTeamPersonFyYearFilter) — passed in here so the very first load already matches it
        // instead of a separate setFyKey call causing a second, immediately-discarded fetch.
        setPerson(level, name, fyKey) {
            state.level = level;
            state.name = name;
            if (fyKey) {
                state.fyKey = fyKey;
            }
            if (titleEl) {
                titleEl.textContent = `Sales Trend — ${name}`;
            }
            // The chart was echarts.init()'d while its section-container was still `hidden`
            // (display:none), so its cached size is 0x0 from that first paint — resize() re-measures
            // the now-visible container before this load()'s setOption, otherwise the chart renders
            // squeezed into a sliver at its old cached width.
            chart.resize();
            load();
        },
        // Called by the Person FY card's own FY Filter (see initTeamPersonFyYearFilter's onSelect
        // wiring in initPersonDetailsSection) whenever the user picks a different FY — re-fetches
        // this same person's trend for the new FY's Apr-Mar range.
        setFyKey(fyKey) {
            state.fyKey = fyKey;
            load();
        },
        // Filter Header's own Status toggle pill — always updates state.status (even with no person
        // set yet, so whichever person is opened next already has it); load()'s own
        // "!state.level || !state.name" guard makes the reload itself a no-op until then.
        setStatus(status) {
            state.status = status;
            load();
        },
        refresh() {
            load();
        },
    };
}

// FY Filter for the Person FY card only (#teamPersonFyYearFilter, right side of
// #teamPerformancePersonFyCard's own header) — scoped to just this card, per explicit request, not
// the whole page. Same shared components/FyYearFilter/FyYearFilter.js widget Dashboard's own
// "1. Overview" card and Site Insight's own Monthly History card use. Builds the menu/label from
// TEAM_PERSON_FY_KEYS (page-specific) itself, then hands the open/close/select mechanics to
// initScopedFyYearFilter, which returns { setSelected(fyKey) } for resyncing the dropdown later.
function initTeamPersonFyYearFilter(onSelect) {
    const label = document.getElementById("teamPersonFyYearFilterLabel");
    const menu = document.getElementById("teamPersonFyYearFilterMenu");
    if (!label || !menu) {
        return { setSelected() {} };
    }

    menu.innerHTML = TEAM_PERSON_FY_KEYS
        .map((key, i) => `<button type="button" class="dashboard-fy-year-filter-item${i === 0 ? " active" : ""}" data-fy="${key}">${fyLabelForKey(key)}</button>`)
        .join("");
    label.textContent = fyLabelForKey(TEAM_PERFORMANCE_FY_CURRENT_KEY);

    return initScopedFyYearFilter({ idPrefix: "teamPersonFyYearFilter", onSelect });
}

function initPersonDetailsSection() {
    const sectionContainer = document.getElementById("teamPerformancePersonSectionContainer");
    const trendContainer = document.getElementById("teamPerformanceDailyTrendSectionContainer");
    if (!sectionContainer || !trendContainer) {
        return { open() {}, setStatus() {} };
    }

    const dailyTrend = initTeamPersonDailyTrend();
    let current = null;
    let sitesRequestSeq = 0;
    let fyRequestSeq = 0;
    // Selected FY for the Person FY card only — defaults to the real current FY, changed only by
    // this card's own FY Filter (fyYearFilter below), independent of the page's own Filter Header
    // Date Filter (which drives "Team Report"/"Daily Sales" instead — see
    // getTeamPerformanceEffectiveRange). Persists across switching to a different person, same as
    // Dashboard's own Year Filter selection persists across other filter changes.
    let currentFyKey = TEAM_PERFORMANCE_FY_CURRENT_KEY;
    // Filter Header's own Status toggle pill (#teamPerformanceStatusFilterToggle) — see
    // the initStatusFilter call/setStatus below. Unlike currentFyKey above, this one IS shared with
    // the page's own Filter Header (not scoped to just this card).
    let currentStatus = teamStatusFilter;
    // Last-fetched /person/fy-overview response — read by the Download button below (no separate
    // fetch, same as Dashboard's own "3. Partner Wise" plain click-to-download convention: it just
    // exports whatever's already on screen).
    let lastFyData = null;

    // The site-code chip list itself was removed per explicit request — this still fetches the same
    // /person/sites data (siteCount for the Person card's own count text, sites for the FY card's own
    // Primary/Secondary column visibility via resolvePersonSalesTypeFlags), just no longer renders a
    // chip per site.
    async function loadSites(level, name) {
        const countEl = document.getElementById("teamPerformancePersonSiteCount");
        const requestId = ++sitesRequestSeq;
        let data = null;
        try {
            const res = await fetch(`/api/team-performance/person/sites?${new URLSearchParams({ level, name, status: currentStatus }).toString()}`);
            data = res.ok ? await res.json() : null;
        } catch (err) {
            data = null;
        }
        if (requestId !== sitesRequestSeq) {
            return;
        }
        if (!data) {
            if (countEl) {
                countEl.textContent = "0 assigned sites";
            }
            applyPersonSalesTypeVisibility({ showPrimary: true, showSecondary: true });
            return;
        }
        if (countEl) {
            countEl.textContent = `${data.siteCount} assigned site${data.siteCount === 1 ? "" : "s"}`;
        }
        applyPersonSalesTypeVisibility(resolvePersonSalesTypeFlags(data.sites));
    }

    async function loadFyOverview(level, name) {
        const tbody = document.getElementById("teamPerformancePersonFyBody");
        const rangeLabel = document.getElementById("teamPerformancePersonFyRangeLabel");
        const card = document.getElementById("teamPerformancePersonFyCard");
        if (!tbody) {
            return;
        }
        const requestId = ++fyRequestSeq;
        const fyKey = currentFyKey;
        if (rangeLabel) {
            rangeLabel.textContent = fyLabelForKey(fyKey);
        }
        card?.classList.add("is-loading");
        tbody.innerHTML = `<tr class="dashboard-fy-row--loading"><td colspan="9">Loading…</td></tr>`;
        let data = null;
        try {
            const res = await fetch(`/api/team-performance/person/fy-overview?${new URLSearchParams({ level, name, fyKey, status: currentStatus }).toString()}`);
            data = res.ok ? await res.json() : null;
        } catch (err) {
            data = null;
        }
        card?.classList.remove("is-loading");
        if (requestId !== fyRequestSeq) {
            return;
        }
        if (!data) {
            tbody.innerHTML = `<tr class="dashboard-fy-row--loading"><td colspan="9">Failed to load</td></tr>`;
            return;
        }
        lastFyData = data;
        renderPersonFyTable(tbody, data);
    }

    // CSV-text counterparts of personAchiCell/personYoyVarianceCell above — same "—" for no-target/
    // no-previous-year convention, plain text instead of that HTML. Mirrors
    // SiteStatusPage.js's own monthlyFyAchiCsvText/monthlyFyVsLyCsvText.
    function personAchiCsvText(sales, target) {
        const t = Number(target ?? 0);
        const s = Number(sales ?? 0);
        const pct = t > 0 ? (s / t) * 100 : null;
        return pct == null ? "—" : `${pct.toFixed(1)}%`;
    }

    function personVsLyCsvText(current, previous) {
        if (!current || !previous) {
            return "—";
        }
        return formatDelta(personGrowthPct(current, previous));
    }

    // Exports whichever FY this card's own Filter currently has selected — reuses the exact same
    // months/type/display-value logic renderPersonFyTable above uses, producing CSV-safe plain-text
    // cells instead of that function's HTML.
    function buildPersonFyCsvLines(data) {
        const header = ["Month", "Primary Target", "Primary Sales", "Primary Achi %", "Primary Vs LY %", "Secondary Target", "Secondary Sales", "Secondary Achi %", "Secondary Vs LY %"];
        const lines = [buildCsvLine(header)];
        let pTargetTotal = 0, sTargetTotal = 0, pSalesTotal = 0, sSalesTotal = 0, pLastYearTotal = 0, sLastYearTotal = 0;

        data.months.forEach((ym, i) => {
            const type = personFyMonthType(data.fyKey, i);
            const pTarget = Number(data.primaryTarget[i] ?? 0);
            const sTarget = Number(data.secondaryTarget[i] ?? 0);
            const realPSales = Number(data.primarySales[i] ?? 0);
            const realSSales = Number(data.secondarySales[i] ?? 0);
            const pLastYear = Number(data.primaryLastYearSales[i] ?? 0);
            const sLastYear = Number(data.secondaryLastYearSales[i] ?? 0);
            const displayPSales = type === "projection" ? pTarget : realPSales;
            const displaySSales = type === "projection" ? sTarget : realSSales;

            pTargetTotal += pTarget;
            sTargetTotal += sTarget;
            pSalesTotal += displayPSales;
            sSalesTotal += displaySSales;
            pLastYearTotal += pLastYear;
            sLastYearTotal += sLastYear;

            lines.push(buildCsvLine([
                personMonthLabel(ym),
                formatMoneyFull(pTarget, { nullDash: true }),
                formatMoneyFull(displayPSales, { nullDash: true }),
                personAchiCsvText(displayPSales, pTarget),
                personVsLyCsvText(displayPSales, pLastYear),
                formatMoneyFull(sTarget, { nullDash: true }),
                formatMoneyFull(displaySSales, { nullDash: true }),
                personAchiCsvText(displaySSales, sTarget),
                personVsLyCsvText(displaySSales, sLastYear),
            ]));
        });

        lines.push(buildCsvLine([
            "Total",
            formatMoneyFull(pTargetTotal, { nullDash: true }),
            formatMoneyFull(pSalesTotal, { nullDash: true }),
            personAchiCsvText(pSalesTotal, pTargetTotal),
            personVsLyCsvText(pSalesTotal, pLastYearTotal),
            formatMoneyFull(sTargetTotal, { nullDash: true }),
            formatMoneyFull(sSalesTotal, { nullDash: true }),
            personAchiCsvText(sSalesTotal, sTargetTotal),
            personVsLyCsvText(sSalesTotal, sLastYearTotal),
        ]));
        return lines;
    }

    document.getElementById("teamPerformancePersonFyDownloadBtn")?.addEventListener("click", () => {
        if (!lastFyData || !current) {
            return;
        }
        const lines = buildPersonFyCsvLines(lastFyData);
        downloadCsv(lines, `person-${current.name}-fy-overview-${currentFyKey}-${new Date().toISOString().slice(0, 10)}.csv`);
    });

    // Scoped to just this card + "Daily Sales" below it — picking a different FY here reloads the FY
    // card's own data (loadFyOverview) AND re-fetches "Daily Sales" for that same FY's Apr-Mar range
    // (dailyTrend.setFyKey), per explicit request; it never touches "Team Report" above.
    initTeamPersonFyYearFilter((fyKey) => {
        currentFyKey = fyKey;
        if (current) {
            loadFyOverview(current.level, current.name);
            dailyTrend.setFyKey(fyKey);
        }
    });

    async function open(level, name) {
        current = { level, name };
        // Both sections start `hidden` in the markup for an unrelated reason (no person picked
        // yet) — awaits the same permission promise every other gated reveal on this page does
        // (never a second /api/auth/me fetch) before deciding whether picking a person actually
        // unhides either one; a session lacking "page:team-insights.person-details"/
        // "page:team-insights.daily-sales" never sees them regardless of what gets clicked.
        const permissions = await pagePermissionsPromise;
        const hasPersonDetails = permissions.has("page:team-insights.person-details");
        const hasDailySales = permissions.has("page:team-insights.daily-sales");
        sectionContainer.hidden = !hasPersonDetails;
        trendContainer.hidden = !hasDailySales;

        const levelBadge = document.getElementById("teamPerformancePersonLevelBadge");
        const nameEl = document.getElementById("teamPerformancePersonName");
        if (levelBadge) levelBadge.textContent = PERSON_LEVEL_LABELS[level] || String(level).toUpperCase();
        if (nameEl) nameEl.textContent = name;

        loadSites(level, name);
        loadFyOverview(level, name);
        // dailyTrend.setPerson's own chart.resize() (see initTeamPersonDailyTrend's own comment)
        // needs trendContainer's hidden already resolved — the assignment above already ran, so
        // this measures the real, final visibility state rather than a still-hidden 0x0 container.
        dailyTrend.setPerson(level, name, currentFyKey);
        teamSiteReportSectionHandle?.setPerson(level, name);

        if (hasPersonDetails) {
            sectionContainer.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    return {
        open,
        // Filter Header's own Status toggle pill — always keeps dailyTrend's own status in sync
        // (even with no person open yet, so whichever person is opened next already has it), but
        // only reloads "Person Details"' own site count/FY card when a person is actually open.
        setStatus(status) {
            currentStatus = status;
            dailyTrend.setStatus(status);
            if (current) {
                loadSites(current.level, current.name);
                loadFyOverview(current.level, current.name);
            }
        },
    };
}

function openPersonDetails(level, name) {
    personSectionHandle?.open(level, name);
}

personSectionHandle = initPersonDetailsSection();
