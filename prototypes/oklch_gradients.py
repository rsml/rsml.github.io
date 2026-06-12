"""Generate gradients/lines for the Chord Colors wheel diagrams.

Diagram 1 (consonance): 12 OKLCH-uniform gradients along the perimeter,
hex stops so the rendered colors match the math exactly.

Diagram 2 (tritones): 12 SOLID-color dashed lines, one per note, from
note center toward wheel center but stopping (L+2G)/2 short so that the
center "gap" reads as exactly one missing dash with its two adjacent
gaps. Dash pattern is `L G` = `20 15`, n=4 dashes per line, length 125;
each line ends 25 from wheel center, so opposite lines form a 50-unit
center gap = L + 2G."""

import math

# --- color math ---

def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def linear_to_srgb_byte(c):
    if c <= 0.0031308:
        v = 12.92 * c
    else:
        v = 1.055 * (c ** (1/2.4)) - 0.055
    return max(0, min(255, round(v * 255)))

def rgb_to_oklab(r, g, b):
    r, g, b = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    cbrt = lambda x: x**(1/3) if x >= 0 else -((-x)**(1/3))
    l_, m_, s_ = cbrt(l), cbrt(m), cbrt(s)
    L = 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_
    A = 1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_
    B = 0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_
    return L, A, B

def oklab_to_rgb(L, A, B):
    l_ = L + 0.3963377774*A + 0.2158037573*B
    m_ = L - 0.1055613458*A - 0.0638541728*B
    s_ = L - 0.0894841775*A - 1.2914855480*B
    l, m, s = l_**3, m_**3, s_**3
    r = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    b = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return linear_to_srgb_byte(r), linear_to_srgb_byte(g), linear_to_srgb_byte(b)

def oklab_to_oklch(L, A, B):
    C = math.sqrt(A*A + B*B)
    H = math.degrees(math.atan2(B, A))
    if H < 0:
        H += 360
    return L, C, H

def lerp_hue(h1, h2, t):
    diff = h2 - h1
    if diff > 180:
        diff -= 360
    elif diff < -180:
        diff += 360
    return (h1 + t * diff) % 360

def lerp_oklch(c1, c2, t):
    return (
        c1[0] + t * (c2[0] - c1[0]),
        c1[1] + t * (c2[1] - c1[1]),
        lerp_hue(c1[2], c2[2], t),
    )

def oklch_to_hex(L, C, H):
    A, B = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
    r, g, b = oklab_to_rgb(L, A, B)
    return f'#{r:02X}{g:02X}{b:02X}'

# --- palette ---

notes = [
    ('C',   (255,   0,   0), (200,  50)),
    ('G',   (255,  89,   0), (275,  70)),
    ('D',   (255, 143,   0), (330, 125)),
    ('A',   (255, 196,   0), (350, 200)),
    ('E',   (254, 255,   0), (330, 275)),
    ('B',   (120, 203,   0), (275, 330)),
    ('Fs',  (  0, 178,   0), (200, 350)),
    ('Cs',  (  0, 165, 203), (125, 330)),
    ('Gs',  (  0,  99, 187), ( 70, 275)),
    ('Ds',  (  8,   0, 172), ( 50, 200)),
    ('As',  (110,   0, 172), ( 70, 125)),
    ('F',   (215,   0, 127), (125,  70)),
]

oklchs = {n: oklab_to_oklch(*rgb_to_oklab(*rgb)) for n, rgb, _ in notes}
coords = {n: xy for n, _, xy in notes}
hexes  = {n: f'#{r:02X}{g:02X}{b:02X}' for n, (r, g, b), _ in notes}

# --- 12 neighbor gradients (diagram 1) ---

def stops_oklch_path(c1, c2, n_segments=7):
    out = []
    for i in range(n_segments + 1):
        t = i / n_segments
        L, C, H = lerp_oklch(c1, c2, t)
        out.append((t, oklch_to_hex(L, C, H)))
    return out

print('=== Diagram 1: neighbor gradients (unchanged) ===')
for i in range(12):
    a = notes[i][0]
    b = notes[(i+1) % 12][0]
    ax, ay = coords[a]
    bx, by = coords[b]
    grad_id = f'nb-{a.lower()}-{b.lower()}'
    print(f'<linearGradient id="{grad_id}" x1="{ax}" y1="{ay}" x2="{bx}" y2="{by}" gradientUnits="userSpaceOnUse">')
    for t, h in stops_oklch_path(oklchs[a], oklchs[b]):
        print(f'  <stop offset="{t*100:.1f}%" stop-color="{h}"/>')
    print('</linearGradient>')

# --- 12 solid dashed tritone-radial lines (diagram 2) ---

DASH_L = 20
GAP_G = 15
N_DASHES = 4  # per line
LINE_LEN = N_DASHES * DASH_L + (N_DASHES - 1) * GAP_G  # = 125
CENTER = (200, 200)
NOTE_RADIUS = 150  # distance from each note center to wheel center
SHORT_OF_CENTER = NOTE_RADIUS - LINE_LEN  # = 25, so center gap diameter = 50

print(f'\n=== Diagram 2 params: L={DASH_L}, G={GAP_G}, n={N_DASHES}, line_len={LINE_LEN}, ends_at={SHORT_OF_CENTER} from wheel center ===')
print(f'    Center gap = {SHORT_OF_CENTER*2} units = L + 2G = {DASH_L + 2*GAP_G} (one missing dash + two adjacent gaps)\n')

print('=== Diagram 2: 12 solid dashed lines ===')
for n, _, (nx, ny) in notes:
    frac = LINE_LEN / NOTE_RADIUS  # 125/150 = 5/6
    ex = nx + frac * (CENTER[0] - nx)
    ey = ny + frac * (CENTER[1] - ny)
    color = hexes[n]
    print(f'<line x1="{nx}" y1="{ny}" x2="{ex:.2f}" y2="{ey:.2f}" stroke="{color}" stroke-width="3" stroke-dasharray="{DASH_L} {GAP_G}" stroke-linecap="round"/>')
