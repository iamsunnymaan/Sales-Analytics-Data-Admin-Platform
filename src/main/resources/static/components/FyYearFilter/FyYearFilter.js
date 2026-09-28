
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


export function initFyYearFilter({ idPrefix, onSelect }) {
    wireMenu({ idPrefix, onSelect });
}


const reCallableCleanups = new Map();

export function initReCallableFyYearFilter({ idPrefix, onSelect }) {
    reCallableCleanups.get(idPrefix)?.();
    reCallableCleanups.delete(idPrefix);

    const wired = wireMenu({ idPrefix, onSelect });
    if (wired) {
        reCallableCleanups.set(idPrefix, wired.cleanup);
    }
}


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
