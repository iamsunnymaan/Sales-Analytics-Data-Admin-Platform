package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;


@Entity
@Table(name = "IAM_Login_Refresh_Tokens")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginRefreshToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "Token_ID")
    private Long tokenId;

    @Column(name = "User_ID", nullable = false)
    private Long userId;

    @Column(name = "Token_Hash", length = 255, nullable = false)
    private String tokenHash;

    @Column(name = "Expires_At", nullable = false)
    private LocalDateTime expiresAt;

    @Column(name = "Revoked_At")
    private LocalDateTime revokedAt;

    @Column(name = "Created_At", nullable = false)
    private LocalDateTime createdAt;
}
