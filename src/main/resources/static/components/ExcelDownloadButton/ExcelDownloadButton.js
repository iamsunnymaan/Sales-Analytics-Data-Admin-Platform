

export function buildCsvLine(values) {
    return values.map((v) => `"${String(v === "—" ? "" : v).replace(/"/g, '""')}"`).join(",");
}


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
