package com.houseofbeauty.service.common;

import java.util.Locale;

public final class TextMatch {

    private TextMatch() {
    }

    public static String normalize(String value) {
        return value == null ? null : value.trim().toLowerCase(Locale.ROOT);
    }

    public static boolean equalsIgnoreCase(String a, String b) {
        String na = normalize(a);
        String nb = normalize(b);
        return na != null && na.equals(nb);
    }

    public static String sql(String columnRef) {
        return "LOWER(LTRIM(RTRIM(" + columnRef + ")))";
    }
}
