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

// JPA mapping for IAM_Login_Otp_Verifications — one row per OTP issued (POST /api/auth/send-otp),
// consumed by POST /api/auth/login when mode=otp. OTP_Code_Hash is BCrypt-hashed, same as a
// password — the raw code is never persisted. User_ID is a plain scalar FK (see
// IamLoginUserRoleId's header comment on this codebase's usual no-relationship-mapping
// convention), not a @ManyToOne.
@Entity
@Table(name = "IAM_Login_Otp_Verifications")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginOtpVerification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "OTP_ID")
    private Long otpId;

    @Column(name = "User_ID", nullable = false)
    private Long userId;

    @Column(name = "OTP_Code_Hash", length = 255, nullable = false)
    private String otpCodeHash;

    @Column(name = "Purpose", length = 30, nullable = false)
    private String purpose;

    @Column(name = "Expires_At", nullable = false)
    private LocalDateTime expiresAt;

    @Column(name = "Is_Used", nullable = false)
    private Boolean used;

    @Column(name = "Created_At", nullable = false)
    private LocalDateTime createdAt;
}
