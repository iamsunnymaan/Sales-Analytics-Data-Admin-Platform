package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginOtpVerification;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IamLoginOtpVerificationRepository extends JpaRepository<IamLoginOtpVerification, Long> {

    // Latest unused OTP for this user/purpose — used by AuthService to verify a submitted code
    // against whatever was most recently issued via POST /api/auth/send-otp.
    Optional<IamLoginOtpVerification> findFirstByUserIdAndPurposeAndUsedFalseOrderByCreatedAtDesc(
            Long userId, String purpose);

    // Clears any issued OTPs before a hard delete (FK_IAM_Login_OtpVerifications_Users would
    // otherwise block it) — see UserManagementService.deleteUser.
    void deleteByUserId(Long userId);

    // Backs the Monitoring page's "Recent OTPs" section — most recent first, capped (see
    // IamLoginLoginAuditRepository's own comment on why not a real Pageable).
    List<IamLoginOtpVerification> findTop300ByOrderByCreatedAtDesc();
}
