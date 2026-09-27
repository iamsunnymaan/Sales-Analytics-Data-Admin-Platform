package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

// Composite key (Role_ID, Feature_ID) for IAM_Role_Feature_Grants — see IamRoleFeatureGrant.
@Embeddable
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamRoleFeatureGrantId implements Serializable {

    @Column(name = "Role_ID")
    private Integer roleId;

    @Column(name = "Feature_ID")
    private Integer featureId;
}
