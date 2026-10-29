import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, H, deckY, cableY, stairSteps, makeTextures, makeMaterials, deckLight, buildBridge, buildEnvironment, buildPeople, buildSky, RiverShader } from './model.js';
import { parsePhotometry, packPhoto } from './photometry.js';
import { buildRealEnvironment } from './entorno.js';
import { TYPES, MOUNTS, EFFECTS, LightRig, computeGrid, computeVertical, CRITERIA_REF, LAYERS, isOn, roleOf, beamOf, falseColor, FALSE_STOPS, groupColor, efficacy, fluxUnit, candela, nitsOf, powerForNits, cctToSRGB, profOf } from './lighting.js';

const $ = (s) => document.querySelector(s);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const fmt = (v, d = 0) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

// =====================================================================
//  Estado
// =====================================================================
let uid = 0;
function G(o) {
  const g = Object.assign({ id: 'g' + (++uid), on: false, colorMode: 'cct', cct: 3000, rgb: '#2a4bff', power: 10, dim: 100, effOverride: null, beam: 120, effect: 'estatico', speed: 0.4, lambda: 8, nLights: 6, params: {}, fixtures: [] }, o);
  for (const p of MOUNTS[g.mount].params) if (g.params[p.k] === undefined) g.params[p.k] = p.def;
  return g;
}
function baseGroups() {
  return [
    G({ name: 'Fita nos cabos principais', mount: 'cable', type: 'strip', beam: 120, power: 1, nLights: 8 }),
    G({ name: 'Linear sob o corrimão', mount: 'handrail', type: 'linearRail', beam: 40, power: 0.15, nLights: 8 }),
    G({ name: 'Pixels nos pendurais', mount: 'hangers', type: 'dot', beam: 120, power: 2, nLights: 6 }),
    G({ name: 'Projetores nas torres', mount: 'towerUp', type: 'flood', beam: 25, power: 12, nLights: 8 }),
    G({ name: 'Washers no pórtico', mount: 'towerTop', type: 'washer', beam: 45, power: 10, nLights: 4 }),
    G({ name: 'Washers sob o tabuleiro', mount: 'underDeck', type: 'washer', beam: 30, power: 8, nLights: 6 }),
    G({ name: 'Projetores no cais', mount: 'quay', type: 'flood', beam: 10, power: 30, nLights: 4 }),
    G({ name: 'Balizadores no rodapé', mount: 'postFoot', type: 'bollard', beam: 60, power: 2, nLights: 6 }),
    G({ name: 'Balizadores das escadas', mount: 'stairs', type: 'bollard', beam: 60, power: 3, nLights: 4 }),
    G({ key: 'avulsas', name: 'Luminárias avulsas', mount: 'custom', type: 'flood', beam: 25, power: 30, nLights: 6 }),
    projGroup(),
  ];
}
/** Exemplo: 4 projetores 10 W de foco fechado ao pé das torres, apontando para cima (facho visível no ar). */
function projGroup() {
  const y = P.ground + 0.075, fx = [];
  for (const s of [-1, 1]) for (const z of [-2.0, 2.0]) fx.push({ p: [s * (H() + 1.55), y, z], d: V(-s * 0.035, 1, -Math.sign(z) * 0.02).normalize().toArray().map(v => +v.toFixed(4)), n: [0, 1, 0] });
  return G({ key: 'proj10', role: 'cenica', name: 'Projetores 10 W foco fechado', mount: 'custom', type: 'proj10', beam: 8, power: 10, nLights: 4, colorMode: 'cct', cct: 4000, fixtures: fx });
}
const PRESETS = {
  cenica: { nome: 'Proposta — funcional 3000 K + cênica sóbria', patch: {
    cable: { on: true, colorMode: 'cct', cct: 4000, power: 0.5, dim: 60 },
    handrail: { on: true, colorMode: 'cct', cct: 3000, power: 0.15, beam: 40 },
    towerUp: { on: true, colorMode: 'cct', cct: 3000, power: 8, beam: 25 },
    towerTop: { on: true, colorMode: 'cct', cct: 3000, power: 6, beam: 45 },
    underDeck: { on: true, colorMode: 'rgb', rgb: '#7fb2e6', power: 3, beam: 30, params: { spacing: 8 } },
    stairs: { on: true, colorMode: 'cct', cct: 3000, power: 2 },
    proj10: { on: true },
  } },
  atual: { nome: 'Situação atual (fotos 2024–25): cabos azuis', patch: {
    cable: { on: true, colorMode: 'rgb', rgb: '#1f2fff', power: 1.0 },
    handrail: { on: true, colorMode: 'cct', cct: 5000, power: 0.15, beam: 60 },
    towerUp: { on: true, colorMode: 'rgb', rgb: '#2436ff', power: 10, beam: 10 },
  } },
  funcional: { nome: 'Funcional — branco quente 3000 K', patch: {
    handrail: { on: true, colorMode: 'cct', cct: 3000, power: 0.15, beam: 40 },
    towerTop: { on: true, colorMode: 'cct', cct: 3000, power: 10, beam: 45 },
    stairs: { on: true, colorMode: 'cct', cct: 3000, power: 2 },
    postFoot: { on: true, colorMode: 'cct', cct: 3000, power: 0.5, params: { every: 2 } },
  } },
  festiva: { nome: 'Festiva — RGB dinâmico', patch: {
    cable: { on: true, colorMode: 'rgb', rgb: '#ff2fd0', power: 1.5, effect: 'arcoiris', speed: 0.25, lambda: 24 },
    hangers: { on: true, colorMode: 'rgb', rgb: '#ffffff', power: 1.5, effect: 'corrida', speed: 0.5, lambda: 30 },
    underDeck: { on: true, colorMode: 'rgb', rgb: '#7a2cff', power: 10, effect: 'onda', speed: 0.3, lambda: 20 },
    towerUp: { on: true, colorMode: 'rgb', rgb: '#ff2fa0', power: 15, beam: 25, effect: 'respira', speed: 0.3 },
    handrail: { on: true, colorMode: 'cct', cct: 3000, power: 0.1, beam: 40 },
  } },
  apagado: { nome: 'Tudo apagado (só o entorno)', patch: {} },
};
function presetGroups(key) {
  const gs = baseGroups(), patch = PRESETS[key].patch;
  for (const g of gs) { const p = patch[g.key || g.mount]; if (p) { const { params, ...rest } = p; Object.assign(g, rest); if (params) Object.assign(g.params, params); } }
  return gs;
}

const IS_MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 820;
const S = {
  mouse: 0.5, mode: 'noite', ev: 0, bloom: 0.18, refl: 0.5, ripple: 0.03, fog: 0.25, lamps: true, shadows: false,
  fm: 0.8, criteria: CRITERIA_REF.map(c => ({ ...c })), layers: { funcional: true, cenica: true }, waterAnim: false,
  people: true, city: true, haze: 0.45, dims: false, heat: false, quality: IS_MOBILE ? 'leve' : 'media', hours: 12, tarifa: 0.85, preset: 'cenica',
  groups: presetGroups('cenica'),
};
try {
  const saved = JSON.parse(localStorage.getItem('ponte-pensil-v4') || 'null');
  if (saved && saved.groups) { Object.assign(S, saved, { groups: migrate(saved.groups.map(g => G({ ...g, id: undefined }))) }); }
} catch (e) { /* armazenamento indisponível */ }
/** Projetos antigos: identifica o grupo avulso original e acrescenta o grupo de projetores 10 W. */
function migrate(gs) {
  gs.forEach(g => { if (!g.key && g.mount === 'custom' && g.name === 'Luminárias avulsas') g.key = 'avulsas'; });
  if (!gs.some(g => g.key === 'proj10')) { const pg = projGroup(); pg.on = true; gs.push(pg); }
  return gs;
}
const perf = { idle: false, frame: 0, last: performance.now(), lastInput: performance.now(), dpr: 1, scale: 1, acc: 0, n: 0, checkAt: performance.now() + 2000 };
Object.assign(LAYERS, S.layers);
const persist = debounce(() => { try { localStorage.setItem('ponte-pensil-v4', JSON.stringify(serialize())); } catch (e) { /* ignora */ } }, 400);
function serialize() { const { groups, ...rest } = S; return { ...rest, groups: groups.map(({ id, _alloc, ...g }) => g) }; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// =====================================================================
//  Renderizador e cena
// =====================================================================
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // a cena é estática: sombras só são refeitas quando algo muda
const shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; };
stage.prepend(renderer.domElement);
const labelRenderer = new CSS2DRenderer({ element: $('#labels') });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
camera.position.set(-75, 32, 95);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 7, 0); controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxDistance = 900; controls.minDistance = 0.5; controls.maxPolarAngle = Math.PI * 0.56;
controls.screenSpacePanning = true;
// sensibilidade reduzida para posicionamento preciso (ajustável na aba Cena)
function applySensitivity() { const k = S.mouse ?? 0.5; controls.rotateSpeed = 0.9 * k; controls.panSpeed = 1.0 * k; controls.zoomSpeed = 1.0 * k; controls.dampingFactor = 0.12; }
// cota mínima da câmera: nunca abaixo do terreno/água nem dentro do muro do cais
let groundAt = (x, z) => Math.abs(x) > P.quayX - 0.2 ? P.ground : 0;

const TX = makeTextures(), M = makeMaterials(TX);
const bridge = buildBridge(M); scene.add(bridge);
// entorno real (OpenStreetMap); se os dados não carregarem, volta ao entorno genérico
let env;
try { env = await buildRealEnvironment(M); }
catch (e) { console.warn('Entorno OSM indisponível, usando o genérico:', e); env = buildEnvironment(M, TX); }
scene.add(env.group);
const people = buildPeople(M); scene.add(people);
const sky = buildSky(); scene.add(sky.dome, sky.stars);
scene.fog = new THREE.FogExp2(0x000000, 0.001);

const water = new Reflector(env.real ? new THREE.PlaneGeometry(9000, 9000) : new THREE.PlaneGeometry(2 * P.quayX, 1600), { textureWidth: 512, textureHeight: 512, clipBias: 0.003, shader: RiverShader, multisample: IS_MOBILE ? 0 : 4 });
water.rotation.x = -Math.PI / 2; water.name = 'Rio_Mampituba'; scene.add(water);
// reflexo: some com o que não aparece na água; parado, atualiza só 1 quadro a cada 3
const reflHide = [];
{ const ob = water.onBeforeRender.bind(water); water.onBeforeRender = (...a) => {
  if ((perf.idle && perf.frame % 3 !== 0) || (S.quality === 'leve' && perf.frame % 2 !== 0)) return;
  const vis = reflHide.map(o => o.visible); reflHide.forEach(o => { o.visible = false; });
  ob(...a); reflHide.forEach((o, i) => { o.visible = vis[i]; });
}; }
const WU = water.material.uniforms;

const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1); sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 1, far: 600 }); sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// iluminação pública existente (sódio/LED 2200 K) nos postes mais próximos
const streetLights = new THREE.Group(); streetLights.name = 'Iluminacao_publica_existente';
(env.real ? [...env.lampPos].sort((a, b) => a.length() - b.length()).filter(p => p.length() < 95).slice(0, 8) : env.lampPos.filter(p => Math.abs(p.z) < 30)).forEach(p => {
  const l = new THREE.SpotLight(cctToSRGB(2200), 2600, 0, 1.15, 0.6, 2);
  l.position.copy(p); l.target.position.copy(p).add(V(0, -10, 0)); streetLights.add(l, l.target);
});
scene.add(streetLights);

const rig = new LightRig(scene);
rig.occluders = [bridge, ...env.pick];
camera.layers.enable(1); // fachos volumétricos (fora do reflexo da água e dos cliques)
const hazeSigma = (v) => 0.045 * v * v; // coeficiente de espalhamento (1/m): 0 = ar limpo … 0,045 = névoa
rig.haze.value = hazeSigma(S.haze ?? 0.45);

// =====================================================================
//  Níveis de detalhe por distância (distância ao ponto mais próximo da caixa do objeto)
// =====================================================================
const LODS = [];
function lodAdd(obj, dist, cond = () => true, proxy = null) {
  if (!obj) return; obj.updateMatrixWorld(true);
  LODS.push({ obj, dist, cond, proxy, box: new THREE.Box3().setFromObject(obj) });
  if (proxy) { proxy.visible = false; scene.add(proxy); }
}
const byName = (root, n) => { let r = null; root.traverse(o => { if (!r && o.name === n) r = o; }); return r; };
function updateLOD() {
  perf.lodDirty = false;
  const c = camera.position, k = S.quality === 'leve' ? 0.65 : S.quality === 'alta' ? 1.4 : 1;
  for (const l of LODS) {
    const near = l.box.distanceToPoint(c) < l.dist * k, ok = l.cond();
    if (l.proxy) { l.obj.visible = ok && near; l.proxy.visible = ok && !near; } else l.obj.visible = ok && near;
  }
  // corpos das luminárias (recriados a cada ajuste): somem longe, as lentes ficam
  rig.root.traverse(o => { if (o.name === 'Corpo_luminaria') { if (!o.userData.box) o.userData.box = new THREE.Box3().setFromObject(o); o.visible = o.userData.box.distanceToPoint(c) < 90 * k; } });
}

// mapa de falsa cor sobre o piso
const heat = (() => {
  const nx = Math.round(P.L / 0.5), nz = 5;
  const data = new Uint8Array(nx * nz * 4);
  const tex = new THREE.DataTexture(data, nx, nz); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const pos = [], uv = [], idx = [], cols = 200;
  for (let i = 0; i <= cols; i++) {
    const x = -H() + P.L * i / cols, y = deckY(x) + 0.012;
    for (const [z, v] of [[-0.75, 0], [0.75, 1]]) { pos.push(x, y, z); uv.push(i / cols, v); }
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat); mesh.visible = false; mesh.renderOrder = 5; mesh.name = 'Mapa_lux';
  scene.add(mesh);
  return { mesh, tex, data, mat };
})();

// =====================================================================
//  Pós-processamento: exposição → bloom → curva de tons por canal máximo
// =====================================================================
const composerRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: IS_MOBILE ? 0 : 4 });
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
const exposurePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, exposure: { value: 1 }, cap: { value: 9 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float exposure, cap; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb*exposure; float m = max(c.r, max(c.g, c.b)); if (m > cap) c *= cap/m; gl_FragColor = vec4(max(c, vec3(0.0)), 1.0); }`,
});
composer.addPass(exposurePass);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.22, 3.5);
composer.addPass(bloom);
const finalPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, wb: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 wb; varying vec2 vUv;
    float aces(float x){ return clamp(x*(2.51*x+0.03)/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
    vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * wb;
      float m = max(c.r, max(c.g, c.b));
      vec3 o = m > 1e-5 ? c*(aces(m)/m) : c;
      float w = smoothstep(3.0, 40.0, m)*0.6;
      o = mix(o, vec3(max(o.r, max(o.g, o.b))), w);
      vec2 q = vUv - 0.5; o *= 1.0 - dot(q, q)*0.35;
      gl_FragColor = vec4(toSRGB(clamp(o, 0.0, 1.0)), 1.0);
    }`,
});
composer.addPass(finalPass);

// =====================================================================
//  Períodos do dia (valores físicos: céu em cd/m², luzes em lux)
// =====================================================================
const MODES = {
  noite: { nome: 'Noite', wbK: 3700, exp: 0.24, top: [0.012, 0.014, 0.026], hor: [0.14, 0.12, 0.12], bot: [0.025, 0.024, 0.025], glow: [0.24, 0.13, 0.07], stars: true, sunI: 0.5, sunC: '#a9b8ff', sunPos: [-60, 120, 140], hemiI: 0.9, hemiSky: '#5a6a9a', hemiGnd: '#2a2420', win: 3.5, lamp: 12000, body: [0.012, 0.016, 0.018], sunShadow: false },
  azul: { nome: 'Hora azul', wbK: 5000, exp: 0.085, top: [0.7, 1.3, 3.4], hor: [6.5, 4.6, 4.0], bot: [0.5, 0.5, 0.6], glow: [2.4, 1.0, 0.35], stars: false, sunI: 2.5, sunC: '#ffb27a', sunPos: [-200, 14, 60], hemiI: 7, hemiSky: '#7f95c8', hemiGnd: '#3a3530', win: 6, lamp: 15000, body: [0.25, 0.33, 0.38], sunShadow: false },
  dia: { nome: 'Dia', wbK: 6200, exp: 0.00012, top: [1500, 3100, 7400], hor: [6000, 6700, 7600], bot: [1400, 1400, 1400], glow: [0, 0, 0], stars: false, sunI: 62000, sunC: '#fff2df', sunPos: [-80, 140, 60], hemiI: 15000, hemiSky: '#a8c8ff', hemiGnd: '#8a7f70', win: 0, lamp: 0, body: [430, 520, 470], sunShadow: true },
};
let exposure = 1;
function applyMode() {
  const m = MODES[S.mode];
  exposure = m.exp * Math.pow(2, S.ev);
  // balanço de branco da "câmera": a luz quente continua quente, mas como o olho adaptado a vê
  { const c = cctToSRGB(m.wbK), Y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, k = 0.65;
    finalPass.uniforms.wb.value.set(1 + k * (Y / c.r - 1), 1 + k * (Y / c.g - 1), 1 + k * (Y / c.b - 1)); }
  exposurePass.uniforms.exposure.value = exposure;
  const u = sky.dome.material.uniforms;
  u.top.value.setRGB(...m.top); u.horizon.value.setRGB(...m.hor); u.bottom.value.setRGB(...m.bot); u.glow.value.setRGB(...m.glow);
  sky.stars.visible = m.stars;
  sun.intensity = m.sunI; sun.color.set(m.sunC); sun.position.set(...m.sunPos); sun.castShadow = m.sunShadow;
  hemi.intensity = m.hemiI; hemi.color.set(m.hemiSky); hemi.groundColor.set(m.hemiGnd);
  M.facade.emissiveIntensity = m.win; M.house.emissiveIntensity = m.win * 0.8;
  M.lampHead.color.setRGB(1, 0.62, 0.32).multiplyScalar(S.lamps ? m.lamp : 0);
  if (env.applyMode) env.applyMode(m, S.lamps);
  if (typeof gizmoTone === 'function') gizmoTone();
  scene.fog.color.setRGB(...m.hor); scene.fog.density = S.fog * 0.0045;
  WU.body.value.setRGB(...m.body); WU.reflectivity.value = S.refl; WU.distortion.value = S.ripple;
  streetLights.visible = S.lamps && S.mode !== 'dia';
  bloom.strength = S.bloom; shadowsDirty(); if (typeof poke === 'function') poke();
  heat.mat.color.setScalar(0.85 / exposure);
  dimMat.color.setScalar(0.9 / exposure);
}

// =====================================================================
//  Cotas e medidas
// =====================================================================
const dims = new THREE.Group(); dims.name = 'Cotas'; dims.visible = false; scene.add(dims);
const dimMat = new THREE.LineBasicMaterial({ color: 0xffffff, fog: false, depthTest: false, transparent: true });
function dimLine(pts) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dimMat); l.renderOrder = 10; dims.add(l); }
function dimLabel(text, p) { const d = document.createElement('div'); d.className = 'dim'; d.textContent = text; const o = new CSS2DObject(d); o.position.copy(p); dims.add(o); }
(() => {
  const h = H(), n = stairSteps();
  dimLine([V(-h, P.towerTop + 1.6, 3.2), V(h, P.towerTop + 1.6, 3.2)]);
  dimLine([V(-h, P.towerTop + 1.2, 3.2), V(-h, P.towerTop + 2.0, 3.2)]); dimLine([V(h, P.towerTop + 1.2, 3.2), V(h, P.towerTop + 2.0, 3.2)]);
  dimLabel('Vão ≈ 100 m (publicado)', V(0, P.towerTop + 2.0, 3.2));
  dimLine([V(0, P.cableLow, 2.4), V(0, P.towerTop, 2.4)]);
  dimLabel(`Flecha f ≈ ${fmt(P.towerTop - P.cableLow, 2)} m (L/${fmt(P.L / (P.towerTop - P.cableLow), 1)}) · estimada`, V(0, (P.cableLow + P.towerTop) / 2, 2.4));
  dimLine([V(0, 0, 2.2), V(0, deckY(0) - 0.37, 2.2)]);
  dimLabel(`Gabarito ≈ ${fmt(deckY(0) - 0.37, 2)} m sobre o N.A. · estimado`, V(0, 2.4, 2.2));
  dimLabel(`Piso no meio ≈ +${fmt(deckY(0), 2)} m · estimado`, V(6, deckY(0) + 1.6, 0));
  dimLabel(`Piso nas torres ≈ +${fmt(P.deckEnd, 2)} m · contraflecha ≈ ${fmt(P.camber, 2)} m · estimados`, V(-h + 8, P.deckEnd + 1.9, 0));
  dimLabel(`Sela do cabo ≈ +${fmt(P.towerTop, 2)} m · estimada`, V(-h, P.towerTop + 0.8, -2.2));
  dimLabel('Largura ≈ 1,50 m (publicada) · guarda-corpo 1,20 m (estimado)', V(22, deckY(22) + 1.5, -1.5));
  dimLabel(`Pendurais ≈ ${fmt(P.hangerStep, 1)} m · Ø 16 mm · a confirmar`, V(-28, cableY(-28) + 0.6, 1.2));
  dimLabel(`Escada ≈ ${n} degraus × ${fmt((P.deckEnd - P.ground) / n * 100, 0)} cm · a contar`, V(h + P.landing + n * P.stairRun / 2, P.ground + 3.2, 1.6));
  dimLabel('Ancoragem dos cabos', V(h + P.anchorDist, P.ground + 1.2, 0));
  dimLabel('N.A. médio ±0,00 (referência)', V(-20, 0.1, 10));
  dimLabel('Praça / cais ≈ +1,60 m · estimado', V(-h - 4, P.ground + 0.3, 12));
})();

// =====================================================================
//  Luzes LED: construção, cálculo e HUD
// =====================================================================
const QUALITY = { leve: { dpr: 1, lights: 12, refl: 0.3, msaa: 0, bloom: 0.5 }, media: { dpr: 1.5, lights: 28, refl: 0.45, msaa: 4, bloom: 1 }, alta: { dpr: 2, lights: 44, refl: 0.7, msaa: 4, bloom: 1 } };
let lastCalc = null;
// orçamento global de luzes dinâmicas: a prévia nunca passa do limite da qualidade;
// grupos que iluminam o piso (corrimão, rodapé, escadas, pórtico) têm prioridade
const FLOOR_MOUNTS = ['handrail', 'postFoot', 'stairs', 'towerTop'];
function allocate() {
  const B = QUALITY[S.quality].lights, on = S.groups.filter(isOn);
  const want = on.reduce((a, g) => a + g.nLights, 0), out = new Map();
  if (want <= B) { on.forEach(g => out.set(g.id, g.nLights)); return out; }
  const w = (g) => g.nLights * (FLOOR_MOUNTS.includes(g.mount) ? 2 : 1), W = on.reduce((a, g) => a + w(g), 0);
  let used = 0;
  on.forEach(g => { const n = Math.min(g.nLights, Math.max(Math.min(2, g.nLights), Math.floor(B * w(g) / W))); out.set(g.id, n); used += n; });
  const order = [...on].sort((a, b) => w(b) - w(a));
  for (let i = 0; used < B && i < order.length * 4; i++) { const g = order[i % order.length]; if (out.get(g.id) < g.nLights) { out.set(g.id, out.get(g.id) + 1); used++; } }
  return out;
}
function applyAlloc() { const a = allocate(); let changed = false; S.groups.forEach(g => { const n = a.get(g.id) ?? g.nLights; if (g._alloc !== n) { changed = true; g._alloc = n; } }); return changed; }
function rebuildAll() { applyAlloc(); rig.shadows = S.shadows && S.quality !== 'leve'; rig.rebuildAll(S.groups); shadowsDirty(); scheduleCalc(); }
const pendingBuild = new Set();
function rebuildGroup(g) { pendingBuild.add(g); requestAnimationFrame(flushBuild); }
function flushBuild() {
  if (!pendingBuild.size) return;
  if (applyAlloc()) rig.rebuildAll(S.groups);
  else pendingBuild.forEach(g => rig.build(g));
  pendingBuild.clear(); rig.applyShadows(); shadowsDirty(); scheduleCalc(); persist();
}
const scheduleCalc = debounce(runCalc, 180);
let calcF = null, calcV = null;
function runCalc() {
  lastCalc = computeGrid(rig, S.groups);                                  // total (funcional + cênica): mapa e piso 3D
  calcF = computeGrid(rig, S.groups, { roles: ['funcional'] });           // só funcional: avaliação normativa
  calcV = computeVertical(rig, S.groups, { roles: ['funcional'] });       // vertical a 1,50 m
  const src = S.heatSrc === 'funcional' ? calcF : lastCalc;
  const { nx, nz } = lastCalc;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const c = falseColor(src.E[i * nz + j] * (S.heatSrc === 'funcional' ? S.fm : 1)), k = (j * nx + i) * 4;
    heat.data[k] = c[0]; heat.data[k + 1] = c[1]; heat.data[k + 2] = c[2]; heat.data[k + 3] = 255;
  }
  heat.tex.needsUpdate = true;
  // mapa de luz das pranchas = iluminância calculada (todas as luminárias, com cor)
  const dl = deckLight.tex.image.data, RGB = lastCalc.RGB, h16 = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const k = (j * deckLight.nx + i) * 4, q = (i * nz + j) * 3;
    dl[k] = h16(Math.min(RGB[q], 6e4)); dl[k + 1] = h16(Math.min(RGB[q + 1], 6e4)); dl[k + 2] = h16(Math.min(RGB[q + 2], 6e4)); dl[k + 3] = h16(1);
  }
  deckLight.tex.needsUpdate = true;
  poke();
  renderHUD(); renderCalc();
}
/** Valores mantidos = iniciais × fator de manutenção. Classe = a mais exigente atendida (estimativa). */
const maintained = () => calcF && ({ Em: calcF.Em * S.fm, Emin: calcF.Emin * S.fm, U0: calcF.U0, Ev: calcV.Evmin * S.fm });
function classOf(m) { for (const k of S.criteria) if (m.Em >= k.Em && m.Emin >= k.Emin) return k.c; return null; }
function renderHUD() {
  const st = rig.stats(S.groups), m = maintained(); if (!m) return;
  const cls = classOf(m), last = S.criteria[S.criteria.length - 1]?.c || '';
  $('#hud').innerHTML = `
    <div class="chip" title="Só a camada funcional, valor mantido (× FM ${fmt(S.fm, 2)})"><small>Em funcional mantida</small>${fmt(m.Em, 1)} lx</div>
    <div class="chip"><small>Emin mantida</small>${fmt(m.Emin, 1)} lx</div>
    <div class="chip" title="Iluminância vertical mínima a 1,50 m, pior sentido"><small>Ev mín. 1,5 m</small>${fmt(m.Ev, 1)} lx</div>
    <div class="chip"><small>Potência</small>${fmt(st.W, 0)} W</div>
    <div class="chip ${cls ? 'ok' : 'no'}" title="Estimativa com critérios de referência editáveis na aba Cálculo — confirme na NBR 5101:2024"><small>Estimativa · critério de referência</small>${cls ? 'Compatível com ' + cls + '*' : 'Abaixo de ' + last + '*'}</div>`;
}
const poke = () => { perf.lastInput = performance.now(); };

// =====================================================================
//  Interface
// =====================================================================
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
  return e;
}
function slider({ id, label, min, max, step, value, f = (v) => v, on }) {
  const out = el('b', {}, f(value));
  const inp = el('input', { type: 'range', id, min, max, step, value });
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = f(v); on(v); });
  return el('div', { class: 'field' }, el('div', { class: 'lab' }, el('label', { for: id }, label), out), inp);
}
function toggle({ id, label, checked, on }) {
  const inp = el('input', { type: 'checkbox', id, checked: !!checked, onchange: () => on(inp.checked) });
  return el('div', { class: 'row' }, el('label', { for: id }, label), el('span', { class: 'switch' }, inp, el('span')));
}
function seg(opts, value, on, id) {
  const wrap = el('div', { class: 'seg', role: 'group', id });
  opts.forEach(([v, l]) => {
    const b = el('button', { type: 'button', 'aria-pressed': String(v === value) }, l);
    b.addEventListener('click', () => { wrap.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); on(v); });
    wrap.append(b);
  });
  return wrap;
}
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); if (ms) toast._t = setTimeout(() => { t.hidden = true; }, ms); }

// abas
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + b.dataset.tab));
  $('#panel').classList.remove('min');
  try { localStorage.setItem('ponte-pensil-tab', b.dataset.tab); } catch (e) { /* ignora */ }
}));
$('#sheetToggle').addEventListener('click', () => { const p = $('#panel'); p.classList.toggle('min'); $('#sheetToggle').textContent = p.classList.contains('min') ? '▴' : '▾'; setTimeout(resize, 50); });

// --- vistas ---
const VIEWS = [
  ['Geral', [-75, 32, 95], [0, 7, 0]],
  ['Do rio', [14, 1.6, 78], [0, 7.5, 0]],
  ['Pedestre', [-47.5, deckY(-47.5) + 1.62, 0.15], [10, deckY(10) + 1.2, 0]],
  ['Praça RS', [-68, P.ground + 1.7, 10], [-30, 9, 0]],
  ['Sob a ponte', [6, 1.1, 9], [-2, 5.6, -3]],
  ['Ponte de concreto', [-205, 14, -300], [-300, 5, -392]],
  ['Letreiro SC', [H() + 22, P.ground + 1.7, -9], [H() + 8.8, P.ground + 1.2, -3.4]],
  ['Rua (SC)', [H() + 40, P.ground + 1.65, 30], [H(), 9, 0]],
  ['Drone', [60, 90, 75], [0, 4, 0]],
];
let tween = null;
function flyTo(p, t) { tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: V(...p), t1: V(...t), s: performance.now(), d: 1200 }; }
VIEWS.forEach(([n, p, t]) => $('#views').append(el('button', { type: 'button', onclick: () => flyTo(p, t) }, n)));

// --- Cena ---
function renderScenePane() {
  const p = $('#pane-cena'); p.innerHTML = '';
  p.append(
    el('h3', {}, 'Navegação'),
    slider({ id: 'mouse', label: 'Sensibilidade do mouse', min: 0.15, max: 1.5, step: 0.05, value: S.mouse ?? 0.5, f: v => fmt(v * 100, 0) + '%', on: v => { S.mouse = v; applySensitivity(); persist(); } }),
    el('h3', {}, 'Período'),
    seg([['noite', 'Noite'], ['azul', 'Hora azul'], ['dia', 'Dia']], S.mode, v => { S.mode = v; applyMode(); persist(); }, 'modeSeg'),
    slider({ id: 'ev', label: 'Exposição da câmera', min: -4, max: 4, step: 0.1, value: S.ev, f: v => (v > 0 ? '+' : '') + fmt(v, 1) + ' EV', on: v => { S.ev = v; applyMode(); persist(); } }),
    slider({ id: 'bloom', label: 'Brilho (bloom) dos LEDs', min: 0, max: 2, step: 0.05, value: S.bloom, f: v => fmt(v, 2), on: v => { S.bloom = v; applyMode(); persist(); } }),
    el('h3', {}, 'Rio e atmosfera'),
    slider({ id: 'refl', label: 'Reflexo na água', min: 0, max: 2, step: 0.05, value: S.refl, f: v => fmt(v, 2) + '×', on: v => { S.refl = v; applyMode(); persist(); } }),
    slider({ id: 'ripple', label: 'Ondulação', min: 0, max: 0.12, step: 0.005, value: S.ripple, f: v => fmt(v * 100, 1), on: v => { S.ripple = v; applyMode(); persist(); } }),
    slider({ id: 'fog', label: 'Névoa / maresia', min: 0, max: 1, step: 0.05, value: S.fog, f: v => fmt(v * 100, 0) + '%', on: v => { S.fog = v; applyMode(); persist(); } }),
    el('h3', {}, 'Elementos'),
    toggle({ id: 'tLamps', label: 'Iluminação pública existente', checked: S.lamps, on: v => { S.lamps = v; applyMode(); persist(); } }),
    toggle({ id: 'tShadow', label: 'Sombras dos projetores (mais pesado)', checked: S.shadows, on: v => { S.shadows = v; rig.shadows = v && S.quality !== 'leve'; rig.applyShadows(); shadowsDirty(); if (v && S.quality === 'leve') toast('No modo Leve as sombras dos projetores ficam desligadas.'); persist(); } }),
    toggle({ id: 'tPeople', label: 'Pessoas em escala (1,75 m)', checked: S.people, on: v => { S.people = v; people.visible = v; perf.lodDirty = true; persist(); } }),
    slider({ id: 'haze', label: 'Facho visível no ar (umidade / maresia)', min: 0, max: 1, step: 0.05, value: S.haze ?? 0.45, f: v => v ? `σ ${fmt(hazeSigma(v) * 1000, 1)}‰/m` : 'ar limpo', on: v => { const was = rig.haze.value > 0; S.haze = v; rig.haze.value = hazeSigma(v); if (was !== v > 0) rebuildAll(); poke(); persist(); } }),
    toggle({ id: 'tCity', label: env.real ? 'Edificações, letreiros, barcos e ponte de concreto (OSM)' : 'Cidade e barcos', checked: S.city, on: v => { S.city = v; setCity(); persist(); } }),
    env.real ? el('p', { class: 'note', html: `Entorno real: ${env.stats.buildings} edificações, ${env.stats.roads} vias, ${env.stats.signs} letreiros de comércios e ${env.stats.trees} árvores, a partir do OpenStreetMap (© colaboradores do <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="color:var(--led)">OpenStreetMap</a>, ODbL). Alturas, cores e telhados são estimados.` }) : null,
    toggle({ id: 'tWater', label: 'Água animada com a cena parada (gasta mais bateria)', checked: S.waterAnim, on: v => { S.waterAnim = v; persist(); } }),
    toggle({ id: 'tDims', label: 'Cotas e medidas', checked: S.dims, on: v => { S.dims = v; dims.visible = v; labelRenderer.render(scene, camera); persist(); } }),
    el('h3', {}, 'Qualidade de renderização'),
    seg([['leve', 'Leve'], ['media', 'Média'], ['alta', 'Alta']], S.quality, v => { S.quality = v; perf.scale = 1; applyQuality(); rebuildAll(); persist(); }, 'qSeg'),
    el('p', { class: 'note', id: 'perfNote' }, 'Leve reduz resolução, reflexo, antisserrilhado e luzes dinâmicas (até 12; Média 28; Alta 44). A resolução também se ajusta sozinha para manter a fluidez. O cálculo de lux sempre usa todas as luminárias.'),
    el('h3', {}, 'Dimensões adotadas no modelo'),
    el('div', { class: 'tblwrap' }, el('table', { class: 'qt', html: `
      <tr><th>Elemento</th><th>Valor</th><th>Origem</th></tr>
      <tr><td>Vão entre torres</td><td>${fmt(P.L, 2)} m</td><td>publicado (≈100 m)</td></tr>
      <tr><td>Largura livre</td><td>${fmt(P.W, 2)} m</td><td>publicado (≈1,5 m)</td></tr>
      <tr><td>Piso nas torres / no meio</td><td>+${fmt(P.deckEnd, 2)} / +${fmt(deckY(0), 2)} m</td><td>estimado (fotos)</td></tr>
      <tr><td>Sela dos cabos</td><td>+${fmt(P.towerTop, 2)} m</td><td>estimado (fotos)</td></tr>
      <tr><td>Cabo no meio / flecha</td><td>+${fmt(P.cableLow, 2)} / ${fmt(P.towerTop - P.cableLow, 2)} m</td><td>estimado (fotos)</td></tr>
      <tr><td>Cabos principais</td><td>2 × Ø 38 mm por lado</td><td>pré-dimensionado</td></tr>
      <tr><td>Pendurais</td><td>Ø 16 mm a cada ${fmt(P.hangerStep, 1)} m</td><td>estimado — contar</td></tr>
      <tr><td>Pranchas</td><td>150 × 45 mm, junta 12 mm</td><td>estimado — medir</td></tr>
      <tr><td>Guarda-corpo</td><td>${fmt(P.railH, 2)} m, tela 50 × 50 mm</td><td>estimado — medir</td></tr>
      <tr><td>Praças / cais</td><td>+${fmt(P.ground, 2)} m</td><td>estimado</td></tr>` })),
    el('p', { class: 'note', html: 'Só o vão, a largura e os materiais vêm de fontes publicadas. O resto foi estimado por fotos ou pré-dimensionado. A lista do que medir está no <a href="guia.html#levantamento" style="color:var(--led)">memorial</a>.' }),
  );
}
function setCity() {
  if (env.real) { env.city.forEach(o => { o.visible = S.city; }); shadowsDirty(); return; }
  env.group.traverse(o => { if (['Edificios_Torres', 'Casas_PassoDeTorres', 'Telhados', 'Barcos', 'Ponte_concreto_referencia'].includes(o.name)) o.visible = S.city; });
}

// --- Luminárias ---
const openGroups = new Set();
let placing = null; // { g, step: 'place'|'aim' }
function renderLightPane() {
  const p = $('#pane-luz'); p.innerHTML = '';
  const sel = el('select', { id: 'presetSel' }, Object.entries(PRESETS).map(([k, v]) => el('option', { value: k, selected: k === S.preset }, v.nome)));
  p.append(
    el('h3', {}, 'Cenas prontas'),
    el('div', { class: 'pair' }, sel, el('button', { class: 'btn primary', type: 'button', onclick: () => {
      S.preset = sel.value; const old = S.groups.filter(g => g.mount === 'custom');
      S.groups = presetGroups(sel.value);
      // avulsas: mantém as posições do usuário (e os grupos que ele criou); a cena só decide se ligam
      for (const c of old) {
        const ng = c.key && S.groups.find(x => x.key === c.key);
        if (ng) { if (c.fixtures.length) Object.assign(ng, { ...c, id: ng.id, on: ng.on }); }
        else S.groups.push(c);
      }
      rebuildAll(); renderLightPane(); persist(); toast('Cena aplicada: ' + PRESETS[sel.value].nome);
    } }, 'Aplicar')),
    el('h3', {}, 'Camadas'),
    toggle({ id: 'layF', label: 'Funcional — piso, circulação, escadas (avaliada na norma)', checked: S.layers.funcional, on: v => { S.layers.funcional = v; LAYERS.funcional = v; rebuildAll(); renderLightPane(); persist(); } }),
    toggle({ id: 'layC', label: 'Cênica — torres, cabos, cor, efeitos', checked: S.layers.cenica, on: v => { S.layers.cenica = v; LAYERS.cenica = v; rebuildAll(); renderLightPane(); persist(); } }),
    el('h3', {}, 'Grupos de luminárias'),
    el('p', { class: 'note' }, 'Cada grupo é uma linha de luminárias montada num ponto da ponte. Ligue, troque o modelo e ajuste cor, potência, nits e facho, ou carregue a curva fotométrica real (.ies/.ldt) do fabricante.'),
  );
  // novo grupo de luminárias avulsas
  const tSel = el('select', { id: 'newType' }, MOUNTS.custom.types.map(t => el('option', { value: t }, TYPES[t].nome)));
  p.append(el('h3', {}, 'Posicionar luminárias manualmente'),
    el('p', { class: 'note' }, 'Crie um grupo, escolha o modelo e clique na ponte, no chão, numa fachada ou numa árvore para fixar cada luminária. O suporte fica preso à superfície; depois mire com outro clique, arraste com as setas ou ajuste giro/inclinação. Clique numa luminária avulsa para selecioná-la.'),
    el('div', { class: 'pair' }, tSel, el('button', { class: 'btn primary', type: 'button', onclick: () => {
      const T = TYPES[tSel.value];
      const g = G({ name: 'Avulsas — ' + T.curto, mount: 'custom', type: tSel.value, beam: T.beams[Math.floor(T.beams.length / 2)], power: Math.min(T.p[1], Math.max(T.p[0], tSel.value === 'proj10' ? 10 : 20)), nLights: 6, on: true, colorMode: 'cct', cct: 3000 });
      S.groups.push(g); openGroups.add(g.id); rebuildGroup(g); renderLightPane(); startPlacing(g);
    } }, 'Novo grupo')));
  S.groups.forEach(g => p.append(groupCard(g)));
}
function swatchColor(g) { const c = groupColor(g); return '#' + c.getHexString(THREE.SRGBColorSpace); }
function groupCard(g) {
  const T = TYPES[g.type], Mo = MOUNTS[g.mount];
  const open = openGroups.has(g.id);
  const card = el('div', { class: 'group' + (open ? ' open' : ''), 'data-gid': g.id });
  const sw = el('span', { class: 'swatch', style: `background:${isOn(g) ? swatchColor(g) : 'transparent'}` });
  const sub = el('small', {}, '');
  const updSub = () => {
    const rt = rig.rt.get(g.id); const qty = rt ? (T.linear ? `${fmt(rt.length, 0)} m` : `${rt.count} un`) : '';
    const w = rt ? g.power * (T.linear ? rt.length : rt.count) * g.dim / 100 : 0;
    sub.textContent = `${roleOf(g) === 'funcional' ? 'Funcional' : 'Cênica'} · ${g.photo ? g.photo.kind : TYPES[g.type].curto} · ${qty} · ${fmt(w, 0)} W${g.on && !isOn(g) ? ' · camada oculta' : ''}`;
    sw.style.background = isOn(g) ? swatchColor(g) : 'transparent';
  };
  const onInp = el('input', { type: 'checkbox', checked: g.on, 'aria-label': 'Ligar ' + g.name });
  onInp.addEventListener('click', e => e.stopPropagation());
  onInp.addEventListener('change', () => { g.on = onInp.checked; rebuildGroup(g); setTimeout(updSub, 60); });
  const head = el('div', { class: 'ghead', role: 'button', tabindex: 0 },
    sw, el('div', { class: 'gtitle' }, el('b', {}, Mo.icon + '  ' + g.name), sub),
    el('span', { class: 'switch' }, onInp, el('span')));
  const toggleOpen = () => { if (openGroups.has(g.id)) openGroups.delete(g.id); else openGroups.add(g.id); const n = groupCard(g); card.replaceWith(n); };
  head.addEventListener('click', toggleOpen);
  head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOpen(); } });
  card.append(head);
  setTimeout(updSub, 0);
  if (!open) return card;

  const body = el('div', { class: 'gbody' });
  const spec = el('div', { class: 'spec' });
  const nitsIn = el('input', { type: 'number', id: g.id + '-nits', min: 1, step: 10 });
  const powIn = el('input', { type: 'number', id: g.id + '-pow', min: T.p[0], max: T.p[1], step: T.p[2], value: g.power });
  const powSl = el('input', { type: 'range', id: g.id + '-pows', min: T.p[0], max: T.p[1], step: T.p[2], value: g.power });
  const refresh = () => {
    const rt = rig.rt.get(g.id); const qty = rt ? (T.linear ? rt.length : rt.count) : 0;
    const fl = fluxUnit(g) * qty;
    nitsIn.value = Math.round(nitsOf(g));
    powIn.value = g.power; powSl.value = g.power;
    spec.innerHTML = `
      <div><small>Quantidade</small><span>${T.linear ? fmt(qty, 1) + ' m' : qty + ' un'}</span></div>
      <div><small>Potência total</small><span>${fmt(g.power * qty * g.dim / 100, 0)} W</span></div>
      <div><small>Fluxo total</small><span>${fmt(fl, 0)} lm</span></div>
      <div><small>Eficácia</small><span>${efficacy(g)} lm/W</span></div>
      <div><small>Intensidade${T.linear ? '/m' : ''}</small><span>${fmt(candela(g), 0)} cd</span></div>
      <div><small>Luminância</small><span>${fmt(nitsOf(g), 0)} nits</span></div>`;
    updSub();
  };
  const change = (fn, rebuild = true) => (v) => { fn(v); if (rebuild) rebuildGroup(g); requestAnimationFrame(() => requestAnimationFrame(refresh)); };

  // modelo de luminária
  const typeSel = el('select', { id: g.id + '-type' }, Mo.types.map(t => el('option', { value: t, selected: t === g.type }, TYPES[t].nome)));
  typeSel.addEventListener('change', () => {
    g.type = typeSel.value; const NT = TYPES[g.type];
    g.beam = NT.beams.reduce((a, b) => Math.abs(b - g.beam) < Math.abs(a - g.beam) ? b : a, NT.beams[0]);
    g.power = Math.min(NT.p[1], Math.max(NT.p[0], g.power)); g.effOverride = null;
    rebuildGroup(g); requestAnimationFrame(() => { const n = groupCard(g); card.replaceWith(n); });
  });
  body.append(el('div', { class: 'field' }, el('div', { class: 'lab' }, el('label', { for: g.id + '-type' }, 'Luminária'), el('b', {}, T.ip)), typeSel, el('p', { class: 'note' }, T.desc)));
  body.append(el('div', { class: 'field' }, el('div', { class: 'lab' }, el('span', {}, 'Função')),
    seg([['funcional', 'Funcional'], ['cenica', 'Cênica']], roleOf(g), v => { g.role = v; rebuildGroup(g); requestAnimationFrame(() => { const n = groupCard(g); card.replaceWith(n); }); })));
  // curva fotométrica real
  const phIn = el('input', { type: 'file', id: g.id + '-ies', accept: '.ies,.ldt,.eul,.IES,.LDT', hidden: true });
  phIn.addEventListener('change', async () => {
    const f = phIn.files[0]; if (!f) return;
    try {
      const ph = parsePhotometry(await f.text(), f.name);
      g.photo = packPhoto(ph); g.photo.file = f.name;
      if (ph.watts > 0) g.power = +(ph.watts / (T.linear ? Math.max(0.1, ph.lenM || 1) : 1)).toFixed(2);
      rebuildGroup(g); toast(`Curva carregada: ${ph.name || f.name} — ${fmt(ph.flux, 0)} lm, Imax ${fmt(ph.Imax, 0)} cd, facho ${fmt(ph.beam, 0)}°`, 5000);
      requestAnimationFrame(() => { const n = groupCard(g); card.replaceWith(n); });
    } catch (e) { toast('Não consegui ler a curva: ' + e.message, 6000); }
    phIn.value = '';
  });
  body.append(el('div', { class: 'field' }, el('div', { class: 'lab' }, el('span', {}, 'Curva fotométrica'), el('b', {}, g.photo ? g.photo.kind : 'modelo idealizado')),
    g.photo ? el('p', { class: 'note', html: `<b>${g.photo.name || g.photo.file}</b>${g.photo.maker ? ' · ' + g.photo.maker : ''}<br>${fmt(g.photo.flux, 0)} lm · ${fmt(g.photo.watts, 1)} W · Imax ${fmt(g.photo.Imax, 0)} cd · facho ${fmt(g.photo.beam, 0)}°${T.linear ? ` · peça de ${fmt(g.photo.lenM || 1, 2)} m` : ''}. Potência, fluxo e facho vêm do arquivo; a dimerização continua valendo.` })
      : el('p', { class: 'note' }, 'Sem arquivo, o facho é um cone uniforme com borda suave: bom para estudo, não para memorial de cálculo. Carregue o .ies ou .ldt do fabricante para usar a distribuição real.'),
    el('div', { class: 'btns' }, el('button', { class: 'btn', type: 'button', onclick: () => phIn.click() }, g.photo ? 'Trocar arquivo' : 'Carregar .ies / .ldt'), phIn,
      g.photo ? el('button', { class: 'btn', type: 'button', onclick: () => { g.photo = null; rebuildGroup(g); requestAnimationFrame(() => { const n = groupCard(g); card.replaceWith(n); }); } }, 'Remover curva') : null,
      g.photo ? el('button', { class: 'btn', type: 'button', title: 'Gira o plano C0 da curva em 90° em torno do eixo da luminária', onclick: () => { g.photoRot = !g.photoRot; rebuildGroup(g); toast(g.photoRot ? 'C0 girado 90°' : 'C0 alinhado ao eixo da ponte / da peça'); } }, 'Girar C0 90°') : null)));

  // cor
  const colorBox = el('div', { class: 'field' });
  const drawColor = () => {
    colorBox.innerHTML = '';
    colorBox.append(el('div', { class: 'lab' }, el('span', {}, 'Cor da luz'), el('b', {}, g.colorMode === 'cct' ? fmt(g.cct) + ' K' : g.rgb.toUpperCase())));
    colorBox.append(seg([['cct', 'Branco (K)'], ['rgb', 'Cor RGB']], g.colorMode, v => { g.colorMode = v; drawColor(); change(() => {})(); }));
    if (g.colorMode === 'cct') {
      const s = el('input', { type: 'range', id: g.id + '-cct', min: 1800, max: 6500, step: 100, value: g.cct, 'aria-label': 'Temperatura de cor' });
      s.addEventListener('input', () => { g.cct = +s.value; colorBox.querySelector('.lab b').textContent = fmt(g.cct) + ' K'; change(() => {})(); });
      colorBox.append(el('div', { class: 'cct-track' }), s,
        el('div', { class: 'swatches' }, [2200, 2700, 3000, 4000, 5000, 6500].map(k => el('button', { type: 'button', title: k + ' K', style: `background:#${cctToSRGB(k).getHexString(THREE.SRGBColorSpace)}`, onclick: () => { g.cct = k; drawColor(); change(() => {})(); } }))));
    } else {
      const ci = el('input', { type: 'color', id: g.id + '-rgb', value: g.rgb, 'aria-label': 'Cor RGB' });
      ci.addEventListener('input', () => { g.rgb = ci.value; colorBox.querySelector('.lab b').textContent = g.rgb.toUpperCase(); change(() => {})(); });
      const sws = ['#1f2fff', '#2b55ff', '#00b7ff', '#00e0c0', '#22ff66', '#ffd000', '#ff8a00', '#ff2020', '#ff2fa0', '#8a2cff', '#ffffff'];
      colorBox.append(el('div', { class: 'swatches' }, ci, sws.map(c => el('button', { type: 'button', title: c, style: `background:${c}`, onclick: () => { g.rgb = c; drawColor(); change(() => {})(); } }))));
    }
  };
  drawColor(); body.append(colorBox);

  // potência / nits
  if (g.photo) { [powSl, powIn, nitsIn].forEach(x => { x.disabled = true; x.title = 'Definido pelo arquivo fotométrico'; }); }
  powSl.addEventListener('input', () => change(v => { g.power = v; })(+powSl.value));
  powIn.addEventListener('change', () => change(v => { g.power = Math.min(T.p[1], Math.max(T.p[0], v)); })(+powIn.value));
  nitsIn.addEventListener('change', () => change(v => {
    const want = powerForNits(g, v); g.power = Math.min(T.p[1], Math.max(T.p[0], Math.round(want / T.p[2]) * T.p[2]));
    if (Math.abs(want - g.power) / want > 0.05) toast(`Para ${fmt(v)} nits seriam ${fmt(want, 1)} ${T.unit}; limitado à faixa do modelo (${T.p[0]}–${T.p[1]} ${T.unit}).`, 4500);
  })(+nitsIn.value));
  body.append(
    el('div', { class: 'field' }, el('div', { class: 'lab' }, el('label', { for: g.id + '-pows' }, `Potência (${T.unit})`), el('b', {}, `${T.p[0]}–${T.p[1]}`)), el('div', { class: 'pair' }, powSl, powIn)),
    el('div', { class: 'field' }, el('div', { class: 'lab' }, el('label', { for: g.id + '-nits' }, 'Luminância da superfície emissora (nits)'), el('b', {}, 'cd/m²')), nitsIn,
      el('p', { class: 'note' }, 'Ao digitar os nits, a potência é recalculada: P = L · Ω · A / (η · dimmer).')),
    slider({ id: g.id + '-dim', label: 'Dimerização', min: 1, max: 100, step: 1, value: g.dim, f: v => v + '%', on: change(v => { g.dim = v; }) }),
  );
  if (T.beams.length > 1 && !g.photo) body.append(el('div', { class: 'field' }, el('div', { class: 'lab' }, el('span', {}, 'Abertura do facho'), el('b', {}, g.beam + '°')),
    seg(T.beams.map(b => [b, b + '°']), g.beam, v => { g.beam = v; change(() => {})(); })));
  const effIn = el('input', { type: 'number', id: g.id + '-eff', min: 20, max: 220, step: 1, placeholder: 'auto: ' + efficacy({ ...g, effOverride: null }), value: g.effOverride || '' });
  effIn.addEventListener('change', () => change(v => { g.effOverride = v > 0 ? v : null; })(parseFloat(effIn.value)));
  body.append(el('div', { class: 'field' }, el('div', { class: 'lab' }, el('label', { for: g.id + '-eff' }, 'Eficácia (lm/W) — vazio = automático pela cor'), el('b', {}, '')), effIn));

  // parâmetros de montagem
  const isPoint = !T.linear;
  const mp = Mo.params.filter(pp => !pp.only || (pp.only === 'point') === isPoint);
  if (mp.length) body.append(el('h3', {}, 'Montagem — ' + Mo.nome));
  for (const pp of mp) {
    if (pp.type === 'bool') body.append(toggle({ id: g.id + '-' + pp.k, label: pp.l, checked: g.params[pp.k], on: change(v => { g.params[pp.k] = v; }) }));
    else if (pp.type === 'select') body.append(el('div', { class: 'field' }, el('div', { class: 'lab' }, el('span', {}, pp.l)), seg(pp.opts, g.params[pp.k], change(v => { g.params[pp.k] = v; }))));
    else body.append(slider({ id: g.id + '-' + pp.k, label: pp.l, min: pp.min, max: pp.max, step: pp.step, value: g.params[pp.k], f: v => fmt(v, pp.step < 1 ? 2 : 0) + (pp.u ? ' ' + pp.u : ''), on: change(v => { g.params[pp.k] = v; }) }));
  }
  if (g.mount === 'custom') body.append(fixtureEditor(g, card));
  else if (!T.linear) body.append(el('div', { class: 'btns' }, el('button', { class: 'btn', type: 'button', title: 'Copia este grupo como luminárias avulsas, uma a uma, para mover e mirar livremente', onclick: () => editIndividually(g) }, 'Editar individualmente')));

  // efeitos
  body.append(el('h3', {}, 'Efeito (controle DMX)'));
  const effSel = el('select', { id: g.id + '-fx' }, EFFECTS.map(([k, l]) => el('option', { value: k, selected: k === g.effect }, l)));
  effSel.addEventListener('change', () => { g.effect = effSel.value; rebuildGroup(g); requestAnimationFrame(() => { const n = groupCard(g); card.replaceWith(n); }); });
  body.append(effSel);
  if (g.effect !== 'estatico') body.append(
    slider({ id: g.id + '-spd', label: 'Velocidade', min: 0.05, max: 2, step: 0.05, value: g.speed, f: v => fmt(v, 2), on: change(v => { g.speed = v; }) }),
    slider({ id: g.id + '-lam', label: 'Comprimento da onda', min: 2, max: 60, step: 1, value: g.lambda, f: v => v + ' m', on: change(v => { g.lambda = v; }) }));

  body.append(el('h3', {}, 'Resultado do grupo'), spec,
    slider({ id: g.id + '-nl', label: 'Luzes dinâmicas na prévia', min: 1, max: 24, step: 1, value: g.nLights, f: v => v, on: change(v => { g.nLights = v; }) }),
    el('p', { class: 'note' }, 'A prévia agrupa luminárias em poucas luzes para rodar no navegador. O cálculo de lux e o quantitativo usam cada luminária individualmente.'));
  card.append(body);
  setTimeout(refresh, 30);
  return card;
}

// --- Editor de luminárias avulsas ---
let sel = null; // { g, i }
const dirOf = (pan, tilt) => { const p = pan * Math.PI / 180, t = tilt * Math.PI / 180; return [Math.cos(t) * Math.cos(p), Math.sin(t), Math.cos(t) * Math.sin(p)].map(v => +v.toFixed(4)); };
const panTilt = (d) => [Math.atan2(d[2], d[0]) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, d[1]))) * 180 / Math.PI];
function refreshCard(g) { const old = document.querySelector(`[data-gid="${g.id}"]`); if (old) old.replaceWith(groupCard(g)); }
function fixtureEditor(g, card) {
  const wrap = el('div', { class: 'fixed' });
  const T = TYPES[g.type];
  wrap.append(el('h3', {}, `Luminárias avulsas (${g.fixtures.length})`),
    el('div', { class: 'btns' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => startPlacing(g) }, 'Posicionar (clique)'),
      g.fixtures.length ? el('button', { class: 'btn', type: 'button', onclick: () => { g.fixtures = []; selectFixture(null); rebuildGroup(g); refreshCard(g); } }, 'Limpar tudo') : null,
      !g.key ? el('button', { class: 'btn', type: 'button', onclick: () => { S.groups = S.groups.filter(x => x !== g); selectFixture(null); rig.clear(g.id); rebuildAll(); renderLightPane(); persist(); toast('Grupo excluído.'); } }, 'Excluir grupo') : null));
  if (!g.fixtures.length) { wrap.append(el('p', { class: 'note' }, 'Nenhuma luminária ainda. Clique em “Posicionar” e depois na superfície onde ela será fixada.')); return wrap; }
  const list = el('div', { class: 'fxlist' });
  g.fixtures.forEach((f, i) => {
    const on = sel && sel.g === g && sel.i === i, [pan, tilt] = panTilt(f.d);
    const row = el('div', { class: 'fxrow' + (on ? ' on' : '') },
      el('button', { class: 'fxname', type: 'button', onclick: () => selectFixture(on ? null : { g, i }) }, `#${i + 1}`, el('small', {}, ` X ${fmt(f.p[0], 1)} · Z ${fmt(f.p[2], 1)} · +${fmt(f.p[1], 2)} m · giro ${fmt(pan, 0)}° · incl. ${fmt(tilt, 0)}°`)),
      el('button', { class: 'btn', type: 'button', title: 'Duplicar', onclick: () => { const c = JSON.parse(JSON.stringify(f)); c.p[2] += 0.5; g.fixtures.splice(i + 1, 0, c); rebuildGroup(g); selectFixture({ g, i: i + 1 }); } }, '⧉'),
      el('button', { class: 'btn', type: 'button', title: 'Excluir', onclick: () => { g.fixtures.splice(i, 1); if (sel && sel.g === g) selectFixture(null); rebuildGroup(g); refreshCard(g); } }, '✕'));
    list.append(row);
    if (on) {
      const upd = (fn) => { fn(); rebuildGroup(g); placeMarker(); };
      const num = (k, lab) => { const x = el('input', { type: 'number', step: 0.05, value: (+f.p[k]).toFixed(2), 'aria-label': lab }); x.addEventListener('change', () => upd(() => { f.p[k] = +x.value; })); return el('label', { class: 'mini' }, lab, x); };
      const panS = slider({ id: `${g.id}-pan-${i}`, label: 'Giro (azimute)', min: -180, max: 180, step: 1, value: Math.round(pan), f: v => v + '°', on: v => upd(() => { f.d = dirOf(v, panTilt(f.d)[1]); }) });
      const tiltS = slider({ id: `${g.id}-tilt-${i}`, label: 'Inclinação (90° = para cima)', min: -90, max: 90, step: 1, value: Math.round(tilt), f: v => v + '°', on: v => upd(() => { f.d = dirOf(panTilt(f.d)[0], v); }) });
      row.after(el('div', { class: 'fxedit' },
        el('div', { class: 'xyz' }, num(0, 'X'), num(1, 'Cota'), num(2, 'Z')),
        panS, tiltS,
        el('div', { class: 'btns' },
          el('button', { class: 'btn', type: 'button', onclick: () => attachGizmo(gizmo.object ? null : { g, i }) }, gizmo.object ? 'Soltar setas' : 'Mover com setas'),
          el('button', { class: 'btn', type: 'button', onclick: () => { placing = { g, step: 'aim', idx: i, once: true }; toast('Clique no ponto que esta luminária deve iluminar. Esc cancela.', 0); } }, 'Mirar clicando'),
          el('button', { class: 'btn', type: 'button', onclick: () => { placing = { g, step: 'place', idx: i, once: true }; toast('Clique na nova posição desta luminária. Esc cancela.', 0); } }, 'Reposicionar'),
          el('button', { class: 'btn', type: 'button', onclick: () => upd(() => { f.d = (f.n || [0, 1, 0]).slice(); }) }, 'Mirar na normal'))));
    }
  });
  wrap.append(list);
  if (T.prof) wrap.append(el('p', { class: 'note' }, 'O facho no ar depende do controle “Facho visível no ar” (aba Cena). Em ar limpo ele quase não aparece; com umidade ou maresia fica como na foto do produto.'));
  return wrap;
}
function editIndividually(g) {
  const rt = rig.rt.get(g.id); const pts = MOUNTS[g.mount].points ? MOUNTS[g.mount].points(g) : [];
  if (!pts.length) { toast('Este grupo não tem pontos para separar.'); return; }
  const { id, _alloc, key, params, fixtures, ...rest } = g;
  const ng = G({ ...JSON.parse(JSON.stringify(rest)), name: g.name + ' (avulsas)', mount: 'custom', on: true,
    fixtures: pts.map(f => ({ p: f.p.toArray().map(v => +v.toFixed(3)), d: f.d.toArray().map(v => +v.toFixed(4)), n: (f.n || V(0, 1, 0)).toArray() })) });
  if (!MOUNTS.custom.types.includes(ng.type)) ng.type = 'flood';
  g.on = false; S.groups.push(ng); openGroups.add(ng.id); rebuildAll(); renderLightPane(); persist();
  toast(`${pts.length} luminárias copiadas para “${ng.name}”. O grupo original foi desligado.`, 5000);
  void rt;
}
// marcador da luminária selecionada + setas de translação
const selMarker = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffb020, depthTest: false, transparent: true, fog: false }));
selMarker.renderOrder = 20; selMarker.visible = false; scene.add(selMarker);
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('translate'); gizmo.setSize(0.8); scene.add(gizmo);
const gizmoTarget = new THREE.Object3D(); scene.add(gizmoTarget);
gizmo.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; poke(); });
gizmo.addEventListener('objectChange', () => {
  if (!sel) return; const f = sel.g.fixtures[sel.i]; if (!f) return;
  const p = gizmoTarget.position; if (p.y < -1) p.y = -1;
  f.p = p.toArray().map(v => +v.toFixed(3)); rebuildGroup(sel.g); placeMarker(); poke();
});
gizmo.addEventListener('mouseUp', () => { if (sel) refreshCard(sel.g); });
function gizmoTone() { // cores das setas compensadas pela exposição da câmera
  const k = Math.min(400, 0.9 / exposure);
  gizmo.traverse(o => { if (o.material && o.material.color) { if (!o.material.userData.base) o.material.userData.base = o.material.color.clone(); o.material.color.copy(o.material.userData.base).multiplyScalar(k); } });
  selMarker.material.color.setRGB(1, 0.69, 0.13).multiplyScalar(k);
}
function placeMarker() {
  const f = sel && sel.g.fixtures[sel.i];
  selMarker.visible = !!f; if (!f) return;
  selMarker.position.fromArray(f.p); selMarker.lookAt(V(...f.p).add(V(...f.d)));
  if (gizmo.object) gizmoTarget.position.fromArray(f.p);
  poke();
}
function attachGizmo(s) {
  if (s) { selectFixture(s, false); gizmoTarget.position.fromArray(s.g.fixtures[s.i].p); gizmo.attach(gizmoTarget); gizmoTone(); }
  else gizmo.detach();
  if (sel) refreshCard(sel.g); poke();
}
function selectFixture(s, refresh = true) {
  const prev = sel && sel.g; sel = s;
  if (!s) gizmo.detach(); else if (gizmo.object) gizmoTarget.position.fromArray(s.g.fixtures[s.i].p);
  placeMarker();
  if (refresh) { if (prev && prev !== (s && s.g)) refreshCard(prev); if (s) { openGroups.add(s.g.id); refreshCard(s.g); document.querySelector(`[data-gid="${s.g.id}"] .fxrow.on`)?.scrollIntoView({ block: 'nearest' }); } }
}
/** Luminária avulsa mais próxima do clique (em pixels). */
function fixtureAt(ev, px = 16) {
  const r = renderer.domElement.getBoundingClientRect(), v = V(); let best = null;
  for (const g of S.groups) { if (g.mount !== 'custom' || !isOn(g)) continue;
    g.fixtures.forEach((f, i) => {
      v.fromArray(f.p).project(camera); if (v.z > 1) return;
      const d = Math.hypot((v.x + 1) / 2 * r.width - (ev.clientX - r.left), (1 - v.y) / 2 * r.height - (ev.clientY - r.top));
      if (d < px && (!best || d < best.d)) best = { g, i, d };
    }); }
  return best;
}

// --- Cálculo ---
function renderCalc() {
  const p = $('#pane-calc'); if (!lastCalc) return;
  const c = lastCalc, st = rig.stats(S.groups);
  const kwh = st.W / 1000 * S.hours * 30;
  p.innerHTML = '';
  const hoursIn = el('input', { type: 'number', id: 'hours', min: 1, max: 24, step: 0.5, value: S.hours });
  const tarIn = el('input', { type: 'number', id: 'tarifa', min: 0, max: 5, step: 0.01, value: S.tarifa });
  hoursIn.addEventListener('change', () => { S.hours = +hoursIn.value || 12; renderCalc(); persist(); });
  tarIn.addEventListener('change', () => { S.tarifa = +tarIn.value || 0; renderCalc(); persist(); });
  const m = maintained(), cls = classOf(m);
  const fmIn = el('input', { type: 'number', id: 'fm', min: 0.4, max: 1, step: 0.01, value: S.fm });
  fmIn.addEventListener('change', () => { S.fm = Math.min(1, Math.max(0.4, +fmIn.value || 0.8)); renderHUD(); renderCalc(); persist(); });
  const crit = el('table', { class: 'qt' });
  crit.innerHTML = '<tr><th>Classe</th><th>Ē mantida ≥</th><th>Emin mantida ≥</th><th>Situação*</th></tr>';
  S.criteria.forEach((k, i) => {
    const ok = m.Em >= k.Em && m.Emin >= k.Emin, tr = el('tr');
    const inp = (key) => { const x = el('input', { type: 'number', min: 0, step: 0.1, value: k[key], 'aria-label': `${k.c} ${key}`, style: 'width:76px;padding:4px 6px' }); x.addEventListener('change', () => { S.criteria[i][key] = +x.value || 0; persist(); renderHUD(); renderCalc(); }); return x; };
    tr.append(el('td', {}, k.c), el('td', {}, inp('Em')), el('td', {}, inp('Emin')), el('td', { html: `<span class="pill ${ok ? 'ok' : 'no'}">${ok ? 'compatível' : 'não'}</span>` }));
    crit.append(tr);
  });
  p.append(
    el('div', { class: 'note', html: '<b>Estimativa de estudo.</b> Os resultados abaixo são calculados pelo modelo e dependem de cotas e potências estimadas. Não substituem o cálculo luminotécnico de projeto (software com arquivos IES/LDT certificados, malha e fator de manutenção definidos em norma).' }),
    el('h3', {}, 'Camada funcional — valores mantidos'),
    el('div', { class: 'kpis', html: `
      <div class="kpi"><small>Ē mantida</small><b>${fmt(m.Em, 1)}<em>lx</em></b></div>
      <div class="kpi"><small>Emin mantida</small><b>${fmt(m.Emin, 1)}<em>lx</em></b></div>
      <div class="kpi"><small>Uniformidade Emin/Ē</small><b>${fmt(m.U0, 2)}</b></div>
      <div class="kpi"><small>Ev mín. a 1,5 m</small><b>${fmt(m.Ev, 1)}<em>lx</em></b></div>` }),
    el('div', { class: 'pair' }, el('label', { for: 'fm' }, 'Fator de manutenção (FM)'), fmIn),
    el('p', { class: 'note' }, `Mantido = inicial × FM. Iniciais da camada funcional: Ē ${fmt(calcF.Em, 1)} lx, Emin ${fmt(calcF.Emin, 1)} lx, Emáx ${fmt(calcF.Emax, 1)} lx. Ev é a iluminância vertical a 1,50 m no eixo, no pior dos dois sentidos de caminhada (reconhecimento de rostos), média ${fmt(calcV.Evavg * S.fm, 1)} lx.`),
    el('h3', {}, 'Total com a camada cênica (inicial)'),
    el('div', { class: 'kpis', html: `
      <div class="kpi"><small>Ē total</small><b>${fmt(c.Em, 1)}<em>lx</em></b></div>
      <div class="kpi"><small>Emáx total</small><b>${fmt(c.Emax, 1)}<em>lx</em></b></div>` }),
    el('p', { class: 'note' }, 'A luz cênica (cores, efeitos) não entra na avaliação: luz saturada e dinâmica não serve de base para iluminação de circulação.'),
    toggle({ id: 'tHeat', label: 'Mostrar mapa de falsa cor no piso', checked: S.heat, on: v => { S.heat = v; heat.mesh.visible = v; $('#legend').hidden = !v; persist(); } }),
    seg([['total', 'Mapa: total inicial'], ['funcional', 'Mapa: funcional mantida']], S.heatSrc || 'total', v => { S.heatSrc = v; runCalc(); persist(); }, 'heatSeg'),
    el('p', { class: 'note' }, `Malha de ${c.nx} × ${c.nz} pontos (0,5 m × 0,33 m) no piso; ${calcV.n} pontos verticais. Inclui obstrução da tela do guarda-corpo (transmissão 84%), rodapé opaco e o próprio tabuleiro. Não inclui refletâncias (inter-reflexões), pessoas nem vento/balanço da ponte. Fachos: curva IES/LDT quando carregada; senão, cone idealizado.`),
    el('h3', {}, 'Critérios por classe (editáveis)'),
    el('div', { class: 'tblwrap' }, crit),
    el('div', { class: 'note', html: `<b>${cls ? 'Compatível com ' + cls : 'Abaixo da última classe'} (estimativa).</b> * Os valores pré-carregados são uma <b>referência provisória</b> (EN 13201-2, classes P1–P6, que estruturam as classes P da revisão brasileira). Não consegui acessar o texto oficial da ABNT NBR 5101:2024: confira a tabela da norma e digite os valores aqui. A escolha da classe depende do fluxo de pedestres e é decisão de projeto.` }),
    el('button', { class: 'btn', type: 'button', onclick: () => { S.criteria = CRITERIA_REF.map(k => ({ ...k })); persist(); renderHUD(); renderCalc(); } }, 'Restaurar valores de referência'),
    el('h3', {}, 'Energia'),
    el('div', { class: 'kpis', html: `
      <div class="kpi"><small>Potência instalada</small><b>${fmt(st.W, 0)}<em>W</em></b></div>
      <div class="kpi"><small>Fluxo instalado</small><b>${fmt(st.lm, 0)}<em>lm</em></b></div>
      <div class="kpi"><small>Consumo mensal</small><b>${fmt(kwh, 0)}<em>kWh</em></b></div>
      <div class="kpi"><small>Custo mensal</small><b>R$ ${fmt(kwh * S.tarifa, 0)}</b></div>` }),
    el('div', { class: 'pair' }, el('label', { for: 'hours' }, 'Horas acesas por noite'), hoursIn),
    el('div', { class: 'pair' }, el('label', { for: 'tarifa' }, 'Tarifa (R$/kWh)'), tarIn),
    el('p', { class: 'note' }, 'Não inclui perdas de fontes/drivers (some ~8–12%) nem dimerização programada por horário.'),
    el('h3', {}, 'Quantitativo'),
    el('div', { class: 'tblwrap' }, el('table', { class: 'qt', html: `<tr><th>Grupo</th><th>Qtd</th><th>W</th><th>lm</th></tr>` +
      st.rows.map(r => `<tr><td>${r.g.name}<br><small style="color:var(--muted)">${roleOf(r.g) === 'funcional' ? 'Funcional' : 'Cênica'} · ${r.g.photo ? r.g.photo.kind : r.T.curto} · ${r.g.colorMode === 'cct' ? r.g.cct + ' K' : r.g.rgb} · ${beamOf(r.g)}°</small></td><td>${r.T.linear ? fmt(r.qty, 0) + ' m' : r.qty}</td><td>${fmt(r.w, 0)}</td><td>${fmt(r.f, 0)}</td></tr>`).join('') +
      `<tr><td><b>Total</b></td><td></td><td><b>${fmt(st.W, 0)}</b></td><td><b>${fmt(st.lm, 0)}</b></td></tr>` })),
  );
}
// legenda
$('#legendBar').style.background = `linear-gradient(90deg, ${[0, 1, 2, 5, 10, 20, 50, 100].map((v, i, a) => { const c = falseColor(Math.max(v, 0.01)); return `rgb(${c}) ${i / (a.length - 1) * 100}%`; }).join(',')})`;

// --- Arquivo ---
function renderFilePane() {
  const p = $('#pane-arq'); p.innerHTML = '';
  const file = el('input', { type: 'file', id: 'loadJson', accept: '.json,application/json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); loadProject(d); toast('Projeto carregado: ' + f.name); }
    catch (e) { toast('Não consegui ler esse arquivo. Use um .json salvo por esta página.', 5000); }
    file.value = '';
  });
  p.append(
    el('h3', {}, 'Modelo 3D'),
    el('div', { class: 'btns' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => exportGLB('ponte') }, 'Baixar GLB — ponte + LEDs'),
      el('button', { class: 'btn', type: 'button', onclick: () => exportGLB('cena') }, 'Baixar GLB — cena completa')),
    el('p', { class: 'note', html: 'O GLB abre no <b>Blender</b> (Arquivo › Importar › glTF 2.0), Rhino 8, 3ds Max e SketchUp. Unidades em metros. As luminárias vão como luzes spot (KHR_lights_punctual) com intensidade em candela, posição e mira.' }),
    el('h3', {}, 'Projeto luminotécnico'),
    el('div', { class: 'btns' },
      el('button', { class: 'btn', type: 'button', onclick: exportCSV }, 'Quantitativo (.csv)'),
      el('button', { class: 'btn', type: 'button', onclick: () => download(new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' }), 'ponte-pensil-iluminacao.json') }, 'Salvar projeto (.json)'),
      el('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Abrir projeto (.json)'), file),
    el('h3', {}, 'Imagem'),
    el('div', { class: 'btns' }, el('button', { class: 'btn', type: 'button', onclick: screenshot }, 'Capturar vista atual (.png)')),
    el('h3', {}, 'Documentação'),
    el('p', { class: 'note', html: '<a href="guia.html" style="color:var(--led)">Memorial técnico de modelagem</a>: geometria, coordenadas, catenária, pendurais, tabuleiro, guarda-corpo, Geometry Nodes/Grasshopper, materiais e câmera.<br><a href="blender/ponte_pensil_blender.py" download style="color:var(--led)">ponte_pensil_blender.py</a>: gera a ponte paramétrica dentro do Blender (Scripting › Run Script).' }),
    el('h3', {}, 'Restaurar'),
    el('button', { class: 'btn', type: 'button', onclick: () => { selectFixture(null); S.groups = presetGroups('cenica'); S.preset = 'cenica'; rebuildAll(); renderLightPane(); persist(); toast('Projeto restaurado para a proposta cênica.'); } }, 'Voltar à proposta inicial'),
  );
}
function loadProject(d) {
  if (!d || !Array.isArray(d.groups)) throw new Error('formato');
  const { groups, ...rest } = d; Object.assign(S, rest); S.groups = migrate(groups.map(g => G({ ...g, id: undefined })));
  rig.haze.value = hazeSigma(S.haze ?? 0.45); selectFixture(null);
  if (!Array.isArray(S.criteria)) S.criteria = CRITERIA_REF.map(c => ({ ...c })); Object.assign(LAYERS, S.layers || {});
  applyMode(); people.visible = S.people; dims.visible = S.dims; heat.mesh.visible = S.heat; $('#legend').hidden = !S.heat; setCity();
  rebuildAll(); renderScenePane(); renderLightPane(); renderFilePane(); persist();
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function zipStore(name, bytes) { // zip sem compressão, um arquivo
  let crc = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8); crc = (crc ^ 0xFFFFFFFF) >>> 0;
  const nm = new TextEncoder().encode(name), lh = new DataView(new ArrayBuffer(30)), ch = new DataView(new ArrayBuffer(46)), end = new DataView(new ArrayBuffer(22));
  [[0, 0x04034b50, 4], [4, 20, 2], [14, crc, 4], [18, bytes.length, 4], [22, bytes.length, 4], [26, nm.length, 2]].forEach(([o, v, z]) => z === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true));
  [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [16, crc, 4], [20, bytes.length, 4], [24, bytes.length, 4], [28, nm.length, 2]].forEach(([o, v, z]) => z === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true));
  const cdOff = 30 + nm.length + bytes.length;
  [[0, 0x06054b50, 4], [8, 1, 2], [10, 1, 2], [12, 46 + nm.length, 4], [16, cdOff, 4]].forEach(([o, v, z]) => z === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true));
  return new Blob([lh, nm, bytes, ch, nm, end], { type: 'application/zip' });
}
let dlCap;
async function download(blob, name) {
  if (window.claude && window.claude.use) {
    if (dlCap === undefined) dlCap = await window.claude.use('downloads').catch(() => null);
    if (dlCap) {
      let data = blob, fname = name;
      if (/\.glb$/.test(name)) { data = zipStore(name, new Uint8Array(await blob.arrayBuffer())); fname = name.replace(/\.glb$/, '.zip'); }
      try { await dlCap.save({ filename: fname, data }); toast('Arquivo salvo: ' + fname); }
      catch (e) { if (e && e.code !== 'declined') toast('Não foi possível salvar aqui (' + (e.code || 'erro') + '). Use a versão do GitHub Pages.', 5000); }
      return;
    }
  }
  const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function exportCSV() {
  const st = rig.stats(S.groups);
  const head = ['Grupo', 'Função', 'Curva fotométrica', 'Montagem', 'Luminária', 'IP', 'Quantidade', 'Unidade', 'Potência unitária', 'Unid. potência', 'Dimer (%)', 'Potência total (W)', 'Eficácia (lm/W)', 'Fluxo total (lm)', 'Facho (°)', 'Cor', 'Intensidade (cd)', 'Luminância (nits)', 'Efeito'];
  const rows = st.rows.map(r => [r.g.name, roleOf(r.g), r.g.photo ? (r.g.photo.file || r.g.photo.name) : 'idealizada', MOUNTS[r.g.mount].nome, r.T.nome, r.T.ip, fmt(r.qty, r.T.linear ? 1 : 0), r.T.linear ? 'm' : 'un', fmt(r.g.power, 2), r.T.unit, r.g.dim, fmt(r.w, 0), efficacy(r.g), fmt(r.f, 0), beamOf(r.g), r.g.colorMode === 'cct' ? r.g.cct + ' K' : r.g.rgb, fmt(candela(r.g), 0), fmt(nitsOf(r.g), 0), EFFECTS.find(e => e[0] === r.g.effect)[1]]);
  const c = lastCalc;
  const mm = maintained();
  rows.push([], ['Total', '', '', '', '', '', '', '', '', '', '', fmt(st.W, 0), '', fmt(st.lm, 0)], ['ESTIMATIVA DE ESTUDO — confirmar com cálculo de projeto'], ['Fator de manutenção', fmt(S.fm, 2)], ['Ē funcional mantida (lx)', fmt(mm.Em, 1)], ['Emin funcional mantida (lx)', fmt(mm.Emin, 1)], ['Emin/Ē', fmt(mm.U0, 2)], ['Ev mín. 1,5 m mantida (lx)', fmt(mm.Ev, 1)], ['Ē total inicial (lx)', fmt(c.Em, 1)], ['Classe estimada (critério de referência)', classOf(mm) || 'abaixo']);
  const csv = '﻿' + [head, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'ponte-pensil-quantitativo.csv');
}
function screenshot() { composer.render(); renderer.domElement.toBlob(b => b && download(b, 'ponte-pensil-vista.png'), 'image/png'); }

// --- Exportação GLB ---
function exportMat(m) {
  if (m.isShaderMaterial) {
    const c = m.uniforms.uColor.value.clone(); const mx = Math.max(c.r, c.g, c.b, 1e-6);
    return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c.multiplyScalar(1 / mx), emissiveIntensity: 1, name: 'LED_emissor' });
  }
  if (m === M.mesh) return new THREE.MeshStandardMaterial({ color: 0xf4f6f7, transparent: true, opacity: 0.35, side: THREE.DoubleSide, metalness: 0.2, roughness: 0.5, name: 'Tela_soldada' });
  if (m.isMeshBasicMaterial) { const c = m.color.clone(); const mx = Math.max(c.r, c.g, c.b, 1e-6); return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c.multiplyScalar(1 / mx), name: 'Emissor' }); }
  const n = m.clone(); n.emissiveIntensity = 0; return n;
}
function cleanGeo(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal.clone()); else g.computeVertexNormals();
  if (geo.attributes.uv) g.setAttribute('uv', geo.attributes.uv.clone()); else g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (geo.index) g.setIndex(geo.index.clone());
  return g;
}
function bake(root, out, withLights) {
  root.updateMatrixWorld(true);
  const m4 = new THREE.Matrix4();
  root.traverseVisible(o => {
    if (o === water) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2 * P.quayX, 1600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b2a30, roughness: 0.05, metalness: 0.1, name: 'Agua' })); p.name = 'Rio_Mampituba'; out.add(p); return; }
    if (o.isInstancedMesh) {
      const geos = [];
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); m4.premultiply(o.matrixWorld); geos.push(cleanGeo(o.geometry).applyMatrix4(m4)); }
      const mesh = new THREE.Mesh(mergeGeometries(geos), exportMat(o.material)); mesh.name = o.name || o.parent?.name || 'Instancias'; out.add(mesh);
    } else if (o.isMesh && !o.isPoints) {
      if (o === sky.dome || o === heat.mesh) return;
      const mesh = new THREE.Mesh(cleanGeo(o.geometry).applyMatrix4(o.matrixWorld), exportMat(o.material)); mesh.name = o.name || o.parent?.name || 'Malha'; out.add(mesh);
    } else if (withLights && o.isSpotLight && o.parent && o.parent.parent === rig.root) {
      const c = o.color.clone(), mx = Math.max(c.r, c.g, c.b, 1e-6);
      const L = new THREE.SpotLight(c.multiplyScalar(1 / mx), o.intensity * mx, 0, o.angle, o.penumbra, 2);
      L.name = o.parent.name; L.position.setFromMatrixPosition(o.matrixWorld);
      L.lookAt(new THREE.Vector3().setFromMatrixPosition(o.target.matrixWorld));
      L.add(L.target); L.target.position.set(0, 0, -1); out.add(L);
    }
  });
}
async function exportGLB(scope) {
  toast('Gerando o GLB…', 0);
  await new Promise(r => setTimeout(r, 30));
  const out = new THREE.Group(); out.name = scope === 'cena' ? 'Ponte_Pensil_Mampituba_cena' : 'Ponte_Pensil_Mampituba';
  const b = new THREE.Group(); b.name = 'Estrutura'; bake(bridge, b, false); out.add(b);
  const l = new THREE.Group(); l.name = 'Iluminacao_LED'; bake(rig.root, l, true); out.add(l);
  if (scope === 'cena') { const e = new THREE.Group(); e.name = 'Entorno'; bake(env.group, e, false); bake(water, e, false); if (people.visible) bake(people, e, false); out.add(e); }
  new GLTFExporter().parse(out, (res) => {
    download(new Blob([res], { type: 'model/gltf-binary' }), scope === 'cena' ? 'ponte-pensil-cena.glb' : 'ponte-pensil.glb');
    toast('GLB pronto. Importe no Blender em Arquivo › Importar › glTF 2.0.');
  }, (err) => { console.error(err); toast('Falhou ao gerar o GLB: ' + err.message, 6000); }, { binary: true, maxTextureSize: 1024 });
}

// =====================================================================
//  Clique: medir cotas e posicionar luminárias avulsas
// =====================================================================
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const pickables = [bridge, ...env.pick, ...(env.real ? env.group.children.filter(o => o.name === 'Vegetacao').flatMap(v => v.children.filter(c => /Troncos|Coqueiros/.test(c.name))) : []), water];
function hitAt(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickables, true).filter(h => h.object.visible);
  return hits[0];
}
function startPlacing(g) { placing = { g, step: 'place' }; toast('Clique onde a luminária vai ficar (ponte, torre, chão, fachada ou árvore). Esc termina.', 0); }
let downPos = null, hoverT = 0;
renderer.domElement.addEventListener('pointerdown', e => { downPos = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5) return;
  if (gizmo.dragging) return;
  if (!placing) { const fx = fixtureAt(e); if (fx) { selectFixture({ g: fx.g, i: fx.i }); toast(`Selecionada: ${fx.g.name} #${fx.i + 1}`); } return; }
  const h = hitAt(e); if (!h) return;
  const g = placing.g;
  if (placing.step === 'place') {
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : V(0, 1, 0);
    if (h.object.isInstancedMesh && h.instanceId !== undefined && h.face) { const m = new THREE.Matrix4(); h.object.getMatrixAt(h.instanceId, m); n.copy(h.face.normal).transformDirection(m).transformDirection(h.object.matrixWorld); }
    if (n.dot(ray.ray.direction) > 0) n.negate(); // face voltada para quem clicou
    const off = TYPES[g.type].housing === 'proj10' ? 0.075 : 0.06;
    const p = h.point.clone().addScaledVector(n, off).toArray().map(v => +v.toFixed(3)), nn = n.toArray().map(v => +v.toFixed(4));
    if (placing.idx !== undefined) { Object.assign(g.fixtures[placing.idx], { p, n: nn }); }
    else { g.fixtures.push({ p, d: nn.slice(), n: nn }); placing.idx = g.fixtures.length - 1; }
    g.on = true; rebuildGroup(g); selectFixture({ g, i: placing.idx });
    if (placing.once) { placing = null; toast('Luminária reposicionada.'); }
    else { placing.step = 'aim'; toast('Agora clique no ponto que ela deve iluminar (ou Esc para deixá-la apontada para fora da superfície).', 0); }
  } else {
    const i = placing.idx ?? g.fixtures.length - 1, f = g.fixtures[i];
    const d = h.point.clone().sub(V(...f.p)).normalize(); f.d = d.toArray().map(v => +v.toFixed(4));
    rebuildGroup(g); selectFixture({ g, i });
    if (placing.once) { placing = null; toast('Luminária mirada.'); }
    else { placing = { g, step: 'place' }; toast('Posicionada e mirada. Clique para fixar outra, ou Esc para terminar.', 0); }
  }
});
renderer.domElement.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || e.buttons) { $('#coord').hidden = true; return; }
  const now = performance.now(); if (now - hoverT < 120) return; hoverT = now;
  const h = hitAt(e), c = $('#coord');
  if (!h) { c.hidden = true; return; }
  c.hidden = false;
  c.innerHTML = `<small>Cursor${placing ? ' — ' + (placing.step === 'place' ? 'posicionar' : 'mirar') : ''}</small>X ${fmt(h.point.x, 2)} · Z ${fmt(h.point.z, 2)} · cota ${h.point.y >= 0 ? '+' : ''}${fmt(h.point.y, 2)} m`;
});
renderer.domElement.addEventListener('pointerleave', () => { $('#coord').hidden = true; });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (placing) { placing = null; toast('Posicionamento encerrado.'); } else if (sel) selectFixture(null); }
  if ((e.key === 'Delete') && sel && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { sel.g.fixtures.splice(sel.i, 1); const g = sel.g; selectFixture(null); rebuildGroup(g); refreshCard(g); }
});

// =====================================================================
//  Laço principal
// =====================================================================
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  if (typeof poke === 'function') poke();
  const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, QUALITY[S.quality].dpr) * perf.scale); perf.dpr = dpr;
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr); composer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const q = QUALITY[S.quality].refl;
  water.getRenderTarget().setSize(Math.max(64, Math.round(w * dpr * q)), Math.max(64, Math.round(h * dpr * q)));
  bloom.setSize(Math.round(w * dpr * QUALITY[S.quality].bloom), Math.round(h * dpr * QUALITY[S.quality].bloom));
}
// Leve (sem antisserrilhado): fecha as juntas de 12 mm na geometria para evitar listras serrilhadas;
// as juntas continuam visíveis pela textura (cantos arredondados no mapa de relevo)
let plankBase = null;
function plankGaps() {
  const pm = byName(bridge, 'Pranchas_madeira'); if (!pm) return;
  if (!plankBase) { plankBase = []; for (let i = 0; i < pm.count; i++) { const m = new THREE.Matrix4(); pm.getMatrixAt(i, m); plankBase.push(m); } }
  const k = S.quality === 'leve' ? (P.plankW + P.plankGap) / P.plankW : 1, sc = new THREE.Matrix4().makeScale(k, 1, 1), m = new THREE.Matrix4();
  plankBase.forEach((b, i) => pm.setMatrixAt(i, m.copy(b).multiply(sc)));
  pm.instanceMatrix.needsUpdate = true;
}
function applyQuality() {
  const q = QUALITY[S.quality];
  plankGaps();
  const sm = S.quality === 'leve' ? 1024 : 2048;
  if (sun.shadow.mapSize.x !== sm) { sun.shadow.mapSize.set(sm, sm); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } shadowsDirty(); }
  perf.lodDirty = true;
  for (const rt of [composerRT, water.getRenderTarget()]) if (rt.samples !== q.msaa) { rt.samples = q.msaa; rt.dispose(); }
  resize();
}
new ResizeObserver(resize).observe(stage);

// luzes que atingem a água (poças de luz) → uniforms do shader do rio
const _wp = V(), _wt = V();
function feedWaterLights() {
  let n = 0;
  const push = (L) => {
    if (n >= 16 || !L.visible || L.intensity <= 0) return;
    L.getWorldPosition(_wp); if (Math.abs(_wp.x) > P.quayX + 2 || _wp.y > 16) return;
    L.target.getWorldPosition(_wt); const d = _wt.sub(_wp).normalize(); if (d.y > -0.05) return;
    WU.lPos.value[n].copy(_wp); WU.lDir.value[n].copy(d);
    WU.lCol.value[n].set(L.color.r, L.color.g, L.color.b).multiplyScalar(L.intensity);
    WU.lCos.value[n] = Math.cos(Math.min(L.angle, L.userData.core ?? L.angle)); n++;
  };
  for (const g of S.groups) { if (!isOn(g)) continue; const rt = rig.rt.get(g.id); if (rt) for (const l of rt.lights) push(l.light); }
  WU.lN.value = n;
}
const clock = new THREE.Clock();
// interação: qualquer gesto ou ajuste devolve a taxa máxima de quadros
controls.addEventListener('change', () => { poke(); perf.lodDirty = true; });
['pointerdown', 'wheel', 'input', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, poke, { passive: true }));
const hasEffects = () => S.groups.some(g => isOn(g) && g.effect !== 'estatico');
function frame(now) {
  requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => { perf.last = performance.now(); clock.getDelta(); });
  perf.idle = !tween && now - perf.lastInput > 2500;
  // parada de verdade: sem efeitos nem água animada, nada é redesenhado (economiza bateria)
  if (perf.idle && now - perf.lastInput > 4000 && !S.waterAnim && !hasEffects() && perf.frozen) return;
  perf.frozen = perf.idle && now - perf.lastInput > 4000;
  // parado: 30 qps com efeitos DMX, 20 qps sem (a água continua mexendo)
  const minGap = perf.idle ? (hasEffects() ? 32 : 48) : 0;
  if (now - perf.last < minGap) return;
  const dt = now - perf.last; perf.last = now; perf.frame++;
  // resolução dinâmica: mira ~50 qps enquanto o usuário interage
  if (!perf.idle && dt < 250) { perf.acc += dt; perf.n++; }
  if (now > perf.checkAt && perf.n > 20) {
    const avg = perf.acc / perf.n, old = perf.scale;
    if (avg > 24) perf.scale = Math.max(0.55, perf.scale - 0.1);
    else if (avg < 15) perf.scale = Math.min(1, perf.scale + 0.05);
    if (perf.scale !== old) resize();
    perf.acc = 0; perf.n = 0; perf.checkAt = now + 1500;
  }
  const t = clock.getElapsedTime();
  if (tween) {
    const k = Math.min(1, (performance.now() - tween.s) / tween.d), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (k >= 1) tween = null;
  }
  controls.update();
  { const cp = camera.position, gmin = groundAt(cp.x, cp.z) + (Math.abs(cp.x) > P.quayX - 0.2 ? 0.5 : 0.35);
    if (cp.y < gmin) cp.y = gmin;
    const tg = controls.target, tmin = groundAt(tg.x, tg.z) + 0.05; if (tg.y < tmin) tg.y = tmin; }
  WU.time.value = t;
  rig.animate(S.groups, t);
  feedWaterLights();
  composer.render();
  if (dims.visible) labelRenderer.render(scene, camera);
  if (perf.lodDirty !== false) updateLOD();
}

// inicialização
people.visible = S.people; dims.visible = S.dims; heat.mesh.visible = S.heat; $('#legend').hidden = !S.heat; setCity();
if (env.real) { reflHide.push(...env.reflHide); groundAt = env.groundAt; }
else env.group.traverse(o => { if (['Copas', 'Troncos', 'Coqueiros', 'Folhas_coqueiro', 'Postes', 'Guarda_corpo_cais', 'Postes_ponte'].includes(o.name)) reflHide.push(o); });
reflHide.push(people, sky.stars, heat.mesh, dims, gizmo, selMarker);
// LOD: miúdos somem de longe; pranchas viram uma faixa única além de 150 m
{
  const deckProxy = (() => {
    const pos = [], uv = [], idx = [], n = 100;
    for (let i = 0; i <= n; i++) { const x = -H() + P.L * i / n, y = deckY(x) - 0.002; pos.push(x, y, -0.85, x, y, 0.85); uv.push(0, x / 1.7 / 3, 0.25, x / 1.7 / 3); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, M.wood); m.name = 'Piso_LOD'; m.receiveShadow = true; return m;
  })();
  lodAdd(byName(bridge, 'Pranchas_madeira'), 150, () => true, deckProxy);
  lodAdd(byName(bridge, 'Bracadeiras'), 70);
  lodAdd(byName(bridge, 'Rodape'), 160);
  lodAdd(byName(bridge, 'Tela_guarda_corpo'), 380);
  lodAdd(people, 260, () => S.people);
  if (env.real) env.lods.forEach(([o, d]) => lodAdd(o, d));
  else {
    for (const n of ['Copas', 'Troncos', 'Coqueiros', 'Folhas_coqueiro']) lodAdd(byName(env.group, n), 450);
    lodAdd(byName(env.group, 'Guarda_corpo_cais'), 200);
    lodAdd(byName(env.group, 'Postes'), 500);
  }
}
applySensitivity(); applyMode(); applyQuality(); rebuildAll(); gizmoTone();
renderScenePane(); renderLightPane(); renderFilePane();
try { const tab = localStorage.getItem('ponte-pensil-tab'); if (tab) document.querySelector(`.tabs button[data-tab="${tab}"]`)?.click(); } catch (e) { /* ignora */ }
if (window.innerWidth <= 820) { $('#panel').classList.add('min'); $('#sheetToggle').textContent = '▴'; }
window.__ponte = { env, sel: () => sel, selectFixture, attachGizmo, perf, applyPreset: (k) => { S.groups = presetGroups(k); rig.rebuildAll(S.groups); const c = computeGrid(rig, S.groups); const st = rig.stats(S.groups); return { k, Em: +c.Em.toFixed(1), U0: +c.U0.toFixed(2), Emin: +c.Emin.toFixed(1), Emax: +c.Emax.toFixed(1), W: Math.round(st.W) }; }, S, scene, camera, controls, rig, flyTo, VIEWS, renderer, composer, lastCalc: () => lastCalc };
requestAnimationFrame(frame);
