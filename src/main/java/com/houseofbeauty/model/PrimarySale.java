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
@Table(name = "Primary_Sales")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PrimarySale {

    @Id
    @Column(name = "SN")
    private Long sn;

    @Column(name = "Sales_Date", nullable = false)
    private LocalDate saleDate;

    @Column(name = "Bill_to", length = 50, nullable = false)
    private String billTo;

    @Column(name = "Ship_to")
    private String shipTo;

    @Column(name = "Brand", length = 100, nullable = false)
    private String brand;

    @Column(name = "Article_Code", length = 50, nullable = false)
    private String articleCode;

    @Column(name = "Batch_Code", length = 50, nullable = false)
    private String batchCode;

    @Column(name = "Qty", nullable = false)
    private BigDecimal qty;

    @Column(name = "GST")
    private BigDecimal gst;

    @Column(name = "Net_Value")
    private BigDecimal netValue;

    @Column(name = "Sales")
    private BigDecimal sales;

    @Column(name = "MRP")
    private BigDecimal mrp;

    @Column(name = "Billing_From")
    private String billingFrom;

    @Column(name = "Bill_No")
    private String billNo;
}
