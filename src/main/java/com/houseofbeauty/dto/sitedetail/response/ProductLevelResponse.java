package com.houseofbeauty.dto.sitedetail.response;

import java.util.List;
import java.util.Map;

/**
 * GET /api/site-detail/product-level's response — this one site's Product Snapshot ranking, at all
 * three levels at once (SiteDetailProductLevelService), sorted by Sales descending server-side;
 * SiteStatusPage.js re-sorts by Qty client-side when the user picks "Top by Qty" instead, same
 * convention Primary Sales' own Product Snapshot uses. {@code tree} backs the "Product Research"
 * popup instead — the real Category -> Sub-category -> Product nesting with vs-Last-Year/
 * vs-Last-Month/contribution figures at every level, same shape Primary Sales' own equivalent popup
 * uses (kept as plain nested maps, not a typed record, for the same reason
 * PrimarySalesProductLevelService's own tree does).
 */
public record ProductLevelResponse(TrendPeriod period, List<RankedRow> products, List<RankedRow> categories,
                                    List<RankedRow> subCategories, List<Map<String, Object>> tree) {
}
