// =====================================================================
//  Motor luminotécnico — catálogo LED, montagens, fotometria e cálculo
//  Luzes em unidades físicas (three.js r165): SpotLight.intensity = candela (cd)
//  Emissores (fitas, lentes) renderizados com luminância real (cd/m² = nits)
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, H, deckY, cableY, cablePolyline, polyTube, stairSteps } from './model.js';
import { sampleI, tiltFactor } from './photometry.js';

/** Camadas: iluminação funcional (piso, circulação) × cênica (arquitetura, cor, efeitos). */
export const LAYERS = { funcional: true, cenica: true };
export const ROLE_DEFAULT = { cable: 'cenica', handrail: 'funcional', hangers: 'cenica', towerUp: 'cenica', towerTop: 'funcional', underDeck: 'cenica', quay: 'cenica', postFoot: 'funcional', faceLight: 'funcional', stairs: 'funcional', custom: 'funcional' };
export const roleOf = (g) => g.role || ROLE_DEFAULT[g.mount] || 'cenica';
export const isOn = (g) => !!g.on && LAYERS[roleOf(g)] !== false;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------
//  Perfil angular real nos shaders: luzes com distance > 19999 usam
//  núcleo gaussiano (meia-abertura h = penumbraCos) + anel + espalhamento
//  até coneCos; anel e espalhamento vão codificados na própria distância.
//  (A atenuação continua 1/d²; o corte em ~35 km não interfere.)
// ---------------------------------------------------------------------
{
  const A = 'float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );';
  const src = THREE.ShaderChunk.lights_pars_begin;
  // desempenho: luz spot que chega com menos de 0,02 lx (ou fora do cone) não entra no BRDF
  const VIS = 'light.visible = ( light.color != vec3( 0.0 ) );', at = src.indexOf('void getSpotLightInfo');
  const src2 = at < 0 ? src : src.slice(0, at) + src.slice(at).replace(VIS, 'light.visible = max( light.color.r, max( light.color.g, light.color.b ) ) > 0.02;');
  const fb = THREE.ShaderChunk.lights_fragment_begin, a0 = fb.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'), b0 = fb.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
  if (a0 >= 0 && b0 > a0) THREE.ShaderChunk.lights_fragment_begin = fb.slice(0, a0) + fb.slice(a0, b0).replace('RE_Direct( directLight,', 'if ( directLight.visible ) RE_Direct( directLight,') + fb.slice(b0);
  if (src2.includes(A)) THREE.ShaderChunk.lights_pars_begin = src2.replace(A, `float spotAttenuation;
		if ( spotLight.distance > 19999.0 ) {
			float th = acos( clamp( angleCos, -1.0, 1.0 ) ), thS = acos( spotLight.coneCos ), hh = max( acos( spotLight.penumbraCos ), 1e-3 );
			float kk = spotLight.distance - 20000.0, sp = floor( kk / 1000.0 ) / 1000.0, rg = ( kk - floor( kk / 1000.0 ) * 1000.0 ) / 1000.0;
			float q = th / hh, w = ( th - 2.6 * hh ) / ( 0.7 * hh );
			spotAttenuation = th < thS ? exp( -0.693147 * q * q ) + rg * exp( -w * w ) + sp * pow( max( 0.0, 1.0 - th / thS ), 1.5 ) : 0.0;
		} else spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );`);
}

export const TYPES = {
  strip:      { nome: 'Fita LED neon flex 24 V', curto: 'Neon flex', linear: true, w: 0.012, r: 0.009, p: [0.25, 30, 0.25], unit: 'W/m', beams: [120, 160], eff: 90, ip: 'IP67', desc: 'Perfil de silicone difuso 12 × 20 mm, preso com clipes inox. Lido como linha contínua de luz.' },
  linearRail: { nome: 'Perfil linear para corrimão', curto: 'Linear de corrimão', linear: true, w: 0.010, r: 0.011, p: [0.1, 20, 0.05], unit: 'W/m', beams: [20, 30, 40, 60, 90], eff: 85, ip: 'IP66', desc: 'Perfil de alumínio sob o corrimão, lente assimétrica voltada ao piso. Não ofusca quem caminha.' },
  flood:      { nome: 'Projetor LED orientável', curto: 'Projetor', linear: false, a: 0.018, p: [10, 300, 5], unit: 'W', beams: [6, 10, 15, 25, 40, 60, 90], eff: 120, ip: 'IP66', housing: 'flood', desc: 'Corpo de alumínio, vidro temperado e suporte em U. Para lavar torres e destacar cabos.' },
  washer:     { nome: 'Wall washer linear 300 mm', curto: 'Wall washer', linear: false, a: 0.009, p: [6, 48, 2], unit: 'W', beams: [10, 15, 30, 45, 60], eff: 105, ip: 'IP66', housing: 'washer', desc: 'Barra linear com lente elíptica. Lava faces de pilares, vigas e a face inferior do tabuleiro.' },
  inground:   { nome: 'Embutido de solo (uplight)', curto: 'Embutido de solo', linear: false, a: 0.008, p: [3, 36, 1], unit: 'W', beams: [6, 10, 15, 24, 36, 60], eff: 95, ip: 'IP67', housing: 'inground', desc: 'Corpo inox 316, vidro 12 mm transitável. Rasante nas pernas das torres.' },
  dot:        { nome: 'Ponto de luz pixel Ø 50 mm', curto: 'Pixel', linear: false, a: 0.00196, p: [0.5, 6, 0.25], unit: 'W', beams: [30, 60, 120], eff: 80, ip: 'IP67', housing: 'dot', desc: 'Domo difuso endereçável (DMX/SPI) com abraçadeira para cabo ou pendural.' },
  spot:       { nome: 'Spot de facho super estreito', curto: 'Super spot', linear: false, a: 0.0079, p: [10, 80, 5], unit: 'W', beams: [3, 4, 6, 8, 10, 15], eff: 90, ip: 'IP66', housing: 'spot', desc: 'Óptica de longo alcance (até ~150 m) para topos de torre e pontos distantes.' },
  proj10:     { nome: 'Projetor LED 10 W foco fechado (fachada externa)', curto: 'Projetor 10 W foco fechado', linear: false, a: 0.0016, p: [5, 20, 1], unit: 'W', beams: [5, 8, 12], eff: 80, ip: 'IP66', housing: 'proj10', prof: { ring: 0.05, spill: 0.012, S: 50 }, desc: 'Corpo cilíndrico aletado de alumínio (≈ 13 × 7 cm), anel frontal, lente colimadora em domo e suporte em U. Facho fechado: núcleo estreito, halo fraco em anel e um leve espalhamento em V junto à lente, como na foto do produto. Curva estimada (~80 lm/W, sem .ies do fabricante).' },
  bollard:    { nome: 'Balizador de rodapé / degrau', curto: 'Balizador', linear: false, a: 0.0012, p: [1, 8, 0.5], unit: 'W', beams: [40, 60, 90, 120], eff: 80, ip: 'IP65', housing: 'bollard', desc: 'Pequeno embutido com facho rasante voltado ao piso. Marca o caminho sem ofuscar.' },
};

export const EFFECTS = [['estatico', 'Estático'], ['respira', 'Respiração'], ['onda', 'Onda'], ['corrida', 'Corrida (chase)'], ['arcoiris', 'Arco-íris']];
const EFFECT_ID = { estatico: 0, respira: 1, onda: 2, corrida: 3, arcoiris: 4 };

// ---------------------------------------------------------------------
//  Montagens (onde as luminárias ficam na ponte)
// ---------------------------------------------------------------------
const hangerXs = (every = 1) => { const out = []; for (let k = 1; k < P.L / P.hangerStep; k++) if ((k - 1) % every === 0) out.push(-H() + k * P.hangerStep); return out; };
function sampleLine(pts, spacing) {
  const out = []; let acc = spacing / 2, s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = a.distanceTo(b);
    while (acc <= len) { out.push({ p: a.clone().lerp(b, acc / len), s: s + acc }); acc += spacing; }
    acc -= len; s += len;
  }
  return out;
}

export const MOUNTS = {
  cable: {
    nome: 'Cabos principais', icon: '⌒', types: ['strip', 'dot'],
    params: [{ k: 'back', l: 'Incluir estais de ancoragem', type: 'bool', def: true }, { k: 'spacing', l: 'Espaçamento dos pixels', min: 0.25, max: 4, step: 0.25, def: 1, u: 'm', only: 'point' }],
    lines: (g) => [-1, 1].map(s => ({ pts: cablePolyline(s * (P.cableZ + P.cableGap / 2), g.params.back, -0.026), dir: V(0, -1, 0) })),
    points: (g) => MOUNTS.cable.lines(g).flatMap(l => sampleLine(l.pts, g.params.spacing).map(o => ({ p: o.p, d: V(0, -1, 0), s: o.s }))),
  },
  handrail: {
    nome: 'Corrimão (luz para o piso)', icon: '═', types: ['linearRail', 'strip'],
    params: [{ k: 'tilt', l: 'Inclinação para o centro', min: 0, max: 60, step: 1, def: 25, u: '°' }],
    lines: (g) => [-1, 1].map(s => {
      const pts = []; for (let x = -H() + 0.3; x <= H() - 0.3 + 1e-6; x += 1) pts.push(V(x, deckY(x) + P.railH - 0.04, s * (P.railZ - 0.035)));
      const t = g.params.tilt * Math.PI / 180; return { pts, dir: V(0, -Math.cos(t), -s * Math.sin(t)) };
    }),
  },
  hangers: {
    nome: 'Pendurais', icon: '┆', types: ['dot', 'strip'],
    params: [{ k: 'every', l: 'Usar 1 a cada N pendurais', min: 1, max: 6, step: 1, def: 1 }, { k: 'h', l: 'Altura no pendural (0 = base, 1 = topo)', min: 0, max: 1, step: 0.05, def: 1, only: 'point' }],
    points: (g) => hangerXs(g.params.every).flatMap((x, i) => [-1, 1].map(s => {
      const top = cableY(x) - 0.08, bot = deckY(x) - 0.1;
      return { p: V(x, bot + (top - bot) * g.params.h, s * (P.cableZ + 0.03)), d: V(0, -1, 0), s: i * P.hangerStep * g.params.every };
    })),
    lines: (g) => hangerXs(g.params.every).flatMap(x => [-1, 1].map(s => ({ pts: [V(x, deckY(x) + 0.05, s * (P.cableZ + 0.014)), V(x, cableY(x) - 0.1, s * (P.cableZ + 0.014))], dir: V(0, -0.35, -s).normalize(), s0: x + H() }))),
  },
  towerUp: {
    nome: 'Torres — de baixo para cima', icon: '▲', types: ['flood', 'inground', 'spot', 'washer', 'proj10'],
    params: [{ k: 'aimH', l: 'Altura do alvo na torre', min: 3, max: 14, step: 0.5, def: 12, u: 'm' }, { k: 'faces', l: 'Faces iluminadas', type: 'select', opts: [['rio', 'Só a face do rio'], ['ambas', 'Rio e terra']], def: 'ambas' }, { k: 'dist', l: 'Afastamento da base', min: 0.2, max: 6, step: 0.1, def: 1.2, u: 'm' }],
    points: (g) => {
      const out = [];
      for (const s of [-1, 1]) for (const z of [-P.legZ, P.legZ]) for (const f of g.params.faces === 'ambas' ? [-s, s] : [-s]) {
        const p = V(s * H() + f * (P.legHXb + g.params.dist), P.ground + 0.06, z);
        const t = V(s * H() + f * P.legHXt * 0.7, P.ground + g.params.aimH, z);
        out.push({ p, d: t.sub(p).normalize(), s: out.length, n: V(0, 1, 0) });
      }
      return out;
    },
  },
  towerTop: {
    nome: 'Pórtico — sob a viga superior', icon: '⊓', types: ['washer', 'flood', 'spot'],
    params: [{ k: 'tilt', l: 'Inclinação para fora', min: 0, max: 80, step: 1, def: 10, u: '°' }],
    points: (g) => {
      const out = [], t = g.params.tilt * Math.PI / 180;
      for (const s of [-1, 1]) for (const f of [-1, 1]) out.push({ p: V(s * H() + f * 0.42, P.towerTop - 1.15, 0), d: V(f * Math.sin(t), -Math.cos(t), 0), s: out.length });
      return out;
    },
  },
  underDeck: {
    nome: 'Sob o tabuleiro (reflexo na água)', icon: '▽', types: ['washer', 'flood', 'strip', 'dot'],
    params: [{ k: 'spacing', l: 'Espaçamento', min: 1, max: 12, step: 1, def: 4, u: 'm', only: 'point' }, { k: 'tilt', l: 'Inclinação para fora', min: 0, max: 80, step: 1, def: 15, u: '°' }],
    points: (g) => {
      const out = [], t = g.params.tilt * Math.PI / 180;
      for (let x = -P.quayX + g.params.spacing / 2; x <= P.quayX; x += g.params.spacing)
        for (const s of [-1, 1]) out.push({ p: V(x, deckY(x) - 0.42, s * 1.05), d: V(0, -Math.cos(t), s * Math.sin(t)), s: x + H() });
      return out;
    },
    lines: (g) => [-1, 1].map(s => {
      const pts = [], t = g.params.tilt * Math.PI / 180; for (let x = -P.quayX; x <= P.quayX + 1e-6; x += 1) pts.push(V(x, deckY(x) - 0.4, s * 1.24));
      return { pts, dir: V(0, -Math.cos(t), s * Math.sin(t)) };
    }),
  },
  quay: {
    nome: 'Cais — projetores mirando a ponte', icon: '◢', types: ['flood', 'spot', 'proj10'],
    params: [{ k: 'qty', l: 'Projetores por margem', min: 1, max: 6, step: 1, def: 2 }, { k: 'aimDist', l: 'Alvo: distância a partir da torre', min: 0, max: 50, step: 1, def: 22, u: 'm' }, { k: 'aimY', l: 'Alvo: cota', min: 0, max: 15, step: 0.5, def: 8, u: 'm' }],
    points: (g) => {
      const out = [];
      for (const s of [-1, 1]) for (let i = 0; i < g.params.qty; i++) {
        const z = (i % 2 ? 1 : -1) * (7 + Math.floor(i / 2) * 6);
        const p = V(s * (P.quayX + 1.2), P.ground + 0.35, z), t = V(s * (H() - g.params.aimDist), g.params.aimY, 0);
        out.push({ p, d: t.sub(p).normalize(), s: out.length, n: V(0, 1, 0) });
      }
      return out;
    },
  },
  postFoot: {
    nome: 'Rodapé do guarda-corpo', icon: '⊥', types: ['bollard', 'dot'],
    params: [{ k: 'every', l: 'Usar 1 a cada N montantes', min: 1, max: 5, step: 1, def: 1 }],
    points: (g) => {
      const out = [];
      for (let k = 1; k < P.L / P.postStep; k += g.params.every) {
        const x = -H() + k * P.postStep;
        for (const s of [-1, 1]) out.push({ p: V(x + 0.06, deckY(x) + 0.25, s * (P.railZ - 0.045)), d: V(0, -0.75, -s * 0.66).normalize(), s: x + H() });
      }
      return out;
    },
  },
  faceLight: {
    nome: 'Reconhecimento facial — luz longitudinal', icon: '⇆', types: ['bollard', 'washer', 'flood'],
    params: [{ k: 'spacing', l: 'Espaçamento entre pares', min: 10, max: 30, step: 2, def: 20, u: 'm' }, { k: 'down', l: 'Inclinação para o piso', min: 5, max: 35, step: 1, def: 14, u: '°' }],
    points: (g) => {
      const out = [], a = g.params.down * Math.PI / 180;
      const xs = [-H() + 1];
      for (let x = -H() + 10; x <= H() - 10 + 1e-6; x += g.params.spacing) xs.push(x);
      xs.push(H() - 1);
      for (const x of [...new Set(xs.map(v => +v.toFixed(3)))]) {
        for (const s of [-1, 1]) {
          const dirX = s < 0 ? 1 : -1;
          out.push({
            p: V(x - dirX * 0.45, deckY(x) + 0.88, s * (P.railZ - 0.05)),
            d: V(dirX * Math.cos(a), -Math.sin(a), -s * 0.22).normalize(),
            s: x + H() + (s > 0 ? 0.5 : 0),
          });
        }
      }
      return out;
    },
  },
  stairs: {
    nome: 'Escadas das cabeceiras', icon: '⌐', types: ['bollard', 'strip'],
    params: [{ k: 'every', l: '1 balizador a cada N degraus', min: 1, max: 6, step: 1, def: 3, only: 'point' }],
    points: (g) => {
      const out = [], n = stairSteps(), rise = (P.deckEnd - P.ground) / n;
      for (const s of [-1, 1]) for (let k = 1; k < n; k += g.params.every) for (const z of [-0.79, 0.79]) {
        const x = s * (H() + P.landing + (k + 0.5) * P.stairRun), y = P.deckEnd - (k + 1) * rise;
        out.push({ p: V(x, y + 0.3, z), d: V(0, -0.7, -Math.sign(z) * 0.7).normalize(), s: k });
      }
      return out;
    },
    lines: () => {
      const out = [], n = stairSteps();
      for (const s of [-1, 1]) for (const z of [-0.8, 0.8])
        out.push({ pts: [V(s * (H() - 0.5), P.deckEnd + 0.25, z), V(s * (H() + P.landing), P.deckEnd + 0.25, z), V(s * (H() + P.landing + n * P.stairRun), P.ground + 0.25, z)], dir: V(0, -0.7, -Math.sign(z) * 0.7).normalize() });
      return out;
    },
  },
  custom: {
    nome: 'Avulsas (posição livre)', icon: '✛', types: ['proj10', 'flood', 'spot', 'washer', 'inground', 'dot', 'bollard'],
    params: [],
    points: (g) => (g.fixtures || []).map((f, i) => ({ p: V(...f.p), d: V(...f.d).normalize(), s: i, n: f.n ? V(...f.n).normalize() : null, i })),
  },
};

// ---------------------------------------------------------------------
//  Cor e fotometria
// ---------------------------------------------------------------------
/** CCT (K) → cor sRGB (aprox. Tanner Helland). */
export function cctToSRGB(K) {
  const t = K / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}
export const luminanceY = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
export function groupColor(g) {
  return g.colorMode === 'cct' ? cctToSRGB(g.cct) : new THREE.Color().setStyle(g.rgb, THREE.SRGBColorSpace);
}
/** Eficácia efetiva (lm/W): LEDs coloridos rendem menos lúmens por watt. */
export function efficacy(g) {
  if (g.photo && g.photo.watts > 0) return Math.round(g.photo.flux / g.photo.watts);
  if (g.effOverride) return g.effOverride;
  const T = TYPES[g.type];
  if (g.colorMode === 'cct') return Math.round(T.eff * (0.86 + 0.14 * Math.min(1, (g.cct - 1800) / 2200)));
  const Y = luminanceY(groupColor(g));
  return Math.round(T.eff * (0.32 + 0.68 * Math.pow(Y, 0.6)));
}
export const solidAngle = (beamDeg) => 2 * Math.PI * (1 - Math.cos(Math.min(beamDeg, 179) * Math.PI / 360));
/** Perfil do projetor de foco fechado: I(θ)/I0 = núcleo gaussiano (FWHM = facho) + anel + espalhamento. */
export function profOf(g) {
  const T = TYPES[g.type]; if (!T || !T.prof || g.photo) return null;
  return { h: beamOf(g) * Math.PI / 360, ring: T.prof.ring, spill: T.prof.spill, S: T.prof.S * Math.PI / 180 };
}
export function profF(pr, th) {
  if (th >= pr.S) return 0;
  const q = th / pr.h, w = (th - 2.6 * pr.h) / (0.7 * pr.h);
  return Math.exp(-0.693147 * q * q) + pr.ring * Math.exp(-w * w) + pr.spill * Math.pow(Math.max(0, 1 - th / pr.S), 1.5);
}
/** Ângulo sólido equivalente Ω = ∫ f(θ) dΩ (fluxo = I0 · Ω). */
export function profOmega(pr) {
  let s = 0; const n = 600, d = pr.S / n;
  for (let i = 0; i < n; i++) { const th = (i + 0.5) * d; s += profF(pr, th) * Math.sin(th) * d; }
  return 2 * Math.PI * s;
}
/** Fitas/perfis: facho transversal × 120° longitudinal → Ω ≈ 4·asin(sin hT · sin hL). */
export const LONG_HALF = 60 * Math.PI / 180;
export const beamOf = (g) => g.photo ? Math.round(g.photo.beam) : g.beam;
export const photoLen = (g) => Math.max(0.1, g.photo?.lenM || 1);
export const solidAngleOf = (g) => g.photo ? solidAngle(g.photo.beam) : profOf(g) ? profOmega(profOf(g)) : TYPES[g.type].linear ? 4 * Math.asin(Math.sin(Math.min(g.beam, 179) * Math.PI / 360) * Math.sin(LONG_HALF)) : solidAngle(g.beam);
export const emitArea = (g) => { const T = TYPES[g.type]; return T.linear ? T.w : T.a; };
/** Fluxo por luminária (lm) ou por metro (lm/m). */
export const fluxUnit = (g) => g.photo ? g.photo.flux / (TYPES[g.type].linear ? photoLen(g) : 1) * g.dim / 100 : g.power * efficacy(g) * g.dim / 100;
export const candela = (g) => g.photo ? g.photo.Imax / (TYPES[g.type].linear ? photoLen(g) : 1) * g.dim / 100 : fluxUnit(g) / solidAngleOf(g);
/** Luminância da superfície emissora (nits = cd/m²). */
export const nitsOf = (g) => candela(g) / emitArea(g);
export const powerForNits = (g, nits) => nits * solidAngleOf(g) * emitArea(g) / (efficacy(g) * g.dim / 100);

const PHOTO_MAPS = new WeakMap();
/** Cookie projetado no SpotLight para que a prévia siga a distribuição C/γ do IES/LDT. */
function photometryMap(ph, rot = 0, halfDeg = 85) {
  let maps = PHOTO_MAPS.get(ph); if (!maps) { maps = new Map(); PHOTO_MAPS.set(ph, maps); }
  const key = `${rot}:${Math.round(halfDeg * 10)}`; if (maps.has(key)) return maps.get(key);
  const N = 128, data = new Uint8Array(N * N * 4), tanHalf = Math.tan(halfDeg * Math.PI / 180);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v), k = (y * N + x) * 4;
    let q = 0;
    if (r <= 1) {
      const gamma = Math.atan(r * tanHalf) * 180 / Math.PI;
      const C = Math.atan2(v, u) * 180 / Math.PI + rot;
      q = Math.min(1, sampleI(ph, C, gamma) / Math.max(ph.Imax, 1e-6));
    }
    const c = Math.round(q * 255); data[k] = data[k + 1] = data[k + 2] = c; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false; tex.needsUpdate = true;
  maps.set(key, tex); return tex;
}

// ---------------------------------------------------------------------
//  Material emissor (fitas e lentes) com efeitos dinâmicos
// ---------------------------------------------------------------------
const PROF_GLSL = `float profF(vec4 pr, float th){ if (th >= pr.w) return 0.0; float q = th/pr.x, w = (th - 2.6*pr.x)/(0.7*pr.x);
  return exp(-0.693147*q*q) + pr.y*exp(-w*w) + pr.z*pow(max(0.0, 1.0 - th/pr.w), 1.5); }`;
export function emitterMaterial(pr = null) {
  return new THREE.ShaderMaterial({
    fog: true,
    // lente de projetor: soma luz ao vidro/refletor por trás (de dia aparece o corpo, à noite o brilho)
    ...(pr ? { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } : {}),
    defines: pr ? { USE_PROF: '' } : {},
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uMode: { value: 0 }, uSpeed: { value: 1 }, uLambda: { value: 8 }, uProf: { value: pr ? new THREE.Vector4(pr.h, pr.ring, pr.spill, pr.S) : new THREE.Vector4() } }]),
    vertexShader: `#include <fog_pars_vertex>
      attribute float aS; varying float vS; varying float vF; uniform vec4 uProf;
      ${PROF_GLSL}
      void main(){ vS = aS; vF = 1.0; vec4 p = vec4(position,1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix*p;
      #endif
      #ifdef USE_PROF
        // lente vista de lado brilha pouco: luminância aparente segue a curva I(θ)
        { vec4 wp = modelMatrix*p; vec3 ax = vec3(0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          ax = mat3(instanceMatrix)*ax;
        #endif
          ax = normalize(mat3(modelMatrix)*ax);
          float c = dot(ax, normalize(cameraPosition - wp.xyz));
          vF = profF(uProf, acos(clamp(c, -1.0, 1.0))) + 0.004; }
      #endif
        vec4 mvPosition = modelViewMatrix*p; gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      uniform vec3 uColor; uniform float uTime, uMode, uSpeed, uLambda; varying float vS; varying float vF;
      vec3 hsv(float h){ vec3 k = clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); return k; }
      void main(){
        float f = 1.0; vec3 col = uColor; float ph = vS/uLambda - uTime*uSpeed;
        if (uMode > 0.5 && uMode < 1.5) f = 0.55 + 0.45*sin(3.14159*uTime*uSpeed);
        else if (uMode > 1.5 && uMode < 2.5) f = 0.5 + 0.5*sin(6.28318*ph);
        else if (uMode > 2.5 && uMode < 3.5) { float q = fract(ph); f = q < 0.18 ? 1.0 : 0.03; }
        else if (uMode > 3.5) { vec3 h = hsv(fract(ph*0.5)); float Y = dot(h, vec3(0.2126,0.7152,0.0722)); float L = dot(uColor, vec3(0.2126,0.7152,0.0722)); col = min(h/max(Y,0.05)*L, vec3(60000.0)); }
        gl_FragColor = vec4(col*f*vF, 1.0);
        #include <fog_fragment>
      }`,
  });
}
export function effectFactor(g, s, t) {
  const ph = s / g.lambda - t * g.speed;
  switch (g.effect) {
    case 'respira': return 0.55 + 0.45 * Math.sin(Math.PI * t * g.speed);
    case 'onda': return 0.5 + 0.5 * Math.sin(2 * Math.PI * ph);
    case 'corrida': { const q = ph - Math.floor(ph); return q < 0.18 ? 1 : 0.03; }
    default: return 1;
  }
}
const _hsv = new THREE.Color();
export function rainbowColor(g, s, t) {
  const ph = (s / g.lambda - t * g.speed) * 0.5; return _hsv.setHSL(ph - Math.floor(ph), 1, 0.5, THREE.LinearSRGBColorSpace);
}

// ---------------------------------------------------------------------
//  Corpos das luminárias
// ---------------------------------------------------------------------
const HOUSINGS = {
  flood:    () => ({ body: new THREE.BoxGeometry(0.26, 0.22, 0.08).translate(0, 0, -0.045), lens: new THREE.BoxGeometry(0.2, 0.16, 0.004) }),
  washer:   () => ({ body: new THREE.BoxGeometry(0.32, 0.07, 0.07).translate(0, 0, -0.04), lens: new THREE.BoxGeometry(0.29, 0.03, 0.004) }),
  inground: () => ({ body: new THREE.CylinderGeometry(0.08, 0.08, 0.05, 20).rotateX(Math.PI / 2).translate(0, 0, -0.028), lens: new THREE.CylinderGeometry(0.05, 0.05, 0.004, 20).rotateX(Math.PI / 2) }),
  dot:      () => ({ body: new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12).rotateX(Math.PI / 2).translate(0, 0, -0.012), lens: new THREE.SphereGeometry(0.025, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2) }),
  spot:     () => ({ body: new THREE.CylinderGeometry(0.06, 0.07, 0.2, 16).rotateX(Math.PI / 2).translate(0, 0, -0.105), lens: new THREE.CylinderGeometry(0.05, 0.05, 0.004, 16).rotateX(Math.PI / 2) }),
  bollard:  () => ({ body: new THREE.BoxGeometry(0.09, 0.05, 0.03).translate(0, 0, -0.016), lens: new THREE.BoxGeometry(0.06, 0.02, 0.003) }),
  // Projetor 10 W foco fechado: corpo Ø 70 × 130 mm aletado, anel frontal frisado, lente em domo, suporte em U
  proj10: () => {
    const parts = [];
    const cyl = (r0, r1, len, z, seg = 24) => new THREE.CylinderGeometry(r1, r0, len, seg).rotateX(Math.PI / 2).translate(0, 0, z);
    parts.push(cyl(0.028, 0.03, 0.095, -0.025));                 // corpo
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, f = new THREE.BoxGeometry(0.0025, 0.007, 0.075).translate(0, 0.0335, -0.03); f.rotateZ(a); parts.push(f); } // aletas
    parts.push(cyl(0.035, 0.035, 0.016, 0.03)); parts.push(cyl(0.0355, 0.0355, 0.003, 0.025)); parts.push(cyl(0.0355, 0.0355, 0.003, 0.035)); // anel frisado
    parts.push(cyl(0.02, 0.026, 0.012, -0.078)); parts.push(cyl(0.005, 0.005, 0.025, -0.095, 8)); // tampa traseira e prensa-cabo
    parts.push(cyl(0.029, 0.029, 0.004, 0.036, 24)); // fundo espelhado atrás da lente (visível de dia)
    const body = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
    const lens = new THREE.SphereGeometry(0.027, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.45).translate(0, 0, 0.038);
    // suporte em U: base no plano local XZ (Y = normal da superfície), braços até o eixo de giro (y = 0,075)
    const br = [new THREE.BoxGeometry(0.06, 0.004, 0.035).translate(0, 0.002, 0),
      new THREE.BoxGeometry(0.004, 0.075, 0.02).translate(0.042, 0.0375, 0), new THREE.BoxGeometry(0.004, 0.075, 0.02).translate(-0.042, 0.0375, 0),
      new THREE.BoxGeometry(0.088, 0.004, 0.02).translate(0, 0.004, 0),
      new THREE.CylinderGeometry(0.007, 0.007, 0.092, 10).rotateZ(Math.PI / 2).translate(0, 0.075, 0)];
    const bracket = mergeGeometries(br.map(p => p.index ? p.toNonIndexed() : p));
    return { body, lens, bracket, pivot: 0.075 };
  },
};
const housingMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.6 });
const housingGrey = new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.42, metalness: 0.7 }); // alumínio cinza (projetor 10 W)

// ---------------------------------------------------------------------
//  Facho visível no ar (espalhamento simples na névoa/maresia)
//  Radiância L = σ ∫ I0·f(θ)·p(φ) / r² ds, integrada no cone (cd/m² = nits)
// ---------------------------------------------------------------------
const BEAM_GEO = (alpha) => new THREE.ConeGeometry(Math.tan(alpha), 1, 28, 1, false).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
function beamMaterial(pr, col, hazeU) {
  return new THREE.ShaderMaterial({
    uniforms: { uCol: { value: col }, uProf: { value: new THREE.Vector4(pr.h, pr.ring, pr.spill, pr.S) }, uHaze: hazeU, uG: { value: 0.6 }, uCosA: { value: Math.cos(pr.mesh) }, uK: { value: 1 } },
    vertexShader: `varying vec3 vW, vA, vD; varying float vL;
      void main(){ mat4 mi = modelMatrix * instanceMatrix; vec4 w = mi * vec4(position, 1.0); vW = w.xyz;
        vA = (mi * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vec3 z = mat3(mi) * vec3(0.0, 0.0, 1.0); vL = length(z); vD = z / vL;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uCol; uniform vec4 uProf; uniform float uHaze, uG, uCosA, uK; varying vec3 vW, vA, vD; varying float vL;
      ${PROF_GLSL}
      void main(){
        vec3 O = cameraPosition, R = vW - O; float t1 = length(R); R /= t1;
        vec3 CO = O - vA; float dv = dot(R, vD), dc = dot(CO, vD), c2 = uCosA * uCosA;
        float a = dv * dv - c2, b = 2.0 * (dv * dc - c2 * dot(R, CO)), c = dc * dc - c2 * dot(CO, CO);
        float t0 = 0.0, disc = b * b - 4.0 * a * c;
        if (!(dc > 0.0 && c > 0.0) && disc > 0.0 && abs(a) > 1e-6) { float sq = sqrt(disc), r1 = min((-b - sq) / (2.0 * a), (-b + sq) / (2.0 * a)); if (r1 > 0.0 && r1 < t1) t0 = r1; }
        float seg = t1 - t0; if (seg <= 1e-4) discard;
        const int N = 16; float dt = seg / float(N);
        float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        float g2 = uG * uG, sum = 0.0;
        for (int i = 0; i < N; i++) {
          vec3 v = O + R * (t0 + (float(i) + j) * dt) - vA; float ax = dot(v, vD);
          if (ax <= 0.0 || ax > vL) continue;
          float r2 = max(dot(v, v), 0.0025), rl = sqrt(r2);
          float ph = (1.0 - g2) / (12.566371 * pow(1.0 + g2 - 2.0 * uG * dot(v / rl, -R), 1.5));
          sum += profF(uProf, acos(clamp(ax / rl, -1.0, 1.0))) * ph / r2;
        }
        gl_FragColor = vec4(uCol * (uK * uHaze * sum * dt), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false, toneMapped: false,
  });
}

// ---------------------------------------------------------------------
//  Rig: monta luzes + emissores de cada grupo
// ---------------------------------------------------------------------
export class LightRig {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'Iluminacao_LED'; scene.add(this.root);
    this.rt = new Map(); this.shadows = false; this.budgetScale = 1;
    this.maps = 0; this.haze = { value: 0 }; this.occluders = []; this.ray = new THREE.Raycaster();
  }
  clear(id) {
    const r = this.rt.get(id); if (!r) return;
    this.maps = Math.max(0, this.maps - (r.maps || 0));
    r.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== housingMat && o.material !== housingGrey) o.material.dispose(); if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose(); });
    this.root.remove(r.obj); this.rt.delete(id);
  }
  rebuildAll(groups) { for (const id of [...this.rt.keys()]) this.clear(id); groups.forEach(g => this.build(g)); this.applyShadows(); }
  build(g) {
    this.clear(g.id);
    const T = TYPES[g.type], M = MOUNTS[g.mount];
    const obj = new THREE.Group(); obj.name = 'LED_' + g.name.replace(/\W+/g, '_');
    const rt = { obj, lights: [], elems: [], count: 0, length: 0, emitMats: [] };
    this.rt.set(g.id, rt); this.root.add(obj);
    if (!T || !M) return rt;
    const colS = groupColor(g), col = colS.clone(); // linear
    const Y = Math.max(luminanceY(col), 0.03);
    const cNorm = col.clone().multiplyScalar(1 / Y);
    const flux = fluxUnit(g), I0 = candela(g), half = beamOf(g) * Math.PI / 360;
    const ph = g.photo || null, phBaseScale = ph ? (g.dim / 100) * (T.linear ? 0.5 / photoLen(g) : 1) : 0, phRot = g.photoRot ? 90 : 0;
    const pr = profOf(g);
    const nits = nitsOf(g);
    const emitCol = cNorm.clone().multiplyScalar(Math.min(nits, 60000));
    ['r', 'g', 'b'].forEach(k => { emitCol[k] = Math.min(emitCol[k], 60000); });
    const emat = emitterMaterial(pr); emat.uniforms.uColor.value.copy(emitCol);
    emat.uniforms.uMode.value = EFFECT_ID[g.effect] || 0; emat.uniforms.uSpeed.value = g.speed; emat.uniforms.uLambda.value = g.lambda;
    rt.emitMats.push(emat);
    const visible = isOn(g);
    obj.visible = visible;
    const nL = Math.max(1, g._alloc ?? Math.round(g.nLights * this.budgetScale));

    if (T.linear) {
      const lines = M.lines ? M.lines(g) : [];
      const geos = []; let offset = 0;
      lines.forEach(l => {
        const pts = l.pts.length > 2 ? l.pts : densify(l.pts, 0.5);
        const geo = polyTube(pts, T.r, 6);
        const aS = geo.attributes.aS; const base = l.s0 !== undefined ? l.s0 : offset;
        for (let i = 0; i < aS.count; i++) aS.setX(i, aS.getX(i) + base);
        geos.push(geo);
        let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
        l._len = len; l._pts = pts; l._base = base; offset += len; rt.length += len;
        // elementos para cálculo: 0,5 m
        const sm = sampleLine(pts, 0.5);
        sm.forEach((o, i) => { const a = sm[Math.max(0, i - 1)].p, b = sm[Math.min(sm.length - 1, i + 1)].p; const t = b.clone().sub(a); if (t.lengthSq() < 1e-8) t.copy(pts[pts.length - 1]).sub(pts[0]); t.normalize(); const phScale = phBaseScale * tiltFactor(ph, Math.acos(Math.max(-1, Math.min(1, -l.dir.y))) * 180 / Math.PI); rt.elems.push({ p: o.p, d: l.dir, I: I0 * 0.5, half, t, c: cNorm, ph, phScale, phRot, r: refAxis(l.dir, t) }); });
      });
      if (geos.length) { const m = new THREE.Mesh(mergeGeometries(geos), emat); m.name = 'Emissor_linear'; obj.add(m); }
      rt.count = lines.length;
      // luzes representativas distribuídas pelo comprimento total
      const total = rt.length, nLights = Math.min(nL, Math.max(1, Math.round(total / 0.5)));
      const per = flux * total / nLights;
      for (let i = 0; i < nLights; i++) {
        const target = (i + 0.5) * total / nLights; let acc = 0;
        for (const l of lines) {
          if (target <= acc + l._len) { const loc = locate(l._pts, target - acc); this.addLight(rt, obj, loc, l.dir, per, g, colS, cNorm, l._base + (target - acc), Math.max(beamOf(g), 100), refAxis(l.dir, V(1, 0, 0))); break; }
          acc += l._len;
        }
      }
    } else {
      const pts = M.points ? M.points(g) : [];
      rt.count = pts.length;
      if (pts.length) {
        const hs = (HOUSINGS[T.housing] || HOUSINGS.flood)();
        const body = new THREE.InstancedMesh(hs.body, T.housing === 'proj10' ? housingGrey : housingMat, pts.length);
        const lens = new THREE.InstancedMesh(hs.lens, emat, pts.length);
        const aS = new Float32Array(pts.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = V(1, 1, 1), Z = V(0, 0, 1);
        pts.forEach((f, i) => { q.setFromUnitVectors(Z, f.d); m.compose(f.p, q, one); body.setMatrixAt(i, m); lens.setMatrixAt(i, m); aS[i] = f.s ?? i; });
        lens.geometry.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 1));
        body.castShadow = false; body.name = 'Corpo_luminaria'; lens.name = 'Lente';
        body.userData.gid = lens.userData.gid = g.id; body.userData.pts = lens.userData.pts = pts;
        obj.add(body, lens);
        // suporte em U preso à superfície (normal n), girando no eixo perpendicular à mira
        if (hs.bracket && pts.some(f => f.n)) {
          const bp = pts.filter(f => f.n), br = new THREE.InstancedMesh(hs.bracket, housingGrey, bp.length), bx = V(), bz = V(), mb = new THREE.Matrix4();
          bp.forEach((f, i) => {
            bx.crossVectors(f.n, f.d); if (bx.lengthSq() < 1e-6) bx.set(1, 0, 0).cross(f.n); if (bx.lengthSq() < 1e-6) bx.set(0, 0, 1);
            bx.normalize(); bz.crossVectors(bx, f.n).normalize();
            mb.makeBasis(bx, f.n, bz); mb.setPosition(f.p.clone().addScaledVector(f.n, -hs.pivot)); br.setMatrixAt(i, mb);
          });
          br.name = 'Corpo_luminaria'; br.userData.gid = g.id; obj.add(br);
        }
        pts.forEach(f => { const phScale = phBaseScale * tiltFactor(ph, Math.acos(Math.max(-1, Math.min(1, -f.d.y))) * 180 / Math.PI); rt.elems.push({ p: f.p, d: f.d, I: I0, half, c: cNorm, ph, phScale, phRot, r: refAxis(f.d, null), prof: pr }); });
        // facho visível no ar: projetores e spots de facho ≤ 30°
        if (this.haze.value > 0 && (pr || (!ph && beamOf(g) <= 30))) {
          const vp = pr ? { ...pr, mesh: Math.min(pr.S, pr.h * 3.6) } : { h: half * 0.9, ring: 0, spill: 0, S: half * 1.35, mesh: half * 1.35 };
          const beams = new THREE.InstancedMesh(BEAM_GEO(vp.mesh), beamMaterial(vp, cNorm.clone().multiplyScalar(I0), this.haze), Math.min(pts.length, 80));
          const mb = new THREE.Matrix4();
          pts.slice(0, 80).forEach((f, i) => {
            let L = 150;
            if (this.occluders.length) { this.ray.set(f.p.clone().addScaledVector(f.d, 0.12), f.d); this.ray.far = 150; const h = this.ray.intersectObjects(this.occluders, true).find(x => x.object.visible); if (h) L = h.distance + 0.12; }
            q.setFromUnitVectors(Z, f.d); mb.compose(f.p.clone().addScaledVector(f.d, 0.04), q, V(L, L, L)); beams.setMatrixAt(i, mb);
          });
          beams.name = 'Facho_volumetrico'; beams.layers.set(1); beams.frustumCulled = false; beams.renderOrder = 4;
          obj.add(beams); rt.beams = beams;
        }
        // agrega luminárias em nL luzes
        const n = Math.min(nL, pts.length), chunk = pts.length / n;
        for (let i = 0; i < n; i++) {
          const a = Math.floor(i * chunk), b = Math.floor((i + 1) * chunk), sub = pts.slice(a, b);
          const p = V(0, 0, 0), d = V(0, 0, 0); sub.forEach(f => { p.add(f.p); d.add(f.d); });
          p.multiplyScalar(1 / sub.length); d.normalize();
          this.addLight(rt, obj, p.add(d.clone().multiplyScalar(0.05)), d, flux * sub.length, g, colS, cNorm, sub[Math.floor(sub.length / 2)].s ?? i, null, refAxis(d, null));
        }
      }
    }
    return rt;
  }
  addLight(rt, obj, p, d, fluxTotal, g, colS, cNorm, s, beamOverride, rAxis) {
    const ph = g.photo || null, count = fluxTotal / Math.max(fluxUnit(g), 1e-6);
    const field = ph ? Math.max(ph.beam || 4, ph.field || ph.beam || 4) : (beamOverride || beamOf(g));
    const halfDeg = Math.min(89, field * 0.5 * (ph ? 1.02 : 1.15));
    const tilt = Math.acos(Math.max(-1, Math.min(1, -d.y))) * 180 / Math.PI;
    const pr = ph || beamOverride ? null : profOf(g);
    const I = ph ? candela(g) * count * tiltFactor(ph, tilt) : pr ? fluxTotal / profOmega(pr) : fluxTotal / solidAngle(field);
    const L = new THREE.SpotLight(0xffffff, I, 0, halfDeg * Math.PI / 180, ph ? 0.02 : 0.45, 2);
    if (pr) {
      // perfil real no shader (ver lights_pars_begin acima)
      L.angle = Math.min(pr.S, 1.5); L.penumbra = Math.max(0, Math.min(1, 1 - pr.h / L.angle));
      L.distance = 20000 + Math.round(pr.spill * 1000) * 1000 + Math.round(pr.ring * 1000);
      L.userData.core = pr.h * 1.6; L.shadow.focus = Math.min(1, pr.h * 4 / L.angle);
    }
    L.color.copy(cNorm);
    // cada mapa ocupa uma unidade de textura no shader: no máximo 4 luzes com curva projetada
    if (ph && this.maps < 4) { L.map = photometryMap(ph, g.photoRot ? 90 : 0, halfDeg); L.up.copy(rAxis || refAxis(d, null)); this.maps++; rt.maps = (rt.maps || 0) + 1; }
    L.position.copy(p); L.target.position.copy(p).add(d.clone().multiplyScalar(5));
    obj.add(L, L.target);
    rt.lights.push({ light: L, I, s, base: cNorm.clone(), ph, field });
  }
  applyShadows() {
    let used = 0;
    for (const [, rt] of this.rt) for (const l of rt.lights) {
      const want = this.shadows && rt.obj.visible && used < 8 && (l.light.userData.core ?? l.light.angle) < 0.6;
      if (want) used++;
      l.light.castShadow = want;
      if (want) { l.light.shadow.mapSize.set(1024, 1024); l.light.shadow.bias = -0.0004; l.light.shadow.camera.near = 0.2; l.light.shadow.camera.far = 160; }
    }
  }
  animate(groups, t) {
    for (const g of groups) {
      const rt = this.rt.get(g.id); if (!rt || !isOn(g)) continue;
      rt.emitMats.forEach(m => { m.uniforms.uTime.value = t; });
      if (g.effect === 'estatico') continue;
      if (rt.beams) rt.beams.material.uniforms.uK.value = g.effect === 'arcoiris' ? 1 : effectFactor(g, 0, t);
      for (const l of rt.lights) {
        l.light.intensity = l.I * effectFactor(g, l.s, t);
        if (g.effect === 'arcoiris') { const c = rainbowColor(g, l.s, t); const Y = Math.max(luminanceY(c), 0.03); l.light.color.copy(c).multiplyScalar(1 / Y); }
      }
    }
  }
  stats(groups) {
    let W = 0, lm = 0, units = 0; const rows = [];
    for (const g of groups) {
      const rt = this.rt.get(g.id); if (!rt || !isOn(g)) continue;
      const T = TYPES[g.type], qty = T.linear ? rt.length : rt.count;
      const w = g.power * qty * g.dim / 100, f = fluxUnit(g) * qty;
      W += w; lm += f; units += T.linear ? 0 : rt.count;
      rows.push({ g, T, qty, w, f });
    }
    return { W, lm, units, rows };
  }
}
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(a.distanceTo(b) / step)); for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n)); }
  return out;
}
function locate(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) { const len = pts[i].distanceTo(pts[i - 1]); if (acc + len >= s) return pts[i - 1].clone().lerp(pts[i], (s - acc) / len); acc += len; }
  return pts[pts.length - 1].clone();
}

function refAxis(d, t) {
  if (t) return t.clone();
  const r = V(1, 0, 0).addScaledVector(d, -d.x); // eixo da ponte projetado no plano da luminária
  if (r.lengthSq() < 1e-4) r.set(0, 0, 1).addScaledVector(d, -d.z);
  return r.normalize();
}
const _b = V();
/** Intensidade (cd) do elemento na direção v (do elemento ao ponto), |v| = d. */
function intensity(el, v, d) {
  if (el.ph) {
    const cg = (v.x * el.d.x + v.y * el.d.y + v.z * el.d.z) / d;
    const gamma = Math.acos(Math.max(-1, Math.min(1, cg))) * 180 / Math.PI;
    _b.crossVectors(el.d, el.r);
    const C = Math.atan2(v.x * _b.x + v.y * _b.y + v.z * _b.z, v.x * el.r.x + v.y * el.r.y + v.z * el.r.z) * 180 / Math.PI + el.phRot;
    return sampleI(el.ph, C, gamma) * el.phScale;
  }
  if (el.prof) return el.I * profF(el.prof, Math.acos(Math.max(-1, Math.min(1, (v.x * el.d.x + v.y * el.d.y + v.z * el.d.z) / d))));
  if (el.t) {
    const vt = v.x * el.t.x + v.y * el.t.y + v.z * el.t.z;
    const thL = Math.asin(Math.min(1, Math.abs(vt) / d));
    const px = v.x - el.t.x * vt, py = v.y - el.t.y * vt, pz = v.z - el.t.z * vt, pl = Math.hypot(px, py, pz) || 1e-6;
    const thT = Math.acos(Math.max(-1, Math.min(1, (px * el.d.x + py * el.d.y + pz * el.d.z) / pl)));
    return el.I * soft(thT, el.half) * soft(thL, LONG_HALF);
  }
  const th = Math.acos(Math.max(-1, Math.min(1, (v.x * el.d.x + v.y * el.d.y + v.z * el.d.z) / d)));
  return el.I * soft(th, el.half);
}
/** Transmissão entre fonte e ponto: guarda-corpo (tela soldada ~84%, rodapé opaco) e tabuleiro. */
export const MESH_T = 0.84;
function transmission(p, q) {
  let T = 1;
  for (const s of [-1, 1]) {
    const zc = s * P.railZ, a = p.z - zc, b = q.z - zc;
    if (a * b >= 0) continue;
    const t = a / (a - b), x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
    if (Math.abs(x) > H()) continue;
    const h = y - deckY(x);
    if (h < 0.12) return 0; if (h <= P.railH) T *= MESH_T;
  }
  // fonte sob o piso não ilumina acima dele (exceto se o raio passar por fora do tabuleiro)
  if (p.y < deckY(p.x) - 0.05 && q.y > deckY(q.x) - 0.05) {
    const yd = deckY((p.x + q.x) / 2), t = (yd - p.y) / ((q.y - p.y) || 1e-6), z = p.z + (q.z - p.z) * t;
    if (Math.abs(z) < 0.85) return 0;
  }
  return T;
}
function collect(rig, groups, roles) {
  const elems = [];
  for (const g of groups) { if (!isOn(g) || (roles && !roles.includes(roleOf(g)))) continue; const rt = rig.rt.get(g.id); if (rt) elems.push(...rt.elems); }
  return elems;
}

// ---------------------------------------------------------------------
//  Malha de cálculo — iluminância horizontal no piso (lux, valores iniciais)
// ---------------------------------------------------------------------
export function computeGrid(rig, groups, opts = {}) {
  const dx = opts.dx || 0.5, nz = opts.nz || 5, roles = opts.roles || null;
  const xs = [], zs = [];
  for (let x = -H() + dx / 2; x < H(); x += dx) xs.push(x);
  for (let j = 0; j < nz; j++) zs.push(-0.65 + 1.3 * j / (nz - 1));
  const E = new Float32Array(xs.length * nz), RGB = new Float32Array(xs.length * nz * 3);
  const elems = collect(rig, groups, roles);
  const q = V(), v = V();
  for (let i = 0; i < xs.length; i++) {
    const y = deckY(xs[i]);
    for (let j = 0; j < nz; j++) {
      q.set(xs[i], y, zs[j]); let e = 0;
      for (const el of elems) {
        if (el.p.y < y + 0.02) continue;
        v.subVectors(q, el.p); const d2 = v.lengthSq(); if (d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        let I = intensity(el, v, d); if (I <= 0) continue;
        I *= transmission(el.p, q); if (I <= 0) continue;
        const ci = (el.p.y - y) / d, ee = I * ci / d2; e += ee;
        if (el.c) { const k = (i * nz + j) * 3; RGB[k] += ee * el.c.r; RGB[k + 1] += ee * el.c.g; RGB[k + 2] += ee * el.c.b; }
      }
      E[i * nz + j] = e;
    }
  }
  let sum = 0, mn = Infinity, mx = 0; for (const e of E) { sum += e; mn = Math.min(mn, e); mx = Math.max(mx, e); }
  const Em = sum / E.length;
  return { E, RGB, xs, zs, nx: xs.length, nz, Em, Emin: mn, Emax: mx, U0: Em > 0 ? mn / Em : 0 };
}

/** Iluminância vertical a 1,50 m no eixo, nos dois sentidos de caminhada (pior caso por ponto). */
export function computeVertical(rig, groups, opts = {}) {
  const roles = opts.roles || null, elems = collect(rig, groups, roles), q = V(), v = V();
  const vals = [];
  for (let x = -H() + 1; x < H(); x += 1) {
    q.set(x, deckY(x) + 1.5, 0); let ep = 0, en = 0;
    for (const el of elems) {
      v.subVectors(q, el.p); const d2 = v.lengthSq(); if (d2 < 1e-4) continue;
      const d = Math.sqrt(d2);
      let I = intensity(el, v, d); if (I <= 0) continue;
      I *= transmission(el.p, q); if (I <= 0) continue;
      const cx = -v.x / d; // cosseno entre a direção da fonte e a normal ±X do plano vertical
      if (cx > 0) ep += I * cx / d2; else en += I * -cx / d2;
    }
    vals.push(Math.min(ep, en));
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { Evmin: Math.min(...vals), Evavg: avg, n: vals.length };
}

function soft(th, half) { if (th <= half) return 1; if (th < half * 1.3) return 1 - (th - half) / (half * 0.3); return 0; }
/** Escala de falsa cor (lux, log). */
const STOPS = [[0, [8, 8, 40]], [0.5, [30, 40, 150]], [1, [0, 120, 220]], [2, [0, 190, 200]], [5, [40, 200, 90]], [10, [200, 220, 40]], [20, [255, 160, 20]], [50, [240, 40, 30]], [100, [255, 230, 230]]];
export function falseColor(e) {
  if (e <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    if (e <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const t = a === 0 ? e / b : (Math.log(e) - Math.log(a)) / (Math.log(b) - Math.log(a));
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
export const FALSE_STOPS = STOPS;

/**
 * Critérios por classe de pedestres. A NBR 5101:2024 não está em acesso aberto; estes valores
 * são uma REFERÊNCIA PROVISÓRIA (EN 13201-2, classes P1–P6: Ē mantida e Emin mantida) e devem
 * ser conferidos e, se preciso, editados na aba Cálculo conforme o texto oficial da norma.
 */
export const CRITERIA_REF = [
  { c: 'P1', Em: 15, Emin: 3.0 }, { c: 'P2', Em: 10, Emin: 2.0 }, { c: 'P3', Em: 7.5, Emin: 1.5 },
  { c: 'P4', Em: 5, Emin: 1.0 }, { c: 'P5', Em: 3, Emin: 0.6 }, { c: 'P6', Em: 2, Emin: 0.4 },
];
