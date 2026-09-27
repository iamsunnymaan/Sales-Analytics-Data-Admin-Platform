package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginUserPermission;
import com.houseofbeauty.model.IamLoginUserPermissionId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IamLoginUserPermissionRepository extends JpaRepository<IamLoginUserPermission, IamLoginUserPermissionId> {

    // "IdUserId" resolves to the embedded id's userId property (id.userId) — used to load a
    // user's per-user GRANT/REVOKE overrides on top of their role permissions.
    List<IamLoginUserPermission> findByIdUserId(Long userId);

    // Clears any per-user override before a hard delete (FK_IAM_Login_UserPermissions_Users would
    // otherwise block it) — see UserManagementService.deleteUser.
    void deleteByIdUserId(Long userId);

    // Used by AuthBootstrapSeeder to clear any per-user override of a permission key that's been
    // retired from PERMISSION_TREE (e.g. the old standalone "page:users" node, folded into
    // "page:roles" when the Users page was merged into the Roles page) before the permission row
    // itself is deleted.
    void deleteByIdPermissionId(Integer permissionId);
}
