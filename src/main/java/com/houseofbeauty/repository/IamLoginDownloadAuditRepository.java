package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginDownloadAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

// MonitoringAuditService only ever inserts (save) a row per download/export attempt.
public interface IamLoginDownloadAuditRepository extends JpaRepository<IamLoginDownloadAudit, Long> {

    // User_ID is nullable specifically so history survives a hard user delete (see
    // UserManagementService.deleteUser) — same reasoning as IamLoginLoginAuditRepository.detachUser.
    @Modifying
    @Query("UPDATE IamLoginDownloadAudit a SET a.userId = null WHERE a.userId = :userId")
    void detachUser(@Param("userId") Long userId);

    // Backs the Monitoring page's "Download Attempts" section — most recent first, capped (see
    // IamLoginLoginAuditRepository's own comment on why not a real Pageable).
    List<IamLoginDownloadAudit> findTop300ByOrderByAttemptedAtDesc();
}
