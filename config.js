// Configuración del juego en línea. Todo es opcional.
window.DOMINO_CONFIG = {
  // Prefijo de las salas en el servidor público de PeerJS. Cámbialo por algo único tuyo
  // (solo letras minúsculas, números y guiones) para evitar choques con otras personas.
  peerPrefix: 'domino-amigos-',

  // Servidores STUN (gratuitos). Puedes añadir aquí tus propios TURN a mano:
  //   { urls: 'turn:servidor:443?transport=tcp', username: '...', credential: '...' }
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ],

  // Relevo TURN gratuito compartido (Open Relay) para redes que bloquean las conexiones directas.
  // Se activa solo; pon false para desactivarlo.
  freeRelay: true,

  // Recomendado si tus amigos tienen problemas: crea una cuenta gratis en metered.ca (20 GB/mes de TURN),
  // crea una "app" y pega aquí el nombre de la app y su API key. Así tienes un relevo propio y fiable.
  meteredApp: '',   // por ejemplo 'minombre'  (de minombre.metered.live)
  meteredKey: '',

  // Si algún día alojas tu propio PeerServer, indícalo aquí. Ejemplo:
  //   peerServer: { host: 'mi-peerserver.example.com', port: 443, path: '/', secure: true }
  peerServer: {},

  // Dónde se descarga la librería PeerJS (se prueban en orden).
  peerScriptUrls: [
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
  ]
};
