package com.houseofbeauty.dto.identity.response;

import java.util.List;

public record RoleSummaryResponse(Integer roleId, String roleName, String description,
                                   List<String> permissions, List<Integer> permissionIds,
                                   List<Integer> featureIds, long userCount) {
}
