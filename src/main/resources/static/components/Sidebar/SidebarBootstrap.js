// Runs synchronously, BEFORE first paint, to kill the things that otherwise make every
// sidebar-link click "blink" during the page-to-page navigation: the width snapping open/closed,
// the collapse toggle button's chevron icon/label pointing the wrong way for a moment, and the
// nav content itself popping in empty-then-populated while Sidebar.js's async initSidebar() is
// still fetching Sidebar.html. Must be a plain classic <script src="..."> (not type="module", not
// defer/async) — those only run after parsing completes, too late to prevent any of these flashes
// — and it must be placed right AFTER <nav id="appSidebar"></nav> (not before it), since it needs
// that element to already exist to write into it.
//
// Job 1 (collapsed width) is now also handled earlier by sidebar-collapse-init.js, loaded at the
// very top of <head> (before any CSS/CDN resource can delay this file's own fetch) — see its
// header comment. The line below is a cheap, idempotent duplicate of that, kept as a second line
// of defense in case this script ever runs before that one manages to (e.g. it was ever removed
// from a page's <head> by mistake).
//
// Job 2 (nav content + toggle button state) reads a same-session cache of the last successful
// Sidebar.html fetch from sessionStorage and injects it immediately — synchronously "hydrating"
// the sidebar before the browser paints anything, instead of leaving it empty for the however-many
// milliseconds Sidebar.js's fetch takes. Sidebar.html's markup always hardcodes the *expanded*
// look for the collapse toggle button (bi-chevron-left, "Collapse sidebar") since that's its
// resting state in the source file — when the page should actually load collapsed, that has to be
// flipped to the collapsed look (bi-chevron-right, "Expand sidebar") right here, synchronously,
// or the chevron visibly points the wrong way and then flips a moment later once
// Sidebar.js's initSidebarCollapse() gets around to it. Sidebar.js's initSidebar() still
// re-fetches fresh markup and re-wires everything (including re-applying active-link highlighting
// and this same toggle-button state) on every single page load regardless — this only ever serves
// very-briefly-stale content, and only until that finishes. The active-link, permission-hiding, and
// toggle-button logic below is intentionally a duplicate of Sidebar.js's initSidebarActiveLink() /
// hideAllGatedNavItems() / initSidebarCollapse() (kept in sync with them) — applying any of them a
// moment late would be its own, subtler version of the same blink this file exists to prevent.
// Permission-hiding in particular can't wait for Sidebar.js's async /api/auth/me check the way it
// used to: every permission-gated nav item must already be hidden the instant this cached markup is
// painted, or a page the session holds no permission for is genuinely visible (not just
// theoretically racy) for however long that fetch takes — "permission data hasn't loaded yet" must
// never look the same as "this page is authorized". On the very first page load of a browser
// session there's no cache yet, so this is a no-op and the sidebar behaves exactly as it did before
// this file existed (empty until Sidebar.js populates and reveals it).
(function () {
    let collapsed = false;
    try {
        collapsed = localStorage.getItem("sidebar-collapsed") === "true";
        if (collapsed) {
            document.documentElement.classList.add("sidebar-collapsed");
        }
    } catch (e) {}

    try {
        const cachedHtml = sessionStorage.getItem("sidebar-html-cache");
        const sidebar = document.getElementById("appSidebar");
        if (cachedHtml && sidebar) {
            sidebar.innerHTML = cachedHtml;

            const path = window.location.pathname.toLowerCase();
            sidebar.querySelectorAll(".nav-link[data-page]").forEach((link) => {
                const page = link.dataset.page;
                const isActive = page === "dashboard"
                    ? (path === "/" || path.endsWith("/index.html"))
                    : path.includes(`/${page.replace("-", "")}page/`.toLowerCase());
                if (isActive) {
                    link.classList.add("active");
                }
            });

            // Hide every permission-gated nav item (and its section-title separator) before this
            // cached markup is ever painted — mirrors Sidebar.js's hideAllGatedNavItems exactly.
            // Sidebar.js's own async filterSidebarByPermissions is what reveals the ones the
            // session actually holds, once its real /api/auth/me check resolves; nothing here ever
            // assumes a page is authorized just because permission data hasn't loaded yet.
            const nav = sidebar.querySelector(".sidebar-nav");
            if (nav) {
                let currentSectionTitleEl = null;
                let sectionItemEls = [];
                // currentSectionTitleEl is null for gated item(s) before the first section-title
                // (Dashboard sits above "Sales" with no title of its own) — still hide those items,
                // there's just no title element to toggle alongside them.
                const hideSection = () => {
                    sectionItemEls.forEach((li) => { li.hidden = true; });
                    if (currentSectionTitleEl) {
                        currentSectionTitleEl.hidden = true;
                    }
                };
                Array.from(nav.children).forEach((li) => {
                    if (li.classList.contains("sidebar-section-title")) {
                        hideSection();
                        currentSectionTitleEl = li;
                        sectionItemEls = [];
                        return;
                    }
                    if (li.querySelector(".nav-link[data-permission]")) {
                        sectionItemEls.push(li);
                    }
                });
                hideSection();
            }

            if (collapsed) {
                const collapseToggle = sidebar.querySelector("#sidebarCollapseToggle");
                const icon = collapseToggle?.querySelector("i");
                if (collapseToggle) {
                    collapseToggle.setAttribute("aria-label", "Expand sidebar");
                    collapseToggle.title = "Expand sidebar";
                }
                if (icon) {
                    icon.className = "bi bi-chevron-right";
                }
            }
        }
    } catch (e) {}
})();
