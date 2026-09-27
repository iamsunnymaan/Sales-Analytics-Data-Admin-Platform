package com.houseofbeauty.service.identity;

import java.util.Set;

// The two roles AuthBootstrapSeeder seeds at startup (SUPERADMIN gets every permission, ADMIN gets
// everything except the Super Admin page) — shared by RoleManagementService (protects their
// permission grants from the regular Roles & Users page) and UserManagementService (protects who
// gets assigned into them). "Is this caller allowed to act on these two names / grant a
// page:superadmin.* permission" is decided by the caller's real ROLE NAME (AuthService.isSuperAdmin)
// rather than holding a "page:superadmin" Permission — that key is deliberately NOT in
// AuthBootstrapSeeder's PERMISSION_TREE (per explicit request, so it never appears as a checkbox in
// the Roles page's own picker), which would otherwise make a Permission-based check permanently
// unsatisfiable for every account, including real SUPERADMIN ones.
public final class SystemRoles {

    public static final String SUPERADMIN_ROLE_NAME = "SUPERADMIN";
    public static final String SUPERADMIN_PERMISSION_PREFIX = "page:superadmin";

    private static final Set<String> PROTECTED_ROLE_NAMES = Set.of("SUPERADMIN", "ADMIN");

    private SystemRoles() {
    }

    public static boolean isProtected(String roleName) {
        return roleName != null && PROTECTED_ROLE_NAMES.contains(roleName.trim().toUpperCase());
    }
}
