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

// JPA mapping for IAM_Login_Password_Reset_Tokens — reserved for the future "forgot password"
// email flow (raw token emailed to the user, only its hash stored here, Used_At stamped once
// redeemed so it can't be replayed). Not wired to any endpoint yet.
@Entity
@Table(name = "IAM_Login_Password_Reset_Tokens")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginPasswordResetToken {

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

    @Column(name = "Used_At")
    private LocalDateTime usedAt;

    @Column(name = "Created_At", nullable = false)
    private LocalDateTime createdAt;
}
