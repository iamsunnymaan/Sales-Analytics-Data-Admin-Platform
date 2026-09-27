package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

// Composite key (Role_ID, Permission_ID) for IAM_Login_Role_Permissions — see
// IamLoginRolePermission.
@Embeddable
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginRolePermissionId implements Serializable {

    @Column(name = "Role_ID")
    private Integer roleId;

    @Column(name = "Permission_ID")
    private Integer permissionId;
}
