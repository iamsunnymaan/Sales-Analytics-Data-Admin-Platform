package com.houseofbeauty.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.houseofbeauty.service.auth.AuthenticatedUser;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.Set;

// The actual server-side enforcement behind Shared/js/auth-guard.js's frontend redirect — that
// script only stops a normal user from wandering into a page without logging in first; this filter
// is what stops someone from skipping the page entirely and calling an API directly. Registered
// for /api/* only (see SecurityFilterConfig) — static HTML/CSS/JS is untouched. Only the specific
// endpoints in PUBLIC_PATHS stay reachable unauthenticated (login/send-otp obviously must be, and
// logout is harmless either way) — everything else under /api/auth/, e.g. GET /api/auth/me, still
// requires a session, unlike a whole-prefix skip would give it.
//
// Deliberately a plain Filter, not full Spring Security: this only proves "is this request still
// tied to a session AuthController's /login created" — authenticated, not yet authorized against a
// specific permission key. IAM_Login_Permissions/Role_Permissions ARE now seeded with real
// page/section/feature keys (see AuthBootstrapSeeder) and GET /api/auth/me resolves a session's
// effective set of them, but no controller method here checks a specific key yet — per-endpoint
// authorization is the next layer on top of this.
public class AuthenticationFilter extends OncePerRequestFilter {

    private static final Set<String> PUBLIC_PATHS = Set.of(
            "/api/auth/login", "/api/auth/send-otp", "/api/auth/logout",
            "/api/auth/forgot-password", "/api/auth/reset-password");

    private final ObjectMapper objectMapper;

    public AuthenticationFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        String path = request.getRequestURI();
        if (PUBLIC_PATHS.contains(path)) {
            chain.doFilter(request, response);
            return;
        }

        HttpSession session = request.getSession(false);
        Object authUser = session != null ? session.getAttribute(AuthenticatedUser.SESSION_ATTRIBUTE) : null;

        if (authUser == null) {
            writeUnauthorized(response);
            return;
        }

        chain.doFilter(request, response);
    }

    // Matches GlobalExceptionHandler's own JSON error shape so the frontend's existing
    // extractErrorMessage()-style handling (read response.message) works the same for a 401 from
    // here as it does for any other API error — this filter runs before Spring MVC's dispatcher,
    // so @RestControllerAdvice can't be reused to produce it.
    private void writeUnauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        Map<String, Object> body = Map.of(
                "timestamp", Instant.now().toString(),
                "status", HttpStatus.UNAUTHORIZED.value(),
                "error", HttpStatus.UNAUTHORIZED.getReasonPhrase(),
                "message", "Authentication required. Please log in."
        );
        response.getWriter().write(objectMapper.writeValueAsString(body));
    }
}
