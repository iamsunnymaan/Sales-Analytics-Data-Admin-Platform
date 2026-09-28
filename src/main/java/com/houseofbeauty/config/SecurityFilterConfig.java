package com.houseofbeauty.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
