package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

// JPA mapping for IAM_Login_Roles — the small, stable set of roles (e.g. 'ADMIN', 'MANAGER',
// 'VIEWER') a user is assigned via IamLoginUserRole. Permissions attach to a role via
// IamLoginRolePermission, not directly to a user (except the per-user override in
// IamLoginUserPermission).
@Entity
@Table(name = "IAM_Login_Roles")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginRole {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "Role_ID")
    private Integer roleId;

    @Column(name = "Role_Name", length = 50, nullable = false)
    private String roleName;

    @Column(name = "Description", length = 255)
    private String description;
}
