// Shared Sales Type pill (All/Primary/Secondary, or a Primary/Secondary-only binary variant) — the
// mechanical click-wiring piece only: toggle .active on the clicked button, call onChange with its
// data-sales-type value. No persistence, no options-fetching/rendering — every real call site today
// already has its buttons present in the DOM (either static markup or already rendered by the
// page's own fetch-driven code) and never persisted this selection across a reload, so this stays
// exactly as minimal as what it's replacing (previously 3 independent, near-identical inline
// click-handler blocks in Dashboard.js x2 and TeamPerformancePage.js).
//
// Uses the shared .brand-header-item look (same class BrandFilter/ChannelFilter render into) so a
// Sales Type pill styled either through that shared CSS or through a page's own matching rules
// renders consistently — see each migrated page's own comment on where its buttons' markup lives.
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
