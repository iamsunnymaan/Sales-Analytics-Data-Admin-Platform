package com.houseofbeauty.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.houseofbeauty.service.auth.AuthService;
import com.houseofbeauty.service.auth.AuthenticatedUser;
import com.houseofbeauty.service.monitoring.MonitoringAuditService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;

// The actual per-endpoint authorization layer — AuthenticationFilter (a servlet Filter, runs
// before this) already guarantees the request is authenticated by the time this interceptor runs;
// this is what checks WHICH permission key the authenticated session actually holds. Registered
// for /api/** in WebConfig. A method with no @RequirePermission (checked first) and no class-level
// one either (fallback) is unaffected — plenty of endpoints (anything not yet mapped to a page/
// feature key, e.g. TableDataController's shared preview/import-session endpoints used by more
// than one page) still only need AuthenticationFilter's authentication check, same as before this
// existed. Rolling out real per-endpoint authorization is therefore additive/gradual: annotate one
// controller at a time, nothing else changes behavior until it's annotated.
public class PermissionInterceptor implements HandlerInterceptor {

    private final AuthService authService;
    private final ObjectMapper objectMapper;
    private final MonitoringAuditService monitoringAuditService;

    public PermissionInterceptor(AuthService authService, ObjectMapper objectMapper,
                                  MonitoringAuditService monitoringAuditService) {
        this.authService = authService;
        this.objectMapper = objectMapper;
        this.monitoringAuditService = monitoringAuditService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            return true;
        }

        RequirePermission required = handlerMethod.getMethodAnnotation(RequirePermission.class);
        if (required == null) {
            required = handlerMethod.getBeanType().getAnnotation(RequirePermission.class);
        }
        if (required == null) {
            return true;
        }

        HttpSession session = request.getSession(false);
        AuthenticatedUser authUser = session != null
                ? (AuthenticatedUser) session.getAttribute(AuthenticatedUser.SESSION_ATTRIBUTE)
                : null;

        // AuthenticationFilter (registered at a lower order, runs first) already rejects an
        // unauthenticated request with 401 before it ever reaches here — a null session at this
        // point would mean that filter isn't actually in front of this path, which is a
        // misconfiguration, not a normal 403 case. Failing closed either way is still correct.
        if (authUser == null) {
            writeError(response, HttpStatus.UNAUTHORIZED, "Authentication required. Please log in.");
            return false;
        }

        Set<String> permissions = authService.effectivePermissions(authUser.getUserId());
        if (Arrays.stream(required.value()).noneMatch(permissions::contains)) {
            String keys = String.join(" or ", required.value());
            monitoringAuditService.recordUnauthorized(authUser.getUserId(), authUser.getUsername(),
                    request.getRemoteAddr(), keys, "Missing permission: " + keys);
            writeError(response, HttpStatus.FORBIDDEN,
                    "You don't have permission to access this (" + keys + ").");
            return false;
        }

        return true;
    }

    // Same JSON error shape GlobalExceptionHandler produces for every other API error, and
    // AuthenticationFilter's own 401 — an interceptor still runs inside Spring MVC's dispatch (unlike
    // the Filter), but @RestControllerAdvice only applies to exceptions a controller method throws,
    // not a preHandle() that returns false before the controller ever runs, so this still has to be
    // written out manually to match.
    private void writeError(HttpServletResponse response, HttpStatus status, String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        Map<String, Object> body = Map.of(
                "timestamp", Instant.now().toString(),
                "status", status.value(),
                "error", status.getReasonPhrase(),
                "message", message
        );
        response.getWriter().write(objectMapper.writeValueAsString(body));
    }
}
