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
public class IamLoginUserRoleId implements Serializable {

    @Column(name = "User_ID")
    private Long userId;

    @Column(name = "Role_ID")
    private Integer roleId;
}
