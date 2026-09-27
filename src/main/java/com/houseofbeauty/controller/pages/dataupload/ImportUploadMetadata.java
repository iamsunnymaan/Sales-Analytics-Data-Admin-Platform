package com.houseofbeauty.controller.pages.dataupload;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/**
 * Small piece of per-session metadata that doesn't warrant its own database column — the uploaded
 * file's SHA-256 checksum (for the duplicate-file warning, see
 * {@code ImportSessionController#findRecentDuplicate}) and the .xlsx sheet index the user chose
 * (see {@code ImportUploadFileParser#listDataSheets}). Persisted as a small JSON blob in
 * {@link com.houseofbeauty.model.ImportSession#getMappingJson()}, a column that already exists on
 * the live {@code import_sessions} table and was otherwise unused — adding real dedicated
 * columns for two small fields isn't worth an ALTER TABLE against a shared database.
 */
record ImportUploadMetadata(String fileChecksum, int sheetIndex) {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    String toJson() {
        try {
            return MAPPER.writeValueAsString(this);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to serialize import upload metadata", e);
        }
    }

    static ImportUploadMetadata fromJson(String json) {
        if (json == null || json.isBlank()) {
            return new ImportUploadMetadata(null, 0);
        }
        try {
            return MAPPER.readValue(json, ImportUploadMetadata.class);
        } catch (IOException e) {
            // Pre-existing sessions from before this metadata existed have a null/unrelated
            // mappingJson — treat as "nothing known" rather than failing the whole request.
            return new ImportUploadMetadata(null, 0);
        }
    }

    static String sha256Hex(byte[] bytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(bytes);
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
