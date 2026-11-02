"""Iconos y pantalla de carga de la app de Android a partir de los de la web.
    python tools/make_app_icons.py

- assets/icons/icon-512.png          -> icono clásico (Android 7)
- assets/icons/icon-maskable-512.png -> icono adaptable (Android 8+), redondo y
                                        pantalla de carga (la Poké Ball sobre el azul del juego)
Escribe en app/android/app/src/main/res/ con los tamaños de la plantilla de
Capacitor. Sólo hace falta volver a ejecutarlo si cambian esos dos iconos.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'app' / 'android' / 'app' / 'src' / 'main' / 'res'
ICON = Image.open(ROOT / 'assets' / 'icons' / 'icon-512.png').convert('RGBA')
MASK = Image.open(ROOT / 'assets' / 'icons' / 'icon-maskable-512.png').convert('RGBA')
BG = MASK.getpixel((0, 0))                      # el azul de fondo (#0a1430)
DENSITY = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def fit(im, size):
    return im.resize((size, size), Image.LANCZOS)


def on_bg(w, h, art, size):
    """La imagen centrada, de `size` px, sobre el azul de fondo."""
    out = Image.new('RGBA', (w, h), BG)
    out.alpha_composite(fit(art, size), ((w - size) // 2, (h - size) // 2))
    return out


for name, d in DENSITY.items():
    folder = RES / f'mipmap-{name}'
    px = round(48 * d)
    fit(ICON, px).save(folder / 'ic_launcher.png')
    # Redondo: el maskable recortado en círculo.
    round_ = fit(MASK, px)
    cut = Image.new('L', (px, px), 0)
    ImageDraw.Draw(cut).ellipse((0, 0, px - 1, px - 1), fill=255)
    round_.putalpha(cut)
    round_.save(folder / 'ic_launcher_round.png')
    # Adaptable: lienzo de 108 dp; lo importante del maskable (el 80 % del centro)
    # tiene que caber en los 66 dp que no recorta ninguna forma de icono.
    canvas = round(108 * d)
    on_bg(canvas, canvas, MASK, round(82 * d)).save(folder / 'ic_launcher_foreground.png')

# Pantalla de carga: la Poké Ball (un tercio del lado corto) sobre el azul.
for f in RES.glob('drawable*/splash.png'):
    w, h = Image.open(f).size
    on_bg(w, h, MASK, min(w, h) // 3).convert('RGB').save(f)

(RES / 'values' / 'ic_launcher_background.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    f'    <color name="ic_launcher_background">#{BG[0]:02X}{BG[1]:02X}{BG[2]:02X}</color>\n</resources>\n',
    encoding='utf-8')
print('ok: iconos y pantalla de carga en', RES.relative_to(ROOT))
