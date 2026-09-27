// Shared Channel pill — exact structural twin of BrandFilter.js, just for Channel. Channel has no
// fixed short-code vocabulary like Brand's "abh"/"kylie": data-channel carries the raw real
// Site_Master.Channel string straight through, matched case-insensitively server-side (see
// ChannelFilter.java's own normalize()).
//
// Previously copy-pasted near-identically in PrimarySalesPage.js and SecondarySalesPage.js — same
// signatures, same behavior, just centralized. Each page keeps passing its own storageKey/endpoint.
import { hasFeatureSync } from "/Shared/js/feature-guard.js";

export async function loadChannelPillOptions(apiUrl) {
    try {
        const res = await fetch(apiUrl);
        if (!res.ok) {
            return [];
        }
        const channels = await res.json();
        return Array.isArray(channels) ? channels : [];
    } catch {
        return [];
    }
}

export function renderChannelPill(headerId, channels) {
    const pill = document.getElementById(headerId);
    if (!pill) {
        return;
    }
    if (!channels.length) {
        pill.innerHTML = `<span class="brand-header-item brand-header-empty">Not Available</span>`;
        return;
    }
    const options = [{ value: "all", label: "All" }, ...channels.map((c) => ({ value: c, label: c }))];
    pill.innerHTML = options
        .map((opt, i) => `<button type="button" class="brand-header-item${i === 0 ? " active" : ""}" data-channel="${opt.value}">${opt.label}</button>`)
        .join("");
}

export function initChannelHeader(options = {}) {
    const { headerId = "dashboardFyOverviewChannelToggle", storageKey = "selected-channel", defaultChannel = "all", onChannelChange, persist = true } = options;
    const header = document.getElementById(headerId);

    if (!header) {
        return;
    }
    if (!hasFeatureSync("feature:channel-filter")) {
        return;
    }

    const items = header.querySelectorAll(".brand-header-item");
    const persisted = persist ? localStorage.getItem(storageKey) : null;
    const persistedIsValid = persisted != null && Array.from(items).some((item) => item.dataset.channel === persisted);
    let selected = persistedIsValid ? persisted : defaultChannel;
    if (persist && persisted != null && !persistedIsValid) {
        localStorage.setItem(storageKey, selected);
    }

    items.forEach((item) => {
        item.classList.toggle("active", item.dataset.channel === selected);

        item.addEventListener("click", () => {
            if (item.dataset.channel === selected) {
                return;
            }
            items.forEach((i) => i.classList.remove("active"));
            item.classList.add("active");
            selected = item.dataset.channel;
            if (persist) {
                localStorage.setItem(storageKey, selected);
            }
            onChannelChange?.(selected);
        });
    });

    onChannelChange?.(selected);
}
