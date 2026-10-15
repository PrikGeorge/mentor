package ru.mentor.platform.files;

import java.time.Duration;

public record BlobPolicy(
        Duration lifetime,
        Duration lease,
        Duration renewEvery,
        Duration grace,
        Duration deleteLease,
        Duration writeWindow) {
    public BlobPolicy {
        for (Duration duration :
                new Duration[] {lifetime, lease, renewEvery, grace, deleteLease, writeWindow})
            if (duration.isNegative() || duration.isZero())
                throw new IllegalArgumentException("Positive blob duration required.");
        if (renewEvery.compareTo(lease) >= 0 || lease.compareTo(lifetime) > 0)
            throw new IllegalArgumentException("Invalid upload lease policy.");
    }

    public static BlobPolicy defaults() {
        return new BlobPolicy(
                Duration.ofMinutes(5),
                Duration.ofSeconds(60),
                Duration.ofSeconds(15),
                Duration.ofSeconds(60),
                Duration.ofSeconds(60),
                Duration.ofSeconds(30));
    }
}
