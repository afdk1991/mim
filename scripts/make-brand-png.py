"""把仓库里的 Mim 品牌 SVG 标记重绘为 PNG（Pillow 无 SVG 渲染器，按原几何参数逐点复刻）。"""
import pathlib
from PIL import Image, ImageDraw

START = (0x3b, 0x6e, 0xf5)   # SVG 渐变起点 #3b6ef5
END = (0x2f, 0x59, 0xc9)     # SVG 渐变终点 #2f59c9
BOX = 32                     # SVG viewBox 边长
STROKE = 3                   # 原 SVG 描边宽度 3
POINTS = [(9, 23), (9, 11), (16, 19), (23, 11), (23, 23)]  # 原 path 顶点，M 形折线


def gradient(size: int) -> Image.Image:
    """按 SVG x1(0,0)->x2(1,1) 的 45° 方向生成线性渐变底。"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))       # 对角投影参数 0~1
            px[x, y] = tuple(
                round(START[i] + (END[i] - START[i]) * t) for i in range(3)
            )
    return img


def rounded_mask(size: int) -> Image.Image:
    """圆角半径 8/32（即 size/4），用于把方形渐变裁成 App 图标形状。"""
    mask = Image.new("L", (size, size), 0)
    radius = size // 4
    ImageDraw.Draw(mask).rounded_rectangle(
        [(0, 0), (size - 1, size - 1)], radius=radius, fill=255
    )
    return mask


def draw_mark(size: int, out_dir: pathlib.Path, names: list[str]) -> None:
    """在透明画布上重绘 M 折线，并按目标尺寸导出。"""
    base = gradient(size)
    rgba = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rgba.paste(base, (0, 0), rounded_mask(size))
    draw = ImageDraw.Draw(rgba)
    scale = size / BOX
    pts = [(x * scale, y * scale) for x, y in POINTS]
    draw.line(pts, fill=(255, 255, 255, 255), width=round(STROKE * scale), joint="curve")
    for name in names:
        path = out_dir / name
        rgba.save(path, "PNG")
        print("OK", path, path.stat().st_size)


def main() -> None:
    out_dir = pathlib.Path(r"F:\合并项目\Mim\branding")
    out_dir.mkdir(parents=True, exist_ok=True)
    draw_mark(512, out_dir, ["mim-logo-512.png"])   # 主题 LOGO
    draw_mark(180, out_dir, ["mim-icon-180.png"])   # 站点图标 apple-touch 尺寸


main()
