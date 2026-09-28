package com.houseofbeauty.dto.identity.request;

import java.util.List;

public record CreateUserRequest(String username, String password, String fullName, String email,
                                 List<Integer> roleIds) {
}
