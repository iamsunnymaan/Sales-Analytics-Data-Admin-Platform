package com.houseofbeauty.dto.auth.response;

import java.util.List;

public record AuthResponse(Long userId, String username, String fullName, List<String> roles) {
}
