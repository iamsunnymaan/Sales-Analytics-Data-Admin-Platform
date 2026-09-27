package com.houseofbeauty.service.auth;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.List;

// What AuthController stores in the HttpSession (key SESSION_ATTRIBUTE, see AuthenticationFilter)
// after a successful POST /api/auth/login — the server-side record of "who this session belongs
// to", checked by AuthenticationFilter on every /api/* request. Deliberately separate from
// AuthResponse (the DTO returned to the browser): this is session state, not a wire response, even
// though the two currently carry the same fields.
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AuthenticatedUser implements Serializable {

    // HttpSession attribute key — shared by AuthController (writes it on login, removes it on
    // logout) and AuthenticationFilter (reads it to decide whether a /api/* request is
    // authenticated).
    public static final String SESSION_ATTRIBUTE = "authUser";

    private Long userId;
    private String username;
    private String fullName;
    private List<String> roles;
}
