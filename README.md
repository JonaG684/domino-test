# Dominó con amigos

Dominó clásico (doble seis) para 4 jugadores en parejas. Sin anuncios, sin cuentas, sin servidor propio:
es una web estática que se juega directo entre los dispositivos (WebRTC con PeerJS). Funciona en móvil y PC.

## Subir a Vercel
**Opción A – con la terminal**
```
npm i -g vercel
cd domino-online
vercel --prod
```
(Cuando pregunte: "Framework" → Other; directorio de salida → `.`)

**Opción B – con GitHub**: sube esta carpeta a un repo, en vercel.com pulsa *Add New → Project*, elige el repo y *Deploy*.
No hay build ni variables de entorno.

## Cómo se juega online
1. Uno escribe su nombre y pulsa **Crear sala**; comparte el enlace o el código de 4 letras.
2. Los demás abren el enlace, ponen su nombre y entran. Se puede completar con bots.
3. El anfitrión elige la meta (50/100/150/200) y la regla del tranque, y pulsa **Empezar**.

El anfitrión es quien "aloja" la partida: si cierra la pestaña, la sala se cae (puede reabrirla desde el mismo
navegador con *Continuar tu sala*). Si alguien se desconecta, un bot juega por él hasta que vuelva.

## Reglas implementadas
- 28 fichas, 7 por jugador; parejas enfrentadas (asientos 1-3 contra 2-4); turno antihorario.
- Primera mano: abre quien tiene el doble seis, con él. Siguientes: abre el ganador de la mano anterior.
- Pasa automáticamente quien no tiene jugada.
- Dominó: la pareja suma todos los puntos de las fichas restantes de los 4 jugadores.
- Tranque: gana la pareja con menos puntos (suma todo o solo la diferencia, a elegir); empate = nadie anota.
- Gana el primer equipo en llegar a la meta.

## Si algún amigo no logra conectarse
Algunas redes móviles/corporativas bloquean las conexiones directas. Solución: añadir un servidor TURN gratuito
en `config.js` (`iceServers`; ejemplo incluido, p. ej. Metered Open Relay).

## Archivos
`engine.js` reglas y bots · `app.js` interfaz y red · `config.js` ajustes · `test/simulate.js` (`node test/simulate.js`).
