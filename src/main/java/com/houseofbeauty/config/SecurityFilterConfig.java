package com.houseofbeauty.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// Registers AuthenticationFilter for /api/* only. AuthenticationFilter is deliberately NOT a
// @Component here — letting Spring Boot auto-register any Filter bean would default it to every
// URL ("/*"), which would also start gating the static HTML/CSS/JS this app serves (and break
// LoginPage.html itself, which has to stay reachable unauthenticated). Explicit registration here
// keeps it scoped to just the API. (Page-document-level access control — the equivalent gate for
// "/", "/index.html", "/pages/**" — is PageAccessInterceptor, registered in WebConfig instead: a
// HandlerInterceptor rather than a Filter, since it also needs to cover requests Spring's static-
// resource HandlerMapping serves, and Spring's own path matching (not raw servlet url-pattern
// semantics, where a bare "/" has special "default servlet" meaning) is what makes "/" matchable
// exactly and unambiguously.)
@Configuration
public class SecurityFilterConfig {

    @Bean
    public FilterRegistrationBean<AuthenticationFilter> authenticationFilter(ObjectMapper objectMapper) {
        FilterRegistrationBean<AuthenticationFilter> registration =
                new FilterRegistrationBean<>(new AuthenticationFilter(objectMapper));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(1);
        return registration;
    }
}
