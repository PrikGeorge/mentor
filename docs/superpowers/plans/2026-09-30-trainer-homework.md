# Trainer and Homework Implementation Plan

> Implementation uses parallel agents with disjoint file ownership and one integration owner. Preserve all existing uncommitted work. No commits, publishing or purchases in this task.

**Goal:** Add teacher-defined Java exercises with fixed dependencies, saved attempts, and uploaded homework with manual review.

**Architecture:** New private training catalog and bounded Java runner; separate atomic practice store/API; lazy browser practice UI integrated into the existing hash router.

**Tech Stack:** Existing Node built-ins, Java 21, prepared Maven artifacts, Docker where available, bundled Monaco reused from algocode-local.

**Spec:** ../specs/2026-09-30-trainer-homework-design.md

## Global constraints

- Existing data/mentoring.json and original algocode-local remain untouched. Work on codex/trainer-homework in the existing checkout; exact pre-task source snapshot is C:/Users/George/AppData/Local/Temp/mentor-before-trainer-f3a0e48711974c4abfac9efc1eb8ac01.
- Keep localhost binding and current documents. Authentication/public deployment is a subsequent stage, not silently implied by the student display mode.
- Student source cannot select commands, dependencies, tests or filesystem paths. Uploads are never unpacked or executed.
- Teaching text stays Russian. Keep the current palette and accessible controls. No fake progress or fabricated test success.
- New state uses supplied temporary dataDir in all write tests.

## Interfaces

Catalog exports createCatalog({root?}) => {list(), get(id), environments(), publicExercise(exercise)}. list/get return private exercise records with {id,revision,title,statement,environmentId,starterFiles: {relativeJavaPath: source},tests:[...]}. publicExercise strips test sources and returns {id,revision,title,statement,environment:{id,title,javaVersion,dependencies},starterFiles}. private test/runner format is owned by the runner task.

Runner exports createJavaRunner({catalog,cacheDir?,mode?}) => {status(): Promise<{available,mode,message}>, run(exercise,files,mode):Promise<result>,close()}. mode is run or submit; result = {status,passed,total,elapsedMs,diagnostics?,tests:[{name,status,expected?,actual?,message?,stdout?}]}. statuses accepted,wrong_answer,compile_error,runtime_error,time_limit,error,unavailable. No false successes when a checker does not finish.

API factory createPracticeApi({store,catalog,runner,dataDir}) => async handle(request,response,pathname): boolean; it returns false for unrelated paths. It owns its JSON/binary responses and bounded request parsing, delegating parent Host/Origin checks to server.cjs. store is existing mentoring createStore object.

- GET /api/practice/catalog => {exercises:[publicExercise],environments:[...]}
- GET /api/students/:sid/lessons/:lid/practice => {exercises:[publicExercise + {placement,draft,attempts}],submissions:[...],runner:{available,mode,message}}
- POST same base /practice/assignments {assignments:[{exerciseId,placement:'class'|'homework'}]} => current practice view
- PATCH /practice/exercises/:id/draft {files,revision,exerciseRevision,resetForExerciseRevision?} => {draft:{files,updatedAt,revision,exerciseRevision,outdated}}; reject stale draft or exercise revision 409, preserve client code. Explicit reset after a catalog update archives the prior saved draft.
- POST /practice/exercises/:id/attempts {files,exerciseRevision,mode:'run'|'submit'} => {attempt:{id,createdAt,mode,exerciseRevision,files,result}}. Reject stale exercise revision before execution. Persist exact checked source and result. Summary attempts omit files; GET /practice/exercises/:id/attempts/:attemptId returns {attempt}.
- POST same lesson base /homework {filename,contentBase64,comment,repositoryUrl} => {submission}. Max decoded 20 MiB; required file; repo optional HTTPS. Allowed zip/java/txt/md/pdf.
- GET /homework/:submissionId/file => attachment, never inline; owner path must match.
- PATCH /homework/:submissionId {status:'reviewed'|'needs_revision',feedback} => {submission}.

Submission = {id,filename,size,createdAt,comment,repositoryUrl,status:'submitted'|'reviewed'|'needs_revision',feedback,reviewedAt?}. GET practice contains safe metadata; no disk paths.

Browser exports window.MENTOR_PRACTICE.mount(container,{studentId,lessonId,presentation,page,exerciseId?}) and dispose(). page is tasks,homework,practice (teacher dashboard when !presentation and no exerciseId). It constructs existing route helpers for links; student full editor route is /student/practice/:id, teacher dashboard /teacher/practice. Summary mount in tasks/homework must fit existing document page. Teacher dashboard assigns exercises, inspects attempts and reviews submissions. Monaco lazy-loads dist/vendor/monaco. CSS owns practice-* classes only.

## Tasks and file ownership

### 1. Catalog and runner
Files: lib/training-catalog.cjs, lib/java-runner.cjs and focused helpers; training/**; scripts/prepare-training.cjs; test/training-*.test.cjs.
- [x] Write failure tests for catalog filtering, named source allowlist, seeded exercises, checker truth, time/output bounds and dependency profile.
- [x] Reuse execution/editor concepts from algocode-local; implement trusted checks for ListTask/GroupingTask preserving signatures and mutation tests.
- [x] Implement fixed profile preparation and prove a dependency-using task executes.
- [x] Verify runner outcomes with actual Java; isolate Docker support and report environment availability precisely.

### 2. Practice state and HTTP API
Files: lib/practice-store.cjs, lib/practice-api.cjs, test/practice-*.test.cjs. Does not edit server.cjs.
- [x] Write failing persistence, ownership, revision-conflict, archive storage/download and review tests.
- [x] Implement independent atomic storage, API and default assignment only for Michael's prepared lesson.
- [x] Verify validation/limits and that client metadata never selects trusted checker code.

### 3. Browser practice UI
Files: dist/practice.js, dist/practice.css, dist/vendor/monaco/**, test/practice-ui.test.cjs if meaningful. Does not edit portal.js/model/index.
- [x] Reuse Monaco loader/editor behaviors from original trainer, preserving vendor license.
- [x] Build list/editor/results, multi-file drafts, history, homework uploads and review UI.
- [x] Add teacher assignment controls using catalog and class/homework placement.
- [x] Handle stale responses, autosave conflicts and navigation without losing typed source.

### 4. Integration and verification (primary agent)
Files: server.cjs, dist/portal.js, dist/portal-model.js, dist/index.html, check.cjs, README.md, .gitignore and routing/integration tests.
- [x] Mount practice API behind existing local request validation; instantiate catalog/runner with shutdown cleanup.
- [x] Add practice routes/tabs/entry points and load new assets; keep printed documents intact.
- [x] Run full existing/new test suites and content checks; independently review against pre-task snapshot.
- [x] Browser test both roles, Monaco editing, actual accepted/rejected Java, upload/download/review, saved drafts and 390px layouts using temporary storage.
- [x] Restart the owned local server with new code, verify live database hash unchanged, document setup and remaining publication prerequisites.

## Review focus

- A late autosave/run response after changing route must not overwrite another exercise or claim the new source passed.
- A student's edited main/System.exit/empty output must never be accepted as successful checker completion.
- Stored data and uploads must remain outside static paths, even with encoded traversal and Windows path quirks.
- Changing exercise revision invalidates prior draft assumptions without discarding saved attempts silently.
- Docker being unavailable must never silently select unrestricted public execution or fabricated results.

## Verified outcome (2026-09-30)

- Full integrated `node --test`: 112 passed, zero failures/skips, including real local Java and Docker/Jackson execution. After the final narrow restored-backup cleanup, the full UI test file passed 14/14 again; `node check.cjs` passed.
- Browser on isolated temporary storage: Monaco edit, source compilation error and successful ListTask 6/6, saved draft after reload, immutable history, two-file Jackson task 4/4, sample-only success wording, assignment, upload, byte-identical download, teacher feedback visible to student, and 390px layout without page overflow. No browser console errors observed.
- Independent review findings were reproduced and fixed: numeric JSON spoofing in checker, stale first-save exercise version, removed-file recovery, reset editing race, and concurrent-tab recovery ownership. Final independent review: no remaining actionable findings.
- Local server restarted at 127.0.0.1:4173 with Docker available. Working mentoring.json SHA-256 unchanged: A67C0A37B2E444C6C60766A0594378AC265663B7597391B90C972E705191A324. Live practice has the two intended exercises and no test submissions/attempts. Temporary browser server stopped.
- Setup and exercise authoring documented in README.md and training/README.md. No hosting purchase, publication, commits, or pushes performed.
