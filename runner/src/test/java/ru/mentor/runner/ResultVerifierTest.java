package ru.mentor.runner;

import org.junit.jupiter.api.Test;
import ru.mentor.runner.protocol.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ResultVerifierTest {
    @Test void rejectsMissingWrongDuplicateNonceIncompleteAndOutputOnlyPass() {
        TestCase test=new TestCase().name("case").args(List.of()).unchangedArguments(Set.of()).expected(List.of(1));
        for(String output:List.of("PASS","{\"nonce\":\"evil\",\"completed\":true,\"actual\":[1],\"before\":[],\"after\":[]}","{\"nonce\":\"secret\",\"completed\":false,\"actual\":[1],\"before\":[],\"after\":[]}","{\"nonce\":\"secret\",\"nonce\":\"secret\",\"completed\":true,\"actual\":[1],\"before\":[],\"after\":[]}","{\"completed\":true,\"actual\":[1],\"before\":[],\"after\":[]}")) {
            var checked=new ResultVerifier().verify(test,"secret",new BoundedProcess.ProcessResult(0,output,"",null));
            assertEquals(TestResult.StatusEnum.RUNTIME_ERROR,checked.getStatus());
        }
    }
    @Test void numericStructuralEqualityAndNullAreComparedWithoutCoercingStrings() {
        TestCase test=new TestCase().name("case").args(List.of()).unchangedArguments(Set.of()).expected(List.of(1));
        String protocol="{\"nonce\":\"secret\",\"completed\":true,\"actual\":[1.0],\"before\":[],\"after\":[]}";
        assertEquals(TestResult.StatusEnum.ACCEPTED,new ResultVerifier().verify(test,"secret",new BoundedProcess.ProcessResult(0,protocol,"",null)).getStatus());
        test.setExpected(List.of("1"));
        assertEquals(TestResult.StatusEnum.WRONG_ANSWER,new ResultVerifier().verify(test,"secret",new BoundedProcess.ProcessResult(0,protocol,"",null)).getStatus());
    }
    @Test void wholeResultBudgetKeepsVerdictWithoutOversizedStudentOutput() throws Exception {
        List<TestResult> cases=new ArrayList<>();
        for(int i=0;i<10;i++) cases.add(new TestResult().name("case").status(TestResult.StatusEnum.WRONG_ANSWER).stdout("x".repeat(16000)).actual("y".repeat(20000)).expected("z".repeat(20000)));
        var result=new ResultVerifier().bounded(new CheckResult(CheckResult.StatusEnum.WRONG_ANSWER,0,10,10L,cases));
        assertTrue(Json.MAPPER.writeValueAsString(result).length()<=32000); assertEquals(CheckResult.StatusEnum.WRONG_ANSWER,result.getStatus()); assertEquals(10,result.getTests().size());
    }
}
