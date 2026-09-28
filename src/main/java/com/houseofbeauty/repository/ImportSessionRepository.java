package com.houseofbeauty.repository;

import com.houseofbeauty.model.ImportSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface ImportSessionRepository extends JpaRepository<ImportSession, String> {

    List<ImportSession> findByCreatedAtBefore(LocalDateTime cutoff);

    List<ImportSession> findByStatusIn(List<String> statuses);

    Optional<ImportSession> findFirstByTableKeyIgnoreCaseAndCommittedAtIsNotNullOrderByCommittedAtDesc(String tableKey);
}
