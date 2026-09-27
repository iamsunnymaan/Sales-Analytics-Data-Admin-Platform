// IAM — "1. User Details" reproduces RolesPage.js's own section verbatim (same UsersController
// endpoints, same markup/IDs — each page is its own document, so no collision), gated by its own
// page:iam.user-details Section key instead of page:roles.user-details (those controllers accept
// either — see RequirePermission's own header comment on the OR semantics). "2. Role and Details"
// is real role management (New/Edit/Delete Role, the Permission/Feature picker) moved here from
// the Roles & Users page per explicit request — RolesPage.html no longer has any role management at
// all, this is now the only place it exists, gated by its own page:iam.roles-details key
// (RolesController's create/update/delete endpoints check this key). No per-user Features field on
// the User modal (removed per explicit request — the Roles checkbox list there is single-select).
// Two separate role arrays are kept: `roles` (ADMIN/SUPERADMIN filtered out, same as before) feeds
// only the New/Edit User modal's own Roles picker — assigning someone the ADMIN/SUPERADMIN role
// from this page still isn't possible, per the original explicit request; `manageableRoles` (every
// role, unfiltered) feeds the "2. Role and Details" table — hiding ADMIN/SUPERADMIN there would
// make them permanently unmanageable now that this is the only surface left for role management.
import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating, reapplyFeatureGating } from "/Shared/js/feature-guard.js";
import { initSearchBar } from "/components/SearchBar/SearchBar.js";

initSidebar();
initQuickAccessPanel();

// ADMIN/SUPERADMIN stay off the New/Edit User modal's Roles picker (and the Users table itself),
// per the original explicit request — this is a display-only filter scoped to this page's own copy
// of the data, not a backend change. Deliberately NOT applied to `manageableRoles`/the Role and
// Details table below (see this file's own header comment).
const HIDDEN_IAM_ROLE_NAMES = new Set(["ADMIN", "SUPERADMIN"]);
// Reveals User Details/Role and Details' own static data-permission elements (New User/New Role
// buttons, table view wraps) once the session's real permission set resolves. Also cached here
// (not just fire-and-forget) because renderUsersTable/renderRolesTable below build each row's own
// Edit/Delete buttons dynamically on every render — they read knownPermissions synchronously
// rather than re-fetching or re-applying after the fact.
let knownPermissions = new Set();
// applyFeatureGating sequenced after applyPagePermissions resolves — see Dashboard.js's own comment
// on why (prevents permission-gating's unconditional `hidden` assignment from undoing a
// feature-based hide on an element carrying both attributes).
applyPagePermissions().then((permissions) => {
    knownPermissions = permissions;
    applyFeatureGating();
    // A render may have already run (with knownPermissions still the empty default) before this
    // resolved — re-render both tables once real permissions are in hand so their Edit/Delete
    // buttons don't stay wrongly hidden for a session that does hold those permissions.
    renderUsersTable();
    renderRolesTable();
});

let permissionOptions = [];
let roles = [];
let manageableRoles = [];
let users = [];

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}

function extractErrorMessage(response) {
    return response.json()
        .then((body) => (body && body.message ? body.message : "Something went wrong. Please try again."))
        .catch(() => "Something went wrong. Please try again.");
}

// Backend sends a LocalDateTime ISO string with no timezone (e.g. "2026-09-15T10:23:45") — parsed
// as local time here, same as every other page's own date rendering assumes.
function formatDateTime(value) {
    if (!value) {
        return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "—";
    }
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

// ==================== "1. User Details" table ====================

function getFilteredUsers() {
    const query = document.getElementById("usersSearchInput").value.trim().toLowerCase();
    if (!query) {
        return users;
    }
    return users.filter((user) => {
        return (user.username && user.username.toLowerCase().includes(query))
            || (user.fullName && user.fullName.toLowerCase().includes(query))
            || (user.email && user.email.toLowerCase().includes(query));
    });
}

function renderUsersTable() {
    const body = document.getElementById("usersTableBody");
    if (!users.length) {
        body.innerHTML = '<tr><td colspan="8" class="users-empty">No users yet — click "New User" to add one.</td></tr>';
        return;
    }

    const filteredUsers = getFilteredUsers();
    if (!filteredUsers.length) {
        body.innerHTML = '<tr><td colspan="8" class="users-empty">No users match your search.</td></tr>';
        return;
    }

    body.innerHTML = filteredUsers.map((user) => {
        const userRoles = user.roles && user.roles.length
            ? user.roles.map((role) => `<span class="users-role-badge">${escapeHtml(role)}</span>`).join("")
            : '<span class="users-field-hint">—</span>';
        const statusClass = user.status ? user.status.toLowerCase() : "inactive";

        return `
            <tr data-user-id="${user.userId}">
                <td>
                    <div class="users-name-cell">
                        <span class="users-name-primary">${escapeHtml(user.username)}</span>
                        ${user.fullName ? `<span class="users-name-secondary">${escapeHtml(user.fullName)}</span>` : ""}
                    </div>
                </td>
                <td>${user.email ? escapeHtml(user.email) : '<span class="users-field-hint">—</span>'}</td>
                <td>${userRoles}</td>
                <td><span class="users-status-badge ${statusClass}">${escapeHtml(user.status)}</span></td>
                <td>${formatDateTime(user.createdAt)}</td>
                <td>${formatDateTime(user.lastLoginAt)}</td>
                <td>${formatDateTime(user.updatedAt)}</td>
                <td>
                    <div class="users-actions">
                        <button type="button" class="users-action-btn" data-action="edit" data-feature="feature:edit-user" title="Edit Profile" aria-label="Edit Profile" ${knownPermissions.has("page:iam.user-details") ? "" : "hidden"}>
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button type="button" class="users-action-btn danger" data-action="delete" data-feature="feature:delete-user" title="Delete" aria-label="Delete" ${knownPermissions.has("page:iam.user-details") ? "" : "hidden"}>
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
    }).join("");
    // Rows above are freshly injected on every render — the one-time applyFeatureGating() pass at
    // page load never sees them, so each render needs its own pass (reapplyFeatureGating is a no-op
    // until that first pass has resolved at least once, per its own header comment).
    reapplyFeatureGating(body);
}

async function loadUsers() {
    const body = document.getElementById("usersTableBody");
    try {
        const response = await fetch("/api/identity/users");
        if (!response.ok) {
            throw new Error(await extractErrorMessage(response));
        }
        const allUsers = await response.json();
        users = allUsers.filter((user) => !(user.roles || []).some((role) => HIDDEN_IAM_ROLE_NAMES.has(role)));
        renderUsersTable();
    } catch (error) {
        body.innerHTML = `<tr><td colspan="8" class="users-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

// The New User/Edit Profile popup's "Roles" list reuses the (filtered) `roles` array populated by
// loadRoles() below instead of a separate fetch. Single-select (radio) — a user holds exactly one
// role.
function renderUserRoleCheckboxes(selectedRoleNames) {
    const container = document.getElementById("usersRoleList");
    if (!roles.length) {
        container.innerHTML = '<span class="users-field-hint">No roles available.</span>';
        return;
    }
    const selected = new Set(selectedRoleNames || []);
    container.innerHTML = roles.map((role) => `
        <label class="users-role-checkbox">
            <input type="radio" name="usersRole" value="${role.roleId}" ${selected.has(role.roleName) ? "checked" : ""}>
            ${escapeHtml(role.roleName)}
        </label>`).join("");
}

function getCheckedUserRoleIds() {
    const checked = document.querySelector('#usersRoleList input[type="radio"]:checked');
    return checked ? [Number(checked.value)] : [];
}

// Feature catalog — used by the New/Edit Role modal's Permission tree (each section can nest
// Feature leaf nodes, see SECTION_FEATURE_KEYS/renderFeatureNode below), not by the User modal
// (which has no Features field of its own).
let featureCatalog = [];

async function loadFeatureCatalog() {
    try {
        const response = await fetch("/api/identity/features");
        featureCatalog = response.ok ? await response.json() : [];
    } catch {
        featureCatalog = [];
    }
}

// ==================== New User / Edit Profile popup ====================

const usersModalBackdrop = document.getElementById("usersModalBackdrop");
const usersModalTitle = document.getElementById("usersModalTitle");
const usersModalForm = document.getElementById("usersModalForm");
const usersModalError = document.getElementById("usersModalError");
const usersPasswordField = document.getElementById("usersPasswordField");
const usersNewPasswordField = document.getElementById("usersNewPasswordField");
const usersStatusField = document.getElementById("usersStatusField");
const usersStatusToggle = document.getElementById("usersStatusToggle");
const usersUsernameInput = document.getElementById("usersUsernameInput");
const usersPasswordInput = document.getElementById("usersPasswordInput");
const usersNewPasswordInput = document.getElementById("usersNewPasswordInput");
const usersFullNameInput = document.getElementById("usersFullNameInput");
const usersEmailInput = document.getElementById("usersEmailInput");
const usersModalSubmitBtn = document.getElementById("usersModalSubmitBtn");
const usersModalSubmitSpinner = document.getElementById("usersModalSubmitSpinner");

let editingUserId = null;

function showUserModalError(message) {
    usersModalError.textContent = message;
    usersModalError.classList.remove("d-none");
}

function clearUserModalError() {
    usersModalError.classList.add("d-none");
    usersModalError.textContent = "";
}

function setUserStatusToggle(active) {
    usersStatusToggle.dataset.active = String(active);
    usersStatusToggle.querySelectorAll(".users-status-toggle-btn").forEach((button) => {
        button.classList.toggle("active", (button.dataset.value === "true") === active);
    });
}

usersStatusToggle.addEventListener("click", (event) => {
    const button = event.target.closest(".users-status-toggle-btn");
    if (!button) {
        return;
    }
    setUserStatusToggle(button.dataset.value === "true");
});

function openUserModal(mode, user) {
    const isEdit = mode === "edit";
    editingUserId = isEdit ? user.userId : null;
    usersModalTitle.textContent = isEdit ? "Edit Profile" : "New User";
    usersPasswordField.classList.toggle("d-none", isEdit);
    usersNewPasswordField.classList.toggle("d-none", !isEdit);
    usersStatusField.classList.toggle("d-none", !isEdit);

    usersUsernameInput.value = isEdit ? user.username : "";
    usersPasswordInput.value = "";
    usersNewPasswordInput.value = "";
    usersNewPasswordInput.type = "password";
    usersFullNameInput.value = isEdit ? (user.fullName || "") : "";
    usersEmailInput.value = isEdit ? (user.email || "") : "";
    setUserStatusToggle(isEdit ? user.status === "Active" : true);

    clearUserModalError();
    renderUserRoleCheckboxes(isEdit ? user.roles : []);

    usersModalBackdrop.hidden = false;
}

function closeUserModal() {
    usersModalBackdrop.hidden = true;
    editingUserId = null;
}

document.getElementById("usersNewUserBtn").addEventListener("click", () => openUserModal("create"));
document.getElementById("usersModalClose").addEventListener("click", closeUserModal);
usersModalBackdrop.addEventListener("click", (event) => {
    if (event.target === usersModalBackdrop) {
        closeUserModal();
    }
});

document.getElementById("usersPasswordToggle").addEventListener("click", () => {
    const isPassword = usersPasswordInput.type === "password";
    usersPasswordInput.type = isPassword ? "text" : "password";
});

document.getElementById("usersNewPasswordToggle").addEventListener("click", () => {
    const isPassword = usersNewPasswordInput.type === "password";
    usersNewPasswordInput.type = isPassword ? "text" : "password";
});

usersModalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearUserModalError();

    const isEdit = editingUserId !== null;
    const roleIds = getCheckedUserRoleIds();
    const username = usersUsernameInput.value.trim();

    if (!username) {
        showUserModalError("Username is required.");
        return;
    }

    if (!isEdit) {
        const password = usersPasswordInput.value;
        if (!password || password.length < 8) {
            showUserModalError("Password must be at least 8 characters.");
            return;
        }
    } else if (usersNewPasswordInput.value && usersNewPasswordInput.value.length < 8) {
        // Blank is fine (means "keep the current password") — only validate length once
        // something's actually been typed.
        showUserModalError("New password must be at least 8 characters.");
        return;
    }

    usersModalSubmitBtn.disabled = true;
    usersModalSubmitSpinner.classList.remove("d-none");

    const payload = isEdit
        ? {
              username,
              fullName: usersFullNameInput.value.trim(),
              email: usersEmailInput.value.trim(),
              roleIds,
              newPassword: usersNewPasswordInput.value || null,
              active: usersStatusToggle.dataset.active === "true"
          }
        : {
              username,
              password: usersPasswordInput.value,
              fullName: usersFullNameInput.value.trim(),
              email: usersEmailInput.value.trim(),
              roleIds
          };

    try {
        const response = await fetch(isEdit ? `/api/identity/users/${editingUserId}` : "/api/identity/users", {
            method: isEdit ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(await extractErrorMessage(response));
        }

        closeUserModal();
        await refreshAllSections();
    } catch (error) {
        showUserModalError(error.message);
    } finally {
        usersModalSubmitBtn.disabled = false;
        usersModalSubmitSpinner.classList.add("d-none");
    }
});

// ==================== User row action dispatch (event delegation — rows are re-rendered on every load) ====================

document.getElementById("usersTableBody").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
        return;
    }
    const row = button.closest("tr[data-user-id]");
    const userId = Number(row.dataset.userId);
    const user = users.find((candidate) => candidate.userId === userId);
    if (!user) {
        return;
    }

    if (button.dataset.action === "edit") {
        openUserModal("edit", user);
    } else if (button.dataset.action === "delete") {
        if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) {
            return;
        }
        try {
            const response = await fetch(`/api/identity/users/${userId}`, { method: "DELETE" });
            if (!response.ok) {
                throw new Error(await extractErrorMessage(response));
            }
            await refreshAllSections();
        } catch (error) {
            window.alert(error.message);
        }
    }
});

initSearchBar({ inputId: "usersSearchInput", onQuery: () => renderUsersTable() });

// ==================== "2. Role and Details" table ====================

function renderRolesTable() {
    const body = document.getElementById("rolesTableBody");
    if (!manageableRoles.length) {
        body.innerHTML = '<tr><td colspan="5" class="roles-empty">No roles yet — click "New Role" to add one.</td></tr>';
        return;
    }

    const visiblePermissionCount = 3;

    body.innerHTML = manageableRoles.map((role) => {
        let permissions = '<span class="roles-field-hint">—</span>';
        if (role.permissions && role.permissions.length) {
            const shown = role.permissions.slice(0, visiblePermissionCount)
                .map((permission) => `<span class="roles-permission-badge">${escapeHtml(permission)}</span>`)
                .join("");
            const hiddenCount = role.permissions.length - visiblePermissionCount;
            const more = hiddenCount > 0
                ? `<span class="roles-permission-badge roles-permission-more" title="${escapeHtml(role.permissions.slice(visiblePermissionCount).join(", "))}">+${hiddenCount} more</span>`
                : "";
            permissions = shown + more;
        }

        const descriptionTitle = role.description ? ` title="${escapeHtml(role.description)}"` : "";

        return `
            <tr data-role-id="${role.roleId}">
                <td><span class="roles-name-primary">${escapeHtml(role.roleName)}</span></td>
                <td class="roles-description-cell"${descriptionTitle}>${role.description ? escapeHtml(role.description) : '<span class="roles-field-hint">—</span>'}</td>
                <td>${permissions}</td>
                <td>${role.userCount}</td>
                <td>
                    <div class="roles-actions">
                        <button type="button" class="roles-action-btn" data-action="edit" data-feature="feature:edit-role" title="Edit Role" aria-label="Edit Role" ${knownPermissions.has("page:iam.roles-details") ? "" : "hidden"}>
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button type="button" class="roles-action-btn danger" data-action="delete" data-feature="feature:delete-role" title="Delete" aria-label="Delete" ${knownPermissions.has("page:iam.roles-details") ? "" : "hidden"}>
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
    }).join("");
    // Same reasoning as renderUsersTable's own reapplyFeatureGating call — these rows are freshly
    // injected on every render, past the one-time applyFeatureGating() pass at page load.
    reapplyFeatureGating(body);
}

// Single fetch backs both role arrays — `roles` (ADMIN/SUPERADMIN filtered out) for the User
// modal's own Roles picker, `manageableRoles` (everything) for the Role and Details table itself.
// See this file's own header comment for why the two are deliberately NOT the same array.
async function loadRoles() {
    const body = document.getElementById("rolesTableBody");
    try {
        const response = await fetch("/api/identity/roles/details");
        if (!response.ok) {
            throw new Error(await extractErrorMessage(response));
        }
        manageableRoles = await response.json();
        roles = manageableRoles.filter((role) => !HIDDEN_IAM_ROLE_NAMES.has(role.roleName));
        renderRolesTable();
    } catch (error) {
        body.innerHTML = `<tr><td colspan="5" class="roles-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

async function loadPermissions() {
    try {
        const response = await fetch("/api/identity/permissions");
        if (!response.ok) {
            throw new Error(await extractErrorMessage(response));
        }
        permissionOptions = await response.json();
    } catch (error) {
        permissionOptions = [];
    }
}

// ==================== Permissions tree (Page -> Section [-> Feature reference]) ====================
//
// permissionOptions is a flat list (permissionId, permissionKey, label, type, parentPermissionId)
// returned parent-before-child (see RoleManagementService#listPermissions). Grouped by
// parentPermissionId here to build the real 2-level SAVABLE tree — a Section is still the finest
// grain a role can actually be granted (an earlier design had a 3rd Feature level under each
// Section as its own permission concept; removed per explicit request, see AuthBootstrapSeeder's
// own header comment). Each level's checkbox is fully independent: checking/unchecking a Page never
// touches its Sections — a Page's sidebar visibility depends only on its own permission being
// granted, regardless of how many (if any) of its Sections are. An earlier version cascaded state
// up/down the tree and used an indeterminate parent state to reflect partial child selection, which
// actively broke Page visibility whenever fewer than all Sections were checked (the Page checkbox
// ended up indeterminate instead of checked and got silently dropped from the saved permission set)
// — plain native checkboxes with no cascading avoid that class of bug entirely.
//
// SECTION_FEATURE_KEYS below adds back a 3rd visual level, but a wholly different "Feature" than the
// one removed above: this is the Features system's own catalog entries
// (FeatureManagementService/FeatureBootstrapSeeder — the components/ folder's shared UI widgets,
// plus the New/Edit/Delete action buttons this page and the Roles & Users page carry), nested here
// so an admin editing a role's page/section grants can also grant/revoke exactly the widgets that
// live on that section, in the same tree. Checking one here saves a real IAM_Role_Feature_Grants
// row (see getCheckedFeatureIds/the submit handler below) — this is deliberately NOT the same as
// the per-USER IAM_Feature_User_Denials override (Super Admin's Feature Bulk Management, and the
// User popup's own Features list): a personal denial there still wins even if every role a user
// holds grants the Feature, see FeatureManagementService's own header comment for the full
// composition rule. The mapping from Section to which Feature keys live under it is hand-maintained
// from each page's own data-feature="feature:<key>" markup (Shared/js/feature-guard.js) since a
// Feature carries no page/section association of its own in the DB; a Feature used on more than one
// Section (e.g. Excel Download, New User Button) is deliberately repeated under every Section it
// actually appears on rather than picked a single "home".
const SECTION_FEATURE_KEYS = {
    "page:dashboard.filter-header": ["feature:sales-type-filter", "feature:brand-filter", "feature:channel-filter", "feature:status-filter", "feature:fy-year-filter"],
    "page:dashboard.overview": ["feature:excel-download"],
    "page:dashboard.daily-trends": ["feature:sales-type-filter", "feature:brand-filter", "feature:date-filter"],
    "page:dashboard.partner-performance": ["feature:excel-download"],

    "page:primary-sales.overview": ["feature:brand-filter", "feature:channel-filter", "feature:status-filter", "feature:date-filter"],
    "page:primary-sales.product-snapshot": ["feature:excel-download"],
    "page:primary-sales.reports": ["feature:excel-download"],

    "page:secondary-sales.overview": ["feature:brand-filter", "feature:channel-filter", "feature:status-filter", "feature:date-filter"],
    "page:secondary-sales.product-snapshot": ["feature:excel-download"],
    "page:secondary-sales.reports": ["feature:excel-download"],
    "page:secondary-sales.site-master-report": ["feature:excel-download"],

    "page:site-insights.site-picker": ["feature:search-bar", "feature:status-filter", "feature:sales-type-filter"],
    "page:site-insights.geo-compare": ["feature:search-bar"],
    "page:site-insights.site-detail": ["feature:date-filter", "feature:fy-year-filter", "feature:excel-download"],

    "page:team-insights.filter-header": ["feature:status-filter", "feature:date-filter", "feature:sales-type-filter"],
    "page:team-insights.team-report": ["feature:excel-download"],
    "page:team-insights.person-details": ["feature:fy-year-filter", "feature:excel-download"],
    "page:team-insights.person-sitemaster-report": ["feature:excel-download"],

    "page:explorer.table-data": ["feature:search-bar", "feature:edit-row", "feature:template-download", "feature:excel-download"],

    "page:data-upload.upload-verify": ["feature:template-download"],

    "page:roles.user-details": ["feature:new-user", "feature:edit-user", "feature:delete-user", "feature:search-bar"],
    "page:iam.user-details": ["feature:new-user", "feature:edit-user", "feature:delete-user", "feature:search-bar"],
    "page:iam.roles-details": ["feature:new-role", "feature:edit-role", "feature:delete-role"],

    "page:monitoring.audit": ["feature:search-bar", "feature:date-filter"],
};

function featureByKey(featureKey) {
    return featureCatalog.find((f) => f.featureKey === featureKey) || null;
}

// Display label markup for a Permission tree row — just its own "<kind>: <name>", never repeating
// its ancestors' kind/name (the tree's own nesting/indentation already shows that, see
// renderPermissionNode/renderFeatureNode below). The "<kind>:" prefix renders smaller/lighter than
// the name via .perm-node-kind (RolesPage.css) so the actual page/section/feature name stays the
// visually dominant part of the row.
function permissionDisplayLabel(kind, name) {
    return `<span class="perm-node-kind">${kind}:</span> ${escapeHtml(name)}`;
}

function renderFeatureNode(featureKey, selectedFeatureIds) {
    const feature = featureByKey(featureKey);
    if (!feature) {
        // Catalog hasn't resolved yet (loadFeatureCatalog() still in flight) or the key was
        // renamed/retired — skip rather than render a checkbox with no real Feature_ID behind it.
        return "";
    }
    const isChecked = selectedFeatureIds.has(feature.featureId);
    const displayLabel = permissionDisplayLabel("feature", feature.label || feature.featureKey);
    return `
        <div class="perm-node perm-node--feature">
            <label class="perm-node-row">
                <span class="perm-node-toggle-spacer"></span>
                <i class="bi bi-puzzle perm-node-ref-icon"></i>
                <input type="checkbox" class="perm-node-checkbox perm-node-feature-checkbox" value="${feature.featureId}" ${isChecked ? "checked" : ""}>
                <span class="perm-node-label">${displayLabel}</span>
            </label>
        </div>`;
}

function groupPermissionsByParent() {
    const byParent = new Map();
    permissionOptions.forEach((permission) => {
        const parentKey = permission.parentPermissionId ?? "root";
        if (!byParent.has(parentKey)) {
            byParent.set(parentKey, []);
        }
        byParent.get(parentKey).push(permission);
    });
    return byParent;
}

function renderPermissionNode(node, byParent, selectedIds, selectedFeatureIds) {
    const children = byParent.get(node.permissionId) || [];
    const featureKeys = SECTION_FEATURE_KEYS[node.permissionKey] || [];
    const hasChildren = children.length > 0 || featureKeys.length > 0;
    const isChecked = selectedIds.has(node.permissionId);
    const nodeLabel = node.label || node.permissionKey;
    const displayLabel = permissionDisplayLabel(node.type === "PAGE" ? "page" : "section", nodeLabel);

    const childrenHtml = children.map((child) => renderPermissionNode(child, byParent, selectedIds, selectedFeatureIds)).join("")
        + featureKeys.map((featureKey) => renderFeatureNode(featureKey, selectedFeatureIds)).join("");

    return `
        <div class="perm-node perm-node--${node.type.toLowerCase()}" data-permission-id="${node.permissionId}">
            <label class="perm-node-row">
                ${hasChildren
                    ? '<button type="button" class="perm-node-toggle" aria-label="Expand/collapse"><i class="bi bi-chevron-right"></i></button>'
                    : '<span class="perm-node-toggle-spacer"></span>'}
                <input type="checkbox" class="perm-node-checkbox" value="${node.permissionId}" ${isChecked ? "checked" : ""}>
                <span class="perm-node-label">${displayLabel}</span>
            </label>
            ${hasChildren ? `<div class="perm-node-children">${childrenHtml}</div>` : ""}
        </div>`;
}

function renderPermissionCheckboxes(selectedIds, selectedFeatureIds) {
    const container = document.getElementById("rolesPermissionList");
    if (!permissionOptions.length) {
        container.innerHTML = '<span class="roles-field-hint">No permissions available.</span>';
        return;
    }
    const selected = new Set(selectedIds || []);
    const selectedFeatures = new Set(selectedFeatureIds || []);
    const byParent = groupPermissionsByParent();
    const pages = byParent.get("root") || [];

    container.innerHTML = pages.map((page) => renderPermissionNode(page, byParent, selected, selectedFeatures)).join("");
}

// Wired once (event delegation on the container, which survives across renders — only its
// innerHTML is replaced on every openRoleModal call) rather than inside renderPermissionCheckboxes,
// so repeated New/Edit Role opens never stack up duplicate listeners.
const rolesPermissionListEl = document.getElementById("rolesPermissionList");

rolesPermissionListEl.addEventListener("click", (event) => {
    const toggle = event.target.closest(".perm-node-toggle");
    if (!toggle) {
        return;
    }
    event.preventDefault();
    const nodeEl = toggle.closest(".perm-node");
    const expanded = nodeEl.classList.toggle("expanded");
    const icon = toggle.querySelector("i");
    if (icon) {
        icon.className = expanded ? "bi bi-chevron-down" : "bi bi-chevron-right";
    }
});

// A Feature used on more than one Section (e.g. Excel Download) renders one checkbox per Section
// it appears under — same Feature_ID, separate DOM checkboxes (see SECTION_FEATURE_KEYS's own
// comment on why they're repeated rather than given one "home"). Without this, unchecking just one
// occurrence would silently do nothing on save: getCheckedFeatureIds() collects EVERY checked
// checkbox's value, so a still-checked sibling elsewhere in the tree would keep that Feature_ID in
// the submitted set regardless. Syncing every same-value checkbox on change is what makes each
// occurrence behave as "the same Feature," matching what an admin actually sees on screen.
rolesPermissionListEl.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".perm-node-feature-checkbox");
    if (!checkbox) {
        return;
    }
    rolesPermissionListEl.querySelectorAll(`.perm-node-feature-checkbox[value="${checkbox.value}"]`)
        .forEach((sibling) => {
            sibling.checked = checkbox.checked;
        });
});

// Excludes .perm-node-feature-checkbox (also carries .perm-node-checkbox for shared styling) —
// Features save to their own IAM_Role_Feature_Grants field, see getCheckedFeatureIds below.
function getCheckedPermissionIds() {
    return Array.from(rolesPermissionListEl.querySelectorAll('.perm-node-checkbox:checked:not(.perm-node-feature-checkbox)'))
        .map((input) => Number(input.value));
}

function getCheckedFeatureIds() {
    return Array.from(rolesPermissionListEl.querySelectorAll('.perm-node-feature-checkbox:checked'))
        .map((input) => Number(input.value));
}

// ==================== New Role / Edit Role popup ====================

const rolesModalBackdrop = document.getElementById("rolesModalBackdrop");
const rolesModalTitle = document.getElementById("rolesModalTitle");
const rolesModalForm = document.getElementById("rolesModalForm");
const rolesModalError = document.getElementById("rolesModalError");
const rolesNameInput = document.getElementById("rolesNameInput");
const rolesDescriptionInput = document.getElementById("rolesDescriptionInput");
const rolesModalSubmitBtn = document.getElementById("rolesModalSubmitBtn");
const rolesModalSubmitSpinner = document.getElementById("rolesModalSubmitSpinner");

let editingRoleId = null;

function showRoleModalError(message) {
    rolesModalError.textContent = message;
    rolesModalError.classList.remove("d-none");
}

function clearRoleModalError() {
    rolesModalError.classList.add("d-none");
    rolesModalError.textContent = "";
}

function openRoleModal(mode, role) {
    const isEdit = mode === "edit";
    editingRoleId = isEdit ? role.roleId : null;
    rolesModalTitle.textContent = isEdit ? "Edit Role" : "New Role";

    rolesNameInput.value = isEdit ? role.roleName : "";
    rolesDescriptionInput.value = isEdit ? (role.description || "") : "";

    clearRoleModalError();
    renderPermissionCheckboxes(isEdit ? role.permissionIds : [], isEdit ? role.featureIds : []);

    rolesModalBackdrop.hidden = false;
}

function closeRoleModal() {
    rolesModalBackdrop.hidden = true;
    editingRoleId = null;
}

document.getElementById("rolesNewRoleBtn").addEventListener("click", () => openRoleModal("create"));
document.getElementById("rolesModalClose").addEventListener("click", closeRoleModal);
rolesModalBackdrop.addEventListener("click", (event) => {
    if (event.target === rolesModalBackdrop) {
        closeRoleModal();
    }
});

rolesModalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearRoleModalError();

    const isEdit = editingRoleId !== null;
    const roleName = rolesNameInput.value.trim();
    if (!roleName) {
        showRoleModalError("Role name is required.");
        return;
    }

    rolesModalSubmitBtn.disabled = true;
    rolesModalSubmitSpinner.classList.remove("d-none");

    const payload = {
        roleName,
        description: rolesDescriptionInput.value.trim(),
        permissionIds: getCheckedPermissionIds(),
        featureIds: getCheckedFeatureIds()
    };

    try {
        const response = await fetch(isEdit ? `/api/identity/roles/${editingRoleId}` : "/api/identity/roles", {
            method: isEdit ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(await extractErrorMessage(response));
        }
        closeRoleModal();
        await refreshAllSections();
    } catch (error) {
        showRoleModalError(error.message);
    } finally {
        rolesModalSubmitBtn.disabled = false;
        rolesModalSubmitSpinner.classList.add("d-none");
    }
});

// ==================== Role row action dispatch (event delegation — rows are re-rendered on every load) ====================

document.getElementById("rolesTableBody").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
        return;
    }
    const row = button.closest("tr[data-role-id]");
    const roleId = Number(row.dataset.roleId);
    const role = manageableRoles.find((candidate) => candidate.roleId === roleId);
    if (!role) {
        return;
    }

    if (button.dataset.action === "edit") {
        openRoleModal("edit", role);
    } else if (button.dataset.action === "delete") {
        if (!window.confirm(`Delete role "${role.roleName}"? This cannot be undone.`)) {
            return;
        }
        try {
            const response = await fetch(`/api/identity/roles/${roleId}`, { method: "DELETE" });
            if (!response.ok) {
                throw new Error(await extractErrorMessage(response));
            }
            await refreshAllSections();
        } catch (error) {
            window.alert(error.message);
        }
    }
});

// ==================== Cross-section sync ====================
//
// "1. User Details" and "2. Role and Details" both read from the same underlying data (a role
// rename/permission change affects the role badges shown per user; a user's role assignment affects
// Role and Details' "Users" count), so every mutating action on either one reloads both rather than
// just its own table — otherwise the other would keep showing stale data until the next full page
// load. loadPermissions() is folded in too (not just fetched once) since the New/Edit Role modal's
// own picker (renderPermissionCheckboxes) needs a fresh permissionOptions array on the same cadence.
async function refreshAllSections() {
    await Promise.all([
        loadUsers(),
        loadRoles(),
        loadPermissions()
    ]);
}

refreshAllSections();
// Independent load cycle, deliberately not folded into refreshAllSections() — see loadFeatureCatalog's
// own header comment.
loadFeatureCatalog();
