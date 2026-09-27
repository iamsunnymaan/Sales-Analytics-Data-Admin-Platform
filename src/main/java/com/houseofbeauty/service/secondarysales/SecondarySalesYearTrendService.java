package com.houseofbeauty.service.secondarysales;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Year;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

// Backs the Secondary Sales page's Daily Sales Trends date filter's Year checkbox/dropdown list —
// mirrors PrimarySalesYearTrendService#listYears, scoped to Secondary_Sales.
@Service
public class SecondarySalesYearTrendService {

    private final JdbcTemplate jdbcTemplate;

    public SecondarySalesYearTrendService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    // Distinct years with data, plus the current year, for the date filter's Year picker.
    public List<Integer> listYears() {
        TreeSet<Integer> years = new TreeSet<>(
                jdbcTemplate.queryForList("SELECT DISTINCT YEAR(Sales_Date) FROM Secondary_Sales", Integer.class));
        years.add(Year.now().getValue());
        return new ArrayList<>(years);
    }
}
