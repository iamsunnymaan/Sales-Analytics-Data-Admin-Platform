package com.houseofbeauty.service.feature;

import com.houseofbeauty.dto.features.response.FeatureOptionResponse;
import com.houseofbeauty.model.IamFeature;
import com.houseofbeauty.model.IamRoleFeatureGrant;
import com.houseofbeauty.model.IamRoleFeatureGrantId;
import com.houseofbeauty.repository.IamFeatureRepository;
import com.houseofbeauty.repository.IamFeatureUserDenialRepository;
import com.houseofbeauty.repository.IamLoginUserRoleRepository;
import com.houseofbeauty.repository.IamRoleFeatureGrantRepository;
import com.houseofbeauty.util.TtlCache;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

// Backs the "Features" system — the 10 shared UI widgets under static/components/. Two grant layers
// compose to decide whether a given user actually sees one:
//
//  1. Per-ROLE grants (IAM_Role_Feature_Grants, new) — a role only shows a Feature to its holders if
//     it has an explicit grant row for it. Edited from the same Edit Role popup as Page/Section
//     permissions (RolesPage.js's SECTION_FEATURE_KEYS tree), via replaceRoleFeatures below.
//  2. Per-USER denials (IAM_Feature_User_Denials, pre-existing) — the final override: even if every
//     role a user holds grants a Feature, an explicit denial row here still turns it off for that
//     one user. Nothing currently WRITES a denial (the per-user Features popup field and the Super
//     Admin "Feature Bulk Management" matrix that used to write these were both removed per explicit
//     request) — any denial rows already in the table from before that removal still apply, this
//     just has no UI left to create new ones.
//
// A user's effective granted set is therefore: granted by AT LEAST ONE of their roles, AND not
// personally denied. This used to be a wholly independent, per-user-only system with no Role
// involvement at all (a Feature was granted to everyone by default, denials were the only lever) —
// that default-open behavior is preserved for every pre-existing role/user by FeatureBootstrapSeeder
// seeding every existing role with every catalog Feature the first time IAM_Role_Feature_Grants is
// empty; a role created afterward starts with none granted, same as a brand-new role's Page/Section
// permissions start unchecked.
@Service
public class FeatureManagementService {

    // getGrantedFeatureKeys(userId) backs GET /api/features/me, called by every page's
    // Shared/js/feature-guard.js — same "recomputed from scratch on every single request" cost
    // AuthService's permissionsCache header comment describes, just for the Feature side. Cached
    // per-user with the same short, bounded-staleness TTL; replaceRoleFeatures/deleteRoleFeatures
    // below evict on the writes that actually change grants so an admin's edit is immediate.
    private static final long GRANTED_FEATURE_KEYS_CACHE_TTL_MILLIS = 30_000;
    private final TtlCache<Long, List<String>> grantedFeatureKeysCache = new TtlCache<>(GRANTED_FEATURE_KEYS_CACHE_TTL_MILLIS);

    private final IamFeatureRepository featureRepository;
    private final IamFeatureUserDenialRepository denialRepository;
    private final IamLoginUserRoleRepository userRoleRepository;
    private final IamRoleFeatureGrantRepository roleFeatureGrantRepository;

    public FeatureManagementService(IamFeatureRepository featureRepository,
                                     IamFeatureUserDenialRepository denialRepository,
                                     IamLoginUserRoleRepository userRoleRepository,
                                     IamRoleFeatureGrantRepository roleFeatureGrantRepository) {
        this.featureRepository = featureRepository;
        this.denialRepository = denialRepository;
        this.userRoleRepository = userRoleRepository;
        this.roleFeatureGrantRepository = roleFeatureGrantRepository;
    }

    public List<FeatureOptionResponse> listCatalog() {
        return featureRepository.findAll().stream()
                .sorted(Comparator.comparing(IamFeature::getFeatureId))
                .map(feature -> new FeatureOptionResponse(feature.getFeatureId(), feature.getFeatureKey(),
                        feature.getLabel(), feature.getDescription()))
                .collect(Collectors.toList());
    }

    private Set<Integer> roleGrantedFeatureIds(Long userId) {
        List<Integer> roleIds = userRoleRepository.findByIdUserId(userId).stream()
                .map(userRole -> userRole.getId().getRoleId())
                .collect(Collectors.toList());
        if (roleIds.isEmpty()) {
            return Set.of();
        }
        Set<Integer> granted = new HashSet<>();
        roleFeatureGrantRepository.findByIdRoleIdIn(roleIds)
                .forEach(grant -> granted.add(grant.getId().getFeatureId()));
        return granted;
    }

    // Cached — see grantedFeatureKeysCache's own header comment.
    public List<String> getGrantedFeatureKeys(Long userId) {
        return grantedFeatureKeysCache.get(userId, this::computeGrantedFeatureKeys);
    }

    private List<String> computeGrantedFeatureKeys(Long userId) {
        Set<Integer> roleGranted = roleGrantedFeatureIds(userId);
        Set<Integer> deniedIds = denialRepository.findByIdUserId(userId).stream()
                .map(denial -> denial.getId().getFeatureId())
                .collect(Collectors.toCollection(HashSet::new));

        return featureRepository.findAll().stream()
                .filter(feature -> roleGranted.contains(feature.getFeatureId()) && !deniedIds.contains(feature.getFeatureId()))
                .map(IamFeature::getFeatureKey)
                .collect(Collectors.toList());
    }

    // Called by RoleManagementService (a role's own Feature grants changed — every holder is
    // affected) and by UserManagementService for a single user's own role/denial changes.
    public void invalidateAllGrantedFeatureKeysCache() {
        grantedFeatureKeysCache.evictAll();
    }

    public void invalidateGrantedFeatureKeysCache(Long userId) {
        grantedFeatureKeysCache.evict(userId);
    }

    // The Feature IDs one role directly grants — populates the Edit Role popup's Feature checkboxes
    // (RoleManagementService includes this in RoleSummaryResponse).
    public List<Integer> getGrantedFeatureIdsForRole(Integer roleId) {
        return roleFeatureGrantRepository.findByIdRoleId(roleId).stream()
                .map(grant -> grant.getId().getFeatureId())
                .collect(Collectors.toList());
    }

    // Full-replace of one role's Feature grants — called by RoleManagementService.createRole/
    // updateRole alongside assignPermissions, same delete-then-reinsert convention. A null
    // featureIds means "grant nothing" (a brand-new role's Feature checkboxes start unchecked, same
    // as its Page/Section permissions).
    @Transactional
    public void replaceRoleFeatures(Integer roleId, List<Integer> featureIds) {
        roleFeatureGrantRepository.deleteByIdRoleId(roleId);
        if (featureIds != null) {
            featureIds.stream().distinct().forEach(featureId ->
                    roleFeatureGrantRepository.save(new IamRoleFeatureGrant(new IamRoleFeatureGrantId(roleId, featureId))));
        }
        invalidateAllGrantedFeatureKeysCache();
    }

    // Called by RoleManagementService.deleteRole before the role row itself is removed — mirrors
    // rolePermissionRepository.deleteByIdRoleId's own precedent (the FK's ON DELETE CASCADE would
    // also clean this up, but explicit deletion keeps the ordering obvious and doesn't rely on the
    // cascade alone, same reasoning already applied to every other Role_ID-keyed junction table).
    @Transactional
    public void deleteRoleFeatures(Integer roleId) {
        roleFeatureGrantRepository.deleteByIdRoleId(roleId);
        invalidateAllGrantedFeatureKeysCache();
    }
}
