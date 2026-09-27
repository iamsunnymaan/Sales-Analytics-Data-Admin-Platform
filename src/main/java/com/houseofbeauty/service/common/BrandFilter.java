package com.houseofbeauty.service.common;

import java.util.Set;

/**
 * The Brand pill's three UI values ("all"/"abh"/"kylie") map to TWO different real vocabularies in
 * the database, not one — {@code Product_Master.Brand} stores full names ("Anastasia Beverly
 * hills", "Kylie Cosmetics"), while {@code Primary_Sales_Target.Brand} stores short codes
 * ("ABH", "Kylie") — the two tables were populated independently and never reconciled on this
 * column. Every brand-filtered query needs the vocabulary matching whichever table it's actually
 * filtering: a query joined to Product_Master needs {@link #product}, a call into
 * {@code PrimarySalesTargetService} (which filters Primary_Sales_Target directly) needs
 * {@link #target}. Passing the wrong one doesn't error — it silently matches zero rows, which is
 * exactly the bug this class was extracted to stop from recurring: several services were reusing
 * one brandFilter value for both, so MTD Sales (Product_Master-joined) stayed stuck at ₹0 for
 * ABH/Kylie while Month Target (Primary_Sales_Target-only) worked correctly, making the two look
 * inconsistent with each other under the same brand filter.
 */
public final class BrandFilter {

    public static final Set<String> VALID_BRANDS = Set.of("all", "abh", "kylie");

    private BrandFilter() {
    }

    public static String normalize(String brand) {
        String normalized = brand == null ? "all" : brand.toLowerCase();
        if (!VALID_BRANDS.contains(normalized)) {
            throw new IllegalArgumentException("Invalid brand: must be one of " + VALID_BRANDS);
        }
        return normalized;
    }

    /** Product_Master.Brand's real values — use for any query joined to Product_Master. */
    public static String product(String normalizedBrand) {
        return switch (normalizedBrand) {
            case "abh" -> "Anastasia Beverly hills";
            case "kylie" -> "Kylie Cosmetics";
            default -> null;
        };
    }

    /** Primary_Sales_Target.Brand's real values — use only for PrimarySalesTargetService calls. */
    public static String target(String normalizedBrand) {
        return switch (normalizedBrand) {
            case "abh" -> "ABH";
            case "kylie" -> "Kylie";
            default -> null;
        };
    }
}
