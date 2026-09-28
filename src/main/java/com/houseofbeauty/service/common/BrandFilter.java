package com.houseofbeauty.service.common;

import java.util.Set;


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

    
    public static String product(String normalizedBrand) {
        return switch (normalizedBrand) {
            case "abh" -> "Anastasia Beverly hills";
            case "kylie" -> "Kylie Cosmetics";
            default -> null;
        };
    }

    
    public static String target(String normalizedBrand) {
        return switch (normalizedBrand) {
            case "abh" -> "ABH";
            case "kylie" -> "Kylie";
            default -> null;
        };
    }
}
