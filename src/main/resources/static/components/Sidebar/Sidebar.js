const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";
const SIDEBAR_MARKUP_URL = "/components/Sidebar/Sidebar.html";

const SIDEBAR_CACHE_KEY = "sidebar-html-cache";


function forEachGatedNavItem(sidebar, visit) {
    const nav = sidebar.querySelector(".sidebar-nav");
    if (!nav) {
        return;
    }

    let currentSectionTitleEl = null;
    let sectionItemEls = [];


    function finalizeSection() {
        if (currentSectionTitleEl || sectionItemEls.length > 0) {
            visit(currentSectionTitleEl, sectionItemEls);
        }
    }

    Array.from(nav.children).forEach((li) => {
        if (li.classList.contains("sidebar-section-title")) {
            finalizeSection();
            currentSectionTitleEl = li;
            sectionItemEls = [];
            return;
        }
        if (li.querySelector(".nav-link[data-permission]")) {
            sectionItemEls.push(li);
        }
    });
    finalizeSection();
}


function hideAllGatedNavItems(sidebar) {
    forEachGatedNavItem(sidebar, (sectionTitleEl, itemEls) => {
        itemEls.forEach((li) => {
            li.hidden = true;
        });
        if (sectionTitleEl) {
            sectionTitleEl.hidden = true;
        }
    });
}

async function renderSidebar() {
    const sidebar = document.getElementById("appSidebar");
    if (!sidebar) {
        return false;
    }

    try {
        const response = await fetch(SIDEBAR_MARKUP_URL);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        const html = await response.text();

        let cachedHtml = null;
        try {
            cachedHtml = sessionStorage.getItem(SIDEBAR_CACHE_KEY);
        } catch (error) {

        }

        const replaced = html !== cachedHtml;
        if (replaced) {
            sidebar.innerHTML = html;
            hideAllGatedNavItems(sidebar);
        }

        try {
            sessionStorage.setItem(SIDEBAR_CACHE_KEY, html);
        } catch (error) {

        }

        return replaced;
    } catch (error) {

        return false;
    }
}


function initSidebarOffCanvas() {
    const sidebar = document.getElementById("appSidebar");
    const toggle = document.getElementById("sidebarToggle");
    const backdrop = document.getElementById("sidebarBackdrop");

    if (!sidebar || !toggle) {
        return;
    }

    function setOpen(open) {
        sidebar.classList.toggle("show", open);
        backdrop?.classList.toggle("show", open);
        toggle.setAttribute("aria-expanded", String(open));
    }

    toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        setOpen(!sidebar.classList.contains("show"));
    });

    backdrop?.addEventListener("click", () => setOpen(false));

    document.addEventListener("click", (event) => {
        if (!sidebar.classList.contains("show")) {
            return;
        }
        if (!sidebar.contains(event.target) && event.target !== toggle) {
            setOpen(false);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && sidebar.classList.contains("show")) {
            setOpen(false);
        }
    });
}


function initSidebarCollapse() {
    const collapseToggle = document.getElementById("sidebarCollapseToggle");

    if (!collapseToggle) {
        return;
    }

    const icon = collapseToggle.querySelector("i");

    function applyState(collapsed) {

        document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
        const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
        collapseToggle.setAttribute("aria-label", label);
        collapseToggle.title = label;
        if (icon) {
            icon.className = collapsed ? "bi bi-chevron-right" : "bi bi-chevron-left";
        }
    }

    applyState(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");

    collapseToggle.addEventListener("click", () => {

        if (window.matchMedia("(max-width: 640px)").matches) {
            const sidebar = document.getElementById("appSidebar");
            const backdrop = document.getElementById("sidebarBackdrop");
            const hamburger = document.getElementById("sidebarToggle");
            sidebar?.classList.remove("show");
            backdrop?.classList.remove("show");
            hamburger?.setAttribute("aria-expanded", "false");
            return;
        }

        const collapsed = !document.documentElement.classList.contains("sidebar-collapsed");
        applyState(collapsed);
        localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
    });
}


function initSidebarUserFooter() {
    const usernameEl = document.querySelector("#appSidebar .sidebar-footer-username");
    const logoutBtn = document.getElementById("sidebarLogoutBtn");

    if (usernameEl) {
        try {
            const raw = sessionStorage.getItem("hob-auth-user");
            const user = raw ? JSON.parse(raw) : null;
            if (user && (user.fullName || user.username)) {
                usernameEl.textContent = user.fullName || user.username;
            }
        } catch (error) {

        }
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {

            fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            try {
                sessionStorage.removeItem("hob-auth-user");
            } catch (error) {

            }
            window.location.href = "/pages/LoginPage/LoginPage.html";
        });
    }
}


function initSidebarActiveLink() {
    const links = document.querySelectorAll("#appSidebar .nav-link[data-page]");
    const path = window.location.pathname.toLowerCase();

    links.forEach((link) => {
        const page = link.dataset.page;

        const isActive = page === "dashboard"
            ? (path === "/" || path.endsWith("/index.html"))
            : path.includes(`/${page.replace("-", "")}page/`.toLowerCase());

        link.classList.toggle("active", isActive);
    });
}


async function filterSidebarByPermissions() {
    const sidebar = document.getElementById("appSidebar");
    if (!sidebar) {
        return;
    }

    let permissions;
    try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
            return;
        }
        const me = await response.json();
        permissions = new Set(me.permissions || []);


        try {
            sessionStorage.setItem("hob-auth-user", JSON.stringify({
                userId: me.userId,
                username: me.username,
                fullName: me.fullName,
                roles: me.roles
            }));
        } catch (error) {

        }
        const usernameEl = document.querySelector("#appSidebar .sidebar-footer-username");
        if (usernameEl) {
            usernameEl.textContent = me.fullName || me.username;
        }
    } catch (error) {
        return;
    }

    forEachGatedNavItem(sidebar, (sectionTitleEl, itemEls) => {
        let sectionHasVisibleItem = false;
        itemEls.forEach((li) => {
            const link = li.querySelector(".nav-link[data-permission]");
            const visible = permissions.has(link.dataset.permission);
            li.hidden = !visible;
            if (visible) {
                sectionHasVisibleItem = true;
            }
        });
        if (sectionTitleEl) {
            sectionTitleEl.hidden = !sectionHasVisibleItem;
        }
    });
}

export async function initSidebar() {
    const sidebar = document.getElementById("appSidebar");

    let wired = false;
    function wireInteractivity() {
        if (wired) {
            return;
        }
        wired = true;
        initSidebarOffCanvas();
        initSidebarCollapse();
        initSidebarActiveLink();
        initSidebarUserFooter();
    }


    if (sidebar && sidebar.childElementCount > 0) {
        wireInteractivity();
    }

    const replaced = await renderSidebar();
    if (replaced) {

        wired = false;
    }
    wireInteractivity();


    filterSidebarByPermissions();
}
