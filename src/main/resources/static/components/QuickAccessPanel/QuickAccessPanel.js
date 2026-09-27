// Fetches QuickAccessPanel.html and injects it into each page's empty
// <div id="quickAccessPanel"></div> placeholder, same fetch-and-inject pattern as Sidebar.js's
// initSidebar() — the markup lives in one place instead of every page duplicating it.
//
// This wires up the open/close slide-in drawer itself, plus the two icons with real behavior:
// the day/night toggle at the bottom (#quickAccessThemeToggle, see wireThemeToggle) which flips
// the whole app's color scheme, and Notes (#quickAccessNotesBtn, see wireNotesModal) which opens
// a real popup notes list/editor.
const PANEL_MARKUP_URL = "/components/QuickAccessPanel/QuickAccessPanel.html";

// Same key the early inline <head> script on every page reads (before this component's markup
// even loads) to set data-theme before first paint and avoid a light-then-dark flash — see
// variables.css's :root[data-theme="dark"] block for the actual color overrides.
const THEME_STORAGE_KEY = "hob-theme";

// Notes persist in the browser's own localStorage — per browser/device, not shared across users
// or synced anywhere, same tradeoff THEME_STORAGE_KEY above already makes for the day/night
// preference. See wireNotesModal for the actual read/write.
const NOTES_STORAGE_KEY = "hob-notes";

// The app's OWN on/off preference for reminder Notifications — separate from (and layered on top
// of) the browser's Notification.permission, since that permission can only ever be GRANTED via
// JS, never revoked or re-requested once denied. This flag is what actually lets a user manually
// switch alerts back off after turning them on, and back on again after that, entirely under their
// own control (see updateNotifyBtnState/fireBrowserNotification in wireNotesModal).
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
            // Private-browsing/storage-disabled — theme still applies for this page view, it just
            // won't persist across navigation.
        }
        updateThemeButton(btn);
        // FIXED: switching back to day mode used to leave some canvas-rendered chart colors stuck
        // on their dark-mode values (ECharts gauges/graphs read CSS custom properties into plain
        // color strings once at load — see e.g. PrimarySalesPage.js's own GAUGE_RED/AXIS_COLOR
        // comments — so the `data-theme` attribute flip above repaints every plain CSS element
        // instantly but never touches an already-drawn canvas) until a full page reload. Any chart
        // that cares can listen for this and re-resolve its own colors + repaint with its last-known
        // data — see PrimarySalesPage.js/SecondarySalesPage.js's own "theme-changed" listeners.
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
        // Leave the panel empty rather than throwing — a missing quick-access strip is
        // recoverable, an uncaught rejection here would abort the rest of page init.
    }
}

// A left-open panel the user isn't actually using shouldn't linger — it auto-closes on whichever
// of these happens first: clicking anywhere outside it, scrolling the page, or just sitting idle
// with no interaction for AUTO_CLOSE_IDLE_MS. Any click/keypress inside the panel (using a tool,
// picking a theme) resets that idle clock instead of closing it.
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

    // Click anywhere outside the open panel closes it. Guarded by panel.contains so the very click
    // that opens it (bubbling up from the toggle tab, itself inside .quick-access-panel) doesn't
    // immediately close it again.
    document.addEventListener("click", (event) => {
        if (panel.classList.contains("open") && !panel.contains(event.target)) {
            closePanel();
        }
    });

    // Scrolling the page also closes it — it's meant to be a quick, momentary tool strip, not
    // something left hanging open while browsing the rest of the page.
    window.addEventListener("scroll", () => {
        if (panel.classList.contains("open")) {
            closePanel();
        }
    }, { passive: true });

    // Any interaction inside the open panel counts as "using it" and pushes the idle auto-close
    // back out, rather than closing on the very click that's using a tool.
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

// The Quick Access Panel's "Projection Form" popup — a fresh-entry grid (dbo.Top_Projection via
// TopProjectionController). A Brand toggle (All/ABH/Kylie) and a Channel toggle (All plus whatever
// GET /api/top-projection/channels returns — real Site_Master Channel values, loaded fresh every
// time the popup opens) up top pick which combos to show together, then a table with one row per
// real Site_Master Brand+Channel+Sub_Channel+Partner combo matching both (GET .../grid — see
// TopProjectionService#getGrid/#loadSiteCombos). Every cell except Projection Value is plain
// read-only text — that one column is always a BLANK <input> (never pre-filled with the existing
// value, so an untouched row can't be accidentally resubmitted), live-summed into the Total row on
// every keystroke (recomputeTotal); Last Value shows that combo's existing stored value, read-only,
// for reference. Submit saves only the rows that actually have a value typed in (POST .../grid,
// upserting each) — untouched rows are left alone. The CURRENT calendar month's entries here feed
// the Overview section's real "Projection" figure (see TopProjectionService's header comment); the
// table is truncated automatically at month rollover (see
// TopProjectionService#truncateIfMonthRolledOver), so it never accumulates past months. A submission
// whose combo Site_Master no longer has is pruned automatically the next time the grid loads (see
// TopProjectionService#pruneOrphanedSubmissions) — so the popup is always in sync with Site_Master
// with no extra step needed.
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
    // The exact rows the grid last rendered, in the same order the table shows them — each row's
    // <input> carries its array index (data-row-index) so Submit can pair "whatever's currently
    // typed in this box" back to that row's real Brand/Channel/Sub_Channel/Partner identity without
    // re-parsing it out of the table's own text cells.
    let currentRows = [];

    // Brand+Channel+Sub_Channel+Partner is a row's stable identity across a save — its own id goes
    // from null to a real number the first time it's ever saved, so id alone can't be used to match
    // "the same row" before vs after. Used by computeChangeInfo below to tag each row New/Updated
    // right after a save (see the submit handler).
    function rowKey(row) {
        return `${row.brand}|${row.channel}|${row.subChannel}|${row.partner}`;
    }

    // Maps a real Site_Master.Brand value ("Anastasia Beverly hills", "Kylie Cosmetics") to the short
    // code TopProjectionService/BrandFilter.normalize() actually accept ("abh"/"kylie") — same
    // conversion PrimarySalesPage.js's own brandNameToCode already does client-side. Falls back to
    // the lowercased value for any brand outside this known pair (matches BrandFilter's own
    // only-2-known-codes limitation).
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

    // Rebuilds the Brand toggle's own buttons from GET /api/primary-sales/brands — the exact same
    // real Site_Master.Brand data source (and endpoint) the Overview Insights card's own Brand pill
    // uses (see PrimarySalesPage.js's loadBrandPillOptions/renderBrandPill) — called on every
    // openModal so this popup can never show a brand Site_Master doesn't actually have data for
    // right now. Mirrors that pill's "Not Available" empty state 1:1 (same wording, same
    // non-interactive treatment, see .top-projection-brand-toggle-empty in QuickAccessPanel.css)
    // instead of falling back to any hardcoded ABH/Kylie buttons when Site_Master has no Brand data
    // at all. FIXED: this used to set data-brand to the raw Site_Master value ("Anastasia Beverly
    // hills") and send that literally as the GET .../grid brand query param — TopProjectionService's
    // brandFilter goes through the exact same BrandFilter.normalize() every other brand-filtered
    // endpoint uses, which only ever accepts "all"/"abh"/"kylie", so every real brand selection was
    // silently throwing "Invalid brand" server-side. data-brand now carries the short code
    // (brandNameToCode above); the button's own visible label still shows the real full name.
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
            // Leave `brands` empty on a transient fetch failure — same "Not Available" treatment as
            // a genuinely empty Site_Master, rather than leaving stale buttons or crashing the open.
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

    // Rebuilds the Channel toggle's own buttons from GET /api/top-projection/channels (real
    // Site_Master Channel values, e.g. Online/Offline today) — called on every openModal so the
    // toggle reflects Site_Master's current Channel vocabulary even if it changed since the popup
    // was last open. Mirrors loadBrandOptions' own "Not Available" empty state 1:1 (same wording,
    // same non-interactive treatment) whenever Site_Master has no Channel data at all OR the fetch
    // itself fails (e.g. database unreachable) — per explicit request, the synthetic "All" button
    // never renders in that case, only the real per-channel buttons do.
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

    // Rebuilds the Sale Type pill's own buttons from GET /api/top-projection/sale-types (real
    // Site_Master Sales_Type values) — per explicit request, purely informational/locked to
    // "Primary Sales" rather than an actual filter (this whole popup edits Primary_Sales_Projection,
    // permanently scoped server-side to Sales_Type = 'Primary Sales', see TopProjectionService's own
    // getGrid), so every button renders `disabled` (no click wiring at all, unlike Brand/Channel
    // above) and "Primary Sales" is always the one marked active regardless of what order the real
    // values come back in. Mirrors loadBrandOptions/loadChannelOptions' own "Not Available" empty
    // state — no synthetic "All" button — whenever Site_Master has no Sales_Type data at all OR the
    // fetch itself fails (e.g. database unreachable).
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

    // Compares the grid's state right before a save (previousRows) to what the post-save reload
    // came back with (newRows) — a row with no id before is "new" (this was its first-ever
    // submission), one whose Last Value actually differs from before is "updated"; anything else
    // (untouched, or resubmitted with the same value) gets no tag at all. Projection Value itself
    // can't be used for this comparison — it's always null in both previousRows and newRows (a
    // fresh-entry field, never returned pre-filled — see TopProjectionGridRow), so Last Value (the
    // combo's actual stored value) is what changes when a save actually lands.
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

    // Live Total — the sum of whatever every Projection Value input currently holds (not the
    // last-saved total), so it always reflects exactly what Submit would save if clicked right now.
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

    // Last Value's own Total — unlike Projection Value's, this one is static per render (Last Value
    // cells are plain read-only text, not inputs, so there's nothing to re-sum on keystroke): the
    // sum of every currently-shown row's existing stored value, treating a combo with no submission
    // yet (lastValue null) as 0, same convention formatProjectionValue itself already uses.
    function recomputeLastValueTotal() {
        if (!lastValueTotalEl) {
            return;
        }
        const sum = currentRows.reduce((acc, row) => acc + Number(row.lastValue ?? 0), 0);
        lastValueTotalEl.textContent = formatProjectionValue(sum);
    }

    // `changeInfo` (rowKey -> "new" | "updated", see computeChangeInfo) is only ever non-null right
    // after a save's reload — every other render (initial open, brand switch, Update Again) passes
    // null, so no row gets tagged.
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

    // `diffAgainst` — the grid's row snapshot from right before a save (see the submit handler) —
    // is only passed for the reload that follows a successful Save; every other call (initial open,
    // brand switch) omits it, which also clears the status line and the "just saved" New/Updated
    // tags, same as a fresh open would.
    async function loadGrid(diffAgainst) {
        clearError();
        if (!diffAgainst) {
            clearStatus();
        }
        // A refresh (brand switch/post-save reload) already has rows on screen — fade those out
        // instead of the old abrupt "Loading…" flash; a first-ever open has nothing to fade from,
        // so it keeps the plain loading row.
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
            // Blank means "leave this combo alone" (it always starts blank — see renderRows), not
            // "set it to 0" — only rows the user actually typed a value into get saved.
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

        // Snapshot of exactly what the grid showed right before this save — the reload below diffs
        // against this (see loadGrid's diffAgainst) to tag which rows actually came back New/Updated.
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
            // Lets the Primary Sales page's Insight card and Reports section pick this save up
            // instantly (no hard reload) — see PrimarySalesPage.js's own "top-projection-saved"
            // listener in Page wiring, added per explicit request.
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
        // Corrupt/unreadable storage — start clean rather than throw and break the whole popup.
        return [];
    }
}

function saveNotes(notes) {
    try {
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    } catch (error) {
        // Private-browsing/storage-disabled/full — notes still work for this page view, they just
        // won't persist across reloads, same tradeoff the theme toggle already accepts.
    }
}

function generateNoteId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `n${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

// The Quick Access Panel's "Notes" popup — create/edit/delete/pin notes with an optional due date
// and reminder, all persisted to localStorage (see loadNotes/saveNotes above), no backend involved.
// One modal, two views swapped via `hidden` (see showListView/showEditorView): a LIST (default)
// and an EDITOR (opened by "+" or by clicking a card). Editing still autosaves on a short debounce
// (scheduleSave/commitSave) as a safety net, but the explicit Save button is the actual "submit"
// action — Back/Close both flush any pending edit immediately first too (see leaveEditor), so
// nothing typed in the last <600ms is ever lost even without clicking Save.
// Reminders are checked on a 30s interval that runs regardless of whether the popup itself is
// open (checkReminders, started once below) — a due reminder raises the fixed-corner toast
// (#notesReminderToast, a sibling of this modal, not nested in it) and, only if the user has
// explicitly granted the browser permission AND left the Alerts toggle on (isAlertsEnabled — a
// fully manual on/off switch the user can flip either way at any time, see updateNotifyBtnState),
// a real Notification too.
function wireNotesModal(openBtn) {
    const backdrop = document.getElementById("notesModalBackdrop");
    if (!backdrop || !openBtn) {
        return;
    }

    // A plain maxlength on the <textarea> only caps character count, not word count, so the
    // 50-word limit is enforced by hand in enforceWordLimit below.
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
    // The note currently open in the editor, or null while the list view is showing.
    let activeId = null;
    let saveDebounce = null;
    let savedBadgeTimeout = null;
    let toastTimeout = null;
    let toastNoteId = null;

    function persist() {
        saveNotes(notes);
    }

    // DD-MM-YYYY HH:mm — same digit order as every other date display in this app (see
    // ExplorerPage.js's formatDateValue) — but built straight from a real Date object rather than
    // string surgery, since these are client-generated timestamps with no server-round-trip
    // UTC-shift risk to guard against (unlike the ISO date-only values that trap applies to).
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

    // dateStr is already "YYYY-MM-DD" (a <input type="date">'s own value format) — plain digit
    // rearrangement, no Date object/timezone involved.
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

    // Pinned first, then most-recently-updated first within each group.
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
            // A changed (or newly set) reminder time re-arms the alert even if the old one had
            // already fired once.
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

    // Trims content down to MAX_CONTENT_WORDS the moment typing (or pasting) crosses it, rather
    // than just refusing further input — simplest to reason about, and matches how maxlength
    // behaves on the Title field above. Updates the counter (and tints it once the cap is hit)
    // every time regardless of whether a trim was needed.
    function enforceWordLimit() {
        const words = contentInput.value.trim().split(/\s+/).filter(Boolean);
        if (words.length > MAX_CONTENT_WORDS) {
            contentInput.value = words.slice(0, MAX_CONTENT_WORDS).join(" ");
        }
        const count = Math.min(words.length, MAX_CONTENT_WORDS);
        wordCountEl.textContent = `${count} / ${MAX_CONTENT_WORDS} words`;
        wordCountEl.classList.toggle("notes-editor-word-count--limit", count >= MAX_CONTENT_WORDS);
    }

    // Flushes any pending debounced edit immediately (so Back/Close can never lose the last <600ms
    // of typing), then discards the note entirely if it was a new, never-actually-used blank draft
    // rather than leaving a junk empty card in the list.
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

    // Same confirm() pattern ExplorerPage.js's row-delete already uses — a lightweight guard
    // against an accidental click, not an undo system.
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

    // The explicit "submit" action — commits right away (rather than waiting out scheduleSave's
    // own debounce) and, per explicit request, returns to the notes list right after, same as
    // Back/Close already do (leaveEditor covers both: flush+commit, then show the list).
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

    // Always visible (mobile/tablet/laptop/desktop all show it, not just whichever browsers happen
    // to support the Notification API), reflecting state through its label/style instead of hiding
    // — some mobile browsers (notably regular Safari on iOS, outside a home-screen-installed PWA)
    // don't implement Notification at all, and hiding the button there made "Enable Alerts"
    // silently disappear on exactly those devices. The in-app reminder toast (showReminderToast)
    // always works regardless of any of this — a real Notification is only ever a bonus channel.
    //
    // Four states:
    //  - unsupported: no Notification API at all → permanently inert.
    //  - blocked: user denied the browser's permission prompt → JS can neither re-prompt nor
    //    override that, so this is also inert (with a hint to fix it in browser settings).
    //  - permission granted, but the user has manually switched alerts off (isAlertsEnabled()
    //    false) → clickable, turns back on.
    //  - permission granted AND alerts on → clickable, turns back off.
    // The browser's own Notification.permission can only ever move toward "granted" via JS (never
    // back to "default", and never away from "granted" once given) — isAlertsEnabled()'s own
    // localStorage flag is what makes the last two states an actual manual on/off switch for the
    // user, layered on top of that one-way permission.
    function isAlertsEnabled() {
        return localStorage.getItem(NOTES_ALERTS_ENABLED_KEY) === "true";
    }

    function setAlertsEnabled(enabled) {
        try {
            localStorage.setItem(NOTES_ALERTS_ENABLED_KEY, String(enabled));
        } catch (error) {
            // Storage disabled — the toggle just won't persist across reloads this session.
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
    // Permission is only ever requested from this explicit click — never automatically on page
    // load or popup open, per the app's own permission-prompt conventions. Once permission is
    // already granted, the same click just flips the manual on/off flag instead.
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

    // A Notification is a bonus channel on top of the toast below, never a replacement for it —
    // it silently does nothing if unsupported, not permitted, or manually switched off by the
    // user via the Alerts button (isAlertsEnabled — this is the actual on/off control, since
    // Notification.permission itself can never be turned back off through JS once granted).
    function fireBrowserNotification(note) {
        if (!("Notification" in window) || Notification.permission !== "granted" || !isAlertsEnabled()) {
            return;
        }
        try {
            // Mobile Chrome (Android) supports the Notification permission/API surface but
            // deliberately throws on `new Notification(...)` directly from a page — it requires
            // going through a Service Worker's showNotification() instead. There's no service
            // worker in this app, so on those browsers this always lands in the catch below; the
            // toast above is what actually reaches the user there, not a real bug to chase further.
            new Notification("Note reminder", { body: note.title || "(Untitled note)" });
        } catch (error) {
            // Some browsers/embedding contexts throw even when permission reads "granted" — the
            // toast already covers the same alert, so this is best-effort only.
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

    // Runs on a 30s interval (started below) regardless of whether the popup is open — a due
    // reminder needs to surface no matter what page/section the user is currently looking at.
    // reminderAt is a <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm", no timezone
    // suffix), which `new Date(...)` parses as local time — exactly the time the user actually
    // picked, no UTC-shift risk since this never round-trips through the server.
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

    // Projection Form is a Primary Sales-only tool — its data (Primary_Sales_Projection, see
    // TopProjectionService's header comment) only ever feeds THAT page's Overview section, never
    // any other page's (e.g. Secondary Sales has its own separate Secondary_Sales_Projection table,
    // untouched by this popup). Per explicit request the icon/popup itself is hidden everywhere but
    // Primary Sales, not just inert, so there's no appearance of it doing anything elsewhere. Same
    // path-matching convention as Sidebar.js's initSidebarActiveLink.
    const isPrimarySalesPage = window.location.pathname.toLowerCase().includes("/primarysalespage/");
    const topProjectionModal = panel.querySelector("#topProjectionModalBackdrop");
    if (isPrimarySalesPage) {
        // Escapes .quick-access-panel's own `transform` (see the modal's CSS comment) so its
        // `position: fixed` overlay actually covers the real viewport instead of being scoped to
        // the small icon strip.
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
    // A reminder toast has to surface regardless of whether the Notes popup itself is open, so it
    // isn't nested inside notesModal — it gets the same body-level treatment independently.
    const notesToast = panel.querySelector("#notesReminderToast");
    if (notesToast) {
        document.body.appendChild(notesToast);
    }
    wireNotesModal(document.getElementById("quickAccessNotesBtn"));
}
