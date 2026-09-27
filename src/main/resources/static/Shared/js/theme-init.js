// Applies the persisted day/night choice before any CSS loads, so the page never flashes
// light-then-dark on load — see QuickAccessPanel.js's applyTheme (the toggle that writes
// this) and variables.css's :root[data-theme="dark"] block (the actual color overrides).
// Loaded as a plain (non-module) blocking <script src> in each page's <head>, before the CSS
// <link> tags, so it still runs synchronously in time to prevent the flash.
(function () {
    try {
        if (localStorage.getItem("hob-theme") === "dark") {
            document.documentElement.setAttribute("data-theme", "dark");
        }
    } catch (error) {}
})();
