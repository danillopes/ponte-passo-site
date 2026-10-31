import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

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

function bestMimeType() {
  if (!window.MediaRecorder) return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function focusView(mount, focus) {
  const presets = {
    cable:     [[-72, 28, 78], [0, 9, 0]],
    handrail:  [[-38, 7.4, 11], [2, 6.2, 0]],
    hangers:   [[2, 12, 31], [0, 9, 0]],
    towerUp:   [[-64, 13, 25], [-50, 10, 0]],
    towerTop:  [[58, 18, 27], [50, 11, 0]],
    underDeck: [[8, 1.6, 17], [0, 5.7, -1]],
    quay:      [[-72, 6.8, 24], [-50, 6.5, 0]],
    postFoot:  [[-35, 7.2, 9], [4, 6.1, 0]],
    faceLight: [[-29, 7.0, 8], [12, 6.2, 0]],
    stairs:    [[65, 7.8, 17], [52, 6.2, 0]],
    custom:    [[-46, 20, 48], [0, 7, 0]],
  };
  const p = presets[mount] || presets.custom;
  if (!focus) return { position: V(...p[0]), target: V(...p[1]) };
  const target = V(...focus);
  const offset = V(...p[0]).sub(V(...p[1]));
  return { position: target.clone().add(offset), target };
}

function buildTimeline(groups) {
  const target = V(0, 7, 0);
  const shots = [{
    kind: 'orbit', duration: 9, title: 'Vista geral 360°',
    subtitle: 'Ponte Pênsil · Rio Mampituba', target,
    radius: 118, y: 32, a0: -0.72 * Math.PI, a1: 1.28 * Math.PI,
  }];
  for (const g of groups) {
    const view = focusView(g.mount, g.focus);
    shots.push({ kind: 'detail', duration: 4.4, ...view, group: g, title: g.name, subtitle: g.role });
  }
  shots.push({
    kind: 'orbit', duration: 7, title: 'Projeto luminotécnico',
    subtitle: 'Camadas funcional e cênica', target,
    radius: 92, y: 48, a0: 0.25 * Math.PI, a1: 1.25 * Math.PI,
  });
  let at = 0;
  for (const s of shots) { s.at = at; at += s.duration; }
  return { shots, duration: at };
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || '').split(/\s+/); let line = '', lines = [];
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  lines = lines.slice(0, maxLines);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

export function createTourRecorder({ camera, controls, renderer, stage, resize, wake, download, onMessage }) {
  const state = {
    active: false, cancelled: false, startedAt: 0, timeline: null, shot: null,
    canvas: null, ctx: null, media: null, chunks: [], stream: null, size: null,
    saved: null, mime: '', format: 'vertical', lastUiSecond: -1,
  };

  const ui = document.createElement('div');
  ui.className = 'recording-ui'; ui.hidden = true;
  ui.innerHTML = `<div class="recording-status" role="status" aria-live="polite">
    <span class="recording-dot" aria-hidden="true"></span>
    <div><b>Gravando tour 360°</b><small id="recordingScene">Preparando…</small></div>
    <time id="recordingTime">00:00</time>
  </div><div class="recording-actions">
    <button class="btn" type="button" id="recordingCancel">Cancelar</button>
    <button class="btn primary" type="button" id="recordingStop">Parar e baixar</button>
  </div>`;
  stage.append(ui);
  ui.querySelector('#recordingCancel').addEventListener('click', () => stop(true));
  ui.querySelector('#recordingStop').addEventListener('click', () => stop(false));

  function supported() {
    return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && bestMimeType());
  }

  function renderSize(format) {
    return format === 'vertical' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  }

  function currentShot(elapsed) {
    const shots = state.timeline.shots;
    return shots.find(s => elapsed >= s.at && elapsed < s.at + s.duration) || shots.at(-1);
  }

  function moveCamera(shot, local) {
    const k = clamp(local / shot.duration);
    if (shot.kind === 'orbit') {
      const a = shot.a0 + (shot.a1 - shot.a0) * k;
      const lift = Math.sin(k * Math.PI) * 8;
      camera.position.set(Math.cos(a) * shot.radius, shot.y + lift, Math.sin(a) * shot.radius);
      controls.target.copy(shot.target);
    } else {
      const e = easeInOut(k), side = V(0, 0, 1).applyAxisAngle(V(0, 1, 0), e * 0.16 - 0.08);
      const base = shot.position.clone();
      base.add(side.multiplyScalar(Math.sin(k * Math.PI) * 2.2));
      camera.position.lerpVectors(state.saved.lastPosition, base, e);
      controls.target.lerpVectors(state.saved.lastTarget, shot.target, e);
    }
    camera.lookAt(controls.target);
  }

  function drawOverlay(elapsed, shot) {
    const { ctx, canvas } = state, w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(renderer.domElement, 0, 0, w, h);
    const s = w / 1920;
    const top = Math.max(40, 54 * s), left = Math.max(42, 68 * s), pad = Math.max(28, 42 * s);
    const bottomH = Math.max(210, h * (state.format === 'vertical' ? 0.17 : 0.21));
    const grad = ctx.createLinearGradient(0, h - bottomH * 1.8, 0, h);
    grad.addColorStop(0, 'rgba(5,8,13,0)'); grad.addColorStop(0.55, 'rgba(5,8,13,.76)'); grad.addColorStop(1, 'rgba(5,8,13,.96)');
    ctx.fillStyle = grad; ctx.fillRect(0, h - bottomH * 1.8, w, bottomH * 1.8);

    ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = `600 ${Math.max(18, 24 * s)}px Arial, sans-serif`;
    ctx.fillText('PONTE PÊNSIL · MAMPITUBA', left, top);
    ctx.fillStyle = '#ffb54a'; ctx.fillRect(left, top + Math.max(34, 42 * s), Math.max(56, 74 * s), Math.max(3, 5 * s));

    const y = h - bottomH + pad;
    ctx.fillStyle = '#ffffff'; ctx.font = `700 ${Math.max(34, 58 * s)}px Arial, sans-serif`;
    wrapText(ctx, shot.title, left, y, w - left * 2, Math.max(43, 67 * s));
    ctx.fillStyle = '#b8c3d1'; ctx.font = `500 ${Math.max(20, 30 * s)}px Arial, sans-serif`;
    ctx.fillText(shot.subtitle || '', left, y + Math.max(76, 88 * s));

    if (shot.group) {
      const g = shot.group;
      ctx.fillStyle = '#e7edf4'; ctx.font = `500 ${Math.max(17, 23 * s)}px Arial, sans-serif`;
      const color = g.colorMode === 'cct' ? `${g.cct} K` : String(g.rgb || '').toUpperCase();
      const photo = g.photo || 'Distribuição idealizada';
      ctx.fillText(`${g.fixture} · ${color} · ${g.power} ${g.unit} · dimmer ${g.dim}% · facho ${g.beam}°`, left, y + Math.max(116, 132 * s));
      ctx.fillStyle = '#8fa0b4'; ctx.fillText(photo, left, y + Math.max(148, 168 * s));
    }

    const progress = clamp(elapsed / state.timeline.duration);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(left, h - Math.max(34, 42 * s), w - left * 2, Math.max(4, 6 * s));
    ctx.fillStyle = '#ffb54a'; ctx.fillRect(left, h - Math.max(34, 42 * s), (w - left * 2) * progress, Math.max(4, 6 * s));
  }

  function finishDownload(blob) {
    if (!blob.size) { onMessage('A gravação terminou sem dados. Tente novamente no Chrome ou Edge.', 6000); return; }
    const ext = state.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const name = `ponte-pensil-tour-360-${state.format}.${ext}`;
    download(blob, name); onMessage(`Vídeo pronto: ${name}`);
  }

  function cleanup() {
    document.body.classList.remove('recording-mode', 'recording-vertical', 'recording-landscape');
    ui.hidden = true;
    if (state.canvas) state.canvas.remove();
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    if (state.saved) {
      camera.position.copy(state.saved.position); controls.target.copy(state.saved.target);
      controls.enabled = state.saved.controlsEnabled; controls.enableDamping = state.saved.damping;
      camera.fov = state.saved.fov; camera.updateProjectionMatrix();
    }
    state.active = false; state.canvas = null; state.ctx = null; state.stream = null; state.media = null;
    resize(); wake();
  }

  function stop(cancelled = false) {
    if (!state.active) return;
    state.cancelled = cancelled;
    if (state.media && state.media.state !== 'inactive') state.media.stop(); else cleanup();
  }

  async function start({ format = 'vertical', groups = [] } = {}) {
    if (state.active) return;
    if (!supported()) { onMessage('Este navegador não consegue gravar o canvas. Use Chrome ou Edge atualizado no computador.', 6500); return; }
    if (!groups.length) { onMessage('Ligue pelo menos um grupo de luminárias antes de gravar.', 5000); return; }
    state.format = format; state.size = renderSize(format); state.timeline = buildTimeline(groups);
    state.saved = {
      position: camera.position.clone(), target: controls.target.clone(), lastPosition: camera.position.clone(), lastTarget: controls.target.clone(),
      controlsEnabled: controls.enabled, damping: controls.enableDamping, fov: camera.fov,
    };
    state.canvas = document.createElement('canvas'); state.canvas.className = 'recording-preview';
    state.canvas.width = state.size.width; state.canvas.height = state.size.height;
    state.ctx = state.canvas.getContext('2d', { alpha: false, desynchronized: true });
    stage.prepend(state.canvas);
    document.body.classList.add('recording-mode', `recording-${format}`);
    ui.hidden = false; controls.enabled = false; controls.enableDamping = false;
    state.mime = bestMimeType(); state.chunks = []; state.cancelled = false; state.lastUiSecond = -1;
    state.stream = state.canvas.captureStream(30);
    state.media = new MediaRecorder(state.stream, { mimeType: state.mime, videoBitsPerSecond: 12_000_000 });
    state.media.ondataavailable = e => { if (e.data?.size) state.chunks.push(e.data); };
    state.media.onerror = e => { console.error(e); state.cancelled = true; onMessage('A gravação foi interrompida pelo navegador.', 6000); };
    state.media.onstop = () => {
      const blob = new Blob(state.chunks, { type: state.mime }); const cancelled = state.cancelled;
      cleanup(); if (!cancelled) finishDownload(blob); else onMessage('Gravação cancelada. Nenhum vídeo foi salvo.');
    };
    state.active = true; state.startedAt = performance.now(); state.media.start(1000);
    resize(); wake();
    onMessage('Gravação iniciada. Mantenha esta aba aberta até o download.', 4500);
  }

  function update(now) {
    if (!state.active) return;
    const elapsed = (now - state.startedAt) / 1000;
    if (elapsed >= state.timeline.duration) { stop(false); return; }
    const shot = currentShot(elapsed);
    if (state.shot !== shot) {
      state.shot = shot;
      state.saved.lastPosition.copy(camera.position); state.saved.lastTarget.copy(controls.target);
    }
    moveCamera(shot, elapsed - shot.at);
    const sec = Math.floor(elapsed);
    if (sec !== state.lastUiSecond) {
      state.lastUiSecond = sec;
      ui.querySelector('#recordingScene').textContent = shot.title;
      const total = Math.ceil(state.timeline.duration), mm = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
      ui.querySelector('#recordingTime').textContent = `${mm(sec)} / ${mm(total)}`;
    }
  }

  function capture(now) {
    if (!state.active || !state.shot) return;
    drawOverlay((now - state.startedAt) / 1000, state.shot);
  }

  return { start, stop, update, capture, supported, get active() { return state.active; }, get size() { return state.active ? state.size : null; } };
}
