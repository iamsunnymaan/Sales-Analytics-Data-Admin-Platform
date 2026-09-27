package com.houseofbeauty.util;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

// Per-key, TTL-bounded memoization — used by AuthService/FeatureManagementService to avoid
// recomputing the same multi-query permission/feature lookup on every single request a page load
// or form submit fires (each was a fresh DB round trip with no caching at all, which is what made
// every action feel slow — see those classes' own cache fields). The TTL is a bounded-staleness
// safety net, same tradeoff already used for static resource caching (see application.properties);
// callers that mutate the underlying rows still call evict()/evictAll() so an admin's role/
// permission edit is reflected immediately rather than waiting out the TTL.
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
