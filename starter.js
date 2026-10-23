// Comprueba la rotación de quién sale.  Uso: node test/starter.js
const assert = require('assert');
const E = require('../engine.js');
const pips = (h) => h.reduce((s, t) => s + t[0] + t[1], 0);
let checked = 0, alternated = 0;
for (let n = 0; n < 300; n++) {
  const g = new E.Game({ target: 200, salida: 'turnos' });
  g.noTimers = true;
  for (let i = 0; i < 4; i++) g.addBot(i);
  g.start();
  const lead = [null, null];           // modelo independiente
  let guard = 0;
  while (g.phase !== 'gameEnd' && guard++ < 5000) {
    if (g.phase === 'roundEnd') {
      const r = g.roundResult;
      if (!r.tie) {
        const t = r.winnerTeam;
        const p = r.hands.map(pips);
        const who = r.type === 'domino' ? r.winnerSeat : (p[t] <= p[t + 2] ? t : t + 2);
        const exp = lead[t] === null ? who : (lead[t] + 2) % 4;
        lead[t] = exp;
        assert.strictEqual(g.nextStarter, exp, 'sale quien no salió la última vez');
        assert.strictEqual(r.nextStarter, exp);
        assert.strictEqual(exp % 2, t, 'sale alguien de la pareja ganadora');
        checked++;
      }
      g.next();
      if (g.phase === 'playing' && !g.firstHand) { /* la salida ya está fijada */ }
      continue;
    }
    g.botMove();
  }
}
// modo «quien se fue»
const g2 = new E.Game({ salida: 'gana' }); g2.noTimers = true;
for (let i = 0; i < 4; i++) g2.addBot(i);
g2.start();
let k = 0;
while (g2.phase !== 'gameEnd' && k++ < 5000) {
  if (g2.phase === 'roundEnd') { const r = g2.roundResult; if (r.type === 'domino') assert.strictEqual(g2.nextStarter, r.winnerSeat); g2.next(); continue; }
  g2.botMove();
}
console.log('OK  rotación de salida: manos verificadas=' + checked);
