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
