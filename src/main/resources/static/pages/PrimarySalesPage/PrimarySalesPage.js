import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { buildCsvLine, downloadCsv, initDownloadPopup } from "/components/ExcelDownloadButton/ExcelDownloadButton.js";
import { initInsightsDateFilter } from "/components/SalesDateFilter/SalesDateFilter.js";
import { initBrandHeader, loadBrandPillOptions, brandNameToCode, renderBrandPill } from "/components/BrandFilter/BrandFilter.js";
import { initChannelHeader, loadChannelPillOptions, renderChannelPill } from "/components/ChannelFilter/ChannelFilter.js";
import { initStatusFilter } from "/components/StatusFilter/StatusFilter.js";
import { formatMoney, formatMoneyFull, formatDelta, formatDeltaSigned } from "/Shared/js/format.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating } from "/Shared/js/feature-guard.js";

const Page = {};


Page.initBrandHeader = initBrandHeader;
Page.initChannelHeader = initChannelHeader;
Page.initStatusFilter = initStatusFilter;


Page.initInsightsDateFilter = initInsightsDateFilter;


{



function growthPct(current, previous) {
    if (previous === 0) {
        return current === 0 ? 0 : null;
    }
    return ((current - previous) / previous) * 100;
}

function daysBetweenInclusive(from, to) {
    return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

const RANGE_LABEL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


function formatRangeDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    return `${day}-${RANGE_LABEL_MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function lastDayOfMonthDate(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}


function monthEndDate(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}


function formatRangeLabel(periodFrom, periodTo, includesCurrentMonth, today) {
    const fromStr = formatRangeDate(periodFrom);
    if (includesCurrentMonth) {
        const cutoff = periodTo > today ? today : periodTo;
        return `${fromStr} to ${formatRangeDate(cutoff)} (${cutoff.getDate()} of ${lastDayOfMonthDate(periodTo)} days)`;
    }
    const toStr = formatRangeDate(periodTo);
    return `${fromStr} to ${toStr} (${daysBetweenInclusive(periodFrom, periodTo)} days)`;
}


function resolvePeriodProgress(from, to, today) {
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const clampedTo = to > todayMidnight ? todayMidnight : to;
    const daysInPeriod = daysBetweenInclusive(from, to);
    const daysElapsed = from > todayMidnight ? 0 : daysBetweenInclusive(from, clampedTo);
    return { daysElapsed, daysInPeriod };
}


function toIsoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function initTargetVsAchievement(options = {}) {
    const {
        monthlyApiUrl = "/api/primary-sales/monthly",
    } = options;

    const root = document.getElementById("targetVsAchievementSection");
    if (!root) {
        return { setDateRange() {}, setBrand() {}, setChannel() {}, setStatus() {} };
    }

    let brand = "all";
    let channel = "all";
    let status = "all";
    const today = new Date();
    let periodFrom = new Date(today.getFullYear(), today.getMonth(), 1);
    let periodTo = monthEndDate(today);
    let { daysElapsed, daysInPeriod } = resolvePeriodProgress(periodFrom, periodTo, today);

    let includesCurrentMonth = true;

    let periodStartsInCurrentMonth = true;

    let isFilterActive = false;

    let requestSeq = 0;


    function withBrand(url) {
        return `${url}?brand=${encodeURIComponent(brand)}&channel=${encodeURIComponent(channel)}&status=${encodeURIComponent(status)}&from=${encodeURIComponent(toIsoDate(periodFrom))}&to=${encodeURIComponent(toIsoDate(periodTo))}`;
    }


    const kpiGaugeDom = document.getElementById("taMtdAchievementGauge");
    const kpiGaugeChart = (kpiGaugeDom && typeof window.echarts !== "undefined") ? window.echarts.init(kpiGaugeDom) : null;
    window.addEventListener("resize", () => {
        kpiGaugeChart?.resize();
    });

    document.addEventListener("permissions-applied", () => kpiGaugeChart?.resize());
    if (kpiGaugeChart) {

        window.addEventListener("theme-changed", () => {
            resolveGaugeColors();
            if (lastGaugePeriodSales !== null && lastGaugePeriodTarget !== null) {
                renderMtdAchievement(lastGaugePeriodSales, lastGaugePeriodTarget);
            }
        });
    }


    let GAUGE_RED, GAUGE_YELLOW, GAUGE_GREEN, KPI_TEXT_PRIMARY, KPI_TEXT_SECONDARY;
    function resolveGaugeColors() {
        const rootStyle = getComputedStyle(document.documentElement);
        GAUGE_RED = (rootStyle.getPropertyValue("--color-danger").trim()) || "#DC2626";
        GAUGE_YELLOW = (rootStyle.getPropertyValue("--color-warning").trim()) || "#D97706";
        GAUGE_GREEN = (rootStyle.getPropertyValue("--color-success").trim()) || "#16803C";
        KPI_TEXT_PRIMARY = (rootStyle.getPropertyValue("--color-text-primary").trim()) || "#17221E";
        KPI_TEXT_SECONDARY = (rootStyle.getPropertyValue("--color-text-secondary").trim()) || "#66756F";
    }
    resolveGaugeColors();

    let lastGaugePeriodSales = null;
    let lastGaugePeriodTarget = null;


    function renderMtdAchievement(periodSales, periodTarget) {
        lastGaugePeriodSales = periodSales;
        lastGaugePeriodTarget = periodTarget;
        const footerEl = document.getElementById("taMtdAchievementFooter");
        if (footerEl) {
            footerEl.innerHTML = `<strong>${formatMoney(periodSales)}</strong> / ${formatMoney(periodTarget)}`;
        }

        const remainingEl = document.getElementById("taMtdAchievementRemaining");
        if (remainingEl) {
            if (!(periodTarget > 0)) {
                remainingEl.textContent = "—";
            } else {
                const remaining = periodTarget - periodSales;
                remainingEl.innerHTML = remaining > 0
                    ? `You are <strong>${formatMoney(remaining)}</strong> short of your target of <strong>${formatMoney(periodTarget)}</strong>`
                    : `You are <strong>${formatMoney(Math.abs(remaining))}</strong> ahead of your target of <strong>${formatMoney(periodTarget)}</strong>`;
            }
        }
        if (!kpiGaugeChart) {
            return;
        }
        const achievedPct = periodTarget > 0 ? (periodSales / periodTarget) * 100 : null;
        const gaugeValue = achievedPct === null ? 0 : Math.min(Math.max(achievedPct, 0), 100);
        const displayText = achievedPct === null ? "—" : `${achievedPct.toFixed(1)}%`;
        kpiGaugeChart.setOption({
            series: [{
                type: "gauge",
                startAngle: 200,
                endAngle: -20,
                min: 0,
                max: 100,
                radius: "100%",
                center: ["50%", "62%"],
                axisLine: {
                    lineStyle: {
                        width: 8,
                        color: [
                            [0.4, GAUGE_RED],
                            [0.75, GAUGE_YELLOW],
                            [1, GAUGE_GREEN],
                        ],
                    },
                },

                pointer: {
                    show: true,
                    icon: "rect",
                    width: 5,
                    length: "16%",
                    offsetCenter: [0, "-92%"],
                    itemStyle: { color: KPI_TEXT_PRIMARY },
                },
                axisTick: { show: false },
                splitLine: { show: false },
                axisLabel: { show: false },
                anchor: { show: false },
                progress: { show: false },

                detail: {
                    valueAnimation: true,
                    offsetCenter: [0, "5%"],
                    fontSize: 10,
                    fontWeight: 700,
                    color: KPI_TEXT_PRIMARY,
                    formatter: () => displayText,
                },
                title: {
                    show: true,
                    offsetCenter: [0, "28%"],
                    fontSize: 7,
                    color: KPI_TEXT_SECONDARY,
                },
                data: [{ value: gaugeValue, name: "of Month Target" }],
            }],
        });
    }


    function loadKpiCards(monthlyDataPromise, requestId) {
        monthlyDataPromise.then((data) => {
            if (!data || requestId !== requestSeq) {
                return;
            }
            const periodSales = Number(data.periodSales ?? 0);
            const periodTarget = Number(data.periodTarget ?? 0);
            renderMtdAchievement(periodSales, periodTarget);
        }).catch(() => {});
    }

    function setText(id, text, deltaValue) {
        const el = document.getElementById(id);
        if (!el) {
            return;
        }
        el.textContent = text;
        el.classList.remove("positive", "negative");
        if (deltaValue !== undefined && deltaValue !== null) {
            el.classList.add(deltaValue >= 0 ? "positive" : "negative");
        }
    }


    function setCalc(id, calcText, sign) {
        const el = document.getElementById(id);
        if (!el) {
            return;
        }
        if (calcText) {
            el.setAttribute("data-calc", calcText);
        } else {
            el.removeAttribute("data-calc");
        }

        if (sign !== undefined && sign !== null) {
            el.setAttribute("data-calc-sign", sign >= 0 ? "positive" : "negative");
        } else {
            el.removeAttribute("data-calc-sign");
        }
    }


    function updateRangeLabel() {
        const el = document.getElementById("taOverviewRangeLabel");
        if (!el) {
            return;
        }
        el.textContent = formatRangeLabel(periodFrom, periodTo, includesCurrentMonth, new Date());
    }


    function insightsZeroSafeGrowthPct(current, previous) {
        const prev = Number(previous ?? 0);
        if (prev === 0) {
            return null;
        }
        return ((Number(current ?? 0) - prev) / prev) * 100;
    }


    function loadInsightsCard(monthlyDataPromise, requestId, periodStartsInCurrentMonth, filterActive, monthsSpanned,
                               capturedDaysElapsed) {
        monthlyDataPromise.then((data) => {
            if (!data || requestId !== requestSeq) {
                return;
            }

            const periodTarget = Number(data.periodTarget ?? 0);
            const previousPeriodTarget = Number(data.previousPeriodTarget ?? 0);
            const lastYearPeriodTarget = Number(data.lastYearPeriodTarget ?? 0);

            setText("taInsightTargetCurrent", formatMoney(periodTarget));
            setCalc("taInsightTargetCurrent", `= ${formatMoney(periodTarget)}`);
            const targetVsLM = monthsSpanned > 1 ? null : insightsZeroSafeGrowthPct(periodTarget, previousPeriodTarget);
            const targetVsLY = insightsZeroSafeGrowthPct(periodTarget, lastYearPeriodTarget);
            setText("taInsightTargetVsLM", formatDelta(targetVsLM, { nullDash: true }), targetVsLM);
            setCalc("taInsightTargetVsLM", targetVsLM == null ? "" :
                `(${formatMoney(periodTarget)}−${formatMoney(previousPeriodTarget)})÷${formatMoney(previousPeriodTarget)}×100 = ${formatDelta(targetVsLM)}`, targetVsLM);
            setText("taInsightTargetVsLY", formatDelta(targetVsLY, { nullDash: true }), targetVsLY);
            setCalc("taInsightTargetVsLY", targetVsLY == null ? "" :
                `(${formatMoney(periodTarget)}−${formatMoney(lastYearPeriodTarget)})÷${formatMoney(lastYearPeriodTarget)}×100 = ${formatDelta(targetVsLY)}`, targetVsLY);


            const periodSales = Number(data.periodSales ?? 0);
            const previousPeriodSales = Number(data.previousPeriodSales ?? 0);
            const lastYearElapsedSales = Number(data.lastYearElapsedSales ?? 0);

            setText("taInsightMtdCurrent", formatMoney(periodSales));
            setCalc("taInsightMtdCurrent", `= ${formatMoney(periodSales)}`);
            const mtdVsLM = monthsSpanned > 1 ? null : insightsZeroSafeGrowthPct(periodSales, previousPeriodSales);
            const mtdVsLY = insightsZeroSafeGrowthPct(periodSales, lastYearElapsedSales);

            const mtdVsLMText = monthsSpanned > 1 ? "—" : formatDelta(mtdVsLM, { nullDash: true });
            setText("taInsightMtdVsLM", mtdVsLMText, mtdVsLM);
            setCalc("taInsightMtdVsLM", mtdVsLM == null ? "" :
                `(${formatMoney(periodSales)}−${formatMoney(previousPeriodSales)})÷${formatMoney(previousPeriodSales)}×100 = ${formatDelta(mtdVsLM)}`, mtdVsLM);
            setText("taInsightMtdVsLY", formatDelta(mtdVsLY, { nullDash: true }), mtdVsLY);
            setCalc("taInsightMtdVsLY", mtdVsLY == null ? "" :
                `(${formatMoney(periodSales)}−${formatMoney(lastYearElapsedSales)})÷${formatMoney(lastYearElapsedSales)}×100 = ${formatDelta(mtdVsLY)}`, mtdVsLY);


            const topProjectionValue = Number(data.topProjectionValue ?? 0);
            const previousMonthProjectionValue = Number(data.previousMonthProjectionValue ?? 0);
            const lastYearMonthProjectionValue = Number(data.lastYearMonthProjectionValue ?? 0);

            const projCell = document.getElementById("taInsightProjCurrent");
            if (periodStartsInCurrentMonth) {
                setText("taInsightProjLabel", "Projection");
                setText("taInsightProjCurrent", formatMoney(topProjectionValue));
                setCalc("taInsightProjCurrent", `= ${formatMoney(topProjectionValue)}`);
                projCell?.setAttribute("data-formula", "Top_Projection");
                projCell?.setAttribute("data-desc", "This month's live projection");
                const projVsLM = insightsZeroSafeGrowthPct(topProjectionValue, previousMonthProjectionValue);
                const projVsLY = insightsZeroSafeGrowthPct(topProjectionValue, lastYearMonthProjectionValue);
                setText("taInsightProjVsLM", formatDelta(projVsLM, { nullDash: true }), projVsLM);
                setCalc("taInsightProjVsLM", projVsLM == null ? "" :
                    `(${formatMoney(topProjectionValue)}−${formatMoney(previousMonthProjectionValue)})÷${formatMoney(previousMonthProjectionValue)}×100 = ${formatDelta(projVsLM)}`, projVsLM);
                setText("taInsightProjVsLY", formatDelta(projVsLY, { nullDash: true }), projVsLY);
                setCalc("taInsightProjVsLY", projVsLY == null ? "" :
                    `(${formatMoney(topProjectionValue)}−${formatMoney(lastYearMonthProjectionValue)})÷${formatMoney(lastYearMonthProjectionValue)}×100 = ${formatDelta(projVsLY)}`, projVsLY);
                setText("taInsightProjVsTargetLabel", "Projection Vs Target");
            } else {
                setText("taInsightProjLabel", "Actual Sales");
                setText("taInsightProjCurrent", formatMoney(periodSales));
                setCalc("taInsightProjCurrent", `= ${formatMoney(periodSales)}`);
                projCell?.setAttribute("data-formula", "SUM(Sales)");
                projCell?.setAttribute("data-desc", "Actual sales, selected range");
                setText("taInsightProjVsLM", "—");
                setCalc("taInsightProjVsLM", "");
                const actualSalesVsLY = insightsZeroSafeGrowthPct(periodSales, lastYearElapsedSales);
                setText("taInsightProjVsLY", formatDelta(actualSalesVsLY, { nullDash: true }), actualSalesVsLY);
                setCalc("taInsightProjVsLY", actualSalesVsLY == null ? "" :
                    `(${formatMoney(periodSales)}−${formatMoney(lastYearElapsedSales)})÷${formatMoney(lastYearElapsedSales)}×100 = ${formatDelta(actualSalesVsLY)}`, actualSalesVsLY);
                setText("taInsightProjVsTargetLabel", "Actual Sales Vs Target");
            }


            const projectionOrActualSalesValue = periodStartsInCurrentMonth ? topProjectionValue : periodSales;
            const projVsTargetPct = insightsZeroSafeGrowthPct(projectionOrActualSalesValue, periodTarget);
            setText("taInsightProjVsTargetCurrent",
                formatDelta(projVsTargetPct, { nullDash: true }), projVsTargetPct);
            setCalc("taInsightProjVsTargetCurrent", projVsTargetPct == null ? "" :
                `(${formatMoney(projectionOrActualSalesValue)}−${formatMoney(periodTarget)})÷${formatMoney(periodTarget)}×100 = ${projVsTargetPct >= 0 ? "+" : "−"}${Math.abs(projVsTargetPct).toFixed(1)}%`, projVsTargetPct);



            const avgPerDay = capturedDaysElapsed > 0 ? periodSales / capturedDaysElapsed : 0;
            const previousAvgPerDay = capturedDaysElapsed > 0 ? previousPeriodSales / capturedDaysElapsed : 0;
            const lastYearAvgPerDay = capturedDaysElapsed > 0 ? lastYearElapsedSales / capturedDaysElapsed : 0;

            setText("taInsightAvgPerDayCurrent", formatMoney(avgPerDay));
            setCalc("taInsightAvgPerDayCurrent", `${formatMoney(periodSales)}÷${capturedDaysElapsed} = ${formatMoney(avgPerDay)}`);

            setText("taInsightAvgPerDayVsLM", "—");
            setCalc("taInsightAvgPerDayVsLM", "");
            setText("taInsightAvgPerDayVsLY", "—");
            setCalc("taInsightAvgPerDayVsLY", "");


            if (filterActive) {
                setText("taInsightRequiredPerDayCurrent", "—");
                setCalc("taInsightRequiredPerDayCurrent", "Hidden while a Filter is active");
            } else {
                const now = new Date();
                const remainingDays = Math.max(0, lastDayOfMonthDate(now) - now.getDate());
                const shortfall = periodTarget - periodSales;
                if (shortfall <= 0) {
                    setText("taInsightRequiredPerDayCurrent", formatMoney(0));
                    setCalc("taInsightRequiredPerDayCurrent", "Target already met = ₹0");
                } else if (remainingDays === 0) {
                    setText("taInsightRequiredPerDayCurrent", "—");
                    setCalc("taInsightRequiredPerDayCurrent", "0 days left in month");
                } else {
                    setText("taInsightRequiredPerDayCurrent", formatMoney(shortfall / remainingDays));
                    setCalc("taInsightRequiredPerDayCurrent",
                        `(${formatMoney(periodTarget)}−${formatMoney(periodSales)})÷${remainingDays} = ${formatMoney(shortfall / remainingDays)}`);
                }
            }
        }).catch(() => {});
    }


    function refresh() {
        const requestId = ++requestSeq;
        const capturedPeriodStartsInCurrentMonth = periodStartsInCurrentMonth;
        const capturedIsFilterActive = isFilterActive;

        const capturedMonthsSpanned = (periodTo.getFullYear() - periodFrom.getFullYear()) * 12
            + (periodTo.getMonth() - periodFrom.getMonth()) + 1;

        const capturedDaysElapsed = daysElapsed;
        const monthlyDataPromise = fetch(withBrand(monthlyApiUrl)).then((response) => (response.ok ? response.json() : null));
        loadInsightsCard(monthlyDataPromise, requestId, capturedPeriodStartsInCurrentMonth, capturedIsFilterActive,
            capturedMonthsSpanned, capturedDaysElapsed);
        loadKpiCards(monthlyDataPromise, requestId);

        return monthlyDataPromise.catch(() => {});
    }

    function setBrand(nextBrand) {
        brand = nextBrand || "all";
        return refresh();
    }

    function setChannel(nextChannel) {
        channel = nextChannel || "all";
        return refresh();
    }

    function setStatus(nextStatus) {
        status = nextStatus || "all";
        return refresh();
    }


    function setDateRange(from, to, meta) {
        if (meta && meta.mode === "filter" && from && to) {
            periodFrom = new Date(`${from}T00:00:00`);
            periodTo = new Date(`${to}T00:00:00`);
            includesCurrentMonth = meta.includesCurrentMonth !== false;
            periodStartsInCurrentMonth = meta.startsInCurrentMonth !== false;
            isFilterActive = true;
        } else {
            const now = new Date();
            periodFrom = new Date(now.getFullYear(), now.getMonth(), 1);
            periodTo = monthEndDate(now);
            includesCurrentMonth = true;
            periodStartsInCurrentMonth = true;
            isFilterActive = false;
        }
        ({ daysElapsed, daysInPeriod } = resolvePeriodProgress(periodFrom, periodTo, new Date()));
        updateRangeLabel();
        return refresh();
    }


    const insightsTable = document.querySelector(".ta-insights-table");
    const tipPopup = document.getElementById("taTipPopup");
    if (insightsTable && tipPopup) {
        insightsTable.addEventListener("mouseover", (event) => {
            const cell = event.target.closest(".ta-tip-cell");
            if (!cell || !insightsTable.contains(cell)) {
                return;
            }
            const formula = cell.getAttribute("data-formula");
            if (!formula) {
                return;
            }
            const desc = cell.getAttribute("data-desc") || "";
            const calc = cell.getAttribute("data-calc") || "";
            tipPopup.replaceChildren();
            const formulaEl = document.createElement("div");
            formulaEl.className = "ta-tip-popup-formula";
            formulaEl.textContent = formula;
            tipPopup.appendChild(formulaEl);
            if (desc) {
                const descEl = document.createElement("div");
                descEl.className = "ta-tip-popup-desc";
                descEl.textContent = desc;
                tipPopup.appendChild(descEl);
            }
            if (calc) {
                const calcSign = cell.getAttribute("data-calc-sign");
                const calcEl = document.createElement("div");
                calcEl.className = calcSign ? `ta-tip-popup-calc ${calcSign}` : "ta-tip-popup-calc";
                calcEl.textContent = calc;
                tipPopup.appendChild(calcEl);
            }
            tipPopup.hidden = false;

            const cellRect = cell.getBoundingClientRect();
            const popupRect = tipPopup.getBoundingClientRect();
            let left = cellRect.left + cellRect.width / 2 - popupRect.width / 2;
            left = Math.max(8, Math.min(left, window.innerWidth - popupRect.width - 8));
            let top = cellRect.top - popupRect.height - 8;
            if (top < 8) {
                top = cellRect.bottom + 8;
            }
            tipPopup.style.left = `${left}px`;
            tipPopup.style.top = `${top}px`;
        });
        insightsTable.addEventListener("mouseout", (event) => {
            const cell = event.target.closest(".ta-tip-cell");
            if (!cell || event.relatedTarget?.closest(".ta-tip-cell") === cell) {
                return;
            }
            tipPopup.hidden = true;
        });
    }


    function loadFixedProjVsTargetBadge() {
        const badgeEl = document.getElementById("taOverviewProjVsTargetBadge");
        if (!badgeEl) {
            return;
        }
        fetch(monthlyApiUrl).then((res) => (res.ok ? res.json() : null)).then((data) => {
            if (!data) {
                return;
            }
            const topProjectionValue = Number(data.topProjectionValue ?? 0);
            const periodTarget = Number(data.periodTarget ?? 0);
            const pct = insightsZeroSafeGrowthPct(topProjectionValue, periodTarget);
            badgeEl.classList.remove("positive", "negative");
            if (pct == null) {
                badgeEl.textContent = "—";
                return;
            }
            const sign = pct >= 0 ? "+" : "-";
            badgeEl.textContent = `${pct >= 0 ? "AHEAD" : "BEHIND"} · Proj ${sign}${Math.abs(pct).toFixed(1)}% (vs Tgt)`;
            badgeEl.classList.add(pct >= 0 ? "positive" : "negative");
        }).catch(() => {});
    }

    updateRangeLabel();
    refresh();
    loadFixedProjVsTargetBadge();


    function reload() {
        refresh();
        loadFixedProjVsTargetBadge();
    }

    return { setDateRange, setBrand, setChannel, setStatus, reload };
}
    Page.initTargetVsAchievement = initTargetVsAchievement;

    Page.formatRangeLabel = formatRangeLabel;
}


{

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
    const { apiBase = "/api/primary-sales" } = options;

    const card = document.getElementById("dailyTrendCard");
    const chartTypeToggle = document.getElementById("dailyTrendChartTypeToggle");
    const compareToggle = document.getElementById("dailyTrendCompareToggle");
    const targetToggle = document.getElementById("dailyTrendTargetToggle");
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

    const state = { chartType: "line", brand: "all", channel: "all", status: "all", from: null, to: null, granularity: "month", compare: false, showLastYear: false, showTarget: true };
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
                    symbol: "circle",
                    symbolSize: 5,
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


    if (compareToggle) {
        compareToggle.addEventListener("click", () => {
            state.compare = !state.compare;
            compareToggle.classList.toggle("active", state.compare);
            compareToggle.setAttribute("aria-pressed", String(state.compare));
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

        setBrand(brand) {
            if (brand === state.brand) {
                return;
            }
            state.brand = brand;
            return load();
        },
        setChannel(channel) {
            if (channel === state.channel) {
                return;
            }
            state.channel = channel;
            return load();
        },
        setStatus(status) {
            if (status === state.status) {
                return;
            }
            state.status = status;
            return load();
        },
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
            return load();
        },
    };
}
    Page.initDailyTrendGraph = initDailyTrendGraph;
}


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
    const el = document.getElementById("productSnapshotQtyBadge");
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
    downloadCsv(lines, `product-ranking-${new Date().toISOString().slice(0, 10)}.csv`);
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
    downloadCsv(lines, `product-research-${new Date().toISOString().slice(0, 10)}.csv`);
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

function initProductSnapshot() {
    const card = document.getElementById("productSnapshotCard");
    if (!card) {
        return { load() {}, setDateRange() {}, setBrand() {}, setChannel() {}, setStatus() {} };
    }


    const researchBtn = document.getElementById("productResearchBtn");
    const researchBackdrop = document.getElementById("productResearchBackdrop");
    const researchClose = document.getElementById("productResearchClose");
    const researchDownloadBtn = document.getElementById("productResearchDownloadBtn");
    const researchTableWrap = document.getElementById("productResearchTableWrap");

    let latestData = null;
    let latestResearchRows = [];
    let requestSeq = 0;

    let periodFrom = null;
    let periodTo = null;

    let brand = "all";
    let channel = "all";
    let status = "all";

    const rankingFilter = wireLevelRankingFilter({
        filterToggleId: "productSnapshotFilterToggleA",
        filterBodyId: "productSnapshotFilterBodyA",
        levelToggleId: "productSnapshotLevelToggleA",
        selectId: "productSnapshotPanelFilterA",
        resultBodyId: "productSnapshotPanelBodyA",
        downloadBtnId: "productSnapshotRankingDownloadBtn",
        downloadRangeSelectId: "productSnapshotDownloadRangeA",
        downloadRangeInputId: "productSnapshotDownloadRangeInputA",
        downloadPopupId: "productSnapshotDownloadPopupA",
        downloadConfirmBtnId: "productSnapshotDownloadConfirmA",
        getData: () => latestData,
    });

    async function refresh() {
        const requestId = ++requestSeq;
        card.classList.add("is-loading");
        try {
            let url = `/api/primary-sales/product-level?brand=${encodeURIComponent(brand)}&channel=${encodeURIComponent(channel)}&status=${encodeURIComponent(status)}`;
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
        return refresh();
    }


    function setBrand(nextBrand) {
        brand = nextBrand;
        return refresh();
    }


    function setChannel(nextChannel) {
        channel = nextChannel;
        return refresh();
    }


    function setStatus(nextStatus) {
        status = nextStatus;
        return refresh();
    }

    refresh();

    return { load: refresh, setDateRange, setBrand, setChannel, setStatus };
}
    Page.initProductSnapshot = initProductSnapshot;
}


{


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
    return [firstLabel, "Mnt", "MTD Sales", "Achi.", "Proj.", "Proj vs Tgt", "Vs LM", "Vs LY"];
}


const REPORTS_COLUMN_ICONS = {
    "Brand": "bi-shop",
    "Channel": "bi-diagram-2-fill",
    "Sub-Channel": "bi-diagram-3-fill",
    "Partner": "bi-people-fill",
    "Mnt": "bi-bullseye",
    "MTD Sales": "bi-cash-stack",
    "Achi.": "bi-graph-up-arrow",
    "Proj.": "bi-binoculars-fill",
    "Proj vs Tgt": "bi-percent",
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
    <col style="width:20%"><col style="width:11%"><col style="width:12%"><col style="width:10%">
    <col style="width:11%"><col style="width:12%"><col style="width:12%"><col style="width:12%">
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
            <td>${primarySiteReportMoney(row.monthTarget, { nullDash: true, round: false })}</td>
            <td>${primarySiteReportMoney(row.mtdSales, { round: false })}</td>
            <td>${renderReportsAchiCell(row.mtdSales, row.monthTarget)}</td>
            <td>${primarySiteReportMoney(row.projection, { nullDash: true, round: false })}</td>
            <td>${renderReportsDelta(row.projVsTargetPct)}</td>
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


function flattenBrandTree(tree) {
    const rows = [];
    function walk(node, id, level, parent, brand) {
        const rowBrand = level === 0 ? (node.name === "Total" ? null : node.name) : brand;
        rows.push({
            id, level, parent, name: node.name, monthTarget: node.monthTarget, mtdSales: node.mtdSales,
            vsLastMonthPct: node.vsLastMonthPct, vsLastYearPct: node.vsLastYearPct,
            projection: node.projection, projVsTargetPct: node.projVsTargetPct, brand: rowBrand,
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
    const header = [...REPORTS_LEVEL_COLUMNS, "Mnt", "MTD Sales", "Achi %", "Proj.", "Proj vs Tgt %", "Vs LM %", "Vs LY %"];
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
                primarySiteReportMoneyFull(row.monthTarget, { nullDash: true }),
                primarySiteReportMoneyFull(row.mtdSales),
                achiPct == null ? "—" : `${achiPct.toFixed(1)}%`,
                primarySiteReportMoneyFull(row.projection, { nullDash: true }),
                formatDeltaSigned(row.projVsTargetPct, { nullDash: true }),
                formatDeltaSigned(row.vsLastMonthPct, { nullDash: true }),
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
                    <td>${primarySiteReportMoney(row.monthTarget, { nullDash: true, round: false })}</td>
                    <td>${primarySiteReportMoney(row.mtdSales, { round: false })}</td>
                    <td>${renderReportsAchiCell(row.mtdSales, row.monthTarget, brandSlot)}</td>
                    <td>${primarySiteReportMoney(row.projection, { nullDash: true, round: false })}</td>
                    <td>${renderReportsDelta(row.projVsTargetPct)}</td>
                    <td>${renderReportsDelta(row.vsLastMonthPct)}</td>
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
    subchannel: { label: "Sub-Channel", endpoint: "/api/primary-sales/reports/subchannels" },
    channel: { label: "Channel", endpoint: "/api/primary-sales/reports/channels" },
    partner: { label: "Partner", endpoint: "/api/primary-sales/reports/partners" },
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
                return loadBrandTree();
            }
            renderBrandHierarchyTable(tableWrap, brandTreeRows);
            renderReportsCounts(countsEl, computeHierarchyCounts(brandTreeRows));
            return;
        }
        const config = FLAT_REPORT_TABS[activeTab];
        if (flatRows[activeTab] === null) {
            renderReportsTable(tableWrap, config.label, []);
            renderSingleReportsCount(countsEl, config.label, 0);
            return loadFlatTab(activeTab);
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
            const res = await fetch(withBrand("/api/primary-sales/reports/brand-hierarchy"));
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
        return renderActiveTab();
    }

    renderActiveTab();
    return { setDateRange };
}
    Page.initReportsSection = initReportsSection;
}


initSidebar();
initQuickAccessPanel();

applyPagePermissions().then(() => applyFeatureGating());


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


(async function wirePage() {
const [brandPillOptions, channelPillOptions, statusPillOptions] = await Promise.all([
    loadBrandPillOptions("/api/primary-sales/brands"),
    loadChannelPillOptions("/api/primary-sales/channels"),
    loadStatusPillOptions("/api/primary-sales/statuses"),
]);
renderBrandPill("brandHeader", brandPillOptions);
renderChannelPill("dashboardFyOverviewChannelToggle", channelPillOptions);
renderStatusPill("dashboardFyOverviewStatusToggle", statusPillOptions);


const targetVsAchievement = Page.initTargetVsAchievement();


const productSnapshot = Page.initProductSnapshot();


const reportsSection = Page.initReportsSection();


const dailyTrend = Page.initDailyTrendGraph();


const filterHeaderContainer = document.getElementById("dashboardFyOverviewFilterHeaderSectionContainer");
let filterLoadingCount = 0;
function withFilterLoading(promises) {
    filterLoadingCount++;
    filterHeaderContainer?.classList.add("is-loading");
    Promise.allSettled(promises).finally(() => {
        filterLoadingCount = Math.max(0, filterLoadingCount - 1);
        if (filterLoadingCount === 0) {
            filterHeaderContainer?.classList.remove("is-loading");
        }
    });
}


Page.initBrandHeader({
    headerId: "brandHeader",
    storageKey: "selected-brand",
    onBrandChange: (brand) => {
        withFilterLoading([
            targetVsAchievement.setBrand(brand),
            productSnapshot.setBrand(brand),
            dailyTrend.setBrand(brand),
        ]);
    },
});


Page.initChannelHeader({
    headerId: "dashboardFyOverviewChannelToggle",
    storageKey: "selected-channel",
    onChannelChange: (channel) => {
        withFilterLoading([
            targetVsAchievement.setChannel(channel),
            productSnapshot.setChannel(channel),
            dailyTrend.setChannel(channel),
        ]);
    },
});


Page.initStatusFilter("dashboardFyOverviewStatusToggle", (status) => {
    withFilterLoading([
        targetVsAchievement.setStatus(status),
        productSnapshot.setStatus(status),
        dailyTrend.setStatus(status),
    ]);
});


Page.initInsightsDateFilter({
    onFilterChange: (column, from, to, meta) => {
        withFilterLoading([
            targetVsAchievement.setDateRange(from, to, meta),
            productSnapshot.setDateRange(from, to, meta),
            dailyTrend.setDateRange(from, to, meta),
            reportsSection?.setDateRange(from, to),
        ]);
    },
});


window.addEventListener("top-projection-saved", () => {
    targetVsAchievement.reload();
});
})();


function primarySiteReportMoney(value, opts) {
    return formatMoney(value, opts).replace("₹", "");
}


function primarySiteReportMoneyFull(value, opts) {
    return formatMoneyFull(value, opts).replace("₹", "");
}
