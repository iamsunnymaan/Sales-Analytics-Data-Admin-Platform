package com.houseofbeauty.dto.primarysales.response;

import java.util.List;
import java.util.Map;

public record ProductLevelResponse(String brand, TrendPeriod period, List<CategoryRow> categories,
                                    List<SubCategoryRow> subCategories, List<ProductRow> topByValue,
                                    List<ProductRow> topByQty, List<ProductRow> bottomByValue,
                                    List<ProductRow> bottomByQty, List<Map<String, Object>> tree,
                                    List<BrandQuantityRow> brandQuantities) {
}
