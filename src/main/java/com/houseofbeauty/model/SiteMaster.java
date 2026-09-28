package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;


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
