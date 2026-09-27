package com.houseofbeauty.exception;

import jakarta.persistence.EntityNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Map;

// Turns the exception types services/controllers throw for expected failure cases into consistent
// JSON error responses, instead of every controller catching them individually.
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    // Same property that caps the multipart upload itself (see application.properties) — reused
    // here so the error message always states the real limit rather than a hardcoded number that
    // could silently drift out of sync with it.
    @Value("${spring.servlet.multipart.max-file-size}")
    private String maxUploadFileSize;

    // e.g. an import session id or table row that doesn't exist.
    @ExceptionHandler(EntityNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleEntityNotFound(EntityNotFoundException ex) {
        return build(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    // e.g. bad request params, unsupported file type, invalid table/column name.
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(IllegalArgumentException ex) {
        return build(HttpStatus.BAD_REQUEST, ex.getMessage());
    }

    // e.g. re-processing an import session that's already been committed.
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalState(IllegalStateException ex) {
        return build(HttpStatus.CONFLICT, ex.getMessage());
    }

    // e.g. an unparsable "from"/"to" date query param such as ?from=notadate.
    @ExceptionHandler(DateTimeParseException.class)
    public ResponseEntity<Map<String, Object>> handleDateTimeParse(DateTimeParseException ex) {
        return build(HttpStatus.BAD_REQUEST, "Invalid date format: " + ex.getParsedString());
    }

    // e.g. a required query param is missing, or a param can't be converted to its declared type.
    @ExceptionHandler({MissingServletRequestParameterException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String, Object>> handleBadRequestParam(Exception ex) {
        return build(HttpStatus.BAD_REQUEST, ex.getMessage());
    }

    // The uploaded file exceeded spring.servlet.multipart.max-file-size/-request-size — thrown by
    // Spring's multipart resolver before ImportSessionController.upload ever runs, so this is the
    // only place that failure can be turned into a clear message instead of falling through to the
    // generic 500 handler below.
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleMaxUploadSizeExceeded(MaxUploadSizeExceededException ex) {
        return build(HttpStatus.PAYLOAD_TOO_LARGE,
                "The uploaded file is too large. Maximum allowed size is " + maxUploadFileSize + ".");
    }

    // e.g. deleting/inserting a row that violates a foreign key or unique constraint.
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, Object>> handleDataIntegrityViolation(DataIntegrityViolationException ex) {
        log.warn("Data integrity violation: {}", ex.getMessage());
        return build(HttpStatus.CONFLICT, "Request violates a database constraint (e.g. a linked record still references this row).");
    }

    // Lets any controller/service throw `new ResponseStatusException(status, reason)` for a one-off
    // case that doesn't warrant its own exception type/handler — any 4xx or 5xx status is honored as-is.
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(ResponseStatusException ex) {
        HttpStatus status = HttpStatus.valueOf(ex.getStatusCode().value());
        if (status.is5xxServerError()) {
            log.error("Server error", ex);
        }
        return build(status, ex.getReason());
    }

    // Catch-all for anything unexpected and not covered above — logs the real cause server-side but
    // never leaks internals (stack traces, SQL, class names) to the client. Everything that reaches
    // here is, by definition, a 5xx: a bug or infra failure, not a bad request.
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "Something went wrong. Please try again.");
    }

    private ResponseEntity<Map<String, Object>> build(HttpStatus status, String message) {
        Map<String, Object> body = Map.of(
                "timestamp", Instant.now().toString(),
                "status", status.value(),
                "error", status.getReasonPhrase(),
                "message", message == null ? "" : message
        );
        return ResponseEntity.status(status).body(body);
    }
}
