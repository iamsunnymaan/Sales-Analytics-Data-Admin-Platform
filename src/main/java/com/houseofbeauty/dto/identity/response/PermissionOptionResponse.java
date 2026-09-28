package com.houseofbeauty.dto.identity.response;

public record PermissionOptionResponse(Integer permissionId, String permissionKey, String label,
                                        String description, String type, Integer parentPermissionId) {
}
