# Lesson Markdown Editor Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Work in the existing feature checkout; do not overwrite unrelated changes or live data.

**Goal:** Import Markdown files and comfortably edit the teacher scenario, student assignments and lesson review.

**Architecture:** Keep Markdown source in the existing three note fields. A vendored parser renders the same HTML for preview and saved pages. A standalone editor component owns formatting, import and its disposable browser state; portal.js retains authorization and explicit saves.

**Tech Stack:** Plain JavaScript/CSS, vendored markdown-it, existing Node server and node:test.

**Spec:** User-approved design in this conversation: `.md` upload, headings, lists, tables and Java code, editable source and preview for teacherNotes, studentNotes and reviewNotes; retain the current style and visibility boundaries.

## Constraints and decisions

- Existing 20,000 UTF-16 character note limit; UTF-8 `.md` and `.markdown` import up to 80,000 bytes, no silent truncation.
- Toolbar and source/preview views, responsive layout, undo/redo, explicit save. Import offers replacement or append when text exists.
- Disable raw HTML and automatic image loads; allow only absolute HTTP(S)/mailto links. No runtime CDN or backend schema change.
- Dispose file reads and editor state on close/account change; freeze edits during save after capturing FormData.
- Preserve all existing data and unrelated working-tree changes. No commits or deployment requested.
- Baseline: `.runtime/lesson-markdown-before-20260930`.

## Tasks

- [x] Renderer: `dist/lesson-markdown.js`, pinned vendor with license/provenance, security and formatting tests.
- [x] Editor: `dist/lesson-editor.js`, `dist/lesson-editor.css`, transformations/import/lifecycle tests.
- [x] Integration: portal note forms and display, lesson review renderer dependency, index script order, exact public asset allowlist, syntax checks, README, integration tests.
- [x] Verify focused and full tests, browser import/edit/preview/save/role boundaries and mobile layout against synthetic data; review changes and confirm live data hashes.

## Review focus

Check async import racing an edit or account switch, empty/invalid/oversize files preserving existing text, only the selected field submitted, preview links not navigating the editor, and preview/saved content escaping identically. Check prepared material additions and legacy plain notes still display, and the teacher scenario remains private.

## Completion evidence

- `node --test`: 298 tests, 297 passed, 0 failed, 1 Windows file-symlink permission skip. Junction containment checks passed. Output: `.runtime/lesson-markdown-full-tests.log`.
- `node check.cjs`: 17 private documents, 68 links, manifest/public syntax/privacy checks passed.
- Browser on synthetic port 4174: import into nonempty field with explicit replacement, preview headings/list/code/table, undo/redo import, bold formatting and keyboard undo, save/reopen, invalid binary preserves text, 390px mobile view, real student account receives formatted tasks without editor controls.
- Independent review resolved Markdown indentation trimming in `lib/store.cjs` and student review rendering, rejected empty imports, and restored editor overflow on shorter screens. Only the three lesson note fields now preserve exact source whitespace; other text fields retain existing normalization.
- Local server restarted with exact new public assets returning HTTP 200. Live `data/mentoring.json` and `data/practice/state.json` hashes match baseline.
- Screenshot: `.runtime/lesson-markdown-editor.png`.

## Follow-up: full lesson length

The user encountered the original 20,000-character ceiling during import. Raised the three lesson note fields and editor to 200,000 UTF-16 units, `.md` input to 1 MiB, and only lesson POST/PATCH request bodies to 4 MiB. Profile limits remain unchanged. The revised limits supersede the original constraint above.

Verified 69 focused tests (editor, portal lifecycle, store, HTTP server), `check.cjs`, and browser import/save/reopen of an exact 200,000-character, 370,764-byte UTF-8 lesson with its final marker intact. Baseline and live-data hashes: `.runtime/lesson-limits-before-20260930`; test results: `.runtime/lesson-limits-tests.log`. Independent review found no issues. Live server restarted; source lesson/practice data unchanged.
