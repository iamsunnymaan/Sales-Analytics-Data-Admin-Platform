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

// JPA mapping for IAM_Login_Permissions — the seeded registry of page/section keys (e.g.
// "page:primary-sales.reports"). Rows here are managed data (seeded/admin-maintained by
// AuthBootstrapSeeder), not something an end user creates. Attached to roles via
// IamLoginRolePermission and, for per-user overrides, IamLoginUserPermission.
//
// permissionType + parentPermissionId form the real 2-level tree (PAGE -> SECTION) the Roles page's
// permission picker renders and Sidebar.js filters by — a Section is the finest grain there is (an
// earlier design had a 3rd FEATURE level under each Section; removed per explicit request, see
// AuthBootstrapSeeder's own header comment) — independent of how many dots are in permissionKey,
// since two pre-existing keys predate even the Section concept and keep their original 2-segment
// key (see the 2026-09-16_permission_hierarchy migration's header comment).
@Entity
@Table(name = "IAM_Login_Permissions")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginPermission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "Permission_ID")
    private Integer permissionId;

    @Column(name = "Permission_Key", length = 150, nullable = false)
    private String permissionKey;

    @Column(name = "Label", length = 150)
    private String label;

    @Column(name = "Description", length = 255)
    private String description;

    @Column(name = "Permission_Type", length = 10, nullable = false)
    private String permissionType;

    @Column(name = "Parent_Permission_ID")
    private Integer parentPermissionId;
}
