package ru.mentor.platform.identity;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.shared.ApiFailure;
import java.util.ArrayList;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class PasswordCapacityTest {
    @Test void admitsOnlyTwoActiveAndEightQueuedKdfRequests() throws Exception {
        try(var codec = new PasswordCodec(); var clients = Executors.newFixedThreadPool(12)) {
            var barrier = new CyclicBarrier(13);
            var futures = new ArrayList<Future<Boolean>>();
            for(int i=0;i<12;i++) futures.add(clients.submit(() -> {
                barrier.await(10,TimeUnit.SECONDS);
                try { return !codec.encode("synthetic-concurrent-password").isBlank(); }
                catch(ApiFailure failure) {
                    assertEquals(429,failure.status()); assertEquals("AUTH_BUSY",failure.code()); assertEquals(1,failure.retryAfter());
                    return false;
                }
            }));
            barrier.await(10,TimeUnit.SECONDS);
            int admitted = 0;
            for(var future : futures) if(future.get(30,TimeUnit.SECONDS)) admitted++;
            assertEquals(10,admitted);
        }
    }
    @Test void closedPasswordServiceReturnsUnavailableInsteadOfOverload() {
        var codec = new PasswordCodec(); codec.close();
        var unavailable = assertThrows(ApiFailure.class,() -> codec.encode("synthetic-closed-password"));
        assertEquals(503,unavailable.status());
        assertEquals("AUTH_UNAVAILABLE",unavailable.code());
    }
}
