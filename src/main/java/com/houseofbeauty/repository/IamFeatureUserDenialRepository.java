package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamFeatureUserDenial;
import com.houseofbeauty.model.IamFeatureUserDenialId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IamFeatureUserDenialRepository extends JpaRepository<IamFeatureUserDenial, IamFeatureUserDenialId> {

    // "IdUserId" resolves to the embedded id's userId property (id.userId) — every denial row for
    // one user, used to compute their granted-Feature complement.
    List<IamFeatureUserDenial> findByIdUserId(Long userId);

    // Clears a user's denials before a full-replace re-save (FeatureManagementService.
    // replaceUserFeatures) — NOT relied on for delete-user cleanup, since the FK carries
    // ON DELETE CASCADE precisely so UserManagementService.deleteUser never has to know this table
    // exists.
    void deleteByIdUserId(Long userId);

    // Unused today; kept for a possible future "retire a Feature key" cleanup step, mirroring
    // IamLoginUserPermissionRepository.deleteByIdPermissionId's own precedent.
    void deleteByIdFeatureId(Integer featureId);
}
