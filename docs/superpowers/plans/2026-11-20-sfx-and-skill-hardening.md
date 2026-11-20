# SFX 同步与 Skill 架构硬化实施计划

> **For agentic workers:** Follow the task checkboxes in order. Preserve all pre-existing work in this worktree; do not commit or push unless asked.

**Goal:** Make code-generated SFX timing semantics explicit and verify them honestly, then review and fix confirmed reliability defects across the Skill repository.

**Architecture:** Keep the existing clip-second storyboard and sample-index PCM renderer. Add optional SFX anchor metadata without breaking legacy `at` events, validate beat-anchored hit times against the existing beat grid, and label mixed-audio RMS checks as transient observations rather than SFX attribution. Then audit the documented cross-module flows and fix the previously recorded regressions individually.

**Tech Stack:** Node.js built-ins, Node test runner, existing Python/FFmpeg QA, Markdown Skill references. No new dependency.

**Spec:** User request in this conversation; existing `references/sfx-and-beat.md`, `storyboard-and-timing.md`, repository tests, and prior audit findings.

## Global Constraints

- Keep storyboard timebase `clip`; source BGM seconds convert once via `project.sourceOffset`.
- Preserve old SFX events with only `{at,type,gain,pitch}`.
- Do not claim that a transient in a mixed BGM proves the transient came from an SFX.
- Do not replace the active frame renderer or add dependencies.
- Do not alter user BGM, existing full-length MV, or unrelated pre-existing work.

## Review Focus

- Beat-anchored SFX with lead-in: validate the intended hit, not the waveform start.
- Cropped BGM: ensure source time and clip time are not shifted twice or left unshifted.
- Mixed audio: coincident drums must not become false SFX evidence.
- Export: output aliases must not overwrite audio/image inputs.
- Resume cache: every frame-affecting source must participate in its fingerprint.
- Whole-skill contracts: validator, renderer, README, templates, and references must agree.

---

### Task 1: SFX timing contract

**Files:** `scripts/sfx.mjs`, `scripts/validate-storyboard.mjs`, `scripts/verify-sfx.mjs`, `references/sfx-and-beat.md`, `references/storyboard-and-timing.md`, `SKILL.md`, `README.md`, `assets/storyboard-sfx-demo.json`, `tests/sfx.test.mjs`.

- [x] Add failing tests for optional `hitAt` / beat anchor metadata, sample-frame report, and honest mixed-audio evidence scope.
- [x] Validate anchors against `music.beats` in clip seconds while keeping legacy entries valid.
- [x] Preserve waveform start at `at`; report expected hit frame separately.
- [x] Change verifier wording/output so RMS rise is transient evidence, not source attribution; show `at → hitAt` and anchor in evidence.
- [x] Update the authoritative SFX guide and fix cross-document absolutes.
- [x] Run SFX, storyboard, export, and full repository tests.

### Task 2: Previously recorded reliability findings

**Files:** `assets/templates/starter/export.mjs`, `assets/templates/starter/frame-core.mjs`, `scripts/qa.mjs`, `scripts/validate-storyboard.mjs`, `scripts/verify-sfx.mjs`, matching tests.

- [x] Reproduce input/output alias overwrite and reject unsafe aliases.
- [x] Include starter `frame-core.mjs` in the resume fingerprint and test invalidation.
- [x] Replace large argument spread in dominant-color QA and add a high-color regression.
- [x] Pass configured beat tolerance through CLI and test custom value; reject malformed settings.
- [x] Confirm SFX evidence fix from Task 1 covers the false-attribution case.
- [x] Keep each fix minimal and independently tested.

### Task 3: Whole-skill architecture pass

**Files:** all source, template, script, reference, test, and README paths under `skills/lyric-driven-code-mv/` plus repository tests.

- [x] Trace public data contracts from storyboard through validation, rendering, export, and evidence generation.
- [x] Check paths, output ownership, asset loading, deterministic time, and crop offsets for cross-module mismatches.
- [x] Record only reproducible defects or contract contradictions; fix high-severity findings with tests.
- [x] Leave optimization/style refactors alone unless they reduce a demonstrated correctness or maintenance risk.

### Task 4: Final verification and runtime sync

- [x] Run focused tests after each task and the full `node --test` suite at the end.
- [x] Run `git diff --check`, validate shipped example storyboards, and perform FFprobe/render checks for affected templates.
- [x] Sync changed Skill files into the local installed copy while preserving the installed starter instructions and unrelated content.
- [x] Report fixed findings, residual risks, files changed, test counts, and that no commit/push was made.


## Confirmed review findings

- Beat-anchored SFX inside `scene.sfx` were collected after beat validation, so their hitAt could silently escape the beat-grid warning. Validation now runs after all scene events are collected.
- The validator CLI did not forward project.settings.beatToleranceMs, even though the analyzer API supported custom tolerance; invalid setting types also lacked a located error.
- Dominant-color QA spread every color count into Math.max and reproducibly overflowed the JS call stack on a 400x400 high-color frame.
- Resume fingerprints omitted the shared starter frame-core.mjs, allowing stale frames to appear reusable after renderer-core changes.
- Mixed-audio RMS windows could be mistaken for SFX attribution; evidence/reporting now distinguishes waveform at from target hitAt/anchor, and optional BGM-only difference is labeled a candidate rather than proof.
- Several export/report/image CLIs accepted input/output aliases (including canonical and hard-link aliases); the shared path helper is now used before writes. The starter also checks video/sidecar/frame outputs, and paired visualization exports reject aliased SVG/JSON targets.
- film-sheet.py left extracted temporary frames behind; TemporaryDirectory now cleans up on success and failure.

**Verification:** full `node --test` suite 410/410; both bundled storyboard examples validate; Python scripts parse; Skill quick validation passes for repository and installed copy; starter export/render/ffprobe checks are exercised by repository tests. No commit or push was made.

**Residual limits:** SFX RMS and BGM-only subtraction still cannot certify perceived synchronization or source causality after lossy encoding; listen to the final mix. File symlink creation was unavailable in this Windows test context, while canonical-path, hard-link and directory-junction cases were exercised where supported.
