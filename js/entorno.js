// =====================================================================
//  Entorno real — OpenStreetMap (© OpenStreetMap contributors, ODbL)
//  Margens do rio, quarteirões, edificações, vias, praças, comércios com
//  letreiros, árvores, postes, barcos, ponte de concreto e o letreiro
//  #EUPASSODETORRES. Dados extraídos em 2026-10 (ver data/entorno_osm.txt).
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { P, rng, canvasTex, noise, cylSegs, boxSegs, box, makeBoat, polyTube } from './model.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------
//  Ajuste do OSM ao modelo: a ponte do OSM tem 89,8 m e as margens no
//  eixo ficam em ±39 m; no modelo os cais estão em ±44 m. Só a faixa
//  |x| < 79 m é esticada; daí para fora tudo fica na posição real.
// ---------------------------------------------------------------------
const XB = 39, XF = 40, SH = P.quayX - XB;
export function warpX(x) {
  const a = Math.abs(x), s = Math.sign(x);
  if (a <= XB) return x * P.quayX / XB;
  if (a >= XB + XF) return x;
  return s * (a + SH * (1 - (a - XB) / XF));
}
const hp = (s) => s.trim().split(/\s+/).map(p => { const [x, z] = p.split(',').map(Number); return [warpX(x / 2), z / 2]; });

// ---------------------------------------------------------------------
//  Geometria plana
// ---------------------------------------------------------------------
function area(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function inRing(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const inPoly = (x, z, poly) => inRing(x, z, poly[0]) && !poly.slice(1).some(h => inRing(x, z, h));
function centroid(r) { let x = 0, z = 0; r.forEach(p => { x += p[0]; z += p[1]; }); return [x / r.length, z / r.length]; }
function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L));
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
}
const dedupe = (r) => { const o = []; r.forEach(p => { const l = o[o.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 0.05) o.push(p); }); if (o.length > 2 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 0.05) o.pop(); return o; };

/** Retângulo orientado de menor área (para telhados de 4 águas). */
function obb(r) {
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of r) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, v); z1 = Math.max(z1, v); }
    const A = (x1 - x0) * (z1 - z0);
    if (!best || A < best.A) best = { A, c, s, x0, x1, z0, z1 };
  }
  return best;
}

/** Acumulador de malha não indexada (posição, normal, uv, cor). */
class Acc {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  tri(a, b, c, na, nb, nc, ua, ub, uc, col) {
    this.p.push(...a, ...b, ...c); this.n.push(...na, ...nb, ...nc); this.u.push(...ua, ...ub, ...uc);
    if (col) for (let i = 0; i < 3; i++) this.c.push(col.r, col.g, col.b);
  }
  quad(a, b, c, d, n, ua, ub, uc, ud, col) { this.tri(a, b, c, n, n, n, ua, ub, uc, col); this.tri(a, c, d, n, n, n, ua, uc, ud, col); }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    if (this.c.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  get empty() { return !this.p.length; }
}
/** Face plana (polígono com furos) em y, voltada para cima; uv = metros / tile. */
function capInto(acc, poly, y, tile = 4, col = null) {
  const toV = (r) => r.map(p => new THREE.Vector2(p[0], p[1]));
  const outer = toV(dedupe(poly[0])), holes = poly.slice(1).map(h => toV(dedupe(h)));
  if (outer.length < 3) return;
  const pts = [...outer, ...holes.flat()];
  const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
  const up = [0, 1, 0];
  for (const [i, j, k] of tris) {
    const a = pts[i], b = pts[j], c = pts[k];
    const cr = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
    const [A, B, C] = cr >= 0 ? [a, b, c] : [a, c, b];
    acc.tri([A.x, y, A.y], [B.x, y, B.y], [C.x, y, C.y], up, up, up, [A.x / tile, -A.y / tile], [B.x / tile, -B.y / tile], [C.x / tile, -C.y / tile], col);
  }
}
/** Paredes ao longo de um anel (normais para fora). u = s/tu, v = (y - y0)/tv. */
function wallsInto(acc, ring, y0, y1, tu, tv, col = null, outwardSign = null) {
  const r = dedupe(ring); if (r.length < 3) return;
  const sgn = outwardSign ?? (area(r) > 0 ? 1 : -1);
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 1e-3) continue;
    // normal para fora: anel com área > 0 (x,z) → (dz, 0, -dx)
    const n = [sgn * dz / L, 0, -sgn * dx / L];
    const A0 = [a[0], y0, a[1]], B0 = [b[0], y0, b[1]], B1 = [b[0], y1, b[1]], A1 = [a[0], y1, a[1]];
    const ua0 = [s / tu, 0], ub0 = [(s + L) / tu, 0], ub1 = [(s + L) / tu, (y1 - y0) / tv], ua1 = [s / tu, (y1 - y0) / tv];
    // ordem dos vértices conforme a normal (frente para fora)
    if (sgn > 0) acc.quad(A0, A1, B1, B0, n, ua0, ua1, ub1, ub0, col);
    else acc.quad(A0, B0, B1, A1, n, ua0, ub0, ub1, ua1, col);
    s += L;
  }
}
/** Faixa (via) ao longo de uma polilinha, com cantos em meia-esquadria. */
function ribbonInto(acc, pts, w, y, vTile, uScale = 1, off = 0) {
  const n = pts.length; if (n < 2) return;
  const L = [], R = [], S = [0];
  for (let i = 1; i < n; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    let k = 1;
    if (i > 0 && i < n - 1) {
      const p = pts[i - 1], c = pts[i], q = pts[i + 1];
      const d1 = [c[0] - p[0], c[1] - p[1]], d2 = [q[0] - c[0], q[1] - c[1]], l1 = Math.hypot(...d1) || 1, l2 = Math.hypot(...d2) || 1;
      const cosH = Math.sqrt(Math.max(0.05, (1 + (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2)) / 2));
      k = Math.min(2.5, 1 / cosH);
    }
    const nx = -tz, nz = tx;
    L.push([pts[i][0] + nx * (off + w / 2) * k, pts[i][1] + nz * (off + w / 2) * k]);
    R.push([pts[i][0] + nx * (off - w / 2) * k, pts[i][1] + nz * (off - w / 2) * k]);
  }
  const up = [0, 1, 0];
  for (let i = 1; i < n; i++) {
    const a = L[i - 1], b = R[i - 1], c = R[i], d = L[i];
    const v0 = S[i - 1] / vTile, v1 = S[i] / vTile;
    acc.quad([a[0], y, a[1]], [d[0], y, d[1]], [c[0], y, c[1]], [b[0], y, b[1]], up, [0, v0], [0, v1], [uScale, v1], [uScale, v0]);
  }
}
function fixUp(geo) { // garante normais para cima nas faixas (ordem dos vértices)
  const p = geo.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], cx = p[i + 6], cz = p[i + 8];
    const cr = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (cr < 0) { for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; } const u = geo.attributes.uv.array, j = i / 9 * 6; for (let k = 0; k < 2; k++) { const t = u[j + 2 + k]; u[j + 2 + k] = u[j + 4 + k]; u[j + 4 + k] = t; } }
  }
  return geo;
}

// ---------------------------------------------------------------------
//  Materiais: recebem as luzes spot (LEDs) só perto da ponte
// ---------------------------------------------------------------------
/** Laço das luzes spot só para |xz| < R (luminárias avulsas iluminam fachadas e árvores próximas). */
export const TREE_FAR = { value: 350 };
export function nearSpots(mat, key, R = 170, cullFar = false) {
  mat.onBeforeCompile = (sh) => {
    if (cullFar) sh.uniforms.uTreeFar = TREE_FAR;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vNearXZ;' + (cullFar ? '\nuniform float uTreeFar;' : ''))
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 nw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          nw = instanceMatrix * nw;
        #endif
          vNearXZ = (modelMatrix * nw).xz; }
        ${cullFar ? `#ifdef USE_INSTANCING
          // árvore além do alcance da qualidade escolhida: descartada antes de gerar pixels
          if (distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition) > uTreeFar) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        #endif` : ''}`);
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const a = chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'), b = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
    if (a < 0 || b < 0) return;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vNearXZ;')
      .replace('#include <lights_fragment_begin>', chunk.slice(0, a) + `if (dot(vNearXZ, vNearXZ) < ${(R * R).toFixed(1)}) {\n` + chunk.slice(a, b) + '\n}\n' + chunk.slice(b));
  };
  mat.customProgramCacheKey = () => 'perto-' + key + (cullFar ? '-longe' : '');
  return mat;
}
const offsetMat = (m, f) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f * 2; return m; };

function makeTex(seed) {
  const r = rng(seed);
  const T = {};
  T.ground = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5b6340'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 9000, '120,118,80', 0.08, 0.35, 3, r); noise(g, w, h, 5000, '150,135,100', 0.05, 0.25, 4, r);
    noise(g, w, h, 6000, '50,60,30', 0.1, 0.3, 2, r);
  });
  T.lawn = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4f6a34'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 16000, '95,125,55', 0.1, 0.45, 2, r); noise(g, w, h, 5000, '40,55,25', 0.1, 0.3, 2, r);
  });
  T.sand = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#b9a787'; g.fillRect(0, 0, w, h); noise(g, w, h, 6000, '90,80,60', 0.05, 0.25, 1.5, r); noise(g, w, h, 3000, '230,220,200', 0.05, 0.3, 1.5, r); });
  T.dirt = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#7c6a52'; g.fillRect(0, 0, w, h); noise(g, w, h, 6000, '50,40,30', 0.05, 0.3, 2, r); });
  // asfalto com faixa central amarela tracejada (vias de mão dupla) — tile de 8 m × 1 largura
  T.road = canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#3a3b3d'; g.fillRect(0, 0, w, h); noise(g, w, h, 4000, '190,190,190', 0.02, 0.12, 1.3, r); noise(g, w, h, 1500, '20,20,20', 0.1, 0.3, 2, r);
    g.fillStyle = 'rgba(214,170,40,0.85)'; g.fillRect(w / 2 - 1.5, 0, 3, h / 2);
    g.fillStyle = 'rgba(225,225,220,0.55)'; g.fillRect(2, 0, 1.5, h); g.fillRect(w - 3.5, 0, 1.5, h);
  });
  // lajota / paralelepípedo (vias locais)
  T.blocks = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4d4b47'; g.fillRect(0, 0, w, h);
    const bw = 32, bh = 22;
    for (let y = 0; y < h; y += bh) for (let x = -((y / bh) % 2) * bw / 2; x < w; x += bw) {
      const t = 0.75 + r() * 0.35; g.fillStyle = `rgb(${[128 * t, 124 * t, 118 * t].map(Math.round)})`;
      g.beginPath(); g.roundRect ? g.roundRect(x + 2, y + 2, bw - 4, bh - 4, 4) : g.rect(x + 2, y + 2, bw - 4, bh - 4); g.fill();
    }
    noise(g, w, h, 3000, '30,30,30', 0.05, 0.2, 2, r);
  });
  T.sidewalk = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#8f8a82'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { const t = 0.9 + r() * 0.2; g.fillStyle = `rgb(${[170 * t, 164 * t, 155 * t].map(Math.round)})`; g.fillRect(x + 1, y + 1, 30, 30); }
    noise(g, w, h, 2500, '60,55,50', 0.04, 0.2, 1.5, r);
  });
  // fachada de loja: testeira, vitrine e porta de enrolar — tile 4 m × 3,2 m
  const shopDraw = (em) => (g, w, h) => {
    g.fillStyle = em ? '#000' : '#d8d3c8'; g.fillRect(0, 0, w, h);
    if (!em) noise(g, w, h, 1500, '90,90,90', 0.03, 0.1, 2, r);
    const top = h * 0.2; // testeira
    if (!em) { g.fillStyle = '#9a958c'; g.fillRect(0, top - 4, w, 4); }
    // vitrine (esq.) e porta de vidro (dir.)
    const glass = (x0, x1, y0, y1) => {
      if (em) { g.fillStyle = 'rgb(255,196,128)'; g.globalAlpha = 0.8; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.globalAlpha = 1; return; }
      g.fillStyle = '#26303a'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x0, y0, x1 - x0, 4);
      g.strokeStyle = '#5c6268'; g.lineWidth = 3; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    };
    glass(w * 0.06, w * 0.56, top + 10, h * 0.86);
    glass(w * 0.64, w * 0.94, top + 6, h * 0.995);
    if (!em) { g.strokeStyle = '#5c6268'; g.lineWidth = 2; g.beginPath(); g.moveTo(w * 0.31, top + 10); g.lineTo(w * 0.31, h * 0.86); g.stroke(); }
    // porta de aço enrolada (caixa)
    if (!em) { g.fillStyle = '#8c9094'; g.fillRect(w * 0.04, top + 2, w * 0.92, 7); }
  };
  T.shop = canvasTex(256, 205, shopDraw(false)); T.shopEm = canvasTex(256, 205, shopDraw(true));
  // telha cerâmica
  T.tile = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#7a3b26'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = -((y / 16) % 2) * 8; x < w; x += 16) {
      const t = 0.8 + r() * 0.35; g.fillStyle = `rgb(${[178 * t, 88 * t, 58 * t].map(Math.round)})`;
      g.beginPath(); g.ellipse(x + 8, y + 9, 7, 9, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + 14, 16, 2);
    }
  });
  // folhas (cachos com transparência), folha de palmeira e cascas
  T.leaf = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * w * 0.44, x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d;
      const t = 0.6 + r() * 0.5; g.fillStyle = `rgb(${[58 * t, 92 * t, 38 * t].map(Math.round)})`;
      g.save(); g.translate(x, y); g.rotate(r() * Math.PI * 2); g.beginPath(); g.ellipse(0, 0, 7 + r() * 5, 3 + r() * 2, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  });
  T.frond = canvasTex(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#6d7a3c'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    for (let x = 8; x < w - 6; x += 6) {
      const len = (h / 2 - 4) * Math.sin(Math.PI * (0.15 + 0.85 * x / w)) * (0.8 + r() * 0.25);
      for (const s of [-1, 1]) {
        const t = 0.65 + r() * 0.45; g.strokeStyle = `rgb(${[64 * t, 98 * t, 40 * t].map(Math.round)})`; g.lineWidth = 2.6;
        g.beginPath(); g.moveTo(x, h / 2); g.quadraticCurveTo(x + len * 0.35, h / 2 + s * len * 0.6, x + len * 0.55, h / 2 + s * len); g.stroke();
      }
    }
  });
  T.bark = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#5a4c3e'; g.fillRect(0, 0, w, h); for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(30,22,16,${0.2 + r() * 0.4})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 8 + r() * 30); } noise(g, w, h, 1500, '140,125,105', 0.05, 0.25, 1.5, r); });
  T.palmBark = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#7d7468'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 10 + r() * 6) { g.fillStyle = 'rgba(40,34,28,0.55)'; g.fillRect(0, y, w, 2 + r() * 2); } noise(g, w, h, 1500, '170,160,145', 0.05, 0.25, 1.5, r); });
  return T;
}

// ---------------------------------------------------------------------
//  Árvores procedurais (jerivá, copa larga e arbustos)
// ---------------------------------------------------------------------
function broadleafGeo(r, scale = 1, cards = 34) {
  const trunkH = (2.2 + r() * 1.2) * scale, Rc = (2.2 + r() * 1.0) * scale, Hc = Rc * (0.75 + r() * 0.15);
  const tr = [];
  const t0 = new THREE.CylinderGeometry(0.11 * scale, 0.17 * scale, trunkH + Hc * 0.4, 7, 1, true); t0.translate(0, (trunkH + Hc * 0.4) / 2, 0); tr.push(t0);
  for (let k = 0; k < 4; k++) { // galhos
    const a = k / 4 * Math.PI * 2 + r(), len = Rc * 0.75;
    const b = new THREE.CylinderGeometry(0.035 * scale, 0.07 * scale, len, 5, 1, true); b.translate(0, len / 2, 0);
    b.rotateZ(-0.9 - r() * 0.3); b.rotateY(a); b.translate(0, trunkH * 0.85, 0); tr.push(b);
  }
  const trunk = mergeGeometries(tr.map(g => g.toNonIndexed()));
  const cy = trunkH + Hc * 0.55, pos = [], nor = [], uv = [];
  for (let i = 0; i < cards; i++) {
    // ponto no elipsoide (mais na casca), cartão orientado ao acaso
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.pow(r(), 0.35), s = Math.sqrt(1 - u * u);
    const c = V(Math.cos(th) * s * Rc * rr, u * Hc * rr * 0.9, Math.sin(th) * s * Rc * rr).add(V(0, cy, 0));
    const sz = (1.3 + r() * 0.6) * scale, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * Math.PI, r() * Math.PI, r() * Math.PI));
    const ex = V(sz / 2, 0, 0).applyQuaternion(q), ey = V(0, sz / 2, 0).applyQuaternion(q);
    const P4 = [c.clone().sub(ex).sub(ey), c.clone().add(ex).sub(ey), c.clone().add(ex).add(ey), c.clone().sub(ex).add(ey)];
    const U4 = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(P4[k].x, P4[k].y, P4[k].z);
      const n = P4[k].clone().sub(V(0, cy - Hc * 0.25, 0)).normalize(); nor.push(n.x, n.y, n.z); // normais "de esfera": copa sombreada como volume
      uv.push(...U4[k]);
    }
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); crown.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); crown.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return { trunk, crown, h: cy + Hc };
}
function palmGeo(r, scale = 1) {
  const Ht = (6.5 + r() * 3) * scale, lean = V((r() - 0.5) * 0.9, 0, (r() - 0.5) * 0.9);
  const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(V(lean.x * t * t, Ht * t, lean.z * t * t)); }
  const trunk = polyTube(pts, 0.15 * scale, 7);
  { const uvA = trunk.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setY(i, uvA.getY(i)); }
  const top = pts[pts.length - 1], pos = [], nor = [], uv = [];
  const nF = 11;
  for (let f = 0; f < nF; f++) {
    const az = f / nF * Math.PI * 2 + r() * 0.3, young = f % 5 === 0;
    const len = (young ? 2.4 : 3.2 + r() * 0.6) * scale, elev = young ? 1.0 : 0.35 + r() * 0.35, droop = young ? 0.4 : 1.6 + r() * 0.6;
    const dir = V(Math.cos(az), 0, Math.sin(az)), side = V(-dir.z, 0, dir.x);
    const N = 5, rows = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, along = len * t;
      const c = top.clone().addScaledVector(dir, along * Math.cos(elev)).add(V(0, along * Math.sin(elev) - droop * t * t * len / 3, 0));
      const halfW = 0.5 * scale * Math.sin(Math.PI * Math.min(1, 0.12 + t)) * (young ? 0.6 : 1);
      // folíolos em "V" (dobrados para cima)
      rows.push([c.clone().addScaledVector(side, -halfW).add(V(0, halfW * 0.35, 0)), c, c.clone().addScaledVector(side, halfW).add(V(0, halfW * 0.35, 0)), t]);
    }
    for (let i = 1; i <= N; i++) {
      const [l0, c0, r0, t0] = rows[i - 1], [l1, c1, r1, t1] = rows[i];
      const n = V(0, 1, 0);
      const add = (p, u, v) => { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(u, v); };
      // metade esquerda (v 0..0,5) e direita (0,5..1)
      add(l0, t0, 0); add(c0, t0, 0.5); add(c1, t1, 0.5); add(l0, t0, 0); add(c1, t1, 0.5); add(l1, t1, 0);
      add(c0, t0, 0.5); add(r0, t0, 1); add(r1, t1, 1); add(c0, t0, 0.5); add(r1, t1, 1); add(c1, t1, 0.5);
    }
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); crown.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); crown.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return { trunk, crown, h: Ht + 1 };
}

// ---------------------------------------------------------------------
//  Montagem do entorno
// ---------------------------------------------------------------------
const KIND = { h: 'casa', a: 'apart', y: 'edif', r: 'comercio', c: 'comercio', g: 'garagem', o: 'hotel', s: 'galpao', t: 'casa', k: 'quiosque', f: 'garagem', p: 'publico' };
const COMMERCE = new Set(['restaurant', 'supermarket', 'pharmacy', 'bakery', 'butcher', 'clothes', 'fast_food', 'cafe', 'ice_cream', 'stationery', 'lottery', 'hairdresser', 'estate_agent', 'furniture', 'florist', 'seafood', 'fishing', 'gift', 'handicraft', 'bicycle', 'convenience', 'hardware', 'bar', 'pub', 'bank', 'fuel', 'beauty', 'optician', 'shoes', 'mobile_phone', 'variety_store', 'kiosk', 'pet', 'car_repair', 'dentist', 'clinic', 'doctors', 'travel_agency', 'craft', 'guest_house', 'hotel', 'townhall', 'post_office', 'company', 'books', 'deli', 'greengrocer', 'beverages', 'jewelry', 'electronics', 'chemist', 'cosmetics', 'mall', 'department_store', 'laundry', 'tailor', 'computer', 'copyshop', 'veterinary', 'pizza', 'taxi']);

export async function buildRealEnvironment(M, base = 'data/') {
  const [txt, terr, font] = await Promise.all([
    fetch(base + 'entorno_osm.txt').then(r => { if (!r.ok) throw new Error('entorno_osm.txt ' + r.status); return r.text(); }),
    fetch(base + 'terreno.json').then(r => { if (!r.ok) throw new Error('terreno.json ' + r.status); return r.json(); }),
    new FontLoader().loadAsync('vendor/fonts/helvetiker_bold.typeface.json').catch(() => null),
  ]);
  const T = makeTex(31), r = rng(77);
  const g = new THREE.Group(); g.name = 'Entorno';
  const pick = [], reflHide = [], city = [], lods = [];
  const G = P.ground;

  // ---------- parse ----------
  const B = [], R = [], PL = [], POI = [], TREES = [];
  for (const line of txt.split('\n')) {
    const f = line.split('|');
    if (f[0] === 'B') { const ring = hp(f[6] || ''); if (ring.length >= 3) B.push({ kind: f[1], lv: +f[2] || 0, h: +f[3] || 0, shop: f[4], name: f[5], ring }); }
    else if (f[0] === 'R') R.push({ hw: f[1], bridge: f[2] === '1', name: f[3], pts: hp(f[4] || '') });
    else if (f[0] === 'P') PL.push({ kind: f[1], ring: hp(f[2] || '') });
    else if (f[0] === 'I') { const [x, z] = f[1].split(',').map(Number); POI.push({ x: warpX(x / 2), z: z / 2, type: f[2], name: f[3] }); }
    else if (f[0] === 'T') { const [x, z] = f[1].split(',').map(Number); TREES.push([warpX(x / 2), z / 2]); }
  }
  const warpPoly = (poly) => poly.map(ring => ring.map(([x, z]) => [warpX(x), z]));
  const land = terr.land.map(warpPoly);
  const onLand = (x, z) => land.some(p => inPoly(x, z, p));
  const nearBridge = (x, z, m = 0) => Math.abs(z) < 3.2 + m && Math.abs(x) < P.L / 2 + P.anchorDist + 4 + m;

  // grade espacial das edificações (para árvores, letreiros e postes)
  const CELL = 20, grid = new Map();
  B.forEach((b, i) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    b.ring.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
    b.bb = [x0, x1, z0, z1]; b.area = Math.abs(area(b.ring));
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const k = cx + ',' + cz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
    }
  });
  const bldAt = (x, z, pad = 0) => {
    const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL), l = grid.get(k); if (!l) return -1;
    for (const i of l) { const b = B[i], bb = b.bb; if (x < bb[0] - pad || x > bb[1] + pad || z < bb[2] - pad || z > bb[3] + pad) continue; if (inRing(x, z, b.ring)) return i; if (pad && b.ring.some((p, j) => segDist(x, z, p, b.ring[(j + 1) % b.ring.length]) < pad)) return i; }
    return -1;
  };
  const roadSegs = [];
  R.forEach(rd => { if (!rd.bridge && rd.hw !== 'steps') for (let i = 1; i < rd.pts.length; i++) roadSegs.push([rd.pts[i - 1], rd.pts[i], rd.hw]); });
  const WIDTH = { secondary: 9, tertiary: 8, residential: 7, living_street: 5, service: 4, footway: 2, path: 1.6 };
  const nearRoad = (x, z, pad = 0) => roadSegs.some(([a, b, hw]) => segDist(x, z, a, b) < (WIDTH[hw] || 5) / 2 + pad);

  // ---------- terreno: quarteirões na cota da praça, muro de margem até o fundo ----------
  const groundMat = nearSpots(new THREE.MeshStandardMaterial({ map: T.ground, roughness: 1 }), 'terreno', 140);
  const quayMat = M.concreteGrey;
  {
    const top = new Acc(), wall = new Acc();
    for (const poly of land) {
      capInto(top, poly, G, 6);
      poly.forEach((ring, k) => wallsInto(wall, ring, -2.5, G, 3, 3, null, (area(ring) > 0 ? 1 : -1) * (k ? -1 : 1)));
    }
    // campo distante: projeção radial das bordas de terra até ~4 km (o rio continua nas brechas)
    const K = 8, far = new Acc(), up = [0, 1, 0], E = 520;
    const onEdge = (p) => Math.abs(Math.abs(p[0]) - E) < 0.6 || Math.abs(Math.abs(p[1]) - E) < 0.6;
    for (const poly of land) {
      const ring = poly[0];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (!onEdge(a) || !onEdge(b)) continue;
        const sameX = Math.abs(a[0] - b[0]) < 0.6 && Math.abs(Math.abs(a[0]) - E) < 0.6, sameZ = Math.abs(a[1] - b[1]) < 0.6 && Math.abs(Math.abs(a[1]) - E) < 0.6;
        if (!sameX && !sameZ) continue;
        const A = [a[0], G - 0.05, a[1]], Bv = [b[0], G - 0.05, b[1]], A2 = [a[0] * K, G - 0.05, a[1] * K], B2 = [b[0] * K, G - 0.05, b[1] * K];
        far.quad(A, Bv, B2, A2, up, [A[0] / 6, -A[2] / 6], [Bv[0] / 6, -Bv[2] / 6], [B2[0] / 6, -B2[2] / 6], [A2[0] / 6, -A2[2] / 6]);
      }
    }
    const topM = new THREE.Mesh(top.geo(), groundMat); topM.name = 'Terreno_OSM'; topM.receiveShadow = true; g.add(topM); pick.push(topM); reflHide.push(topM);
    const wallM = new THREE.Mesh(wall.geo(), quayMat); wallM.name = 'Muro_margem'; wallM.receiveShadow = true; g.add(wallM); pick.push(wallM);
    if (!far.empty) { const fg = fixUp(far.geo()); fg.computeVertexNormals(); const fm = new THREE.Mesh(fg, groundMat); fm.name = 'Terreno_distante'; g.add(fm); reflHide.push(fm); }
  }

  // ---------- praças, gramados, piscinas, estacionamentos, trapiches ----------
  const mats = {
    lawn: offsetMat(nearSpots(new THREE.MeshStandardMaterial({ map: T.lawn, roughness: 1 }), 'gramado'), -1),
    sand: offsetMat(nearSpots(new THREE.MeshStandardMaterial({ map: T.sand, roughness: 1 }), 'areia'), -1),
    dirt: offsetMat(nearSpots(new THREE.MeshStandardMaterial({ map: T.dirt, roughness: 1 }), 'terra'), -1),
    park: offsetMat(nearSpots(new THREE.MeshStandardMaterial({ map: T.road, color: 0xcfcfcf, roughness: 0.95 }), 'estac'), -1),
    pool: offsetMat(new THREE.MeshStandardMaterial({ color: 0x2f8fb0, roughness: 0.08, metalness: 0, emissive: 0x2a9fd0, emissiveIntensity: 0 }), -2),
    side: offsetMat(nearSpots(new THREE.MeshStandardMaterial({ map: T.sidewalk, roughness: 0.9 }), 'calcada'), -2),
    road: offsetMat(nearSpots(new THREE.MeshStandardMaterial({ map: T.road, roughness: 0.92 }), 'asfalto'), -3),
    blocks: offsetMat(nearSpots(new THREE.MeshStandardMaterial({ map: T.blocks, roughness: 0.9 }), 'lajota'), -3),
    pavers: offsetMat(nearSpots(M.pavers.clone(), 'praca'), -2),
  };
  {
    const acc = { lawn: new Acc(), sand: new Acc(), dirt: new Acc(), park: new Acc(), pool: new Acc() }, pier = new Acc(), pierW = new Acc();
    for (const p of PL) {
      const ring = p.ring; if (ring.length < 3) continue;
      const k = { park: 'lawn', pitch: 'lawn', greenfield: 'lawn', playground: 'sand', parking: 'park', swimming_pool: 'pool', construction: 'dirt' }[p.kind];
      if (p.kind === 'pier') { capInto(pier, [ring], 1.25, 1.2); wallsInto(pierW, ring, 0.9, 1.25, 1.2, 1.2); continue; }
      if (p.kind === 'bleachers') { capInto(acc.dirt, [ring], G + 0.6, 4); continue; }
      if (k) capInto(acc[k], [ring], G + (k === 'pool' ? 0.02 : 0.015), k === 'park' ? 7 : 4);
    }
    for (const [k, a] of Object.entries(acc)) if (!a.empty) { const m = new THREE.Mesh(a.geo(), mats[k]); m.name = 'Area_' + k; m.receiveShadow = true; m.renderOrder = -1; g.add(m); reflHide.push(m); if (k === 'pool') m.userData.pool = true; }
    if (!pier.empty) { const m = new THREE.Mesh(mergeGeometries([pier.geo(), pierW.geo()]), M.wood); m.name = 'Trapiche'; m.castShadow = m.receiveShadow = true; g.add(m); pick.push(m); }
  }

  // ---------- vias, calçadas e a ponte de concreto ----------
  {
    const road = new Acc(), blocks = new Acc(), side = new Acc();
    for (const rd of R) {
      if (rd.bridge || rd.hw === 'steps' || rd.pts.length < 2) continue;
      const w = WIDTH[rd.hw] || 5;
      if (rd.hw === 'footway' || rd.hw === 'path') { ribbonInto(side, rd.pts, w, G + 0.03, 2, w / 2); continue; }
      const main = rd.hw === 'secondary' || rd.hw === 'tertiary';
      ribbonInto(main ? road : blocks, rd.pts, w, G + 0.05, main ? 8 : 2, main ? 1 : w / 2);
      if (rd.hw !== 'service') for (const s of [-1, 1]) ribbonInto(side, rd.pts, 2.2, G + 0.035, 2, 1.1, s * (w / 2 + 1.1));
    }
    for (const [a, m, n] of [[road, mats.road, 'Vias_asfalto'], [blocks, mats.blocks, 'Vias_lajota'], [side, mats.side, 'Calcadas']]) {
      if (a.empty) continue; const mesh = new THREE.Mesh(fixUp(a.geo()), m); mesh.name = n; mesh.receiveShadow = true; mesh.renderOrder = n === 'Calcadas' ? -2 : -3; g.add(mesh); pick.push(mesh); reflHide.push(mesh);
    }
    // ponto de chegada da ponte pênsil: piso de concreto/blocos ao pé das escadas
    const pz = new Acc();
    for (const s of [-1, 1]) {
      const x0 = s * (P.L / 2 - 1.5), x1 = s * (P.L / 2 + P.anchorDist + 2);
      const z0 = s > 0 ? -10 : -6.5; // SC: a praça avança para o lado do canteiro do letreiro
      capInto(pz, [[[Math.min(x0, x1), z0], [Math.max(x0, x1), z0], [Math.max(x0, x1), 6.5], [Math.min(x0, x1), 6.5]]], G + 0.04, 2);
    }
    const pzm = new THREE.Mesh(pz.geo(), mats.pavers); pzm.name = 'Praca'; pzm.receiveShadow = true; pzm.renderOrder = -2; g.add(pzm); pick.push(pzm); reflHide.push(pzm);
  }
  // ponte José Mário Soares Noronha (rodoviária) — posição real; perfil e seção estimados
  {
    const rd = R.find(x => x.bridge && x.hw !== 'path');
    if (rd) {
      const a = rd.pts[0], b = rd.pts[rd.pts.length - 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const cb = new THREE.Group(); cb.name = 'Ponte_concreto';
      const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], nrm = [-dir[1], dir[0]];
      const yAt = (t) => G + 4.6 * Math.sin(Math.PI * t), W = 12;
      const deck = new Acc(), sideW = new Acc(), N = 24;
      const at = (t, o, y) => [a[0] + dir[0] * len * t + nrm[0] * o, y, a[1] + dir[1] * len * t + nrm[1] * o];
      for (let i = 1; i <= N; i++) {
        const t0 = (i - 1) / N, t1 = i / N, y0 = yAt(t0), y1 = yAt(t1);
        deck.quad(at(t0, -W / 2, y0), at(t0, W / 2, y0), at(t1, W / 2, y1), at(t1, -W / 2, y1), [0, 1, 0], [0, t0 * len / 8], [1, t0 * len / 8], [1, t1 * len / 8], [0, t1 * len / 8]);
        for (const s of [-1, 1]) { // face lateral da viga
          const n = [s * nrm[0], 0, s * nrm[1]];
          const A0 = at(t0, s * W / 2, y0 - 1.3), B0 = at(t1, s * W / 2, y1 - 1.3), B1 = at(t1, s * W / 2, y1 + 0.95), A1 = at(t0, s * W / 2, y0 + 0.95);
          if (s > 0) sideW.quad(A0, A1, B1, B0, n, [0, 0], [0, 1], [1, 1], [1, 0]); else sideW.quad(A0, B0, B1, A1, n, [0, 0], [1, 0], [1, 1], [0, 1]);
          const C0 = at(t0, s * W / 2, y0 - 1.3), C1 = at(t1, s * W / 2, y1 - 1.3), D1 = at(t1, 0, y1 - 1.3), D0 = at(t0, 0, y0 - 1.3); // fundo
          sideW.quad(C0, D0, D1, C1, [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1]);
        }
      }
      const dm = new THREE.Mesh(fixUp(deck.geo()), mats.road); dm.receiveShadow = true; dm.name = 'Tabuleiro_concreto';
      const sm = new THREE.Mesh(sideW.geo(), M.concreteGrey); sm.castShadow = sm.receiveShadow = true;
      cb.add(dm, sm);
      const pil = [];
      for (let t = 0.18; t < 0.9; t += 0.16) { const p0 = at(t, 0, 0); if (!onLand(p0[0], p0[2])) for (const o of [-3.5, 3.5]) { const q = at(t, o, 0); pil.push([V(q[0], -1, q[2]), V(q[0], yAt(t) - 1.3, q[2])]); } }
      if (pil.length) cb.add(cylSegs(pil, 0.6, M.concreteGrey, 'Pilares_concreto', 12));
      const lamps = [], heads = [];
      for (let t = 0.1; t < 0.95; t += 0.2) for (const s of [-1, 1]) { const q = at(t, s * (W / 2 - 0.3), yAt(t)); lamps.push([V(q[0], q[1], q[2]), V(q[0], q[1] + 8, q[2])]); const h = at(t, s * (W / 2 - 1.8), yAt(t) + 7.9); heads.push(V(...h)); }
      cb.add(cylSegs(lamps, 0.08, M.pole, 'Postes_ponte', 6));
      const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.12, 0.3), M.lampHead, heads.length);
      heads.forEach((p, i) => hm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z))); cb.add(hm);
      g.add(cb); city.push(cb); pick.push(dm);
    }
  }

  // ---------- comércios: POIs → edificação que os contém ----------
  const shopOf = new Map(); // índice da edificação → lista de nomes
  B.forEach((b, i) => { if (b.name && (COMMERCE.has(b.shop) || b.kind === 'r' || b.kind === 'c' || b.kind === 'o')) shopOf.set(i, [b.name]); });
  for (const p of POI) {
    let i = bldAt(p.x, p.z);
    if (i < 0) i = bldAt(p.x, p.z, 8);
    if (i < 0 || !p.name) continue;
    if (!shopOf.has(i)) shopOf.set(i, []);
    if (!shopOf.get(i).includes(p.name)) shopOf.get(i).push(p.name);
  }

  // ---------- edificações ----------
  const pal = {
    casa: ['#efe9dc', '#f3ecd2', '#e9dcc0', '#f1e2b3', '#dfe8ea', '#cfe0e8', '#f0d9c8', '#e6efe0', '#ffffff', '#ead9d0', '#d9d4c9'],
    apart: ['#e9e6df', '#f2efe8', '#dcd8cf', '#e4ddd0', '#d6dbe0', '#ece4d6'],
    comercio: ['#f2efe8', '#efe3c7', '#e2e9ee', '#f6f1e6', '#e8dccb'],
  };
  const walls = { casa: new Acc(), apart: new Acc() }, shopBand = new Acc(), roofsT = new Acc(), roofsF = new Acc();
  const signs = []; // { pos, nrm, w, text }
  const lit = new THREE.Color();
  B.forEach((b, i) => {
    const kind = KIND[b.kind] || 'edif', hash = Math.abs(Math.sin(b.ring[0][0] * 12.9898 + b.ring[0][1] * 78.233) * 43758.5) % 1;
    if (b.ring.some(([x, z]) => nearBridge(x, z, -1))) return;
    let H;
    if (b.lv) H = b.lv * 3.0 + 0.4;
    else if (b.h) H = b.h;
    else H = { casa: hash < 0.72 ? 3.3 : 6.3, apart: 12.4, comercio: b.area > 300 ? 5.5 : 4.4, garagem: 2.7, galpao: 4.2, quiosque: 3.0, hotel: 7.0, publico: 7.2 }[kind] ?? (b.area < 110 ? 3.3 : hash < 0.6 ? 3.6 : 6.4);
    const floor = kind === 'apart' || kind === 'hotel' ? 3.0 : 3.2;
    const shop = shopOf.has(i);
    const palK = kind === 'apart' || kind === 'hotel' ? 'apart' : shop ? 'comercio' : 'casa';
    const colS = pal[palK][Math.floor(hash * 97) % pal[palK].length];
    const col = new THREE.Color().setStyle(colS, THREE.SRGBColorSpace);
    const acc = palK === 'apart' ? walls.apart : walls.casa;
    const y0 = G - 0.3;
    if (shop && H > 3.4) {
      wallsInto(shopBand, b.ring, y0, G + 3.2, 4, 3.5, col);
      wallsInto(acc, b.ring, G + 3.2, G + H, 12, 4 * floor, col);
    } else if (shop) wallsInto(shopBand, b.ring, y0, G + H, 4, 3.5, col);
    else wallsInto(acc, b.ring, y0, G + H, 12, 4 * floor, col);
    // telhado: 4 águas cerâmico nas casas compactas; laje nos demais
    const ob = obb(b.ring), compact = ob && b.area / ob.A > 0.8;
    const roofCol = lit.setHSL(0.03 + hash * 0.03, 0.45, 0.32 + hash * 0.12, THREE.SRGBColorSpace).clone();
    const fibro = hash > 0.78;
    if ((kind === 'casa' || kind === 'edif' || kind === 'quiosque') && compact && b.area < 420 && H < 7) {
      const o = 0.45, x0 = ob.x0 - o, x1 = ob.x1 + o, z0 = ob.z0 - o, z1 = ob.z1 + o;
      const along = (x1 - x0) >= (z1 - z0), half = (along ? z1 - z0 : x1 - x0) / 2, rh = half * Math.tan(26 * Math.PI / 180);
      const W = (u, v, y) => [u * ob.c - v * ob.s, y, u * ob.s + v * ob.c];
      const yb = G + H - 0.05, yt = yb + rh, cu = (x0 + x1) / 2, cv = (z0 + z1) / 2;
      const c = fibro ? new THREE.Color(0.55, 0.55, 0.53) : roofCol;
      let rp;
      if (along) { const ra = x0 + half, rb = x1 - half; rp = [[W(x0, z0, yb), W(x1, z0, yb), W(rb, cv, yt), W(ra, cv, yt)], [W(x1, z1, yb), W(x0, z1, yb), W(ra, cv, yt), W(rb, cv, yt)], [W(x1, z0, yb), W(x1, z1, yb), W(rb, cv, yt)], [W(x0, z1, yb), W(x0, z0, yb), W(ra, cv, yt)]]; }
      else { const ra = z0 + half, rb = z1 - half; rp = [[W(x1, z0, yb), W(x1, z1, yb), W(cu, rb, yt), W(cu, ra, yt)], [W(x0, z1, yb), W(x0, z0, yb), W(cu, ra, yt), W(cu, rb, yt)], [W(x1, z1, yb), W(x0, z1, yb), W(cu, rb, yt)], [W(x0, z0, yb), W(x1, z0, yb), W(cu, ra, yt)]]; }
      for (const f of rp) {
        const a = V(...f[0]), bb = V(...f[1]), cc = V(...f[2]);
        let n = bb.clone().sub(a).cross(cc.clone().sub(a)).normalize();
        let pts = f; if (n.y < 0) { pts = [...f].reverse(); n.negate(); }
        const uvOf = (p) => [(p[0] * ob.c + p[2] * ob.s) / 2, (p[1] - yb) / Math.max(0.3, Math.sqrt(1 - n.y * n.y)) / 2 + (-p[0] * ob.s + p[2] * ob.c) * 0.0];
        const na = [n.x, n.y, n.z];
        if (pts.length === 4) roofsT.quad(pts[0], pts[1], pts[2], pts[3], na, uvOf(pts[0]), uvOf(pts[1]), uvOf(pts[2]), uvOf(pts[3]), c);
        else roofsT.tri(pts[0], pts[1], pts[2], na, na, na, uvOf(pts[0]), uvOf(pts[1]), uvOf(pts[2]), c);
      }
      // oitão/beiral: fecha o vão entre parede e beiral com a própria laje
      capInto(roofsF, [b.ring], G + H - 0.06, 4, new THREE.Color(0.6, 0.6, 0.58));
    } else {
      const k = 0.62 + hash * 0.2; capInto(roofsF, [b.ring], G + H, 4, new THREE.Color(k, k, k * 0.97));
      // platibanda (meio metro)
      wallsInto(palK === 'apart' ? walls.apart : walls.casa, b.ring, G + H, G + H + 0.5, 12, 4 * floor, col);
    }
    // letreiro sobre a porta, na face voltada para a via mais próxima
    if (shop) {
      const names = shopOf.get(i), sgn = area(b.ring) > 0 ? 1 : -1;
      let best = null;
      for (let j = 0; j < b.ring.length; j++) {
        const a = b.ring[j], c = b.ring[(j + 1) % b.ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 3) continue;
        const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        let d = Infinity; for (const [p, q] of roadSegs) d = Math.min(d, segDist(m[0], m[1], p, q));
        const score = d - L * 0.15; if (!best || score < best.score) best = { score, a, c, L, m };
      }
      if (best) {
        const dx = best.c[0] - best.a[0], dz = best.c[1] - best.a[1];
        const n = V(sgn * dz / best.L, 0, -sgn * dx / best.L);
        names.slice(0, 2).forEach((nm, k) => {
          const w = Math.min(best.L * 0.85, Math.max(2.2, nm.length * 0.32));
          const off = names.length > 1 ? (k - 0.5) * Math.min(best.L / 2, w + 0.3) : 0;
          const t = V(dx / best.L, 0, dz / best.L);
          signs.push({ pos: V(best.m[0], G + 3.55, best.m[1]).addScaledVector(n, 0.09).addScaledVector(t, off), n, t, w: Math.min(w, best.L / names.length * 0.9), text: nm, hash: (hash + k * 0.37) % 1 });
        });
      }
    }
  });
  const facadeHouse = M.house, facadeApt = M.facade;
  facadeHouse.color.set(0xffffff); facadeHouse.vertexColors = true; nearSpots(facadeHouse, 'casas'); facadeHouse.needsUpdate = true;
  facadeApt.color.set(0xffffff); facadeApt.vertexColors = true; nearSpots(facadeApt, 'predios'); facadeApt.needsUpdate = true;
  const shopMat = nearSpots(new THREE.MeshStandardMaterial({ map: T.shop, emissiveMap: T.shopEm, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.6 }), 'lojas');
  const tileMat = nearSpots(new THREE.MeshStandardMaterial({ map: T.tile, vertexColors: true, roughness: 0.8 }), 'telhas');
  const slabMat = nearSpots(new THREE.MeshStandardMaterial({ map: M.concrete.map, vertexColors: true, roughness: 0.95 }), 'lajes');
  const bld = new THREE.Group(); bld.name = 'Edificacoes_OSM';
  for (const [a, m, n] of [[walls.casa, facadeHouse, 'Casas'], [walls.apart, facadeApt, 'Predios'], [shopBand, shopMat, 'Comercios'], [roofsT, tileMat, 'Telhados'], [roofsF, slabMat, 'Lajes']]) {
    if (a.empty) continue; const mesh = new THREE.Mesh(a.geo(), m); mesh.name = n; mesh.castShadow = mesh.receiveShadow = true; bld.add(mesh); pick.push(mesh);
    if (n === 'Telhados' || n === 'Lajes') reflHide.push(mesh); // de baixo d'água não se veem
  }
  g.add(bld); city.push(bld);

  // ---------- letreiros dos comércios (atlas de texto) ----------
  let signMat = null;
  if (signs.length) {
    const near = signs.sort((a, b) => a.pos.length() - b.pos.length()).slice(0, 112);
    const cols = 4, rows = Math.ceil(near.length / cols), cw = 512, ch = 96;
    const cv = document.createElement('canvas'); cv.width = cols * cw; cv.height = rows * ch;
    const cx = cv.getContext('2d');
    const bgs = ['#c8102e', '#0b4ea2', '#127a3a', '#f2c200', '#ffffff', '#1b1b1b', '#e05a00', '#6a1b9a', '#00838f', '#f5f0e6'];
    const ecv = document.createElement('canvas'); ecv.width = cv.width; ecv.height = cv.height; const ex = ecv.getContext('2d');
    ex.fillStyle = '#000'; ex.fillRect(0, 0, ecv.width, ecv.height);
    const acc = new Acc();
    near.forEach((s, k) => {
      const cxp = (k % cols) * cw, cyp = Math.floor(k / cols) * ch, bg = bgs[Math.floor(s.hash * 977) % bgs.length];
      const light = ['#f2c200', '#ffffff', '#f5f0e6'].includes(bg), fg = light ? '#1a1a1a' : '#ffffff';
      cx.fillStyle = bg; cx.fillRect(cxp + 2, cyp + 2, cw - 4, ch - 4);
      cx.fillStyle = fg; let fs = 54; cx.font = `bold ${fs}px "Arial Narrow", Arial, sans-serif`;
      const txt = s.text.toUpperCase();
      while (cx.measureText(txt).width > cw - 30 && fs > 18) { fs -= 2; cx.font = `bold ${fs}px "Arial Narrow", Arial, sans-serif`; }
      cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(txt, cxp + cw / 2, cyp + ch / 2 + 2);
      // ~60% iluminados à noite (backlight); os demais só refletem
      if (s.hash < 0.6) { ex.fillStyle = light ? '#ffffff' : '#bbbbbb'; ex.globalAlpha = light ? 0.9 : 0.55; ex.fillRect(cxp + 2, cyp + 2, cw - 4, ch - 4); ex.globalAlpha = 1; ex.fillStyle = '#ffffff'; ex.font = cx.font; ex.textAlign = 'center'; ex.textBaseline = 'middle'; ex.fillText(txt, cxp + cw / 2, cyp + ch / 2 + 2); }
      const w = s.w, h = Math.min(0.9, w * ch / cw * 1.6), u0 = cxp / cv.width, u1 = (cxp + cw) / cv.width, v0 = 1 - (cyp + ch) / cv.height, v1 = 1 - cyp / cv.height;
      const A = s.pos.clone().addScaledVector(s.t, -w / 2).add(V(0, -h / 2, 0)), Bp = s.pos.clone().addScaledVector(s.t, w / 2).add(V(0, -h / 2, 0));
      const C = Bp.clone().add(V(0, h, 0)), D = A.clone().add(V(0, h, 0));
      // texto legível de fora: a ordem dos cantos depende de n × t
      const flip = s.t.clone().cross(V(0, 1, 0)).dot(s.n) < 0;
      const [P0, P1, P2, P3] = flip ? [Bp, A, D, C] : [A, Bp, C, D];
      acc.quad(P0.toArray(), P1.toArray(), P2.toArray(), P3.toArray(), s.n.toArray(), [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
    });
    const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const emap = new THREE.CanvasTexture(ecv); emap.colorSpace = THREE.SRGBColorSpace;
    signMat = nearSpots(new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5 }), 'letreiros');
    const geo = acc.geo();
    // garante a frente para fora (normal da face = n)
    const sm = new THREE.Mesh(geo, signMat); sm.name = 'Letreiros'; g.add(sm); city.push(sm); lods.push([sm, 260]);
  }

  // ---------- postes de iluminação pública ao longo das vias ----------
  const lampPos = []; let poolMat = null, poolsNear = null;
  {
    const poles = [], arms = [], heads = [];
    let flip = 1;
    for (const rd of R) {
      if (!['secondary', 'tertiary', 'residential', 'living_street'].includes(rd.hw) || rd.bridge) continue;
      const w = WIDTH[rd.hw], step = rd.hw === 'residential' ? 34 : 30;
      let acc = step * 0.5;
      for (let i = 1; i < rd.pts.length; i++) {
        const a = rd.pts[i - 1], b = rd.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-3) continue;
        const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
        while (acc <= L) {
          flip = -flip;
          const nx = -tz * flip, nz = tx * flip, x = a[0] + tx * acc + nx * (w / 2 + 0.5), z = a[1] + tz * acc + nz * (w / 2 + 0.5);
          if (onLand(x, z) && !nearBridge(x, z, 2) && bldAt(x, z, 0.3) < 0) {
            const hgt = rd.hw === 'residential' ? 8 : 9, ax = x - nx * 1.6, az = z - nz * 1.6;
            poles.push([V(x, G, z), V(x, G + hgt, z)]); arms.push([V(x, G + hgt - 0.4, z), V(ax, G + hgt, az)]);
            heads.push(V(ax, G + hgt - 0.05, az)); lampPos.push(V(ax, G + hgt - 0.12, az));
          }
          acc += step;
        }
        acc -= L;
      }
    }
    // praças da ponte: postes junto às escadas (posições estimadas)
    for (const s of [-1, 1]) for (const z of [-5.5, 5.5]) { const x = s * (P.L / 2 + 9); poles.push([V(x, G, z), V(x, G + 6, z)]); arms.push([V(x, G + 5.7, z), V(x, G + 6, z - Math.sign(z) * 0.9)]); heads.push(V(x, G + 5.95, z - Math.sign(z) * 0.9)); lampPos.push(V(x, G + 5.85, z - Math.sign(z) * 0.9)); }
    const pm = cylSegs(poles, 0.11, M.concreteGrey, 'Postes', 7); g.add(pm);
    const am = cylSegs(arms, 0.045, M.pole, 'Bracos_postes', 5); g.add(am);
    const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.12, 0.3), M.lampHead, heads.length);
    heads.forEach((p, i) => hm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    hm.name = 'Luminarias_publicas'; g.add(hm);
    reflHide.push(pm, am); lods.push([pm, 520], [am, 380]);
    // poças de luz no piso dos postes que não têm luz dinâmica (L = E·ρ/π, E = I·h/d³)
    const near = [...lampPos].sort((p, q) => p.length() - q.length()).filter(p => p.length() < 95).slice(0, 8);
    const dyn = new Set(near);
    const pools = lampPos.filter(p => !dyn.has(p));
    // os postes 4–8 só têm luz dinâmica na qualidade Média/Alta; no Leve recebem a poça
    const mkPools = (list, name) => {
      const im = new THREE.InstancedMesh(pg, poolMat, list.length);
      list.forEach((p, i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, G + 0.07, p.z)));
      im.name = name; g.add(im); reflHide.push(im); return im;
    };
    let pg = null;
    if (pools.length) {
      pg = new THREE.PlaneGeometry(36, 36).rotateX(-Math.PI / 2);
      poolMat = new THREE.ShaderMaterial({
        uniforms: { uL: { value: 0 }, uCol: { value: new THREE.Color(1, 0.62, 0.32) } },
        vertexShader: `varying vec3 vL; void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vL = (instanceMatrix * vec4(position, 1.0)).xyz - (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float uL; uniform vec3 uCol; varying vec3 vL;
          void main(){ float h = 8.6, r2 = dot(vL.xz, vL.xz); float k = pow(h * h / (h * h + r2), 1.5) * smoothstep(18.0, 11.0, sqrt(r2)); gl_FragColor = vec4(uCol * uL * k, 1.0); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
      });
      mkPools(pools, 'Pocas_luz_postes');
      if (near.length > 3) { poolsNear = mkPools(near.slice(3), 'Pocas_luz_postes_proximos'); poolsNear.visible = false; }
    }
  }

  // ---------- guarda-corpo azul na margem (trecho urbano junto à ponte) ----------
  {
    const posts = [], rails = [];
    for (const poly of land) for (const ring of poly) {
      const sg = area(ring) > 0 ? 1 : -1;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        if (L < 0.5 || Math.hypot(mx, mz) > 170 || Math.abs(a[0]) >= 519 || Math.abs(a[1]) >= 519) continue;
        const nx = sg * (b[1] - a[1]) / L, nz = -sg * (b[0] - a[0]) / L; // para fora (água)
        const A = V(a[0] - nx * 0.3, G, a[1] - nz * 0.3), Bq = V(b[0] - nx * 0.3, G, b[1] - nz * 0.3);
        const segs = Math.max(1, Math.round(L / 2.5));
        for (let k = 0; k < segs; k++) {
          const p0 = A.clone().lerp(Bq, k / segs), p1 = A.clone().lerp(Bq, (k + 1) / segs);
          if (nearBridge(p0.x, p0.z, -1.2) || nearBridge(p1.x, p1.z, -1.2)) continue;
          posts.push([p0, p0.clone().setY(G + 1.0)]);
          rails.push([p0.clone().setY(G + 1.0), p1.clone().setY(G + 1.0)], [p0.clone().setY(G + 0.5), p1.clone().setY(G + 0.5)]);
        }
      }
    }
    const pm = boxSegs(posts.map(([a, b]) => [a, b]), 0.05, 0.05, M.hullBlue, 'Guarda_corpo_cais');
    const rm = cylSegs(rails, 0.028, M.hullBlue, 'Guarda_corpo_cais_tubos', 6);
    g.add(pm, rm); reflHide.push(pm, rm); lods.push([pm, 220], [rm, 260]);
  }

  // ---------- árvores ----------
  const trees = { broad: [], palm: [], shrub: [] };
  const okTree = (x, z, pad = 1.2) => onLand(x, z) && !nearBridge(x, z, 2.5) && bldAt(x, z, pad) < 0 && !nearRoad(x, z, 0.4);
  TREES.forEach(([x, z]) => { if (onLand(x, z) && !nearBridge(x, z, 2)) trees[r() < 0.5 ? 'palm' : 'broad'].push([x, z]); });
  // arborização viária
  for (const rd of R) {
    if (!['secondary', 'tertiary', 'residential', 'living_street'].includes(rd.hw) || rd.bridge) continue;
    const w = WIDTH[rd.hw], beira = /beira/i.test(rd.name);
    let acc = 6 + r() * 8;
    for (let i = 1; i < rd.pts.length; i++) {
      const a = rd.pts[i - 1], b = rd.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-3) continue;
      const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
      while (acc <= L) {
        for (const s of [-1, 1]) {
          if (r() > (beira ? 0.75 : 0.32)) continue;
          const x = a[0] + tx * acc - tz * s * (w / 2 + 1.5), z = a[1] + tz * acc + tx * s * (w / 2 + 1.5);
          if (okTree(x, z, 0.8)) trees[beira || r() < 0.3 ? 'palm' : r() < 0.85 ? 'broad' : 'shrub'].push([x, z]);
        }
        acc += beira ? 9 + r() * 3 : 11 + r() * 8;
      }
      acc -= L;
    }
  }
  // margens: coqueiros/jerivás no passeio ribeirinho perto da ponte
  for (const poly of land) for (const ring of poly) {
    const sg = area(ring) > 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1 || Math.hypot(a[0], a[1]) > 320 || Math.abs(a[0]) >= 519 || Math.abs(a[1]) >= 519) continue;
      const nx = sg * (b[1] - a[1]) / L, nz = -sg * (b[0] - a[0]) / L;
      for (let t = 4; t < L; t += 11 + r() * 6) {
        if (r() > 0.55) continue;
        const x = a[0] + (b[0] - a[0]) * t / L - nx * 3.2, z = a[1] + (b[1] - a[1]) * t / L - nz * 3.2;
        if (okTree(x, z, 0.6)) trees[r() < 0.7 ? 'palm' : 'broad'].push([x, z]);
      }
    }
  }
  // gramados, praças e quintais
  for (const p of PL) if (['park', 'greenfield', 'resort'].includes(p.kind)) {
    const ring = p.ring, A = Math.abs(area(ring)); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    ring.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
    const n = Math.min(60, Math.round(A / (p.kind === 'resort' ? 260 : 150)));
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) { const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0); if (inRing(x, z, ring) && okTree(x, z)) { trees[r() < 0.35 ? 'palm' : r() < 0.8 ? 'broad' : 'shrub'].push([x, z]); k++; } }
  }
  B.forEach((b) => {
    if (!['h', 'y'].includes(b.kind) || b.area > 260 || r() > 0.3) return;
    const [cx, cz] = centroid(b.ring), ob = obb(b.ring); if (!ob) return;
    const d = (ob.z1 - ob.z0) / 2 + 3, sx = r() < 0.5 ? -1 : 1;
    const x = cx - ob.s * d * sx, z = cz + ob.c * d * sx;
    if (okTree(x, z, 0.8)) trees[r() < 0.6 ? 'broad' : r() < 0.6 ? 'shrub' : 'palm'].push([x, z]);
  });
  // instâncias
  // folhagem: muita sobreposição de pixels → LEDs só nas árvores a até 80 m da ponte
  const leafMat = nearSpots(new THREE.MeshStandardMaterial({ map: T.leaf, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85 }), 'folhas', 80, true);
  const frondMat = nearSpots(new THREE.MeshStandardMaterial({ map: T.frond, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.8 }), 'palmas', 80, true);
  const barkMat = nearSpots(new THREE.MeshStandardMaterial({ map: T.bark, roughness: 0.95 }), 'casca', 80, true);
  const palmBarkMat = nearSpots(new THREE.MeshStandardMaterial({ map: T.palmBark, roughness: 0.95 }), 'estipe', 80, true);
  const veg = new THREE.Group(); veg.name = 'Vegetacao';
  const inst = (geo, mat, pts, name, sc = [0.85, 1.2], tint = null) => {
    if (!pts.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, pts.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    pts.forEach(([x, z, rot, s], i) => { q.setFromAxisAngle(V(0, 1, 0), rot); m.compose(V(x, G, z), q, V(s, s, s)); im.setMatrixAt(i, m); if (tint) { tint(c, i); im.setColorAt(i, c); } });
    im.name = name; im.castShadow = true; im.receiveShadow = true; veg.add(im); return im;
  };
  const variants = (list, n) => { const out = Array.from({ length: n }, () => []); list.forEach((p, i) => out[i % n].push([p[0], p[1], r() * Math.PI * 2, 0.85 + r() * 0.35])); return out; };
  const tintLeaf = (c) => c.setHSL(0.2 + r() * 0.1, 0.22 + r() * 0.25, 0.74 + r() * 0.2, THREE.SRGBColorSpace);
  variants(trees.broad, 3).forEach((pts, k) => { const t = broadleafGeo(rng(100 + k)); inst(t.trunk, barkMat, pts, 'Troncos'); inst(t.crown, leafMat, pts, 'Copas', null, tintLeaf); });
  variants(trees.palm, 3).forEach((pts, k) => { const t = palmGeo(rng(200 + k)); inst(t.trunk, palmBarkMat, pts, 'Coqueiros'); inst(t.crown, frondMat, pts, 'Folhas_coqueiro', null, tintLeaf); });
  variants(trees.shrub, 2).forEach((pts, k) => { const t = broadleafGeo(rng(300 + k), 0.38, 14); inst(t.crown, leafMat, pts, 'Arbustos', null, tintLeaf); });
  g.add(veg);
  veg.children.forEach(o => { reflHide.push(o); });

  // ---------- barcos atracados nas margens próximas ----------
  {
    const boats = new THREE.Group(); boats.name = 'Barcos';
    const spots = [];
    for (const poly of land) { const ring = poly[0], sg = area(ring) > 0 ? 1 : -1;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = Math.hypot(...m);
        if (L < 14 || d < 30 || d > 150 || Math.abs(m[1]) < 14) continue;
        spots.push({ m, t: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n: [sg * (b[1] - a[1]) / L, -sg * (b[0] - a[0]) / L], L });
      } }
    spots.slice(0, 7).forEach((s, i) => {
      const len = [17, 12, 19, 13, 14, 11, 16][i], bt = makeBoat(len, i % 2 === 0, M);
      bt.position.set(s.m[0] + s.n[0] * (len * 0.14 + 1.2), 0, s.m[1] + s.n[1] * (len * 0.14 + 1.2));
      bt.rotation.y = -Math.atan2(s.t[1], s.t[0]); boats.add(bt);
    });
    g.add(boats); city.push(boats);
  }

  // ---------- letreiro #EUPASSODETORRES (cabeceira de SC, ao lado da escada) ----------
  let eu = null;
  if (font) {
    eu = new THREE.Group(); eu.name = 'Letreiro_EuPassoDeTorres';
    const white = nearSpots(new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.45, emissive: 0xffffff, emissiveIntensity: 0 }), 'letras');
    const red = nearSpots(new THREE.MeshStandardMaterial({ color: 0xd0141c, roughness: 0.4, emissive: 0xff2020, emissiveIntensity: 0 }), 'coracao');
    const base = M.concreteGrey;
    const text = (s, size) => { const tg = new TextGeometry(s, { font, size, depth: 0.16, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 1 }); tg.computeBoundingBox(); return tg; };
    const l1 = text('#EUPASSODE', 0.34), l2 = text('TORRES', 0.5);
    const w1 = l1.boundingBox.max.x - l1.boundingBox.min.x, w2 = l2.boundingBox.max.x - l2.boundingBox.min.x;
    const heart = new THREE.Shape(); const hs = 0.5;
    heart.moveTo(0, -0.42 * hs); heart.bezierCurveTo(-0.08 * hs, -0.3 * hs, -0.55 * hs, -0.05 * hs, -0.55 * hs, 0.2 * hs);
    heart.bezierCurveTo(-0.55 * hs, 0.48 * hs, -0.2 * hs, 0.55 * hs, 0, 0.3 * hs); heart.bezierCurveTo(0.2 * hs, 0.55 * hs, 0.55 * hs, 0.48 * hs, 0.55 * hs, 0.2 * hs);
    heart.bezierCurveTo(0.55 * hs, -0.05 * hs, 0.08 * hs, -0.3 * hs, 0, -0.42 * hs);
    const hg = new THREE.ExtrudeGeometry(heart, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 12 });
    const hw = 0.95 * hs * 1.2, gap = 0.14, total = hw + gap + Math.max(w1, w2);
    const x0 = -total / 2;
    const hm = new THREE.Mesh(hg.scale(1.7, 1.7, 1), red); hm.position.set(x0 + hw / 2, 0.18 + 0.62, 0);
    const m1 = new THREE.Mesh(l1, white); m1.position.set(x0 + hw + gap - l1.boundingBox.min.x, 0.18 + 0.72, 0);
    const m2 = new THREE.Mesh(l2, white); m2.position.set(x0 + hw + gap - l2.boundingBox.min.x, 0.18 + 0.08, 0);
    const bm = box(total + 0.4, 0.18, 0.5, 0, 0.09, 0.05, base, 'Base_letreiro');
    // canteiro baixo de grama com meio-fio de concreto, na frente do letreiro (foto)
    const cw = total + 1.2, cd = 2.0, ch = 0.32;
    const curb = new THREE.Group(); curb.position.y = -ch;
    const zc = cd / 2 - 0.35; // grama na frente do letreiro (z local positivo = lado da praça)
    curb.add(box(cw, ch, 0.15, 0, ch / 2, zc + cd / 2 - 0.075, base, 'Meio_fio'), box(cw, ch, 0.15, 0, ch / 2, zc - cd / 2 + 0.075, base, 'Meio_fio'),
      box(0.15, ch, cd, -cw / 2 + 0.075, ch / 2, zc, base, 'Meio_fio'), box(0.15, ch, cd, cw / 2 - 0.075, ch / 2, zc, base, 'Meio_fio'));
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(cw - 0.3, cd - 0.3).rotateX(-Math.PI / 2), mats.lawn); lawn.position.set(0, ch - 0.03, zc); lawn.receiveShadow = true; curb.add(lawn);
    eu.add(hm, m1, m2, bm, curb);
    eu.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // ao lado do pé da escada de SC, de frente para a cidade (+x); posição estimada pelas fotos
    // ao lado da ponte, deslocado lateralmente do eixo (foto): entre a torre e o pé da escada, de frente para a praça
    eu.position.set(P.L / 2 + 3.6, G + 0.04 + 0.32, -5.6); eu.rotation.y = Math.PI;
    g.add(eu); pick.push(eu);
    eu.userData.mats = [white, red];
  }

  // ---------- consultas ----------
  const groundAt = (x, z) => onLand(x, z) ? G : 0;
  function applyMode(m, lampsOn) {
    shopMat.emissiveIntensity = m.win ? m.win * 1.6 : 0;
    if (signMat) signMat.emissiveIntensity = m.win ? 28 * (lampsOn ? 1 : 0.9) : 0;
    mats.pool.emissiveIntensity = m.win ? 0.35 : 0;
    // ~25 lx no pé do poste (LED viário ~9 m), piso com refletância ~0,2 → ~1,6 nits
    if (poolMat) poolMat.uniforms.uL.value = lampsOn && m.lamp ? 1.6 : 0;
    if (eu) { eu.userData.mats[0].emissiveIntensity = m.win ? 0.6 : 0; eu.userData.mats[1].emissiveIntensity = m.win ? 0.25 : 0; }
  }
  const treeFar = TREE_FAR;
  const stats = { buildings: B.length, roads: R.length, pois: POI.length, signs: signs.length, trees: trees.broad.length + trees.palm.length + trees.shrub.length };
  return { group: g, pick, lampPos, reflHide, city, lods, groundAt, onLand, applyMode, stats, real: true, eu, treeFar, setStreetDynamic: (n) => { if (poolsNear) poolsNear.visible = n <= 3; } };
}
