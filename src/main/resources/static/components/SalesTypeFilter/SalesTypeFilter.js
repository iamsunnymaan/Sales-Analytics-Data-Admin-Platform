import { hasFeatureSync } from "/Shared/js/feature-guard.js";

export function initSalesTypeFilter(toggleId, onChange) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) {
        return;
    }
    if (!hasFeatureSync("feature:sales-type-filter")) {
        return;
    }

    const items = toggle.querySelectorAll(".brand-header-item[data-sales-type]");
    items.forEach((item) => {
        item.addEventListener("click", () => {
            if (item.classList.contains("active")) {
                return;
            }
            items.forEach((i) => i.classList.remove("active"));
            item.classList.add("active");
            onChange?.(item.dataset.salesType);
        });
    });
}
