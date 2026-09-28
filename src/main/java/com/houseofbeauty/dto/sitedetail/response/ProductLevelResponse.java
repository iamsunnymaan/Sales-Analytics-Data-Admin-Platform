package com.houseofbeauty.dto.sitedetail.response;

import java.util.List;
import java.util.Map;

public record ProductLevelResponse(TrendPeriod period, List<RankedRow> products, List<RankedRow> categories,
                                    List<RankedRow> subCategories, List<Map<String, Object>> tree) {
}
