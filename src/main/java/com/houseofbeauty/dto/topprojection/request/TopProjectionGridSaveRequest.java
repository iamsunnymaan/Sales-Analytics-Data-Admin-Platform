package com.houseofbeauty.dto.topprojection.request;

import java.util.List;

/**
 * POST /api/top-projection/grid's request body — every row the popup's grid table currently shows
 * (see TopProjectionService#saveGrid), submitted together as one bulk Save rather than one row at a
 * time.
 */
public record TopProjectionGridSaveRequest(List<TopProjectionGridSaveRow> rows) {
}
