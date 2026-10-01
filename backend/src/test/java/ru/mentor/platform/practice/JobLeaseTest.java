package ru.mentor.platform.practice;

import org.junit.jupiter.api.Test;
import java.util.Map;
import java.nio.file.Files;
import static org.junit.jupiter.api.Assertions.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import tools.jackson.databind.node.ObjectNode;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class JobLeaseTest extends AttemptHttpTest {
    @Test void filesystemUrisAreRedactedAcrossEveryPublicTextField()throws Exception {
        var f=fixture("lease-file-uri");publish(f,source());assign(f,0,"list-task");var attempt=data(enqueue(f,"file-uri",code("source")),202);var lease=claim();var result=(ObjectNode)result(lease,"accepted");
        String unsafe="file:///srv/runner/secret file://host/share/secret file:/srv/runner/secret FILE:///C:/private/secret file:\\C:\\private\\secret jar:file:///srv/private/secret.jar!/pkg/Foo.class";
        String safe="https://example.com/home/docs http://example.com/docs demo/ListTask.java:5";
        result.put("diagnostics",unsafe+" "+safe);var test=(ObjectNode)result.get("tests").get(0);
        for(String field:List.of("expected","actual","message","stdout"))test.put(field,unsafe+" "+safe);
        assertEquals(204,complete(lease,result).statusCode());
        for(var user:List.of(f.teacher(),f.learner())){
            var projected=data(get(user.client(),attempts(f)+"/"+attempt.get("id").asText()),200).get("result");
            var values=new ArrayList<String>();values.add(projected.get("diagnostics").asText());for(String field:List.of("expected","actual","message","stdout"))values.add(projected.get("tests").get(0).get(field).asText());
            for(String value:values){assertFalse(value.contains("secret"),value);assertFalse(value.contains("host/share"),value);assertTrue(value.contains(safe),value);}
            assertTrue(json.writeValueAsString(projected).length()<=32000);
        }
    }
    @Test void explicitNullResultScalarsRemainDistinctFromMissingOnDetailAndHistory()throws Exception {
        var f=fixture("lease-null-scalar");var s=source();var catalog=(tools.jackson.databind.node.ArrayNode)json.readTree(s.catalog().toFile());((ObjectNode)catalog.get(0).get("tests").get(0)).putNull("expected");Files.writeString(s.catalog(),json.writeValueAsString(catalog));publish(f,s);assign(f,0,"list-task");
        var attempt=data(enqueue(f,"null-scalar",Map.of("exerciseRevision",1,"mode","submit","files",Map.of("ListTask.java","source"))),202);var lease=claim();var result=(ObjectNode)result(lease,"accepted");
        var tests=result.get("tests");((ObjectNode)tests.get(0)).putNull("actual");((ObjectNode)tests.get(1)).remove(List.of("expected","actual"));
        ((ObjectNode)tests.get(2)).put("expected",false).put("actual",true);((ObjectNode)tests.get(3)).put("expected",0).put("actual",0);((ObjectNode)tests.get(4)).put("expected","").put("actual","");
        assertEquals(204,complete(lease,result).statusCode());assertEquals(204,complete(lease,result).statusCode());
        for(var user:List.of(f.teacher(),f.learner()))for(String path:List.of(attempts(f)+"/"+attempt.get("id").asText(),attempts(f))){
            var response=data(get(user.client(),path),200);var projected=(response.has("items")?response.get("items").get(0):response).get("result");var details=projected.get("tests");
            assertAll(()->assertTrue(details.get(0).has("expected")),()->assertTrue(details.get(0).has("actual")));assertTrue(details.get(0).get("expected").isNull());assertTrue(details.get(0).get("actual").isNull());
            assertFalse(details.get(1).has("expected"));assertFalse(details.get(1).has("actual"));assertFalse(details.get(0).has("message"));assertFalse(details.get(0).has("stdout"));
            assertTrue(details.get(2).get("expected").isBoolean());assertFalse(details.get(2).get("expected").asBoolean());assertTrue(details.get(2).get("actual").asBoolean());assertTrue(details.get(3).get("expected").isNumber());assertEquals(0,details.get(3).get("actual").asInt());assertTrue(details.get(4).get("expected").isString());assertEquals("",details.get(4).get("actual").asText());assertTrue(json.writeValueAsString(projected).length()<=32000);
        }
    }
    @ParameterizedTest @ValueSource(strings={"wrong_answer","compile_error","runtime_error","time_limit"})
    void studentVerdictsTerminalizeOnceWithoutInfrastructureRetry(String status)throws Exception {
        var f=fixture("verdict-"+status);publish(f,source());assign(f,0,"list-task");var attempt=data(enqueue(f,"verdict",code("source")),202);var lease=claim();var result=(ObjectNode)result(lease,status);
        if(status.equals("wrong_answer"))for(var selected:lease.get("payload").get("exercise").get("tests")){var test=((tools.jackson.databind.node.ArrayNode)result.get("tests")).addObject();test.put("name",selected.get("name").asText());test.put("status",status);}else if(status.equals("runtime_error")){var test=((tools.jackson.databind.node.ArrayNode)result.get("tests")).addObject();test.put("name",lease.get("payload").get("exercise").get("tests").get(0).get("name").asText());test.put("status",status);}
        assertEquals(204,complete(lease,result).statusCode());assertEquals(204,internal("/claim",Map.of("workerId","next"),workerSecret).statusCode());var completed=data(get(f.learner().client(),attempts(f)+"/"+attempt.get("id").asText()),200);assertEquals("completed",completed.get("jobState").asText());assertEquals(status,completed.get("result").get("status").asText());assertEquals(1,jdbc.queryForObject("SELECT grants FROM practice_job",Integer.class));
    }
    @Test void completionReceiptCanonicalizesNumericResultScalars()throws Exception {
        var f=fixture("lease-canonical");publish(f,source());assign(f,0,"list-task");data(enqueue(f,"canonical",code("source")),202);var lease=claim();var result=result(lease,"accepted");assertEquals(204,complete(lease,result).statusCode());
        String same=json.writeValueAsString(result).replace("[2,2,5,7]","[2.0,2.0,5.0,7.0]");assertEquals(204,complete(lease,PracticeJson.read(same)).statusCode());assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_completion_receipt",Integer.class));
    }
    @Test void invalidStructuredValueKeyUnicodeAndNonfinitePresentationNumbersAreRejected()throws Exception {
        var f=fixture("lease-unicode");publish(f,source());assign(f,0,"list-task");data(enqueue(f,"unicode",code("source")),202);var lease=claim();var result=(ObjectNode)result(lease,"accepted");var actual=json.createObjectNode();actual.put("placeholder",1);((ObjectNode)result.get("tests").get(0)).set("actual",actual);
        String body=json.writeValueAsString(Map.of("leaseToken",lease.get("leaseToken").asText(),"result",result)).replace("placeholder","\\ud800");
        var request=java.net.http.HttpRequest.newBuilder(java.net.URI.create(origin+"/internal/v1/jobs/"+lease.get("jobId").asText()+"/complete")).header("Authorization","Bearer "+workerSecret).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(body)).build();assertEquals(400,worker.send(request,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
        ((ObjectNode)result.get("tests").get(0)).set("actual",PracticeJson.read("1e309"));assertThrows(IllegalArgumentException.class,()->new CheckResult(result).validate(JobPayload.decode(lease.get("payload"))));assertEquals(400,complete(lease,result).statusCode());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_completion_receipt",Integer.class));
    }
    @Test void everyHostPathRootAndUncAreRedactedWhileUrlsAndRelativeJavaRemain()throws Exception {
        var f=fixture("lease-paths");publish(f,source());assign(f,0,"list-task");var attempt=data(enqueue(f,"paths",code("source")),202);var lease=claim();var result=(ObjectNode)result(lease,"accepted");result.put("diagnostics","/srv/runner/secret /mnt/operator/secret /Volumes/secret \\\\host\\share\\secret https://example.com/docs https://example.com/home/docs demo/ListTask.java:5");assertEquals(204,complete(lease,result).statusCode());String diagnostics=data(get(f.learner().client(),attempts(f)+"/"+attempt.get("id").asText()),200).get("result").get("diagnostics").asText();assertFalse(diagnostics.contains("secret"));assertFalse(diagnostics.contains("host"));assertTrue(diagnostics.contains("https://example.com/docs"));assertTrue(diagnostics.contains("https://example.com/home/docs"));assertTrue(diagnostics.contains("demo/ListTask.java:5"));
    }
    @Test void periodicReconciliationFencesExpiredWorkerWithoutAnyFurtherWorkerRequest()throws Exception {
        var f=fixture("lease-periodic");publish(f,source());assign(f,0,"list-task");data(enqueue(f,"periodic",code("source")),202);claim();CLOCK.advance(Duration.ofSeconds(30));
        // Advance the injected clock exactly to expiry; await the scheduler's state predicate, never assume a fixed sleep wins.
        long until=System.nanoTime()+java.time.Duration.ofSeconds(8).toNanos();String state;
        do{state=jdbc.queryForObject("SELECT state FROM practice_job",String.class);if(state.equals("retry_pending"))break;Thread.sleep(20);}while(System.nanoTime()<until);
        assertEquals("retry_pending",state);assertNull(jdbc.queryForObject("SELECT token_hash FROM practice_job",String.class));
    }
    @Test void realApplicationRestartKeepsWaitingAndFencesLostTokensForOnlyTwoGrants()throws Exception {
        var f=fixture("lease-restart");publish(f,source());assign(f,0,"list-task");var attempt=data(enqueue(f,"restart",code("saved source")),202);CLOCK.advance(Duration.ofHours(1));restart();assertEquals(attempt.get("id"),data(enqueue(f,"restart",code("saved source")),202).get("id"));var first=claim();CLOCK.advance(Duration.ofSeconds(30));restart();assertEquals(409,complete(first,result(first,"accepted")).statusCode());var second=claim();assertEquals(first.get("jobId"),second.get("jobId"));CLOCK.advance(Duration.ofSeconds(30));assertEquals(204,internal("/claim",Map.of("workerId","after-loss"),workerSecret).statusCode());assertEquals(409,complete(second,result(second,"accepted")).statusCode());var detail=data(get(f.learner().client(),attempts(f)+"/"+attempt.get("id").asText()),200);assertEquals("failed",detail.get("jobState").asText());assertEquals("saved source",detail.get("files").get("ListTask.java").asText());assertEquals(2,jdbc.queryForObject("SELECT grants FROM practice_job",Integer.class));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_completion_receipt",Integer.class));assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_attempt WHERE result IS NOT NULL",Integer.class));
    }
    @Test void jobAndAttemptSnapshotCannotBeEditedAndExerciseBindingHasCompositeFk()throws Exception {
        var f=fixture("lease-fixed");publish(f,source());assign(f,0,"list-task","grouping-task");var attempt=data(enqueue(f,"fixed",code("immutable source")),202);
        assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("UPDATE practice_job SET payload='{}'::jsonb"));
        assertAll(
            ()->assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("UPDATE practice_attempt SET files='{}'::jsonb")),
            ()->assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("UPDATE practice_attempt SET exercise_revision='2'::jsonb")),
            ()->assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("INSERT INTO practice_attempt(workspace_id,id,assignment_id,account_id,exercise_id,exercise_revision,mode,files,created_at,job_state) SELECT workspace_id,'wrong-binding',assignment_id,account_id,'grouping-task',exercise_revision,mode,files,created_at,job_state FROM practice_attempt WHERE id=?",attempt.get("id").asText()))
        );
    }
    @Test void malformedNullAndWrongAnswerWithoutChecksAreRejectedWithoutConsumingReceipt()throws Exception {
        var f=fixture("lease-shape");publish(f,source());assign(f,0,"list-task");data(enqueue(f,"shape",code("source")),202);var lease=claim();
        var complete=json.createObjectNode();complete.put("leaseToken",lease.get("leaseToken").asText());complete.putNull("result");assertEquals(400,internal("/"+lease.get("jobId").asText()+"/complete",complete,workerSecret).statusCode());assertEquals(400,complete(lease,result(lease,"wrong_answer")).statusCode());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_completion_receipt",Integer.class));assertEquals(204,complete(lease,result(lease,"accepted")).statusCode());
    }
    @Test void competingClaimsOwnOneSlotAndHeartbeatNeverMovesDeadline()throws Exception {
        var f=fixture("lease-claim");publish(f,source());assign(f,0,"list-task");data(enqueue(f,"one",code("source")),202);data(enqueue(f,"two",code("source")),202);
        try(var pool=Executors.newFixedThreadPool(2)){
            var go=new CountDownLatch(1);var a=pool.submit(()->{assertTrue(go.await(5,TimeUnit.SECONDS));return internal("/claim",Map.of("workerId","a"),workerSecret);});var b=pool.submit(()->{assertTrue(go.await(5,TimeUnit.SECONDS));return internal("/claim",Map.of("workerId","b"),workerSecret);});go.countDown();var first=a.get(10,TimeUnit.SECONDS);var second=b.get(10,TimeUnit.SECONDS);assertEquals(List.of(200,204),java.util.stream.Stream.of(first.statusCode(),second.statusCode()).sorted().toList());var lease=json.readTree(first.statusCode()==200?first.body():second.body());
            Instant deadline=Instant.parse(lease.get("deadlineAt").asText()),start=Instant.parse(lease.get("leaseExpiresAt").asText()).minusSeconds(30);assertEquals(start.plusSeconds(90),deadline);
            for(int i=0;i<4;i++){CLOCK.advance(Duration.ofSeconds(20));assertEquals(204,heartbeat(lease).statusCode());assertEquals(deadline,jdbc.queryForObject("SELECT deadline_at FROM practice_job WHERE id=?",java.sql.Timestamp.class,lease.get("jobId").asText()).toInstant());}
            CLOCK.advance(Duration.ofSeconds(10));assertEquals(409,heartbeat(lease).statusCode());assertEquals(409,complete(lease,result(lease,"accepted")).statusCode());var retry=claim();assertEquals(lease.get("jobId"),retry.get("jobId"));assertNotEquals(lease.get("leaseToken"),retry.get("leaseToken"));assertEquals(Instant.parse(retry.get("leaseExpiresAt").asText()).plusSeconds(60),Instant.parse(retry.get("deadlineAt").asText()));
        }
    }
    @Test void retryReservationReceiptReplayAndSecondInfrastructureFailureAreDurable()throws Exception {
        var f=fixture("lease-retry");publish(f,source());assign(f,0,"list-task");var accepted=data(enqueue(f,"first",code("source")),202);var first=claim();
        for(int i=0;i<4;i++)data(enqueue(f,"waiting"+i,code("source")),202);assertEquals(429,enqueue(f,"overflow",code("source")).statusCode());assertEquals(202,enqueue(f,"first",code("source")).statusCode());
        var infra=result(first,"error");assertEquals(204,complete(first,infra).statusCode());assertEquals(204,complete(first,infra).statusCode());assertEquals(409,complete(first,result(first,"unavailable")).statusCode());
        assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM practice_job WHERE state='queued'",Integer.class));assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_job WHERE state='retry_pending'",Integer.class));assertEquals("running",data(get(f.learner().client(),attempts(f)+"/"+accepted.get("id").asText()),200).get("jobState").asText());
        // A new service object reconstructs ownership solely from PG; no process-local counter or token history.
        var manager=context.getBean(org.springframework.transaction.PlatformTransactionManager.class);var queue=new JobQueue(context.getBean(AttemptRepository.class),CLOCK,manager,4,1);var retry=queue.claim("restarted-worker").orElseThrow();assertEquals(first.get("jobId").asText(),retry.jobId());assertEquals(204,complete(first,infra).statusCode());
        var second=json.valueToTree(retry);assertEquals(204,complete(second,result(second,"unavailable")).statusCode());var detail=data(get(f.learner().client(),attempts(f)+"/"+accepted.get("id").asText()),200);assertEquals("failed",detail.get("jobState").asText());assertEquals("unavailable",detail.get("result").get("status").asText());assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_attempt WHERE result IS NOT NULL",Integer.class));assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM practice_completion_receipt",Integer.class));assertNotEquals(first.get("jobId"),claim().get("jobId"));
    }
    @Test void malformedResultsDoNotConsumeLeaseAndPublicProjectionIsBoundedAndPrivateFree()throws Exception {
        var f=fixture("lease-result");publish(f,source());assign(f,0,"list-task");var attempt=data(enqueue(f,"result",code("source")),202);var lease=claim();
        var good=(ObjectNode)result(lease,"accepted");var zero=good.deepCopy();zero.put("total",0);zero.put("passed",0);zero.putArray("tests");assertEquals(400,complete(lease,zero).statusCode());
        var unknown=good.deepCopy();unknown.put("hostPath","/etc/secret");assertEquals(400,complete(lease,unknown).statusCode());var name=good.deepCopy();((ObjectNode)name.get("tests").get(0)).put("name","fabricated");assertEquals(400,complete(lease,name).statusCode());var oversized=good.deepCopy();oversized.put("diagnostics","x".repeat(32000));assertEquals(400,complete(lease,oversized).statusCode());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_completion_receipt",Integer.class));assertEquals(204,heartbeat(lease).statusCode());
        good.put("diagnostics","/home/operator/private /var/lib/secret C:\\Users\\operator\\secret /input/src/ListTask.java https://example.com/docs ListTask.java:5");assertEquals(204,complete(lease,good).statusCode());assertEquals(204,complete(lease,good).statusCode());var detail=data(get(f.teacher().client(),attempts(f)+"/"+attempt.get("id").asText()),200);String serialized=json.writeValueAsString(detail.get("result"));assertTrue(serialized.length()<=32000);assertFalse(serialized.contains("operator"));assertFalse(serialized.contains("/var/lib"));assertTrue(serialized.contains("ListTask.java"));assertTrue(serialized.contains("https://example.com/docs"));assertFalse(detail.has("leaseToken"));assertFalse(serialized.contains("unchangedArguments"));assertEquals("[2,2,5,7]",detail.get("result").get("tests").get(0).get("expected").asText());
    }
    @Test void statelessWorkerSecretRotatesAndRejectsBrowserMarkers()throws Exception {
        var body=Map.of("workerId","synthetic-worker");
        assertEquals(401,internal("/claim",body,null).statusCode());assertEquals(401,internal("/claim",body,"wrong-worker-secret").statusCode());
        assertEquals(204,internal("/claim",body,workerSecret).statusCode());
        for(var header:Map.of("Origin",origin,"Sec-Fetch-Site","same-origin","Cookie","SESSION=synthetic").entrySet())assertEquals(401,internal("/claim",body,workerSecret,header.getKey(),header.getValue()).statusCode());
        String rotated="synthetic-rotated-worker-credential";var replacement=credential.resolveSibling("worker-secret-next");Files.writeString(replacement,"\n"+rotated+"\n");Files.move(replacement,credential,java.nio.file.StandardCopyOption.ATOMIC_MOVE,java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        assertEquals(401,internal("/claim",body,workerSecret).statusCode());var response=internal("/claim",body,rotated);assertEquals(204,response.statusCode());assertTrue(response.headers().allValues("set-cookie").isEmpty());
        var publicRequest=java.net.http.HttpRequest.newBuilder(java.net.URI.create(origin+"/api/v1/admin/teachers")).header("Authorization","Bearer "+rotated).GET().build();assertEquals(401,worker.send(publicRequest,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
        Files.writeString(credential,"invalid\u0000secret-content");assertEquals(401,internal("/claim",body,rotated).statusCode());Files.delete(credential);assertEquals(401,internal("/claim",body,rotated).statusCode());
    }
    @Test void diagnosticsObserveAuthenticatedWorkerWithoutMutatingQueueAndProjectionBoundsEscaping()throws Exception {
        var queue=context.getBean(JobQueue.class);var before=queue.diagnostics();assertEquals(0,before.waiting());assertEquals(0,before.running());assertEquals(0,before.retryPending());assertEquals(1,before.configuredSlots());
        assertEquals(204,internal("/claim",Map.of("workerId","diagnostic"),workerSecret).statusCode());var seen=queue.diagnostics().lastWorkerSeenAt();assertNotNull(seen);CLOCK.advance(Duration.ofSeconds(1));assertEquals(401,internal("/claim",Map.of("workerId","bad"),null).statusCode());assertEquals(seen,queue.diagnostics().lastWorkerSeenAt());
        var f=fixture("lease-escaping");publish(f,source());assign(f,0,"list-task");var attempt=data(enqueue(f,"escaping",code("source")),202);var lease=claim();var result=(ObjectNode)result(lease,"accepted");var actual=json.createObjectNode();actual.put("text","\\".repeat(14000));((ObjectNode)result.get("tests").get(0)).set("actual",actual);assertTrue(json.writeValueAsString(result).length()<32000);assertEquals(204,complete(lease,result).statusCode());var publicResult=data(get(f.learner().client(),attempts(f)+"/"+attempt.get("id").asText()),200).get("result");assertTrue(json.writeValueAsString(publicResult).length()<=32000);assertEquals("accepted",publicResult.get("status").asText());assertTrue(publicResult.get("tests").get(0).get("actual").isString());
    }
}
