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
export function makeTextures() {
  const r = rng(11);
  const wood = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#7b6956'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x0 = r() * w, amp = 1 + r() * 3, a = 0.05 + r() * 0.18, dark = r() > 0.4;
      g.strokeStyle = dark ? `rgba(48,36,26,${a})` : `rgba(190,175,150,${a * 0.7})`;
      g.lineWidth = 0.6 + r() * 1.6; g.beginPath();
      for (let y = 0; y <= h; y += 8) g.lineTo(x0 + Math.sin(y * 0.02 + i) * amp, y);
      g.stroke();
    }
    noise(g, w, h, 2500, '30,24,18', 0.03, 0.12, 2, r);
    g.fillStyle = 'rgba(40,30,20,0.35)';
    for (let k = 0; k < 2; k++) { g.beginPath(); g.ellipse(r() * w, r() * h, 3 + r() * 4, 6 + r() * 6, 0, 0, 7); g.fill(); }
  });
  const concrete = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d8d6d1'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 9000, '120,118,112', 0.02, 0.10, 2.2, r);
    noise(g, w, h, 1500, '255,255,255', 0.03, 0.12, 2, r);
  });
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
        g.fillStyle = warm ? `rgb(255,${170 + r() * 50 | 0},${90 + r() * 50 | 0})` : 'rgb(190,215,255)';
        g.globalAlpha = 0.4 + r() * 0.6; g.fillRect(12 + i * 64, 14 + j * 64, 40, 36); g.globalAlpha = 1;
      }
    }
  });
  return { wood, concrete, pavers, asphalt, grass, mesh, facade, windowsEm };
}

export function makeMaterials(T) {
  const M = {
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.wood, roughness: 0.82, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xf2f0ec, map: T.concrete, roughness: 0.88 }),
    concreteGrey: new THREE.MeshStandardMaterial({ color: 0xb9b6b0, map: T.concrete, roughness: 0.9 }),
    whiteSteel: new THREE.MeshStandardMaterial({ color: 0xeef1f3, roughness: 0.42, metalness: 0.15 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x3c4146, roughness: 0.55, metalness: 0.55 }),
    galv: new THREE.MeshStandardMaterial({ color: 0xa7adb2, roughness: 0.32, metalness: 0.9 }),
    mesh: new THREE.MeshStandardMaterial({ color: 0xf4f6f7, alphaMap: T.mesh, transparent: true, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.2, depthWrite: false }),
    pavers: new THREE.MeshStandardMaterial({ map: T.pavers, roughness: 0.9 }),
    asphalt: new THREE.MeshStandardMaterial({ map: T.asphalt, roughness: 0.95 }),
    grass: new THREE.MeshStandardMaterial({ map: T.grass, roughness: 1 }),
    facade: new THREE.MeshStandardMaterial({ map: T.facade, emissiveMap: T.windowsEm, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8 }),
    house: new THREE.MeshStandardMaterial({ color: 0xe8e2d6, map: T.facade, emissiveMap: T.windowsEm, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x9a4a32, roughness: 0.8 }),
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
  return M;
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
      nor.push(nx, ny, nz); uv.push(lens[i] / total, j / radial); aS.push(lens[i]);
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
function box(sx, sy, sz, x, y, z, mat, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
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
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 6);
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
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = -P.L / 2 + pitch * (i + 0.5);
    _q.setFromAxisAngle(V(0, 0, 1), Math.atan(deckSlope(x)));
    _m.compose(_mid.set(x, deckY(x) - P.plankT / 2, 0), _q, _s.set(1, 1, 1));
    planks.setMatrixAt(i, _m);
    const t = 0.78 + r() * 0.3; planks.setColorAt(i, col.setRGB(t, t * (0.97 + r() * 0.05), t * (0.93 + r() * 0.08)));
  }
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
  const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(run, rise + 0.12, 1.6), M.concreteGrey, n);
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
    const uq = quay.geometry.attributes.uv; for (let i = 0; i < uq.count; i++) uq.setXY(i, uq.getX(i) * 400, uq.getY(i) * 2);
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
  const tall = [], low = [], roofs = [];
  const facadeUV = (geo, w, hgt, d, floor = 3) => {
    const uv = geo.attributes.uv; // ordem: px, nx, py, ny, pz, nz (4 vértices cada)
    const dims = [[d, hgt], [d, hgt], [0, 0], [0, 0], [w, hgt], [w, hgt]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k; const [fw, fh] = dims[f];
      if (!fw) uv.setXY(i, 0.01, 0.01); else uv.setXY(i, uv.getX(i) * fw / (4 * floor), uv.getY(i) * fh / (4 * floor));
    }
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
    const geo = new THREE.BoxGeometry(w, hgt, d); facadeUV(geo, w, hgt, d); geo.translate(x, P.ground + hgt / 2, z); tall.push(geo);
  }
  // Passo de Torres (SC): casas baixas com telhado
  for (let i = 0; i < 160; i++) {
    const w = 8 + r() * 6, d = 7 + r() * 5, x = P.quayX + 50 + r() * 320, z = -400 + r() * 800;
    if (!free(x, z, w, d)) continue;
    occupied.push([x, z, w, d]);
    const hgt = r() < 0.75 ? 3.2 + r() * 1.5 : 6.5 + r() * 2;
    const geo = new THREE.BoxGeometry(w, hgt, d); facadeUV(geo, w, hgt, d, 3.2); geo.translate(x, P.ground + hgt / 2, z); low.push(geo);
    const shp = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.4, 0), new THREE.Vector2(w / 2 + 0.4, 0), new THREE.Vector2(0, 1.8)]);
    const rf = new THREE.ExtrudeGeometry(shp, { depth: d + 0.6, bevelEnabled: false }); rf.translate(0, 0, -(d + 0.6) / 2); rf.translate(x, P.ground + hgt, z); roofs.push(rf);
  }
  // edificações baixas junto às praças (quiosque "Barcos", livraria etc.)
  for (const [x, z, w, d, hh] of [[-(P.quayX + 12), 16, 8, 5, 3.4], [-(P.quayX + 14), -20, 10, 7, 3.6], [P.quayX + 14, -14, 22, 12, 4.2], [P.quayX + 12, 20, 6, 5, 3.2]]) {
    const geo = new THREE.BoxGeometry(w, hh, d); facadeUV(geo, w, hh, d, 3.2); geo.translate(x, P.ground + hh / 2, z); low.push(geo);
  }
  const tallM = new THREE.Mesh(mergeGeometries(tall), M.facade); tallM.name = 'Edificios_Torres'; tallM.castShadow = tallM.receiveShadow = true; g.add(tallM);
  const lowM = new THREE.Mesh(mergeGeometries(low), M.house); lowM.name = 'Casas_PassoDeTorres'; lowM.castShadow = lowM.receiveShadow = true; g.add(lowM);
  const roofM = new THREE.Mesh(mergeGeometries(roofs), M.roof); roofM.name = 'Telhados'; roofM.castShadow = true; g.add(roofM);

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
    lCol: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) }, lCos: { value: new Array(16).fill(1) }, lN: { value: 0 }, albedo: { value: 0.06 },
  },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld;
    void main(){ vUv = textureMatrix*vec4(position,1.0); vec4 w = modelMatrix*vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, distortion, reflectivity, albedo; uniform vec3 body; varying vec4 vUv; varying vec3 vWorld;
    uniform vec3 lPos[16]; uniform vec3 lDir[16]; uniform vec3 lCol[16]; uniform float lCos[16]; uniform int lN;
    vec2 waves(vec2 p){
      vec2 n = vec2(0.0);
      n += vec2(sin(p.x*0.35 + p.y*0.9 + time*0.9), cos(p.y*1.1 - p.x*0.2 - time*0.7))*0.45;
      n += vec2(sin(p.x*1.7 - time*1.6 + p.y*2.3), cos(p.y*2.9 + p.x*0.6 + time*1.4))*0.3;
      n += vec2(sin(p.x*5.3 + time*2.6 - p.y*3.1), cos(p.y*6.7 - time*2.2 + p.x*1.3))*0.16;
      n += vec2(sin(p.x*13.0 - p.y*9.0 + time*3.4), cos(p.y*15.0 + p.x*7.0 - time*3.0))*0.09;
      return n;
    }
    void main(){
      vec2 n = waves(vWorld.xz);
      float d = length(cameraPosition - vWorld);
      float k = distortion / (1.0 + d*0.004);
      vec4 uv = vUv; uv.x += n.x*k*0.25*uv.w; uv.y += n.y*k*uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 N = normalize(vec3(-n.x*0.12, 1.0, -n.y*0.12));
      float c = clamp(dot(V, N), 0.0, 1.0);
      float F = 0.02 + 0.98*pow(1.0 - c, 5.0);
      vec3 E = vec3(0.0);
      for (int i = 0; i < 16; i++) {
        if (i >= lN) break;
        vec3 L = lPos[i] - vWorld; float d2 = max(dot(L, L), 0.01); vec3 l = L*inversesqrt(d2);
        float cs = dot(-l, lDir[i]); float sp = smoothstep(lCos[i], mix(lCos[i], 1.0, 0.35), cs);
        E += lCol[i]*sp*max(l.y, 0.0)/d2;
      }
      vec3 col = body*(1.0 - F) + E*albedo*(1.0 - F)/3.14159 + refl*(F*0.8 + 0.05)*reflectivity;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
