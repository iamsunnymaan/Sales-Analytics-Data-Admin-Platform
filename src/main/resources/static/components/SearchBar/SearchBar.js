// Thin, generic wiring shared by every free-text search/filter input across the app (Explorer's
// table search, Roles' users search, SiteStatus's Compare-modal store search). Deliberately owns
// nothing about how the typed text gets interpreted — server search param vs client-side .filter()
// vs Explorer's own month-query reparsing all stay page-side, passed in via onQuery. This only
// owns: finding the input, optionally debouncing, and firing one callback with the current value.
import { hasFeatureSync } from "/Shared/js/feature-guard.js";

export function initSearchBar({ inputId, onQuery, debounceMs = 0 }) {
    const input = document.getElementById(inputId);
    if (!input) {
        return { setValue() {} };
    }
    if (!hasFeatureSync("feature:search-bar")) {
        return { setValue() {} };
    }

    let debounceTimer = null;

    input.addEventListener("input", () => {
        if (debounceMs > 0) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                onQuery(input.value.trim());
            }, debounceMs);
        } else {
            onQuery(input.value.trim());
        }
    });

    return {
        setValue(text) {
            input.value = text;
        },
    };
}
