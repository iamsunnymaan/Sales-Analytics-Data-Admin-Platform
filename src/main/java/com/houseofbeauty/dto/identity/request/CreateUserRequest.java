package com.houseofbeauty.dto.identity.request;

import java.util.List;

// POST /api/identity/users' body — the "New User" popup on RolesPage.html. roleIds may be empty
// (a user with no role yet, added later) but not null.
public record CreateUserRequest(String username, String password, String fullName, String email,
                                 List<Integer> roleIds) {
}
