package com.houseofbeauty.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

// Declares which IAM_Login_Permissions.Permission_Key(s) a controller (class-level — every
// endpoint in it needs the same page permission) or a specific method (overrides the class-level
// one, for a dangerous single action like TableDataController#truncateTable) requires. Checked by
// PermissionInterceptor, which resolves the current session's effective permission set via
// AuthService#effectivePermissions and returns 403 unless it holds AT LEAST ONE of the listed keys
// — an OR, not an AND (e.g. UsersController/RolesController/FeaturesController accept either
// page:roles.* or page:iam.*, since the same Users/Roles data is independently reachable from both
// the Roles & Users page and the IAM page, each with its own permission grant). A single string
// still works exactly as before (`@RequirePermission("page:x")` — Java's annotation shorthand
// treats a lone value as a one-element array), so every pre-existing usage is unaffected. A
// controller/method with no annotation at all is unaffected either way — it still just needs
// AuthenticationFilter's plain "is this session authenticated" check, same as before this existed.
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequirePermission {
    String[] value();
}
