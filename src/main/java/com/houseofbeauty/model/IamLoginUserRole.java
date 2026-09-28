package com.houseofbeauty.model;

import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;


@Entity
@Table(name = "IAM_Login_User_Roles")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginUserRole {

    @EmbeddedId
    private IamLoginUserRoleId id;
}
