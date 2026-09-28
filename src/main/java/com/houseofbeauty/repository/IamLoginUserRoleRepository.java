package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginUserRole;
import com.houseofbeauty.model.IamLoginUserRoleId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IamLoginUserRoleRepository extends JpaRepository<IamLoginUserRole, IamLoginUserRoleId> {

    List<IamLoginUserRole> findByIdUserId(Long userId);

    void deleteByIdUserId(Long userId);

    long countByIdRoleId(Integer roleId);

    void deleteByIdRoleId(Integer roleId);
}
