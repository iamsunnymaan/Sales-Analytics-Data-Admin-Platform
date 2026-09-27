// Three mechanical primitives shared by every client-side CSV "download" button across the app
// (Dashboard's FY Overview, Primary/Secondary Sales' Ranking/Research/Reports/Site Report,
// TeamPerformance's Team Report/Site Report, SiteStatus's Research/Ranking). Every page still
// builds its own header row and cell values (money formatting, category hierarchy, report-tab
// flattening, etc.) — none of that business logic lives here, only the parts that were being
// hand-copied identically everywhere: quoting a CSV row, turning CSV text into a downloaded file,
// and the download-popup's own show/hide/outside-click/aria wiring.

// Quotes+escapes one CSV row's cells (`"` -> `""`), matching every existing copy's convention of
// treating a literal "—" placeholder as an empty cell rather than a literal em dash in the file.
export function buildCsvLine(values) {
    return values.map((v) => `"${String(v === "—" ? "" : v).replace(/"/g, '""')}"`).join(",");
}

// Leading UTF-8 BOM (﻿) — without it, Excel on Windows ignores the "charset=utf-8" MIME hint on a
// plain double-click open and decodes using the system codepage instead, turning every ₹/▲/▼/Δ
// into mojibake (e.g. "â‚¹"). The BOM is what actually tells Excel's CSV importer "this is UTF-8."
export function downloadCsv(lines, filename) {
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// Generic funnel-button-opens-a-popup wiring: click the trigger to toggle the popup open/closed
// (with aria-expanded kept in sync) and close it on any outside click or Escape. The caller wires
// its own confirm button's click handler as before (building/downloading the CSV is page-specific)
// and calls the returned close() once done. Safe to call again after popupEl's markup has been
// rebuilt (e.g. injected fresh via a template string) since each call re-attaches its own listeners
// to whatever triggerBtn/popupEl elements are passed in.
import { hasFeatureSync } from "/Shared/js/feature-guard.js";

export function initDownloadPopup({ triggerBtn, popupEl }) {
    if (!hasFeatureSync("feature:excel-download")) {
        return { open() {}, close() {}, toggle() {} };
    }

    function isOpen() {
        return !!popupEl && !popupEl.hidden;
    }

    function open() {
        if (!popupEl) {
            return;
        }
        popupEl.hidden = false;
        triggerBtn?.setAttribute("aria-expanded", "true");
    }

    function close() {
        if (!popupEl) {
            return;
        }
        popupEl.hidden = true;
        triggerBtn?.setAttribute("aria-expanded", "false");
    }

    function toggle() {
        if (isOpen()) {
            close();
        } else {
            open();
        }
    }

    triggerBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggle();
    });

    document.addEventListener("click", (event) => {
        if (isOpen() && !popupEl.contains(event.target) && event.target !== triggerBtn) {
            close();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isOpen()) {
            close();
        }
    });

    return { open, close, toggle };
}
