"""複数の土木3Dプロジェクトから GitHub Pages 静的配信用ファイル一式を自動同期・最適化ビルドするスクリプト."""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from PIL import Image

SITE_ROOT = Path(__file__).resolve().parent.parent
PROJECTS_ROOT = SITE_ROOT.parent

THREE_SRC = PROJECTS_ROOT / "urban-cutaway-cube-3d" / "node_modules" / "three"
THREE_FILES = [
    "build/three.module.js",
    "build/three.core.js",
    "examples/jsm/controls/OrbitControls.js",
    "examples/jsm/loaders/GLTFLoader.js",
    "examples/jsm/environments/RoomEnvironment.js",
    "examples/jsm/utils/BufferGeometryUtils.js",
]

WORKS = [
    {
        "slug": "retaining-wall",
        "src_dir": PROJECTS_ROOT / "l-retaining-wall-3d",
        "output_files": [],
        "thumb_src": PROJECTS_ROOT / "l-retaining-wall-3d" / "output" / "previews" / "thumb_standard_iso.png",
        "thumb_out": "retaining_wall.jpg",
        "theme": "light",
    },
    {
        "slug": "river-levee",
        "src_dir": PROJECTS_ROOT / "river-levee-failure-3d",
        "output_files": ["river_levee_viewer.glb", "viewer_data.json"],
        "thumb_src": PROJECTS_ROOT / "river-levee-failure-3d" / "output" / "previews" / "thumb_piping_off.png",
        "thumb_out": "river_levee.jpg",
    },
    {
        "slug": "urban-cube",
        "src_dir": PROJECTS_ROOT / "urban-cutaway-cube-3d",
        "output_files": ["urban_cutaway_cube.glb", "viewer_data.json"],
        "thumb_src": PROJECTS_ROOT / "urban-cutaway-cube-3d" / "output" / "previews" / "01_cyber_cutaway_iso.png",
        "thumb_out": "urban_cube.jpg",
    },
    {
        "slug": "bridge-launching",
        "src_dir": PROJECTS_ROOT / "bridge-launching-3d",
        "output_files": ["bridge_launching_viewer.glb", "viewer_data.json"],
        "thumb_src": PROJECTS_ROOT / "bridge-launching-3d" / "output" / "previews" / "05_stage5_p2_closeup.png",
        "thumb_out": "bridge_launch.jpg",
    },
    {
        "slug": "sabo-dam",
        "src_dir": PROJECTS_ROOT / "sabo-3d-modeling",
        "output_files": ["sabo_dam_viewer.glb", "viewer_data.json"],
        "thumb_src": PROJECTS_ROOT / "sabo-3d-modeling" / "output" / "previews" / "01_iso_left_completed.png",
        "thumb_out": "sabo_dam.jpg",
    },
]

BACK_BTN_HTML_DARK = (
    '<a href="../../../index.html" '
    'style="display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:6px;'
    'background:rgba(56,189,248,0.16);border:1px solid rgba(56,189,248,0.48);color:#e0f2fe;'
    'font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0;" '
    'title="ポートフォリオ一覧へ戻る">← 一覧へ</a>'
)

BACK_BTN_HTML_LIGHT = (
    '<a href="../../../index.html" '
    'style="display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:6px;'
    'background:rgba(2,132,199,0.10);border:1px solid rgba(2,132,199,0.38);color:#0369a1;'
    'font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0;" '
    'title="ポートフォリオ一覧へ戻る">← 一覧へ</a>'
)


def sync_three() -> None:
    dst_root = SITE_ROOT / "libs" / "three"
    for rel in THREE_FILES:
        src = THREE_SRC / rel
        dst = dst_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    print(f"[1/3] Three.js 最小バンドル ({len(THREE_FILES)} files) 同期完了")


def sync_works() -> None:
    thumbs_dir = SITE_ROOT / "assets" / "thumbs"
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    for w in WORKS:
        slug = w["slug"]
        src_dir: Path = w["src_dir"]
        dst_work = SITE_ROOT / "works" / slug
        dst_viewer = dst_work / "viewer"
        dst_output = dst_work / "output"
        dst_viewer.mkdir(parents=True, exist_ok=True)

        # viewer/* コピー ＆ index.html の importmap を自己完結 libs/three へ書換＋一覧戻りリンク挿入
        for vf in (src_dir / "viewer").iterdir():
            if not vf.is_file():
                continue
            if vf.name == "index.html":
                html = vf.read_text(encoding="utf-8")
                html = html.replace("../node_modules/three/", "../../../libs/three/")
                html = html.replace("../libs/three/", "../../../libs/three/")
                html = re.sub(
                    r'<link\s+rel="icon"[^\n]*',
                    '<link rel="icon" type="image/png" href="../../../assets/brand/favicon.png" />',
                    html,
                    count=1,
                )
                if 'href="../../../index.html"' not in html:
                    btn_html = BACK_BTN_HTML_LIGHT if w.get("theme") == "light" else BACK_BTN_HTML_DARK
                    html = re.sub(
                        r'(<div\s+class="brand(?:-area)?"\s*>)',
                        rf"\1\n        {btn_html}",
                        html,
                        count=1,
                    )
                (dst_viewer / "index.html").write_text(html, encoding="utf-8")
            else:
                shutil.copy2(vf, dst_viewer / vf.name)

        # output の軽量必須ファイルのみ同期
        if w["output_files"]:
            dst_output.mkdir(parents=True, exist_ok=True)
            for fname in w["output_files"]:
                sf = src_dir / "output" / fname
                if not sf.exists():
                    raise FileNotFoundError(f"Missing required asset: {sf}")
                shutil.copy2(sf, dst_output / fname)

        # サムネイル画像を 960x540 高品質JPEGへ最適化
        tsrc: Path = w["thumb_src"]
        if tsrc.exists():
            im = Image.open(tsrc).convert("RGB")
            im = im.resize((960, 540), Image.Resampling.LANCZOS)
            im.save(thumbs_dir / w["thumb_out"], format="JPEG", quality=86, optimize=True)
        print(f"  - synced work: {slug}")
    print(f"[2/3] 全{len(WORKS)}作品のビューア・GLB・サムネイル同期完了")


def report_sizes() -> None:
    total = 0
    max_file = ("", 0)
    for p in SITE_ROOT.rglob("*"):
        if p.is_file() and ".git" not in p.parts:
            sz = p.stat().st_size
            total += sz
            if sz > max_file[1]:
                max_file = (str(p.relative_to(SITE_ROOT)), sz)
    print(f"[3/3] サイト合計サイズ: {total / (1024 * 1024):.2f} MB (GitHub Pages上限 1000MB に対し {total / (1024 * 1024) / 10.0:.1f}%)")
    print(f"      最大ファイル: {max_file[0]} ({max_file[1] / (1024 * 1024):.2f} MB < 上限 100MB OK)")


def main() -> None:
    sync_three()
    sync_works()
    report_sizes()


if __name__ == "__main__":
    main()
