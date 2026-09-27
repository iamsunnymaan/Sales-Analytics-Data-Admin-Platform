package com.houseofbeauty.model;

import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

// JPA mapping for IAM_Login_User_Roles — the Users<->Roles junction. A user can hold more
// than one role; AuthService unions the permissions of every role a user has.
@Entity
@Table(name = "IAM_Login_User_Roles")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginUserRole {

    @EmbeddedId
    private IamLoginUserRoleId id;
}
