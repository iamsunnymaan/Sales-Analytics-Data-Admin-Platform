// Shared Brand pill: fetch real Site_Master.Brand options, render them into a pill container, and
// wire click-to-select with localStorage persistence (opt out via persist:false for a caller whose
// options are re-fetched fresh every load and were never meant to survive a reload).
//
// Previously copy-pasted near-identically in PrimarySalesPage.js and SecondarySalesPage.js — same
// signatures, same behavior, just centralized. Each page keeps passing its OWN headerId/storageKey/
// endpoint (these were never actually shared defaults, just two different pages' own hardcoded
// values that happened to live inside near-identical function bodies) so nothing about either
// page's real behavior changes.
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

// Maps a real Site_Master.Brand value ("Anastasia Beverly hills", "Kylie Cosmetics") to the short
// code every brand-filtered endpoint's BrandFilter.normalize() actually accepts ("abh"/"kylie").
// Falls back to the lowercased value for any brand outside this known pair (matches
// BrandFilter.java's own only-2-known-codes limitation — see that class's header comment for why
// ABH/Kylie are the only vocabulary wired end-to-end right now).
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

// Renders into whichever element inside headerId actually carries .brand-header-pill — either
// headerId itself (if the id IS the pill container, e.g. SecondarySalesPage's
// #dashboardFyOverviewBrandToggle) or a descendant of it (e.g. PrimarySalesPage's #brandHeader,
// which wraps an inner .brand-header-pill for historical reasons) — so this works unmodified for
// either page's existing DOM shape.
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

// Selection persists across page loads via localStorage by default. Pass a distinct
// headerId/storageKey to run a second, independent brand pill elsewhere on the same page without it
// syncing with or overwriting another one. `onBrandChange` is optional — fires once on init with
// the restored/default selection, then again on every click.
export function initBrandHeader(options = {}) {
    const { headerId = "brandHeader", storageKey = "selected-brand", defaultBrand = "all", onBrandChange, persist = true } = options;
    const header = document.getElementById(headerId);

    if (!header) {
        return;
    }
    // Feature gating (defense in depth — data-feature/applyFeatureGating on the page's own markup
    // is what reliably hides this on first paint; see feature-guard.js's own header comment).
    if (!hasFeatureSync("feature:brand-filter")) {
        return;
    }

    const items = header.querySelectorAll(".brand-header-item");
    const persisted = persist ? localStorage.getItem(storageKey) : null;
    // A persisted value that no longer matches any real button (e.g. a stale raw brand name saved
    // by an old build before renderBrandPill's short-code mapping) falls back to defaultBrand
    // instead of being applied blindly, so a bad value left over in a real user's browser self-heals
    // on the next load instead of permanently 400ing every brand-filtered request for them.
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
