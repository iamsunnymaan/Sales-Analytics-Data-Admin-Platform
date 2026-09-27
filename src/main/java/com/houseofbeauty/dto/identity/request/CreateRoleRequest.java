package com.houseofbeauty.dto.identity.request;

import java.util.List;

// POST /api/identity/roles's body — the "New Role" popup on RolesPage.js. featureIds is this
// role's Feature grant set (IAM_Role_Feature_Grants) — the checkboxes nested under each Section in
// the same permission tree, see RoleManagementService.createRole and FeatureManagementService's own
// header comment.
public record CreateRoleRequest(String roleName, String description, List<Integer> permissionIds,
                                 List<Integer> featureIds) {
}
