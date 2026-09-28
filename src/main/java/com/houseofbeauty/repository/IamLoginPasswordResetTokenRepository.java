package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginPasswordResetToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IamLoginPasswordResetTokenRepository extends JpaRepository<IamLoginPasswordResetToken, Long> {

    Optional<IamLoginPasswordResetToken> findByTokenHash(String tokenHash);

    void deleteByUserId(Long userId);

    List<IamLoginPasswordResetToken> findTop300ByOrderByCreatedAtDesc();
}
