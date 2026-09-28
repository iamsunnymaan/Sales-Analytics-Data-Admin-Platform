package com.houseofbeauty.service.dataupload.import_common;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public final class ImportFileSecurityScanner {

    private static final byte[] ZIP_MAGIC = {0x50, 0x4B, 0x03, 0x04};

    private static final byte[] EXE_MAGIC = {0x4D, 0x5A};

    private static final long MAX_COMPRESSION_RATIO = 100;

    private static final long MAX_UNCOMPRESSED_BYTES = 500L * 1024 * 1024;

    private ImportFileSecurityScanner() {
    }

    public static void scan(byte[] fileBytes, String extension) {
        if ("xlsx".equalsIgnoreCase(extension)) {
            scanXlsx(fileBytes);
        } else if ("csv".equalsIgnoreCase(extension)) {
            scanCsv(fileBytes);
        }
    }

    private static void scanCsv(byte[] fileBytes) {
        if (startsWith(fileBytes, ZIP_MAGIC)) {
            throw new IllegalArgumentException(
                    "This file's content is a ZIP/Office archive, not a .csv — rename won't fix it; "
                            + "export it as a real CSV and re-upload.");
        }
        if (startsWith(fileBytes, EXE_MAGIC)) {
            throw new IllegalArgumentException("This file's content is an executable, not a .csv — refusing to accept it.");
        }

        int sample = Math.min(fileBytes.length, 8192);
        for (int i = 0; i < sample; i++) {
            if (fileBytes[i] == 0) {
                throw new IllegalArgumentException("This file's content doesn't look like text — refusing to accept it as a .csv.");
            }
        }
    }

    private static void scanXlsx(byte[] fileBytes) {
        if (!startsWith(fileBytes, ZIP_MAGIC)) {
            throw new IllegalArgumentException(
                    "This file's content isn't a valid Excel workbook (not a ZIP container) — re-export it as .xlsx and re-upload.");
        }

        long totalCompressed = 0;
        long totalUncompressed = 0;
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(fileBytes))) {
            ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zis.getNextEntry()) != null) {
                String nameLower = entry.getName().toLowerCase(Locale.ROOT);
                if (nameLower.endsWith("vbaproject.bin")) {
                    throw new IllegalArgumentException(
                            "This workbook contains a macro (VBA) project — macro-enabled files are never accepted here.");
                }
                long entryUncompressed = 0;
                int read;
                while ((read = zis.read(buffer)) >= 0) {
                    entryUncompressed += read;
                    if (entryUncompressed > MAX_UNCOMPRESSED_BYTES) {
                        throw new IllegalArgumentException("This workbook is too large once decompressed — refusing to process it.");
                    }
                }
                totalUncompressed += entryUncompressed;

                long compressedSize = entry.getCompressedSize();
                if (compressedSize > 0) {
                    totalCompressed += compressedSize;
                }
                zis.closeEntry();
            }
        } catch (IOException e) {
            throw new IllegalArgumentException("This file couldn't be read as a valid .xlsx workbook: " + e.getMessage());
        }

        if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
            throw new IllegalArgumentException("This workbook is too large once decompressed — refusing to process it.");
        }
        if (totalCompressed > 0 && totalUncompressed / totalCompressed > MAX_COMPRESSION_RATIO) {
            throw new IllegalArgumentException(
                    "This workbook's compression ratio is abnormally high (possible zip bomb) — refusing to process it.");
        }
    }

    private static boolean startsWith(byte[] data, byte[] prefix) {
        if (data.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (data[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }
}
