function buildChip(tableName, grid, onSelect) {
    const chip = document.createElement("span");
    chip.className = "table-chip";
    chip.dataset.table = tableName;
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;

    const icon = document.createElement("i");
    icon.className = "bi bi-table";
    chip.appendChild(icon);
    chip.appendChild(document.createTextNode(tableName));

    function select() {
        grid.querySelectorAll(".table-chip.active").forEach((el) => el.classList.remove("active"));
        chip.classList.add("active");
        onSelect(tableName);
    }

    chip.addEventListener("click", select);
    chip.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select();
        }
    });

    return chip;
}

function renderStatus(grid, text, isError) {
    const status = document.createElement("span");
    status.className = isError ? "table-list-status table-list-error" : "table-list-status";
    status.textContent = text;
    grid.replaceChildren(status);
}


export function initTableInfoPanel() {
    const panel = document.getElementById("tableInfoPanel");
    if (!panel) {
        return { show() {} };
    }

    function elem(tag, className, text) {
        const e = document.createElement(tag);
        if (className) {
            e.className = className;
        }
        if (text !== undefined) {
            e.textContent = text;
        }
        return e;
    }

    function buildPlaceholder() {
        const wrap = elem("div", "table-info-empty");
        wrap.appendChild(Object.assign(document.createElement("i"), { className: "bi bi-info-circle" }));
        wrap.appendChild(elem("p", null, "Select a table to see its details."));
        return wrap;
    }


    function formatLastUpdated(iso) {
        return iso ? new Date(iso).toLocaleString() : "No import yet";
    }


    function buildContent(tableName, summary) {
        const wrap = document.createDocumentFragment();

        const primaryRow = elem("div", "table-info-primary-row");
        const nameLine = elem("div", "table-info-name-line");
        nameLine.appendChild(Object.assign(document.createElement("i"), { className: "bi bi-table" }));
        nameLine.appendChild(elem("span", null, tableName));
        primaryRow.appendChild(nameLine);
        primaryRow.appendChild(elem("div", "table-info-updated-line", formatLastUpdated(summary.lastUpdated)));
        wrap.appendChild(primaryRow);

        wrap.appendChild(elem("span",
            `table-info-dup-badge ${summary.duplicateCheckEnabled ? "table-info-dup-on" : "table-info-dup-off"}`,
            summary.duplicateCheckEnabled ? "Duplicate Check" : "No Duplicate Check"));

        return wrap;
    }


    let requestToken = 0;

    async function show(tableName) {
        const token = ++requestToken;
        panel.replaceChildren(elem("div", "table-info-loading", "Loading…"));
        try {
            const response = await fetch(`/api/database/tables/${encodeURIComponent(tableName)}/summary`);
            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }
            const summary = await response.json();
            if (token !== requestToken) {
                return;
            }
            panel.replaceChildren(buildContent(tableName, summary));
        } catch (error) {
            if (token !== requestToken) {
                return;
            }
            panel.replaceChildren(elem("div", "table-info-error", "Unable to load table details."));
        }
    }

    panel.replaceChildren(buildPlaceholder());
    return { show };
}


export async function initTableList(onSelect, options = {}) {
    const { initialTable } = options;
    const grid = document.getElementById("tableListGrid");
    if (!grid) {
        return;
    }

    try {
        const response = await fetch("/api/database/tables");
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        const tables = await response.json();

        if (!tables.length) {
            renderStatus(grid, "No tables found.", false);
            return;
        }

        grid.replaceChildren(...tables.map((name) => buildChip(name, grid, onSelect)));

        if (initialTable) {
            const match = tables.find((name) => name.toLowerCase() === initialTable.toLowerCase());
            if (match) {
                grid.querySelector(`.table-chip[data-table="${match}"]`)?.click();
            }
        }
    } catch (error) {
        renderStatus(grid, "Unable to load tables.", true);
    }
}
