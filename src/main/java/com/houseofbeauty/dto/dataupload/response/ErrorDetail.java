package com.houseofbeauty.dto.dataupload.response;

/** One invalid row's detail in a {@link CommitResultResponse}'s errorDetails list. */
public record ErrorDetail(String rowNumber, String message, String solution) {
}
