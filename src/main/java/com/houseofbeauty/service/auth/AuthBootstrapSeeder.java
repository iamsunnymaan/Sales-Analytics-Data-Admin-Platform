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

// One-time bootstrap so the login + permission system is actually testable the moment the
// IAM_Login_* tables are created empty (see database/migrations/2026-09-15_create_iam_login_tables.sql)
// — every account/permission is otherwise company-provisioned by an admin, per explicit request;
// there's no self-signup and (yet) no admin screen to create these with by hand. Each seed step is
// independently guarded by its own table being empty, so re-running this against a database that
// already has real roles/users in it is always a no-op — EXCEPT the permission catalog itself
// (PERMISSION_TREE below), which is upserted on every startup instead of "if empty" (see
// seedOrUpgradePermissionCatalog). That's deliberate: the catalog grew from a flat page-only list
// to the real Page->Section->Feature hierarchy the Roles page and Sidebar.js now depend on, and it
// will keep growing as more of the app gets real permission keys — an upsert lets that happen
// without ever deleting a permission row a role/user might already be granted, and
// topUpAdminPermissions keeps ADMIN able to see/grant every newly added key without a fresh
// install, without ever touching MANAGER/VIEWER's (or any custom role's) existing grants.
//
// Permission keys follow the dotted scheme: "page:<page>" gates a whole page, "page:<page>.<section>"
// one section within it — a Section is the finest grain there is (per explicit request: the
// permission model was originally Page->Section->Feature, but a 3rd "Feature" level under each
// Section was removed as its own concept everywhere in the app, not just on the Roles & Users page
// — a Section is now both the visibility unit and the action unit, e.g. "Upload and Verify" alone
// gates upload/verify/commit together rather than each getting its own sub-key). The tree structure
// itself lives in permissionType/parentPermissionId (see IamLoginPermission), not in the key's dot
// count — one pre-existing key (page:data-upload.truncate-table) predates even the original
// Section concept and keeps its original key so the @RequirePermission annotation already
// referencing it (TableDataController) and any grants already made against it keep working;
// PERMISSION_TREE just lists it as its own SECTION, sibling to the others under the same page,
// below. The old "page:explorer.export" Section was folded into "page:explorer.table-data" per
// explicit request (a single checkbox in the Roles picker was showing both a Section and a Feature
// for what's really one control) — TableDataController's export endpoint now requires
// "page:explorer.table-data" instead, same as viewing the grid it exports from. Controllers for
// dashboard/primary-sales/secondary-sales/site-insights/team-insights/data-upload already enforce
// their page-level key (see each controller's own @RequirePermission); explorer's page-level key
// and its remaining section keys are seeded but not yet enforced by any controller — same
// "additive/gradual rollout" already described on PermissionInterceptor. GET /api/auth/me is what
// lets you see each seeded account's resolved
// permission set to confirm the data resolves correctly end to end; Sidebar.js is what actually
// hides a page-level nav link a session's permission set doesn't include.
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

    // The real Page -> Section tree, one entry per page actually in Sidebar.html, each page's
    // sections matching its real "N. Section Title" headers (or, where a page has no such headers —
    // Site Insights' card layout — the real functional areas on that page). A Section is the
    // finest-grained thing a role/user can be granted or denied — there is
    // deliberately no further breakdown into individual view/export/edit/delete-style actions within
    // one (see this class's own header comment on why that level was removed).
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

            // Re-added per explicit request, restructured from the original "Roles & Users" tree.
            // "Role and Details" (role CRUD: New/Edit/Delete Role, the Permission/Feature picker)
            // moved to live under "page:iam" instead of here per a later explicit request — this
            // page ("User and Role") now has ONLY User Details; it lost its Roles table entirely
            // (not duplicated — RolesPage.html was deliberately trimmed down, see that file's own
            // header comment). The old "page:roles.filter-header" Section (whose only content was
            // the New Role button, back when Role and Details still lived here) stays retired — New
            // Role is a Feature (feature:new-role) nested under "page:iam.roles-details" instead, see
            // that page's own comment below. RolesController.createRole/updateRole/deleteRole now
            // check "page:iam.roles-details" — see that controller's own comment.
            page("page:roles", "User and Role", "View the Roles & Users page.",
                    section("page:roles.user-details", "User Details", "The user accounts table.")),

            // Under Sidebar.html's own "Admin" section (separate from "Super Admin") — a second,
            // independently-permissioned place to reach the same "User Details" management as
            // "page:roles" above (UsersController/FeaturesController each accept EITHER
            // page:roles.user-details or page:iam.user-details — see RequirePermission's own header
            // comment on the OR semantics this relies on). "Role and Details" (role CRUD) now lives
            // ONLY here, moved from "page:roles" per explicit request — this is the sole place role
            // management exists anywhere in the app; New Role/Edit Role/Delete are Features
            // (feature:new-role/edit-role/delete-role, IAMPage.js's SECTION_FEATURE_KEYS) nested
            // under this one Section, same treatment "User Details" above already gets.
            page("page:iam", "IAM", "View the IAM page.",
                    section("page:iam.user-details", "User Details", "The user accounts table."),
                    section("page:iam.roles-details", "Role and Details", "The roles table.")),

            // Re-added per explicit request — was removed from this catalog earlier, which left the
            // Monitoring page and its API completely unreachable for everyone (MonitoringController's
            // @RequirePermission("page:monitoring")/per-section keys were never actually touched, so
            // restoring these keys alone is enough to make it reachable again; existing role grants
            // of any of these keys from before the removal were already purged by
            // removeStalePermissions in the meantime, so ADMIN/SUPERADMIN need topUpAdminPermissions/
            // topUpSuperAdminPermissions to pick this back up — both already do that automatically on
            // this restart, same as any newly-added key). Security audit trail — the 4 "Attempts"
            // tables (login, download, upload, unauthorized-access) were removed as their own
            // always-visible sections per an earlier explicit request, then folded into "Audit" as
            // one Type/Status/Search/Date-filtered view instead — MonitoringController's own 4
            // attempt endpoints still back that view per-Type, so all 4 keys below stay. Plus 2
            // remaining token tables: Password Reset Tokens is always empty (no forgot-password flow
            // exists — see IamLoginPasswordResetToken's own header comment) — still a real section
            // since a session with page:monitoring but not that specific key shouldn't see its
            // contents.
            page("page:monitoring", "Monitoring", "View the Monitoring page.",
                    section("page:monitoring.login-attempts", "Usage Overview", "Login attempts data — gates the Usage Overview graph and the Audit view's Login rows."),
                    section("page:monitoring.download-attempts", "Attempts (Download)", "File download/export attempts — gates the Audit view's Download rows."),
                    section("page:monitoring.upload-attempts", "Attempts (Upload)", "File upload attempts on the Upload Data page — gates the Audit view's Upload rows."),
                    section("page:monitoring.unauthorized-attempts", "Attempts (Unauthorized)", "Blocked requests, missing page or API permission — gates the Audit view's Unauthorized rows."),
                    section("page:monitoring.password-reset-tokens", "Password Reset Tokens", "Issued password-reset tokens."),
                    section("page:monitoring.otps", "Recent OTPs", "Issued OTP codes."),
                    section("page:monitoring.audit", "Audit", "Type/Status/Search/Date-filtered view over the same 4 attempt tables above."))

            // page:superadmin remains removed from this catalog per explicit request. SuperAdminPage
            // stays permanently unreachable for every account until that key is re-added too — do not
            // re-add it without confirming that's actually intended.
    );

    // role name -> permission keys it's granted, seeded only the first time IAM_Login_Role_Permissions
    // is empty (see seedIfEmpty). ADMIN gets every seeded permission (computed below, not listed
    // here, so a newly added permission is never silently left out of ADMIN) both on that first seed
    // and, via topUpAdminPermissions, on every later startup too.
    private static final Map<String, List<String>> ROLE_PERMISSIONS = Map.of(
            "MANAGER", List.of("page:dashboard", "page:primary-sales", "page:secondary-sales",
                    "page:site-insights", "page:team-insights"),
            "VIEWER", List.of("page:dashboard", "page:primary-sales", "page:secondary-sales",
                    "page:site-insights", "page:team-insights")
    );

    // username -> {password, fullName, role}
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

    // @Transactional on a @PostConstruct method is a no-op — the AOP proxy that would open the
    // transaction doesn't exist yet at this point in the bean lifecycle (@PostConstruct runs on the
    // raw target, before postProcessAfterInitialization wraps it), which is why removeStalePermissions
    // below (a plain derived deleteByIdPermissionId query, not a self-transactional CrudRepository
    // method like save()) used to fail on every single startup with "No EntityManager with actual
    // transaction available" and get silently swallowed by the catch below — never actually removing
    // a retired permission key, and (since the exception aborted the rest of this method too) never
    // reaching topUpAdminPermissions or seedUsersIfEmpty either. TransactionTemplate opens a real
    // transaction imperatively via the injected PlatformTransactionManager, sidestepping the proxy
    // entirely, so it works correctly from @PostConstruct.
    @PostConstruct
    public void seedIfEmpty() {
        try {
            transactionTemplate.executeWithoutResult(status -> {
                // Captured before seedOrUpgradePermissionCatalog can insert any Role_Permissions rows of
                // its own, so it still correctly reflects "is this a fresh DB" for the ROLE_PERMISSIONS
                // (MANAGER/VIEWER) seed step below.
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

                // Unconditional, every startup, regardless of rolePermissionsWereEmpty — covers both a
                // truly fresh install (SUPERADMIN exists from seedRolesIfEmpty above but seedRolePermissionsFresh
                // never grants it anything) and every later startup (SUPERADMIN's own top-up, same
                // idempotent-grant() pattern topUpAdminPermissions already uses for ADMIN).
                IamLoginRole superAdmin = roles.get("SUPERADMIN");
                if (superAdmin != null) {
                    topUpSuperAdminPermissions(superAdmin, permissions);
                }

                seedUsersIfEmpty(roles);
            });
        } catch (Exception ex) {
            // Never fail application startup over this — an unreachable DB at boot (or the
            // migration not having been run yet) just means seeding is skipped this run, same
            // as ImportSessionCleanupService's own startup recovery does.
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

        // SUPERADMIN top-up: checked independently of the empty-table branch above, the same "create
        // this one specific thing if it's missing, regardless of whether this is a fresh install"
        // pattern topUpAdminPermissions already uses for permissions — added after ADMIN/MANAGER/
        // VIEWER already existed in a real deployment, so it can't rely on the whole-table-empty gate
        // above ever firing again. Idempotent: never touches ADMIN/MANAGER/VIEWER's existing rows.
        if (!roles.containsKey("SUPERADMIN")) {
            roles.put("SUPERADMIN", roleRepository.save(new IamLoginRole(null, "SUPERADMIN",
                    "Above ADMIN — everything ADMIN has, plus advanced system/role/feature/audit tooling.")));
            log.info("Seeded SUPERADMIN role (top-up, independent of the initial empty-table seed).");
        }

        return roles;
    }

    // Upserts PERMISSION_TREE into IAM_Login_Permissions: a key that already exists gets its
    // type/parent/label/description brought in line with the tree (never its Permission_ID, so
    // existing Role_Permissions/User_Permissions grants against it are untouched); a key that
    // doesn't exist yet gets created. Runs on every startup, not just against an empty table — see
    // this class's own header comment for why.
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

    // The reverse of the upsert above: deletes any permission key no longer present in
    // PERMISSION_TREE (e.g. the old standalone "page:users" node, folded into "page:roles" when
    // the Users page was merged into the Roles page) so a fully-retired page/section also
    // disappears from "3. Permission Details" and every role's/user's grant of it, instead of
    // lingering forever the way the additive upsert deliberately never removes anything. Clears
    // Role_Permissions/User_Permissions grants first (FK children), then the permission rows
    // themselves, deepest (SECTION) first so a PAGE row is never deleted while a child still
    // references it via Parent_Permission_ID.
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

    // One-time-bug repair, safe to leave running on every startup: a role holding a SECTION/FEATURE
    // grant but not that grant's own PAGE/SECTION ancestor is almost certainly a leftover from the
    // permission picker's old cascade design, where a Page checkbox could end up merely
    // "indeterminate" (and therefore silently excluded from what got saved) even while some of its
    // Sections were explicitly checked — see RolesPage.js's own header comment on the redesigned,
    // fully independent picker that replaced it. Idempotent: it only ever adds a missing ancestor a
    // role already holds at least one descendant of, never removes or requires anything, so it
    // can't fight the new picker's "each level is independent" model going forward — a role
    // deliberately left with, say, a Section on and its Page off simply never reaches this method
    // (nothing here ever revokes a grant), it just guarantees a Section grant is never silently
    // unreachable because its own ancestor chain has a gap.
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

    // Grants ADMIN every permission in the catalog EXCEPT page:superadmin* — safe to call on every
    // startup (grant() is idempotent: re-granting an already-held permission is a harmless no-op
    // merge on the same composite key), so a permission key added to PERMISSION_TREE after go-live
    // still reaches ADMIN without a fresh install. MANAGER/VIEWER/custom roles are deliberately left
    // untouched here — only ADMIN is guaranteed "everything except Super Admin", per this class's own
    // header comment. The page:superadmin* exclusion is deliberate, per explicit request that
    // SUPERADMIN be a genuinely narrower/higher tier than ADMIN, not just an alias for it — see
    // topUpSuperAdminPermissions below, which grants that page (and everything else) only to SUPERADMIN.
    private void topUpAdminPermissions(IamLoginRole admin, Map<String, IamLoginPermission> permissions) {
        permissions.values().stream()
                .filter(permission -> !permission.getPermissionKey().startsWith("page:superadmin"))
                .forEach(permission -> grant(admin.getRoleId(), permission.getPermissionId()));
    }

    // SUPERADMIN sits above ADMIN — gets every permission in the catalog, no exclusions, including
    // page:superadmin* (see topUpAdminPermissions' own comment on why ADMIN alone excludes it).
    // Same idempotent-grant() safety as topUpAdminPermissions; safe to call on every startup.
    private void topUpSuperAdminPermissions(IamLoginRole superAdmin, Map<String, IamLoginPermission> permissions) {
        permissions.values().forEach(permission -> grant(superAdmin.getRoleId(), permission.getPermissionId()));
    }

    // Explicit existence check rather than relying on save()/merge() to upsert — IamLoginRolePermission
    // has no state besides its own @EmbeddedId, and merge() on that shape doesn't reliably resolve
    // to a no-op UPDATE for an already-granted (roleId, permissionId) the way it would for an
    // entity with real column state to reconcile; it can still attempt an INSERT and hit the
    // composite PK. This is called for every permission on every startup (topUpAdminPermissions),
    // so it has to be a true no-op for anything already granted.
    private void grant(Integer roleId, Integer permissionId) {
        IamLoginRolePermissionId id = new IamLoginRolePermissionId(roleId, permissionId);
        if (!rolePermissionRepository.existsById(id)) {
            rolePermissionRepository.save(new IamLoginRolePermission(id));
        }
    }

    private void seedUsersIfEmpty(Map<String, IamLoginRole> roles) {
        // Per-username, not a blanket "table is empty" gate like the other seed steps use — this
        // one has to tolerate the admin account already existing (from before MANAGER/VIEWER demo
        // accounts were added here) without either skipping the other two or duplicating admin.
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
