import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating, reapplyFeatureGating } from "/Shared/js/feature-guard.js";
import { initSearchBar } from "/components/SearchBar/SearchBar.js";

initSidebar();
initQuickAccessPanel();


const HIDDEN_IAM_ROLE_NAMES = new Set(["ADMIN", "SUPERADMIN"]);

let knownPermissions = new Set();

applyPagePermissions().then((permissions) => {
    knownPermissions = permissions;
    applyFeatureGating();

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


let featureCatalog = [];

async function loadFeatureCatalog() {
    try {
        const response = await fetch("/api/identity/features");
        featureCatalog = response.ok ? await response.json() : [];
    } catch {
        featureCatalog = [];
    }
}



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

    reapplyFeatureGating(body);
}


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


function permissionDisplayLabel(kind, name) {
    return `<span class="perm-node-kind">${kind}:</span> ${escapeHtml(name)}`;
}

function renderFeatureNode(featureKey, selectedFeatureIds) {
    const feature = featureByKey(featureKey);
    if (!feature) {

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


function getCheckedPermissionIds() {
    return Array.from(rolesPermissionListEl.querySelectorAll('.perm-node-checkbox:checked:not(.perm-node-feature-checkbox)'))
        .map((input) => Number(input.value));
}

function getCheckedFeatureIds() {
    return Array.from(rolesPermissionListEl.querySelectorAll('.perm-node-feature-checkbox:checked'))
        .map((input) => Number(input.value));
}



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


async function refreshAllSections() {
    await Promise.all([
        loadUsers(),
        loadRoles(),
        loadPermissions()
    ]);
}

refreshAllSections();

loadFeatureCatalog();
