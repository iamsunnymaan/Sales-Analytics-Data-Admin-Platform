package com.houseofbeauty.dto.topprojection.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;


public record TopProjectionEntryResponse(long id, String brand, String channel, String subChannel, String partner,
                                          LocalDate month, BigDecimal projectionValue, LocalDateTime submittedAt) {
}
