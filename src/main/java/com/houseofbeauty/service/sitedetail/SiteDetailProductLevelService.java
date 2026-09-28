package com.houseofbeauty.service.sitedetail;

import com.houseofbeauty.dto.sitedetail.response.ProductLevelResponse;
import com.houseofbeauty.dto.sitedetail.response.RankedRow;
import com.houseofbeauty.dto.sitedetail.response.TrendPeriod;
import com.houseofbeauty.service.common.GrowthMath;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class SiteDetailProductLevelService {

    private final JdbcTemplate jdbcTemplate;

    public SiteDetailProductLevelService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private record ArticleTotal(String code, String description, String category, String subCategory,
                                 String ean, String hsn, BigDecimal tax, BigDecimal sales, BigDecimal qty) {
    }

    private record CatKey(String category, String subCategory) {
    }

    public ProductLevelResponse getProductLevel(String siteCode, String brand, LocalDate from, LocalDate to) {
        LocalDate periodFrom = from;
        LocalDate periodTo = to;
        if (periodFrom == null || periodTo == null) {
            YearMonth currentMonth = YearMonth.now();
            periodFrom = currentMonth.atDay(1);
            periodTo = currentMonth.atEndOfMonth();
        } else if (periodFrom.isAfter(periodTo)) {
            LocalDate swap = periodFrom;
            periodFrom = periodTo;
            periodTo = swap;
        }
        LocalDate lastYearFrom = periodFrom.minusYears(1);
        LocalDate lastYearTo = periodTo.minusYears(1);
        LocalDate lastMonthFrom = periodFrom.minusMonths(1);
        LocalDate lastMonthTo = periodTo.minusMonths(1);

        Map<String, ArticleTotal> current = articleTotalsFor(siteCode, brand, periodFrom, periodTo);
        Map<String, ArticleTotal> lastYear = articleTotalsFor(siteCode, brand, lastYearFrom, lastYearTo);
        Map<String, ArticleTotal> lastMonth = articleTotalsFor(siteCode, brand, lastMonthFrom, lastMonthTo);

        BigDecimal grandTotalSales = current.values().stream()
                .map(ArticleTotal::sales).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal lastYearGrandTotalSales = lastYear.values().stream()
                .map(ArticleTotal::sales).reduce(BigDecimal.ZERO, BigDecimal::add);

        List<RankedRow> products = current.values().stream()
                .map(a -> {
                    ArticleTotal lyArticle = lastYear.get(a.code());
                    ArticleTotal lmArticle = lastMonth.get(a.code());
                    BigDecimal lySales = lyArticle == null ? BigDecimal.ZERO : lyArticle.sales();
                    BigDecimal lmSales = lmArticle == null ? BigDecimal.ZERO : lmArticle.sales();
                    return toRow(a.code(), a.description() == null ? a.code() : a.description(), a.sales(), a.qty(),
                            grandTotalSales, lySales, lmSales, lastYearGrandTotalSales);
                })
                .sorted(Comparator.comparing(RankedRow::sales).reversed())
                .toList();
        List<RankedRow> categories = rankByGroup(current.values(), lastYear.values(), lastMonth.values(),
                ArticleTotal::category, grandTotalSales, lastYearGrandTotalSales);
        List<RankedRow> subCategories = rankByGroup(current.values(), lastYear.values(), lastMonth.values(),
                ArticleTotal::subCategory, grandTotalSales, lastYearGrandTotalSales);
        List<Map<String, Object>> tree = buildResearchTree(current, lastYear, lastMonth);

        return new ProductLevelResponse(new TrendPeriod(periodFrom.toString(), periodTo.toString()),
                products, categories, subCategories, tree);
    }

    private Map<String, ArticleTotal> articleTotalsFor(String siteCode, String brand, LocalDate from, LocalDate to) {
        Map<String, ArticleTotal> byArticle = new LinkedHashMap<>();
        mergeArticleTotals(byArticle, "Primary_Sales", "Bill_to", siteCode, brand, from, to);
        mergeArticleTotals(byArticle, "Secondary_Sales", "Site_Code", siteCode, brand, from, to);
        return byArticle;
    }

    private void mergeArticleTotals(Map<String, ArticleTotal> byArticle, String table, String siteColumn,
                                     String siteCode, String brand, LocalDate from, LocalDate to) {
        String sql = "SELECT s.Article_Code AS code, pm.Description AS description, pm.Category AS category, " +
                "pm.SubCategory AS subCategory, pm.EAN AS ean, pm.HSN AS hsn, pm.Tax AS tax, " +
                "SUM(s.Qty) AS qty, SUM(s.Sales) AS sales FROM " + table + " s " +
                "LEFT JOIN Product_Master pm ON pm.Article_Code = s.Article_Code " +
                "WHERE s." + siteColumn + " = ? AND s.Brand = ? AND s.Sales_Date BETWEEN ? AND ? " +
                "GROUP BY s.Article_Code, pm.Description, pm.Category, pm.SubCategory, pm.EAN, pm.HSN, pm.Tax";
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql, siteCode, brand, from, to)) {
            String code = (String) row.get("code");
            BigDecimal sales = asDecimal(row.get("sales"));
            BigDecimal qty = asDecimal(row.get("qty"));
            byArticle.merge(code,
                    new ArticleTotal(code, (String) row.get("description"), (String) row.get("category"),
                            (String) row.get("subCategory"), (String) row.get("ean"), (String) row.get("hsn"),
                            (BigDecimal) row.get("tax"), sales, qty),
                    (existing, incoming) -> new ArticleTotal(code,
                            existing.description() != null ? existing.description() : incoming.description(),
                            existing.category() != null ? existing.category() : incoming.category(),
                            existing.subCategory() != null ? existing.subCategory() : incoming.subCategory(),
                            existing.ean() != null ? existing.ean() : incoming.ean(),
                            existing.hsn() != null ? existing.hsn() : incoming.hsn(),
                            existing.tax() != null ? existing.tax() : incoming.tax(),
                            existing.sales().add(incoming.sales()), existing.qty().add(incoming.qty())));
        }
    }

    private List<RankedRow> rankByGroup(java.util.Collection<ArticleTotal> current,
                                         java.util.Collection<ArticleTotal> lastYear,
                                         java.util.Collection<ArticleTotal> lastMonth,
                                         java.util.function.Function<ArticleTotal, String> groupKey,
                                         BigDecimal grandTotalSales, BigDecimal lastYearGrandTotalSales) {
        Map<String, BigDecimal[]> currentTotals = groupTotals(current, groupKey);
        Map<String, BigDecimal[]> lastYearTotals = groupTotals(lastYear, groupKey);
        Map<String, BigDecimal[]> lastMonthTotals = groupTotals(lastMonth, groupKey);

        List<RankedRow> rows = new ArrayList<>();
        currentTotals.forEach((label, vals) -> {
            BigDecimal[] ly = lastYearTotals.getOrDefault(label, ZERO_PAIR);
            BigDecimal[] lm = lastMonthTotals.getOrDefault(label, ZERO_PAIR);
            rows.add(toRow(null, label, vals[0], vals[1], grandTotalSales, ly[0], lm[0], lastYearGrandTotalSales));
        });
        return rows.stream().sorted(Comparator.comparing(RankedRow::sales).reversed()).toList();
    }

    private Map<String, BigDecimal[]> groupTotals(java.util.Collection<ArticleTotal> articles,
                                                    java.util.function.Function<ArticleTotal, String> groupKey) {
        Map<String, BigDecimal[]> totals = new LinkedHashMap<>();
        for (ArticleTotal a : articles) {
            String key = groupKey.apply(a);
            String label = key == null ? "Uncategorized" : key;
            totals.merge(label, new BigDecimal[]{a.sales(), a.qty()},
                    (existing, incoming) -> new BigDecimal[]{existing[0].add(incoming[0]), existing[1].add(incoming[1])});
        }
        return totals;
    }

    private RankedRow toRow(String code, String name, BigDecimal sales, BigDecimal qty, BigDecimal grandTotalSales,
                             BigDecimal lastYearSales, BigDecimal lastMonthSales, BigDecimal lastYearGrandTotalSales) {
        BigDecimal contributionPct = grandTotalSales.compareTo(BigDecimal.ZERO) > 0
                ? sales.multiply(BigDecimal.valueOf(100)).divide(grandTotalSales, 1, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;
        BigDecimal contribPct = percentOf(sales, grandTotalSales);
        BigDecimal contribLYPct = percentOf(lastYearSales, lastYearGrandTotalSales);
        return new RankedRow(code, name, sales.setScale(2, RoundingMode.HALF_UP), qty, contributionPct,
                GrowthMath.growthPct(sales, lastYearSales), GrowthMath.growthPct(sales, lastMonthSales),
                contribDelta(contribPct, contribLYPct));
    }

    private List<Map<String, Object>> buildResearchTree(Map<String, ArticleTotal> current,
                                                          Map<String, ArticleTotal> lastYear,
                                                          Map<String, ArticleTotal> lastMonth) {
        Map<CatKey, List<ArticleTotal>> currentBySubKey = new LinkedHashMap<>();
        for (ArticleTotal a : current.values()) {
            CatKey key = new CatKey(orUncategorized(a.category()), orUncategorized(a.subCategory()));
            currentBySubKey.computeIfAbsent(key, k -> new ArrayList<>()).add(a);
        }

        Map<CatKey, BigDecimal[]> lastYearBySubKey = aggregateByKey(lastYear.values());
        Map<CatKey, BigDecimal[]> lastMonthBySubKey = aggregateByKey(lastMonth.values());

        Map<String, List<CatKey>> subKeysByCategory = new LinkedHashMap<>();
        for (CatKey key : currentBySubKey.keySet()) {
            subKeysByCategory.computeIfAbsent(key.category(), c -> new ArrayList<>()).add(key);
        }

        Map<String, BigDecimal> categoryTotals = new LinkedHashMap<>();
        Map<String, BigDecimal> categoryQtyTotals = new LinkedHashMap<>();
        for (Map.Entry<String, List<CatKey>> e : subKeysByCategory.entrySet()) {
            BigDecimal sum = BigDecimal.ZERO;
            BigDecimal qtySum = BigDecimal.ZERO;
            for (CatKey key : e.getValue()) {
                for (ArticleTotal a : currentBySubKey.get(key)) {
                    sum = sum.add(a.sales());
                    qtySum = qtySum.add(a.qty());
                }
            }
            categoryTotals.put(e.getKey(), sum);
            categoryQtyTotals.put(e.getKey(), qtySum);
        }
        BigDecimal grandTotal = categoryTotals.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal grandTotalLastYear = lastYearBySubKey.values().stream().map(v -> v[0]).reduce(BigDecimal.ZERO, BigDecimal::add);

        List<String> orderedCategories = categoryTotals.entrySet().stream()
                .sorted((a, b) -> b.getValue().compareTo(a.getValue()))
                .map(Map.Entry::getKey)
                .toList();

        List<Map<String, Object>> tree = new ArrayList<>();
        int categoryIndex = 1;
        for (String category : orderedCategories) {
            List<CatKey> subKeys = new ArrayList<>(subKeysByCategory.get(category));
            subKeys.sort((a, b) -> {
                BigDecimal sa = currentBySubKey.get(a).stream().map(ArticleTotal::sales).reduce(BigDecimal.ZERO, BigDecimal::add);
                BigDecimal sb = currentBySubKey.get(b).stream().map(ArticleTotal::sales).reduce(BigDecimal.ZERO, BigDecimal::add);
                return sb.compareTo(sa);
            });

            BigDecimal categorySales = categoryTotals.get(category);
            BigDecimal categoryLYSales = subKeys.stream().map(k -> lastYearBySubKey.getOrDefault(k, ZERO_PAIR)[0]).reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal categoryLMSales = subKeys.stream().map(k -> lastMonthBySubKey.getOrDefault(k, ZERO_PAIR)[0]).reduce(BigDecimal.ZERO, BigDecimal::add);

            List<Map<String, Object>> subRows = new ArrayList<>();
            int subIndex = 1;
            for (CatKey key : subKeys) {
                List<ArticleTotal> articles = currentBySubKey.get(key);
                BigDecimal subSales = articles.stream().map(ArticleTotal::sales).reduce(BigDecimal.ZERO, BigDecimal::add);
                BigDecimal subQty = articles.stream().map(ArticleTotal::qty).reduce(BigDecimal.ZERO, BigDecimal::add);
                BigDecimal[] ly = lastYearBySubKey.getOrDefault(key, ZERO_PAIR);
                BigDecimal[] lm = lastMonthBySubKey.getOrDefault(key, ZERO_PAIR);

                List<Map<String, Object>> products = articles.stream()
                        .sorted(Comparator.comparing(ArticleTotal::sales).reversed())
                        .map(a -> {
                            ArticleTotal lyArticle = lastYear.get(a.code());
                            BigDecimal lySales = lyArticle == null ? BigDecimal.ZERO : lyArticle.sales();
                            ArticleTotal lmArticle = lastMonth.get(a.code());
                            BigDecimal lmSales = lmArticle == null ? BigDecimal.ZERO : lmArticle.sales();
                            BigDecimal productContribPct = percentOf(a.sales(), subSales);
                            BigDecimal productContribLYPct = percentOf(lySales, ly[0]);
                            Map<String, Object> productRow = new LinkedHashMap<>();
                            productRow.put("articleCode", a.code());
                            productRow.put("description", a.description() == null ? a.code() : a.description());
                            productRow.put("ean", a.ean());
                            productRow.put("hsn", a.hsn());
                            productRow.put("tax", a.tax());
                            productRow.put("salesValue", a.sales().setScale(2, RoundingMode.HALF_UP));
                            productRow.put("salesQty", a.qty());
                            productRow.put("vsLastYearPct", GrowthMath.growthPct(a.sales(), lySales));
                            productRow.put("vsLastMonthPct", GrowthMath.growthPct(a.sales(), lmSales));
                            productRow.put("contribPct", productContribPct);
                            productRow.put("contribDeltaLYPct", contribDelta(productContribPct, productContribLYPct));
                            return productRow;
                        })
                        .toList();

                BigDecimal subContribPct = percentOf(subSales, categorySales);
                BigDecimal subContribLYPct = percentOf(ly[0], categoryLYSales);

                Map<String, Object> subRow = new LinkedHashMap<>();
                subRow.put("name", key.subCategory());
                subRow.put("index", subIndex++);
                subRow.put("salesValue", subSales.setScale(2, RoundingMode.HALF_UP));
                subRow.put("salesQty", subQty);
                subRow.put("vsLastYearPct", GrowthMath.growthPct(subSales, ly[0]));
                subRow.put("vsLastMonthPct", GrowthMath.growthPct(subSales, lm[0]));
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

    private static final BigDecimal[] ZERO_PAIR = {BigDecimal.ZERO, BigDecimal.ZERO};

    private Map<CatKey, BigDecimal[]> aggregateByKey(java.util.Collection<ArticleTotal> articles) {
        Map<CatKey, BigDecimal[]> totals = new LinkedHashMap<>();
        for (ArticleTotal a : articles) {
            CatKey key = new CatKey(orUncategorized(a.category()), orUncategorized(a.subCategory()));
            totals.merge(key, new BigDecimal[]{a.sales(), a.qty()},
                    (existing, incoming) -> new BigDecimal[]{existing[0].add(incoming[0]), existing[1].add(incoming[1])});
        }
        return totals;
    }

    private static String orUncategorized(String value) {
        return (value == null || value.isBlank()) ? "Uncategorized" : value;
    }

    private static BigDecimal contribDelta(BigDecimal contribPct, BigDecimal contribLYPct) {
        return (contribPct != null && contribLYPct != null)
                ? contribPct.subtract(contribLYPct).setScale(2, RoundingMode.HALF_UP) : null;
    }

    private static BigDecimal percentOf(BigDecimal numerator, BigDecimal denominator) {
        if (denominator == null || denominator.compareTo(BigDecimal.ZERO) == 0) {
            return null;
        }
        return numerator.divide(denominator, 6, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100))
                .setScale(2, RoundingMode.HALF_UP);
    }

    private static BigDecimal asDecimal(Object value) {
        if (value instanceof BigDecimal bd) return bd;
        if (value == null) return BigDecimal.ZERO;
        return new BigDecimal(value.toString());
    }
}
