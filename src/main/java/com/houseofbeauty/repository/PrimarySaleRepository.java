package com.houseofbeauty.repository;

import com.houseofbeauty.model.PrimarySale;
import org.springframework.data.jpa.repository.JpaRepository;

// Standard Spring Data CRUD — no custom queries needed yet.
public interface PrimarySaleRepository extends JpaRepository<PrimarySale, Long> {
}
