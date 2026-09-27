// Default-ALLOW content gating for the new, wholly independent "Features" system — the deliberate
// inverse of permission-guard.js's deny-by-default model. Permission gating hides an element until
// proven authorized because a brand-new page/section must never flash something a session doesn't
// hold; Feature gating does the opposite on purpose: every one of these 10 widgets already worked
// for everyone before this system existed, and the explicit decision (see
// FeatureManagementService's own header comment) was that shipping this must never visibly change
// that unless an admin actively revokes a Feature for a specific user. So an element carrying
// data-feature="<key>" renders normally from first paint (no hard-coded `hidden` in markup, unlike
// data-permission's convention) — applyFeatureGating() only ever ADDS `hidden` to the rare element
// whose key is confirmed absent once /api/features/me resolves; it never needs to reveal anything.
//
// This is UI-only, same caveat permission-guard.js documents for itself: nothing here substitutes
// for a real server-side check. Today no controller enforces a Feature key server-side (unlike
// Permission's @RequirePermission) — every one of these 10 widgets is display/convenience-only
// (a filter pill, a download button), not a distinct authorization boundary of its own, so hiding it
// client-side is the whole mechanism, matching how "hide the nav link" already works for Permission
// on top of its own real server-side page/section gate.
let resolvedFeatures = null; // null = "not yet known" — every synchronous check below defaults to allowed, matching the default-allow model

export async function applyFeatureGating(root = document) {
    let features = new Set();
    try {
        const response = await fetch("/api/features/me");
        if (response.ok) {
            const me = await response.json();
            features = new Set(me.featureKeys || []);
        }
    } catch {
        // Leave features empty on a genuine network failure — resolvedFeatures still gets set
        // below so hasFeatureSync() stops defaulting to "allowed" once this has run, same
        // fail-safe-closed posture applyPagePermissions takes on its own fetch failure, just
        // reached from the opposite starting default.
    }

    resolvedFeatures = features;
    root.querySelectorAll("[data-feature]").forEach((el) => {
        if (!features.has(el.dataset.feature)) {
            el.hidden = true;
        }
    });

    document.dispatchEvent(new CustomEvent("features-applied", { detail: { features } }));
    return features;
}

// Re-applies the ALREADY-resolved feature set (no new /api/features/me fetch) to freshly-injected
// markup — for a page like SiteStatusPage.js that rebuilds a chunk of its own DOM from a template
// string on every user action (there: picking a different site) rather than once at page load, so
// any data-feature element inside that freshly-injected chunk gets the same gating the rest of the
// page already has, without re-fetching on every single rebuild. A no-op (leaves everything
// visible) if called before the real applyFeatureGating() has resolved even once — same fail-open-
// until-known default every other check in this module uses.
export function reapplyFeatureGating(root) {
    if (resolvedFeatures === null) {
        return;
    }
    root.querySelectorAll("[data-feature]").forEach((el) => {
        if (!resolvedFeatures.has(el.dataset.feature)) {
            el.hidden = true;
        }
    });
}

// Synchronous, best-effort check for a component's own in-module guard (defense in depth,
// composed with each component's existing DOM-null-check early return — see each component's own
// comment for its exact hook point). Before applyFeatureGating()'s fetch resolves this always
// returns true; it is NOT what reliably hides a revoked widget on first paint — the declarative
// data-feature attribute + applyFeatureGating() pass above is. This only reliably catches a LATER
// re-invocation of the same init after the cache has warmed (several of these components do get
// re-invoked on data refresh).
export function hasFeatureSync(key) {
    return resolvedFeatures === null || resolvedFeatures.has(key);
}
