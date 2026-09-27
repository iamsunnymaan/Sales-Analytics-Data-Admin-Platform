package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

// JPA mapping for IAM_Feature_User_Denials — a row here means the given user has this Feature
// turned OFF; the ABSENCE of a row means granted (the default for everyone). This is the inverse
// of IAM_Login_User_Permissions' GRANT/REVOKE model on purpose — see
// FeatureManagementService's own header comment for the full reasoning. Nothing outside
// FeatureManagementService should read/write this entity directly; every other layer (controllers,
// frontend) speaks only in terms of granted Feature ids/keys.
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
