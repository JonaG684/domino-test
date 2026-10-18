/* engine.js — reglas del dominó, bots y lógica de la partida (la ejecuta el anfitrión).
 * Dominó clásico doble-seis, 4 jugadores en parejas (asientos 0 y 2 contra 1 y 3).
 * Sin dependencias: funciona en el navegador (window.DominoEngine) y en Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DominoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BOT_NAMES = ['Luna', 'Rayo', 'Nube', 'Fénix', 'Trueno', 'Sol'];
  const EMOTES = ['👏', '😂', '😡', '🔥', '😴', '🤝'];
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- fichas y reglas básicas ---------- */

  function allTiles() {
    const t = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b]);
    return t;
  }

  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function deal(rnd) {
    const t = shuffle(allTiles(), rnd || Math.random);
    return [0, 1, 2, 3].map((i) => t.slice(i * 7, i * 7 + 7));
  }

  const pips = (hand) => hand.reduce((s, t) => s + t[0] + t[1], 0);
  const sameTile = (x, y) => (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]);

  // board: lista de {a,b} ordenada de izquierda a derecha; el extremo izquierdo es board[0].a
  // y el derecho es board[último].b
  function ends(board) {
    return board.length ? { L: board[0].a, R: board[board.length - 1].b } : null;
  }

  function sidesFor(board, tile) {
    if (!board.length) return ['C'];
    const e = ends(board);
    const out = [];
    if (tile[0] === e.L || tile[1] === e.L) out.push('L');
    if (tile[0] === e.R || tile[1] === e.R) out.push('R');
    return out;
  }

  function legalMoves(board, hand, opts) {
    const moves = [];
    for (const t of hand) {
      if (!board.length && opts && opts.openTile && !sameTile(t, opts.openTile)) continue;
      const sides = sidesFor(board, t);
      if (sides.length) moves.push({ tile: t, sides });
    }
    return moves;
  }

  /* ---------- bot ---------- */

  function botChoose(game, seat) {
    const hand = game.hands[seat];
    const moves = legalMoves(game.board, hand, { openTile: game.openTile });
    const partner = (seat + 2) % 4;
    const opps = [(seat + 1) % 4, (seat + 3) % 4];
    const e = ends(game.board);
    let best = null;
    let bestScore = -Infinity;
    for (const mv of moves) {
      for (const side of mv.sides) {
        const t = mv.tile;
        const rest = hand.filter((x) => x !== t);
        const other = (v) => (t[0] === v ? t[1] : t[0]);
        let L, R;
        if (side === 'C') { L = t[0]; R = t[1]; }
        else if (side === 'L') { L = other(e.L); R = e.R; }
        else { L = e.L; R = other(e.R); }

        let score = t[0] + t[1];                 // soltar fichas pesadas
        if (t[0] === t[1]) score += 4;           // y los dobles temprano
        if (rest.length === 0) score += 1000;    // ¡dominó!
        for (const v of [L, R]) {
          score += 1.5 * rest.filter((x) => x[0] === v || x[1] === v).length; // extremos que puedo seguir jugando
          for (const o of opps) if (game.passed[o].includes(v)) score += 3;   // rival sin ese número
          if (game.passed[partner].includes(v)) score -= 4;                   // mi pareja sin ese número
        }
        score += game.rnd() * 0.8;
        if (score > bestScore) { bestScore = score; best = { tile: t, side }; }
      }
    }
    return best;
  }

  /* ---------- partida ---------- */

  const PERSIST = ['opts', 'seats', 'phase', 'scores', 'roundNo', 'firstHand', 'hands', 'board', 'startIdx',
    'turn', 'starter', 'nextStarter', 'passed', 'roundResult', 'lastEvent', 'eventId', 'log', 'openTile',
    'lastEmote', 'emoteId'];

  class Game {
    constructor(opts) {
      this.opts = Object.assign({ target: 100, tranque: 'todo' }, opts || {});
      this.seats = [0, 1, 2, 3].map(() => ({ kind: 'empty', name: '', token: '', connected: false }));
      this.phase = 'lobby';          // lobby | playing | roundEnd | gameEnd
      this.scores = [0, 0];          // equipo 0 = asientos 0 y 2; equipo 1 = asientos 1 y 3
      this.roundNo = 0;
      this.firstHand = true;
      this.hands = [[], [], [], []];
      this.board = [];
      this.startIdx = 0;
      this.turn = 0;
      this.starter = 0;
      this.nextStarter = 0;
      this.passed = [[], [], [], []];
      this.openTile = null;
      this.roundResult = null;
      this.lastEvent = null;
      this.eventId = 0;
      this.lastEmote = null;
      this.emoteId = 0;
      this.log = [];
      this.onChange = null;
      this.timer = null;
      this.noTimers = false;
      this.rnd = Math.random;
      this.botDelay = [800, 1600];
    }

    /* --- utilidades --- */
    nameOf(i) { return this.seats[i].name || ('Asiento ' + (i + 1)); }
    addLog(t) { this.log.push(t); if (this.log.length > 60) this.log.shift(); }
    isAuto(i) { const s = this.seats[i]; return s.kind === 'bot' || (s.kind === 'human' && !s.connected); }
    firstFreeSeat() { return this.seats.findIndex((s) => s.kind === 'empty'); }
    emit() { if (this.onChange) this.onChange(); this.schedule(); }

    /* --- sala --- */
    seatHuman(i, name, token) {
      this.seats[i] = { kind: 'human', name: name, token: token, connected: true };
    }
    addBot(i) {
      if (this.phase !== 'lobby' || this.seats[i].kind !== 'empty') return false;
      const used = this.seats.map((s) => s.name);
      const nm = 'Bot ' + (BOT_NAMES.find((n) => !used.includes('Bot ' + n)) || (i + 1));
      this.seats[i] = { kind: 'bot', name: nm, token: '', connected: true };
      this.emit();
      return true;
    }
    clearSeat(i) {
      if (this.phase !== 'lobby') return false;
      this.seats[i] = { kind: 'empty', name: '', token: '', connected: false };
      this.emit();
      return true;
    }
    replaceWithBot(i) {  // en plena partida: un bot ocupa el lugar de un humano
      const s = this.seats[i];
      if (s.kind !== 'human') return false;
      this.seats[i] = { kind: 'bot', name: s.name + ' (bot)', token: '', connected: true };
      this.addLog(s.name + ' fue reemplazado por un bot');
      this.emit();
      return true;
    }
    sit(from, to) {
      if (this.phase !== 'lobby' || to < 0 || to > 3 || this.seats[to].kind !== 'empty') return false;
      this.seats[to] = this.seats[from];
      this.seats[from] = { kind: 'empty', name: '', token: '', connected: false };
      this.emit();
      return true;
    }
    setOpts(o) {
      if (this.phase !== 'lobby') return;
      if ([50, 100, 150, 200].includes(o.target)) this.opts.target = o.target;
      if (['todo', 'dif'].includes(o.tranque)) this.opts.tranque = o.tranque;
      this.emit();
    }
    canStart() { return this.phase === 'lobby' && this.seats.every((s) => s.kind !== 'empty'); }
    start() {
      if (!this.canStart()) return false;
      this.scores = [0, 0];
      this.roundNo = 0;
      this.firstHand = true;
      this.log = [];
      this.startRound();
      this.emit();
      return true;
    }

    /* --- manos --- */
    startRound() {
      this.roundNo++;
      this.hands = deal(this.rnd);
      this.board = [];
      this.startIdx = 0;
      this.passed = [[], [], [], []];
      this.roundResult = null;
      if (this.firstHand) {
        this.openTile = [6, 6];
        this.starter = this.hands.findIndex((h) => h.some((t) => t[0] === 6 && t[1] === 6));
      } else {
        this.openTile = null;
        this.starter = this.nextStarter;
      }
      this.turn = this.starter;
      this.phase = 'playing';
      this.lastEvent = { id: ++this.eventId, kind: 'deal', seat: this.starter, passes: [] };
      this.addLog('Mano ' + this.roundNo + ': sale ' + this.nameOf(this.starter) +
        (this.openTile ? ' (con el doble seis)' : ''));
    }

    play(seat, tile, side) {
      if (this.phase !== 'playing' || this.turn !== seat) return false;
      if (!Array.isArray(tile) || tile.length !== 2) return false;
      const hand = this.hands[seat];
      const idx = hand.findIndex((t) => sameTile(t, tile));
      if (idx < 0) return false;
      const t = hand[idx];
      const mv = legalMoves(this.board, hand, { openTile: this.openTile }).find((m) => m.tile === t);
      if (!mv) return false;
      if (!this.board.length) side = 'C';
      else if (!mv.sides.includes(side)) return false;

      hand.splice(idx, 1);
      let placed;
      if (side === 'C') {
        placed = { a: t[0], b: t[1] };
        this.board = [placed];
        this.startIdx = 0;
      } else if (side === 'L') {
        const L = this.board[0].a;
        placed = t[1] === L ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] };
        this.board.unshift(placed);
        this.startIdx++;
      } else {
        const R = this.board[this.board.length - 1].b;
        placed = t[0] === R ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] };
        this.board.push(placed);
      }
      this.lastEvent = { id: ++this.eventId, kind: 'play', seat: seat, tile: placed, side: side, passes: [] };
      this.addLog(this.nameOf(seat) + ' jugó ' + t[0] + '|' + t[1]);

      if (hand.length === 0) {
        this.endRound('domino', seat);
      } else if (!this.hands.some((h) => legalMoves(this.board, h).length > 0)) {
        this.endRound('tranque');
      } else {
        this.turn = (seat + 1) % 4;
        // quien no puede jugar pasa automáticamente
        let guard = 0;
        while (legalMoves(this.board, this.hands[this.turn]).length === 0 && guard++ < 4) {
          const e = ends(this.board);
          const p = this.passed[this.turn];
          if (!p.includes(e.L)) p.push(e.L);
          if (!p.includes(e.R)) p.push(e.R);
          this.lastEvent.passes.push(this.turn);
          this.addLog(this.nameOf(this.turn) + ' pasó');
          this.turn = (this.turn + 1) % 4;
        }
      }
      this.emit();
      return true;
    }

    endRound(type, seat) {
      const p = this.hands.map(pips);
      const team = [p[0] + p[2], p[1] + p[3]];
      const total = team[0] + team[1];
      const res = { type: type, hands: clone(this.hands), teamPips: team, points: 0,
        winnerTeam: null, winnerSeat: null, tie: false, gameOver: false };
      if (type === 'domino') {
        res.winnerSeat = seat;
        res.winnerTeam = seat % 2;
        res.points = total;
        this.nextStarter = seat;
        this.addLog('¡Dominó de ' + this.nameOf(seat) + '! +' + total);
      } else if (team[0] === team[1]) {
        res.tie = true;
        this.nextStarter = this.starter;
        this.addLog('Tranque empatado: nadie anota');
      } else {
        const wt = team[0] < team[1] ? 0 : 1;
        res.winnerTeam = wt;
        res.points = this.opts.tranque === 'dif' ? Math.abs(team[0] - team[1]) : total;
        this.nextStarter = p[wt] <= p[wt + 2] ? wt : wt + 2;
        this.addLog('Tranque: gana el equipo con menos puntos (+' + res.points + ')');
      }
      if (res.winnerTeam !== null) this.scores[res.winnerTeam] += res.points;
      this.firstHand = false;
      this.phase = 'roundEnd';
      if (res.winnerTeam !== null && this.scores[res.winnerTeam] >= this.opts.target) {
        this.phase = 'gameEnd';
        res.gameOver = true;
      }
      this.roundResult = res;
      this.lastEvent = { id: ++this.eventId, kind: 'end', seat: seat == null ? -1 : seat, passes: [] };
    }

    next() {
      if (this.phase === 'roundEnd') {
        this.startRound();
      } else if (this.phase === 'gameEnd') {
        this.scores = [0, 0];
        this.roundNo = 0;
        this.firstHand = true;
        this.log = [];
        this.startRound();
      } else return false;
      this.emit();
      return true;
    }

    emote(seat, e) {
      if (!EMOTES.includes(e)) return false;
      this.lastEmote = { id: ++this.emoteId, seat: seat, e: e };
      this.emit();
      return true;
    }

    /* --- mensajes que llegan de los jugadores --- */
    handle(seat, m) {
      if (!m || typeof m !== 'object') return;
      switch (m.type) {
        case 'play': this.play(seat, m.tile, m.side); break;
        case 'sit': if (Number.isInteger(m.to)) this.sit(seat, m.to); break;
        case 'next': this.next(); break;
        case 'emote': this.emote(seat, m.e); break;
        default: break;
      }
    }

    /* --- bots --- */
    botMove() {
      if (this.phase !== 'playing' || !this.isAuto(this.turn)) return;
      const mv = botChoose(this, this.turn);
      if (mv) this.play(this.turn, mv.tile, mv.side);
    }
    schedule() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.noTimers || this.phase !== 'playing' || !this.isAuto(this.turn)) return;
      const d = this.botDelay;
      this.timer = setTimeout(() => { this.timer = null; this.botMove(); }, d[0] + Math.random() * (d[1] - d[0]));
    }
    stop() { clearTimeout(this.timer); this.timer = null; this.onChange = null; }

    /* --- lo que ve cada jugador (nunca incluye fichas ajenas ni tokens) --- */
    view(seat) {
      const reveal = this.phase === 'roundEnd' || this.phase === 'gameEnd';
      const playing = this.phase === 'playing';
      return {
        phase: this.phase,
        you: seat,
        seats: this.seats.map((s, i) => ({
          kind: s.kind, name: s.name, host: !!s.host, connected: s.kind === 'human' ? s.connected : s.kind === 'bot',
          count: this.hands[i] ? this.hands[i].length : 0,
        })),
        opts: this.opts,
        scores: this.scores.slice(),
        roundNo: this.roundNo,
        turn: this.turn,
        starter: this.starter,
        board: this.board,
        startIdx: this.startIdx,
        hand: playing || reveal ? this.hands[seat] : [],
        legal: playing && this.turn === seat ? legalMoves(this.board, this.hands[seat], { openTile: this.openTile }) : [],
        openTile: this.openTile,
        event: this.lastEvent,
        emote: this.lastEmote,
        log: this.log.slice(-8),
        roundResult: reveal ? this.roundResult : null,
        canStart: this.canStart(),
      };
    }

    toJSON() {
      const o = {};
      for (const k of PERSIST) o[k] = this[k];
      return clone(o);
    }
    static fromJSON(o) {
      const g = new Game(o.opts);
      for (const k of PERSIST) if (o[k] !== undefined) g[k] = o[k];
      g.seats.forEach((s) => { if (s.kind === 'human') s.connected = false; });
      return g;
    }
  }

  return { Game, allTiles, deal, pips, ends, sidesFor, legalMoves, botChoose, sameTile, EMOTES };
});
