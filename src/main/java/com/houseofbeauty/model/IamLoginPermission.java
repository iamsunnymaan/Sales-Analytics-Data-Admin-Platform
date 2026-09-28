package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;


@Entity
@Table(name = "IAM_Login_Permissions")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamLoginPermission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "Permission_ID")
    private Integer permissionId;

    @Column(name = "Permission_Key", length = 150, nullable = false)
    private String permissionKey;

    @Column(name = "Label", length = 150)
    private String label;

    @Column(name = "Description", length = 255)
    private String description;

    @Column(name = "Permission_Type", length = 10, nullable = false)
    private String permissionType;

    @Column(name = "Parent_Permission_ID")
    private Integer parentPermissionId;
}
