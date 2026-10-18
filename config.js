// Configuración del juego en línea. Todo es opcional.
window.DOMINO_CONFIG = {
  // Prefijo de las salas en el servidor público de PeerJS. Cámbialo por algo único tuyo
  // (solo letras minúsculas, números y guiones) para evitar choques con otras personas.
  peerPrefix: 'domino-amigos-',

  // Servidores STUN (gratuitos). Para que funcione en casi cualquier red móvil conviene
  // añadir un servidor TURN. Ejemplo (Open Relay de Metered, requiere cuenta gratuita):
  //   { urls: 'turn:TU-SUBDOMINIO.metered.live:443?transport=tcp', username: '...', credential: '...' }
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ],

  // Si algún día alojas tu propio PeerServer, indícalo aquí. Ejemplo:
  //   peerServer: { host: 'mi-peerserver.example.com', port: 443, path: '/', secure: true }
  peerServer: {},

  // Dónde se descarga la librería PeerJS (se prueban en orden).
  peerScriptUrls: [
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
  ]
};
