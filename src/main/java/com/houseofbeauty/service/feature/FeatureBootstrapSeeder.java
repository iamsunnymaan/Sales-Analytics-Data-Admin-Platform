package com.houseofbeauty.service.feature;

import com.houseofbeauty.model.IamFeature;
import com.houseofbeauty.model.IamLoginRole;
import com.houseofbeauty.model.IamRoleFeatureGrant;
import com.houseofbeauty.model.IamRoleFeatureGrantId;
import com.houseofbeauty.repository.IamFeatureRepository;
import com.houseofbeauty.repository.IamLoginRoleRepository;
import com.houseofbeauty.repository.IamRoleFeatureGrantRepository;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

@Component
public class FeatureBootstrapSeeder {

    private static final Logger log = LoggerFactory.getLogger(FeatureBootstrapSeeder.class);

    private record FeatureDef(String key, String label, String description) {
    }

    private static final List<FeatureDef> FEATURE_CATALOG = List.of(
            new FeatureDef("feature:sales-type-filter", "Sales Type Filter", "The Primary/Secondary/All Sales Type pill."),
            new FeatureDef("feature:brand-filter", "Brand Filter", "The ABH/Kylie (or page-specific) Brand pill."),
            new FeatureDef("feature:channel-filter", "Channel Filter", "The Online/Offline (or page-specific) Channel pill."),
            new FeatureDef("feature:fy-year-filter", "FY Year Filter", "The Financial Year dropdown filter."),
            new FeatureDef("feature:date-filter", "Date Filter", "The By Date/By Month/By Year range picker."),
            new FeatureDef("feature:status-filter", "Status Filter", "The All/Active/Inactive/Upcoming status pill."),
            new FeatureDef("feature:edit-row", "Edit Row", "Explorer's inline per-row cell editing."),
            new FeatureDef("feature:search-bar", "Search Bar", "The free-text/month search input."),
            new FeatureDef("feature:template-download", "Excel Download", "Downloading a blank import template."),
            new FeatureDef("feature:excel-download", "Excel Download", "Downloading a CSV/XLSX export of on-screen data."),
            new FeatureDef("feature:new-user", "New User Button", "Opens the New User popup on the Roles & Users/IAM User Details table."),
            new FeatureDef("feature:edit-user", "Edit User", "The per-row Edit Profile action on the User Details table."),
            new FeatureDef("feature:delete-user", "Delete User", "The per-row Delete action on the User Details table."),
            new FeatureDef("feature:new-role", "New Role Button", "Opens the New Role popup on the Roles & Users page's Role and Details table."),
            new FeatureDef("feature:edit-role", "Edit Role", "The per-row Edit Role action on the Role and Details table."),
            new FeatureDef("feature:delete-role", "Delete Role", "The per-row Delete action on the Role and Details table.")
    );

    private static final Set<String> ADMIN_TOP_UP_FEATURE_KEYS = Set.of(
            "feature:new-user", "feature:edit-user", "feature:delete-user",
            "feature:new-role", "feature:edit-role", "feature:delete-role"
    );

    private final IamFeatureRepository featureRepository;
    private final IamLoginRoleRepository roleRepository;
    private final IamRoleFeatureGrantRepository roleFeatureGrantRepository;
    private final TransactionTemplate transactionTemplate;

    public FeatureBootstrapSeeder(IamFeatureRepository featureRepository,
                                   IamLoginRoleRepository roleRepository,
                                   IamRoleFeatureGrantRepository roleFeatureGrantRepository,
                                   PlatformTransactionManager transactionManager) {
        this.featureRepository = featureRepository;
        this.roleRepository = roleRepository;
        this.roleFeatureGrantRepository = roleFeatureGrantRepository;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @PostConstruct
    public void seedIfEmpty() {
        try {
            transactionTemplate.executeWithoutResult(status -> {
                List<IamFeature> catalog = upsertCatalog();
                seedRoleFeatureGrantsIfEmpty(catalog);
                topUpAdminAndSuperAdminFeatures(catalog);
            });
        } catch (Exception ex) {

            log.warn("Feature catalog bootstrap seeding skipped: {}", ex.getMessage());
        }
    }

    private void seedRoleFeatureGrantsIfEmpty(List<IamFeature> catalog) {
        if (roleFeatureGrantRepository.count() > 0 || catalog.isEmpty()) {
            return;
        }
        List<IamLoginRole> roles = roleRepository.findAll();
        if (roles.isEmpty()) {
            return;
        }
        for (IamLoginRole role : roles) {
            for (IamFeature feature : catalog) {
                roleFeatureGrantRepository.save(new IamRoleFeatureGrant(
                        new IamRoleFeatureGrantId(role.getRoleId(), feature.getFeatureId())));
            }
        }
        log.info("Feature grants: seeded {} existing role(s) with all {} catalog Feature(s) (first-time, preserves prior default-open behavior).",
                roles.size(), catalog.size());
    }

    private void topUpAdminAndSuperAdminFeatures(List<IamFeature> catalog) {
        List<IamLoginRole> targets = new ArrayList<>();
        roleRepository.findByRoleNameIgnoreCase("ADMIN").ifPresent(targets::add);
        roleRepository.findByRoleNameIgnoreCase("SUPERADMIN").ifPresent(targets::add);
        if (targets.isEmpty()) {
            return;
        }
        catalog.stream()
                .filter(feature -> ADMIN_TOP_UP_FEATURE_KEYS.contains(feature.getFeatureKey()))
                .forEach(feature -> targets.forEach(role -> grant(role.getRoleId(), feature.getFeatureId())));
    }

    private void grant(Integer roleId, Integer featureId) {
        IamRoleFeatureGrantId id = new IamRoleFeatureGrantId(roleId, featureId);
        if (!roleFeatureGrantRepository.existsById(id)) {
            roleFeatureGrantRepository.save(new IamRoleFeatureGrant(id));
        }
    }

    private List<IamFeature> upsertCatalog() {
        Map<String, IamFeature> existingByKey = new LinkedHashMap<>();
        featureRepository.findAll().forEach(feature -> existingByKey.put(feature.getFeatureKey(), feature));

        List<String> createdKeys = new ArrayList<>();
        List<IamFeature> catalog = new ArrayList<>();

        for (FeatureDef def : FEATURE_CATALOG) {
            IamFeature feature = existingByKey.get(def.key());
            if (feature == null) {
                feature = new IamFeature();
                feature.setFeatureKey(def.key());
                createdKeys.add(def.key());
            }

            boolean changed = feature.getFeatureId() == null
                    || !Objects.equals(feature.getLabel(), def.label())
                    || !Objects.equals(feature.getDescription(), def.description());

            feature.setLabel(def.label());
            feature.setDescription(def.description());

            if (changed) {
                feature = featureRepository.save(feature);
            }
            catalog.add(feature);
        }

        if (!createdKeys.isEmpty()) {
            log.info("Feature catalog: added {} new feature key(s): {}", createdKeys.size(), createdKeys);
        }
        return catalog;
    }
}
