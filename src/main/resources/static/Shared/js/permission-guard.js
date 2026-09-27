// Deny-by-default Section/Feature-level content gating — the page-content equivalent of
// Sidebar.js's hideAllGatedNavItems/filterSidebarByPermissions (see that file's own header
// comment for why "hidden until proven authorized" matters, not just "hidden once we know it's
// unauthorized"). Any element in a page's static HTML carrying both data-permission="<key>" and a
// hard-coded `hidden` attribute in the markup itself (not applied later by JS — see each page's
// own HTML) stays invisible from the very first paint, no matter how slow /api/auth/me is; this
// module's only job is to reveal the ones the session's effective permission set actually holds.
//
// Nesting works for free: a Feature element living inside a Section container that's also
// data-permission-gated only becomes visible once BOTH the Section's own [hidden] is cleared AND
// the Feature element's own [hidden] is cleared, because clearing one element's [hidden] never
// touches an ancestor's — exactly mirroring the Page/Section/Feature independence the Roles
// picker and AuthBootstrapSeeder's PERMISSION_TREE are built around (a Feature is only reachable
// if its Section is too), without this module needing to know the tree shape at all.
//
// This is UI-only, same caveat Sidebar.js's own filterSidebarByPermissions documents: it stops a
// Section/Feature from being *visible*, not from being reachable some other way (a direct API
// call). Any action here backed by its own real endpoint (export/edit/delete/etc.) still needs
// its own @RequirePermission server-side — this module never substitutes for that.
export function hideAllGatedPageElements(root = document) {
    root.querySelectorAll("[data-permission]").forEach((el) => {
        el.hidden = true;
    });
}

// Fetches the session's real effective permission set and reveals exactly the gated elements it
// covers — everything else (including every element still hidden because a fetch failed, or the
// session isn't authenticated) stays hidden. Returns the permission Set so callers can also guard
// a feature's actual click handler/logic, not just its visibility (defense in depth for anything
// wired to a still-technically-reachable DOM node).
export async function applyPagePermissions(root = document) {
    let permissions = new Set();
    try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
            return permissions;
        }
        const me = await response.json();
        permissions = new Set(me.permissions || []);
    } catch {
        return permissions;
    }

    root.querySelectorAll("[data-permission]").forEach((el) => {
        el.hidden = !permissions.has(el.dataset.permission);
    });

    // Lets anything that measured its own size while still hidden (most notably an ECharts
    // instance initialized inside a data-permission container — a chart drawn into a
    // `display: none` box renders at 0x0 and never fixes itself on its own) react once its
    // container is actually revealed, without this module needing to know charts exist at all.
    document.dispatchEvent(new CustomEvent("permissions-applied", { detail: { permissions } }));

    return permissions;
}

export function hasPermission(permissions, key) {
    return Boolean(permissions) && permissions.has(key);
}
