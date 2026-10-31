# =====================================================================
#  Ponte Pênsil do Rio Mampituba (Torres/RS – Passo de Torres/SC)
#  Gerador paramétrico para Blender 3.6 / 4.x
#
#  Uso: Blender › aba Scripting › Abrir este arquivo › Run Script (Alt+P)
#  Eixos (Blender, Z para cima):
#     X = eixo da ponte  (−X = Torres/RS, +X = Passo de Torres/SC)
#     Y = transversal    (o rio corre ao longo de Y)
#     Z = cota           (Z = 0 no nível médio da água)
#  Unidades: metros. Altere o dicionário P e rode de novo: a coleção é recriada.
# =====================================================================
import bpy, bmesh, math
from mathutils import Matrix, Vector

P = dict(
    L=100.0,          # vão entre eixos das torres
    deck_end=5.20,    # cota do piso nas torres
    camber=0.80,      # contraflecha no meio do vão
    ground=1.60,      # cota das praças / cais
    quay_x=44.0,      # face do cais (|x|)
    tower_top=14.50,  # cota da sela dos cabos
    cable_low=7.45,   # cota do cabo no meio do vão (flecha = tower_top - cable_low)
    cable_y=1.20, cable_r=0.019, cable_gap=0.10,
    hanger_step=2.0, hanger_r=0.008,
    plank_w=0.15, plank_gap=0.012, plank_t=0.045, plank_len=1.70,
    stringer_y=0.60, trans_step=1.0, trans_len=2.60,
    rail_h=1.20, rail_y=0.82, post_step=2.0,
    leg_y=1.55, leg_hy=0.25, leg_hx_base=0.75, leg_hx_top=0.35,
    anchor_dist=9.0, anchor_y=2.40,   # SC: estais presos ao piso (chumbador + esticador)
    rs_strut=7.0, rs_strut_z=8.0,     # RS: escora de concreto até o pilar frontal (estimado por foto)
    landing=1.40, stair_run=0.28,
    build_environment=True,   # água, cais e praças simples
    build_leds=True,          # fitas LED emissivas (cabos e corrimão)
    led_cable_rgb=(0.17, 0.33, 1.0), led_cable_nits=4000,
    led_rail_kelvin=3000, led_rail_nits=1500,
)
H = P['L'] / 2
COL = 'Ponte_Pensil_Mampituba'

def deck_z(x):   return P['deck_end'] + P['camber'] * (1 - (2 * x / P['L']) ** 2)
def deck_slope(x): return -8 * P['camber'] * x / P['L'] ** 2
def cable_z(x):  u = 2 * x / P['L']; return P['cable_low'] + (P['tower_top'] - P['cable_low']) * u * u
def frange(a, b, s):
    out, x = [], a
    while x <= b + 1e-9: out.append(x); x += s
    return out

# ---------------------------------------------------------------------
#  Coleção e materiais
# ---------------------------------------------------------------------
if COL in bpy.data.collections:
    old = bpy.data.collections[COL]
    for o in list(old.all_objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(old)
root = bpy.data.collections.new(COL); bpy.context.scene.collection.children.link(root)

def sub(name):
    c = bpy.data.collections.new(name); root.children.link(c); return c

def bsdf_input(node, *names):
    for n in names:
        if n in node.inputs: return node.inputs[n]
    return None

def material(name, rgb, rough=0.6, metal=0.0, emit=None, strength=0.0, alpha=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit is not None:
        bsdf_input(b, 'Emission Color', 'Emission').default_value = (*emit, 1)
        bsdf_input(b, 'Emission Strength').default_value = strength
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
        for attr, val in (('blend_method', 'HASHED'), ('surface_render_method', 'DITHERED')):
            try: setattr(m, attr, val)
            except Exception: pass
    return m

def wood_material():
    m = material('Madeira_tratada_desgastada', (0.36, 0.29, 0.22), rough=0.82)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (40.0, 1.5, 40.0)          # veios ao longo da prancha (Y)
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 3.0; nz.inputs['Detail'].default_value = 8.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.20, 0.16, 0.12, 1); ramp.color_ramp.elements[1].color = (0.46, 0.39, 0.31, 1)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    return m

def mesh_material():
    """Tela soldada 50×50 mm por máscara procedural (sem geometria extra)."""
    m = material('Tela_soldada_50mm', (0.92, 0.93, 0.94), rough=0.45, metal=0.3, alpha=1.0)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    def wire(axis):
        d = nt.nodes.new('ShaderNodeMath'); d.operation = 'DIVIDE'; d.inputs[1].default_value = 0.05
        f = nt.nodes.new('ShaderNodeMath'); f.operation = 'FRACT'
        lt = nt.nodes.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = 0.09   # fio Ø 4–5 mm
        nt.links.new(sep.outputs[axis], d.inputs[0]); nt.links.new(d.outputs[0], f.inputs[0]); nt.links.new(f.outputs[0], lt.inputs[0])
        return lt
    mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
    nt.links.new(wire('X').outputs[0], mx.inputs[0]); nt.links.new(wire('Z').outputs[0], mx.inputs[1])
    nt.links.new(mx.outputs[0], b.inputs['Alpha'])
    return m

def kelvin_rgb(k):
    t = k / 100
    r = 255 if t <= 66 else 329.698727446 * (t - 60) ** -0.1332047592
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * (t - 60) ** -0.0755148492
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    c = lambda v: max(0, min(255, v)) / 255
    lin = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(lin(c(v)) for v in (r, g, b))

# Luminância (nits) → Emission Strength do Blender:  S ≈ π · L / 683
nits_to_strength = lambda nits: math.pi * nits / 683.0

M = dict(
    concreto=material('Concreto_pintado_branco', (0.80, 0.79, 0.76), rough=0.85),
    concreto_cinza=material('Concreto_cinza', (0.52, 0.51, 0.49), rough=0.9),
    aco_branco=material('Aco_pintado_branco', (0.86, 0.88, 0.89), rough=0.42, metal=0.15),
    aco_escuro=material('Aco_estrutural', (0.10, 0.11, 0.12), rough=0.55, metal=0.6),
    galvanizado=material('Aco_galvanizado', (0.66, 0.68, 0.70), rough=0.35, metal=1.0),
    madeira=wood_material(),
    tela=mesh_material(),
    agua=material('Agua_Mampituba', (0.02, 0.035, 0.035), rough=0.04, metal=0.0),
    piso=material('Piso_praca', (0.33, 0.29, 0.26), rough=0.9),
)

# ---------------------------------------------------------------------
#  Construtores
# ---------------------------------------------------------------------
def mesh_obj(name, bm, mat, coll):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    for p in me.polygons: p.use_smooth = False
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob); return ob

def add_box(bm, center, size, rot=Matrix.Identity(3)):
    mtx = Matrix.Translation(Vector(center)) @ rot.to_4x4() @ Matrix.Diagonal((*size, 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=mtx)

def add_segment_box(bm, a, b, sy, sz):
    """Caixa entre os pontos a→b (eixo local X ao longo do segmento)."""
    a, b = Vector(a), Vector(b); d = b - a
    rot = d.to_track_quat('X', 'Z').to_matrix()
    add_box(bm, (a + b) / 2, (d.length, sy, sz), rot)

def add_frustum(bm, cx, z0, z1, hx0, hx1, cy, hy):
    v = []
    for z, hx in ((z0, hx0), (z1, hx1)):
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            v.append(bm.verts.new((cx + sx * hx, cy + sy * hy, z)))
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])

def curve_obj(name, polylines, r, mat, coll, res=2):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = r; cu.bevel_resolution = res; cu.use_fill_caps = True
    for pts in polylines:
        sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts): sp.points[i].co = (*p, 1.0)
    ob = bpy.data.objects.new(name, cu); cu.materials.append(mat); coll.objects.link(ob); return ob

def sc_anchor(y):
    sy = 1 if y >= 0 else -1
    return (H + P['anchor_dist'], sy * P['anchor_y'] + (y - sy * P['cable_y']), P['ground'] + 0.62)

def cable_polyline(y, back=True, dz=0.0):
    pts = []
    zf = P['ground'] + P['rs_strut_z']
    # RS: o cabo desce embutido na escora de concreto
    if back: pts += [(-H - P['rs_strut'] * (1 - i / 12), y, zf + 0.2 * (1 - i / 12) + (P['tower_top'] - zf) * i / 12 + dz) for i in range(12)]
    pts += [(x, y, cable_z(x) + dz) for x in frange(-H, H, 0.5)]
    # SC: estai reto até o esticador no piso
    if back:
        ax, ay, az = sc_anchor(y)
        pts += [(H + (ax - H) * i / 12, y + (ay - y) * i / 12, P['tower_top'] + (az - P['tower_top']) * i / 12 + dz) for i in range(1, 13)]
    return pts

# ---------------------------------------------------------------------
#  1. Tabuleiro
# ---------------------------------------------------------------------
c_deck = sub('01_Tabuleiro')
bm = bmesh.new(); pitch = P['plank_w'] + P['plank_gap']
for i in range(int(P['L'] / pitch)):
    x = -H + pitch * (i + 0.5)
    rot = Matrix.Rotation(-math.atan(deck_slope(x)), 3, 'Y')
    add_box(bm, (x, 0, deck_z(x) - P['plank_t'] / 2), (P['plank_w'], P['plank_len'], P['plank_t']), rot)
mesh_obj('Pranchas_150x45', bm, M['madeira'], c_deck)

bm = bmesh.new()
for x in frange(-H, H - 1, 1.0):
    for y in (-P['stringer_y'], P['stringer_y']):
        z0, z1 = deck_z(x) - P['plank_t'] - 0.10, deck_z(x + 1) - P['plank_t'] - 0.10
        add_segment_box(bm, (x, y, z0), (x + 1, y, z1), 0.10, 0.20)
mesh_obj('Longarinas', bm, M['aco_escuro'], c_deck)

bm = bmesh.new()
for k in range(int(P['L'] / P['trans_step']) + 1):
    x = -H + k * P['trans_step']; z = deck_z(x) - P['plank_t'] - 0.26
    add_box(bm, (x, 0, z), (0.08, P['trans_len'], 0.12))
mesh_obj('Transversinas', bm, M['aco_escuro'], c_deck)

# ---------------------------------------------------------------------
#  2. Suspensão: cabos e pendurais
# ---------------------------------------------------------------------
c_sus = sub('02_Suspensao')
cables = [cable_polyline(s * P['cable_y'] + c * P['cable_gap'] / 2) for s in (-1, 1) for c in (-1, 1)]
curve_obj('Cabos_principais_2x2_D38', cables, P['cable_r'], M['galvanizado'], c_sus, res=3)
hangers = []
for k in range(1, int(P['L'] / P['hanger_step'])):
    x = -H + k * P['hanger_step']
    for s in (-1, 1):
        hangers.append([(x, s * P['cable_y'], cable_z(x) - 0.02), (x, s * P['cable_y'], deck_z(x) - P['plank_t'] - 0.32)])
curve_obj('Pendurais_D16', hangers, P['hanger_r'], M['galvanizado'], c_sus, res=1)

# ---------------------------------------------------------------------
#  3. Guarda-corpo
# ---------------------------------------------------------------------
c_rail = sub('03_Guarda_corpo')
bm = bmesh.new()
for k in range(int(P['L'] / P['post_step']) + 1):
    x = -H + k * P['post_step']
    for s in (-1, 1): add_box(bm, (x, s * P['rail_y'], deck_z(x) + P['rail_h'] / 2), (0.05, 0.05, P['rail_h']))
mesh_obj('Montantes_50x50', bm, M['aco_branco'], c_rail)
tops = [[(x, s * P['rail_y'], deck_z(x) + P['rail_h']) for x in frange(-H, H, 1)] for s in (-1, 1)]
bots = [[(x, s * P['rail_y'], deck_z(x) + 0.12) for x in frange(-H, H, 1)] for s in (-1, 1)]
curve_obj('Corrimao_D50', tops, 0.026, M['aco_branco'], c_rail)
curve_obj('Travessa_inferior', bots, 0.016, M['aco_branco'], c_rail)
bm = bmesh.new()
for s in (-1, 1):
    prev = None
    for x in frange(-H, H, 1):
        a = bm.verts.new((x, s * P['rail_y'], deck_z(x) + 0.12)); b = bm.verts.new((x, s * P['rail_y'], deck_z(x) + P['rail_h'] - 0.03))
        if prev: bm.faces.new((prev[0], a, b, prev[1]))
        prev = (a, b)
tela = mesh_obj('Tela_soldada', bm, M['tela'], c_rail)

# ---------------------------------------------------------------------
#  4. Torres-pórtico, patamares, escadas e ancoragens
# ---------------------------------------------------------------------
c_tow = sub('04_Torres_e_cabeceiras')
n_steps = round((P['deck_end'] - P['ground']) / 0.18); rise = (P['deck_end'] - P['ground']) / n_steps
for s, nome in ((-1, 'RS_Torres'), (1, 'SC_Passo_de_Torres')):
    cx = s * H; bm = bmesh.new(); yw = 2 * P['leg_y'] + 2 * P['leg_hy']
    if s < 0:   # RS: pórtico com escoras inclinadas até pilares frontais (sem estai no piso)
        xf, zf = cx + s * P['rs_strut'], P['ground'] + P['rs_strut_z']
        for y in (-P['leg_y'], P['leg_y']):
            z0, z1 = P['ground'] - 0.8, P['tower_top'] + 0.35
            add_box(bm, (cx, y, (z0 + z1) / 2), (0.62, 2 * P['leg_hy'], z1 - z0))            # pilar traseiro
            add_box(bm, (xf, y, (P['ground'] - 0.6 + zf + 0.25) / 2), (0.9, 2 * P['leg_hy'], zf + 0.25 - P['ground'] + 0.6))  # pilar frontal
            add_segment_box(bm, (cx + s * 0.05, y, P['tower_top'] + 0.05), (xf - s * 0.2, y, zf), 2 * P['leg_hy'], 0.62)  # escora
        add_box(bm, (cx, 0, P['tower_top'] - 0.25), (0.72, yw, 0.70))
        add_box(bm, (cx, 0, P['tower_top'] - 3.60), (0.55, yw, 0.40))
        add_box(bm, (xf, 0, zf - 0.45), (0.9, yw, 0.45))
    else:       # SC: torre-pórtico alta com painel no topo
        for y in (-P['leg_y'], P['leg_y']):
            add_frustum(bm, cx, P['ground'] - 0.8, P['tower_top'] + 0.35, P['leg_hx_base'], P['leg_hx_top'], y, P['leg_hy'])
        add_box(bm, (cx, 0, P['tower_top'] - 0.65), (0.72, yw, 0.90))                       # viga superior
        add_box(bm, (cx, 0, P['tower_top'] - 2.30), (0.20, 2 * (P['leg_y'] - P['leg_hy']), 2.30))  # painel
        add_box(bm, (cx, 0, P['tower_top'] - 3.60), (0.55, yw, 0.35))                       # viga intermediária
    add_box(bm, (cx, 0, P['deck_end'] - 0.60), (1.10, yw, 0.60))                        # viga de apoio
    mesh_obj('Torre_' + nome, bm, M['concreto'], c_tow)
    bm = bmesh.new()
    x0, x1 = s * (H - 0.6), s * (H + P['landing'])
    add_box(bm, ((x0 + x1) / 2, 0, P['deck_end'] - 0.15), (abs(x1 - x0), 1.9, 0.30))     # patamar
    for k in range(n_steps):
        top = P['deck_end'] - (k + 1) * rise
        add_box(bm, (s * (H + P['landing'] + (k + 0.5) * P['stair_run']), 0, top - (rise + 0.12) / 2), (P['stair_run'], 1.6, rise + 0.12))
    if s > 0:   # placas dos chumbadores no piso (fundação enterrada, não modelada)
        for sy in (-1, 1): add_box(bm, (H + P['anchor_dist'], sy * P['anchor_y'], P['ground'] + 0.055), (0.55, 0.5, 0.03))
    mesh_obj('Escada_patamar_ancoragem_' + nome, bm, M['concreto_cinza'], c_tow)
    bm = bmesh.new()
    for y in (-P['cable_y'], P['cable_y']): add_box(bm, (cx, y, P['tower_top'] - 0.1), (0.7, 0.3, 0.2))
    mesh_obj('Selas_' + nome, bm, M['aco_escuro'], c_tow)
    xs0, xs1 = s * (H + P['landing']), s * (H + P['landing'] + n_steps * P['stair_run'])
    curve_obj('Corrimao_escada_' + nome, [[(s * (H - 0.6), y, P['deck_end'] + P['rail_h']), (xs0, y, P['deck_end'] + P['rail_h']), (xs1, y, P['ground'] + P['rail_h'])] for y in (-0.85, 0.85)], 0.026, M['aco_branco'], c_tow)

# ---------------------------------------------------------------------
#  5. Entorno simples (água, cais, praças)
# ---------------------------------------------------------------------
if P['build_environment']:
    c_env = sub('05_Entorno')
    bm = bmesh.new(); add_box(bm, (0, 0, -0.01), (2 * P['quay_x'], 800, 0.02)); mesh_obj('Rio_Mampituba_NA_medio', bm, M['agua'], c_env)
    bm = bmesh.new()
    for s in (-1, 1):
        add_box(bm, (s * (P['quay_x'] + 0.6), 0, P['ground'] - 3), (1.2, 800, 6))
        add_box(bm, (s * (P['quay_x'] + 150), 0, P['ground'] - 0.05), (300, 800, 0.1))
    mesh_obj('Cais_e_pracas', bm, M['piso'], c_env)

# ---------------------------------------------------------------------
#  6. LEDs (fitas emissivas) — mesma luminância (nits) do simulador web
# ---------------------------------------------------------------------
if P['build_leds']:
    c_led = sub('06_LED')
    m_cab = material('LED_cabos', (0, 0, 0), emit=P['led_cable_rgb'], strength=nits_to_strength(P['led_cable_nits']))
    m_rail = material('LED_corrimao', (0, 0, 0), emit=kelvin_rgb(P['led_rail_kelvin']), strength=nits_to_strength(P['led_rail_nits']))
    curve_obj('LED_neon_flex_cabos', [cable_polyline(s * (P['cable_y'] + P['cable_gap'] / 2), dz=-0.026) for s in (-1, 1)], 0.009, m_cab, c_led)
    curve_obj('LED_linear_corrimao', [[(x, s * (P['rail_y'] - 0.035), deck_z(x) + P['rail_h'] - 0.04) for x in frange(-H + 0.3, H - 0.3, 1)] for s in (-1, 1)], 0.011, m_rail, c_led)

# câmera de referência: praça de Torres, altura dos olhos
cam_data = bpy.data.cameras.new('Cam_Praca_RS'); cam_data.lens = 28
cam = bpy.data.objects.new('Cam_Praca_RS', cam_data); root.objects.link(cam)
cam.location = (-68, -10, P['ground'] + 1.7)
direction = Vector((-30, 0, 9)) - cam.location; cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.unit_settings.system = 'METRIC'
print('Ponte pênsil gerada: L = %.1f m, flecha = %.2f m, %d pranchas, %d pendurais.' % (P['L'], P['tower_top'] - P['cable_low'], int(P['L'] / pitch), len(hangers)))
