package ru.mentor.runner;

import com.fasterxml.jackson.core.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.annotation.JsonInclude;
import ru.mentor.runner.protocol.CheckResult;
import ru.mentor.runner.protocol.TestResult;

final class Json {
    static final ObjectMapper MAPPER = new ObjectMapper(JsonFactory.builder()
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
        .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(100).maxStringLength(2_000_000).build()).build())
        .registerModule(new JavaTimeModule()).disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .addMixIn(CheckResult.class,OptionalResultText.class).addMixIn(TestResult.class,OptionalTestText.class);
    // The frozen protocol allows absent optional text, not null text. Expected/actual JSON null stays explicit.
    private abstract static class OptionalResultText {
        @JsonInclude(JsonInclude.Include.NON_NULL) abstract String getDiagnostics();
    }
    private abstract static class OptionalTestText {
        @JsonInclude(JsonInclude.Include.NON_NULL) abstract String getMessage();
        @JsonInclude(JsonInclude.Include.NON_NULL) abstract String getStdout();
    }
    private Json() {}
}
