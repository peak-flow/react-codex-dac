const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appAPI', {
  selectMusicFolder: () => ipcRenderer.invoke('library:select-folder'),
  scanMusicFolder: (folderPath) => ipcRenderer.invoke('library:scan-folder', folderPath),
  readAudioFile: (filePath) => ipcRenderer.invoke('library:read-audio-file', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  spotifyLogin: (clientId) => ipcRenderer.invoke('spotify:login', clientId),
  spotifySync: () => ipcRenderer.invoke('spotify:sync'),
  spotifyLogout: () => ipcRenderer.invoke('spotify:logout'),
  getSpotifyRedirectUri: () => ipcRenderer.invoke('spotify:redirect-uri')
});
