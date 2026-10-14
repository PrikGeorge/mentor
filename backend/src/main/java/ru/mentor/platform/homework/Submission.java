package ru.mentor.platform.homework;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

public record Submission(String id,String filename,long size,Instant createdAt,String comment,String repositoryUrl,
                         ReviewStatus status,String feedback,@JsonInclude(JsonInclude.Include.NON_NULL) Instant reviewedAt,long revision,
                         @JsonInclude(JsonInclude.Include.NON_NULL) Grade grade) {}
