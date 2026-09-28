package com.houseofbeauty.dto.identity.request;

import java.util.List;

public record UpdateUserRequest(String username, String fullName, String email, List<Integer> roleIds,
                                 String newPassword, Boolean active) {
}
