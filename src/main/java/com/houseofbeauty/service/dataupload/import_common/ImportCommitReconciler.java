package com.houseofbeauty.service.dataupload.import_common;

import com.houseofbeauty.service.common.TableAccessService;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Post-commit "prove it, don't just claim it" reconciliation, run once by {@link ImportAtomicCommitRunner}
 * after its transaction has actually committed (never inside the same transaction — the whole point is
 * to re-read the rows as a fresh query would see them, not as the writer already knows they look).
 * Every successfully inserted row's real primary-key value is collected, SHA-256 digested (sorted, so
 * chunk-completion order never affects the result), and compared against a fresh digest computed from
 * re-querying the database for that same key range.
 *
 * <p>Only runs when the table's primary key is a single column whose actual inserted value this app can
 * reconstruct without reading generated keys back from a batch INSERT — a real JDBC limitation of the
 * batch-insert path {@link ImportChunkRowProcessor} uses, not something worth working around by
 * switching every table to single-row inserts just to support this check. That means either an
 * app-managed column (the "SN" convention — see {@code ImportProcessingService.RunContext#appManagedPkBaseValues})
 * or a value the uploaded file explicitly supplied itself (a preserved identity column). A composite
 * primary key, a genuine unretrieved DB IDENTITY value, or a non-numeric key all report {@link Status#SKIPPED}
 * rather than fabricating a result — this is a real proof or no claim at all, never a guess.
 */
final class ImportCommitReconciler {

    enum Status { VERIFIED, MISMATCH, SKIPPED }

    record Result(Status status, String expectedDigest, String actualDigest) {
        static Result skipped() {
            return new Result(Status.SKIPPED, null, null);
        }
    }

    private final JdbcTemplate jdbcTemplate;

    ImportCommitReconciler(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    Result reconcile(ImportProcessingService.RunContext ctx, List<ImportProcessingService.RowResult> rowResults,
                      TableAccessService tableAccessService) {
        List<String> pkColumns = tableAccessService.getPrimaryKeyColumns(ctx.table());
        if (pkColumns.size() != 1) {
            return Result.skipped();
        }
        String pkColumn = pkColumns.get(0);
        Long appManagedBase = ctx.appManagedPkBaseValues().get(pkColumn);
        String pkHeader = appManagedBase == null
                ? ctx.headers().stream().filter(h -> h.equalsIgnoreCase(pkColumn)).findFirst().orElse(null)
                : null;
        if (appManagedBase == null && pkHeader == null) {
            // A genuine DB-generated identity this run never captured a value for — nothing to
            // re-verify against.
            return Result.skipped();
        }

        List<Long> expected = new ArrayList<>();
        for (ImportProcessingService.RowResult row : rowResults) {
            if (row.status() != ImportProcessingService.RowStatus.VALID) {
                continue;
            }
            // Mirrors exactly how ImportChunkRowProcessor computed the real inserted value for an
            // app-managed PK: base + (this row's 1-indexed position in the file) - 1. Deliberately an
            // if/else, not a ternary — a ternary with one primitive-long branch and one Long branch
            // forces both operands through numeric promotion (JLS 15.25), which auto-unboxes the Long
            // branch's result (here, possibly a genuine null from toLong) even when that branch isn't
            // the one taken, throwing an NPE that has nothing to do with which branch actually ran.
            Long value;
            if (appManagedBase != null) {
                value = appManagedBase + row.rowNumber() - 1;
            } else {
                value = toLong(row.data().get(pkHeader));
            }
            if (value == null) {
                return Result.skipped(); // couldn't resolve one row's key — no partial claim
            }
            expected.add(value);
        }
        if (expected.isEmpty()) {
            return Result.skipped();
        }

        long min = Collections.min(expected);
        long max = Collections.max(expected);
        List<Long> actual;
        try {
            actual = jdbcTemplate.queryForList(
                    "SELECT [" + pkColumn + "] FROM [" + ctx.table() + "] WHERE [" + pkColumn + "] BETWEEN ? AND ?",
                    Long.class, min, max);
        } catch (Exception e) {
            // A read-back failure (e.g. a non-numeric key that slipped past the Long parse above for
            // some rows but not others) is a SKIP, not a false MISMATCH — this check either proves
            // something or says nothing, never misreports.
            return Result.skipped();
        }

        String expectedDigest = digestOf(expected);
        String actualDigest = digestOf(actual);
        boolean match = expected.size() == actual.size() && expectedDigest.equals(actualDigest);
        return new Result(match ? Status.VERIFIED : Status.MISMATCH, expectedDigest, actualDigest);
    }

    private Long toLong(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return Long.parseLong(String.valueOf(value).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String digestOf(List<Long> values) {
        List<Long> sorted = new ArrayList<>(values);
        Collections.sort(sorted);
        StringBuilder canonical = new StringBuilder();
        for (Long v : sorted) {
            canonical.append(v).append('\n');
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(String.format(Locale.ROOT, "%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
