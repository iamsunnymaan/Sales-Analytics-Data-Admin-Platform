// Primary Sales page: Overview KPI cards (Target vs Achievement), Daily Sales Trends,
// Product Snapshot, and Region/State/City Summary sections, all driven by the shared Brand pill
// and SalesDateFilter.
//
// Per explicit request, all the section-specific logic that used to live in separate
// components/* modules (BrandHeader, SalesDateFilter, TargetVsAchievement, DailyTrendGraph,
// ProductSnapshot, RegionSummary) is inlined below instead — this page is
// the only place any of it was ever used. Each section's code keeps its own `{ ... }` block
// scope (unchanged from its original file) so identically-named internal helpers across
// sections don't collide; only each section's init function is exposed, via the `Page` object,
// to the wiring code at the bottom. formatMoney/formatDelta are the one exception — every
// section now imports the same shared implementation (see Shared/js/format.js) instead of each
// carrying its own near-identical copy; each block still calls it as a bare local-looking name,
// so this doesn't reintroduce the per-section module split described above.
//
// Sidebar is the one exception and stays a separate shared component — it's also used by every
// other page in the app, so inlining it here would just recreate the duplication that was
// already removed.
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

// ==================== Brand Header / Channel Header (shared by every section's pills) ====================
// Now components/BrandFilter/BrandFilter.js and components/ChannelFilter/ChannelFilter.js, imported
// above.
Page.initBrandHeader = initBrandHeader;
Page.initChannelHeader = initChannelHeader;
Page.initStatusFilter = initStatusFilter;

// ==================== Sales Date Filter (shared by Overview + Daily Sales Trends) ====================
// The full 3-mode picker used to live here too but was dead code (never called) — deleted. The
// real, actively-used widget (a single From/To MONTH range + Insights-card pacing meta) now lives
// in components/SalesDateFilter/SalesDateFilter.js as initInsightsDateFilter, imported above.
Page.initInsightsDateFilter = initInsightsDateFilter;

// ==================== 1. Overview (Target vs Achievement) ====================
{
// The Primary Sales page's "Target vs Achievement" overview, modeled on the QRPL DSR portal's
// "Top-Line Performance" cards (period line, then Monthly Sales / Current Month Target / MTD
// Sales (Month up to Today) / Month Projection cards — per explicit request, Today Sales and
// Yesterday Sales were removed entirely, including their backing endpoints/service methods; see
// git history if they're ever needed again). Everything here is REAL — sales from
// dbo.primary_sales, targets from dbo.primary_sales_target, and the Projection row from
// dbo.Top_Projection (via GET /api/primary-sales/monthly, /monthly/breakdown, backed by
// PrimarySalesTodayService/PrimarySalesTargetService/TopProjectionService) — there's no
// placeholder data left. Every card moves with BOTH the Brand pill (setBrand) and the card's own
// Filter (setDateRange) — a From/To MONTH range (see initInsightsDateFilter above): no filter (or a
// range ending in the current month) always runs 1st-of-start-month through today; a range ending
// before the current month is a fully closed span, 1st-of-start-month through the end month's last
// day.
// formatMoney/formatDelta come from the shared Shared/js/format.js import (top of file) — this
// section's calls use their default options (nullDash: false/true respectively — see call sites).

// null when previous is 0 and current isn't — growth is undefined/infinite, not 0.
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

// DD-Mon-YYYY, always in this exact dash format regardless of browser locale (unlike
// toLocaleDateString elsewhere on this page) — feeds the Overview header's range label only.
function formatRangeDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    return `${day}-${RANGE_LABEL_MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function lastDayOfMonthDate(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// The current calendar month's real last day, as a Date — the default "no filter" period's `to`,
// same as what the Filter's own "By Month" input already resolves a current-month selection to (see
// initSalesDateFilter's renderRangeInputs). Using the month's real end (not just today) here is what
// gives resolvePeriodProgress a genuine daysInPeriod for the WHOLE month, rather than daysInPeriod
// always equaling daysElapsed (today) and Required Sales Per Day always landing on 0 — the backend
// (PrimarySalesTodayService#getMonthlySales) already clamps any future `to` back to today for the
// actual sales figures, and Period Target is resolved by YearMonth regardless of the exact day, so
// this doesn't change any of the real numbers, only the day-count math done client-side.
function monthEndDate(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

// The Overview header's right-side range label. Current-month selections show today's cutoff and
// today's "elapsed of total" days WITHIN ITS OWN MONTH (e.g. "01-Aug-2026 to 18-Aug-2026 (18 of 31
// days)") — deliberately independent of periodFrom/daysElapsed (which, for a multi-month filter
// ending in the current month, e.g. Jun-Aug, cover the WHOLE span and would otherwise produce a
// nonsensical count like "79 of 31 days"). A fully historical range instead shows the real end date
// and the whole span's real day count (e.g. "01-Jan-2026 to 31-Jan-2026 (31 days)").
//
// `today` is passed in (rather than reading `new Date()` here) so this stays a pure function of its
// arguments, matching resolvePeriodProgress's own (from, to, today) shape just below. The cutoff is
// min(periodTo, today) rather than periodTo itself: periodTo for a current-month selection is now
// always that month's real last day (see setDateRange's default branch AND the Filter's own "By
// Month" input, both of which need the FULL month length for daysInPeriod/Required Sales Per Day to
// mean anything — see resolvePeriodProgress) even though today is always <= that date, so the label
// must still show where TODAY actually falls, not the month's end.
function formatRangeLabel(periodFrom, periodTo, includesCurrentMonth, today) {
    const fromStr = formatRangeDate(periodFrom);
    if (includesCurrentMonth) {
        const cutoff = periodTo > today ? today : periodTo;
        return `${fromStr} to ${formatRangeDate(cutoff)} (${cutoff.getDate()} of ${lastDayOfMonthDate(periodTo)} days)`;
    }
    const toStr = formatRangeDate(periodTo);
    return `${fromStr} to ${toStr} (${daysBetweenInclusive(periodFrom, periodTo)} days)`;
}

// Days Elapsed/Days in the current calendar month, feeding Avg Sales per Day and Required Sales Per
// Day (Projection itself no longer runs off these — see loadInsightsCard's topProjectionValue).
// `today` is normalized to midnight first — callers pass `new Date()` (current time-of-day
// included), and daysBetweenInclusive's day-count math needs whole-day boundaries on both ends to
// round correctly (a same-calendar-day `to`/`today` pair with `to` at midnight and `today` mid-
// afternoon would otherwise round down a fractional day short).
function resolvePeriodProgress(from, to, today) {
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const clampedTo = to > todayMidnight ? todayMidnight : to;
    const daysInPeriod = daysBetweenInclusive(from, to);
    const daysElapsed = from > todayMidnight ? 0 : daysBetweenInclusive(from, clampedTo);
    return { daysElapsed, daysInPeriod };
}

// Timezone-safe yyyy-MM-dd — Date#toISOString converts to UTC first, which can shift the calendar
// date by a day depending on the browser's local offset; this reads the local y/m/d components
// directly instead.
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
    // Whether the currently-active period's end month is the current month or later — true by
    // default (no filter = current month-to-date). Feeds the header range label only (see
    // updateRangeLabel/formatRangeLabel) — NOT the Projection row, see periodStartsInCurrentMonth
    // just below for that.
    let includesCurrentMonth = true;
    // Whether the currently-active period's START month IS the current month — true by default (no
    // filter = current month-to-date, which by definition starts in the current month). Drives the
    // Insights card's Projection row: only a period that starts in the current month shows the real
    // dbo.Top_Projection total; any period starting before it (even one that still reaches into the
    // current month, e.g. last month through today) relabels to Actual Sales — see loadInsightsCard.
    let periodStartsInCurrentMonth = true;
    // Whether the card's own Filter (initInsightsDateFilter) is currently active — false by default
    // (no filter = plain current month-to-date). Per explicit request, Required Sales Per Day only
    // ever shows a value in that unfiltered default state; the moment ANY Filter range is applied —
    // current month or otherwise — it goes blank ("—") instead of computing anything, since the row
    // is specifically about the real, un-filtered current month's own pacing, not a stand-in for
    // whatever the Filter happens to be set to. See loadInsightsCard.
    let isFilterActive = false;
    // Brand/filter changes can fire in quick succession (e.g. clicking through All/ABH/Kylie fast,
    // or a From/To month range's two inputs each firing their own change event). Every card-loading
    // function below checks its captured requestId against this counter before touching the DOM, so
    // a stale response can't clobber a fresher one that happened to resolve first — same guard
    // pattern as DailyTrendGraph.js's load().
    let requestSeq = 0;

    // Every Overview fetch is scoped to both the Brand pill and the card's own Filter (via
    // `from`/`to` — see PrimarySalesTodayService.getMonthlySales), so a picked month range genuinely
    // sums real sales/target across every month it touches, not just the current one.
    function withBrand(url) {
        return `${url}?brand=${encodeURIComponent(brand)}&channel=${encodeURIComponent(channel)}&status=${encodeURIComponent(status)}&from=${encodeURIComponent(toIsoDate(periodFrom))}&to=${encodeURIComponent(toIsoDate(periodTo))}`;
    }

    // ==================== KPI cards (MTD Achievement) ====================
    // Per explicit request, a small card reintroducing the row .ta-overview-kpis/.ta-overview-insights
    // split used to carry (see that CSS rule's own comment; also per later explicit request, this
    // half sits on the RIGHT of the Insights card, not the left it started on) — reuses this section's own
    // brand/periodFrom/periodTo/requestSeq state, and the exact same /monthly fetch loadInsightsCard
    // already makes each refresh() (see below), rather than a separate module/fetch of their own.
    // Two other cards started out in this row too — Channel Contribution (moved to "4. Channel / Full
    // Report" and later removed entirely per explicit request) and Projected MTD (removed once the
    // same Projection Vs Target figure got its own Above/Below Target badge in the section header
    // instead, see #taOverviewProjVsTargetBadge in loadInsightsCard, backed by
    // .ta-kpi-projected-badge) — this row now has only the MTD Achievement gauge left.
    const kpiGaugeDom = document.getElementById("taMtdAchievementGauge");
    const kpiGaugeChart = (kpiGaugeDom && typeof window.echarts !== "undefined") ? window.echarts.init(kpiGaugeDom) : null;
    window.addEventListener("resize", () => {
        kpiGaugeChart?.resize();
    });
    // This gauge lives inside "#overviewSectionContainer", which ships `hidden` by default (see
    // data-permission="page:primary-sales.overview" on it in the HTML) — a chart initialized while
    // its container is display:none draws at 0x0, so it needs an explicit remeasure once
    // applyPagePermissions reveals it.
    document.addEventListener("permissions-applied", () => kpiGaugeChart?.resize());
    if (kpiGaugeChart) {
        // FIXED: switching back to day mode used to leave this gauge's red/yellow/green bands and
        // text stuck on their dark-mode colors until a full page reload — see resolveGaugeColors'
        // own comment. Re-resolving the colors then repainting with the gauge's last-known Sales/
        // Target (no re-fetch needed) fixes it immediately; a no-op before the first real render.
        window.addEventListener("theme-changed", () => {
            resolveGaugeColors();
            if (lastGaugePeriodSales !== null && lastGaugePeriodTarget !== null) {
                renderMtdAchievement(lastGaugePeriodSales, lastGaugePeriodTarget);
            }
        });
    }

    // ECharts renders to canvas, so it needs a literal color string, not a live var() reference —
    // FIXED: these used to be resolved once at load and never again, so a theme switch after load
    // wouldn't repaint an already-drawn gauge until a full page reload (same pre-existing limitation
    // DailyTrendGraph's own LINE_COLOR/AXIS_COLOR used to have). `let` + resolveGaugeColors() lets
    // the "theme-changed" listener below (see QuickAccessPanel.js's theme toggle, which dispatches
    // it) re-resolve these and repaint with the gauge's last-known Sales/Target.
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
    // Last-known render inputs, so the "theme-changed" listener below can repaint the gauge without
    // needing a re-fetch — null until the first real renderMtdAchievement() call.
    let lastGaugePeriodSales = null;
    let lastGaugePeriodTarget = null;

    // Semicircle gauge, 0-100 (a period Sales/Target ratio past 100% still clamps the NEEDLE at the
    // full-green end, but the center label always shows the real, possibly >100%, percentage —
    // capping the number itself would hide genuine over-achievement). Red/yellow/green bands
    // (0-40/40-75/75-100) read as "well short of / approaching / at-or-past target", standard
    // traffic-light gauge convention. periodTarget <= 0 has no meaningful ratio to show — renders
    // "—" rather than a fabricated percentage (0 Sales ÷ 0 Target isn't 0% any more than it's
    // infinite).
    function renderMtdAchievement(periodSales, periodTarget) {
        lastGaugePeriodSales = periodSales;
        lastGaugePeriodTarget = periodTarget;
        const footerEl = document.getElementById("taMtdAchievementFooter");
        if (footerEl) {
            footerEl.innerHTML = `<strong>${formatMoney(periodSales)}</strong> / ${formatMoney(periodTarget)}`;
        }
        // "You are ₹X short of your target of ₹Y" once sales haven't caught up yet, "ahead of" once
        // they have (periodTarget <= 0 has no meaningful shortfall/lead to show, same "no fabricated
        // number" rule the gauge's own percentage follows just below).
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
                // Needle removed per explicit request. In its place: a short rectangular "strip"
                // marker that sits directly on the colored band at the achieved value's angle,
                // instead of a long needle spanning out from the gauge's center — length/offsetCenter
                // are tuned so the strip only covers the band's own radial thickness, leaving the
                // center (the old needle's pivot) empty rather than filled by an anchor dot or any
                // other marker.
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
                // Both fontSize values are absolute px, not relative to the gauge's own radius/
                // container — the card shrank (10rem wide, 5rem-tall gauge, see .ta-overview-kpis
                // .ta-kpi-card / .ta-kpi-gauge-chart in CSS) but these stayed at their old larger-card
                // sizes, so the text overflowed/overlapped the now-smaller arc instead of sitting
                // inside it. Scaled down to match (15→10, 9→7).
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

    // Shares monthlyDataPromise with loadInsightsCard (see refresh()) rather than a second /monthly
    // fetch — every figure MTD Achievement needs is already in that response.
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

    // Stashes the real, filled-in calculation (e.g. "(₹1.60 Cr − ₹1.56 Cr) ÷ ₹1.56 Cr × 100 = +2.8%")
    // on a Value/Vs LM/Vs LY cell's data-calc attribute — read by the hover-card handler above whenever
    // that cell is moused over. Called alongside that same cell's own setText, so the two never drift.
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
        // Colors the hover card's Calculation line green/red — same growth-function convention as
        // the visible table's own .positive/.negative cell coloring — when this calc represents a
        // signed delta (Vs LM/Vs LY/Vs Target rows); omitted for plain-value rows (Month
        // Target/MTD Sales/Projection's own Value cell, Avg Sales per Day's Value cell) which have
        // nothing to compare against.
        if (sign !== undefined && sign !== null) {
            el.setAttribute("data-calc-sign", sign >= 0 ? "positive" : "negative");
        } else {
            el.removeAttribute("data-calc-sign");
        }
    }

    // The section header's right-side range label (see formatRangeLabel above) — updated any time
    // periodFrom/periodTo/includesCurrentMonth change (setDateRange), independent of the /monthly
    // fetch itself so it reflects the picked range immediately rather than waiting on the network.
    function updateRangeLabel() {
        const el = document.getElementById("taOverviewRangeLabel");
        if (!el) {
            return;
        }
        el.textContent = formatRangeLabel(periodFrom, periodTo, includesCurrentMonth, new Date());
    }

    // Insights card rows' own Vs LM/Vs LY growth formula — deliberately NOT the shared growthPct
    // above: per explicit spec (Month Target, then MTD Sales), a zero or missing comparison value
    // must show "—", full stop, never a fabricated "(current − 0) ÷ 0" or a misleading "0%" for a
    // 0-vs-0 case (the shared growthPct returns 0 there, which is right for other cards but wrong
    // here — the "previous" side being 0 almost always means no real data for that period, not a
    // real zero to compare against).
    function insightsZeroSafeGrowthPct(current, previous) {
        const prev = Number(previous ?? 0);
        if (prev === 0) {
            return null;
        }
        return ((Number(current ?? 0) - prev) / prev) * 100;
    }

    // Insights card. All six rows (Month Target, MTD Sales, Projection, Projection Vs Target, Avg
    // Sales per Day, Required Sales Per Day) are real — see each row's own comment below for its
    // specific spec (the pre-removal implementation, before the metric-by-metric reset+respecify
    // pass this whole card went through, is recoverable from git history if ever needed).
    function loadInsightsCard(monthlyDataPromise, requestId, periodStartsInCurrentMonth, filterActive, monthsSpanned,
                               capturedDaysElapsed) {
        monthlyDataPromise.then((data) => {
            if (!data || requestId !== requestSeq) {
                return;
            }
            // Month Target — Value always sums the complete calendar month(s) the selection touches,
            // never reduced to today's date (periodTarget is already month-aligned server-side, see
            // PrimarySalesTargetService#getTargetSumInRange, which resolves by YearMonth regardless
            // of the day component of whatever LocalDate it's given). Vs LM is a single "previous
            // calendar month vs this one" comparison, so per explicit spec it's only shown for a
            // single-month selection — hidden (—) the instant the range spans more than one calendar
            // month, rather than comparing against some multi-month block before it. Vs LY has no
            // such restriction: "this span vs the same span last year" stays well-defined regardless
            // of how many months are selected.
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

            // MTD Sales — unlike Month Target, this one DOES track today's date: Value sums real
            // sales from periodFrom through whichever is earlier of the selection's end date or
            // today (periodSales is already computed that way server-side, see
            // PrimarySalesTodayService.getMonthlySales' salesTo) — so a fully historical month sums
            // in full, a range reaching into the current month stops at today, and a multi-month
            // range spanning past months plus the current one sums past-months-in-full plus
            // current-month-to-date in one continuous range, per explicit spec's Case 1-5. Vs LM
            // compares the same elapsed-day window against last month and only makes sense for a
            // single selected month, so it's hidden for a multi-month range, same rule as Month
            // Target. Vs LY compares the same elapsed-day window against last year and has no such
            // restriction (previousPeriodSales/lastYearElapsedSales are pre-computed server-side
            // against periodSales' own salesTo, so they're already the correctly-clamped windows —
            // no extra date math needed here).
            const periodSales = Number(data.periodSales ?? 0);
            const previousPeriodSales = Number(data.previousPeriodSales ?? 0);
            const lastYearElapsedSales = Number(data.lastYearElapsedSales ?? 0);

            setText("taInsightMtdCurrent", formatMoney(periodSales));
            setCalc("taInsightMtdCurrent", `= ${formatMoney(periodSales)}`);
            const mtdVsLM = monthsSpanned > 1 ? null : insightsZeroSafeGrowthPct(periodSales, previousPeriodSales);
            const mtdVsLY = insightsZeroSafeGrowthPct(periodSales, lastYearElapsedSales);
            // Per explicit request: just the growth % on its own, no last month raw value alongside it
            // — "—" when genuinely not applicable (a multi-month Filter, where there's no single "last
            // month" to compare against at all) or when the % itself is hidden (zero LM baseline —
            // insightsZeroSafeGrowthPct's own "never divide by 0" rule).
            const mtdVsLMText = monthsSpanned > 1 ? "—" : formatDelta(mtdVsLM, { nullDash: true });
            setText("taInsightMtdVsLM", mtdVsLMText, mtdVsLM);
            setCalc("taInsightMtdVsLM", mtdVsLM == null ? "" :
                `(${formatMoney(periodSales)}−${formatMoney(previousPeriodSales)})÷${formatMoney(previousPeriodSales)}×100 = ${formatDelta(mtdVsLM)}`, mtdVsLM);
            setText("taInsightMtdVsLY", formatDelta(mtdVsLY, { nullDash: true }), mtdVsLY);
            setCalc("taInsightMtdVsLY", mtdVsLY == null ? "" :
                `(${formatMoney(periodSales)}−${formatMoney(lastYearElapsedSales)})÷${formatMoney(lastYearElapsedSales)}×100 = ${formatDelta(mtdVsLY)}`, mtdVsLY);

            // Projection / Actual Sales — Projection mode only when the selection resolves to
            // exactly the real current calendar month (periodStartsInCurrentMonth, captured at fetch
            // time in refresh()); every other shape — a single historical month, or ANY multi-month
            // range, even one reaching into the current month — is Actual Sales instead, per explicit
            // spec (this is a stricter rule than MTD Sales' own "hide Vs LM only for multi-month":
            // here a single historical month ALSO gets no Vs LM, and the mode switch itself only
            // fires for the exact current month, not "any range starting in/reaching it").
            //  - Projection mode: Value is the real current month's dbo.Top_Projection total
            //    (topProjectionValue — independent of the filter, since being in Projection mode
            //    already implies the filter resolves to exactly this month). Vs LM/Vs LY compare
            //    against the immediately preceding month's / same month last year's own real
            //    Top_Projection totals (previousMonthProjectionValue/lastYearMonthProjectionValue —
            //    month-level Projection data, not MTD Sales).
            //  - Actual Sales mode: Value is periodSales (already the correct sum for whatever shape
            //    the selection has, see the MTD Sales section above). Vs LM is ALWAYS hidden here,
            //    unconditionally, per explicit spec. Vs LY compares against lastYearElapsedSales, the
            //    same elapsed-matched last-year sum already computed for MTD Sales' own Vs LY.
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

            // Projection Vs Target — Projection/Actual Sales (whichever the row above is currently
            // showing, per periodStartsInCurrentMonth) against periodTarget, which is ALREADY exactly
            // "Target" for every one of the spec's cases: Month Target's own logic (see that section
            // above) sums the complete calendar month(s) the selection touches regardless of today's
            // date, so periodTarget is the full August target for Case 1/2, full July for Case 3,
            // June+July+August full targets for Case 4 (even though August's own Sales side is
            // MTD-only), and June+July full targets for Case 5 — no separate computation needed here.
            const projectionOrActualSalesValue = periodStartsInCurrentMonth ? topProjectionValue : periodSales;
            const projVsTargetPct = insightsZeroSafeGrowthPct(projectionOrActualSalesValue, periodTarget);
            setText("taInsightProjVsTargetCurrent",
                formatDelta(projVsTargetPct, { nullDash: true }), projVsTargetPct);
            setCalc("taInsightProjVsTargetCurrent", projVsTargetPct == null ? "" :
                `(${formatMoney(projectionOrActualSalesValue)}−${formatMoney(periodTarget)})÷${formatMoney(periodTarget)}×100 = ${projVsTargetPct >= 0 ? "+" : "−"}${Math.abs(projVsTargetPct).toFixed(1)}%`, projVsTargetPct);
            // #taOverviewProjVsTargetBadge (the header's Above/Below Target badge) used to be set
            // right here from this same filtered value — per explicit request it no longer tracks
            // the Filter/Brand pill at all, so it's now loaded once, independently, by
            // loadFixedProjVsTargetBadge below instead of from this per-refresh computation.

            // Avg Sales per Day — MTD Sales ÷ the same clamped elapsed-day count MTD Sales itself
            // was summed over (capturedDaysElapsed, see refresh()): 19 for the default/current-month
            // case, a historical month's own full length, or a multi-month total (e.g. 30+31+19=80
            // for June→August) — never the calendar span's raw day count. Vs LM/Vs LY divide
            // previousPeriodSales/lastYearElapsedSales by that SAME day count rather than each
            // period's own length, per explicit spec's examples (both sides always divided by the
            // same "19") — previousPeriodSales/lastYearElapsedSales are already the correctly
            // elapsed-matched sums from the MTD Sales section above, so this stays a same-length,
            // apples-to-apples daily average on both sides. Vs LM is hidden for a multi-month range,
            // same rule as MTD Sales; Vs LY has no such restriction.
            const avgPerDay = capturedDaysElapsed > 0 ? periodSales / capturedDaysElapsed : 0;
            const previousAvgPerDay = capturedDaysElapsed > 0 ? previousPeriodSales / capturedDaysElapsed : 0;
            const lastYearAvgPerDay = capturedDaysElapsed > 0 ? lastYearElapsedSales / capturedDaysElapsed : 0;

            setText("taInsightAvgPerDayCurrent", formatMoney(avgPerDay));
            setCalc("taInsightAvgPerDayCurrent", `${formatMoney(periodSales)}÷${capturedDaysElapsed} = ${formatMoney(avgPerDay)}`);
            // Per explicit request: Vs Last Month / Vs Last Year are always dashed out for this row
            // (no computation shown at all), regardless of what the underlying values would be.
            setText("taInsightAvgPerDayVsLM", "—");
            setCalc("taInsightAvgPerDayVsLM", "");
            setText("taInsightAvgPerDayVsLY", "—");
            setCalc("taInsightAvgPerDayVsLY", "");

            // Required Sales Per Day — strictly a current-month metric per explicit final spec: the
            // Filter must never change or drive this row, full stop — not even a range that reaches
            // into the current month (e.g. June→August). It shows a value ONLY in the default,
            // un-filtered state (filterActive false), and even then always paces against the real
            // current month's own Target/MTD Sales — which is exactly what periodTarget/periodSales
            // already equal when no Filter is active (the unfiltered default IS the current month:
            // periodFrom = this month's 1st, periodToRaw = today, see
            // PrimarySalesTodayService.getMonthlySales), so no separate "current month" fields are
            // needed here. Remaining Days is always the real current month's own (daysInMonth −
            // today's day-of-month). Two special cases once unfiltered:
            //  1. Target already met (Sales >= Target) — ₹0, even on the literal last day of the
            //     month (Remaining Days = 0) where case 2 below would otherwise apply.
            //  2. Target not met and Remaining Days = 0 (today is the month's last day) — "—", never
            //     a division by zero.
            //  Otherwise, the real formula.
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

    // Refetches the Insights card for the current {brand, periodFrom, periodTo, daysElapsed,
    // daysInPeriod, periodStartsInCurrentMonth}. `requestId` (see the requestSeq guard above) threads
    // through so a fetch from an earlier, now-stale refresh() can't overwrite a newer one that
    // happens to resolve first; `periodStartsInCurrentMonth` is captured here too (rather than read
    // from the closure inside loadInsightsCard's callback) so a stale response can't apply an
    // already-superseded Projection/Actual Sales label to data from before it changed.
    function refresh() {
        const requestId = ++requestSeq;
        const capturedPeriodStartsInCurrentMonth = periodStartsInCurrentMonth;
        const capturedIsFilterActive = isFilterActive;
        // How many distinct calendar months [periodFrom, periodTo] touches — 1 for the default
        // current-month-to-date view or any single-month Filter, >1 for a multi-month range. Only
        // the Month Target row's Vs LM currently cares about this (see loadInsightsCard).
        const capturedMonthsSpanned = (periodTo.getFullYear() - periodFrom.getFullYear()) * 12
            + (periodTo.getMonth() - periodFrom.getMonth()) + 1;
        // Same clamped elapsed-day count MTD Sales' own periodSales is summed over server-side (see
        // resolvePeriodProgress) — Avg Sales per Day divides by this, not daysInPeriod, so a
        // multi-month range reaching into the current month divides by the real elapsed total (e.g.
        // 30+31+19=80), not the full span's calendar length.
        const capturedDaysElapsed = daysElapsed;
        const monthlyDataPromise = fetch(withBrand(monthlyApiUrl)).then((response) => (response.ok ? response.json() : null));
        loadInsightsCard(monthlyDataPromise, requestId, capturedPeriodStartsInCurrentMonth, capturedIsFilterActive,
            capturedMonthsSpanned, capturedDaysElapsed);
        loadKpiCards(monthlyDataPromise, requestId);
        // Returned (not fire-and-forget) so setBrand/setChannel/setDateRange below can hand it back to
        // the Filter Header's own loading-spinner tracker (see Page wiring's withFilterLoading) —
        // resolves once the real fetch settles, regardless of whether it errored (loadInsightsCard/
        // loadKpiCards's own .catch already swallow that) so the spinner never gets stuck on.
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

    // Wired to the card's own Filter (initInsightsDateFilter): `meta.mode === "filter"` with real
    // from/to applies that From/To month range as-is (the filter component already resolved the
    // 1st-of-start-month / month-end `to`, and both the includesCurrentMonth/startsInCurrentMonth
    // flags — see that function's own doc comment for what each drives); anything else (cleared, or
    // the filter's initial closed-panel probe) resets to the default current calendar month-to-date,
    // which both flags are true for by definition.
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

    // Insights table hover cards: hovering any Value/Vs LM/Vs LY cell (.ta-tip-cell) shows a small
    // floating card — Formula (data-formula, static), a one-line Description (data-desc, static),
    // and the real live Calculation with actual values plugged in (data-calc, refreshed every
    // loadInsightsCard() run alongside that same cell's setText — see setCalc below). No icon/button,
    // the cell itself is the trigger. position: fixed + computed here (rather than a pure CSS :hover +
    // ::after) so the card always renders above .ta-insights-table-wrap's overflow-x: hidden instead
    // of getting clipped near the wrap's edges (see the CSS's own comment).
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

    // The header's Above/Below Target badge (#taOverviewProjVsTargetBadge) — per explicit request,
    // deliberately independent of the page's Brand pill/date Filter entirely (unlike every other
    // figure in this section): a bare fetch to monthlyApiUrl with no query string defaults
    // server-side to brand="all" and the current calendar month-to-date (see
    // PrimarySaleController#getMonthlySales), and topProjectionValue is already always the real
    // current month's own Top_Projection total regardless of what's requested (see
    // PrimarySalesTodayService#getMonthlySales's own comment on that field) — so this fetch, run
    // once here and never repeated by setDateRange/setBrand, is exactly "today's real position,
    // unaffected by whatever the user has filtered the rest of the page to." Format is
    // "BEHIND · Proj -27.8% (vs Tgt)" / "AHEAD · Proj +27.8% (vs Tgt)" per explicit request — deliberately
    // different wording from the Insights table's own "Projection Vs Target" row, which stays
    // filter-aware and keeps its plain "-27.8%" style.
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

    // Re-fetches everything this card shows for whatever brand/period it's currently scoped to —
    // same as setDateRange, but without changing that scope. Used to pick up a Top_Projection save
    // made through the Quick Access Panel's Projection Form popup instantly, without a hard page
    // reload (see the top-projection-saved listener in Page wiring below).
    function reload() {
        refresh();
        loadFixedProjVsTargetBadge();
    }

    return { setDateRange, setBrand, setChannel, setStatus, reload };
}
    Page.initTargetVsAchievement = initTargetVsAchievement;
    // Reused by Product Snapshot/Channel Partner Report (see Page wiring) so their own header range
    // labels — matching the Overview section's own — use the exact same date-range formatting
    // rather than a re-implemented copy.
    Page.formatRangeLabel = formatRangeLabel;
}

// ==================== 2. Daily Sales Trends ====================
{
// The Primary Sales page's "2. Daily Sales Trends" section (part of Target vs Achievement): its own
// independent brand pill + Filter date filter bar (idPrefix'd initSalesDateFilter instance wired by
// the page) drives a single-series amount chart (y-axis = ₹ sales, x-axis = the period the active
// filter implies). The x-axis granularity is a direct 1:1 mapping off the filter's `meta.rangeType`:
// By Date -> every individual date in the range (day buckets, however long the range — e.g. "5 Jan
// 2026" through "6 Feb 2026" is 33 separate points, not grouped by month); By Month -> one bucket
// per calendar month touched, even a single month stays one bucket (never expands into its days);
// By Year -> one bucket per year touched. See SalesDateFilter.js and /api/primary-sales/trend-range.
// The chart is always exactly the card's width — no horizontal scrolling. A long By Date/By
// Month/By Year selection instead gets denser x-axis labels, thinned automatically by ECharts'
// own axisLabel interval (see renderChart's xAxis.axisLabel) so they never overlap; that
// recalculates on every chart.resize() (window resize, sidebar collapse/expand), so the labels
// actually shown track the available screen width live. The Graph/Bar Graph toggle re-renders the
// already-fetched data with a different series type, no refetch.
// A second "Target" series (dashed dark-gray line) overlays the real per-bucket
// dbo.primary_sales_target figure in Graph (line) mode — daily granularity uses
// monthlyTarget/daysInMonth (a flat per-day pace line), month/year use the bucket's own real
// target. Bar Graph mode drops the Target line entirely (bars alone); instead every bar always
// shows its own short Sales value and growth-vs-Target (arrow+colored) directly above it, via the
// Sales series' own `label` (formatter/rich, computed per data index) — no click needed. Hovering a
// point (either mode) shows a dark semi-transparent tooltip with the full period (exact date/month/year,
// not just the terser axis label), the active brand, Sales, Target (+ Sales-vs-Target growth,
// arrow+colored), and the same period one year earlier (+ vs-Last-Year growth, arrow+colored) — all
// sourced from /trend-range's labels/dates/data/target/lastYear arrays (see
// tooltipFormatter/growthPct/formatGrowth).
// A right-aligned summary line below the brand/date filter bar (#dailyTrendSelectionSummary)
// echoes the active selection — period, bucket count, brand — via updateSelectionSummary().
// Note: brand-filtered queries (abh/kylie) are known to return all zeros — pre-existing
// dbo.products brand-join bug, see project memory, not something this section can fix on its own.
// ECharts options need a resolved color, not a CSS var() reference — read the custom property off
// :root at render time (falls back to its known light-mode variables.css value if the var isn't
// defined yet). FIXED: these used to be resolved once at load and never again, same pre-existing
// limitation the MTD Achievement gauge's GAUGE_RED/GREEN/etc. below has its own copy of — a theme
// switch after load wouldn't repaint an already-drawn chart until a full page reload. `let` (not
// `const`) + resolveDailyTrendColors() lets initDailyTrendGraph's own "theme-changed" listener
// (see QuickAccessPanel.js's theme toggle, which dispatches it) re-resolve these and repaint with
// the chart's last-loaded data.
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
    // "Last Year" overlay line — a distinct warm accent so it doesn't get confused with the green
    // Sales line or the neutral dashed Target line.
    LAST_YEAR_COLOR = (THEME_ROOT_STYLE.getPropertyValue("--color-warning").trim()) || "#D97706";
}
resolveDailyTrendColors();
const CRORE = 10000000;
const LAKH = 100000;

// LINE_COLOR is a plain hex string (from the CSS var read above) — this fades it to a given
// alpha for the Sales line's area fill's gradient stops, without hand-maintaining a separate rgba
// constant that could drift out of sync with LINE_COLOR.
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
// Real, individually-comparable brands for Compare mode — excludes "all", which is the combined
// aggregate rather than a brand of its own. Each brand's color stays identical between Graph and
// Bar Graph mode (both read it straight from here). Adding a brand later is the only change
// needed to extend Compare past 2 — every fetch/render/tooltip path below already loops over
// this list rather than assuming exactly 2 entries.
const COMPARE_BRANDS = [
    { key: "abh", label: "ABH", color: "#7C3AED" },
    { key: "kylie", label: "Kylie", color: "#DB2777" },
];

// Single-line (non-Compare) trend color — per explicit request: "All Brands" keeps the section's own
// default (theme --color-success, see LINE_COLOR), but picking one real brand recolors the line to
// that brand's own COMPARE_BRANDS identity color instead — mirrors SecondarySalesPage.js's own
// resolveTrendLineColor for UI/UX parity across both pages.
function resolveTrendLineColor(brand) {
    const compareBrand = COMPARE_BRANDS.find((b) => b.key === brand);
    return compareBrand ? compareBrand.color : LINE_COLOR;
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
    // #dailyTrendSectionContainer (an ancestor) ships `hidden` by default (see
    // data-permission="page:primary-sales.daily-trends" in the HTML) until applyPagePermissions
    // confirms the session holds it — remeasure once it's revealed, same reason the Overview gauge
    // above does.
    if (chart) {
        document.addEventListener("permissions-applied", () => chart.resize());
    }
    // granularity starts "month" (the default, filter-cleared view spans the whole FY) — see
    // setDateRange below for the real rule: a single specific month buckets by individual date, any
    // wider span buckets by month.
    // showTarget starts true (unlike showLastYear) — the Target line used to always be drawn
    // unconditionally in Graph mode before this toggle existed, so this keeps that same default-on
    // look; the toggle only adds the ability to turn it off (and to also show it in Bar Graph mode,
    // which it never did before either — see dailyTrendTargetToggle's own markup comment in
    // PrimarySalesPage.html).
    const state = { chartType: "line", brand: "all", channel: "all", status: "all", from: null, to: null, granularity: "month", compare: false, showLastYear: false, showTarget: true };
    let currentData = null;
    // One entry per COMPARE_BRANDS item ({ key, label, color, ...trend-range response }), only
    // populated while state.compare is true — null the rest of the time.
    let currentCompareData = null;
    let requestSeq = 0;

    // Trims to at most 2 decimals without trailing zeros (1.50 -> "1.5", 2.00 -> "2").
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

    // null when comparison is 0 and current isn't — growth is undefined/infinite, not 0.
    function growthPct(current, comparison) {
        const cur = Number(current ?? 0);
        const cmp = Number(comparison ?? 0);
        if (cmp === 0) {
            return cur === 0 ? 0 : null;
        }
        return ((cur - cmp) / cmp) * 100;
    }

    // Colored % for the tooltip's dark background — brighter tints than the app's normal
    // --color-success/--color-danger (meant for light card backgrounds) so they stay readable here.
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

    // Same up/down color convention as formatGrowth, but for a raw Sales - Target amount plus its
    // own % of Target alongside it (Compare tooltip's own "Sales Variance" rows, per row and Total)
    // — mirrors SecondarySalesPage.js's own formatVariance for UI/UX parity across both pages.
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

    // Turns a bucket's raw ISO `dates` entry into the full, unambiguous period shown on hover —
    // "05 Jan 2026" for a day, "January 2026" for a month, "2026" for a year (the axis `labels`
    // are deliberately terser, e.g. bare day numbers or a year-less month name for same-year ranges).
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

    // The overall selected window (backend's `period.from`/`period.to`, always full ISO dates)
    // formatted to match how a user would describe their own selection — a single month name when
    // By Month collapses to one calendar month, a single date when from/to match exactly, otherwise
    // a "from – to" range. Not keyed off granularity alone (day-granularity By Date can span many
    // months, so it must NOT be assumed to be "one month" the way it used to be pre-restructure).
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

    // Right-aligned summary line under the brand/date filter bar — per explicit request, spells out
    // every Filter Header input this chart is currently reading (selected date range, Brand, Channel,
    // and whether Compare is on) all at once, not just whichever one mode happens to hide the others.
    // (Per-point Last Year comparison still lives in the hover tooltip's "Last Year" row — see
    // tooltipFormatter — this summary line doesn't repeat a note about it.)
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

        // Compare mode: one block per brand (Sales/Target/Sales Variance, both the number and its %
        // of Target together — see formatVariance) plus a final combined Total row summing every
        // compared brand together — mirrors SecondarySalesPage.js's own tooltipFormatter for UI/UX
        // parity across both pages. dates/labels are shared across brands (see load()), only each
        // brand's own `data`/`target` values at this index differ.
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
                // see load()'s COMPARE_BRANDS fetch) is drawing as its own dotted overlay line below.
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
            // One series per COMPARE_BRANDS entry instead of the single Sales/Target pair — same
            // brandData.color in both Graph and Bar Graph mode, so a brand's line and its bars are
            // always the same color. No per-bar value labels (with 2+ brands grouped per x-axis
            // point, per-bar text labels would just collide/clutter) — the legend + hover tooltip
            // (see tooltipFormatter) carry that detail instead. Each brand also gets its own colored
            // area fill down to the chart's bottom axis (ECharts' own default areaStyle baseline) —
            // mirrors SecondarySalesPage.js's own Compare-mode fill for UI/UX parity across both
            // pages; low opacity keeps both fills visible wherever a higher brand's fill overlaps a
            // lower brand's.
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
            // Target overlay in Compare mode — per explicit request ("make the target line visible in
            // the compare option"), one dashed line per compared brand, reusing that same brand's own
            // COMPARE_BRANDS identity color (each brandData already carries its own real `target`
            // array — /trend-range returns it on every fetch, compare or not, the same field the
            // non-compare branch above already reads). Same dashed/0.7-opacity treatment Dashboard's
            // own copy of this chart already uses for its compare-mode Target overlay.
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
            // "Vs Last Year" overlay in Compare mode — one dotted line per compared brand, reusing
            // that brand's own COMPARE_BRANDS identity color (each brandData already carries
            // `lastYear` since /trend-range returns it on every fetch, compare or not).
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
            // Line color follows the selected brand (ABH/Kylie's own COMPARE_BRANDS identity color)
            // instead of always the theme default — "All Brands" keeps that default. Mirrors
            // SecondarySalesPage.js's own resolveTrendLineColor for UI/UX parity across both pages.
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
                // Graph (line) mode only — Bar Graph's bars are already a filled shape, an area fill
                // under them would just double up. Fades from the line's own color down to fully
                // transparent so the achieved-sales area reads clearly without darkening the Target
                // dashed line or data-point labels underneath it.
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

            // Bar Graph mode only: every bar always shows its own short Sales value + growth-vs-Target
            // above it (no click needed) — a two-line rich-text label computed per data index, since
            // each bar's growth depends on that bucket's own target.
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
            // Toggled via #dailyTrendTargetToggle (state.showTarget, defaults true) — per explicit
            // request this now works in both Graph and Bar Graph mode, same as Dashboard's own copy;
            // previously hard-gated to `!isBar` (never shown in Bar Graph mode, and no way to hide it
            // in Graph mode either). showSymbol follows isBar same as the Last Year overlay below, so
            // the dashed Target line gets visible point markers only when it's overlaid on top of bars.
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
            // "Vs Last Year" overlay — same-period Sales from a year ago (currentData.lastYear,
            // already fetched every load() regardless of this toggle since tooltipFormatter has
            // relied on it for the vs-Last-Year % all along); only drawn on-canvas once the user opts
            // in via #dailyTrendVsLastYearToggle (state.showLastYear). Drawn as a thin dotted "line"
            // even in Bar Graph mode — echarts happily mixes a line series onto a bar chart's category
            // axis, and a second bar-per-category would crowd out the growth-% labels above each bar.
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
                // appendToBody: false (the default) keeps the tooltip a DOM child of the chart's own
                // container (#dailyTrendChart, see .daily-trend-chart's position: relative below) —
                // it scrolls and resizes together with the card instead of floating at fixed page
                // coordinates that drift away from the chart the moment .app-main (the real scroll
                // container — see .app-main in Shared/css/app.css; <body> itself never scrolls) is
                // scrolled on a touch device. confine: true then does the actual edge-boundary work:
                // ECharts clamps/repositions the tooltip so it never renders past the chart
                // container's own edges (left/right/top/bottom), on hover AND on mobile/tablet touch
                // alike — so it can never overlap the Product Snapshot card below or overflow outside
                // the Daily Sales Trend section.
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
                    // Chart width never grows past the card (see .daily-trend-chart-scroll — no
                    // horizontal scrolling), so a long selection can have more points than fit
                    // legibly. "auto" skips just enough labels to stop them overlapping, keyed off
                    // the axis's actual current pixel width — re-evaluated on every chart.resize()
                    // (window resize, sidebar collapse/expand), so it adapts live to screen size.
                    interval: "auto",
                },
            },
            yAxis: {
                type: "value",
                // Bar mode reserves extra headroom above the tallest bar (ECharts' auto "nice" max
                // plus this padding) so every bar's two-line label has room to render without
                // clipping off the canvas top — Graph (line) mode doesn't need it.
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
        // Filter changes (brand, date inputs, mode/range-type, Compare toggle) can fire in quick
        // succession — each keystroke on a native date input triggers its own fetch. Guard against
        // an earlier request's response(s) arriving after a later one and clobbering current state.
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
                // Same date range/granularity for every brand, fetched in parallel — one
                // /trend-range call per COMPARE_BRANDS entry instead of the single-brand fetch.
                const results = await Promise.all(COMPARE_BRANDS.map(async (brand) => {
                    const params = new URLSearchParams({ ...baseParams, brand: brand.key });
                    const response = await fetch(`${apiBase}/trend-range?${params.toString()}`);
                    return { ...brand, ...(response.ok ? await response.json() : {}) };
                }));
                if (requestId !== requestSeq) {
                    return;
                }
                currentCompareData = results;
                // labels/dates/period are identical across brands (same date range/granularity for
                // all of them) — reusing the first brand's here lets updateSelectionSummary/
                // tooltipFormatter's shared (non-compare) plumbing keep working unchanged.
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

    // Compare toggle — a plain ON/OFF switch, not a 2-option pill like Graph/Bar Graph above.
    // While active, every real brand (COMPARE_BRANDS) is fetched and shown at once instead of
    // whatever single brand the Filter Header's own Brand pill currently has selected. Re-fetches
    // via load() since compare mode needs a different set of requests (one per brand) than the
    // single-brand fetch.
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
            // currentData/currentCompareData already carry `target` from every load() — toggling this
            // just changes what renderChart() draws, no re-fetch needed, same as showLastYear below.
            renderChart();
        });
    }

    if (vsLastYearToggle) {
        vsLastYearToggle.addEventListener("click", () => {
            state.showLastYear = !state.showLastYear;
            vsLastYearToggle.classList.toggle("active", state.showLastYear);
            vsLastYearToggle.setAttribute("aria-pressed", String(state.showLastYear));
            // currentData/currentCompareData already carry `lastYear` from every load() (the
            // tooltip's always used it) — toggling this just changes what renderChart() draws, no
            // re-fetch needed.
            renderChart();
        });
    }

    if (chart) {
        window.addEventListener("resize", () => {
            chart.resize();
        });
        // FIXED: switching back to day mode used to leave this chart's axis/line/target colors
        // stuck on their dark-mode values until a full page reload — see resolveDailyTrendColors'
        // own comment. Re-resolving the colors then re-running renderChart() (which reads off
        // currentData/currentCompareData, no re-fetch needed) repaints it immediately instead.
        window.addEventListener("theme-changed", () => {
            resolveDailyTrendColors();
            renderChart();
        });
    }

    return {
        load,
        // Driven by the Filter Header's shared Brand/Channel pills per explicit request (this
        // section used to have its own independent Brand pill/date filter, both removed — see
        // PrimarySalesPage.html's own comment on that removal). Compare mode already fetches every
        // COMPARE_BRANDS entry regardless of state.brand, so a Brand change while Compare is active
        // still re-fetches (channel/date apply equally to every compared brand) even though it won't
        // visibly change which brands are shown.
        // load() is already async — returned (not fire-and-forget) so Page wiring's
        // withFilterLoading can track it alongside every other Filter-Header-driven section.
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
                // REFINED per explicit follow-up request ("if only current month is selected then
                // show that month date wise... exam in aug to aug, sept to sept, etc"): a single
                // specific calendar month (from and to both fall in the same "yyyy-MM") now buckets by
                // individual date within that one month instead — a single month collapsed to one flat
                // point (the prior "always month" behavior) was a literally one-dot, useless chart.
                // Any WIDER span (2+ distinct months) still buckets by month, per the original explicit
                // request this refines rather than replaces. initInsightsDateFilter (this page's own
                // Filter — unlike Dashboard's own richer initSalesDateFilter) never sends a
                // meta.rangeType at all (no By Date/By Month/By Year sub-modes here, just one From/To
                // MONTH picker), so this compares the real [from, to] window directly instead.
                state.granularity = from.slice(0, 7) === to.slice(0, 7) ? "day" : "month";
            } else {
                // Filter closed/cleared — default to the current financial year (Apr-Mar) by month,
                // instead of an unbounded day-level view. Auto-rolls to the next FY once it starts.
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

// ==================== 3. Product Snapshot ====================
{
// The Primary Sales page's "3. Product Snapshot" section, backed by
// GET /api/primary-sales/product-level (PrimarySalesProductLevelService). The top full-width panel
// renders a REAL Category -> Sub-category -> Product nested tree (flattenTree turns the backend's
// nested "tree" field into the flat row list the expand/collapse table needs); the Product Ranking
// panel (the section's only panel now — Snapshot Summary was removed) has a level toggle (Products/
// Category/Sub-category) plus a Top/Below 10 by Value/Qty select, rendering the same #/Name/Sales/
// Qty/Contrib/Contrib Δ LY/vs LY/vs LM shape from either the backend's pre-limited topByValue/
// topByQty/bottomByValue/bottomByQty (Products level) or a locally re-sorted/sliced copy of the
// backend's full (unlimited) categories/subCategories arrays (Category/Sub-category levels —
// re-sorting client-side avoids a second request just to sort by qty instead of value). The
// header's All/ABH/Kylie brand pill is self-contained here (not the shared BrandHeader.js), matching
// the rest of this section's pattern.
// formatMoney/formatDelta come from the shared Shared/js/format.js import (top of file) — this
// section's calls pass { nullDash: true } (formatMoney also { round: false }) to match its
// original null-as-"—", unrounded-amount behavior.

function trendClass(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return value >= 0 ? "positive" : "negative";
}

// Wraps formatDelta's signed text in a colored pill so trend direction reads at a glance in the
// tree/ranking tables, matching the summary grid's positive/negative coloring.
function renderDelta(value) {
    if (value === null || value === undefined) {
        return "—";
    }
    return `<span class="product-snapshot-delta ${trendClass(value)}">${formatDelta(value, { nullDash: true })}</span>`;
}

// EAN/HSN/Tax (dbo.Product_Master) shown as a hover tooltip on the product name cell rather than
// dedicated table columns — the same tree/ranking table is shared across Category/Sub-category/
// Product levels, and only Product-level rows have these fields.
function productTooltip(row) {
    const parts = [];
    if (row.ean) parts.push(`EAN: ${row.ean}`);
    if (row.hsn) parts.push(`HSN: ${row.hsn}`);
    if (row.tax != null) parts.push(`Tax: ${Number(row.tax).toFixed(1)}%`);
    return parts.join(" | ");
}

// Same brand identity colors as Daily Trend Graph's Compare mode (COMPARE_BRANDS, further down this
// file, in that section's own block scope — duplicated here rather than shared, since every section
// in this file is its own isolated { } block, so BRAND_LABEL/COMPARE_BRANDS elsewhere aren't visible
// from this one) — keeps ABH/Kylie reading as the same color everywhere on the page rather than
// picking an unrelated palette just for this strip. "ABH"/"Kylie" here are Site_Master's own short
// codes for Anastasia Beverly Hills / Kylie Cosmetics respectively (see BrandFilter.java's header
// comment on the backend) — not the full Product_Master display names, which never reach this file.
const QTY_LEADER_BRAND_COLOR = { abh: "#7C3AED", kylie: "#DB2777" };
const QTY_LEADER_BRAND_LABEL = { abh: "ABH", kylie: "Kylie" };

// Compact "in short" quantity — 484008 -> "4.8L", 12000 -> "12.0K" — same Indian Lakh/Crore scale
// formatMoney (Shared/js/format.js) uses for money, just without the ₹ sign since this is a unit
// count, not currency.
function formatQtyShort(value) {
    const num = Number(value ?? 0);
    const abs = Math.abs(num);
    if (abs >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`;
    if (abs >= 100000) return `${(num / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return String(Math.round(num));
}

// Header badge — every real brand's Qty (ProductLevelResponse.brandQuantities, now driven by
// whatever Product_Master.Brand actually has — see loadBrandQuantities's own comment — not a
// hardcoded ABH/Kylie pair) condensed into one line: "ABH: 4.8L • Kylie: 0" — per explicit request
// the ▲/▼ leader/trailer glyph (not a period-over-period trend — brandQuantities carries just this
// period's totals, not a prior-period comparison) is removed entirely, brand name/color is the only
// leader cue left. Sits right before the Product Research button (see the HTML) via
// renderQtyHeaderBadge, called from the same refresh() that already populates the right-side Qty
// Leader strip below. A null/empty brandQuantities means Product_Master genuinely has no Brand data
// right now — shown as "Not Available" (same convention/wording as the Brand pill's own empty
// state, see renderBrandPill above) rather than silently collapsing the badge away.
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

// Product Detail's tree table (renderTable below) drops the "#" index numbering entirely (no
// index/icon column), so it gets its own header row instead of sharing COLUMNS with Product Ranking.
const DETAIL_COLUMNS = ["Name", "Sales", "Contrib", "Contrib Δ LY", "vs LM", "vs LY"];

// One icon per Product Snapshot column header — per explicit request, same icon-then-text
// side-by-side look Secondary Sales' Site Master Report/Reports headers use (siteMasterHeaderCell/
// REPORTS_COLUMN_ICONS in SecondarySalesPage.js/.css), ported here so this section's headers read
// the same way. "#" reuses Site Master Report's own Rank icon since both are a row-position column;
// "vs LY" reuses that page's exact Vs LY icon for the same concept.
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

// Turns the backend's nested Category -> Sub-category -> Product "tree" into the flat
// id/parent/level row list the expand/collapse table below operates on.
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

    // Tree starts fully collapsed — only top-level Category rows are visible until the user clicks
    // a row's chevron to reveal its children.
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

// Client-side CSV export of the Product Research popup's whole Category -> Sub-category -> Product
// tree (whatever's currently loaded, expanded/collapsed state doesn't matter — every row exports
// regardless), same Blob-download approach as downloadRankingCsv above. Per explicit request, each
// hierarchy level gets its own column (Category/Sub-Category/Product) instead of one combined
// "Category > Sub-category > Product" text column — a row's own ancestor path (row.level tells us
// how deep it is) fills the columns up to and including its own level, the rest stay blank.
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

// The filter (level toggle + metric select) starts collapsed inside filterBody — clicking
// filterToggle is the only way to open it, matching SalesDateFilter's "closed until clicked" UX.
// `getData` is called fresh on every render so this stays in sync with whatever the module's latest
// fetch loaded, without this function needing to know about the fetch/refresh cycle itself.
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
    // ON_SCREEN_LIMIT is what the table itself ever shows, regardless of level — the download
    // range select (see productSnapshotDownloadRangeA in the HTML) lets the CSV export go past it
    // (an exact "Custom Range" count) into the exact same order/metric without changing what's on
    // screen.
    const ON_SCREEN_LIMIT = 10;
    // Mirrors PrimarySalesProductLevelService.TOP_N — Product-level rows (topByValue/bottomByValue/
    // topByQty/bottomByQty) are already capped server-side at this many, so a bigger Custom Range
    // number can never actually download more than this — Category/Sub-category have no such cap
    // (they're genuinely unlimited server-side). updateDownloadRangeForLevel below caps the Custom
    // Range input itself at this value for Product level, rather than letting the user type a number
    // the server can't honor.
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

    // `limit` caps how many rows come back — ON_SCREEN_LIMIT for the table, a larger value when
    // the download range select asks for more. Product-level rows are already capped server-side
    // (see PrimarySalesProductLevelService.TOP_N) to at least the largest selectable range, so
    // slicing here just trims that same array down further, never re-fetches.
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

    // "Custom Range" reveals the number input right below the select; the other two options hide
    // it again (its value is left as-is, so re-picking "Custom Range" later restores it).
    if (downloadRangeSelect && downloadRangeInput) {
        downloadRangeSelect.addEventListener("change", () => {
            downloadRangeInput.hidden = downloadRangeSelect.value !== "range";
        });
    }

    // The download icon button only opens/closes the range-picker popup now — the actual CSV
    // download happens from the popup's own confirm button (downloadConfirmBtn) below, once the
    // user has picked Current Display/All/Custom Range.
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
                // Custom Range — whatever count the user typed, falling back to the on-screen count
                // for a blank/invalid entry rather than downloading nothing.
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

    // Product Research modal — the Category -> Sub-category -> Product tree (renderTable/
    // flattenTree; the standalone "Product Detail" section that used to hold this on the page was
    // removed once this popup covered the same thing). Kept in sync every refresh(), not just when
    // opened, so it's never stale if the user changes brand while the popup happens to be open.
    const researchBtn = document.getElementById("productResearchBtn");
    const researchBackdrop = document.getElementById("productResearchBackdrop");
    const researchClose = document.getElementById("productResearchClose");
    const researchDownloadBtn = document.getElementById("productResearchDownloadBtn");
    const researchTableWrap = document.getElementById("productResearchTableWrap");

    let latestData = null;
    let latestResearchRows = [];
    let requestSeq = 0;
    // ISO yyyy-MM-dd strings straight from the Overview section's shared Filter (see
    // initInsightsDateFilter's onFilterChange, wired in Page wiring below) — null/null means no
    // filter applied, which the backend defaults to month-to-date on its own (see
    // PrimarySalesProductLevelService.getProductLevel).
    let periodFrom = null;
    let periodTo = null;
    // CHANGED 2026-08-25: wired to the Overview section's shared Brand pill too (see setBrand below
    // and Page wiring) — "all"/"abh"/"kylie", same convention getProductLevel's own `brand` param
    // already followed server-side (it was just never fed anything but the literal string "all"
    // until now).
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

    // "Product Research" button: opens the Category -> Sub-category -> Product tree in a popup —
    // same open/close pattern as the Overview section's "i" info modal (backdrop click, close
    // button, Escape).
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

    // Wired to the Overview section's shared Filter (see Page wiring) — `meta.mode === "filter"`
    // with real from/to scopes this section to that exact range; anything else (cleared, or the
    // filter's initial closed-panel probe) resets to the backend's own month-to-date default, same
    // convention as initTargetVsAchievement.setDateRange.
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

    // Wired to the Overview section's shared Brand pill (see Page wiring) — same "all"/"abh"/"kylie"
    // values initTargetVsAchievement.setBrand already takes. refresh() is already async — returned
    // (not fire-and-forget) so Page wiring's withFilterLoading can track it alongside every other
    // Filter-Header-driven section.
    function setBrand(nextBrand) {
        brand = nextBrand;
        return refresh();
    }

    // Wired to the Filter Header's shared Channel pill (see Page wiring) — "all" or a real
    // Site_Master.Channel value, same convention setBrand above already follows.
    function setChannel(nextChannel) {
        channel = nextChannel;
        return refresh();
    }

    // Wired to the Filter Header's shared Status pill (see Page wiring) — "all"/"active"/"inactive",
    // same convention setBrand/setChannel above already follow.
    function setStatus(nextStatus) {
        status = nextStatus;
        return refresh();
    }

    refresh();

    return { load: refresh, setDateRange, setBrand, setChannel, setStatus };
}
    Page.initProductSnapshot = initProductSnapshot;
}

// ==================== 4. Reports ====================
// Base structure/behavior mirrors SecondarySalesPage.js's own "3. Reports" — 4 tabs (All Report tree
// + Sub-Channel/Channel/Partner flat), same tab toggle/counts-strip/download-popup/no-data-available/
// per-tab-count conventions, and no Brand-filter pill of its own (always "all" brands, same as
// Secondary's version — see initReportsSection's own withBrand). It DOES follow "1. Overview"'s own
// date Filter, same as Secondary's Reports follows its own "1. Overview" Filter (see Page wiring
// below). Per explicit request, this section carries 8 columns (Brand/Channel/Sub-Channel/Partner,
// Mnt, MTD Sales, Achi., Proj., Proj vs Tgt, Vs LM, Vs LY) — real differences from Secondary's own
// 5-column version (which has neither Proj./Proj vs Tgt nor Vs LM): Mnt is combo-matched
// (Primary_Sales_Target has no clean per-site grain — Secondary's own Secondary_Sales_Target does),
// Sales is Bill_to-joined (not Site_Code), and Proj./Proj vs Tgt are real, sourced from
// Primary_Sales_Projection via TopProjectionService (Secondary has no equivalent projection table at
// all) — see PrimarySalesReportsService's own header comment for the full rationale. Every figure on
// this section comes from exactly four tables: site_master, Primary_Sales, Primary_Sales_Target, and
// Primary_Sales_Projection — never Secondary_Sales/Secondary_Sales_Target.
{
// Local to this section's own `{ ... }` block, same as every other section on this page — Product
// Snapshot has its own near-identical trendClass/renderDelta pair that isn't reachable from here (a
// block-scoped function declaration in an ES module doesn't leak across sibling `{ ... }` blocks), so
// this is its own copy, exact mirror of SecondarySalesPage.js's own reportsTrendClass/
// renderReportsDelta. primarySiteReportMoney IS safely reusable, though — genuinely module-top-level
// (declared bare, with no wrapping block, further down this file) — reused here as this section's
// own money formatter (matches Secondary's own single shared money()).

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

// One icon per Reports column header — reuses this page's own Product Snapshot header-cell classes
// (product-snapshot-header-cell/-icon/-icon-label, already white-on-solid-primary styled for
// .product-snapshot-table th) instead of introducing Secondary's differently-named equivalents
// (site-master-header-cell/secondary-overview-header-icon*) — same visual result, this page's own
// existing vocabulary. The first column's icon matches whichever real Site_Master dimension that tab
// is (Brand/Channel/Sub-Channel/Partner — same icons BRAND_TREE_LEVEL_ICONS below already uses for
// those levels). "Vs LM" reuses Product Snapshot's own "vs LM" icon (PRODUCT_SNAPSHOT_COLUMN_ICONS)
// for the same concept.
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

// 8-column widths — first column a bit wider for the name/tree indentation.
const REPORTS_TABLE_COLGROUP = `<colgroup>
    <col style="width:20%"><col style="width:11%"><col style="width:12%"><col style="width:10%">
    <col style="width:11%"><col style="width:12%"><col style="width:12%"><col style="width:12%">
</colgroup>`;

function reportsAchiPct(sales, target) {
    const t = Number(target ?? 0);
    const s = Number(sales ?? 0);
    return t > 0 ? (s / t) * 100 : null;
}

// `brandSlot` (0-3, or undefined) colors the fill via .channel-report-achi-fill[data-brand-slot] in
// the stylesheet — omitted for rows that don't belong to one single Brand (the Total row, and every
// row in the brand-less flat tabs), which fall back to a neutral color instead.
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

// Per-tab row-tint class for renderReportsTable's own <table> — per explicit request, each flat
// tab's data rows get one solid color (Sub-Channel/Channel/Partner) instead of the base
// .product-snapshot-table rule's even/odd zebra stripe, same tint family renderBrandHierarchyTable's
// own data-level rule uses (see .brand-hierarchy-table tbody tr[data-level] in the stylesheet) —
// mirrors SecondarySalesPage.js's own FLAT_REPORT_TABLE_CLASS for UI/UX parity across both pages:
// Channel=success, Sub-Channel=info, Partner=warning.
const FLAT_REPORT_TABLE_CLASS = {
    "Sub-Channel": "report-flat-table--subchannel",
    "Channel": "report-flat-table--channel",
    "Partner": "report-flat-table--partner",
};

// `rows` is a flat list of {name, monthTarget, mtdSales, vsLastMonthPct, vsLastYearPct, projection,
// projVsTargetPct} objects (Sub-Channel/Channel/Partner tabs, real per
// PrimarySalesReportsService.get*Summaries) — every column is real. `firstLabel` doubles as the
// BRAND_TREE_LEVEL_LABELS lookup key so every flat tab shows the exact same icon-on-top/
// label-underneath row icon the "All Report" hierarchy tree uses for that same level, instead of one
// generic icon shared by all three tabs.
function renderReportsTable(wrap, firstLabel, rows) {
    const level = BRAND_TREE_LEVEL_LABELS.indexOf(firstLabel);
    // getFlatSummary (backend) always appends its own trailing {name: "Total", ...} row, even when
    // site_master itself has zero rows for the current brand filter — so a plain !rows.length check
    // would never actually trigger. countFlatRows excludes that row, so this only fires when
    // site_master genuinely has nothing.
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

// Turns the backend's nested {name, monthTarget, mtdSales, states:[...]} tree into a flat
// id/parent/level row list an expand/collapse table can render as one flat <table> with per-row
// indentation. Each row carries `brand`: its own name at level 0, or its level-0 ancestor's name at
// every level below that (so a Sub_Channel/Partner row's Achi. bar can be colored by the Brand it
// rolls up to). The bottom Total row (level 0, name "Total") gets brand: null since it spans every
// Brand, not just one.
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

// A row's full ancestor path (["Brand", "Channel", "Sub-Channel", "Partner"]) by walking `parent`
// back up `rows` — needed here because a flat CSV loses the on-screen table's indentation. Flat-tab
// rows have no `parent`/`level` at all (single level) and never reach this — see downloadReportsCsv.
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

// Brand -> Channel -> Sub-Channel -> Partner — one CSV column per hierarchy level, per explicit
// request (replaces the previous single combined "Name" column).
const REPORTS_LEVEL_COLUMNS = ["Brand", "Channel", "Sub-Channel", "Partner"];

// Client-side CSV export for the Reports section's download popup — `sections` is one or more
// {label, rows} pairs.
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
            // "All Report" rows are real 4-level tree nodes (level 0-3) — split their own ancestor
            // path across all 4 columns. The flat Sub-Channel/Channel/Partner tabs have no level at
            // all (a single flat list), so each of those rows' one name goes only into its own
            // tab's matching column, the rest blank.
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

// Total row count per hierarchy level (Brand/Channel/Sub-Channel/Partner) for the header's count
// strip — the bottom Total row (level 0, name "Total") is excluded, it isn't a real Brand.
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

// Sub-Channel/Channel/Partner tabs each only carry their own flat dimension's rows — no info about
// the other 3 dimensions to compute real counts for — so only that one tab's own distinct-value
// count is shown here. "All Report" keeps showing all 4 (renderReportsCounts above), since its
// brand-hierarchy tree is the one endpoint with real data for every level.
function renderSingleReportsCount(el, label, count) {
    if (!el) {
        return;
    }
    el.innerHTML = `<span class="reports-section-count"><span class="reports-section-count-label">${label}:</span>${count}</span>`;
}

// getFlatSummary (backend) always appends its own trailing {name: "Total", ...} row — not a real
// distinct value, excluded the same way computeHierarchyCounts excludes the brand tree's own Total.
function countFlatRows(rows) {
    return (rows ?? []).filter((row) => row.name !== "Total").length;
}

// One icon per hierarchy level (0=Brand, 1=Channel, 2=Sub Channel, 3=Partner) so the tree reads at a
// glance without having to check indentation alone.
const BRAND_TREE_LEVEL_ICONS = ["bi-shop", "bi-diagram-2-fill", "bi-diagram-3-fill", "bi-people-fill"];
const BRAND_TREE_LEVEL_LABELS = ["Brand", "Channel", "Sub-Channel", "Partner"];

// Achi. bar color slots (0-3, matching --achi-brand-1..4 in the stylesheet) — one per Brand, in fixed
// first-seen order, so every Sub_Channel/Partner row under a Brand shares that Brand's color rather
// than being colored by its own level/category.
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

// Every node starts collapsed and can be expanded/collapsed independently of its siblings.
function renderBrandHierarchyTable(wrap, rows) {
    // getBrandHierarchy (backend) always appends its own trailing {name: "Total", level: 0, ...}
    // brand node, even when site_master itself has zero rows for the current brand filter — so a
    // plain !rows.length check would never actually trigger. Excluding that node here means this
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

// Every flat (single-level) Reports tab besides "All Report" — one tab per Site_Master dimension
// (Sub-Channel/Channel/Partner; the standalone Brand tab is intentionally not wired here, same as
// Secondary's own version — Brand-level rows are still visible via the "All Report" hierarchy tree),
// each backed by its own PrimarySalesReportsService#get*Summaries endpoint.
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
    // One cached row-list + request-sequence guard per flat tab (see FLAT_REPORT_TABS) — same
    // "ignore anything but the latest request" pattern brandTreeRequestSeq already uses.
    const flatRows = { subchannel: null, channel: null, partner: null };
    const flatRequestSeq = { subchannel: 0, channel: 0, partner: 0 };
    // Driven by "1. Overview"'s own date Filter (see setDateRange below and this page's Page wiring)
    // — null/null means the backend's own current-month-to-date default, same as before this existed.
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

    // loadBrandTree/loadFlatTab are both async — returned (not fire-and-forget) on the cache-miss
    // branches so setDateRange below can hand the real fetch back to Page wiring's
    // withFilterLoading; the cache-hit branches return undefined, which Promise.allSettled treats
    // as already resolved.
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

    // This section has no Brand-filter pill of its own (always "all", same as Secondary's version).
    // It DOES follow "1. Overview"'s own date Filter (see currentFrom/currentTo and setDateRange
    // below) — omitted (backend's own current-month-to-date default) until that filter is actually
    // used.
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

    // Download button opens a small popup with a scope select — "Active Tab" or "All Tabs" — and its
    // own confirm button.
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

    // Called from Page wiring's own "1. Overview" onFilterChange. Clears every cached tab (both the
    // brand tree and each flat tab) so renderActiveTab's null-check re-fetches the active one fresh
    // under the new window — the other, currently-inactive tabs just lazily re-fetch next time their
    // tab button is clicked, same as a first-ever visit to them would.
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

// ==================== Page wiring ====================
initSidebar();
initQuickAccessPanel();
// Reveals this page's Section/Feature-gated elements (Overview, Daily Sales Trends, Product
// Snapshot, Reports, Site_Master Report and their own view/export features — see this file's
// data-permission attributes) once the session's real permission set resolves; every one of them
// ships `hidden` in the static HTML itself, so there's no flash of content this session doesn't
// hold permission for.
// applyFeatureGating runs only after applyPagePermissions resolves (not in parallel) — an element
// carrying both a data-permission and a data-feature gate must never have permission-gating's own
// unconditional `hidden` assignment silently undo a feature-based hide by resolving second; see
// Dashboard.js's own comment on this same sequencing for the full reasoning.
applyPagePermissions().then(() => applyFeatureGating());

// Status pill options — local twin of BrandFilter.js's loadBrandPillOptions/renderBrandPill (not
// exported from the shared StatusFilter.js component, which every other page using it still drives
// off hardcoded All/Active/Inactive HTML buttons — changing that shared file would ripple into
// Dashboard/Site Insight/Team Performance's own Status pills too, well beyond what was asked here).
// Same fetch-then-render-then-"Not Available" shape as loadBrandPillOptions/renderBrandPill above,
// per explicit request ("same as we do in the brand and channel filter").
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

// Renders into #dashboardFyOverviewStatusToggle itself (that id IS the .site-status-filter-pill
// container — no extra wrapper div the way Brand's #brandHeader used to have, see this page's own
// alignment fix). Buttons use .site-status-filter-item (StatusFilter.css's own class, not
// .brand-header-item) so Page.initStatusFilter's querySelectorAll(".site-status-filter-item") below
// finds them once this replaces the placeholder — data-status is lowercased (matching the old static
// HTML's own "active"/"inactive" values) since OperationalStatusFilter's server-side match is
// case-insensitive but the frontend's own persisted/compared value should stay predictable either way.
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

// Brand pill options are fetched before any of the brand-pill-dependent init calls below run, so
// initBrandHeader/initDailyTrendGraph's one-time querySelectorAll(".brand-header-item") sees the
// real Site_Master-backed buttons instead of the static HTML fallback — see loadBrandPillOptions'
// own comment. Status pill options (below) follow the exact same sequencing for the exact same reason.
(async function wirePage() {
const [brandPillOptions, channelPillOptions, statusPillOptions] = await Promise.all([
    loadBrandPillOptions("/api/primary-sales/brands"),
    loadChannelPillOptions("/api/primary-sales/channels"),
    loadStatusPillOptions("/api/primary-sales/statuses"),
]);
renderBrandPill("brandHeader", brandPillOptions);
renderChannelPill("dashboardFyOverviewChannelToggle", channelPillOptions);
renderStatusPill("dashboardFyOverviewStatusToggle", statusPillOptions);

// 1. Overview (Target vs Achievement) — reacts to the Filter Header's Brand/Channel pills and its
// own Filter (a From/To month range, see initInsightsDateFilter).
const targetVsAchievement = Page.initTargetVsAchievement();

// 3. Product Snapshot — initialized here (ahead of "2. Daily Sales Trends" below, matching this
// file's existing out-of-visual-order wiring convention) so its `setDateRange`/`setBrand`/
// `setChannel` exist before initBrandHeader/initChannelHeader/initInsightsDateFilter's callbacks
// (wired further down) can reference them — all fire synchronously once during their own setup, so
// productSnapshot must already be a real object by the time any of them first runs, not still
// undefined.
const productSnapshot = Page.initProductSnapshot();

// 4. Reports — created before "1. Overview"'s own Filter below so its onFilterChange can drive it via
// the setDateRange it returns (see initReportsSection's own comment for how it plumbs [from, to]
// into its already from/to-capable backend endpoints) — exact mirror of SecondarySalesPage.js's own
// wiring convention for its "3. Reports". Has no Brand/Channel-filter pill of its own (always "all"
// brands, same as Secondary's version) — per explicit request only the date Filter reaches it, so
// it's the one section here NOT wired into initBrandHeader/initChannelHeader below.
const reportsSection = Page.initReportsSection();

// 2. Daily Sales Trends — created here (same reasoning as productSnapshot above) so its setBrand/
// setChannel/setDateRange exist before the Filter Header's own pills/Filter (wired below) reference
// them. Used to have its own independent Brand pill + date filter bar; both were removed per
// explicit request, so it's now driven entirely by the Filter Header's shared controls instead.
const dailyTrend = Page.initDailyTrendGraph();

// Filter Header's own loading spinner (#filterHeaderSpinner, next to the "Filter Header" title —
// see PrimarySalesPage.html/.css's .section-loading-spinner convention, same one Product Snapshot's
// title already uses) — shown while a Brand/Channel/Date change is still being applied across every
// section that reacts to it. A plain counter (not a bare add/remove) so clicking through Brand ->
// Channel -> Date in quick succession, each still in flight, doesn't let an earlier one's resolution
// hide the spinner while a later one is still pending — same pendingRequests pattern
// initReportsSection's own beginLoading/endLoading already uses. Every setBrand/setChannel/
// setDateRange handed in below now returns its own real fetch promise (see each section's own
// comment on that change) instead of firing and forgetting, so Promise.allSettled here genuinely
// waits for the data to land, not just for the synchronous call to return.
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

// The Brand pill is SHARED/global, same as Channel and the date Filter below — every section on this
// page except Reports (which has no Brand/Channel pill of its own, always "all") reacts to it.
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

// The Channel pill is SHARED/global too — same sections as the Brand pill above, same "all" or a
// real Site_Master.Channel value convention.
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

// The Status pill is SHARED/global too — same sections as Brand/Channel above (Reports has no
// Brand/Channel pill of its own either — see this file's own header comment on that section — so
// it's excluded from Status the same way), "all"/"active"/"inactive" convention same as Site
// Insight's own Status toggle. initStatusFilter (unlike initBrandHeader/initChannelHeader) doesn't
// fire its callback once on init with a restored/default value — there's nothing to restore here
// (no persist/localStorage support in that shared component), so "all" (every section's own default
// state) is already correct without an initial fire.
Page.initStatusFilter("dashboardFyOverviewStatusToggle", (status) => {
    withFilterLoading([
        targetVsAchievement.setStatus(status),
        productSnapshot.setStatus(status),
        dailyTrend.setStatus(status),
    ]);
});

// The Overview section's Filter is a SHARED/global filter, not scoped to Overview alone — every
// month-range pick (or clear) it fires also re-scopes Product Snapshot, Daily Sales Trends, AND
// Reports to the exact same range, per explicit request (Reports' own wiring mirrors Secondary's "1.
// Overview" Filter -> "3. Reports" convention exactly). Product Snapshot/Daily Sales Trends
// independently default back to their own backend's month-to-date when the filter is cleared
// (meta.mode !== "filter"); Reports does the same via its own backend's default (see
// initReportsSection's withBrand).
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

// A Projection Value saved through the Quick Access Panel's Projection Form popup (dbo.Top_Projection
// — see QuickAccessPanel.js's submit handler) feeds the Insight card's Projection row/badge, which
// doesn't re-fetch on its own since it doesn't poll — per explicit request, a save should show up
// right away, no hard page reload needed. The popup dispatches "top-projection-saved" on window right
// after a successful save; this just re-runs the same real fetch the Insight card already does for a
// Filter change, scoped to whatever brand/period it's currently showing (Product Snapshot/Daily Trend
// never display Top_Projection data at all, so they have nothing to react to here).
window.addEventListener("top-projection-saved", () => {
    targetVsAchievement.reload();
});
})();

// primarySiteReportMoney/primarySiteReportMoneyFull were originally part of the removed "5.
// Site_Master Primary_Sale Report" section (deleted per explicit request) — kept here, still bare/
// module-top-level, because "4. Reports" above genuinely reuses them as its own money formatters
// (see that section's own header comment).
function primarySiteReportMoney(value, opts) {
    return formatMoney(value, opts).replace("₹", "");
}

// Per explicit request: the CSV/Excel download's own money columns show the full, un-abbreviated
// digit count instead of this table's on-screen Cr/L abbreviation — on-screen
// primarySiteReportMoney is untouched, this is a separate wrapper used only inside
// downloadReportsCsv above.
function primarySiteReportMoneyFull(value, opts) {
    return formatMoneyFull(value, opts).replace("₹", "");
}
