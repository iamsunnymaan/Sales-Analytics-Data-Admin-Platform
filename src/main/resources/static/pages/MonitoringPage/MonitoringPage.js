// Monitoring page — Password Reset Tokens, Recent OTPs, a "Usage Overview" graph (login activity
// by hour of day + most-active users), and "2. Audit" — a single Type/Status/Search/Date-filtered
// table covering all 4 attempt kinds (login, download, upload, unauthorized) that used to each
// have their own standalone always-visible section here; those were folded into this one filterable
// view instead (per explicit request) — don't re-add them as their own sections. Each Type option
// still reads MonitoringController's original per-type endpoint (/login-attempts, /download-
// attempts, /upload-attempts, /unauthorized-attempts), and each of THOSE still enforces its own
// original page:monitoring.login-attempts/download-attempts/upload-attempts/unauthorized-attempts
// permission (independent of page:monitoring.audit, which only gates the Audit section's own
// visibility) — see AuthBootstrapSeeder's own PERMISSION_TREE comment. A session with page:
// monitoring.audit but not, say, page:monitoring.upload-attempts sees the Audit card but gets an
// HTTP 403 (rendered as a plain error row) the moment it picks Type=Upload; that's intentional, not
// a bug. "Sessions (Refresh Tokens)" was removed per explicit request too — it only ever reflected
// another application's own use of this shared database, house_of_beauty itself never issues one
// (see IamLoginRefreshTokenRepository's own header comment) — don't re-add it unasked. All backed
// by real data via MonitoringController/MonitoringService. Password Reset Tokens reads from a real
// table that's always empty today (no forgot-password flow exists yet) — it simply renders its
// normal empty state, same as any other table with nothing to show.
import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating } from "/Shared/js/feature-guard.js";
import { initSalesDateFilter } from "/components/SalesDateFilter/SalesDateFilter.js";

initSidebar();
initQuickAccessPanel();
// Reveals this page's Section-gated elements (see this file's own data-permission attributes)
// once the session's real permission set resolves; every one of them ships `hidden` in the static
// HTML itself, so there's no flash of content this session doesn't hold permission for. Also
// drives which of the fetches below actually run — no point calling an endpoint the session was
// never going to be allowed to see the result of.
const permissionsPromise = applyPagePermissions();
// "2. Audit"'s Search bar/Date filter carry data-feature="feature:search-bar"/"feature:date-filter"
// (the same global Feature keys those widgets use everywhere else) — applyFeatureGating only ever
// ADDS `hidden` to the rare one a session had revoked, so it must run after permissions have
// revealed the section itself, same ordering every other page combining both gates already uses
// (see e.g. SecondarySalesPage.js's own permissionsPromise.then(() => applyFeatureGating())).
permissionsPromise.then(() => applyFeatureGating());

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}

// Backend sends a LocalDateTime ISO string with no timezone — parsed as local time, same as every
// other page's own date rendering assumes (see e.g. RolesPage.js's own formatDateTime).
function formatDateTime(value) {
    if (!value) {
        return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "—";
    }
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

function resultBadge(success) {
    return success
        ? '<span class="monitoring-badge success">Success</span>'
        : '<span class="monitoring-badge failure">Failure</span>';
}

function boolBadge(value, trueLabel, falseLabel) {
    return value
        ? `<span class="monitoring-badge info">${trueLabel}</span>`
        : `<span class="monitoring-badge neutral">${falseLabel}</span>`;
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

function renderRows(bodyId, colSpan, rows, rowHtml) {
    const body = document.getElementById(bodyId);
    if (!rows.length) {
        body.innerHTML = `<tr><td colspan="${colSpan}" class="monitoring-empty">No data yet.</td></tr>`;
        return;
    }
    body.innerHTML = rows.map(rowHtml).join("");
}

async function loadPasswordResetTokens() {
    const body = document.getElementById("passwordResetTokensBody");
    try {
        const rows = await fetchJson("/api/monitoring/password-reset-tokens");
        renderRows("passwordResetTokensBody", 5, rows, (r) => `
            <tr>
                <td>${r.tokenId}</td>
                <td>${escapeHtml(r.username ?? "—")}</td>
                <td>${boolBadge(r.used, "Used", "Unused")}</td>
                <td>${formatDateTime(r.createdAt)}</td>
                <td>${formatDateTime(r.expiresAt)}</td>
            </tr>`);
    } catch (error) {
        body.innerHTML = `<tr><td colspan="5" class="monitoring-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

async function loadOtps() {
    const body = document.getElementById("otpsBody");
    try {
        const rows = await fetchJson("/api/monitoring/otps");
        renderRows("otpsBody", 6, rows, (r) => `
            <tr>
                <td>${r.otpId}</td>
                <td>${escapeHtml(r.username ?? "—")}</td>
                <td>${escapeHtml(r.purpose)}</td>
                <td>${boolBadge(r.used, "Used", "Unused")}</td>
                <td>${formatDateTime(r.createdAt)}</td>
                <td>${formatDateTime(r.expiresAt)}</td>
            </tr>`);
    } catch (error) {
        body.innerHTML = `<tr><td colspan="6" class="monitoring-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

// ==================== 1. Usage Overview charts ====================
// Colors resolved from the app's own design tokens (variables.css), same "read the CSS custom
// property at render time, re-resolve on theme-changed" convention every other page's own
// ECharts instance uses (see e.g. PrimarySalesPage.js's resolveDailyTrendColors) — not a
// one-time read, so a theme switch after load repaints these with their last-loaded data instead
// of staying stuck on the wrong mode's colors until a full reload.
let AXIS_COLOR, GRID_LINE_COLOR, HOUR_BAR_COLOR, USER_BAR_COLOR, TOOLTIP_BG, TOOLTIP_BORDER, TOOLTIP_TEXT;
function resolveMonitoringChartColors() {
    const rootStyle = getComputedStyle(document.documentElement);
    AXIS_COLOR = rootStyle.getPropertyValue("--color-text-secondary").trim() || "#66756F";
    GRID_LINE_COLOR = rootStyle.getPropertyValue("--color-border").trim() || "#DCE7E2";
    HOUR_BAR_COLOR = rootStyle.getPropertyValue("--color-primary").trim() || "#1B4D3E";
    USER_BAR_COLOR = rootStyle.getPropertyValue("--color-info").trim() || "#2563EB";
    TOOLTIP_BG = rootStyle.getPropertyValue("--color-card-bg").trim() || "#FFFFFF";
    TOOLTIP_BORDER = rootStyle.getPropertyValue("--color-border").trim() || "#DCE7E2";
    TOOLTIP_TEXT = rootStyle.getPropertyValue("--color-text-primary").trim() || "#17221E";
}
resolveMonitoringChartColors();

let hourChart = null;
let userChart = null;
let lastUsageStats = null;

function tooltipStyle() {
    return {
        backgroundColor: TOOLTIP_BG,
        borderColor: TOOLTIP_BORDER,
        textStyle: { color: TOOLTIP_TEXT, fontSize: 11 },
    };
}

function renderHourChart(byHour) {
    const dom = document.getElementById("usageHourChart");
    if (!dom || typeof window.echarts === "undefined") {
        return;
    }
    if (!hourChart) {
        hourChart = window.echarts.init(dom);
    }
    hourChart.setOption({
        grid: { left: 36, right: 12, top: 16, bottom: 28 },
        xAxis: {
            type: "category",
            data: byHour.map((h) => `${String(h.hour).padStart(2, "0")}:00`),
            axisLabel: { color: AXIS_COLOR, fontSize: 9, interval: 1 },
            axisLine: { lineStyle: { color: GRID_LINE_COLOR } },
            axisTick: { show: false },
        },
        yAxis: {
            type: "value",
            minInterval: 1,
            axisLabel: { color: AXIS_COLOR, fontSize: 10 },
            splitLine: { lineStyle: { color: GRID_LINE_COLOR } },
        },
        tooltip: {
            trigger: "axis",
            ...tooltipStyle(),
            formatter: (params) => `${params[0].axisValueLabel}<br/>${params[0].value} login(s)`,
        },
        series: [{
            type: "bar",
            data: byHour.map((h) => h.count),
            itemStyle: { color: HOUR_BAR_COLOR, borderRadius: [3, 3, 0, 0] },
            barMaxWidth: 14,
        }],
    });
}

function renderUserChart(byUser) {
    const dom = document.getElementById("usageUserChart");
    if (!dom || typeof window.echarts === "undefined") {
        return;
    }
    if (!byUser.length) {
        dom.innerHTML = '<div class="monitoring-chart-empty">No login activity in the last 30 days.</div>';
        return;
    }
    if (!userChart) {
        userChart = window.echarts.init(dom);
    }
    // Most-active user on top — ECharts' own category axis draws bottom-up, so the list is
    // reversed once here rather than fighting that with inverse:true (which would also flip the
    // value axis's gridlines).
    const ordered = [...byUser].reverse();
    userChart.setOption({
        grid: { left: 90, right: 20, top: 8, bottom: 20 },
        xAxis: {
            type: "value",
            minInterval: 1,
            axisLabel: { color: AXIS_COLOR, fontSize: 10 },
            splitLine: { lineStyle: { color: GRID_LINE_COLOR } },
        },
        yAxis: {
            type: "category",
            data: ordered.map((u) => u.username),
            axisLabel: { color: AXIS_COLOR, fontSize: 10 },
            axisLine: { lineStyle: { color: GRID_LINE_COLOR } },
            axisTick: { show: false },
        },
        tooltip: {
            trigger: "axis",
            axisPointer: { type: "shadow" },
            ...tooltipStyle(),
            formatter: (params) => `${params[0].name}<br/>${params[0].value} login(s)`,
        },
        series: [{
            type: "bar",
            data: ordered.map((u) => u.count),
            itemStyle: { color: USER_BAR_COLOR, borderRadius: [0, 3, 3, 0] },
            barMaxWidth: 14,
        }],
    });
}

async function loadUsageStats() {
    try {
        lastUsageStats = await fetchJson("/api/monitoring/usage-stats");
        renderHourChart(lastUsageStats.byHour);
        renderUserChart(lastUsageStats.byUser);
    } catch (error) {
        const hourDom = document.getElementById("usageHourChart");
        const userDom = document.getElementById("usageUserChart");
        if (hourDom) hourDom.innerHTML = `<div class="monitoring-chart-empty">${escapeHtml(error.message)}</div>`;
        if (userDom) userDom.innerHTML = `<div class="monitoring-chart-empty">${escapeHtml(error.message)}</div>`;
    }
}

window.addEventListener("resize", () => {
    hourChart?.resize();
    userChart?.resize();
});
// Every chart on this page lives inside a Section that ships `hidden` by default (see
// data-permission="page:monitoring.login-attempts" in the HTML) until applyPagePermissions
// confirms the session holds it — a chart initialized while its container is display:none draws
// at 0x0, so it needs an explicit remeasure once revealed (same convention every other page's own
// ECharts instance uses — see e.g. Dashboard.js's own permissions-applied listener).
document.addEventListener("permissions-applied", () => {
    hourChart?.resize();
    userChart?.resize();
});
window.addEventListener("theme-changed", () => {
    resolveMonitoringChartColors();
    if (lastUsageStats) {
        renderHourChart(lastUsageStats.byHour);
        renderUserChart(lastUsageStats.byUser);
    }
});

// ==================== 2. Audit ====================
// One Type/Status/Search/Date-filtered table standing in for what used to be 4 separate always-
// visible "Attempts" sections — Type picks which of MonitoringController's own 4 (still separately
// permissioned, see this file's own header comment) attempt endpoints to read, Status/Search/Date
// all filter client-side over whatever that endpoint returns (each already carries all 300 of its
// own capped rows, so no new paginated/filtered backend endpoint was needed just for this). Status
// only applies to the 3 types that actually have a success/failure outcome (login/download/upload)
// — Unauthorized Login is, by definition, always blocked, so its own Result column shows the real
// block reason text instead of a badge, and the Status toggle is simply ignored while that type is
// selected.
const AUDIT_TYPE_CONFIG = {
    login: {
        endpoint: "/api/monitoring/login-attempts",
        columns: ["Username", "User ID", "Result", "IP Address", "Timestamp"],
        hasStatus: true,
        row: (r) => [
            escapeHtml(r.username),
            r.userId ?? "—",
            resultBadge(r.success),
            escapeHtml(r.ipAddress ?? "—"),
            formatDateTime(r.attemptedAt),
        ],
    },
    unauthorized: {
        endpoint: "/api/monitoring/unauthorized-attempts",
        columns: ["Username", "User ID", "Result", "Page", "IP Address", "Timestamp"],
        hasStatus: false,
        row: (r) => [
            escapeHtml(r.username),
            r.userId ?? "—",
            `<span class="monitoring-reason">${r.reason ? escapeHtml(r.reason) : "—"}</span>`,
            escapeHtml(r.resource ?? "—"),
            escapeHtml(r.ipAddress ?? "—"),
            formatDateTime(r.attemptedAt),
        ],
    },
    download: {
        endpoint: "/api/monitoring/download-attempts",
        columns: ["Username", "User ID", "Result", "File Name", "IP Address", "Timestamp"],
        hasStatus: true,
        row: (r) => [
            escapeHtml(r.username),
            r.userId ?? "—",
            resultBadge(r.success),
            escapeHtml(r.fileName),
            escapeHtml(r.ipAddress ?? "—"),
            formatDateTime(r.attemptedAt),
        ],
    },
    upload: {
        endpoint: "/api/monitoring/upload-attempts",
        columns: ["Username", "User ID", "Result", "File Name", "Table", "IP Address", "Timestamp"],
        hasStatus: true,
        row: (r) => [
            escapeHtml(r.username),
            r.userId ?? "—",
            resultBadge(r.success),
            escapeHtml(r.fileName),
            escapeHtml(r.tableKey ?? "—"),
            escapeHtml(r.ipAddress ?? "—"),
            formatDateTime(r.attemptedAt),
        ],
    },
};

const auditFilters = { type: "login", status: "success", search: "", from: null, to: null };

function filterAuditRows(config, rows) {
    let filtered = rows;
    if (config.hasStatus) {
        const wantSuccess = auditFilters.status === "success";
        filtered = filtered.filter((r) => Boolean(r.success) === wantSuccess);
    }
    if (auditFilters.search) {
        const needle = auditFilters.search.toLowerCase();
        filtered = filtered.filter((r) => (r.username || "").toLowerCase().includes(needle));
    }
    if (auditFilters.from || auditFilters.to) {
        filtered = filtered.filter((r) => {
            if (!r.attemptedAt) {
                return false;
            }
            const day = r.attemptedAt.slice(0, 10);
            if (auditFilters.from && day < auditFilters.from) {
                return false;
            }
            if (auditFilters.to && day > auditFilters.to) {
                return false;
            }
            return true;
        });
    }
    return filtered;
}

function renderAuditHead(type) {
    document.getElementById("auditTableHead").innerHTML =
        `<tr>${AUDIT_TYPE_CONFIG[type].columns.map((c) => `<th>${c}</th>`).join("")}</tr>`;
}

function renderAuditBody(type, rows) {
    const config = AUDIT_TYPE_CONFIG[type];
    const body = document.getElementById("auditTableBody");
    if (!rows.length) {
        body.innerHTML = `<tr><td colspan="${config.columns.length}" class="monitoring-empty">No data yet.</td></tr>`;
        return;
    }
    body.innerHTML = rows.map((r) => `<tr>${config.row(r).map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
}

async function loadAuditRows() {
    const type = auditFilters.type;
    const config = AUDIT_TYPE_CONFIG[type];
    renderAuditHead(type);
    const body = document.getElementById("auditTableBody");
    body.innerHTML = `<tr><td colspan="${config.columns.length}" class="monitoring-empty">Loading…</td></tr>`;
    try {
        const rows = await fetchJson(config.endpoint);
        renderAuditBody(type, filterAuditRows(config, rows));
    } catch (error) {
        body.innerHTML = `<tr><td colspan="${config.columns.length}" class="monitoring-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

function wireAuditHeader() {
    const typeSelect = document.getElementById("auditTypeSelect");
    const statusToggle = document.getElementById("auditStatusToggle");
    const searchInput = document.getElementById("auditSearchInput");
    if (!typeSelect || !statusToggle || !searchInput) {
        return;
    }

    typeSelect.addEventListener("change", () => {
        auditFilters.type = typeSelect.value;
        loadAuditRows();
    });

    statusToggle.querySelectorAll(".monitoring-audit-status-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            statusToggle.querySelectorAll(".monitoring-audit-status-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            auditFilters.status = btn.dataset.status;
            loadAuditRows();
        });
    });

    let searchDebounce;
    searchInput.addEventListener("input", () => {
        auditFilters.search = searchInput.value.trim();
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(loadAuditRows, 300);
    });

    // Same widget/idPrefix convention as SecondarySalesPage.js's own "1. Overview" date filter
    // (initSalesDateFilter, imported above) — see SalesDateFilter.js for what each mode reports.
    // from/to arrive as plain "YYYY-MM-DD" strings (or null/null once cleared), matching the same
    // slice(0, 10) comparison filterAuditRows does against each row's own attemptedAt.
    initSalesDateFilter({
        idPrefix: "auditDateFilter",
        onFilterChange: (column, from, to) => {
            auditFilters.from = from;
            auditFilters.to = to;
            loadAuditRows();
        },
    });

    loadAuditRows();
}

// ==================== Page wiring ====================
// Each section only fetches once the session's real permission set confirms it can actually see
// that section — matches the sidebar/other pages' own "don't fetch what you can't show" rule.
permissionsPromise.then((permissions) => {
    if (permissions.has("page:monitoring.login-attempts")) {
        loadUsageStats();
    }
    if (permissions.has("page:monitoring.password-reset-tokens")) {
        loadPasswordResetTokens();
    }
    if (permissions.has("page:monitoring.otps")) {
        loadOtps();
    }
    if (permissions.has("page:monitoring.audit")) {
        wireAuditHeader();
    }
});
