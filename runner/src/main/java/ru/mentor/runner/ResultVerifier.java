package ru.mentor.runner;

import com.fasterxml.jackson.databind.JsonNode;
import ru.mentor.runner.protocol.*;
import java.util.*;

/** Interprets only the trusted, nonce-bound protocol, never student stdout. */
public final class ResultVerifier {
    public TestResult verify(TestCase test, String nonce, BoundedProcess.ProcessResult process) {
        TestResult result=new TestResult().name(test.getName()).status(TestResult.StatusEnum.RUNTIME_ERROR).expected(test.getExpected());
        if("timeout".equals(process.reason())) return result.status(TestResult.StatusEnum.TIME_LIMIT).message("Превышено время выполнения теста.");
        if("output_limit".equals(process.reason())) return result.message("Превышен допустимый объём вывода.");
        if(!process.successful()) return result.message("Проверяющий процесс завершился без результата.");
        try {
            JsonNode checked=Json.MAPPER.readTree(process.stdout());
            if(!checked.isObject() || !nonce.equals(checked.path("nonce").asText())) throw new IllegalArgumentException();
            if(checked.has("stdout")) result.setStdout(limit(checked.path("stdout").asText(),16000));
            if("runtime_error".equals(checked.path("status").asText())) return result.message(sanitize(checked.path("message").asText("Ошибка выполнения.")));
            JsonNode before=checked.path("before"), after=checked.path("after");
            if(!checked.path("completed").isBoolean() || !checked.path("completed").booleanValue() || !checked.has("actual") || !before.isArray() || !after.isArray() || before.size()!=test.getArgs().size() || after.size()!=before.size()) throw new IllegalArgumentException();
            boolean mutation=false;
            for(int index:test.getUnchangedArguments()) {
                if(index<0 || index>=before.size()) throw new IllegalArgumentException();
                mutation|=!equivalent(before.get(index),after.get(index));
            }
            result.setActual(Json.MAPPER.convertValue(checked.get("actual"),Object.class));
            result.setStatus(!mutation && equivalent(checked.get("actual"),Json.MAPPER.valueToTree(test.getExpected())) ? TestResult.StatusEnum.ACCEPTED : TestResult.StatusEnum.WRONG_ANSWER);
            if(mutation) result.setMessage("Решение изменило входные данные, которые должны оставаться неизменными.");
            return result;
        } catch(Exception invalid) { return result.message("Проверяющий процесс не вернул корректный завершённый результат."); }
    }
    static boolean equivalent(JsonNode left, JsonNode right) {
        if(left==null || right==null) return left==right;
        if(left.isNumber() && right.isNumber()) return left.decimalValue().compareTo(right.decimalValue())==0;
        if(left.isArray() && right.isArray()) {
            if(left.size()!=right.size()) return false;
            for(int i=0;i<left.size();i++) if(!equivalent(left.get(i),right.get(i))) return false;
            return true;
        }
        if(left.isObject() && right.isObject()) {
            if(left.size()!=right.size()) return false;
            var fields=left.fieldNames(); while(fields.hasNext()) { String key=fields.next(); if(!equivalent(left.get(key),right.get(key))) return false; }
            return true;
        }
        return left.equals(right);
    }
    static String limit(String text,int size) { return text==null?null:text.substring(0,Math.min(size,text.length())); }
    static String sanitize(String text) {
        return limit(text.replace("/input/src/","").replace("/work/classes/","").replace("/opt/mentor/","[runner]/"),4000);
    }
    public CheckResult bounded(CheckResult result) {
        // The backend independently validates the same global serialized character ceiling.
        try {
            if(Json.MAPPER.writeValueAsString(result).length()<=32000) return result;
            for(TestResult test:result.getTests()) {
                test.setStdout(null); test.setActual(null); test.setExpected(null);
                test.setMessage(limit(test.getMessage(),500));
            }
            if(Json.MAPPER.writeValueAsString(result).length()>32000) throw new IllegalArgumentException("Oversized summary");
            return result;
        } catch(Exception error) {
            return new CheckResult(CheckResult.StatusEnum.ERROR,0,0,result.getElapsedMs(),List.of()).diagnostics("Результат превысил допустимый объём.");
        }
    }
}
