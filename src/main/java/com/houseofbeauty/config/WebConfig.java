package com.houseofbeauty.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.houseofbeauty.security.PageAccessInterceptor;
import com.houseofbeauty.security.PermissionInterceptor;
import com.houseofbeauty.service.auth.AuthService;
import com.houseofbeauty.service.monitoring.MonitoringAuditService;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

// Registers PermissionInterceptor (the @RequirePermission check) for /api/** — the interceptor
// itself no-ops for any handler without that annotation, so this doesn't change behavior for
// endpoints that haven't been annotated yet (see PermissionInterceptor's own header comment). Also
// registers PageAccessInterceptor for the page document paths it gates ("/", "/index.html",
// "/pages/**") — see that class's own header comment for why it's a HandlerInterceptor here rather
// than a Filter alongside AuthenticationFilter in SecurityFilterConfig.
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AuthService authService;
    private final ObjectMapper objectMapper;
    private final MonitoringAuditService monitoringAuditService;

    public WebConfig(AuthService authService, ObjectMapper objectMapper, MonitoringAuditService monitoringAuditService) {
        this.authService = authService;
        this.objectMapper = objectMapper;
        this.monitoringAuditService = monitoringAuditService;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new PermissionInterceptor(authService, objectMapper, monitoringAuditService))
                .addPathPatterns("/api/**");
        registry.addInterceptor(new PageAccessInterceptor(authService, monitoringAuditService))
                .addPathPatterns("/", "/index.html", "/pages/**");
    }
}
