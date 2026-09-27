package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginRole;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface IamLoginRoleRepository extends JpaRepository<IamLoginRole, Integer> {

    Optional<IamLoginRole> findByRoleNameIgnoreCase(String roleName);
}
