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

const pagePermissionsPromise = applyPagePermissions();

const pageFeaturesPromise = pagePermissionsPromise.then(() => applyFeatureGating());


const Page = {};


let siteStatusFilter = "active";


function withStatusParam(url) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}status=${encodeURIComponent(siteStatusFilter)}`;
}


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


let siteSalesTypeFilter = "all";


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


const MONTHLY_FY_MONTH_NAMES = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];


function monthlyFyCurrentStartYear2Digit() {
    const now = new Date();
    const calendarYear2Digit = now.getFullYear() % 100;
    return now.getMonth() < 3 ? calendarYear2Digit - 1 : calendarYear2Digit;
}


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


function buildMonthlyFyMonths(fyStartYear2Digit) {
    const fullStartYear = 2000 + fyStartYear2Digit;
    return MONTHLY_FY_MONTH_NAMES.map((name, i) => {
        const year = i < 9 ? fullStartYear : fullStartYear + 1;
        const monthNum = i < 9 ? i + 4 : i - 8;
        return { label: `${name}-${String(year % 100).padStart(2, "0")}`, key: `${year}-${String(monthNum).padStart(2, "0")}` };
    });
}


function monthlyFyLastYearKey(key) {
    const [y, m] = key.split("-");
    return `${Number(y) - 1}-${m}`;
}


const MONTHLY_FY_CURRENT_START_YEAR = monthlyFyCurrentStartYear2Digit();
const MONTHLY_FY_WINDOW_SIZE = 3;
const MONTHLY_FY_KEYS = Array.from({ length: MONTHLY_FY_WINDOW_SIZE }, (_, i) => monthlyFyKeyFor(MONTHLY_FY_CURRENT_START_YEAR - i));


function monthlyFyGroupHeaderCell(label, groupClass) {
    return `<th colspan="4" class="dashboard-fy-overview-group-header ${groupClass}">${escapeHtml(label)}</th>`;
}

function monthlyFySubHeaderCell(label, groupClass) {
    return `<th class="${groupClass}">${escapeHtml(label)}</th>`;
}


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


function monthlyFySignedVariance(value) {
    if (value === null || value === undefined) {
        return "—";
    }
    const num = Number(value);
    const sign = num > 0 ? "+" : (num < 0 ? "-" : "");
    return `${sign}${money(Math.abs(num), { round: false })}`;
}


function monthlyFyRenderYoyVariance(current, previous) {
    if (!current || !previous) {
        return "—";
    }
    const diff = current - previous;
    return `<span class="dashboard-delta ${monthlyFyTrendClass(diff)}" title="Last Year: ${escapeHtml(formatMoneyFull(previous))}">${monthlyFySignedVariance(diff)} (${formatDelta(monthlyFyGrowthPct(current, previous))}) / <span class="dashboard-delta-lastyear">${money(previous, { round: false })}</span></span>`;
}


function monthlyFyMoneyCell(value, allowDash) {
    if (allowDash && !value) {
        return "<td>—</td>";
    }
    return `<td title="${escapeHtml(formatMoneyFull(value))}">${money(value, { round: false })}</td>`;
}


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


Page.initSalesDateFilter = initSalesDateFilter;


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


{

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

    TREND_LAST_YEAR_COLOR = TREND_THEME_STYLE.getPropertyValue("--color-warning").trim() || "#D97706";
}
resolveTrendColors();

const TREND_GRANULARITY_LABEL = { day: "Daily", month: "Monthly", year: "Yearly" };
const TREND_PERIOD_LABEL = { day: "Date", month: "Month", year: "Year" };


let activeTrendCleanup = null;


function currentFinancialYearMonthRange() {
    const now = new Date();
    const month = now.getMonth() + 1;
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

    const state = { chartType: "line", from: null, to: null, granularity: "day", showLastYear: false, showTarget: true };
    let currentData = null;
    let requestSeq = 0;

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

    if (vsLastYearToggle) {
        vsLastYearToggle.addEventListener("click", () => {
            state.showLastYear = !state.showLastYear;
            vsLastYearToggle.classList.toggle("active", state.showLastYear);
            vsLastYearToggle.setAttribute("aria-pressed", String(state.showLastYear));

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


    function setDateRange(from, to, meta) {
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
    }

    return { setDateRange };
}
Page.initSalesTrend = initSalesTrend;
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


const PRODUCT_SNAPSHOT_COLUMNS = ["#", "Name", "Sales", "Qty", "Contrib", "Contrib Δ LY", "vs LM", "vs LY"];

const PRODUCT_SNAPSHOT_LEVEL_LABELS = {
    product: "Products",
    category: "Category",
    subcategory: "Sub-category",
};


function productSnapshotLevelMetricOptions(level) {
    const name = PRODUCT_SNAPSHOT_LEVEL_LABELS[level];
    return [
        { value: "top10-value", label: `Top 10 ${name} by Value` },
        { value: "top10-qty", label: `Top 10 ${name} by Qty` },
        { value: "bottom10-value", label: `Below 10 ${name} by Value` },
        { value: "bottom10-qty", label: `Below 10 ${name} by Qty` },
    ];
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

    void spinner;
    const initialLevel = levelButtons.find((b) => b.classList.contains("active"))?.dataset.level ?? "product";
    populateMetricSelect(initialLevel);
    refresh();


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


    contentEl.innerHTML = SITE_DETAIL_CONTENT_TEMPLATE;

    const sitePermissions = await pagePermissionsPromise;

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

    contentEl.hidden = !sitePermissions.has("page:site-insights.site-detail");


    const salesTrend = Page.initSalesTrend(siteCode, brand, salesTypeFlags);
    const productSnapshot = Page.initProductSnapshot(siteCode, brand);


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


    let siteCodes = [];
    let siteCodeSearchQuery = "";
    const countEl = document.getElementById("siteStatusCodeCount");

    function siteCodeOptionLabel(entry) {
        return entry.Store_Name ? `${entry.Site_Code} - ${entry.Store_Name}` : entry.Site_Code;
    }


    function syncSiteCodeSelectTitle() {
        const selectedOption = select.options[select.selectedIndex];
        select.title = selectedOption ? selectedOption.textContent : "";
    }


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


let lastGeoMapContextState = null;


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


function refreshGeoMapContextForStatus() {
    const row = document.getElementById("siteStatusContextRow");
    if (row && !row.hidden && lastGeoMapContextState) {
        updateGeoMapContext(lastGeoMapContextState);
    }
}


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

            compareStatesLoaded = false;
            compareAllStores = null;
            if (!backdrop.classList.contains("is-open")) {
                return;
            }
            activateTab(currentTab);

            if (currentTab === "sitesInState") {
                const stateSelect = document.getElementById("siteStatusCompareStateSelect");
                if (stateSelect?.value) {
                    loadCompareSitesInState(stateSelect.value);
                }
            }
        },
    };
}


const geoMapModalHandle = wireGeoMapModal();
const compareModalHandle = wireCompareModal();

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
