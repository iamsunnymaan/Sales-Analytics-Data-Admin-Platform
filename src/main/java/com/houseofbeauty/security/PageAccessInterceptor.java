package com.houseofbeauty.security;

import com.houseofbeauty.service.auth.AuthService;
import com.houseofbeauty.service.auth.AuthenticatedUser;
import com.houseofbeauty.service.monitoring.MonitoringAuditService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.servlet.HandlerInterceptor;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

// Server-side page-level access control — the real fix for "sidebar hides a link, but the page
// behind it is still reachable by URL/bookmark/refresh/hard-refresh/Back-Forward". Sidebar.js's own
// permission filtering (filterSidebarByPermissions) only ever hid the NAV LINK; nothing stopped the
// browser from fetching the page's actual HTML document any other way, and no backend check existed
// on that request either — so a user could always open e.g. /pages/RolesPage/RolesPage.html
// directly regardless of role, and there was a real window on every load where the sidebar itself
// showed every link before its own async permission check finished and hid the unauthorized ones.
//
// This closes both gaps before a single byte of the page's HTML is served: every request for a
// gated page document is checked against the session's effective permission set (same
// AuthService.effectivePermissions PermissionInterceptor uses for /api/** — one source of truth),
// and an unauthorized request never receives that page's real content, it's redirected instead.
// Because this runs on the HTTP request for the document itself (registered for "/", "/index.html",
// "/pages/**" in WebConfig — a HandlerInterceptor rather than a Filter specifically so it also
// covers requests served by Spring's static-resource HandlerMapping, and so "/" can be matched
// exactly via Spring's own AntPathMatcher instead of relying on raw servlet url-pattern semantics,
// where a bare "/" has special "default servlet" meaning that varies by container), it uniformly
// covers every way a browser can arrive at that request — a clicked link, typed URL, bookmark,
// refresh, hard refresh, or Back/Forward — there is no client-side timing window to race, since the
// unauthorized HTML is simply never sent.
//
// Deliberately narrow in scope (PAGE_PERMISSIONS below): Shared/components/assets resources are
// untouched by the path patterns this is registered for, so CSS/JS every page needs still loads
// freely — the sensitive part was always the page's real content and the data behind it (already
// covered by AuthenticationFilter + PermissionInterceptor on /api/**), not its static markup shell.
public class PageAccessInterceptor implements HandlerInterceptor {

    // Kept in sync with Sidebar.html's data-page/data-permission pairs and AuthBootstrapSeeder's
    // PERMISSION_TREE — one entry per real page-level permission key. LoginPage.html is
    // deliberately absent (must stay reachable unauthenticated). Note this only gates the page
    // DOCUMENT itself; some of these pages call shared /api/** endpoints (e.g. Explorer's generic
    // table-browsing API is also used by Primary Sales' date filter) that aren't yet enforced per
    // page-permission at the API layer — see TableDataController's own header comment.
    private static final Map<String, String> PAGE_PERMISSIONS = buildPagePermissions();

    // "/" and "/index.html" both resolve to the Dashboard shell — the fallback every other
    // unauthorized hit redirects to first, since it's the one every seeded role is expected to hold.
    private static final String DASHBOARD_PATH = "/";
    private static final String LOGIN_PATH = "/pages/LoginPage/LoginPage.html";

    private final AuthService authService;
    private final MonitoringAuditService monitoringAuditService;

    public PageAccessInterceptor(AuthService authService, MonitoringAuditService monitoringAuditService) {
        this.authService = authService;
        this.monitoringAuditService = monitoringAuditService;
    }

    private static Map<String, String> buildPagePermissions() {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("/", "page:dashboard");
        map.put("/index.html", "page:dashboard");
        map.put("/pages/PrimarySalesPage/PrimarySalesPage.html", "page:primary-sales");
        map.put("/pages/SecondarySalesPage/SecondarySalesPage.html", "page:secondary-sales");
        map.put("/pages/SiteStatusPage/SiteStatusPage.html", "page:site-insights");
        map.put("/pages/TeamPerformancePage/TeamPerformancePage.html", "page:team-insights");
        map.put("/pages/ExplorerPage/ExplorerPage.html", "page:explorer");
        map.put("/pages/DataUploadPage/DataUploadPage.html", "page:data-upload");
        map.put("/pages/IAMPage/IAMPage.html", "page:iam");
        map.put("/pages/RolesPage/RolesPage.html", "page:roles");
        map.put("/pages/MonitoringPage/MonitoringPage.html", "page:monitoring");
        map.put("/pages/SuperAdminPage/SuperAdminPage.html", "page:superadmin");
        return map;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String path = request.getRequestURI();
        String requiredPermission = PAGE_PERMISSIONS.get(path);
        if (requiredPermission == null) {
            return true;
        }

        HttpSession session = request.getSession(false);
        AuthenticatedUser authUser = session != null
                ? (AuthenticatedUser) session.getAttribute(AuthenticatedUser.SESSION_ATTRIBUTE)
                : null;

        if (authUser == null) {
            // Not logged in at all — send them to Login with the same ?next= convention
            // auth-guard.js's own (client-side, non-authoritative) check already uses, so a
            // successful login still lands back on the page they originally asked for.
            String next = URLEncoder.encode(path, StandardCharsets.UTF_8);
            response.sendRedirect(LOGIN_PATH + "?next=" + next);
            return false;
        }

        Set<String> permissions = authService.effectivePermissions(authUser.getUserId());
        if (permissions.contains(requiredPermission)) {
            return true;
        }

        // Authenticated but not authorized for this specific page — never fall through to serving
        // its real content. Land on Dashboard if they hold that (the common case), otherwise the
        // first other page they do hold permission for, otherwise Login as a last resort (a role
        // with literally zero page permissions has nowhere authorized to go).
        monitoringAuditService.recordUnauthorized(authUser.getUserId(), authUser.getUsername(),
                request.getRemoteAddr(), path, "Missing page permission: " + requiredPermission);
        response.sendRedirect(fallbackPathFor(permissions, path));
        return false;
    }

    private String fallbackPathFor(Set<String> permissions, String requestedPath) {
        if (!DASHBOARD_PATH.equals(requestedPath) && permissions.contains("page:dashboard")) {
            return DASHBOARD_PATH;
        }
        for (Map.Entry<String, String> entry : PAGE_PERMISSIONS.entrySet()) {
            if (!entry.getKey().equals(requestedPath) && permissions.contains(entry.getValue())) {
                return entry.getKey();
            }
        }
        return LOGIN_PATH;
    }
}
