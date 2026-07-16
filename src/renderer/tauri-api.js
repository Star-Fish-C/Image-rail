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
    chooseProjectFolder: (payload = {}) => invoke('choose_project_folder', {
      projectName: payload.projectName || ''
    }),
    listProjects: () => invoke('list_projects'),
    openExistingProject: (payload) => invoke('open_existing_project', {
      projectPath: payload.projectPath,
      projectDataFile: payload.projectDataFile
    }),
    rebindProjectFolder: (payload) => invoke('rebind_project_folder_command', {
      projectDataFile: payload.projectDataFile
    }),
    saveProject: (payload) => invoke('save_project_command', {
      projectPath: payload.projectPath,
      project: payload.project
    }),
    restoreProject: (payload) => invoke('restore_project_command', {
      projectPath: payload.projectPath,
      currentProject: payload.currentProject,
      previousProject: payload.previousProject
    }),
    renameProject: (payload) => invoke('rename_project_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      newProjectName: payload.newProjectName
    }),
    deleteProjectRecord: (payload) => invoke('delete_project_record_command', {
      projectDataFile: payload.projectDataFile
    }),
    deleteImageFile: (payload) => invoke('delete_image_file_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      trackId: payload.trackId,
      imageId: payload.imageId
    }),
    deleteTrackFolder: (payload) => invoke('delete_track_folder_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      trackId: payload.trackId
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
    addImageRawFileDataToTrack: (payload) => invoke(
      'add_image_raw_file_data_to_track_command',
      new Uint8Array(payload.fileData),
      {
        headers: {
          'x-project-path': encodeURIComponent(payload.projectPath || ''),
          'x-project-data-file': encodeURIComponent(payload.project.projectDataFile || ''),
          'x-track-id': encodeURIComponent(payload.trackId || ''),
          'x-file-name': encodeURIComponent(payload.fileName || ''),
          'x-mime-type': payload.mimeType || ''
        }
      }
    ),
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
    renameImageFile: (payload) => invoke('rename_image_file_command', {
      projectPath: payload.projectPath,
      project: payload.project,
      trackId: payload.trackId,
      imageId: payload.imageId,
      newImageName: payload.newImageName
    }),
    revealImageInFolder: (payload) => invoke('reveal_image_in_folder_command', {
      projectPath: payload.projectPath,
      relativePath: payload.relativePath
    }),
    startWindowDrag: () => invoke('start_window_drag_command'),
    minimizeWindow: () => invoke('minimize_window_command'),
    toggleMaximizeWindow: () => invoke('toggle_maximize_window_command'),
    closeWindow: () => invoke('close_window_command')
  };
})();
