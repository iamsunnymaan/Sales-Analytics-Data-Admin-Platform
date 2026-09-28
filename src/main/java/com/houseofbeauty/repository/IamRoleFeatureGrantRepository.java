package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamRoleFeatureGrant;
import com.houseofbeauty.model.IamRoleFeatureGrantId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface IamRoleFeatureGrantRepository extends JpaRepository<IamRoleFeatureGrant, IamRoleFeatureGrantId> {

    List<IamRoleFeatureGrant> findByIdRoleId(Integer roleId);

    List<IamRoleFeatureGrant> findByIdRoleIdIn(Collection<Integer> roleIds);

    void deleteByIdRoleId(Integer roleId);

    void deleteByIdFeatureId(Integer featureId);
}
