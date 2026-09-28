import { hasFeatureSync } from "/Shared/js/feature-guard.js";

export function initStatusFilter(toggleId, onChange) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) {
        return;
    }
    if (!hasFeatureSync("feature:status-filter")) {
        return;
    }
    toggle.querySelectorAll(".site-status-filter-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.classList.contains("active")) {
                return;
            }
            toggle.querySelectorAll(".site-status-filter-item").forEach((b) => b.classList.toggle("active", b === btn));
            onChange(btn.dataset.status);
        });
    });
}
