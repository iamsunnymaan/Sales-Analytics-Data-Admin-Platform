package com.houseofbeauty.dto.identity.response;

import java.util.List;

// Backs GET /api/identity/roles/details — one row of RolesPage.js's "2. Roles Details" table.
// permissions is the granted permission labels (for the table's badge display, where duplicate
// labels across different pages are harmless); permissionIds is the same grant set by ID instead
// (for pre-checking the Edit Role permission tree, where matching by label would wrongly check
// every same-labeled node across unrelated pages — e.g. "View Overview" exists under both Primary
// and Secondary Sales). featureIds is this role's own granted Feature set (IAM_Role_Feature_Grants
// — see FeatureManagementService's own header comment), pre-checking the Feature checkboxes nested
// under the Edit Role permission tree's Sections. userCount is how many accounts currently hold
// this role (IAM_Login_User_Roles), not editable here.
public record RoleSummaryResponse(Integer roleId, String roleName, String description,
                                   List<String> permissions, List<Integer> permissionIds,
                                   List<Integer> featureIds, long userCount) {
}
