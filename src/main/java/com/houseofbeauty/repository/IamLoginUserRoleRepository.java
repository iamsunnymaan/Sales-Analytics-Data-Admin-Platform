package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginUserRole;
import com.houseofbeauty.model.IamLoginUserRoleId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IamLoginUserRoleRepository extends JpaRepository<IamLoginUserRole, IamLoginUserRoleId> {

    // "IdUserId" resolves to the embedded id's userId property (id.userId) — used by AuthService
    // to look up every role a user holds.
    List<IamLoginUserRole> findByIdUserId(Long userId);

    // Used by UserManagementService to replace a user's whole role set on edit, and to clear it
    // before a hard delete (FK_IAM_Login_UserRoles_Users would otherwise block the delete).
    void deleteByIdUserId(Long userId);

    // Used by RoleManagementService for the Roles page's "Users" column (how many accounts hold
    // this role) and to clear assignments before a role is hard-deleted.
    long countByIdRoleId(Integer roleId);

    void deleteByIdRoleId(Integer roleId);
}
