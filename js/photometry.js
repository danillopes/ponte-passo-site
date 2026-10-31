// =====================================================================
//  Fotometria: leitura de arquivos IES (LM-63) e EULUMDAT (.ldt)
//  Resultado normalizado: intensidade absoluta em cd por plano C (0–360°)
//  e ângulo γ (0° = nadir, eixo da luminária). Ângulos em graus.
// =====================================================================

const num = (s) => s.trim().split(/[\s,]+/).filter(Boolean).map(Number);

/** IES LM-63 (1995/2002/2019). Suporta TILT=NONE e TILT=INCLUDE. */
export function parseIES(text, fileName = '') {
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0; const meta = {};
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    const m = l.match(/^\[(\w+)\]\s*(.*)$/); if (m) meta[m[1].toUpperCase()] = m[2];
    if (/^TILT\s*=/i.test(l)) break;
  }
  if (i >= lines.length) throw new Error('Arquivo IES sem a linha TILT=.');
  const tilt = lines[i].split('=')[1].trim().toUpperCase(); i++;
  let rest = lines.slice(i).join(' ');
  let v = num(rest);
  let tiltGeometry = null, tiltAngles = null, tiltFactors = null;
  if (tilt === 'INCLUDE') {
    tiltGeometry = v[0]; const nt = v[1];
    if (![1, 2, 3].includes(tiltGeometry) || !Number.isInteger(nt) || nt < 1) throw new Error('Bloco TILT=INCLUDE inválido.');
    tiltAngles = v.slice(2, 2 + nt); tiltFactors = v.slice(2 + nt, 2 + 2 * nt);
    if (tiltAngles.length !== nt || tiltFactors.length !== nt || [...tiltAngles, ...tiltFactors].some(x => !Number.isFinite(x))) throw new Error('Tabela TILT=INCLUDE incompleta.');
    v = v.slice(2 + 2 * nt);
  } else if (tilt !== 'NONE') {
    throw new Error('IES com TILT em arquivo externo não é autocontido. Use uma versão TILT=NONE ou TILT=INCLUDE.');
  }
  // linha 10: nLamps, lmPerLamp, multiplier, nV, nH, photometricType, units, width, length, height
  const [nLamps, lmLamp, mult, nV, nH, ptype, units, w, len, h] = v; v = v.slice(10);
  // linha 11: ballastFactor, futureUse, inputWatts
  const [bf, , watts] = v; v = v.slice(3);
  const V = v.slice(0, nV); v = v.slice(nV);
  const Hh = v.slice(0, nH); v = v.slice(nH);
  if (ptype !== 1) throw new Error('Só a fotometria tipo C (a mais comum para LED) é suportada.');
  const cd = [];
  for (let k = 0; k < nH; k++) { cd.push(v.slice(0, nV).map(x => x * mult * (bf || 1))); v = v.slice(nV); }
  if (cd.length !== nH || cd[nH - 1].length !== nV) throw new Error('Tabela de candelas incompleta.');
  const toM = units === 1 ? 0.3048 : 1;
  const out = normalize({ C: Hh, G: V, I: cd }, {
    kind: 'IES', name: meta.LUMINAIRE || meta.LUMCAT || fileName, maker: meta.MANUFAC || '',
    watts: watts || 0, lampLumens: lmLamp > 0 ? lmLamp * nLamps : null,
    lenM: Math.abs(len) * toM, widthM: Math.abs(w) * toM,
    tiltGeometry, tiltAngles, tiltFactors,
  });
  return out;
}

/** EULUMDAT (.ldt). Intensidades em cd/klm convertidas pelo fluxo das lâmpadas. */
export function parseLDT(text, fileName = '') {
  const L = text.replace(/\r/g, '').split('\n');
  const n = (k) => parseFloat(String(L[k] ?? '').replace(',', '.'));
  const Isym = n(2), Mc = n(3), Ng = n(5);
  const name = (L[8] || fileName).trim();
  const lenMM = n(12), lumLenMM = n(15);
  const sets = n(25);
  let k = 26;
  let flux = 0, watts = 0;
  const lamps = [], fluxes = [], wts = [];
  for (let s = 0; s < sets; s++) lamps.push(n(k + s)); k += sets;
  k += sets; // tipos
  for (let s = 0; s < sets; s++) fluxes.push(n(k + s)); k += sets;
  k += sets; k += sets; // CCT, IRC
  for (let s = 0; s < sets; s++) wts.push(n(k + s)); k += sets;
  for (let s = 0; s < sets; s++) { flux += fluxes[s] * Math.abs(lamps[s] || 1); watts += wts[s]; }
  k += 10; // razões diretas
  const C = [], G = [];
  for (let c = 0; c < Mc; c++) C.push(n(k + c)); k += Mc;
  for (let g = 0; g < Ng; g++) G.push(n(k + g)); k += Ng;
  let planes;
  if (Isym === 1) planes = [0];
  else if (Isym === 2) planes = C.filter(c => c <= 180);
  else if (Isym === 3) planes = C.filter(c => c >= 90 && c <= 270);
  else if (Isym === 4) planes = C.filter(c => c <= 90);
  else planes = C.slice();
  const rest = L.slice(k).join(' ').split(/\s+/).filter(Boolean).map(x => parseFloat(x.replace(',', '.')));
  const I = [];
  for (let p = 0; p < planes.length; p++) I.push(rest.slice(p * Ng, (p + 1) * Ng).map(x => x * flux / 1000));
  if (I.length !== planes.length || I[I.length - 1].length !== Ng) throw new Error('Tabela de intensidades do LDT incompleta.');
  const symm = Isym === 1 ? 'axial' : Isym === 2 ? 'bilateral' : Isym === 3 ? 'c90' : Isym === 4 ? 'quadrante' : 'total';
  return normalize({ C: planes, G, I }, { kind: 'LDT', name, watts, lampLumens: flux, lenM: (lumLenMM || lenMM) / 1000, symm });
}

/** Expande simetrias para 0–360 e calcula fluxo, Imax e abertura de facho. */
function normalize(t, meta) {
  const C0 = t.C, I0 = t.I, last = C0[C0.length - 1];
  const symm = meta.symm || (C0.length === 1 ? 'axial' : last <= 90 ? 'quadrante' : last <= 180 ? 'bilateral' : 'total');
  // leva qualquer plano C (0–360) para um plano existente no arquivo, conforme a simetria
  const map = (c) => {
    if (symm === 'axial') return C0[0];
    if (symm === 'quadrante') return c <= 90 ? c : c <= 180 ? 180 - c : c <= 270 ? c - 180 : 360 - c;
    if (symm === 'bilateral') return c <= 180 ? c : 360 - c;
    if (symm === 'c90') return c >= 90 && c <= 270 ? c : (540 - c) % 360;
    return c;
  };
  const rowAt = (c) => {
    if (C0.length === 1) return I0[0];
    let a = 0; while (a < C0.length - 2 && C0[a + 1] < c) a++;
    const t = C0[a + 1] > C0[a] ? Math.min(1, Math.max(0, (c - C0[a]) / (C0[a + 1] - C0[a]))) : 0;
    return I0[a].map((x, g) => x + (I0[a + 1][g] - x) * t);
  };
  let step = 360; for (let i = 1; i < C0.length; i++) step = Math.min(step, C0[i] - C0[i - 1]);
  step = Math.max(2.5, Math.min(15, step || 15));
  const C = [], I = [];
  for (let c = 0; c <= 360 + 1e-6; c += step) { C.push(Math.min(360, c)); I.push(rowAt(map(Math.min(360, c) % 360 === 0 && c > 0 ? 0 : Math.min(360, c)))); }
  const G = t.G.slice();
  // fluxo por integração: Φ = ΣΣ I·sinγ·Δγ·ΔC
  let flux = 0, Imax = 0;
  for (let c = 0; c < C.length - 1; c++) {
    const dC = (C[c + 1] - C[c]) * Math.PI / 180;
    for (let g = 0; g < G.length - 1; g++) {
      const g0 = G[g] * Math.PI / 180, g1 = G[g + 1] * Math.PI / 180;
      const Iavg = (I[c][g] + I[c][g + 1] + I[c + 1][g] + I[c + 1][g + 1]) / 4;
      flux += Iavg * (Math.cos(g0) - Math.cos(g1)) * dC;
    }
  }
  for (const r of I) for (const x of r) Imax = Math.max(Imax, x);
  // abertura do facho (50% de Imax) — média dos planos C0 e C90
  const beamAt = (row) => {
    const h = 0.5 * Math.max(...row);
    for (let g = 1; g < G.length; g++) if (row[g] < h && row[g - 1] >= h) return 2 * (G[g - 1] + (G[g] - G[g - 1]) * (row[g - 1] - h) / (row[g - 1] - row[g]));
    return 2 * G[G.length - 1];
  };
  const sample = (c) => { let i = 0; while (i < C.length - 2 && C[i + 1] <= c) i++; return I[i]; };
  const beam = Math.max(4, Math.min(170, (beamAt(sample(0)) + beamAt(sample(90))) / 2));
  let fieldGamma = 0;
  const fieldLimit = Imax * 0.01;
  for (const row of I) for (let g = 0; g < G.length; g++) if (row[g] >= fieldLimit) fieldGamma = Math.max(fieldGamma, G[g]);
  const field = Math.max(beam, Math.min(178, 2 * fieldGamma));
  return { ...meta, C, G, I, flux, Imax, beam, field };
}

/** Intensidade (cd) num plano C e ângulo γ, por interpolação bilinear. */
export function sampleI(ph, C, g) {
  const Cs = ph.C, Gs = ph.G;
  C = ((C % 360) + 360) % 360;
  if (g < Gs[0] || g > Gs[Gs.length - 1]) return 0;
  let a = 0; while (a < Cs.length - 2 && Cs[a + 1] < C) a++;
  let b = 0; while (b < Gs.length - 2 && Gs[b + 1] < g) b++;
  const tc = Cs[a + 1] > Cs[a] ? (C - Cs[a]) / (Cs[a + 1] - Cs[a]) : 0;
  const tg = Gs[b + 1] > Gs[b] ? (g - Gs[b]) / (Gs[b + 1] - Gs[b]) : 0;
  const I = ph.I;
  const i0 = I[a][b] + (I[a][b + 1] - I[a][b]) * tg, i1 = I[a + 1][b] + (I[a + 1][b + 1] - I[a + 1][b]) * tg;
  return Math.max(0, i0 + (i1 - i0) * tc);
}

/** Multiplicador fotométrico para a inclinação instalada da luminária. */
export function tiltFactor(ph, tiltDeg) {
  const A = ph?.tiltAngles, F = ph?.tiltFactors;
  if (!A?.length || !F?.length) return 1;
  const x = Math.max(A[0], Math.min(A[A.length - 1], tiltDeg));
  let i = 0; while (i < A.length - 2 && A[i + 1] < x) i++;
  const t = A[i + 1] > A[i] ? (x - A[i]) / (A[i + 1] - A[i]) : 0;
  return Math.max(0, F[i] + (F[i + 1] - F[i]) * t);
}

export function parsePhotometry(text, fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.ldt') || lower.endsWith('.eul')) return parseLDT(text, fileName);
  if (/IESNA|TILT\s*=/i.test(text)) return parseIES(text, fileName);
  return parseLDT(text, fileName);
}

/** Versão compacta para salvar no projeto (.json). */
export const packPhoto = (p) => p && ({
  kind: p.kind, name: p.name, maker: p.maker, watts: p.watts, lenM: p.lenM,
  C: p.C, G: p.G, I: p.I.map(r => r.map(x => Math.round(x * 10) / 10)),
  flux: p.flux, Imax: p.Imax, beam: p.beam, field: p.field,
  tiltGeometry: p.tiltGeometry, tiltAngles: p.tiltAngles, tiltFactors: p.tiltFactors,
});
