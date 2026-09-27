package com.houseofbeauty.model;

import java.util.Arrays;

// Single source of truth for the 8 real values ImportSession.status ever holds. The DB column and
// every outbound JSON field stay plain String (unchanged schema, unchanged frontend contract) — this
// enum exists so every Java call site that assigns or compares a status goes through one named
// constant instead of a magic string literal repeated (and possibly mistyped) across
// ImportSessionController/ImportSessionCleanupService. value() is the exact literal persisted to the
// DB and serialized to callers today, including "Committed with errors" (space, no underscore) — do
// not change these strings without also migrating existing import_sessions rows.
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
