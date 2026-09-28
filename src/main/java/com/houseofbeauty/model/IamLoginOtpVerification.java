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
