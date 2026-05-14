#!/usr/bin/env python3
"""Apply migration_url_map.json to rewrite src->dst URLs in demo data files,
and strip the broken signed_url field from data/assets.json (Step 3 option A).

Idempotent: rerunning is a no-op once all src URLs are replaced.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEMO_DATA = REPO_ROOT / "demo" / "data"
MAP_PATH = REPO_ROOT / "dev" / "scripts" / "migration_url_map.json"
ASSETS_JSON = REPO_ROOT / "data" / "assets.json"

SRC_HOST = "intern-data-wlcb.oss-cn-wulanchabu.aliyuncs.com"


def rewrite_demo_files(mapping: dict[str, str]) -> dict[str, int]:
    """Substitute each src URL literal with its dst URL in every demo data
    JSON file. Returns per-file replacement counts."""
    counts: dict[str, int] = {}
    targets = [DEMO_DATA / "index.json"]
    for d in sorted(DEMO_DATA.iterdir()):
        if d.is_dir():
            mf = d / "manifest.json"
            if mf.exists():
                targets.append(mf)
    for path in targets:
        text = path.read_text()
        n = 0
        for src, dst in mapping.items():
            if src in text:
                text = text.replace(src, dst)
                n += 1
        path.write_text(text)
        counts[str(path.relative_to(REPO_ROOT))] = n
    return counts


def strip_signed_url(assets_path: Path) -> int:
    """Remove the signed_url field from every entry in data/assets.json."""
    with assets_path.open() as f:
        items = json.load(f)
    n = 0
    for item in items:
        if isinstance(item, dict) and "signed_url" in item:
            del item["signed_url"]
            n += 1
    # keep 2-space indent + trailing newline to match existing file style
    with assets_path.open("w") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return n


def main() -> int:
    mapping: dict[str, str] = json.loads(MAP_PATH.read_text())
    print(f"loaded {len(mapping)} url mappings from {MAP_PATH.relative_to(REPO_ROOT)}")

    counts = rewrite_demo_files(mapping)
    total = sum(counts.values())
    print(f"[step 2] rewrote {total} src URLs across demo/data/:")
    for p, n in counts.items():
        print(f"  {n:4d}  {p}")

    n_assets = strip_signed_url(ASSETS_JSON)
    print(f"[step 3] stripped signed_url from {n_assets} entries in {ASSETS_JSON.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
