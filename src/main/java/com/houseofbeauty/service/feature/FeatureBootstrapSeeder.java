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

// One-time-per-startup bootstrap for the Feature catalog, plus a one-time-ever seed of every
// existing role's Feature grants — wholly independent of AuthBootstrapSeeder (which seeds
// Roles/Permissions/Users itself) and never touches IamFeatureUserDenialRepository. Upserts
// FEATURE_CATALOG by key on every startup, same non-destructive convention as
// AuthBootstrapSeeder.seedOrUpgradePermissionCatalog: a key that already exists gets its
// label/description brought in line (never its Feature_ID, so any existing denial/grant row against
// it survives), a key that doesn't exist yet gets created, nothing is ever deleted here even if a
// key is later dropped from this list.
//
// Deliberately does NOT do any per-user seeding — there is no "grant every user every Feature" step
// anywhere in this class, and there doesn't need to be: IAM_Feature_User_Denials stores denials, not
// grants, so an empty (or partially-populated) denials table already means "granted" for every id it
// has no row for. This is what guarantees an admin's earlier deliberate denial for one user is never
// silently undone by a later app restart — this class has no code path that could ever touch that
// table.
//
// It DOES seed per-ROLE grants once, though (seedRoleFeatureGrantsIfEmpty): unlike denials,
// IAM_Role_Feature_Grants stores grants directly (see FeatureManagementService's own header
// comment), so an empty table there would mean nobody has any Feature via their role at all — a real
// behavior change for every existing user, who previously had every Feature by default with no role
// involved. Seeding every role that exists the first time this table is empty with every catalog
// Feature preserves that exact "everyone already has everything" starting point; a role created
// afterward starts with none granted, same as a brand-new role's Page/Section permissions.
@Component
public class FeatureBootstrapSeeder {

    private static final Logger log = LoggerFactory.getLogger(FeatureBootstrapSeeder.class);

    private record FeatureDef(String key, String label, String description) {
    }

    // One entry per shared UI widget under static/components/ — "Edit Row" has no shared component
    // (it's Explorer's own inline-cell-editing feature) but still gets a catalog entry like every
    // other Feature, gated directly inside ExplorerPage.js instead of a components/ module.
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

    // Added after the original catalog/seedRoleFeatureGrantsIfEmpty already ran (that method only
    // ever fires once, guarded by the grants table being empty — see its own header comment), so
    // these 6 new keys would otherwise never reach ANY role, including ADMIN/SUPERADMIN, and their
    // New User/Edit/Delete/New Role buttons would vanish the moment this catalog entry ships. Same
    // "auto top-up so an existing tier never regresses when a new key is introduced" pattern
    // AuthBootstrapSeeder.topUpAdminPermissions/topUpSuperAdminPermissions already use for the
    // Permission catalog — scoped to just these 6 keys (not every Feature) so it can never re-grant
    // something an admin may have deliberately unchecked for ADMIN/SUPERADMIN since the original
    // one-time seed ran. MANAGER/VIEWER/any custom role are left untouched, same as every other
    // Feature — they start with none of these granted until an admin checks them on the Roles page.
    private static final Set<String> ADMIN_TOP_UP_FEATURE_KEYS = Set.of(
            "feature:new-user", "feature:edit-user", "feature:delete-user",
            "feature:new-role", "feature:edit-role", "feature:delete-role"
    );

    private final IamFeatureRepository featureRepository;
    private final IamLoginRoleRepository roleRepository;
    private final IamRoleFeatureGrantRepository roleFeatureGrantRepository;
    private final TransactionTemplate transactionTemplate;

    // @Transactional on a @PostConstruct method is a no-op — the AOP proxy that would open the
    // transaction doesn't exist yet at this point in the bean lifecycle (@PostConstruct runs on the
    // raw target, before postProcessAfterInitialization wraps it). TransactionTemplate opens a real
    // transaction imperatively via the injected PlatformTransactionManager, sidestepping the proxy
    // entirely — same fix AuthBootstrapSeeder uses for the exact same reason (see that class's own
    // header comment for the fuller story of the bug this avoids).
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
            // Never fail application startup over this — an unreachable DB at boot (or the
            // migration not having been run yet) just means seeding is skipped this run, same
            // defensive posture as AuthBootstrapSeeder.seedIfEmpty.
            log.warn("Feature catalog bootstrap seeding skipped: {}", ex.getMessage());
        }
    }

    // Runs once, ever (guarded by the grants table being empty, not re-checked on later startups —
    // an admin later unchecking a Feature for a role must survive every future restart, same
    // "seed only if empty" convention AuthBootstrapSeeder.seedRolesIfEmpty/seedUsersIfEmpty already
    // use for Roles/Users themselves, deliberately NOT the "upsert every startup" convention
    // upsertCatalog uses for the catalog's own label/description).
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

    // Runs on every startup (unlike seedRoleFeatureGrantsIfEmpty, which only ever fires once) —
    // idempotent via grant()'s own existsById guard, so it's a true no-op once ADMIN/SUPERADMIN
    // already hold these grants.
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

    // Explicit existence check for the same reason AuthBootstrapSeeder's own grant() documents —
    // IamRoleFeatureGrant has no state besides its own @EmbeddedId, so save() alone doesn't reliably
    // no-op for an already-granted (roleId, featureId) pair.
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
