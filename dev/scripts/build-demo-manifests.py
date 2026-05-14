#!/usr/bin/env python3
"""Generate replay manifests for the 5 picked demo runs.

For each demo:
1. Load OSS credentials from /mnt/workspace/akide/code/unirlm-02/.env
2. List all already-uploaded objects under <prefix>/assets/<asset_id>/
3. Sign each URL with a 60-day expiry (per user request)
4. Compose a per-demo event timeline (with validator phase for rerun demos)
5. Write demos/<demo_id>/manifest.json containing skeleton + render_plan
   (inlined for small JSONs) + media URL map + event timeline.

The backend's /api/generate { demo_id } route reads these manifests and
plays the event timeline back over SSE.

Run from anywhere:
  python3 scripts/build-demo-manifests.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

THIS = Path(__file__).resolve()
# Script now lives in dev/scripts/ → climb two parents to reach the msve root.
MSVE_ROOT = THIS.parents[2]
REPO_ROOT = THIS.parents[5]   # unirlm-02
ENV_FILE = REPO_ROOT / ".env"
# Per-demo manifests live under demo/data/ (was demos/ at root).
DEMOS_DIR = MSVE_ROOT / "demo" / "data"

# 60 days, per user request
EXPIRY_S = 60 * 24 * 3600

# ── Load .env ─────────────────────────────────────────────────────────────
if not ENV_FILE.exists():
    sys.exit(f"missing {ENV_FILE}")
for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

try:
    import oss2  # type: ignore
except Exception:
    sys.exit("oss2 not installed; run `pip install oss2`")

OSS_KEY = os.environ.get("oss_AccessKey_ID") or os.environ.get("OSS_ACCESS_KEY_ID")
OSS_SECRET = os.environ.get("oss_AccessKey_Secret") or os.environ.get("OSS_ACCESS_KEY_SECRET")
OSS_BUCKET = os.environ.get("oss_bucket") or "intern-data-wlcb"
OSS_ENDPOINT = os.environ.get("OSS_ENDPOINT") or "https://oss-cn-wulanchabu.aliyuncs.com"

if not (OSS_KEY and OSS_SECRET):
    sys.exit("missing oss_AccessKey_ID / oss_AccessKey_Secret in .env")

auth = oss2.Auth(OSS_KEY, OSS_SECRET)
bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET)


# ── Demo configs ─────────────────────────────────────────────────────────

V22_PREFIX = "new-videos/20260502-videorlm-version-2-2-preview/20260502-171315-original"
V22_30D_PREFIX = "new-videos/20260502-videorlm-version-2-2-preview/20260513-155500-30d-page"
SEED_PREFIX = "new-videos/20260503-videorlm-version-2-2-seedance-i2v-preview/20260503-175524-original"
SEED_30D_PREFIX = "new-videos/20260503-videorlm-version-2-2-seedance-i2v-preview/20260513-155358-30d-refresh"

DEMOS = [
    dict(
        demo_id="ex02_happyhorse",
        slug="boxing",
        title="Boxing",
        summary="天庭神魔之战，12 镜头 22 段。单 pass R2V 渲染，无重验证。",
        backend="happyhorse-1.0-r2v",
        oss_prefix=V22_PREFIX,
        oss_asset_candidates=["good_ex02_happyhorse"],
        local_dir=REPO_ROOT / "videorlm/outputs/version_2.2/good_ex02_happyhorse",
        is_rerun=False,
    ),
    dict(
        demo_id="ex19_wan",
        slug="dumplings",
        title="Dumplings",
        summary="同剧情换 Wan 2.7 R2V 后端，单 pass。",
        backend="wan2.7-r2v",
        oss_prefix=V22_PREFIX,
        oss_asset_candidates=["good_ex19_wan"],
        local_dir=REPO_ROOT / "videorlm/outputs/version_2.2/good_ex19_wan",
        is_rerun=False,
    ),
    dict(
        demo_id="ex10_happyhorse_rerun",
        slug="couple",
        title="Couple",
        summary="同剧情走 ④ validator → re-render 链路，summary 显示 validator 跑了 274s。",
        backend="happyhorse-1.0-r2v",
        oss_prefix=V22_30D_PREFIX,
        oss_asset_candidates=["good_ex10_happyhorse_rerun"],
        local_dir=REPO_ROOT / "videorlm/outputs/version_2.2/good_ex10_happyhorse_rerun",
        is_rerun=True,
    ),
    dict(
        demo_id="ex00_wan_rerun",
        slug="world-landmarks",
        title="World Landmarks",
        summary="同剧情 Wan2.7 后端 + validator。final.mp4 走 OSS（本地 40GB 是 scratch）。",
        backend="wan2.7-r2v",
        oss_prefix=V22_30D_PREFIX,
        oss_asset_candidates=["good_ex00_wan_rerun"],
        local_dir=REPO_ROOT / "videorlm/outputs/version_2.2/good_ex00_wan_rerun",
        is_rerun=True,
    ),
    dict(
        demo_id="ex01_seedance_rerun",
        slug="heavenly-titans",
        title="Heavenly Titans",
        summary="第三种后端 Seedance i2v；同样走 validator → re-render。",
        backend="seedance-i2v",
        oss_prefix=SEED_30D_PREFIX,
        # NOTE: 0503 seedance manifest uses 'good_ex_01_seedance_rerun' (extra underscore)
        # but 30d-refresh might re-use the canonical local name. List + match.
        # NB: real OSS asset name has a typo: `good_ex_01_seedance_run`
        # (extra underscore between ex and 01, and missing "re" prefix)
        oss_asset_candidates=[
            "good_ex_01_seedance_run",
            "good_ex_01_seedance_rerun",
            "good_ex01_seedance-i2v_rerun",
        ],
        local_dir=REPO_ROOT / "videorlm/outputs/version_2.2seedance-i2v/good_ex01_seedance-i2v_rerun",
        is_rerun=True,
    ),
]


# ── Helpers ──────────────────────────────────────────────────────────────

def resolve_asset_id(prefix: str, candidates: list[str]) -> tuple[str, dict[str, str]]:
    """Try each candidate asset_id under <prefix>/assets/. Return (asset_id, file_map)."""
    for cand in candidates:
        base = f"{prefix}/assets/{cand}/"
        files: dict[str, str] = {}
        for obj in oss2.ObjectIterator(bucket, prefix=base, max_keys=1000):
            rel = obj.key[len(base):]
            if rel:  # skip the base itself
                files[rel] = obj.key
        if files:
            return cand, files
    return "", {}


def sign(key: str) -> str:
    return bucket.sign_url("GET", key, EXPIRY_S, slash_safe=True)


def load_first(path_options: list[Path]) -> dict | None:
    for p in path_options:
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
    return None


# ── Event timeline composer ──────────────────────────────────────────────

def compose_events(skeleton: dict, render_plan: dict, media: dict, final_url: str | None,
                    is_rerun: bool, backend: str = "") -> list[dict]:
    """Compose a tight event timeline (~ 15-25 s wall-clock) that mirrors
    what a real videorlm run would emit. Schema = EVENT_SCHEMA.md.

    `backend` is the segment_r2v / segment_i2v backend name from the demo
    config (e.g. "happyhorse-1.0-r2v"); propagated into seg_done events.

    Pacing rationale: the demo must FEEL like a generation pipeline (one
    thing happens at a time, planner-thinks then tree-pops, memory fills
    progressively, leaves fill in order, validator chain animates) but
    nothing should sit on screen long enough to feel like a wait.
    """
    events: list[dict] = []
    t = [0.0]
    BRIDGE_BACKEND = "wan2.7-i2v"
    IMAGE_BACKEND = "wan2.7-image"
    PHASE_PAUSE_S = 5.0  # gap inserted between major phases for "what's happening" beat

    def emit(dt: float, ev: dict) -> None:
        t[0] += dt
        ev["t"] = round(t[0], 2)
        events.append(ev)

    def pause_phase(stage: str, detail: str, pause_s: float = PHASE_PAUSE_S) -> None:
        """Emit a phase_marker (sets statusStage + statusDetail in the UI)
        and then hold the clock for `pause_s` so the user has time to read
        the message before the next event lands."""
        emit(0.05, dict(type="phase_marker", stage=stage, detail=detail))
        t[0] += pause_s

    # ── lifecycle ────────────────────────────────────────────────────────
    emit(0.15, dict(type="spawn_ok"))
    emit(0.25, dict(type="planner_start"))

    shots = skeleton.get("shots") or []
    # Plan-skeleton hero beat: long enough to read "planner thinking".
    pause_phase("① Planner LLM thinking",
                "Decomposing your story into a tree of shots + per-shot segments…")
    emit(0.15, dict(type="plan_ok", shots=len(shots)))

    # ── state memory: portraits → locations → props (fast batch) ────────
    if any(media.get(g) for g in ("portraits", "locations", "props")):
        pause_phase("⑤ State Memory",
                    "Rendering character portraits, locations and props that persist across shots…")
    for ptype, ev_name in (("portraits", "portrait_ready"),
                            ("locations", "location_ready"),
                            ("props",     "prop_ready")):
        for ref_id, url in media.get(ptype, {}).items():
            emit(0.10, dict(type=ev_name, id=ref_id, url=url, backend=IMAGE_BACKEND))

    # ── anchors — one per shot column ────────────────────────────────────
    anchor_items = list(media.get("anchors", {}).items())
    if anchor_items:
        pause_phase("Anchor frames",
                    f"Painting the first frame of each of the {len(anchor_items)} shots — seeds the I2V chain…")
    for anchor_id, url in anchor_items:
        emit(0.15, dict(type="anchor_ready", id=anchor_id, url=url, backend=IMAGE_BACKEND))

    # ── ④ Anchor validator (rerun demos only) ──────────────────────────
    # videorlm/framework/validator/anchor/ already implements this. The
    # demo flags 1 anchor and re-renders it so the user sees the anchor
    # row in the ④ panel.
    if is_rerun and anchor_items:
        flagged_anchor_id, flagged_anchor_url = anchor_items[0]
        anchor_reason = "identity_drift"
        anchor_action = "RepackPrompt"
        pause_phase("④ Anchor validator",
                    "Checking each anchor for identity / pose drift before letting it seed the video render…")
        emit(0.30, dict(type="anchor_validator_start", id=flagged_anchor_id))
        emit(0.30, dict(type="anchor_validator_fail",
                         id=flagged_anchor_id, reason=anchor_reason))
        emit(0.20, dict(type="anchor_repair_start",
                         id=flagged_anchor_id, action=anchor_action))
        emit(0.50, dict(type="anchor_ready",
                         id=flagged_anchor_id, url=flagged_anchor_url,
                         backend=IMAGE_BACKEND, repaired=True))

    # ── render_plan hero beat ────────────────────────────────────────────
    pause_phase("② Render plan",
                "Allocating segments per shot, deciding parallel vs serial dependency edges…")
    emit(0.40, dict(type="render_plan_ok", segments=len(media.get("segments", {}))))
    emit(0.10, dict(type="render_start"))

    # ── segments — within-shot serial (≥ SEG_DUR_S), cross-shot stagger ──
    # Real videorlm renders segments in a shot serially (each segment's
    # first_frame = previous segment's tail.png), so collapsing the
    # whole timeline to 0.5 s/seg lies about the dependency graph.
    # Schedule:
    #   shot k, segment i lands at t_base + k * SHOT_STAGGER + (i + 1) * SEG_DUR
    # so different shots overlap (parallel) but same-shot segments are
    # ≥ SEG_DUR_S apart (serial).
    #
    # url & tail_url collapse to the same tail.png because the demo's OSS
    # only has tail frames (no segment mp4s uploaded). Real videorlm
    # populates url with the segment mp4 and tail_url with the separate
    # last-frame png.
    SEG_DUR_S = 6.0       # within-shot serial: each segment takes 6 s
    SHOT_STAGGER_S = 0.3  # cross-shot stagger so first segments don't all land at the same instant
    seg_kind = "segment_i2v" if "i2v" in backend.lower() else "segment_r2v"
    seg_items = list(media.get("segments", {}).items())
    if seg_items:
        pause_phase("② Segment rendering",
                    f"{len(seg_items)} leaves to render — within-shot serial (each seg = prev tail), cross-shot parallel.")
    from collections import defaultdict
    by_shot: dict[str, list[tuple[int, str, str]]] = defaultdict(list)
    for seg_id, url in seg_items:
        m = re.match(r"^seg_(.+)_(\d+)$", seg_id)
        shot_id = m.group(1) if m else "shot_unknown"
        order = int(m.group(2)) if m else 0
        by_shot[shot_id].append((order, seg_id, url))
    for sid in by_shot:
        by_shot[sid].sort(key=lambda x: x[0])
    t_base = t[0]
    scheduled: list[tuple[float, str, str, str]] = []
    for shot_idx, sid in enumerate(by_shot.keys()):
        shot_t0 = t_base + shot_idx * SHOT_STAGGER_S
        for k, (_order, seg_id, url) in enumerate(by_shot[sid]):
            abs_t = shot_t0 + SEG_DUR_S * (k + 1)
            scheduled.append((abs_t, seg_id, sid, url))
    scheduled.sort(key=lambda x: x[0])
    for abs_t, seg_id, shot_id, url in scheduled:
        dt = max(0.0, abs_t - t[0])
        emit(dt, dict(
            type="seg_done", id=seg_id, shot_id=shot_id,
            kind=seg_kind, backend=backend or "happyhorse-1.0-r2v",
            url=url, tail_url=url, duration_s=8.0,
        ))

    # ── bridges ──────────────────────────────────────────────────────────
    if media.get("bridges"):
        pause_phase("Cross-shot bridges",
                    "Stitching shot pairs with short transition clips (wan2.7-i2v)…")
    for br_id, url in media.get("bridges", {}).items():
        # Bridge ids like "bridge_shot01_to_shot02"
        m = re.match(r"^bridge_(.+)_to_(.+)$", br_id)
        from_shot, to_shot = (m.group(1), m.group(2)) if m else ("", "")
        emit(0.12, dict(
            type="bridge_done", id=br_id,
            from_shot=from_shot, to_shot=to_shot,
            backend=BRIDGE_BACKEND, url=url, duration_s=4.0,
        ))

    # ── ④ Adaptive State Update — segment validator (rerun demos only) ──
    # Real backend impl is TODO #1 in videorlm/docs/framework.md §2. The
    # demo emits the same event names so the future swap is zero-change.
    if is_rerun and seg_items:
        pause_phase("④ Segment validator",
                    "Extracting end-state from every segment → refreshing memory → feedback flags drift…")
        emit(0.50, dict(type="segment_validator_start"))
        emit(0.35, dict(type="segment_extractor_ok"))
        emit(0.30, dict(type="segment_refresh_ok"))
        flagged = [sid for sid, _ in seg_items[:2]]
        reasons = {flagged[0]: "motif_drift"} if flagged else {}
        if len(flagged) > 1:
            reasons[flagged[1]] = "end_state_mismatch"
        emit(0.30, dict(type="segment_feedback_flagged",
                         flagged=flagged, reasons=reasons))
        for sid in flagged:
            action = "RepackPrompt" if reasons.get(sid) == "motif_drift" else "RegenerateUnit"
            emit(0.15, dict(type="segment_repair_start", id=sid, action=action))
            m = re.match(r"^seg_(.+)_\d+$", sid)
            shot_id = m.group(1) if m else ""
            emit(0.55, dict(
                type="seg_done", id=sid, shot_id=shot_id,
                kind=seg_kind, backend=backend or "happyhorse-1.0-r2v",
                url=media["segments"][sid], tail_url=media["segments"][sid],
                duration_s=8.0, rerendered=True,
            ))

    pause_phase("Final concat",
                "ffmpeg-concat every segment + bridge into the final mp4…")
    emit(0.60, dict(type="final_done", url=final_url))
    emit(0.20, dict(type="done", final_url=final_url, total_s=round(t[0], 1)))
    return events


# ── Main ─────────────────────────────────────────────────────────────────

def build_one(cfg: dict) -> None:
    demo_id = cfg["demo_id"]
    print(f"\n[{demo_id}] ----")
    asset_id, files = resolve_asset_id(cfg["oss_prefix"], cfg["oss_asset_candidates"])
    if not files:
        print(f"  ! no objects found under {cfg['oss_prefix']}/assets/<candidates>")
        print(f"  candidates tried: {cfg['oss_asset_candidates']}")
        return
    print(f"  resolved asset_id={asset_id}, {len(files)} objects")

    # Read local skeleton / render_plan (small JSONs, inline into manifest)
    local = Path(cfg["local_dir"])
    skeleton = load_first([local / "skeleton.json", local / "planner.json"])
    render_plan = load_first([local / "render_plan.json"])
    if skeleton is None:
        print(f"  ! no local skeleton.json or planner.json under {local}")
        return
    if render_plan is None:
        print(f"  ! no local render_plan.json under {local}")
        return

    # Group OSS files by subdir.
    # OSS upload flattened local `run/anchors/X.png` to `<asset_id>/anchors/X.png`
    # (no `run/` prefix). Segment mp4s were NOT uploaded — instead each
    # segment's tail frame ended up at `<asset_id>/segment_tails/seg_X.tail.png`.
    # We treat tail PNGs as the segment's "poster" (matches paper's
    # "writes back to state" semantics: each leaf produces a frame that
    # becomes the next leaf's prev frame). final.mp4 sits at asset root.
    # OSS file naming varies across uploads. We normalise file stems so the
    # IDs match what the frontend's skeleton/render_plan-driven lookups expect:
    #   portrait_NN_<id>.png  →  <id>
    #   location_NN_<id>.png  →  <id>
    #   prop_NN_<id>.png       →  <id>
    #   anchor_NN_aMM_x_start.png → aMM_x_start  (keep aMM_ prefix; matches render_plan anchor id)
    #   bare <id>.png          →  <id>           (some demos uploaded without prefix)
    import re
    PREFIX_RES = {
        "portraits": re.compile(r"^portrait_\d+_(.+)$"),
        "locations": re.compile(r"^location_\d+_(.+)$"),
        "props":     re.compile(r"^prop_\d+_(.+)$"),
        "anchors":   re.compile(r"^anchor_\d+_(.+)$"),
    }
    def clean_stem(group, stem):
        pat = PREFIX_RES.get(group)
        if pat:
            m = pat.match(stem)
            if m:
                return m.group(1)
        return stem

    media = {k: {} for k in ("portraits", "locations", "props", "anchors", "segments", "bridges")}
    final_url = None
    skipped = 0
    for rel, key in files.items():
        parts = rel.split("/")
        if len(parts) == 2 and parts[0] in media:
            filename = parts[-1]
            if filename.endswith(".url") or filename.endswith(".url.fail"):
                skipped += 1
                continue
            stem = filename.rsplit(".", 1)[0]
            stem = clean_stem(parts[0], stem)
            media[parts[0]][stem] = sign(key)
        elif len(parts) == 2 and parts[0] == "segment_tails":
            filename = parts[-1]
            stem = filename.replace(".tail.png", "").replace(".png", "")
            media["segments"][stem] = sign(key)
        elif rel == "final.mp4":
            final_url = sign(key)

    counts = {k: len(v) for k, v in media.items()}
    print(f"  signed: final={'✓' if final_url else '✗'}  " +
          " ".join(f"{k}={n}" for k, n in counts.items()) +
          f"  (skipped {skipped} tail/url markers)")

    events = compose_events(skeleton, render_plan, media, final_url,
                             cfg["is_rerun"], cfg.get("backend", ""))

    manifest = dict(
        demo_id=demo_id,
        slug=cfg.get("slug", demo_id),
        title=cfg["title"],
        summary=cfg["summary"],
        backend=cfg["backend"],
        is_rerun=cfg["is_rerun"],
        oss_prefix=cfg["oss_prefix"],
        oss_asset_id=asset_id,
        signed_at=datetime.now(timezone.utc).isoformat(),
        expires_at=(datetime.now(timezone.utc) + timedelta(seconds=EXPIRY_S)).isoformat(),
        n_shots=len(skeleton.get("shots") or []),
        n_segments=len(media["segments"]),
        skeleton=skeleton,
        render_plan=render_plan,
        media=dict(
            **media,
            final_mp4=final_url,
        ),
        events=events,
        timeline_duration_s=round(events[-1]["t"], 1),
    )

    out_path = DEMOS_DIR / demo_id / "manifest.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  wrote {out_path} ({out_path.stat().st_size // 1024} KB, "
          f"timeline {manifest['timeline_duration_s']}s)")


def build_index(built: list[dict]) -> None:
    """Write demos/index.json listing all built demos."""
    items = []
    for cfg in built:
        m_path = DEMOS_DIR / cfg["demo_id"] / "manifest.json"
        if not m_path.exists():
            continue
        m = json.loads(m_path.read_text(encoding="utf-8"))
        items.append(dict(
            demo_id=m["demo_id"],
            slug=m.get("slug", m["demo_id"]),
            title=m["title"],
            summary=m["summary"],
            backend=m["backend"],
            is_rerun=m["is_rerun"],
            n_shots=m["n_shots"],
            n_segments=m["n_segments"],
            timeline_duration_s=m["timeline_duration_s"],
            poster_url=m["media"]["final_mp4"],
        ))
    idx_path = DEMOS_DIR / "index.json"
    idx_path.write_text(json.dumps(dict(demos=items, generated_at=datetime.now(timezone.utc).isoformat()),
                                    ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {idx_path} with {len(items)} demos")


if __name__ == "__main__":
    t0 = time.time()
    print(f"OSS bucket={OSS_BUCKET} endpoint={OSS_ENDPOINT}")
    print(f"Expiry: {EXPIRY_S}s = {EXPIRY_S/86400:.0f} days")
    for cfg in DEMOS:
        try:
            build_one(cfg)
        except Exception as e:
            print(f"  ! [{cfg['demo_id']}] failed: {type(e).__name__}: {e}")
    build_index(DEMOS)
    print(f"\ntotal {time.time()-t0:.1f}s")
