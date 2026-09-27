package com.houseofbeauty.dto.topprojection.request;

import java.math.BigDecimal;

/**
 * One row of POST /api/top-projection/grid's request body — a Brand+Channel+Sub_Channel+Partner
 * combo's Projection Value as currently typed into the popup's grid table (rows with nothing typed
 * are omitted by the frontend, not sent as null — see TopProjectionService#saveGrid). {@code month}
 * is deliberately NOT part of this request, same reason as {@link SubmitTopProjectionRequest} — the
 * server always stamps/matches against the real current month, never a client-supplied date.
 */
public record TopProjectionGridSaveRow(String brand, String channel, String subChannel, String partner,
                                        BigDecimal projectionValue) {
}
