const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('imageRail', {
  chooseProjectFolder: () => ipcRenderer.invoke('project:choose-folder'),
  listProjects: () => ipcRenderer.invoke('project:list'),
  openExistingProject: (projectPath) => ipcRenderer.invoke('project:open-existing', projectPath),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  renameImagesFolder: (payload) => ipcRenderer.invoke('project:rename-images-folder', payload),
  renameProject: (payload) => ipcRenderer.invoke('project:rename', payload),
  deleteProjectRecord: (projectPath) => ipcRenderer.invoke('project:delete-record', projectPath),
  renameTrackFolder: (payload) => ipcRenderer.invoke('track:rename-folder', payload),
  addImageToTrack: (payload) => ipcRenderer.invoke('image:add-to-track', payload),
  renameTrackPrefix: (payload) => ipcRenderer.invoke('image:rename-track-prefix', payload)
});
