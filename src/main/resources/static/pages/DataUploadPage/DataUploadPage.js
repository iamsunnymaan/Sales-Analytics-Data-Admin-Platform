import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { initTableList, initTableInfoPanel } from "/components/TableList/TableList.js";
import { triggerUrlDownload } from "/components/TemplateDownload/TemplateDownload.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating } from "/Shared/js/feature-guard.js";


let knownPermissions = new Set();

applyPagePermissions().then((permissions) => {
    knownPermissions = permissions;
    applyFeatureGating();
});


function initFileImport(options = {}) {
    const { onUploaded, onValidated, onImported } = options;
    const section = document.getElementById("fileImportSection");
    const message = document.getElementById("fileImportMessage");
    const tableLabel = document.getElementById("uploadSelectedTableLabel");
    const dropzone = document.getElementById("uploadDropzone");
    const browseBtn = document.getElementById("uploadBrowseBtn");
    const fileInput = document.getElementById("uploadFileInput");
    const fileNameEl = document.getElementById("uploadSelectedFileName");
    const templateBtn = document.getElementById("uploadTemplateBtn");
    const uploadBtn = document.getElementById("uploadSubmitBtn");
    const progressCard = document.getElementById("fileImportProgressCard");
    const progressInner = document.getElementById("fileImportProgressInner");
    const progressTitle = document.getElementById("fileImportProgressTitle");
    const progressResetBtn = document.getElementById("fileImportResetBtn");
    const downloadBtn = document.getElementById("fileImportDownloadBtn");

    if (!section) {
        return { selectTable() {}, reset() {} };
    }

    const DEFAULT_STAGE_LABEL = "Data Preview";


    function setStage(label) {
        progressTitle.textContent = label ? `${DEFAULT_STAGE_LABEL} — ${label}` : DEFAULT_STAGE_LABEL;
    }

    const TABLE_ROW_CAP = 500;

    let messageTimeout = null;
    let selectedTable = null;

    let currentSession = null;
    let processResult = null;
    let tableContainerEl = null;


    let operationToken = 0;
    let activeXhr = null;
    let activeAbortController = null;
    let activeEventSource = null;

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

    function formatValue(value) {
        return value === null || value === undefined || value === "" ? "—" : String(value);
    }


    async function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (error) {

            }
        }
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.top = "-1000px";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        let copied = false;
        try {
            copied = document.execCommand("copy");
        } catch (error) {
            copied = false;
        }
        textarea.remove();
        return copied;
    }

    function showMessage(text, isError) {
        clearTimeout(messageTimeout);
        message.textContent = text;
        message.className = "file-import-message " + (isError ? "error" : "success");
        messageTimeout = setTimeout(() => {
            message.className = "file-import-message";
        }, isError ? 5000 : 3000);
    }

    function updateButtonStates() {
        uploadBtn.disabled = !selectedTable || !fileInput.files.length;
        templateBtn.disabled = !selectedTable;
    }

    function selectTable(tableName) {
        selectedTable = tableName;
        tableLabel.textContent = tableName;
        updateButtonStates();
    }

    function handleFileSelected() {
        const file = fileInput.files[0];
        fileNameEl.textContent = file ? file.name : "";
        updateButtonStates();
    }

    browseBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", handleFileSelected);

    dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("dragover");
        if (event.dataTransfer.files.length) {
            fileInput.files = event.dataTransfer.files;
            handleFileSelected();
        }
    });

    templateBtn.addEventListener("click", async () => {
        if (!selectedTable) {
            return;
        }
        try {
            await triggerUrlDownload(`/api/database/tables/${encodeURIComponent(selectedTable)}/template`,
                `${selectedTable}_template.csv`);
        } catch (error) {
            showMessage(error.message || "Unable to download template.", true);
        }
    });

    function buildProgressPlaceholder() {
        const wrap = elem("div", "file-import-progress-empty");
        wrap.appendChild(Object.assign(document.createElement("i"), { className: "bi bi-table" }));
        wrap.appendChild(elem("p", null,
            "Nothing running. Upload a file on the left and the parsed rows, chunk lanes and live speed will appear here."));
        return wrap;
    }

    const STEP_ORDER = ["parsing", "validating", "committing", "done"];

    function buildStep(key, label) {
        const step = elem("div", "file-import-step");
        step.dataset.step = key;
        step.appendChild(elem("span", "file-import-step-dot"));
        step.appendChild(document.createTextNode(label));
        return step;
    }


    function setStepperPhase(root, phase) {
        const idx = phase === "failed" ? STEP_ORDER.indexOf("validating") : STEP_ORDER.indexOf(phase);
        root.querySelectorAll(".file-import-step").forEach((el) => {
            const stepIdx = STEP_ORDER.indexOf(el.dataset.step);
            el.classList.remove("done", "active", "failed");
            if (phase === "failed" && el.dataset.step === "validating") {
                el.classList.add("failed");
            } else if (stepIdx < idx) {
                el.classList.add("done");
            } else if (stepIdx === idx) {
                el.classList.add(phase === "done" ? "done" : "active");
            }
        });
    }

    function buildTally(label, variant) {
        const tile = elem("div", `file-import-tally file-import-tally-${variant}`);
        tile.appendChild(elem("div", "file-import-tally-k", label));
        tile.appendChild(elem("div", "file-import-tally-v", "0"));
        return tile;
    }


    function phaseVerb(phase) {
        return phase === "committing" ? "Committing" : "Validating";
    }


    function buildRowProgressPlaceholder(phase, totalRows) {
        const wrap = elem("div", "file-import-pipeline");

        const stepper = elem("div", "file-import-stepper");
        stepper.append(
            buildStep("parsing", "Parsing"), elem("span", "file-import-step-rule"),
            buildStep("validating", "Validating"), elem("span", "file-import-step-rule"),
            buildStep("committing", "Committing"), elem("span", "file-import-step-rule"),
            buildStep("done", "Done"));
        wrap.appendChild(stepper);

        const verb = phaseVerb(phase);
        const speedLine = elem("div", "speed-line");
        speedLine.dataset.verb = verb;
        const label = elem("span", "label", `${verb} rows`);
        label.id = "speedLabel";
        const stats = elem("span", "stats tnum", "");
        stats.id = "speedStats";
        speedLine.append(label, stats);
        wrap.appendChild(speedLine);

        const barOuter = elem("div", "progress-track");
        const barFill = elem("div", "progress-fill");
        barFill.id = "progressFill";
        barOuter.appendChild(barFill);
        wrap.appendChild(barOuter);

        const tallyRow = elem("div", "file-import-tally-row");
        tallyRow.append(buildTally("Processed", "processed"), buildTally("Valid", "valid"), buildTally("Invalid", "invalid"));
        wrap.appendChild(tallyRow);

        wrap.appendChild(elem("div", "file-import-lanes"));
        wrap.appendChild(elem("div", "file-import-live-grid-slot"));

        setStepperPhase(wrap, phase);
        return wrap;
    }


    function renderLiveInvalidRows(rows) {
        const slot = progressInner.querySelector(".file-import-live-grid-slot");
        if (!slot || slot.dataset.count === String(rows.length)) {
            return;
        }
        slot.dataset.count = String(rows.length);

        if (!rows.length) {
            slot.replaceChildren();
            return;
        }

        const headers = Object.keys(rows[0].data || {});
        const wrapper = elem("div", "file-import-live-grid-wrap");
        const table = document.createElement("table");
        table.className = "file-import-progress-table";
        table.appendChild(buildRowTableHead(headers));
        const tbody = document.createElement("tbody");
        rows.forEach((row) => tbody.appendChild(buildRowTr(row, headers)));
        table.appendChild(tbody);
        wrapper.appendChild(table);

        slot.replaceChildren(elem("div", "file-import-live-grid-label", `Invalid rows found so far (${rows.length})`),
            wrapper);
    }


    function updateLanes(workerCount, chunks) {
        const lanesEl = progressInner.querySelector(".file-import-lanes");
        if (!lanesEl) {
            return;
        }
        if (!lanesEl.dataset.built) {
            const laneRows = new Map();
            const laneCount = Math.max(1, workerCount);
            for (let l = 0; l < laneCount; l++) {
                const lane = elem("div", "file-import-lane");
                lane.appendChild(elem("span", "file-import-lane-idx", `W${l + 1}`));
                const chunkRow = elem("div", "file-import-lane-chunks");
                lane.appendChild(chunkRow);
                lanesEl.appendChild(lane);
                laneRows.set(l, chunkRow);
            }
            chunks.forEach((chunk) => {
                const row = laneRows.get(chunk.lane) || laneRows.get(0);
                const chunkEl = elem("div", "file-import-chunk");
                chunkEl.id = `file-import-chunk-${chunk.index}`;
                chunkEl.appendChild(elem("div", "file-import-chunk-fill"));
                chunkEl.appendChild(elem("span", null, `C${chunk.index + 1}`));
                row.appendChild(chunkEl);
            });
            lanesEl.dataset.built = "1";
        }
        chunks.forEach((chunk) => {
            const chunkEl = document.getElementById(`file-import-chunk-${chunk.index}`);
            if (!chunkEl) {
                return;
            }
            const pct = chunk.rowsTotal > 0 ? Math.min(100, Math.round((chunk.rowsDone / chunk.rowsTotal) * 100)) : 0;
            const fill = chunkEl.querySelector(".file-import-chunk-fill");
            if (fill) {
                fill.style.width = `${pct}%`;
            }
            chunkEl.classList.remove("running", "passed", "flagged", "aborted");
            if (["running", "passed", "flagged", "aborted"].includes(chunk.status)) {
                chunkEl.classList.add(chunk.status);
            }
        });
    }


    function updateRowProgress(phaseStartTime, state) {
        const { processedRows, totalRows, insertedSoFar, duplicatesSoFar, errorsSoFar, chunks, workerCount,
            liveInvalidRows } = state;
        const label = progressInner.querySelector("#speedLabel");
        const stats = progressInner.querySelector("#speedStats");
        const barFill = progressInner.querySelector("#progressFill");
        if (!label || !stats || !barFill) {
            return;
        }
        const progressPct = totalRows > 0 ? Math.min(100, (processedRows / totalRows) * 100) : 0;
        const successPct = processedRows > 0 ? Math.round((insertedSoFar / processedRows) * 100) : 0;
        const elapsedSec = (performance.now() - phaseStartTime) / 1000;
        const rowsPerSec = elapsedSec > 0 ? processedRows / elapsedSec : 0;
        const remainingSec = rowsPerSec > 0 ? Math.max(0, totalRows - processedRows) / rowsPerSec : 0;

        barFill.style.width = `${progressPct}%`;

        const verb = label.closest(".speed-line").dataset.verb;
        label.innerHTML = `${verb} rows · <b>${processedRows.toLocaleString("en-IN")} / ` +
            `${totalRows.toLocaleString("en-IN")}</b>`;

        const statsParts = [];
        if (rowsPerSec > 0) {
            statsParts.push(`${Math.round(rowsPerSec).toLocaleString("en-IN")} rows/sec`);
        }
        if (progressPct < 100 && rowsPerSec > 0) {
            statsParts.push(`${formatSeconds(remainingSec)} left`);
        }
        statsParts.push(`${progressPct.toFixed(1)}%`);
        stats.textContent = statsParts.join(" · ");

        const tallyProcessed = progressInner.querySelector(".file-import-tally-processed .file-import-tally-v");
        const tallyValid = progressInner.querySelector(".file-import-tally-valid .file-import-tally-v");
        const tallyInvalid = progressInner.querySelector(".file-import-tally-invalid .file-import-tally-v");
        if (tallyProcessed) {
            tallyProcessed.textContent = `${processedRows.toLocaleString("en-IN")} / ${totalRows.toLocaleString("en-IN")}`;
        }
        if (tallyValid) {
            tallyValid.textContent = `${insertedSoFar.toLocaleString("en-IN")} (${successPct}%)`;
        }
        if (tallyInvalid) {
            tallyInvalid.textContent = duplicatesSoFar
                ? `${errorsSoFar.toLocaleString("en-IN")} · ${duplicatesSoFar.toLocaleString("en-IN")} dup`
                : errorsSoFar.toLocaleString("en-IN");
        }


        if (Array.isArray(liveInvalidRows)) {
            renderLiveInvalidRows(liveInvalidRows);
        }

        if (Array.isArray(chunks) && chunks.length) {
            updateLanes(workerCount || 1, chunks);
        }
    }


    function buildErrorContent(message) {
        const wrap = elem("div", "file-import-progress-error");
        wrap.appendChild(Object.assign(document.createElement("i"), {
            className: "bi bi-exclamation-triangle-fill file-import-progress-error-icon",
        }));
        wrap.appendChild(elem("div", "file-import-progress-error-text", message));
        return wrap;
    }

    function showErrorCard(message) {
        progressCard.hidden = false;
        setStage("Error");
        progressInner.replaceChildren(buildErrorContent(message));
    }



    function formatBytes(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function formatSeconds(seconds) {
        if (!isFinite(seconds) || seconds < 0) {
            return "";
        }
        if (seconds < 1) {
            return "<1s";
        }
        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        }
        return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    }


    function buildUploadProgressUI(file) {
        const wrap = elem("div", "file-import-upload-progress");
        wrap.appendChild(elem("div", "file-import-progress-title", `${file.name} (${formatBytes(file.size)})`));
        const label = elem("div", "file-import-upload-progress-label", "Uploading… 0%");
        const barOuter = elem("div", "file-import-upload-progress-bar");
        const barInner = elem("div", "file-import-upload-progress-bar-fill");
        barOuter.appendChild(barInner);
        const detail = elem("div", "file-import-upload-progress-detail", "");
        wrap.append(label, barOuter, detail);
        return { wrap, label, barInner, detail };
    }

    
    function uploadFileWithProgress(tableKey, file, onProgress, sheetIndex) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            formData.append("tableKey", tableKey);
            formData.append("file", file);

            if (sheetIndex !== null && sheetIndex !== undefined) {
                formData.append("sheetIndex", String(sheetIndex));
            }

            xhr.open("POST", "/api/import-sessions/upload");
            xhr.responseType = "json";

            xhr.upload.addEventListener("progress", (event) => {
                if (event.lengthComputable) {
                    onProgress(event.loaded, event.total);
                }
            });

            xhr.addEventListener("load", () => {
                activeXhr = null;
                const result = xhr.response || {};
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(result);
                } else {
                    reject(new Error(result.message || `Upload failed with status ${xhr.status}`));
                }
            });
            xhr.addEventListener("error", () => {
                activeXhr = null;
                reject(new Error("Upload failed due to a network error."));
            });
            xhr.addEventListener("abort", () => {
                activeXhr = null;
                reject(new Error("Upload was cancelled."));
            });

            activeXhr = xhr;
            xhr.send(formData);
        });
    }


    function updateUploadProcessingProgress(ui, phaseStartTime, state) {
        const { processedRows, totalRows } = state;
        if (!totalRows) {
            return;
        }
        ui.barInner.classList.remove("processing");
        const progressPct = Math.min(100, Math.round((processedRows / totalRows) * 100));
        const elapsedSec = (performance.now() - phaseStartTime) / 1000;
        const rowsPerSec = elapsedSec > 0 ? processedRows / elapsedSec : 0;
        const remainingSec = rowsPerSec > 0 ? Math.max(0, totalRows - processedRows) / rowsPerSec : 0;

        ui.barInner.style.width = `${progressPct}%`;
        ui.label.textContent = `Parsing rows… ${progressPct}%`;
        const detailParts = [`${processedRows.toLocaleString("en-IN")} / ${totalRows.toLocaleString("en-IN")} rows`];
        if (rowsPerSec > 0) {
            detailParts.push(`${Math.round(rowsPerSec).toLocaleString("en-IN")} rows/sec`);
            if (progressPct < 100) {
                detailParts.push(`${formatSeconds(remainingSec)} left`);
            }
        }
        ui.detail.textContent = detailParts.join(" · ");
    }


    async function performUpload(file, sheetIndex, ui, onUploadProgress, token) {
        const startResponse = await uploadFileWithProgress(selectedTable, file, onUploadProgress, sheetIndex);
        if (token !== operationToken) {
            throw CANCELLED;
        }
        activeAbortController = new AbortController();
        const signal = activeAbortController.signal;
        const phaseStartTime = performance.now();
        try {
            closeLiveProgress();
            const wakeupRef = {};
            activeEventSource = openLiveProgress(startResponse.uploadId,
                (state) => updateUploadProcessingProgress(ui, phaseStartTime, state), wakeupRef);

            const result = await pollJobStatus(`/api/import-sessions/upload/${startResponse.uploadId}/status`,
                (state) => updateUploadProcessingProgress(ui, phaseStartTime, state), token, signal, wakeupRef);
            if (!result) {
                throw new Error("Upload did not complete.");
            }
            return result;
        } finally {
            closeLiveProgress();
        }
    }

    function statusBadgeFor(status) {
        const span = document.createElement("span");
        const cls = status === "VALID" ? "status-valid" : status === "DUPLICATE" ? "status-duplicate" : "status-invalid";
        span.className = `file-import-badge ${cls}`;
        span.textContent = status === "VALID" ? "Valid" : status === "DUPLICATE" ? "Duplicate" : "Invalid";
        return span;
    }


    function buildIssueIcon(tooltipText) {
        const icon = document.createElement("i");
        icon.className = "bi bi-exclamation-circle-fill file-import-issue-icon";
        icon.title = `${tooltipText} (click to copy)`;
        icon.setAttribute("role", "button");
        icon.setAttribute("tabindex", "0");
        icon.setAttribute("aria-label", "Copy error details");

        let revertTimeout = null;
        const copy = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const copied = await copyToClipboard(tooltipText);
            clearTimeout(revertTimeout);
            icon.classList.toggle("file-import-issue-icon-copied", copied);
            icon.title = copied ? "Copied to clipboard!" : "Copy failed — select and copy the text manually.";
            revertTimeout = setTimeout(() => {
                icon.classList.remove("file-import-issue-icon-copied");
                icon.title = `${tooltipText} (click to copy)`;
            }, 1500);
        };
        icon.addEventListener("click", copy);
        icon.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                copy(event);
            }
        });

        return icon;
    }

    function summaryTile(label, value, variant) {
        const tile = elem("div", "file-import-tile" + (variant ? ` tile-${variant}` : ""));
        tile.append(elem("span", "file-import-tile-value", String(value ?? 0)), elem("span", "file-import-tile-label", label));
        return tile;
    }




    function filteredRows() {
        return processResult.rows.filter((row) => row.status !== "VALID");
    }


    function buildRowTr(row, headers) {
        const tr = document.createElement("tr");
        tr.className = `file-import-row-${row.status.toLowerCase()}`;

        const isInvalid = row.status === "INVALID";
        const tooltipText = isInvalid
            ? `Row ${row.rowNumber}: ${row.errorMessage} — Fix: ${row.solution}`
            : null;
        const errorColumnLower = row.errorColumn ? row.errorColumn.toLowerCase() : null;

        const statusTd = document.createElement("td");
        statusTd.appendChild(statusBadgeFor(row.status));
        if (isInvalid && !errorColumnLower) {
            statusTd.appendChild(buildIssueIcon(tooltipText));
        }
        tr.appendChild(statusTd);

        headers.forEach((h) => {
            const td = document.createElement("td");
            td.textContent = formatValue(row.data ? row.data[h] : undefined);
            if (isInvalid && errorColumnLower && errorColumnLower === h.toLowerCase()) {
                td.classList.add("file-import-cell-invalid");
                td.appendChild(buildIssueIcon(tooltipText));
            }
            tr.appendChild(td);
        });
        return tr;
    }

    function buildRowTableHead(headers) {
        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        headRow.appendChild(elem("th", null, "Status"));
        headers.forEach((h) => headRow.appendChild(elem("th", null, h)));
        thead.appendChild(headRow);
        return thead;
    }


    function buildValidationTable(rows) {
        const headers = processResult.headers || [];
        const container = document.createElement("div");

        if (!rows.length) {
            container.appendChild(elem("div", "file-import-table-empty", "No issues found — every row is valid."));
            return container;
        }

        const wrapper = elem("div", "file-import-progress-table-wrapper");
        const table = document.createElement("table");
        table.className = "file-import-progress-table";
        table.appendChild(buildRowTableHead(headers));

        const tbody = document.createElement("tbody");
        const shown = rows.slice(0, TABLE_ROW_CAP);
        shown.forEach((row) => tbody.appendChild(buildRowTr(row, headers)));
        table.appendChild(tbody);
        wrapper.appendChild(table);
        container.appendChild(wrapper);

        container.appendChild(elem("div", "file-import-table-note",
            rows.length > TABLE_ROW_CAP
                ? `Showing ${TABLE_ROW_CAP} of ${rows.length} matching rows.`
                : `${rows.length} matching row${rows.length === 1 ? "" : "s"}.`));

        return container;
    }

    function updateValidationTable() {
        tableContainerEl.replaceChildren(buildValidationTable(filteredRows()));
    }


    function buildValidationContent(session, result) {
        const wrap = elem("div", "file-import-progress-content");

        wrap.appendChild(elem("h3", "file-import-progress-title", `${session.originalFilename} → ${session.tableKey}`));

        const summary = elem("div", "file-import-summary");
        summary.append(
            summaryTile("Total Records", result.totalRows),
            summaryTile("Valid Records", result.validRows, "valid"),
            summaryTile("Invalid Records", result.invalidRows, "invalid")
        );
        wrap.appendChild(summary);

        tableContainerEl = document.createElement("div");
        wrap.appendChild(tableContainerEl);
        updateValidationTable();

        const importBtn = document.createElement("button");
        importBtn.type = "button";
        importBtn.className = "file-import-next-btn";
        importBtn.disabled = result.validRows === 0;
        importBtn.append(document.createTextNode("Import Data "),
            Object.assign(document.createElement("i"), { className: "bi bi-cloud-upload" }));
        importBtn.addEventListener("click", () => runImport(session, importBtn, ++operationToken));

        importBtn.hidden = !knownPermissions.has("page:data-upload.upload-verify");
        wrap.appendChild(importBtn);

        return wrap;
    }

    function renderValidation(session, result) {
        progressInner.replaceChildren(buildValidationContent(session, result));
    }




    function buildCappedRowsTable(headers, displayedRows, finalRow) {
        const wrapper = elem("div", "file-import-progress-table-wrapper");
        const table = document.createElement("table");
        table.className = "file-import-progress-table";
        table.appendChild(buildRowTableHead(headers));

        const tbody = document.createElement("tbody");
        displayedRows.forEach((row) => tbody.appendChild(buildRowTr(row, headers)));
        if (finalRow) {
            const ellipsisTr = document.createElement("tr");
            ellipsisTr.className = "file-import-limit-ellipsis-row";
            const ellipsisTd = elem("td", "file-import-limit-ellipsis-cell", "⋮");
            ellipsisTd.colSpan = headers.length + 1;
            ellipsisTr.appendChild(ellipsisTd);
            tbody.appendChild(ellipsisTr);
            tbody.appendChild(buildRowTr(finalRow, headers));
        }
        table.appendChild(tbody);
        wrapper.appendChild(table);
        return wrapper;
    }


    function buildInvalidLimitContent(session, result) {
        const wrap = elem("div", "file-import-progress-content");
        wrap.appendChild(elem("h3", "file-import-progress-title", `${session.originalFilename} → ${session.tableKey}`));

        const headers = result.headers || (processResult && processResult.headers) || [];
        const displayedRows = result.displayedInvalidRows || [];
        if (displayedRows.length || result.finalInvalidRow) {
            wrap.appendChild(buildCappedRowsTable(headers, displayedRows, result.finalInvalidRow));
        }

        wrap.appendChild(elem("div", "file-import-limit-footer",
            "Please correct these issues in the Excel file and upload it again."));

        return wrap;
    }

    function renderInvalidLimitReached(session, result) {
        progressInner.replaceChildren(buildInvalidLimitContent(session, result));
    }




    function updateDownloadButtonVisibility() {
        const hasIssues = !!processResult && (processResult.invalidRowLimitReached
            || (processResult.invalidRows ?? 0) > 0 || (processResult.duplicateRows ?? 0) > 0);
        downloadBtn.hidden = !hasIssues;
    }


    async function downloadFullScan() {
        if (!currentSession) {
            return;
        }
        const session = currentSession;
        const token = operationToken;
        downloadBtn.classList.add("scanning");
        downloadBtn.title = "Scanning the entire file…";
        try {
            const startResponse = await fetch(`/api/import-sessions/${session.id}/full-scan`, { method: "POST" });
            if (!startResponse.ok) {
                const errorBody = await startResponse.json().catch(() => ({}));
                throw new Error(errorBody.message || `Request failed with status ${startResponse.status}`);
            }
            await pollJobStatus(`/api/import-sessions/${session.id}/full-scan/status`, (state) => {
                const pct = state.totalRows > 0 ? Math.round((state.processedRows / state.totalRows) * 100) : 0;
                downloadBtn.title = `Scanning the entire file… ${pct}%`;
            }, token, null);

            const downloadResponse = await fetch(`/api/import-sessions/${session.id}/full-scan/download`);
            if (!downloadResponse.ok) {
                const errorBody = await downloadResponse.json().catch(() => ({}));
                throw new Error(errorBody.message || `Download failed with status ${downloadResponse.status}`);
            }
            const blob = await downloadResponse.blob();
            const disposition = downloadResponse.headers.get("Content-Disposition") || "";
            const match = disposition.match(/filename="?([^"]+)"?/);
            const filename = match ? match[1] : `${session.tableKey}_full_dataset.xlsx`;

            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(link.href);
        } catch (error) {
            if (error !== CANCELLED && token === operationToken) {
                showMessage(error.message || "Could not scan the file.", true);
            }
        } finally {
            downloadBtn.classList.remove("scanning");
            downloadBtn.title = "Download the full data set (invalid cells in red)";
        }
    }

    downloadBtn.addEventListener("click", downloadFullScan);

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }


    function interruptibleSleep(ms) {
        let wake;
        const promise = new Promise((resolve) => {
            const timer = setTimeout(resolve, ms);
            wake = () => {
                clearTimeout(timer);
                resolve();
            };
        });
        return { promise, wake };
    }


    function openLiveProgress(sessionId, onProgress, wakeupRef) {
        if (typeof EventSource === "undefined") {
            return null;
        }
        let source;
        try {
            source = new EventSource(`/api/import-sessions/${sessionId}/events`);
        } catch (error) {
            return null;
        }
        source.addEventListener("progress", (event) => {
            try {
                onProgress(JSON.parse(event.data));
            } catch (error) {

            }
        });
        const close = () => source.close();
        source.addEventListener("done", () => {
            wakeupRef?.current?.();
            close();
        });
        source.onerror = close;
        return source;
    }

    function closeLiveProgress() {
        if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
        }
    }

    const CANCELLED = Symbol("cancelled");


    const POLL_INTERVAL_MS = 150;


    async function pollJobStatus(statusUrl, onProgress, token, signal, wakeupRef) {
        while (true) {
            if (token !== operationToken) {
                throw CANCELLED;
            }
            const response = await fetch(statusUrl, { signal });
            if (token !== operationToken) {
                throw CANCELLED;
            }
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(errorBody.message || `Request failed with status ${response.status}`);
            }
            const state = await response.json();
            if (state.status === "DONE") {
                return state.result;
            }
            if (state.status === "CANCELLED") {
                throw CANCELLED;
            }
            if (state.status === "ERROR") {
                throw new Error(state.errorMessage || "Request failed unexpectedly.");
            }
            onProgress(state);
            const wait = interruptibleSleep(POLL_INTERVAL_MS);
            if (wakeupRef) {
                wakeupRef.current = wait.wake;
            }
            await wait.promise;
        }
    }


    async function showValidation(session, token) {
        currentSession = session;
        activeAbortController = new AbortController();
        const signal = activeAbortController.signal;


        progressCard.hidden = false;
        setStage("Validating");
        progressInner.replaceChildren(buildRowProgressPlaceholder("validating", session.totalRows));
        const phaseStartTime = performance.now();

        try {
            const startResponse = await fetch(`/api/import-sessions/${session.id}/process`,
                { method: "POST", signal });
            if (token !== operationToken) {
                return;
            }
            if (!startResponse.ok) {
                const errorBody = await startResponse.json().catch(() => ({}));
                throw new Error(errorBody.message || `Request failed with status ${startResponse.status}`);
            }

            closeLiveProgress();
            const wakeupRef = {};
            activeEventSource = openLiveProgress(session.id,
                (state) => updateRowProgress(phaseStartTime, state), wakeupRef);

            const result = await pollJobStatus(`/api/import-sessions/${session.id}/process/status`,
                (state) => updateRowProgress(phaseStartTime, state), token, signal, wakeupRef);
            if (!result) {
                throw new Error("Validation did not complete.");
            }
            processResult = result;
            updateDownloadButtonVisibility();

            if (result.invalidRowLimitReached) {

                setStage("Validation Failed");
                renderInvalidLimitReached(session, result);
                if (onValidated) {
                    onValidated(session);
                }
                return;
            }

            const hasIssues = (result.invalidRows ?? 0) > 0 || (result.duplicateRows ?? 0) > 0;
            if (hasIssues) {

                setStage("Validated — Review Required");
                renderValidation(session, result);
                if (onValidated) {
                    onValidated(session);
                }
            } else {

                await runImport(session, null, token);
            }
        } catch (error) {
            if (error === CANCELLED || token !== operationToken) {
                return;
            }

            showErrorCard(error.message || "Unable to validate the uploaded data.");
        } finally {
            closeLiveProgress();
        }
    }




    async function runImport(session, btn, token) {
        if (btn) {
            btn.disabled = true;
        }
        progressCard.hidden = false;
        setStage("Committing");
        progressInner.replaceChildren(buildRowProgressPlaceholder("committing", session.totalRows));
        const phaseStartTime = performance.now();

        activeAbortController = new AbortController();
        const signal = activeAbortController.signal;

        try {
            const startResponse = await fetch(`/api/import-sessions/${session.id}/commit`,
                { method: "POST", signal });
            if (token !== operationToken) {
                return;
            }
            if (!startResponse.ok) {
                const errorBody = await startResponse.json().catch(() => ({}));
                throw new Error(errorBody.message || `Request failed with status ${startResponse.status}`);
            }

            closeLiveProgress();
            const wakeupRef = {};
            activeEventSource = openLiveProgress(session.id,
                (state) => updateRowProgress(phaseStartTime, state), wakeupRef);

            const result = await pollJobStatus(`/api/import-sessions/${session.id}/commit/status`,
                (state) => updateRowProgress(phaseStartTime, state), token, signal, wakeupRef);
            if (token !== operationToken) {
                return;
            }
            if (!result) {
                throw new Error("Import did not complete.");
            }

            if (result.invalidRowLimitReached) {
                progressCard.hidden = false;
                setStage("Import Failed");
                renderInvalidLimitReached(session, result);
                if (onImported) {
                    onImported(result);
                }
                return;
            }
            if (result.status === "Failed") {
                throw new Error(result.message || "Import failed — nothing was committed.");
            }
            setStage("Committed");
            const inserted = result.insertedRows ?? 0;
            showMessage(`Imported "${result.originalFilename}": ${inserted} row${inserted === 1 ? "" : "s"} inserted.`, false);
            reset();
            if (onImported) {
                onImported(result);
            }
        } catch (error) {
            if (error === CANCELLED || error.name === "AbortError" || token !== operationToken) {
                return;
            }

            if (processResult) {
                progressCard.hidden = false;
                setStage("Validated — Review Required");
                renderValidation(session, processResult);
            } else {
                showErrorCard(error.message || "Import failed.");
            }
        } finally {
            closeLiveProgress();
        }
    }


    const MULTI_SHEET_MARKER = "more than one sheet with data";

    function promptForSheetIndex(message) {
        if (!message || !message.includes(MULTI_SHEET_MARKER)) {
            return null;
        }
        const optionsText = message.substring(message.indexOf(":", message.indexOf(MULTI_SHEET_MARKER)) + 1).trim();
        const options = optionsText.split(",").map((s) => s.trim()).filter(Boolean);
        const listForPrompt = options.map((opt) => `  ${opt}`).join("\n");
        const answer = window.prompt(
            `This workbook has more than one sheet with data. Enter the sheet index to import:\n${listForPrompt}`, "");
        if (answer === null || answer.trim() === "") {
            return null;
        }
        const parsed = Number.parseInt(answer.trim(), 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    progressCard.hidden = true;
    progressInner.replaceChildren(buildProgressPlaceholder());

    uploadBtn.addEventListener("click", async () => {
        const file = fileInput.files[0];
        if (!selectedTable || !file) {
            return;
        }


        const token = ++operationToken;

        uploadBtn.disabled = true;

        progressCard.hidden = false;
        setStage("Uploading");
        const ui = buildUploadProgressUI(file);
        progressInner.replaceChildren(ui.wrap);
        const startTime = performance.now();

        const onUploadProgress = (loaded, total) => {
            const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
            const elapsedSec = (performance.now() - startTime) / 1000;
            const speedBps = elapsedSec > 0 ? loaded / elapsedSec : 0;
            const remainingSec = speedBps > 0 ? (total - loaded) / speedBps : 0;

            ui.barInner.style.width = `${percent}%`;
            if (percent >= 100) {

                ui.barInner.classList.add("processing");
                ui.label.textContent = "Processing file…";
                ui.detail.textContent = "Upload complete — parsing and checking the file on the server.";
            } else {
                ui.label.textContent = `Uploading… ${percent}%`;
                ui.detail.textContent = `${formatBytes(loaded)} of ${formatBytes(total)} · ${formatBytes(speedBps)}/s` +
                    ` · ${formatSeconds(remainingSec)} left`;
            }
        };

        try {
            let result;
            try {
                result = await performUpload(file, undefined, ui, onUploadProgress, token);
            } catch (error) {
                if (error === CANCELLED || token !== operationToken) {
                    throw error;
                }

                const sheetIndex = promptForSheetIndex(error.message);
                if (sheetIndex === null) {
                    throw error;
                }
                result = await performUpload(file, sheetIndex, ui, onUploadProgress, token);
            }
            if (token !== operationToken) {
                return;
            }

            const rowCount = result.totalRows !== null && result.totalRows !== undefined ? result.totalRows : 0;
            if (result.duplicateWarning) {
                showMessage(result.duplicateWarning, true);
            } else {
                showMessage(`Uploaded "${result.originalFilename}" (${rowCount} row${rowCount === 1 ? "" : "s"}).`, false);
            }
            fileInput.value = "";
            fileNameEl.textContent = "";
            showValidation(result, token);
            if (onUploaded) {
                onUploaded(result);
            }
        } catch (error) {
            if (error === CANCELLED || token !== operationToken) {

                return;
            }

            showErrorCard(error.message || "Upload failed.");
        } finally {
            if (token === operationToken) {
                updateButtonStates();
            }
        }
    });

    function reset() {
        fileInput.value = "";
        fileNameEl.textContent = "";
        updateButtonStates();
        currentSession = null;
        processResult = null;
        updateDownloadButtonVisibility();
        progressCard.hidden = true;
        setStage(null);
        progressInner.replaceChildren(buildProgressPlaceholder());
    }


    function cancelCurrentOperation() {
        operationToken++;
        if (activeXhr) {
            activeXhr.abort();
            activeXhr = null;
        }
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
        closeLiveProgress();
        if (currentSession) {
            fetch(`/api/import-sessions/${currentSession.id}/cancel`, { method: "POST" }).catch(() => {});
        }
    }


    progressResetBtn.addEventListener("click", () => {
        cancelCurrentOperation();
        clearTimeout(messageTimeout);
        message.textContent = "";
        message.className = "file-import-message";
        reset();
    });

    return { selectTable, reset };
}


function initImportHistory() {
    const body = document.getElementById("importHistoryBody");
    const empty = document.getElementById("importHistoryEmpty");
    const table = document.getElementById("importHistoryTable");
    const message = document.getElementById("importHistoryMessage");
    const refreshBtn = document.getElementById("importHistoryRefreshBtn");

    const previewOverlay = document.getElementById("importPreviewOverlay");
    const previewTitle = document.getElementById("importPreviewTitle");
    const previewBody = document.getElementById("importPreviewBody");
    const previewCloseBtn = document.getElementById("importPreviewCloseBtn");
    const previewDownloadBtn = document.getElementById("importPreviewDownloadBtn");

    if (!body) {
        return { reload() {} };
    }

    let messageTimeout = null;
    let previewSessionId = null;
    let previewFilename = null;

    function showMessage(text, isError) {
        clearTimeout(messageTimeout);
        message.textContent = text;
        message.className = "import-history-message " + (isError ? "error" : "success");
        messageTimeout = setTimeout(() => {
            message.className = "import-history-message";
        }, isError ? 5000 : 2500);
    }

    function formatDate(iso) {
        return iso ? new Date(iso).toLocaleString() : "—";
    }

    function formatDuration(ms) {
        if (ms === null || ms === undefined) {
            return "—";
        }
        if (ms < 1000) {
            return `${ms} ms`;
        }
        return `${(ms / 1000).toFixed(1)} s`;
    }

    function formatBytes(bytes) {
        if (bytes === null || bytes === undefined) {
            return "";
        }
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function statusBadge(status, message) {
        const span = document.createElement("span");
        const normalized = (status || "").toLowerCase();

        const cls = normalized.includes("error") || normalized.includes("fail")
            ? "status-error"
            : normalized === "validating" || normalized === "committing"
                ? "status-pending"
                : normalized.includes("commit") || normalized.includes("complete")
                    ? "status-complete"
                    : "status-pending";
        span.className = `import-history-badge ${cls}`;
        span.textContent = status || "—";
        if (message) {
            span.title = message;
        }
        return span;
    }


    async function downloadFile(url, filenameFallback) {
        try {
            await triggerUrlDownload(url, filenameFallback);
        } catch (error) {
            showMessage(error.message || "Download failed.", true);
        }
    }

    function buildPreviewTable(columns, rows) {
        const wrapper = document.createElement("div");
        wrapper.className = "import-preview-table-wrapper";

        const tableEl = document.createElement("table");
        tableEl.className = "import-preview-table";

        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        columns.forEach((col) => {
            const th = document.createElement("th");
            th.textContent = col;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);

        const tbody = document.createElement("tbody");
        rows.forEach((row) => {
            const tr = document.createElement("tr");
            columns.forEach((col, i) => {
                const td = document.createElement("td");
                const value = row[i];
                td.textContent = value === undefined || value === null || value === "" ? "—" : value;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        tableEl.append(thead, tbody);
        wrapper.appendChild(tableEl);
        return wrapper;
    }

    function buildPreviewContent(data) {
        const wrap = document.createElement("div");
        const columns = data.columns || [];
        const rows = data.rows || [];

        const meta = document.createElement("div");
        meta.className = "import-preview-meta";
        meta.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${columns.length} column${columns.length === 1 ? "" : "s"}`;
        wrap.appendChild(meta);

        if (!rows.length) {
            const emptyEl = document.createElement("div");
            emptyEl.className = "import-preview-empty";
            emptyEl.textContent = "No data rows found in this file.";
            wrap.appendChild(emptyEl);
            return wrap;
        }

        wrap.appendChild(buildPreviewTable(columns, rows));
        return wrap;
    }


    async function openPreview(session) {
        previewSessionId = session.id;
        previewFilename = session.originalFilename;
        previewTitle.textContent = `Preview — ${session.originalFilename} → ${session.tableKey}`;

        const loading = document.createElement("div");
        loading.className = "import-preview-empty";
        loading.textContent = "Loading…";
        previewBody.replaceChildren(loading);
        previewOverlay.hidden = false;

        try {
            const response = await fetch(`/api/import-sessions/${session.id}/preview`);
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(errorBody.message || `Request failed with status ${response.status}`);
            }
            const data = await response.json();
            previewBody.replaceChildren(buildPreviewContent(data));
        } catch (error) {
            const errorEl = document.createElement("div");
            errorEl.className = "import-preview-empty";
            errorEl.textContent = error.message || "Unable to load preview.";
            previewBody.replaceChildren(errorEl);
        }
    }

    function closePreview() {
        previewOverlay.hidden = true;
        previewSessionId = null;
        previewFilename = null;
    }


    function buildRow(session) {
        const tr = document.createElement("tr");

        const fileTd = document.createElement("td");
        fileTd.textContent = session.originalFilename || "—";
        const sizeLabel = formatBytes(session.fileSize);
        if (sizeLabel) {
            fileTd.title = sizeLabel;
        }

        const tableTd = document.createElement("td");
        tableTd.textContent = session.tableKey || "—";

        const statusTd = document.createElement("td");
        statusTd.appendChild(statusBadge(session.status, session.message));

        const rowsTd = document.createElement("td");
        rowsTd.textContent = typeof session.totalRows === "number" ? session.totalRows.toLocaleString() : "—";

        const durationTd = document.createElement("td");
        durationTd.textContent = formatDuration(session.durationMs);

        const dateTd = document.createElement("td");
        dateTd.textContent = formatDate(session.createdAt);

        const viewTd = document.createElement("td");
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "import-history-view-btn";
        const viewIcon = document.createElement("i");
        viewIcon.className = "bi bi-eye";
        viewBtn.append(viewIcon, document.createTextNode(" View"));
        viewBtn.addEventListener("click", () => openPreview(session));
        viewTd.appendChild(viewBtn);

        tr.append(fileTd, tableTd, statusTd, rowsTd, durationTd, dateTd, viewTd);
        return tr;
    }


    async function reload() {
        try {
            const response = await fetch("/api/import-sessions");
            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }
            const sessions = await response.json();
            sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            if (!sessions.length) {
                table.hidden = true;
                empty.hidden = false;
                return;
            }
            empty.hidden = true;
            table.hidden = false;
            body.replaceChildren(...sessions.map(buildRow));
        } catch (error) {
            showMessage("Unable to load upload history.", true);
        }
    }

    refreshBtn.addEventListener("click", reload);

    previewCloseBtn.addEventListener("click", closePreview);
    previewOverlay.addEventListener("click", (event) => {
        if (event.target === previewOverlay) {
            closePreview();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !previewOverlay.hidden) {
            closePreview();
        }
    });

    previewDownloadBtn.addEventListener("click", () => {
        if (!previewSessionId) {
            return;
        }
        downloadFile(`/api/import-sessions/${previewSessionId}/download`, previewFilename || "download");
    });

    reload();

    return { reload };
}


initSidebar();
initQuickAccessPanel();

const importHistory = initImportHistory();
const fileImport = initFileImport({
    onUploaded: () => importHistory.reload(),
    onValidated: () => importHistory.reload(),
    onImported: () => importHistory.reload(),
});
const tableInfoPanel = initTableInfoPanel();

initTableList((tableName) => {
    fileImport.selectTable(tableName);
    tableInfoPanel.show(tableName);
});
