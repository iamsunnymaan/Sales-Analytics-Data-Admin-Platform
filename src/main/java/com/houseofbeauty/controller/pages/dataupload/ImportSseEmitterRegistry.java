package com.houseofbeauty.controller.pages.dataupload;

import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

class ImportSseEmitterRegistry {

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

    void complete(String sessionId) {
        CopyOnWriteArrayList<SseEmitter> listeners = emitters.remove(sessionId);
        if (listeners == null) {
            return;
        }
        for (SseEmitter emitter : listeners) {
            try {
                emitter.complete();
            } catch (IllegalStateException ignored) {

            }
        }
    }
}
