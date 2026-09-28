package com.houseofbeauty.model;

import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;


@Entity
@Table(name = "IAM_Role_Feature_Grants")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamRoleFeatureGrant {

    @EmbeddedId
    private IamRoleFeatureGrantId id;
}
