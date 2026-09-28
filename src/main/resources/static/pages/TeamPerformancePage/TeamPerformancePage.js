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

const pagePermissionsPromise = applyPagePermissions();

pagePermissionsPromise.then(() => applyFeatureGating());


const teamPerformanceFilters = { from: null, to: null, dateMeta: null };


let teamStatusFilter = "active";


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


let teamReportSectionHandle = null;


let teamSiteReportSectionHandle = null;


let personSectionHandle = null;


function getCurrentFyStartYear2Digit() {
    const now = new Date();
    const calendarYear2Digit = now.getFullYear() % 100;

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


const TEAM_PERFORMANCE_FY_CURRENT_KEY = fyKeyFor(getCurrentFyStartYear2Digit());


function fyLabelForKey(fyKey) {
    const startYear = Number(String(fyKey).split("-")[0]);
    return fyLabelFor(startYear % 100);
}


const TEAM_PERSON_FY_WINDOW_SIZE = 3;
const TEAM_PERSON_FY_KEYS = Array.from(
    { length: TEAM_PERSON_FY_WINDOW_SIZE },
    (_, i) => fyKeyFor(getCurrentFyStartYear2Digit() - i),
);


initSalesDateFilter({
    idPrefix: "teamPerformanceDateFilter",
    onFilterChange: (column, from, to, meta) => {
        teamPerformanceFilters.from = from;
        teamPerformanceFilters.to = to;
        teamPerformanceFilters.dateMeta = meta;

        const range = getTeamPerformanceEffectiveRange();
        teamReportSectionHandle?.setDateRange(range.from, range.to);
        teamSiteReportSectionHandle?.setDateRange(range.from, range.to);
        updateTeamPerformanceRangeLabel();
    },
});


loadStatusPillOptions().then((statuses) => {
    renderStatusPill(statuses);
    initStatusFilter("teamPerformanceStatusFilterToggle", (status) => {
        teamStatusFilter = status;
        teamReportSectionHandle?.setStatus(status);
        teamSiteReportSectionHandle?.setStatus(status);
        personSectionHandle?.setStatus(status);
    });
});


function pad2(n) {
    return String(n).padStart(2, "0");
}

function lastDayOfMonthNum(year, month) {
    return new Date(year, month, 0).getDate();
}


function currentMonthDateRange() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDayOfMonthNum(y, m))}` };
}


function fyKeyToDateRange(fyKey) {
    const fyStartYear = Number(String(fyKey).split("-")[0]);
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
}


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


const REPORTS_TABLE_COLGROUP = `<colgroup>
    <col style="width:24%"><col style="width:10%"><col style="width:12%"><col style="width:12%">
    <col style="width:14%"><col style="width:14%"><col style="width:14%">
</colgroup>`;

function reportsAchiPct(sales, target) {
    const t = Number(target ?? 0);
    const s = Number(sales ?? 0);
    return t > 0 ? (s / t) * 100 : null;
}


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


const FLAT_REPORT_TABLE_CLASS = {
    "AM": "report-flat-table--am",
    "CM": "report-flat-table--cm",
    "SM": "report-flat-table--sm",
};

function countFlatRows(rows) {
    return (rows ?? []).filter((row) => row.name !== "Total").length;
}


const POSITION_TREE_LEVEL_ICONS = ["bi-diagram-3-fill", "bi-signpost-split-fill", "bi-building", "bi-shop"];
const POSITION_TREE_LEVEL_LABELS = ["RM", "AM", "CM", "SM"];


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


function renderFlatTable(wrap, firstLabel, rows) {
    const level = POSITION_TREE_LEVEL_LABELS.indexOf(firstLabel);

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


function renderSingleReportsCount(el, label, count) {
    if (!el) {
        return;
    }
    el.innerHTML = `<span class="reports-section-count"><span class="reports-section-count-label">${label}:</span>${count}</span>`;
}


function renderPositionHierarchyTable(wrap, rows) {

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


    tableWrap.addEventListener("click", (event) => {
        const nameEl = event.target.closest(".product-snapshot-name-text[data-person-level]");
        if (!nameEl) {
            return;
        }
        openPersonDetails(nameEl.dataset.personLevel, nameEl.dataset.personName);
    });


    let salesType = salesTypeToggle?.querySelector(".brand-header-item.active")?.dataset.salesType || "secondary";
    let activeTab = "all";
    let treeRows = null;
    let treeRequestSeq = 0;
    const flatRows = { am: null, cm: null, sm: null };
    const flatRequestSeq = { am: 0, cm: 0, sm: 0 };

    const initialRange = getTeamPerformanceEffectiveRange();
    let currentFrom = initialRange.from;
    let currentTo = initialRange.to;

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

        setDateRange(from, to) {
            currentFrom = from;
            currentTo = to;
            treeRows = null;
            flatRows.am = null;
            flatRows.cm = null;
            flatRows.sm = null;
            renderActiveTab();
        },

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

    let currentStatus = teamStatusFilter;
    let requestSeq = 0;
    downloadBtn?.addEventListener("click", () => downloadTeamSiteReportCsv(siteReportRows));


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


    async function setPerson(level, name) {
        currentLevel = level;
        currentName = name;
        const permissions = await pagePermissionsPromise;
        sectionContainer.hidden = !permissions.has("page:team-insights.person-sitemaster-report");
        refresh();
    }


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


const PERSON_LEVEL_LABELS = { rm: "RM", am: "AM", cm: "CM", sm: "SM" };


function escapeAttr(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


function personFormatVariance(value) {
    if (value === null || value === undefined) {
        return "—";
    }
    const num = Number(value);
    const sign = num > 0 ? "+" : (num < 0 ? "-" : "");
    return `${sign}${teamPerformanceReportMoney(Math.abs(num), { round: false })}`;
}


function personFyMoneyTd(value, allowDash, groupClass) {
    const cls = groupClass ? ` class="${groupClass}"` : "";
    if (allowDash && !value) {
        return `<td${cls}>—</td>`;
    }
    return `<td${cls} title="${escapeAttr(formatMoneyFull(value))}">${teamPerformanceReportMoney(value, { round: false })}</td>`;
}


function personGrowthPct(current, previous) {
    const cur = Number(current ?? 0);
    const prev = Number(previous ?? 0);
    if (prev !== 0) {
        return ((cur - prev) / prev) * 100;
    }
    return cur === 0 ? 0 : null;
}


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


function personMonthLabel(yearMonthStr) {
    const [year, month] = yearMonthStr.split("-").map(Number);
    return `${new Date(year, month - 1, 1).toLocaleString("en-US", { month: "short" })}-${String(year).slice(2)}`;
}


function getCurrentFyMonthIndex() {
    const jsMonth = new Date().getMonth();
    return (jsMonth + 9) % 12;
}


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


function renderPersonFyTable(tbody, data) {
    if (!data || !data.months || !data.months.length) {
        tbody.innerHTML = `<tr class="dashboard-fy-row--loading"><td colspan="9">No data available</td></tr>`;
        return;
    }

    let pTargetTotal = 0, sTargetTotal = 0, pSalesTotal = 0, sSalesTotal = 0, pLastYearTotal = 0, sLastYearTotal = 0;

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


function resolvePersonSalesTypeFlags(sites) {
    const hasPrimary = (sites || []).some((site) => String(site.salesType ?? "").toLowerCase().includes("primary"));
    const hasSecondary = (sites || []).some((site) => String(site.salesType ?? "").toLowerCase().includes("secondary"));
    if (!hasPrimary && !hasSecondary) {
        return { showPrimary: true, showSecondary: true };
    }
    return { showPrimary: hasPrimary, showSecondary: hasSecondary };
}


function applyPersonSalesTypeVisibility(flags) {
    const card = document.getElementById("teamPerformancePersonFyCard");
    if (!card) {
        return;
    }
    card.classList.toggle("hide-primary-group", !flags.showPrimary);
    card.classList.toggle("hide-secondary-group", !flags.showSecondary);
}


const TEAM_DAILY_TREND_COMPARE_TYPES = [
    { key: "primary", label: "Primary Sales", color: "#16A34A" },
    { key: "secondary", label: "Secondary Sales", color: "#2563EB" },
];
const TEAM_DAILY_TREND_GRANULARITY_LABEL = { day: "Daily", month: "Monthly", year: "Yearly" };
const TEAM_DAILY_TREND_PERIOD_LABEL = { day: "Date", month: "Month", year: "Year" };


function teamDailyTrendHexToRgba(hex, alpha) {
    const clean = String(hex).replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


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

    const state = {
        chartType: "line", level: null, name: null, compare: false, showLastYear: false, showTarget: true,

        fyKey: TEAM_PERFORMANCE_FY_CURRENT_KEY,

        status: teamStatusFilter,
    };
    let currentData = null;
    let requestSeq = 0;


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


    function resolveGranularity() {
        return "month";
    }


    function shortAmount(value) {
        return teamPerformanceReportMoney(value, { round: false });
    }


    function fullAmount(value) {
        return formatMoneyFull(value).replace("₹", "");
    }


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


    function formatSelectedPeriod(period, granularity) {
        if (!period || !period.from || !period.to) return "—";
        if (granularity === "month" && period.from.slice(0, 7) === period.to.slice(0, 7)) {
            const [y, m] = period.from.split("-").map(Number);
            return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
        }
        if (period.from === period.to) return formatFullDate(period.from);
        return `${formatFullDate(period.from)} – ${formatFullDate(period.to)}`;
    }


    function formatGrowthTooltip(value) {
        if (value === null || value === undefined) {
            return '<span style="color:#9CA3AF;">— N/A</span>';
        }
        const isUp = value >= 0;
        const color = isUp ? "#4ADE80" : "#F87171";
        const sign = isUp ? "+" : "−";
        return `<span style="color:${color};font-weight:600;">${sign}${Math.abs(value).toFixed(1)}%</span>`;
    }


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


        if (state.compare) {

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

        setPerson(level, name, fyKey) {
            state.level = level;
            state.name = name;
            if (fyKey) {
                state.fyKey = fyKey;
            }
            if (titleEl) {
                titleEl.textContent = `Sales Trend — ${name}`;
            }

            chart.resize();
            load();
        },

        setFyKey(fyKey) {
            state.fyKey = fyKey;
            load();
        },

        setStatus(status) {
            state.status = status;
            load();
        },
        refresh() {
            load();
        },
    };
}


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

    let currentFyKey = TEAM_PERFORMANCE_FY_CURRENT_KEY;

    let currentStatus = teamStatusFilter;

    let lastFyData = null;


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


    initTeamPersonFyYearFilter((fyKey) => {
        currentFyKey = fyKey;
        if (current) {
            loadFyOverview(current.level, current.name);
            dailyTrend.setFyKey(fyKey);
        }
    });

    async function open(level, name) {
        current = { level, name };

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

        dailyTrend.setPerson(level, name, currentFyKey);
        teamSiteReportSectionHandle?.setPerson(level, name);

        if (hasPersonDetails) {
            sectionContainer.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    return {
        open,

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
