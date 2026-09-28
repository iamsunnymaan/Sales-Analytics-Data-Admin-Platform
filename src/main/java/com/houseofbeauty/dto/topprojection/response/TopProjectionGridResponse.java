package com.houseofbeauty.dto.topprojection.response;

import java.util.List;

public record TopProjectionGridResponse(List<TopProjectionGridRow> rows, String currentMonth, String currentMonthLabel) {
}
