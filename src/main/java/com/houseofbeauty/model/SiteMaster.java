package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

// JPA mapping for Site_Master — the store/site master data. Still no SN column (dropped by the
// 2026-08-12 table recreate; TableDataController.resolveOrder falls back to its no-SN default for
// this table). Brand was re-added to the live schema on 2026-08-24 (nullable at the time), then made
// part of the table's composite PK on 2026-09-02 (Site_Code, Brand) — so the same Site_Code can carry
// one row per Brand it stocks. @Id is still declared on siteCode alone below: no JpaRepository<SiteMaster,
// ?> exists in this codebase (verified 2026-09-02), so this class is never used for JPA persistence —
// if one is ever added, this needs an @IdClass/@EmbeddedId over (siteCode, brand) first.
@Entity
@Table(name = "Site_Master")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SiteMaster {

    @Id
    @Column(name = "Site_Code", length = 50)
    private String siteCode;

    @Column(name = "Brand", length = 100, nullable = false)
    private String brand;

    @Column(name = "Store_Name", length = 255)
    private String storeName;

    @Column(name = "City", length = 100)
    private String city;

    @Column(name = "State", length = 100)
    private String state;

    @Column(name = "Region", length = 100)
    private String region;

    @Column(name = "Channel", length = 100)
    private String channel;

    @Column(name = "Sub_Channel", length = 100)
    private String subChannel;

    @Column(name = "Partner", length = 150)
    private String partner;

    @Column(name = "RM", length = 100)
    private String rm;

    @Column(name = "AM", length = 100)
    private String am;

    @Column(name = "CM", length = 100)
    private String cm;

    @Column(name = "SM", length = 100)
    private String sm;

    @Column(name = "Opening_Date")
    private LocalDate openingDate;

    @Column(name = "Operational_Status", length = 50)
    private String operationalStatus;
}
