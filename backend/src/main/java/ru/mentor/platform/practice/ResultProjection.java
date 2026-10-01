package ru.mentor.platform.practice;
import org.springframework.stereotype.Component;
import com.fasterxml.jackson.annotation.JsonInclude;
import tools.jackson.databind.JsonNode;
import java.util.*;
@Component
public class ResultProjection {
    // A missing detail is optional; an explicitly reported JSON null is still a scalar value.
    public static final class AbsentValue {
        public AbsentValue(){}
        @Override public boolean equals(Object value){return value instanceof AbsentValue;}
        @Override public int hashCode(){return AbsentValue.class.hashCode();}
    }
    private static final AbsentValue ABSENT=new AbsentValue();
    @JsonInclude(JsonInclude.Include.NON_NULL) public record PublicTest(String name,String status,
        @JsonInclude(value=JsonInclude.Include.CUSTOM,valueFilter=AbsentValue.class) Object expected,
        @JsonInclude(value=JsonInclude.Include.CUSTOM,valueFilter=AbsentValue.class) Object actual,String message,String stdout){}
    @JsonInclude(JsonInclude.Include.NON_NULL) public record PublicResult(String status,int passed,int total,long elapsedMs,String diagnostics,List<PublicTest> tests) {public PublicResult {tests=List.copyOf(tests);}}
    public PublicResult project(CheckResult result){
        var n=result.value();int budget=32000;
        for(;;){var tests=new ArrayList<PublicTest>();for(var t:n.get("tests"))tests.add(new PublicTest(text(t.get("name"),Math.min(200,budget)),t.get("status").asText(),scalar(t.get("expected"),budget),scalar(t.get("actual"),budget),text(t.get("message"),budget),text(t.get("stdout"),budget)));
            var out=new PublicResult(n.get("status").asText(),n.get("passed").asInt(),n.get("total").asInt(),n.get("elapsedMs").asLong(),text(n.get("diagnostics"),budget),tests);
            if(PracticeJson.MAPPER.writeValueAsString(out).length()<=32000)return out;budget/=2;
        }
    }
    private Object scalar(JsonNode n,int budget){if(n==null)return ABSENT;if(n.isNull())return null;if(n.isBoolean())return n.asBoolean();if(n.isNumber())return n.decimalValue();return text(n.isString()?n:PracticeJson.MAPPER.valueToTree(PracticeJson.MAPPER.writeValueAsString(n)),budget);}
    static String text(JsonNode n,int budget){if(n==null||n.isNull())return null;String text=n.asText();
        // Keep ordinary URLs and relative Java locations; remove host filesystem roots in diagnostics/output.
        // Scan whole tokens once: actual filesystem schemes precede URLs at the same position,
        // while a complete ordinary URL wins over file: or /input/src/ text inside its path.
        var matcher=java.util.regex.Pattern.compile(
            "(?<![A-Za-z0-9+._/\\\\:-])(?i:(?:[A-Za-z][A-Za-z0-9+.-]*:)*file:)[\\\\/][^\\s\"'<>]+"
            +"|(?<url>[A-Za-z][A-Za-z0-9+.-]*://[^\\s\"'<>]+)"
            +"|(?<![A-Za-z0-9._/\\\\:-])(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/)[^\\s\"'<>]+").matcher(text);var safe=new StringBuffer();
        while(matcher.find()){
            String location=matcher.group();String replacement=matcher.group("url")!=null?location:location.startsWith("/input/src/")?location.substring("/input/src/".length()):"[path]";
            matcher.appendReplacement(safe,java.util.regex.Matcher.quoteReplacement(replacement));
        }matcher.appendTail(safe);text=safe.toString();
        int end=Math.min(budget,text.length());if(end>0&&end<text.length()&&Character.isHighSurrogate(text.charAt(end-1)))end--;return text.substring(0,end);
    }
}
