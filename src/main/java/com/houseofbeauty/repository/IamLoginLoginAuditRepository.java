package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginLoginAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface IamLoginLoginAuditRepository extends JpaRepository<IamLoginLoginAudit, Long> {

    @Modifying
    @Query("UPDATE IamLoginLoginAudit a SET a.userId = null WHERE a.userId = :userId")
    void detachUser(@Param("userId") Long userId);

    List<IamLoginLoginAudit> findTop300ByOrderByAttemptedAtDesc();

    List<IamLoginLoginAudit> findBySuccessTrueAndAttemptedAtAfter(LocalDateTime since);
}
