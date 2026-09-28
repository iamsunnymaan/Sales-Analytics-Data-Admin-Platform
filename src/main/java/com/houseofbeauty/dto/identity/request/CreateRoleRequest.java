package com.houseofbeauty.dto.identity.request;

import java.util.List;

public record CreateRoleRequest(String roleName, String description, List<Integer> permissionIds,
                                 List<Integer> featureIds) {
}
