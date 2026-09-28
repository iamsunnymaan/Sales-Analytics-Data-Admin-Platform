package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginRolePermission;
import com.houseofbeauty.model.IamLoginRolePermissionId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface IamLoginRolePermissionRepository extends JpaRepository<IamLoginRolePermission, IamLoginRolePermissionId> {

    List<IamLoginRolePermission> findByIdRoleId(Integer roleId);

    List<IamLoginRolePermission> findByIdRoleIdIn(Collection<Integer> roleIds);

    void deleteByIdRoleId(Integer roleId);

    void deleteByIdPermissionId(Integer permissionId);
}
