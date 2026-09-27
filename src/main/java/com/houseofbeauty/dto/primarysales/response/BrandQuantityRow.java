package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;

/**
 * One row in {@code ProductLevelResponse.brandQuantities} — real total Qty sold per brand for the
 * response's own period, one row per real {@code Site_Master.Brand} value (e.g. "ABH"/"Kylie"),
 * regardless of the request's own {@code brand} filter (this is a cross-brand comparison by design,
 * so it always covers every brand Site_Master currently has, even when the page itself is filtered
 * down to one) — see PrimarySalesProductLevelService#loadBrandQuantities. {@code label} is that same
 * short Site_Master code, NOT {@code Product_Master.Brand}'s full display name — "ABH" means
 * Anastasia Beverly Hills, "Kylie" means Kylie Cosmetics; see {@link
 * com.houseofbeauty.service.common.BrandFilter}'s own header comment for why these two tables use
 * different vocabularies for the same real brand. Sorted highest Qty first — the frontend's
 * "leader" strip is simply this list's first entry.
 */
public record BrandQuantityRow(String brandKey, String label, BigDecimal qty) {
}
