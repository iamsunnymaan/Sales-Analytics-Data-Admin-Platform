// Shared "All/Active/Inactive/Upcoming" status pill toggle — previously copy-pasted between
// SiteStatusPage.js (initSiteStatusFilterToggle) and TeamPerformancePage.js
// (initTeamStatusFilterToggle). Each page keeps its own module-level "current status" variable and
// its own fan-out of what refreshes when the status changes — this only owns the click/active-class
// mechanics and always calls onChange with the new value, regardless of whether a given call site
// uses that argument.
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
