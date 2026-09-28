package com.houseofbeauty.service.auth;

import com.houseofbeauty.model.IamLoginPermission;
import com.houseofbeauty.model.IamLoginRole;
import com.houseofbeauty.model.IamLoginRolePermission;
import com.houseofbeauty.model.IamLoginRolePermissionId;
import com.houseofbeauty.model.IamLoginUser;
import com.houseofbeauty.model.IamLoginUserRole;
import com.houseofbeauty.model.IamLoginUserRoleId;
import com.houseofbeauty.repository.IamLoginPermissionRepository;
import com.houseofbeauty.repository.IamLoginRolePermissionRepository;
import com.houseofbeauty.repository.IamLoginRoleRepository;
import com.houseofbeauty.repository.IamLoginUserPermissionRepository;
import com.houseofbeauty.repository.IamLoginUserRepository;
import com.houseofbeauty.repository.IamLoginUserRoleRepository;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class AuthBootstrapSeeder {

    private static final Logger log = LoggerFactory.getLogger(AuthBootstrapSeeder.class);

    private static final String TYPE_PAGE = "PAGE";
    private static final String TYPE_SECTION = "SECTION";

    private record SectionDef(String key, String label, String description) {
    }

    private record PageDef(String key, String label, String description, List<SectionDef> sections) {
    }

    private static SectionDef section(String key, String label, String description) {
        return new SectionDef(key, label, description);
    }

    private static PageDef page(String key, String label, String description, SectionDef... sections) {
        return new PageDef(key, label, description, List.of(sections));
    }

    private static final List<PageDef> PERMISSION_TREE = List.of(
            page("page:dashboard", "Dashboard", "View the Dashboard page.",
                    section("page:dashboard.filter-header", "Filter Header", "Change the Overview's Sales Type/Brand/Channel/Year filters."),
                    section("page:dashboard.overview", "Overview", "View the Financial Year Overview table."),
                    section("page:dashboard.daily-trends", "Daily Sales Trends", "View the Sales Trend chart."),
                    section("page:dashboard.partner-performance", "Partner Wise", "View the Partner Wise Target Vs Achievement table.")),

            page("page:primary-sales", "Primary Sales", "View the Primary Sales page.",
                    section("page:primary-sales.overview", "Overview", "View the Primary Sales overview."),
                    section("page:primary-sales.daily-trends", "Daily Sales Trends", "View the daily sales trend chart."),
                    section("page:primary-sales.product-snapshot", "Product Snapshot", "View the Top10/Below10 product ranking."),
                    section("page:primary-sales.reports", "Reports", "View the Primary Sales reports tabs.")),

            page("page:secondary-sales", "Secondary Sales", "View the Secondary Sales page.",
                    section("page:secondary-sales.overview", "Overview", "View the Secondary Sales overview."),
                    section("page:secondary-sales.daily-trends", "Daily Sales Trends", "View the daily sales trend chart."),
                    section("page:secondary-sales.product-snapshot", "Product Snapshot", "View the Top10/Below10 product ranking."),
                    section("page:secondary-sales.reports", "Reports", "View the Secondary Sales reports tabs."),
                    section("page:secondary-sales.site-master-report", "Site_Master Secondary_Sale Report", "View the per-site Secondary Sales report.")),

            page("page:site-insights", "Site Insights", "View the Site Insights page.",
                    section("page:site-insights.site-picker", "Site Picker", "Pick a real Site_Code/Brand to inspect."),
                    section("page:site-insights.geo-compare", "Geo Map & Compare", "The Geo Map popup and the state/site/store Compare modal."),
                    section("page:site-insights.site-detail", "Site Detail", "The picked site's full profile.")),

            page("page:team-insights", "Team Insights", "View the Team Insights page.",
                    section("page:team-insights.filter-header", "Filter Header", "Change the report filters."),
                    section("page:team-insights.team-report", "Team Report", "View the team-wide report."),
                    section("page:team-insights.person-details", "Person Details", "View one person's details."),
                    section("page:team-insights.daily-sales", "Daily Sales", "View a person's daily sales."),
                    section("page:team-insights.person-sitemaster-report", "Person Sitemaster Report", "View a person's Site_Master report.")),

            page("page:explorer", "Explorer", "View the Explorer (raw table browser) page.",
                    section("page:explorer.tables", "Tables", "The list of browsable tables."),
                    section("page:explorer.table-data", "Table Data", "The picked table's row grid — also gates downloading it (see this class's own header comment on the folded-in old page:explorer.export key).")),

            page("page:data-upload", "Upload Data", "View the Upload Data page.",
                    section("page:data-upload.available-tables", "Available Tables", "The list of importable tables and their last import."),
                    section("page:data-upload.truncate-table", "Upload Data", "Run the destructive truncate-table action."),
                    section("page:data-upload.upload-verify", "Upload and Verify", "Upload a file, dry-run validate it, and commit it."),
                    section("page:data-upload.upload-history", "Upload History", "Past uploads and re-downloading them.")),

            page("page:roles", "User and Role", "View the Roles & Users page.",
                    section("page:roles.user-details", "User Details", "The user accounts table.")),

            page("page:iam", "IAM", "View the IAM page.",
                    section("page:iam.user-details", "User Details", "The user accounts table."),
                    section("page:iam.roles-details", "Role and Details", "The roles table.")),

            page("page:monitoring", "Monitoring", "View the Monitoring page.",
                    section("page:monitoring.login-attempts", "Usage Overview", "Login attempts data — gates the Usage Overview graph and the Audit view's Login rows."),
                    section("page:monitoring.download-attempts", "Attempts (Download)", "File download/export attempts — gates the Audit view's Download rows."),
                    section("page:monitoring.upload-attempts", "Attempts (Upload)", "File upload attempts on the Upload Data page — gates the Audit view's Upload rows."),
                    section("page:monitoring.unauthorized-attempts", "Attempts (Unauthorized)", "Blocked requests, missing page or API permission — gates the Audit view's Unauthorized rows."),
                    section("page:monitoring.password-reset-tokens", "Password Reset Tokens", "Issued password-reset tokens."),
                    section("page:monitoring.otps", "Recent OTPs", "Issued OTP codes."),
                    section("page:monitoring.audit", "Audit", "Type/Status/Search/Date-filtered view over the same 4 attempt tables above."))

    );

    private static final Map<String, List<String>> ROLE_PERMISSIONS = Map.of(
            "MANAGER", List.of("page:dashboard", "page:primary-sales", "page:secondary-sales",
                    "page:site-insights", "page:team-insights"),
            "VIEWER", List.of("page:dashboard", "page:primary-sales", "page:secondary-sales",
                    "page:site-insights", "page:team-insights")
    );

    private static final String[][] DEMO_USERS = {
            {"admin", "Admin@12345", "Administrator", "ADMIN"},
            {"manager", "Manager@12345", "Demo Manager", "MANAGER"},
            {"viewer", "Viewer@12345", "Demo Viewer", "VIEWER"},
            {"superadmin", "SuperAdmin@12345", "Super Administrator", "SUPERADMIN"},
    };

    private final IamLoginUserRepository userRepository;
    private final IamLoginRoleRepository roleRepository;
    private final IamLoginUserRoleRepository userRoleRepository;
    private final IamLoginPermissionRepository permissionRepository;
    private final IamLoginRolePermissionRepository rolePermissionRepository;
    private final IamLoginUserPermissionRepository userPermissionRepository;
    private final PasswordEncoder passwordEncoder;
    private final TransactionTemplate transactionTemplate;

    public AuthBootstrapSeeder(IamLoginUserRepository userRepository,
                                IamLoginRoleRepository roleRepository,
                                IamLoginUserRoleRepository userRoleRepository,
                                IamLoginPermissionRepository permissionRepository,
                                IamLoginRolePermissionRepository rolePermissionRepository,
                                IamLoginUserPermissionRepository userPermissionRepository,
                                PasswordEncoder passwordEncoder,
                                PlatformTransactionManager transactionManager) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.userRoleRepository = userRoleRepository;
        this.permissionRepository = permissionRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.userPermissionRepository = userPermissionRepository;
        this.passwordEncoder = passwordEncoder;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @PostConstruct
    public void seedIfEmpty() {
        try {
            transactionTemplate.executeWithoutResult(status -> {

                boolean rolePermissionsWereEmpty = rolePermissionRepository.count() == 0;

                Map<String, IamLoginRole> roles = seedRolesIfEmpty();
                Map<String, IamLoginPermission> permissions = seedOrUpgradePermissionCatalog();
                removeStalePermissions(permissions);
                repairOrphanedPermissionGrants(permissions);

                IamLoginRole admin = roles.get("ADMIN");
                if (rolePermissionsWereEmpty) {
                    seedRolePermissionsFresh(roles, permissions);
                } else if (admin != null) {
                    topUpAdminPermissions(admin, permissions);
                }

                IamLoginRole superAdmin = roles.get("SUPERADMIN");
                if (superAdmin != null) {
                    topUpSuperAdminPermissions(superAdmin, permissions);
                }

                seedUsersIfEmpty(roles);
            });
        } catch (Exception ex) {

            log.warn("IAM login bootstrap seeding skipped: {}", ex.getMessage());
        }
    }

    private Map<String, IamLoginRole> seedRolesIfEmpty() {
        Map<String, IamLoginRole> roles;
        if (roleRepository.count() > 0) {
            roles = new LinkedHashMap<>();
            roleRepository.findAll().forEach(role -> roles.put(role.getRoleName().toUpperCase(), role));
        } else {
            roles = new LinkedHashMap<>();
            roles.put("ADMIN", roleRepository.save(new IamLoginRole(null, "ADMIN", "Full access — can manage users, roles, and permissions.")));
            roles.put("MANAGER", roleRepository.save(new IamLoginRole(null, "MANAGER", "Elevated access to assigned pages/sections.")));
            roles.put("VIEWER", roleRepository.save(new IamLoginRole(null, "VIEWER", "Read-only access to assigned pages/sections.")));
            log.info("Seeded default roles: ADMIN, MANAGER, VIEWER.");
        }

        if (!roles.containsKey("SUPERADMIN")) {
            roles.put("SUPERADMIN", roleRepository.save(new IamLoginRole(null, "SUPERADMIN",
                    "Above ADMIN — everything ADMIN has, plus advanced system/role/feature/audit tooling.")));
            log.info("Seeded SUPERADMIN role (top-up, independent of the initial empty-table seed).");
        }

        return roles;
    }

    private Map<String, IamLoginPermission> seedOrUpgradePermissionCatalog() {
        Map<String, IamLoginPermission> existingByKey = new LinkedHashMap<>();
        permissionRepository.findAll().forEach(permission -> existingByKey.put(permission.getPermissionKey(), permission));

        Map<String, IamLoginPermission> resolved = new LinkedHashMap<>();
        List<String> createdKeys = new ArrayList<>();

        for (PageDef pageDef : PERMISSION_TREE) {
            IamLoginPermission pagePermission = upsert(existingByKey, resolved, createdKeys,
                    pageDef.key(), pageDef.label(), pageDef.description(), TYPE_PAGE, null);

            for (SectionDef sectionDef : pageDef.sections()) {
                upsert(existingByKey, resolved, createdKeys,
                        sectionDef.key(), sectionDef.label(), sectionDef.description(), TYPE_SECTION, pagePermission.getPermissionId());
            }
        }

        if (!createdKeys.isEmpty()) {
            log.info("Permission catalog: added {} new permission key(s): {}", createdKeys.size(), createdKeys);
        }
        return resolved;
    }

    private IamLoginPermission upsert(Map<String, IamLoginPermission> existingByKey,
                                       Map<String, IamLoginPermission> resolved,
                                       List<String> createdKeys,
                                       String key, String label, String description, String type, Integer parentId) {
        IamLoginPermission permission = existingByKey.get(key);
        if (permission == null) {
            permission = new IamLoginPermission();
            permission.setPermissionKey(key);
            createdKeys.add(key);
        }

        boolean changed = permission.getPermissionId() == null
                || !Objects.equals(permission.getLabel(), label)
                || !Objects.equals(permission.getDescription(), description)
                || !Objects.equals(permission.getPermissionType(), type)
                || !Objects.equals(permission.getParentPermissionId(), parentId);

        permission.setLabel(label);
        permission.setDescription(description);
        permission.setPermissionType(type);
        permission.setParentPermissionId(parentId);

        if (changed) {
            permission = permissionRepository.save(permission);
        }

        resolved.put(key, permission);
        return permission;
    }

    private void removeStalePermissions(Map<String, IamLoginPermission> resolved) {
        List<IamLoginPermission> stale = permissionRepository.findAll().stream()
                .filter(permission -> !resolved.containsKey(permission.getPermissionKey()))
                .sorted(Comparator.comparing((IamLoginPermission permission) -> permissionDepth(permission.getPermissionType())).reversed())
                .collect(Collectors.toList());
        if (stale.isEmpty()) {
            return;
        }

        stale.forEach(permission -> {
            rolePermissionRepository.deleteByIdPermissionId(permission.getPermissionId());
            userPermissionRepository.deleteByIdPermissionId(permission.getPermissionId());
        });
        permissionRepository.deleteAll(stale);

        log.info("Permission catalog: removed {} retired permission key(s): {}", stale.size(),
                stale.stream().map(IamLoginPermission::getPermissionKey).collect(Collectors.toList()));
    }

    private int permissionDepth(String type) {
        return TYPE_SECTION.equals(type) ? 1 : 0;
    }

    private void repairOrphanedPermissionGrants(Map<String, IamLoginPermission> permissions) {
        Map<Integer, Integer> parentById = permissions.values().stream()
                .filter(permission -> permission.getParentPermissionId() != null)
                .collect(Collectors.toMap(IamLoginPermission::getPermissionId, IamLoginPermission::getParentPermissionId));

        int repairedRoleCount = 0;
        for (IamLoginRole role : roleRepository.findAll()) {
            Set<Integer> granted = rolePermissionRepository.findByIdRoleId(role.getRoleId()).stream()
                    .map(rolePermission -> rolePermission.getId().getPermissionId())
                    .collect(Collectors.toCollection(LinkedHashSet::new));

            List<Integer> missingAncestors = new ArrayList<>();
            for (Integer permissionId : new ArrayList<>(granted)) {
                Integer parentId = parentById.get(permissionId);
                while (parentId != null && granted.add(parentId)) {
                    missingAncestors.add(parentId);
                    parentId = parentById.get(parentId);
                }
            }

            if (!missingAncestors.isEmpty()) {
                missingAncestors.forEach(permissionId -> grant(role.getRoleId(), permissionId));
                repairedRoleCount++;
                log.warn("Permission repair: role '{}' was missing {} ancestor permission(s) for grants it "
                                + "already held ({}); granted automatically.",
                        role.getRoleName(), missingAncestors.size(), missingAncestors);
            }
        }

        if (repairedRoleCount > 0) {
            log.warn("Permission repair: fixed {} role(s) with orphaned Section grants missing their "
                    + "Page ancestor.", repairedRoleCount);
        }
    }

    private void seedRolePermissionsFresh(Map<String, IamLoginRole> roles, Map<String, IamLoginPermission> permissions) {
        IamLoginRole admin = roles.get("ADMIN");
        if (admin != null) {
            topUpAdminPermissions(admin, permissions);
        }

        ROLE_PERMISSIONS.forEach((roleName, keys) -> {
            IamLoginRole role = roles.get(roleName);
            if (role == null) {
                return;
            }
            keys.forEach(key -> {
                IamLoginPermission permission = permissions.get(key);
                if (permission != null) {
                    grant(role.getRoleId(), permission.getPermissionId());
                }
            });
        });

        long adminPermissionCount = permissions.keySet().stream().filter(key -> !key.startsWith("page:superadmin")).count();
        log.info("Seeded role->permission grants for ADMIN ({} permissions, all except Super Admin), MANAGER ({} permissions), VIEWER ({} permissions).",
                adminPermissionCount, ROLE_PERMISSIONS.get("MANAGER").size(), ROLE_PERMISSIONS.get("VIEWER").size());
    }

    private void topUpAdminPermissions(IamLoginRole admin, Map<String, IamLoginPermission> permissions) {
        permissions.values().stream()
                .filter(permission -> !permission.getPermissionKey().startsWith("page:superadmin"))
                .forEach(permission -> grant(admin.getRoleId(), permission.getPermissionId()));
    }

    private void topUpSuperAdminPermissions(IamLoginRole superAdmin, Map<String, IamLoginPermission> permissions) {
        permissions.values().forEach(permission -> grant(superAdmin.getRoleId(), permission.getPermissionId()));
    }

    private void grant(Integer roleId, Integer permissionId) {
        IamLoginRolePermissionId id = new IamLoginRolePermissionId(roleId, permissionId);
        if (!rolePermissionRepository.existsById(id)) {
            rolePermissionRepository.save(new IamLoginRolePermission(id));
        }
    }

    private void seedUsersIfEmpty(Map<String, IamLoginRole> roles) {

        boolean createdAny = false;
        for (String[] demo : DEMO_USERS) {
            String username = demo[0];
            String password = demo[1];
            String fullName = demo[2];
            String roleName = demo[3];

            if (userRepository.existsByUsernameIgnoreCase(username)) {
                continue;
            }

            IamLoginUser user = new IamLoginUser();
            user.setUsername(username);
            user.setPasswordHash(passwordEncoder.encode(password));
            user.setFullName(fullName);
            user.setActive(true);
            user.setLocked(false);
            user.setFailedLoginAttempts(0);
            user.setCreatedAt(LocalDateTime.now());
            user = userRepository.save(user);

            IamLoginRole role = roles.get(roleName);
            if (role != null) {
                userRoleRepository.save(new IamLoginUserRole(new IamLoginUserRoleId(user.getUserId(), role.getRoleId())));
            }
            createdAny = true;
        }

        if (createdAny) {
            log.warn("Seeded dev-only login accounts (username / password / role): "
                            + "admin / Admin@12345 / ADMIN, manager / Manager@12345 / MANAGER, viewer / Viewer@12345 / VIEWER, "
                            + "superadmin / SuperAdmin@12345 / SUPERADMIN "
                            + "(only whichever of these didn't already exist). "
                            + "Change these passwords (or remove this seeder) before any real/shared use.");
        }
    }
}
