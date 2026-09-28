package com.houseofbeauty.dto.identity.response;

import java.time.LocalDateTime;
import java.util.List;

public record UserSummaryResponse(Long userId, String username, String fullName, String email,
                                   List<String> roles, String status, LocalDateTime createdAt,
                                   LocalDateTime lastLoginAt, LocalDateTime updatedAt) {
}
