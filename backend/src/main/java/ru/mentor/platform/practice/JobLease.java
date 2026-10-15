package ru.mentor.platform.practice;

import java.time.Instant;

public record JobLease(
        String jobId,
        String attemptId,
        String leaseToken,
        Instant leaseExpiresAt,
        Instant deadlineAt,
        JobPayload payload) {}
