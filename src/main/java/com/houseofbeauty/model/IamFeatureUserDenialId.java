package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

// Composite key (User_ID, Feature_ID) for IAM_Feature_User_Denials — see IamFeatureUserDenial.
@Embeddable
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamFeatureUserDenialId implements Serializable {

    @Column(name = "User_ID")
    private Long userId;

    @Column(name = "Feature_ID")
    private Integer featureId;
}
