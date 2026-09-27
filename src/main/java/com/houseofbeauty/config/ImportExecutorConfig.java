package com.houseofbeauty.config;

import com.houseofbeauty.service.dataupload.import_common.ImportLimits;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

// Dedicated pool for the upload/import pipeline — separate from Spring Boot's default
// applicationTaskExecutor, which unrelated code (e.g. PrimarySalesProductLevelService's parallel
// report queries) also runs on. Import work uses this pool at two levels at once: the outer
// background job ImportSessionController starts per /process or /commit call, which itself blocks
// waiting on up to ImportLimits.MAX_PARALLEL_CHUNKS inner chunk tasks (see ImportValidationRunner).
// Sharing one small pool across both levels is exactly the self-deadlock shape to avoid — an outer
// job thread can end up occupying a slot while waiting on inner chunk threads that never get one — so
// this is sized with headroom above MAX_PARALLEL_CHUNKS for a few concurrent uploads' outer dispatch
// threads, not sized to MAX_PARALLEL_CHUNKS alone.
@Configuration
public class ImportExecutorConfig {

    private static final int OUTER_JOB_HEADROOM = 4;

    @Bean
    public ThreadPoolTaskExecutor importChunkExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        int poolSize = ImportLimits.MAX_PARALLEL_CHUNKS + OUTER_JOB_HEADROOM;
        executor.setCorePoolSize(poolSize);
        executor.setMaxPoolSize(poolSize);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("import-chunk-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }

    // Spring Boot's TaskExecutionAutoConfiguration only creates its own "applicationTaskExecutor"
    // bean when NO other Executor bean exists anywhere in the context (@ConditionalOnMissingBean
    // (Executor.class)) — defining importChunkExecutor above silently suppressed it, breaking every
    // unrelated consumer still wired to @Qualifier("applicationTaskExecutor") (e.g.
    // PrimarySalesProductLevelService's parallel report queries). Replicating Boot's own defaults
    // here restores that bean explicitly so nothing outside the import pipeline is affected by this
    // config class's existence.
    @Bean(name = "applicationTaskExecutor")
    public ThreadPoolTaskExecutor applicationTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(Integer.MAX_VALUE);
        executor.setQueueCapacity(Integer.MAX_VALUE);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("task-");
        executor.initialize();
        return executor;
    }
}
