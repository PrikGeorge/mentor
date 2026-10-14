-- A mentor's mark on a reviewed work: a chess-style sign that the interface always shows together with its word.
ALTER TABLE homework_submission ADD COLUMN grade TEXT
 CHECK(grade IN ('excellent','good','interesting','dubious','mistake'));
ALTER TABLE homework_submission ADD CONSTRAINT homework_grade_after_review CHECK(grade IS NULL OR status<>'submitted');
