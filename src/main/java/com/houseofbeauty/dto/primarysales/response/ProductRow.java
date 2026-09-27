package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;

/**
 * One product in a top/bottom-by-value/qty list ({@code ProductLevelResponse.topByValue} etc.). Also
 * the shape reused (with an added {@code contribPct} recomputed for its parent sub-category) inside
 * the recursive Category → SubCategory → Product tree — see
 * PrimarySalesProductLevelService.productRowToTreeMap, which stays a plain map since the tree itself
 * does.
 */
public record ProductRow(int index, String articleCode, String description, String category, String subCategory,
                          String ean, String hsn, BigDecimal tax, BigDecimal salesValue, BigDecimal salesQty,
                          BigDecimal vsLastYearPct, BigDecimal vsLastMonthPct, BigDecimal contribPct) {
}
