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
