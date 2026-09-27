// Applies the persisted sidebar collapsed/expanded state to <html> before any CSS loads, so the
// sidebar never paints at its default (expanded) width for a frame and then snaps to collapsed —
// see Sidebar.js's applyState (the toggle that writes this) and Sidebar.css's
// html.sidebar-collapsed rules (the actual width/visibility overrides). Loaded as a plain
// (non-module) blocking <script src> in each page's <head>, before the CSS <link> tags — same
// pattern, and same reason, as theme-init.js.
//
// This targets <html>, not <body>: SidebarBootstrap.js (which also applies this same class, plus
// hydrates the nav's actual markup) can only run once <body> — and the <nav id="appSidebar"> it
// writes into — exist, which is well after this script and after every render-blocking <head>
// resource (CDN stylesheets, chart libraries, etc.) has loaded. On a slow connection that gap is
// long enough to paint the sidebar at its default width first. <html> is available from the very
// first byte of the document, before any of that, which is what closes the gap entirely.
(function () {
    try {
        if (localStorage.getItem("sidebar-collapsed") === "true") {
            document.documentElement.classList.add("sidebar-collapsed");
        }
    } catch (error) {}
})();
