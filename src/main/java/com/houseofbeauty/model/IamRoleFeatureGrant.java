package com.houseofbeauty.model;

import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

// JPA mapping for IAM_Role_Feature_Grants — the Roles<->Features junction: a row's presence
// means the role grants that Feature to every user holding it (see FeatureManagementService's own
// header comment for how this composes with the per-user IAM_Feature_User_Denials override).
@Entity
@Table(name = "IAM_Role_Feature_Grants")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamRoleFeatureGrant {

    @EmbeddedId
    private IamRoleFeatureGrantId id;
}
