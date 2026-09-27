package com.houseofbeauty.model;

import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

// JPA mapping for IAM_Login_Role_Permissions — the Roles<->Permissions junction: what every
// user holding a given role can do.
@Entity
@Table(name = "IAM_Login_Role_Permissions")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginRolePermission {

    @EmbeddedId
    private IamLoginRolePermissionId id;
}
