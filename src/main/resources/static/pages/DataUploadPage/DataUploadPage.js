// Upload Data page: table picker + file upload/preview + upload history, wired up below.
//
// Per explicit request, the section logic that used to live in separate components/* modules
// (FileImport, ImportHistory) is inlined below instead — this page is the only place either was
// ever used, and neither declares anything at module top level besides its own single init
// function, so there's no naming-collision risk in concatenating them directly.
//
// TableList stays a separate shared component — ExplorerPage.js uses it too, so inlining it here
// would just recreate the duplication that was already removed elsewhere in the app.
import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { initTableList, initTableInfoPanel } from "/components/TableList/TableList.js";
import { triggerUrlDownload } from "/components/TemplateDownload/TemplateDownload.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating } from "/Shared/js/feature-guard.js";

// Reveals this page's static Section/Feature-gated elements (Available Tables, Upload and Verify,
// Upload History — see this file's own data-permission attributes) once the session's real
// permission set resolves. Also cached here (not just fire-and-forget) because
// buildValidationContent's "Import Data" button below is built dynamically, long after this
// promise resolves in practice (a user has to pick a file and wait for validation first) — it
// reads knownPermissions synchronously rather than threading an await through several layers of
// nested closures.
let knownPermissions = new Set();
// applyFeatureGating sequenced after applyPagePermissions resolves — see Dashboard.js's own comment
// on why (prevents permission-gating's unconditional `hidden` assignment from undoing a
// feature-based hide on an element carrying both attributes).
applyPagePermissions().then((permissions) => {
    knownPermissions = permissions;
    applyFeatureGating();
});

// Drives the Data Upload page's upload -> preview -> import flow: file selection, upload with a
// live progress bar, then either an auto-import (if the file is clean) or a review table the user
// confirms before committing. Mirrors the backend's Upload/Preview/Commit split in
// ImportSessionController.
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

    // Named-stage header shown above whichever phase panel is currently rendered — the strict
    // pipeline this page enforces (Uploading -> Validating -> Validated/Failed -> Committing ->
    // Committed/Failed, never Validating -> Committing directly, see runImport/showValidation) is
    // otherwise only implied by which panel happens to be on screen; this makes the current stage
    // explicit and unambiguous at a glance, matching the state names in the row-progress panels and
    // in ImportSession.status server-side.
    function setStage(label) {
        progressTitle.textContent = label ? `${DEFAULT_STAGE_LABEL} — ${label}` : DEFAULT_STAGE_LABEL;
    }

    const TABLE_ROW_CAP = 500;

    let messageTimeout = null;
    let selectedTable = null;

    let currentSession = null;
    let processResult = null;
    let tableContainerEl = null;

    // Cancellation: bumped once per upload->validate->import chain the user starts (uploadBtn
    // click). Every async step in that chain checks its own snapshot against the live value after
    // each await and bails out silently the moment they no longer match — the cheapest way to make
    // a whole in-flight promise chain a no-op without threading cancellation through every function
    // signature. activeXhr/activeAbortController additionally stop the underlying network
    // request/upload immediately rather than just ignoring its eventual result.
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

    // navigator.clipboard requires a secure context (https, or true "localhost") — this internal
    // tool is also reached over plain http via a LAN IP, where that API is simply absent. Falling
    // back to the old execCommand technique (a temporary, off-screen, selected textarea) covers
    // that case too, so "copy" works the same regardless of how the page was loaded.
    async function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (error) {
                // Fall through to the execCommand fallback below.
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

    // Marks every step up to (and excluding) `phase` "done", `phase` itself "active" (or "failed"),
    // and leaves the rest untouched — mirrors the design-system mockup's own stepper state machine.
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

    // Verb prefix for the live "{verb} rows · N / M" speed-line label — "Committing" names the real
    // guarantee ImportAtomicCommitRunner makes (one transaction, whole file), "Validating" is the
    // dry-run Preview phase. Stashed on the speed-line's own dataset (see buildRowProgressPlaceholder)
    // so updateRowProgress can keep reusing it on every tick without needing the phase threaded
    // through the whole poll/SSE call chain.
    function phaseVerb(phase) {
        return phase === "committing" ? "Committing" : "Validating";
    }

    // Builds the "pipeline" view shown while a /process or /commit job runs: a phase stepper, a
    // speed line + thin progress bar, a Processed/Valid/Invalid tally row, an (initially empty)
    // chunk-lane grid — see updateLanes(), which lazily builds the lane/chunk DOM the first time a
    // poll response actually carries chunk data (SSE progress events don't carry it; see
    // updateRowProgress()) — and an (initially empty) live invalid-rows slot, filled in by
    // renderLiveInvalidRows() as the backend's own chunk engine actually finds bad rows (see
    // ImportProcessingService.RowResultListener) — never a guess, and never a row that later turns
    // out fine. Shared between the Validate and Commit phases — both are the same chunked row engine
    // under the hood (ImportProcessingService.run), just dryRun vs real — so they get the same live
    // UI, only the label/stepper-phase differ.
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

    // Rebuilds the live invalid-rows slot from state.liveInvalidRows (a ProcessStatusResponse/
    // CommitStatusResponse field, appended to server-side as ImportProcessingService's chunk engine
    // actually finds a bad row — see ImportProcessJobTracker#liveInvalidRows) whenever its length has
    // grown since the last render. Reuses buildRowTr/buildRowTableHead — the exact same status-badge/
    // error-tooltip rendering as the post-run review table (buildValidationTable) — so a row looks
    // identical whether it appeared here live or in the final results. Headers aren't known up front
    // (unlike the post-run table, which has processResult.headers) — derived from the first row's own
    // data keys instead, since ImportChunkRowProcessor always populates that map in column order.
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

    // Lazily builds one lane row per worker + one chunk cell per chunk (first call only — chunk
    // count/lanes never change mid-job), then updates every chunk's fill width + status class on
    // every call. `chunks`/`workerCount` come straight from ImportProcessJobTracker.ChunkSlot via
    // ProcessStatusResponse/CommitStatusResponse — real per-chunk state, not a simulated animation.
    // Chunk status strings ("running"/"passed"/"flagged"/"aborted") match the CSS classes 1:1 — see
    // ImportValidationRunner/ImportAtomicCommitRunner's chunkProgressListener calls.
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

    // Live rows-processed label/%/bar + tally tiles + invalid-row list, driven by each GET .../status
    // poll — see pollJobStatus()/showValidation()/runImport() below. Unlike the old static phase
    // label, `label` is rewritten every tick with the live processed/total count; `phaseStartTime` is
    // a performance.now() timestamp taken when this phase's polling began, used to derive rows/sec and
    // an ETA the same way the upload bar derives bytes/sec. `chunks`/`workerCount` are only present on
    // poll responses (not SSE progress events, see openLiveProgress) — guarded so an SSE-driven call
    // simply leaves the lanes at whatever the last poll left them.
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

        // liveInvalidRows is only present on poll responses (not SSE progress events, same as
        // chunks/workerCount above) — an SSE-driven call simply leaves this slot at whatever the last
        // poll left it.
        if (Array.isArray(liveInvalidRows)) {
            renderLiveInvalidRows(liveInvalidRows);
        }

        if (Array.isArray(chunks) && chunks.length) {
            updateLanes(workerCount || 1, chunks);
        }
    }

    // Surfaces an upload/validation failure (bad file type, column mismatch, server error, etc.)
    // directly in the Data Preview card so the user sees exactly what went wrong without having
    // to catch the transient banner message.
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

    // ---------- Upload (live speed bar) ----------

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

    // `fileLabel` (name + size) is set once up front and never changes during the upload — only
    // label/barInner/detail are updated live as progress events arrive (see the upload button
    // handler below).
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

    /**
     * Uploads via XMLHttpRequest (not fetch) so upload progress events are available to drive a
     * live speed bar. Also registered as activeXhr so the "×" button can call xhr.abort() directly
     * to actually stop an in-flight upload, not just stop waiting for it.
     */
    function uploadFileWithProgress(tableKey, file, onProgress, sheetIndex) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            formData.append("tableKey", tableKey);
            formData.append("file", file);
            // Only ever set on the retry after the server rejected an ambiguous multi-sheet workbook
            // with the sheet list (see the "more than one sheet with data" handling in uploadBtn's
            // click handler) — omitted on every normal upload, matching "ask, never silently guess".
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

    // Live "N / M rows · rate · time left" readout for the post-byte-transfer processing gap (see
    // onUploadProgress's percent >= 100 branch) — driven by real processedRows/totalRows from
    // GET /upload/{id}/status (see runUploadJob's onRowParsed callback server-side), not a
    // time-based simulation. Same rate/ETA math as updateRowProgress uses for Validate/Commit, just
    // targeting the simple upload-progress UI's own label/bar/detail instead of the full pipeline
    // view. `totalRows` stays 0 for a brief moment at the very start (the server is still scanning
    // the file/counting rows) — left on the indeterminate "Processing file…" state from
    // onUploadProgress until a real total is known.
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

    // Uploads the file's bytes (live speed bar via onUploadProgress), then polls the background
    // parse/store job's own status (live rows/ETA via updateUploadProcessingProgress) until it
    // finishes — the two phases the browser's upload bar alone can't distinguish between (see
    // onUploadProgress's own comment). Split out so the sheet-index retry below can re-run the whole
    // thing with `sheetIndex` set without duplicating either half.
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

    // Shows the row's error (what's wrong + how to fix it) on hover, and lets the user click to
    // copy that same text — hovering only lets you read it, but the message is often what needs to
    // go into a Slack message or ticket, so it needs to be copyable, not just visible.
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

    // ---------- Validation (Invalid/Duplicate rows only) ----------

    // Only rows with a problem are worth reviewing here — clean rows import silently.
    function filteredRows() {
        return processResult.rows.filter((row) => row.status !== "VALID");
    }

    // One row as a <tr>: a Status badge cell, then one cell per header — the cell matching
    // row.errorColumn (if any) gets a red highlight + an (!) icon carrying the full "what's wrong /
    // how to fix it" text as a hover tooltip (click to copy). Shared by the normal Validate review
    // table and the hard-stop (10-invalid-row cap) table below, so both point at exactly the same
    // row+column+reason with the same visual symbol instead of two different presentations of the
    // same underlying RowResultResponse shape.
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

    // Renders the invalid/duplicate preview rows, capped at TABLE_ROW_CAP for render performance;
    // invalid cells get a tooltip icon explaining what's wrong and how to fix it.
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

    // Builds the whole preview card: summary tiles, All/Valid/Invalid tabs, search box, the row
    // table (invalid/duplicate rows only), and the final "Import Data" button.
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
        // Built dynamically (never static HTML — see this function's own header comment), so it
        // can't ship `hidden` in markup the way every other data-permission element on this page
        // does; gated here instead, against knownPermissions (already resolved by the time a real
        // upload gets this far — validating a file takes far longer than one /api/auth/me fetch).
        // Section-level only ("page:data-upload.upload-verify" — the whole "2. Upload and Verify"
        // Section covers upload/verify/commit together, no separate Feature-level key exists for
        // commit specifically — see AuthBootstrapSeeder's own header comment).
        importBtn.hidden = !knownPermissions.has("page:data-upload.upload-verify");
        wrap.appendChild(importBtn);

        return wrap;
    }

    function renderValidation(session, result) {
        progressInner.replaceChildren(buildValidationContent(session, result));
    }

    // ---------- Invalid-row-limit hard stop (10 invalid rows, see ImportLimits.MAX_INVALID_ROWS) ----------

    // Same Status+columns table the normal Validate review uses (see buildRowTr/buildRowTableHead) —
    // same red-highlighted cell + (!) icon (hover for the reason, click to copy) marking exactly
    // which column is wrong on exactly which row — with an ellipsis row separating the leading rows
    // from the 10th (final) one, matching ImportLimits.DISPLAYED_LEADING_ERRORS/MAX_INVALID_ROWS.
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

    // Renders the hard-stop display for a validation attempt that hit the 10-invalid-row cap — the
    // same row/column table the normal review uses (not a bare "Row N — reason" list), so exactly
    // which row and which column is wrong is visible at a glance via the same red-highlight + (!)
    // symbol. Still no Import button: the whole upload failed and nothing was imported, so the only
    // next step is fixing the file and uploading it again. `result.headers` is only present when
    // this is called from a Preview run (ValidationResultResponse) — a commit-time re-validation cap
    // hit (CommitResultResponse) carries no headers of its own, so it falls back to the last known
    // Preview headers (processResult), which are the same table's columns either way.
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

    // ---------- Download the full data set (valid + invalid together, invalid cells in red) ----------

    // Shows/hides the download button based on whether the currently-displayed Data Preview result
    // actually has anything non-valid to export — hidden while idle/running, and after a file
    // validates completely clean (nothing to review, so nothing to download either).
    function updateDownloadButtonVisibility() {
        const hasIssues = !!processResult && (processResult.invalidRowLimitReached
            || (processResult.invalidRows ?? 0) > 0 || (processResult.duplicateRows ?? 0) > 0);
        downloadBtn.hidden = !hasIssues;
    }

    // Single click, single result: ignores the normal fail-fast invalid-row budget and re-validates
    // the entire file (see POST .../full-scan) so every row — not just the handful the original
    // Preview run stopped at — is accounted for, then downloads the whole data set as one .xlsx (see
    // ImportSessionResponseBuilder#writeFullDatasetWorkbook): every row, valid and invalid together,
    // with each invalid row's own offending cell in red text — no separate "shown rows" vs. "full
    // file" choice per explicit request.
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

    // A sleep(ms) that can be cut short by calling the returned wake() — lets an SSE "done" push (see
    // openLiveProgress's wakeupRef param) skip whatever's left of the current poll interval instead of
    // waiting it out. This is not just a nice-to-have: confirmed live that a browser clamps a
    // backgrounded/inactive tab's setTimeout to firing roughly once per second NO MATTER what interval
    // is requested — POLL_INTERVAL_MS below can say 150ms all it wants, but once that clamp kicks in, a
    // plain sleep() silently turns into a ~1s wait regardless. SSE message delivery isn't subject to
    // that same timer throttling, so waking the loop from it is what actually keeps the gap short.
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

    // CHANGED (this turn): was reading POST /process's response body as an NDJSON stream (one line
    // per chunk) for live progress. Reverted after confirming live in Chrome — with both fetch()'s
    // ReadableStream reader and XMLHttpRequest's onprogress/responseText, on a clean tab — that the
    // browser fully buffers this kind of slow-trickle response and delivers nothing to page JS
    // until the connection is nearly closed, no matter how the server flushes it: the "live" bar
    // never actually moved for any file big enough for the difference to matter. POST /process (and
    // POST /commit) now just kick the work off server-side and return immediately; this polls the
    // small, complete-each-time GET .../status response instead, which isn't a slow trickle and so
    // isn't subject to the same buffering. Shared verbatim between Validate and Commit — both are
    // backed by the identical job-tracker shape (status/processedRows/totalRows/insertedSoFar/
    // duplicatesSoFar/errorsSoFar/result/errorMessage), just against a different statusUrl.
    //
    // Live progress on top of that polling floor: GET .../events is a real Server-Sent Events stream
    // (see ImportSseEmitterRegistry), not the same kind of plain chunked response the NDJSON attempt
    // above ran into — a browser's EventSource has its own incremental text/event-stream parser that
    // delivers each event the moment it arrives, so it doesn't hit the whole-response buffering that
    // sank the earlier attempt. openLiveProgress layers this in as a pure accelerant: every event it
    // gets calls the exact same onProgress callback pollJobStatus's own loop already calls, so if a
    // corporate proxy strips SSE, the stream never connects, or it drops mid-run, nothing breaks — the
    // polling loop below is still the one actually driving completion/result/error handling and was
    // always going to repaint the bar on its own next tick regardless.
    //
    // `wakeupRef` (a plain { current } holder pollJobStatus keeps pointed at its own current
    // interruptibleSleep's wake, see below) is what makes the "done" push actually matter rather than
    // just being a slightly-earlier repaint: calling it short-circuits whatever's left of the poll
    // loop's current wait — the one thing a browser's backgrounded-tab timer throttling can't touch,
    // since that clamp applies to setTimeout, not to incoming SSE messages.
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
                // Malformed/unexpected payload — ignore, the polling loop still has the real state.
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
    // A stale-result sentinel, thrown when the token no longer matches operationToken (the user
    // cancelled or started a fresh upload while this chain was still in flight) — callers catch it
    // and simply do nothing further, since the UI has already moved on.
    const CANCELLED = Symbol("cancelled");

    // How long pollJobStatus waits between checks. Every phase transition (upload processing ->
    // Validate, Validate -> the review table or straight to Commit, Commit -> Committed) goes through
    // this same loop, so this one constant is what actually decides the worst-case "hold" between a
    // job finishing server-side and the UI noticing — e.g. a job that finishes 1ms after a poll comes
    // back RUNNING previously sat there for up to 400ms before the next check saw DONE. Lowered from
    // 400ms so every one of those transitions starts sooner, without touching any of the job/validation
    // logic itself — this only changes how often the client asks, never what it does with the answer.
    const POLL_INTERVAL_MS = 150;

    // `wakeupRef`, when passed, is kept pointed at the current wait's wake() (see interruptibleSleep)
    // so openLiveProgress's SSE "done" handler can cut it short — see that function's own comment for
    // why this matters more than a shorter POLL_INTERVAL_MS alone can (browser timer throttling).
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

    // Calls Preview (dry-run) and decides whether the user needs to review anything before import.
    async function showValidation(session, token) {
        currentSession = session;
        activeAbortController = new AbortController();
        const signal = activeAbortController.signal;

        // Validating a file means real (rolled-back) DB inserts under the hood, which takes a
        // moment for larger files — show the card with a live progress bar right away instead of
        // leaving it hidden with no feedback until the request resolves.
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
                // Hard stop: validation found 10 invalid rows and stopped scanning the file — the
                // whole upload failed and nothing was imported. No review table, no Import button.
                // VALIDATING -> FAILED: commit is never reachable from here (see the FSM note on
                // buildInvalidLimitContent below) — this is a dead end by design, not an oversight.
                setStage("Validation Failed");
                renderInvalidLimitReached(session, result);
                if (onValidated) {
                    onValidated(session);
                }
                return;
            }

            const hasIssues = (result.invalidRows ?? 0) > 0 || (result.duplicateRows ?? 0) > 0;
            if (hasIssues) {
                // VALIDATING -> VALIDATED: the Commit ("Import Data") button only exists inside this
                // rendered content (see buildValidationContent), so there is no control that can fire
                // a commit before this point is reached — VALIDATING -> COMMITTING directly is not
                // just discouraged, it's structurally impossible from this UI.
                setStage("Validated — Review Required");
                renderValidation(session, result);
                if (onValidated) {
                    onValidated(session);
                }
            } else {
                // Everything's clean — skip the review step and go straight to Commit (runImport sets
                // its own "Committing" stage/progress and hides the card on success). Still strictly
                // VALIDATING -> VALIDATED -> COMMITTING, just without a manual click in between.
                await runImport(session, null, token);
            }
        } catch (error) {
            if (error === CANCELLED || token !== operationToken) {
                return;
            }
            // The validation request itself failed — that's an error condition too, so surface it.
            showErrorCard(error.message || "Unable to validate the uploaded data.");
        } finally {
            closeLiveProgress();
        }
    }

    // ---------- Import (saves directly to the database) ----------

    // Calls Commit (the real insert) and resets the form on success. `btn` is null for the
    // auto-import path (no review button to disable). CHANGED (this turn): commit now runs as a
    // background job polled the same way as Validate (see pollJobStatus) instead of one long
    // synchronous request, so a big file's atomic insert gets the same live bar/%/speed feedback
    // in the Data Preview card instead of a static "Importing data…" placeholder.
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
            // The whole commit is one atomic transaction (see ImportProcessingService) — a fresh
            // re-validation at commit time can still hit the invalid-row cap (e.g. another upload
            // changed the table since Preview ran), in which case NOTHING was imported even though
            // the job itself completed normally (status "DONE", result.status "Failed").
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
            // Errors surface in the Data Preview card, not the Upload Data banner.
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

    // Parses ImportSessionController#resolveSheetIndex's "more than one sheet with data" message
    // (the only 400 this specific wording can come from) into its "index:name (N rows)" options and
    // asks the user to pick one, returning the chosen index — or null if this wasn't that error, or
    // the user cancelled the prompt, in which case the caller re-throws the original error as-is.
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

        // A fresh upload always starts a new cancellation "generation" — any earlier chain that's
        // still winding down (e.g. the user re-uploads right after cancelling) becomes stale and
        // goes silent as soon as it next checks its token.
        const token = ++operationToken;

        uploadBtn.disabled = true;
        // CHANGED (this turn): the live upload speed bar used to render in the left Upload card's
        // own slot, separate from the Data Preview card. Moved into the Data Preview card (shown
        // immediately, before the request even starts) so upload/validate/commit all report live
        // progress in the same place instead of two.
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
                // xhr.upload's progress event only tracks bytes hitting the wire — it hits 100% as
                // soon as the browser finishes sending, well before the server responds. The actual
                // xhr "load" event (see uploadFileWithProgress) doesn't fire until the server has
                // also scanned, parsed and stored the file, which for a large workbook can take a
                // while with zero further progress events in between. Without this, the bar just sat
                // at a static "Uploading… 100%" for that whole gap, reading as a hang. Switching to
                // an explicit "processing" state (indeterminate stripes, see the .processing rule in
                // DataUploadPage.css) makes clear something is still happening on the server.
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
                // The server never silently guesses a sheet — see ImportSessionController#upload,
                // #resolveSheetIndex and runUploadJob — it fails the background job with the sheet
                // list instead (surfaced here as this poll's error). Ask the user which one, then
                // retry the same file (a fresh upload — bytes and all) with that choice attached.
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
                // Cancelled via the "×" button (which already reset the UI) — nothing left to show.
                return;
            }
            // Errors surface in the Data Preview card, not the Upload Data banner.
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

    // Actually stops whatever's currently uploading/validating/committing — not just resetting the
    // UI while the work keeps running unseen. Bumps operationToken first so every in-flight step of
    // the chain (each one checks its own snapshot against the live value after every await) goes
    // silent on its very next check, aborts the live upload XHR or fetch so the browser stops
    // sending/waiting on it, and — since validation and commit both run server-side independent of
    // this request once started — tells the server to stop too via /cancel, so the underlying
    // ImportProcessingService loop stops at its next chunk boundary instead of grinding on unseen.
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

    // The Data Preview card's own "×" — completely cancels whatever's currently uploading,
    // validating, or importing (see cancelCurrentOperation) and lets the user start clean, without
    // waiting for it to finish or fail first. Navigating to a different page instead leaves the
    // same in-progress work running server-side to completion — only this explicit close cancels it.
    progressResetBtn.addEventListener("click", () => {
        cancelCurrentOperation();
        clearTimeout(messageTimeout);
        message.textContent = "";
        message.className = "file-import-message";
        reset();
    });

    return { selectTable, reset };
}

// Renders the Upload History / Queue table and its file preview modal.
// Backed by ImportSessionController's list/preview endpoints.
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
        // "committing" is checked before the "commit" substring test below on purpose — it would
        // otherwise false-positive-match "commit" and show as complete (green) while actually still
        // in progress. "validating" doesn't have that collision but is listed alongside it for
        // clarity — both fall through to the same in-progress (amber) styling as "pending".
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

    // Fetches a file endpoint as a blob and triggers a browser download — used for both the
    // original-file re-download and the history-log export, which use the same Content-Disposition
    // filename convention.
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

    // Opens the modal and loads the stored file's own columns/rows (not the import result) —
    // i.e. exactly what's on disk, via GET /api/import-sessions/{id}/preview.
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

    // One history table row per session, with a "View" button opening the file preview.
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

    // Fetches every session and re-renders the table, newest first.
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

// ==================== Page wiring ====================
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
