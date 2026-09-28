package com.houseofbeauty.repository;

import com.houseofbeauty.model.IamLoginUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface IamLoginUserRepository extends JpaRepository<IamLoginUser, Long> {

    Optional<IamLoginUser> findByUsernameIgnoreCase(String username);

    boolean existsByUsernameIgnoreCase(String username);

    Optional<IamLoginUser> findByEmailIgnoreCase(String email);
}
