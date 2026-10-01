package ru.mentor.platform.files;
import org.springframework.stereotype.Component;
import org.springframework.context.event.EventListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.beans.factory.annotation.Value;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
@Component
public class BlobJanitor {
    private final BlobService service;private final boolean enabled;
    private final ScheduledExecutorService scheduler=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"blob-cleanup");t.setDaemon(true);return t;});
    public BlobJanitor(BlobService service,@Value("${mentor.blobs.cleanup-enabled:true}") boolean enabled){this.service=service;this.enabled=enabled;}
    @EventListener(ApplicationReadyEvent.class) public void start(){if(enabled)scheduler.scheduleWithFixedDelay(()->{try{service.cleanExpired(100);}catch(Exception failure){org.slf4j.LoggerFactory.getLogger(BlobJanitor.class).warn("Private object cleanup incomplete; reservations retained for retry.");}},30,30,TimeUnit.SECONDS);}
    @PreDestroy public void close(){scheduler.shutdownNow();}
}
