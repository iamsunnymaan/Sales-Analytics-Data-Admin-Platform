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

// Backs the Quick Access Panel's "Projection Form" popup (Primary_Sales_Projection — see
// database/01_schema.sql). A pure fresh-entry log: getGrid returns one row per real
// Brand+Channel+Sub_Channel+Partner combo found in Site_Master (not a fixed list this class
// hardcodes — the old CHANNELS/PARTNERS constants it used to have didn't line up with Site_Master's
// own values, e.g. "Nykaa" vs Site_Master's "Nykaa-Online"/"Nykaa-Offline"), each row's Projection
// Value input always starts blank so an untouched row is never accidentally resubmitted with a stale
// number, and its {@code lastValue} shows that combo's existing stored value (if any) purely for
// reference — see getGrid/saveGrid's own comments. Because the grid re-queries Site_Master live on
// every load, it's always automatically in sync with it; the one thing that does need an explicit
// step is a submission whose combo Site_Master no longer has (a re-upload renamed/removed a
// Brand+Channel+Sub_Channel+Partner combo that had a real value this month) — pruneOrphanedSubmissions
// deletes those, called at the top of every getGrid. listEntries (a flat log view, most-recent-first)
// predates the grid and stays unused by any current UI, same as before.
//
// This table only ever holds the CURRENT calendar month's data — see truncateIfMonthRolledOver
// below, a real TRUNCATE at month rollover (no archive kept): getCurrentMonthProjectionTotal's real
// "Projection" figure (see PrimarySalesTodayService.getMonthlySales) and every "Vs LM"/"Vs LY" figure
// that reads a past month via getProjectionTotalForMonth will read as zero for any month once it's
// rolled past, by design — this is an in-progress-month entry log, not a permanent record.
// getCurrentMonthProjectionsByCombo/getLatestProjectionsByChannelInRange/-BySubChannelInRange/
// -ByPartnerInRange briefly fed the Primary Sales page's "4. Reports" section's own Proj. columns —
// that section was removed again (2026-09-03) per explicit request, so as of that removal these four
// methods are currently unused (kept as ready-made building blocks rather than deleted outright; see
// each method's own comment).
//
// Primary_Sales_Projection carries Channel/Sub_Channel/Partner columns, all real Site_Master values (see
// loadSiteCombos) — the row uniqueness a submission is checked/overwritten against is the full
// Brand+Channel+Sub_Channel+Partner+Month combo, so two Site_Master rows that share a Channel but
// differ in Sub_Channel or Partner carry independent figures.
@Service
public class TopProjectionService {

    private static final Logger log = LoggerFactory.getLogger(TopProjectionService.class);

    // Site_Master's own Brand vocabulary (BrandFilter#product's two values, e.g. "Anastasia Beverly
    // hills"/"Kylie Cosmetics") — getGrid's "all" case (both brands together) and submit()'s
    // row-level sanity check both still need a concrete list, even though the actual brandFilter
    // validation/mapping now goes through BrandFilter itself.
    // FIXED: this used to be the short codes ("ABH", "Kylie") — Primary_Sales_Projection.Brand and
    // Site_Master.Brand both actually store the full display names (verified live via SQL: `SELECT
    // DISTINCT Brand FROM Site_Master WHERE Sales_Type = 'Primary Sales'` returns "Anastasia Beverly
    // hills"/"Kylie Cosmetics"), so loadSiteCombos' own `AND Brand IN (...)` filter (built from this
    // list) never matched a single row — the exact same BrandFilter#target-vs-#product vocabulary
    // mismatch bug found/fixed elsewhere this session (see SecondarySalesDailyTrendService/
    // PrimarySalesDailyTrendService), which made this whole popup's grid permanently empty.
    // Selecting a brand Site_Master has no rows for today (e.g. "Kylie Cosmetics" before it's ever
    // uploaded) legitimately returns an empty grid, not an error.
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

    // A genuine month rollover, not a daily reset — the table can (and normally does) sit untouched
    // for weeks with the current month's data in it; this only fires once the calendar has actually
    // moved past every row currently in the table. Same daily-cron + startup-catch-up shape as
    // ImportSessionCleanupService.deleteExpiredSessions: Spring's @Scheduled only fires while the app
    // is running at that instant, so a server that's down (or gets restarted) right at midnight on
    // the 1st would skip the rollover forever without the @PostConstruct catch-up run too. No archive
    // is kept — per explicit decision, this is a real TRUNCATE, not an end-of-month snapshot, so
    // lastValue (see getGrid) legitimately comes back null for every combo right after a rollover.
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

    // One real Site_Master row's Brand+Channel+Sub_Channel+Partner quadruple, deduped and
    // display-normalized (see loadSiteCombos) — the grid's row identity, replacing the old fixed
    // CHANNELS/PARTNERS lists.
    private record SiteCombo(String brand, String channel, String subChannel, String partner) {
    }

    // Every real distinct Brand+Channel+Sub_Channel+Partner combo Site_Master currently has,
    // optionally narrowed to `brands` (null/empty means every brand) and to `channelFilter`
    // (null/"all", case-insensitive, means every channel — matched against the DISPLAY-normalized
    // Channel, after loading, since the raw casing in Site_Master itself isn't reliable enough to
    // filter on in SQL), sorted Brand then Channel then Sub_Channel then Partner (case-insensitive)
    // for a stable grid row order. Channel is display-normalized the same way
    // PrimarySalesReportsService.normalizeChannelDisplay does ("online"/"Online" both occur in the
    // wild) so the same real channel doesn't show up as two differently-capitalized rows once
    // deduped; blank Brand/Channel/Sub_Channel/Partner rows are excluded rather than falling into an
    // "Uncategorized" bucket, since a projection needs a real, submittable combo.
    // `primarySalesOnly` scopes combos to Site_Master rows whose own Sales_Type is 'Primary Sales' —
    // used by getGrid (this whole popup is a Primary_Sales_Projection feature, per explicit decision
    // permanently locked to Primary Sales, not a user-toggleable filter) but NOT by
    // pruneOrphanedSubmissions, which deliberately checks against every Sales_Type so it never
    // deletes a still-real combo just because this newer filter would otherwise exclude it.
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

    // Every real distinct Channel value Site_Master currently has, display-normalized and sorted —
    // backs the popup's Channel toggle (GET /api/top-projection/channels): "All" plus whatever this
    // returns, so the toggle adapts automatically if Site_Master's own Channel vocabulary changes
    // instead of this class hardcoding it. Scoped to Sales_Type = 'Primary Sales' (same as
    // loadSiteCombos' own getGrid path) so this toggle never offers a Channel that only exists among
    // Secondary Sales sites and would then match zero rows in the (always Primary-Sales-only) grid.
    public List<String> getAvailableChannels() {
        String sql = "SELECT DISTINCT Channel FROM Site_Master " +
                "WHERE Channel IS NOT NULL AND LTRIM(RTRIM(Channel)) <> '' AND Sales_Type = 'Primary Sales'";
        Set<String> channels = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql)) {
            channels.add(normalizeChannelDisplay((String) row.get("Channel")));
        }
        return new ArrayList<>(channels);
    }

    // Every real distinct Sales_Type value Site_Master currently has (today: "Primary Sales" and
    // "Secondary Sales") — backs the popup's Sale Type pill, which is purely informational/locked to
    // "Primary Sales" (see getGrid's own comment on why this whole feature is permanently scoped to
    // Primary Sales) rather than an actual selectable filter, per explicit request: the pill still
    // shows real Site_Master values, not a hardcoded pair, so it stays accurate if that vocabulary
    // ever changes.
    public List<String> getAvailableSaleTypes() {
        String sql = "SELECT DISTINCT Sales_Type FROM Site_Master " +
                "WHERE Sales_Type IS NOT NULL AND LTRIM(RTRIM(Sales_Type)) <> ''";
        Set<String> types = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String type : jdbcTemplate.queryForList(sql, String.class)) {
            types.add(type.trim());
        }
        return new ArrayList<>(types);
    }

    // Deletes any current-month Primary_Sales_Projection row whose Brand+Channel+Sub_Channel+Partner combo no
    // longer exists in Site_Master — per explicit decision, a submission for a combo that a
    // Site_Master re-upload has since renamed/removed shouldn't linger referencing something that no
    // longer exists. Runs against EVERY brand/channel (not just whatever the current request is
    // filtered to), so switching the popup's Brand/Channel toggle never wipes another combo's real
    // submission just because it's outside the current view. Called at the top of every getGrid, so
    // the moment Site_Master changes, the next popup open (or brand/channel switch, which reloads the
    // grid) cleans up after it — no separate schedule needed.
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

    // "offline"/"Offline" both occur in the wild in Site_Master (same fact
    // PrimarySalesReportsService documents) — capitalizing the first letter keeps grouping
    // case-insensitive in effect while giving both a single, tidy display form.
    private static String normalizeChannelDisplay(String channel) {
        String lower = channel.trim().toLowerCase(Locale.ROOT);
        return Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
    }

    // Public — PrimarySalesReportsService builds matching keys against getCurrentMonthProjectionsByCombo's
    // own map using this exact same function, so the two classes' notion of "the same combo" can never
    // drift apart into two subtly different normalization rules.
    public static String comboKey(String brand, String channel, String subChannel, String partner) {
        return normalizeKey(brand) + "|" + normalizeKey(channel) + "|" + normalizeKey(subChannel) + "|" + normalizeKey(partner);
    }

    public static String normalizeKey(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    // Per later explicit request, the popup was rebuilt from a one-row-at-a-time form into a grid:
    // pick a Brand ("all"/"ABH"/"Kylie") and a Channel ("all" or one of getAvailableChannels()), see
    // every real Brand+Channel+Sub_Channel+Partner combo Site_Master currently has for that filter
    // (both toggles apply together — a combo must match both) as one row each, whether or not a
    // submission already exists for it this month. Projection Value is ALWAYS returned null (a fresh
    // row, never pre-filled — see this class's header comment); lastValue instead carries that
    // combo's existing stored value (and id/submittedAt) where a submission already exists this
    // month, all three staying null for a combo nobody has submitted yet. channelFilter null/"all"
    // means every channel; anything else is matched case-insensitively against
    // getAvailableChannels() — unlike Brand, this isn't a fixed list, so an unrecognized value just
    // legitimately returns an empty grid rather than throwing (same "empty is a valid outcome"
    // philosophy Brand already has for a brand Site_Master has no rows for yet).
    //
    // brandFilter's normalize/product routing is now the exact same BrandFilter logic the Overview
    // Insights card's own Brand pill uses server-side (see PrimarySalesTodayService/BrandFilter) —
    // per explicit request, this popup's Brand toggle should behave identically to that pill even
    // though its own UI/markup stays a separate, self-styled component. brandFilter itself is always
    // "all"/"abh"/"kylie" (the short UI code, see QuickAccessPanel.js's own brandNameToCode) — this
    // resolves to BrandFilter#product's Site_Master.Brand display names ("Anastasia Beverly hills"/
    // "Kylie Cosmetics"), NOT BrandFilter#target's short codes (that vocabulary belongs only to
    // Primary_Sales_Target, a table this class never queries — see this file's BRANDS comment for the
    // real bug this used to be).
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

        // Keyed by "Brand|Channel|Sub_Channel|Partner" — the same natural key every dedup/uniqueness
        // check in this class already uses, just as a lookup here instead of a SQL PARTITION BY.
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

    // Bulk Save for the grid popup — one call per row the popup actually submits (see getGrid above);
    // per the form's fresh-entry design, the frontend only ever includes rows the user typed a real
    // value into and omits every untouched one, but a null/blank value is skipped here too as a
    // safety net rather than trusted blindly — an untouched combo's existing value (if any) is left
    // alone, never overwritten with a stray null. Each included row is routed through the exact same
    // findExistingCurrentMonthEntry/submit/update logic the old one-row-at-a-time popup used: a combo
    // that already has a row gets updated in place, a combo that doesn't gets a fresh insert. Reusing
    // those methods (rather than a new bulk UPSERT query) keeps every existing validation/uniqueness
    // rule — non-negative value, Submitted_At refresh on update — in exactly one place instead of
    // duplicating it for the grid path.
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

    // Most recent submission first, scoped to the current calendar month only — every submission is
    // always tagged with the month it was entered in (see submit() below), so once the calendar
    // rolls over a past month's entries age out of this list rather than piling up forever; this is
    // still a log, not a per-period-unique value, so repeats for the same brand/channel within the
    // month are each their own row.
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

    // The Overview section's "Projection" figure for the current calendar month (see
    // PrimarySalesTodayService.getMonthlySales) — just getProjectionTotalForMonth for the real
    // current month. `targetBrand` is the Primary_Sales_Target vocabulary ("ABH"/"Kylie", see
    // BrandFilter#target) — null sums across both brands.
    public BigDecimal getCurrentMonthProjectionTotal(String targetBrand) {
        return getProjectionTotalForMonth(YearMonth.now(), targetBrand);
    }

    // The same figure as getCurrentMonthProjectionTotal, but for an arbitrary month — backs the
    // Overview Insights card's Projection row's Vs LM/Vs LY (the immediately preceding calendar
    // month's, and the same month last year's, own real Primary_Sales_Projection totals — see
    // PrimarySalesTodayService.getMonthlySales). The SUM, across every Brand+Channel+Partner combo
    // submitted in that month, of only the LATEST entry per combo (by Submitted_At, tie-broken by
    // TopProjectionID): since this table is an append-only log, a resubmission for the same
    // Brand+Channel+Partner is a correction, not an addition, so summing every row would
    // double-count it. Partner is part of the dedup partition (not just Brand+Channel) so an
    // Online row and an Offline row for the same Brand+Channel+Month are two distinct combos that
    // both survive and both get summed, not one dedup'd away as a false duplicate of the other.
    // A month nobody ever submitted anything for (the common case for any month but the current one,
    // since the submission form always tags today's real month) legitimately sums to zero — the
    // frontend is what turns that into a "—" instead of a fabricated 0% via insightsZeroSafeGrowthPct.
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

    // Same as getProjectionTotalForMonth(month, brand) above, additionally scoped by Channel — backs
    // the Dashboard's "1. Overview" current-month row, which stands in the real submitted Projection
    // total for Primary Sales' Actual figure whenever the current month has no real Primary_Sales rows
    // yet (see DashboardOverviewService's own header comment / Dashboard.js's renderDashboardFyOverviewTable).
    // No Status param: Primary_Sales_Projection is keyed by Brand+Channel+Sub_Channel+Partner, not
    // Site_Code, so there's no per-site Operational_Status to join against here.
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

    // Real Projection per exact Brand+Channel+Sub_Channel+Partner combo, for the CURRENT calendar
    // month only — Primary_Sales_Projection only ever holds current-month data (truncated at rollover, see
    // truncateIfMonthRolledOver). Latest submitted value per combo wins (ROW_NUMBER dedup,
    // same rule getProjectionTotalForMonth uses) — a combo with no submission this month is simply
    // absent from the map, the caller treats that as zero. Keyed via the public comboKey above so a
    // caller can look up its own Site_Master-derived combo against this map with zero risk of the two
    // classes' key formats drifting apart. Currently unused (see this class's header comment).
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

    // Sum, per Channel, of that channel's latest submitted Projection_Value (summed across BOTH
    // Online and Offline Partner rows) in EACH month across [from, to] inclusive (a single month is
    // just from == to). Dedup is per Brand+Channel+Partner+Month (ROW_NUMBER over Submitted_At/
    // TopProjectionID, same "latest wins" rule getProjectionTotalForMonth uses) so a resubmission
    // within one month for the same Partner is a correction, not an addition, but Online and Offline
    // are distinct combos that both survive and both get summed into this Channel's total, and a real
    // second month's submission for the same channel still adds on top too — same "sum every month in
    // the range" shape PrimarySalesTargetService.getTargetsByPartnerInRange uses for Month Target. A
    // channel with no submission in ANY month of the range is simply absent from the result — the
    // caller treats that as zero. `brand` is nullable (sums across both brands, e.g. for a combined
    // Total row) — the ROW_NUMBER partition always includes Brand even when the WHERE clause doesn't
    // filter on it, so ABH's and Kylie's own latest entries for the same Channel+Partner+Month both
    // survive the dedup independently and get summed together, rather than the dedup picking only one
    // of the two brands' rows and silently dropping the other. Currently unused (see this class's
    // header comment).
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

    // Sum, per Partner (e.g. "Nykaa", "Mall", "Tira Online"), of that Partner's latest submitted
    // Projection_Value (summed across EVERY Channel, unless `channel` narrows it to one) in EACH
    // month across [from, to] inclusive. Mirrors getLatestProjectionsByChannelInRange above but
    // grouped the other way (by Partner instead of Channel). Same dedup shape: partitioned by the
    // full Brand+Channel+Partner+Month key so a resubmission for one Channel+Partner combo is a
    // correction, not an addition, while every other Channel's own entries still add on top into this
    // Partner's total, and a real second month's submission still adds on too. Same nullable `brand`/
    // `channel` convention as getProjectionTotalForMonth(month, brand, channel) above (null means no
    // filter on that column). Keys stay the raw Partner spelling exactly as stored (NOT
    // TextMatch-normalized) — PrimarySalesReportsService#getPartnerSummaries already keys its own
    // lookup into this same map by the raw Site_Master.Partner spelling (SiteRow::partner), so
    // normalizing here would silently zero out that page's own Proj. column for any partner whose
    // casing doesn't happen to already match. A caller that DOES want a normalized/lowercased key
    // (e.g. Dashboard's own Current Month Projection column, keyed the same way
    // DashboardOverviewService#collectPartnerTotals's maps already are) re-keys this map itself after
    // calling in — see DashboardController's own /partner-overview/projection endpoint.
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

    // Sum, per Sub_Channel, of that Sub_Channel's latest submitted Projection_Value (summed across
    // every Channel/Partner under it) in EACH month across [from, to] inclusive. Mirrors
    // getLatestProjectionsByChannelInRange/getLatestProjectionsByPartnerInRange exactly, just grouped
    // by Sub_Channel. Currently unused (see this class's header comment).
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

    // Backs the popup's pre-submit check: is there already a row for this Brand+Channel+Partner
    // this calendar month? If so the form asks the user to confirm overwriting it (see update
    // below) instead of silently inserting a second row for the same combo — the thing that let
    // ABH/Tira accumulate 3 rows in one month and made the Overview Projection total (which sums
    // one value per Brand+Channel+Partner, see getCurrentMonthProjectionTotal) diverge from a
    // simple eyeballed total of everything in the log. Most-recent row wins if legacy duplicates
    // already exist for a combo.
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

    // Overwrites an existing row's Projection_Value in place (the "Update" button on the popup
    // that findExistingCurrentMonthEntry triggers) — no new row, so a Brand+Channel+Partner never
    // accumulates more than one entry for the same month. Submitted_At is refreshed too, so "most
    // recently touched" stays meaningful for anyone reading the raw table.
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

    // Inserts a genuinely new Brand+Channel+Sub_Channel+Partner+month row — the popup only ever calls
    // this after findExistingCurrentMonthEntry came back empty; when it doesn't, the popup routes the
    // user to update(id, ...) instead so the existing row is overwritten rather than duplicated.
    public TopProjectionEntryResponse submit(SubmitTopProjectionRequest request) {
        String brand = request == null ? null : request.brand();
        String channel = request == null ? null : request.channel();
        String subChannel = request == null ? null : request.subChannel();
        String partner = request == null ? null : request.partner();
        BigDecimal value = request == null ? null : request.projectionValue();

        if (brand == null || !BRANDS.contains(brand)) {
            throw new IllegalArgumentException("Invalid brand: must be one of " + BRANDS);
        }
        // Channel/Sub_Channel/Partner are no longer checked against a fixed list — they're real
        // Site_Master values now (see loadSiteCombos), an open, evolving set rather than something
        // this class can hardcode. The grid never lets the user free-type these three (each row's
        // identity is fixed by getGrid, only Projection Value is an editable field), so a blank check
        // is the only defense actually needed against a malformed request.
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
