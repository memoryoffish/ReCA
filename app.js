const DATA_FILES = {
  videos: "./data/videos.json",
  wukong: "./data/wukong-preview.json",
  assets: "./data/assets.json"
};

const LOCAL_VIDEO_ROOT = "";
const LOCAL_ASSET_ROOT = "";
const OSS_ASSET_ROOT = "https://net-oss.akclau.de/videorlm-msve-demo/20260505/assets";

const LOCAL_POSTERS = {
  battle_of_the_heavenly_titans: `${OSS_ASSET_ROOT}/posters/battle_of_the_heavenly_titans.png`,
  ex01_battle_of_the_heavenly_titans_ours: `${OSS_ASSET_ROOT}/posters/ex01_battle_of_the_heavenly_titans_ours.png`,
  world_landmarks: `${OSS_ASSET_ROOT}/posters/world_landmarks.png`,
  boxing: `${OSS_ASSET_ROOT}/posters/boxing.png`,
  dumplings: `${OSS_ASSET_ROOT}/posters/dumplings.png`,
  couple: `${OSS_ASSET_ROOT}/posters/couple.png`
};

const FEATURED_DEMO_FALLBACKS = {
  world_landmarks: {
    video: "",
    poster: LOCAL_POSTERS.world_landmarks,
    frames: [
      `${OSS_ASSET_ROOT}/evidence-frames/featured/world_landmarks_0029.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/world_landmarks_0068.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/world_landmarks_0110.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/world_landmarks_0148.jpg`
    ]
  },
  boxing: {
    poster: LOCAL_POSTERS.boxing,
    frames: [
      `${OSS_ASSET_ROOT}/evidence-frames/featured/boxing_0029.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/boxing_0067.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/boxing_0109.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/boxing_0147.jpg`
    ]
  },
  dumplings: {
    poster: LOCAL_POSTERS.dumplings,
    frames: [
      `${OSS_ASSET_ROOT}/evidence-frames/featured/dumplings_0025.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/dumplings_0076.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/dumplings_0102.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/dumplings_0127.jpg`
    ]
  },
  couple: {
    poster: LOCAL_POSTERS.couple,
    frames: [
      `${OSS_ASSET_ROOT}/evidence-frames/featured/couple_0032.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/couple_0074.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/couple_0120.jpg`,
      `${OSS_ASSET_ROOT}/evidence-frames/featured/couple_0162.jpg`
    ]
  }
};

const MISSING_LOCAL_VIDEO_FALLBACKS = new Set([
  "framework-comparison/ex01_battle_of_the_heavenly_titans_movieagent.mp4",
  "framework-comparison/ex19_dumplings_movieagent.mp4",
  "framework-comparison/expending_world_landmarks_movieagent.mp4"
]);

const SHOT_NOTES = {
  shot01_back_clash: "Both fighters and the locked weapon relation are established before the long sequence expands.",
  shot02_weapon_lock_close: "A closer weapon lock keeps the clash readable before the camera changes.",
  shot03_faces_roar: "Faces and body lines confirm the opposing roles in the duel.",
  shot04_separated_standoff: "The sequence resets spacing without losing the battlefield setup.",
  shot05_ascent_through_clouds: "The action expands upward while preserving the source-grounded conflict.",
  shot06_cloud_counter: "The cloud-stage exchange keeps motion direction and target relation legible.",
  shot07_high_sky_battle: "Aerial combat remains readable as camera height and scale change.",
  shot08_mountain_staff_press: "The staff action lands at a new scale while keeping the same story pressure.",
  shot09_counter_knockdown: "A counter beat makes the attack result explicit before the fall.",
  shot10_wukong_fall_impact: "The fall and impact carry forward the previous strike.",
  shot11_giant_ape_transformation: "A transformation beat changes form while staying in the same conflict.",
  shot12_yangjian_fatian: "The opposing figure answers with matching mythic scale.",
  shot13_titan_clash: "The titan-scale clash preserves two clear sides of the duel.",
  shot14_clone_siege: "The clone sequence adds complexity without losing the center action.",
  shot15_third_eye_scan: "The detection beat turns visual continuity into a story payoff.",
  shot16_true_body_counter: "The true-body response follows directly from the scan.",
  shot17_aftermath_standoff: "The aftermath restores spacing and character orientation.",
  shot18_final_ready: "The final pose keeps the battle state ready for continuation."
};

const SHOT_THUMBNAIL_TIMES_MS = {
  shot01_back_clash: 5000,
  shot02_weapon_lock_close: 11000,
  shot03_faces_roar: 24000,
  shot04_separated_standoff: 32600,
  shot05_ascent_through_clouds: 49400,
  shot06_cloud_counter: 62000,
  shot07_high_sky_battle: 88200,
  shot08_mountain_staff_press: 102600,
  shot09_counter_knockdown: 112200,
  shot10_wukong_fall_impact: 125200,
  shot11_giant_ape_transformation: 142400,
  shot12_yangjian_fatian: 160400,
  shot13_titan_clash: 175000,
  shot14_clone_siege: 202000,
  shot15_third_eye_scan: 214000,
  shot16_true_body_counter: 227600,
  shot17_aftermath_standoff: 243400,
  shot18_final_ready: 253000
};

const selectors = {
  dataStatus: document.querySelector("#dataStatus"),
  heroVideo: document.querySelector("#heroVideo"),
  shotVideo: document.querySelector("#shotVideo"),
  timelineFill: document.querySelector("#timelineFill"),
  currentShotTitle: document.querySelector("#currentShotTitle"),
  currentShotText: document.querySelector("#currentShotText"),
  highlightList: document.querySelector("#highlightList"),
  shotRail: document.querySelector("#shotRail"),
  previewFrames: document.querySelector("#previewFrames"),
  previewMeta: document.querySelector("#previewMeta"),
  showcaseList: document.querySelector("#showcaseList"),
  benchmarkTabs: document.querySelector("#benchmarkTabs"),
  benchmarkSummary: document.querySelector("#benchmarkSummary"),
  comparisonGrid: document.querySelector("#comparisonGrid")
};

let state = {
  videos: { heroDemos: [], frameworkComparisons: [] },
  wukong: { shots: [], bridges: [], frames: [], highlights: [] },
  assets: [],
  assetByLocal: new Map(),
  shots: [],
  activeCaseIndex: 0
};

let hoverPreview = null;

async function fetchJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(error);
    return fallback;
  }
}

function normalizeLocalRel(value = "") {
  return value
    .replace(/^\.\//, "")
    .replace(/^assets\//, "");
}

function buildAssetMap(assets = []) {
  const map = new Map();
  assets.forEach((asset) => {
    const key = normalizeLocalRel(asset.local_rel || "");
    if (key) map.set(key, asset);
  });
  return map;
}

function assetUrl(localRel, fallback = "") {
  const key = normalizeLocalRel(localRel);
  const asset = state.assetByLocal.get(key);
  return asset?.signed_url || asset?.public_url || fallback;
}

function localAssetFromRemote(url = "") {
  const match = url.split("?")[0].match(/\/20260505\/assets\/(.+)$/);
  return match ? `${OSS_ASSET_ROOT}/${match[1]}` : "";
}

function assetKeyFromRemote(url = "") {
  const match = url.split("?")[0].match(/\/20260505\/assets\/(.+)$/);
  return match ? match[1] : "";
}

function remoteAssetUrl(url = "", fallback = "") {
  const key = assetKeyFromRemote(url);
  const asset = key ? state.assetByLocal.get(key) : null;
  return asset?.signed_url || asset?.public_url || url || fallback || "";
}

function localVideoFromRemote(url = "") {
  const match = url.split("?")[0].match(/\/20260505\/(.+)$/);
  return match ? `https://net-oss.akclau.de/videorlm-msve-demo/20260505/${match[1]}` : "";
}

function fallbackForImage(url = "", fallback = "") {
  return fallback || localAssetFromRemote(url);
}

function fallbackForVideo(url = "", fallback = "") {
  return fallback || localVideoFromRemote(url);
}

function mediaSrcAtTime(src = "", seconds = 0) {
  if (!src) return "";
  return `${src.split("#")[0]}#t=${Math.max(0, Number(seconds) || 0)}`;
}

function imageSnapshotFromVideo(src = "", seconds = 0) {
  if (!src) return "";
  const base = src.split("?")[0].split("#")[0];
  const separator = base.includes("?") ? "&" : "?";
  const timestamp = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  return `${base}${separator}x-oss-process=video/snapshot,t_${timestamp},f_jpg,w_640,h_360,m_fast`;
}

function usableVideoFallback(value = "") {
  const rel = value.replace("https://net-oss.akclau.de/videorlm-msve-demo/20260505/", "");
  return MISSING_LOCAL_VIDEO_FALLBACKS.has(rel) ? "" : value;
}

function formatTime(seconds = 0) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function labelFromId(id = "") {
  return id
    .replace(/^shot(\d+)_/, "Shot $1 ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sceneName(value = "") {
  return value
    .replace(/^EX(?:Pending|\d+)\s*/i, "")
    .replace("Battle of the Heavenly Titans", "Heavenly Titans")
    .trim();
}

function methodSlug(name = "") {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugFromTitle(value = "") {
  return value
    .toLowerCase()
    .replace(/^ex(?:pending|\d+)\s*/i, "")
    .replaceAll(" ", "_")
    .replace(/[^a-z0-9_]/g, "");
}

function keyFromTitle(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function createImage(src, fallback, alt, className = "") {
  const image = document.createElement("img");
  image.src = remoteAssetUrl(src, fallback);
  image.alt = alt;
  if (className) image.className = className;
  if (["shot-thumb", "highlight-thumb", "frame-thumb"].includes(className)) {
    image.loading = "eager";
    image.fetchPriority = "high";
  } else {
    image.loading = "lazy";
  }
  if (fallback && fallback !== image.src) {
    image.dataset.fallbackSrc = fallback;
    image.addEventListener("error", () => {
      if (image.dataset.fallbackSrc && image.src !== image.dataset.fallbackSrc) {
        image.src = image.dataset.fallbackSrc;
        image.removeAttribute("data-fallback-src");
      }
    }, { once: true });
  }
  return image;
}

function ensureHoverPreview() {
  if (hoverPreview) return hoverPreview;
  const root = document.createElement("div");
  root.className = "hover-preview-layer";
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  const image = document.createElement("img");
  image.alt = "";
  const caption = document.createElement("span");
  root.append(image, caption);
  document.body.append(root);
  hoverPreview = { root, image, caption };
  return hoverPreview;
}

function moveHoverPreview(event) {
  if (!hoverPreview || hoverPreview.root.hidden) return;
  const root = hoverPreview.root;
  const gap = 18;
  const width = root.offsetWidth || 280;
  const height = root.offsetHeight || 180;
  let left = event.clientX + gap;
  let top = event.clientY - height - gap;
  if (left + width > window.innerWidth - 12) left = event.clientX - width - gap;
  if (top < 66) top = event.clientY + gap;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  top = Math.max(66, Math.min(top, window.innerHeight - height - 12));
  root.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

function showHoverPreview(src, fallback, title, text, event) {
  const imageSrc = remoteAssetUrl(src, fallback);
  if (!imageSrc) return;
  const preview = ensureHoverPreview();
  preview.image.src = imageSrc;
  preview.image.alt = title || "Preview frame";
  preview.caption.textContent = [title, text].filter(Boolean).join(" · ");
  preview.root.classList.toggle("has-copy", Boolean(preview.caption.textContent));
  preview.root.hidden = false;
  moveHoverPreview(event);
}

function hideHoverPreview() {
  if (hoverPreview) hoverPreview.root.hidden = true;
}

function applyHoverPreview(element, src, fallback, title = "", text = "") {
  const image = remoteAssetUrl(src, fallback);
  if (!element || !image) return;
  element.dataset.previewTitle = title || "";
  element.dataset.previewText = text || "";
  element.addEventListener("pointerenter", (event) => showHoverPreview(src, fallback, title, text, event));
  element.addEventListener("pointermove", moveHoverPreview);
  element.addEventListener("pointerleave", hideHoverPreview);
  element.addEventListener("focus", () => {
    const rect = element.getBoundingClientRect();
    showHoverPreview(src, fallback, title, text, {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    });
  });
  element.addEventListener("blur", hideHoverPreview);
}

function setImageSource(image, src, fallback) {
  if (!image) return;
  image.src = remoteAssetUrl(src, fallback);
  if (fallback && fallback !== image.src) {
    image.dataset.fallbackSrc = fallback;
    image.addEventListener("error", () => {
      if (image.dataset.fallbackSrc && image.src !== image.dataset.fallbackSrc) {
        image.src = image.dataset.fallbackSrc;
        image.removeAttribute("data-fallback-src");
      }
    }, { once: true });
  }
}

function setMediaSource(media, primary, fallback = "", onFinalError) {
  if (!media) return;
  media.dataset.baseSrc = primary || fallback || "";
  media.src = media.dataset.baseSrc;
  let triedFallback = false;
  media.addEventListener("error", () => {
    if (!triedFallback && fallback && fallback !== primary) {
      triedFallback = true;
      media.dataset.baseSrc = fallback;
      media.src = fallback;
      media.load();
      return;
    }
    if (typeof onFinalError === "function") onFinalError();
  });
}

function setPoster(video, poster, fallback = "") {
  if (!video) return;
  video.poster = remoteAssetUrl(poster, fallback);
}

function createVideo(item = {}, className = "", onFinalError) {
  const video = document.createElement("video");
  if (className) video.className = className;
  video.controls = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  // Lazy load: start with preload="none" so 20 video tags don't all
  // hammer OSS in parallel at page-load (Chrome caps per-host at 6
  // concurrent connections — the last 14 stall and look "broken").
  // _attachLazyPreload below flips preload to "metadata" only once
  // the tile scrolls within 400px of the viewport.
  video.preload = item.preload || "none";
  setMediaSource(video, item.src || item.preview_src, item.fallbackSrc || fallbackForVideo(item.src || item.preview_src || ""), onFinalError);
  setPoster(video, posterFromItem(item), item.fallbackPoster || fallbackForImage(posterFromItem(item)));
  _attachLazyPreload(video);
  return video;
}

// Single shared IntersectionObserver — when a <video> approaches the
// viewport, flip preload to "metadata" and force a load() so the first
// frame paints. The observer un-observes the element after the upgrade
// so the work happens once per tile.
let _lazyVideoObserver = null;
function _attachLazyPreload(video) {
  if (typeof IntersectionObserver !== "function") {
    // Old browser → fall back to immediate metadata preload
    video.preload = "metadata";
    return;
  }
  if (!_lazyVideoObserver) {
    _lazyVideoObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const v = entry.target;
        if (v.preload !== "metadata") {
          v.preload = "metadata";
          try { v.load(); } catch (_) {}
        }
        _lazyVideoObserver.unobserve(v);
      }
    }, { rootMargin: "400px 0px", threshold: 0 });
  }
  _lazyVideoObserver.observe(video);
}

function posterFromItem(item = {}) {
  return item.poster
    || item.thumbnail
    || item.frames?.[0]?.thumbnail
    || item.highlights?.[0]?.thumbnail
    || item.evidence?.[0]?.thumbnail
    || "";
}

function shotsWithStart(shots = []) {
  let start = 0;
  return shots.map((shot, index) => {
    const id = shot.shot_id || shot.id || `shot${index + 1}`;
    const duration = Number(shot.duration_s || shot.duration || 0);
    const item = {
      id,
      index,
      duration,
      start,
      text: shot.text || SHOT_NOTES[id] || "Shot-level beat in the planned continuation."
    };
    start += duration;
    return item;
  });
}

function seekTo(video, seconds) {
  if (!video) return;
  const target = Math.max(0, Number(seconds) || 0);
  video.dataset.pendingSeek = String(target);
  video.preload = "metadata";
  video.muted = false;
  video.volume = 1;
  const apply = () => {
    const nextTarget = Math.max(0, Number(video.dataset.pendingSeek) || target);
    try {
      video.currentTime = nextTarget;
    } catch (error) {
      console.warn(error);
    }
    video.muted = false;
    video.volume = 1;
    video.play().catch(() => {});
  };
  video.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    video.currentTime = target;
  } catch (error) {
    console.warn(error);
  }
  if (video.readyState >= 1) apply();
  else {
    const baseSrc = video.dataset.baseSrc || video.currentSrc || video.src;
    const timedSrc = mediaSrcAtTime(baseSrc, target);
    if (timedSrc && video.src !== timedSrc) {
      video.src = timedSrc;
    }
    video.addEventListener("loadedmetadata", apply, { once: true });
    video.load();
  }
}

function collectAssetGroups(assets = []) {
  return assets.reduce((groups, asset) => {
    const rel = normalizeLocalRel(asset.local_rel || "");
    let type = "other";
    if (rel.startsWith("posters/")) type = "posters";
    else if (rel.startsWith("evidence-frames/featured/")) type = "featured frames";
    else if (rel.startsWith("evidence-frames/review-points/")) type = "review points";
    else if (rel.startsWith("evidence-frames/framework-comparison/")) type = "comparison frames";
    else if (rel.startsWith("evidence-frames/shot-preview-plan/")) type = "shot preview";
    else if (rel.startsWith("fig_")) type = "figures";
    groups[type] = (groups[type] || 0) + 1;
    return groups;
  }, {});
}

function fallbackPosterByTitle(title = "") {
  const key = keyFromTitle(title);
  return LOCAL_POSTERS[key] || "";
}

function demoByKey(key = "") {
  return (state.videos.heroDemos || []).find((demo) => keyFromTitle(demo.title) === key);
}

function frameFromDemo(key = "", frameIndex = 0) {
  const demo = demoByKey(key);
  const frame = demo?.frames?.[frameIndex];
  const fallback = FEATURED_DEMO_FALLBACKS[key]?.frames?.[frameIndex] || "";
  return {
    src: frame?.thumbnail || fallback,
    fallback: fallbackForImage(frame?.thumbnail, fallback)
  };
}

const DEMO_FRAME_ORDER = {
  world_landmarks: [0, 1, 4, 5, 6, 7, 2, 3],
  boxing: [0, 1, 3, 4, 5, 7, 2, 6],
  dumplings: [0, 1, 2, 3, 5, 6, 7, 4],
  couple: [0, 1, 2, 4, 3, 5, 6, 7]
};

function resolveShotThumbnail(shot = {}, wukong = {}) {
  const start = Number(shot.start) || 0;
  const duration = Number(shot.duration) || 0;
  const end = start + duration;
  const selectedTime = Number.isFinite(SHOT_THUMBNAIL_TIMES_MS[shot.id])
    ? SHOT_THUMBNAIL_TIMES_MS[shot.id] / 1000
    : start + Math.max(0.6, duration * 0.5);
  const timelineItems = [
    ...(wukong.highlights || []).map((item) => ({ ...item, source: "highlight" })),
    ...(wukong.frames || []).map((item) => ({ ...item, source: "frame" }))
  ]
    .filter((item) => item.thumbnail)
    .map((item) => ({ ...item, time_s: Number(item.time_s) || 0 }));

  const inShot = timelineItems
    .filter((item) => item.time_s >= start && item.time_s < end)
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === "highlight" ? -1 : 1;
      return Math.abs(a.time_s - selectedTime) - Math.abs(b.time_s - selectedTime);
    })[0];

  const frame = inShot || {};
  return {
    thumbnail: shot.thumbnail || imageSnapshotFromVideo(wukong.preview_src, selectedTime) || frame.thumbnail,
    fallback: frame.thumbnail || wukong.poster || LOCAL_POSTERS.battle_of_the_heavenly_titans,
    time_s: selectedTime
  };
}

function selectDemoFrames(frames = [], title = "", limit = 4) {
  const order = DEMO_FRAME_ORDER[keyFromTitle(title)] || [];
  const selected = [];
  const used = new Set();
  order.forEach((frameIndex) => {
    if (frames[frameIndex] && selected.length < limit) {
      selected.push(frames[frameIndex]);
      used.add(frameIndex);
    }
  });
  frames.forEach((frame, index) => {
    if (!used.has(index) && selected.length < limit) selected.push(frame);
  });
  return selected;
}

function createFrameButton(frame = {}, video, alt, className = "frame-chip") {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  const imageLabel = `${alt} at ${formatTime(frame.time_s)}`;
  applyHoverPreview(button, frame.thumbnail, fallbackForImage(frame.thumbnail), imageLabel, "");
  button.append(createImage(frame.thumbnail, fallbackForImage(frame.thumbnail), imageLabel, "frame-thumb"));
  const label = document.createElement("span");
  label.textContent = formatTime(frame.time_s);
  button.append(label);
  button.addEventListener("click", () => seekTo(video, frame.time_s));
  return button;
}

function createFrameStrip(frames = [], video, limit = 4, alt = "Evidence frame", title = "") {
  const visibleFrames = selectDemoFrames(frames, title, limit);
  if (!visibleFrames.length) return null;
  const strip = document.createElement("div");
  strip.className = "frame-strip";
  visibleFrames.forEach((frame, index) => {
    strip.append(createFrameButton(frame, video, `${alt} ${index + 1}`));
  });
  return strip;
}

function createDemoTimeline(frames = [], video, limit = 4, alt = "Demo") {
  const strip = createFrameStrip(frames, video, limit, `${alt} frame`, alt);
  if (!strip) return null;
  const timeline = document.createElement("div");
  timeline.className = "demo-timeline";
  const heading = document.createElement("div");
  heading.className = "demo-timeline-heading";
  heading.textContent = "Evidence Timeline";
  timeline.append(heading, strip);
  return timeline;
}

function createMethodFrames(frames = [], video, limit = 4, alt = "Method frame") {
  const visibleFrames = frames.slice(0, limit);
  if (!visibleFrames.length) return null;
  const strip = document.createElement("div");
  strip.className = "method-frames";
  visibleFrames.forEach((frame, index) => {
    strip.append(createFrameButton(frame, video, `${alt} ${index + 1}`, "method-frame"));
  });
  return strip;
}

function fallbackPosterForCase(caseName = "", method = {}) {
  if (method.poster) return fallbackForImage(method.poster);
  if (method.isOurs && /battle/i.test(caseName)) return LOCAL_POSTERS.ex01_battle_of_the_heavenly_titans_ours;
  if (method.isOurs && /world/i.test(caseName)) return LOCAL_POSTERS.world_landmarks;
  if (method.isOurs && /boxing/i.test(caseName)) return LOCAL_POSTERS.boxing;
  if (method.isOurs && /dumplings/i.test(caseName)) return LOCAL_POSTERS.dumplings;
  return fallbackForImage(posterFromItem(method));
}

function renderHero() {
  const heroDemo = demoByKey("world_landmarks");

  const previewSrc = heroDemo?.src || "";
  const previewFallback = FEATURED_DEMO_FALLBACKS.world_landmarks.video;
  const poster = heroDemo?.poster || "";
  setMediaSource(selectors.heroVideo, previewSrc, previewFallback);
  setPoster(selectors.heroVideo, poster, FEATURED_DEMO_FALLBACKS.world_landmarks.poster);
}

function renderTimeline() {
  const wukong = state.wukong;
  state.shots = shotsWithStart(wukong.shots || []);
  const totalDuration = Number(wukong.total_duration_s) || state.shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0);
  selectors.shotVideo.preload = "none";
  selectors.shotVideo.loop = true;
  setMediaSource(selectors.shotVideo, wukong.preview_src, "");
  setPoster(selectors.shotVideo, wukong.poster, LOCAL_POSTERS.battle_of_the_heavenly_titans);

  selectors.shotRail.innerHTML = "";
  const maxDuration = Math.max(...state.shots.map((shot) => shot.duration), 1);
  state.shots.forEach((shot, index) => {
    const button = document.createElement("button");
    button.className = "shot-button";
    button.type = "button";
    const frame = resolveShotThumbnail(shot, wukong);
    if (frame?.thumbnail) {
      const imageLabel = `${labelFromId(shot.id)} preview`;
      applyHoverPreview(
        button,
        frame.thumbnail,
        frame.fallback,
        labelFromId(shot.id),
        `${formatTime(shot.start)} / ${shot.duration}s`
      );
      button.append(createImage(
        frame.thumbnail,
        frame.fallback,
        imageLabel,
        "shot-thumb"
      ));
    }
    const copy = document.createElement("span");
    copy.className = "shot-button-copy";
    copy.innerHTML = `
      <strong>${String(index + 1).padStart(2, "0")}</strong>
      <span>${labelFromId(shot.id).replace(/^Shot \d+\s*/, "")}</span>
      <span>${formatTime(shot.start)} / ${shot.duration}s</span>
    `;
    button.append(copy);
    button.addEventListener("click", () => {
      setActiveShot(index);
      seekTo(selectors.shotVideo, shot.start);
    });
    selectors.shotRail.append(button);
  });

  selectors.highlightList.innerHTML = "";
  const highlights = (wukong.highlights || []).slice(0, 4);
  if (highlights.length) {
    const heading = document.createElement("div");
    heading.className = "highlight-heading";
    heading.textContent = "Evidence Timeline";
    selectors.highlightList.append(heading);
  }
  highlights.forEach((highlight) => {
    const button = document.createElement("button");
    const fallback = fallbackForImage(highlight.thumbnail);
    button.className = "highlight-button";
    button.type = "button";
    const imageLabel = highlight.title || "Highlight frame";
    applyHoverPreview(button, highlight.thumbnail, fallback, `${formatTime(highlight.time_s)} · ${imageLabel}`, "");
    button.append(createImage(highlight.thumbnail, fallback, imageLabel, "highlight-thumb"));
    const copy = document.createElement("span");
    copy.innerHTML = `<strong>${highlight.title || "Highlight"}</strong><span>${formatTime(highlight.time_s)}</span>`;
    button.append(copy);
    button.addEventListener("click", () => seekTo(selectors.shotVideo, highlight.time_s));
    selectors.highlightList.append(button);
  });

  if (selectors.previewFrames) {
    selectors.previewFrames.innerHTML = "";
    (wukong.frames || []).forEach((frame) => {
      const button = document.createElement("button");
      button.className = "preview-frame";
      button.type = "button";
      const imageLabel = `Preview frame at ${formatTime(frame.time_s)}`;
      applyHoverPreview(button, frame.thumbnail, fallbackForImage(frame.thumbnail), imageLabel, "");
      button.append(createImage(frame.thumbnail, fallbackForImage(frame.thumbnail), imageLabel));
      const label = document.createElement("span");
      label.textContent = formatTime(frame.time_s);
      button.append(label);
      button.addEventListener("click", () => seekTo(selectors.shotVideo, frame.time_s));
      selectors.previewFrames.append(button);
    });
  }

  if (selectors.previewMeta) {
    selectors.previewMeta.innerHTML = `<span>${state.shots.length} shots · ${(wukong.bridges || []).length} bridges · ${formatTime(totalDuration)}</span>`;
  }

  selectors.shotVideo.addEventListener("timeupdate", () => {
    const total = Number(totalDuration || selectors.shotVideo.duration || 1);
    const progress = Math.min(100, Math.max(0, (selectors.shotVideo.currentTime / total) * 100));
    selectors.timelineFill.style.width = `${progress}%`;
    const currentIndex = state.shots.findIndex((shot, index) => {
      const next = state.shots[index + 1];
      return selectors.shotVideo.currentTime >= shot.start && (!next || selectors.shotVideo.currentTime < next.start);
    });
    if (currentIndex >= 0) setActiveShot(currentIndex, false);
  });

  setActiveShot(0, false);
}

function setActiveShot(index, scroll = true) {
  const shot = state.shots[index];
  if (!shot) return;
  selectors.currentShotTitle.textContent = labelFromId(shot.id);
  selectors.currentShotText.textContent = shot.text;
  Array.from(selectors.shotRail.children).forEach((button, buttonIndex) => {
    button.classList.toggle("active", buttonIndex === index);
  });
  if (scroll) {
    selectors.shotRail.children[index]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
}

function renderShowcase() {
  selectors.showcaseList.innerHTML = "";
  (state.videos.heroDemos || []).forEach((demo, index) => {
    const item = document.createElement("article");
    item.className = `showcase-item ${index === 0 ? "featured-main" : "featured-small"}`;

    const media = document.createElement("div");
    media.className = "showcase-media";
    const video = createVideo({
      ...demo,
      fallbackSrc: "",
      fallbackPoster: fallbackPosterByTitle(demo.title),
    }, "showcase-video");
    media.append(video);
    // Veo-style: auto-play muted preview on hover
    item.addEventListener("mouseenter", () => {
      try { video.muted = true; video.play().catch(()=>{}); } catch(_){}
    });
    item.addEventListener("mouseleave", () => {
      try { video.pause(); } catch(_){}
    });

    const copy = document.createElement("div");
    copy.className = "showcase-copy";
    const duration = formatTime(demo.duration_s);
    copy.innerHTML = `
      <span class="label">${demo.eyebrow || `Demo ${index + 1}`} / ${duration}</span>
      <h3>${demo.title}</h3>
    `;
    const timeline = createDemoTimeline(demo.frames || [], video, index === 0 ? 6 : 4, demo.title);

    item.append(copy, media);
    if (timeline) item.append(timeline);
    selectors.showcaseList.append(item);
  });
}

function renderBenchmarkTabs() {
  selectors.benchmarkTabs.innerHTML = "";
  (state.videos.frameworkComparisons || []).forEach((item, index) => {
    const tab = document.createElement("button");
    tab.className = "benchmark-tab";
    tab.type = "button";
    tab.role = "tab";
    tab.textContent = sceneName(item.case);
    tab.setAttribute("aria-selected", index === state.activeCaseIndex ? "true" : "false");
    tab.addEventListener("click", () => {
      state.activeCaseIndex = index;
      renderBenchmark();
    });
    selectors.benchmarkTabs.append(tab);
  });
}

function createEvidenceGroup(method, video) {
  const evidenceItems = (method.evidence || []).slice(0, 2);
  if (!evidenceItems.length) return null;
  const group = document.createElement("div");
  const tone = method.isOurs ? "highlight" : "issue";
  group.className = `evidence-group ${tone}`;

  const heading = document.createElement("div");
  heading.className = "evidence-heading";
  heading.innerHTML = `
    <span>${method.isOurs ? "Strength Points" : "Failure Points"}</span>
    <em>${evidenceItems.length || "No"} reviewed ${evidenceItems.length === 1 ? "moment" : "moments"}</em>
  `;
  group.append(heading);

  evidenceItems.forEach((evidence, index) => {
    const point = document.createElement("button");
    point.type = "button";
    point.className = `evidence-point ${tone}`;
    point.innerHTML = `
      <span class="evidence-copy">
        <em class="evidence-time">${formatTime(evidence.time_s)}</em>
        <strong>${evidence.title || `Evidence point ${index + 1}`}</strong>
      </span>
    `;

    const thumbs = document.createElement("span");
    thumbs.className = "evidence-thumbs";
    const appendEvidenceThumb = ({ src, time, label, alt }) => {
      const thumb = document.createElement("span");
      thumb.className = "evidence-thumb-jump";
      thumb.dataset.time = String(Number(time) || 0);
      applyHoverPreview(thumb, src, fallbackForImage(src), `${label} · ${formatTime(time)}`, alt);
      thumb.append(createImage(src, fallbackForImage(src), alt));
      const thumbLabel = document.createElement("em");
      thumbLabel.textContent = `${label} · ${formatTime(time)}`;
      thumb.append(thumbLabel);
      thumb.addEventListener("click", (event) => {
        event.stopPropagation();
        seekTo(video, Number(thumb.dataset.time));
      });
      return thumb;
    };

    if (evidence.compare_thumbnail) {
      thumbs.classList.add("compare-thumbs");
      thumbs.append(
        appendEvidenceThumb({
          src: evidence.compare_thumbnail,
          time: Number(evidence.compare_time_s) || 0,
          label: "Before",
          alt: `Before ${evidence.title || `${method.name} evidence ${index + 1}`}`
        }),
        appendEvidenceThumb({
          src: evidence.thumbnail,
          time: evidence.time_s,
          label: "After",
          alt: `After ${evidence.title || `${method.name} evidence ${index + 1}`}`
        })
      );
    } else {
      thumbs.append(appendEvidenceThumb({
        src: evidence.thumbnail,
        time: evidence.time_s,
        label: "Frame",
        alt: `${method.name} evidence ${index + 1}`
      }));
    }

    thumbs.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    point.prepend(thumbs);

    point.addEventListener("click", () => seekTo(video, evidence.time_s));
    group.append(point);
  });

  return group;
}

function renderBenchmark() {
  const cases = state.videos.frameworkComparisons || [];
  const active = cases[state.activeCaseIndex];
  if (!active) return;
  const isLandmarksCase = active.case.includes("World Landmarks");

  Array.from(selectors.benchmarkTabs.children).forEach((tab, index) => {
    const activeTab = index === state.activeCaseIndex;
    tab.classList.toggle("active", activeTab);
    tab.setAttribute("aria-selected", activeTab ? "true" : "false");
  });

  selectors.benchmarkSummary.innerHTML = "";
  const summaryCopy = document.createElement("div");
  summaryCopy.innerHTML = `<h3>${active.case}</h3><p>${active.prompt || "Framework comparison case for multi-shot extrapolation."}</p>`;
  if (isLandmarksCase) {
    const note = document.createElement("p");
    note.className = "landmarks-note";
    note.textContent = "All frameworks can render recognizable landmarks, while ours presents the scene with stronger scale, cleaner detail, and a more cinematic aesthetic.";
    summaryCopy.append(note);
  }
  const metrics = document.createElement("div");
  metrics.className = "metric-list";
  (active.metrics || []).forEach((metric) => {
    const chip = document.createElement("span");
    chip.textContent = metric.label || metric;
    metrics.append(chip);
  });
  selectors.benchmarkSummary.append(summaryCopy, metrics);

  selectors.comparisonGrid.innerHTML = "";
  (active.methods || []).forEach((method) => {
    const card = document.createElement("article");
    card.className = `method-card${method.isOurs ? " ours" : ""}${isLandmarksCase ? " landmarks" : ""}`;
    const generatedFallbackSrc = "";
    const rawFallbackSrc = fallbackForVideo(method.src) || generatedFallbackSrc;
    const fallbackSrc = usableVideoFallback(rawFallbackSrc);
    const posterFallback = fallbackPosterForCase(active.case, method);
    const video = createVideo({
      ...method,
      fallbackSrc,
      fallbackPoster: posterFallback,
      preload: "none"
    }, "method-video", () => {
      if (!posterFallback) return;
      const poster = createImage(posterFallback, posterFallback, `${method.name} local evidence poster`, "method-video");
      video.replaceWith(poster);
    });

    const body = document.createElement("div");
    body.className = "method-body";
    const label = method.isOurs ? "Ours" : formatTime(method.duration_s);
    body.innerHTML = `
      <div class="method-top">
        <h4>${method.name}</h4>
        <span>${label}</span>
      </div>
    `;

    if (!isLandmarksCase) {
      const evidenceGroup = createEvidenceGroup(method, video);
      if (evidenceGroup) body.append(evidenceGroup);
      const frames = createMethodFrames(method.frames || method.evidence || [], video, 4, `${method.name} evidence frame`);
      if (frames) body.append(frames);
    }

    card.append(video, body);
    selectors.comparisonGrid.append(card);
  });
}

async function init() {
  const [videos, wukong, assets] = await Promise.all([
    fetchJson(DATA_FILES.videos, { heroDemos: [], frameworkComparisons: [] }),
    fetchJson(DATA_FILES.wukong, { shots: [], bridges: [], frames: [], highlights: [] }),
    fetchJson(DATA_FILES.assets, [])
  ]);

  state.videos = videos;
  state.wukong = wukong;
  state.assets = assets;
  state.assetByLocal = buildAssetMap(assets);

  renderHero();
  renderTimeline();
  renderShowcase();
  renderBenchmarkTabs();
  renderBenchmark();

  selectors.dataStatus.textContent = "Demo ready";
}

init().catch((error) => {
  console.error(error);
  selectors.dataStatus.textContent = "Demo unavailable";
});

// BibTeX copy-to-clipboard — small enhancement so the citation block
// is one-click usable. No-op silently when navigator.clipboard is absent.
(function wireBibtexCopy() {
  const btn = document.getElementById("bibtexCopy");
  const block = document.getElementById("bibtexBlock");
  if (!btn || !block) return;
  btn.addEventListener("click", async () => {
    const text = block.innerText.trim();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      const prev = btn.textContent;
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = prev;
        btn.classList.remove("copied");
      }, 1600);
    } catch (err) {
      console.error("Copy failed", err);
    }
  });
})();
