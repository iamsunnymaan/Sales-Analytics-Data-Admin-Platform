package com.houseofbeauty.service.secondarysales;

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

// Backs the Secondary Sales page's own "3. Product Snapshot" section — a scoped copy of
// PrimarySalesProductLevelService's logic/SQL (same shape: Category -> Sub-category -> Product tree,
// Product Ranking panel, Product Research modal), per explicit request to reuse that page's Product
// Snapshot implementation rather than designing a separate one. Reads ONLY Secondary_Sales (never
// Primary_Sales) joined to Product_Master on Article_Code, and Site_Master scoped to
// Sales_Type = 'Secondary Sales' (never 'Primary Sales') for the brand-quantity badge/available-brand
// list/Channel filter — strict data isolation from Primary Sales, per explicit request (contrast with
// DashboardProductLevelService's own copy, which deliberately DOES combine both tables). Reuses the
// same generic response DTOs Primary/Dashboard already use (they're plain data shapes, not
// page-styled UI) — only this service class itself is duplicated, matching this codebase's own
// convention of each page keeping its own copy of page-facing logic.
@Service
public class SecondarySalesProductLevelService {

    private static final int TOP_N = 100;
    private static final int TREE_CATEGORY_LIMIT = 10;
    private static final int TREE_PRODUCT_POOL_LIMIT = 300;
    private static final int TREE_PRODUCTS_PER_SUBCATEGORY = 5;
    private static final BigDecimal[] ZERO_PAIR = {BigDecimal.ZERO, BigDecimal.ZERO};

    private final JdbcTemplate jdbcTemplate;
    private final Executor queryExecutor;
    private final SqlDialect dialect;

    public SecondarySalesProductLevelService(JdbcTemplate jdbcTemplate,
                                              @Qualifier("applicationTaskExecutor") TaskExecutor queryExecutor,
                                              SqlDialect dialect) {
        this.jdbcTemplate = jdbcTemplate;
        this.queryExecutor = queryExecutor;
        this.dialect = dialect;
    }

    public ProductLevelResponse getProductLevel(LocalDate from, LocalDate to, String brand, String channel, String status) {
        String normalizedBrand = BrandFilter.normalize(brand);
        String brandFilter = BrandFilter.product(normalizedBrand);
        // Channel/Status filtering — Secondary_Sales has a DIRECT Site_Code column (no Bill_to-style
        // indirection Primary needs), so resolveSiteCodesForChannelAndStatus pre-fetches just the
        // Site_Codes this channel/status combo covers, then every query adds
        // "AND ss.Site_Code IN (...)" instead of joining Site_Master directly (a direct join risks
        // fanning a Secondary_Sales row out across more than one Site_Master row for the same
        // Site_Code, since Site_Master's real key is (Site_Code, Brand) — an IN-list filter can't
        // double-count a row, a JOIN could). Mirrors PrimarySalesProductLevelService's own version.
        List<String> siteCodes = resolveSiteCodesForChannelAndStatus(ChannelFilter.normalize(channel), status);

        LocalDate periodFrom = from;
        LocalDate periodTo = to;
        if (periodFrom == null || periodTo == null) {
            periodFrom = YearMonth.now().atDay(1);
            periodTo = LocalDate.now();
        } else if (periodFrom.isAfter(periodTo)) {
            LocalDate swap = periodFrom;
            periodFrom = periodTo;
            periodTo = swap;
        }
        final LocalDate finalFrom = periodFrom;
        final LocalDate finalTo = periodTo;
        final LocalDate lastYearFrom = periodFrom.minusYears(1);
        final LocalDate lastYearTo = periodTo.minusYears(1);
        final LocalDate lastMonthFrom = periodFrom.minusMonths(1);
        final LocalDate lastMonthTo = periodTo.minusMonths(1);

        CompletableFuture<List<DimensionAggregateRow>> categoryFuture = supplyAsync(() ->
                buildDimension("category", finalFrom, finalTo, lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, brandFilter, siteCodes));
        CompletableFuture<List<DimensionAggregateRow>> subCategoryFuture = supplyAsync(() ->
                buildDimension("sub_category", finalFrom, finalTo, lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, brandFilter, siteCodes));
        CompletableFuture<List<ProductRow>> topByValueFuture = supplyAsync(() ->
                loadTopProducts(finalFrom, finalTo, brandFilter, "SUM(ss.Sales)", false, TOP_N,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, siteCodes));
        CompletableFuture<List<ProductRow>> topByQtyFuture = supplyAsync(() ->
                loadTopProducts(finalFrom, finalTo, brandFilter, "SUM(ss.Qty)", false, TOP_N,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, siteCodes));
        CompletableFuture<List<ProductRow>> bottomByValueFuture = supplyAsync(() ->
                loadTopProducts(finalFrom, finalTo, brandFilter, "SUM(ss.Sales)", true, TOP_N,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, siteCodes));
        CompletableFuture<List<ProductRow>> bottomByQtyFuture = supplyAsync(() ->
                loadTopProducts(finalFrom, finalTo, brandFilter, "SUM(ss.Qty)", true, TOP_N,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, siteCodes));
        CompletableFuture<List<Map<String, Object>>> treeFuture = supplyAsync(() ->
                buildTree(finalFrom, finalTo, lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, brandFilter, siteCodes));
        CompletableFuture<List<BrandQuantityRow>> brandQuantitiesFuture = supplyAsync(() ->
                loadBrandQuantities(finalFrom, finalTo, siteCodes));

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

    // null = every channel/status (no filter). Otherwise the real, distinct Site_Codes Site_Master
    // says carry this Channel/Status combo among Secondary Sales sites — an empty (non-null) list
    // means the combo exists nowhere in Site_Master right now, so every query below correctly
    // contributes zero instead of accidentally matching everything (see appendSiteCodeFilter's own
    // empty-list handling).
    private List<String> resolveSiteCodesForChannelAndStatus(String channelFilter, String status) {
        String statusClause = OperationalStatusFilter.whereClause(status);
        if (channelFilter == null && statusClause.isEmpty()) {
            return null;
        }
        StringBuilder sql = new StringBuilder("SELECT DISTINCT Site_Code FROM Site_Master WHERE Sales_Type = 'Secondary Sales' ");
        List<Object> params = new ArrayList<>();
        if (channelFilter != null) {
            sql.append("AND LOWER(LTRIM(RTRIM(Channel))) = LOWER(?) ");
            params.add(channelFilter);
        }
        sql.append(statusClause);
        return jdbcTemplate.queryForList(sql.toString(), String.class, params.toArray());
    }

    // Appends "AND ss.Site_Code IN (...)" when siteCodes is non-null — an empty list still appends a
    // clause that always evaluates false (1 = 0) rather than an invalid empty IN(), so "channel
    // exists in Site_Master but has zero Secondary Sales sites" correctly yields zero rows instead of
    // silently falling through to "no filter at all".
    private void appendSiteCodeFilter(StringBuilder sql, List<Object> params, List<String> siteCodes) {
        if (siteCodes == null) {
            return;
        }
        if (siteCodes.isEmpty()) {
            sql.append("AND 1 = 0 ");
            return;
        }
        sql.append("AND ss.Site_Code IN (")
                .append(siteCodes.stream().map(c -> "?").collect(Collectors.joining(",")))
                .append(") ");
        params.addAll(siteCodes);
    }

    // Scoped to Sales_Type = 'Secondary Sales' — strict data isolation from Primary Sales, per
    // explicit request — so this never pulls in a brand that only exists on Primary Sales sites.
    private List<String> loadAvailableBrandsFromSiteMaster() {
        String sql = "SELECT DISTINCT Brand FROM Site_Master WHERE Brand IS NOT NULL AND LTRIM(RTRIM(Brand)) <> '' " +
                "AND Sales_Type = 'Secondary Sales'";
        java.util.Set<String> brands = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String brand : jdbcTemplate.queryForList(sql, String.class)) {
            brands.add(brand.trim());
        }
        return new ArrayList<>(brands);
    }

    // Maps a real Site_Master.Brand value ("Anastasia Beverly hills", "Kylie Cosmetics") to the short
    // code BrandFilter.VALID_BRANDS/BrandFilter#product actually accept ("abh"/"kylie").
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

    private List<BrandQuantityRow> loadBrandQuantities(LocalDate from, LocalDate to, List<String> siteCodes) {
        List<String> siteBrands = loadAvailableBrandsFromSiteMaster();
        if (siteBrands.isEmpty()) {
            return List.of();
        }

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
        StringBuilder sql = new StringBuilder("SELECT p.Brand, SUM(ss.Qty) AS qty FROM Secondary_Sales ss " +
                "JOIN Product_Master p ON p.Article_Code = ss.Article_Code " +
                "WHERE ss.Sales_Date BETWEEN ? AND ? AND p.Brand IN (" + placeholders + ") ");
        List<Object> params = new ArrayList<>();
        params.add(from);
        params.add(to);
        params.addAll(productBrands);
        appendSiteCodeFilter(sql, params, siteCodes);
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

    private record DimensionAggregateRow(String label, BigDecimal salesValue, BigDecimal salesQty,
                                          BigDecimal vsLastYearPct, BigDecimal vsLastMonthPct, BigDecimal contribPct,
                                          BigDecimal contribDeltaLYPct) {
    }

    private List<DimensionAggregateRow> buildDimension(String dimensionColumn, LocalDate from, LocalDate to,
                                                         LocalDate lastYearFrom, LocalDate lastYearTo,
                                                         LocalDate lastMonthFrom, LocalDate lastMonthTo,
                                                         String brand, List<String> siteCodes) {
        Map<String, BigDecimal> current = dimensionAggregate(dimensionColumn, from, to, brand, "SUM(ss.Sales)", siteCodes);
        Map<String, BigDecimal> currentQty = dimensionAggregate(dimensionColumn, from, to, brand, "SUM(ss.Qty)", siteCodes);
        Map<String, BigDecimal> lastYear = dimensionAggregate(dimensionColumn, lastYearFrom, lastYearTo, brand, "SUM(ss.Sales)", siteCodes);
        Map<String, BigDecimal> lastMonth = dimensionAggregate(dimensionColumn, lastMonthFrom, lastMonthTo, brand, "SUM(ss.Sales)", siteCodes);

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
                                                         String brand, String aggregateExpr, List<String> siteCodes) {
        String dbColumn = "sub_category".equals(dimensionColumn) ? "SubCategory" : "Category";
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT COALESCE(p." + dbColumn + ", 'Uncategorized') AS label, " + aggregateExpr + " AS total " +
                        "FROM Secondary_Sales ss LEFT JOIN Product_Master p ON p.Article_Code = ss.Article_Code " +
                        "WHERE ss.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendSiteCodeFilter(sql, params, siteCodes);
        sql.append("GROUP BY COALESCE(p.").append(dbColumn).append(", 'Uncategorized')");

        Map<String, BigDecimal> totals = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            totals.put((String) row.get("label"), asDecimal(row.get("total")));
        }
        return totals;
    }

    private Map<String, BigDecimal[]> categorySubcategorySalesQty(LocalDate from, LocalDate to, String brand, List<String> siteCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT COALESCE(p.Category, 'Uncategorized') AS category, COALESCE(p.SubCategory, 'Uncategorized') AS subCategory, " +
                        "SUM(ss.Sales) AS salesValue, SUM(ss.Qty) AS salesQty " +
                        "FROM Secondary_Sales ss LEFT JOIN Product_Master p ON p.Article_Code = ss.Article_Code " +
                        "WHERE ss.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendSiteCodeFilter(sql, params, siteCodes);
        sql.append("GROUP BY COALESCE(p.Category, 'Uncategorized'), COALESCE(p.SubCategory, 'Uncategorized')");

        Map<String, BigDecimal[]> totals = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), params.toArray())) {
            String key = combineKey((String) row.get("category"), (String) row.get("subCategory"));
            totals.put(key, new BigDecimal[]{asDecimal(row.get("salesValue")), asDecimal(row.get("salesQty"))});
        }
        return totals;
    }

    private static final String KEY_SEPARATOR = "###";

    private static String combineKey(String category, String subCategory) {
        return category + KEY_SEPARATOR + subCategory;
    }

    private static String[] splitKey(String key) {
        int idx = key.indexOf(KEY_SEPARATOR);
        return new String[]{key.substring(0, idx), key.substring(idx + KEY_SEPARATOR.length())};
    }

    private List<Map<String, Object>> buildTree(LocalDate from, LocalDate to, LocalDate lastYearFrom, LocalDate lastYearTo,
                                                  LocalDate lastMonthFrom, LocalDate lastMonthTo, String brand,
                                                  List<String> siteCodes) {
        CompletableFuture<Map<String, BigDecimal[]>> currentFuture =
                CompletableFuture.supplyAsync(() -> categorySubcategorySalesQty(from, to, brand, siteCodes));
        CompletableFuture<Map<String, BigDecimal[]>> lastYearFuture =
                CompletableFuture.supplyAsync(() -> categorySubcategorySalesQty(lastYearFrom, lastYearTo, brand, siteCodes));
        CompletableFuture<Map<String, BigDecimal[]>> lastMonthFuture =
                CompletableFuture.supplyAsync(() -> categorySubcategorySalesQty(lastMonthFrom, lastMonthTo, brand, siteCodes));
        CompletableFuture<List<ProductRow>> productPoolFuture = CompletableFuture.supplyAsync(() ->
                loadTopProducts(from, to, brand, "SUM(ss.Sales)", false, TREE_PRODUCT_POOL_LIMIT,
                        lastYearFrom, lastYearTo, lastMonthFrom, lastMonthTo, siteCodes));
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
        Map<String, BigDecimal> productPoolLastYearSales = articleCodeSales(lastYearFrom, lastYearTo, brand,
                productPool.stream().map(ProductRow::articleCode).toList(), siteCodes);

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

    private static BigDecimal contribDelta(BigDecimal contribPct, BigDecimal contribLYPct) {
        return (contribPct != null && contribLYPct != null)
                ? contribPct.subtract(contribLYPct).setScale(2, RoundingMode.HALF_UP) : null;
    }

    private List<ProductRow> loadTopProducts(LocalDate from, LocalDate to, String brand, String orderColumn,
                                              boolean ascending, int limit,
                                              LocalDate lastYearFrom, LocalDate lastYearTo,
                                              LocalDate lastMonthFrom, LocalDate lastMonthTo,
                                              List<String> siteCodes) {
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT " + dialect.topPrefix(limit) + "ss.Article_Code AS articleCode, " +
                        "MAX(p.Description) AS description, " +
                        "MAX(COALESCE(p.Category, 'Uncategorized')) AS category, " +
                        "MAX(COALESCE(p.SubCategory, 'Uncategorized')) AS subCategory, " +
                        "MAX(p.EAN) AS ean, MAX(p.HSN) AS hsn, MAX(p.Tax) AS tax, " +
                        "SUM(ss.Sales) AS salesValue, SUM(ss.Qty) AS salesQty " +
                        "FROM Secondary_Sales ss LEFT JOIN Product_Master p ON p.Article_Code = ss.Article_Code " +
                        "WHERE ss.Sales_Date BETWEEN ? AND ? ");
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendSiteCodeFilter(sql, params, siteCodes);
        sql.append("GROUP BY ss.Article_Code ORDER BY ").append(orderColumn).append(ascending ? " ASC" : " DESC")
                .append(dialect.limitSuffix(limit));

        List<Map<String, Object>> rawRows = jdbcTemplate.queryForList(sql.toString(), params.toArray());
        if (rawRows.isEmpty()) {
            return List.of();
        }

        List<String> articleCodes = rawRows.stream().map(r -> (String) r.get("articleCode")).toList();
        Map<String, BigDecimal> lastYearSales = articleCodeSales(lastYearFrom, lastYearTo, brand, articleCodes, siteCodes);
        Map<String, BigDecimal> lastMonthSales = articleCodeSales(lastMonthFrom, lastMonthTo, brand, articleCodes, siteCodes);
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
                                                       List<String> siteCodes) {
        if (articleCodes.isEmpty()) {
            return Map.of();
        }
        List<Object> params = new ArrayList<>(List.of(from, to));
        StringBuilder sql = new StringBuilder(
                "SELECT ss.Article_Code AS articleCode, SUM(ss.Sales) AS salesValue FROM Secondary_Sales ss ");
        if (brand != null) {
            sql.append("LEFT JOIN Product_Master p ON p.Article_Code = ss.Article_Code ");
        }
        sql.append("WHERE ss.Sales_Date BETWEEN ? AND ? AND ss.Article_Code IN (")
                .append(articleCodes.stream().map(c -> "?").collect(Collectors.joining(","))).append(") ");
        params.addAll(articleCodes);
        if (brand != null) {
            sql.append("AND p.Brand = ? ");
            params.add(brand);
        }
        appendSiteCodeFilter(sql, params, siteCodes);
        sql.append("GROUP BY ss.Article_Code");

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
