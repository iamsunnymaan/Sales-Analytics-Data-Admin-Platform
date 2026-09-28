let resolvedFeatures = null;

export async function applyFeatureGating(root = document) {
    let features = new Set();
    try {
        const response = await fetch("/api/features/me");
        if (response.ok) {
            const me = await response.json();
            features = new Set(me.featureKeys || []);
        }
    } catch {

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


export function hasFeatureSync(key) {
    return resolvedFeatures === null || resolvedFeatures.has(key);
}
