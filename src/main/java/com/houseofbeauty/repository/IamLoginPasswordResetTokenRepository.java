package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginPasswordResetToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// Not wired to any endpoint yet — reserved for the future "forgot password" email flow (see
// IamLoginPasswordResetToken's header comment).
public interface IamLoginPasswordResetTokenRepository extends JpaRepository<IamLoginPasswordResetToken, Long> {

    Optional<IamLoginPasswordResetToken> findByTokenHash(String tokenHash);

    // Empty in practice (table isn't wired to anything yet — see class header), but still cleared
    // before a hard delete for the same FK-safety reason as the other per-user tables — see
    // UserManagementService.deleteUser.
    void deleteByUserId(Long userId);

    // Backs the Monitoring page's "Password Reset Tokens" section — always empty for now (see
    // class header), but reads from the real table rather than a stub so it starts working the
    // moment a real forgot-password flow ever writes to it.
    List<IamLoginPasswordResetToken> findTop300ByOrderByCreatedAtDesc();
}
