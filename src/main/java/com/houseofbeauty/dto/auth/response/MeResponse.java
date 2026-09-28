package com.houseofbeauty.dto.auth.response;

import java.util.List;

public record MeResponse(Long userId, String username, String fullName, List<String> roles, List<String> permissions) {
}
