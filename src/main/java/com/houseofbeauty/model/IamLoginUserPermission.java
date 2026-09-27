package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

// JPA mapping for IAM_Login_User_Permissions — a per-user GRANT/REVOKE override on top of
// whatever the user's role(s) already allow via IamLoginRolePermission. Effect is either 'GRANT'
// (extra permission beyond the role) or 'REVOKE' (takes away something the role would otherwise
// allow) — a user's effective permission set is role permissions plus GRANTs minus REVOKEs.
@Entity
@Table(name = "IAM_Login_User_Permissions")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginUserPermission {

    @EmbeddedId
    private IamLoginUserPermissionId id;

    @Column(name = "Effect", length = 10, nullable = false)
    private String effect;
}
