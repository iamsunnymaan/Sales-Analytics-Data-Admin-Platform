package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginPermission;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface IamLoginPermissionRepository extends JpaRepository<IamLoginPermission, Integer> {

    Optional<IamLoginPermission> findByPermissionKey(String permissionKey);
}
