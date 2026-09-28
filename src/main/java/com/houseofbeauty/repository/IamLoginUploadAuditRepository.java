package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginUploadAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface IamLoginUploadAuditRepository extends JpaRepository<IamLoginUploadAudit, Long> {

    @Modifying
    @Query("UPDATE IamLoginUploadAudit a SET a.userId = null WHERE a.userId = :userId")
    void detachUser(@Param("userId") Long userId);

    List<IamLoginUploadAudit> findTop300ByOrderByAttemptedAtDesc();
}
