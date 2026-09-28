package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginRefreshToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface IamLoginRefreshTokenRepository extends JpaRepository<IamLoginRefreshToken, Long> {

    Optional<IamLoginRefreshToken> findByTokenHash(String tokenHash);

    void deleteByUserId(Long userId);
}
