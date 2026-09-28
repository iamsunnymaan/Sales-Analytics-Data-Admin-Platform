package com.houseofbeauty.util;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

public class TtlCache<K, V> {

    private record Entry<V>(V value, long expiresAtNanos) {
        boolean isExpired(long now) {
            return expiresAtNanos <= now;
        }
    }

    private final Map<K, Entry<V>> entries = new ConcurrentHashMap<>();
    private final long ttlNanos;

    public TtlCache(long ttlMillis) {
        this.ttlNanos = ttlMillis * 1_000_000L;
    }

    public V get(K key, Function<K, V> loader) {
        Entry<V> existing = entries.get(key);
        long now = System.nanoTime();
        if (existing != null && !existing.isExpired(now)) {
            return existing.value();
        }
        V loaded = loader.apply(key);
        entries.put(key, new Entry<>(loaded, now + ttlNanos));
        return loaded;
    }

    public void evict(K key) {
        entries.remove(key);
    }

    public void evictAll() {
        entries.clear();
    }
}
