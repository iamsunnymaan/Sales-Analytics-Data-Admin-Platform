package com.houseofbeauty.dto.primarysales.response;

import java.util.List;
import java.util.Map;

/**
 * GET /api/primary-sales/product-level's response — the "3. Product Snapshot" section.
 * {@code tree} stays a list of plain maps rather than a typed structure: it's a genuinely recursive
 * Category → SubCategory → Product nesting (arbitrary depth of dynamically-keyed fields at each
 * level), unlike every other field here which has a single fixed row shape.
 */
public record ProductLevelResponse(String brand, TrendPeriod period, List<CategoryRow> categories,
                                    List<SubCategoryRow> subCategories, List<ProductRow> topByValue,
                                    List<ProductRow> topByQty, List<ProductRow> bottomByValue,
                                    List<ProductRow> bottomByQty, List<Map<String, Object>> tree,
                                    List<BrandQuantityRow> brandQuantities) {
}
