package ru.mentor.runner;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import ru.mentor.runner.protocol.*;
import java.net.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class JobClientTest {
    @Test void completionOmitsAbsentOptionalTextButPreservesExplicitNullScalars() throws Exception {
        HttpServer service=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var requests=new LinkedBlockingQueue<com.fasterxml.jackson.databind.JsonNode>();
        service.createContext("/internal/v1/jobs/job/complete",exchange->{
            try { requests.add(Json.MAPPER.readTree(exchange.getRequestBody()));exchange.sendResponseHeaders(204,-1); }
            finally { exchange.close(); }
        });
        service.start();Path credential=Files.createTempFile("job-client-token-",".txt");Files.writeString(credential,"synthetic-job-client-token");
        try {
            var client=new JobClient(URI.create("http://127.0.0.1:"+service.getAddress().getPort()+"/internal/v1/"),credential,"client-test");
            var test=new TestResult("nullable",TestResult.StatusEnum.ACCEPTED).expected(null).actual(null);
            var result=new CheckResult(CheckResult.StatusEnum.ACCEPTED,1,1,1L,List.of(test));var lease=new JobLease().jobId("job").leaseToken("synthetic-lease");
            client.complete(lease,result);var body=requests.poll(2,TimeUnit.SECONDS);assertNotNull(body);var serialized=body.get("result");var details=serialized.get("tests").get(0);
            assertAll(()->assertFalse(serialized.has("diagnostics")),()->assertFalse(details.has("message")),()->assertFalse(details.has("stdout")),()->assertTrue(details.has("expected")&&details.get("expected").isNull()),()->assertTrue(details.has("actual")&&details.get("actual").isNull()));
            result.diagnostics("compiler output");test.message("checked").stdout("value");client.complete(lease,result);body=requests.poll(2,TimeUnit.SECONDS);assertNotNull(body);assertEquals("compiler output",body.get("result").get("diagnostics").asText());assertEquals("checked",body.get("result").get("tests").get(0).get("message").asText());assertEquals("value",body.get("result").get("tests").get(0).get("stdout").asText());
        } finally {service.stop(0);Files.deleteIfExists(credential);}
    }
    @Test void stalledResponseBodyCannotStrandLeaseWorker() throws Exception {
        HttpServer service=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        CountDownLatch release=new CountDownLatch(1);
        service.createContext("/internal/v1/jobs/claim",exchange->{
            try { exchange.getRequestBody().readAllBytes(); exchange.sendResponseHeaders(200,0); exchange.getResponseBody().write('{'); exchange.getResponseBody().flush(); release.await(15,TimeUnit.SECONDS); }
            catch(InterruptedException failure) { Thread.currentThread().interrupt(); }
            finally { exchange.close(); }
        });
        service.start(); Path credential=Files.createTempFile("job-client-token-",".txt"); Files.writeString(credential,"synthetic-job-client-token");
        try {
            var client=new JobClient(URI.create("http://127.0.0.1:"+service.getAddress().getPort()+"/internal/v1/"),credential,"client-test");
            assertTimeoutPreemptively(Duration.ofSeconds(8),()->assertThrows(Exception.class,client::claim));
        } finally { release.countDown(); service.stop(0); Files.deleteIfExists(credential); }
    }
    @Test void oversizedClaimIsRejectedAndAcceptedZeroTestsNeverReachesServer() throws Exception {
        HttpServer service=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        service.createContext("/internal/v1/jobs/claim",exchange->{
            try { exchange.getRequestBody().readAllBytes(); byte[] body=new byte[4*1024*1024+1]; exchange.sendResponseHeaders(200,body.length); exchange.getResponseBody().write(body); }
            finally { exchange.close(); }
        });
        service.start(); Path credential=Files.createTempFile("job-client-token-",".txt"); Files.writeString(credential,"synthetic-job-client-token");
        try {
            var client=new JobClient(URI.create("http://127.0.0.1:"+service.getAddress().getPort()+"/internal/v1/"),credential,"client-test");
            assertThrows(Exception.class,client::claim);
            assertThrows(IllegalArgumentException.class,()->client.complete(new JobLease().jobId("job"),new CheckResult(CheckResult.StatusEnum.ACCEPTED,0,0,0L,List.of())));
        } finally { service.stop(0); Files.deleteIfExists(credential); }
    }
}
