// Preload mínimo de Electron.
//
// La app se comunica con el backend por HTTP (mismo origen en producción),
// así que no necesita exponer APIs privilegiadas al renderer por ahora. Este
// archivo existe para satisfacer webPreferences.preload y dejar la puerta
// abierta a IPC futuro (p.ej. diálogo nativo de selección de llama-server).
//
// contextIsolation: true → el renderer no tiene acceso directo a Node.

export {}
