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


            const nav = sidebar.querySelector(".sidebar-nav");
            if (nav) {
                let currentSectionTitleEl = null;
                let sectionItemEls = [];

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
