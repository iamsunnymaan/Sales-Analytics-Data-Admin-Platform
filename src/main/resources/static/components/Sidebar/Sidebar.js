const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";
const SIDEBAR_MARKUP_URL = "/components/Sidebar/Sidebar.html";
// Keep in sync with SidebarBootstrap.js, which reads this same key synchronously.
const SIDEBAR_CACHE_KEY = "sidebar-html-cache";

// Every permission-gated nav item (and section-title separator) starts hidden the moment the
// sidebar's real markup exists in the DOM — see hideAllGatedNavItems/SidebarBootstrap.js's own
// mirrored copy of this same logic — and only filterSidebarByPermissions, once its real
// /api/auth/me check resolves, ever reveals one. Shared here so both hideAllGatedNavItems and
// filterSidebarByPermissions walk the exact same DOM shape the same way.
function forEachGatedNavItem(sidebar, visit) {
    const nav = sidebar.querySelector(".sidebar-nav");
    if (!nav) {
        return;
    }

    let currentSectionTitleEl = null;
    let sectionItemEls = [];

    // currentSectionTitleEl is null for any gated item(s) before the first section-title (e.g.
    // Dashboard, which sits above "Sales" with no title of its own) — visit() still has to run for
    // that group so those items get hidden/revealed too, it just has no title element to toggle.
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

// Single source of truth for the sidebar's markup lives in Sidebar.html — every page just has an
// empty <nav id="appSidebar"> placeholder (see any pages/*/*.html), and this fetches that markup
// and injects it in, instead of every page duplicating the HTML. Add/remove/rename a nav link
// only in Sidebar.html.
//
// SidebarBootstrap.js — a blocking classic script placed right after the empty <nav> in every
// page — synchronously injects the sessionStorage-cached copy from a previous page's fetch (if
// any) before this even starts running, which is what actually removes the visible flicker
// between page navigations. This function still fetches fresh markup on every load (so a real nav
// change always shows up, e.g. after a deploy), but — critically — only touches the DOM with it
// when the fetched markup actually differs from what's cached. Unconditionally doing
// `sidebar.innerHTML = html` here on every single page load, even when the content is byte-for-
// byte identical to what SidebarBootstrap.js already rendered, was the real cause of the
// collapsed-sidebar flicker/width-jump bug: destroying and rebuilding the sidebar's entire DOM
// subtree forces the browser to relayout the whole `.app-shell` flex container (sidebar AND main
// content are flex siblings), and recreated icon elements re-resolving their webfont glyphs is
// what showed up as icons/spacing briefly jumping. Comparing the raw fetched/cached strings (not
// `sidebar.innerHTML`, which the DOM would re-serialize in a possibly different form) is what
// makes this comparison reliable.
// Returns true if the sidebar's DOM subtree was actually torn down and rebuilt (fresh nodes, no
// listeners) — callers need to know this so they can decide whether interactivity must be
// (re)wired, since a rebuilt subtree carries none of whatever was attached before it.
// Hides every permission-gated nav item, and any section-title separator whose items are all
// gated, immediately — before filterSidebarByPermissions's real /api/auth/me check has even
// started, let alone resolved. This is what makes "permission data is still loading" impossible to
// mistake for "user has permission": there is no window, however brief, where a page the session
// doesn't hold permission for is visible in the sidebar. SidebarBootstrap.js (the synchronous,
// before-first-paint script) carries an exact copy of this same logic for its own cache-hydration
// path — keep the two in sync.
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
            // Private browsing / storage disabled — treat as a cache miss, safe to still render.
        }

        const replaced = html !== cachedHtml;
        if (replaced) {
            sidebar.innerHTML = html;
            hideAllGatedNavItems(sidebar);
        }

        try {
            sessionStorage.setItem(SIDEBAR_CACHE_KEY, html);
        } catch (error) {
            // Private browsing / storage disabled — caching is a pure optimization, safe to skip.
        }

        return replaced;
    } catch (error) {
        // Leave whatever's already there (e.g. SidebarBootstrap.js's cached copy, or nothing)
        // rather than clearing it — a page missing its nav is recoverable, an uncaught rejection
        // here would abort the rest of initSidebar() below it.
        return false;
    }
}

// Mobile/off-canvas: toggle the sidebar open (with its dimmed backdrop), and close it on any
// outside click, a backdrop tap, or Escape. #sidebarToggle and #sidebarBackdrop are rendered
// statically by every page right next to <nav id="appSidebar"> (see pages/*/*.html) — outside the
// sidebar's own DOM subtree, since they must stay visible/clickable while the sidebar itself is
// translated off-screen.
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

// Desktop collapse/expand toggle — state persists across page loads via localStorage.
function initSidebarCollapse() {
    const collapseToggle = document.getElementById("sidebarCollapseToggle");

    if (!collapseToggle) {
        return;
    }

    const icon = collapseToggle.querySelector("i");

    function applyState(collapsed) {
        // Kept on <html> (not <body>) — see sidebar-collapse-init.js's header comment for why:
        // <html> is what gets hydrated before first paint, so the CSS in Sidebar.css that reads
        // this class targets the same element.
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
        // On mobile the sidebar is an off-canvas drawer (see initSidebarOffCanvas) rather than an
        // in-flow icon-only rail, so this same header button closes the drawer instead of toggling
        // the desktop collapsed state, and hands control back to the hamburger button.
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

// Shows the signed-in user's name (from "hob-auth-user", written by LoginPage.js on login) in the
// footer instead of the hardcoded "Admin" placeholder, and wires the logout button to clear that
// session and send the user back to LoginPage.html — the counterpart to Shared/js/auth-guard.js's
// redirect-if-absent check every other page runs.
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
            // Malformed cache — leave the placeholder text as-is rather than breaking the sidebar.
        }
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            // Clears the client-side cache and invalidates the server-side HttpSession
            // AuthenticationFilter checks on every /api/* request (see AuthController#logout) —
            // both have to go for logout to actually revoke access, not just hide the UI. The
            // redirect happens either way; a failed logout call shouldn't strand the user on a
            // page they can no longer use (every API on it now 401s once the client-side cache
            // clears below, session or not).
            fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            try {
                sessionStorage.removeItem("hob-auth-user");
            } catch (error) {
                // Storage disabled — nothing to clear, still redirect below.
            }
            window.location.href = "/pages/LoginPage/LoginPage.html";
        });
    }
}

// Highlights the nav link matching the current page (by data-page or href), since pages are
// plain static HTML with no client-side router to track "current route" for us.
function initSidebarActiveLink() {
    const links = document.querySelectorAll("#appSidebar .nav-link[data-page]");
    const path = window.location.pathname.toLowerCase();

    links.forEach((link) => {
        const page = link.dataset.page;
        // No href-based fallback here on purpose — Dashboard's href="/" is a substring of every
        // path, so an `includes(href)` fallback previously matched it as "active" on every page.
        const isActive = page === "dashboard"
            ? (path === "/" || path.endsWith("/index.html"))
            : path.includes(`/${page.replace("-", "")}page/`.toLowerCase());

        link.classList.toggle("active", isActive);
    });
}

// Reveals sidebar nav items the current session's effective permission set actually includes a
// "page:<slug>" key for (data-permission on each <a class="nav-link"> in Sidebar.html) — every
// permission-gated item starts hidden (see hideAllGatedNavItems/SidebarBootstrap.js's mirrored
// copy), so this is strictly additive: it only ever un-hides an item once its permission is
// confirmed present, it never has to decide what to hide. Section-title separators (Sales/
// Performance/Inventory/Database/Identity) are revealed too, but only once at least one nav-link
// under them was.
//
// On any failure (not logged in yet, a transient network error, /api/auth/me erroring) nothing gets
// revealed — "permission data is still loading/unavailable" must never be treated the same as "user
// has permission", so the safe default (everything stays hidden) wins over guessing. A genuinely
// logged-in user hitting a transient error here just sees an empty sidebar until the next page load
// succeeds, which is the correct tradeoff against ever showing a page a session doesn't hold.
//
// This only reveals the LINK — the actual page document itself is independently protected by
// PageAccessInterceptor (server-side, checked before the page's HTML is ever served), so typing the
// URL directly, a bookmark, refresh, hard refresh, or Back/Forward all hit that same real check
// regardless of what this function does or doesn't reveal.
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

        // Refreshes this tab's own cached identity from the same real check — sessionStorage is
        // per tab, not shared, so a DIFFERENT user logging in from another tab (same browser, same
        // underlying HttpSession cookie) leaves this tab's own "hob-auth-user" copy pointing at
        // whoever it was before, even though the server (and the permission filtering right below)
        // has already moved on to the new session; confirmed live as a stale "Administrator" footer
        // surviving a plain reload after a different user logged in elsewhere. initSidebarUserFooter
        // already ran once off the stale cache by the time this resolves — updating the footer text
        // directly here (not just the cache) is what actually corrects what's on screen.
        try {
            sessionStorage.setItem("hob-auth-user", JSON.stringify({
                userId: me.userId,
                username: me.username,
                fullName: me.fullName,
                roles: me.roles
            }));
        } catch (error) {
            // Storage disabled — nothing to cache, footer update below still applies.
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

    // SidebarBootstrap.js (a blocking script placed right after <nav id="appSidebar">) already
    // synchronously hydrated the real markup — including the correct collapsed/expanded icon
    // state — before this module even started running, on every page load except the very first
    // one in a session. Waiting on the fetch below before wiring up the collapse toggle and
    // hamburger meant a click during that round trip (slow network, loaded dev server, etc.) was
    // silently swallowed — no listener existed yet — which is what showed up as the sidebar
    // "not responding" to a click, then a moment later reacting on its own once renderSidebar()
    // finally finished. Wiring immediately against whatever's already in the DOM fixes that.
    if (sidebar && sidebar.childElementCount > 0) {
        wireInteractivity();
    }

    const replaced = await renderSidebar();
    if (replaced) {
        // The fetch found genuinely different markup (e.g. after a deploy) and tore down/rebuilt
        // the subtree — those fresh nodes carry none of the listeners attached above, so rewire.
        wired = false;
    }
    wireInteractivity();

    // Runs after the real markup is in place (bootstrap-cached or freshly fetched), every
    // permission-gated item already hidden by default (hideAllGatedNavItems/SidebarBootstrap.js's
    // mirrored copy) — a separate async call, not awaited, so a slow /api/auth/me never delays the
    // sidebar itself appearing. A slow fetch here just means authorized items take a moment longer
    // to reveal, never that an unauthorized one is shown in the meantime.
    filterSidebarByPermissions();
}
