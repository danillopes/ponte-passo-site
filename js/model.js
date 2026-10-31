// =====================================================================
//  Ponte Pênsil do Rio Mampituba — modelo paramétrico (Three.js)
//  Unidades: metros. Eixos: X = eixo da ponte (−X Torres/RS, +X Passo de Torres/SC),
//  Y = vertical (Y = 0 no nível médio da água), Z = transversal (rio corre em Z).
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const P = {
  L: 100,            // vão entre eixos das torres (m)
  W: 1.5,            // largura livre do passeio (m)
  deckEnd: 5.2,      // cota do piso nas torres (m acima d'água)
  camber: 0.8,       // contraflecha do tabuleiro no meio do vão (m)
  ground: 1.6,       // cota das praças/cais (m)
  quayX: 44,         // face do cais (|x|) — rio com ~88 m entre cais
  towerTop: 14.5,    // cota do ponto de apoio do cabo (sela) (m)
  cableLow: 7.45,    // cota do cabo no meio do vão (m)  → flecha 7,05 m (≈ L/14)
  cableZ: 1.2,       // afastamento dos cabos em relação ao eixo (m)
  cableR: 0.019,     // raio do cabo (Ø 38 mm)
  cableGap: 0.10,    // 2 cabos por lado, lado a lado
  hangerStep: 2.0,   // espaçamento dos pendurais (m)
  hangerR: 0.008,    // Ø 16 mm
  plankW: 0.15, plankGap: 0.012, plankT: 0.045, plankLen: 1.70,
  stringerZ: 0.60, transStep: 1.0, transLen: 2.6,
  railH: 1.20, railZ: 0.82, postStep: 2.0,
  legZ: 1.55, legHZ: 0.25, legHXb: 0.75, legHXt: 0.35,
  anchorDist: 14, landing: 1.4, stairRun: 0.28,
};
export const H = () => P.L / 2;
export const deckY = (x) => P.deckEnd + P.camber * (1 - Math.pow(2 * x / P.L, 2));
export const deckSlope = (x) => -8 * P.camber * x / (P.L * P.L);
export const cableY = (x) => { const u = 2 * x / P.L; return P.cableLow + (P.towerTop - P.cableLow) * u * u; };
export const stairSteps = () => Math.round((P.deckEnd - P.ground) / 0.18);

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AX = V(1, 0, 0), AY = V(0, 1, 0);

// ---------- aleatório determinístico ----------
export function rng(seed = 7) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- texturas procedurais ----------
function canvasTex(w, h, draw, { srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noise(g, w, h, n, col, a0, a1, r, rnd) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${col},${a0 + rnd() * (a1 - a0)})`;
    const s = 0.5 + rnd() * r; g.fillRect(rnd() * w, rnd() * h, s, s);
  }
}
// ruído de valor 2D periódico (para texturas que repetem sem emenda)
function makeNoise(seed) {
  const r = rng(seed), N = 256, perm = new Uint8Array(512), val = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; val[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const sm = (t) => t * t * (3 - 2 * t);
  const n2 = (x, y, px, py) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X0 = ((xi % px) + px) % px, Y0 = ((yi % py) + py) % py, X1 = (X0 + 1) % px, Y1 = (Y0 + 1) % py;
    const h = (a, b) => val[perm[(perm[a & 255] + b) & 255]];
    const u = sm(xf), v = sm(yf);
    return (h(X0, Y0) * (1 - u) + h(X1, Y0) * u) * (1 - v) + (h(X0, Y1) * (1 - u) + h(X1, Y1) * u) * v;
  };
  return (x, y, px = 256, py = 256, oct = 4) => { let s = 0, a = 0.5, f = 1, t = 0; for (let o = 0; o < oct; o++) { s += a * n2(x * f, y * f, px * f, py * f); t += a; a *= 0.5; f *= 2; } return s / t; };
}
/** Mapa de normais (espaço tangente) a partir de um mapa de altura periódico. */
function normalTex(hgt, w, h, strength) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xl = hgt[y * w + (x + w - 1) % w], xr = hgt[y * w + (x + 1) % w], yu = hgt[((y + h - 1) % h) * w + x], yd = hgt[((y + 1) % h) * w + x];
    let nx = (xl - xr) * strength, ny = (yd - yu) * strength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (y * w + x) * 4; d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (ny * 0.5 + 0.5) * 255; d[k + 2] = (nz * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
/** Textura a partir de arrays por pixel (cor sRGB 0–1 ou escalar em todos os canais). */
function arrTex(w, h, fn, srgb) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fn(x, y), k = (y * w + x) * 4; d[k] = v[0] * 255; d[k + 1] = v[1] * 255; d[k + 2] = v[2] * 255; d[k + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * Atlas de pranchas: 4 colunas × 3 linhas = 12 pranchas diferentes.
 * Cada célula = uma prancha inteira (0,15 m × 1,70 m) → ~850 px/m na largura e ~300 px/m no comprimento.
 * Inclui veios, fendas, cantos arredondados, parafusos com halo de ferrugem, desgaste no centro
 * (onde se pisa) e umidade/limo nas pontas (junto ao guarda-corpo).
 */
function woodAtlas() {
  const CW = 128, CH = 512, W = CW * 4, Hh = CH * 3, r = rng(31), nz = makeNoise(5);
  const col = new Float32Array(W * Hh * 3), hgt = new Float32Array(W * Hh), rough = new Float32Array(W * Hh);
  const cells = [];
  for (let i = 0; i < 12; i++) cells.push({ tone: 0.82 + r() * 0.26, red: r() * 0.08, grey: 0.25 + r() * 0.5, ring: 7 + r() * 9, ph: r() * 10, ph2: r() * 10,
    knots: Array.from({ length: r() < 0.6 ? 1 + (r() * 2 | 0) : 0 }, () => ({ u: 0.2 + r() * 0.6, v: 0.1 + r() * 0.8, s: 0.6 + r() * 0.8 })),
    cracks: Array.from({ length: r() * 3 | 0 }, () => ({ u: 0.15 + r() * 0.7, v0: r() * 0.3, v1: 0.4 + r() * 0.6 })) });
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const ci = Math.floor(x / CW) + 4 * Math.floor(y / CH), c = cells[ci];
    const u = (x % CW) / CW, v = (y % CH) / CH;
    let wob = 0.15 * Math.sin(v * 6 + c.ph) + 0.05 * Math.sin(v * 23 + c.ph2);
    for (const k of c.knots) { const du = (u - k.u) / 0.08, dv = (v - k.v) / 0.03; const d2 = du * du + dv * dv; wob += 0.25 * k.s * Math.exp(-d2) * Math.sign(du || 1); }
    const ring = 0.5 + 0.5 * Math.sin((u * c.ring + wob) * Math.PI * 2);
    const late = Math.pow(ring, 6), fib = nz(x * 0.9, y * 0.06, 512 * 0.9, 1536 * 0.06, 3);
    let H = 0.5 - 0.18 * late + 0.12 * (fib - 0.5);
    // cantos arredondados (≈3 mm) e topos
    const edge = Math.min(u, 1 - u) * 150, end = Math.min(v, 1 - v) * 1700;
    H -= 0.35 * (1 - sm(0, 3, edge)) + 0.35 * (1 - sm(0, 4, end));
    // fendas ao longo do veio
    let crack = 0; for (const k of c.cracks) if (v > k.v0 && v < k.v1) crack = Math.max(crack, 1 - sm(0.002, 0.006, Math.abs(u - k.u - 0.01 * Math.sin(v * 40))));
    H -= 0.4 * crack;
    // nós
    let knot = 0; for (const k of c.knots) { const du = (u - k.u) / 0.05, dv = (v - k.v) / 0.016; knot = Math.max(knot, Math.exp(-(du * du + dv * dv))); }
    // parafusos: 2 por longarina (longarinas a ±0,60 m → v = 0,147 e 0,853)
    let screw = 0, rust = 0;
    for (const sv of [0.147, 0.853]) for (const su of [0.3, 0.7]) { const du = (u - su) * 150, dv = (v - sv) * 1700, d = Math.hypot(du, dv); if (d < 6) screw = 1; rust = Math.max(rust, Math.exp(-((d - 4) ** 2) / 60) * (dv > 0 ? 1.6 : 0.6)); }
    if (screw) H = 0.42;
    // uso: centro (onde se pisa) mais claro e liso; pontas úmidas, escuras, com limo
    const wear = 1 - sm(0.12, 0.3, Math.abs(v - 0.5)), damp = 1 - sm(0.03, 0.14, Math.min(v, 1 - v)), blot = nz(x * 0.05, y * 0.02, 512 * 0.05, 1536 * 0.02, 3);
    // cor: marrom tratado → cinza prateado de intempérie
    let R = 0.43, G = 0.33, B = 0.24;
    const gry = Math.min(1, c.grey + 0.25 * wear);
    R = R * (1 - gry) + 0.55 * gry; G = G * (1 - gry) + 0.52 * gry; B = B * (1 - gry) + 0.48 * gry;
    const t = c.tone * (0.9 + 0.2 * blot) * (1 - 0.35 * late) * (1 - 0.25 * knot) * (1 + 0.1 * wear);
    R = R * t + c.red; G *= t; B *= t;
    const dk = 1 - 0.35 * damp; R *= dk * 0.92; G *= dk; B *= dk * 0.9;
    R = R * (1 - 0.5 * crack); G = G * (1 - 0.5 * crack); B = B * (1 - 0.5 * crack);
    if (rust > 0.05) { const k = Math.min(0.6, rust * 0.35); R = R * (1 - k) + 0.45 * k; G = G * (1 - k) + 0.22 * k; B = B * (1 - k) + 0.1 * k; }
    if (screw) { R = 0.32; G = 0.3; B = 0.28; }
    const i = y * W + x;
    col[i * 3] = Math.min(1, R); col[i * 3 + 1] = Math.min(1, G); col[i * 3 + 2] = Math.min(1, B);
    hgt[i] = H;
    rough[i] = screw ? 0.45 : Math.min(1, 0.86 - 0.2 * wear - 0.12 * damp + 0.08 * late + 0.1 * crack);
  }
  const map = arrTex(W, Hh, (x, y) => { const i = (y * W + x) * 3; return [col[i], col[i + 1], col[i + 2]]; }, true);
  const normal = normalTex(hgt, W, Hh, 5);
  const rmap = arrTex(W, Hh, (x, y) => { const v = rough[y * W + x]; return [v, v, v]; }, false);
  return { map, normal, rough: rmap };
}
/** Concreto pintado: 512 px = 2,0 m (256 px/m). Poros, variação de pintura e juntas de fôrma a cada 0,60 m. */
function concreteTex() {
  const W = 512, nz = makeNoise(9), hgt = new Float32Array(W * W);
  const cols = [];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const big = nz(x / 64, y / 64, 8, 8, 4), fine = nz(x / 3, y / 3, W / 3 | 0, W / 3 | 0, 2);
    const pore = fine > 0.78 ? (fine - 0.78) * 4 : 0;
    const joint = Math.exp(-(((y % 154) - 77) ** 2) / 1.5) * 0.6; // 0,60 m
    hgt[y * W + x] = 0.5 + 0.08 * (big - 0.5) - 0.5 * pore + 0.25 * joint;
    const t = 0.9 + 0.12 * (big - 0.5) - 0.25 * pore;
    cols.push(t);
  }
  const map = arrTex(W, W, (x, y) => { const t = cols[y * W + x]; return [0.86 * t, 0.85 * t, 0.82 * t]; }, true);
  return { map, normal: normalTex(hgt, W, W, 3), rough: arrTex(W, W, (x, y) => { const v = 0.82 + 0.12 * (cols[y * W + x] - 0.9); return [v, v, v]; }, false) };
}
/** Galvanizado ("spangle") e pintura: variação de rugosidade em placas de 1–3 cm. */
function spangleTex(seed, base, amp) {
  const W = 256, r = rng(seed), pts = Array.from({ length: 90 }, () => [r() * W, r() * W, r()]), nz = makeNoise(seed + 1);
  return arrTex(W, W, (x, y) => {
    let best = 1e9, v = 0;
    for (const p of pts) { let dx = Math.abs(x - p[0]), dy = Math.abs(y - p[1]); dx = Math.min(dx, W - dx); dy = Math.min(dy, W - dy); const d = dx * dx + dy * dy; if (d < best) { best = d; v = p[2]; } }
    const k = Math.min(1, Math.max(0, base + amp * (v - 0.5) + 0.06 * (nz(x / 16, y / 16, 16, 16, 3) - 0.5))); return [k, k, k];
  }, false);
}
export function makeTextures() {
  const r = rng(11);
  const woodA = woodAtlas(), conc = concreteTex();
  const wood = woodA.map, concrete = conc.map;
  const pavers = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6f675e'; g.fillRect(0, 0, w, h);
    const bw = 32, bh = 16;
    for (let y = 0; y < h; y += bh) for (let x = -(y / bh % 2) * bw / 2; x < w; x += bw) {
      const t = 0.85 + r() * 0.3; const c = [150 * t, 132 * t, 118 * t].map(Math.round);
      g.fillStyle = `rgb(${c})`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
    noise(g, w, h, 3000, '40,35,30', 0.03, 0.1, 2, r);
  });
  const asphalt = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3b3c3e'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 12000, '200,200,200', 0.02, 0.12, 1.6, r);
  });
  const grass = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4c5a35'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 14000, '90,110,55', 0.1, 0.4, 2, r);
    noise(g, w, h, 6000, '40,45,25', 0.1, 0.3, 2, r);
  });
  // tela soldada 50×50 mm (1 célula por repetição)
  const mesh = canvasTex(32, 32, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h);
  }, { srgb: false });
  // fachada: janelas (mapa de cor + emissivo)
  const winCols = 4, winRows = 4;
  const facade = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c9c6bf'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 3000, '90,90,90', 0.02, 0.08, 2, r);
    for (let i = 0; i < winCols; i++) for (let j = 0; j < winRows; j++) {
      g.fillStyle = '#2b3440'; g.fillRect(12 + i * 64, 14 + j * 64, 40, 36);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(12 + i * 64, 14 + j * 64, 40, 3);
    }
  });
  const windowsEm = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < winCols; i++) for (let j = 0; j < winRows; j++) {
      if (r() < 0.3) {
        const warm = r() < 0.8;
        g.fillStyle = warm ? `rgb(255,${175 + r() * 45 | 0},${105 + r() * 45 | 0})` : 'rgb(235,232,225)';
        g.globalAlpha = 0.4 + r() * 0.6; g.fillRect(12 + i * 64, 14 + j * 64, 40, 36); g.globalAlpha = 1;
      }
    }
  });
  return { wood, woodN: woodA.normal, woodR: woodA.rough, concrete, concN: conc.normal, concR: conc.rough, galvR: spangleTex(41, 0.38, 0.35), paintR: spangleTex(43, 0.45, 0.18), pavers, asphalt, grass, mesh, facade, windowsEm };
}

/** Mapa de luz do piso: iluminância RGB (lux) calculada para todas as luminárias. */
export const deckLight = (() => {
  const nx = 200, nz = 5;
  const tex = new THREE.DataTexture(new Uint16Array(nx * nz * 4), nx, nz, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return { tex, nx, nz, uniform: { value: tex } };
})();
function deckLitWood(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.deckE = deckLight.uniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDeckW; varying float vDeckUp;\n#ifdef USE_INSTANCING\nattribute vec3 aAtlas;\n#endif')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_INSTANCING
          vec2 au = vMapUv; if (aAtlas.z > 0.5) au = vec2(1.0) - au;
          vMapUv = (au + aAtlas.xy) * vec2(0.25, 1.0 / 3.0);
          #ifdef USE_NORMALMAP
            vNormalMapUv = vMapUv;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = vMapUv;
          #endif
        #endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 dW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          dW = instanceMatrix*dW;
          vDeckUp = normalize(mat3(modelMatrix)*mat3(instanceMatrix)*objectNormal).y;
        #else
          vDeckUp = normalize(mat3(modelMatrix)*objectNormal).y;
        #endif
        vDeckW = (modelMatrix*dW).xyz;`);
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const a = chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'), b = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D deckE; varying vec3 vDeckW; varying float vDeckUp;')
      .replace('#include <lights_fragment_begin>', chunk.slice(0, a) + chunk.slice(b))
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { vec2 duv = vec2((vDeckW.x + ${(P.L / 2).toFixed(1)}) / ${P.L.toFixed(1)}, (vDeckW.z + 0.65) / 1.3 * 0.8 + 0.1);
          reflectedLight.directDiffuse += texture2D(deckE, duv).rgb * smoothstep(0.2, 0.9, vDeckUp) * BRDF_Lambert(material.diffuseColor); }`);
  };
  mat.customProgramCacheKey = () => 'piso-com-mapa-de-luz';
}

export function makeMaterials(T) {
  const M = {
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.wood, normalMap: T.woodN, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: T.woodR, roughness: 1, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xdedbd4, map: T.concrete, normalMap: T.concN, normalScale: new THREE.Vector2(0.62, 0.62), roughnessMap: T.concR, roughness: 0.94 }),
    concreteGrey: new THREE.MeshStandardMaterial({ color: 0xaaa7a0, map: T.concrete, normalMap: T.concN, normalScale: new THREE.Vector2(0.72, 0.72), roughnessMap: T.concR, roughness: 0.98 }),
    whiteSteel: new THREE.MeshStandardMaterial({ color: 0xd9dcde, roughnessMap: T.paintR, roughness: 0.78, metalness: 0.08 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x353a3f, roughness: 0.48, metalness: 0.62 }),
    galv: new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughnessMap: T.galvR, roughness: 0.68, metalness: 0.78 }),
    mesh: new THREE.MeshStandardMaterial({ color: 0xf4f6f7, alphaMap: T.mesh, transparent: true, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.2, depthWrite: false }),
    pavers: new THREE.MeshStandardMaterial({ map: T.pavers, bumpMap: T.pavers, bumpScale: 0.025, roughness: 0.9 }),
    asphalt: new THREE.MeshStandardMaterial({ map: T.asphalt, bumpMap: T.asphalt, bumpScale: 0.012, roughness: 0.96 }),
    grass: new THREE.MeshStandardMaterial({ map: T.grass, bumpMap: T.grass, bumpScale: 0.035, roughness: 1 }),
    facade: new THREE.MeshStandardMaterial({ map: T.facade, emissiveMap: T.windowsEm, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8, vertexColors: true }),
    house: new THREE.MeshStandardMaterial({ color: 0xe8e2d6, map: T.facade, emissiveMap: T.windowsEm, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85, vertexColors: true }),
    roof: new THREE.MeshStandardMaterial({ color: 0x874a38, roughness: 0.9 }),
    cityTrim: new THREE.MeshStandardMaterial({ color: 0xb8b7b3, roughness: 0.84, metalness: 0.02 }),
    hullWhite: new THREE.MeshStandardMaterial({ color: 0xf3f4f5, roughness: 0.5 }),
    hullBlue: new THREE.MeshStandardMaterial({ color: 0x1f4f9a, roughness: 0.5 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.95 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 0.9 }),
    palm: new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.9, side: THREE.DoubleSide }),
    person: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
    lampHead: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.62, 0.32).multiplyScalar(15000) }),
    pole: new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.6, metalness: 0.6 }),
  };
  M.lampHead.userData.baseNits = 30000;
  // Otimização: o entorno (prédios, casas, árvores, grama, vias, barcos) não calcula
  // as luzes spot dos LEDs — só lua/sol/céu. Corta a maior parte do custo por pixel.
  deckLitWood(M.wood);
  weatheredConcrete(M.concrete, 'branco'); weatheredConcrete(M.concreteGrey, 'cinza');
  T.galvR.repeat.set(3, 1); T.paintR.repeat.set(2, 2);
  for (const k of ['facade', 'house', 'roof', 'cityTrim', 'trunk', 'leaf', 'palm', 'grass', 'asphalt', 'hullWhite', 'hullBlue', 'pole']) noSpotLights(M[k]);
  return M;
}

/** Concreto: respingo e sujeira na base, limo junto ao chão e escorridos sob as vigas (coordenada de mundo). */
function weatheredConcrete(mat, key) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cw = instanceMatrix * cw;
        #endif
        vCW = (modelMatrix * cw).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float hg = vCW.y - ${P.ground.toFixed(2)};
        float splash = 1.0 - smoothstep(0.0, 0.9, hg);
        float moss = 1.0 - smoothstep(0.0, 0.35, hg);
        float col = fract(sin(floor(vCW.x * 9.0 + vCW.z * 9.0) * 91.7) * 43758.5);
        float t1 = ${(P.towerTop - 1.1).toFixed(2)}, t2 = ${(P.towerTop - 3.78).toFixed(2)};
        float streak = smoothstep(0.55, 1.0, col) * (step(vCW.y, t1) * exp(-(t1 - vCW.y) / 2.4) + step(vCW.y, t2) * exp(-(t2 - vCW.y) / 1.7));
        diffuseColor.rgb *= 1.0 - 0.3 * splash - 0.16 * streak;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.74, 0.82, 0.68), 0.55 * moss);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, 0.45 * moss);`);
  };
  mat.customProgramCacheKey = () => 'concreto-' + key;
}

/** Remove o laço de luzes spot do shader deste material (mantém sol, lua e céu). */
export function noSpotLights(mat) {
  mat.onBeforeCompile = (sh) => {
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const a = chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'), b = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
    if (a < 0 || b < 0) return;
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', chunk.slice(0, a) + chunk.slice(b));
  };
  mat.customProgramCacheKey = () => 'sem-spots';
}

// ---------- utilitários de geometria ----------
/** Tubo ao longo de uma polilinha, com atributo aS (comprimento acumulado). */
export function polyTube(pts, r, radial = 6) {
  const n = pts.length, pos = [], nor = [], uv = [], aS = [], idx = [];
  const lens = [0]; let s = 0;
  for (let i = 1; i < n; i++) { s += pts[i].distanceTo(pts[i - 1]); lens.push(s); }
  const total = s || 1;
  const T = V(), N = V(), B = V(), ref = V(); let prevN = null;
  for (let i = 0; i < n; i++) {
    if (i === 0) T.subVectors(pts[1], pts[0]);
    else if (i === n - 1) T.subVectors(pts[n - 1], pts[n - 2]);
    else T.subVectors(pts[i + 1], pts[i - 1]);
    T.normalize();
    if (!prevN) { ref.set(0, 1, 0); if (Math.abs(T.dot(ref)) > 0.9) ref.set(1, 0, 0); N.crossVectors(T, ref).normalize(); }
    else { N.copy(prevN).addScaledVector(T, -prevN.dot(T)).normalize(); }
    B.crossVectors(T, N).normalize(); prevN = N.clone();
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const nx = N.x * c + B.x * sn, ny = N.y * c + B.y * sn, nz = N.z * c + B.z * sn;
      pos.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
      nor.push(nx, ny, nz); uv.push(lens[i], j / radial); aS.push(lens[i]);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  g.setIndex(idx);
  return g;
}
/** Faixa (ribbon) entre duas polilinhas — usada para a tela do guarda-corpo. */
function ribbon(bottom, top, cell) {
  const pos = [], uv = [], idx = []; let s = 0;
  for (let i = 0; i < bottom.length; i++) {
    if (i) s += bottom[i].distanceTo(bottom[i - 1]);
    const hgt = top[i].distanceTo(bottom[i]);
    pos.push(bottom[i].x, bottom[i].y, bottom[i].z, top[i].x, top[i].y, top[i].z);
    uv.push(s / cell, 0, s / cell, hgt / cell);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _d = V(), _mid = V(), _s = V();
/** Caixas instanciadas ao longo de segmentos [a,b]. */
function boxSegs(segs, sy, sz, mat, name) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, segs.length);
  segs.forEach(([a, b], i) => {
    _d.subVectors(b, a); const len = _d.length(); _d.normalize();
    _q.setFromUnitVectors(AX, _d); _mid.addVectors(a, b).multiplyScalar(0.5);
    _m.compose(_mid, _q, _s.set(len, sy, sz)); im.setMatrixAt(i, _m);
  });
  im.name = name; im.castShadow = im.receiveShadow = true; return im;
}
/** Cilindros instanciados ao longo de segmentos [a,b]. */
function cylSegs(segs, r, mat, name, radial = 8) {
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(r, r, 1, radial), mat, segs.length);
  segs.forEach(([a, b], i) => {
    _d.subVectors(b, a); const len = _d.length(); _d.normalize();
    _q.setFromUnitVectors(AY, _d); _mid.addVectors(a, b).multiplyScalar(0.5);
    _m.compose(_mid, _q, _s.set(1, len, 1)); im.setMatrixAt(i, _m);
  });
  im.name = name; im.castShadow = true; return im;
}
/** UV projetada por face (caixa), em metros/tile: textura com escala real e sem esticar. */
function boxUV(geo, tile = 2) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i) / tile, p.getY(i) / tile);
    else if (az >= ay) uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
    else uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
  }
  uv.needsUpdate = true; return geo;
}
function box(sx, sy, sz, x, y, z, mat, name) {
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z)).translate(-x, -y, -z), mat);
  m.position.set(x, y, z); m.name = name || ''; m.castShadow = m.receiveShadow = true; return m;
}
/** Pilar troncocônico (afinamento em X), seção retangular. */
function taperBox(cx, yb, yt, hxB, hxT, cz, hz, mat, name) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5;
    p.setXYZ(i, cx + p.getX(i) * 2 * (hxB + (hxT - hxB) * t), yb + t * (yt - yb), cz + p.getZ(i) * 2 * hz);
  }
  g.computeVertexNormals();
  boxUV(g, 2);
  const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = m.receiveShadow = true; return m;
}

/** Polilinha do cabo principal (estai de ancoragem + parábola + estai). */
export function cablePolyline(z, includeBack = true, yOff = 0) {
  const h = H(), pts = [];
  const ya = P.ground + 0.6;
  if (includeBack) for (let i = 0; i < 12; i++) { const t = i / 12; pts.push(V(-h - P.anchorDist * (1 - t), ya + (P.towerTop - ya) * t + yOff, z)); }
  for (let x = -h; x <= h + 1e-6; x += 0.5) pts.push(V(x, cableY(x) + yOff, z));
  if (includeBack) for (let i = 1; i <= 12; i++) { const t = i / 12; pts.push(V(h + P.anchorDist * t, P.towerTop + (ya - P.towerTop) * t + yOff, z)); }
  return pts;
}

// =====================================================================
//  PONTE
// =====================================================================
export function buildBridge(M) {
  const g = new THREE.Group(); g.name = 'Ponte_Pensil';
  const h = H(), r = rng(3);

  // --- Pranchas do piso (instanciadas) ---
  const pitch = P.plankW + P.plankGap, n = Math.floor(P.L / pitch);
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(P.plankW, P.plankT, P.plankLen), M.wood, n);
  const col = new THREE.Color(), atlas = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = -P.L / 2 + pitch * (i + 0.5);
    _q.setFromAxisAngle(V(0, 0, 1), Math.atan(deckSlope(x)));
    _m.compose(_mid.set(x, deckY(x) - P.plankT / 2, 0), _q, _s.set(1, 1, 1));
    planks.setMatrixAt(i, _m);
    const t = 0.92 + r() * 0.12; planks.setColorAt(i, col.setRGB(t, t, t * (0.97 + r() * 0.04)));
    atlas[i * 3] = Math.floor(r() * 4); atlas[i * 3 + 1] = Math.floor(r() * 3); atlas[i * 3 + 2] = r() < 0.5 ? 1 : 0;
  }
  planks.geometry.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlas, 3));
  planks.name = 'Pranchas_madeira'; planks.receiveShadow = planks.castShadow = true; g.add(planks);

  // --- Longarinas e rodapés ---
  const yStr = (x) => deckY(x) - P.plankT - 0.1;
  const str = [], toe = [];
  for (let x = -h; x < h - 1e-6; x += 1) {
    const x2 = Math.min(x + 1, h);
    for (const z of [-P.stringerZ, P.stringerZ]) str.push([V(x, yStr(x), z), V(x2, yStr(x2), z)]);
    for (const z of [-(P.railZ - 0.03), P.railZ - 0.03]) toe.push([V(x, deckY(x) + 0.06, z), V(x2, deckY(x2) + 0.06, z)]);
  }
  g.add(boxSegs(str, 0.2, 0.1, M.steelDark, 'Longarinas'));
  g.add(boxSegs(toe, 0.12, 0.012, M.whiteSteel, 'Rodape'));

  // --- Transversinas (a cada 1 m) ---
  const tr = [];
  for (let k = 0; k <= P.L / P.transStep; k++) {
    const x = -h + k * P.transStep, y = deckY(x) - P.plankT - 0.26;
    tr.push([V(x, y, -P.transLen / 2), V(x, y, P.transLen / 2)]);
  }
  g.add(boxSegs(tr, 0.12, 0.08, M.steelDark, 'Transversinas'));

  // --- Pendurais + braçadeiras ---
  const hs = [], clamps = [];
  for (let k = 1; k < P.L / P.hangerStep; k++) {
    const x = -h + k * P.hangerStep;
    for (const s of [-1, 1]) {
      const top = V(x, cableY(x) - 0.02, s * P.cableZ), bot = V(x, deckY(x) - P.plankT - 0.32, s * P.cableZ);
      hs.push([top, bot]);
      clamps.push([V(x, cableY(x) - 0.04, s * P.cableZ - 0.08), V(x, cableY(x) - 0.04, s * P.cableZ + 0.08)]);
    }
  }
  g.add(cylSegs(hs, P.hangerR, M.galv, 'Pendurais'));
  g.add(boxSegs(clamps, 0.07, 0.06, M.steelDark, 'Bracadeiras'));

  // --- Cabos principais (2 por lado) ---
  const cables = [];
  for (const s of [-1, 1]) for (const c of [-1, 1]) cables.push(polyTube(cablePolyline(s * P.cableZ + c * P.cableGap / 2), P.cableR, 8));
  const cab = new THREE.Mesh(mergeGeometries(cables), M.galv); cab.name = 'Cabos_principais'; cab.castShadow = true; g.add(cab);

  // --- Guarda-corpo: montantes, corrimão, travessa inferior e tela ---
  const posts = [], rails = [], meshes = [];
  for (let k = 0; k <= P.L / P.postStep; k++) {
    const x = -h + k * P.postStep;
    for (const s of [-1, 1]) posts.push([V(x, deckY(x), s * P.railZ), V(x, deckY(x) + P.railH, s * P.railZ)]);
  }
  for (const s of [-1, 1]) {
    const top = [], bot = [], mb = [], mt = [];
    for (let x = -h; x <= h + 1e-6; x += 1) {
      top.push(V(x, deckY(x) + P.railH, s * P.railZ)); bot.push(V(x, deckY(x) + 0.12, s * P.railZ));
      mb.push(V(x, deckY(x) + 0.12, s * P.railZ)); mt.push(V(x, deckY(x) + P.railH - 0.03, s * P.railZ));
    }
    rails.push(polyTube(top, 0.026, 8), polyTube(bot, 0.016, 6));
    meshes.push(ribbon(mb, mt, 0.05));
  }
  g.add(boxSegs(posts, 0.05, 0.05, M.whiteSteel, 'Montantes'));
  const railMesh = new THREE.Mesh(mergeGeometries(rails), M.whiteSteel); railMesh.name = 'Corrimao'; railMesh.castShadow = true; g.add(railMesh);
  const tela = new THREE.Mesh(mergeGeometries(meshes), M.mesh); tela.name = 'Tela_guarda_corpo'; tela.renderOrder = 2; g.add(tela);

  // --- Torres-pórtico, escadas e ancoragens ---
  for (const s of [-1, 1]) g.add(buildHead(s, M));
  return g;
}

function buildHead(s, M) {
  const g = new THREE.Group(); g.name = s < 0 ? 'Cabeceira_Torres_RS' : 'Cabeceira_PassoDeTorres_SC';
  const h = H(), cx = s * h, zw = 2 * P.legZ + 2 * P.legHZ;
  // pernas
  for (const z of [-P.legZ, P.legZ]) g.add(taperBox(cx, P.ground - 0.8, P.towerTop + 0.35, P.legHXb, P.legHXt, z, P.legHZ, M.concrete, 'Torre_perna'));
  g.add(box(0.72, 0.9, zw, cx, P.towerTop - 0.65, 0, M.concrete, 'Viga_superior'));
  g.add(box(0.2, 2.3, 2 * (P.legZ - P.legHZ), cx, P.towerTop - 2.3, 0, M.concrete, 'Painel_superior'));
  g.add(box(0.55, 0.35, zw, cx, P.towerTop - 3.6, 0, M.concrete, 'Viga_intermediaria'));
  g.add(box(1.1, 0.6, zw, cx, P.deckEnd - 0.6, 0, M.concrete, 'Viga_de_apoio'));
  for (const z of [-P.cableZ, P.cableZ]) g.add(box(0.7, 0.2, 0.3, cx, P.towerTop - 0.1, z, M.steelDark, 'Sela'));
  // patamar
  const x0 = s * (h - 0.6), x1 = s * (h + P.landing);
  g.add(box(Math.abs(x1 - x0), 0.3, 1.9, (x0 + x1) / 2, P.deckEnd - 0.15, 0, M.concreteGrey, 'Patamar'));
  // escada
  const n = stairSteps(), rise = (P.deckEnd - P.ground) / n, run = P.stairRun;
  const steps = new THREE.InstancedMesh(boxUV(new THREE.BoxGeometry(run, rise + 0.12, 1.6), 1), M.concreteGrey, n);
  for (let k = 0; k < n; k++) {
    const xa = s * (h + P.landing + k * run + run / 2), top = P.deckEnd - (k + 1) * rise;
    _m.compose(_mid.set(xa, top - (rise + 0.12) / 2, 0), _q.identity(), _s.set(1, 1, 1)); steps.setMatrixAt(k, _m);
  }
  steps.name = 'Degraus'; steps.castShadow = steps.receiveShadow = true; g.add(steps);
  const xs0 = s * (h + P.landing), xs1 = s * (h + P.landing + n * run);
  g.add(boxSegs([[V(xs0, P.deckEnd - 0.4, 0), V(xs1, P.ground - 0.25, 0)]], 0.25, 1.6, M.concreteGrey, 'Laje_escada'));
  // guarda-corpo do patamar + escada
  const rails = [], meshes = [], posts = [];
  for (const z of [-0.85, 0.85]) {
    const top = [V(s * (h - 0.6), P.deckEnd + P.railH, z), V(xs0, P.deckEnd + P.railH, z), V(xs1, P.ground + P.railH, z)];
    rails.push(polyTube(top, 0.026, 8));
    const bt = [V(s * (h - 0.6), P.deckEnd + 0.1, z), V(xs0, P.deckEnd + 0.1, z), V(xs1, P.ground + 0.1, z)];
    const tp = top.map(p => p.clone().setY(p.y - 0.03));
    meshes.push(ribbon(bt, tp, 0.05));
    for (let k = 0; k <= n; k += 3) { const x = s * (h + P.landing + k * run), y = P.deckEnd - k * rise; posts.push([V(x, y, z), V(x, y + P.railH, z)]); }
    posts.push([V(s * (h - 0.6), P.deckEnd, z), V(s * (h - 0.6), P.deckEnd + P.railH, z)]);
  }
  const rm = new THREE.Mesh(mergeGeometries(rails), M.whiteSteel); rm.name = 'Corrimao_escada'; g.add(rm);
  const tm = new THREE.Mesh(mergeGeometries(meshes), M.mesh); tm.name = 'Tela_escada'; tm.renderOrder = 2; g.add(tm);
  g.add(boxSegs(posts, 0.05, 0.05, M.whiteSteel, 'Montantes_escada'));
  // bloco de ancoragem
  g.add(box(2.0, 2.2, 3.2, s * (h + P.anchorDist), P.ground - 0.5, 0, M.concreteGrey, 'Bloco_ancoragem'));
  return g;
}

// =====================================================================
//  ENTORNO
// =====================================================================
export function buildEnvironment(M, T) {
  const g = new THREE.Group(); g.name = 'Entorno';
  const r = rng(21), h = H();
  const pick = [];

  for (const s of [-1, 1]) {
    // terreno
    const grd = new THREE.Mesh(new THREE.PlaneGeometry(800, 1600).rotateX(-Math.PI / 2), M.grass);
    grd.position.set(s * (P.quayX + 400), P.ground - 0.02, 0); grd.receiveShadow = true; grd.name = 'Terreno'; g.add(grd); pick.push(grd);
    M.grass.map.repeat.set(80, 160);
    // praça pavimentada
    const pz = new THREE.PlaneGeometry(36, 90).rotateX(-Math.PI / 2);
    const uv = pz.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 18, uv.getY(i) * 45);
    const plaza = new THREE.Mesh(pz, M.pavers); plaza.position.set(s * (P.quayX + 18), P.ground, 0); plaza.receiveShadow = true; plaza.name = 'Praca'; g.add(plaza); pick.push(plaza);
    // calçada ao longo do cais
    const sw = new THREE.PlaneGeometry(10, 1600).rotateX(-Math.PI / 2);
    const uv2 = sw.attributes.uv; for (let i = 0; i < uv2.count; i++) uv2.setXY(i, uv2.getX(i) * 5, uv2.getY(i) * 800);
    const walk = new THREE.Mesh(sw, M.pavers); walk.position.set(s * (P.quayX + 5), P.ground + 0.005, 0); walk.receiveShadow = true; g.add(walk);
    // via
    const rd = new THREE.PlaneGeometry(10, 1600).rotateX(-Math.PI / 2);
    const uv3 = rd.attributes.uv; for (let i = 0; i < uv3.count; i++) uv3.setXY(i, uv3.getX(i) * 3, uv3.getY(i) * 400);
    const road = new THREE.Mesh(rd, M.asphalt); road.position.set(s * (P.quayX + 41), P.ground + 0.012, 0); road.receiveShadow = true; road.name = 'Via'; g.add(road);
    // muro do cais
    const quay = box(1.2, 6, 1600, s * (P.quayX + 0.6), P.ground - 3, 0, M.concreteGrey, 'Cais');
    g.add(quay); pick.push(quay);
    // guarda-corpo do cais (azul, como nas fotos)
    const qr = [];
    for (let z = -400; z < 400; z += 2.5) if (Math.abs(z) > 3) qr.push([V(s * (P.quayX + 0.3), P.ground, z), V(s * (P.quayX + 0.3), P.ground + 1.0, z)]);
    g.add(boxSegs(qr, 0.05, 0.05, M.hullBlue, 'Guarda_corpo_cais'));
    const ql = [];
    for (const zz of [[-400, -2], [2, 400]]) ql.push(polyTube([V(s * (P.quayX + 0.3), P.ground + 1.0, zz[0]), V(s * (P.quayX + 0.3), P.ground + 1.0, zz[1])], 0.03, 6));
    g.add(new THREE.Mesh(mergeGeometries(ql), M.hullBlue));
  }

  // --- Postes de iluminação pública existentes ---
  const poles = [], heads = [], lampPos = [];
  for (const s of [-1, 1]) for (let z = -300; z <= 300; z += 32) {
    const x = s * (P.quayX + 35.5);
    poles.push([V(x, P.ground, z), V(x, P.ground + 9, z)], [V(x, P.ground + 9, z), V(x - s * 1.6, P.ground + 9, z)]);
    heads.push(V(x - s * 1.6, P.ground + 8.9, z)); lampPos.push(V(x - s * 1.6, P.ground + 8.85, z));
  }
  g.add(cylSegs(poles, 0.08, M.pole, 'Postes', 6));
  const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.12, 0.3), M.lampHead, heads.length);
  heads.forEach((p, i) => { _m.compose(p, _q.identity(), _s.set(1, 1, 1)); hm.setMatrixAt(i, _m); });
  hm.name = 'Luminarias_publicas'; g.add(hm);

  // --- Edificações ---
  const tall = [], low = [], roofs = [], cityDetails = [];
  const facadeUV = (geo, w, hgt, d, floor = 3) => {
    const uv = geo.attributes.uv; // ordem: px, nx, py, ny, pz, nz (4 vértices cada)
    const dims = [[d, hgt], [d, hgt], [0, 0], [0, 0], [w, hgt], [w, hgt]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k; const [fw, fh] = dims[f];
      if (!fw) uv.setXY(i, 0.01, 0.01); else uv.setXY(i, uv.getX(i) * fw / (4 * floor), uv.getY(i) * fh / (4 * floor));
    }
  };
  const tint = (geo, c) => {
    const a = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < geo.attributes.position.count; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  };
  const occupied = [];
  const free = (x, z, w, d) => occupied.every(o => Math.abs(o[0] - x) > (o[2] + w) / 2 + 4 || Math.abs(o[1] - z) > (o[3] + d) / 2 + 4);
  // Torres (RS): torres residenciais altas
  for (let i = 0; i < 70; i++) {
    const w = 14 + r() * 12, d = 14 + r() * 12, x = -(P.quayX + 52 + r() * 300), z = -380 + r() * 760;
    if (!free(x, z, w, d)) continue;
    const near = Math.max(0, 1 - Math.abs(x) / 400);
    const hgt = 18 + r() * 55 * (0.5 + near);
    occupied.push([x, z, w, d]);
    const geo = new THREE.BoxGeometry(w, hgt, d); facadeUV(geo, w, hgt, d);
    const tone = 0.78 + r() * 0.24, cool = r() * 0.05; tint(geo, new THREE.Color(tone - cool, tone - cool * 0.4, tone));
    geo.translate(x, P.ground + hgt / 2, z); tall.push(geo);
    // platibandas, recuos técnicos e algumas linhas de varanda quebram a repetição dos blocos.
    const crown = new THREE.BoxGeometry(w * 1.035, 0.32, d * 1.035); crown.translate(x, P.ground + hgt + 0.16, z); cityDetails.push(crown);
    if (r() < 0.72) {
      const pw = w * (0.34 + r() * 0.3), pd = d * (0.34 + r() * 0.3), ph = 1.1 + r() * 1.8;
      const pent = new THREE.BoxGeometry(pw, ph, pd); pent.translate(x + (r() - 0.5) * w * 0.18, P.ground + hgt + ph / 2 + 0.3, z + (r() - 0.5) * d * 0.18); cityDetails.push(pent);
    }
    const bands = 1 + (r() * 3 | 0);
    for (let k = 1; k <= bands; k++) {
      const band = new THREE.BoxGeometry(w * 1.018, 0.10, d * 1.018);
      band.translate(x, P.ground + hgt * k / (bands + 1), z); cityDetails.push(band);
    }
  }
  // Passo de Torres (SC): casas baixas com telhado
  for (let i = 0; i < 160; i++) {
    const w = 8 + r() * 6, d = 7 + r() * 5, x = P.quayX + 50 + r() * 320, z = -400 + r() * 800;
    if (!free(x, z, w, d)) continue;
    occupied.push([x, z, w, d]);
    const hgt = r() < 0.75 ? 3.2 + r() * 1.5 : 6.5 + r() * 2;
    const geo = new THREE.BoxGeometry(w, hgt, d); facadeUV(geo, w, hgt, d, 3.2);
    const tone = 0.8 + r() * 0.22, warm = r() * 0.08; tint(geo, new THREE.Color(tone, tone - warm * 0.35, tone - warm));
    geo.translate(x, P.ground + hgt / 2, z); low.push(geo);
    const shp = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.4, 0), new THREE.Vector2(w / 2 + 0.4, 0), new THREE.Vector2(0, 1.8)]);
    const rf = new THREE.ExtrudeGeometry(shp, { depth: d + 0.6, bevelEnabled: false }); rf.translate(0, 0, -(d + 0.6) / 2); rf.translate(x, P.ground + hgt, z); roofs.push(rf);
  }
  // edificações baixas junto às praças (quiosque "Barcos", livraria etc.)
  for (const [x, z, w, d, hh] of [[-(P.quayX + 12), 16, 8, 5, 3.4], [-(P.quayX + 14), -20, 10, 7, 3.6], [P.quayX + 14, -14, 22, 12, 4.2], [P.quayX + 12, 20, 6, 5, 3.2]]) {
    const geo = new THREE.BoxGeometry(w, hh, d); facadeUV(geo, w, hh, d, 3.2); tint(geo, new THREE.Color(0.92, 0.89, 0.84)); geo.translate(x, P.ground + hh / 2, z); low.push(geo);
  }
  const tallM = new THREE.Mesh(mergeGeometries(tall), M.facade); tallM.name = 'Edificios_Torres'; tallM.castShadow = tallM.receiveShadow = true; g.add(tallM);
  const lowM = new THREE.Mesh(mergeGeometries(low), M.house); lowM.name = 'Casas_PassoDeTorres'; lowM.castShadow = lowM.receiveShadow = true; g.add(lowM);
  const roofM = new THREE.Mesh(mergeGeometries(roofs), M.roof); roofM.name = 'Telhados'; roofM.castShadow = true; g.add(roofM);
  const cityDetailM = new THREE.Mesh(mergeGeometries(cityDetails), M.cityTrim); cityDetailM.name = 'Detalhes_edificios'; cityDetailM.castShadow = true; g.add(cityDetailM);

  // --- Vegetação ---
  const trunks = [], crowns = [], palmT = [], fronds = [];
  const treeOK = (x, z) => Math.abs(z) > 5 || Math.abs(x) > P.L / 2 + P.anchorDist + 3;
  for (let i = 0; i < 70; i++) {
    const s = r() < 0.5 ? -1 : 1, x = s * (P.quayX + 3 + r() * 30), z = -120 + r() * 240;
    if (!treeOK(x, z) || Math.abs(x) > P.quayX + 30 && Math.abs(x) < P.quayX + 46) continue;
    if (r() < 0.45) {
      const hh = 6 + r() * 4; palmT.push([V(x, P.ground, z), V(x + (r() - 0.5) * 0.8, P.ground + hh, z + (r() - 0.5) * 0.8)]);
      for (let k = 0; k < 9; k++) fronds.push({ x, y: P.ground + hh, z, a: k / 9 * Math.PI * 2 + r() });
    } else {
      const hh = 3 + r() * 2.5; trunks.push([V(x, P.ground, z), V(x, P.ground + hh, z)]); crowns.push({ x, y: P.ground + hh + 1.2, z, s: 2 + r() * 1.8 });
    }
  }
  g.add(cylSegs(trunks, 0.18, M.trunk, 'Troncos', 6));
  g.add(cylSegs(palmT, 0.16, M.trunk, 'Coqueiros', 6));
  const cm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), M.leaf, crowns.length);
  crowns.forEach((c, i) => { _m.compose(_mid.set(c.x, c.y, c.z), _q.identity(), _s.set(c.s, c.s * 0.8, c.s)); cm.setMatrixAt(i, _m); });
  cm.name = 'Copas'; cm.castShadow = true; g.add(cm);
  const frondGeo = new THREE.PlaneGeometry(3.2, 0.7); frondGeo.translate(1.6, 0, 0);
  const fm = new THREE.InstancedMesh(frondGeo, M.palm, fronds.length);
  fronds.forEach((f, i) => {
    _q.setFromEuler(new THREE.Euler(Math.PI / 2 - 0.2, f.a, -0.45, 'YXZ'));
    _m.compose(_mid.set(f.x, f.y, f.z), _q, _s.set(1, 1, 1)); fm.setMatrixAt(i, _m);
  });
  fm.name = 'Folhas_coqueiro'; g.add(fm);

  // --- Barcos atracados ---
  const boats = new THREE.Group(); boats.name = 'Barcos';
  for (const [x, z, len, two] of [[-(P.quayX - 3.5), 18, 19, true], [-(P.quayX - 3.2), -26, 13, false], [P.quayX - 3.6, 24, 17, true], [P.quayX - 3.2, -17, 12, false], [P.quayX - 3.2, -45, 14, false]]) {
    const b = makeBoat(len, two, M); b.position.set(x, 0, z); b.rotation.y = Math.PI / 2 + (r() - 0.5) * 0.1; boats.add(b);
  }
  g.add(boats);

  // --- Ponte de concreto (Anita Garibaldi) — posição aproximada ---
  const cb = new THREE.Group(); cb.name = 'Ponte_concreto_referencia';
  const zc = -280;
  cb.add(box(140, 1.4, 13, 0, 5.6, zc, M.concreteGrey, 'Tabuleiro_concreto'));
  for (const x of [-42, -14, 14, 42]) for (const z of [-4, 4]) {
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 9, 12), M.concreteGrey); pil.position.set(x, 0.4, zc + z); cb.add(pil);
  }
  for (const z of [-6.2, 6.2]) cb.add(box(140, 0.9, 0.3, 0, 6.75, zc + z, M.concreteGrey, 'Barreira'));
  const cbl = [];
  for (let x = -60; x <= 60; x += 20) cbl.push(V(x, 13.5, zc - 6.4), V(x, 13.5, zc + 6.4));
  const cbh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 0.25), M.lampHead, cbl.length);
  cbl.forEach((p, i) => { _m.compose(p, _q.identity(), _s.set(1, 1, 1)); cbh.setMatrixAt(i, _m); });
  cb.add(cbh);
  cb.add(cylSegs(cbl.map(p => [p.clone().setY(6.3), p]), 0.07, M.pole, 'Postes_ponte', 6));
  g.add(cb);

  return { group: g, pick, lampPos };
}

function makeBoat(len, twoDeck, M) {
  const b = new THREE.Group(), w = len * 0.28;
  const shp = new THREE.Shape([
    new THREE.Vector2(-len / 2, -w / 2), new THREE.Vector2(len / 2 - w * 0.9, -w / 2), new THREE.Vector2(len / 2, 0),
    new THREE.Vector2(len / 2 - w * 0.9, w / 2), new THREE.Vector2(-len / 2, w / 2)]);
  const hull = new THREE.ExtrudeGeometry(shp, { depth: 1.8, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15, bevelSegments: 1 });
  hull.rotateX(-Math.PI / 2); hull.translate(0, -0.7, 0);
  b.add(new THREE.Mesh(hull, M.hullWhite));
  const stripe = new THREE.Mesh(hull.clone().scale(1.01, 0.25, 1.01), M.hullBlue); stripe.position.y = -0.05; b.add(stripe);
  const cab = box(len * 0.55, 2.0, w * 0.8, -len * 0.08, 2.1, 0, M.hullWhite); b.add(cab);
  b.add(box(len * 0.6, 0.12, w * 0.95, -len * 0.08, 3.15, 0, M.hullBlue));
  if (twoDeck) { b.add(box(len * 0.42, 1.6, w * 0.75, -len * 0.12, 4.0, 0, M.hullWhite)); b.add(box(len * 0.5, 0.12, w * 0.9, -len * 0.12, 4.85, 0, M.hullBlue)); }
  else { const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 6), M.pole); mast.position.set(len * 0.2, 3.5, 0); b.add(mast); }
  b.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return b;
}

/** Pessoas em escala (1,75 m) — sobre a ponte (limite atual: 10) e nas praças. */
export function buildPeople(M) {
  const g = new THREE.Group(); g.name = 'Escala_humana';
  const r = rng(5);
  const body = new THREE.CapsuleGeometry(0.19, 1.05, 4, 8); body.translate(0, 0.72, 0);
  const head = new THREE.SphereGeometry(0.11, 10, 8); head.translate(0, 1.64, 0);
  const geo = mergeGeometries([body, head]);
  const spots = [];
  for (let i = 0; i < 8; i++) { const x = -42 + r() * 84; spots.push([x, deckY(x), (r() - 0.5) * 0.9]); }
  for (let i = 0; i < 14; i++) { const s = r() < 0.5 ? -1 : 1; spots.push([s * (P.quayX + 2 + r() * 24), P.ground, -25 + r() * 50]); }
  const palette = [0x2d4a7a, 0xb23a3a, 0x3d3d3d, 0xd9b44a, 0x5a7d5a, 0xe6e6e6, 0x7a4a8a];
  const im = new THREE.InstancedMesh(geo, M.person, spots.length);
  spots.forEach((p, i) => {
    if (Math.abs(p[0]) > P.L / 2 - 1 && Math.abs(p[0]) < P.L / 2 + P.anchorDist && Math.abs(p[2]) < 2) p[2] += 4;
    _m.compose(_mid.set(...p), _q.identity(), _s.set(1, 0.92 + r() * 0.12, 1)); im.setMatrixAt(i, _m);
    im.setColorAt(i, new THREE.Color(palette[i % palette.length]));
  });
  im.castShadow = true; g.add(im);
  return g;
}

/** Céu em domo com gradiente (valores em cd/m²) + estrelas. */
export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, glow: { value: new THREE.Color() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w*0.99999; }`,
    fragmentShader: `uniform vec3 top, horizon, bottom, glow; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.45)) : mix(horizon, bottom, pow(clamp(-h,0.0,1.0), 0.35));
        float g = pow(max(0.0, 1.0 - abs(h)*6.0), 2.0) * smoothstep(-0.2, 1.0, -vDir.x*0.7 + 0.3);
        gl_FragColor = vec4(c + glow*g, 1.0); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), mat); dome.name = 'Ceu'; dome.renderOrder = -1;
  const r = rng(99), pts = [];
  for (let i = 0; i < 1600; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, y = 0.08 + Math.abs(u) * 0.92, k = Math.sqrt(1 - y * y);
    pts.push(Math.cos(a) * k * 1700, y * 1700, Math.sin(a) * k * 1700);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(1.2), size: 1.4, sizeAttenuation: false, fog: false, depthWrite: false }));
  stars.name = 'Estrelas';
  return { dome, stars };
}

/** Rio: espelho (Reflector) com shader de ondulação e Fresnel. */
export const RiverShader = {
  name: 'RiverShader',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    time: { value: 0 }, distortion: { value: 0.035 }, reflectivity: { value: 1 }, body: { value: new THREE.Color(0.01, 0.015, 0.016) },
    lPos: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) }, lDir: { value: Array.from({ length: 16 }, () => new THREE.Vector3(0, -1, 0)) },
    lCol: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) }, lCos: { value: new Array(16).fill(1) }, lN: { value: 0 }, albedo: { value: 0.02 },
  },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld;
    void main(){ vUv = textureMatrix*vec4(position,1.0); vec4 w = modelMatrix*vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, distortion, reflectivity, albedo; uniform vec3 body; varying vec4 vUv; varying vec3 vWorld;
    uniform vec3 lPos[16]; uniform vec3 lDir[16]; uniform vec3 lCol[16]; uniform float lCos[16]; uniform int lN;
    float waveHeight(vec2 p){
      float h = 0.0;
      h += sin(dot(p, vec2(0.19, 0.57)) + time*0.34)*0.62;
      h += sin(dot(p, vec2(-0.43, 0.31)) - time*0.27 + 1.7)*0.31;
      h += sin(dot(p, vec2(0.92, 0.17)) + time*0.52 + 3.1)*0.15;
      h += sin(dot(p, vec2(-1.33, 0.81)) - time*0.66 + 0.4)*0.07;
      return h;
    }
    vec2 waves(vec2 p){
      float e = 0.16, h = waveHeight(p);
      return vec2(waveHeight(p + vec2(e,0.0)) - h, waveHeight(p + vec2(0.0,e)) - h) / e;
    }
    void main(){
      vec2 n = waves(vWorld.xz);
      float d = length(cameraPosition - vWorld);
      float k = distortion / (1.0 + d*0.006);
      vec4 uv = vUv; uv.x += n.x*k*0.10*uv.w; uv.y += n.y*k*0.34*uv.w;
      // amostragem elíptica: dissolve fragmentos sem transformar cada reflexo em uma faixa vertical.
      float bl = (0.0014 + k*0.034)*uv.w, bx = bl*0.42;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb*0.30
                + (texture2DProj(tDiffuse, uv + vec4(0.0, bl, 0.0, 0.0)).rgb + texture2DProj(tDiffuse, uv - vec4(0.0, bl, 0.0, 0.0)).rgb)*0.14
                + (texture2DProj(tDiffuse, uv + vec4(0.0, 3.0*bl, 0.0, 0.0)).rgb + texture2DProj(tDiffuse, uv - vec4(0.0, 3.0*bl, 0.0, 0.0)).rgb)*0.09
                + (texture2DProj(tDiffuse, uv + vec4(0.0, 7.0*bl, 0.0, 0.0)).rgb + texture2DProj(tDiffuse, uv - vec4(0.0, 7.0*bl, 0.0, 0.0)).rgb)*0.055
                + (texture2DProj(tDiffuse, uv + vec4(bx, 0.0, 0.0, 0.0)).rgb + texture2DProj(tDiffuse, uv - vec4(bx, 0.0, 0.0, 0.0)).rgb)*0.065;
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 N = normalize(vec3(-n.x*0.18, 1.0, -n.y*0.18));
      float c = clamp(dot(V, N), 0.0, 1.0);
      float F = 0.02 + 0.98*pow(1.0 - c, 5.0);
      vec3 E = vec3(0.0);
      for (int i = 0; i < 16; i++) {
        if (i >= lN) break;
        vec3 L = lPos[i] - vWorld; float d2 = max(dot(L, L), 0.01); vec3 l = L*inversesqrt(d2);
        float cs = dot(-l, lDir[i]); float sp = smoothstep(lCos[i], mix(lCos[i], 1.0, 0.35), cs);
        E += lCol[i]*sp*max(l.y, 0.0)/d2;
      }
      E = E/(1.0 + E*0.018);
      float turbidity = 0.94 + 0.06*sin(dot(vWorld.xz, vec2(0.018,0.031)) + time*0.035);
      vec3 col = body*turbidity*(1.0 - F) + E*albedo*(1.0 - F)/3.14159 + refl*(F*0.72 + 0.014)*reflectivity;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
