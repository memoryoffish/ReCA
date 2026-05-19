"use strict";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* Convert an asset id like "old_father" / "kitchen_prep_counter" into a
   human-readable English label by replacing underscores with spaces.
   Used to display memory + ref-chip labels — the source label fields
   ship in Chinese, so we show the underlying id (humanised) instead. */
function humanizeId(id) {
  return String(id || "").replace(/[_-]/g, " ").trim();
}

const $ = (id) => document.getElementById(id);

/* ── DOM ───────────────────────────────────────────────────────────────── */
const dom = {
  status: $("dataStatus"),
  navPills: [...document.querySelectorAll(".nav-pill")],
  viewForm: $("viewForm"),
  viewRunning: $("viewRunning"),
  viewFinal: $("viewFinal"),
  viewError: $("viewError"),

  // Form
  demoPicker: $("demoPicker"),
  historyList: $("historyList"),

  // Running — status bar
  statusStage: $("statusStage"),
  statusElapsed: $("statusElapsed"),
  statusDetail: $("statusDetail"),
  statusFill: $("statusFill"),
  cancelBtn: $("cancelBtn"),

  // Running — left
  stateRows: document.querySelectorAll(".state-row"),
  lastExtract: $("lastExtract"),
  lastRefresh: $("lastRefresh"),
  lastFeedback: $("lastFeedback"),
  validatorLogAnchors: $("validatorLogAnchors"),
  validatorLogAnchorsEmpty: $("validatorLogAnchorsEmpty"),
  validatorLogSegments: $("validatorLogSegments"),
  validatorLogSegmentsEmpty: $("validatorLogSegmentsEmpty"),
  leafValidation: $("leafValidation"),
  memPortraitItems: $("memPortraitItems"),
  memLocationItems: $("memLocationItems"),
  memPropItems: $("memPropItems"),
  memPortraitCount: $("memPortraitCount"),
  memLocationCount: $("memLocationCount"),
  memPropCount: $("memPropCount"),

  // Running — middle
  rootNode: $("rootNode"),
  rootStory: $("rootStory"),
  rootBadge: $("rootBadge"),
  rootBadgeTitle: $("rootBadgeTitle"),
  rootFinalVideo: $("rootFinalVideo"),
  shotColumns: $("shotColumns"),
  bridgesRow: $("bridgesRow"),
  bridgesItems: $("bridgesItems"),
  treeLines: $("treeLines"),

  // Running — right
  leafEmpty: $("leafEmpty"),
  leafContent: $("leafContent"),
  leafTitle: $("leafTitle"),
  leafSubtitle: $("leafSubtitle"),
  ctxPrev: $("ctxPrev"),
  ctxPrompt: $("ctxPrompt"),
  ctxRefs: $("ctxRefs"),
  genCard: $("genCard"),
  outputBlock: $("outputBlock"),

  // Final
  finalVideo: $("finalVideo"),
  finalSubtitle: $("finalSubtitle"),
  downloadLink: $("downloadLink"),
  copyLinkBtn: $("copyLinkBtn"),
  restartBtn: $("restartBtn"),
  backToTreeBtn: $("backToTreeBtn"),

  // Error
  errorBox: $("errorBox"),
  errorRestartBtn: $("errorRestartBtn"),
};

/* ── State ─────────────────────────────────────────────────────────────── */
const state = {
  jobId: null,
  startedAt: null,
  ticker: null,
  errorTail: [],
  navStage: "form",
  tree: null,
  selectedSegId: null,
  // Replay mode (pre-recorded demos, played entirely client-side)
  demos: null,
  selectedDemoId: null,
  isReplay: false,
  replayTitle: "",
  replayBackend: "",
  replayIsRerun: false,
  replayManifest: null,
  // Per-run validator activity log — one entry per flagged segment.
  // Shape: {seg_id, reason, action, status: "queued"|"running"|"done"}.
  // Renders into the ④ Adaptive State Update panel's "Validate &
  // Re-render" list.
  validatorLog: [],
  replayTimers: [],
  replayClock: null,
  replayClockStart: null,
  replayStartedAt: null,
  // Persistent run history (cross-session) + fast-forward marker
  history: null,
  fastForward: false,
};

function freshTree() {
  return {
    shots: [],
    bridges: {},
    memory: { portraits: {}, locations: {}, props: {} },
  };
}

/* Pre-seed phase 1 (called on plan_ok): plan_skeleton returns → render
   shot columns + state-memory slots. NO leaves yet (leaves come from
   render_plan, which is a SEPARATE planner call later in the pipeline). */
function preSeedSkeletonFromManifest(manifest) {
  if (!manifest) return false;
  const sk = manifest.skeleton || {};

  state.tree.shots = (sk.shots || []).map((s) => ({
    id: s.id,
    anchorId: null,
    anchorUrl: null,
    status: "pending",
    prompt: s.start_state || s.summary || s.action || s.story_goal || s.visual_intent || "",
    leaves: [],
  }));

  // Display name = humanised id (e.g. "old_father" → "old father").
  // The skeleton's .name / .reference_name fields are Chinese — we drop
  // them on the frontend to keep the demo UI English-only.
  for (const p of (sk.portrait_plan || [])) {
    state.tree.memory.portraits[p.id] = { id: p.id, name: humanizeId(p.id), url: null };
  }
  for (const lkey in (sk.location_plan || {})) {
    const loc = sk.location_plan[lkey] || {};
    // key_zones are sub-regions, not separately uploaded → no event ever
    // fires for them; pre-registering would leave permanent placeholders.
    state.tree.memory.locations[lkey] = {
      id: lkey, name: humanizeId(lkey), url: null,
    };
    for (const pid in (loc.props || {})) {
      state.tree.memory.props[pid] = {
        id: pid, name: humanizeId(pid), url: null,
      };
    }
  }
  return state.tree.shots.length > 0;
}

/* Pre-seed phase 2 (called on render_plan_ok): render_plan returned →
   pair boundary_anchors to shots, fill leaf placeholders per shot. */
function preSeedRenderPlanFromManifest(manifest) {
  if (!manifest) return false;
  const rp = manifest.render_plan || {};

  for (const a of (rp.boundary_anchors || [])) {
    const aId = a.id || "";
    const infer = aId.replace(/^a\d+_/, "").replace(/_start$/, "");
    let shot = state.tree.shots.find((s) => s.id === infer || s.id.endsWith(infer) || infer.endsWith(s.id));
    if (!shot && a.shot_id) shot = state.tree.shots.find((s) => s.id === a.shot_id);
    if (shot && !shot.anchorId) shot.anchorId = aId;
  }
  const stillUnmapped = (rp.boundary_anchors || []).filter((a) => !state.tree.shots.find((s) => s.anchorId === a.id));
  let j = 0;
  for (const shot of state.tree.shots) {
    if (!shot.anchorId && stillUnmapped[j]) { shot.anchorId = stillUnmapped[j].id; j++; }
  }

  const segs = rp.segments || {};
  const segByShot = {};
  for (const segId in segs) {
    const seg = segs[segId] || {};
    let sid = seg.shot_id || seg.parent_shot;
    if (!sid) {
      const m = /^seg_(.+?)_\d+$/.exec(segId);
      if (m) sid = m[1];
    }
    if (!sid) continue;
    if (!segByShot[sid]) segByShot[sid] = [];
    const flf2v = seg.flf2v_request || seg.segment_request || seg.bridge_request || seg.request || {};
    segByShot[sid].push({
      id: segId,
      status: "pending",
      url: null,
      prompt: flf2v.prompt || seg.prompt || "",
      refs: extractRefsFromSeg(flf2v, seg),
      backend: flf2v.kind || seg.kind || "segment_r2v",
      kind: flf2v.kind || seg.kind || "segment_r2v",
      duration_s: flf2v.duration_s || seg.duration_s || 0,
      transition_mode: extractTransitionModeFromSeg(seg, segId),
      order: parseInt((/_(\d+)$/.exec(segId) || [, "0"])[1], 10),
    });
  }
  for (const shot of state.tree.shots) {
    const list = segByShot[shot.id] || [];
    list.sort((a, b) => a.order - b.order);
    shot.leaves = list;
  }
  return true;
}

/* Convenience for fast-forward / history re-open: do both phases at once. */
function preSeedTreeFromManifest(manifest) {
  if (!manifest) return false;
  preSeedSkeletonFromManifest(manifest);
  preSeedRenderPlanFromManifest(manifest);
  return state.tree.shots.length > 0;
}

/* Local helpers so preSeedTreeFromManifest doesn't depend on the
   later-declared extractRefs / extractTransitionMode. */
function extractRefsFromSeg(flf2v, seg) {
  // The demo render_plan.json shape for `reference_inputs` is an object
  // keyed by role (`{portrait, place, prop}`), and values may be a
  // comma-separated string of asset ids. The older array form is also
  // still supported (reference_images / list-of-strings or
  // list-of-{asset_id,role}). Handle all three; dedupe by id.
  const refs = [];
  const seen = new Set();
  const push = (id, role) => {
    if (!id || typeof id !== "string") return;
    if (seen.has(id)) return;
    seen.add(id);
    refs.push(role ? { id, role } : { id });
  };
  for (const arr of [seg.reference_inputs, flf2v.reference_inputs, flf2v.reference_images, seg.reference_images]) {
    if (Array.isArray(arr)) {
      arr.forEach((r) => {
        if (typeof r === "string") push(r);
        else if (r && r.asset_id) push(r.asset_id, r.role);
      });
    }
  }
  for (const obj of [seg.reference_inputs, flf2v.reference_inputs]) {
    if (obj && !Array.isArray(obj) && typeof obj === "object") {
      for (const [role, val] of Object.entries(obj)) {
        if (typeof val === "string") {
          val.split(",").map((s) => s.trim()).filter(Boolean).forEach((id) => push(id, role));
        }
      }
    }
  }
  // NB: seg.start_anchor is intentionally NOT pushed here — the anchor
  // is already represented in the "prev seg" panel of the leaf detail
  // view (as the first-frame seed image when the leaf is the first in
  // its shot). Mixing it into state-mem refs would double-count.
  return refs;
}
function extractTransitionModeFromSeg(seg, segId) {
  if (seg.transition && seg.transition.mode) return seg.transition.mode;
  const m = /_(\d+)$/.exec(segId);
  if (m && parseInt(m[1], 10) === 0) return "anchor";
  return "sequential";
}

/* ── View / nav ────────────────────────────────────────────────────────── */
const VIEWS = ["form", "running", "final", "error"];
function showView(name) {
  const map = { form: dom.viewForm, running: dom.viewRunning, final: dom.viewFinal, error: dom.viewError };
  for (const k of VIEWS) map[k].hidden = (k !== name);
  if (name === "form") setNav("form");
  if (name === "final") setNav("final");
  if (name === "error") setNav("error");
}
function setNav(stage) {
  state.navStage = stage;
  for (const pill of dom.navPills) {
    pill.classList.toggle("active", pill.dataset.nav === stage);
  }
}

/* ── 5-chip section progress ───────────────────────────────────────────── */
function setChip(num, status) {
  const chip = document.querySelector(`.section-chips .chip[data-chip="${num}"]`);
  if (!chip) return;
  chip.dataset.active = (status === "active") ? "true" : "false";
  chip.dataset.done = (status === "done") ? "true" : "false";
}
function resetChips() {
  for (let i = 1; i <= 5; i++) setChip(i, "pending");
}

function setStateRowDot(rowKey, status) {
  // rowKey: "extractor" | "refresh" | "feedback"
  // status: "off" | "running" | "ok" | "err"
  const row = document.querySelector(`.state-row[data-state-row="${rowKey}"]`);
  if (!row) return;
  const dot = row.querySelector(".state-dot");
  if (!dot) return;
  dot.className = "state-dot " + status;
}

/* ── Local-only history (localStorage; survives reloads, per-browser) ──
   The static deploy has no server-side jsonl. History is persisted
   client-side and bounded to MAX_HISTORY entries (newest first). */
const HISTORY_KEY = "msve_history_v1";
const MAX_HISTORY = 100;

function readHistoryLS() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}
function writeHistoryLS(items) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); }
  catch (e) { console.warn("history write failed", e); }
}
function appendHistoryRecord(rec) {
  const items = readHistoryLS();
  // Dedupe by job_id (so re-playing the same local run doesn't pile up dupes)
  const filtered = items.filter((x) => x.job_id !== rec.job_id);
  filtered.unshift(rec);
  writeHistoryLS(filtered);
}
function findHistoryRecord(jobId) {
  return readHistoryLS().find((r) => r.job_id === jobId) || null;
}

/* Build version appended to JSON fetches as ?v=… — bumping it busts the
   browser HTTP cache when a manifest or index changes. */
const BUILD_VERSION = "20260515-purge-archive";

/* Detect the path prefix the site is mounted under so absolute fetches
   and pushState targets work whether we're deployed at the host root
   (https://example.com/demo/) or under a subdirectory. The SPA always
   lives at <BASE_PATH>/demo/. */
const BASE_PATH = (() => {
  const m = window.location.pathname.match(/^(.*?)\/demo(?:\/|$)/);
  return m ? m[1] : "";
})();

/* ── History list (read from localStorage, populated on each demo done) ── */
async function loadHistory() {
  if (!dom.historyList) return;
  state.history = readHistoryLS();
  renderHistoryList();
}

function fmtRelativeTime(ts) {
  if (!ts) return "—";
  const dt = Math.max(0, (Date.now() / 1000) - ts);
  if (dt < 60) return `${Math.floor(dt)}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
  if (dt < 30 * 86400) return `${Math.floor(dt / 86400)}d ago`;
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}

function renderHistoryList() {
  if (!dom.historyList || !state.history) return;
  if (!state.history.length) {
    dom.historyList.innerHTML = `<p class="history-empty">No runs yet — click a demo card to start one.</p>`;
    return;
  }
  dom.historyList.innerHTML = "";
  for (const rec of state.history) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "history-card";
    card.dataset.jobId = rec.job_id;
    if (rec.kind) card.dataset.kind = rec.kind;
    if (rec.is_rerun) card.dataset.isRerun = "true";
    const poster = rec.poster_url || rec.final_url || "";
    const isVideo = isVideoUrl(poster);
    const posterHtml = poster
      ? (isVideo
          ? `<video src="${escapeHtml(poster)}" muted loop playsinline preload="metadata"></video>`
          : `<img src="${escapeHtml(poster)}" alt="${escapeHtml(rec.title || rec.job_id)}" loading="lazy">`)
      : `<div class="history-poster-empty">no poster</div>`;
    const kindTag = rec.kind === "replay"
      ? `<span class="history-tag replay">replay</span>`
      : `<span class="history-tag real">real</span>`;
    const variantTag = rec.is_rerun
      ? `<span class="history-tag rerun">④ rerun</span>`
      : "";
    card.innerHTML = `
      <div class="history-poster">${posterHtml}</div>
      <div class="history-body">
        <strong class="history-title">${escapeHtml(rec.title || rec.job_id || "(no title)")}</strong>
        <div class="history-chips">
          ${kindTag}${variantTag}
          ${rec.n_shots ? `<span class="history-tag">${rec.n_shots} shots</span>` : ""}
          <span class="history-tag dim">${fmtRelativeTime(rec.completed_at || rec.started_at)}</span>
        </div>
      </div>
    `;
    const vid = card.querySelector("video");
    if (vid) {
      card.addEventListener("mouseenter", () => { vid.currentTime = 0; vid.play().catch(()=>{}); });
      card.addEventListener("mouseleave", () => { vid.pause(); });
    }
    card.addEventListener("click", () => openHistory(rec.job_id));
    dom.historyList.appendChild(card);
  }
}

async function openHistory(jobId) {
  const rec = findHistoryRecord(jobId);
  if (!rec) {
    alert("Replay failed: record not found");
    return;
  }
  // The manifest is the canonical source for events + media; re-fetch
  // by demo_id so the URL signatures are still fresh if the user kept
  // the tab open across a long break.
  let manifest = null;
  try {
    if (rec.demo_id) {
      const slug = rec.slug || (state.slugByDemoId && state.slugByDemoId[rec.demo_id]) || rec.demo_id;
      const r = await fetch(`${BASE_PATH}/demo/data/${encodeURIComponent(slug)}/manifest.json?v=${BUILD_VERSION}`);
      if (r.ok) manifest = await r.json();
    }
  } catch (e) {
    console.warn("history manifest fetch failed", e);
  }
  const events = manifest ? (manifest.events || []) : [];

  state.jobId = rec.job_id || jobId;
  state.isReplay = true;
  state.replayTitle = rec.title || jobId;
  state.replayIsRerun = !!rec.is_rerun;
  state.replayBackend = rec.backend || "";
  state.replayManifest = manifest;
  enterRunning("[history: " + (rec.title || jobId) + "]");
  replayEventsFastForward(events);

  // Drop the user on the final view with the tree fully painted behind it.
  const finalUrl = (manifest && manifest.media && manifest.media.final_mp4)
                    || rec.final_url || rec.poster_url;
  if (finalUrl) {
    onFinalDone({ url: finalUrl });
    enterFinal({
      final_url: finalUrl,
      total_s: Math.max(0, (rec.completed_at || 0) - (rec.started_at || 0)),
    });
  }
}

/* Fast-forward: feed every event into handleEvent with no timing waits.
   The dispatcher already does DOM updates synchronously, so a 90-second
   replay collapses to ~50ms. */
function replayEventsFastForward(events) {
  state.fastForward = true;
  try {
    for (const ev of (events || [])) {
      const copy = { ...ev };
      delete copy.t;  // never block on schedule keys
      try { handleEvent(copy); } catch (e) { console.warn("ff handler threw", ev.type, e); }
    }
  } finally {
    state.fastForward = false;
  }
}

/* ── Demo picker (replay mode) ───────────────────────────────────────── */
async function loadDemos() {
  if (!dom.demoPicker) return;
  try {
    const r = await fetch(`${BASE_PATH}/demo/data/index.json?v=${BUILD_VERSION}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    state.demos = (await r.json()).demos || [];
  } catch (e) {
    dom.demoPicker.innerHTML = `<p class="demo-picker-loading err">demo List failed to load: ${escapeHtml(e.message)}</p>`;
    return;
  }
  // Build slug ↔ demo_id maps so /demo/<slug>/ routes resolve to demoIds.
  state.demoBySlug = {};
  state.slugByDemoId = {};
  for (const d of state.demos) {
    const slug = d.slug || d.demo_id;
    state.demoBySlug[slug] = d.demo_id;
    state.slugByDemoId[d.demo_id] = slug;
  }
  renderDemoPicker();
  // If the page was loaded at /demo/<slug>/, auto-start that demo.
  const slug = currentSlugFromUrl();
  if (slug && state.demoBySlug[slug]) {
    startDemoReplay(state.demoBySlug[slug]);
  }
}

/* Pull the trailing slug from /demo/<slug>/ or /demo/<slug>. Returns "" for
   the picker root and null for any path that isn't under /demo/. */
function currentSlugFromUrl() {
  const m = window.location.pathname.match(/\/demo\/([^/]+)\/?$/);
  return m ? m[1] : "";
}

/* Push /demo/<slug>/ (or /demo/ for the picker) into history without
   reloading. Safe to call repeatedly — same-URL push is a no-op. */
function pushDemoRoute(slug) {
  const target = slug ? `${BASE_PATH}/demo/${slug}/` : `${BASE_PATH}/demo/`;
  if (window.location.pathname === target) return;
  try { history.pushState({ slug: slug || null }, "", target); } catch (_) {}
}
function replaceDemoRoute(slug) {
  const target = slug ? `${BASE_PATH}/demo/${slug}/` : `${BASE_PATH}/demo/`;
  if (window.location.pathname === target) return;
  try { history.replaceState({ slug: slug || null }, "", target); } catch (_) {}
}

function renderDemoPicker() {
  if (!dom.demoPicker || !state.demos) return;
  if (!state.demos.length) {
    dom.demoPicker.innerHTML = `<p class="demo-picker-loading">No demos available.</p>`;
    return;
  }
  dom.demoPicker.innerHTML = "";
  for (const d of state.demos) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "demo-card";
    card.dataset.demoId = d.demo_id;
    if (d.is_rerun) card.dataset.isRerun = "true";
    const variantTag = d.is_rerun
      ? `<span class="demo-tag rerun">④ validator · re-render</span>`
      : `<span class="demo-tag single">single pass</span>`;
    // Title now holds the scene name only ("Boxing", "Dumplings",
    // "Couple", "World Landmarks", "Heavenly Titans"). Backend / mode
    // info is dropped — chips below distinguish single-pass vs
    // validator-rerun runs.
    const displayTitle = d.title || d.demo_id;
    card.innerHTML = `
      <div class="demo-poster">
        <video src="${escapeHtml(d.poster_url || '')}" muted loop playsinline preload="metadata"></video>
      </div>
      <div class="demo-body">
        <strong class="demo-title">${escapeHtml(displayTitle)}</strong>
        <div class="demo-chips">
          ${variantTag}
          <span class="demo-tag">${d.n_shots} shots</span>
          <span class="demo-tag">${Math.round(d.timeline_duration_s || 0)}s</span>
        </div>
      </div>
    `;
    // Veo-style hover playback
    const vid = card.querySelector("video");
    if (vid) {
      card.addEventListener("mouseenter", () => { vid.currentTime = 0; vid.play().catch(()=>{}); });
      card.addEventListener("mouseleave", () => { vid.pause(); });
    }
    card.addEventListener("click", () => {
      pushDemoRoute(d.slug || d.demo_id);
      startDemoReplay(d.demo_id);
    });
    dom.demoPicker.appendChild(card);
  }
}

async function startDemoReplay(demoId) {
  state.selectedDemoId = demoId;
  document.querySelectorAll(".demo-card").forEach((c) => {
    c.disabled = true;
    c.dataset.selected = (c.dataset.demoId === demoId) ? "true" : "false";
  });

  // Switch to the running view IMMEDIATELY — title from the already
  // loaded demo list, zero network wait.
  const d = (state.demos || []).find((x) => x.demo_id === demoId);
  const title = d?.title || demoId;
  state.jobId = "local-" + Date.now().toString(36);   // synthetic
  state.isReplay = true;
  state.replayTitle = d?.title || demoId;
  state.replayBackend = d?.backend || "";
  state.replayIsRerun = !!d?.is_rerun;
  state.replayManifest = null;
  state.replayStartedAt = Date.now() / 1000;
  enterRunning("[demo replay: " + title + "]");

  // Fetch the manifest. The timeline is played entirely client-side
  // with setTimeout, so there is no "connecting…" or job-creation stall.
  let manifest;
  try {
    const slug = d?.slug || (state.slugByDemoId && state.slugByDemoId[demoId]) || demoId;
    const r = await fetch(`${BASE_PATH}/demo/data/${encodeURIComponent(slug)}/manifest.json?v=${BUILD_VERSION}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    manifest = await r.json();
  } catch (e) {
    document.querySelectorAll(".demo-card").forEach((c) => { c.disabled = false; });
    alert(`Failed to load demo: ${e.message}`);
    showView("form");
    setNav("form");
    return;
  }
  state.replayManifest = manifest;

  // Replay the inlined event timeline with setTimeout. Each event has a
  // `t` (seconds from start); we schedule them all up-front so the
  // browser owns the clock — server speed / SSE flow doesn't matter.
  scheduleLocalReplay(manifest.events || [], demoId);
}

function scheduleLocalReplay(events, demoId) {
  // Cancel any previous local replay (e.g. user switched demos mid-run)
  cancelLocalReplay();

  const t0 = Date.now();
  state.replayTimers = [];

  for (const ev of events) {
    const tMs = Math.max(0, (ev.t || 0) * 1000);
    const payload = { ...ev };
    delete payload.t;
    const tid = setTimeout(() => {
      try { handleEvent(payload); } catch (e) { console.warn("local replay event threw", payload.type, e); }
      // After the terminal `done` event, append a localStorage record
      // so the run shows up in the "Replay" sidebar across reloads.
      if (payload.type === "done") {
        const m = state.replayManifest || {};
        const finalUrl = (m.media && m.media.final_mp4) || payload.final_url || "";
        const jobId = "local-" + Date.now().toString(36) + "-" +
                      Math.random().toString(36).slice(2, 8);
        appendHistoryRecord({
          job_id: jobId,
          kind: "replay",
          demo_id: demoId,
          title: m.title || demoId,
          summary: m.summary || "",
          backend: m.backend || "",
          is_rerun: !!m.is_rerun,
          n_shots: m.n_shots || 0,
          n_segments: m.n_segments || 0,
          timeline_duration_s: m.timeline_duration_s || 0,
          final_url: finalUrl,
          poster_url: finalUrl,
          started_at: state.replayStartedAt,
          completed_at: Date.now() / 1000,
        });
        loadHistory();
      }
    }, tMs);
    state.replayTimers.push(tid);
  }

  // Drive the on-screen elapsed clock locally — no SSE ticks needed.
  // The shared running-view ticker (startTicker, started inside
  // enterRunning ~300 ms ago against a different t0) was overwriting
  // the same DOM element on a 1-s cadence, which made the displayed
  // time bounce between two values that differed by the manifest-fetch
  // duration. Stop it before the replay clock takes over.
  stopTicker();
  state.replayClockStart = t0;
  if (state.replayClock) clearInterval(state.replayClock);
  state.replayClock = setInterval(() => {
    if (!state.replayClockStart) return;
    const s = Math.floor((Date.now() - state.replayClockStart) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    if (dom.statusElapsed) dom.statusElapsed.textContent = `${mm}:${ss}`;
  }, 500);
}

function cancelLocalReplay() {
  if (state.replayTimers) {
    for (const tid of state.replayTimers) clearTimeout(tid);
    state.replayTimers = [];
  }
  if (state.replayClock) {
    clearInterval(state.replayClock);
    state.replayClock = null;
  }
  state.replayClockStart = null;
}
/* ── Running ───────────────────────────────────────────────────────────── */
function enterRunning(story) {
  state.tree = freshTree();
  state.selectedSegId = null;
  state.errorTail = [];
  state.startedAt = Date.now();

  // Reset the cancel button (may have been swapped to "← Back to demos"
  // by a previous done/cancel cycle).
  if (dom.cancelBtn) {
    dom.cancelBtn.textContent = "Cancel";
    dom.cancelBtn.disabled = false;
    delete dom.cancelBtn.dataset.role;
  }

  dom.rootStory.textContent = (story || "").slice(0, 280);
  dom.rootNode.dataset.status = "running";
  dom.rootBadge.hidden = true;
  dom.shotColumns.innerHTML = '<p class="tree-empty-hint">Waiting for plan_skeleton (~5s)…</p>';
  dom.shotColumns.dataset.empty = "true";
  dom.bridgesItems.innerHTML = "";
  dom.bridgesRow.hidden = true;
  dom.treeLines.innerHTML = "";

  for (const row of dom.stateRows) {
    const dot = row.querySelector(".state-dot");
    if (dot) dot.className = "state-dot off";
  }
  if (dom.lastExtract) dom.lastExtract.textContent = "—";
  if (dom.lastRefresh) dom.lastRefresh.textContent = "—";
  if (dom.lastFeedback) dom.lastFeedback.textContent = "—";
  state.validatorLog = [];
  renderValidatorLog();

  ["memPortraitItems", "memLocationItems", "memPropItems"].forEach((k) => (dom[k].innerHTML = ""));
  dom.memPortraitCount.textContent = "0";
  dom.memLocationCount.textContent = "0";
  dom.memPropCount.textContent = "0";

  dom.statusStage.textContent = "Connecting…";
  dom.statusElapsed.textContent = "00:00";
  dom.statusDetail.textContent = "Waiting for first event…";
  dom.statusFill.style.width = "0%";

  dom.leafEmpty.hidden = false;
  dom.leafContent.hidden = true;

  resetChips();
  setChip(1, "active");

  showView("running");
  setNav("plan");
  dom.status.textContent = "Running…";

  startTicker();
}

function startTicker() {
  stopTicker();
  state.ticker = setInterval(() => {
    if (!state.startedAt) return;
    const s = Math.floor((Date.now() - state.startedAt) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    dom.statusElapsed.textContent = `${mm}:${ss}`;
  }, 1000);
}
function stopTicker() { if (state.ticker) clearInterval(state.ticker); state.ticker = null; }

// Called when a replay reaches a terminal state. Kept tiny so we don't
// keep an unused live-stream connection abstraction lying around.
function closeSSE() { stopTicker(); }

/* ── Event handler ─────────────────────────────────────────────────────── */
const STAGE_LABELS = {
  spawn_ok: "Pipeline started",
  planner_start: "Planner thinking",
  plan_ok: "Plan skeleton ready",
  render_plan_ok: "Render plan ready",
  render_start: "Rendering started",
};

function handleEvent(ev) {
  const t = ev.type;
  if (STAGE_LABELS[t]) dom.statusStage.textContent = STAGE_LABELS[t];

  // Phase markers carry a status string + detail and act as a brief
  // pause between major phases. They only update the status line.
  if (t === "phase_marker") {
    if (ev.stage) dom.statusStage.textContent = ev.stage;
    if (ev.detail) dom.statusDetail.textContent = ev.detail;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────
  if (t === "spawn_ok" || t === "planner_start") {
    setChip(1, "active");
    bumpProgress(t === "planner_start" ? 5 : 2);
  }
  if (t === "plan_ok") { setChip(1, "done"); setChip(2, "active"); setChip(3, "active"); setChip(4, "active"); bumpProgress(15); onPlanOk(ev); }
  if (t === "render_plan_ok") { bumpProgress(22); onRenderPlanOk(ev); }
  if (t === "render_start") { setChip(2, "active"); bumpProgress(25); }
  if (t === "portrait_ready") onMemReady("portraits", ev);
  if (t === "location_ready") onMemReady("locations", ev);
  if (t === "prop_ready") onMemReady("props", ev);
  if (t === "anchor_ready") {
    onAnchorReady(ev); bumpProgressBy(2, 55);
    // Repaired anchor lands → mark its validator-log entry done.
    if (ev.repaired && ev.id) {
      upsertValidatorEntry(ev.id, { status: "done" }, "anchor");
    }
  }
  if (t === "seg_done") { onSegDone(ev); bumpProgressBy(4, 92); setChip(5, "active"); }
  if (t === "bridge_done") { onBridgeDone(ev); bumpProgressBy(1, 93); }

  // ── Anchor validator ──────────────────────────────────────────────
  if (t === "anchor_validator_start") {
    dom.statusStage.textContent = `Anchor validator ${ev.id || ""}`;
  }
  if (t === "anchor_validator_pass") { /* badge could be added; for now silent */ }
  if (t === "anchor_validator_fail") {
    dom.statusDetail.textContent =
      `Anchor ${ev.id} rejected: ${ev.reason || "other"}; re-rendering…`;
    if (ev.id) {
      upsertValidatorEntry(ev.id, {
        reason: ev.reason || "other",
        status: "queued",
      }, "anchor");
    }
  }
  if (t === "anchor_repair_start") {
    dom.statusStage.textContent = `Anchor repair ${ev.id || ""} (${ev.action || ""})`;
    if (ev.id) {
      upsertValidatorEntry(ev.id, {
        action: ev.action || "?",
        status: "running",
      }, "anchor");
    }
  }

  // ── Segment validator (④ Adaptive State Update — paper §5.3) ──────
  // Three sub-stages map to the left-rail State Pipeline rows
  // (Extractor → Refresh → Feed Back).
  if (t === "segment_validator_start") {
    setStateRowDot("extractor", "running");
    setChip(4, "active");
    dom.statusStage.textContent = "④ Validator started";
    if (dom.lastExtract) dom.lastExtract.textContent = "running…";
    bumpProgressBy(0, 92);
  }
  if (t === "segment_extractor_ok") {
    setStateRowDot("extractor", "ok");
    setStateRowDot("refresh", "running");
    if (dom.lastExtract) dom.lastExtract.textContent = "extracted";
    if (dom.lastRefresh) dom.lastRefresh.textContent = "running…";
    dom.statusStage.textContent = "④ Refresh State";
  }
  if (t === "segment_refresh_ok") {
    setStateRowDot("refresh", "ok");
    setStateRowDot("feedback", "running");
    if (dom.lastRefresh) dom.lastRefresh.textContent = "refreshed";
    if (dom.lastFeedback) dom.lastFeedback.textContent = "running…";
    dom.statusStage.textContent = "④ Feed Back";
  }
  if (t === "segment_feedback_pass") {
    setStateRowDot("feedback", "ok");
    if (dom.lastFeedback) dom.lastFeedback.textContent = "all clear";
    dom.statusDetail.textContent = "Validator passed — no re-render needed.";
  }
  if (t === "segment_feedback_flagged") {
    setStateRowDot("feedback", "ok");
    const flagged = ev.flagged || [];
    if (dom.lastFeedback) dom.lastFeedback.textContent =
      `flagged ${flagged.length} segs`;
    const reasons = ev.reasons || {};
    const reasonsStr = ev.reasons
      ? " (" + Object.entries(reasons).map(([id, r]) => `${id}:${r}`).join(", ") + ")"
      : "";
    dom.statusDetail.textContent =
      `Validator flagged ${flagged.length} segment(s) for re-render: ${flagged.join(", ")}${reasonsStr}`;
    for (const segId of flagged) {
      const card = document.querySelector(`.leaf-card[data-seg-id="${CSS.escape(segId)}"]`);
      if (card) card.dataset.flagged = "true";
      upsertValidatorEntry(segId, {
        reason: reasons[segId] || "other",
        status: "queued",
      });
    }
  }
  if (t === "segment_repair_start") {
    const card = document.querySelector(`.leaf-card[data-seg-id="${CSS.escape(ev.id || "")}"]`);
    if (card) {
      card.dataset.status = "running";
      card.dataset.rerendering = "true";
    }
    dom.statusStage.textContent = `④ Repair ${ev.id || ""} (${ev.action || "?"})`;
    if (ev.id) {
      upsertValidatorEntry(ev.id, {
        action: ev.action || "?",
        status: "running",
      });
    }
  }
  if (t === "final_done") { bumpProgress(96); onFinalDone(ev); }
  if (t === "done") {
    bumpProgress(100); dom.status.textContent = "Done";
    setChip(2, "done"); setChip(3, "done"); setChip(4, "done"); setChip(5, "done");
    // Stay on the running view — final.mp4 already mounted inline via
    // onFinalDone() inside the ROOT node's rootBadge. Clear the noisy
    // last-event status line and repurpose the cancel button as
    // "← Back to demos" so the user has a way out.
    dom.statusStage.textContent = "✓ Done";
    dom.statusDetail.textContent = "Final video ready — scroll to see the full tree.";
    if (dom.cancelBtn) {
      dom.cancelBtn.textContent = "← Back to demos";
      dom.cancelBtn.disabled = false;
      dom.cancelBtn.dataset.role = "back";
    }
    closeSSE();
  }
  if (t === "exit" || t === "error") {
    if (ev.status === "cancelled") {
      dom.statusDetail.textContent = "Job cancelled.";
      dom.status.textContent = "Cancelled"; closeSSE(); return;
    }
    dom.status.textContent = t === "error" ? "Failed" : "Exited";
    enterError(ev); closeSSE();
  }
  if (t === "tick" && ev.elapsed_s != null) {
    const s = Math.floor(ev.elapsed_s);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    dom.statusElapsed.textContent = `${mm}:${ss}`;
  }
  if (ev.msg && t === "error") state.errorTail.push(`[error] ${ev.msg}`);
  if (ev.msg && t !== "error") dom.statusDetail.textContent = ev.msg;
}

function bumpProgress(pct) {
  pct = Math.max(0, Math.min(100, pct));
  const cur = parseFloat(dom.statusFill.style.width) || 0;
  if (pct > cur) dom.statusFill.style.width = pct + "%";
}
function bumpProgressBy(delta, cap) {
  const cur = parseFloat(dom.statusFill.style.width) || 0;
  bumpProgress(Math.min(cap, cur + delta));
}

/* ── plan_ok ─────────────────────────────────────────────────────────────
   plan_skeleton returned. The tree skeleton (shot columns + state-memory
   slots) appears NOW — not before. Leaves are NOT created yet; they come
   from a separate render_plan call (handled by onRenderPlanOk). */
function onPlanOk(ev) {
  if (state.replayManifest) {
    try { preSeedSkeletonFromManifest(state.replayManifest); }
    catch (e) { console.error("onPlanOk threw", e); }
    renderShots();
    renderMemory();
    queueDrawLines();
    return;
  }
  // No manifest — nothing to seed; tree keeps its placeholders.
  queueDrawLines();
}

/* ── render_plan_ok ──────────────────────────────────────────────────────
   render_plan returned: paint leaf placeholders under each shot column. */
function onRenderPlanOk(ev) {
  if (state.replayManifest) {
    try { preSeedRenderPlanFromManifest(state.replayManifest); }
    catch (e) { console.error("onRenderPlanOk threw", e); }
    renderShots();
    queueDrawLines();
    return;
  }
  // No manifest — nothing structural to paint; the tree will keep its
  // pre-seeded placeholders.
  queueDrawLines();
  return;
}
function extractRefs(flf2v, seg) {
  // Same shape variants as extractRefsFromSeg — delegate so the two stay
  // in sync.
  return extractRefsFromSeg(flf2v, seg);
}

function extractTransitionMode(seg, segId) {
  if (seg.transition && seg.transition.mode) return seg.transition.mode;
  const m = /_(\d+)$/.exec(segId);
  if (m && parseInt(m[1], 10) === 0) return "anchor";
  return "sequential";
}

/* ── State memory ──────────────────────────────────────────────────────── */
function onMemReady(group, ev) {
  if (!ev.id || !ev.url) return;
  const slot = state.tree.memory[group];
  if (!slot[ev.id]) slot[ev.id] = { id: ev.id, name: humanizeId(ev.id), url: null };
  slot[ev.id].url = ev.url;
  renderMemoryGroup(group);
}

function renderMemory() {
  renderMemoryGroup("portraits");
  renderMemoryGroup("locations");
  renderMemoryGroup("props");
}

/* Render the ④ Adaptive State Update panel's two "re-render" lists: one for
   anchors (anchor_validator → anchor_repair_start → anchor_ready), one
   for segments (segment_validator → segment_repair_start →
   seg_done{rerendered:true}). Each entry is updated in place as the
   chain progresses. */
function renderValidatorLog() {
  const log = state.validatorLog || [];
  const anchorEntries  = log.filter((e) => e.kind === "anchor");
  const segmentEntries = log.filter((e) => e.kind !== "anchor");
  _renderValidatorSection(dom.validatorLogAnchors,  dom.validatorLogAnchorsEmpty,  anchorEntries);
  _renderValidatorSection(dom.validatorLogSegments, dom.validatorLogSegmentsEmpty, segmentEntries);
}

function _renderValidatorSection(ul, emptyEl, entries) {
  if (!ul) return;
  if (!entries.length) {
    ul.hidden = true;
    ul.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  ul.hidden = false;
  ul.innerHTML = "";
  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "validator-log-entry";
    li.dataset.status = entry.status || "queued";
    li.dataset.kind = entry.kind || "segment";
    const icon = entry.status === "done" ? "✓"
               : entry.status === "running" ? "⟳"
               : "·";
    li.innerHTML = `
      <span class="vlog-icon">${icon}</span>
      <div class="vlog-body">
        <strong class="vlog-id">${escapeHtml(entry.seg_id)}</strong>
        <div class="vlog-meta">
          <span class="vlog-reason">${escapeHtml(entry.reason || "—")}</span>
          ${entry.action ? `<span class="vlog-action">→ ${escapeHtml(entry.action)}</span>` : ""}
        </div>
      </div>
      <span class="vlog-status">${entry.status === "done" ? "rerendered"
                                : entry.status === "running" ? "running…"
                                : "queued"}</span>
    `;
    ul.appendChild(li);
  }
}

function upsertValidatorEntry(seg_id, patch, kind = "segment") {
  const log = state.validatorLog || (state.validatorLog = []);
  let entry = log.find((e) => e.seg_id === seg_id);
  if (!entry) {
    entry = { seg_id, kind, reason: "", action: "", status: "queued", history: [] };
    log.push(entry);
  }
  if (kind) entry.kind = kind;
  // Append a history step whenever a meaningful field changes.
  entry.history = entry.history || [];
  if (patch.reason && patch.reason !== entry.reason) {
    entry.history.push({ step: "flagged", reason: patch.reason });
  }
  if (patch.action && patch.action !== entry.action) {
    entry.history.push({ step: "repair", action: patch.action });
  }
  if (patch.status === "done" && entry.status !== "done") {
    entry.history.push({ step: "rerendered" });
  }
  Object.assign(entry, patch);
  renderValidatorLog();
  // If this segment is currently in the right-side leaf detail panel,
  // refresh its validation block too.
  if (state.selectedSegId === seg_id) {
    for (const shot of state.tree.shots) {
      const leaf = shot.leaves.find((l) => l.id === seg_id);
      if (leaf) { renderLeafValidation(leaf); break; }
    }
  }
}
function renderMemoryGroup(group) {
  const items = state.tree.memory[group];
  const ids = Object.keys(items);
  const map = {
    portraits: ["memPortraitItems", "memPortraitCount"],
    locations: ["memLocationItems", "memLocationCount"],
    props: ["memPropItems", "memPropCount"],
  };
  const [itemsKey, countKey] = map[group];
  const itemsEl = dom[itemsKey];
  const countEl = dom[countKey];
  countEl.textContent = ids.length;
  itemsEl.innerHTML = "";
  for (const id of ids) {
    const it = items[id];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "mem-chip";
    chip.dataset.memId = id;
    chip.dataset.memGroup = group;
    if (it.url) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = it.name;
      img.src = it.url;
      chip.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.style.cssText = "aspect-ratio:1/1;background:rgba(247,244,236,0.04);display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:9px;";
      ph.textContent = "pending";
      chip.appendChild(ph);
    }
    const name = document.createElement("span");
    name.className = "mem-chip-name";
    name.textContent = it.name || id;
    chip.appendChild(name);
    chip.addEventListener("mouseenter", () => highlightLeavesForRef(id, true, false));
    chip.addEventListener("mouseleave", () => highlightLeavesForRef(id, false, false));
    chip.addEventListener("click", () => highlightLeavesForRef(id, true, true));
    itemsEl.appendChild(chip);
  }
}

function highlightLeavesForRef(refId, on, scrollFirst) {
  let first = null;
  document.querySelectorAll(".leaf-card").forEach((card) => {
    const segId = card.dataset.segId;
    if (!segId) return;
    const seg = findSegById(segId);
    if (!seg) return;
    const hit = (seg.refs || []).some((r) => r.id === refId);
    card.style.outline = (on && hit) ? "2px solid var(--gold)" : "";
  });
  if (on && scrollFirst && first) first.scrollIntoView({ behavior: "smooth", block: "center" });
}

function findSegById(segId) {
  for (const shot of (state.tree?.shots || [])) {
    for (const seg of (shot.leaves || [])) if (seg.id === segId) return seg;
  }
  return null;
}
function findShotForSeg(segId) {
  for (const shot of (state.tree?.shots || [])) {
    for (const seg of (shot.leaves || [])) if (seg.id === segId) return shot;
  }
  return null;
}

/* ── Anchor / Seg / Bridge ready ───────────────────────────────────────── */
function onAnchorReady(ev) {
  const aId = ev.id;
  if (!aId) return;
  let shot = state.tree.shots.find((s) => s.anchorId === aId);
  if (!shot) {
    const infer = aId.replace(/^a\d+_/, "").replace(/_start$/, "");
    shot = state.tree.shots.find((s) => s.id === infer || s.id.endsWith(infer));
    if (shot && !shot.anchorId) shot.anchorId = aId;
  }
  if (!shot) {
    shot = state.tree.shots.find((s) => !s.anchorUrl);
    if (shot && !shot.anchorId) shot.anchorId = aId;
  }
  if (shot) {
    shot.anchorUrl = ev.url;
    shot.status = "running";
    renderShots();
    queueDrawLines();
  }
}

function onSegDone(ev) {
  const segId = ev.id;
  if (!segId) return;
  // Re-rendered seg: clear repair-in-progress visuals and mark the
  // validator-log entry done so the ④ panel turns ✓.
  if (ev.rerendered) {
    const card = document.querySelector(`.leaf-card[data-seg-id="${CSS.escape(segId)}"]`);
    if (card) {
      delete card.dataset.rerendering;
      delete card.dataset.flagged;
    }
    upsertValidatorEntry(segId, { status: "done" });
  }
  let placed = false;
  for (const shot of state.tree.shots) {
    const seg = shot.leaves.find((l) => l.id === segId);
    if (seg) {
      seg.url = ev.url;
      seg.status = "done";
      if (ev.rerendered) seg.rerendered = true;
      shot.status = "running";
      placed = true;
      // Re-render this shot's column for new poster
      renderShots();
      queueDrawLines();
      if (!state.selectedSegId) {
        state.selectedSegId = segId;
        renderLeafDetail(shot, seg);
      } else if (state.selectedSegId === segId) {
        renderLeafDetail(shot, seg);
      }
      break;
    }
  }
  if (!placed) {
    const lastShot = state.tree.shots[state.tree.shots.length - 1];
    if (lastShot) {
      lastShot.leaves.push({
        id: segId, status: "done", url: ev.url,
        prompt: "", refs: [], backend: "segment", kind: "segment_r2v",
        duration_s: ev.duration_s || 0, transition_mode: "sequential",
        order: lastShot.leaves.length,
      });
      renderShots();
      queueDrawLines();
    }
  }
}

function onBridgeDone(ev) {
  if (!ev.id) return;
  state.tree.bridges[ev.id] = { id: ev.id, url: ev.url, status: "done" };
  renderBridges();
}

function onFinalDone(ev) {
  dom.rootNode.dataset.status = "done";
  dom.rootBadge.hidden = false;
  if (dom.rootBadgeTitle) dom.rootBadgeTitle.textContent = "★ Final concatenated mp4";
  if (dom.rootFinalVideo && ev.url) dom.rootFinalVideo.src = ev.url;
}

/* ── Tree rendering ────────────────────────────────────────────────────── */
function renderShots() {
  const cols = dom.shotColumns;
  if (!state.tree.shots.length) {
    cols.dataset.empty = "true";
    cols.innerHTML = '<p class="tree-empty-hint">Waiting for plan_skeleton (~5s)…</p>';
    return;
  }
  cols.dataset.empty = "false";
  cols.innerHTML = "";
  state.tree.shots.forEach((shot, idx) => cols.appendChild(renderShotColumn(shot, idx)));
}

function renderShotColumn(shot, idx) {
  const col = document.createElement("div");
  col.className = "shot-column";
  col.dataset.shotId = shot.id;

  const a = document.createElement("button");
  a.type = "button";
  a.className = "shot-anchor";
  a.dataset.status = shot.anchorUrl ? "done" : (shot.status === "running" ? "running" : "pending");
  a.dataset.shotId = shot.id;
  if (shot.anchorUrl) {
    const img = document.createElement("img");
    img.className = "anchor-thumb";
    img.loading = "lazy";
    img.alt = shot.id;
    img.src = shot.anchorUrl;
    a.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "anchor-thumb";
    a.appendChild(ph);
  }
  const meta = document.createElement("div");
  meta.className = "anchor-meta";
  const titleText = shot.id;
  meta.innerHTML = `<strong>${escapeHtml(titleText)}</strong><small>plan · anchor frame</small>`;
  a.appendChild(meta);
  a.addEventListener("click", () => onAnchorClick(shot));
  col.appendChild(a);

  const leavesDiv = document.createElement("div");
  leavesDiv.className = "shot-leaves";
  if (!shot.leaves.length) {
    const ph = document.createElement("div");
    ph.className = "leaf-spinner";
    ph.textContent = "planning";
    leavesDiv.appendChild(ph);
  } else {
    shot.leaves.forEach((leaf) => leavesDiv.appendChild(renderLeafCard(shot, leaf)));
  }
  col.appendChild(leavesDiv);
  return col;
}

function isVideoUrl(u) {
  if (!u) return false;
  return /\.(mp4|webm|mov)(\?|$)/i.test(u);
}
function isImageUrl(u) {
  if (!u) return false;
  return /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(u);
}

function renderLeafCard(shot, leaf) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "leaf-card";
  card.dataset.status = leaf.status;
  card.dataset.shotId = shot.id;
  card.dataset.segId = leaf.id;
  card.dataset.selected = (leaf.id === state.selectedSegId) ? "true" : "false";
  if (leaf.rerendered) card.dataset.rerendered = "true";

  if (leaf.status === "done" && leaf.url) {
    const url = leaf.url;
    let media;
    if (isImageUrl(url)) {
      media = document.createElement("img");
      media.className = "leaf-thumb";
      media.loading = "lazy";
      media.alt = leaf.id;
      media.src = url;
    } else {
      media = document.createElement("video");
      media.className = "leaf-thumb";
      media.muted = true;
      media.playsInline = true;
      media.preload = "metadata";
      media.src = url + (url.includes("#") ? "" : "#t=0.5");
    }
    card.appendChild(media);
    const meta = document.createElement("div");
    meta.className = "leaf-meta";
    const labelParts = leaf.id.replace(/^seg_/, "").split("_");
    labelParts.pop();
    const label = labelParts.join("_") || shot.id;
    const chipHtml =
      (leaf.duration_s ? `<span class="leaf-chip">${leaf.duration_s}s</span>` : "") +
      `<span class="leaf-chip">${escapeHtml(leaf.backend || "segment")}</span>` +
      (leaf.rerendered ? `<span class="leaf-chip rerendered">re-rendered</span>` : "");
    meta.innerHTML = `<strong>${escapeHtml(label)}</strong><div class="leaf-chip-row">${chipHtml}</div>`;
    card.appendChild(meta);
  } else {
    const sp = document.createElement("div");
    sp.className = "leaf-spinner";
    sp.textContent = leaf.status === "pending" ? "queued" : leaf.status;
    card.appendChild(sp);
  }
  card.addEventListener("click", () => onLeafClick(shot, leaf));
  return card;
}

function renderBridges() {
  const ids = Object.keys(state.tree.bridges);
  if (!ids.length) { dom.bridgesRow.hidden = true; return; }
  dom.bridgesRow.hidden = false;
  dom.bridgesItems.innerHTML = "";
  for (const bid of ids) {
    const b = state.tree.bridges[bid];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "bridge-card";
    card.dataset.status = b.status;
    if (b.url) {
      let media;
      if (isImageUrl(b.url)) {
        media = document.createElement("img");
        media.className = "bridge-thumb";
        media.loading = "lazy";
        media.alt = bid;
        media.src = b.url;
      } else {
        media = document.createElement("video");
        media.className = "bridge-thumb";
        media.muted = true;
        media.playsInline = true;
        media.preload = "metadata";
        media.src = b.url + (b.url.includes("#") ? "" : "#t=0.3");
      }
      card.appendChild(media);
    }
    const label = document.createElement("strong");
    label.textContent = bid;
    card.appendChild(label);
    dom.bridgesItems.appendChild(card);
  }
}

/* ── Click handlers ─────────────────────────────────────────────────────── */
function onAnchorClick(shot) {
  document.querySelectorAll(".leaf-card").forEach((c) => {
    c.style.outline = (c.dataset.shotId === shot.id) ? "2px solid var(--cyan)" : "";
  });
  setTimeout(() => { document.querySelectorAll(".leaf-card").forEach((c) => { c.style.outline = ""; }); }, 1800);
}

function onLeafClick(shot, leaf) {
  state.selectedSegId = leaf.id;
  document.querySelectorAll(".leaf-card").forEach((c) => {
    c.dataset.selected = (c.dataset.segId === leaf.id) ? "true" : "false";
  });
  renderLeafDetail(shot, leaf);
  document.querySelectorAll(".mem-chip").forEach((c) => {
    const id = c.dataset.memId;
    c.dataset.highlight = (leaf.refs || []).some((r) => r.id === id) ? "true" : "false";
  });
}

function renderLeafDetail(shot, leaf) {
  dom.leafEmpty.hidden = true;
  dom.leafContent.hidden = false;
  dom.leafTitle.textContent = leaf.id;
  // status/shot/kind subtitle dropped — leaf id + the section labels
  // below already convey the same info, and the line was visual noise.
  if (dom.leafSubtitle) dom.leafSubtitle.hidden = true;

  dom.ctxPrev.innerHTML = "";
  const idx = shot.leaves.indexOf(leaf);
  let prevTail = null;
  if (idx > 0 && shot.leaves[idx - 1].url) {
    prevTail = shot.leaves[idx - 1].url.replace(/\.mp4$/, ".tail.png");
  }
  if (prevTail) {
    const img = document.createElement("img");
    img.src = prevTail;
    img.alt = "prev tail";
    img.style.cssText = "max-width:100%;border-radius:4px;background:#0a0d18;";
    img.onerror = () => {
      const p = document.createElement("p");
      p.className = "ctx-empty";
      p.textContent = "Previous tail-frame not yet extracted";
      img.replaceWith(p);
    };
    dom.ctxPrev.appendChild(img);
  } else {
    const note = document.createElement("p");
    note.className = "ctx-empty";
    note.textContent = "This is the shot's first leaf — prev seg = anchor frame";
    dom.ctxPrev.appendChild(note);
    if (shot.anchorUrl) {
      const img = document.createElement("img");
      img.src = shot.anchorUrl;
      img.alt = "anchor as prev";
      img.style.cssText = "max-width:100%;border-radius:4px;background:#0a0d18;margin-top:6px;";
      dom.ctxPrev.appendChild(img);
    }
  }

  dom.ctxPrompt.textContent = leaf.prompt || "(no prompt found in render_plan.json)";

  dom.ctxRefs.innerHTML = "";
  if (!leaf.refs || !leaf.refs.length) {
    dom.ctxRefs.innerHTML = '<p class="ctx-empty">(no references)</p>';
  } else {
    for (const ref of leaf.refs) {
      const chip = document.createElement("span");
      chip.className = "ref-chip";
      if (ref.role) chip.dataset.role = ref.role;
      // Thumbnail lookup: direct match in memory, then fall back across
      // groups. key_zones (e.g. "kitchen_prep_counter") are sub-regions
      // and won't have their own entry — they're not uploaded as
      // separate images — so they end up as text-only chips.
      const memUrl = (state.tree.memory.portraits[ref.id]?.url
                  || state.tree.memory.locations[ref.id]?.url
                  || state.tree.memory.props[ref.id]?.url);
      if (memUrl) {
        const img = document.createElement("img");
        img.src = memUrl;
        img.alt = ref.id;
        chip.appendChild(img);
      }
      const body = document.createElement("span");
      body.className = "ref-chip-body";
      if (ref.role) {
        const roleEl = document.createElement("em");
        roleEl.className = "ref-chip-role";
        roleEl.textContent = ref.role;
        body.appendChild(roleEl);
      }
      const text = document.createElement("strong");
      text.className = "ref-chip-name";
      text.textContent = humanizeId(ref.id);
      body.appendChild(text);
      chip.appendChild(body);
      dom.ctxRefs.appendChild(chip);
    }
  }

  dom.genCard.innerHTML = `
    <div class="gen-row"><b>kind</b><span>${escapeHtml(leaf.kind || "segment_r2v")}</span></div>
    <div class="gen-row"><b>duration</b><span>${leaf.duration_s || "?"}s</span></div>
    <div class="gen-row"><b>seed</b><span>0</span></div>
  `;

  dom.outputBlock.innerHTML = "";
  if (leaf.url) {
    if (isVideoUrl(leaf.url)) {
      const v = document.createElement("video");
      v.src = leaf.url;
      v.controls = true;
      v.playsInline = true;
      dom.outputBlock.appendChild(v);
    } else {
      // Static demo replay: leaf "url" is the tail PNG (writes-back-to-state).
      const img = document.createElement("img");
      img.src = leaf.url;
      img.alt = leaf.id;
      img.style.cssText = "max-width:100%;border-radius:8px;background:#03060c;border:1px solid rgba(98,220,255,0.28);";
      dom.outputBlock.appendChild(img);
      const note = document.createElement("p");
      note.className = "output-meta";
      note.style.color = "var(--cyan)";
      note.textContent = "tail.png · last frame of the rendered segment (demo replays show the tail only, not the full mp4)";
      dom.outputBlock.appendChild(note);
    }
    const meta = document.createElement("p");
    meta.className = "output-meta";
    meta.textContent = `duration ${leaf.duration_s || "?"}s · cond=prev boundary · writes back: tail.png`;
    dom.outputBlock.appendChild(meta);
  } else {
    dom.outputBlock.innerHTML = `<p class="ctx-empty">leaf status: ${escapeHtml(leaf.status)}；video not yet generated。</p>`;
  }

  renderLeafValidation(leaf);
}

/* Per-leaf validation block on the right "One Leaf In Detail" panel.
   Reads the same state.validatorLog the ④ panel does and picks out
   THIS segment's entry. Shows the full repair history when present
   (flagged → repair → rerendered) so the user can see WHAT happened
   to this specific leaf. */
function renderLeafValidation(leaf) {
  const el = dom.leafValidation;
  if (!el) return;
  const entry = (state.validatorLog || []).find((e) => e.seg_id === leaf.id);
  if (!entry) {
    el.innerHTML =
      `<p class="leaf-validation-pass">` +
        `<span class="leaf-validation-badge ok">PASS</span>` +
        `<span>Passed validator on first pass — no re-render needed.</span>` +
      `</p>`;
    return;
  }
  const statusLabel = entry.status === "done" ? "✓ re-rendered" :
                      entry.status === "running" ? "⟳ re-rendering…" : "· queued";
  const stepLabels = {
    flagged:    (h) => `flagged · reason <b>${escapeHtml(h.reason || "?")}</b>`,
    repair:     (h) => `repair action <b>${escapeHtml(h.action || "?")}</b>`,
    rerendered: ()  => `Re-rendered — new tail.png written back to state`,
  };
  const historyRows = (entry.history || []).map((h, i) => `
    <li class="leaf-validation-step">
      <span class="leaf-validation-step-idx">${i + 1}</span>
      <span class="leaf-validation-step-text">${stepLabels[h.step](h)}</span>
    </li>
  `).join("");
  el.innerHTML = `
    <p class="leaf-validation-row">
      <b>Status</b>
      <span data-status="${entry.status}">${statusLabel}</span>
    </p>
    <p class="leaf-validation-section">Repair history</p>
    <ol class="leaf-validation-history">${historyRows || `<li class="leaf-validation-step-empty">…</li>`}</ol>
  `;
}

/* ── SVG lines ─────────────────────────────────────────────────────────── */
let drawLinesPending = false;
function queueDrawLines() {
  if (drawLinesPending) return;
  drawLinesPending = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawLinesPending = false;
    drawTreeLines();
  }));
}
function drawTreeLines() {
  const svg = dom.treeLines;
  const wrap = svg.parentElement;
  if (!svg || !wrap) return;
  const wrapRect = wrap.getBoundingClientRect();
  svg.setAttribute("width", String(Math.max(0, wrap.scrollWidth)));
  svg.setAttribute("height", String(Math.max(0, wrap.scrollHeight)));
  svg.style.width = wrap.scrollWidth + "px";
  svg.style.height = wrap.scrollHeight + "px";
  svg.innerHTML = "";
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - wrapRect.left + wrap.scrollLeft, y: r.top - wrapRect.top + wrap.scrollTop, w: r.width, h: r.height };
  };
  const rootEl = dom.rootNode;
  if (!rootEl) return;
  const rootR = rect(rootEl);
  const rootBottom = { x: rootR.x + rootR.w / 2, y: rootR.y + rootR.h };
  wrap.querySelectorAll(".shot-anchor").forEach((anchorEl) => {
    const ar = rect(anchorEl);
    const aTop = { x: ar.x + ar.w / 2, y: ar.y };
    const mid = (rootBottom.y + aTop.y) / 2;
    const d = `M ${rootBottom.x},${rootBottom.y} C ${rootBottom.x},${mid} ${aTop.x},${mid} ${aTop.x},${aTop.y}`;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "line-root");
    svg.appendChild(path);
  });
  wrap.querySelectorAll(".shot-column").forEach((col) => {
    const anchorEl = col.querySelector(".shot-anchor");
    if (!anchorEl) return;
    const leaves = col.querySelectorAll(".leaf-card");
    const ar = rect(anchorEl);
    const aBot = { x: ar.x + ar.w / 2, y: ar.y + ar.h };
    leaves.forEach((leafEl, idx) => {
      const lr = rect(leafEl);
      const lTop = { x: lr.x + lr.w / 2, y: lr.y };
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const cls = (idx === 0) ? "line-parallel" : "line-sequential";
      path.setAttribute("class", cls);
      path.setAttribute("d", `M ${aBot.x},${aBot.y} L ${lTop.x},${lTop.y}`);
      svg.appendChild(path);
    });
  });
}
window.addEventListener("resize", () => queueDrawLines());
window.addEventListener("scroll", () => queueDrawLines(), true);

/* ── Final view ────────────────────────────────────────────────────────── */
function enterFinal(ev) {
  const url = ev.final_url || ev.url;
  if (!url) return;
  dom.finalVideo.src = url;
  dom.downloadLink.href = url;
  if (ev.total_s != null) {
    const s = Math.floor(ev.total_s);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    const nShots = (state.tree?.shots || []).length || "—";
    dom.finalSubtitle.textContent = `Total ${mm}m ${ss}s · shots ${nShots}`;
  }
  setNav("final");
  showView("final");
}

dom.copyLinkBtn.addEventListener("click", async () => {
  const url = dom.downloadLink.href;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    dom.copyLinkBtn.textContent = "Copied";
    setTimeout(() => { dom.copyLinkBtn.textContent = "Copy watch link"; }, 1500);
  } catch (_) { dom.copyLinkBtn.textContent = "Copy failed"; }
});

dom.restartBtn.addEventListener("click", () => {
  cancelLocalReplay();
  state.jobId = null;
  pushDemoRoute("");
  showView("form");
  setNav("form");
  dom.status.textContent = "Ready";
  document.querySelectorAll(".demo-card").forEach((c) => {
    c.disabled = false; delete c.dataset.selected;
  });
});
if (dom.backToTreeBtn) {
  dom.backToTreeBtn.addEventListener("click", () => {
    // The running view still has the populated tree (enterFinal doesn't
    // tear it down). Just flip back so the user can scroll the columns
    // and re-inspect any leaf. The "final" video is still mounted as
    // the rootFinalVideo inside the tree's ROOT node.
    showView("running");
    setNav("plan");
    queueDrawLines();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
dom.cancelBtn.addEventListener("click", async () => {
  // Post-done state — the button was relabeled "← Back to demos".
  if (dom.cancelBtn.dataset.role === "back") {
    cancelLocalReplay();
    state.jobId = null;
    pushDemoRoute("");
    showView("form");
    setNav("form");
    dom.status.textContent = "Ready";
    // Re-enable every demo card — startDemoReplay disables them all on
    // click, and we never unlocked them when leaving the running view.
    document.querySelectorAll(".demo-card").forEach((c) => {
      c.disabled = false;
      delete c.dataset.selected;
    });
    return;
  }
  dom.cancelBtn.disabled = true;
  if (state.replayTimers && state.replayTimers.length) {
    cancelLocalReplay();
    dom.statusDetail.textContent = "Replay cancelled.";
    dom.status.textContent = "Cancelled";
    // Flip the cancel button into "back" mode so the user can leave.
    dom.cancelBtn.textContent = "← Back to demos";
    dom.cancelBtn.disabled = false;
    dom.cancelBtn.dataset.role = "back";
    return;
  }
});

function enterError(ev) {
  let body = "";
  if (ev.msg) body += `msg: ${ev.msg}\n`;
  if (ev.tail) body += ev.tail + "\n";
  if (ev.code != null) body += `\n[exit code: ${ev.code}]\n`;
  body += "\n--- recent event tail ---\n" + state.errorTail.join("\n");
  dom.errorBox.textContent = body || "(no error detail)";
  setNav("error");
  showView("error");
}
dom.errorRestartBtn.addEventListener("click", () => {
  state.jobId = null;
  pushDemoRoute("");
  showView("form");
  setNav("form");
  dom.status.textContent = "Ready";
  document.querySelectorAll(".demo-card").forEach((c) => {
    c.disabled = false; delete c.dataset.selected;
  });
});

/* ── URL routing — browser back/forward keeps state in sync. ──────────── */
window.addEventListener("popstate", () => {
  const slug = currentSlugFromUrl();
  const targetDemoId = (slug && state.demoBySlug) ? state.demoBySlug[slug] : null;
  if (targetDemoId) {
    // /demo/<slug>/ — if already playing the same demo, no-op.
    if (state.selectedDemoId === targetDemoId) return;
    startDemoReplay(targetDemoId);
  } else {
    // /demo/ or unrecognised slug — return to picker.
    cancelLocalReplay();
    state.jobId = null;
    state.selectedDemoId = null;
    showView("form");
    setNav("form");
    dom.status.textContent = "Ready";
    document.querySelectorAll(".demo-card").forEach((c) => {
      c.disabled = false; delete c.dataset.selected;
    });
  }
});

/* ── Bootstrap ─────────────────────────────────────────────────────────── */
loadDemos();
loadHistory();
showView("form");
setNav("form");
