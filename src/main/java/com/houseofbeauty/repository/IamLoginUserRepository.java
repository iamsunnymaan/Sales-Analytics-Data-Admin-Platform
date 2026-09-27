package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface IamLoginUserRepository extends JpaRepository<IamLoginUser, Long> {

    // The login lookup — Username is the "User ID" field on LoginPage.html.
    Optional<IamLoginUser> findByUsernameIgnoreCase(String username);

    boolean existsByUsernameIgnoreCase(String username);

    // Backs the "forgot password" flow (AuthService.forgotPassword) — the reset link is requested
    // by registered email, not username.
    Optional<IamLoginUser> findByEmailIgnoreCase(String email);
}
