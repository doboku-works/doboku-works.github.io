"""DOBOKU WORKS by Minamo — OGP画像 (1200x630 JPEG) 自動生成スクリプト."""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SITE_ROOT = Path(__file__).resolve().parent.parent
BRAND_DIR = SITE_ROOT / "assets" / "brand"
THUMBS_DIR = SITE_ROOT / "assets" / "thumbs"

W, H = 1200, 630
FONT_BOLD = r"C:\Windows\Fonts\BIZ-UDGothicB.ttc"
FONT_REG = r"C:\Windows\Fonts\BIZ-UDGothicR.ttc"


def draw_rounded_tile(
    base: Image.Image,
    img_path: Path,
    box: tuple[int, int, int, int],
    label: str,
    font: ImageFont.FreeTypeFont,
) -> None:
    x0, y0, x1, y1 = box
    tw, th = x1 - x0, y1 - y0
    src = Image.open(img_path).convert("RGB")
    # アスペクト比を保って中央クロップ
    sw, sh = src.size
    target_r = tw / th
    src_r = sw / sh
    if src_r > target_r:
        nw = int(sh * target_r)
        left = (sw - nw) // 2
        src = src.crop((left, 0, left + nw, sh))
    else:
        nh = int(sw / target_r)
        top = (sh - nh) // 2
        src = src.crop((0, top, sw, top + nh))
    tile = src.resize((tw, th), Image.Resampling.LANCZOS).convert("RGBA")

    mask = Image.new("L", (tw, th), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([(0, 0), (tw - 1, th - 1)], radius=14, fill=255)

    # キャプションバッジ
    td = ImageDraw.Draw(tile)
    bb = td.textbbox((0, 0), label, font=font)
    lw = bb[2] - bb[0]
    td.rounded_rectangle(
        [(10, th - 36), (10 + lw + 18, th - 10)],
        radius=7,
        fill=(9, 17, 32, 224),
    )
    td.text((19, th - 31), label, font=font, fill=(241, 245, 249, 255))

    base.paste(tile, (x0, y0), mask)
    bd = ImageDraw.Draw(base)
    bd.rounded_rectangle(
        [(x0, y0), (x1 - 1, y1 - 1)],
        radius=14,
        outline=(96, 165, 250, 95),
        width=2,
    )


def main() -> None:
    im = Image.new("RGBA", (W, H), (9, 19, 36, 255))
    d = ImageDraw.Draw(im)

    # 背景グラデーション
    for y in range(H):
        t = y / H
        r = int(9 + t * 8)
        g = int(19 + t * 13)
        b = int(36 + t * 20)
        d.line([(0, y), (W, y)], fill=(r, g, b, 255))

    # 淡い設計方眼グリッド
    grid_ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid_ov)
    for gx in range(0, W, 36):
        gd.line([(gx, 0), (gx, H)], fill=(56, 189, 248, 16), width=1)
    for gy in range(0, H, 36):
        gd.line([(0, gy), (W, gy)], fill=(56, 189, 248, 16), width=1)
    im = Image.alpha_composite(im, grid_ov)
    d = ImageDraw.Draw(im)

    # トップグラデーションアクセントバー
    for x in range(W):
        t = x / W
        if t < 0.5:
            u = t * 2.0
            col = (int(56 + u * 73), int(189 - u * 49), int(248))
        else:
            u = (t - 0.5) * 2.0
            col = (int(129 + u * 122), int(140 + u * 6), int(248 - u * 188))
        d.line([(x, 0), (x, 4)], fill=(*col, 255))

    # フォント読込（英字ロゴはモダンなサンセリフBoldを優先）
    segoe_bold = Path(r"C:\Windows\Fonts\segoeuib.ttf")
    f_pill = ImageFont.truetype(FONT_BOLD, 17)
    f_brand = ImageFont.truetype(str(segoe_bold) if segoe_bold.exists() else FONT_BOLD, 58)
    f_sub = ImageFont.truetype(FONT_BOLD, 25)
    f_desc = ImageFont.truetype(FONT_REG, 15)
    f_tag = ImageFont.truetype(FONT_BOLD, 15)
    f_url = ImageFont.truetype(str(segoe_bold) if segoe_bold.exists() else FONT_BOLD, 18)
    f_tile = ImageFont.truetype(FONT_BOLD, 15)

    # 左上ロゴ＋ピル（Minamo 表記のみ）
    fav_path = BRAND_DIR / "favicon.png"
    if fav_path.exists():
        logo = Image.open(fav_path).convert("RGBA").resize((62, 62), Image.Resampling.LANCZOS)
        im.paste(logo, (54, 128), logo)

    pill_text = "Minamo — 個人技術デモ"
    pb = d.textbbox((0, 0), pill_text, font=f_pill)
    pw = pb[2] - pb[0]
    px0, py0 = 136, 140
    d.rounded_rectangle(
        [(px0, py0), (px0 + pw + 34, py0 + 38)],
        radius=19,
        fill=(15, 36, 62, 230),
        outline=(56, 189, 248, 130),
        width=1,
    )
    d.text((px0 + 17, py0 + 10), pill_text, font=f_pill, fill=(125, 211, 252, 255))

    # タイトル: DOBOKU (白) + WORKS (シアン〜オレンジグラデ風)
    d.text((54, 212), "DOBOKU", font=f_brand, fill=(248, 250, 252, 255))
    db_w = d.textbbox((0, 0), "DOBOKU ", font=f_brand)[2]
    wx = 54 + db_w
    works_colors = [
        (56, 189, 248),
        (96, 165, 250),
        (147, 150, 250),
        (216, 148, 178),
        (251, 146, 60),
    ]
    for ch, col in zip("WORKS", works_colors):
        d.text((wx, 212), ch, font=f_brand, fill=(*col, 255))
        wx += d.textbbox((0, 0), ch, font=f_brand)[2] - 2

    # キャッチコピー
    d.text((54, 294), "動く 3D / 4D と力学で可視化する", font=f_sub, fill=(241, 245, 249, 255))
    d.text((54, 332), "土木シミュレーション ＆ インフラアート", font=f_sub, fill=(241, 245, 249, 255))

    # 説明文（x=594 の区切り線内に余裕を持って収める）
    d.text(
        (54, 392),
        "L型・大型ブロック擁壁・河川堤防4大決壊・少数鈑桁送り出しFEM・",
        font=f_desc,
        fill=(148, 163, 184, 255),
    )
    d.text(
        (54, 417),
        "都市地下解剖キューブ・砂防堰堤 4D をブラウザだけで直接操作。",
        font=f_desc,
        fill=(148, 163, 184, 255),
    )

    # 下部区切り線＆タグ
    d.line([(54, 468), (594, 468)], fill=(51, 65, 85, 180), width=1)
    tags = ["5 WebGL Demos", "Three.js / FEM"]
    tx = 54
    for tag in tags:
        tb = d.textbbox((0, 0), tag, font=f_tag)
        tw = tb[2] - tb[0]
        d.rounded_rectangle(
            [(tx, 490), (tx + tw + 26, 522)],
            radius=10,
            fill=(15, 28, 48, 220),
            outline=(56, 189, 248, 100),
            width=1,
        )
        d.text((tx + 13, 498), tag, font=f_tag, fill=(186, 230, 253, 255))
        tx += tw + 38

    url_txt = "doboku-works.github.io"
    ub = d.textbbox((0, 0), url_txt, font=f_url)
    d.text((594 - (ub[2] - ub[0]), 496), url_txt, font=f_url, fill=(56, 189, 248, 255))

    # 右側 2x2 デモサムネイルグリッド
    tiles = [
        (THUMBS_DIR / "urban_cube.jpg", (638, 152, 886, 304), "都市地下解剖キューブ"),
        (THUMBS_DIR / "bridge_launch.jpg", (900, 152, 1148, 304), "少数鈑桁 送り出し4D/FEM"),
        (THUMBS_DIR / "retaining_wall.jpg", (638, 318, 886, 470), "擁壁 0ms安定・大型ブロック"),
        (THUMBS_DIR / "river_levee.jpg", (900, 318, 1148, 470), "河川堤防 4大決壊"),
    ]
    for path, box, label in tiles:
        if path.exists():
            draw_rounded_tile(im, path, box, label, f_tile)

    out_path = BRAND_DIR / "ogp.jpg"
    im.convert("RGB").save(out_path, format="JPEG", quality=92, optimize=True)
    print(f"Generated OGP: {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
