package com.houseofbeauty.service.primarysales;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Year;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

// Backs the Primary Sales page's Sales Comparison 02 section's Year checkbox list.
@Service
public class PrimarySalesYearTrendService {

    private final JdbcTemplate jdbcTemplate;

    public PrimarySalesYearTrendService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    // Distinct years with data, plus the current year, for the section's Year checkbox list.
    public List<Integer> listYears() {
        TreeSet<Integer> years = new TreeSet<>(
                jdbcTemplate.queryForList("SELECT DISTINCT YEAR(Sales_Date) FROM Primary_Sales", Integer.class));
        years.add(Year.now().getValue());
        return new ArrayList<>(years);
    }
}
