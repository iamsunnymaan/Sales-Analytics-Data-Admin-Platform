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

// JPA mapping for IAM_Feature_Catalog — the seeded, flat registry of Feature keys (e.g.
// "feature:brand-filter"), one per shared UI widget under static/components/. Wholly independent
// of IAM_Login_Permission's Page->Section tree — this catalog has no hierarchy, no parent column,
// and is never consulted by PermissionInterceptor/AuthService. See FeatureManagementService's own
// header comment for how a user's granted Features are actually resolved.
@Entity
@Table(name = "IAM_Feature_Catalog")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IamFeature {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "Feature_ID")
    private Integer featureId;

    @Column(name = "Feature_Key", length = 100, nullable = false)
    private String featureKey;

    @Column(name = "Label", length = 150)
    private String label;

    @Column(name = "Description", length = 255)
    private String description;
}
