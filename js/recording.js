// =====================================================================
//  Tour em vídeo — renderização quadro a quadro (offline) + WebCodecs
//  O vídeo sai sempre a 60 (ou 30) qps cravados, em 1080p, mesmo que o PC
//  renderize devagar: cada quadro é desenhado no tempo do vídeo, não do relógio.
//  MP4 (H.264) montado com mp4-muxer (MIT, vendor/mp4-muxer).
// =====================================================================
import * as THREE from 'three';
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const yieldUI = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

// cubic-bezier(0.77, 0, 0.175, 1): movimento deliberado dentro da cena.
function easeInOut(x) {
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 10; i++) {
    t = (lo + hi) / 2;
    const u = 1 - t;
    const bx = 3 * u * u * t * 0.77 + 3 * u * t * t * 0.175 + t * t * t;
    if (bx < x) lo = t; else hi = t;
  }
  const u = 1 - t;
  return 3 * u * t * t + t * t * t;
}

// enquadramentos que valorizam cada tipo de luz (cabos de baixo, corrimão ao longo do piso etc.)
const FOCUS = {
  cable:     [[24, 2.2, 36], [-6, 9.5, 0]],
  handrail:  [[-24, 7.2, -0.25], [10, 6.4, 0.85]],
  hangers:   [[4, 11, 26], [0, 9, 0]],
  towerUp:   [[-66, 7.5, 24], [-50, 9.5, 0]],
  towerTop:  [[60, 16, 26], [50, 11, 0]],
  quay:      [[-74, 6.8, 26], [-50, 6.5, 0]],
  postFoot:  [[-30, 6.9, -0.3], [6, 5.9, 0.7]],
  faceLight: [[-28, 7.0, 0.2], [12, 6.4, 0]],
  stairs:    [[66, 6.4, 14], [53, 4.2, 0]],
  custom:    [[-46, 20, 48], [0, 7, 0]],
};
function focusView(mount, focus) {
  const p = FOCUS[mount] || FOCUS.custom;
  if (!focus || FOCUS[mount] && mount !== 'custom') return { position: V(...p[0]), target: V(...p[1]), point: focus ? V(...focus) : null };
  const target = V(...focus);
  const offset = V(...p[0]).sub(V(...p[1])).setLength(18);
  return { position: target.clone().add(offset), target, point: target.clone() };
}

function buildTimeline(groups, k = 1) {
  const target = V(0, 7, 0);
  const shots = [{ kind: 'orbit', duration: 10, title: 'Vista geral 360°', subtitle: 'Ponte Pênsil · Rio Mampituba', target, radius: 118, y: 32, a0: -0.72 * Math.PI, a1: 1.28 * Math.PI }];
  for (const g of groups) shots.push({ kind: 'detail', duration: 5.2, ...focusView(g.mount, g.focus), group: g, title: g.name, subtitle: g.role });
  shots.push({ kind: 'orbit', duration: 8, title: 'Projeto luminotécnico', subtitle: 'Camadas funcional e cênica', target, radius: 92, y: 48, a0: 0.25 * Math.PI, a1: 1.25 * Math.PI });
  let at = 0;
  for (const s of shots) { s.duration *= k; s.at = at; at += s.duration; }
  return { shots, duration: at };
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || '').split(/\s+/); let line = '', lines = [];
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

async function pickCodec(width, height, fps, bitrate) {
  if (!window.VideoEncoder) return null;
  const tries = [['avc', 'avc1.640034'], ['avc', 'avc1.4d0034'], ['avc', 'avc1.640033'], ['avc', 'avc1.42003e'], ['vp9', 'vp09.00.51.08'], ['vp9', 'vp09.00.41.08']];
  for (const [mux, codec] of tries) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
      const config = { codec, width, height, bitrate, framerate: fps, hardwareAcceleration, latencyMode: 'quality', bitrateMode: 'variable', ...(mux === 'avc' ? { avc: { format: 'avc' } } : {}) };
      try { const r = await VideoEncoder.isConfigSupported(config); if (r.supported) return { mux, config: r.config }; } catch (e) { /* tenta o próximo */ }
    }
  }
  return null;
}

export function createTourRecorder({ camera, controls, renderer, stage, resize, wake, download, onMessage, renderAt, onBegin, onEnd }) {
  const state = { active: false, cancelled: false, timeline: null, shot: null, canvas: null, ctx: null, size: null, saved: null, format: 'vertical', fps: 60 };

  const ui = document.createElement('div');
  ui.className = 'recording-ui'; ui.hidden = true;
  ui.innerHTML = `<div class="recording-status" role="status" aria-live="polite">
    <span class="recording-dot" aria-hidden="true"></span>
    <div><b id="recordingTitle">Gerando vídeo</b><small id="recordingScene">Preparando…</small></div>
    <time id="recordingTime">0%</time>
  </div><div class="recording-actions">
    <button class="btn" type="button" id="recordingCancel">Cancelar</button>
  </div>`;
  stage.append(ui);
  ui.querySelector('#recordingCancel').addEventListener('click', () => { state.cancelled = true; });

  const supported = () => !!(window.VideoEncoder && window.VideoFrame);
  const renderSize = (format) => format === 'vertical' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const shotAt = (t) => state.timeline.shots.find(s => t >= s.at && t < s.at + s.duration) || state.timeline.shots.at(-1);

  function moveCamera(shot, local) {
    const k = clamp(local / shot.duration);
    if (shot.kind === 'orbit') {
      const a = shot.a0 + (shot.a1 - shot.a0) * k, lift = Math.sin(k * Math.PI) * 8;
      camera.position.set(Math.cos(a) * shot.radius, shot.y + lift, Math.sin(a) * shot.radius);
      controls.target.copy(shot.target);
    } else {
      // chega ao enquadramento em ~45% do plano e depois avança devagar (dolly) em direção à luz
      const e = easeInOut(clamp(k / 0.45)), push = (k - 0.45) / 0.55;
      const base = shot.position.clone();
      if (push > 0) base.lerp(shot.target, 0.12 * easeInOut(push));
      camera.position.lerpVectors(state.saved.lastPosition, base, e);
      controls.target.lerpVectors(state.saved.lastTarget, shot.target, e);
    }
    camera.lookAt(controls.target);
  }

  function drawOverlay(t, shot) {
    const { ctx, canvas } = state, w = canvas.width, h = canvas.height;
    ctx.drawImage(renderer.domElement, 0, 0, w, h);
    const s = Math.min(w, h) / 1080;
    const left = 60 * s, top = 56 * s;
    const local = t - shot.at, fade = clamp(local / 0.6) * clamp((shot.duration - local) / 0.5);
    // destaque da luz: anel + linha de chamada até o ponto iluminado do grupo
    if (shot.group && shot.point) {
      const p = shot.point.clone().project(camera);
      if (p.z < 1 && Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95) {
        const px = (p.x + 1) / 2 * w, py = (1 - p.y) / 2 * h, r = 26 * s * (1 + 0.15 * Math.sin(local * 4));
        ctx.globalAlpha = 0.85 * fade; ctx.strokeStyle = '#ffb54a'; ctx.lineWidth = 3 * s;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + r * 0.7, py - r * 0.7); ctx.lineTo(px + r * 2.2, py - r * 2.2); ctx.lineTo(px + r * 4.6, py - r * 2.2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    const bottomH = h * (state.format === 'vertical' ? 0.2 : 0.26);
    const grad = ctx.createLinearGradient(0, h - bottomH * 1.6, 0, h);
    grad.addColorStop(0, 'rgba(5,8,13,0)'); grad.addColorStop(0.5, 'rgba(5,8,13,.72)'); grad.addColorStop(1, 'rgba(5,8,13,.94)');
    ctx.fillStyle = grad; ctx.fillRect(0, h - bottomH * 1.6, w, bottomH * 1.6);
    ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = `600 ${24 * s}px Arial, sans-serif`; ctx.fillText('PONTE PÊNSIL · MAMPITUBA', left, top);
    ctx.fillStyle = '#ffb54a'; ctx.fillRect(left, top + 40 * s, 74 * s, 5 * s);
    ctx.globalAlpha = fade;
    const y = h - bottomH + 10 * s;
    ctx.fillStyle = '#ffffff'; ctx.font = `700 ${54 * s}px Arial, sans-serif`;
    wrapText(ctx, shot.title, left, y, w - left * 2, 62 * s);
    ctx.fillStyle = '#b8c3d1'; ctx.font = `500 ${28 * s}px Arial, sans-serif`;
    ctx.fillText(shot.subtitle || '', left, y + 82 * s);
    if (shot.group) {
      const g = shot.group, color = g.colorMode === 'cct' ? `${g.cct} K` : String(g.rgb || '').toUpperCase();
      ctx.fillStyle = '#e7edf4'; ctx.font = `500 ${23 * s}px Arial, sans-serif`;
      wrapText(ctx, `${g.fixture} · ${color} · ${g.power} ${g.unit} · dimmer ${g.dim}% · facho ${g.beam}°`, left, y + 124 * s, w - left * 2, 30 * s, 2);
      ctx.fillStyle = '#8fa0b4'; ctx.fillText(g.photo || 'Distribuição idealizada', left, y + 188 * s);
    }
    ctx.globalAlpha = 1;
    const prog = clamp(t / state.timeline.duration);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(left, h - 40 * s, w - left * 2, 5 * s);
    ctx.fillStyle = '#ffb54a'; ctx.fillRect(left, h - 40 * s, (w - left * 2) * prog, 5 * s);
  }

  function setUI(title, scene, right) {
    ui.querySelector('#recordingTitle').textContent = title;
    ui.querySelector('#recordingScene').textContent = scene;
    ui.querySelector('#recordingTime').textContent = right;
  }

  async function start({ format = 'vertical', fps = 60, groups = [], timeScale = 1 } = {}) {
    if (state.active) return;
    if (!supported()) { onMessage('Este navegador não tem codificador de vídeo (WebCodecs). Use Chrome ou Edge atualizado no computador.', 7000); return; }
    if (!groups.length) { onMessage('Ligue pelo menos um grupo de luminárias antes de gravar.', 5000); return; }
    const size = renderSize(format), bitrate = Math.round((fps >= 60 ? 22e6 : 14e6) * (size.width * size.height) / (1920 * 1080));
    const codec = await pickCodec(size.width, size.height, fps, bitrate);
    if (!codec) { onMessage('Não encontrei um codificador H.264/VP9 compatível neste navegador.', 7000); return; }

    Object.assign(state, { format, fps, size, timeline: buildTimeline(groups, timeScale), cancelled: false, shot: null, active: true });
    state.saved = { position: camera.position.clone(), target: controls.target.clone(), lastPosition: camera.position.clone(), lastTarget: controls.target.clone(), controlsEnabled: controls.enabled, damping: controls.enableDamping };
    state.canvas = document.createElement('canvas'); state.canvas.className = 'recording-preview';
    state.canvas.width = size.width; state.canvas.height = size.height;
    state.ctx = state.canvas.getContext('2d', { alpha: false });
    stage.prepend(state.canvas);
    document.body.classList.add('recording-mode', `recording-${format}`);
    ui.hidden = false; controls.enabled = false; controls.enableDamping = false;
    if (onBegin) await onBegin();
    resize();

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: codec.mux, width: size.width, height: size.height, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    let encErr = null;
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
    encoder.configure(codec.config);

    const N = Math.ceil(state.timeline.duration * fps), t0 = performance.now();
    let lastUI = 0;
    try {
      for (let i = 0; i < N; i++) {
        if (state.cancelled || encErr) break;
        const t = i / fps, shot = shotAt(t);
        if (state.shot !== shot) { state.shot = shot; state.saved.lastPosition.copy(camera.position); state.saved.lastTarget.copy(controls.target); }
        moveCamera(shot, t - shot.at);
        renderAt(t);
        drawOverlay(t, shot);
        const frame = new VideoFrame(state.canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 }); frame.close();
        while (encoder.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 2));
        const now = performance.now();
        if (now - lastUI > 250) {
          lastUI = now;
          const done = (i + 1) / N, eta = (now - t0) / done * (1 - done) / 1000;
          setUI('Gerando vídeo', `${shot.title} · quadro ${i + 1}/${N}`, `${Math.round(done * 100)}% · ~${eta > 90 ? Math.round(eta / 60) + ' min' : Math.round(eta) + ' s'}`);
          await yieldUI();
        }
      }
      if (!state.cancelled && !encErr) {
        setUI('Finalizando', 'Montando o arquivo MP4…', '100%'); await yieldUI();
        await encoder.flush(); muxer.finalize();
        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        const name = `ponte-pensil-tour-${format === 'vertical' ? '1080x1920' : '1920x1080'}-${fps}fps.mp4`;
        finish(); download(blob, name);
        onMessage(`Vídeo pronto: ${name} (${(blob.size / 1e6).toFixed(0)} MB, ${fps} qps)`, 6000);
        return;
      }
    } catch (e) { encErr = e; }
    try { encoder.close(); } catch (e) { /* já fechado */ }
    finish();
    onMessage(encErr ? 'A gravação falhou: ' + (encErr.message || encErr) : 'Gravação cancelada. Nenhum vídeo foi salvo.', 6000);
  }

  function finish() {
    document.body.classList.remove('recording-mode', 'recording-vertical', 'recording-landscape');
    ui.hidden = true;
    if (state.canvas) state.canvas.remove();
    camera.position.copy(state.saved.position); controls.target.copy(state.saved.target);
    controls.enabled = state.saved.controlsEnabled; controls.enableDamping = state.saved.damping;
    state.active = false; state.canvas = null; state.ctx = null;
    if (onEnd) onEnd();
    resize(); wake();
  }

  return { start, supported, stop: () => { state.cancelled = true; }, get active() { return state.active; }, get size() { return state.active ? state.size : null; } };
}
