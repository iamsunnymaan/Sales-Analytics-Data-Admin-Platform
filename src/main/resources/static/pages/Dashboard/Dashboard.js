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


applyPagePermissions().then(() => applyFeatureGating());

function money(value, opts) {
    return formatMoney(value, opts).replace("₹", "");
}

function moneyFull(value, opts) {
    return formatMoneyFull(value, opts).replace("₹", "");
}


const DASHBOARD_FY_MONTH_NAMES = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];


function buildDashboardFyMonths(fyStartYear, currentMonthIndex) {
    return DASHBOARD_FY_MONTH_NAMES.map((name, i) => {
        const year = i < 9 ? fyStartYear : fyStartYear + 1;
        const label = `${name}-${String(year).padStart(2, "0")}`;
        const type = currentMonthIndex == null ? "actual"
            : i === currentMonthIndex ? "current"
            : i < currentMonthIndex ? "actual"
            : "projection";
        return { month: label, type };
    });
}


function getCurrentFyStartYear2Digit() {
    const now = new Date();
    const calendarYear2Digit = now.getFullYear() % 100;

    return now.getMonth() < 3 ? calendarYear2Digit - 1 : calendarYear2Digit;
}

function getCurrentFyMonthIndex() {
    const jsMonth = new Date().getMonth();
    return (jsMonth + 9) % 12;
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


function dashboardFyKeyToMonthRange(fyKey) {
    const fyStartYear = Number(fyKey.split("-")[0]);
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
}


let dailyTrendGraph = null;


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


let dashboardFyOverviewRequestSeq = 0;


let dashboardFyOverviewSalesType = "all";
let dashboardFyOverviewBrand = "all";
let dashboardFyOverviewChannel = "all";
let dashboardFyOverviewStatus = "all";
let dashboardFyOverviewCurrentKey = DASHBOARD_FY_CURRENT_KEY;


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


function dashboardFyMonthLabelToKey(month) {
    const [monthName, yy] = month.split("-");
    const idx = DASHBOARD_FY_MONTH_NAMES.indexOf(monthName);
    const mm = idx < 9 ? idx + 4 : idx - 8;
    return `20${yy}-${String(mm).padStart(2, "0")}`;
}


function dashboardFyMonthKeyLastYear(monthKey) {
    const [y, m] = monthKey.split("-");
    return `${Number(y) - 1}-${m}`;
}


function growthPct(current, previous) {
    if (!current || !previous) {
        return null;
    }
    return ((current - previous) / previous) * 100;
}


function formatVariance(value) {
    if (value === null || value === undefined) {
        return "—";
    }
    const num = Number(value);
    const sign = num > 0 ? "+" : (num < 0 ? "-" : "");
    return `${sign}${money(Math.abs(num), { round: false })}`;
}


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


function fyMoneyCell(value, allowDash, groupClass = "") {
    const cls = groupClass ? ` class="${groupClass}"` : "";
    if (allowDash && !value) {
        return `<td${cls}>—</td>`;
    }
    return `<td${cls} title="${escapeAttr(formatMoneyFull(value))}">${money(value, { round: false })}</td>`;
}


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
        return;
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

    const rangeLabel = document.getElementById("dashboardFyOverviewRangeLabel");
    if (rangeLabel) {
        rangeLabel.textContent = `${data.months[0].month} to ${data.months[data.months.length - 1].month}`;
    }

    const fyStartYear = 2000 + Number(fyKey.split("-")[0].slice(-2));
    const requestId = ++dashboardFyOverviewRequestSeq;

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

        isCurrentFy ? fetchDashboardPrimaryProjectionTotal(requestId) : Promise.resolve(null),
    ]);
    if (requestId !== dashboardFyOverviewRequestSeq) {
        return;
    }
    const primaryProjectionTotal = primaryProjectionTotalRaw != null ? Number(primaryProjectionTotalRaw) : 0;

    let primaryTargetTotal = 0;
    let secondaryTargetTotal = 0;
    let primaryActualTotal = 0;
    let secondaryActualTotal = 0;
    let primaryActualTotalLY = 0;
    let secondaryActualTotalLY = 0;

    let ytdPrimaryTarget = 0;
    let ytdSecondaryTarget = 0;
    let ytdPrimaryActual = 0;
    let ytdSecondaryActual = 0;
    let ytdPrimaryActualLY = 0;
    let ytdSecondaryActualLY = 0;
    let ytdRowHtml = "";

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


    menu.innerHTML = DASHBOARD_FY_KEYS
        .map((key, i) => `<button type="button" class="dashboard-fy-year-filter-item${i === 0 ? " active" : ""}" data-fy="${key}">${DASHBOARD_FY_OVERVIEW_DATA[key].label}</button>`)
        .join("");
    label.textContent = DASHBOARD_FY_OVERVIEW_DATA[DASHBOARD_FY_CURRENT_KEY].label;
    renderDashboardFyOverviewTable(DASHBOARD_FY_CURRENT_KEY);
    updateDashboardPartnerYtdLabel(DASHBOARD_FY_CURRENT_KEY);
    updateDashboardPartnerCurrentMonthLabel();
    updateDashboardPartnerProjectionInfoTooltip();


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

            const fyRange = dashboardFyKeyToMonthRange(fyKey);
            dailyTrendGraph?.setDateRange(fyRange.from, fyRange.to, { rangeType: "month" });

            updateDashboardPartnerYtdLabel(fyKey);
            loadDashboardPartners();
        },
    });
})();


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

    initStatusFilter("dashboardFyOverviewStatusToggle", (status) => setDashboardFyOverviewFilter("status", status));
})();


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


function dashboardCurrentCalendarMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}


function updateDashboardPartnerCurrentMonthLabel() {
    const header = document.getElementById("dashboardPartnerCurrentGroupHeader");
    if (!header) {
        return;
    }
    const now = new Date();
    const monthAbbr = now.toLocaleString("en-US", { month: "short" });
    header.textContent = `Current Month: ${monthAbbr}-${now.getFullYear()}`;
}


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


let dashboardPartnerLatestRows = [];
let dashboardPartnerLatestTotals = null;


function renderDashboardPartnerTable(partners, ytdTargetMap, ytdActualMap, ytdActualLYMap,
                                      currentTargetMap, currentActualMap, currentActualLYMap,
                                      currentPrimaryActualMap, currentProjectionMap, includesPrimaryProjection,
                                      fullYearTargetMap, remainingTargetMap, lastFyActualMap) {
    const body = document.getElementById("dashboardPartnerBody");
    if (!body) {
        return;
    }

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


    const currentMonthKey = dashboardCurrentCalendarMonthKey();
    const currentMonthKeyLY = dashboardFyMonthKeyLastYear(currentMonthKey);
    const includesPrimaryProjection = dashboardFyOverviewSalesType === "all" || dashboardFyOverviewSalesType === "primary";


    const fyMonths = DASHBOARD_FY_OVERVIEW_DATA[DASHBOARD_FY_CURRENT_KEY].months;
    const fullYearFromKey = dashboardFyMonthLabelToKey(fyMonths[0].month);
    const fullYearToKey = dashboardFyMonthLabelToKey(fyMonths[fyMonths.length - 1].month);


    const remainingMonths = fyMonths.filter((m) => m.type === "projection");
    const remainingTargetMapPromise = remainingMonths.length
        ? fetchDashboardPartnerYtdMap("target", dashboardFyMonthLabelToKey(remainingMonths[0].month), dashboardFyMonthLabelToKey(remainingMonths[remainingMonths.length - 1].month), requestId)
        : Promise.resolve({});


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
        return;
    }
    renderDashboardPartnerTable(partners, ytdTargetMap, ytdActualMap, ytdActualLYMap,
        currentTargetMap, currentActualMap, currentActualLYMap, currentPrimaryActualMap, currentProjectionMap,
        includesPrimaryProjection, fullYearTargetMap, remainingTargetMap, lastFyActualMap);
}

loadDashboardPartners();


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

    }
    if (requestId !== dashboardOverviewRequestSeq) {
        return;
    }
    section?.classList.remove("is-loading");
    renderDashboardOverviewTable(data.brands || [], data.channels || [], data.cells || []);
}




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

    DAILY_TREND_LAST_YEAR_COLOR = (DAILY_TREND_THEME_ROOT_STYLE.getPropertyValue("--color-warning").trim()) || "#D97706";
}
resolveDailyTrendColors();
const DAILY_TREND_CRORE = 10000000;
const DAILY_TREND_LAKH = 100000;

const DAILY_TREND_GRANULARITY_LABEL = { day: "Daily", month: "Monthly", year: "Yearly" };
const DAILY_TREND_PERIOD_LABEL = { day: "Date", month: "Month", year: "Year" };
const DAILY_TREND_BRAND_LABEL = { all: "All Brands", abh: "ABH", kylie: "Kylie" };
const DAILY_TREND_SALES_TYPE_LABEL = { all: "All Sales", primary: "Primary Sales", secondary: "Secondary Sales" };

const DAILY_TREND_COMPARE_BRANDS = [
    { key: "abh", label: "ABH", color: "#7C3AED" },
    { key: "kylie", label: "Kylie", color: "#DB2777" },
];

const DAILY_TREND_COMPARE_SALES_TYPES = [
    { key: "primary", label: "Primary Sales", color: "#16A34A" },
    { key: "secondary", label: "Secondary Sales", color: "#2563EB" },
];

function resolveTrendLineColor(brand) {
    const compareBrand = DAILY_TREND_COMPARE_BRANDS.find((b) => b.key === brand);
    return compareBrand ? compareBrand.color : DAILY_TREND_LINE_COLOR;
}


function currentFinancialYearMonthRange() {
    const now = new Date();
    const month = now.getMonth() + 1;
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

    if (chart) {
        document.addEventListener("permissions-applied", () => chart.resize());
    }

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

        }
    }


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


    function updateCompareModeClasses() {
        brandHeader?.classList.toggle("compare-mode-brand", state.compare && state.compareMode === "brand");
        brandHeader?.classList.toggle("compare-mode-salesType", state.compare && state.compareMode === "salesType");
    }

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

            renderChart();
        });
    }

    if (vsLastYearToggle) {
        vsLastYearToggle.addEventListener("click", () => {
            state.showLastYear = !state.showLastYear;
            vsLastYearToggle.classList.toggle("active", state.showLastYear);
            vsLastYearToggle.setAttribute("aria-pressed", String(state.showLastYear));

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
