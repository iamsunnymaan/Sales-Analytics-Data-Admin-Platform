package com.houseofbeauty.service.identity;

import java.util.Set;

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
