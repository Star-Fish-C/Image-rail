(function () {
  if (window.imageRail) return;

  const tauri = window.__TAURI__;
  const invoke = tauri?.core?.invoke;
  const convertFileSrc = tauri?.core?.convertFileSrc;

  if (!invoke) {
    console.error('Tauri API is not available.');
    return;
  }

  window.imageRail = {
    fileUrlFromPath: (filePath) => {
      if (convertFileSrc) return convertFileSrc(filePath);
      return encodeURI(`file:///${String(filePath).replace(/\\/g, '/')}`);
    },
    chooseProjectFolder: () => invoke('choose_project_folder'),
    listProjects: () => invoke('list_projects'),
    openExistingProject: (payload) => invoke('open_existing_project', {
      projectPath: payload.projectPath,
      projectDataFile: payload.projectDataFile
    }),
    saveProject: (payload) => invoke('save_project_command', {
      projectPath: payload.projectPath,
      project: payload.project
    }),
    renameImagesFolder: (payload) => invoke('rename_images_folder_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      newFolderName: payload.newFolderName
    }),
    renameProject: (payload) => invoke('rename_project_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      newProjectName: payload.newProjectName
    }),
    deleteProjectRecord: (payload) => invoke('delete_project_record_command', {
      projectDataFile: payload.projectDataFile
    }),
    renameTrackFolder: (payload) => invoke('rename_track_folder_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      trackId: payload.trackId,
      newTrackName: payload.newTrackName
    }),
    addImageToTrack: (payload) => invoke('add_image_to_track_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      trackId: payload.trackId,
      sourcePath: payload.sourcePath
    }),
    addImagePathsToTrack: (payload) => invoke('add_image_paths_to_track_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      trackId: payload.trackId,
      sourcePaths: payload.sourcePaths
    }),
    addImageFileDataToTrack: (payload) => invoke('add_image_file_data_to_track_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      trackId: payload.trackId,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      fileData: Array.from(new Uint8Array(payload.fileData))
    }),
    addImageUrlToTrack: (payload) => invoke('add_image_url_to_track_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      trackId: payload.trackId,
      url: payload.url
    }),
    renameTrackPrefix: (payload) => invoke('rename_track_prefix_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      trackId: payload.trackId,
      newPrefix: payload.newPrefix
    }),
    onFileDropEvent: (handler) => {
      const getCurrentWebview = tauri?.webview?.getCurrentWebview;
      const webview = getCurrentWebview?.();
      return webview?.onDragDropEvent?.(handler);
    }
  };
})();
