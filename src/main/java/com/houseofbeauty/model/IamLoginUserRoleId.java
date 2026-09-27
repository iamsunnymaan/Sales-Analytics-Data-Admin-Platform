package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

// Composite key (User_ID, Role_ID) for IAM_Login_User_Roles — see IamLoginUserRole. This
// codebase otherwise avoids JPA relationship/composite-key mapping entirely (every other entity
// keeps FK columns as plain scalar fields, see e.g. PrimarySale.billTo/.articleCode), but a
// junction table with no extra columns genuinely needs a composite id, so this is the first one.
@Embeddable
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginUserRoleId implements Serializable {

    @Column(name = "User_ID")
    private Long userId;

    @Column(name = "Role_ID")
    private Integer roleId;
}
