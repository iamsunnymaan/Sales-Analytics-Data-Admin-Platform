package com.houseofbeauty.service.common;

import java.math.BigDecimal;
import java.math.RoundingMode;

// Shared current-vs-previous growth-% math. growthPct is null when previous is 0 and current
// isn't — growth is undefined/infinite in that case, not zero.
public final class GrowthMath {

    private GrowthMath() {
    }

    public static BigDecimal growthPct(BigDecimal current, BigDecimal previous) {
        BigDecimal difference = current.subtract(previous);
        if (previous.compareTo(BigDecimal.ZERO) != 0) {
            return difference.divide(previous, 6, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100))
                    .setScale(2, RoundingMode.HALF_UP);
        }
        if (current.compareTo(BigDecimal.ZERO) == 0) {
            return BigDecimal.ZERO;
        }
        return null;
    }
}
