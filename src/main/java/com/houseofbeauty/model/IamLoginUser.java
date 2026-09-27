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

// JPA mapping for IAM_Login_Users — one row per company-provisioned account (no public
// signup: accounts are created by an admin, per explicit request). Password_Hash is a BCrypt hash
// (see AuthService/PasswordEncoderConfig), never plaintext. Failed_Login_Attempts/Is_Locked back
// the login lockout policy in AuthService; Is_Active lets an account be disabled without deleting
// it (and losing its audit/token history via the FK chain).
@Entity
@Table(name = "IAM_Login_Users")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "User_ID")
    private Long userId;

    @Column(name = "Username", length = 100, nullable = false)
    private String username;

    @Column(name = "Password_Hash", length = 255, nullable = false)
    private String passwordHash;

    @Column(name = "Full_Name", length = 150)
    private String fullName;

    @Column(name = "Email", length = 255)
    private String email;

    @Column(name = "Is_Active", nullable = false)
    private Boolean active;

    @Column(name = "Is_Locked", nullable = false)
    private Boolean locked;

    @Column(name = "Failed_Login_Attempts", nullable = false)
    private Integer failedLoginAttempts;

    @Column(name = "Last_Login_At")
    private LocalDateTime lastLoginAt;

    @Column(name = "Created_At", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "Updated_At")
    private LocalDateTime updatedAt;
}
