package com.houseofbeauty.controller.pages.explorer;

import com.houseofbeauty.dto.explorer.response.ConnectionStatusResponse;
import com.houseofbeauty.dto.explorer.response.TableSummaryResponse;
import com.houseofbeauty.model.ImportSession;
import com.houseofbeauty.repository.ImportSessionRepository;
import com.houseofbeauty.service.common.TableAccessService;
import com.houseofbeauty.service.dataupload.import_common.ImportProcessingService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Reports the DB connection status and available tables for the Explorer/Upload UI's connection banner.
@RestController
@RequestMapping("/api/database")
public class DatabaseConnectionController {

    // Pulled from the JDBC URL rather than a config property, so the UI shows what's actually in use.
    private static final Pattern SERVER_PATTERN = Pattern.compile("//([^;]+)");
    private static final Pattern DATABASE_PATTERN = Pattern.compile("(?i)databaseName=([^;]+)");

    private final DataSource dataSource;
    private final TableAccessService tableAccessService;
    private final ImportSessionRepository importSessionRepository;
    private final ImportProcessingService importProcessingService;
    private final String datasourceUrl;

    public DatabaseConnectionController(DataSource dataSource,
                                         TableAccessService tableAccessService,
                                         ImportSessionRepository importSessionRepository,
                                         ImportProcessingService importProcessingService,
                                         @Value("${spring.datasource.url}") String datasourceUrl) {
        this.dataSource = dataSource;
        this.tableAccessService = tableAccessService;
        this.importSessionRepository = importSessionRepository;
        this.importProcessingService = importProcessingService;
        this.datasourceUrl = datasourceUrl;
    }

    @GetMapping("/tables")
    public List<String> getTables() {
        return tableAccessService.listAvailableTables();
    }

    /**
     * Backs the Data Upload/Explorer pages' "Available Tables" info panel — icon+name, last
     * committed-import date, and whether this table's own import rules apply the normal duplicate
     * check or always insert every row as new (see TableImportRules#alwaysInsertNew).
     *
     * <p>{@code lastUpdated}: CHANGED 2026-09-03 — now reads table_last_import first (see
     * TableAccessService#getLastImportedAt's own comment), a real permanent per-table record, not
     * subject to any retention window. Falls back to the older import_sessions.committedAt lookup
     * only when table_last_import has no row for this table yet (either the table has genuinely
     * never been imported, or it WAS imported before this permanent-tracking table existed/was
     * picked up — in which case today's still-fresh import_sessions history can still answer it; a
     * commit any older than that is unrecoverable either way, see ImportSessionCleanupService).
     */
    @GetMapping("/tables/{tableKey}/summary")
    public TableSummaryResponse getTableSummary(@PathVariable String tableKey) {
        String table = tableAccessService.validateTable(tableKey);
        LocalDateTime lastUpdated = tableAccessService.getLastImportedAt(table);
        if (lastUpdated == null) {
            lastUpdated = importSessionRepository
                    .findFirstByTableKeyIgnoreCaseAndCommittedAtIsNotNullOrderByCommittedAtDesc(table)
                    .map(ImportSession::getCommittedAt)
                    .orElse(null);
        }
        boolean duplicateCheckEnabled = !importProcessingService.alwaysAutoGeneratesPrimaryKey(table);
        return new TableSummaryResponse(table, lastUpdated, duplicateCheckEnabled);
    }

    @GetMapping("/connection")
    public ConnectionStatusResponse getConnectionStatus() {
        return new ConnectionStatusResponse(extract(SERVER_PATTERN, "Unknown"), extract(DATABASE_PATTERN, "Unknown"),
                isConnected() ? "connected" : "disconnected");
    }

    // A short validity ping rather than a real query — cheap and enough to prove the DB is reachable.
    private boolean isConnected() {
        try (Connection connection = dataSource.getConnection()) {
            return connection.isValid(2);
        } catch (SQLException e) {
            return false;
        }
    }

    private String extract(Pattern pattern, String fallback) {
        Matcher matcher = pattern.matcher(datasourceUrl);
        return matcher.find() ? matcher.group(1) : fallback;
    }
}
