package com.houseofbeauty.service.topprojection;

import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.util.SqlDialect;
import com.houseofbeauty.dto.topprojection.request.SubmitTopProjectionRequest;
import com.houseofbeauty.dto.topprojection.request.TopProjectionGridSaveRow;
import com.houseofbeauty.dto.topprojection.request.UpdateTopProjectionRequest;
import com.houseofbeauty.dto.topprojection.response.TopProjectionEntryResponse;
import com.houseofbeauty.dto.topprojection.response.TopProjectionGridResponse;
import com.houseofbeauty.dto.topprojection.response.TopProjectionGridRow;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
public class TopProjectionService {

    private static final Logger log = LoggerFactory.getLogger(TopProjectionService.class);

    private static final List<String> BRANDS = List.of("Anastasia Beverly hills", "Kylie Cosmetics");

    private static final DateTimeFormatter MONTH_LABEL_FORMAT = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH);

    private final JdbcTemplate jdbcTemplate;
    private final SqlDialect dialect;
    private final String monthCol;

    public TopProjectionService(JdbcTemplate jdbcTemplate, SqlDialect dialect) {
        this.jdbcTemplate = jdbcTemplate;
        this.dialect = dialect;
        this.monthCol = dialect.quote("Month");
    }

    @PostConstruct
    public void truncateOnStartup() {
        try {
            truncateIfMonthRolledOver();
        } catch (Exception e) {
            log.warn("Skipping startup check for a Primary_Sales_Projection month rollover: {}", e.getMessage());
        }
    }

    @Scheduled(cron = "0 0 0 * * *")
    public void truncateIfMonthRolledOver() {
        LocalDate currentMonth = YearMonth.now().atDay(1);
        LocalDate maxMonth = jdbcTemplate.queryForObject("SELECT MAX(" + monthCol + ") FROM Primary_Sales_Projection", LocalDate.class);
        if (maxMonth != null && maxMonth.isBefore(currentMonth)) {
            jdbcTemplate.execute("TRUNCATE TABLE Primary_Sales_Projection");
            log.info("Primary_Sales_Projection truncated on month rollover (last data was for {}).", maxMonth);
        }
    }

    private record SiteCombo(String brand, String channel, String subChannel, String partner) {
    }

    private List<SiteCombo> loadSiteCombos(List<String> brands, String channelFilter, boolean primarySalesOnly) {
        StringBuilder sql = new StringBuilder(
                "SELECT DISTINCT Brand, Channel, Sub_Channel, Partner FROM Site_Master " +
                        "WHERE Brand IS NOT NULL AND LTRIM(RTRIM(Brand)) <> '' " +
                        "AND Channel IS NOT NULL AND LTRIM(RTRIM(Channel)) <> '' " +
                        "AND Sub_Channel IS NOT NULL AND LTRIM(RTRIM(Sub_Channel)) <> '' " +
                        "AND Partner IS NOT NULL AND LTRIM(RTRIM(Partner)) <> ''");
        if (primarySalesOnly) {
            sql.append(" AND Sales_Type = 'Primary Sales'");
        }
        List<Object> params = new ArrayList<>();
        if (brands != null && !brands.isEmpty()) {
            sql.append(" AND Brand IN (").append(String.join(",", brands.stream().map(b -> "?").toList())).append(")");
            params.addAll(brands);
        }

        boolean filterChannel = channelFilter != null && !"all".equalsIgnoreCase(channelFilter);
        Set<String> seenKeys = new LinkedHashSet<>();
        List<SiteCombo> combos = new ArrayList<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            SiteCombo combo = new SiteCombo(
                    (String) row.get("Brand"),
                    normalizeChannelDisplay((String) row.get("Channel")),
                    (String) row.get("Sub_Channel"),
                    (String) row.get("Partner"));
            if (filterChannel && !combo.channel().equalsIgnoreCase(channelFilter)) {
                continue;
            }
            String key = comboKey(combo.brand(), combo.channel(), combo.subChannel(), combo.partner());
            if (seenKeys.add(key)) {
                combos.add(combo);
            }
        }
        combos.sort(Comparator.comparing(SiteCombo::brand, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(SiteCombo::channel, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(SiteCombo::subChannel, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(SiteCombo::partner, String.CASE_INSENSITIVE_ORDER));
        return combos;
    }

    public List<String> getAvailableChannels() {
        String sql = "SELECT DISTINCT Channel FROM Site_Master " +
                "WHERE Channel IS NOT NULL AND LTRIM(RTRIM(Channel)) <> '' AND Sales_Type = 'Primary Sales'";
        Set<String> channels = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            channels.add(normalizeChannelDisplay((String) row.get("Channel")));
        }
        return new ArrayList<>(channels);
    }

    public List<String> getAvailableSaleTypes() {
        String sql = "SELECT DISTINCT Sales_Type FROM Site_Master " +
                "WHERE Sales_Type IS NOT NULL AND LTRIM(RTRIM(Sales_Type)) <> ''";
        Set<String> types = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String type : jdbcTemplate.queryForList(sql, String.class)) {
            types.add(type.trim());
        }
        return new ArrayList<>(types);
    }

    private void pruneOrphanedSubmissions(LocalDate month) {
        Set<String> validKeys = new java.util.HashSet<>();
        for (SiteCombo combo : loadSiteCombos(null, null, false)) {
            validKeys.add(comboKey(combo.brand(), combo.channel(), combo.subChannel(), combo.partner()));
        }

        String sql = "SELECT TopProjectionID, Brand, Channel, Sub_Channel, Partner FROM Primary_Sales_Projection WHERE " + monthCol + " = ?";
        List<Long> orphanedIds = new ArrayList<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, java.sql.Date.valueOf(month))) {
            String key = comboKey((String) row.get("Brand"), normalizeChannelDisplay((String) row.get("Channel")),
                    (String) row.get("Sub_Channel"), (String) row.get("Partner"));
            if (!validKeys.contains(key)) {
                orphanedIds.add(((Number) row.get("TopProjectionID")).longValue());
            }
        }
        if (orphanedIds.isEmpty()) {
            return;
        }
        for (Long id : orphanedIds) {
            jdbcTemplate.update("DELETE FROM Primary_Sales_Projection WHERE TopProjectionID = ?", id);
        }
        log.info("Pruned {} Primary_Sales_Projection submission(s) whose combo no longer exists in Site_Master.", orphanedIds.size());
    }

    private static String normalizeChannelDisplay(String channel) {
        String lower = channel.trim().toLowerCase(Locale.ROOT);
        return Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
    }

    public static String comboKey(String brand, String channel, String subChannel, String partner) {
        return normalizeKey(brand) + "|" + normalizeKey(channel) + "|" + normalizeKey(subChannel) + "|" + normalizeKey(partner);
    }

    public static String normalizeKey(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    public TopProjectionGridResponse getGrid(String brandFilter, String channelFilter) {
        String normalizedBrand = BrandFilter.normalize(brandFilter);
        List<String> brandsToShow = "all".equals(normalizedBrand)
                ? BRANDS : List.of(BrandFilter.product(normalizedBrand));

        LocalDate month = YearMonth.now().atDay(1);
        pruneOrphanedSubmissions(month);
        List<SiteCombo> combos = loadSiteCombos(brandsToShow, channelFilter, true);

        String placeholders = String.join(",", brandsToShow.stream().map(b -> "?").toList());
        String sql = "SELECT TopProjectionID, Brand, Channel, Sub_Channel, Partner, Projection_Value, Submitted_At " +
                "FROM Primary_Sales_Projection WHERE " + monthCol + " = ? AND Brand IN (" + placeholders + ")";
        List<Object> params = new ArrayList<>();
        params.add(java.sql.Date.valueOf(month));
        params.addAll(brandsToShow);

        Map<String, Map<String, Object>> existingByKey = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params.toArray())) {
            String key = comboKey((String) row.get("Brand"), normalizeChannelDisplay((String) row.get("Channel")),
                    (String) row.get("Sub_Channel"), (String) row.get("Partner"));
            existingByKey.put(key, row);
        }

        List<TopProjectionGridRow> rows = new ArrayList<>();
        for (SiteCombo combo : combos) {
            Map<String, Object> existing = existingByKey.get(comboKey(combo.brand(), combo.channel(), combo.subChannel(), combo.partner()));
            if (existing != null) {
                rows.add(new TopProjectionGridRow(
                        ((Number) existing.get("TopProjectionID")).longValue(),
                        combo.brand(), combo.channel(), combo.subChannel(), combo.partner(), month, null,
                        (BigDecimal) existing.get("Projection_Value"),
                        ((java.sql.Timestamp) existing.get("Submitted_At")).toLocalDateTime()));
            } else {
                rows.add(new TopProjectionGridRow(null, combo.brand(), combo.channel(), combo.subChannel(), combo.partner(), month, null, null, null));
            }
        }
        return new TopProjectionGridResponse(rows, month.toString(), month.format(MONTH_LABEL_FORMAT));
    }

    public List<TopProjectionEntryResponse> saveGrid(List<TopProjectionGridSaveRow> rows) {
        if (rows == null || rows.isEmpty()) {
            throw new IllegalArgumentException("No rows to save.");
        }
        List<TopProjectionEntryResponse> results = new ArrayList<>();
        for (TopProjectionGridSaveRow row : rows) {
            String brand = row == null ? null : row.brand();
            String channel = row == null ? null : row.channel();
            String subChannel = row == null ? null : row.subChannel();
            String partner = row == null ? null : row.partner();
            BigDecimal value = row == null ? null : row.projectionValue();
            if (value == null) {
                continue;
            }
            TopProjectionEntryResponse existing = findExistingCurrentMonthEntry(brand, channel, subChannel, partner);
            results.add(existing != null
                    ? update(existing.id(), new UpdateTopProjectionRequest(value))
                    : submit(new SubmitTopProjectionRequest(brand, channel, subChannel, partner, value)));
        }
        if (results.isEmpty()) {
            throw new IllegalArgumentException("Enter at least one Projection Value before submitting.");
        }
        return results;
    }

    public List<TopProjectionEntryResponse> listEntries() {
        String sql = "SELECT TopProjectionID, Brand, Channel, Sub_Channel, Partner, " + monthCol + ", Projection_Value, Submitted_At " +
                "FROM Primary_Sales_Projection WHERE " + monthCol + " = ? ORDER BY Submitted_At DESC";
        LocalDate currentMonth = YearMonth.now().atDay(1);
        return jdbcTemplate.query(sql, (rs, rowNum) -> new TopProjectionEntryResponse(
                rs.getLong("TopProjectionID"),
                rs.getString("Brand"),
                rs.getString("Channel"),
                rs.getString("Sub_Channel"),
                rs.getString("Partner"),
                rs.getDate("Month").toLocalDate(),
                rs.getBigDecimal("Projection_Value"),
                rs.getTimestamp("Submitted_At").toLocalDateTime()), java.sql.Date.valueOf(currentMonth));
    }

    public BigDecimal getCurrentMonthProjectionTotal(String targetBrand) {
        return getProjectionTotalForMonth(YearMonth.now(), targetBrand);
    }

    public BigDecimal getProjectionTotalForMonth(YearMonth month, String targetBrand) {
        StringBuilder sql = new StringBuilder(
                "SELECT COALESCE(SUM(Projection_Value), 0) FROM ( " +
                        "SELECT Projection_Value, ROW_NUMBER() OVER (" +
                        "PARTITION BY Brand, Channel, Sub_Channel, Partner ORDER BY Submitted_At DESC, TopProjectionID DESC) AS rn " +
                        "FROM Primary_Sales_Projection WHERE " + monthCol + " = ?");
        List<Object> params = new ArrayList<>();
        params.add(java.sql.Date.valueOf(month.atDay(1)));
        if (targetBrand != null) {
            sql.append(" AND Brand = ?");
            params.add(targetBrand);
        }
        sql.append(") ranked WHERE rn = 1");
        BigDecimal total = jdbcTemplate.queryForObject(sql.toString(), BigDecimal.class, params.toArray());
        return total == null ? BigDecimal.ZERO : total;
    }

    public BigDecimal getProjectionTotalForMonth(YearMonth month, String brand, String channel) {
        StringBuilder sql = new StringBuilder(
                "SELECT COALESCE(SUM(Projection_Value), 0) FROM ( " +
                        "SELECT Projection_Value, ROW_NUMBER() OVER (" +
                        "PARTITION BY Brand, Channel, Sub_Channel, Partner ORDER BY Submitted_At DESC, TopProjectionID DESC) AS rn " +
                        "FROM Primary_Sales_Projection WHERE " + monthCol + " = ?");
        List<Object> params = new ArrayList<>();
        params.add(java.sql.Date.valueOf(month.atDay(1)));
        if (brand != null) {
            sql.append(" AND Brand = ?");
            params.add(brand);
        }
        if (channel != null) {
            sql.append(" AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(?)");
            params.add(channel);
        }
        sql.append(") ranked WHERE rn = 1");
        BigDecimal total = jdbcTemplate.queryForObject(sql.toString(), BigDecimal.class, params.toArray());
        return total == null ? BigDecimal.ZERO : total;
    }

    public Map<String, BigDecimal> getCurrentMonthProjectionsByCombo() {
        String sql = "SELECT Brand, Channel, Sub_Channel, Partner, Projection_Value FROM ( " +
                "SELECT Brand, Channel, Sub_Channel, Partner, Projection_Value, ROW_NUMBER() OVER (" +
                "PARTITION BY Brand, Channel, Sub_Channel, Partner ORDER BY Submitted_At DESC, TopProjectionID DESC) AS rn " +
                "FROM Primary_Sales_Projection WHERE " + monthCol + " = ?" +
                ") ranked WHERE rn = 1";
        Map<String, BigDecimal> byCombo = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, java.sql.Date.valueOf(YearMonth.now().atDay(1)))) {
            BigDecimal value = row.get("Projection_Value") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            byCombo.put(comboKey((String) row.get("Brand"), (String) row.get("Channel"),
                    (String) row.get("Sub_Channel"), (String) row.get("Partner")), value);
        }
        return byCombo;
    }

    public Map<String, BigDecimal> getLatestProjectionsByChannelInRange(YearMonth from, YearMonth to, String brand) {
        String sql = "SELECT Channel, SUM(Projection_Value) AS total FROM ( " +
                "SELECT Channel, Projection_Value, ROW_NUMBER() OVER (" +
                "PARTITION BY Brand, Channel, Sub_Channel, Partner, " + monthCol + " ORDER BY Submitted_At DESC, TopProjectionID DESC) AS rn " +
                "FROM Primary_Sales_Projection WHERE " + monthCol + " BETWEEN ? AND ?" +
                (brand != null ? " AND Brand = ?" : "") +
                ") ranked WHERE rn = 1 GROUP BY Channel";
        List<Object> params = new ArrayList<>(List.of(java.sql.Date.valueOf(from.atDay(1)), java.sql.Date.valueOf(to.atDay(1))));
        if (brand != null) {
            params.add(brand);
        }
        Map<String, BigDecimal> byChannel = new java.util.HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params.toArray())) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            byChannel.put((String) row.get("Channel"), total);
        }
        return byChannel;
    }

    public Map<String, BigDecimal> getLatestProjectionsByPartnerInRange(YearMonth from, YearMonth to, String brand, String channel) {
        String sql = "SELECT Partner, SUM(Projection_Value) AS total FROM ( " +
                "SELECT Partner, Projection_Value, ROW_NUMBER() OVER (" +
                "PARTITION BY Brand, Channel, Sub_Channel, Partner, " + monthCol + " ORDER BY Submitted_At DESC, TopProjectionID DESC) AS rn " +
                "FROM Primary_Sales_Projection WHERE " + monthCol + " BETWEEN ? AND ?" +
                (brand != null ? " AND Brand = ?" : "") +
                (channel != null ? " AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(?)" : "") +
                ") ranked WHERE rn = 1 GROUP BY Partner";
        List<Object> params = new ArrayList<>(List.of(java.sql.Date.valueOf(from.atDay(1)), java.sql.Date.valueOf(to.atDay(1))));
        if (brand != null) {
            params.add(brand);
        }
        if (channel != null) {
            params.add(channel);
        }
        Map<String, BigDecimal> byPartner = new java.util.HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params.toArray())) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            byPartner.put((String) row.get("Partner"), total);
        }
        return byPartner;
    }

    public Map<String, BigDecimal> getLatestProjectionsBySubChannelInRange(YearMonth from, YearMonth to, String brand) {
        String sql = "SELECT Sub_Channel, SUM(Projection_Value) AS total FROM ( " +
                "SELECT Sub_Channel, Projection_Value, ROW_NUMBER() OVER (" +
                "PARTITION BY Brand, Channel, Sub_Channel, Partner, " + monthCol + " ORDER BY Submitted_At DESC, TopProjectionID DESC) AS rn " +
                "FROM Primary_Sales_Projection WHERE " + monthCol + " BETWEEN ? AND ?" +
                (brand != null ? " AND Brand = ?" : "") +
                ") ranked WHERE rn = 1 GROUP BY Sub_Channel";
        List<Object> params = new ArrayList<>(List.of(java.sql.Date.valueOf(from.atDay(1)), java.sql.Date.valueOf(to.atDay(1))));
        if (brand != null) {
            params.add(brand);
        }
        Map<String, BigDecimal> bySubChannel = new java.util.HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, params.toArray())) {
            BigDecimal total = row.get("total") instanceof BigDecimal decimal ? decimal : BigDecimal.ZERO;
            bySubChannel.put((String) row.get("Sub_Channel"), total);
        }
        return bySubChannel;
    }

    public TopProjectionEntryResponse findExistingCurrentMonthEntry(String brand, String channel, String subChannel, String partner) {
        String sql = "SELECT " + dialect.topPrefix(1) + "TopProjectionID, Brand, Channel, Sub_Channel, Partner, " + monthCol + ", Projection_Value, Submitted_At " +
                "FROM Primary_Sales_Projection WHERE " + monthCol + " = ? AND Brand = ? AND Channel = ? AND Sub_Channel = ? AND Partner = ? " +
                "ORDER BY Submitted_At DESC, TopProjectionID DESC" + dialect.limitSuffix(1);
        try {
            return jdbcTemplate.queryForObject(sql, (rs, rowNum) -> new TopProjectionEntryResponse(
                    rs.getLong("TopProjectionID"),
                    rs.getString("Brand"),
                    rs.getString("Channel"),
                    rs.getString("Sub_Channel"),
                    rs.getString("Partner"),
                    rs.getDate("Month").toLocalDate(),
                    rs.getBigDecimal("Projection_Value"),
                    rs.getTimestamp("Submitted_At").toLocalDateTime()),
                    java.sql.Date.valueOf(YearMonth.now().atDay(1)), brand, channel, subChannel, partner);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public TopProjectionEntryResponse update(long id, UpdateTopProjectionRequest request) {
        BigDecimal value = request == null ? null : request.projectionValue();
        if (value == null || value.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("Projection value must be a non-negative number.");
        }

        LocalDateTime submittedAt = LocalDateTime.now();
        int updated = jdbcTemplate.update(
                "UPDATE Primary_Sales_Projection SET Projection_Value = ?, Submitted_At = ? WHERE TopProjectionID = ?",
                value, java.sql.Timestamp.valueOf(submittedAt), id);
        if (updated == 0) {
            throw new IllegalArgumentException("No projection entry found with id " + id);
        }

        String sql = "SELECT Brand, Channel, Sub_Channel, Partner, " + monthCol + " FROM Primary_Sales_Projection WHERE TopProjectionID = ?";
        Map<String, Object> row = jdbcTemplate.queryForMap(sql, id);
        return new TopProjectionEntryResponse(id, (String) row.get("Brand"), (String) row.get("Channel"),
                (String) row.get("Sub_Channel"), (String) row.get("Partner"),
                ((java.sql.Date) row.get("Month")).toLocalDate(), value, submittedAt);
    }

    public TopProjectionEntryResponse submit(SubmitTopProjectionRequest request) {
        String brand = request == null ? null : request.brand();
        String channel = request == null ? null : request.channel();
        String subChannel = request == null ? null : request.subChannel();
        String partner = request == null ? null : request.partner();
        BigDecimal value = request == null ? null : request.projectionValue();

        if (brand == null || !BRANDS.contains(brand)) {
            throw new IllegalArgumentException("Invalid brand: must be one of " + BRANDS);
        }

        if (channel == null || channel.isBlank()) {
            throw new IllegalArgumentException("Invalid channel: must not be blank.");
        }
        if (subChannel == null || subChannel.isBlank()) {
            throw new IllegalArgumentException("Invalid sub-channel: must not be blank.");
        }
        if (partner == null || partner.isBlank()) {
            throw new IllegalArgumentException("Invalid partner: must not be blank.");
        }
        if (value == null || value.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("Projection value must be a non-negative number.");
        }

        LocalDate month = YearMonth.now().atDay(1);
        LocalDateTime submittedAt = LocalDateTime.now();

        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO Primary_Sales_Projection (Brand, Channel, Sub_Channel, Partner, " + monthCol + ", Projection_Value, Submitted_At) " +
                            "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, brand);
            ps.setString(2, channel);
            ps.setString(3, subChannel);
            ps.setString(4, partner);
            ps.setDate(5, java.sql.Date.valueOf(month));
            ps.setBigDecimal(6, value);
            ps.setTimestamp(7, java.sql.Timestamp.valueOf(submittedAt));
            return ps;
        }, keyHolder);

        long id = keyHolder.getKey().longValue();
        return new TopProjectionEntryResponse(id, brand, channel, subChannel, partner, month, value, submittedAt);
    }
}
