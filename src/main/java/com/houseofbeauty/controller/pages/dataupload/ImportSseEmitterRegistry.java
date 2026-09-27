package com.houseofbeauty.controller.pages.dataupload;

import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Per-session {@link SseEmitter} lifecycle for live /process and /commit progress — backs
 * {@link ImportSessionController#events}. A session can have more than one active listener (e.g. a
 * page reload while a job is still running), so this fans a push out to every emitter currently
 * registered for that session rather than assuming exactly one.
 *
 * <p>This is a live-push convenience layered on top of {@link ImportProcessJobTracker}'s own
 * poll-on-demand status endpoints, never a replacement for them — polling stays the source of truth
 * a client falls back to automatically if SSE never connects (e.g. a corporate proxy strips it) or
 * drops mid-run. Every {@code push} here is best-effort: a dead connection is quietly dropped from
 * this registry, not propagated as a failure to the background job it's reporting on.
 */
class ImportSseEmitterRegistry {

    // Comfortably longer than any realistic single /process or /commit run — the emitter's own
    // timeout is a safety net (browsers reconnect on drop), not a run-time budget.
    private static final long TIMEOUT_MS = 15 * 60 * 1000L;

    private final Map<String, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();

    SseEmitter register(String sessionId) {
        SseEmitter emitter = new SseEmitter(TIMEOUT_MS);
        CopyOnWriteArrayList<SseEmitter> listeners =
                emitters.computeIfAbsent(sessionId, key -> new CopyOnWriteArrayList<>());
        listeners.add(emitter);

        Runnable cleanup = () -> {
            CopyOnWriteArrayList<SseEmitter> current = emitters.get(sessionId);
            if (current != null) {
                current.remove(emitter);
            }
        };
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(ex -> cleanup.run());
        return emitter;
    }

    /** Best-effort push to every live listener for this session; silently drops any dead connection. */
    void push(String sessionId, String eventName, Object payload) {
        CopyOnWriteArrayList<SseEmitter> listeners = emitters.get(sessionId);
        if (listeners == null || listeners.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : listeners) {
            try {
                emitter.send(SseEmitter.event().name(eventName).data(payload));
            } catch (IOException | IllegalStateException e) {
                listeners.remove(emitter);
            }
        }
    }

    /** Closes out every live listener for this session — call once the job it was reporting on is done. */
    void complete(String sessionId) {
        CopyOnWriteArrayList<SseEmitter> listeners = emitters.remove(sessionId);
        if (listeners == null) {
            return;
        }
        for (SseEmitter emitter : listeners) {
            try {
                emitter.complete();
            } catch (IllegalStateException ignored) {
                // Already completed/errored on its own — nothing left to do.
            }
        }
    }
}
