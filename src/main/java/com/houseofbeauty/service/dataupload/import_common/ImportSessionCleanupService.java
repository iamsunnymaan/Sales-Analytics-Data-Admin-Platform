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

@Service
public class ImportSessionCleanupService {

    private static final Logger log = LoggerFactory.getLogger(ImportSessionCleanupService.class);

    private final ImportSessionRepository importSessionRepository;

    public ImportSessionCleanupService(ImportSessionRepository importSessionRepository) {
        this.importSessionRepository = importSessionRepository;
    }

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

        }
    }
}
