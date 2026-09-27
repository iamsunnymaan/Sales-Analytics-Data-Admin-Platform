package com.houseofbeauty.service.primarysales;

import com.houseofbeauty.dto.primarysales.response.BrandQuantityRow;
import com.houseofbeauty.dto.primarysales.response.CategoryRow;
import com.houseofbeauty.dto.primarysales.response.ProductLevelResponse;
import com.houseofbeauty.dto.primarysales.response.ProductRow;
import com.houseofbeauty.dto.primarysales.response.SubCategoryRow;
import com.houseofbeauty.dto.primarysales.response.TrendPeriod;
import com.houseofbeauty.service.common.BrandFilter;
import com.houseofbeauty.service.common.ChannelFilter;
import com.houseofbeauty.service.common.GrowthMath;
import com.houseofbeauty.service.common.OperationalStatusFilter;
import com.houseofbeauty.util.SqlDialect;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.stream.Collectors;

// Backs the Primary Sales page's "3. Product Snapshot" section: the top full-width Category ->
// Sub-category -> Product nested tree ("tree"), the "Product Ranking" panel's Products/Category/
// Sub-category top/bottom-by-value/qty lists ("categories"/"subCategories" are returned in
// full — unlimited, sorted by sales desc — so the frontend can locally re-sort/slice by qty or by
// bottom-N without another round trip; "topByValue"/"topByQty"/"bottomByValue"/"bottomByQty" are
// backend-limited to TOP_N since raw primary_sales has far more distinct products than is
// reasonable to ship in full — TOP_N is sized to the frontend's largest selectable download range
// (see PrimarySalesPage.js's DOWNLOAD_RANGES), not just the 10 rows the on-screen table shows).
// Scoped to the page's
// Brand pill and SalesDateFilter window — [from, to] default to the current calendar month when
// the filter isn't set, matching PrimarySalesDailyTrendService's default. "vs Last Year"/
// "vs Last Month" shift the whole [from, to] window back a year/month and compare against that
// window's totals; "Contrib" fields are each row's % share of its dimension's total sales (for
// tree sub-categories/products, share of their PARENT's total, not the grand total).
@Service
public class PrimarySalesProductLevelService {

    private static final int TOP_N = 100;
    private static final int TREE_CATEGORY_LIMIT = 10;
    private static final int TREE_PRODUCT_POOL_LIMIT = 300;
    private static final int TREE_PRODUCTS_PER_SUBCATEGORY = 5;
    private static final BigDecimal[] ZERO_PAIR = {BigDecimal.ZERO, BigDecimal.ZERO};

    private final JdbcTemplate jdbcTemplate;
    private final Executor queryExecutor;
    private final SqlDialect dialect;

    public PrimarySalesProductLevelService(JdbcTemplate jdbcTemplate,
                                            @Qualifier("applicationTaskExecutor") TaskExecutor queryExecutor,
                                            SqlDialect dialect) {
        this.jdbcTemplate = jdbcTemplate;
        this.queryExecutor = queryExecutor;
        this.dialect = dialect;
    }

    // CHANGED 2026-08-25: this used to run its ~28 individual JdbcTemplate queries strictly one
    // after another — on a full month's ~190k-row Primary_Sales window that meant 17+ sequential
    // full-date-range scans (each ~150-200ms un-cached, see database/04_indexes.sql's
    // IX_PrimarySales_Date_Covering comment for the complementary index-side fix, not yet applied
    // live), adding up to several real seconds before the Product Snapshot section had anything to
    // show. The 8 top-level branches below share no mutable state and don't depend on each other, so
    // they now run concurrently on the app's shared applicationTaskExecutor (same executor
    // ImportProcessingService already uses for parallel import chunks) instead of blocking this
    // request thread through them one at a time — wall-clock time drops from the SUM of every
    // branch's own queries down to whichever single branch (buildTree, typically) takes longest.
    // Deliberately NOT parallelized any further inside buildDimension/buildTree/loadTopProducts
    // themselves (each already runs on one of these 8 threads) — nesting more supplyAsync+join calls
    // onto the SAME bounded pool from within a task that's already occupying one of its threads risks
    // starving/deadlocking it if every branch tries to fan out at once. Same SQL, same results, same
    // brand/period resolution — purely a wall-clock-time fix, not a behavior change.
    public ProductLevelResponse getProductLevel(LocalDate from, LocalDate to, String brand, String channel, String status) {
        String normalizedBrand = BrandFilter.normalize(brand);
        String brandFilter = BrandFilter.product(normalizedBrand);
        // Channel/Status filtering — Primary_Sales has no Channel/Status column and none of this
        // class's queries join Site_Master; resolveBillToCodesForChannelAndStatus pre-fetches just the
        // Site_Codes this channel/status combo covers, then every query adds "AND ps.Bill_to IN (...)"
        // instead of joining Site_Master directly (a direct join risks fanning a Primary_Sales row out
        // across more than one Site_Master row for the same Site_Code, since Site_Master's real key is
        // (Site_Code, Brand) — an IN-list filter can't double-count a row, a JOIN could). Same approach
        // PrimarySalesDailyTrendService uses for its own identical gap.
        List<String> billToCodes = resolveBillToCodesForChannelAndStatus(ChannelFilter.normalize(channel), status);

        LocalDate periodFrom = from;
        LocalDate periodTo = to;
        if (periodFrom == null || periodTo == null) {
            // Month-to-date by default (1st of the current month through today), not the full
            // calendar month — matches the Overview section's "current month" figure instead of
            // silently including not-yet-elapsed days.
            periodFrom = YearMonth.now().atDay(1);
            periodTo = LocalDate.now();
        } else if (periodFrom.isAfter(periodTo)) {
            LocalDate swap = periodFrom;
            periodFrom = periodTo;
            periodTo = swap;
        }
        // Effectively-final copies for the lambdas below (periodFrom/periodTo themselves may have
        // been reassigned above).
        final LocalDate finalFrom = periodFrom;
        final LocalDate finalTo = periodTo;
        final LocalDate lastYearFrom = periodFrom.minusYears(1);
        final LocalDate lastYearTo = periodTo.minusYears(1);
        final LocalDate lastMonthFrom = periodFrom.minusMonths(1);
        final LocalDate lastMonthTo = periodTo.minusMonths(1);

        CompletableFuture<List<DimensionAggregateRow>> categoryFuture = supplyAsync(() ->
                buildDimension("category", finalFrom, finalTo, lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, brandFilter, billToCodes));
        CompletableFuture<List<DimensionAggregateRow>> subCategoryFuture = supplyAsync(() ->
                buildDimension("sub_category", finalFrom, finalTo, lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, brandFilter, billToCodes));
        CompletableFuture<List<ProductRow>> topByValueFuture = supplyAsync(() ->
                loadTopProducts(finalFrom, finalTo, brandFilter, "SUM(ps.Sales)", false, TOP_N,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, billToCodes));
        CompletableFuture<List<ProductRow>> topByQtyFuture = supplyAsync(() ->
                loadTopProducts(finalFrom, finalTo, brandFilter, "SUM(ps.Qty)", false, TOP_N,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, billToCodes));
        CompletableFuture<List<ProductRow>> bottomByValueFuture = supplyAsync(() ->
                loadTopProducts(finalFrom, finalTo, brandFilter, "SUM(ps.Sales)", true, TOP_N,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, billToCodes));
        CompletableFuture<List<ProductRow>> bottomByQtyFuture = supplyAsync(() ->
                loadTopProducts(finalFrom, finalTo, brandFilter, "SUM(ps.Qty)", true, TOP_N,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, billToCodes));
        CompletableFuture<List<Map<String, Object>>> treeFuture = supplyAsync(() ->
                buildTree(finalFrom, finalTo, lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, brandFilter, billToCodes));
        CompletableFuture<List<BrandQuantityRow>> brandQuantitiesFuture = supplyAsync(() ->
                loadBrandQuantities(finalFrom, finalTo, billToCodes));

        CompletableFuture.allOf(categoryFuture, subCategoryFuture, topByValueFuture, topByQtyFuture,
                bottomByValueFuture, bottomByQtyFuture, treeFuture, brandQuantitiesFuture).join();

        List<CategoryRow> categories = categoryFuture.join().stream()
                .map(r -> new CategoryRow(r.label(), r.salesValue(), r.salesQty(), r.vsLastYearPct(),
                        r.vsLastMonthPct(), r.contribPct(), r.contribDeltaLYPct()))
                .toList();
        List<SubCategoryRow> subCategories = subCategoryFuture.join().stream()
                .map(r -> new SubCategoryRow(r.label(), r.salesValue(), r.salesQty(), r.vsLastYearPct(),
                        r.vsLastMonthPct(), r.contribPct(), r.contribDeltaLYPct()))
                .toList();

        return new ProductLevelResponse(normalizedBrand, new TrendPeriod(finalFrom.toString(), finalTo.toString()),
                categories, subCategories,
                topByValueFuture.join(), topByQtyFuture.join(), bottomByValueFuture.join(), bottomByQtyFuture.join(),
                treeFuture.join(), brandQuantitiesFuture.join());
    }

    private <T> CompletableFuture<T> supplyAsync(java.util.function.Supplier<T> supplier) {
        return CompletableFuture.supplyAsync(supplier, queryExecutor);
    }

    // null = every channel AND every status (no filter of either). Otherwise the real, distinct
    // Site_Codes Site_Master says match whichever of Channel/Status is active among Primary Sales
    // sites — an empty (non-null) list means that combo exists nowhere in Site_Master right now, so
    // every query below correctly contributes zero instead of accidentally matching everything (see
    // appendBillToFilter's own empty-list handling).
    private List<String> resolveBillToCodesForChannelAndStatus(String channelFilter, String status) {
        String statusClause = OperationalStatusFilter.whereClause(status);
        if (channelFilter == null && statusClause.isEmpty()) {
            return null;
        }
        StringBuilder sql = new StringBuilder("SELECT DISTINCT Site_Code FROM Site_Master WHERE Sales_Type = 'Primary Sales' ");
        List<Object> params = new ArrayList<>();
        if (channelFilter != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(?) ");
            params.add(channelFilter);
        }
        sql.append(statusClause);
        return jdbcTemplate.queryForList(sql.toString(), String.class, params.toArray());
    }

    // Appends "AND ps.Bill_to IN (...)" when billToCodes is non-null — an empty list still appends a
    // clause that always evaluates false (1 = 0) rather than an invalid empty IN(), so "channel
    // exists in Site_Master but has zero Primary Sales sites" correctly yields zero rows instead of
    // silently falling through to "no filter at all".
    private void appendBillToFilter(StringBuilder sql, List<Object> params, List<String> billToCodes) {
        if (billToCodes == null) {
            return;
        }
        if (billToCodes.isEmpty()) {
            sql.append("AND 1 = 0 ");
            return;
        }
        sql.append("AND ps.Bill_to IN (")
                .append(billToCodes.stream().map(c -> "?").collect(Collectors.joining(",")))
                .append(") ");
        params.addAll(billToCodes);
    }

    // Real distinct Site_Master.Brand values — the EXACT same source/semantics the Overview
    // Insights card's own Brand pill uses (see PrimarySalesTodayService.getAvailableBrands, same
    // case-insensitive dedup/sort convention), per explicit request so "which brands exist right
    // now" is answered identically everywhere in the app (Brand pill, Projection Form toggle, and
    // this Qty badge all agree), rather than this badge deriving its own separate answer from
    // Product_Master. Scoped to Sales_Type = 'Primary Sales' (same convention as
    // PrimarySalesReportsService.loadSiteRows/loadPrimarySaleSiteMasterInfo) so this page never
    // pulls in a brand that only exists on Secondary Sales sites.
    private List<String> loadAvailableBrandsFromSiteMaster() {
        String sql = "SELECT DISTINCT Brand FROM Site_Master WHERE Brand IS NOT NULL AND LTRIM(RTRIM(Brand)) <> '' " +
                "AND Sales_Type = 'Primary Sales'";
        java.util.Set<String> brands = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String brand : jdbcTemplate.queryForList(sql, String.class)) {
            brands.add(brand.trim());
        }
        return new ArrayList<>(brands);
    }

    // Real total Qty per brand for [from, to], scoped to whatever Site_Master currently says is
    // "available" (loadAvailableBrandsFromSiteMaster above) — regardless of this request's own
    // brand filter: the Product Snapshot header's "top brand by quantity" strip is a cross-brand
    // comparison by definition, so it can't be scoped to whichever single brand the page happens to
    // be filtered to. Each Site_Master brand is mapped to Product_Master's own vocabulary via
    // BrandFilter#product to actually sum its real Qty (see BrandFilter's own header comment on why
    // these two tables' Brand columns need separate vocabularies) — a Site_Master brand
    // BrandFilter doesn't recognize (anything beyond today's only two wired-up brands, ABH/Kylie)
    // has no reliable Product_Master match and is skipped rather than guessed at. An empty return
    // (Site_Master has no Brand data at all) is what drives the frontend's "Not Available" state
    // (see renderQtyHeaderBadge in PrimarySalesPage.js), same convention the Brand pill's own empty
    // state already uses. Sorted highest Qty first (ties keep Site_Master's own row order).
    // Maps a real Site_Master.Brand value ("Anastasia Beverly hills", "Kylie Cosmetics") to the short
    // code BrandFilter.VALID_BRANDS/BrandFilter#product actually accept ("abh"/"kylie") — same
    // conversion PrimarySalesPage.js's own brandNameToCode already does client-side. Falls back to
    // the lowercased value for any brand outside this known pair (matches BrandFilter's own
    // only-2-known-codes limitation).
    private static String siteBrandToCode(String siteBrand) {
        String normalized = siteBrand.trim().toLowerCase(java.util.Locale.ROOT);
        if (normalized.equals("anastasia beverly hills")) {
            return "abh";
        }
        if (normalized.equals("kylie cosmetics")) {
            return "kylie";
        }
        return normalized;
    }

    private List<BrandQuantityRow> loadBrandQuantities(
            LocalDate from, LocalDate to, List<String> billToCodes) {
        List<String> siteBrands = loadAvailableBrandsFromSiteMaster();
        if (siteBrands.isEmpty()) {
            return List.of();
        }

        // FIXED 2026-09-07: real bug — this used to lowercase the site_master Brand's own FULL name
        // ("anastasia beverly hills") and check that literal string against
        // BrandFilter.VALID_BRANDS, which only ever contains the short codes ("all"/"abh"/"kylie").
        // A full name can never match a short code, so this `continue` fired for every real brand,
        // every time — productBrandBySiteBrand (and so this whole Qty badge) was permanently empty,
        // regardless of real data. Now converts the full name to its short code first (siteBrandToCode
        // above), the same real classification VALID_BRANDS/BrandFilter#product actually expect.
        Map<String, String> productBrandBySiteBrand = new LinkedHashMap<>();
        for (String siteBrand : siteBrands) {
            String code = siteBrandToCode(siteBrand);
            if (!BrandFilter.VALID_BRANDS.contains(code)) {
                continue;
            }
            String productBrand = BrandFilter.product(code);
            if (productBrand != null) {
                productBrandBySiteBrand.put(siteBrand, productBrand);
            }
        }
        if (productBrandBySiteBrand.isEmpty()) {
            return List.of();
        }

        List<String> productBrands = new ArrayList<>(productBrandBySiteBrand.values());
        String placeholders = String.join(",", productBrands.stream().map(b -> "?").toList());
        StringBuilder sql = new StringBuilder("SELECT p.Brand, SUM(ps.Qty) AS qty FROM Primary_Sales ps " +
                "JOIN Product_Master p ON p.Article_Code = ps.Article_Code " +
                "WHERE ps.Sales_Date BETWEEN ? AND ? AND p.Brand IN (" + placeholders + ") ");
        List<Object> params = new ArrayList<>();
        params.add(from);
        params.add(to);
        params.addAll(productBrands);
        appendBillToFilter(sql, params, billToCodes);
        sql.append("GROUP BY p.Brand");
        Map<String, BigDecimal> qtyByProductBrand = new java.util.HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            Object qty = row.get("qty");
            qtyByProductBrand.put((String) row.get("Brand"), qty instanceof BigDecimal bd ? bd : BigDecimal.ZERO);
        }

        List<BrandQuantityRow> rows = new ArrayList<>();
        productBrandBySiteBrand.forEach((siteBrand, productBrand) -> rows.add(new BrandQuantityRow(
                siteBrand.toLowerCase(java.util.Locale.ROOT), siteBrand,
                qtyByProductBrand.getOrDefault(productBrand, BigDecimal.ZERO))));
        rows.sort((a, b) -> b.qty().compareTo(a.qty()));
        return rows;
    }

    // Internal shape shared by the category/sub-category rankings below — getProductLevel wraps each
    // into the correctly-named public CategoryRow/SubCategoryRow.
    private record DimensionAggregateRow(String label, BigDecimal salesValue, BigDecimal salesQty,
                                          BigDecimal vsLastYearPct, BigDecimal vsLastMonthPct, BigDecimal contribPct,
                                          BigDecimal contribDeltaLYPct) {
    }

    // dimensionColumn is always a fixed literal ("category" or "sub_category"), never user input.
    private List<DimensionAggregateRow> buildDimension(String dimensionColumn, LocalDate from, LocalDate to,
                                                         LocalDate lastYearFrom, LocalDate lastYearTo,
                                                         LocalDate lastMonthFrom, LocalDate lastMonthTo,
                                                         String brand, List<String> billToCodes) {
        Map<String, BigDecimal> current = dimensionAggregate(dimensionColumn, from, to, brand, "SUM(ps.Sales)", billToCodes);
        Map<String, BigDecimal> currentQty = dimensionAggregate(dimensionColumn, from, to, brand, "SUM(ps.Qty)", billToCodes);
        Map<String, BigDecimal> lastYear = dimensionAggregate(dimensionColumn, lastYearFrom, lastYearTo, brand, "SUM(ps.Sales)", billToCodes);
        Map<String, BigDecimal> lastMonth = dimensionAggregate(dimensionColumn, lastMonthFrom, lastMonthTo, brand, "SUM(ps.Sales)", billToCodes);

        BigDecimal totalCurrent = current.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalLastYear = lastYear.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);

        List<Map.Entry<String, BigDecimal>> sorted = new ArrayList<>(current.entrySet());
        sorted.sort((a, b) -> b.getValue().compareTo(a.getValue()));

        List<DimensionAggregateRow> rows = new ArrayList<>();
        for (Map.Entry<String, BigDecimal> entry : sorted) {
            String label = entry.getKey();
            BigDecimal salesValue = entry.getValue();
            BigDecimal previousYear = lastYear.getOrDefault(label, BigDecimal.ZERO);
            BigDecimal previousMonth = lastMonth.getOrDefault(label, BigDecimal.ZERO);
            BigDecimal contribPct = percentOf(salesValue, totalCurrent);
            BigDecimal contribLYPct = percentOf(previousYear, totalLastYear);

            rows.add(new DimensionAggregateRow(label, salesValue.setScale(2, RoundingMode.HALF_UP),
                    currentQty.getOrDefault(label, BigDecimal.ZERO), GrowthMath.growthPct(salesValue, previousYear),
                    GrowthMath.growthPct(salesValue, previousMonth), contribPct,
                    (contribPct != null && contribLYPct != null)
                            ? contribPct.subtract(contribLYPct).setScale(2, RoundingMode.HALF_UP) : null));
        }
        return rows;
    }

    private Map<String, BigDecimal> dimensionAggregate(String dimensionColumn, LocalDate from, LocalDate to,
                                                         String brand, String aggregateExpr, List<String> billToCodes) {
        String dbColumn = "sub_category".equals(dimensionColumn) ? "SubCategory" : "Category";
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT COALESCE(p." + dbColumn + ", 'Uncategorized') AS label, " + aggregateExpr + " AS total " +
                        "FROM Primary_Sales ps LEFT JOIN Product_Master p ON p.Article_Code = ps.Article_Code " +
                        "WHERE ps.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendBillToFilter(sql, params, billToCodes);
        sql.append("GROUP BY COALESCE(p.").append(dbColumn).append(", 'Uncategorized')");

        Map<String, BigDecimal> totals = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put((String) row.get("label"), asDecimal(row.get("total")));
        }
        return totals;
    }

    // Same (category, sub_category) grouping as dimensionAggregate but on the composite key, for
    // the tree. Returns label -> [salesValue, salesQty]. Keys are joined with a NUL separator
    // (never appears in real category/sub-category text) instead of a custom record, to stay
    // consistent with this file's existing String-keyed-map style.
    private Map<String, BigDecimal[]> categorySubcategorySalesQty(LocalDate from, LocalDate to, String brand, List<String> billToCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT COALESCE(p.Category, 'Uncategorized') AS category, COALESCE(p.SubCategory, 'Uncategorized') AS subCategory, " +
                        "SUM(ps.Sales) AS salesValue, SUM(ps.Qty) AS salesQty " +
                        "FROM Primary_Sales ps LEFT JOIN Product_Master p ON p.Article_Code = ps.Article_Code " +
                        "WHERE ps.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendBillToFilter(sql, params, billToCodes);
        sql.append("GROUP BY COALESCE(p.Category, 'Uncategorized'), COALESCE(p.SubCategory, 'Uncategorized')");

        Map<String, BigDecimal[]> totals = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            String key = combineKey((String) row.get("category"), (String) row.get("subCategory"));
            totals.put(key, new BigDecimal[]{asDecimal(row.get("salesValue")), asDecimal(row.get("salesQty"))});
        }
        return totals;
    }

    // Plain string concatenation with a delimiter that won't appear in real category/sub-category
    // text, used as a composite map key (split back apart via splitKey below) instead of a custom
    // record, to stay consistent with this file's existing String-keyed-map style.
    private static final String KEY_SEPARATOR = "###";

    private static String combineKey(String category, String subCategory) {
        return category + KEY_SEPARATOR + subCategory;
    }

    private static String[] splitKey(String key) {
        int idx = key.indexOf(KEY_SEPARATOR);
        return new String[]{key.substring(0, idx), key.substring(idx + KEY_SEPARATOR.length())};
    }

    // Real Category -> Sub-category -> Product nesting (top 10 categories by sales; each with all
    // its real sub-categories; each sub-category with its top 5 products) for the top full-width
    // panel. Every level's figures (sales/qty/vs LY/vs LM/contribution) are real, computed from the
    // same primary_sales+products join as the rest of this service.
    private List<Map<String, Object>> buildTree(LocalDate from, LocalDate to, LocalDate lastYearFrom, LocalDate lastYearTo,
                                                  LocalDate lastMonthFrom, LocalDate lastMonthTo, String brand,
                                                  List<String> billToCodes) {
        // CHANGED 2026-08-25: measured live as the slowest of getProductLevel's 8 parallel branches
        // (and therefore the actual critical path for the whole Product Snapshot request) precisely
        // because it used to run these 4 independent queries — 3x categorySubcategorySalesQty plus
        // the product pool below — strictly one after another inside a single branch. Parallelized
        // here on the JDK's default common pool, deliberately NOT queryExecutor: this method is
        // already running ON one of queryExecutor's own threads (it's one of getProductLevel's 8
        // branches), so submitting more work back onto that same bounded pool and blocking on it
        // would risk starving/deadlocking it if every branch tried to fan out at once (see
        // getProductLevel's own comment on why the outer fan-out stops at one level).
        CompletableFuture<Map<String, BigDecimal[]>> currentFuture =
                CompletableFuture.supplyAsync(() -> categorySubcategorySalesQty(from, to, brand, billToCodes));
        CompletableFuture<Map<String, BigDecimal[]>> lastYearFuture =
                CompletableFuture.supplyAsync(() -> categorySubcategorySalesQty(lastYearFrom, lastYearTo, brand, billToCodes));
        CompletableFuture<Map<String, BigDecimal[]>> lastMonthFuture =
                CompletableFuture.supplyAsync(() -> categorySubcategorySalesQty(lastMonthFrom, lastMonthTo, brand, billToCodes));
        CompletableFuture<List<ProductRow>> productPoolFuture = CompletableFuture.supplyAsync(() ->
                loadTopProducts(from, to, brand, "SUM(ps.Sales)", false, TREE_PRODUCT_POOL_LIMIT,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, billToCodes));
        CompletableFuture.allOf(currentFuture, lastYearFuture, lastMonthFuture, productPoolFuture).join();
        Map<String, BigDecimal[]> current = currentFuture.join();
        Map<String, BigDecimal[]> lastYear = lastYearFuture.join();
        Map<String, BigDecimal[]> lastMonth = lastMonthFuture.join();

        Map<String, List<String>> keysByCategory = new LinkedHashMap<>();
        for (String key : current.keySet()) {
            String category = splitKey(key)[0];
            keysByCategory.computeIfAbsent(category, c -> new ArrayList<>()).add(key);
        }

        Map<String, BigDecimal> categoryTotals = new LinkedHashMap<>();
        Map<String, BigDecimal> categoryQtyTotals = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> e : keysByCategory.entrySet()) {
            BigDecimal sum = e.getValue().stream().map(k -> current.get(k)[0]).reduce(BigDecimal.ZERO, BigDecimal::add);
            categoryTotals.put(e.getKey(), sum);
            BigDecimal qtySum = e.getValue().stream().map(k -> current.get(k)[1]).reduce(BigDecimal.ZERO, BigDecimal::add);
            categoryQtyTotals.put(e.getKey(), qtySum);
        }
        BigDecimal grandTotal = categoryTotals.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        // Denominator for every category's contribDeltaLYPct below — the SAME-shaped total as
        // grandTotal above, just for last year's window instead of the current one. Summed across
        // every category/sub-category combo lastYear has (categorySubcategorySalesQty above is not
        // limited to TREE_CATEGORY_LIMIT), matching how buildDimension's own contribLYPct is scoped.
        BigDecimal grandTotalLastYear = lastYear.values().stream().map(v -> v[0]).reduce(BigDecimal.ZERO, BigDecimal::add);

        List<String> orderedCategories = categoryTotals.entrySet().stream()
                .sorted((a, b) -> b.getValue().compareTo(a.getValue()))
                .map(Map.Entry::getKey)
                .limit(TREE_CATEGORY_LIMIT)
                .toList();

        List<ProductRow> productPool = productPoolFuture.join();
        Map<String, List<ProductRow>> productsBySubKey = new LinkedHashMap<>();
        for (ProductRow product : productPool) {
            String key = combineKey(product.category(), product.subCategory());
            productsBySubKey.computeIfAbsent(key, k -> new ArrayList<>()).add(product);
        }
        // Per-product LY sales, needed only for each product's own contribDeltaLYPct below (its
        // vsLastYearPct growth % alone doesn't recover the absolute LY value) — one extra query,
        // scoped to just the article codes already in the pool, same helper loadTopProducts uses
        // for its own vsLastYearPct/vsLastMonthPct.
        Map<String, BigDecimal> productPoolLastYearSales = articleCodeSales(lastYearFrom, lastYearTo, brand,
                productPool.stream().map(ProductRow::articleCode).toList(), billToCodes);

        List<Map<String, Object>> tree = new ArrayList<>();
        int categoryIndex = 1;
        for (String category : orderedCategories) {
            List<String> subKeys = new ArrayList<>(keysByCategory.get(category));
            subKeys.sort((a, b) -> current.get(b)[0].compareTo(current.get(a)[0]));

            BigDecimal categorySales = categoryTotals.get(category);
            BigDecimal categoryLYSales = subKeys.stream().map(k -> lastYear.getOrDefault(k, ZERO_PAIR)[0]).reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal categoryLMSales = subKeys.stream().map(k -> lastMonth.getOrDefault(k, ZERO_PAIR)[0]).reduce(BigDecimal.ZERO, BigDecimal::add);

            List<Map<String, Object>> subRows = new ArrayList<>();
            int subIndex = 1;
            for (String key : subKeys) {
                String subCategory = splitKey(key)[1];
                BigDecimal[] cur = current.get(key);
                BigDecimal[] ly = lastYear.getOrDefault(key, ZERO_PAIR);
                BigDecimal[] lm = lastMonth.getOrDefault(key, ZERO_PAIR);

                // Each product's contribDeltaLYPct is its own contribution % of this sub-category's
                // CURRENT sales, minus its contribution % of this sub-category's LAST YEAR sales
                // (ly[0]) — same "share of parent, not grand total" convention contribPct itself
                // already follows for tree rows (see this method's header comment).
                List<Map<String, Object>> products = productsBySubKey.getOrDefault(key, List.of()).stream()
                        .limit(TREE_PRODUCTS_PER_SUBCATEGORY)
                        .map(p -> {
                            BigDecimal productContribPct = percentOf(p.salesValue(), cur[0]);
                            BigDecimal productContribLYPct = percentOf(
                                    productPoolLastYearSales.getOrDefault(p.articleCode(), BigDecimal.ZERO), ly[0]);
                            return productRowToTreeMap(p, productContribPct,
                                    contribDelta(productContribPct, productContribLYPct));
                        })
                        .toList();

                BigDecimal subContribPct = percentOf(cur[0], categorySales);
                BigDecimal subContribLYPct = percentOf(ly[0], categoryLYSales);

                Map<String, Object> subRow = new LinkedHashMap<>();
                subRow.put("name", subCategory);
                subRow.put("index", subIndex++);
                subRow.put("salesValue", cur[0].setScale(2, RoundingMode.HALF_UP));
                subRow.put("salesQty", cur[1]);
                subRow.put("vsLastYearPct", GrowthMath.growthPct(cur[0], ly[0]));
                subRow.put("vsLastMonthPct", GrowthMath.growthPct(cur[0], lm[0]));
                subRow.put("contribPct", subContribPct);
                subRow.put("contribDeltaLYPct", contribDelta(subContribPct, subContribLYPct));
                subRow.put("products", products);
                subRows.add(subRow);
            }

            BigDecimal categoryContribPct = percentOf(categorySales, grandTotal);
            BigDecimal categoryContribLYPct = percentOf(categoryLYSales, grandTotalLastYear);

            Map<String, Object> categoryRow = new LinkedHashMap<>();
            categoryRow.put("name", category);
            categoryRow.put("index", categoryIndex++);
            categoryRow.put("salesValue", categorySales.setScale(2, RoundingMode.HALF_UP));
            categoryRow.put("salesQty", categoryQtyTotals.get(category));
            categoryRow.put("vsLastYearPct", GrowthMath.growthPct(categorySales, categoryLYSales));
            categoryRow.put("vsLastMonthPct", GrowthMath.growthPct(categorySales, categoryLMSales));
            categoryRow.put("contribPct", categoryContribPct);
            categoryRow.put("contribDeltaLYPct", contribDelta(categoryContribPct, categoryContribLYPct));
            categoryRow.put("subCategories", subRows);
            tree.add(categoryRow);
        }

        return tree;
    }

    // The tree stays plain maps (see ProductLevelResponse's javadoc), so a ProductRow nested inside
    // it — reused from the same pool loadTopProducts() builds for the flat top/bottom lists — is
    // converted here, with contribPct/contribDeltaLYPct recomputed against its parent sub-category's
    // own current/last-year sales (not the pool's total, which is what ProductRow.contribPct() from
    // loadTopProducts() itself means).
    private Map<String, Object> productRowToTreeMap(ProductRow p, BigDecimal contribPct, BigDecimal contribDeltaLYPct) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("index", p.index());
        map.put("articleCode", p.articleCode());
        map.put("description", p.description());
        map.put("category", p.category());
        map.put("subCategory", p.subCategory());
        map.put("ean", p.ean());
        map.put("hsn", p.hsn());
        map.put("tax", p.tax());
        map.put("salesValue", p.salesValue());
        map.put("salesQty", p.salesQty());
        map.put("vsLastYearPct", p.vsLastYearPct());
        map.put("vsLastMonthPct", p.vsLastMonthPct());
        map.put("contribPct", contribPct);
        map.put("contribDeltaLYPct", contribDeltaLYPct);
        return map;
    }

    // Percentage-point difference between this year's and last year's contribution share — null,
    // not zero, whenever either side is unknown (e.g. no sales at all in one of the two windows),
    // same convention buildDimension's own contribLYPct delta already follows.
    private static BigDecimal contribDelta(BigDecimal contribPct, BigDecimal contribLYPct) {
        return (contribPct != null && contribLYPct != null)
                ? contribPct.subtract(contribLYPct).setScale(2, RoundingMode.HALF_UP) : null;
    }

    // orderColumn is always a fixed literal ("SUM(ps.Sales)" or "SUM(ps.Qty)"), never user input.
    // Loads the top/bottom `limit` products by orderColumn, then tags each with real vs-Last-Year/
    // vs-Last-Month growth and its contribution % (share of this result set's own total sales) —
    // via one extra IN(...) query scoped to just these `limit` article codes, not a full-table scan.
    private List<ProductRow> loadTopProducts(LocalDate from, LocalDate to, String brand, String orderColumn,
                                              boolean ascending, int limit,
                                              LocalDate lastYearFrom, LocalDate lastYearTo,
                                              LocalDate lastMonthFrom, LocalDate lastMonthTo,
                                              List<String> billToCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT " + dialect.topPrefix(limit) + "ps.Article_Code AS articleCode, " +
                        "MAX(p.Description) AS description, " +
                        "MAX(COALESCE(p.Category, 'Uncategorized')) AS category, " +
                        "MAX(COALESCE(p.SubCategory, 'Uncategorized')) AS subCategory, " +
                        "MAX(p.EAN) AS ean, MAX(p.HSN) AS hsn, MAX(p.Tax) AS tax, " +
                        "SUM(ps.Sales) AS salesValue, SUM(ps.Qty) AS salesQty " +
                        "FROM Primary_Sales ps LEFT JOIN Product_Master p ON p.Article_Code = ps.Article_Code " +
                        "WHERE ps.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendBillToFilter(sql, params, billToCodes);
        sql.append("GROUP BY ps.Article_Code ORDER BY ").append(orderColumn).append(ascending ? " ASC" : " DESC")
                .append(dialect.limitSuffix(limit));

        List<Map<String, Object>> rawRows = jdbcTemplate.queryForList(sql.toString(), params.toArray());
        if (rawRows.isEmpty()) {
            return List.of();
        }

        List<String> articleCodes = rawRows.stream().map(r -> (String) r.get("articleCode")).toList();
        Map<String, BigDecimal> lastYearSales = articleCodeSales(lastYearFrom, lastYearTo, brand, articleCodes, billToCodes);
        Map<String, BigDecimal> lastMonthSales = articleCodeSales(lastMonthFrom, lastMonthTo, brand, articleCodes, billToCodes);
        BigDecimal totalSales = rawRows.stream().map(r -> asDecimal(r.get("salesValue"))).reduce(BigDecimal.ZERO, BigDecimal::add);

        List<ProductRow> products = new ArrayList<>();
        int index = 1;
        for (Map<String, Object> row : rawRows) {
            String articleCode = (String) row.get("articleCode");
            BigDecimal salesValue = asDecimal(row.get("salesValue"));
            BigDecimal ly = lastYearSales.getOrDefault(articleCode, BigDecimal.ZERO);
            BigDecimal lm = lastMonthSales.getOrDefault(articleCode, BigDecimal.ZERO);

            products.add(new ProductRow(index++, articleCode, (String) row.get("description"),
                    (String) row.get("category"), (String) row.get("subCategory"), (String) row.get("ean"),
                    (String) row.get("hsn"), (BigDecimal) row.get("tax"), salesValue.setScale(2, RoundingMode.HALF_UP),
                    asDecimal(row.get("salesQty")), GrowthMath.growthPct(salesValue, ly),
                    GrowthMath.growthPct(salesValue, lm), percentOf(salesValue, totalSales)));
        }
        return products;
    }

    private Map<String, BigDecimal> articleCodeSales(LocalDate from, LocalDate to, String brand, List<String> articleCodes,
                                                       List<String> billToCodes) {
        if (articleCodes.isEmpty()) {
            return Map.of();
        }
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT ps.Article_Code AS articleCode, SUM(ps.Sales) AS salesValue FROM Primary_Sales ps ");
        if (brand != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ps.Article_Code ");
        }
        sql.append("WHERE ps.Sales_Date BETWEEN ? AND ? AND ps.Article_Code IN (")
                .append(articleCodes.stream().map(c -> "?").collect(Collectors.joining(","))).append(") ");
        params.addAll(articleCodes);
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendBillToFilter(sql, params, billToCodes);
        sql.append("GROUP BY ps.Article_Code");

        Map<String, BigDecimal> totals = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put((String) row.get("articleCode"), asDecimal(row.get("salesValue")));
        }
        return totals;
    }

    private static BigDecimal percentOf(BigDecimal numerator, BigDecimal denominator) {
        if (denominator == null || denominator.compareTo(BigDecimal.ZERO) == 0) {
            return null;
        }
        return numerator.divide(denominator, 6, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100))
                .setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }
}
