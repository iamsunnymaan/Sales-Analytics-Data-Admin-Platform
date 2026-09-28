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

@Service
public class FeatureManagementService {

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

    public void invalidateAllGrantedFeatureKeysCache() {
        grantedFeatureKeysCache.evictAll();
    }

    public void invalidateGrantedFeatureKeysCache(Long userId) {
        grantedFeatureKeysCache.evict(userId);
    }

    public List<Integer> getGrantedFeatureIdsForRole(Integer roleId) {
        return roleFeatureGrantRepository.findByIdRoleId(roleId).stream()
                .map(grant -> grant.getId().getFeatureId())
                .collect(Collectors.toList());
    }

    @Transactional
    public void replaceRoleFeatures(Integer roleId, List<Integer> featureIds) {
        roleFeatureGrantRepository.deleteByIdRoleId(roleId);
        if (featureIds != null) {
            featureIds.stream().distinct().forEach(featureId ->
                    roleFeatureGrantRepository.save(new IamRoleFeatureGrant(new IamRoleFeatureGrantId(roleId, featureId))));
        }
        invalidateAllGrantedFeatureKeysCache();
    }

    @Transactional
    public void deleteRoleFeatures(Integer roleId) {
        roleFeatureGrantRepository.deleteByIdRoleId(roleId);
        invalidateAllGrantedFeatureKeysCache();
    }
}
