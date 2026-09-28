import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { initTableList, initTableInfoPanel } from "/components/TableList/TableList.js";
import { triggerUrlDownload } from "/components/TemplateDownload/TemplateDownload.js";
import { initSearchBar } from "/components/SearchBar/SearchBar.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating } from "/Shared/js/feature-guard.js";


async function initDatabaseInfo() {
    const statusEl = document.getElementById("dbConnectionStatus");

    if (!statusEl) {
        return;
    }

    const statusTextEl = statusEl.querySelector(".status-text");

    function render(connected) {
        statusEl.classList.remove("connected", "disconnected");
        statusEl.classList.add(connected ? "connected" : "disconnected");
        statusTextEl.textContent = connected ? "Connected" : "Disconnected";
    }

    try {
        const response = await fetch("/api/database/connection");
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        const data = await response.json();
        render(data.status === "connected");
    } catch (error) {
        render(false);
    }
}


const MONTH_FILTERED_TABLES = new Set(["primary_sales", "secondary_sales"]);
const MONTH_FILTER_DATE_COLUMN = "Sales_Date";

function isMonthFilteredTable(tableName) {
    return !!tableName && MONTH_FILTERED_TABLES.has(tableName.toLowerCase());
}


function monthRange(year, month) {
    const pad = (n) => String(n).padStart(2, "0");
    const from = `${year}-${pad(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${pad(month)}-${pad(lastDay)}`;
    return { from, to };
}

function currentMonthRange() {
    const now = new Date();
    return monthRange(now.getFullYear(), now.getMonth() + 1);
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december"];


function matchMonthName(token) {
    const lower = token.toLowerCase();
    if (lower.length < 3) {
        return -1;
    }
    const index = MONTH_NAMES.findIndex((name) => name.startsWith(lower));
    return index === -1 ? -1 : index + 1;
}


function parseMonthQuery(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }

    let match = trimmed.match(/^(\d{4})[-/](\d{1,2})$/);
    if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        return month >= 1 && month <= 12 ? monthRange(year, month) : null;
    }

    match = trimmed.match(/^(\d{1,2})[-/](\d{4})$/);
    if (match) {
        const month = Number(match[1]);
        const year = Number(match[2]);
        return month >= 1 && month <= 12 ? monthRange(year, month) : null;
    }

    match = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (match) {
        const month = matchMonthName(match[1]);
        const year = Number(match[2]);
        return month === -1 ? null : monthRange(year, month);
    }

    match = trimmed.match(/^(\d{4})\s+([A-Za-z]+)$/);
    if (match) {
        const year = Number(match[1]);
        const month = matchMonthName(match[2]);
        return month === -1 ? null : monthRange(year, month);
    }

    return null;
}


function initTableData(options = {}) {
    const { onChange } = options;
    const section = document.getElementById("tableDataSection");
    const title = document.getElementById("tableDataTitle");
    const searchInput = document.getElementById("tableDataSearch");
    const head = document.getElementById("tableDataHead");
    const body = document.getElementById("tableDataBody");
    const pagination = document.getElementById("tableDataPagination");
    const message = document.getElementById("tableDataMessage");
    const downloadBtn = document.getElementById("tableDataDownloadBtn");
    const downloadPanel = document.getElementById("tableDataDownloadPanel");
    const downloadRangeInputs = document.getElementById("downloadRangeInputs");
    const downloadRangeStart = document.getElementById("downloadRangeStart");
    const downloadRangeEnd = document.getElementById("downloadRangeEnd");
    const downloadSubmitBtn = document.getElementById("downloadSubmitBtn");
    const downloadScopeDate = document.getElementById("downloadScopeDate");
    const downloadScopeDateHint = document.getElementById("downloadScopeDateHint");
    const downloadDateInputs = document.getElementById("downloadDateInputs");
    const downloadDateColumnGroup = document.getElementById("downloadDateColumnGroup");
    const downloadDateColumnSelect = document.getElementById("downloadDateColumnSelect");
    const downloadDateSingleHint = document.getElementById("downloadDateSingleHint");
    const downloadDateFrom = document.getElementById("downloadDateFrom");
    const downloadDateTo = document.getElementById("downloadDateTo");
    const downloadDateError = document.getElementById("downloadDateError");
    const menuBtn = document.getElementById("tableDataMenuBtn");
    const menuPanel = document.getElementById("tableDataMenuPanel");
    const menuTemplateBtn = document.getElementById("menuTemplateBtn");
    const menuEditBtn = document.getElementById("menuEditBtn");
    const menuEditBtnLabel = document.getElementById("menuEditBtnLabel");
    const refreshBtn = document.getElementById("tableDataRefreshBtn");

    if (!section) {
        return { loadTable() {} };
    }

    const state = {
        tableName: null,
        page: 0,
        size: 50,
        sortColumn: null,
        sortDir: "asc",
        search: "",
        totalRows: 0,
        editMode: false,
        lastData: null,
        dateColumns: [],
        dateColumn: null,
        dateFrom: null,
        dateTo: null,
    };

    let messageTimeout = null;

    let requestSeq = 0;
    let isLoading = false;

    function showMessage(text, isError) {
        clearTimeout(messageTimeout);
        message.textContent = text;
        message.className = "table-data-message " + (isError ? "error" : "success");
        messageTimeout = setTimeout(() => {
            message.className = "table-data-message";
        }, isError ? 5000 : 2500);
    }

    function createIconButton(iconClass, title, className) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = className;
        btn.title = title;
        const icon = document.createElement("i");
        icon.className = iconClass;
        btn.appendChild(icon);
        return btn;
    }


    function formatDateValue(value) {
        const str = String(value);
        const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/);
        if (!match) {
            return str;
        }
        const [, year, month, day, hour, minute, second] = match;
        const datePart = `${day}-${month}-${year}`;
        const hasTime = hour !== undefined && !(hour === "00" && minute === "00" && second === "00");
        return hasTime ? `${datePart} ${hour}:${minute}:${second}` : datePart;
    }


    function formatValue(value, col) {
        if (value === null || value === undefined) {
            return "—";
        }
        if (col && state.dateColumns.includes(col)) {
            return formatDateValue(value);
        }
        return String(value);
    }

    function emptyRow(text, colspan) {
        body.replaceChildren();
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.className = "table-data-empty";
        if (colspan) {
            td.colSpan = colspan;
        }
        td.textContent = text;
        tr.appendChild(td);
        body.appendChild(tr);
    }


    function setLoading() {
        emptyRow("Loading…");
        pagination.querySelectorAll("button").forEach((btn) => {
            btn.disabled = true;
        });
    }

    function renderError(text) {
        head.replaceChildren();
        emptyRow(text);
        pagination.replaceChildren();
    }


    function buildHeader(columns, sortableColumns, hasActionsColumn) {
        head.replaceChildren();
        const tr = document.createElement("tr");

        columns.forEach((col) => {
            const th = document.createElement("th");
            const wrap = document.createElement("span");
            wrap.className = "th-content";

            const label = document.createElement("span");
            label.textContent = col;
            wrap.appendChild(label);

            th.appendChild(wrap);
            tr.appendChild(th);
        });

        if (hasActionsColumn) {
            const th = document.createElement("th");
            th.textContent = "Action";
            th.className = "table-data-actions-header";
            tr.appendChild(th);
        }

        head.appendChild(tr);
    }


    function buildRow(columns, primaryKeyColumns, computedColumns, row, editable) {
        const tr = document.createElement("tr");
        const cellRefs = {};
        const isEditableColumn = (col) => !primaryKeyColumns.includes(col) && !computedColumns.includes(col);

        columns.forEach((col) => {
            const td = document.createElement("td");
            td.textContent = formatValue(row[col], col);
            tr.appendChild(td);
            cellRefs[col] = { td, value: row[col] };
        });

        if (!editable) {
            return tr;
        }

        const actionsTd = document.createElement("td");
        actionsTd.className = "table-data-actions-cell";
        tr.appendChild(actionsTd);

        function renderViewActions() {
            actionsTd.replaceChildren();
            const editBtn = createIconButton("bi bi-pencil", "Edit row", "row-action-btn row-edit-btn");
            editBtn.addEventListener("click", enterEdit);
            const deleteBtn = createIconButton("bi bi-trash", "Delete row", "row-action-btn row-delete-btn");
            deleteBtn.addEventListener("click", deleteRow);
            actionsTd.append(editBtn, deleteBtn);
        }

        function renderEditActions(saving) {
            actionsTd.replaceChildren();
            const saveBtn = createIconButton("bi bi-check-lg", "Save changes", "row-action-btn row-save-btn");
            saveBtn.disabled = saving;
            saveBtn.addEventListener("click", saveEdit);
            const cancelBtn = createIconButton("bi bi-x-lg", "Cancel", "row-action-btn row-cancel-btn");
            cancelBtn.disabled = saving;
            cancelBtn.addEventListener("click", () => cancelEdit());
            actionsTd.append(saveBtn, cancelBtn);
        }

        function enterEdit() {
            columns.forEach((col) => {
                if (!isEditableColumn(col)) {
                    return;
                }
                const ref = cellRefs[col];
                const input = document.createElement("input");
                input.type = "text";
                input.className = "cell-edit-input";
                input.value = ref.value === null || ref.value === undefined ? "" : String(ref.value);
                ref.td.replaceChildren(input);
                ref.input = input;
            });
            renderEditActions(false);
        }

        function cancelEdit() {
            columns.forEach((col) => {
                const ref = cellRefs[col];
                ref.td.textContent = formatValue(ref.value, col);
                ref.input = null;
            });
            renderViewActions();
        }


        async function saveEdit() {
            const keys = {};
            primaryKeyColumns.forEach((col) => {
                keys[col] = cellRefs[col].value;
            });

            const originalRow = {};
            columns.forEach((col) => {
                originalRow[col] = cellRefs[col].value;
            });

            const values = {};
            columns.forEach((col) => {
                if (!isEditableColumn(col)) {
                    return;
                }
                const raw = cellRefs[col].input.value;
                values[col] = raw.trim() === "" ? null : raw;
            });

            renderEditActions(true);

            try {
                const response = await fetch(`/api/database/tables/${encodeURIComponent(state.tableName)}/rows`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ keys, originalRow, values }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.message || `Request failed with status ${response.status}`);
                }
                showMessage("Row updated successfully.", false);
                load();
                if (onChange) {
                    onChange();
                }
            } catch (error) {
                showMessage(error.message || "Unable to update row.", true);
                renderEditActions(false);
            }
        }

        async function deleteRow() {
            if (!window.confirm("Delete this row? This can be undone from Log History until committed.")) {
                return;
            }

            const keys = {};
            primaryKeyColumns.forEach((col) => {
                keys[col] = cellRefs[col].value;
            });

            const originalRow = {};
            columns.forEach((col) => {
                originalRow[col] = cellRefs[col].value;
            });

            const buttons = actionsTd.querySelectorAll(".row-action-btn");
            buttons.forEach((btn) => { btn.disabled = true; });

            try {
                const response = await fetch(`/api/database/tables/${encodeURIComponent(state.tableName)}/rows`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ keys, originalRow }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.message || `Request failed with status ${response.status}`);
                }
                showMessage("Row deleted.", false);
                load();
                if (onChange) {
                    onChange();
                }
            } catch (error) {
                showMessage(error.message || "Unable to delete row.", true);
                buttons.forEach((btn) => { btn.disabled = false; });
            }
        }

        renderViewActions();

        return tr;
    }

    function buildRows(columns, primaryKeyColumns, computedColumns, rows, editable) {
        const totalCols = columns.length + (editable ? 1 : 0);
        if (!rows.length) {
            emptyRow("No matching rows found.", totalCols);
            return;
        }
        body.replaceChildren(...rows.map((row) => buildRow(columns, primaryKeyColumns, computedColumns, row, editable)));
    }


    function buildPagination(totalRows) {
        pagination.replaceChildren();

        const totalPages = Math.max(1, Math.ceil(totalRows / state.size));
        const currentPage = state.page + 1;

        const info = document.createElement("span");
        info.className = "pagination-info";
        info.textContent = totalRows === 0
            ? "0 rows"
            : `Showing ${state.page * state.size + 1}–${Math.min(totalRows, (state.page + 1) * state.size)} of ${totalRows} rows`;

        const controls = document.createElement("div");
        controls.className = "pagination-controls";

        const prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.append(Object.assign(document.createElement("i"), { className: "bi bi-chevron-left" }), document.createTextNode(" Prev"));
        prevBtn.disabled = state.page <= 0;
        prevBtn.addEventListener("click", () => {
            if (state.page > 0) {
                state.page -= 1;
                load();
            }
        });

        const pageLabel = document.createElement("span");
        pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;

        const nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.append(document.createTextNode("Next "), Object.assign(document.createElement("i"), { className: "bi bi-chevron-right" }));
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.addEventListener("click", () => {
            if (currentPage < totalPages) {
                state.page += 1;
                load();
            }
        });

        controls.append(prevBtn, pageLabel, nextBtn);
        pagination.append(info, controls);
    }


    function updateDownloadDateOptionUi() {
        const hasDateColumns = state.dateColumns.length > 0;
        downloadScopeDate.disabled = !hasDateColumns;
        downloadScopeDateHint.hidden = hasDateColumns;
        if (!hasDateColumns && downloadScopeDate.checked) {
            document.querySelector('input[name="downloadScope"][value="range"]').checked = true;
            downloadRangeInputs.hidden = false;
            downloadDateInputs.hidden = true;
        }

        downloadDateColumnGroup.hidden = state.dateColumns.length <= 1;
        const previousSelection = downloadDateColumnSelect.value;
        downloadDateColumnSelect.replaceChildren(...state.dateColumns.map((col) => {
            const option = document.createElement("option");
            option.value = col;
            option.textContent = col;
            return option;
        }));
        if (state.dateColumns.includes(previousSelection)) {
            downloadDateColumnSelect.value = previousSelection;
        }

        downloadDateSingleHint.hidden = state.dateColumns.length !== 1;
        if (state.dateColumns.length === 1) {
            downloadDateSingleHint.replaceChildren(
                document.createTextNode("Filtering on "),
                Object.assign(document.createElement("strong"), { textContent: state.dateColumns[0] })
            );
        }
    }

    function updateEditToggleUi() {
        if (!menuEditBtn) {
            return;
        }
        menuEditBtn.disabled = !state.lastData;
        menuEditBtnLabel.textContent = state.editMode ? "Done Editing" : "Edit Rows";
        menuEditBtn.querySelector("i").className = state.editMode ? "bi bi-check2-square" : "bi bi-pencil-square";
        menuEditBtn.classList.toggle("menu-panel-item-active", state.editMode);
    }


    function renderCurrentData() {
        const data = state.lastData;
        if (!data) {
            return;
        }
        const primaryKeyColumns = data.primaryKeyColumns || [];
        const computedColumns = data.computedColumns || [];
        const editable = state.editMode;

        const rowCount = data.totalRows ?? 0;

        const nameSpan = document.createElement("span");
        nameSpan.className = "table-data-title-name";
        nameSpan.textContent = state.tableName;

        const countBadge = document.createElement("span");
        countBadge.className = "table-data-row-badge";
        countBadge.textContent = `${rowCount.toLocaleString()} Row${rowCount === 1 ? "" : "s"}`;

        title.replaceChildren(
            document.createTextNode("Table Data — "),
            nameSpan,
            document.createTextNode(" "),
            countBadge
        );

        buildHeader(data.columns, data.sortableColumns || [], editable);
        buildRows(data.columns, primaryKeyColumns, computedColumns, data.rows, editable);
        buildPagination(data.totalRows);
        updateEditToggleUi();
    }


    async function load() {
        if (!state.tableName) {
            return;
        }
        const requestId = ++requestSeq;
        isLoading = true;
        setLoading();

        const params = new URLSearchParams({
            page: String(state.page),
            size: String(state.size),
            sortDir: state.sortDir,
        });
        if (state.search) {
            params.set("search", state.search);
        }
        if (state.sortColumn) {
            params.set("sortColumn", state.sortColumn);
        }
        if (state.dateColumn && state.dateFrom && state.dateTo) {
            params.set("dateColumn", state.dateColumn);
            params.set("dateFrom", state.dateFrom);
            params.set("dateTo", state.dateTo);
        }

        try {
            const response = await fetch(`/api/database/tables/${encodeURIComponent(state.tableName)}/data?${params}`);
            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }
            const data = await response.json();
            if (requestId !== requestSeq) {
                return;
            }

            state.sortColumn = data.sortColumn;
            state.sortDir = data.sortDir;
            state.totalRows = data.totalRows;
            state.lastData = data;
            state.dateColumns = data.dateColumns || [];

            renderCurrentData();
            updateDownloadDateOptionUi();

            downloadRangeEnd.max = String(data.totalRows);
            downloadRangeEnd.value = String(data.totalRows);
            downloadRangeStart.max = String(data.totalRows);
        } catch (error) {
            if (requestId !== requestSeq) {
                return;
            }
            renderError("Unable to load table data.");
        } finally {
            if (requestId === requestSeq) {
                isLoading = false;
            }
        }
    }


    function loadTable(tableName) {
        state.tableName = tableName;
        state.page = 0;
        state.sortColumn = null;
        state.sortDir = "asc";
        state.search = "";
        state.editMode = false;
        state.lastData = null;
        state.dateColumns = [];

        if (isMonthFilteredTable(tableName)) {
            const { from, to } = currentMonthRange();
            state.dateColumn = MONTH_FILTER_DATE_COLUMN;
            state.dateFrom = from;
            state.dateTo = to;
            searchInput.placeholder = "Search month… e.g. 2026-09 or September 2026";
        } else {
            state.dateColumn = null;
            state.dateFrom = null;
            state.dateTo = null;
            searchInput.placeholder = "Search…";
        }
        searchInput.value = "";
        searchInput.disabled = false;
        message.className = "table-data-message";

        downloadBtn.disabled = false;
        downloadPanel.hidden = true;
        document.querySelector('input[name="downloadFormat"][value="csv"]').checked = true;
        document.querySelector('input[name="downloadScope"][value="range"]').checked = true;
        downloadRangeInputs.hidden = false;
        downloadRangeStart.value = "1";
        downloadScopeDate.disabled = true;
        downloadDateInputs.hidden = true;
        downloadDateFrom.value = "";
        downloadDateFrom.removeAttribute("max");
        downloadDateTo.value = "";
        downloadDateTo.removeAttribute("min");
        downloadDateError.hidden = true;

        menuBtn.disabled = false;
        menuPanel.hidden = true;
        updateEditToggleUi();

        refreshBtn.disabled = false;

        load();
    }

    initSearchBar({
        inputId: "tableDataSearch",
        debounceMs: 300,
        onQuery: (term) => {

            if (isMonthFilteredTable(state.tableName)) {
                state.search = "";
                if (!term) {
                    const { from, to } = currentMonthRange();
                    state.dateColumn = MONTH_FILTER_DATE_COLUMN;
                    state.dateFrom = from;
                    state.dateTo = to;
                } else {
                    const range = parseMonthQuery(term);
                    if (!range) {
                        showMessage("Enter a month, e.g. \"2026-09\" or \"September 2026\".", true);
                        return;
                    }
                    state.dateColumn = MONTH_FILTER_DATE_COLUMN;
                    state.dateFrom = range.from;
                    state.dateTo = range.to;
                }
            } else {
                state.search = term;
            }
            state.page = 0;
            load();
        },
    });

    downloadBtn.addEventListener("click", () => {
        downloadPanel.hidden = !downloadPanel.hidden;
    });

    menuBtn.addEventListener("click", () => {
        menuPanel.hidden = !menuPanel.hidden;
    });

    document.addEventListener("click", (event) => {
        if (!downloadPanel.hidden && !event.target.closest(".table-data-download")) {
            downloadPanel.hidden = true;
        }
        if (!menuPanel.hidden && !event.target.closest(".table-data-menu")) {
            menuPanel.hidden = true;
        }
    });


    document.querySelectorAll('input[name="downloadScope"]').forEach((radio) => {
        radio.addEventListener("change", () => {
            const scope = document.querySelector('input[name="downloadScope"]:checked').value;
            downloadRangeInputs.hidden = scope !== "range";
            downloadDateInputs.hidden = scope !== "date";
            downloadDateError.hidden = true;
        });
    });


    downloadDateFrom.addEventListener("change", () => {
        downloadDateTo.min = downloadDateFrom.value || "";
        downloadDateError.hidden = true;
    });
    downloadDateTo.addEventListener("change", () => {
        downloadDateFrom.max = downloadDateTo.value || "";
        downloadDateError.hidden = true;
    });

    async function triggerDownload(url, filenameFallback) {
        try {
            await triggerUrlDownload(url, filenameFallback);
            downloadPanel.hidden = true;
        } catch (error) {
            showMessage(error.message || "Download failed.", true);
        }
    }

    downloadSubmitBtn.addEventListener("click", () => {
        if (!state.tableName) {
            return;
        }
        const format = document.querySelector('input[name="downloadFormat"]:checked').value;
        const scope = document.querySelector('input[name="downloadScope"]:checked').value;

        const backendMode = scope === "date" ? "all" : scope;

        const params = new URLSearchParams({ format, mode: backendMode });
        if (state.search) {
            params.set("search", state.search);
        }
        if (state.sortColumn) {
            params.set("sortColumn", state.sortColumn);
            params.set("sortDir", state.sortDir);
        }
        if (state.dateColumn && state.dateFrom && state.dateTo) {
            params.set("dateColumn", state.dateColumn);
            params.set("dateFrom", state.dateFrom);
            params.set("dateTo", state.dateTo);
        }

        if (scope === "range") {
            const start = parseInt(downloadRangeStart.value, 10);
            const end = parseInt(downloadRangeEnd.value, 10);
            if (!start || !end || start < 1 || end < start) {
                showMessage("Enter a valid row range (From ≤ To, both at least 1).", true);
                return;
            }
            params.set("start", String(start));
            params.set("end", String(end));
        } else if (scope === "date") {
            const column = downloadDateColumnSelect.value || state.dateColumns[0];
            const from = downloadDateFrom.value;
            const to = downloadDateTo.value;
            downloadDateError.hidden = true;
            if (!from || !to) {
                downloadDateError.textContent = "Pick both a From and a To date.";
                downloadDateError.hidden = false;
                return;
            }
            if (from > to) {
                downloadDateError.textContent = "From date must be on or before To date.";
                downloadDateError.hidden = false;
                return;
            }
            params.set("dateColumn", column);
            params.set("dateFrom", from);
            params.set("dateTo", to);
        }

        const url = `/api/database/tables/${encodeURIComponent(state.tableName)}/export?${params}`;
        triggerDownload(url, `${state.tableName}.${format}`);
    });

    menuTemplateBtn.addEventListener("click", () => {
        if (!state.tableName) {
            return;
        }
        menuPanel.hidden = true;
        const url = `/api/database/tables/${encodeURIComponent(state.tableName)}/template`;
        triggerDownload(url, `${state.tableName}_template.csv`);
    });

    menuEditBtn.addEventListener("click", () => {
        if (!state.lastData) {
            return;
        }
        state.editMode = !state.editMode;
        menuPanel.hidden = true;
        renderCurrentData();
    });

    refreshBtn.addEventListener("click", () => {
        if (!state.tableName) {
            return;
        }
        load();
    });


    function setDateFilter(column, from, to) {
        state.dateColumn = column || null;
        state.dateFrom = from || null;
        state.dateTo = to || null;
        state.page = 0;
        load();
    }

    return { loadTable, setDateFilter };
}


initSidebar();
initQuickAccessPanel();

applyPagePermissions().then(() => applyFeatureGating());
initDatabaseInfo();

const tableData = initTableData();
const tableInfoPanel = initTableInfoPanel();

const initialTable = new URLSearchParams(window.location.search).get("table") || "site_master";
initTableList((tableName) => {
    tableData.loadTable(tableName);
    tableInfoPanel.show(tableName);
}, { initialTable });
