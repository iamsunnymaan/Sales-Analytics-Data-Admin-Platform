import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";
import { applyFeatureGating, reapplyFeatureGating } from "/Shared/js/feature-guard.js";
import { initSearchBar } from "/components/SearchBar/SearchBar.js";

initSidebar();
initQuickAccessPanel();

let knownPermissions = new Set();

applyPagePermissions().then((permissions) => {
    knownPermissions = permissions;
    applyFeatureGating();

    renderUsersTable();
});

let roles = [];
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
                        <button type="button" class="users-action-btn" data-action="edit" data-feature="feature:edit-user" title="Edit Profile" aria-label="Edit Profile" ${knownPermissions.has("page:roles.user-details") ? "" : "hidden"}>
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button type="button" class="users-action-btn danger" data-action="delete" data-feature="feature:delete-user" title="Delete" aria-label="Delete" ${knownPermissions.has("page:roles.user-details") ? "" : "hidden"}>
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
        users = await response.json();
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


async function loadRoles() {
    try {
        const response = await fetch("/api/identity/roles/details");
        roles = response.ok ? await response.json() : [];
    } catch {
        roles = [];
    }
}


async function refreshAllSections() {
    await Promise.all([
        loadUsers(),
        loadRoles()
    ]);
}

refreshAllSections();
