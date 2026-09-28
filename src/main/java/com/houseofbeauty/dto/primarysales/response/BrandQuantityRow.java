package com.houseofbeauty.dto.primarysales.response;

import java.math.BigDecimal;


public record BrandQuantityRow(String brandKey, String label, BigDecimal qty) {
}
