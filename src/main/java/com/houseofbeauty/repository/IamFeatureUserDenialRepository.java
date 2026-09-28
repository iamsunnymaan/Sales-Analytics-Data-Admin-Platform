package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamFeatureUserDenial;
import com.houseofbeauty.model.IamFeatureUserDenialId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IamFeatureUserDenialRepository extends JpaRepository<IamFeatureUserDenial, IamFeatureUserDenialId> {

    List<IamFeatureUserDenial> findByIdUserId(Long userId);

    void deleteByIdUserId(Long userId);

    void deleteByIdFeatureId(Integer featureId);
}
