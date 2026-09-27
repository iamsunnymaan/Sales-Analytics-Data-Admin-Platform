package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamRoleFeatureGrant;
import com.houseofbeauty.model.IamRoleFeatureGrantId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface IamRoleFeatureGrantRepository extends JpaRepository<IamRoleFeatureGrant, IamRoleFeatureGrantId> {

    // "IdRoleId" resolves to the embedded id's roleId property (id.roleId) — every Feature one role
    // grants, used to populate the Edit Role popup's Feature checkboxes and to resolve a user's
    // effective granted set across all their roles.
    List<IamRoleFeatureGrant> findByIdRoleId(Integer roleId);

    // Batch form — FeatureManagementService.roleGrantedFeatureIds resolves every role a user holds
    // in one query instead of one per role.
    List<IamRoleFeatureGrant> findByIdRoleIdIn(Collection<Integer> roleIds);

    // Used by FeatureManagementService to replace a role's whole Feature grant set on role edit,
    // and by RoleManagementService.deleteRole to clear it before a hard delete.
    void deleteByIdRoleId(Integer roleId);

    // Used by FeatureBootstrapSeeder to clear every role's grant of a Feature key that's ever
    // retired from the catalog, mirroring IamLoginRolePermissionRepository.deleteByIdPermissionId's
    // own precedent — unused today since FEATURE_CATALOG has never dropped a key, kept for parity.
    void deleteByIdFeatureId(Integer featureId);
}
