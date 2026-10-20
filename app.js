/* app.js — interfaz y conexión en línea (PeerJS, sin servidor propio).
 * El anfitrión ejecuta la partida; los demás jugadores se conectan a él por código de sala.
 */
(() => {
  'use strict';

  const E = window.DominoEngine;
  const CFG = window.DOMINO_CONFIG || {};
  const PREFIX = CFG.peerPrefix || 'domino-amigos-';
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal');
  const $toast = document.getElementById('toast');

  /* ============ utilidades ============ */

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } },
  };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === false || v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function randomToken() {
    const a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function randomCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let c = '';
    for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
    return c;
  }

  let toastT = null;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => $toast.classList.remove('show'), 2200);
  }

  function copyText(text) {
    const done = () => toast('Enlace copiado');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const t = h('textarea', { style: 'position:fixed;opacity:0' });
    t.value = text;
    document.body.append(t);
    t.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast(text); }
    t.remove();
  }

  /* ============ estado ============ */

  const S = {
    name: (ls.get('domino.name', '') || '').slice(0, 14),
    token: ls.get('domino.token', ''),
    sound: ls.get('domino.sound', '1') !== '0',
    mode: null,          // 'local' | 'host' | 'client'
    code: null,
    game: null,          // solo anfitrión / local
    view: null,
    sel: null,           // ficha elegida (cuando puede ir a ambos extremos)
    peer: null, conn: null, conns: {},
    status: '',
    bubbles: {},
    lastEventId: null, lastEmoteId: null, wasMine: false,
    popDone: 0, dealDone: 0, resultSeen: 0,
    modalId: null, modalDismiss: true,
    leaving: false, everJoined: false, retries: 0, reconnectScheduled: false,
    prefill: '',
  };
  if (!S.token) { S.token = randomToken(); ls.set('domino.token', S.token); }

  /* ============ sonido ============ */

  let actx = null;
  function sound(kind) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime;
      const beep = (f, dur, type, vol, at) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(vol, t0 + at);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        o.connect(g); g.connect(actx.destination);
        o.start(t0 + at); o.stop(t0 + at + dur + 0.03);
      };
      switch (kind) {
        case 'play': beep(190, 0.09, 'triangle', 0.22, 0); beep(120, 0.07, 'square', 0.05, 0.02); break;
        case 'pass': beep(240, 0.2, 'sine', 0.09, 0); break;
        case 'turn': beep(660, 0.1, 'sine', 0.07, 0); beep(880, 0.14, 'sine', 0.07, 0.1); break;
        case 'deal': for (let i = 0; i < 5; i++) beep(150 + Math.random() * 60, 0.05, 'triangle', 0.1, i * 0.07); break;
        case 'win': [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.28, 'triangle', 0.1, i * 0.13)); break;
        case 'lose': beep(300, 0.3, 'sine', 0.08, 0); beep(220, 0.45, 'sine', 0.08, 0.22); break;
        default: break;
      }
    } catch (e) { /* sin audio */ }
  }

  /* ============ fichas (DOM) ============ */

  const PIPS = { 0: [], 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  function half(n) {
    const d = h('div', { class: 'half' });
    for (let i = 1; i <= 9; i++) d.append(h('div', { class: 'cell' }, PIPS[n].includes(i) ? h('div', { class: 'pip' }) : null));
    return d;
  }
  // vertical: l = mitad de arriba, r = mitad de abajo; horizontal: l = izquierda, r = derecha
  function tileEl(l, r, vertical, u, cls) {
    const el = h('div', { class: 'tile ' + (vertical ? 'v' : 'h') + (cls ? ' ' + cls : '') });
    if (u) el.style.setProperty('--u', u + 'px');
    el.append(half(l), h('div', { class: 'mid' }), half(r));
    return el;
  }
  const backEl = (u) => h('div', { class: 'tile v back', style: '--u:' + u + 'px' });

  /* ============ ventanas ============ */

  $modal.addEventListener('click', (e) => { if (e.target === $modal && S.modalDismiss) closeModal(); });
  function openModal(id, content, dismiss) {
    S.modalId = id;
    S.modalDismiss = dismiss !== false;
    $modal.innerHTML = '';
    $modal.append(content);
    $modal.classList.remove('hidden');
  }
  function closeModal() {
    S.modalId = null;
    $modal.classList.add('hidden');
    $modal.innerHTML = '';
  }
  function showBusy(msg, onCancel) {
    openModal('busy', h('div', { class: 'sheet center' },
      h('div', { style: 'font-size:34px' }, '🁣'),
      h('p', {}, msg),
      onCancel ? h('button', { class: 'btn', onclick: onCancel }, 'Cancelar') : null), false);
  }
  function fatal(msg, retry) {
    cleanup();
    openModal('fatal', h('div', { class: 'sheet' },
      h('h2', {}, 'Ups'),
      h('p', {}, msg),
      retry ? h('button', { class: 'btn primary', onclick: () => { closeModal(); retry(); } }, 'Reintentar') : null,
      h('button', { class: retry ? 'btn' : 'btn primary', onclick: () => { closeModal(); goHome(); } }, retry ? 'Volver al inicio' : 'Aceptar')), false);
  }

  /* ============ red ============ */

  // Servidores de conexión: STUN (gratis) + TURN de relevo para redes móviles/corporativas que bloquean
  // las conexiones directas. El TURN se pide al arrancar; si falla, se sigue solo con STUN.
  let iceP = null;
  function b64(buf) { let s = ''; new Uint8Array(buf).forEach((c) => { s += String.fromCharCode(c); }); return btoa(s); }
  function getIce() {
    if (iceP) return iceP;
    iceP = (async () => {
      const list = (CFG.iceServers || []).slice();
      const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
      try {
        if (CFG.meteredApp && CFG.meteredKey) {
          const r = await Promise.race([fetch('https://' + CFG.meteredApp + '.metered.live/api/v1/turn/credentials?apiKey=' + encodeURIComponent(CFG.meteredKey)), timeout(4000)]);
          const j = await r.json();
          if (Array.isArray(j)) list.push(...j);
        } else if (CFG.freeRelay !== false && window.crypto && crypto.subtle) {
          // Relevo gratuito compartido (Open Relay): credenciales temporales firmadas con el secreto público.
          const host = 'staticauth.openrelay.metered.ca';
          const user = String(Math.floor(Date.now() / 1000) + 86400);
          const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('openrelayprojectsecret'), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
          const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(user));
          list.push({ urls: ['turn:' + host + ':80', 'turn:' + host + ':443', 'turn:' + host + ':443?transport=tcp', 'turns:' + host + ':443?transport=tcp'], username: user, credential: b64(sig) });
        }
      } catch (e) { /* sin TURN: se intenta conexión directa */ }
      return list;
    })();
    return iceP;
  }
  function peerOpts() {
    return Object.assign({ debug: 0, config: { iceServers: S.ice || CFG.iceServers || [], iceCandidatePoolSize: 4 } }, CFG.peerServer || {});
  }
  function prepareNet() {
    return Promise.all([loadPeer(), getIce().then((l) => { S.ice = l; })]);
  }
  function loadPeer() {
    if (window.Peer) return Promise.resolve();
    const urls = CFG.peerScriptUrls || ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'];
    const load = (u) => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = u; s.onload = res; s.onerror = () => rej(new Error('script'));
      document.head.append(s);
    });
    return urls.reduce((p, u) => p.catch(() => load(u)), Promise.reject(new Error('start')))
      .then(() => { if (!window.Peer) throw new Error('nopeer'); });
  }

  function connBanner() {
    if (!S.status) return null;
    return h('div', { class: 'conn' }, S.status, S.mode === 'client' ? h('button', { class: 'btn small', style: 'margin-left:10px', onclick: () => {
      clearTimeout(S.retryT); S.reconnectScheduled = false; S.retries = 0; connectClient();
    } }, 'Reconectar ahora') : null);
  }

  function setStatus(s) {
    S.status = s;
    if (S.view) render();
  }

  /* ---- anfitrión ---- */

  const mySeat = () => {
    const i = S.game.seats.findIndex((s) => s.kind === 'human' && s.token === S.token);
    return i < 0 ? 0 : i;
  };

  function hostChanged() {
    const g = S.game;
    if (!g) return;
    g.seats.forEach((s, i) => {
      if (s.kind === 'human' && s.token !== S.token) {
        const c = S.conns[s.token];
        if (c && c.open) { try { c.send({ type: 'state', view: g.view(i) }); } catch (e) { /* conexión caída */ } }
      }
    });
    applyView(g.view(mySeat()));
    if (S.mode === 'host') {
      ls.set('domino.host', JSON.stringify({ code: S.code, ts: Date.now(), game: g.toJSON() }));
    }
  }

  function newGame() {
    const g = new E.Game();
    g.seatHuman(0, S.name, S.token);
    g.seats[0].host = true;
    g.onChange = hostChanged;
    return g;
  }

  function createRoom() {
    if (!needName()) return;
    showBusy('Creando sala…');
    prepareNet().then(() => openHost(randomCode(), 5, null))
      .catch(() => fatal('No se pudo cargar la conexión. Revisa tu internet e inténtalo de nuevo.'));
  }

  function resumeHost() {
    if (!needName()) return;
    let saved = null;
    try { saved = JSON.parse(ls.get('domino.host', 'null')); } catch (e) { /* nada */ }
    if (!saved || !saved.game) return toast('No hay partida guardada');
    showBusy('Reabriendo la sala ' + saved.code + '…');
    const game = E.Game.fromJSON(saved.game);
    game.noTimers = false;
    prepareNet().then(() => openHost(saved.code, 10, game))
      .catch(() => fatal('No se pudo cargar la conexión. Revisa tu internet e inténtalo de nuevo.'));
  }

  function openHost(code, tries, resume) {
    const peer = new window.Peer(PREFIX + code, peerOpts());
    let opened = false;
    peer.on('open', () => {
      opened = true;
      closeModal();
      S.peer = peer; S.mode = 'host'; S.code = code; S.leaving = false;
      let g = resume;
      if (g) {
        const i = g.seats.findIndex((s) => s.kind === 'human' && s.token === S.token);
        const me = i < 0 ? 0 : i;
        if (i < 0) { g.seats[0] = { kind: 'human', name: S.name, token: S.token, connected: true, host: true }; }
        g.seats[me].connected = true;
        g.onChange = hostChanged;
      } else g = newGame();
      S.game = g;
      startHostWatch();
      g.emit();
    });
    peer.on('error', (e) => {
      if (opened) return;
      try { peer.destroy(); } catch (x) { /* nada */ }
      if (e.type === 'unavailable-id') {
        if (resume) {
          if (tries > 0) setTimeout(() => openHost(code, tries - 1, resume), 2500);
          else fatal('No pude reabrir la sala ' + code + '. Prueba de nuevo en un minuto.');
        } else if (tries > 0) openHost(randomCode(), tries - 1, null);
        else fatal('No pude crear la sala. Inténtalo otra vez.');
      } else {
        fatal('No pude conectar con el servidor de salas (' + e.type + '). Revisa tu internet.');
      }
    });
    peer.on('disconnected', () => { if (!peer.destroyed) { try { peer.reconnect(); } catch (e) { /* nada */ } } });
    peer.on('error', (e) => {
      // errores después de abrir la sala: solo reintentar la conexión con el servidor de salas
      if (opened && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (x) { /* nada */ } }
    });
    peer.on('connection', hostAccept);
  }

  let hostWatchT = null;
  function startHostWatch() {
    clearInterval(hostWatchT);
    hostWatchT = setInterval(() => {
      const now = Date.now();
      if (S.peer && S.peer.disconnected && !S.peer.destroyed) { try { S.peer.reconnect(); } catch (e) { /* nada */ } }
      Object.values(S.conns).forEach((c) => { if (now - (c._seen || now) > 30000) { try { c.close(); } catch (e) { /* nada */ } hostClosed(c); } });
    }, 10000);
  }

  function watchIce(conn, onDead) {
    try {
      const pc = conn.peerConnection;
      if (!pc) return;
      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') onDead();
        else if (pc.iceConnectionState === 'disconnected') { try { pc.restartIce && pc.restartIce(); } catch (e) { /* nada */ } }
      });
    } catch (e) { /* nada */ }
  }

  function hostAccept(conn) {
    conn._seen = Date.now();
    watchIce(conn, () => hostClosed(conn));
    conn.on('data', (m) => hostData(conn, m));
    conn.on('close', () => hostClosed(conn));
    conn.on('error', () => hostClosed(conn));
  }

  function hostData(conn, m) {
    if (!S.game || !m || typeof m !== 'object') return;
    conn._seen = Date.now();
    const g = S.game;
    if (m.type === 'ping') { try { conn.send({ type: 'pong' }); } catch (e) { /* nada */ } return; }
    if (m.type === 'join') {
      const name = String(m.name || '').trim().slice(0, 14);
      const token = String(m.token || '').slice(0, 40);
      if (!token || token === S.token) return;
      let seat = g.seats.findIndex((s) => s.kind === 'human' && s.token === token);
      if (seat >= 0) {
        const old = S.conns[token];
        if (old && old !== conn) { delete S.conns[token]; try { old.close(); } catch (e) { /* nada */ } }
        g.seats[seat].connected = true;
        if (name) g.seats[seat].name = name;
      } else if (g.phase === 'lobby') {
        seat = g.firstFreeSeat();
        if (seat < 0) { conn.send({ type: 'fatal', msg: 'La sala está llena.' }); return; }
        g.seatHuman(seat, name || ('Jugador ' + (seat + 1)), token);
      } else {
        conn.send({ type: 'fatal', msg: 'La partida ya empezó. Solo pueden volver quienes ya estaban jugando (desde el mismo dispositivo y navegador).' });
        return;
      }
      conn._token = token;
      S.conns[token] = conn;
      conn.send({ type: 'welcome' });
      g.emit();
      return;
    }
    const token = conn._token;
    if (!token || S.conns[token] !== conn) return;
    const seat = g.seats.findIndex((s) => s.kind === 'human' && s.token === token);
    if (seat >= 0) g.handle(seat, m);
  }

  function hostClosed(conn) {
    const token = conn._token;
    if (!token || S.conns[token] !== conn || !S.game) return;
    delete S.conns[token];
    const seat = S.game.seats.findIndex((s) => s.kind === 'human' && s.token === token);
    if (seat < 0) return;
    if (S.game.phase === 'lobby') S.game.clearSeat(seat);
    else { S.game.seats[seat].connected = false; S.game.emit(); }
  }

  function hostKick(seat, msg) {
    const g = S.game;
    const s = g.seats[seat];
    if (s.kind === 'human') {
      const c = S.conns[s.token];
      delete S.conns[s.token];
      if (c) { try { c.send({ type: 'fatal', msg }); } catch (e) { /* nada */ } setTimeout(() => { try { c.close(); } catch (e) { /* nada */ } }, 400); }
    }
  }

  /* ---- cliente ---- */

  function joinRoom(codeRaw) {
    const code = (codeRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) return toast('El código tiene 4 letras');
    if (!needName()) return;
    cleanup();
    S.mode = 'client'; S.code = code; S.leaving = false; S.everJoined = false; S.retries = 0; S.reconnectScheduled = false;
    showBusy('Conectando a la sala ' + code + '…', () => { closeModal(); goHome(); });
    prepareNet().then(connectClient)
      .catch(() => fatal('No se pudo cargar la conexión. Revisa tu internet e inténtalo de nuevo.'));
  }

  function connectClient() {
    if (S.leaving || S.mode !== 'client') return;
    S.reconnectScheduled = false;
    clearTimeout(S.retryT);
    if (S.conn) { const old = S.conn; S.conn = null; try { old.close(); } catch (e) { /* nada */ } }
    if (S.peer) { const old = S.peer; S.peer = null; try { old.destroy(); } catch (e) { /* nada */ } }
    const peer = new window.Peer(undefined, peerOpts());
    S.peer = peer;
    peer.on('open', () => {
      if (S.peer !== peer) return;
      const conn = peer.connect(PREFIX + S.code, { reliable: true });
      S.conn = conn;
      let opened = false;
      conn.on('open', () => {
        opened = true;
        conn.send({ type: 'join', name: S.name, token: S.token });
        startPing();
      });
      watchIce(conn, () => { if (S.conn === conn) lost(); });
      conn.on('data', onHostMsg);
      conn.on('close', () => { if (S.conn === conn) lost(); });
      conn.on('error', () => { if (S.conn === conn) lost(); });
      setTimeout(() => { if (!opened && S.conn === conn) lost(); }, 15000);
    });
    peer.on('error', (e) => {
      if (S.peer !== peer || S.leaving) return;
      if (e.type === 'peer-unavailable' && !S.everJoined && S.retries >= 2) {
        fatal('No encontré la sala ' + S.code + '. Revisa el código y que tu amigo tenga la sala abierta (y la pantalla encendida).', () => joinRoom(S.code));
      } else lost();
    });
  }

  function lost() {
    if (S.leaving || S.mode !== 'client' || S.reconnectScheduled) return;
    stopPing();
    if (!S.everJoined && S.retries >= 3) {
      const code = S.code;
      fatal('No pude conectar con la sala ' + code + '. Prueba: 1) revisar que el anfitrión tenga la sala abierta y la pantalla encendida, 2) cambiar entre Wi-Fi y datos móviles, 3) desactivar VPN o «Relay privado».', () => joinRoom(code));
      return;
    }
    if (S.retries >= 40) { fatal('Se perdió la conexión con el anfitrión.'); return; }
    S.retries++;
    S.reconnectScheduled = true;
    if (S.everJoined) setStatus('Reconectando…');
    S.retryT = setTimeout(connectClient, S.everJoined ? 1500 : 2000);
  }

  function startPing() {
    stopPing();
    S.lastPong = Date.now();
    S.pingT = setInterval(() => {
      if (S.conn && S.conn.open) { try { S.conn.send({ type: 'ping' }); } catch (e) { /* nada */ } }
      if (Date.now() - S.lastPong > 25000) { stopPing(); lost(); }
    }, 8000);
  }
  function stopPing() { clearInterval(S.pingT); S.pingT = null; }

  function onHostMsg(m) {
    if (!m || typeof m !== 'object') return;
    S.lastPong = Date.now();
    if (m.type === 'welcome') {
      S.everJoined = true; S.retries = 0;
      ls.set('domino.session', JSON.stringify({ code: S.code, ts: Date.now() }));
      if (S.modalId === 'busy') closeModal();
    } else if (m.type === 'state') {
      S.everJoined = true; S.retries = 0;
      if (S.modalId === 'busy') closeModal();
      S.status = '';
      applyView(m.view);
    } else if (m.type === 'fatal') {
      ls.del('domino.session');
      fatal(m.msg || 'Te desconectaron de la sala.');
    }
  }

  let wakeLock = null;
  function keepAwake() {
    try {
      if (!navigator.wakeLock || wakeLock) return;
      navigator.wakeLock.request('screen').then((l) => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
    } catch (e) { /* nada */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (S.mode) keepAwake();
    if (S.mode === 'host' && S.peer && S.peer.disconnected && !S.peer.destroyed) { try { S.peer.reconnect(); } catch (e) { /* nada */ } }
    if (S.mode === 'client' && S.everJoined && !S.leaving && (!S.conn || !S.conn.open)) {
      clearTimeout(S.retryT);
      S.reconnectScheduled = false;
      connectClient();
    }
  });

  /* ---- común ---- */

  function send(m) {
    if (S.mode === 'client') {
      if (S.conn && S.conn.open) { try { S.conn.send(m); } catch (e) { /* nada */ } } else toast('Sin conexión…');
    } else if (S.game) S.game.handle(mySeat(), m);
  }

  function cleanup() {
    S.leaving = true;
    clearTimeout(S.retryT); clearInterval(hostWatchT); stopPing();
    if (S.game) { S.game.stop(); }
    if (S.conn) { try { S.conn.close(); } catch (e) { /* nada */ } }
    Object.values(S.conns).forEach((c) => { try { c.close(); } catch (e) { /* nada */ } });
    if (S.peer) { try { S.peer.destroy(); } catch (e) { /* nada */ } }
    S.game = null; S.conn = null; S.conns = {}; S.peer = null;
    S.view = null; S.sel = null; S.status = ''; S.bubbles = {};
    S.lastEventId = null; S.lastEmoteId = null; S.wasMine = false; S.popDone = 0; S.dealDone = 0; S.resultSeen = 0;
    S.mode = null;
    cancelAnimationFrame(S.raf);
  }

  function leave(keepSaved) {
    const wasHost = S.mode === 'host';
    cleanup();
    if (!keepSaved) {
      if (wasHost) ls.del('domino.host');
      ls.del('domino.session');
    }
    closeModal();
    goHome();
  }

  function needName() {
    S.name = (S.name || '').trim().slice(0, 14);
    if (!S.name) {
      toast('Escribe tu nombre primero');
      const el = document.getElementById('name');
      if (el) el.focus();
      return false;
    }
    ls.set('domino.name', S.name);
    return true;
  }

  function startLocal() {
    if (!needName()) return;
    cleanup();
    S.leaving = false;
    S.mode = 'local';
    const g = new E.Game();
    g.seatHuman(0, S.name, S.token);
    for (let i = 1; i < 4; i++) g.addBot(i);
    S.game = g;
    g.onChange = hostChanged;
    g.start();
  }

  /* ============ eventos de la partida ============ */

  function bubble(seat, text, big) {
    S.bubbles[seat] = { text, big: !!big };
    clearTimeout(S['bt' + seat]);
    S['bt' + seat] = setTimeout(() => {
      delete S.bubbles[seat];
      if (S.view && S.view.phase !== 'lobby') render();
    }, big ? 2600 : 1800);
  }

  function applyView(v) {
    S.view = v;
    S.turnEnd = v.turnMs ? Date.now() + v.turnMs : 0;
    S.turnTotal = ((v.opts && v.opts.timer) || 0) * 1000;
    keepAwake();
    if (S.sel && !(v.legal || []).some((m) => E.sameTile(m.tile, S.sel))) S.sel = null;
    const ev = v.event;
    if (ev && ev.id !== S.lastEventId) {
      const first = S.lastEventId === null;
      S.lastEventId = ev.id;
      if (!first) {
        if (ev.kind === 'play') {
          sound('play');
          if (ev.passes && ev.passes.length) { ev.passes.forEach((s) => bubble(s, '¡Paso!')); sound('pass'); }
          if (ev.auto && ev.seat === v.you) toast('Se acabó tu tiempo: jugó un bot por ti');
        } else if (ev.kind === 'deal') sound('deal');
        else if (ev.kind === 'end' && v.roundResult) {
          const rr = v.roundResult;
          if (rr.gameOver) sound(rr.winnerTeam === v.you % 2 ? 'win' : 'lose');
        }
      }
    }
    if (v.emote && v.emote.id !== S.lastEmoteId) {
      if (S.lastEmoteId !== null) bubble(v.emote.seat, v.emote.e, Array.from(v.emote.e).length <= 2);
      S.lastEmoteId = v.emote.id;
    } else if (S.lastEmoteId === null) S.lastEmoteId = v.emote ? v.emote.id : 0;

    const mine = v.phase === 'playing' && v.turn === v.you;
    if (mine && !S.wasMine) {
      sound('turn');
      try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) { /* nada */ }
    }
    S.wasMine = mine;
    render();
  }

  /* ============ pantallas ============ */

  function render() {
    const v = S.view;
    if (!v) return;
    if (v.phase === 'lobby') renderLobby(v);
    else { renderGame(v); syncResultModal(v); }
  }

  function mount(node) {
    $app.innerHTML = '';
    $app.append(node);
  }

  /* ---- inicio ---- */

  function renderHome() {
    let savedHost = null, savedSession = null;
    try {
      const a = JSON.parse(ls.get('domino.host', 'null'));
      if (a && a.game && Date.now() - a.ts < 6 * 3600e3) savedHost = a;
      const b = JSON.parse(ls.get('domino.session', 'null'));
      if (b && Date.now() - b.ts < 12 * 3600e3) savedSession = b;
    } catch (e) { /* nada */ }

    const codeIn = h('input', { type: 'text', class: 'code-input', maxlength: 4, placeholder: 'CÓDIGO', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', value: S.prefill || '',
      oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); },
      onkeydown: (e) => { if (e.key === 'Enter') joinRoom(codeIn.value); } });
    const nameIn = h('input', { type: 'text', id: 'name', maxlength: 14, placeholder: 'Tu nombre', value: S.name, autocomplete: 'nickname',
      oninput: (e) => { S.name = e.target.value.slice(0, 14); ls.set('domino.name', S.name); } });

    mount(h('div', { class: 'screen home' },
      h('div', { class: 'home-inner' },
        h('div', { class: 'logo' },
          tileEl(6, 6, true, 28, '', ''), tileEl(3, 5, true, 28), tileEl(0, 4, true, 28)),
        h('h1', {}, 'DOMINÓ'),
        h('p', { class: 'sub' }, 'Clásico para 4 · en parejas · sin anuncios'),
        nameIn,
        h('button', { class: 'btn primary', onclick: createRoom }, 'Crear sala para jugar con amigos'),
        h('div', { class: 'row' }, codeIn, h('button', { class: 'btn', onclick: () => joinRoom(codeIn.value) }, 'Unirme')),
        savedHost ? h('button', { class: 'btn', onclick: resumeHost }, '↩ Continuar tu sala ' + savedHost.code) : null,
        savedSession && !savedHost ? h('button', { class: 'btn', onclick: () => { if (needName()) joinRoom(savedSession.code); } }, '↩ Volver a la sala ' + savedSession.code) : null,
        h('div', { class: 'sep' }),
        h('button', { class: 'btn', onclick: startLocal }, '🤖 Practicar contra bots'),
        h('button', { class: 'btn small', onclick: showRules }, 'Ver reglas'),
        h('p', { class: 'fine' }, 'Uno crea la sala y comparte el enlace o el código de 4 letras. Las partidas van directo entre los dispositivos: no hay cuentas ni anuncios.'))));
  }

  function goHome() {
    S.prefill = S.prefill || '';
    renderHome();
  }

  /* ---- sala de espera ---- */

  function shareLink() {
    const url = location.origin + location.pathname + '?sala=' + S.code;
    if (navigator.share) navigator.share({ title: 'Dominó', text: '¡Juega dominó conmigo! Sala ' + S.code, url }).catch(() => {});
    else copyText(url);
  }

  function renderLobby(v) {
    const isHost = S.mode === 'host';
    const you = v.you;
    const seatCard = (i) => {
      const s = v.seats[i];
      const mine = i === you;
      const card = h('div', { class: 'seat' + (s.kind === 'empty' ? ' empty' : '') });
      if (s.kind === 'empty') {
        card.append(h('div', { class: 'tag' }, 'Asiento libre'),
          h('div', { class: 'btns' },
            h('button', { class: 'btn small', onclick: () => send({ type: 'sit', to: i }) }, 'Sentarme aquí'),
            isHost ? h('button', { class: 'btn small', onclick: () => S.game.addBot(i) }, '+ Bot') : null));
      } else {
        card.append(h('div', {},
          h('div', { class: 'nm' }, (s.kind === 'bot' ? '🤖 ' : '') + s.name),
          h('div', { class: 'tag' }, (mine ? 'Tú' : (s.host ? 'Anfitrión' : (s.kind === 'bot' ? 'Bot' : 'Jugador'))) + (s.kind === 'human' ? (s.connected ? ' · ✅ conectado' : ' · ⚠️ sin conexión') : ''))));
        if (isHost && !mine) {
          card.append(h('div', { class: 'btns' }, h('button', { class: 'btn small danger', onclick: () => {
            hostKick(i, 'El anfitrión te sacó de la sala.');
            S.game.clearSeat(i);
          } }, s.kind === 'bot' ? 'Quitar' : 'Expulsar')));
        }
      }
      return card;
    };
    const seg = (items, cur, onPick) => h('div', { class: 'seg' },
      items.map(([val, label]) => h('button', { class: cur === val ? 'on' : '', disabled: !isHost, onclick: () => onPick(val) }, label)));

    const free = v.seats.filter((s) => s.kind === 'empty').length;
    mount(h('div', { class: 'screen lobby' },
      h('div', { class: 'lobby-inner' },
        connBanner(),
        h('div', { class: 'code-card' },
          h('div', { class: 'dim', style: 'font-size:13px' }, 'Código de la sala'),
          h('div', { class: 'code' }, S.code),
          h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' },
            h('button', { class: 'btn small', onclick: shareLink }, '📤 Compartir enlace'),
            h('button', { class: 'btn small', onclick: () => copyText(location.origin + location.pathname + '?sala=' + S.code) }, '🔗 Copiar'))),
        h('div', { class: 'teams' },
          h('div', { class: 'team a' }, h('h3', {}, 'Equipo azul'), seatCard(0), seatCard(2)),
          h('div', { class: 'team b' }, h('h3', {}, 'Equipo naranja'), seatCard(1), seatCard(3))),
        h('p', { class: 'fine' }, 'Los compañeros se sientan enfrentados. El turno gira hacia la derecha (sentido antihorario).'),
        h('div', {},
          h('div', { class: 'opt-label' }, 'Meta de puntos'),
          seg([[50, '50'], [100, '100'], [150, '150'], [200, '200']], v.opts.target, (t) => S.game.setOpts({ target: t }))),
        h('div', {},
          h('div', { class: 'opt-label' }, 'Si se tranca, la pareja ganadora suma…'),
          seg([['rival', 'Puntos del rival'], ['dif', 'Solo la diferencia']], v.opts.tranque, (t) => S.game.setOpts({ tranque: t }))),
        h('div', {},
          h('div', { class: 'opt-label' }, 'Tiempo por turno (si te pasas, juega un bot por ti)'),
          seg([[0, 'Sin límite'], [30, '30 s'], [45, '45 s'], [60, '60 s']], v.opts.timer == null ? 45 : v.opts.timer, (t) => S.game.setOpts({ timer: t }))),
        isHost
          ? h('button', { class: 'btn primary', disabled: !v.canStart, onclick: () => S.game.start() },
            v.canStart ? 'Empezar partida' : 'Faltan ' + free + ' jugador' + (free === 1 ? '' : 'es') + ' — agrega bots')
          : h('p', { class: 'center dim' }, v.canStart ? 'Esperando a que el anfitrión empiece…' : 'Esperando a los demás jugadores…'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small grow', onclick: showRules }, 'Reglas'),
          h('button', { class: 'btn small grow danger', onclick: () => confirmLeave() }, 'Salir')))));
  }

  /* ---- partida ---- */

  const rel = (seat, you) => (seat - you + 4) % 4;

  // pos: 'top' (tu pareja, frente a ti), 'left' o 'right' (los rivales a los lados), como en una mesa real
  function oppPanel(v, seat, pos) {
    const s = v.seats[seat];
    const same = seat % 2 === v.you % 2;
    const turn = v.phase === 'playing' && v.turn === seat;
    const side = pos !== 'top';
    const backs = h('div', { class: 'backs' });
    for (let i = 0; i < s.count; i++) backs.append(side ? h('div', { class: 'tile h back', style: '--u:10px' }) : backEl(12));
    const b = S.bubbles[seat];
    const ini = s.kind === 'bot' ? '🤖' : ((s.name || '?').trim().charAt(0).toUpperCase() || '?');
    const sub = !s.connected ? '⚠ sin conexión' : (s.afk ? '⏸ automático' : (side ? String(s.count) : (same ? 'tu pareja' : 'rival') + ' · ' + s.count));
    return h('div', { class: 'opp ' + pos + ' ' + (same ? 'us' : 'them') + (turn ? ' turn' : '') + (!s.connected ? ' offline' : '') },
      b ? h('div', { class: 'bubble' + (b.big ? ' big' : '') }, b.text) : null,
      h('div', { class: 'avatar' + (turn && S.turnEnd ? ' timing' : '') }, ini),
      h('div', { class: 'info' },
        h('div', { class: 'nm' }, s.name),
        h('div', { class: 'sub' }, sub)),
      backs);
  }

  function renderGame(v) {
    const you = v.you;
    const myTurn = v.phase === 'playing' && v.turn === you;
    const us = v.scores[you % 2];
    const them = v.scores[1 - (you % 2)];
    const myBubble = S.bubbles[you];
    const fresh = v.event && v.event.kind === 'deal' && S.dealDone !== v.event.id;
    if (fresh) S.dealDone = v.event.id;

    // estado
    let status;
    const ended = v.phase === 'roundEnd' || v.phase === 'gameEnd';
    if (ended) {
      status = h('div', { class: 'status' },
        h('button', { class: 'btn small', onclick: () => showResult(v) }, 'Ver resultado'),
        h('button', { class: 'btn small primary', onclick: () => send({ type: 'next' }) }, v.phase === 'gameEnd' ? 'Revancha' : 'Siguiente mano'));
    } else if (v.afk && v.phase === 'playing') {
      status = h('div', { class: 'status afk' }, h('span', {}, '⏸ Estás en automático por no jugar'),
        h('button', { class: 'btn small primary', onclick: () => send({ type: 'back' }) }, 'Volver a jugar'));
    } else if (myTurn) {
      let msg = 'Tu turno — elige una ficha';
      if (!v.board.length && v.openTile) msg = 'Sales tú: juega el doble seis';
      else if (!v.board.length) msg = 'Sales tú: juega cualquier ficha';
      else if (S.sel) msg = 'Toca el extremo donde quieres jugarla';
      status = h('div', { class: 'status mine' }, h('span', { class: 'pill' }, msg, S.turnEnd ? h('span', { class: 'secs' }, '') : null));
    } else {
      status = h('div', { class: 'status' }, 'Turno de ' + v.seats[v.turn].name + '…');
    }

    const sorted = v.hand.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const hand = h('div', { class: 'hand' }, sorted.map((t) => {
      const mv = (v.legal || []).find((m) => E.sameTile(m.tile, t));
      const cls = (myTurn ? (mv ? 'ok' : 'no') : '') + (S.sel && E.sameTile(S.sel, t) ? ' sel' : '') + (fresh ? ' fresh' : '');
      const el = tileEl(t[0], t[1], true, 0, cls.trim());
      el.addEventListener('click', () => onHandTile(t));
      return el;
    }));

    const emotes = h('div', { class: 'emotes' },
      ['👏', '😂', '😡', '🔥'].map((e) => h('button', { 'aria-label': 'Reacción ' + e, onclick: () => emoteThrottled(e) }, e)),
      h('button', { 'aria-label': 'Frases rápidas', onclick: showPhrases }, '💬'));

    const root = h('div', { class: 'screen game' },
      h('div', { class: 'g-top' },
        h('div', { class: 'scorebar' },
          h('div', { class: 't us' }, h('span', {}, 'Nosotros'), h('b', {}, us)),
          h('div', { class: 'mid' }, 'Mano ' + v.roundNo, h('br'), 'Meta ' + v.opts.target),
          h('div', { class: 't them' }, h('span', {}, 'Ellos'), h('b', {}, them))),
        h('button', { class: 'btn icon-btn', 'aria-label': 'Menú', onclick: showMenu }, '☰')),
      connBanner(),
      oppPanel(v, (you + 2) % 4, 'top'),
      h('div', { class: 'table-mid' },
        oppPanel(v, (you + 3) % 4, 'left'),
        h('div', { class: 'board-wrap' }, h('div', { id: 'board' })),
        oppPanel(v, (you + 1) % 4, 'right')),
      status,
      h('div', { class: 'me' + (myTurn ? ' turn' : '') },
        myBubble ? h('div', { class: 'bubble' + (myBubble.big ? ' big' : '') }, myBubble.text) : null,
        myTurn && S.turnEnd ? h('div', { class: 'tbar' }, h('i')) : null,
        h('div', { class: 'me-head' }, h('div', { class: 'nm' }, v.seats[you].name + ' (tú)'), emotes),
        hand));
    mount(root);
    fitBoard();
    startTick();
  }

  // reloj: mueve el aro del avatar, la barra y los segundos sin volver a dibujar la pantalla
  function startTick() {
    cancelAnimationFrame(S.raf);
    const step = () => {
      const v = S.view;
      if (!v || v.phase !== 'playing' || !S.turnEnd || !S.turnTotal) return;
      const left = Math.max(0, S.turnEnd - Date.now());
      const p = Math.min(1, left / S.turnTotal);
      document.querySelectorAll('.timing').forEach((el) => el.style.setProperty('--p', p));
      const bar = document.querySelector('.tbar');
      if (bar) { bar.firstChild.style.width = (p * 100) + '%'; bar.classList.toggle('low', left < 10000); }
      const secs = document.querySelector('.secs');
      if (secs) secs.textContent = ' · ' + Math.ceil(left / 1000) + ' s';
      S.raf = requestAnimationFrame(step);
    };
    step();
  }

  function showPhrases() {
    openModal('phrases', h('div', { class: 'sheet' },
      h('h2', {}, 'Frases rápidas'),
      h('div', { class: 'phrases' }, E.PHRASES.map((p) => h('button', { class: 'btn', onclick: () => { closeModal(); emoteThrottled(p); } }, p))),
      h('button', { class: 'btn small', onclick: closeModal }, 'Cerrar')));
  }

  function showHistory() {
    const v = S.view;
    if (!v) return;
    const me = v.you % 2;
    let us = 0, them = 0;
    const rows = (v.history || []).map((x) => {
      const w = x.winnerTeam;
      const a = w === me ? x.points : 0, b = w !== null && w !== me ? x.points : 0;
      us += a; them += b;
      let what;
      if (x.type === 'domino') what = 'Dominó de ' + (v.seats[x.winnerSeat] ? v.seats[x.winnerSeat].name : '?');
      else if (x.tie) what = 'Tranque empatado';
      else what = 'Tranque';
      return h('div', { class: 'hrow' },
        h('span', { class: 'hn' }, x.no), h('span', { class: 'hw' }, what),
        h('span', { class: 'hp us' }, a ? '+' + a : '–'), h('span', { class: 'hp them' }, b ? '+' + b : '–'),
        h('span', { class: 'ht' }, us + ' / ' + them));
    });
    openModal('history', h('div', { class: 'sheet' },
      h('h2', {}, 'Historial de manos'),
      h('div', { class: 'hrow head' }, h('span', { class: 'hn' }, '#'), h('span', { class: 'hw' }, 'Mano'),
        h('span', { class: 'hp us' }, 'Nos.'), h('span', { class: 'hp them' }, 'Ellos'), h('span', { class: 'ht' }, 'Total')),
      rows.length ? h('div', { class: 'hist' }, rows) : h('p', { class: 'dim' }, 'Todavía no se terminó ninguna mano.'),
      h('button', { class: 'btn', onclick: closeModal }, 'Cerrar')));
  }

  let lastEmoteAt = 0;
  function emoteThrottled(e) {
    if (Date.now() - lastEmoteAt < 1200) return;
    lastEmoteAt = Date.now();
    send({ type: 'emote', e });
  }

  function onHandTile(t) {
    const v = S.view;
    if (!v || v.phase !== 'playing' || v.turn !== v.you) return;
    const mv = (v.legal || []).find((m) => E.sameTile(m.tile, t));
    if (!mv) { toast('Esa ficha no encaja en ningún extremo'); return; }
    if (mv.sides.length === 1) { doPlay(t, mv.sides[0]); return; }
    S.sel = S.sel && E.sameTile(S.sel, t) ? null : t;
    render();
  }

  function doPlay(t, side) {
    S.sel = null;
    send({ type: 'play', tile: t, side });
  }

  /* ---- tablero ---- */

  // Mesa en espiral, como en el juego de referencia: desde la ficha central la cadena sale hacia los lados,
  // al llegar al borde gira 90° y sigue en línea recta por el borde (en columnas y filas), y así va
  // rodeando la mesa hacia adentro. Un brazo ocupa la mitad de arriba y el otro (simétrico) la de abajo,
  // por eso nunca se cruzan. Las fichas llevan una separación pequeña entre sí.
  function layoutBoard(board, startIdx, W, H, u, ghosts) {
    const gap = Math.max(3, Math.round(u * 0.1));
    const pad = 3, P = 2 * u + gap;
    const cx = W / 2, cy = H / 2;
    const XMAX0 = W - pad - u / 2, XMIN0 = pad + u / 2, YMIN0 = pad + u / 2, B0 = cy - 1.5 * u - gap;
    const DIRS = ['R', 'U', 'L', 'D'];
    const FLIP = { R: 'L', L: 'R', U: 'D', D: 'U' };
    const items = [];
    let overflow = false;

    const st = board[startIdx];
    const sdbl = st.a === st.b;
    const start = { w: sdbl ? u : 2 * u, h: sdbl ? 2 * u : u };
    start.x = cx - start.w / 2; start.y = cy - start.h / 2;
    items.push({ kind: 'tile', idx: startIdx, x: start.x, y: start.y, w: start.w, h: start.h, vert: sdbl, l: st.a, r: st.b });

    function arm(list, mirror, ghostVal, ghostSide) {
      let d = 0, k = 0, lc = cy, last = start;
      const seq = list.slice();
      if (ghostVal != null) seq.push({ ghost: true, val: ghostVal });
      for (const p of seq) {
        const dbl = !p.ghost && p.t.a === p.t.b;
        const rectFor = (dir) => {
          const horiz = dir === 'R' || dir === 'L';
          const along = dbl ? u : 2 * u, across = dbl ? 2 * u : u;
          const w = horiz ? along : across, hh = horiz ? across : along;
          if (dir === 'R') return { x: last.x + last.w + gap, y: lc - hh / 2, w, h: hh };
          if (dir === 'L') return { x: last.x - gap - w, y: lc - hh / 2, w, h: hh };
          if (dir === 'U') return { x: lc - w / 2, y: last.y - gap - hh, w, h: hh };
          return { x: lc - w / 2, y: last.y + last.h + gap, w, h: hh };
        };
        const fits = (dir, r) => {
          if (dir === 'R') return r.x + r.w <= XMAX0 - k * P + 0.01;
          if (dir === 'L') return r.x >= XMIN0 + k * P - 0.01;
          if (dir === 'U') return r.y >= YMIN0 + k * P - 0.01;
          return r.y + r.h <= B0 - k * P + 0.01;
        };
        let r = rectFor(DIRS[d]);
        if (!fits(DIRS[d], r)) {
          // esquina: la nueva ficha se apoya al ras del extremo de la anterior
          const cur = DIRS[d];
          if (cur === 'R') lc = last.x + last.w - u / 2;
          else if (cur === 'U') lc = last.y + u / 2;
          else if (cur === 'L') lc = last.x + u / 2;
          else { lc = last.y + last.h - u / 2; k++; }
          d = (d + 1) % 4;
          r = rectFor(DIRS[d]);
          if (!fits(DIRS[d], r)) overflow = true;
        }
        last = r;
        const dirA = mirror ? FLIP[DIRS[d]] : DIRS[d];
        const box = mirror ? { x: W - (r.x + r.w), y: 2 * cy - (r.y + r.h), w: r.w, h: r.h } : r;
        if (p.ghost) { items.push({ kind: 'slot', x: box.x, y: box.y, w: box.w, h: box.h, side: ghostSide, val: p.val }); continue; }
        const inner = mirror ? p.t.b : p.t.a, outer = mirror ? p.t.a : p.t.b;
        const first = dirA === 'R' || dirA === 'D';
        items.push({ kind: 'tile', idx: p.idx, x: box.x, y: box.y, w: box.w, h: box.h, vert: box.h > box.w,
          l: first ? inner : outer, r: first ? outer : inner });
      }
    }
    const right = [], left = [];
    for (let i = startIdx + 1; i < board.length; i++) right.push({ t: board[i], idx: i });
    for (let i = startIdx - 1; i >= 0; i--) left.push({ t: board[i], idx: i });
    arm(right, false, ghosts && ghosts.R != null ? ghosts.R : null, 'R');
    arm(left, true, ghosts && ghosts.L != null ? ghosts.L : null, 'L');
    return { items, overflow };
  }

  const sizeCache = {};
  function fixedTileSize(W, H) {
    const key = Math.round(W) + 'x' + Math.round(H);
    if (sizeCache[key]) return sizeCache[key];
    // cadena de prueba: 28 fichas con 7 dobles repartidos, más una ranura en cada extremo
    const chain = [];
    for (let i = 0; i < 28; i++) chain.push(i % 4 === 1 ? { a: 1, b: 1 } : { a: 1, b: 2 });
    let found = 12;
    for (let cand = Math.min(44, Math.floor(W / 6.5)); cand >= 12; cand--) {
      let ok = true;
      for (const st of [0, 4, 9, 13, 14, 18, 23, 27]) {
        if (layoutBoard(chain, st, W, H, cand, { L: 1, R: 1 }).overflow) { ok = false; break; }
      }
      if (ok) { found = cand; break; }
    }
    sizeCache[key] = found;
    return found;
  }

  function fitBoard() {
    const v = S.view;
    const wrap = document.querySelector('.board-wrap');
    const board = document.getElementById('board');
    if (!v || !wrap || !board) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    board.innerHTML = '';
    if (!v.board.length) {
      const msg = v.phase === 'playing'
        ? (v.openTile ? 'La mano la abre quien tiene el doble seis' : 'Sale ' + v.seats[v.starter].name)
        : 'Mesa vacía';
      wrap.append(h('div', { class: 'empty-board' }, msg));
      return;
    }
    const prevMsg = wrap.querySelector('.empty-board');
    if (prevMsg) prevMsg.remove();

    const e = E.ends(v.board);
    let ghosts = null;
    if (S.sel && v.phase === 'playing' && v.turn === v.you) {
      const mv = (v.legal || []).find((m) => E.sameTile(m.tile, S.sel));
      if (mv) ghosts = { L: mv.sides.includes('L') ? e.L : null, R: mv.sides.includes('R') ? e.R : null };
    }
    // Tamaño de ficha FIJO: el más grande con el que cabría una cadena completa (28 fichas) en la mesa.
    // Así las fichas no cambian de tamaño mientras se juega.
    const u = fixedTileSize(W, H);
    const lay = layoutBoard(v.board, v.startIdx, W, H, u, ghosts);
    const ev = v.event && v.event.kind === 'play' ? v.event : null;
    const lastIdx = ev ? (ev.side === 'R' ? v.board.length - 1 : (ev.side === 'L' ? 0 : v.startIdx)) : -1;
    const popIdx = ev && S.popDone !== ev.id ? lastIdx : -1;
    if (v.event) S.popDone = v.event.id;

    lay.items.forEach((it) => {
      let el;
      if (it.kind === 'slot') {
        el = h('div', { class: 'slot', style: 'width:' + it.w + 'px;height:' + it.h + 'px;font-size:' + Math.round(u * 0.8) + 'px', onclick: () => { if (S.sel) doPlay(S.sel, it.side); } }, it.val);
      } else {
        el = tileEl(it.l, it.r, it.vert, u, (it.idx === popIdx ? 'pop ' : '') + (it.idx === lastIdx ? 'last' : ''));
      }
      el.style.left = it.x + 'px';
      el.style.top = it.y + 'px';
      board.append(el);
    });
    board.style.width = W + 'px';
    board.style.height = H + 'px';
    board.style.transform = 'none';
    board.style.top = '0px';
  }

  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (S.view && S.view.phase !== 'lobby') fitBoard(); }, 120);
  });

  /* ---- resultados ---- */

  function syncResultModal(v) {
    const ended = v.phase === 'roundEnd' || v.phase === 'gameEnd';
    if (ended) {
      if (S.resultSeen !== v.event.id) { S.resultSeen = v.event.id; showResult(v); }
    } else if (S.modalId === 'result') closeModal();
  }

  function showResult(v) {
    const rr = v.roundResult;
    if (!rr) return;
    const you = v.you;
    const weWon = rr.winnerTeam === you % 2;
    const us = v.scores[you % 2], them = v.scores[1 - (you % 2)];
    let title, sub;
    if (rr.gameOver) {
      title = weWon ? '🏆 ¡Ganamos la partida!' : 'Ganaron ellos la partida';
      sub = 'Resultado final: ' + us + ' a ' + them;
    } else if (rr.type === 'domino') {
      title = '¡Dominó de ' + v.seats[rr.winnerSeat].name + '!';
      sub = (weWon ? 'Sumamos ' : 'Suman ellos ') + rr.points + ' puntos';
    } else if (rr.tie) {
      title = 'Tranque empatado';
      sub = 'Los dos equipos tienen ' + rr.teamPips[0] + ' puntos: nadie anota';
    } else {
      title = 'Tranque';
      sub = (weWon ? 'Ganamos' : 'Ganan ellos') + ' con menos puntos (' + rr.teamPips[rr.winnerTeam] + ' contra ' + rr.teamPips[1 - rr.winnerTeam] + '): +' + rr.points;
    }
    const hands = h('div', { class: 'res-hands' }, [0, 1, 2, 3].map((i) => {
      const hd = rr.hands[i];
      const tot = hd.reduce((s, t) => s + t[0] + t[1], 0);
      return h('div', { class: 'res-hand' },
        h('div', { class: 'nm' }, h('span', {}, v.seats[i].name + (i === rr.winnerSeat ? ' ★' : '')), h('span', { class: 'chip ' + (i % 2 === 0 ? 'a' : 'b') }, tot)),
        h('div', { class: 'tiles' }, hd.length ? hd.map((t) => tileEl(t[0], t[1], true, 0)) : h('span', { class: 'dim', style: 'font-size:12px' }, 'sin fichas')));
    }));
    const next = h('button', { class: 'btn primary grow', disabled: true, onclick: () => { closeModal(); send({ type: 'next' }); } }, rr.gameOver ? 'Revancha' : 'Siguiente mano');
    let n = 2;
    const tick = () => {
      if (!next.isConnected) return;
      if (n > 0) { next.textContent = (rr.gameOver ? 'Revancha' : 'Siguiente mano') + ' (' + n + ')'; n--; setTimeout(tick, 1000); }
      else { next.textContent = rr.gameOver ? 'Revancha' : 'Siguiente mano'; next.disabled = false; }
    };
    openModal('result', h('div', { class: 'sheet' },
      h('div', { class: 'win-box' }, h('div', { class: 'big' }, title), h('p', { class: 'dim' }, sub)),
      hands,
      h('p', { class: 'center' }, 'Nosotros ', h('b', {}, us), ' — Ellos ', h('b', {}, them), h('span', { class: 'dim' }, '  (meta ' + v.opts.target + ')')),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onclick: closeModal }, 'Ver mesa'),
        next),
      rr.gameOver ? h('button', { class: 'btn small danger', onclick: () => confirmLeave() }, 'Salir') : null), true);
    tick();
  }

  /* ---- menú y reglas ---- */

  function confirmLeave() {
    const host = S.mode === 'host';
    openModal('leave', h('div', { class: 'sheet' },
      h('h2', {}, '¿Salir?'),
      h('p', {}, host ? 'Eres el anfitrión: si sales, la sala se cierra para todos.' : (S.mode === 'local' ? 'Se perderá esta partida de práctica.' : 'Un bot jugará en tu lugar.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onclick: closeModal }, 'Seguir jugando'),
        h('button', { class: 'btn danger grow', onclick: () => leave(false) }, 'Salir'))));
  }

  function showMenu() {
    const v = S.view;
    const isHost = S.mode === 'host';
    const others = [];
    if (isHost && v) {
      v.seats.forEach((s, i) => {
        if (s.kind === 'human' && i !== v.you) {
          others.push(h('div', { class: 'row' },
            h('div', { class: 'grow' }, s.name, !s.connected ? h('span', { class: 'dim' }, ' (sin conexión)') : null),
            h('button', { class: 'btn small danger', onclick: () => {
              hostKick(i, 'Un bot tomó tu lugar.');
              S.game.replaceWithBot(i);
              closeModal();
            } }, 'Poner un bot')));
        }
      });
    }
    openModal('menu', h('div', { class: 'sheet' },
      h('h2', {}, 'Menú'),
      S.code ? h('div', { class: 'row' },
        h('div', { class: 'grow' }, 'Sala ', h('b', { style: 'letter-spacing:3px;color:var(--gold)' }, S.code)),
        h('button', { class: 'btn small', onclick: shareLink }, 'Compartir')) : null,
      others.length ? h('div', { class: 'col' }, h('div', { class: 'opt-label' }, 'Jugadores'), others) : null,
      h('button', { class: 'btn', onclick: () => { S.sound = !S.sound; ls.set('domino.sound', S.sound ? '1' : '0'); showMenu(); } }, S.sound ? '🔊 Sonido: activado' : '🔇 Sonido: apagado'),
      v && v.phase !== 'lobby' ? h('button', { class: 'btn', onclick: showHistory }, '📊 Historial de manos') : null,
      h('button', { class: 'btn', onclick: showRules }, '📖 Reglas'),
      h('button', { class: 'btn danger', onclick: confirmLeave }, 'Salir de la partida'),
      h('button', { class: 'btn small', onclick: closeModal }, 'Cerrar')));
  }

  function showRules() {
    openModal('rules', h('div', { class: 'sheet' },
      h('h2', {}, 'Reglas'),
      h('ul', {},
        h('li', {}, 'Se juega con las 28 fichas (doble seis). Cada jugador recibe 7.'),
        h('li', {}, 'Son dos parejas: los jugadores sentados frente a frente son compañeros.'),
        h('li', {}, 'La primera mano sale quien tiene el doble seis, y debe abrir con él. Las siguientes salen quien ganó la mano anterior, con cualquier ficha.'),
        h('li', {}, 'El turno gira hacia la derecha. Cada ficha debe encajar con el número de uno de los dos extremos de la fila.'),
        h('li', {}, 'Si no tienes ninguna ficha que encaje, pasas (el juego lo hace solo).'),
        h('li', {}, 'Dominó: quien se queda sin fichas gana la mano y su pareja suma los puntos de las fichas que le quedan a la pareja rival (solo las del rival, no las de su propia pareja).'),
        h('li', {}, 'Tranque: si nadie puede jugar, gana el equipo que sume menos puntos entre las fichas de sus dos jugadores. Suma los puntos de las fichas del rival (o solo la diferencia, según la opción de la sala). Si empatan, nadie anota.'),
        h('li', {}, 'Gana la partida el primer equipo que llegue a la meta de puntos.')),
      h('button', { class: 'btn primary', onclick: () => { if (S.view && S.view.phase !== 'lobby' && S.modalId === 'rules') closeModal(); else closeModal(); } }, 'Entendido')));
  }

  /* ============ arranque ============ */

  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (urlCode) S.prefill = urlCode;
  renderHome();
  if (urlCode) {
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* nada */ }
    if (S.name) toast('Sala ' + urlCode + ' lista: pulsa «Unirme»');
    else toast('Escribe tu nombre y pulsa «Unirme»');
  }
})();
