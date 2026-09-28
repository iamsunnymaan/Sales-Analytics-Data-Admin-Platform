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

            return Result.skipped();
        }

        List<Long> expected = new ArrayList<>();
        for (ImportProcessingService.RowResult row : rowResults) {
            if (row.status() != ImportProcessingService.RowStatus.VALID) {
                continue;
            }

            Long value;
            if (appManagedBase != null) {
                value = appManagedBase + row.rowNumber() - 1;
            } else {
                value = toLong(row.data().get(pkHeader));
            }
            if (value == null) {
                return Result.skipped();
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
