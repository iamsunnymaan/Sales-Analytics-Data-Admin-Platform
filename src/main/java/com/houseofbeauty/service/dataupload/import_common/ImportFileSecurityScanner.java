package com.houseofbeauty.service.dataupload.import_common;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Upload-intake security checks that run BEFORE the file is ever parsed as data — content-based, not
 * just the filename-extension allow-list {@code ImportSessionController#upload} already enforces, so a
 * renamed or crafted file can't slip past it. Three checks, cheapest first:
 * <ol>
 *     <li>Magic-byte content sniff — the file's actual bytes must look like what its extension claims
 *     (a real .xlsx is a ZIP container; a real .csv is never a ZIP or a Windows executable). This is a
 *     deliberately lightweight, dependency-free substitute for a full MIME-sniffing library (e.g.
 *     Apache Tika) — it catches the same "renamed .exe as .xlsx" class of spoofing for the exact two
 *     extensions this app accepts, without pulling in a library sized for detecting hundreds of formats
 *     this app will never see.</li>
 *     <li>Zip-bomb ratio guard (.xlsx only) — rejects a crafted workbook whose compressed:uncompressed
 *     ratio (or raw decompressed size) is designed to exhaust memory/disk while parsing. Decompresses
 *     incrementally with a running cap rather than trusting the zip header's own claimed sizes, which a
 *     hand-crafted archive can misstate.</li>
 *     <li>Macro rejection (.xlsx only) — rejects any workbook containing a VBA project stream, even one
 *     saved under a plain .xlsx extension. Excel itself would refuse to run macros from a real .xlsx,
 *     but this app never needs to find that out — the whole point of this table's import pipeline is
 *     data rows, not code.</li>
 * </ol>
 * Every rejection throws {@link IllegalArgumentException} with a message meant to be shown to the
 * uploader directly (see {@code GlobalExceptionHandler#handleIllegalArgument}), matching how
 * {@code ImportColumnValidator}'s own validation failures already surface.
 */
public final class ImportFileSecurityScanner {

    // Every ZIP starts with this 4-byte local-file-header magic — a real .xlsx (a ZIP container under
    // the hood) always begins with it.
    private static final byte[] ZIP_MAGIC = {0x50, 0x4B, 0x03, 0x04};
    // Windows/DOS executable magic ("MZ") — the most common "renamed .exe" spoofing attempt.
    private static final byte[] EXE_MAGIC = {0x4D, 0x5A};

    // A legitimate spreadsheet (mostly repetitive XML, already fairly compressible) rarely exceeds a
    // double-digit compression ratio; a deliberately crafted zip bomb aims for the thousands. 100:1
    // matches the design doc's own stated threshold.
    private static final long MAX_COMPRESSION_RATIO = 100;
    // Absolute ceiling regardless of ratio — defense in depth independent of how well-compressed the
    // archive claims to be.
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
        // A real CSV is text — a NUL byte anywhere in a reasonable leading sample never legitimately
        // appears in one, and reliably shows up in binary content mislabeled as .csv.
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
                // Not every ZipEntry reliably reports its own compressed size while streaming (-1 when
                // unknown) — those entries simply don't contribute to the ratio check below, while the
                // absolute MAX_UNCOMPRESSED_BYTES cap above stays authoritative regardless.
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
