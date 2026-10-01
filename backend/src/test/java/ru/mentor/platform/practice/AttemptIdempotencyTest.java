package ru.mentor.platform.practice;

import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import java.nio.charset.StandardCharsets;

class AttemptIdempotencyTest extends AttemptHttpTest {
    @Test void admissionCapacityIsAtomicAcrossIndependentWorkspaces()throws Exception {
        var a=fixture("capacity-a");publish(a,source());assign(a,0,"list-task");var b=fixture("capacity-b");publish(b,source());assign(b,0,"list-task");
        try(var pool=Executors.newFixedThreadPool(8)){
            var start=new CountDownLatch(1);var requests=new ArrayList<Future<Integer>>();for(int i=0;i<8;i++){final int key=i;requests.add(pool.submit(()->{assertTrue(start.await(5,TimeUnit.SECONDS));return enqueue(key%2==0?a:b,"capacity"+key,code("source")).statusCode();}));}start.countDown();var statuses=new ArrayList<Integer>();for(var request:requests)statuses.add(request.get(15,TimeUnit.SECONDS));assertEquals(4,statuses.stream().filter(s->s==202).count());assertEquals(4,statuses.stream().filter(s->s==429).count());assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM practice_attempt",Integer.class));assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM practice_job",Integer.class));
        }
    }
    @Test void numericTypeCanonicalReplayAndOutdatedDraftRequireExplicitReset()throws Exception {
        var f=fixture("attempt-draft");var source=source();publish(f,source);assign(f,0,"list-task");var body=code("source");var first=data(enqueue(f,"typed",body),202);var numeric=new LinkedHashMap<String,Object>(body);numeric.put("exerciseRevision",new java.math.BigDecimal("1.0"));assertEquals(first.get("id"),data(enqueue(f,"typed",numeric),202).get("id"));numeric.put("exerciseRevision","1");assertEquals(409,enqueue(f,"typed",numeric).statusCode());
        data(write(f.learner().client(),"PUT",draftPath(f,"list-task"),save(1,0,Map.of("ListTask.java","old saved source"))),200);revision(source,"1");publish(f,source);var fresh=new LinkedHashMap<String,Object>(body);fresh.put("exerciseRevision","1");assertEquals(409,enqueue(f,"current",fresh).statusCode());var reset=new LinkedHashMap<>(save("1",1,Map.of("ListTask.java","reset source")));reset.put("resetForRevision","1");data(write(f.learner().client(),"PUT",draftPath(f,"list-task"),reset),200);assertEquals(202,enqueue(f,"current",fresh).statusCode());assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM practice_attempt",Integer.class));assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_draft_archive",Integer.class));
    }
    @Test void bodyAndIdempotencyBoundariesRejectBeforeReservationWithExactDecimalParsing()throws Exception {
        var f=fixture("attempt-input");publish(f,source());assign(f,0,"list-task");String input=json.writeValueAsString(code("source"));byte[] bytes=input.getBytes(StandardCharsets.UTF_8);
        for(String key:Arrays.asList(null,"bad key","a".repeat(129)))assertEquals(400,enqueue(f,key,code("source")).statusCode());assertEquals(400,submit(f,"duplicate",bytes,false,"application/json","Idempotency-Key","other").statusCode());
        var fractional=new LinkedHashMap<String,Object>(code("source"));fractional.put("exerciseRevision",new java.math.BigDecimal("1.0000000000000000000001"));assertEquals(400,enqueue(f,"fractional",fractional).statusCode());
        var privateField=new LinkedHashMap<String,Object>(code("source"));privateField.put("environment",Map.of("imageDigest","arbitrary"));assertEquals(400,enqueue(f,"private",privateField).statusCode());assertEquals(400,enqueue(f,"files",Map.of("exerciseRevision",1,"mode","run","files",Map.of("Other.java","source"))).statusCode());
        String padded=input+" ".repeat(1605632-bytes.length);for(boolean chunked:List.of(false,true))assertEquals(413,submit(f,"oversized",(padded+" ").getBytes(StandardCharsets.UTF_8),chunked,"application/vnd.mentor+json").statusCode());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_attempt",Integer.class));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_job",Integer.class));assertEquals(202,submit(f,"exact",padded.getBytes(StandardCharsets.UTF_8),true,"application/vnd.mentor+json").statusCode());
    }
    @Test void teacherAdminAndForeignStudentCannotReadOrWriteButCompletionDoesNotRestoreDisabledAccount()throws Exception {
        var f=fixture("attempt-own");publish(f,source());assign(f,0,"list-task");var accepted=data(enqueue(f,"owned",code("source")),202);String detail=attempts(f)+"/"+accepted.get("id").asText();var other=fixture("attempt-other");
        assertEquals(404,get(admin,detail).statusCode());assertEquals(404,get(other.learner().client(),detail).statusCode());
        // Teacher request carries all transport fields; adding the required key reveals role denial, not header validation.
        var session=session(f.teacher().client());var request=java.net.http.HttpRequest.newBuilder(java.net.URI.create(origin+"/api/v1"+attempts(f))).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",f.teacher().id()).header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Idempotency-Key","teacher").header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(code("source")))).build();assertEquals(403,f.teacher().client().send(request,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
        var lease=claim();jdbc.update("UPDATE identity_account SET disabled=true WHERE id=?",f.learner().id());assertEquals(204,complete(lease,result(lease,"accepted")).statusCode());assertEquals(401,get(f.learner().client(),detail).statusCode());assertEquals("completed",data(get(f.teacher().client(),detail),200).get("jobState").asText());
    }
    @Test void assignmentRevokedAfterEnqueueKeepsCompletionHistoryAndCommittedReplay()throws Exception {
        var f=fixture("attempt-remove");var source=source();publish(f,source);assign(f,0,"list-task");var accepted=data(enqueue(f,"committed",code("exact old source")),202);var lease=claim();assertEquals(2,lease.get("payload").get("exercise").get("tests").size());assertEquals(Set.of("id","revision","imageDigest"),lease.get("payload").get("environment").propertyNames());assertFalse(lease.get("payload").get("exercise").has("starterFiles"));
        assign(f,1);revision(source,"new");publish(f,source);assertEquals(202,enqueue(f,"committed",code("exact old source")).statusCode());assertEquals(404,enqueue(f,"new-key",code("exact old source")).statusCode());assertEquals(204,complete(lease,result(lease,"accepted")).statusCode());var detail=data(get(f.learner().client(),attempts(f)+"/"+accepted.get("id").asText()),200);assertEquals("completed",detail.get("jobState").asText());assertEquals(1,detail.get("exerciseRevision").asInt());assertEquals("exact old source",detail.get("files").get("ListTask.java").asText());assertEquals(1,data(get(f.teacher().client(),attempts(f)),200).get("total").asInt());
        jdbc.update("UPDATE identity_account SET disabled=true WHERE id=?",f.learner().id());assertEquals(401,get(f.learner().client(),attempts(f)).statusCode());assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_attempt",Integer.class));
    }
    @Test void concurrentSameKeyHasOneAttemptAndJobAndChangedPayloadConflicts()throws Exception {
        var f=fixture("attempt-replay");publish(f,source());assign(f,0,"list-task");
        var ready=new CountDownLatch(2);var go=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)){
            var jobs=new ArrayList<Future<tools.jackson.databind.JsonNode>>();
            for(int i=0;i<2;i++)jobs.add(pool.submit(()->{ready.countDown();assertTrue(go.await(10,TimeUnit.SECONDS));return data(enqueue(f,"same-key",code("  class ListTask {}\n")),202);}));
            assertTrue(ready.await(10,TimeUnit.SECONDS));go.countDown();var first=jobs.get(0).get(15,TimeUnit.SECONDS);var second=jobs.get(1).get(15,TimeUnit.SECONDS);assertEquals(first.get("id"),second.get("id"));
            assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_attempt",Integer.class));assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_job",Integer.class));
            assertEquals(409,enqueue(f,"same-key",code("changed")).statusCode());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_draft",Integer.class));
            var listing=data(get(f.learner().client(),attempts(f)),200);assertFalse(listing.get("items").get(0).has("files"));assertEquals("  class ListTask {}\n",data(get(f.learner().client(),attempts(f)+"/"+first.get("id").asText()),200).get("files").get("ListTask.java").asText());
        }
    }
}
