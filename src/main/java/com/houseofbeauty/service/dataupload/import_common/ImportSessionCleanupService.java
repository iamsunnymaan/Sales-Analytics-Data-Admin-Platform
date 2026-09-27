package com.houseofbeauty.service.dataupload.import_common;

import com.houseofbeauty.model.ImportSession;
import com.houseofbeauty.model.ImportSessionStatus;
import com.houseofbeauty.repository.ImportSessionRepository;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Upload History & Queue entries (and the file each one stored on disk) are transient working
 * data, not a permanent record — only today's entries are kept, anything from a prior calendar
 * day is deleted automatically so uploads don't accumulate indefinitely.
 */
@Service
public class ImportSessionCleanupService {

    private static final Logger log = LoggerFactory.getLogger(ImportSessionCleanupService.class);

    private final ImportSessionRepository importSessionRepository;

    public ImportSessionCleanupService(ImportSessionRepository importSessionRepository) {
        this.importSessionRepository = importSessionRepository;
    }

    // Spring's @Scheduled trigger only fires while the app is actually running at that instant —
    // if it's down (or gets restarted) around midnight, that day's cleanup is skipped forever, not
    // deferred. Running it once on startup too catches up on anything missed while the app was off.
    // Caught broadly: an unreachable DB at boot must not fail application startup — the missed
    // cleanup just gets picked up by the next successful run instead. Recovery runs first (and
    // independently) since a session stuck "Validating"/"Committing" is a correctness/usability
    // issue, not just tidiness — see recoverOrphanedInProgressSessions().
    @PostConstruct
    public void cleanupOnStartup() {
        try {
            recoverOrphanedInProgressSessions();
        } catch (Exception e) {
            log.warn("Skipping startup recovery of in-progress import sessions: {}", e.getMessage());
        }
        try {
            deleteExpiredSessions();
        } catch (Exception e) {
            log.warn("Skipping startup cleanup of expired import sessions: {}", e.getMessage());
        }
    }

    // A server restart while a /process or /commit background job was running (see
    // ImportProcessJobTracker) loses all in-memory job/mutex state, but never leaves partial DATA in
    // the target table itself: validation never persists anything (always-rolled-back transactions),
    // and commit runs inside a single DB transaction that the dropped connection rolls back
    // automatically. What CAN be left behind is the import_sessions row itself, still eagerly flipped
    // to "Validating"/"Committing" from just before the restart — and, unrecovered, permanently
    // un-retriable (requireNotYetImported/requireValidatedForCommit in ImportSessionController don't
    // accept either status). This reverts each to the same safe, retriable state its phase always
    // reverts to on a normal in-process failure: "Validating" -> "Uploaded" (nothing to lose, it was
    // only ever a dry run); "Committing" -> "Validated" (a retry re-validates fresh against the
    // current DB state before inserting anything, so nothing stale is trusted).
    public void recoverOrphanedInProgressSessions() {
        List<ImportSession> orphaned = importSessionRepository.findByStatusIn(
                List.of(ImportSessionStatus.VALIDATING.value(), ImportSessionStatus.COMMITTING.value()));
        if (orphaned.isEmpty()) {
            return;
        }
        for (ImportSession session : orphaned) {
            session.setStatus(ImportSessionStatus.VALIDATING.matches(session.getStatus())
                    ? ImportSessionStatus.UPLOADED.value()
                    : ImportSessionStatus.VALIDATED.value());
        }
        importSessionRepository.saveAll(orphaned);
        log.warn("Recovered {} import session(s) left in-progress by a previous server run.", orphaned.size());
    }

    // Runs once daily at midnight (00:00:00) — that's the only moment "before today's start"
    // actually changes, so an hourly schedule was just redundant extra runs that found nothing to do.
    @Scheduled(cron = "0 0 0 * * *")
    public void deleteExpiredSessions() {
        LocalDateTime cutoff = LocalDate.now().atStartOfDay();
        List<ImportSession> expired = importSessionRepository.findByCreatedAtBefore(cutoff);
        if (expired.isEmpty()) {
            return;
        }

        for (ImportSession session : expired) {
            deleteFileQuietly(session.getStoredPath());
        }
        importSessionRepository.deleteAll(expired);
    }

    private void deleteFileQuietly(String storedPath) {
        if (storedPath == null || storedPath.isBlank()) {
            return;
        }
        try {
            Files.deleteIfExists(Paths.get(storedPath));
        } catch (IOException ignored) {
            // Best-effort — a stray file-system issue shouldn't block the history row from
            // being cleaned up too.
        }
    }
}
