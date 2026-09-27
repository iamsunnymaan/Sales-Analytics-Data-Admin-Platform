package com.houseofbeauty.dto.identity.response;

// Backs GET /api/identity/permissions — populates both the Permissions tree (Page -> Section ->
// Feature) in RolesPage.js's New Role/Edit Role popup AND the read-only "4. Permission Details"
// catalog browser on the same page. Returned flat, sorted parent-before-child by permissionId
// (insertion order == PERMISSION_TREE's own declared order); RolesPage.js groups these by
// parentPermissionId client-side to build the actual nested tree in both places.
public record PermissionOptionResponse(Integer permissionId, String permissionKey, String label,
                                        String description, String type, Integer parentPermissionId) {
}
