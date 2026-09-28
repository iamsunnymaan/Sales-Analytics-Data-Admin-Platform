package com.houseofbeauty.service.auth;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class AuthenticatedUser implements Serializable {

    public static final String SESSION_ATTRIBUTE = "authUser";

    private Long userId;
    private String username;
    private String fullName;
    private List<String> roles;
}
