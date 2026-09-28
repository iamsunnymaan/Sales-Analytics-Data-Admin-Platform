const PANEL_MARKUP_URL = "/components/QuickAccessPanel/QuickAccessPanel.html";


const THEME_STORAGE_KEY = "hob-theme";


const NOTES_STORAGE_KEY = "hob-notes";


const NOTES_ALERTS_ENABLED_KEY = "hob-notes-alerts-enabled";

function isDarkTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark";
}

function applyTheme(theme) {
    if (theme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
    } else {
        document.documentElement.removeAttribute("data-theme");
    }
}

function updateThemeButton(btn) {
    const dark = isDarkTheme();
    btn.setAttribute("aria-pressed", String(dark));
    const label = dark ? "Switch to day mode" : "Switch to night mode";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = dark ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';
}

function wireThemeToggle(panel) {
    const btn = panel.querySelector("#quickAccessThemeToggle");
    if (!btn) {
        return;
    }
    updateThemeButton(btn);
    btn.addEventListener("click", () => {
        const next = isDarkTheme() ? "light" : "dark";
        applyTheme(next);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch (error) {

        }
        updateThemeButton(btn);

        window.dispatchEvent(new CustomEvent("theme-changed", { detail: { dark: next === "dark" } }));
    });
}

async function renderPanel(panel) {
    try {
        const response = await fetch(PANEL_MARKUP_URL);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        panel.innerHTML = await response.text();
    } catch (error) {

    }
}


const AUTO_CLOSE_IDLE_MS = 6000;

function wirePanel(panel) {
    const toggle = panel.querySelector("#quickAccessToggle");
    if (!toggle) {
        return;
    }

    let idleTimer = null;

    function clearIdleTimer() {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }
    }

    function closePanel() {
        if (!panel.classList.contains("open")) {
            return;
        }
        clearIdleTimer();
        panel.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open quick access panel");
    }

    function resetIdleTimer() {
        clearIdleTimer();
        idleTimer = setTimeout(closePanel, AUTO_CLOSE_IDLE_MS);
    }

    function openPanel() {
        panel.classList.add("open");
        toggle.setAttribute("aria-expanded", "true");
        toggle.setAttribute("aria-label", "Close quick access panel");
        resetIdleTimer();
    }

    toggle.addEventListener("click", () => {
        if (panel.classList.contains("open")) {
            closePanel();
        } else {
            openPanel();
        }
    });


    document.addEventListener("click", (event) => {
        if (panel.classList.contains("open") && !panel.contains(event.target)) {
            closePanel();
        }
    });


    window.addEventListener("scroll", () => {
        if (panel.classList.contains("open")) {
            closePanel();
        }
    }, { passive: true });


    panel.addEventListener("click", () => {
        if (panel.classList.contains("open")) {
            resetIdleTimer();
        }
    });
    panel.addEventListener("keydown", () => {
        if (panel.classList.contains("open")) {
            resetIdleTimer();
        }
    });

    wireThemeToggle(panel);
}

function formatProjectionValue(value) {
    const num = Number(value ?? 0);
    return `₹${num.toLocaleString("en-IN")}`;
}

function formatSubmittedAt(value) {
    if (!value) {
        return "—";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
}


function wireTopProjectionModal(openBtn) {
    const backdrop = document.getElementById("topProjectionModalBackdrop");
    if (!backdrop || !openBtn) {
        return;
    }

    const closeBtn = document.getElementById("topProjectionModalClose");
    const monthLabel = document.getElementById("topProjectionModalMonth");
    const brandToggle = document.getElementById("topProjectionBrandToggle");
    const channelToggle = document.getElementById("topProjectionChannelToggle");
    const saleTypeToggle = document.getElementById("topProjectionSaleTypeToggle");
    const gridBody = document.getElementById("topProjectionGridBody");
    const totalEl = document.getElementById("topProjectionGridTotal");
    const lastValueTotalEl = document.getElementById("topProjectionGridLastValueTotal");
    const statusEl = document.getElementById("topProjectionStatus");
    const errorEl = document.getElementById("topProjectionError");
    const submitBtn = document.getElementById("topProjectionSubmitBtn");

    let activeBrand = "all";
    let activeChannel = "all";

    let currentRows = [];


    function rowKey(row) {
        return `${row.brand}|${row.channel}|${row.subChannel}|${row.partner}`;
    }


    function brandNameToCode(label) {
        const normalized = label.trim().toLowerCase();
        if (normalized === "anastasia beverly hills") {
            return "abh";
        }
        if (normalized === "kylie cosmetics") {
            return "kylie";
        }
        return normalized;
    }


    async function loadBrandOptions() {
        if (!brandToggle) {
            return;
        }
        let brands = [];
        try {
            const res = await fetch("/api/primary-sales/brands");
            if (res.ok) {
                const data = await res.json();
                brands = Array.isArray(data) ? data : [];
            }
        } catch (error) {

        }
        if (!brands.length) {
            brandToggle.innerHTML = `<span class="top-projection-brand-toggle-item top-projection-brand-toggle-empty">Not Available</span>`;
            return;
        }
        brandToggle.innerHTML = ["all", ...brands].map((b) => {
            const code = b === "all" ? "all" : brandNameToCode(b);
            const active = code === activeBrand ? " active" : "";
            return `<button type="button" class="top-projection-brand-toggle-item${active}" data-brand="${code}">${b === "all" ? "All" : b}</button>`;
        }).join("");
        wireBrandToggleButtons();
    }

    function wireBrandToggleButtons() {
        brandToggle?.querySelectorAll(".top-projection-brand-toggle-item").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (btn.classList.contains("active")) {
                    return;
                }
                brandToggle.querySelectorAll(".top-projection-brand-toggle-item").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                activeBrand = btn.dataset.brand;
                loadGrid();
            });
        });
    }


    async function loadChannelOptions() {
        if (!channelToggle) {
            return;
        }
        let channels = [];
        try {
            const res = await fetch("/api/top-projection/channels");
            if (!res.ok) {
                throw new Error("Failed to load channel options.");
            }
            channels = await res.json() ?? [];
        } catch (error) {
            channels = [];
        }
        if (!channels.length) {
            channelToggle.innerHTML = `<span class="top-projection-brand-toggle-item top-projection-brand-toggle-empty">Not Available</span>`;
            return;
        }
        channelToggle.innerHTML = ["all", ...channels].map((ch) => {
            const active = ch === activeChannel ? " active" : "";
            return `<button type="button" class="top-projection-brand-toggle-item${active}" data-channel="${ch}">${ch === "all" ? "All" : ch}</button>`;
        }).join("");
        wireChannelToggleButtons();
    }

    function wireChannelToggleButtons() {
        channelToggle?.querySelectorAll(".top-projection-brand-toggle-item").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (btn.classList.contains("active")) {
                    return;
                }
                channelToggle.querySelectorAll(".top-projection-brand-toggle-item").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                activeChannel = btn.dataset.channel;
                loadGrid();
            });
        });
    }


    async function loadSaleTypeOptions() {
        if (!saleTypeToggle) {
            return;
        }
        let saleTypes = [];
        try {
            const res = await fetch("/api/top-projection/sale-types");
            if (!res.ok) {
                throw new Error("Failed to load sale type options.");
            }
            saleTypes = await res.json() ?? [];
        } catch (error) {
            saleTypes = [];
        }
        if (!saleTypes.length) {
            saleTypeToggle.innerHTML = `<span class="top-projection-brand-toggle-item top-projection-brand-toggle-empty">Not Available</span>`;
            return;
        }
        saleTypeToggle.innerHTML = saleTypes.map((type) => {
            const active = type === "Primary Sales" ? " active" : "";
            return `<button type="button" class="top-projection-brand-toggle-item${active}" data-sale-type="${type}" disabled>${type}</button>`;
        }).join("");
    }


    function computeChangeInfo(previousRows, newRows) {
        const previousByKey = new Map(previousRows.map((row) => [rowKey(row), row]));
        const info = new Map();
        newRows.forEach((row) => {
            const previous = previousByKey.get(rowKey(row));
            if (!previous || previous.id == null) {
                info.set(rowKey(row), "new");
            } else if (Number(previous.lastValue ?? 0) !== Number(row.lastValue ?? 0)) {
                info.set(rowKey(row), "updated");
            }
        });
        return info;
    }

    function showError(message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }

    function clearError() {
        errorEl.hidden = true;
        errorEl.textContent = "";
    }

    function showStatus(message) {
        statusEl.textContent = message;
        statusEl.hidden = false;
    }

    function clearStatus() {
        statusEl.hidden = true;
        statusEl.textContent = "";
    }


    function recomputeTotal() {
        let sum = 0;
        gridBody.querySelectorAll(".top-projection-grid-value-input").forEach((input) => {
            const num = Number(input.value);
            if (Number.isFinite(num)) {
                sum += num;
            }
        });
        totalEl.textContent = formatProjectionValue(sum);
    }


    function recomputeLastValueTotal() {
        if (!lastValueTotalEl) {
            return;
        }
        const sum = currentRows.reduce((acc, row) => acc + Number(row.lastValue ?? 0), 0);
        lastValueTotalEl.textContent = formatProjectionValue(sum);
    }


    function renderRows(rows, monthText, changeInfo) {
        currentRows = rows;
        if (!rows.length) {
            gridBody.innerHTML = `<tr><td colspan="9" class="top-projection-grid-empty">No channels/partners for this brand.</td></tr>`;
            totalEl.textContent = formatProjectionValue(0);
            recomputeLastValueTotal();
            return;
        }
        gridBody.innerHTML = rows.map((row, idx) => {
            const change = changeInfo ? changeInfo.get(rowKey(row)) : null;
            const rowClass = change ? ` class="top-projection-grid-row--${change}"` : "";
            const tag = change
                ? `<span class="top-projection-grid-tag top-projection-grid-tag--${change}">${change === "new" ? "New" : "Updated"}</span>`
                : "";
            return `
            <tr${rowClass}>
                <td>${idx + 1}</td>
                <td>${row.brand}</td>
                <td>${row.channel}</td>
                <td>${row.subChannel}</td>
                <td>${row.partner}</td>
                <td>${monthText}</td>
                <td>
                    <input type="number" class="top-projection-grid-value-input" min="0" step="0.01"
                        data-row-index="${idx}" value="" placeholder="Enter value">
                    ${tag}
                </td>
                <td>${row.lastValue == null ? "—" : formatProjectionValue(row.lastValue)}</td>
                <td>${formatSubmittedAt(row.submittedAt)}</td>
            </tr>`;
        }).join("");
        gridBody.querySelectorAll(".top-projection-grid-value-input").forEach((input) => {
            input.addEventListener("input", recomputeTotal);
        });
        recomputeTotal();
        recomputeLastValueTotal();
    }


    async function loadGrid(diffAgainst) {
        clearError();
        if (!diffAgainst) {
            clearStatus();
        }

        const isRefresh = currentRows.length > 0;
        if (isRefresh) {
            gridBody.classList.add("top-projection-grid-body--loading");
        } else {
            gridBody.innerHTML = `<tr><td colspan="9" class="top-projection-grid-empty">Loading…</td></tr>`;
        }
        try {
            const res = await fetch(`/api/top-projection/grid?brand=${encodeURIComponent(activeBrand)}&channel=${encodeURIComponent(activeChannel)}`);
            if (!res.ok) {
                throw new Error("Failed to load the projection grid.");
            }
            const data = await res.json();
            const monthText = data.currentMonthLabel ?? "—";
            monthLabel.textContent = monthText;
            const rows = data.rows ?? [];
            renderRows(rows, monthText, diffAgainst ? computeChangeInfo(diffAgainst, rows) : null);
        } catch (error) {
            gridBody.innerHTML = "";
            showError(error.message || "Unable to load the projection grid. Try closing and reopening.");
        } finally {
            if (isRefresh) {
                requestAnimationFrame(() => gridBody.classList.remove("top-projection-grid-body--loading"));
            }
        }
    }

    function openModal() {
        activeBrand = "all";
        activeChannel = "all";
        backdrop.hidden = false;
        Promise.all([loadBrandOptions(), loadChannelOptions(), loadSaleTypeOptions()]).then(() => loadGrid());
    }

    function closeModal() {
        backdrop.hidden = true;
    }

    openBtn.addEventListener("click", () => {
        if (backdrop.hidden) {
            openModal();
        } else {
            closeModal();
        }
    });

    closeBtn?.addEventListener("click", closeModal);

    backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
            closeModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !backdrop.hidden) {
            closeModal();
        }
    });

    submitBtn.addEventListener("click", async () => {
        clearError();
        clearStatus();
        const inputs = gridBody.querySelectorAll(".top-projection-grid-value-input");
        if (!inputs.length) {
            return;
        }

        const rowsToSave = [];
        for (const input of inputs) {
            const row = currentRows[Number(input.dataset.rowIndex)];
            if (!row) {
                continue;
            }
            const raw = input.value.trim();

            if (raw === "") {
                continue;
            }
            const numericValue = Number(raw);
            if (!Number.isFinite(numericValue) || numericValue < 0) {
                showError(`Enter a valid Projection Value (0 or greater) for ${row.brand} / ${row.channel} / ${row.subChannel} / ${row.partner}.`);
                input.focus();
                return;
            }
            rowsToSave.push({
                brand: row.brand, channel: row.channel, subChannel: row.subChannel, partner: row.partner,
                projectionValue: numericValue,
            });
        }

        if (!rowsToSave.length) {
            showError("Enter at least one Projection Value before submitting.");
            return;
        }


        const previousRows = currentRows;

        submitBtn.disabled = true;
        try {
            const res = await fetch("/api/top-projection/grid", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows: rowsToSave }),
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(result.message || "Failed to save projections.");
            }
            showStatus(`Saved ${rowsToSave.length} projection${rowsToSave.length === 1 ? "" : "s"} for ${monthLabel.textContent}.`);
            await loadGrid(previousRows);

            window.dispatchEvent(new CustomEvent("top-projection-saved"));
        } catch (error) {
            showError(error.message || "Failed to save projections.");
        } finally {
            submitBtn.disabled = false;
        }
    });
}

function loadNotes() {
    try {
        const raw = localStorage.getItem(NOTES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {

        return [];
    }
}

function saveNotes(notes) {
    try {
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    } catch (error) {

    }
}

function generateNoteId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `n${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}


function wireNotesModal(openBtn) {
    const backdrop = document.getElementById("notesModalBackdrop");
    if (!backdrop || !openBtn) {
        return;
    }


    const MAX_CONTENT_WORDS = 50;

    const closeBtn = document.getElementById("notesModalClose");
    const newBtn = document.getElementById("notesNewBtn");
    const backBtn = document.getElementById("notesBackBtn");
    const titleEl = document.getElementById("notesModalTitle");
    const listView = document.getElementById("notesListView");
    const editorView = document.getElementById("notesEditorView");
    const listEl = document.getElementById("notesList");
    const listEmptyEl = document.getElementById("notesListEmpty");
    const titleInput = document.getElementById("notesEditorTitle");
    const contentInput = document.getElementById("notesEditorContent");
    const wordCountEl = document.getElementById("notesEditorWordCount");
    const dueDateInput = document.getElementById("notesEditorDueDate");
    const reminderInput = document.getElementById("notesEditorReminder");
    const metaEl = document.getElementById("notesEditorMeta");
    const saveBtn = document.getElementById("notesSaveBtn");
    const pinBtn = document.getElementById("notesEditorPinBtn");
    const deleteBtn = document.getElementById("notesEditorDeleteBtn");
    const notifyBtn = document.getElementById("notesEditorNotifyBtn");
    const savedBadge = document.getElementById("notesSavedBadge");
    const toast = document.getElementById("notesReminderToast");
    const toastText = document.getElementById("notesReminderToastText");
    const toastCloseBtn = document.getElementById("notesReminderToastClose");

    let notes = loadNotes();

    let activeId = null;
    let saveDebounce = null;
    let savedBadgeTimeout = null;
    let toastTimeout = null;
    let toastNoteId = null;

    function persist() {
        saveNotes(notes);
    }


    function formatDateTime(iso) {
        if (!iso) {
            return "";
        }
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) {
            return "";
        }
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }


    function formatDueDate(dateStr) {
        if (!dateStr) {
            return "";
        }
        const [y, m, d] = dateStr.split("-");
        return `${d}-${m}-${y}`;
    }

    function isOverdue(note) {
        if (!note.dueDate) {
            return false;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return new Date(`${note.dueDate}T00:00:00`).getTime() < today.getTime();
    }


    function sortedNotes() {
        return [...notes].sort((a, b) => {
            if (a.pinned !== b.pinned) {
                return a.pinned ? -1 : 1;
            }
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
    }

    function updatePinBtn(note) {
        pinBtn.classList.toggle("notes-editor-pin-btn--active", note.pinned);
        pinBtn.setAttribute("aria-pressed", String(note.pinned));
        pinBtn.querySelector("i").className = note.pinned ? "bi bi-pin-fill" : "bi bi-pin-angle";
    }

    function renderMeta(note) {
        metaEl.textContent = `Created ${formatDateTime(note.createdAt)} · Updated ${formatDateTime(note.updatedAt)}`;
    }

    function renderList() {
        const sorted = sortedNotes();
        listEmptyEl.hidden = sorted.length > 0;
        listEl.replaceChildren(...(sorted.length ? [] : [listEmptyEl]));
        sorted.forEach((note) => {
            const li = document.createElement("li");
            li.className = "notes-list-item";

            const pinItemBtn = document.createElement("button");
            pinItemBtn.type = "button";
            pinItemBtn.className = "notes-list-pin-btn" + (note.pinned ? " notes-list-pin-btn--active" : "");
            pinItemBtn.title = note.pinned ? "Unpin" : "Pin";
            pinItemBtn.setAttribute("aria-label", note.pinned ? "Unpin note" : "Pin note");
            pinItemBtn.innerHTML = `<i class="bi ${note.pinned ? "bi-pin-fill" : "bi-pin-angle"}"></i>`;
            pinItemBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                togglePin(note.id);
            });

            const main = document.createElement("div");
            main.className = "notes-list-item-main";

            const titleDiv = document.createElement("div");
            titleDiv.className = "notes-list-item-title";
            titleDiv.textContent = note.title || "(Untitled)";

            const snippetDiv = document.createElement("div");
            snippetDiv.className = "notes-list-item-snippet";
            snippetDiv.textContent = note.content ? note.content.slice(0, 80) : "";

            const metaRow = document.createElement("div");
            metaRow.className = "notes-list-item-meta";
            const updatedSpan = document.createElement("span");
            updatedSpan.textContent = `Updated ${formatDateTime(note.updatedAt)}`;
            metaRow.appendChild(updatedSpan);
            if (note.dueDate) {
                const dueBadge = document.createElement("span");
                dueBadge.className = "notes-due-badge" + (isOverdue(note) ? " notes-due-badge--overdue" : "");
                dueBadge.textContent = `Due ${formatDueDate(note.dueDate)}`;
                metaRow.appendChild(dueBadge);
            }
            if (note.reminderAt) {
                const reminderBadge = document.createElement("span");
                reminderBadge.className = "notes-reminder-badge";
                reminderBadge.innerHTML = `<i class="bi bi-alarm"></i> ${formatDateTime(note.reminderAt)}`;
                metaRow.appendChild(reminderBadge);
            }

            main.append(titleDiv, snippetDiv, metaRow);

            const deleteItemBtn = document.createElement("button");
            deleteItemBtn.type = "button";
            deleteItemBtn.className = "notes-list-delete-btn";
            deleteItemBtn.title = "Delete";
            deleteItemBtn.setAttribute("aria-label", "Delete note");
            deleteItemBtn.innerHTML = `<i class="bi bi-trash"></i>`;
            deleteItemBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                requestDelete(note.id);
            });

            li.append(pinItemBtn, main, deleteItemBtn);
            li.addEventListener("click", () => openEditor(note.id));
            listEl.appendChild(li);
        });
    }

    function showListView() {
        listView.hidden = false;
        editorView.hidden = true;
        backBtn.hidden = true;
        titleEl.textContent = "Notes";
        renderList();
    }

    function showEditorView(isNew) {
        listView.hidden = true;
        editorView.hidden = false;
        backBtn.hidden = false;
        titleEl.textContent = isNew ? "New Note" : "Edit Note";
    }

    function clearSavedBadgeSoon() {
        clearTimeout(savedBadgeTimeout);
        savedBadge.hidden = false;
        savedBadgeTimeout = setTimeout(() => {
            savedBadge.hidden = true;
        }, 1200);
    }

    function commitSave() {
        const note = notes.find((n) => n.id === activeId);
        if (!note) {
            return;
        }
        note.title = titleInput.value.trim();
        note.content = contentInput.value;
        note.dueDate = dueDateInput.value || null;
        const newReminder = reminderInput.value || null;
        if (newReminder !== note.reminderAt) {

            note.reminderNotified = false;
        }
        note.reminderAt = newReminder;
        note.updatedAt = new Date().toISOString();
        persist();
        renderMeta(note);
        clearSavedBadgeSoon();
    }

    function scheduleSave() {
        clearTimeout(saveDebounce);
        saveDebounce = setTimeout(commitSave, 600);
    }


    function enforceWordLimit() {
        const words = contentInput.value.trim().split(/\s+/).filter(Boolean);
        if (words.length > MAX_CONTENT_WORDS) {
            contentInput.value = words.slice(0, MAX_CONTENT_WORDS).join(" ");
        }
        const count = Math.min(words.length, MAX_CONTENT_WORDS);
        wordCountEl.textContent = `${count} / ${MAX_CONTENT_WORDS} words`;
        wordCountEl.classList.toggle("notes-editor-word-count--limit", count >= MAX_CONTENT_WORDS);
    }


    function leaveEditor() {
        if (activeId === null) {
            return;
        }
        clearTimeout(saveDebounce);
        commitSave();
        const note = notes.find((n) => n.id === activeId);
        if (note && !note.title && !note.content) {
            notes = notes.filter((n) => n.id !== activeId);
            persist();
        }
        activeId = null;
        showListView();
    }

    function openEditor(id) {
        if (activeId !== null && activeId !== id) {
            leaveEditor();
        }
        const note = notes.find((n) => n.id === id);
        if (!note) {
            return;
        }
        activeId = id;
        titleInput.value = note.title || "";
        contentInput.value = note.content || "";
        dueDateInput.value = note.dueDate || "";
        reminderInput.value = note.reminderAt || "";
        enforceWordLimit();
        updatePinBtn(note);
        renderMeta(note);
        showEditorView(false);
        titleInput.focus();
    }

    function newNote() {
        if (activeId !== null) {
            leaveEditor();
        }
        const now = new Date().toISOString();
        const note = {
            id: generateNoteId(),
            title: "",
            content: "",
            pinned: false,
            dueDate: null,
            reminderAt: null,
            reminderNotified: false,
            createdAt: now,
            updatedAt: now,
        };
        notes.push(note);
        persist();
        activeId = note.id;
        titleInput.value = "";
        contentInput.value = "";
        dueDateInput.value = "";
        reminderInput.value = "";
        enforceWordLimit();
        updatePinBtn(note);
        renderMeta(note);
        showEditorView(true);
        titleInput.focus();
    }

    function togglePin(id) {
        const note = notes.find((n) => n.id === id);
        if (!note) {
            return;
        }
        note.pinned = !note.pinned;
        note.updatedAt = new Date().toISOString();
        persist();
        if (activeId === id) {
            updatePinBtn(note);
            renderMeta(note);
        }
        if (!listView.hidden) {
            renderList();
        }
    }


    function requestDelete(id) {
        if (!window.confirm("Delete this note? This can't be undone.")) {
            return;
        }
        notes = notes.filter((n) => n.id !== id);
        persist();
        if (activeId === id) {
            activeId = null;
            showListView();
        } else {
            renderList();
        }
    }

    titleInput.addEventListener("input", scheduleSave);
    contentInput.addEventListener("input", () => {
        enforceWordLimit();
        scheduleSave();
    });
    dueDateInput.addEventListener("change", scheduleSave);
    reminderInput.addEventListener("change", scheduleSave);


    saveBtn.addEventListener("click", leaveEditor);

    pinBtn.addEventListener("click", () => {
        if (activeId !== null) {
            togglePin(activeId);
        }
    });
    deleteBtn.addEventListener("click", () => {
        if (activeId !== null) {
            requestDelete(activeId);
        }
    });
    newBtn.addEventListener("click", newNote);
    backBtn.addEventListener("click", leaveEditor);


    function isAlertsEnabled() {
        return localStorage.getItem(NOTES_ALERTS_ENABLED_KEY) === "true";
    }

    function setAlertsEnabled(enabled) {
        try {
            localStorage.setItem(NOTES_ALERTS_ENABLED_KEY, String(enabled));
        } catch (error) {

        }
    }

    function updateNotifyBtnState() {
        const supported = "Notification" in window;
        const icon = notifyBtn.querySelector("i");
        const label = notifyBtn.querySelector("span");
        if (!supported) {
            notifyBtn.disabled = true;
            notifyBtn.title = "This browser doesn't support alert notifications — you'll still get the in-app reminder popup.";
            icon.className = "bi bi-bell-slash";
            label.textContent = "Alerts Unsupported";
        } else if (Notification.permission === "denied") {
            notifyBtn.disabled = true;
            notifyBtn.title = "Notifications are blocked for this site in your browser settings — you'll still get the in-app reminder popup.";
            icon.className = "bi bi-bell-slash";
            label.textContent = "Alerts Blocked";
        } else if (Notification.permission === "granted" && isAlertsEnabled()) {
            notifyBtn.disabled = false;
            notifyBtn.title = "Click to turn browser notifications off (you'll still get the in-app reminder popup).";
            icon.className = "bi bi-bell-fill";
            label.textContent = "Alerts On";
        } else if (Notification.permission === "granted") {
            notifyBtn.disabled = false;
            notifyBtn.title = "Click to turn browser notifications back on.";
            icon.className = "bi bi-bell";
            label.textContent = "Alerts Off";
        } else {
            notifyBtn.disabled = false;
            notifyBtn.title = "Get a browser notification when a reminder is due, even if this tab isn't focused";
            icon.className = "bi bi-bell";
            label.textContent = "Enable Alerts";
        }
    }

    notifyBtn.addEventListener("click", () => {
        if (!("Notification" in window) || Notification.permission === "denied") {
            return;
        }
        if (Notification.permission === "granted") {
            setAlertsEnabled(!isAlertsEnabled());
            updateNotifyBtnState();
            return;
        }
        Notification.requestPermission().then((permission) => {
            if (permission === "granted") {
                setAlertsEnabled(true);
            }
            updateNotifyBtnState();
        });
    });
    updateNotifyBtnState();

    function openModal() {
        notes = loadNotes();
        showListView();
        backdrop.hidden = false;
    }

    function closeModal() {
        leaveEditor();
        backdrop.hidden = true;
    }

    openBtn.addEventListener("click", () => {
        if (backdrop.hidden) {
            openModal();
        } else {
            closeModal();
        }
    });
    closeBtn.addEventListener("click", closeModal);
    backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
            closeModal();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !backdrop.hidden) {
            closeModal();
        }
    });


    function fireBrowserNotification(note) {
        if (!("Notification" in window) || Notification.permission !== "granted" || !isAlertsEnabled()) {
            return;
        }
        try {

            new Notification("Note reminder", { body: note.title || "(Untitled note)" });
        } catch (error) {

        }
    }

    function showReminderToast(note) {
        toastNoteId = note.id;
        toastText.textContent = note.title || "(Untitled note)";
        toast.hidden = false;
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.hidden = true;
        }, 8000);
    }

    toast.addEventListener("click", (event) => {
        if (event.target === toastCloseBtn || toastCloseBtn.contains(event.target)) {
            return;
        }
        toast.hidden = true;
        clearTimeout(toastTimeout);
        if (toastNoteId) {
            openModal();
            openEditor(toastNoteId);
        }
    });
    toastCloseBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        toast.hidden = true;
        clearTimeout(toastTimeout);
    });


    function checkReminders() {
        const now = Date.now();
        let changed = false;
        notes.forEach((note) => {
            if (!note.reminderAt || note.reminderNotified) {
                return;
            }
            const remTime = new Date(note.reminderAt).getTime();
            if (Number.isNaN(remTime) || remTime > now) {
                return;
            }
            showReminderToast(note);
            fireBrowserNotification(note);
            note.reminderNotified = true;
            changed = true;
        });
        if (changed) {
            persist();
        }
    }

    checkReminders();
    setInterval(checkReminders, 30000);
}

export async function initQuickAccessPanel() {
    const panel = document.getElementById("quickAccessPanel");
    if (!panel) {
        return;
    }
    await renderPanel(panel);
    wirePanel(panel);


    const isPrimarySalesPage = window.location.pathname.toLowerCase().includes("/primarysalespage/");
    const topProjectionModal = panel.querySelector("#topProjectionModalBackdrop");
    if (isPrimarySalesPage) {

        if (topProjectionModal) {
            document.body.appendChild(topProjectionModal);
        }
        wireTopProjectionModal(document.getElementById("quickAccessTopProjectionBtn"));
    } else {
        document.getElementById("quickAccessTopProjectionBtn")?.remove();
        topProjectionModal?.remove();
    }

    const notesModal = panel.querySelector("#notesModalBackdrop");
    if (notesModal) {
        document.body.appendChild(notesModal);
    }

    const notesToast = panel.querySelector("#notesReminderToast");
    if (notesToast) {
        document.body.appendChild(notesToast);
    }
    wireNotesModal(document.getElementById("quickAccessNotesBtn"));
}
