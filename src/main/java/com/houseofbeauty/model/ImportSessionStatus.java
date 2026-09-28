package com.houseofbeauty.model;

import java.util.Arrays;

public enum ImportSessionStatus {

    UPLOADED("Uploaded"),
    VALIDATING("Validating"),
    VALIDATED("Validated"),
    FAILED("Failed"),
    COMMITTING("Committing"),
    COMMITTED("Committed"),
    COMMITTED_WITH_ERRORS("Committed with errors"),
    CANCELLED("Cancelled");

    private final String value;

    ImportSessionStatus(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    public boolean matches(String raw) {
        return value.equals(raw);
    }

    public static ImportSessionStatus fromValue(String raw) {
        return Arrays.stream(values())
                .filter(s -> s.value.equals(raw))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown import session status: " + raw));
    }

    @Override
    public String toString() {
        return value;
    }
}
