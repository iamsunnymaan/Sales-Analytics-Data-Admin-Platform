package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

// JPA mapping for Batch_Master — one row per product batch (MRP/COGS/expiry). Primary key is
// Batch_Code alone (Article_Code+Batch_Code is a separate UNIQUE constraint, not the PK — see
// database/01_schema.sql). No SN column — a live-only addition dropped by the 2026-08-12 table
// recreate. Currently unused (data access for this table goes through raw JdbcTemplate SQL, not
// this entity).
@Entity
@Table(name = "Batch_Master")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class BatchMaster {

    @Column(name = "Article_Code", length = 50)
    private String articleCode;

    @Id
    @Column(name = "Batch_Code", length = 50)
    private String batchCode;

    @Column(name = "MRP")
    private BigDecimal mrp;

    @Column(name = "COGS")
    private BigDecimal cogs;

    @Column(name = "Expiry")
    private LocalDate expiry;
}
