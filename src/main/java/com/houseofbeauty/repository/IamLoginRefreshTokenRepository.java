package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginRefreshToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

// Not wired to anything yet — reserved for a future JWT refresh-token flow (see
// IamLoginRefreshToken's header comment). The Monitoring page's own "Sessions (Refresh Tokens)"
// section (a read of findTop300ByOrderByCreatedAtDesc) was removed per explicit request — it only
// ever reflected another application's own use of this shared database, house_of_beauty itself
// never issues one — don't re-add that read method unasked.
public interface IamLoginRefreshTokenRepository extends JpaRepository<IamLoginRefreshToken, Long> {

    Optional<IamLoginRefreshToken> findByTokenHash(String tokenHash);

    // Empty in practice (table isn't wired to anything yet — see class header), but still cleared
    // before a hard delete for the same FK-safety reason as the other per-user tables — see
    // UserManagementService.deleteUser.
    void deleteByUserId(Long userId);
}
