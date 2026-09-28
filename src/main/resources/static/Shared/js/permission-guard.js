export function hideAllGatedPageElements(root = document) {
    root.querySelectorAll("[data-permission]").forEach((el) => {
        el.hidden = true;
    });
}


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


    document.dispatchEvent(new CustomEvent("permissions-applied", { detail: { permissions } }));

    return permissions;
}

export function hasPermission(permissions, key) {
    return Boolean(permissions) && permissions.has(key);
}
