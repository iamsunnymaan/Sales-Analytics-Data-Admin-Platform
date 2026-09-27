package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginLoginAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

// Standard Spring Data CRUD — AuthService only ever inserts (save) a row per login attempt.
public interface IamLoginLoginAuditRepository extends JpaRepository<IamLoginLoginAudit, Long> {

    // User_ID is nullable specifically so history survives a hard user delete (see
    // UserManagementService.deleteUser) — Username_Attempted (always set) keeps the row readable
    // on its own once detached, same as it already is for a failed attempt against a username
    // that was never real to begin with.
    @Modifying
    @Query("UPDATE IamLoginLoginAudit a SET a.userId = null WHERE a.userId = :userId")
    void detachUser(@Param("userId") Long userId);

    // Backs the Monitoring page's "Attempts" (login) section — most recent first, capped rather
    // than a real Pageable (this codebase's usual convention, see e.g. TeamPerformanceController's
    // own list endpoints) since this is a read-only audit trail, not something a user pages
    // through indefinitely.
    List<IamLoginLoginAudit> findTop300ByOrderByAttemptedAtDesc();

    // Backs the Monitoring page's "Usage Overview" graph (MonitoringService#getUsageStats) — every
    // successful login since the cutoff, uncapped (unlike findTop300 above): a busy 30-day window
    // can easily exceed 300 rows once failed attempts are mixed in, and this graph needs the real
    // count per hour/user, not whatever the most recent 300 rows happen to contain.
    List<IamLoginLoginAudit> findBySuccessTrueAndAttemptedAtAfter(LocalDateTime since);
}
