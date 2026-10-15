package ru.mentor.platform.homework;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/** Latest homework exchanges used to show whose turn it is; all fields are visible to the student of that card. */
public final class HomeworkTurns {
    private HomeworkTurns(){}
    /** The latest exchange of one lesson: a homework file, or a submitted trainer attempt of a homework-placement exercise (kind attempt). */
    public record LessonTurn(String lessonId,String submissionId,String kind,String filename,ReviewStatus status,Instant createdAt,
                             @JsonInclude(JsonInclude.Include.NON_NULL) Instant reviewedAt) {}
    /** One row per student: the oldest lesson awaiting review, otherwise the latest exchange. */
    public record StudentTurn(String studentId,String studentName,String lessonId,String lessonTitle,String lessonDate,String submissionId,String kind,
                              String filename,String comment,ReviewStatus status,Instant createdAt,
                              @JsonInclude(JsonInclude.Include.NON_NULL) Instant reviewedAt,long awaitingReview) {}
}
