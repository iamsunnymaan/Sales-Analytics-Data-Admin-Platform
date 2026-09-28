package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginUserPermission;
import com.houseofbeauty.model.IamLoginUserPermissionId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IamLoginUserPermissionRepository extends JpaRepository<IamLoginUserPermission, IamLoginUserPermissionId> {

    List<IamLoginUserPermission> findByIdUserId(Long userId);

    void deleteByIdUserId(Long userId);

    void deleteByIdPermissionId(Integer permissionId);
}
