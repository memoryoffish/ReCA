# MSVE event schema — canonical contract between videorlm backend and the demo frontend

This is the **single source of truth** for what events flow through:
- `GET /api/jobs/<id>/events` (SSE stream from real videorlm runs)
- `demos/<id>/manifest.json` `events[]` (pre-recorded demo timeline)
- `replayEventsFastForward()` (history "回看" fast-forward)

The frontend's `handleEvent(ev)` dispatcher is the only consumer. The
same code path must work for all three sources.

## Wire format

Every event is a JSON object with:

| field | type | required | meaning |
|---|---|---|---|
| `type` | str | yes | event type (see below) |
| `t` | float | demo manifests only | seconds from job start, used for setTimeout scheduling on the frontend side. **NOT emitted** by live SSE — that adds `ts` instead. |
| `ts` | float | live SSE only | seconds from job start, set server-side. **NOT in demo manifests** (frontend strips `t` before dispatching). |
| `id` | str | most resource events | the entity id (e.g. `"yang_jian"`, `"a01_shot01_start"`, `"seg_shot01_01"`) |
| `url` | str | most resource events | primary asset URL (OSS-signed) |
| `...` | | | type-specific extras |

The frontend dispatcher ignores `t` / `ts` for rendering decisions — it
only uses `type` + payload.

## Lifecycle events

| type | payload | meaning |
|---|---|---|
| `spawn_ok` | `pid?: int` | subprocess started (real) or local replay started (demo) |
| `planner_start` | — | parent agent begins `plan_skeleton(...)` |
| `plan_ok` | `shots: int` | skeleton returned. Frontend pre-seeds shot columns + state-memory slots. |
| `render_plan_ok` | `segments: int` | `to_render_plan` done. Frontend pre-seeds leaf placeholders. |
| `render_start` | — | `run_render` begins (image DAG kicks off) |
| `final_done` | `url: str` | `concat_final` produced final.mp4 |
| `done` | `final_url: str, total_s: float, watch_url?: str` | job terminal-success. Frontend lands on `final` view. |
| `exit` | `code: int, status: "cancelled"|"error", msg?: str` | terminal-not-success |
| `error` | `msg: str, stage?: str, fatal?: bool` | non-terminal error event (the run may continue with placeholders if `keep_partial=true`); fatal=true means the run dies |
| `tick` | `elapsed_s: float, stage?: str, n_done?: int, n_total?: int` | optional heartbeat for progress bar |

## Resource-ready events (the tree fills in)

All five carry `id` + `url`. Optional fields below.

| type | extra fields | source |
|---|---|---|
| `portrait_ready` | `backend?: str` | image DAG produces a portrait png |
| `location_ready` | `backend?: str` | image DAG produces a location png |
| `prop_ready` | `backend?: str` | image DAG produces a prop png |
| `anchor_ready` | `shot_id?: str, backend?: str, repaired?: bool` | image DAG produces a shot's anchor png |
| `seg_done` | `shot_id: str, kind: "segment_r2v"|"segment_i2v", backend: str, tail_url?: str, duration_s: float, rerendered?: bool` | `dispatch_segment` returned an mp4. `tail_url` is the last-frame png that feeds the next segment's first-frame slot. |
| `bridge_done` | `from_shot: str, to_shot: str, backend: str, duration_s: float` | `dispatch_bridge` returned an mp4 |

## Anchor validator events (between image DAG and segments)

Fires only if `validator: ValidatorParams(enabled=true)` is set on `run_render`.
Currently implemented in `videorlm/framework/validator/anchor/`.

| type | extra fields | meaning |
|---|---|---|
| `anchor_validator_start` | `id: str` | VLM begins evaluating an anchor png |
| `anchor_validator_pass` | `id: str` | anchor accepted as-is |
| `anchor_validator_fail` | `id: str, reason: "identity_drift"|"motif_missing"|"composition_off"|"prop_misplaced"|"other"` | anchor rejected |
| `anchor_repair_start` | `id: str, action: "RepackPrompt"|"ReanchorState"|"PropAttach"|"RegenerateUnit"` | repair branch launched |
| `anchor_ready` | `id: str, url: str, repaired: true` | repaired anchor lands. Frontend swaps the thumb. |

## Segment validator events (after each segment renders, per shot)

Fires only if `segment_validator: SegmentValidatorParams(enabled=true)`.
**TODO #1 in `videorlm/docs/framework.md` §2** — not yet implemented in
the backend. Demo manifests emit these to preview the future UX.

The validator wraps three internal sub-stages (matches paper §5.3
④ Adaptive State Update — Extractor / Refresh / Feed Back):

| type | extra fields | meaning |
|---|---|---|
| `segment_validator_start` | `id: str` | VLM begins evaluating this segment mp4 (sampling its own frames). Maps to ④ panel "Extractor → running". |
| `segment_extractor_ok` | `id: str` | sub-stage 1: motif / identity / end_state observations extracted. ④ panel "Extractor → ok, Refresh → running". |
| `segment_refresh_ok` | `id: str` | sub-stage 2: state memory updated with observations. ④ panel "Refresh → ok, Feed Back → running". |
| `segment_feedback_flagged` | `flagged: [seg_id,...], reasons: {seg_id: reason}` | sub-stage 3: planner-feedback decides which segs need repair. ④ panel "Feed Back → ok". |
| `segment_feedback_pass` | — | nothing flagged, no repair needed |
| `segment_repair_start` | `id: str, action: "RepackPrompt"|"RegenerateUnit"|"SplitUnit"|"micro_adjust"|"replan"` | repair branch launched on this seg |
| `seg_done` | `id, url, rerendered: true, ...` | re-rendered seg lands. Frontend swaps the leaf thumb + shows ↺ badge. |

## Reasons (controlled vocabulary)

`anchor_validator_fail.reason`:
- `identity_drift` — main character face / costume drift
- `motif_missing` — required motif (e.g. glowing eyes) absent
- `composition_off` — framing / pose mismatch
- `prop_misplaced` — required prop missing or wrong position
- `other` — any other failure mode

`segment_validator_fail.reason` / per-id reason in `segment_feedback_flagged.reasons`:
- `motif_drift` — motif disappeared mid-segment
- `end_state_mismatch` — last frame doesn't match `end_state` description
- `r2v_lost_action` — R2V backend compressed multiple beats into one
- `identity_drift` — face/costume drifted across the segment
- `other`

`segment_repair_start.action`:
- `RepackPrompt` — re-inject motif words into seg.prompt and re-render
- `RegenerateUnit` — same prompt + same first_frame, re-render whole seg
- `SplitUnit` — split the seg (e.g. 15s → 7s+8s) then re-render
- `micro_adjust` — gpt-5.5 rewrites one seg's prompt with minimal change
- `replan` — gpt-5.5 rewrites the whole shot's segments

## Removed / renamed (migration table from prior demo manifests)

| old | new | reason |
|---|---|---|
| `shim_installed` | (removed) | demo-only OSS shim; real videorlm has no equivalent |
| `validator_start` | `segment_validator_start` | namespaced to distinguish from anchor validator |
| `extractor_ok` | `segment_extractor_ok` | same |
| `refresh_ok` | `segment_refresh_ok` | same |
| `feedback_flagged` | `segment_feedback_flagged` | same |
| `re_render_start` | `segment_repair_start` | aligned to videorlm repair-action vocabulary; now carries `action` field |

## Ordering invariants

A run that succeeds will always emit events in this order (validator
events optional):

```
spawn_ok
  → planner_start
  → plan_ok                                       (tree shot columns + memory slots appear)
  → portrait_ready × N
  → location_ready × N
  → prop_ready × N
  → anchor_ready × N                              (per shot; column anchor thumb appears)
  → [anchor_validator_start → pass|fail+repair_start → anchor_ready] (optional, per anchor)
  → render_plan_ok                                (leaf placeholders appear under each column)
  → render_start
  → for each shot:
      for each segment in shot:
        seg_done                                  (leaf gets mp4/tail; status=done)
        → [segment_validator_start →
             segment_extractor_ok →
             segment_refresh_ok →
             segment_feedback_flagged|pass →
             (for each flagged) segment_repair_start → seg_done(rerendered=true)]  (optional)
      bridge_done                                 (to next shot)
  → final_done
  → done
```

A failed run replaces the terminal `done` with either:
- `error{fatal=true} → exit{status=error}` (hard failure)
- `done` with the failed cells substituted by placeholder mp4s (when `keep_partial=true`)

A cancelled run terminates with `exit{status=cancelled}` at any point.

## Frontend dispatch (`static/app.js::handleEvent`)

| event type | side-effect |
|---|---|
| `spawn_ok` | chip ① "active"; `dom.statusStage = "启动子进程"` |
| `planner_start` | chip ① spinning |
| `plan_ok` | preSeedSkeletonFromManifest(); chips ①→done, ②③④→active |
| `portrait_ready` / `location_ready` / `prop_ready` | left-sidebar slot gets `<img>` |
| `anchor_ready` | shot column's anchor thumb gets `<img>` |
| `render_plan_ok` | preSeedRenderPlanFromManifest(); leaves pop in |
| `render_start` | chip ② "active"; existing leaves data-status=running |
| `seg_done` | leaf gets img/video src by URL kind; data-status=done; if rerendered=true → ↺ badge |
| `bridge_done` | append bridge card between sibling shot columns |
| `anchor_validator_*` / `anchor_repair_start` | optional: small badge under the anchor thumb |
| `segment_validator_start` | ④ State Pipeline row "Extractor" → running |
| `segment_extractor_ok` | row "Extractor" → ok, "Refresh" → running |
| `segment_refresh_ok` | row "Refresh" → ok, "Feed Back" → running |
| `segment_feedback_flagged` | row "Feed Back" → ok; flagged leaves get data-flagged=true (red ring) |
| `segment_feedback_pass` | row "Feed Back" → ok; no leaves flagged |
| `segment_repair_start` | flagged leaf gets data-rerendering=true (spin) |
| `final_done` | root node swaps to `<video>` with final mp4 |
| `done` | progress 100%; enterFinal() |
| `error{fatal=true}` / `exit{status=error}` | enterError() |
| `exit{status=cancelled}` | status "已取消" |
| `tick` | update elapsed clock + optional stage progress |
