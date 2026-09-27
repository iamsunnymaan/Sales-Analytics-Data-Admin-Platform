package com.houseofbeauty.repository;

import com.houseofbeauty.model.ImportSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface ImportSessionRepository extends JpaRepository<ImportSession, String> {

    // Used by ImportSessionCleanupService to find yesterday-or-older rows to purge.
    List<ImportSession> findByCreatedAtBefore(LocalDateTime cutoff);

    // Used by ImportSessionCleanupService on startup to recover sessions orphaned mid-"Validating"/
    // "Committing" by a server restart — see recoverOrphanedInProgressSessions().
    List<ImportSession> findByStatusIn(List<String> statuses);

    // Used by DatabaseConnectionController's table-summary endpoint for the Available Tables info
    // panel's "last updated" row. committedAt is non-null only for a session that actually committed
    // (see ImportSessionController#runCommitJob) — a session that's still mid-import, or that failed/
    // was cancelled before ever committing, is correctly excluded. NOTE: like every ImportSession row,
    // this one is purged the day after it's created (see ImportSessionCleanupService), so this only
    // ever reflects a commit from within roughly the last day, not the table's full history.
    Optional<ImportSession> findFirstByTableKeyIgnoreCaseAndCommittedAtIsNotNullOrderByCommittedAtDesc(String tableKey);
}
