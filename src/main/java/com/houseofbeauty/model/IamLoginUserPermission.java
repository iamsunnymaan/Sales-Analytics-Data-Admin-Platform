package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;


@Entity
@Table(name = "IAM_Login_User_Permissions")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginUserPermission {

    @EmbeddedId
    private IamLoginUserPermissionId id;

    @Column(name = "Effect", length = 10, nullable = false)
    private String effect;
}
