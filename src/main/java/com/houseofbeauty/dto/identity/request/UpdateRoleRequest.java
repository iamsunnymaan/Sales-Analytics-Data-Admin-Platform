package com.houseofbeauty.dto.identity.request;

import java.util.List;

// PUT /api/identity/roles/{id}'s body — the "Edit Role" action on RolesPage.js. permissionIds
// replaces the role's entire permission set, it isn't a diff; featureIds does the same for this
// role's Feature grant set (IAM_Role_Feature_Grants) — see CreateRoleRequest's own comment.
public record UpdateRoleRequest(String roleName, String description, List<Integer> permissionIds,
                                 List<Integer> featureIds) {
}
