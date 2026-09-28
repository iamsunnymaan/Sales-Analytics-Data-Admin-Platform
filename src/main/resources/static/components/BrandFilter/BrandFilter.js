import { hasFeatureSync } from "/Shared/js/feature-guard.js";

export async function loadBrandPillOptions(apiUrl) {
    try {
        const res = await fetch(apiUrl);
        if (!res.ok) {
            return [];
        }
        const brands = await res.json();
        return Array.isArray(brands) ? brands : [];
    } catch {
        return [];
    }
}


export function brandNameToCode(label) {
    const normalized = label.trim().toLowerCase();
    if (normalized === "anastasia beverly hills") {
        return "abh";
    }
    if (normalized === "kylie cosmetics") {
        return "kylie";
    }
    return normalized;
}


export function renderBrandPill(headerId, brands) {
    const container = document.getElementById(headerId);
    if (!container) {
        return;
    }
    const pill = container.querySelector(".brand-header-pill") ?? container;
    if (!brands.length) {
        pill.innerHTML = `<span class="brand-header-item brand-header-empty">Not Available</span>`;
        return;
    }
    const options = [{ value: "all", label: "All" }, ...brands.map((b) => ({ value: brandNameToCode(b), label: b }))];
    pill.innerHTML = options
        .map((opt, i) => `<button type="button" class="brand-header-item${i === 0 ? " active" : ""}" data-brand="${opt.value}">${opt.label}</button>`)
        .join("");
}


export function initBrandHeader(options = {}) {
    const { headerId = "brandHeader", storageKey = "selected-brand", defaultBrand = "all", onBrandChange, persist = true } = options;
    const header = document.getElementById(headerId);

    if (!header) {
        return;
    }

    if (!hasFeatureSync("feature:brand-filter")) {
        return;
    }

    const items = header.querySelectorAll(".brand-header-item");
    const persisted = persist ? localStorage.getItem(storageKey) : null;

    const persistedIsValid = persisted != null && Array.from(items).some((item) => item.dataset.brand === persisted);
    let selected = persistedIsValid ? persisted : defaultBrand;
    if (persist && persisted != null && !persistedIsValid) {
        localStorage.setItem(storageKey, selected);
    }

    items.forEach((item) => {
        item.classList.toggle("active", item.dataset.brand === selected);

        item.addEventListener("click", () => {
            if (item.dataset.brand === selected) {
                return;
            }
            items.forEach((i) => i.classList.remove("active"));
            item.classList.add("active");
            selected = item.dataset.brand;
            if (persist) {
                localStorage.setItem(storageKey, selected);
            }
            onBrandChange?.(selected);
        });
    });

    onBrandChange?.(selected);
}
