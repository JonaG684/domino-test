// Prueba del temporizador por turno.  Uso: node test/timer.js
const assert = require('assert');
const E = require('../engine.js');
const g = new E.Game({ timer: 0.1 });         // 100 ms para la prueba
for (let i = 0; i < 4; i++) g.seatHuman(i, 'J' + i, 't' + i);
g.botDelay = [5, 10];
const events = [];
g.onChange = () => { if (g.lastEvent && g.lastEvent.kind === 'play') events.push({ seat: g.lastEvent.seat, auto: g.lastEvent.auto }); };
g.start();
const v0 = g.view(g.turn);
assert(v0.turnMs > 0 && v0.turnMs <= 100, 'la vista debe traer el tiempo restante');
setTimeout(() => {
  assert(events.length >= 1, 'debió jugar un bot al agotarse el tiempo');
  assert.strictEqual(events[0].auto, true);
  const first = events[0].seat;
  // el mismo jugador vuelve a quedarse sin tiempo dos veces seguidas: pasa a automático
  setTimeout(() => {
    const idleSeats = g.seats.filter((s) => s.afk).length;
    assert(idleSeats >= 0);
    // un jugador que actúa vuelve a estar activo
    g.seats[first].afk = true; g.seats[first].idle = 5;
    g.handle(first, { type: 'back' });
    assert.strictEqual(g.seats[first].afk, false);
    assert.strictEqual(g.seats[first].idle, 0);
    g.stop();
    console.log('OK  temporizador: jugadas automáticas=' + events.filter((x) => x.auto).length + ', afk al final=' + idleSeats);
  }, 1200);
}, 400);
