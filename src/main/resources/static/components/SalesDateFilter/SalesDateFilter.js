import { hasFeatureSync } from "/Shared/js/feature-guard.js";

export function initSalesDateFilter(options = {}) {
    const {
        column = "salesDate",
        yearsApiUrl,
        onFilterChange,
        idPrefix = "salesDateFilter",
        monthDefaultMode = "current",
    } = options;

    const modeToggle = document.getElementById(`${idPrefix}ModeToggle`);
    const body = document.getElementById(`${idPrefix}Body`);
    const clearBtn = document.getElementById(`${idPrefix}ClearBtn`);

    if (!modeToggle || !body || !clearBtn || !onFilterChange) {
        return;
    }
    if (!hasFeatureSync("feature:date-filter")) {
        return;
    }

    const thisYear = new Date().getFullYear();
    let years = [thisYear];
    let mode = null;
    let rangeType = "month";

    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    function lastDayOfMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    function yearOptionsHtml(selected) {
        return years.map((y) => `<option value="${y}"${y === selected ? " selected" : ""}>${y}</option>`).join("");
    }

    function setActiveModeBtn() {
        modeToggle.querySelectorAll(".sales-date-filter-mode-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.mode === mode);
        });
        clearBtn.hidden = mode === null;
    }

    function renderRangeInputs() {
        const wrap = document.getElementById(`${idPrefix}RangeInputs`);
        if (rangeType === "date") {
            const today = new Date();
            const monthStartIso = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-01`;
            const monthEndIso = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(lastDayOfMonth(today.getFullYear(), today.getMonth() + 1))}`;
            wrap.innerHTML = `
                <input type="date" class="sales-date-filter-input" id="${idPrefix}From" value="${monthStartIso}">
                <span class="sales-date-filter-range-sep">to</span>
                <input type="date" class="sales-date-filter-input" id="${idPrefix}To" value="${monthEndIso}">
            `;
            const fromInput = document.getElementById(`${idPrefix}From`);
            const toInput = document.getElementById(`${idPrefix}To`);
            const trigger = () => {
                if (!fromInput.value || !toInput.value) {
                    return;
                }
                const [from, to] = fromInput.value <= toInput.value
                    ? [fromInput.value, toInput.value]
                    : [toInput.value, fromInput.value];
                onFilterChange(column, from, to, { mode: "filter", rangeType: "date" });
            };
            fromInput.addEventListener("change", trigger);
            toInput.addEventListener("change", trigger);
            trigger();
        } else if (rangeType === "year") {
            wrap.innerHTML = `
                <select class="sales-date-filter-input" id="${idPrefix}FromYear">${yearOptionsHtml(years[0])}</select>
                <span class="sales-date-filter-range-sep">to</span>
                <select class="sales-date-filter-input" id="${idPrefix}ToYear">${yearOptionsHtml(thisYear)}</select>
            `;
            const fromSelect = document.getElementById(`${idPrefix}FromYear`);
            const toSelect = document.getElementById(`${idPrefix}ToYear`);
            const trigger = () => {
                const from = Number(fromSelect.value);
                const to = Number(toSelect.value);
                const [lo, hi] = from <= to ? [from, to] : [to, from];
                onFilterChange(column, `${lo}-01-01`, `${hi}-12-31`, { mode: "filter", rangeType: "year" });
            };
            fromSelect.addEventListener("change", trigger);
            toSelect.addEventListener("change", trigger);
            trigger();
        } else {
            const now = new Date();
            const currentMonthValue = `${thisYear}-${pad2(now.getMonth() + 1)}`;
            const defaultFromMonthValue = monthDefaultMode === "year" ? `${thisYear}-01` : currentMonthValue;
            const defaultToMonthValue = monthDefaultMode === "year" ? `${thisYear}-12` : currentMonthValue;
            wrap.innerHTML = `
                <input type="month" class="sales-date-filter-input" id="${idPrefix}FromMonth" value="${defaultFromMonthValue}">
                <span class="sales-date-filter-range-sep">to</span>
                <input type="month" class="sales-date-filter-input" id="${idPrefix}ToMonth" value="${defaultToMonthValue}">
            `;
            const fromInput = document.getElementById(`${idPrefix}FromMonth`);
            const toInput = document.getElementById(`${idPrefix}ToMonth`);
            const trigger = () => {
                if (!fromInput.value || !toInput.value) {
                    return;
                }
                const [fy, fm] = fromInput.value.split("-").map(Number);
                const [ty, tm] = toInput.value.split("-").map(Number);
                const [startY, startM, endY, endM] = (fy * 12 + fm) <= (ty * 12 + tm)
                    ? [fy, fm, ty, tm]
                    : [ty, tm, fy, fm];
                const from = `${startY}-${pad2(startM)}-01`;
                const to = `${endY}-${pad2(endM)}-${pad2(lastDayOfMonth(endY, endM))}`;
                onFilterChange(column, from, to, { mode: "filter", rangeType: "month" });
            };
            fromInput.addEventListener("change", trigger);
            toInput.addEventListener("change", trigger);
            trigger();
        }
    }

    function renderFilter() {
        body.innerHTML = `
            <div class="sales-date-filter-range-type" id="${idPrefix}RangeType">
                <button type="button" class="sales-date-filter-range-type-btn" data-range-type="date">By Date</button>
                <button type="button" class="sales-date-filter-range-type-btn" data-range-type="month">By Month</button>
                <button type="button" class="sales-date-filter-range-type-btn" data-range-type="year">By Year</button>
            </div>
            <div class="sales-date-filter-range-inputs" id="${idPrefix}RangeInputs"></div>
        `;
        document.getElementById(`${idPrefix}RangeType`).querySelectorAll(".sales-date-filter-range-type-btn").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.rangeType === rangeType);
            btn.addEventListener("click", () => {
                if (btn.dataset.rangeType === rangeType) {
                    return;
                }
                btn.parentElement.querySelectorAll(".sales-date-filter-range-type-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                rangeType = btn.dataset.rangeType;
                renderRangeInputs();
            });
        });
        renderRangeInputs();
    }

    function renderBody() {
        if (mode === "filter") {
            renderFilter();
        } else {
            body.innerHTML = "";
            onFilterChange(null, null, null, { mode: null });
        }
        setActiveModeBtn();
    }

    modeToggle.querySelectorAll(".sales-date-filter-mode-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            mode = mode === btn.dataset.mode ? null : btn.dataset.mode;
            renderBody();
        });
    });

    clearBtn.addEventListener("click", () => {
        mode = null;
        renderBody();
    });

    if (yearsApiUrl) {
        fetch(yearsApiUrl)
            .then((response) => (response.ok ? response.json() : []))
            .then((fetchedYears) => {
                if (fetchedYears && fetchedYears.length) {
                    years = fetchedYears;
                }
            })
            .catch(() => {});
    }

    renderBody();
}


export function initInsightsDateFilter(options = {}) {
    const {
        column = "salesDate",
        onFilterChange,
        idPrefix = "salesDateFilter",
    } = options;

    const modeToggle = document.getElementById(`${idPrefix}ModeToggle`);
    const body = document.getElementById(`${idPrefix}Body`);
    const clearBtn = document.getElementById(`${idPrefix}ClearBtn`);

    if (!modeToggle || !body || !clearBtn || !onFilterChange) {
        return;
    }
    if (!hasFeatureSync("feature:date-filter")) {
        return;
    }

    const thisYear = new Date().getFullYear();
    let mode = null;

    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    function lastDayOfMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    function setActiveButtons() {
        modeToggle.querySelectorAll(".sales-date-filter-mode-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.mode === mode);
        });
        clearBtn.hidden = mode === null;
    }

    function renderRangeInputs(wrap) {
        const now = new Date();
        const currentMonthValue = `${thisYear}-${pad2(now.getMonth() + 1)}`;
        wrap.innerHTML = `
            <input type="month" class="sales-date-filter-input" id="${idPrefix}FromMonth" value="${currentMonthValue}">
            <span class="sales-date-filter-range-sep">to</span>
            <input type="month" class="sales-date-filter-input" id="${idPrefix}ToMonth" value="${currentMonthValue}">
        `;
        const fromInput = document.getElementById(`${idPrefix}FromMonth`);
        const toInput = document.getElementById(`${idPrefix}ToMonth`);
        const trigger = () => {
            if (!fromInput.value || !toInput.value) {
                return;
            }
            const [fy, fm] = fromInput.value.split("-").map(Number);
            const [ty, tm] = toInput.value.split("-").map(Number);
            const [startY, startM, endY, endM] = (fy * 12 + fm) <= (ty * 12 + tm)
                ? [fy, fm, ty, tm]
                : [ty, tm, fy, fm];

            const today = new Date();
            const currentOrdinal = today.getFullYear() * 12 + today.getMonth();
            const includesCurrentMonth = (endY * 12 + (endM - 1)) >= currentOrdinal;
            const startsInCurrentMonth = (startY * 12 + (startM - 1)) >= currentOrdinal;

            const from = `${startY}-${pad2(startM)}-01`;

            const to = `${endY}-${pad2(endM)}-${pad2(lastDayOfMonth(endY, endM))}`;
            onFilterChange(column, from, to, { mode: "filter", includesCurrentMonth, startsInCurrentMonth });
        };
        fromInput.addEventListener("change", trigger);
        toInput.addEventListener("change", trigger);
        trigger();
    }

    function renderPanel() {
        if (mode === "filter") {
            body.innerHTML = `<div class="sales-date-filter-range-inputs" id="${idPrefix}RangeInputs"></div>`;
            renderRangeInputs(document.getElementById(`${idPrefix}RangeInputs`));
        } else {
            body.innerHTML = "";
            onFilterChange(null, null, null, { mode: null });
        }
        setActiveButtons();
    }

    modeToggle.querySelectorAll(".sales-date-filter-mode-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            mode = mode === btn.dataset.mode ? null : btn.dataset.mode;
            renderPanel();
        });
    });

    clearBtn.addEventListener("click", () => {
        mode = null;
        renderPanel();
    });

    renderPanel();
}
