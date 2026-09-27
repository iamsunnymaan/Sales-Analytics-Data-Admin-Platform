package com.houseofbeauty.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

// Just the hashing algorithm (spring-security-crypto), not the full Spring Security filter chain
// — see pom.xml's comment on why spring-boot-starter-security isn't pulled in yet. Used by
// AuthService to hash/verify IAM_Login_Users.Password_Hash and IAM_Login_Otp_Verifications.OTP_Code_Hash.
@Configuration
public class PasswordEncoderConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
