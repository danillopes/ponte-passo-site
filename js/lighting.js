// =====================================================================
//  Motor luminotécnico — catálogo LED, montagens, fotometria e cálculo
//  Luzes em unidades físicas (three.js r165): SpotLight.intensity = candela (cd)
//  Emissores (fitas, lentes) renderizados com luminância real (cd/m² = nits)
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, H, deckY, cableY, cablePolyline, polyTube, stairSteps } from './model.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const TYPES = {
  strip:      { nome: 'Fita LED neon flex 24 V', curto: 'Neon flex', linear: true, w: 0.012, r: 0.009, p: [0.25, 30, 0.25], unit: 'W/m', beams: [120, 160], eff: 90, ip: 'IP67', desc: 'Perfil de silicone difuso 12 × 20 mm, preso com clipes inox. Lido como linha contínua de luz.' },
  linearRail: { nome: 'Perfil linear para corrimão', curto: 'Linear de corrimão', linear: true, w: 0.010, r: 0.011, p: [0.1, 20, 0.05], unit: 'W/m', beams: [20, 30, 40, 60, 90], eff: 85, ip: 'IP66', desc: 'Perfil de alumínio sob o corrimão, lente assimétrica voltada ao piso. Não ofusca quem caminha.' },
  flood:      { nome: 'Projetor LED orientável', curto: 'Projetor', linear: false, a: 0.018, p: [10, 300, 5], unit: 'W', beams: [6, 10, 15, 25, 40, 60, 90], eff: 120, ip: 'IP66', housing: 'flood', desc: 'Corpo de alumínio, vidro temperado e suporte em U. Para lavar torres e destacar cabos.' },
  washer:     { nome: 'Wall washer linear 300 mm', curto: 'Wall washer', linear: false, a: 0.009, p: [6, 48, 2], unit: 'W', beams: [10, 15, 30, 45, 60], eff: 105, ip: 'IP66', housing: 'washer', desc: 'Barra linear com lente elíptica. Lava faces de pilares, vigas e a face inferior do tabuleiro.' },
  inground:   { nome: 'Embutido de solo (uplight)', curto: 'Embutido de solo', linear: false, a: 0.008, p: [3, 36, 1], unit: 'W', beams: [6, 10, 15, 24, 36, 60], eff: 95, ip: 'IP67', housing: 'inground', desc: 'Corpo inox 316, vidro 12 mm transitável. Rasante nas pernas das torres.' },
  dot:        { nome: 'Ponto de luz pixel Ø 50 mm', curto: 'Pixel', linear: false, a: 0.00196, p: [0.5, 6, 0.25], unit: 'W', beams: [30, 60, 120], eff: 80, ip: 'IP67', housing: 'dot', desc: 'Domo difuso endereçável (DMX/SPI) com abraçadeira para cabo ou pendural.' },
  spot:       { nome: 'Spot de facho super estreito', curto: 'Super spot', linear: false, a: 0.0079, p: [10, 80, 5], unit: 'W', beams: [3, 4, 6, 8, 10, 15], eff: 90, ip: 'IP66', housing: 'spot', desc: 'Óptica de longo alcance (até ~150 m) para topos de torre e pontos distantes.' },
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
    nome: 'Torres — de baixo para cima', icon: '▲', types: ['flood', 'inground', 'spot', 'washer'],
    params: [{ k: 'aimH', l: 'Altura do alvo na torre', min: 3, max: 14, step: 0.5, def: 12, u: 'm' }, { k: 'faces', l: 'Faces iluminadas', type: 'select', opts: [['rio', 'Só a face do rio'], ['ambas', 'Rio e terra']], def: 'ambas' }, { k: 'dist', l: 'Afastamento da base', min: 0.2, max: 6, step: 0.1, def: 1.2, u: 'm' }],
    points: (g) => {
      const out = [];
      for (const s of [-1, 1]) for (const z of [-P.legZ, P.legZ]) for (const f of g.params.faces === 'ambas' ? [-s, s] : [-s]) {
        const p = V(s * H() + f * (P.legHXb + g.params.dist), P.ground + 0.06, z);
        const t = V(s * H() + f * P.legHXt * 0.7, P.ground + g.params.aimH, z);
        out.push({ p, d: t.sub(p).normalize(), s: out.length });
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
    nome: 'Cais — projetores mirando a ponte', icon: '◢', types: ['flood', 'spot'],
    params: [{ k: 'qty', l: 'Projetores por margem', min: 1, max: 6, step: 1, def: 2 }, { k: 'aimDist', l: 'Alvo: distância a partir da torre', min: 0, max: 50, step: 1, def: 22, u: 'm' }, { k: 'aimY', l: 'Alvo: cota', min: 0, max: 15, step: 0.5, def: 8, u: 'm' }],
    points: (g) => {
      const out = [];
      for (const s of [-1, 1]) for (let i = 0; i < g.params.qty; i++) {
        const z = (i % 2 ? 1 : -1) * (7 + Math.floor(i / 2) * 6);
        const p = V(s * (P.quayX + 1.2), P.ground + 0.35, z), t = V(s * (H() - g.params.aimDist), g.params.aimY, 0);
        out.push({ p, d: t.sub(p).normalize(), s: out.length });
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
    nome: 'Avulsas (posição livre)', icon: '✛', types: ['flood', 'washer', 'inground', 'dot', 'spot', 'bollard'],
    params: [],
    points: (g) => (g.fixtures || []).map((f, i) => ({ p: V(...f.p), d: V(...f.d).normalize(), s: i })),
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
  if (g.effOverride) return g.effOverride;
  const T = TYPES[g.type];
  if (g.colorMode === 'cct') return Math.round(T.eff * (0.86 + 0.14 * Math.min(1, (g.cct - 1800) / 2200)));
  const Y = luminanceY(groupColor(g));
  return Math.round(T.eff * (0.32 + 0.68 * Math.pow(Y, 0.6)));
}
export const solidAngle = (beamDeg) => 2 * Math.PI * (1 - Math.cos(Math.min(beamDeg, 179) * Math.PI / 360));
/** Fitas/perfis: facho transversal × 120° longitudinal → Ω ≈ 4·asin(sin hT · sin hL). */
export const LONG_HALF = 60 * Math.PI / 180;
export const solidAngleOf = (g) => TYPES[g.type].linear ? 4 * Math.asin(Math.sin(Math.min(g.beam, 179) * Math.PI / 360) * Math.sin(LONG_HALF)) : solidAngle(g.beam);
export const emitArea = (g) => { const T = TYPES[g.type]; return T.linear ? T.w : T.a; };
/** Fluxo por luminária (lm) ou por metro (lm/m). */
export const fluxUnit = (g) => g.power * efficacy(g) * g.dim / 100;
export const candela = (g) => fluxUnit(g) / solidAngleOf(g);
/** Luminância da superfície emissora (nits = cd/m²). */
export const nitsOf = (g) => fluxUnit(g) / (solidAngleOf(g) * emitArea(g));
export const powerForNits = (g, nits) => nits * solidAngleOf(g) * emitArea(g) / (efficacy(g) * g.dim / 100);

// ---------------------------------------------------------------------
//  Material emissor (fitas e lentes) com efeitos dinâmicos
// ---------------------------------------------------------------------
export function emitterMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uMode: { value: 0 }, uSpeed: { value: 1 }, uLambda: { value: 8 } }]),
    vertexShader: `#include <fog_pars_vertex>
      attribute float aS; varying float vS;
      void main(){ vS = aS; vec4 p = vec4(position,1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix*p;
      #endif
        vec4 mvPosition = modelViewMatrix*p; gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      uniform vec3 uColor; uniform float uTime, uMode, uSpeed, uLambda; varying float vS;
      vec3 hsv(float h){ vec3 k = clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); return k; }
      void main(){
        float f = 1.0; vec3 col = uColor; float ph = vS/uLambda - uTime*uSpeed;
        if (uMode > 0.5 && uMode < 1.5) f = 0.55 + 0.45*sin(3.14159*uTime*uSpeed);
        else if (uMode > 1.5 && uMode < 2.5) f = 0.5 + 0.5*sin(6.28318*ph);
        else if (uMode > 2.5 && uMode < 3.5) { float q = fract(ph); f = q < 0.18 ? 1.0 : 0.03; }
        else if (uMode > 3.5) { vec3 h = hsv(fract(ph*0.5)); float Y = dot(h, vec3(0.2126,0.7152,0.0722)); float L = dot(uColor, vec3(0.2126,0.7152,0.0722)); col = min(h/max(Y,0.05)*L, vec3(60000.0)); }
        gl_FragColor = vec4(col*f, 1.0);
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
};
const housingMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.6 });

// ---------------------------------------------------------------------
//  Rig: monta luzes + emissores de cada grupo
// ---------------------------------------------------------------------
export class LightRig {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'Iluminacao_LED'; scene.add(this.root);
    this.rt = new Map(); this.shadows = false; this.budgetScale = 1;
  }
  clear(id) {
    const r = this.rt.get(id); if (!r) return;
    r.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== housingMat) o.material.dispose(); if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose(); });
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
    const flux = fluxUnit(g), I0 = candela(g), half = g.beam * Math.PI / 360;
    const nits = nitsOf(g);
    const emitCol = cNorm.clone().multiplyScalar(Math.min(nits, 60000));
    ['r', 'g', 'b'].forEach(k => { emitCol[k] = Math.min(emitCol[k], 60000); });
    const emat = emitterMaterial(); emat.uniforms.uColor.value.copy(emitCol);
    emat.uniforms.uMode.value = EFFECT_ID[g.effect] || 0; emat.uniforms.uSpeed.value = g.speed; emat.uniforms.uLambda.value = g.lambda;
    rt.emitMats.push(emat);
    const visible = g.on;
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
        sm.forEach((o, i) => { const a = sm[Math.max(0, i - 1)].p, b = sm[Math.min(sm.length - 1, i + 1)].p; const t = b.clone().sub(a); if (t.lengthSq() < 1e-8) t.copy(pts[pts.length - 1]).sub(pts[0]); rt.elems.push({ p: o.p, d: l.dir, I: I0 * 0.5, half, t: t.normalize(), c: cNorm }); });
      });
      if (geos.length) { const m = new THREE.Mesh(mergeGeometries(geos), emat); m.name = 'Emissor_linear'; obj.add(m); }
      rt.count = lines.length;
      // luzes representativas distribuídas pelo comprimento total
      const total = rt.length, nLights = Math.min(nL, Math.max(1, Math.round(total / 0.5)));
      const per = flux * total / nLights;
      for (let i = 0; i < nLights; i++) {
        const target = (i + 0.5) * total / nLights; let acc = 0;
        for (const l of lines) {
          if (target <= acc + l._len) { const loc = locate(l._pts, target - acc); this.addLight(rt, obj, loc, l.dir, per, g, colS, cNorm, l._base + (target - acc), Math.max(g.beam, 100)); break; }
          acc += l._len;
        }
      }
    } else {
      const pts = M.points ? M.points(g) : [];
      rt.count = pts.length;
      if (pts.length) {
        const hs = (HOUSINGS[T.housing] || HOUSINGS.flood)();
        const body = new THREE.InstancedMesh(hs.body, housingMat, pts.length);
        const lens = new THREE.InstancedMesh(hs.lens, emat, pts.length);
        const aS = new Float32Array(pts.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = V(1, 1, 1), Z = V(0, 0, 1);
        pts.forEach((f, i) => { q.setFromUnitVectors(Z, f.d); m.compose(f.p, q, one); body.setMatrixAt(i, m); lens.setMatrixAt(i, m); aS[i] = f.s ?? i; });
        lens.geometry.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 1));
        body.castShadow = false; body.name = 'Corpo_luminaria'; lens.name = 'Lente';
        obj.add(body, lens);
        pts.forEach(f => rt.elems.push({ p: f.p, d: f.d, I: I0, half, c: cNorm }));
        // agrega luminárias em nL luzes
        const n = Math.min(nL, pts.length), chunk = pts.length / n;
        for (let i = 0; i < n; i++) {
          const a = Math.floor(i * chunk), b = Math.floor((i + 1) * chunk), sub = pts.slice(a, b);
          const p = V(0, 0, 0), d = V(0, 0, 0); sub.forEach(f => { p.add(f.p); d.add(f.d); });
          p.multiplyScalar(1 / sub.length); d.normalize();
          this.addLight(rt, obj, p.add(d.clone().multiplyScalar(0.05)), d, flux * sub.length, g, colS, cNorm, sub[Math.floor(sub.length / 2)].s ?? i);
        }
      }
    }
    return rt;
  }
  addLight(rt, obj, p, d, fluxTotal, g, colS, cNorm, s, beamOverride) {
    const beam = beamOverride || g.beam, I = fluxTotal / solidAngle(beam);
    const L = new THREE.SpotLight(0xffffff, I, 0, Math.min(beam * Math.PI / 360 * 1.15, Math.PI / 2 * 0.98), 0.45, 2);
    L.color.copy(cNorm);
    L.position.copy(p); L.target.position.copy(p).add(d.clone().multiplyScalar(5));
    obj.add(L, L.target);
    rt.lights.push({ light: L, I, s, base: cNorm.clone() });
  }
  applyShadows() {
    let used = 0;
    for (const [, rt] of this.rt) for (const l of rt.lights) {
      const want = this.shadows && rt.obj.visible && used < 8 && l.light.angle < 0.6;
      if (want) used++;
      l.light.castShadow = want;
      if (want) { l.light.shadow.mapSize.set(1024, 1024); l.light.shadow.bias = -0.0004; l.light.shadow.camera.near = 0.2; l.light.shadow.camera.far = 160; }
    }
  }
  animate(groups, t) {
    for (const g of groups) {
      const rt = this.rt.get(g.id); if (!rt || !g.on) continue;
      rt.emitMats.forEach(m => { m.uniforms.uTime.value = t; });
      if (g.effect === 'estatico') continue;
      for (const l of rt.lights) {
        l.light.intensity = l.I * effectFactor(g, l.s, t);
        if (g.effect === 'arcoiris') { const c = rainbowColor(g, l.s, t); const Y = Math.max(luminanceY(c), 0.03); l.light.color.copy(c).multiplyScalar(1 / Y); }
      }
    }
  }
  stats(groups) {
    let W = 0, lm = 0, units = 0; const rows = [];
    for (const g of groups) {
      const rt = this.rt.get(g.id); if (!rt || !g.on) continue;
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

// ---------------------------------------------------------------------
//  Malha de cálculo — iluminância horizontal no piso (lux)
// ---------------------------------------------------------------------
export function computeGrid(rig, groups, dx = 0.5, nz = 5) {
  const xs = [], zs = [];
  for (let x = -H() + dx / 2; x < H(); x += dx) xs.push(x);
  for (let j = 0; j < nz; j++) zs.push(-0.65 + 1.3 * j / (nz - 1));
  const E = new Float32Array(xs.length * nz), RGB = new Float32Array(xs.length * nz * 3);
  const elems = [];
  for (const g of groups) { if (!g.on) continue; const rt = rig.rt.get(g.id); if (rt) elems.push(...rt.elems); }
  const q = V(), v = V();
  for (let i = 0; i < xs.length; i++) {
    const y = deckY(xs[i]);
    for (let j = 0; j < nz; j++) {
      q.set(xs[i], y, zs[j]); let e = 0;
      for (const el of elems) {
        if (el.p.y < y + 0.02) continue;
        v.subVectors(q, el.p); const d2 = v.lengthSq(); if (d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        let I;
        if (el.t) {
          const vt = v.x * el.t.x + v.y * el.t.y + v.z * el.t.z;
          const thL = Math.asin(Math.min(1, Math.abs(vt) / d));
          const px = v.x - el.t.x * vt, py = v.y - el.t.y * vt, pz = v.z - el.t.z * vt, pl = Math.hypot(px, py, pz) || 1e-6;
          const thT = Math.acos(Math.max(-1, Math.min(1, (px * el.d.x + py * el.d.y + pz * el.d.z) / pl)));
          I = el.I * soft(thT, el.half) * soft(thL, LONG_HALF);
        } else {
          const th = Math.acos(Math.max(-1, Math.min(1, (v.x * el.d.x + v.y * el.d.y + v.z * el.d.z) / d)));
          I = el.I * soft(th, el.half);
        }
        if (I <= 0) continue;
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

/** NBR 5101 — classes de iluminação para vias de pedestres (referência). */
export const NBR5101 = [
  { c: 'P1', Em: 20, U0: 0.3, uso: 'Grande fluxo de pedestres, áreas de destaque' },
  { c: 'P2', Em: 10, U0: 0.25, uso: 'Fluxo médio (passarelas urbanas)' },
  { c: 'P3', Em: 5, U0: 0.2, uso: 'Fluxo baixo' },
  { c: 'P4', Em: 3, U0: 0.2, uso: 'Fluxo muito baixo' },
];
