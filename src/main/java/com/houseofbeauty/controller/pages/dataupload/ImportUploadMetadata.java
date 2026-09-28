package com.houseofbeauty.controller.pages.dataupload;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;


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
