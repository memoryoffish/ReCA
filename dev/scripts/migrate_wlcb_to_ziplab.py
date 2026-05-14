#!/usr/bin/env python3
"""Migrate ReCA demo assets from intern-data-wlcb (private) to ziplab-data-worldwide (public).

Reads src signed URLs from demo/data/*/manifest.json + demo/data/index.json,
downloads via the signed URL (no src creds needed), uploads to dst bucket via
v1 OSS signing (creds loaded from PaperClip shared env), and writes a
migration_url_map.json that the URL-rewrite step uses for literal substitution.

Credentials are sourced from oss-migration-creds.env via env vars; never echoed.

Usage:
    python3 migrate_wlcb_to_ziplab.py            # full migration
    python3 migrate_wlcb_to_ziplab.py --plan     # collect URLs and print plan only
    python3 migrate_wlcb_to_ziplab.py --verify-only --sample 5   # HEAD-check N
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import email.utils
import hashlib
import hmac
import json
import mimetypes
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEMO_DATA = REPO_ROOT / "demo" / "data"
MAP_PATH = REPO_ROOT / "dev" / "scripts" / "migration_url_map.json"
CACHE_DIR = Path("/home/ubuntu/code/.migration-cache")
SRC_HOST = "intern-data-wlcb.oss-cn-wulanchabu.aliyuncs.com"
DST_KEY_PREFIX = "videorlm-msve-demo/20260514-migrated-from-wlcb/"
DEFAULT_CACHE_CONTROL = "public, max-age=31536000, immutable"

_print_lock = threading.Lock()


def log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)


def env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f"missing required env var: {name}")
    return v


def collect_src_urls() -> list[str]:
    """Walk all demo/data JSON files and collect every src signed URL."""
    files = [DEMO_DATA / "index.json"]
    for d in sorted((DEMO_DATA).iterdir()):
        if d.is_dir():
            mf = d / "manifest.json"
            if mf.exists():
                files.append(mf)
    seen: dict[str, None] = {}

    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, str) and SRC_HOST in o:
            seen.setdefault(o, None)

    for f in files:
        with f.open() as fh:
            walk(json.load(fh))
    return list(seen.keys())


def src_to_dst_key(url: str) -> str:
    """Strip query, derive new dst object key from src path."""
    p = urllib.parse.urlsplit(url)
    assert p.netloc == SRC_HOST, f"unexpected host: {p.netloc}"
    path = p.path.lstrip("/")
    return DST_KEY_PREFIX + path


def cache_path_for(url: str) -> Path:
    """sha256 of full src URL (incl query) is the cache key."""
    h = hashlib.sha256(url.encode()).hexdigest()
    return CACHE_DIR / f"{h}.bin"


def http_request(req: urllib.request.Request, *, timeout: int = 120):
    return urllib.request.urlopen(req, timeout=timeout)


def download(url: str) -> Path:
    """Download src URL to cache; return cache file path. Cached on retry."""
    cp = cache_path_for(url)
    if cp.exists() and cp.stat().st_size > 0:
        return cp
    tmp = cp.with_suffix(".part")
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, method="GET")
            with http_request(req, timeout=300) as r, tmp.open("wb") as out:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
            tmp.rename(cp)
            return cp
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"download failed after retries: {url[:120]}... err={last_err}")


def md5_b64(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode()


def content_type_for(path_str: str) -> str:
    ct, _ = mimetypes.guess_type(path_str)
    return ct or "application/octet-stream"


def oss_v1_sign(method: str, content_md5: str, content_type: str, date: str,
                amz_headers: dict[str, str], canonical_resource: str,
                access_key_id: str, access_key_secret: str) -> str:
    """Compute OSS v1 Authorization header value."""
    canon = ""
    if amz_headers:
        items = sorted((k.lower(), v) for k, v in amz_headers.items())
        canon = "".join(f"{k}:{v}\n" for k, v in items)
    string_to_sign = (
        f"{method}\n{content_md5}\n{content_type}\n{date}\n{canon}{canonical_resource}"
    )
    sig = base64.b64encode(
        hmac.new(access_key_secret.encode(), string_to_sign.encode(), hashlib.sha1).digest()
    ).decode()
    return f"OSS {access_key_id}:{sig}"


def upload(local: Path, dst_key: str, *, bucket: str, endpoint: str,
           ak_id: str, ak_secret: str) -> None:
    """PUT local file to ziplab dst bucket via v1 signed request."""
    content_type = content_type_for(dst_key)
    content_md5 = md5_b64(local)
    date = email.utils.formatdate(usegmt=True)
    amz: dict[str, str] = {}
    canonical_resource = f"/{bucket}/{urllib.parse.quote(dst_key)}"
    auth = oss_v1_sign(
        "PUT", content_md5, content_type, date, amz, canonical_resource, ak_id, ak_secret
    )
    url = f"https://{bucket}.{endpoint}/{urllib.parse.quote(dst_key)}"
    headers = {
        "Date": date,
        "Content-Type": content_type,
        "Content-MD5": content_md5,
        "Content-Length": str(local.stat().st_size),
        "Authorization": auth,
        "Cache-Control": DEFAULT_CACHE_CONTROL,
    }
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            with local.open("rb") as body:
                req = urllib.request.Request(url, data=body, method="PUT", headers=headers)
                with http_request(req, timeout=600) as resp:
                    if resp.status not in (200, 204):
                        raise RuntimeError(f"upload status {resp.status}")
                    return
        except urllib.error.HTTPError as e:
            last_err = RuntimeError(f"upload HTTPError {e.code}: {e.read()[:200]!r}")
            time.sleep(1.5 * (attempt + 1))
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"upload failed after retries: dst_key={dst_key} err={last_err}")


_HEAD_UA = "Mozilla/5.0 (compatible; ReCA-migrate/1.0)"


def head_public(public_url: str, *, bust_cache: bool = False) -> tuple[int, int | None]:
    """HEAD the public CDN URL and return (status, content_length-or-None).

    Cloudflare in front of net-oss.akclau.de blocks default Python-urllib UA,
    so we set a benign UA. When ``bust_cache`` is true we append a unique
    query so Cloudflare treats this as a fresh URL (avoids serving a stale
    404 from a probe issued before the object existed).
    """
    if bust_cache:
        sep = "&" if "?" in public_url else "?"
        public_url = f"{public_url}{sep}_v={int(time.time() * 1000)}"
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(public_url, method="HEAD",
                                          headers={"User-Agent": _HEAD_UA})
            with http_request(req, timeout=60) as resp:
                cl = resp.headers.get("Content-Length")
                return resp.status, int(cl) if cl else None
        except urllib.error.HTTPError as e:
            return e.code, None
        except Exception as e:
            last_err = e
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"HEAD failed: {public_url[:120]}... err={last_err}")


def head_bucket(bucket: str, endpoint: str, dst_key: str) -> tuple[int, int | None]:
    """Direct HEAD on the OSS bucket endpoint (bypasses CDN, no cache pollution)."""
    url = f"https://{bucket}.{endpoint}/{urllib.parse.quote(dst_key)}"
    try:
        req = urllib.request.Request(url, method="HEAD")
        with http_request(req, timeout=30) as resp:
            cl = resp.headers.get("Content-Length")
            return resp.status, int(cl) if cl else None
    except urllib.error.HTTPError as e:
        return e.code, None


def migrate_one(url: str, *, bucket: str, endpoint: str, public_cdn: str,
                ak_id: str, ak_secret: str) -> dict:
    dst_key = src_to_dst_key(url)
    public_url = f"{public_cdn.rstrip('/')}/{dst_key}"
    t0 = time.time()
    local = download(url)
    size = local.stat().st_size
    # Idempotency check on the bucket endpoint, not the CDN (CDN caches 404 of
    # not-yet-existing objects, which would later mask a successful upload).
    st_b, cl_b = head_bucket(bucket, endpoint, dst_key)
    if st_b == 200 and cl_b == size:
        # Already in dst bucket with matching size; verify CDN sees it too.
        st, cl = head_public(public_url, bust_cache=True)
        if st != 200:
            raise RuntimeError(f"bucket has object but CDN HEAD non-200 for {public_url}: status={st}")
        return {"src": url, "dst": public_url, "size": size, "elapsed": time.time() - t0,
                "skipped_upload": True}
    upload(local, dst_key, bucket=bucket, endpoint=endpoint, ak_id=ak_id, ak_secret=ak_secret)
    st, cl = head_public(public_url, bust_cache=True)
    if st != 200:
        raise RuntimeError(f"verification HEAD non-200 for {public_url}: status={st}")
    return {"src": url, "dst": public_url, "size": size, "elapsed": time.time() - t0,
            "skipped_upload": False}


def run_full(args: argparse.Namespace) -> int:
    bucket = env("OSS_DST_BUCKET")
    endpoint = env("OSS_DST_ENDPOINT")
    public_cdn = env("OSS_DST_PUBLIC_CDN")
    ak_id = env("OSS_DST_ACCESS_KEY_ID")
    ak_secret = env("OSS_DST_ACCESS_KEY_SECRET")

    urls = collect_src_urls()
    log(f"[plan] {len(urls)} unique src URLs across demo/data/")
    if args.plan:
        # show prefix distribution
        from collections import Counter
        prefixes = Counter()
        for u in urls:
            p = urllib.parse.urlsplit(u).path.lstrip("/")
            parts = p.split("/")
            prefixes["/".join(parts[:4])] += 1
        for k, v in prefixes.most_common():
            log(f"  {v:4d} {k}")
        return 0

    if args.limit:
        urls = urls[: args.limit]
        log(f"[plan] limit applied: processing first {len(urls)} URLs")

    mapping: dict[str, str] = {}
    failures: list[tuple[str, str]] = []
    total_bytes = 0
    t0 = time.time()
    workers = max(1, args.workers)
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(migrate_one, u, bucket=bucket, endpoint=endpoint,
                              public_cdn=public_cdn, ak_id=ak_id,
                              ak_secret=ak_secret): u for u in urls}
        done = 0
        for fut in cf.as_completed(futures):
            u = futures[fut]
            done += 1
            try:
                r = fut.result()
                mapping[r["src"]] = r["dst"]
                total_bytes += r["size"]
                tag = "skip" if r.get("skipped_upload") else "ok  "
                log(f"[{done:3d}/{len(urls)}] {tag} {r['size']:>10d}B {r['elapsed']:6.2f}s {urllib.parse.urlsplit(r['dst']).path[-80:]}")
            except Exception as e:
                failures.append((u, str(e)))
                log(f"[{done:3d}/{len(urls)}] FAIL {e} :: {u[:100]}")

    elapsed = time.time() - t0
    log("")
    log(f"[done] migrated={len(mapping)} failed={len(failures)} bytes={total_bytes} elapsed={elapsed:.1f}s")
    if failures:
        for u, e in failures[:20]:
            log(f"  FAIL {e} :: {u[:120]}")
        return 2

    MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MAP_PATH.open("w") as f:
        json.dump(mapping, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    log(f"[map] wrote {MAP_PATH}")
    return 0


def run_verify(args: argparse.Namespace) -> int:
    if not MAP_PATH.exists():
        log(f"[verify] {MAP_PATH} missing; nothing to verify")
        return 1
    with MAP_PATH.open() as f:
        mapping: dict[str, str] = json.load(f)
    items = list(mapping.values())
    if args.sample and args.sample < len(items):
        # deterministic sample: evenly spaced
        step = max(1, len(items) // args.sample)
        items = items[::step][: args.sample]
    failed = 0
    for url in items:
        try:
            st, cl = head_public(url)
            ok = st == 200
            log(f"  {'OK ' if ok else 'BAD'} {st} cl={cl} {url}")
            if not ok:
                failed += 1
        except Exception as e:
            failed += 1
            log(f"  ERR {e} {url}")
    log(f"[verify] checked={len(items)} failed={failed}")
    return 0 if failed == 0 else 2


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true", help="just collect and show plan")
    ap.add_argument("--limit", type=int, default=0, help="limit number of URLs (debug)")
    ap.add_argument("--workers", type=int, default=6, help="parallel workers")
    ap.add_argument("--verify-only", action="store_true", help="HEAD-check existing map")
    ap.add_argument("--sample", type=int, default=0, help="sample N for --verify-only")
    args = ap.parse_args()
    if args.verify_only:
        return run_verify(args)
    return run_full(args)


if __name__ == "__main__":
    sys.exit(main())
