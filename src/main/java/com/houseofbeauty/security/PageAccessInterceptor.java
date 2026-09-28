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

public class PageAccessInterceptor implements HandlerInterceptor {

    private static final Map<String, String> PAGE_PERMISSIONS = buildPagePermissions();

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

            String next = URLEncoder.encode(path, StandardCharsets.UTF_8);
            response.sendRedirect(LOGIN_PATH + "?next=" + next);
            return false;
        }

        Set<String> permissions = authService.effectivePermissions(authUser.getUserId());
        if (permissions.contains(requiredPermission)) {
            return true;
        }

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
