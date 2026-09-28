package com.houseofbeauty.dto.topprojection.request;

import java.math.BigDecimal;

public record SubmitTopProjectionRequest(String brand, String channel, String subChannel, String partner,
                                          BigDecimal projectionValue) {
}
