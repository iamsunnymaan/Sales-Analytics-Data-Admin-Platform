package com.houseofbeauty.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;

// Exposes a JdbcTemplate bean over the auto-configured DataSource — used for the raw/dynamic
// SQL in TableAccessService (querying arbitrary tables isn't a good fit for Spring Data JPA repos).
@Configuration
public class DatabaseConfig {

    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }
}
