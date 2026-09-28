package com.houseofbeauty.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;


@Entity
@Table(name = "Product_Master")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ProductMaster {

    @Id
    @Column(name = "Article_Code", length = 50)
    private String articleCode;

    @Column(name = "EAN", length = 50)
    private String ean;

    @Column(name = "Description", length = 500)
    private String description;

    @Column(name = "Category", length = 100)
    private String category;

    @Column(name = "SubCategory", length = 100)
    private String subCategory;

    @Column(name = "Product_Range", length = 100)
    private String productRange;

    @Column(name = "Shade", length = 100)
    private String shade;

    @Column(name = "Size", length = 50)
    private String size;

    @Column(name = "Brand", length = 100)
    private String brand;

    @Column(name = "HSN", length = 50)
    private String hsn;

    @Column(name = "Tax")
    private BigDecimal tax;
}
