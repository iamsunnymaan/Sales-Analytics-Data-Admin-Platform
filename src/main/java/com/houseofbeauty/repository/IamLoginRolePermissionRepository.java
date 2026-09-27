package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginRolePermission;
import com.houseofbeauty.model.IamLoginRolePermissionId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface IamLoginRolePermissionRepository extends JpaRepository<IamLoginRolePermission, IamLoginRolePermissionId> {

    // "IdRoleId" resolves to the embedded id's roleId property (id.roleId) — used to load every
    // permission a given role grants.
    List<IamLoginRolePermission> findByIdRoleId(Integer roleId);

    // Batch form of the above — AuthService.effectivePermissions resolves every role a user holds
    // in one query instead of one per role (that loop used to run on every single request with no
    // caching at all, see permissionsCache's own header comment).
    List<IamLoginRolePermission> findByIdRoleIdIn(Collection<Integer> roleIds);

    // Used by RoleManagementService to replace a role's whole permission set on edit, and to
    // clear it before a hard delete.
    void deleteByIdRoleId(Integer roleId);

    // Used by AuthBootstrapSeeder to clear every role's grant of a permission key that's been
    // retired from PERMISSION_TREE before the permission row itself is deleted.
    void deleteByIdPermissionId(Integer permissionId);
}
