package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;


@Entity
@Table(name = "IAM_Feature_User_Denials")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamFeatureUserDenial {

    @EmbeddedId
    private IamFeatureUserDenialId id;

    @Column(name = "Denied_At", nullable = false)
    private LocalDateTime deniedAt;
}
