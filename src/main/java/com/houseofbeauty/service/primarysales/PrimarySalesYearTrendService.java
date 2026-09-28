package com.houseofbeauty.service.primarysales;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Year;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

@Service
public class PrimarySalesYearTrendService {

    private final JdbcTemplate jdbcTemplate;

    public PrimarySalesYearTrendService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Integer> listYears() {
        TreeSet<Integer> years = new TreeSet<>(
                jdbcTemplate.queryForList("SELECT DISTINCT YEAR(Sales_Date) FROM Primary_Sales", Integer.class));
        years.add(Year.now().getValue());
        return new ArrayList<>(years);
    }
}
