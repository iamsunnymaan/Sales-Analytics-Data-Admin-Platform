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
