package com.houseofbeauty.dto.secondarysales.response;

import java.util.List;

/**
 * GET /api/secondary-sales/overview's response — {@code brands}/{@code channels} are every real,
 * distinct Site_Master value right now (the frontend appends its own synthesized "Total" group/
 * sub-column after these, last), and {@code cells} is every (brand, channel) combo's own figures,
 * including each brand's own (brand, "Total") cell and the grand ("Total", channel)/("Total",
 * "Total") cells — flat, not nested; the frontend builds its own {@code brand|channel} lookup.
 * Empty {@code brands} or {@code channels} means Site_Master has no real Brand/Channel data at all
 * right now — the frontend shows "Not Available" instead of attempting to render a table.
 */
public record OverviewResponse(List<String> brands, List<String> channels, List<OverviewCell> cells) {
}
