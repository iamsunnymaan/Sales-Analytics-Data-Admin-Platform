package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;


@Entity
@Table(name = "import_sessions")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ImportSession {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "table_key", length = 50, nullable = false)
    private String tableKey;

    @Column(name = "original_filename", length = 255, nullable = false)
    private String originalFilename;

    @Column(name = "stored_path", length = 500, nullable = false)
    private String storedPath;

    @Column(name = "file_size", nullable = false)
    private Integer fileSize;

    @Column(name = "file_type", length = 50, nullable = false)
    private String fileType;

    @Column(name = "status", length = 30, nullable = false)
    private String status;

    @Column(name = "total_rows")
    private Integer totalRows;

    @Column(name = "valid_rows")
    private Integer validRows;

    @Column(name = "error_rows")
    private Integer errorRows;

    @Column(name = "duplicate_rows")
    private Integer duplicateRows;

    @Column(name = "inserted_rows")
    private Integer insertedRows;

    @Lob
    @Column(name = "mapping_json")
    private String mappingJson;

    @Column(name = "message", length = 500)
    private String message;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "committed_at")
    private LocalDateTime committedAt;

    @Column(name = "duration_ms")
    private Long durationMs;


    @Transient
    private String duplicateWarning;
}
