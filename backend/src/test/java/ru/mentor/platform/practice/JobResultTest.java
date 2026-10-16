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

/** What a completed job may report — exact text, redacted paths, scalar shapes and malformed results (Q-20). */
class JobResultTest extends AttemptHttpTest {
    @Test void ordinaryResultTextAndWholeUrlsRemainExactBesideFilesystemUris()throws Exception {
        var f=fixture("lease-uri-preserve");publish(f,source());assign(f,0,"list-task");var attempt=data(enqueue(f,"uri-preserve",code("source")),202);var lease=claim();var result=(ObjectNode)result(lease,"accepted");
        String ordinary="profile:active https://example.com/profile:settings https://example.com/file:notes http://example.com/file:/notes?q=profile:active https://example.com/input/src/Profile.java demo/Profile.java:5";
        String input=ordinary+" file:/srv/secret jar:file:///srv/secret.jar!/pkg/Foo.class";String expected=ordinary+" [path] [path]";
        result.put("diagnostics",input);var test=(ObjectNode)result.get("tests").get(0);for(String field:List.of("expected","actual","message","stdout"))test.put(field,input);assertEquals(204,complete(lease,result).statusCode());
        for(var user:List.of(f.teacher(),f.learner()))for(String path:List.of(attempts(f)+"/"+attempt.get("id").asText(),attempts(f))){
            var response=data(get(user.client(),path),200);var projected=(response.has("items")?response.get("items").get(0):response).get("result");assertEquals(expected,projected.get("diagnostics").asText());for(String field:List.of("expected","actual","message","stdout"))assertEquals(expected,projected.get("tests").get(0).get(field).asText());assertTrue(json.writeValueAsString(projected).length()<=32000);
        }
    }
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
    @Test void malformedNullAndWrongAnswerWithoutChecksAreRejectedWithoutConsumingReceipt()throws Exception {
        var f=fixture("lease-shape");publish(f,source());assign(f,0,"list-task");data(enqueue(f,"shape",code("source")),202);var lease=claim();
        var complete=json.createObjectNode();complete.put("leaseToken",lease.get("leaseToken").asText());complete.putNull("result");assertEquals(400,internal("/"+lease.get("jobId").asText()+"/complete",complete,workerSecret).statusCode());assertEquals(400,complete(lease,result(lease,"wrong_answer")).statusCode());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_completion_receipt",Integer.class));assertEquals(204,complete(lease,result(lease,"accepted")).statusCode());
    }
    @Test void malformedResultsDoNotConsumeLeaseAndPublicProjectionIsBoundedAndPrivateFree()throws Exception {
        var f=fixture("lease-result");publish(f,source());assign(f,0,"list-task");var attempt=data(enqueue(f,"result",code("source")),202);var lease=claim();
        var good=(ObjectNode)result(lease,"accepted");var zero=good.deepCopy();zero.put("total",0);zero.put("passed",0);zero.putArray("tests");assertEquals(400,complete(lease,zero).statusCode());
        var unknown=good.deepCopy();unknown.put("hostPath","/etc/secret");assertEquals(400,complete(lease,unknown).statusCode());var name=good.deepCopy();((ObjectNode)name.get("tests").get(0)).put("name","fabricated");assertEquals(400,complete(lease,name).statusCode());var oversized=good.deepCopy();oversized.put("diagnostics","x".repeat(32000));assertEquals(400,complete(lease,oversized).statusCode());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_completion_receipt",Integer.class));assertEquals(204,heartbeat(lease).statusCode());
        good.put("diagnostics","/home/operator/private /var/lib/secret C:\\Users\\operator\\secret /input/src/ListTask.java https://example.com/docs ListTask.java:5");assertEquals(204,complete(lease,good).statusCode());assertEquals(204,complete(lease,good).statusCode());var detail=data(get(f.teacher().client(),attempts(f)+"/"+attempt.get("id").asText()),200);String serialized=json.writeValueAsString(detail.get("result"));assertTrue(serialized.length()<=32000);assertFalse(serialized.contains("operator"));assertFalse(serialized.contains("/var/lib"));assertTrue(serialized.contains("ListTask.java"));assertTrue(serialized.contains("https://example.com/docs"));assertFalse(detail.has("leaseToken"));assertFalse(serialized.contains("unchangedArguments"));assertEquals("[2,2,5,7]",detail.get("result").get("tests").get(0).get("expected").asText());
    }
}
