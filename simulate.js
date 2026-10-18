// Simula muchas partidas completas entre bots y comprueba las reglas.  Uso: node test/simulate.js
const assert = require('assert');
const E = require('../engine.js');

function check(g) {
  // 28 fichas en total, sin repetir
  const seen = new Set();
  const add = (a, b) => {
    const k = Math.min(a, b) + '-' + Math.max(a, b);
    assert(!seen.has(k), 'ficha repetida ' + k);
    seen.add(k);
  };
  g.hands.forEach((h) => h.forEach((t) => add(t[0], t[1])));
  g.board.forEach((t) => add(t.a, t.b));
  assert.strictEqual(seen.size, 28, 'deben existir 28 fichas');
  // la cadena es válida: cada ficha encaja con la siguiente
  for (let i = 0; i + 1 < g.board.length; i++) {
    assert.strictEqual(g.board[i].b, g.board[i + 1].a, 'cadena rota en ' + i);
  }
}

let games = 0, rounds = 0, dominos = 0, tranques = 0, ties = 0, plays = 0, passes = 0;
const N = Number(process.argv[2] || 1500);

for (let n = 0; n < N; n++) {
  const g = new E.Game({ target: [50, 100, 150, 200][n % 4], tranque: n % 2 ? 'dif' : 'todo' });
  g.noTimers = true;
  for (let i = 0; i < 4; i++) g.addBot(i);
  assert(g.start());
  let guard = 0;
  while (g.phase !== 'gameEnd') {
    assert(guard++ < 20000, 'partida infinita');
    if (g.phase === 'roundEnd') {
      const r = g.roundResult;
      rounds++;
      if (r.type === 'domino') dominos++; else if (r.tie) ties++; else tranques++;
      if (r.type === 'domino') assert.strictEqual(r.hands[r.winnerSeat].length, 0);
      assert(g.next());
      continue;
    }
    if (g.roundNo === 1 && g.board.length === 0) {
      // la primera mano debe abrir el doble seis
      assert.deepStrictEqual(g.hands[g.turn].some((t) => t[0] === 6 && t[1] === 6), true);
      const ms = E.legalMoves(g.board, g.hands[g.turn], { openTile: g.openTile });
      assert.strictEqual(ms.length, 1);
    }
    const before = g.eventId;
    g.botMove();
    assert(g.eventId > before, 'el bot no jugó');
    plays++;
    passes += g.lastEvent.passes ? g.lastEvent.passes.length : 0;
    if (g.phase === 'playing') {
      check(g);
      // el jugador en turno siempre tiene jugada
      assert(E.legalMoves(g.board, g.hands[g.turn], { openTile: g.openTile }).length > 0);
    }
  }
  const win = g.scores[0] >= g.opts.target ? 0 : 1;
  assert(g.scores[win] >= g.opts.target);
  // el resumen visible no filtra fichas ajenas durante la partida
  games++;
}

// una vista durante la partida no incluye manos ajenas ni tokens
const g2 = new E.Game();
g2.noTimers = true;
g2.seatHuman(0, 'Ana', 'secreto0');
for (let i = 1; i < 4; i++) g2.addBot(i);
g2.start();
const v = g2.view(0);
assert.strictEqual(JSON.stringify(v).includes('secreto0'), false);
assert.strictEqual(v.hand.length, 7);
assert(!('hands' in v));

// guardar y restaurar
const g3 = E.Game.fromJSON(JSON.parse(JSON.stringify(g2.toJSON())));
assert.deepStrictEqual(g3.hands, g2.hands);
assert.strictEqual(g3.seats[0].connected, false);

// rechaza jugadas ilegales
const g4 = new E.Game();
g4.noTimers = true;
for (let i = 0; i < 4; i++) g4.addBot(i);
g4.start();
const s = g4.turn;
const wrong = g4.hands[s].find((t) => !(t[0] === 6 && t[1] === 6));
assert.strictEqual(g4.play(s, wrong, 'C'), false, 'la primera mano exige el doble seis');
assert.strictEqual(g4.play((s + 1) % 4, g4.hands[(s + 1) % 4][0], 'C'), false, 'fuera de turno');

console.log('OK  partidas=' + games + ' manos=' + rounds + ' (dominó=' + dominos + ', tranque=' + tranques +
  ', empates=' + ties + ') jugadas=' + plays + ' pases=' + passes);
