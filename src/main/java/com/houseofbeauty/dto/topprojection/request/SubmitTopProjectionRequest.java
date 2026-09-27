package com.houseofbeauty.dto.topprojection.request;

import java.math.BigDecimal;

/**
 * POST /api/top-projection's request body — the Quick Access Panel's "Projection Form" popup.
 * {@code month} is deliberately NOT part of this request: the popup only ever shows/labels the
 * current month (never lets the user pick one), so the server stamps every submission with
 * whatever month it actually is at insert time (see TopProjectionService.submit) rather than
 * trusting a client-supplied date. {@code subChannel}/{@code partner} are real Site_Master values
 * alongside Channel (see TopProjectionService#loadSiteCombos) — the uniqueness key a current-month
 * submission is checked/overwritten against is the full Brand+Channel+Sub_Channel+Partner combo, so
 * the same Channel/Sub_Channel can carry independent figures per Partner.
 */
public record SubmitTopProjectionRequest(String brand, String channel, String subChannel, String partner,
                                          BigDecimal projectionValue) {
}
