const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('imageRail', {
  chooseProjectFolder: () => ipcRenderer.invoke('project:choose-folder'),
  loadProject: (projectPath) => ipcRenderer.invoke('project:load', projectPath),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  renameImagesFolder: (payload) => ipcRenderer.invoke('project:rename-images-folder', payload),
  renameTrackFolder: (payload) => ipcRenderer.invoke('track:rename-folder', payload),
  addImageToTrack: (payload) => ipcRenderer.invoke('image:add-to-track', payload),
  renameTrackPrefix: (payload) => ipcRenderer.invoke('image:rename-track-prefix', payload)
});
