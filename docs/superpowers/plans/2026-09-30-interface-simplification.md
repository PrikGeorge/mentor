# Interface Simplification Implementation Plan

> **For agentic workers:** Use parallel agents for the separate rendering files; the primary agent integrates shared styles and browser behavior. Track completion below.

**Goal:** Make current teacher and student pages easier to navigate and read while preserving their green/sand visual style.

**Architecture:** Keep the existing local Node server, data schema, vanilla JavaScript renderers and hash routes. Improve presentation and navigation without replacing the application or changing stored learning records.

**Tech Stack:** Node.js built-ins, browser JavaScript, CSS, existing Python Markdown compiler.

**Spec:** The seven improvement areas proposed in this chat and approved by the user on 2026-09-30.

## Global Constraints

- Preserve existing working-tree changes; compare against the saved pre-task snapshot, not repository HEAD.
- Work in the current checkout because the reviewed application includes uncommitted files.
- Preserve every existing document section ID and student/teacher boundary.
- No new runtime dependencies, external publishing, authentication or fabricated progress.
- Keep complete teaching material available for reading, printing and download.
- Browser write checks must use a separate temporary data directory.

## Review Focus

- A student with no lessons or documents must not inherit Michael's material.
- A future lesson must not hide the nearest current lesson; dates use Moscow time.
- Deep links must open collapsed sections and place keyboard focus at their heading.
- Printed documents must include collapsed explanations and route details.
- At 390 px, navigation, forms, long titles and code must fit without page overflow.

## Task 1: Student cabinet hierarchy

**Files:** dist/student-cabinet.js, dist/portal-model.js, test/student-dashboard.test.cjs.

**Interfaces:** Add MentorRoutes.lessonFocus(lessons, now) returning {lesson, upcoming} or null; callers pass only the selected student's lessons. Keep STUDENT_CABINET public methods.

- [x] Add behavior tests for nearest upcoming/ongoing lesson and latest past lesson, selection isolation and preserved section anchors.
- [x] Put the focused lesson first on the student's home; compact goal and secondary destinations follow it.
- [x] Put the existing nearest-week roadmap section first, render long stages as disclosures, and add a review priority summary linking to existing sections.
- [x] Keep review version metadata available in a compact disclosure.

## Task 2: Learning document presentation

**Files:** dist/app.js, compile_content.py, content/homework.md, generated dist/content.js and downloads as required, test/document-ui.test.cjs.

**Interfaces:** UI.doc(key, options) accepts studentMode; retain all existing UI exports. Doc markup uses .toc-disclosure, .toc-links, .explanation-details and stable section IDs.

- [x] Add regression checks for homework navigation, preserved sections and complete teacher explanations.
- [x] Remove the duplicate student-window action in student mode and promote starting tasks/downloads.
- [x] Make three homework steps navigable without changing their requirements.
- [x] Collapse long teacher explanations while leaving lesson actions, expected answers and spoken prompts visible; add expand-all action.
- [x] Render compact disclosure-based table of contents, readable short labels and next-section links.

## Task 3: Shared navigation, teacher pages and forms

**Files:** dist/portal.js, dist/portal.css, dist/index.html, optional small dist/document-navigation.js.

- [x] Replace repeated day/role banners with compact context and role controls.
- [x] Add direct teacher/student lesson actions and explicit date labels.
- [x] Mark unavailable lesson sections before users open them.
- [x] Group profile form fields and keep save/cancel visible with a scrollable body.
- [x] Implement document navigation activation, disclosure opening, focus, expand-all and print handling.
- [x] Apply coordinated responsive CSS and consistent inline SVG navigation icons.

## Task 4: Integration and verification

- [x] Run node --test and node check.cjs; resolve regressions.
- [x] Review changes independently against the pre-task snapshot.
- [x] Inspect both roles on desktop and at 390 px, including document anchors, collapsed content and forms.
- [x] Verify saving a temporary student's profile and lesson without modifying live records.
- [x] Update README to describe the resulting interface and report completion.

## Verification outcome

- 49 Node tests passed; check.cjs verified 17 documents and 42 links.
- Independent review compared against the pre-task snapshot; identified layout and punctuation issues were corrected.
- Browser checks covered both roles, 390 px and desktop, anchor focus, disclosures, long titles and profile/lesson saving in an isolated data directory.
- Live mentoring.json SHA256 remained A67C0A37B2E444C6C60766A0594378AC265663B7597391B90C972E705191A324.
