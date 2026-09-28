import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { buildCsvLine, downloadCsv, initDownloadPopup } from "/components/ExcelDownloadButton/ExcelDownloadButton.js";
import { initSalesDateFilter } from "/components/SalesDateFilter/SalesDateFilter.js";
import { initBrandHeader, loadBrandPillOptions, brandNameToCode, renderBrandPill } from "/components/BrandFilter/BrandFilter.js";
import { initChannelHeader, loadChannelPillOptions, renderChannelPill } from "/components/ChannelFilter/ChannelFilter.js";
import { initStatusFilter } from "/components/StatusFilter/StatusFilter.js";
import { formatMoney, formatMoneyFull, formatDelta, formatDeltaSigned } from "/Shared/js/format.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating } from "/Shared/js/feature-guard.js";

initSidebar();
initQuickAccessPanel();

applyPagePermissions().then(() => applyFeatureGating());


function money(value, opts) {
    return formatMoney(value, opts).replace("₹", "");
}


function moneyFull(value, opts) {
    return formatMoneyFull(value, opts).replace("₹", "");
}


const BRAND_STORAGE_KEY = "secondary-sales-selected-brand";
const CHANNEL_STORAGE_KEY = "secondary-sales-selected-channel";


async function loadStatusPillOptions(apiUrl) {
    try {
        const res = await fetch(apiUrl);
        if (!res.ok) {
            return [];
        }
        const statuses = await res.json();
        return Array.isArray(statuses) ? statuses : [];
    } catch {
        return [];
    }
}


function renderStatusPill(toggleId, statuses) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) {
        return;
    }
    if (!statuses.length) {
        toggle.innerHTML = `<span class="site-status-filter-item brand-header-empty">Not Available</span>`;
        return;
    }
    const options = [{ value: "all", label: "All" }, ...statuses.map((s) => ({ value: s.toLowerCase(), label: s }))];
    toggle.innerHTML = options
        .map((opt, i) => `<button type="button" class="site-status-filter-item${i === 0 ? " active" : ""}" data-status="${opt.value}">${opt.label}</button>`)
        .join("");
}


const RANGE_LABEL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRangeDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    return `${day}-${RANGE_LABEL_MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function monthEndDate(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function daysBetweenInclusive(from, to) {
    return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}


function updateOverviewRangeLabel(from, to) {
    const el = document.getElementById("taOverviewRangeLabel");
    if (!el) {
        return;
    }
    const today = new Date();
    const periodFrom = from ? new Date(`${from}T00:00:00`) : new Date(today.getFullYear(), today.getMonth(), 1);
    const periodTo = to ? new Date(`${to}T00:00:00`) : monthEndDate(today);
    const days = daysBetweenInclusive(periodFrom, periodTo);
    el.textContent = `${formatRangeDate(periodFrom)} to ${formatRangeDate(periodTo)} (${days} day${days === 1 ? "" : "s"})`;
}




const SECONDARY_OVERVIEW_BRAND_COLORS = { abh: "#7C3AED", kylie: "#DB2777" };
const SECONDARY_OVERVIEW_FALLBACK_COLOR_VARS = ["--achi-brand-1", "--achi-brand-2", "--achi-brand-3", "--achi-brand-4"];

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
    { label: "Vs LY", key: "vsLastYearPct", format: (v) => renderReportsDelta(v) },
    { label: "SOB", key: "sobPct", format: (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}%`) },
];


function renderSecondaryOverviewTable(brands, channels, cells) {
    const wrap = document.getElementById("secondaryOverviewTableWrap");
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
            const iconColor = isGrandTotal ? null : colorByBrand[group];

            const style = isGrandTotal ? "" : ` style="background-color:${hexToRgba(iconColor, 0.14)}"`;
            return `<th colspan="${subColumns.length}" class="${classes.join(" ")}"${style}>${overviewHeaderCell("Brand", "bi-shop", group, iconColor)}</th>`;
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

                            const style = (tint && sub !== "Total") ? ` style="background-color:${tint}"` : "";
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

let overviewRequestSeq = 0;


async function loadOverview(from, to, brand = "all", channel = "all", status = "all") {
    const requestId = ++overviewRequestSeq;
    const section = document.getElementById("secondaryOverviewSection");
    section?.classList.add("is-loading");
    const params = new URLSearchParams({ brand, channel, status });
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
    if (requestId !== overviewRequestSeq) {
        return;
    }
    section?.classList.remove("is-loading");
    renderSecondaryOverviewTable(data.brands || [], data.channels || [], data.cells || []);
}




let THEME_ROOT_STYLE = getComputedStyle(document.documentElement);
let AXIS_COLOR, GRID_LINE_COLOR, LINE_COLOR, TARGET_COLOR, POS_LABEL_COLOR, NEG_LABEL_COLOR, NA_LABEL_COLOR, LAST_YEAR_COLOR;
function resolveDailyTrendColors() {
    THEME_ROOT_STYLE = getComputedStyle(document.documentElement);
    AXIS_COLOR = (THEME_ROOT_STYLE.getPropertyValue("--color-text-secondary").trim()) || "#66756F";
    GRID_LINE_COLOR = (THEME_ROOT_STYLE.getPropertyValue("--color-border").trim()) || "#DCE7E2";
    LINE_COLOR = (THEME_ROOT_STYLE.getPropertyValue("--color-success").trim()) || "#16803C";
    TARGET_COLOR = (THEME_ROOT_STYLE.getPropertyValue("--color-text-secondary").trim()) || "#595f5c";
    POS_LABEL_COLOR = (THEME_ROOT_STYLE.getPropertyValue("--color-success").trim()) || "#16803C";
    NEG_LABEL_COLOR = (THEME_ROOT_STYLE.getPropertyValue("--color-danger").trim()) || "#DC2626";
    NA_LABEL_COLOR = (THEME_ROOT_STYLE.getPropertyValue("--color-text-secondary").trim()) || "#9CA3AF";

    LAST_YEAR_COLOR = (THEME_ROOT_STYLE.getPropertyValue("--color-warning").trim()) || "#D97706";
}
resolveDailyTrendColors();
const CRORE = 10000000;
const LAKH = 100000;

function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
const GRANULARITY_LABEL = { day: "Daily", month: "Monthly", year: "Yearly" };
const PERIOD_LABEL = { day: "Date", month: "Month", year: "Year" };
const BRAND_LABEL = { all: "All Brands", abh: "ABH", kylie: "Kylie" };

const COMPARE_BRANDS = [
    { key: "abh", label: "ABH", color: "#7C3AED" },
    { key: "kylie", label: "Kylie", color: "#DB2777" },
];


function resolveTrendLineColor(brand) {
    const compareBrand = COMPARE_BRANDS.find((b) => b.key === brand);
    return compareBrand ? compareBrand.color : LINE_COLOR;
}


function currentFinancialYearMonthRange() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const fyStartYear = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
}

function initDailyTrendGraph(options = {}) {
    const { apiBase = "/api/secondary-sales" } = options;

    const card = document.getElementById("dailyTrendCard");
    const chartTypeToggle = document.getElementById("dailyTrendChartTypeToggle");
    const targetToggle = document.getElementById("dailyTrendTargetToggle");
    const compareToggle = document.getElementById("dailyTrendCompareToggle");
    const vsLastYearToggle = document.getElementById("dailyTrendVsLastYearToggle");
    const chartDom = document.getElementById("dailyTrendChart");
    const modeBadge = document.getElementById("dailyTrendModeBadge");
    const selectionSummary = document.getElementById("dailyTrendSelectionSummary");

    if (!card) {
        return { load() {}, setDateRange() {}, setBrand() {}, setChannel() {}, setStatus() {} };
    }

    const chart = (chartDom && typeof window.echarts !== "undefined") ? window.echarts.init(chartDom) : null;

    if (chart) {
        document.addEventListener("permissions-applied", () => chart.resize());
    }

    const state = { chartType: "line", brand: "all", channel: "all", status: "all", from: null, to: null, granularity: "day", compare: false, showLastYear: false, showTarget: true };
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
        if (abs >= CRORE) {
            return `${sign}${trimNum(abs / CRORE)} Cr`;
        }
        if (abs >= LAKH) {
            return `${sign}${trimNum(abs / LAKH)} Lakh`;
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
        const brandLabel = BRAND_LABEL[state.brand] || "All Brands";
        const channelLabel = state.channel === "all" ? "All Channels" : state.channel;
        const compareLabel = state.compare
            ? `Yes (${COMPARE_BRANDS.map((b) => b.label).join(" vs ")})`
            : "No";
        const parts = [
            `Selected: <strong>${periodLabel}</strong>`,
            `<strong>${countLabel}</strong>`,
            `Brand: <strong>${brandLabel}</strong>`,
            `Channel: <strong>${channelLabel}</strong>`,
            `Compare: <strong>${compareLabel}</strong>`,
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
        const periodField = PERIOD_LABEL[state.granularity] || "Period";
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

        const brandLabel = BRAND_LABEL[state.brand] || "All Brands";
        const salesVal = (currentData.data || [])[idx];
        const targetVal = (currentData.target || [])[idx];
        const lastYearVal = (currentData.lastYear || [])[idx];
        const vsTargetGrowth = growthPct(salesVal, targetVal);
        const vsLastYearGrowth = growthPct(salesVal, lastYearVal);
        const periodUnit = (PERIOD_LABEL[state.granularity] || "period").toLowerCase();
        return `
            <div style="font-size:8px;line-height:1.2;min-width:105px;">
                <div>${periodField}: <strong>${periodValue}</strong></div>
                <div>Brand: <strong>${brandLabel}</strong></div>
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
                        smooth: false,
                        showSymbol: false,
                        symbol: "none",
                        connectNulls: true,
                        itemStyle: { color: brandData.color },
                        lineStyle: { width: 2, color: brandData.color, type: "dotted", opacity: 0.7 },
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
                        val: { color: AXIS_COLOR, fontSize: 9, fontWeight: 700, lineHeight: 11, align: "center" },
                        pos: { color: POS_LABEL_COLOR, fontSize: 8, fontWeight: 700, lineHeight: 10, align: "center" },
                        neg: { color: NEG_LABEL_COLOR, fontSize: 8, fontWeight: 700, lineHeight: 10, align: "center" },
                        na: { color: NA_LABEL_COLOR, fontSize: 8, fontWeight: 700, lineHeight: 10, align: "center" },
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
                    symbol: "none",
                    connectNulls: true,
                    itemStyle: { color: TARGET_COLOR },
                    lineStyle: { width: 2, color: TARGET_COLOR, type: "dashed" },
                    z: 3,
                });
            }

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
                    itemStyle: { color: LAST_YEAR_COLOR },
                    lineStyle: { width: 2, color: LAST_YEAR_COLOR, type: "dotted" },
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
                textStyle: { color: AXIS_COLOR, fontSize: 9 },
                itemWidth: 12,
                itemHeight: 7,
            },
            grid: { left: 8, right: 20, top: isBar ? 34 : 18, bottom: 38, containLabel: true },
            xAxis: {
                type: "category",
                data: labels,
                boundaryGap: isBar,
                axisLine: { lineStyle: { color: GRID_LINE_COLOR } },
                axisLabel: {
                    color: AXIS_COLOR,
                    fontSize: 9,
                    rotate: state.granularity === "day" && labels.length > 10 ? 45 : 0,
                    interval: "auto",
                },
            },
            yAxis: {
                type: "value",
                boundaryGap: isBar ? [0, "22%"] : [0, 0],
                axisLine: { lineStyle: { color: GRID_LINE_COLOR } },
                splitLine: { lineStyle: { color: GRID_LINE_COLOR } },
                axisLabel: { color: AXIS_COLOR, fontSize: 9, formatter: (v) => formatIndianAmount(v) },
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
            const baseParams = { granularity: state.granularity, channel: state.channel, status: state.status };
            if (state.from) {
                baseParams.from = state.from;
            }
            if (state.to) {
                baseParams.to = state.to;
            }

            if (state.compare) {
                const results = await Promise.all(COMPARE_BRANDS.map(async (brand) => {
                    const params = new URLSearchParams({ ...baseParams, brand: brand.key });
                    const response = await fetch(`${apiBase}/trend-range?${params.toString()}`);
                    return { ...brand, ...(response.ok ? await response.json() : {}) };
                }));
                if (requestId !== requestSeq) {
                    return;
                }
                currentCompareData = results;
                currentData = results[0] || null;
            } else {
                const params = new URLSearchParams({ ...baseParams, brand: state.brand });
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
                modeBadge.textContent = GRANULARITY_LABEL[state.granularity] || "—";
            }
            updateSelectionSummary();
            renderChart();
        } catch (error) {

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

            renderChart();
        });
    }

    if (compareToggle) {
        compareToggle.addEventListener("click", () => {
            state.compare = !state.compare;
            compareToggle.classList.toggle("active", state.compare);
            compareToggle.setAttribute("aria-pressed", String(state.compare));
            load();
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
        setDateRange(from, to, meta) {
            if (from && to) {
                state.from = from;
                state.to = to;

                state.granularity = from.slice(0, 7) === to.slice(0, 7) ? "day" : "month";
            } else {

                const fy = currentFinancialYearMonthRange();
                state.from = fy.from;
                state.to = fy.to;
                state.granularity = "month";
            }
            load();
        },
        setBrand(nextBrand) {
            state.brand = nextBrand;
            load();
        },
        setChannel(nextChannel) {
            state.channel = nextChannel;
            load();
        },
        setStatus(nextStatus) {
            state.status = nextStatus;
            load();
        },
    };
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
    return [firstLabel, "MNT", "Actual Sales", "Achi%", "Vs LY"];
}


const REPORTS_COLUMN_ICONS = {
    "Brand": "bi-shop",
    "Channel": "bi-diagram-2-fill",
    "Sub-Channel": "bi-diagram-3-fill",
    "Partner": "bi-people-fill",
    "MNT": "bi-bullseye",
    "Actual Sales": "bi-cash-stack",
    "Achi%": "bi-graph-up-arrow",
    "Vs LY": "bi-arrow-left-right",
};


function reportsIconHeaderCell(icon, label) {
    return `<span class="site-master-header-cell">
        <i class="bi ${icon} secondary-overview-header-icon" aria-hidden="true"></i>
        <span class="secondary-overview-header-icon-label">${label}</span>
    </span>`;
}

function reportsHeaderCell(label) {
    return reportsIconHeaderCell(REPORTS_COLUMN_ICONS[label] || "bi-list-columns", label);
}


const REPORTS_TABLE_COLGROUP = `<colgroup>
    <col style="width:25%"><col style="width:19%"><col style="width:19%">
    <col style="width:19%"><col style="width:18%">
</colgroup>`;

function reportsAchiPct(sales, target) {
    const t = Number(target ?? 0);
    const s = Number(sales ?? 0);
    return t > 0 ? (s / t) * 100 : null;
}


function renderReportsAchiCell(sales, target, brandSlot) {
    const pct = reportsAchiPct(sales, target);
    const barWidth = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
    const pctLabel = pct == null ? "—" : `${pct.toFixed(1)}%`;
    const slotAttr = brandSlot == null ? "" : ` data-brand-slot="${brandSlot}"`;
    return `
        <span class="channel-report-achi-cell">
            <span class="channel-report-achi-track">
                <span class="channel-report-achi-fill" style="width:${barWidth.toFixed(1)}%"${slotAttr}></span>
            </span>
            <span class="channel-report-achi-pct">${pctLabel}</span>
        </span>`;
}


const FLAT_REPORT_TABLE_CLASS = {
    "Sub-Channel": "report-flat-table--subchannel",
    "Channel": "report-flat-table--channel",
    "Partner": "report-flat-table--partner",
};

function renderReportsTable(wrap, firstLabel, rows) {
    const level = BRAND_TREE_LEVEL_LABELS.indexOf(firstLabel);

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
                    <i class="bi ${BRAND_TREE_LEVEL_ICONS[level]} brand-tree-row-icon" data-level="${level}" aria-hidden="true"></i>
                    <span class="brand-tree-row-icon-label">${BRAND_TREE_LEVEL_LABELS[level]}</span>
               </span>`;
        return `
        <tr data-level="0"${isTotal ? ' class="channel-report-total-row"' : ""}>
            <td class="product-snapshot-col-name">
                <span class="product-snapshot-name-cell">
                    ${rowIcon}
                    <span class="product-snapshot-name-text">${row.name}</span>
                </span>
            </td>
            <td>${money(row.monthTarget, { nullDash: true, round: false })}</td>
            <td>${money(row.mtdSales, { round: false })}</td>
            <td>${renderReportsAchiCell(row.mtdSales, row.monthTarget)}</td>
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


function flattenBrandTree(tree) {
    const rows = [];
    function walk(node, id, level, parent, brand) {
        const rowBrand = level === 0 ? (node.name === "Total" ? null : node.name) : brand;
        rows.push({
            id, level, parent, name: node.name, monthTarget: node.monthTarget, mtdSales: node.mtdSales,
            vsLastMonthPct: node.vsLastMonthPct, vsLastYearPct: node.vsLastYearPct, brand: rowBrand,
        });
        (node.states ?? []).forEach((child, ci) => walk(child, `${id}-${level}${ci}`, level + 1, id, rowBrand));
    }
    (tree ?? []).forEach((brand, bi) => walk(brand, `b${bi}`, 0, null, null));
    return rows;
}

function brandTreeHasChildren(rowId, rows) {
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


const REPORTS_LEVEL_COLUMNS = ["Brand", "Channel", "Sub-Channel", "Partner"];


function downloadReportsCsv(sections) {
    const nonEmpty = sections.filter((s) => s.rows && s.rows.length);
    if (!nonEmpty.length) {
        return;
    }
    const header = [...REPORTS_LEVEL_COLUMNS, "MNT", "Actual Sales", "Achi %", "Vs LY %"];
    const lines = [header.join(",")];
    nonEmpty.forEach(({ label, rows }) => {
        rows.forEach((row) => {
            const achiPct = reportsAchiPct(row.mtdSales, row.monthTarget);

            let levelCells;
            if (row.level != null) {
                const path = reportsRowPathArray(row, rows);
                levelCells = REPORTS_LEVEL_COLUMNS.map((_, i) => path[i] ?? "");
            } else {
                levelCells = REPORTS_LEVEL_COLUMNS.map((col) => (col === label ? row.name : ""));
            }
            const cells = [
                ...levelCells,
                moneyFull(row.monthTarget, { nullDash: true }),
                moneyFull(row.mtdSales),
                achiPct == null ? "—" : `${achiPct.toFixed(1)}%`,
                formatDeltaSigned(row.vsLastYearPct, { nullDash: true }),
            ];
            lines.push(buildCsvLine(cells));
        });
    });
    downloadCsv(lines, `reports-${new Date().toISOString().slice(0, 10)}.csv`);
}


function computeHierarchyCounts(rows) {
    const counts = { brand: 0, channel: 0, subChannel: 0, partner: 0 };
    (rows ?? []).forEach((row) => {
        if (row.level === 0 && row.name === "Total") {
            return;
        }
        if (row.level === 0) counts.brand++;
        else if (row.level === 1) counts.channel++;
        else if (row.level === 2) counts.subChannel++;
        else if (row.level === 3) counts.partner++;
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
        <span class="reports-section-count"><span class="reports-section-count-label">Brand:</span>${counts.brand}</span>
        <span class="reports-section-count"><span class="reports-section-count-label">Channel:</span>${counts.channel}</span>
        <span class="reports-section-count"><span class="reports-section-count-label">Sub-Channel:</span>${counts.subChannel}</span>
        <span class="reports-section-count"><span class="reports-section-count-label">Partner:</span>${counts.partner}</span>`;
}


function renderSingleReportsCount(el, label, count) {
    if (!el) {
        return;
    }
    el.innerHTML = `<span class="reports-section-count"><span class="reports-section-count-label">${label}:</span>${count}</span>`;
}


function countFlatRows(rows) {
    return (rows ?? []).filter((row) => row.name !== "Total").length;
}


const BRAND_TREE_LEVEL_ICONS = ["bi-shop", "bi-diagram-2-fill", "bi-diagram-3-fill", "bi-people-fill"];
const BRAND_TREE_LEVEL_LABELS = ["Brand", "Channel", "Sub-Channel", "Partner"];


const REPORT_BRAND_COLOR_SLOTS = 4;

function assignBrandColorSlots(rows) {
    const slotByBrand = new Map();
    rows.forEach((row) => {
        if (row.brand && !slotByBrand.has(row.brand)) {
            slotByBrand.set(row.brand, slotByBrand.size % REPORT_BRAND_COLOR_SLOTS);
        }
    });
    return slotByBrand;
}


function renderBrandHierarchyTable(wrap, rows) {

    const hasRealRows = rows.some((row) => !(row.level === 0 && row.name === "Total"));
    if (!hasRealRows) {
        wrap.innerHTML = `
            <div class="reports-empty-state">
                <i class="bi bi-inbox reports-empty-state-icon" aria-hidden="true"></i>
                <p class="reports-empty-state-title">No data available</p>
            </div>`;
        return;
    }

    const collapsed = new Set(rows.filter((row) => brandTreeHasChildren(row.id, rows)).map((row) => row.id));

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

    const brandColorSlots = assignBrandColorSlots(rows);

    const bodyRows = rows
        .map((row) => {
            const expandable = brandTreeHasChildren(row.id, rows);
            const toggle = expandable
                ? `<i class="bi bi-chevron-right product-snapshot-toggle collapsed" data-toggle-id="${row.id}"></i>`
                : `<span class="product-snapshot-toggle-spacer"></span>`;
            const isTotal = row.level === 0 && row.name === "Total";
            const levelIcon = isTotal
                ? '<i class="bi bi-calculator channel-report-row-icon" aria-hidden="true"></i>'
                : `<span class="brand-tree-row-icon-wrap">
                        <i class="bi ${BRAND_TREE_LEVEL_ICONS[row.level]} brand-tree-row-icon" data-level="${row.level}" aria-hidden="true"></i>
                        <span class="brand-tree-row-icon-label">${BRAND_TREE_LEVEL_LABELS[row.level]}</span>
                   </span>`;
            const brandSlot = row.brand ? brandColorSlots.get(row.brand) : null;
            return `
                <tr data-row-id="${row.id}" data-level="${row.level}"${isTotal ? ' class="channel-report-total-row"' : ""}>
                    <td class="product-snapshot-col-name">
                        <span class="product-snapshot-name-cell" style="padding-left:${row.level * 1.1}rem">
                            ${toggle}
                            ${levelIcon}
                            <span class="product-snapshot-name-text">${row.name}</span>
                        </span>
                    </td>
                    <td>${money(row.monthTarget, { nullDash: true, round: false })}</td>
                    <td>${money(row.mtdSales, { round: false })}</td>
                    <td>${renderReportsAchiCell(row.mtdSales, row.monthTarget, brandSlot)}</td>
                    <td>${renderReportsDelta(row.vsLastYearPct)}</td>
                </tr>`;
        })
        .join("");

    wrap.innerHTML = `
        <table class="product-snapshot-table brand-hierarchy-table">
            ${REPORTS_TABLE_COLGROUP}
            <thead>
                <tr>${reportsColumns("Brand").map((col) => `<th>${reportsHeaderCell(col)}</th>`).join("")}</tr>
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
    subchannel: { label: "Sub-Channel", endpoint: "/api/secondary-sales/reports/subchannels" },
    channel: { label: "Channel", endpoint: "/api/secondary-sales/reports/channels" },
    partner: { label: "Partner", endpoint: "/api/secondary-sales/reports/partners" },
};

function initReportsSection() {
    const card = document.getElementById("reportsSectionCard");
    if (!card) {
        return;
    }

    const tableWrap = document.getElementById("reportsSectionTableWrap");
    const tabToggle = document.getElementById("reportsSectionTabToggle");
    const countsEl = document.getElementById("reportsSectionCounts");
    if (!tableWrap) {
        return;
    }

    let activeTab = "all";
    let brandTreeRows = null;
    let brandTreeRequestSeq = 0;

    const flatRows = { subchannel: null, channel: null, partner: null };
    const flatRequestSeq = { subchannel: 0, channel: 0, partner: 0 };

    let currentFrom = null;
    let currentTo = null;

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

    function renderActiveTab() {
        if (activeTab === "all") {
            if (brandTreeRows === null) {
                renderBrandHierarchyTable(tableWrap, []);
                loadBrandTree();
                return;
            }
            renderBrandHierarchyTable(tableWrap, brandTreeRows);
            renderReportsCounts(countsEl, computeHierarchyCounts(brandTreeRows));
            return;
        }
        const config = FLAT_REPORT_TABS[activeTab];
        if (flatRows[activeTab] === null) {
            renderReportsTable(tableWrap, config.label, []);
            renderSingleReportsCount(countsEl, config.label, 0);
            loadFlatTab(activeTab);
            return;
        }
        renderReportsTable(tableWrap, config.label, flatRows[activeTab]);
        renderSingleReportsCount(countsEl, config.label, countFlatRows(flatRows[activeTab]));
    }


    function withBrand(url) {
        const params = { brand: "all" };
        if (currentFrom) params.from = currentFrom;
        if (currentTo) params.to = currentTo;
        return `${url}?${new URLSearchParams(params)}`;
    }

    async function loadBrandTree() {
        const requestId = ++brandTreeRequestSeq;
        beginLoading();
        let tree = [];
        try {
            const res = await fetch(withBrand("/api/secondary-sales/reports/brand-hierarchy"));
            if (!res.ok) {
                throw new Error("Failed to load brand hierarchy data");
            }
            tree = await res.json();
        } catch (err) {
            tree = [];
        }
        endLoading();
        if (requestId !== brandTreeRequestSeq) {
            return;
        }
        brandTreeRows = flattenBrandTree(tree);
        if (activeTab === "all") {
            renderBrandHierarchyTable(tableWrap, brandTreeRows);
            renderReportsCounts(countsEl, computeHierarchyCounts(brandTreeRows));
        }
    }

    async function loadFlatTab(tab) {
        const config = FLAT_REPORT_TABS[tab];
        const requestId = ++flatRequestSeq[tab];
        beginLoading();
        let rows = [];
        try {
            const res = await fetch(withBrand(config.endpoint));
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
            renderReportsTable(tableWrap, config.label, flatRows[tab]);
            renderSingleReportsCount(countsEl, config.label, countFlatRows(flatRows[tab]));
        }
    }

    tabToggle?.querySelectorAll(".brand-header-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.tab;
            if (tab === activeTab) {
                return;
            }
            activeTab = tab;
            tabToggle.querySelectorAll(".brand-header-item").forEach((b) => b.classList.toggle("active", b === btn));
            renderActiveTab();
        });
    });


    const downloadBtn = document.getElementById("reportsSectionDownloadBtn");
    const downloadPopup = document.getElementById("reportsSectionDownloadPopup");
    const downloadScope = document.getElementById("reportsSectionDownloadScope");
    const downloadConfirmBtn = document.getElementById("reportsSectionDownloadConfirm");

    const downloadPopupHandle = initDownloadPopup({ triggerBtn: downloadBtn, popupEl: downloadPopup });

    async function ensureRowsLoaded(tab) {
        if (tab === "all") {
            if (brandTreeRows === null) {
                await loadBrandTree();
            }
        } else if (flatRows[tab] === null) {
            await loadFlatTab(tab);
        }
    }

    downloadConfirmBtn?.addEventListener("click", async () => {
        const scope = downloadScope ? downloadScope.value : "active";
        const tabs = scope === "both" ? ["all", ...Object.keys(FLAT_REPORT_TABS)] : [activeTab];
        await Promise.all(tabs.map(ensureRowsLoaded));
        downloadReportsCsv(tabs.map((tab) => ({
            label: tab === "all" ? "All Report" : FLAT_REPORT_TABS[tab].label,
            rows: tab === "all" ? brandTreeRows : flatRows[tab],
        })));
        downloadPopupHandle.close();
    });


    function setDateRange(from, to) {
        currentFrom = from;
        currentTo = to;
        brandTreeRows = null;
        Object.keys(flatRows).forEach((tab) => {
            flatRows[tab] = null;
        });
        renderActiveTab();
    }

    renderActiveTab();
    return { setDateRange };
}


let secondarySiteReportSection = null;


let secondaryProductSnapshot = null;

(async function wirePage() {
const [brandPillOptions, channelPillOptions, statusPillOptions] = await Promise.all([
    loadBrandPillOptions("/api/secondary-sales/brands"),
    loadChannelPillOptions("/api/secondary-sales/channels"),
    loadStatusPillOptions("/api/secondary-sales/statuses"),
]);
renderBrandPill("dashboardFyOverviewBrandToggle", brandPillOptions);
renderChannelPill("dashboardFyOverviewChannelToggle", channelPillOptions);
renderStatusPill("dashboardFyOverviewStatusToggle", statusPillOptions);


const reportsSection = initReportsSection();


const dailyTrend = initDailyTrendGraph({ apiBase: "/api/secondary-sales" });


let overviewFrom = null;
let overviewTo = null;
let overviewBrand = "all";
let overviewChannel = "all";
let overviewStatus = "all";
function reloadOverview() {
    loadOverview(overviewFrom, overviewTo, overviewBrand, overviewChannel, overviewStatus);
}


initSalesDateFilter({
    idPrefix: "overviewDateFilter",
    yearsApiUrl: "/api/secondary-sales/comparison2/years",
    monthDefaultMode: "year",
    onFilterChange: (column, from, to, meta) => {
        updateOverviewRangeLabel(from, to);
        overviewFrom = from;
        overviewTo = to;
        reloadOverview();
        dailyTrend.setDateRange(from, to, meta);
        secondaryProductSnapshot?.setDateRange(from, to, meta);
        reportsSection?.setDateRange(from, to);
        secondarySiteReportSection?.setDateRange(from, to);
    },
});
reloadOverview();


initBrandHeader({
    headerId: "dashboardFyOverviewBrandToggle",
    storageKey: BRAND_STORAGE_KEY,
    onBrandChange: (brand) => {
        overviewBrand = brand;
        reloadOverview();
        dailyTrend.setBrand(brand);
        secondaryProductSnapshot?.setBrand(brand);
        secondarySiteReportSection?.setBrand(brand);
    },
});


initChannelHeader({
    headerId: "dashboardFyOverviewChannelToggle",
    storageKey: CHANNEL_STORAGE_KEY,
    onChannelChange: (channel) => {
        overviewChannel = channel;
        reloadOverview();
        dailyTrend.setChannel(channel);
        secondaryProductSnapshot?.setChannel(channel);
        secondarySiteReportSection?.setChannel(channel);
    },
});


initStatusFilter("dashboardFyOverviewStatusToggle", (status) => {
    overviewStatus = status;
    reloadOverview();
    dailyTrend.setStatus(status);
    secondaryProductSnapshot?.setStatus(status);
    secondarySiteReportSection?.setStatus(status);
});
})();


{
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

function productTooltip(row) {
    const parts = [];
    if (row.ean) parts.push(`EAN: ${row.ean}`);
    if (row.hsn) parts.push(`HSN: ${row.hsn}`);
    if (row.tax != null) parts.push(`Tax: ${Number(row.tax).toFixed(1)}%`);
    return parts.join(" | ");
}

const QTY_LEADER_BRAND_COLOR = { abh: "#7C3AED", kylie: "#DB2777" };
const QTY_LEADER_BRAND_LABEL = { abh: "ABH", kylie: "Kylie" };

function formatQtyShort(value) {
    const num = Number(value ?? 0);
    const abs = Math.abs(num);
    if (abs >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`;
    if (abs >= 100000) return `${(num / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return String(Math.round(num));
}

function renderQtyHeaderBadge(rows) {
    const el = document.getElementById("secondaryProductSnapshotQtyBadge");
    if (!el) {
        return;
    }
    if (!rows || !rows.length) {
        el.innerHTML = `<span class="product-snapshot-qty-badge-item product-snapshot-qty-badge-empty">Not Available</span>`;
        return;
    }
    el.innerHTML = rows
        .map((row, index) => {
            const qty = Number(row.qty ?? 0);
            const color = QTY_LEADER_BRAND_COLOR[row.brandKey] || "var(--color-primary)";
            const label = QTY_LEADER_BRAND_LABEL[row.brandKey] || row.label;
            const sep = index > 0 ? `<span class="product-snapshot-qty-badge-sep">•</span>` : "";
            return `${sep}<span class="product-snapshot-qty-badge-item">
                <span class="product-snapshot-qty-badge-brand" style="color:${color};">${label}:</span>
                <span class="product-snapshot-qty-badge-qty">${formatQtyShort(qty)}</span>
            </span>`;
        })
        .join("");
}

const COLUMNS = ["#", "Name", "Sales", "Qty", "Contrib", "Contrib Δ LY", "vs LM", "vs LY"];
const DETAIL_COLUMNS = ["Name", "Sales", "Contrib", "Contrib Δ LY", "vs LM", "vs LY"];

const PRODUCT_SNAPSHOT_COLUMN_ICONS = {
    "#": "bi-trophy-fill",
    "Name": "bi-tag-fill",
    "Sales": "bi-cash-stack",
    "Qty": "bi-boxes",
    "Contrib": "bi-pie-chart-fill",
    "Contrib Δ LY": "bi-arrow-down-up",
    "vs LM": "bi-calendar3",
    "vs LY": "bi-arrow-left-right",
};

function productSnapshotHeaderCell(label) {
    return `<span class="product-snapshot-header-cell">
        <i class="bi ${PRODUCT_SNAPSHOT_COLUMN_ICONS[label] || "bi-list-columns"} product-snapshot-header-icon" aria-hidden="true"></i>
        <span class="product-snapshot-header-icon-label">${label}</span>
    </span>`;
}

const LEVEL_LABELS = {
    product: "Products",
    category: "Category",
    subcategory: "Sub-category",
};

function levelMetricOptions(level) {
    const name = LEVEL_LABELS[level];
    return [
        { value: "top10-value", label: `Top 10 ${name} by Value` },
        { value: "top10-qty", label: `Top 10 ${name} by Qty` },
        { value: "bottom10-value", label: `Below 10 ${name} by Value` },
        { value: "bottom10-qty", label: `Below 10 ${name} by Qty` },
    ];
}

function flattenTree(tree) {
    const rows = [];
    (tree ?? []).forEach((category, ci) => {
        const categoryId = `c${ci}`;
        rows.push({
            id: categoryId,
            level: 0,
            index: category.index,
            name: category.name,
            salesValue: category.salesValue,
            salesQty: category.salesQty,
            contribPct: category.contribPct,
            contribDeltaLYPct: category.contribDeltaLYPct,
            vsLastYearPct: category.vsLastYearPct,
            vsLastMonthPct: category.vsLastMonthPct,
        });
        (category.subCategories ?? []).forEach((sub, si) => {
            const subId = `${categoryId}-s${si}`;
            rows.push({
                id: subId,
                level: 1,
                parent: categoryId,
                index: sub.index,
                name: sub.name,
                salesValue: sub.salesValue,
                salesQty: sub.salesQty,
                contribPct: sub.contribPct,
                contribDeltaLYPct: sub.contribDeltaLYPct,
                vsLastYearPct: sub.vsLastYearPct,
                vsLastMonthPct: sub.vsLastMonthPct,
            });
            (sub.products ?? []).forEach((product, pi) => {
                rows.push({
                    id: `${subId}-p${pi}`,
                    level: 2,
                    parent: subId,
                    index: product.index,
                    name: product.description ?? product.articleCode ?? "—",
                    salesValue: product.salesValue,
                    salesQty: product.salesQty,
                    contribPct: product.contribPct,
                    contribDeltaLYPct: product.contribDeltaLYPct,
                    vsLastYearPct: product.vsLastYearPct,
                    vsLastMonthPct: product.vsLastMonthPct,
                    ean: product.ean,
                    hsn: product.hsn,
                    tax: product.tax,
                });
            });
        });
    });
    return rows;
}

function hasChildren(rowId, rows) {
    return rows.some((row) => row.parent === rowId);
}

function renderTable(wrap, rows) {
    if (!rows.length) {
        wrap.innerHTML = `<div class="product-snapshot-empty">No data available.</div>`;
        return;
    }

    const collapsed = new Set(rows.filter((row) => hasChildren(row.id, rows)).map((row) => row.id));

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

    const bodyRows = rows
        .map((row) => {
            const expandable = hasChildren(row.id, rows);
            const toggle = expandable
                ? `<i class="bi bi-chevron-right product-snapshot-toggle collapsed" data-toggle-id="${row.id}"></i>`
                : `<span class="product-snapshot-toggle-spacer"></span>`;
            const tooltip = row.level === 2 ? productTooltip(row) : "";
            return `
                <tr data-row-id="${row.id}" data-level="${row.level}">
                    <td class="product-snapshot-col-name">
                        <span class="product-snapshot-name-cell" style="padding-left:${row.level * 1.1}rem" ${tooltip ? `title="${tooltip}"` : ""}>
                            ${toggle}
                            <span class="product-snapshot-name-text">${row.name}</span>
                        </span>
                    </td>
                    <td>${formatMoney(row.salesValue, { nullDash: true, round: false })}</td>
                    <td>${row.contribPct == null ? "—" : `${Number(row.contribPct).toFixed(1)}%`}</td>
                    <td>${row.contribDeltaLYPct == null ? "—" : renderDelta(row.contribDeltaLYPct)}</td>
                    <td>${renderDelta(row.vsLastMonthPct)}</td>
                    <td>${renderDelta(row.vsLastYearPct)}</td>
                </tr>`;
        })
        .join("");

    wrap.innerHTML = `
        <table class="product-snapshot-table">
            <thead>
                <tr>${DETAIL_COLUMNS.map((col) => `<th>${productSnapshotHeaderCell(col)}</th>`).join("")}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>`;

    wrap.querySelectorAll(".product-snapshot-toggle").forEach((toggle) => {
        toggle.addEventListener("click", () => {
            const id = toggle.dataset.toggleId;
            const row = rows.find((r) => r.id === id);
            const opening = collapsed.has(id);

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

function downloadRankingCsv(rows) {
    if (!rows.length) {
        return;
    }
    const header = ["Name", "Sales", "Qty", "Contrib %", "Contrib Δ LY %", "vs LM %", "vs LY %"];
    const lines = [header.join(",")];
    rows.forEach((row) => {
        const cells = [
            row.name ?? "—",
            formatMoneyFull(row.salesValue, { nullDash: true }),
            Number(row.salesQty ?? 0).toLocaleString("en-IN"),
            row.contribPct == null ? "—" : `${Number(row.contribPct).toFixed(1)}%`,
            formatDeltaSigned(row.contribDeltaLYPct, { nullDash: true }),
            formatDeltaSigned(row.vsLastMonthPct, { nullDash: true }),
            formatDeltaSigned(row.vsLastYearPct, { nullDash: true }),
        ];
        lines.push(buildCsvLine(cells));
    });
    downloadCsv(lines, `secondary-sales-product-ranking-${new Date().toISOString().slice(0, 10)}.csv`);
}

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
    downloadCsv(lines, `secondary-sales-product-research-${new Date().toISOString().slice(0, 10)}.csv`);
}

function wireLevelRankingFilter({ filterToggleId, filterBodyId, levelToggleId, selectId, resultBodyId, downloadBtnId,
                                    downloadRangeSelectId, downloadRangeInputId, downloadPopupId, downloadConfirmBtnId, getData }) {
    const filterToggle = document.getElementById(filterToggleId);
    const filterBody = document.getElementById(filterBodyId);
    const levelToggle = document.getElementById(levelToggleId);
    const select = document.getElementById(selectId);
    const resultBody = document.getElementById(resultBodyId);
    const downloadBtn = document.getElementById(downloadBtnId);
    const downloadRangeSelect = downloadRangeSelectId ? document.getElementById(downloadRangeSelectId) : null;
    const downloadRangeInput = downloadRangeInputId ? document.getElementById(downloadRangeInputId) : null;
    const downloadPopup = downloadPopupId ? document.getElementById(downloadPopupId) : null;
    const downloadConfirmBtn = downloadConfirmBtnId ? document.getElementById(downloadConfirmBtnId) : null;
    if (!filterToggle || !filterBody || !levelToggle || !select || !resultBody) {
        return { rerender() {} };
    }

    const levelButtons = Array.from(levelToggle.querySelectorAll(".product-snapshot-level-btn"));
    const ON_SCREEN_LIMIT = 10;
    const PRODUCT_LEVEL_DOWNLOAD_CAP = 100;
    let currentRows = [];
    let currentNameKey = null;

    function updateDownloadRangeForLevel(level) {
        if (!downloadRangeInput) {
            return;
        }
        if (level === "product") {
            downloadRangeInput.max = String(PRODUCT_LEVEL_DOWNLOAD_CAP);
        } else {
            downloadRangeInput.removeAttribute("max");
        }
    }

    function populateSelect(level) {
        const previous = select.value;
        const options = levelMetricOptions(level);
        select.innerHTML = options.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join("");
        if (options.some((opt) => opt.value === previous)) {
            select.value = previous;
        }
    }

    function rankedRows(level, metricValue, limit) {
        const data = getData();
        if (!data) {
            return [];
        }
        const [order, metric] = metricValue.split("-");
        const ascending = order === "bottom10";

        if (level === "product") {
            const source = metric === "value"
                ? (ascending ? data.bottomByValue : data.topByValue)
                : (ascending ? data.bottomByQty : data.topByQty);
            return (source ?? []).slice(0, limit);
        }

        const source = level === "category" ? data.categories ?? [] : data.subCategories ?? [];
        const sortKey = metric === "value" ? "salesValue" : "salesQty";
        return [...source]
            .sort((a, b) => (ascending ? Number(a[sortKey]) - Number(b[sortKey]) : Number(b[sortKey]) - Number(a[sortKey])))
            .slice(0, limit);
    }

    function renderResult() {
        const level = levelToggle.querySelector(".product-snapshot-level-btn.active")?.dataset.level ?? "product";
        const option = levelMetricOptions(level).find((opt) => opt.value === select.value);
        const label = option ? option.label : select.value;
        const nameKey = level === "category" ? "category" : level === "subcategory" ? "subCategory" : null;
        const rows = rankedRows(level, select.value, ON_SCREEN_LIMIT);
        currentRows = rows;
        currentNameKey = nameKey;

        if (!rows.length) {
            resultBody.innerHTML = `
                <table class="product-snapshot-table">
                    <thead>
                        <tr>${COLUMNS.map((col) => `<th>${productSnapshotHeaderCell(col)}</th>`).join("")}</tr>
                    </thead>
                    <tbody>
                        <tr><td class="product-snapshot-table-empty" colspan="${COLUMNS.length}">No data available for ${label}.</td></tr>
                    </tbody>
                </table>`;
            return;
        }

        const bodyRows = rows
            .map((row, index) => {
                const name = nameKey ? row[nameKey] : (row.description ?? row.articleCode ?? "—");
                return `
                    <tr>
                        <td class="product-snapshot-col-index">${index + 1}</td>
                        <td class="product-snapshot-col-name"><span class="product-snapshot-name-text">${name}</span></td>
                        <td>${formatMoney(row.salesValue, { nullDash: true, round: false })}</td>
                        <td>${Number(row.salesQty ?? 0).toLocaleString("en-IN")}</td>
                        <td>${row.contribPct == null ? "—" : `${Number(row.contribPct).toFixed(1)}%`}</td>
                        <td>${row.contribDeltaLYPct == null ? "—" : renderDelta(row.contribDeltaLYPct)}</td>
                        <td>${renderDelta(row.vsLastMonthPct)}</td>
                        <td>${renderDelta(row.vsLastYearPct)}</td>
                    </tr>`;
            })
            .join("");

        resultBody.innerHTML = `
            <table class="product-snapshot-table">
                <thead>
                    <tr>${COLUMNS.map((col) => `<th>${productSnapshotHeaderCell(col)}</th>`).join("")}</tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>`;
    }

    levelButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.classList.contains("active")) {
                return;
            }
            levelButtons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            populateSelect(btn.dataset.level);
            updateDownloadRangeForLevel(btn.dataset.level);
            renderResult();
        });
    });

    select.addEventListener("change", renderResult);

    filterToggle.addEventListener("click", () => {
        const opening = filterBody.hidden;
        filterBody.hidden = !opening;
        filterToggle.classList.toggle("active", opening);
        filterToggle.setAttribute("aria-expanded", String(opening));
    });

    if (downloadRangeSelect && downloadRangeInput) {
        downloadRangeSelect.addEventListener("change", () => {
            downloadRangeInput.hidden = downloadRangeSelect.value !== "range";
        });
    }

    const downloadPopupHandle = initDownloadPopup({ triggerBtn: downloadBtn, popupEl: downloadPopup });

    if (downloadConfirmBtn) {
        downloadConfirmBtn.addEventListener("click", () => {
            const rangeValue = downloadRangeSelect ? downloadRangeSelect.value : "current";
            let rows;
            let nameKey;
            if (rangeValue === "current") {
                rows = currentRows;
                nameKey = currentNameKey;
            } else {
                const level = levelToggle.querySelector(".product-snapshot-level-btn.active")?.dataset.level ?? "product";
                nameKey = level === "category" ? "category" : level === "subcategory" ? "subCategory" : null;
                const parsed = Math.floor(Number(downloadRangeInput?.value));
                const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : ON_SCREEN_LIMIT;
                rows = rankedRows(level, select.value, limit);
            }
            downloadRankingCsv(rows.map((row) => ({
                name: nameKey ? row[nameKey] : (row.description ?? row.articleCode ?? "—"),
                salesValue: row.salesValue,
                salesQty: row.salesQty,
                contribPct: row.contribPct,
                contribDeltaLYPct: row.contribDeltaLYPct,
                vsLastYearPct: row.vsLastYearPct,
                vsLastMonthPct: row.vsLastMonthPct,
            })));
            downloadPopupHandle.close();
        });
    }

    const initialLevel = levelButtons.find((b) => b.classList.contains("active"))?.dataset.level ?? "product";
    populateSelect(initialLevel);
    updateDownloadRangeForLevel(initialLevel);
    renderResult();

    return { rerender: renderResult };
}

function initSecondaryProductSnapshot() {
    const card = document.getElementById("secondaryProductSnapshotCard");
    if (!card) {
        return { load() {}, setDateRange() {}, setBrand() {}, setChannel() {}, setStatus() {} };
    }

    const researchBtn = document.getElementById("secondaryProductResearchBtn");
    const researchBackdrop = document.getElementById("secondaryProductResearchBackdrop");
    const researchClose = document.getElementById("secondaryProductResearchClose");
    const researchDownloadBtn = document.getElementById("secondaryProductResearchDownloadBtn");
    const researchTableWrap = document.getElementById("secondaryProductResearchTableWrap");

    let latestData = null;
    let latestResearchRows = [];
    let requestSeq = 0;
    let periodFrom = null;
    let periodTo = null;
    let brand = "all";
    let channel = "all";
    let status = "all";

    const rankingFilter = wireLevelRankingFilter({
        filterToggleId: "secondaryProductSnapshotFilterToggleA",
        filterBodyId: "secondaryProductSnapshotFilterBodyA",
        levelToggleId: "secondaryProductSnapshotLevelToggleA",
        selectId: "secondaryProductSnapshotPanelFilterA",
        resultBodyId: "secondaryProductSnapshotPanelBodyA",
        downloadBtnId: "secondaryProductSnapshotRankingDownloadBtn",
        downloadRangeSelectId: "secondaryProductSnapshotDownloadRangeA",
        downloadRangeInputId: "secondaryProductSnapshotDownloadRangeInputA",
        downloadPopupId: "secondaryProductSnapshotDownloadPopupA",
        downloadConfirmBtnId: "secondaryProductSnapshotDownloadConfirmA",
        getData: () => latestData,
    });

    async function refresh() {
        const requestId = ++requestSeq;
        card.classList.add("is-loading");
        try {
            let url = `/api/secondary-sales/product-level?brand=${encodeURIComponent(brand)}&channel=${encodeURIComponent(channel)}&status=${encodeURIComponent(status)}`;
            if (periodFrom && periodTo) {
                url += `&from=${encodeURIComponent(periodFrom)}&to=${encodeURIComponent(periodTo)}`;
            }
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error("Failed to load product level data");
            }
            const data = await res.json();
            if (requestId !== requestSeq) {
                return;
            }
            latestData = data;
        } catch (err) {
            if (requestId !== requestSeq) {
                return;
            }
            latestData = null;
        }

        card.classList.remove("is-loading");
        latestResearchRows = flattenTree(latestData?.tree);
        if (researchTableWrap) {
            renderTable(researchTableWrap, latestResearchRows);
        }
        rankingFilter.rerender();
        renderQtyHeaderBadge(latestData?.brandQuantities);
    }

    if (researchBtn && researchBackdrop) {
        researchBtn.addEventListener("click", () => {
            researchBackdrop.hidden = false;
        });
        researchClose?.addEventListener("click", () => {
            researchBackdrop.hidden = true;
        });
        researchBackdrop.addEventListener("click", (event) => {
            if (event.target === researchBackdrop) {
                researchBackdrop.hidden = true;
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !researchBackdrop.hidden) {
                researchBackdrop.hidden = true;
            }
        });
    }

    researchDownloadBtn?.addEventListener("click", () => downloadResearchCsv(latestResearchRows));

    function setDateRange(from, to, meta) {
        if (meta && meta.mode === "filter" && from && to) {
            periodFrom = from;
            periodTo = to;
        } else {
            periodFrom = null;
            periodTo = null;
        }
        refresh();
    }

    function setBrand(nextBrand) {
        brand = nextBrand;
        refresh();
    }

    function setChannel(nextChannel) {
        channel = nextChannel;
        refresh();
    }

    function setStatus(nextStatus) {
        status = nextStatus;
        refresh();
    }

    refresh();

    return { load: refresh, setDateRange, setBrand, setChannel, setStatus };
}


secondaryProductSnapshot = initSecondaryProductSnapshot();
}


const SECONDARY_SITE_REPORT_COLGROUP = `<colgroup>
    <col style="width:5%"><col style="width:10%"><col style="width:9%"><col style="width:8%">
    <col style="width:10%"><col style="width:10%"><col style="width:9%"><col style="width:10%">
    <col style="width:10%"><col style="width:10%"><col style="width:9%">
</colgroup>`;

const SECONDARY_SITE_REPORT_COLUMNS = [
    { label: "Rank", icon: "bi-trophy-fill" },
    { label: "Site_Code", icon: "bi-upc-scan" },
    { label: "Brand", icon: "bi-shop" },
    { label: "Store_Name", icon: "bi-building" },
    { label: "City", icon: "bi-geo-alt-fill" },
    { label: "State", icon: "bi-map-fill" },
    { label: "Region", icon: "bi-compass-fill" },
    { label: "MNT", icon: "bi-bullseye" },
    { label: "Actual Sales", icon: "bi-cash-stack" },
    { label: "Achi%", icon: "bi-graph-up-arrow" },
    { label: "Vs LY", icon: "bi-arrow-left-right" },
];

function secondarySiteReportEscapeAttr(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function secondarySiteReportHeaderCell(icon, label) {
    return `<span class="secondary-site-report-header-cell">
        <i class="bi ${icon} secondary-site-report-header-icon" aria-hidden="true"></i>
        <span class="secondary-site-report-header-icon-label">${label}</span>
    </span>`;
}

function secondarySiteReportAchiPct(sales, target) {
    const t = Number(target ?? 0);
    const s = Number(sales ?? 0);
    return t > 0 ? (s / t) * 100 : null;
}

function renderSecondarySiteReportAchiCell(sales, target) {
    const pct = secondarySiteReportAchiPct(sales, target);
    const barWidth = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
    const pctLabel = pct == null ? "—" : `${pct.toFixed(1)}%`;
    return `
        <span class="secondary-site-report-achi-cell">
            <span class="secondary-site-report-achi-track">
                <span class="secondary-site-report-achi-fill" style="width:${barWidth.toFixed(1)}%"></span>
            </span>
            <span class="secondary-site-report-achi-pct">${pctLabel}</span>
        </span>`;
}

function secondarySiteReportTrendClass(value) {
    return Number(value ?? 0) >= 0 ? "positive" : "negative";
}

function renderSecondarySiteReportDelta(value) {
    return `<span class="product-snapshot-delta ${secondarySiteReportTrendClass(value)}">${formatDelta(value, { nullDash: true })}</span>`;
}

function downloadSecondarySiteReportCsv(rows) {

    if (!rows.some((row) => row.rank != null)) {
        return;
    }
    const header = ["Rank", "Site_Code", "Brand", "Store_Name", "City", "State", "Region", "MNT", "Actual Sales", "Achi %", "Vs LY %"];
    const lines = [header.join(",")];
    rows.forEach((row) => {
        const isTotal = row.rank == null;
        const pct = secondarySiteReportAchiPct(row.actualSales, row.monthTarget);
        const pctText = pct == null ? "—" : `${pct.toFixed(1)}%`;
        const deltaText = formatDeltaSigned(row.vsLastYearPct, { nullDash: true });
        const mntValue = moneyFull(row.monthTarget, { nullDash: true });
        const actualSalesValue = moneyFull(row.actualSales);
        const cells = [
            isTotal ? `Total: ${row.totalCount ?? 0}` : row.rank,
            row.siteCode ?? "",
            isTotal ? `Brand: ${row.brandCount ?? 0}` : (row.brand ?? ""),
            row.storeName ?? "",
            isTotal ? `City: ${row.cityCount ?? 0}` : (row.city ?? ""),
            isTotal ? `State: ${row.stateCount ?? 0}` : (row.state ?? ""),
            isTotal ? `Region: ${row.regionCount ?? 0}` : (row.region ?? ""),
            isTotal ? `MNT: ${mntValue}` : mntValue,
            isTotal ? `Actual Sales: ${actualSalesValue}` : actualSalesValue,
            isTotal ? `Achi%: ${pctText}` : pctText,
            isTotal ? `Vs LY: ${deltaText}` : deltaText,
        ];
        lines.push(buildCsvLine(cells));
    });
    downloadCsv(lines, `secondary-site-master-report-${new Date().toISOString().slice(0, 10)}.csv`);
}

function renderSecondarySiteReportTable(wrap, rows) {

    const realRows = rows.filter((row) => row.rank != null);
    const bodyRows = !realRows.length
        ? `<tr><td colspan="${SECONDARY_SITE_REPORT_COLUMNS.length}" class="secondary-site-report-table-empty">
            <div class="reports-empty-state">
                <i class="bi bi-inbox reports-empty-state-icon" aria-hidden="true"></i>
                <p class="reports-empty-state-title">No data available</p>
            </div>
        </td></tr>`
        : rows.map((row) => {
            const isTotal = row.rank == null;
            const rankCell = isTotal
                ? `<i class="bi bi-calculator secondary-site-report-row-icon" aria-hidden="true"></i>`
                : row.rank;
            const nameCell = isTotal
                ? `<span class="secondary-site-report-name-cell"><span>Total: ${row.totalCount ?? 0}</span></span>`
                : `<span class="secondary-site-report-name-cell">
                        <span class="secondary-site-report-row-icon-wrap">
                            <i class="bi bi-shop secondary-site-report-row-icon" aria-hidden="true"></i>
                            <span class="secondary-site-report-row-icon-label">Site</span>
                        </span>
                        <span>${row.siteCode}</span>
                   </span>`;
            const brandCell = isTotal ? `Brand: ${row.brandCount ?? 0}` : (row.brand ?? "—");
            const cityCell = isTotal ? `City: ${row.cityCount ?? 0}` : (row.city ?? "—");
            const stateCell = isTotal ? `State: ${row.stateCount ?? 0}` : (row.state ?? "—");
            const regionCell = isTotal ? `Region: ${row.regionCount ?? 0}` : (row.region ?? "—");
            const mntValue = money(row.monthTarget, { nullDash: true, round: false });
            const actualSalesValue = money(row.actualSales, { round: false });
            const storeName = row.storeName ?? "—";
            return `
        <tr${isTotal ? ' class="secondary-site-report-total-row"' : ""}>
            <td>${rankCell}</td>
            <td>${nameCell}</td>
            <td>${brandCell}</td>
            <td class="secondary-site-report-store-name-cell" title="${secondarySiteReportEscapeAttr(storeName)}">${storeName}</td>
            <td>${cityCell}</td>
            <td>${stateCell}</td>
            <td>${regionCell}</td>
            <td>${isTotal ? `MNT: ${mntValue}` : mntValue}</td>
            <td>${isTotal ? `Actual Sales: ${actualSalesValue}` : actualSalesValue}</td>
            <td>${isTotal ? "Achi%: " : ""}${renderSecondarySiteReportAchiCell(row.actualSales, row.monthTarget)}</td>
            <td>${isTotal ? "Vs LY: " : ""}${renderSecondarySiteReportDelta(row.vsLastYearPct)}</td>
        </tr>`;
        }).join("");

    wrap.innerHTML = `
        <table class="secondary-site-report-table">
            ${SECONDARY_SITE_REPORT_COLGROUP}
            <thead>
                <tr>${SECONDARY_SITE_REPORT_COLUMNS.map((col) => `<th>${secondarySiteReportHeaderCell(col.icon, col.label)}</th>`).join("")}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>`;
}


function initSecondarySiteReport() {
    const card = document.getElementById("secondarySiteReportCard");
    const wrap = document.getElementById("secondarySiteReportTableWrap");
    const downloadBtn = document.getElementById("secondarySiteReportDownloadBtn");
    if (!card || !wrap) {
        return { setDateRange() {}, setBrand() {}, setChannel() {}, setStatus() {} };
    }
    let siteReportRows = [];
    let requestSeq = 0;
    let currentFrom = null;
    let currentTo = null;
    let currentBrand = "all";
    let currentChannel = "all";
    let currentStatus = "all";
    downloadBtn?.addEventListener("click", () => downloadSecondarySiteReportCsv(siteReportRows));


    function load() {
        const requestId = ++requestSeq;
        const params = new URLSearchParams({ brand: currentBrand, channel: currentChannel, status: currentStatus });
        if (currentFrom) params.set("from", currentFrom);
        if (currentTo) params.set("to", currentTo);
        card.classList.add("is-loading");
        fetch(`/api/secondary-sales/reports/site-master-secondary-sale?${params.toString()}`)
            .then((res) => {
                if (!res.ok) {
                    throw new Error("Failed to load Secondary Sale site master report data");
                }
                return res.json();
            })
            .then((rows) => {
                if (requestId !== requestSeq) {
                    return;
                }
                siteReportRows = rows ?? [];
                renderSecondarySiteReportTable(wrap, siteReportRows);
            })
            .catch(() => {
                if (requestId !== requestSeq) {
                    return;
                }
                renderSecondarySiteReportTable(wrap, []);
            })
            .finally(() => {
                if (requestId === requestSeq) {
                    card.classList.remove("is-loading");
                }
            });
    }

    function setDateRange(from, to) {
        currentFrom = from;
        currentTo = to;
        load();
    }

    function setBrand(nextBrand) {
        currentBrand = nextBrand;
        load();
    }

    function setChannel(nextChannel) {
        currentChannel = nextChannel;
        load();
    }

    function setStatus(nextStatus) {
        currentStatus = nextStatus;
        load();
    }

    load();

    return { setDateRange, setBrand, setChannel, setStatus };
}

secondarySiteReportSection = initSecondarySiteReport();
