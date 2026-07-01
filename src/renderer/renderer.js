const STATUS_OPTIONS = [
  { value: 'usable', label: '可用' },
  { value: 'pending', label: '待定' },
  { value: 'discarded', label: '废弃' },
  { value: 'final_candidate', label: '最终候选' }
];

const COMPARE_WIDTH_STORAGE_KEY = 'imagerail.comparePanelWidth';
const COMPARE_MIN_WIDTH = 300;
const COMPARE_MAX_WIDTH = 780;
const COMPARE_ZOOM_MIN = 0.5;
const COMPARE_ZOOM_MAX = 8;
const COMPARE_ZOOM_STEP = 0.25;

const state = {
  projectPath: '',
  project: null,
  selectedImageId: '',
  pinnedCompareImageId: '',
  renameResolver: null,
  pendingDeleteImageId: '',
  pendingDeleteTrackId: '',
  pendingDeleteProjectPath: '',
  contextMenuImage: null,
  contextMenuTrackId: '',
  draggedTrackId: '',
  draggedImage: null,
  activeCompareViewport: null,
  comparePanelWidth: Number(localStorage.getItem(COMPARE_WIDTH_STORAGE_KEY)) || 390
};

const elements = {
  projectPathText: document.querySelector('#projectPathText'),
  chooseProjectButton: document.querySelector('#chooseProjectButton'),
  newTrackButton: document.querySelector('#newTrackButton'),
  saveProjectButton: document.querySelector('#saveProjectButton'),
  emptyState: document.querySelector('#emptyState'),
  tracks: document.querySelector('#tracks'),
  compareContent: document.querySelector('#compareContent'),
  comparePanel: document.querySelector('.compare-panel'),
  compareResizer: document.querySelector('#compareResizer'),
  pinCompareButton: document.querySelector('#pinCompareButton'),
  zoomInButton: document.querySelector('#zoomInButton'),
  zoomOutButton: document.querySelector('#zoomOutButton'),
  previewModal: document.querySelector('#previewModal'),
  previewImage: document.querySelector('#previewImage'),
  closePreviewButton: document.querySelector('#closePreviewButton'),
  renameModal: document.querySelector('#renameModal'),
  renameForm: document.querySelector('#renameForm'),
  renameTitle: document.querySelector('#renameTitle'),
  renameDescription: document.querySelector('#renameDescription'),
  renameInput: document.querySelector('#renameInput'),
  cancelRenameButton: document.querySelector('#cancelRenameButton'),
  projectModal: document.querySelector('#projectModal'),
  projectList: document.querySelector('#projectList'),
  createProjectButton: document.querySelector('#createProjectButton'),
  closeProjectModalButton: document.querySelector('#closeProjectModalButton'),
  appMessage: document.querySelector('#appMessage'),
  appMessageText: document.querySelector('#appMessageText'),
  appMessageCloseButton: document.querySelector('#appMessageCloseButton'),
  contextMenu: document.querySelector('#contextMenu'),
  renameImageButton: document.querySelector('#renameImageButton'),
  copyPathButton: document.querySelector('#copyPathButton'),
  copyImageButton: document.querySelector('#copyImageButton'),
  pasteImageButton: document.querySelector('#pasteImageButton'),
  revealImageButton: document.querySelector('#revealImageButton'),
  deleteContextImageButton: document.querySelector('#deleteContextImageButton'),
  minimizeWindowButton: document.querySelector('#minimizeWindowButton'),
  maximizeWindowButton: document.querySelector('#maximizeWindowButton'),
  closeWindowButton: document.querySelector('#closeWindowButton')
};

function getTrackLetter(index) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < alphabet.length) return alphabet[index];
  return `T${index + 1}`;
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyComparePanelWidth() {
  const width = clamp(state.comparePanelWidth, COMPARE_MIN_WIDTH, COMPARE_MAX_WIDTH);
  state.comparePanelWidth = width;
  document.documentElement.style.setProperty('--compare-panel-width', `${width}px`);
  localStorage.setItem(COMPARE_WIDTH_STORAGE_KEY, String(width));
}

function getActiveCompareViewport() {
  if (state.activeCompareViewport?.isConnected) return state.activeCompareViewport;
  return document.querySelector('.compare-image-button');
}

function getViewportZoom(viewport) {
  return Number(viewport?.dataset.zoom) || 1;
}

function setViewportZoom(viewport, zoom) {
  if (!viewport) return;
  const cleanZoom = clamp(zoom, COMPARE_ZOOM_MIN, COMPARE_ZOOM_MAX);
  viewport.dataset.zoom = String(cleanZoom);
  viewport.style.setProperty('--compare-zoom', String(cleanZoom));
  viewport.classList.toggle('zoomed', cleanZoom !== 1);
  updateCompareZoomButtons();
}

function activateCompareViewport(viewport) {
  state.activeCompareViewport = viewport;
  updateCompareZoomButtons();
}

function updateCompareZoomButtons() {
  const viewport = getActiveCompareViewport();
  const zoom = getViewportZoom(viewport);
  const disabled = !state.selectedImageId || !viewport;
  if (elements.zoomInButton) elements.zoomInButton.disabled = disabled || zoom >= COMPARE_ZOOM_MAX;
  if (elements.zoomOutButton) elements.zoomOutButton.disabled = disabled || zoom <= COMPARE_ZOOM_MIN;
}

function showAppMessage(message) {
  elements.appMessageText.textContent = String(message || '操作失败，请稍后再试。');
  elements.appMessage.hidden = false;
}

function closeAppMessage() {
  elements.appMessage.hidden = true;
  elements.appMessageText.textContent = '';
}

function getErrorText(error, fallbackMessage) {
  return String(error?.message || error || fallbackMessage);
}

function fileUrlFromRelativePath(relativePath, cacheKey = '') {
  if (!state.projectPath || !relativePath) return '';
  const fullPath = fullPathFromRelativePath(relativePath);
  const baseUrl = window.imageRail?.fileUrlFromPath
    ? window.imageRail.fileUrlFromPath(fullPath)
    : encodeURI(`file:///${fullPath}`);
  return cacheKey ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(cacheKey)}` : baseUrl;
}

function fullPathFromRelativePath(relativePath) {
  const normalizedProjectPath = state.projectPath.replace(/\\/g, '/');
  return `${normalizedProjectPath}/${String(relativePath || '').replace(/\\/g, '/')}`;
}

function fileUriFromPath(filePath) {
  return encodeURI(`file:///${String(filePath || '').replace(/\\/g, '/')}`);
}

function imageMimeFromName(fileName) {
  const extension = String(fileName || '').split('.').pop().toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'avif') return 'image/avif';
  return 'image/png';
}

function imageCacheKey(image) {
  return [image?.id, image?.createdAt, image?.fileName].filter(Boolean).join('_');
}

function setProject(projectPath, project) {
  state.projectPath = projectPath;
  state.project = project;
  state.project.projectName = state.project.projectName || getFolderName(projectPath);
  state.project.imagesFolderName = state.project.imagesFolderName || '';
  state.selectedImageId = '';
  state.pinnedCompareImageId = '';
  state.pendingDeleteImageId = '';
  state.pendingDeleteTrackId = '';
  state.pendingDeleteProjectPath = '';
  render();
}

function setProjectFromResult(result) {
  state.projectPath = result.projectPath || state.projectPath;
  state.project = result.project;
  render();
}

async function openProjectModal() {
  elements.projectModal.hidden = false;
  await renderProjectList();
}

function closeProjectModal() {
  elements.projectModal.hidden = true;
}

async function renderProjectList() {
  elements.projectList.innerHTML = '';

  try {
    const projects = await window.imageRail.listProjects();

    if (projects.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'project-list-empty';
      empty.textContent = '还没有已创建项目。请点击下方按钮选择一个位置创建项目。';
      elements.projectList.appendChild(empty);
      return;
    }

    projects.forEach((project) => {
      elements.projectList.appendChild(createProjectListItem(project));
    });
  } catch (error) {
    const empty = document.createElement('div');
    empty.className = 'project-list-empty';
    empty.textContent = getErrorText(error, '读取项目列表失败');
    elements.projectList.appendChild(empty);
  }
}

function createProjectListItem(project) {
  const item = document.createElement('div');
  const isMissing = project.pathExists === false;
  item.className = `project-list-item${isMissing ? ' project-list-item-missing' : ''}`;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'project-open-button';
  openButton.addEventListener('click', async () => {
    if (isMissing) {
      await rebindProjectFromList(project);
      return;
    }

    try {
      const result = await window.imageRail.openExistingProject({
        projectPath: project.projectPath,
        projectDataFile: project.projectDataFile
      });
      setProject(result.projectPath, result.project);
      closeProjectModal();
    } catch (error) {
      showAppMessage(getErrorText(error, '打开项目失败'));
    }
  });

  const title = document.createElement('strong');
  title.textContent = project.projectName || getFolderName(project.projectPath);

  const meta = document.createElement('span');
  meta.textContent = isMissing
    ? `位置失效 · ${project.trackCount} 条轨道 · ${project.imageCount} 张图片`
    : `${project.trackCount} 条轨道 · ${project.imageCount} 张图片`;

  const pathText = document.createElement('small');
  pathText.textContent = project.imagesFolderName
    ? joinDisplayPath(project.projectPath, project.imagesFolderName)
    : project.projectPath;

  openButton.append(title, meta, pathText);

  const actions = document.createElement('div');
  actions.className = 'project-item-actions';

  const renameProjectButton = createProjectActionButton('重命名项目', () => renameProjectFromList(project));
  const rebindProjectButton = createProjectActionButton('重新绑定', () => rebindProjectFromList(project), 'warning-button');
  const deleteProjectButton = createProjectActionButton('删除项目', () => deleteProjectFromList(project, deleteProjectButton), 'danger-button');
  setInlineConfirmState(deleteProjectButton, state.pendingDeleteProjectPath === project.projectPath);

  actions.append(renameProjectButton);
  if (isMissing) actions.append(rebindProjectButton);
  actions.append(deleteProjectButton);
  item.append(openButton, actions);
  return item;
}

function createProjectActionButton(label, onClick, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `project-action-button ${extraClass}`.trim();
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

async function createProjectFromFolder() {
  const projectName = await askRenameValue({
    title: '创建项目',
    description: '先输入项目名称。ImageRail 会在你接下来选择的位置里创建同名项目文件夹。',
    value: 'ImageRail_Project'
  });
  if (projectName === null) return;

  const cleanProjectName = cleanFilePrefix(projectName);
  if (!cleanProjectName) {
    showAppMessage('项目名称不能为空');
    return;
  }

  const result = await window.imageRail.chooseProjectFolder({
    projectName: cleanProjectName
  });

  if (result) {
    setProject(result.projectPath, result.project);
    closeProjectModal();
  }
}

async function rebindProjectFromList(project) {
  try {
    const result = await window.imageRail.rebindProjectFolder({
      projectDataFile: project.projectDataFile
    });

    if (!result) return;

    setProject(result.projectPath, result.project);
    await renderProjectList();
    closeProjectModal();
  } catch (error) {
    showAppMessage(getErrorText(error, '重新绑定项目位置失败'));
  }
}

async function getProjectForListAction(project) {
  const result = await window.imageRail.openExistingProject({
    projectPath: project.projectPath,
    projectDataFile: project.projectDataFile
  });
  return result.project;
}

async function renameProjectFromList(project) {
  const currentName = project.projectName || getFolderName(project.projectPath);
  const newName = await askRenameValue({
    title: '重命名项目',
    description: '会同时修改 ImageRail 里的项目名称和硬盘上的项目文件夹名称。',
    value: currentName
  });
  if (newName === null) return;

  const cleanName = newName.trim();
  if (!cleanName) {
    showAppMessage('项目名称不能为空');
    return;
  }

  try {
    const fullProject = await getProjectForListAction(project);
    const result = await window.imageRail.renameProject({
      projectPath: project.projectPath,
      project: fullProject,
      newProjectName: cleanName
    });

    if (state.projectPath === project.projectPath) {
      setProjectFromResult(result);
    }

    await renderProjectList();
  } catch (error) {
    showAppMessage(getRenameErrorMessage(error, '重命名项目文件夹失败'));
  }
}

async function deleteProjectFromList(project, button) {
  if (state.pendingDeleteProjectPath !== project.projectPath) {
    markInlineDeleteConfirmation(button, 'project', project.projectPath);
    return;
  }

  try {
    await window.imageRail.deleteProjectRecord({
      projectPath: project.projectPath,
      projectDataFile: project.projectDataFile
    });

    if (state.projectPath === project.projectPath) {
      state.projectPath = '';
      state.project = null;
      state.selectedImageId = '';
      state.pinnedCompareImageId = '';
      render();
    }

    state.pendingDeleteProjectPath = '';
    await renderProjectList();
  } catch (error) {
    state.pendingDeleteProjectPath = '';
    resetInlineDeleteConfirmations();
    showAppMessage(getErrorText(error, '删除项目记录失败'));
  }
}

function render() {
  const hasProject = Boolean(state.projectPath && state.project);
  elements.projectPathText.textContent = hasProject
    ? `${state.project.projectName || getFolderName(state.projectPath)} · ${state.projectPath}`
    : '尚未选择项目文件夹';
  elements.newTrackButton.disabled = !hasProject;
  elements.saveProjectButton.disabled = !hasProject;
  elements.pinCompareButton.disabled = !hasProject || !state.selectedImageId;
  updateCompareZoomButtons();
  elements.pinCompareButton.textContent = state.pinnedCompareImageId ? '取消固定' : '固定对比';
  elements.emptyState.hidden = hasProject && state.project.tracks.length > 0;
  elements.tracks.innerHTML = '';

  if (!hasProject) {
    renderComparePanel();
    return;
  }

  state.project.tracks.forEach((track, trackIndex) => {
    elements.tracks.appendChild(createTrackElement(track, trackIndex));
  });

  renderComparePanel();
}

function createTrackElement(track, trackIndex) {
  const trackElement = document.createElement('article');
  trackElement.className = 'track';
  trackElement.dataset.trackId = track.id;

  const label = document.createElement('div');
  label.className = 'track-label';
  label.draggable = true;
  label.addEventListener('dragstart', (event) => {
    if (event.target.closest('button, input, select, textarea')) {
      event.preventDefault();
      return;
    }

    state.draggedTrackId = track.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-imagerail-track', track.id);
  });
  label.addEventListener('dragend', () => {
    state.draggedTrackId = '';
    document.querySelectorAll('.track.drag-over-track').forEach((item) => item.classList.remove('drag-over-track'));
  });

  const trackName = document.createElement('strong');
  trackName.textContent = track.name;

  const trackMeta = document.createElement('span');
  trackMeta.textContent = `${track.images.length} 张图片 · 文件夹 ${track.folderName || `track_${track.letter || getTrackLetter(trackIndex)}`} · 前缀 ${track.prefix || track.letter || getTrackLetter(trackIndex)}`;

  const renameTrackButton = document.createElement('button');
  renameTrackButton.type = 'button';
  renameTrackButton.className = 'small-button';
  renameTrackButton.textContent = '重命名轨道';
  renameTrackButton.addEventListener('click', () => renameTrack(track.id));

  const renamePrefixButton = document.createElement('button');
  renamePrefixButton.type = 'button';
  renamePrefixButton.className = 'small-button';
  renamePrefixButton.textContent = '重命名前缀';
  renamePrefixButton.addEventListener('click', () => renameTrackPrefix(track.id));

  const deleteTrackButton = document.createElement('button');
  deleteTrackButton.type = 'button';
  deleteTrackButton.className = 'small-button danger-button';
  deleteTrackButton.textContent = '删除轨道';
  setInlineConfirmState(deleteTrackButton, state.pendingDeleteTrackId === track.id);
  deleteTrackButton.addEventListener('click', () => removeTrackRecord(track.id, deleteTrackButton));

  label.append(trackName, trackMeta, renameTrackButton, renamePrefixButton, deleteTrackButton);

  const lane = document.createElement('div');
  lane.className = 'track-lane';
  lane.dataset.trackId = track.id;

  trackElement.addEventListener('dragover', (event) => {
    if (!dataTransferHasType(event.dataTransfer, 'application/x-imagerail-track')) return;
    event.preventDefault();
    trackElement.classList.add('drag-over-track');
  });

  trackElement.addEventListener('dragleave', () => {
    trackElement.classList.remove('drag-over-track');
  });

  trackElement.addEventListener('drop', (event) => {
    const draggedTrackId = event.dataTransfer.getData('application/x-imagerail-track');
    if (!draggedTrackId) return;

    event.preventDefault();
    event.stopPropagation();
    trackElement.classList.remove('drag-over-track');
    reorderTrack(draggedTrackId, track.id, event.offsetY > trackElement.clientHeight / 2);
  });

  lane.addEventListener('dragover', (event) => {
    event.preventDefault();
    lane.classList.add('drag-over');
  });

  lane.addEventListener('dragleave', () => {
    lane.classList.remove('drag-over');
  });

  lane.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    lane.classList.remove('drag-over');
    if (handleImageReorderDrop(event, track.id)) return;
    await handleDrop(event, track.id);
  });

  lane.addEventListener('wheel', (event) => {
    const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;

    if (horizontalDelta === 0) return;

    event.preventDefault();
    event.stopPropagation();
    lane.scrollLeft += horizontalDelta;
  }, { passive: false });

  lane.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showImageContextMenu(event.clientX, event.clientY, track.id, null);
  });

  if (track.images.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'drop-hint';
    hint.textContent = '把图片拖到这里';
    lane.appendChild(hint);
  } else {
    track.images.forEach((image) => {
      lane.appendChild(createImageCard(track.id, image));
    });
  }

  trackElement.append(label, lane);
  return trackElement;
}

function createImageCard(trackId, image) {
  const card = document.createElement('div');
  card.className = `image-card${image.id === state.selectedImageId ? ' selected' : ''}`;
  card.dataset.imageId = image.id;
  card.draggable = true;
  card.addEventListener('dragstart', (event) => {
    if (event.target.closest('textarea, select, .delete-button')) {
      event.preventDefault();
      return;
    }

    state.draggedImage = { trackId, imageId: image.id };
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('application/x-imagerail-image', JSON.stringify(state.draggedImage));
  });
  card.addEventListener('dragend', () => {
    state.draggedImage = null;
    document.querySelectorAll('.image-card.drag-over-image').forEach((item) => item.classList.remove('drag-over-image', 'drag-before', 'drag-after'));
  });
  card.addEventListener('dragover', (event) => {
    if (!dataTransferHasType(event.dataTransfer, 'application/x-imagerail-image')) return;
    event.preventDefault();
    const insertAfter = event.offsetX > card.clientWidth / 2;
    card.classList.toggle('drag-before', !insertAfter);
    card.classList.toggle('drag-after', insertAfter);
    card.classList.add('drag-over-image');
  });
  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over-image', 'drag-before', 'drag-after');
  });
  card.addEventListener('drop', (event) => {
    if (!event.dataTransfer.getData('application/x-imagerail-image')) return;

    event.preventDefault();
    event.stopPropagation();
    const insertAfter = event.offsetX > card.clientWidth / 2;
    card.classList.remove('drag-over-image', 'drag-before', 'drag-after');
    handleImageReorderDrop(event, trackId, image.id, insertAfter);
  });

  const thumbButton = document.createElement('button');
  thumbButton.type = 'button';
  thumbButton.className = 'thumb-button';
  thumbButton.draggable = true;
  thumbButton.addEventListener('click', (event) => {
    event.stopPropagation();
    selectImage(image.id);
    refreshSelectedImageView();
  });

  const img = document.createElement('img');
  img.src = fileUrlFromRelativePath(image.relativePath, imageCacheKey(image));
  img.alt = image.fileName;
  img.draggable = true;
  thumbButton.appendChild(img);
  setupImageFileInteractions(thumbButton, img, trackId, image);

  const body = document.createElement('div');
  body.className = 'card-body';

  const fileName = document.createElement('div');
  fileName.className = 'file-name';
  fileName.textContent = image.fileName;

  const version = document.createElement('div');
  version.className = 'version';
  version.textContent = `版本 ${image.version}`;

  const note = document.createElement('textarea');
  note.placeholder = '备注';
  note.value = image.note || '';
  stopCardClick(note);
  note.addEventListener('input', () => {
    updateImage(trackId, image.id, { note: note.value });
  });

  const status = document.createElement('select');
  STATUS_OPTIONS.forEach((option) => {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    status.appendChild(item);
  });
  status.value = image.status || 'pending';
  stopCardClick(status);
  status.addEventListener('change', () => {
    updateImage(trackId, image.id, { status: status.value });
  });

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete-button';
  deleteButton.textContent = '删除图片';
  setInlineConfirmState(deleteButton, state.pendingDeleteImageId === image.id);
  deleteButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    await deleteImageFile(trackId, image.id, deleteButton);
  });

  actions.append(deleteButton);
  body.append(fileName, version, note, status, actions);
  card.append(thumbButton, body);
  card.addEventListener('click', () => {
    if (state.selectedImageId === image.id) return;
    selectImage(image.id);
    refreshSelectedImageView();
  });

  return card;
}

function findTrack(trackId) {
  return state.project?.tracks.find((item) => item.id === trackId) || null;
}

function dataTransferHasType(dataTransfer, type) {
  return Array.from(dataTransfer?.types || []).includes(type);
}

function moveArrayItem(items, fromIndex, toIndex) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false;
  const [item] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, item);
  return true;
}

function reorderTrack(sourceTrackId, targetTrackId, insertAfter = false) {
  if (!state.project || !sourceTrackId || !targetTrackId || sourceTrackId === targetTrackId) return;

  const tracks = state.project.tracks;
  const sourceIndex = tracks.findIndex((track) => track.id === sourceTrackId);
  let targetIndex = tracks.findIndex((track) => track.id === targetTrackId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  if (insertAfter) targetIndex += 1;
  if (sourceIndex < targetIndex) targetIndex -= 1;
  if (!moveArrayItem(tracks, sourceIndex, targetIndex)) return;

  saveProject({ silent: true });
  render();
}

function getDraggedImageData(event) {
  const raw = event.dataTransfer.getData('application/x-imagerail-image');
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function handleImageReorderDrop(event, targetTrackId, targetImageId = '', insertAfter = true) {
  const draggedImage = getDraggedImageData(event);
  if (!draggedImage) return false;

  const sourceTrack = findTrack(draggedImage.trackId);
  const targetTrack = findTrack(targetTrackId);
  if (!sourceTrack || !targetTrack || sourceTrack.id !== targetTrack.id) {
    showAppMessage('当前版本先支持同一条轨道内的图片排序。跨轨道移动会在后续版本中加入。');
    return true;
  }

  const sourceIndex = sourceTrack.images.findIndex((image) => image.id === draggedImage.imageId);
  let targetIndex = targetImageId
    ? targetTrack.images.findIndex((image) => image.id === targetImageId)
    : targetTrack.images.length - 1;

  if (sourceIndex < 0 || targetIndex < 0) return true;
  if (insertAfter) targetIndex += 1;
  if (sourceIndex < targetIndex) targetIndex -= 1;

  if (!moveArrayItem(targetTrack.images, sourceIndex, targetIndex)) return true;
  saveProject({ silent: true });
  render();
  return true;
}

function setupImageFileInteractions(thumbButton, imageElement, trackId, image) {
  const handleContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    showImageContextMenu(event.clientX, event.clientY, trackId, image);
  };

  const handleDragStart = (event) => {
    if (!state.projectPath || !image.relativePath) {
      event.preventDefault();
      return;
    }

    const fullPath = fullPathFromRelativePath(image.relativePath);
    const fileUri = fileUriFromPath(fullPath);
    const mimeType = imageMimeFromName(image.fileName);

    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', fullPath);
    event.dataTransfer.setData('text/uri-list', fileUri);
    event.dataTransfer.setData('DownloadURL', `${mimeType}:${image.fileName}:${fileUri}`);

    if (imageElement) {
      event.dataTransfer.setDragImage(imageElement, imageElement.width / 2, imageElement.height / 2);
    }
  };

  thumbButton.addEventListener('contextmenu', handleContextMenu);
  imageElement.addEventListener('contextmenu', handleContextMenu);
  thumbButton.addEventListener('dragstart', handleDragStart);
  imageElement.addEventListener('dragstart', handleDragStart);
}

function showImageContextMenu(x, y, trackId, image) {
  if (!elements.contextMenu) return;

  state.contextMenuImage = image;
  state.contextMenuTrackId = trackId;
  elements.renameImageButton.disabled = !image;
  elements.copyPathButton.disabled = !image;
  elements.copyImageButton.disabled = !image;
  elements.revealImageButton.disabled = !image;
  elements.deleteContextImageButton.disabled = !image;
  elements.pasteImageButton.disabled = true;
  elements.contextMenu.hidden = false;
  updatePasteButtonState();

  const menuRect = elements.contextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - menuRect.width - 8);
  const top = Math.min(y, window.innerHeight - menuRect.height - 8);

  elements.contextMenu.style.left = `${Math.max(8, left)}px`;
  elements.contextMenu.style.top = `${Math.max(8, top)}px`;
}

function closeContextMenu() {
  if (!elements.contextMenu) return;
  elements.contextMenu.hidden = true;
  state.contextMenuImage = null;
  state.contextMenuTrackId = '';
}

async function updatePasteButtonState() {
  if (!elements.pasteImageButton || elements.contextMenu.hidden) return;
  elements.pasteImageButton.disabled = !(await clipboardHasImage());
}

async function clipboardHasImage() {
  if (!navigator.clipboard?.read) return false;

  try {
    const items = await navigator.clipboard.read();
    return items.some((item) => item.types.some((type) => type.startsWith('image/')));
  } catch (error) {
    return false;
  }
}

async function readClipboardImage() {
  if (!navigator.clipboard?.read) {
    throw new Error('当前系统不支持读取剪切板图片');
  }

  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith('image/'));
    if (imageType) {
      return {
        blob: await item.getType(imageType),
        mimeType: imageType
      };
    }
  }

  throw new Error('剪切板中没有图片');
}

function fileExtensionFromMime(mimeType) {
  const cleanType = String(mimeType || '').toLowerCase();
  if (cleanType.includes('jpeg')) return '.jpg';
  if (cleanType.includes('webp')) return '.webp';
  if (cleanType.includes('gif')) return '.gif';
  if (cleanType.includes('bmp')) return '.bmp';
  if (cleanType.includes('avif')) return '.avif';
  return '.png';
}

async function copyContextMenuImage() {
  const image = state.contextMenuImage;
  closeContextMenu();

  if (!image) return;

  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    showAppMessage('当前系统不支持复制图片到剪切板');
    return;
  }

  try {
    const response = await fetch(fileUrlFromRelativePath(image.relativePath, imageCacheKey(image)));
    const blob = await response.blob();
    const mimeType = blob.type || imageMimeFromName(image.fileName);
    await navigator.clipboard.write([
      new ClipboardItem({
        [mimeType]: blob
      })
    ]);
  } catch (error) {
    showAppMessage(getErrorText(error, '复制图片失败'));
  }
}

async function renameContextMenuImage() {
  const image = state.contextMenuImage;
  const trackId = state.contextMenuTrackId;
  closeContextMenu();

  if (!image || !trackId) return;

  const currentName = String(image.fileName || '').replace(/\.[^.]+$/, '');
  const newName = await askRenameValue({
    title: '重命名图片',
    description: '会同时重命名硬盘上的图片文件，并更新 ImageRail 里的图片记录。扩展名会自动保留。',
    value: currentName
  });
  if (newName === null) return;

  const cleanName = cleanFilePrefix(newName);
  if (!cleanName) {
    showAppMessage('图片名称不能为空');
    return;
  }

  try {
    const result = await window.imageRail.renameImageFile({
      projectPath: state.projectPath,
      project: state.project,
      trackId,
      imageId: image.id,
      newImageName: cleanName
    });
    setProjectFromResult(result);
  } catch (error) {
    showAppMessage(getRenameErrorMessage(error, '重命名图片文件失败'));
  }
}

async function copyContextMenuImagePath() {
  const image = state.contextMenuImage;
  closeContextMenu();

  if (!image) return;

  try {
    await navigator.clipboard.writeText(fullPathFromRelativePath(image.relativePath));
  } catch (error) {
    showAppMessage(getErrorText(error, '复制文件路径失败'));
  }
}

async function pasteContextMenuImage() {
  const trackId = state.contextMenuTrackId;
  closeContextMenu();

  if (!trackId) return;

  try {
    const clipboardImage = await readClipboardImage();
    const extension = fileExtensionFromMime(clipboardImage.mimeType);
    const result = await window.imageRail.addImageRawFileDataToTrack({
      projectPath: state.projectPath,
      project: state.project,
      trackId,
      fileName: `clipboard_${Date.now()}${extension}`,
      mimeType: clipboardImage.mimeType,
      fileData: await clipboardImage.blob.arrayBuffer()
    });

    state.project = result.project;
    render();
  } catch (error) {
    showAppMessage(getErrorText(error, '粘贴图片失败'));
  }
}

async function deleteContextMenuImage() {
  const image = state.contextMenuImage;
  const trackId = state.contextMenuTrackId;
  closeContextMenu();

  if (!image || !trackId) return;

  try {
    const result = await window.imageRail.deleteImageFile({
      projectPath: state.projectPath,
      project: state.project,
      trackId,
      imageId: image.id
    });
    if (state.selectedImageId === image.id) state.selectedImageId = '';
    if (state.pinnedCompareImageId === image.id) state.pinnedCompareImageId = '';
    setProjectFromResult(result);
  } catch (error) {
    showAppMessage(getRenameErrorMessage(error, '删除图片失败'));
  }
}

async function revealContextMenuImage() {
  const image = state.contextMenuImage;
  closeContextMenu();

  if (!image) return;

  try {
    await window.imageRail.revealImageInFolder({
      projectPath: state.projectPath,
      relativePath: image.relativePath
    });
  } catch (error) {
    showAppMessage(getErrorText(error, '在文件夹中显示图片失败'));
  }
}

function stopCardClick(element) {
  ['click', 'mousedown', 'mouseup', 'dblclick'].forEach((eventName) => {
    element.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  });
}

function setInlineConfirmState(button, isConfirming) {
  button.textContent = isConfirming ? '确定' : button.textContent;
  button.classList.toggle('confirm-delete', isConfirming);
}

function resetInlineDeleteConfirmations(exceptButton) {
  document.querySelectorAll('.confirm-delete').forEach((button) => {
    if (button === exceptButton) return;
    button.classList.remove('confirm-delete');
    if (button.classList.contains('delete-button')) {
      button.textContent = '删除图片';
    } else if (button.classList.contains('project-action-button')) {
      button.textContent = '删除项目';
    } else {
      button.textContent = '删除轨道';
    }
  });
}

function markInlineDeleteConfirmation(button, type, id) {
  resetInlineDeleteConfirmations(button);
  state.pendingDeleteImageId = type === 'image' ? id : '';
  state.pendingDeleteTrackId = type === 'track' ? id : '';
  state.pendingDeleteProjectPath = type === 'project' ? id : '';
  button.textContent = '确定';
  button.classList.add('confirm-delete');
}

async function handleDrop(event, trackId) {
  if (!state.projectPath || !state.project) return;

  const files = Array.from(event.dataTransfer.files || []);
  let importedCount = 0;

  for (const file of files) {
    try {
      const result = file.path
        ? await window.imageRail.addImageToTrack({
            projectPath: state.projectPath,
            project: state.project,
            trackId,
            sourcePath: file.path
          })
        : await window.imageRail.addImageRawFileDataToTrack({
            projectPath: state.projectPath,
            project: state.project,
            trackId,
            fileName: file.name,
            mimeType: file.type,
            fileData: await file.arrayBuffer()
          });

      state.project = result.project;
      importedCount += 1;
    } catch (error) {
      showAppMessage(getErrorText(error, '导入图片失败'));
    }
  }

  if (importedCount === 0 && files.length === 0) {
    const items = Array.from(event.dataTransfer.items || []);
    const fileItems = items.filter((item) => item.kind === 'file');

    for (const item of fileItems) {
      const file = item.getAsFile();
      if (!file) continue;

      try {
        const result = await window.imageRail.addImageRawFileDataToTrack({
          projectPath: state.projectPath,
          project: state.project,
          trackId,
          fileName: file.name,
          mimeType: file.type,
          fileData: await file.arrayBuffer()
        });

        state.project = result.project;
        importedCount += 1;
      } catch (error) {
        showAppMessage(getErrorText(error, '导入图片失败'));
      }
    }
  }

  if (importedCount === 0) {
    const imageUrl = getDraggedImageUrl(event.dataTransfer);

    if (imageUrl) {
      try {
        const result = await window.imageRail.addImageUrlToTrack({
          projectPath: state.projectPath,
          project: state.project,
          trackId,
          url: imageUrl
        });
        state.project = result.project;
        importedCount += 1;
      } catch (error) {
        showAppMessage(getErrorText(error, '从网页导入图片失败'));
      }
    }
  }

  if (importedCount === 0) {
    showAppMessage('没有识别到可导入的图片。请拖入 png、jpg、jpeg、webp、gif、bmp 或 avif 图片。');
  }

  render();
}

function getDraggedImageUrl(dataTransfer) {
  const uriList = dataTransfer.getData('text/uri-list');
  const plainText = dataTransfer.getData('text/plain');
  const html = dataTransfer.getData('text/html');
  const directUrl = [uriList, plainText]
    .flatMap((text) => String(text || '').split(/\r?\n/))
    .map((line) => line.trim())
    .find((line) => /^https?:\/\//i.test(line));

  if (directUrl) return directUrl;

  const match = String(html || '').match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : '';
}

function createTrack() {
  if (!state.project) return;

  const index = state.project.tracks.length;
  const letter = getTrackLetter(index);
  state.project.tracks.push({
    id: makeId('track'),
    letter,
    prefix: letter,
    folderName: `track_${letter}`,
    name: `轨道 ${letter}`,
    images: []
  });

  saveProject();
  render();
}

async function renameTrack(trackId) {
  const track = findTrack(trackId);
  if (!track) return;

  const newName = await askRenameValue({
    title: '重命名轨道',
    description: '会重命名项目文件夹里的轨道文件夹，并更新轨道内图片的保存路径。',
    value: track.name
  });
  if (newName === null) return;

  const cleanName = newName.trim();
  if (!cleanName) {
    showAppMessage('轨道名称不能为空');
    return;
  }

  try {
    const result = await window.imageRail.renameTrackFolder({
      projectPath: state.projectPath,
      project: state.project,
      trackId,
      newTrackName: cleanName
    });
    setProjectFromResult(result);
  } catch (error) {
    showAppMessage(getRenameErrorMessage(error, '重命名轨道文件夹失败'));
  }
}

async function renameTrackPrefix(trackId) {
  const track = findTrack(trackId);
  if (!track) return;

  const currentPrefix = track.prefix || track.letter || 'image';
  const newPrefix = await askRenameValue({
    title: '重命名图片前缀',
    description: '同一条轨道里的图片文件名会一起修改，例如 hero_1.png、hero_2.png。',
    value: currentPrefix
  });
  if (newPrefix === null) return;

  const cleanPrefix = cleanFilePrefix(newPrefix);
  if (!cleanPrefix) {
    showAppMessage('图片名前缀不能为空');
    return;
  }

  try {
    const result = await window.imageRail.renameTrackPrefix({
      projectPath: state.projectPath,
      project: state.project,
      trackId,
      newPrefix: cleanPrefix
    });
    setProjectFromResult(result);
  } catch (error) {
    showAppMessage(getRenameErrorMessage(error, '重命名图片失败'));
  }
}

function askRenameValue({ title, description, value }) {
  return new Promise((resolve) => {
    if (state.renameResolver) {
      state.renameResolver(null);
    }

    state.renameResolver = resolve;
    elements.renameTitle.textContent = title;
    elements.renameDescription.textContent = description;
    elements.renameInput.value = value || '';
    elements.renameModal.hidden = false;

    window.setTimeout(() => {
      elements.renameInput.focus();
      elements.renameInput.select();
    }, 0);
  });
}

function closeRenameModal(value) {
  elements.renameModal.hidden = true;

  if (state.renameResolver) {
    const resolve = state.renameResolver;
    state.renameResolver = null;
    resolve(value);
  }
}

function updateImage(trackId, imageId, patch) {
  const track = findTrack(trackId);
  if (!track) return;

  const image = track.images.find((item) => item.id === imageId);
  if (!image) return;

  Object.assign(image, patch);
  saveProject({ silent: true });
  renderComparePanel();
}

async function deleteImageFile(trackId, imageId, button) {
  const track = findTrack(trackId);
  if (!track) return;

  const image = track.images.find((item) => item.id === imageId);
  if (!image) return;

  if (state.pendingDeleteImageId !== imageId) {
    markInlineDeleteConfirmation(button, 'image', imageId);
    return;
  }

  try {
    const result = await window.imageRail.deleteImageFile({
      projectPath: state.projectPath,
      project: state.project,
      trackId,
      imageId
    });
    state.pendingDeleteImageId = '';
    state.pendingDeleteTrackId = '';
    state.pendingDeleteProjectPath = '';
    setProjectFromResult(result);
    if (state.selectedImageId === imageId) state.selectedImageId = '';
    if (state.pinnedCompareImageId === imageId) state.pinnedCompareImageId = '';
    render();
  } catch (error) {
    state.pendingDeleteImageId = '';
    state.pendingDeleteTrackId = '';
    state.pendingDeleteProjectPath = '';
    resetInlineDeleteConfirmations();
    showAppMessage(getRenameErrorMessage(error, '删除图片失败'));
  }
}

async function removeTrackRecord(trackId, button) {
  const track = findTrack(trackId);
  if (!track) return;

  if (state.pendingDeleteTrackId !== trackId) {
    markInlineDeleteConfirmation(button, 'track', trackId);
    return;
  }

  const removedImageIds = new Set(track.images.map((image) => image.id));
  try {
    if (removedImageIds.has(state.selectedImageId)) {
      state.selectedImageId = '';
    }

    if (removedImageIds.has(state.pinnedCompareImageId)) {
      state.pinnedCompareImageId = '';
    }

    const result = await window.imageRail.deleteTrackFolder({
      projectPath: state.projectPath,
      project: state.project,
      trackId
    });
    state.pendingDeleteImageId = '';
    state.pendingDeleteTrackId = '';
    state.pendingDeleteProjectPath = '';
    setProjectFromResult(result);
  } catch (error) {
    state.pendingDeleteImageId = '';
    state.pendingDeleteTrackId = '';
    state.pendingDeleteProjectPath = '';
    resetInlineDeleteConfirmations();
    showAppMessage(getRenameErrorMessage(error, '删除轨道文件夹失败'));
  }
}

async function saveProject(options = {}) {
  if (!state.projectPath || !state.project) return;

  try {
    const result = await window.imageRail.saveProject({
      projectPath: state.projectPath,
      project: state.project
    });
    state.project = result.project;
    if (!options.silent) render();
  } catch (error) {
    showAppMessage(getErrorText(error, '保存失败'));
  }
}

function findSelectedImage() {
  return findImageById(state.selectedImageId);
}

function findImageById(imageId) {
  if (!state.project || !imageId) return null;

  for (const track of state.project.tracks) {
    const image = track.images.find((item) => item.id === imageId);
    if (image) return { track, image };
  }

  return null;
}

function selectImage(imageId) {
  state.selectedImageId = imageId;
  state.pendingDeleteImageId = '';
  state.pendingDeleteTrackId = '';
  state.pendingDeleteProjectPath = '';
  resetInlineDeleteConfirmations();
}

function refreshSelectedImageView() {
  document.querySelectorAll('.image-card.selected').forEach((card) => {
    card.classList.remove('selected');
  });

  if (state.selectedImageId) {
    document.querySelectorAll(`.image-card[data-image-id="${CSS.escape(state.selectedImageId)}"]`).forEach((card) => {
      card.classList.add('selected');
    });
  }

  const hasProject = Boolean(state.projectPath && state.project);
  elements.pinCompareButton.disabled = !hasProject || !state.selectedImageId;
  renderComparePanel();
}

function togglePinnedCompareImage() {
  if (!state.selectedImageId) return;

  state.pinnedCompareImageId = state.pinnedCompareImageId ? '' : state.selectedImageId;
  render();
}

function changeViewportZoom(viewport, delta) {
  if (!viewport) return;
  const nextZoom = Number((getViewportZoom(viewport) + delta).toFixed(2));
  setViewportZoom(viewport, nextZoom);
}

function changeActiveCompareZoom(delta) {
  const viewport = getActiveCompareViewport();
  activateCompareViewport(viewport);
  changeViewportZoom(viewport, delta);
}

function renderComparePanel() {
  const selected = findSelectedImage();
  const pinned = findImageById(state.pinnedCompareImageId);

  elements.compareContent.innerHTML = '';

  if (!selected) {
    elements.compareContent.className = 'compare-empty';
    elements.compareContent.textContent = state.projectPath
      ? '点击任意图片卡片后，这里会显示大图。'
      : '选择项目文件夹并点击图片后，这里会显示大图。';
    return;
  }

  elements.compareContent.className = pinned ? 'compare-stack' : 'compare-single';

  if (pinned) {
    elements.compareContent.appendChild(createComparePane('固定图', pinned));
    elements.compareContent.appendChild(createComparePane('当前图', selected));
    updateCompareZoomButtons();
    return;
  }

  elements.compareContent.appendChild(createComparePane('当前图', selected));
  updateCompareZoomButtons();
}

function createComparePane(label, item) {
  const pane = document.createElement('section');
  pane.className = `compare-pane ${label === '固定图' ? 'compare-pane-pinned' : 'compare-pane-current'}`;

  const archiveTag = document.createElement('div');
  archiveTag.className = 'compare-archive-tag';
  archiveTag.textContent = `${label} / ${item.track.name}`;

  const sideMarker = document.createElement('div');
  sideMarker.className = 'compare-side-marker';
  sideMarker.innerHTML = `<strong>${label === '固定图' ? '01' : '02'}</strong><span>${escapeHtml(label)}</span>`;

  const imageButton = document.createElement('button');
  imageButton.type = 'button';
  imageButton.className = 'compare-image-button';
  imageButton.dataset.zoom = '1';
  imageButton.style.setProperty('--compare-zoom', '1');
  imageButton.addEventListener('dblclick', () => openPreview(item.image));
  setupCompareImagePanZoom(imageButton);

  const imageStage = document.createElement('div');
  imageStage.className = 'compare-image-stage';

  const image = document.createElement('img');
  image.src = fileUrlFromRelativePath(item.image.relativePath, imageCacheKey(item.image));
  image.alt = item.image.fileName;
  image.draggable = false;
  imageStage.appendChild(image);
  imageButton.appendChild(imageStage);

  const caption = document.createElement('div');
  caption.className = 'compare-caption';
  const statusLabel = STATUS_OPTIONS.find((option) => option.value === item.image.status)?.label || '待定';
  caption.innerHTML = `
    <div class="compare-info-card compare-info-card-small">
      <strong>状态</strong>
      <span>${escapeHtml(statusLabel)}</span>
    </div>
    <div class="compare-info-card">
      <strong>文件</strong>
      <span>${escapeHtml(item.image.fileName)}</span>
      <em>${escapeHtml(item.track.name)} / 版本 ${escapeHtml(item.image.version)}</em>
    </div>
  `;

  pane.append(archiveTag, sideMarker, imageButton, caption);
  return pane;
}

function setupCompareImagePanZoom(viewport) {
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let panX = 0;
  let panY = 0;

  const applyPan = () => {
    viewport.style.setProperty('--pan-x', `${panX}px`);
    viewport.style.setProperty('--pan-y', `${panY}px`);
  };

  applyPan();

  viewport.addEventListener('dragstart', (event) => {
    event.preventDefault();
  });

  viewport.addEventListener('wheel', (event) => {
    if (!state.selectedImageId) return;
    event.preventDefault();

    const direction = event.deltaY > 0 ? -1 : 1;

    activateCompareViewport(viewport);
    changeViewportZoom(viewport, direction * COMPARE_ZOOM_STEP);
  }, { passive: false });

  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activateCompareViewport(viewport);
    isDragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    viewport.classList.add('dragging');
    viewport.setPointerCapture(event.pointerId);
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!isDragging) return;
    event.preventDefault();
    panX += event.clientX - lastX;
    panY += event.clientY - lastY;
    applyPan();
    lastX = event.clientX;
    lastY = event.clientY;
  });

  const stopDragging = (event) => {
    if (!isDragging) return;
    isDragging = false;
    viewport.classList.remove('dragging');
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  };

  viewport.addEventListener('pointerup', stopDragging);
  viewport.addEventListener('pointercancel', stopDragging);
  viewport.addEventListener('mouseenter', () => activateCompareViewport(viewport));
}

function openPreview(image) {
  elements.previewImage.src = fileUrlFromRelativePath(image.relativePath, imageCacheKey(image));
  elements.previewModal.hidden = false;
}

function closePreview() {
  elements.previewModal.hidden = true;
  elements.previewImage.src = '';
}

function getRenameErrorMessage(error, fallbackMessage) {
  const message = getErrorText(error, '');

  if (
    message.includes('EBUSY') ||
    message.includes('EPERM') ||
    message.includes('EACCES') ||
    message.includes('拒绝访问') ||
    message.toLowerCase().includes('access is denied')
  ) {
    return `${fallbackMessage}。\n\n项目文件夹可能已经被打开或正在被其他软件占用。请关闭资源管理器、图片查看器、Photoshop、ComfyUI 等正在使用这个项目文件夹的窗口，然后再重命名。`;
  }

  if (message.includes('Already exists') || message.includes('EEXIST')) {
    return `${fallbackMessage}。\n\n目标名称已经存在。请换一个没有被使用的名称。`;
  }

  if (message.includes('ENOENT')) {
    return `${fallbackMessage}。\n\n没有找到原文件或文件夹。可能它已经被手动移动、删除或改名了。请重新选择项目文件夹后再试。`;
  }

  return `${fallbackMessage}。\n\n${message || '请关闭可能占用文件的窗口后再试。'}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getFolderName(folderPath) {
  return String(folderPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || 'image';
}

function joinDisplayPath(...parts) {
  return parts
    .filter(Boolean)
    .join('\\')
    .replace(/\\+/g, '\\');
}

function cleanFilePrefix(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function setupCompareResizer() {
  if (!elements.compareResizer) return;

  let startX = 0;
  let startWidth = state.comparePanelWidth;

  const stopResize = () => {
    document.body.classList.remove('resizing-compare');
    window.removeEventListener('pointermove', resize);
    window.removeEventListener('pointerup', stopResize);
  };

  const resize = (event) => {
    const delta = startX - event.clientX;
    state.comparePanelWidth = clamp(startWidth + delta, COMPARE_MIN_WIDTH, COMPARE_MAX_WIDTH);
    applyComparePanelWidth();
  };

  elements.compareResizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startX = event.clientX;
    startWidth = state.comparePanelWidth;
    document.body.classList.add('resizing-compare');
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
  });
}

function setupWindowFrame() {
  const dragRegions = document.querySelectorAll('.topbar, .window-drag-strip');
  if (!dragRegions.length) return;

  dragRegions.forEach((region) => {
    region.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('button, input, select, textarea')) return;
      window.imageRail?.startWindowDrag?.()?.catch(() => {});
    });

    region.addEventListener('dblclick', (event) => {
      if (event.target.closest('button, input, select, textarea')) return;
      window.imageRail?.toggleMaximizeWindow?.()?.catch(() => {});
    });
  });
}

applyComparePanelWidth();
updateCompareZoomButtons();
setupCompareResizer();
setupWindowFrame();

elements.chooseProjectButton.addEventListener('click', openProjectModal);
elements.createProjectButton.addEventListener('click', createProjectFromFolder);
elements.closeProjectModalButton.addEventListener('click', closeProjectModal);
elements.projectModal.addEventListener('click', (event) => {
  if (event.target === elements.projectModal) closeProjectModal();
});
elements.newTrackButton.addEventListener('click', createTrack);
elements.saveProjectButton.addEventListener('click', () => saveProject());
elements.pinCompareButton.addEventListener('click', togglePinnedCompareImage);
elements.zoomInButton.addEventListener('click', () => changeActiveCompareZoom(COMPARE_ZOOM_STEP));
elements.zoomOutButton.addEventListener('click', () => changeActiveCompareZoom(-COMPARE_ZOOM_STEP));
elements.minimizeWindowButton.addEventListener('click', () => window.imageRail?.minimizeWindow?.());
elements.maximizeWindowButton.addEventListener('click', () => window.imageRail?.toggleMaximizeWindow?.());
elements.closeWindowButton.addEventListener('click', () => window.imageRail?.closeWindow?.());
elements.closePreviewButton.addEventListener('click', closePreview);
elements.previewModal.addEventListener('click', (event) => {
  if (event.target === elements.previewModal) closePreview();
});
elements.renameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  closeRenameModal(elements.renameInput.value);
});
elements.cancelRenameButton.addEventListener('click', () => closeRenameModal(null));
elements.renameModal.addEventListener('click', (event) => {
  if (event.target === elements.renameModal) closeRenameModal(null);
});
elements.appMessageCloseButton.addEventListener('click', closeAppMessage);
elements.appMessage.addEventListener('click', (event) => {
  if (event.target === elements.appMessage) closeAppMessage();
});
elements.renameImageButton.addEventListener('click', renameContextMenuImage);
elements.copyPathButton.addEventListener('click', copyContextMenuImagePath);
elements.copyImageButton.addEventListener('click', copyContextMenuImage);
elements.pasteImageButton.addEventListener('click', pasteContextMenuImage);
elements.revealImageButton.addEventListener('click', revealContextMenuImage);
elements.deleteContextImageButton.addEventListener('click', deleteContextMenuImage);
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  closeContextMenu();
});
document.addEventListener('pointerdown', (event) => {
  if (!elements.contextMenu.hidden && !event.target.closest('.context-menu')) {
    closeContextMenu();
  }
});
window.addEventListener('blur', closeContextMenu);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.contextMenu.hidden) {
    closeContextMenu();
  }

  if (event.key === 'Escape' && !elements.appMessage.hidden) {
    closeAppMessage();
  }

  if (event.key === 'Escape' && !elements.renameModal.hidden) {
    closeRenameModal(null);
  }

  if (event.key === 'Escape' && !elements.projectModal.hidden) {
    closeProjectModal();
  }
});

render();
