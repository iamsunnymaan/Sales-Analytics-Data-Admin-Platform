// Shared "funnel button opens a dropdown of FY buttons" widget — previously copy-pasted 3 ways
// (Dashboard.js's initDashboardFyYearFilter, SiteStatusPage.js's wireMonthlyFyYearFilter,
// TeamPerformancePage.js's initTeamPersonFyYearFilter) with 3 genuinely different lifecycles, kept
// here as 3 separate exports rather than force-unified into one signature.
//
// Every export expects the caller to have already built `${idPrefix}Menu`'s innerHTML (one
// `.dashboard-fy-year-filter-item` button per FY, with `data-fy` and whatever label text that page
// wants, `.active` on whichever one is initially selected) and set `${idPrefix}Label`'s initial
// text — computing the real list of FY keys/labels is page-specific (different page-specific key
// generators, different label formats), only the open/close/select/outside-click/Escape mechanics
// are generic. On a click, the label is set from the clicked item's OWN textContent (already
// page-authored), so nothing here needs a labelFor callback — it just fires onSelect(fyKey) after
// updating the button label/active class itself.

import { hasFeatureSync } from "/Shared/js/feature-guard.js";

function wireMenu({ idPrefix, onSelect }) {
    const wrap = document.getElementById(idPrefix);
    const btn = document.getElementById(`${idPrefix}Btn`);
    const label = document.getElementById(`${idPrefix}Label`);
    const menu = document.getElementById(`${idPrefix}Menu`);
    if (!wrap || !btn || !label || !menu) {
        return null;
    }
    if (!hasFeatureSync("feature:fy-year-filter")) {
        return null;
    }

    function closeMenu() {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", () => {
        const isOpen = !menu.hidden;
        menu.hidden = isOpen;
        btn.setAttribute("aria-expanded", String(!isOpen));
    });

    menu.addEventListener("click", (event) => {
        const item = event.target.closest(".dashboard-fy-year-filter-item");
        if (!item) {
            return;
        }
        label.textContent = item.textContent;
        menu.querySelectorAll(".dashboard-fy-year-filter-item").forEach((b) => b.classList.toggle("active", b === item));
        closeMenu();
        onSelect(item.dataset.fy);
    });

    const documentClickHandler = (event) => {
        if (!wrap.contains(event.target)) {
            closeMenu();
        }
    };
    const documentKeydownHandler = (event) => {
        if (event.key === "Escape" && !menu.hidden) {
            closeMenu();
        }
    };
    document.addEventListener("click", documentClickHandler);
    document.addEventListener("keydown", documentKeydownHandler);

    return {
        menu,
        label,
        cleanup() {
            document.removeEventListener("click", documentClickHandler);
            document.removeEventListener("keydown", documentKeydownHandler);
        },
    };
}

// One-time init — the menu/button/document listeners are wired exactly once and never re-wired
// (matches Dashboard's own usage: its FY filter's DOM never gets rebuilt after page load).
export function initFyYearFilter({ idPrefix, onSelect }) {
    wireMenu({ idPrefix, onSelect });
}

// Re-callable init — safe to call again after `${idPrefix}Menu`'s markup has been rebuilt (e.g.
// injected fresh via a template string on every site switch, as SiteStatusPage.js's Monthly
// History FY filter is). Each call tears down its OWN previous document-level listeners (keyed by
// idPrefix) before re-adding new ones; the button/menu click listeners never need this since
// they're attached to brand-new, previously-detached elements every call, with no leak risk.
const reCallableCleanups = new Map();

export function initReCallableFyYearFilter({ idPrefix, onSelect }) {
    reCallableCleanups.get(idPrefix)?.();
    reCallableCleanups.delete(idPrefix);

    const wired = wireMenu({ idPrefix, onSelect });
    if (wired) {
        reCallableCleanups.set(idPrefix, wired.cleanup);
    }
}

// Scoped init returning a handle — reproduces TeamPerformancePage.js's initTeamPersonFyYearFilter:
// wired once (no cleanup needed, same lifecycle as initFyYearFilter above), but returns
// { setSelected(fyKey) } so a caller can externally resync the label/active-item later (e.g. when
// a different card/person is opened) without going through a real click.
export function initScopedFyYearFilter({ idPrefix, onSelect }) {
    const wired = wireMenu({ idPrefix, onSelect });
    if (!wired) {
        return { setSelected() {} };
    }
    return {
        setSelected(fyKey) {
            const item = wired.menu.querySelector(`.dashboard-fy-year-filter-item[data-fy="${fyKey}"]`);
            if (!item) {
                return;
            }
            wired.label.textContent = item.textContent;
            wired.menu.querySelectorAll(".dashboard-fy-year-filter-item").forEach((b) => b.classList.toggle("active", b === item));
        },
    };
}
