package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;


@Embeddable
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginUserPermissionId implements Serializable {

    @Column(name = "User_ID")
    private Long userId;

    @Column(name = "Permission_ID")
    private Integer permissionId;
}
