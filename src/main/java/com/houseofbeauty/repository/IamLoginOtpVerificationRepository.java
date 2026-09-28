package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginOtpVerification;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IamLoginOtpVerificationRepository extends JpaRepository<IamLoginOtpVerification, Long> {

    Optional<IamLoginOtpVerification> findFirstByUserIdAndPurposeAndUsedFalseOrderByCreatedAtDesc(
            Long userId, String purpose);

    void deleteByUserId(Long userId);

    List<IamLoginOtpVerification> findTop300ByOrderByCreatedAtDesc();
}
