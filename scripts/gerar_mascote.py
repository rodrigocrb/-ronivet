"""Gera o mascote do RoniVet (labrador preto) em SVG e os ícones PNG do aplicativo.

Uso:  python scripts/gerar_mascote.py

Saídas (em web/): mascote.svg, mascote.js (SVG embutido para a interface) e icons/icon-*.png.
O desenho é feito só com elipses e linhas, descritas uma vez e renderizadas nos dois formatos.
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

WEB = Path(__file__).resolve().parent.parent / "web"
TAM = 120  # área de desenho do SVG (viewBox 0 0 120 120)

PRETO, BRANCO = "#000", "#fff"

# (tipo, cor, parâmetros). elipse: cx, cy, rx, ry, rotação em graus. linha: x1, y1, x2, y2, espessura.
FORMAS = [
    # corpo e coleira (o corpo encosta na cabeça)
    ("elipse", PRETO, (60, 94, 44, 26, 0)),
    ("elipse", BRANCO, (60, 79, 26, 6.5, 0)),
    ("elipse", PRETO, (60, 78, 24.4, 4.9, 0)),
    ("elipse", BRANCO, (60, 89, 5.5, 5.5, 0)),
    ("elipse", PRETO, (60, 89, 2, 2, 0)),
    # orelhas caídas e cabeça
    ("elipse", PRETO, (26, 50, 11, 25, 12)),
    ("elipse", PRETO, (94, 50, 11, 25, -12)),
    ("elipse", PRETO, (60, 44, 29, 27, 0)),
    # focinho com contorno branco
    ("elipse", BRANCO, (60, 61, 17.5, 13.5, 0)),
    ("elipse", PRETO, (60, 61, 16, 12, 0)),
    # olhos (branco, pupila, brilho)
    ("elipse", BRANCO, (47, 37, 6.2, 6.6, 0)),
    ("elipse", BRANCO, (73, 37, 6.2, 6.6, 0)),
    ("elipse", PRETO, (48, 38, 3.5, 3.8, 0)),
    ("elipse", PRETO, (72, 38, 3.5, 3.8, 0)),
    ("elipse", BRANCO, (49.2, 36.4, 1.2, 1.2, 0)),
    ("elipse", BRANCO, (73.2, 36.4, 1.2, 1.2, 0)),
    # nariz com contorno branco
    ("elipse", BRANCO, (60, 53, 8, 5.6, 0)),
    ("elipse", PRETO, (60, 53, 6.4, 4.2, 0)),
    # boca e língua
    ("elipse", BRANCO, (60, 72, 4.6, 5.4, 0)),
    ("linha", BRANCO, (60, 57, 60, 64, 2)),
    ("linha", BRANCO, (60, 64, 53, 68, 2)),
    ("linha", BRANCO, (60, 64, 67, 68, 2)),
]


def _svg() -> str:
    partes = []
    for tipo, cor, p in FORMAS:
        if tipo == "elipse":
            cx, cy, rx, ry, rot = p
            giro = f' transform="rotate({rot} {cx} {cy})"' if rot else ""
            partes.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{cor}"{giro}/>')
        else:
            x1, y1, x2, y2, w = p
            partes.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{cor}" '
                          f'stroke-width="{w}" stroke-linecap="round"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {TAM} {TAM}" role="img" '
            f'aria-label="Mascote RoniVet: labrador preto">' + "".join(partes) + "</svg>")


def _png(lado: int, margem: float) -> Image.Image:
    """Renderiza o mesmo desenho, com supersampling, sobre fundo branco."""
    fator = 4
    area = lado * fator
    img = Image.new("RGB", (area, area), BRANCO)
    d = ImageDraw.Draw(img)
    escala = area * (1 - 2 * margem) / TAM
    deslocamento = area * margem

    def pt(x, y):
        return (deslocamento + x * escala, deslocamento + y * escala)

    for tipo, cor, p in FORMAS:
        if tipo == "elipse":
            cx, cy, rx, ry, rot = p
            r = math.radians(rot)
            pontos = []
            for k in range(72):
                a = 2 * math.pi * k / 72
                x, y = rx * math.cos(a), ry * math.sin(a)
                pontos.append(pt(cx + x * math.cos(r) - y * math.sin(r),
                                 cy + x * math.sin(r) + y * math.cos(r)))
            d.polygon(pontos, fill=cor)
        else:
            x1, y1, x2, y2, w = p
            a, b = pt(x1, y1), pt(x2, y2)
            largura = max(1, round(w * escala))
            d.line([a, b], fill=cor, width=largura)
            for ponta in (a, b):
                d.ellipse([ponta[0] - largura / 2, ponta[1] - largura / 2,
                           ponta[0] + largura / 2, ponta[1] + largura / 2], fill=cor)
    return img.resize((lado, lado), Image.LANCZOS)


def main():
    svg = _svg()
    (WEB / "mascote.svg").write_text(svg, encoding="utf8")
    (WEB / "mascote.js").write_text(
        '"use strict";\n// Gerado por scripts/gerar_mascote.py: não edite à mão.\n'
        f"const MASCOTE_SVG = {json.dumps(svg)};\n", encoding="utf8")
    (WEB / "icons").mkdir(exist_ok=True)
    for lado in (192, 512):
        _png(lado, 0.12).save(WEB / "icons" / f"icon-{lado}.png", optimize=True)
    print("mascote.svg, mascote.js e ícones gerados em", WEB)


if __name__ == "__main__":
    main()
