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
const MAX_RAW_IMAGE_BYTES = 100 * 1024 * 1024;

const state = {
  projectPath: '',
  project: null,
  selectedImageId: '',
  pinnedCompareImageId: '',
  compareMode: 'single',
  syncComparePan: false,
  syncCompareZoom: false,
  renameResolver: null,
  pendingDelete: { type: '', id: '' },
  contextMenuImage: null,
  contextMenuTrackId: '',
  trackDropIndicatorElement: null,
  trackDropIndicatorAfter: false,
  draggedImage: null,
  draggedExportImage: false,
  imageDropIndicatorCard: null,
  imageDropIndicatorAfter: false,
  trackScrollPositions: {},
  tracksToScrollEnd: new Set(),
  undoEntry: null,
  undoInProgress: false,
  closeInProgress: false,
  compareNoteUndo: null,
  projectOperationPromise: Promise.resolve(),
  savePromise: Promise.resolve(),
  pendingSaveTimer: null,
  activeCompareViewport: null,
  comparePanelWidth: Number(localStorage.getItem(COMPARE_WIDTH_STORAGE_KEY)) || 390
};

const elements = {
  projectPathText: document.querySelector('#projectPathText'),
  undoButton: document.querySelector('#undoButton'),
  chooseProjectButton: document.querySelector('#chooseProjectButton'),
  newTrackButton: document.querySelector('#newTrackButton'),
  scrollBoardTopButton: document.querySelector('#scrollBoardTopButton'),
  scrollBoardBottomButton: document.querySelector('#scrollBoardBottomButton'),
  railBoard: document.querySelector('.rail-board'),
  emptyState: document.querySelector('#emptyState'),
  tracks: document.querySelector('#tracks'),
  compareContent: document.querySelector('#compareContent'),
  compareDetails: document.querySelector('#compareDetails'),
  compareDimensionsText: document.querySelector('#compareDimensionsText'),
  compareSizeText: document.querySelector('#compareSizeText'),
  compareNoteInput: document.querySelector('#compareNoteInput'),
  compareRevealButton: document.querySelector('#compareRevealButton'),
  comparePanel: document.querySelector('.compare-panel'),
  compareResizer: document.querySelector('#compareResizer'),
  compareViewButton: document.querySelector('#compareViewButton'),
  zoomInButton: document.querySelector('#zoomInButton'),
  zoomOutButton: document.querySelector('#zoomOutButton'),
  syncPanButton: document.querySelector('#syncPanButton'),
  syncZoomButton: document.querySelector('#syncZoomButton'),
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

function getCompareViewports() {
  return [...document.querySelectorAll('.compare-image-button')];
}

function getViewportZoom(viewport) {
  return Number(viewport?.dataset.zoom) || 1;
}

function applyViewportZoom(viewport, zoom) {
  const cleanZoom = clamp(zoom, COMPARE_ZOOM_MIN, COMPARE_ZOOM_MAX);
  viewport.dataset.zoom = String(cleanZoom);
  viewport.style.setProperty('--compare-zoom', String(cleanZoom));
  viewport.classList.toggle('zoomed', cleanZoom !== 1);
}

function setViewportZoom(viewport, zoom) {
  if (!viewport) return;
  const targets = state.compareMode === 'compare' && state.syncCompareZoom
    ? getCompareViewports()
    : [viewport];

  targets.forEach((target) => applyViewportZoom(target, zoom));
  updateCompareZoomButtons();
}

function getViewportPan(viewport) {
  return {
    x: Number(viewport?.dataset.panX) || 0,
    y: Number(viewport?.dataset.panY) || 0
  };
}

function applyViewportPan(viewport, x, y) {
  viewport.dataset.panX = String(x);
  viewport.dataset.panY = String(y);
  viewport.style.setProperty('--pan-x', `${x}px`);
  viewport.style.setProperty('--pan-y', `${y}px`);
}

function activateCompareViewport(viewport) {
  state.activeCompareViewport = viewport;
  updateCompareZoomButtons();
}

function updateCompareZoomButtons() {
  const viewport = getActiveCompareViewport();
  const zoom = getViewportZoom(viewport);
  const disabled = state.compareMode === 'compare' || !state.selectedImageId || !viewport;
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

function formatFileSize(sizeBytes) {
  const bytes = Number(sizeBytes);
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function setProject(projectPath, project) {
  state.projectPath = projectPath;
  state.project = project;
  state.project.projectName = state.project.projectName || getFolderName(projectPath);
  state.project.imagesFolderName = state.project.imagesFolderName || '';
  state.selectedImageId = '';
  state.pinnedCompareImageId = '';
  state.compareMode = 'single';
  state.syncComparePan = false;
  state.syncCompareZoom = false;
  clearPendingDelete();
  state.undoEntry = null;
  render();
}

function cloneProject(project = state.project) {
  return project ? JSON.parse(JSON.stringify(project)) : null;
}

function enqueueProjectOperation(operation) {
  const task = state.projectOperationPromise
    .catch(() => {})
    .then(operation);
  state.projectOperationPromise = task;
  return task;
}

function enqueueCurrentProjectOperation(projectPath, operation) {
  return enqueueProjectOperation(() => {
    if (!state.project || state.projectPath !== projectPath) {
      throw new Error('项目已经切换，已取消刚才的操作');
    }
    return operation();
  });
}

function scheduleProjectSave(options = {}) {
  if (state.pendingSaveTimer) window.clearTimeout(state.pendingSaveTimer);
  const projectPath = state.projectPath;
  state.pendingSaveTimer = window.setTimeout(() => {
    state.pendingSaveTimer = null;
    if (state.projectPath === projectPath) saveProject(options);
  }, 280);
}

function flushScheduledProjectSave() {
  if (state.pendingSaveTimer) {
    window.clearTimeout(state.pendingSaveTimer);
    state.pendingSaveTimer = null;
    return saveProject({ silent: true });
  }
  return Promise.resolve();
}

async function waitForProjectOperations() {
  await flushScheduledProjectSave();
  await state.projectOperationPromise.catch(() => {});
}

async function closeApplication() {
  if (state.closeInProgress) return;
  state.closeInProgress = true;

  try {
    await waitForProjectOperations();
    await window.imageRail?.closeWindow?.();
  } catch (error) {
    state.closeInProgress = false;
    showAppMessage(getErrorText(error, '关闭应用失败'));
  }
}

function captureUndo(label, options = {}) {
  if (!state.project || !state.projectPath) return null;
  return {
    label,
    projectPath: state.projectPath,
    project: cloneProject(),
    preserveTrash: options.preserveTrash === true
  };
}

function commitUndo(entry) {
  if (!entry) return;
  state.undoEntry = entry;
  updateUndoButton();

  if (!entry.preserveTrash && window.imageRail?.clearUndoTrash) {
    enqueueProjectOperation(() => window.imageRail.clearUndoTrash({
      projectPath: entry.projectPath
    })).catch((error) => {
      showAppMessage(getErrorText(error, '清理旧撤回文件失败'));
    });
  }
}

function updateUndoButton() {
  const available = Boolean(state.undoEntry && state.project && !state.undoInProgress);
  elements.undoButton.disabled = !available;
  elements.undoButton.title = available
    ? `撤回：${state.undoEntry.label}（Ctrl+Z）`
    : '没有可以撤回的操作（Ctrl+Z）';
}

async function undoLastAction() {
  const entry = state.undoEntry;
  if (!entry || !state.project || state.undoInProgress) return;
  if (entry.projectPath !== state.projectPath) {
    state.undoEntry = null;
    updateUndoButton();
    return;
  }

  state.undoInProgress = true;
  updateUndoButton();
  try {
    await enqueueCurrentProjectOperation(entry.projectPath, async () => {
      const result = await window.imageRail.restoreProject({
        projectPath: state.projectPath,
        currentProject: cloneProject(),
        previousProject: entry.project
      });
      state.undoEntry = null;
      state.projectPath = result.projectPath || state.projectPath;
      state.project = result.project;
      state.selectedImageId = findImageById(state.selectedImageId) ? state.selectedImageId : '';
      state.pinnedCompareImageId = findImageById(state.pinnedCompareImageId) ? state.pinnedCompareImageId : '';
      render();
    });
  } catch (error) {
    showAppMessage(getErrorText(error, `撤回“${entry.label}”失败`));
  } finally {
    state.undoInProgress = false;
    updateUndoButton();
  }
}

function setProjectFromResult(result) {
  state.projectPath = result.projectPath || state.projectPath;
  state.project = result.project;
  render();
}

async function openProjectModal() {
  elements.projectModal.hidden = false;
  await waitForProjectOperations();
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
      await waitForProjectOperations();
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
  setInlineConfirmState(deleteProjectButton, isPendingDelete('project', project.projectPath));

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

  try {
    await waitForProjectOperations();
    const result = await window.imageRail.chooseProjectFolder({
      projectName: cleanProjectName
    });

    if (result) {
      setProject(result.projectPath, result.project);
      closeProjectModal();
    }
  } catch (error) {
    showAppMessage(getErrorText(error, '创建项目失败'));
  }
}

async function rebindProjectFromList(project) {
  try {
    await waitForProjectOperations();
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
    await enqueueProjectOperation(async () => {
      const fullProject = await getProjectForListAction(project);
      const result = await window.imageRail.renameProject({
        projectPath: project.projectPath,
        project: fullProject,
        newProjectName: cleanName
      });

      if (state.projectPath === project.projectPath) {
        setProjectFromResult(result);
      }
    });

    await renderProjectList();
  } catch (error) {
    showAppMessage(getRenameErrorMessage(error, '重命名项目文件夹失败'));
  }
}

async function deleteProjectFromList(project, button) {
  if (!isPendingDelete('project', project.projectPath)) {
    markInlineDeleteConfirmation(button, 'project', project.projectPath);
    return;
  }

  try {
    await enqueueProjectOperation(async () => {
      await window.imageRail.deleteProjectRecord({
        projectPath: project.projectPath,
        projectDataFile: project.projectDataFile
      });

      if (state.projectPath === project.projectPath) {
        state.projectPath = '';
        state.project = null;
        state.selectedImageId = '';
        state.pinnedCompareImageId = '';
        state.compareMode = 'single';
        state.syncComparePan = false;
        state.syncCompareZoom = false;
        render();
      }
    });

    clearPendingDelete();
    await renderProjectList();
  } catch (error) {
    clearPendingDelete();
    resetInlineDeleteConfirmations();
    showAppMessage(getErrorText(error, '删除项目记录失败'));
  }
}

function render() {
  rememberTrackScrollPositions();

  const hasProject = Boolean(state.projectPath && state.project);
  elements.projectPathText.textContent = hasProject
    ? `${state.project.projectName || getFolderName(state.projectPath)} · ${state.projectPath}`
    : '尚未选择项目文件夹';
  elements.newTrackButton.disabled = !hasProject;
  updateUndoButton();
  updateCompareModeButtons();
  updateCompareZoomButtons();
  elements.emptyState.hidden = hasProject && state.project.tracks.length > 0;

  if (!hasProject) {
    elements.tracks.replaceChildren();
    renderComparePanel();
    updateBoardNavigationButtons();
    return;
  }

  reconcileTracks();
  restoreTrackScrollPositions();
  renderComparePanel();
  requestAnimationFrame(updateBoardNavigationButtons);
}

function updateBoardNavigationButtons() {
  const board = elements.railBoard;
  if (!board) return;
  const hasProject = Boolean(state.projectPath && state.project);
  const maxScrollTop = Math.max(0, board.scrollHeight - board.clientHeight);
  elements.scrollBoardTopButton.disabled = !hasProject || board.scrollTop <= 1;
  elements.scrollBoardBottomButton.disabled = !hasProject || board.scrollTop >= maxScrollTop - 1;
}

function imageCardRenderKey(trackId, image) {
  return [
    trackId,
    image.id,
    image.fileName,
    image.relativePath,
    image.version,
    image.note,
    image.status,
    image.createdAt
  ].join('|');
}

function reconcileTrackImages(trackElement, track) {
  const lane = trackElement.querySelector('.track-lane');
  if (!lane) return;

  const desiredImageIds = new Set(track.images.map((image) => image.id));
  lane.querySelectorAll('.image-card[data-image-id]').forEach((card) => {
    if (!desiredImageIds.has(card.dataset.imageId)) card.remove();
  });

  const hint = lane.querySelector('.drop-hint');
  if (track.images.length === 0) {
    if (!hint) {
      const nextHint = document.createElement('div');
      nextHint.className = 'drop-hint';
      nextHint.textContent = '把图片拖到这里';
      lane.appendChild(nextHint);
    }
    return;
  }

  hint?.remove();
  track.images.forEach((image, imageIndex) => {
    const key = imageCardRenderKey(track.id, image);
    let card = lane.querySelector(`.image-card[data-image-id="${CSS.escape(image.id)}"]`);
    if (!card || card.dataset.renderKey !== key) {
      const replacement = createImageCard(track.id, image);
      if (card) card.replaceWith(replacement);
      card = replacement;
    }
    card.classList.toggle('selected', image.id === state.selectedImageId);
    const cardAtTargetIndex = lane.children[imageIndex] || null;
    if (card !== cardAtTargetIndex) lane.insertBefore(card, cardAtTargetIndex);
  });
}

function reconcileTracks() {
  const desiredTrackIds = new Set(state.project.tracks.map((track) => track.id));
  elements.tracks.querySelectorAll('.track[data-track-id]').forEach((trackElement) => {
    if (!desiredTrackIds.has(trackElement.dataset.trackId)) trackElement.remove();
  });

  state.project.tracks.forEach((track, trackIndex) => {
    let trackElement = elements.tracks.querySelector(`.track[data-track-id="${CSS.escape(track.id)}"]`);
    if (!trackElement) {
      trackElement = createTrackElement(track, trackIndex);
    } else {
      trackElement.classList.toggle('collapsed', Boolean(track.collapsed));
      const label = trackElement.querySelector('.track-label');
      const name = label?.querySelector('strong');
      const meta = label?.querySelector('span');
      const deleteButton = label?.querySelector('.danger-button');
      const collapseButton = label?.querySelector('.track-collapse-button');
      if (name) name.textContent = track.name;
      if (meta) {
        meta.textContent = `${track.images.length} 张图片 · 文件夹 ${track.folderName || `track_${track.letter || getTrackLetter(trackIndex)}`} · 前缀 ${track.prefix || track.letter || getTrackLetter(trackIndex)}`;
      }
      if (deleteButton) setInlineConfirmState(deleteButton, isPendingDelete('track', track.id));
      if (collapseButton) updateTrackCollapseButton(collapseButton, Boolean(track.collapsed));
      reconcileTrackImages(trackElement, track);
    }
    const trackAtTargetIndex = elements.tracks.children[trackIndex] || null;
    if (trackElement !== trackAtTargetIndex) {
      elements.tracks.insertBefore(trackElement, trackAtTargetIndex);
    }
  });
}

function rememberTrackScrollPositions() {
  document.querySelectorAll('.track-lane[data-track-id]').forEach((lane) => {
    state.trackScrollPositions[lane.dataset.trackId] = lane.scrollLeft;
  });
}

function restoreTrackScrollPositions() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.track-lane[data-track-id]').forEach((lane) => {
        const trackId = lane.dataset.trackId;

        if (state.tracksToScrollEnd.has(trackId)) {
          lane.scrollLeft = lane.scrollWidth;
          state.trackScrollPositions[trackId] = lane.scrollLeft;
          updateTrackNavigationButtons(lane);
          window.setTimeout(() => {
            if (!state.tracksToScrollEnd.has(trackId)) return;
            const currentLane = elements.tracks.querySelector(`.track-lane[data-track-id="${CSS.escape(trackId)}"]`);
            if (currentLane) {
              currentLane.scrollLeft = currentLane.scrollWidth;
              state.trackScrollPositions[trackId] = currentLane.scrollLeft;
              updateTrackNavigationButtons(currentLane);
            }
            state.tracksToScrollEnd.delete(trackId);
          }, 120);
          return;
        }

        lane.scrollLeft = state.trackScrollPositions[trackId] || 0;
        updateTrackNavigationButtons(lane);
      });
    });
  });
}

function updateTrackNavigationButtons(lane) {
  if (!lane) return;
  const trackElement = lane.closest('.track');
  const leftButton = trackElement?.querySelector('[data-track-scroll="left"]');
  const rightButton = trackElement?.querySelector('[data-track-scroll="right"]');
  const maxScrollLeft = Math.max(0, lane.scrollWidth - lane.clientWidth);
  if (leftButton) leftButton.disabled = lane.scrollLeft <= 1;
  if (rightButton) rightButton.disabled = lane.scrollLeft >= maxScrollLeft - 1;
}

function updateTrackCollapseButton(button, collapsed) {
  button.textContent = collapsed ? '▾' : '▴';
  button.title = collapsed ? '展开轨道' : '折叠轨道';
  button.setAttribute('aria-label', button.title);
}

function toggleTrackCollapsed(trackId) {
  const track = findTrack(trackId);
  if (!track) return;

  const undo = captureUndo(track.collapsed ? '展开轨道' : '折叠轨道');
  track.collapsed = !track.collapsed;
  saveProject({ silent: true });
  commitUndo(undo);
  render();
}

function createTrackElement(track, trackIndex) {
  const trackElement = document.createElement('article');
  trackElement.className = `track${track.collapsed ? ' collapsed' : ''}`;
  trackElement.dataset.trackId = track.id;

  const label = document.createElement('div');
  label.className = 'track-label';
  label.draggable = true;
  label.addEventListener('dragstart', (event) => {
    if (event.target.closest('button, input, select, textarea')) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-imagerail-track', track.id);
  });
  label.addEventListener('dragend', () => {
    clearTrackDropIndicator();
  });

  const trackName = document.createElement('strong');
  trackName.textContent = track.name;

  const collapseTrackButton = document.createElement('button');
  collapseTrackButton.type = 'button';
  collapseTrackButton.className = 'track-collapse-button';
  updateTrackCollapseButton(collapseTrackButton, Boolean(track.collapsed));
  collapseTrackButton.addEventListener('click', () => toggleTrackCollapsed(track.id));

  const trackTitleRow = document.createElement('div');
  trackTitleRow.className = 'track-title-row';
  trackTitleRow.append(trackName, collapseTrackButton);

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
  setInlineConfirmState(deleteTrackButton, isPendingDelete('track', track.id));
  deleteTrackButton.addEventListener('click', () => removeTrackRecord(track.id, deleteTrackButton));

  const lane = document.createElement('div');
  lane.className = 'track-lane';
  lane.dataset.trackId = track.id;

  const trackNavigation = document.createElement('div');
  trackNavigation.className = 'track-navigation';

  const scrollLeftButton = document.createElement('button');
  scrollLeftButton.type = 'button';
  scrollLeftButton.className = 'small-button track-navigation-button';
  scrollLeftButton.dataset.trackScroll = 'left';
  scrollLeftButton.textContent = '←';
  scrollLeftButton.title = '移动到轨道最左侧';
  scrollLeftButton.setAttribute('aria-label', '移动到轨道最左侧');
  scrollLeftButton.addEventListener('click', () => {
    lane.scrollTo({ left: 0, behavior: 'smooth' });
  });

  const scrollRightButton = document.createElement('button');
  scrollRightButton.type = 'button';
  scrollRightButton.className = 'small-button track-navigation-button';
  scrollRightButton.dataset.trackScroll = 'right';
  scrollRightButton.textContent = '→';
  scrollRightButton.title = '移动到轨道最右侧';
  scrollRightButton.setAttribute('aria-label', '移动到轨道最右侧');
  scrollRightButton.addEventListener('click', () => {
    lane.scrollTo({ left: lane.scrollWidth, behavior: 'smooth' });
  });

  trackNavigation.append(scrollLeftButton, scrollRightButton);
  label.append(trackTitleRow, trackMeta, renameTrackButton, renamePrefixButton, deleteTrackButton, trackNavigation);

  trackElement.addEventListener('dragover', (event) => {
    if (!dataTransferHasType(event.dataTransfer, 'application/x-imagerail-track')) return;
    event.preventDefault();
    const rect = trackElement.getBoundingClientRect();
    setTrackDropIndicator(trackElement, event.clientY > rect.top + rect.height / 2);
  });

  trackElement.addEventListener('dragleave', (event) => {
    if (trackElement.contains(event.relatedTarget)) return;
    clearTrackDropIndicator(trackElement);
  });

  trackElement.addEventListener('drop', (event) => {
    const draggedTrackId = event.dataTransfer.getData('application/x-imagerail-track');
    if (!draggedTrackId) return;

    event.preventDefault();
    event.stopPropagation();
    const insertAfter = state.trackDropIndicatorElement === trackElement
      ? state.trackDropIndicatorAfter
      : event.clientY > trackElement.getBoundingClientRect().top + trackElement.getBoundingClientRect().height / 2;
    clearTrackDropIndicator();
    reorderTrack(draggedTrackId, track.id, insertAfter);
  });

  lane.addEventListener('dragover', (event) => {
    if (isImageReorderDrag(event.dataTransfer)) {
      event.preventDefault();
      return;
    }

    if (!isImageImportDrag(event.dataTransfer)) return;
    event.preventDefault();
    setTrackLaneDropHighlight(lane);
  });

  lane.addEventListener('dragleave', (event) => {
    if (lane.contains(event.relatedTarget)) return;
    clearTrackLaneDropHighlights();
    if (!lane.contains(event.relatedTarget)) clearImageDropIndicator();
  });

  lane.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearTrackLaneDropHighlights();
    clearImageDropIndicator();
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
    state.trackScrollPositions[track.id] = lane.scrollLeft;
  }, { passive: false });

  lane.addEventListener('scroll', () => {
    state.trackScrollPositions[track.id] = lane.scrollLeft;
    updateTrackNavigationButtons(lane);
  });

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
  card.dataset.renderKey = imageCardRenderKey(trackId, image);
  card.addEventListener('dragover', (event) => {
    if (!dataTransferHasType(event.dataTransfer, 'application/x-imagerail-image')) return;
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    setImageDropIndicator(card, insertAfter);
  });
  card.addEventListener('drop', (event) => {
    if (!event.dataTransfer.getData('application/x-imagerail-image')) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = card.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    clearImageDropIndicator();
    handleImageReorderDrop(event, trackId, image.id, insertAfter);
  });

  const imageUrl = fileUrlFromRelativePath(image.relativePath, imageCacheKey(image));
  const thumbButton = document.createElement('button');
  thumbButton.type = 'button';
  thumbButton.className = 'thumb-button';
  thumbButton.addEventListener('click', (event) => {
    event.stopPropagation();
    selectImage(image.id);
    refreshSelectedImageView();
  });

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = image.fileName;
  thumbButton.appendChild(img);
  setupImageFileInteractions(thumbButton, img, trackId, image);

  const body = document.createElement('div');
  body.className = 'card-body';
  setupImageReorderInteractions(body, trackId, image);

  const titleRow = document.createElement('div');
  titleRow.className = 'card-title-row';

  const fileName = document.createElement('div');
  fileName.className = 'file-name';
  fileName.textContent = image.fileName;

  const version = document.createElement('div');
  version.className = 'version';
  version.textContent = `版本 ${image.version}`;
  titleRow.append(fileName, version);

  const status = document.createElement('select');
  status.className = 'card-status-select';
  STATUS_OPTIONS.forEach((option) => {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    status.appendChild(item);
  });
  status.value = image.status || 'pending';
  stopCardClick(status);
  status.addEventListener('change', () => {
    const undo = captureUndo('修改图片状态');
    updateImage(trackId, image.id, { status: status.value });
    commitUndo(undo);
  });

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete-button';
  deleteButton.textContent = '删除图片';
  setInlineConfirmState(deleteButton, isPendingDelete('image', image.id));
  deleteButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    await deleteImageFile(trackId, image.id, deleteButton);
  });

  actions.append(status, deleteButton);
  body.append(titleRow, actions);
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

function isImageReorderDrag(dataTransfer) {
  return dataTransferHasType(dataTransfer, 'application/x-imagerail-image');
}

function isImageImportDrag(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  return types.includes('Files')
    || types.includes('text/uri-list')
    || types.includes('text/html')
    || types.includes('text/plain');
}

function setTrackLaneDropHighlight(lane) {
  document.querySelectorAll('.track-lane.drag-over').forEach((item) => {
    if (item !== lane) item.classList.remove('drag-over');
  });
  lane.classList.add('drag-over');
}

function clearTrackLaneDropHighlights() {
  document.querySelectorAll('.track-lane.drag-over').forEach((item) => item.classList.remove('drag-over'));
}

function showImageDragCancelZone() {
  elements.comparePanel.classList.add('image-drag-active');
}

function clearImageDragCancelZone() {
  elements.comparePanel.classList.remove('image-drag-active', 'cancel-drop-active');
}

function isAnyImageDragActive() {
  return Boolean(state.draggedImage || state.draggedExportImage);
}

function setupImageReorderInteractions(handle, trackId, image) {
  handle.draggable = true;
  handle.addEventListener('dragstart', (event) => {
    if (event.target.closest('textarea, select, .delete-button')) {
      event.preventDefault();
      return;
    }

    state.draggedImage = { trackId, imageId: image.id };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-imagerail-image', JSON.stringify(state.draggedImage));
    showImageDragCancelZone();
  });

  handle.addEventListener('dragend', () => {
    state.draggedImage = null;
    clearImageDropIndicator();
    clearTrackLaneDropHighlights();
    clearImageDragCancelZone();
  });
}

function setImageDropIndicator(card, insertAfter) {
  if (state.imageDropIndicatorCard === card && state.imageDropIndicatorAfter === insertAfter) return;

  clearImageDropIndicator();
  state.imageDropIndicatorCard = card;
  state.imageDropIndicatorAfter = insertAfter;
  card.classList.toggle('drag-before', !insertAfter);
  card.classList.toggle('drag-after', insertAfter);
  card.classList.add('drag-over-image');
}

function clearImageDropIndicator() {
  if (!state.imageDropIndicatorCard) return;

  state.imageDropIndicatorCard.classList.remove('drag-over-image', 'drag-before', 'drag-after');
  state.imageDropIndicatorCard = null;
  state.imageDropIndicatorAfter = false;
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
  const undo = captureUndo('调整轨道顺序');
  if (!moveArrayItem(tracks, sourceIndex, targetIndex)) return;

  saveProject({ silent: true });
  commitUndo(undo);
  render();
}

function setTrackDropIndicator(trackElement, insertAfter = false) {
  if (state.trackDropIndicatorElement === trackElement && state.trackDropIndicatorAfter === insertAfter) return;

  clearTrackDropIndicator();
  state.trackDropIndicatorElement = trackElement;
  state.trackDropIndicatorAfter = insertAfter;
  trackElement.classList.add('drag-over-track');
  trackElement.classList.toggle('drag-before-track', !insertAfter);
  trackElement.classList.toggle('drag-after-track', insertAfter);
}

function clearTrackDropIndicator(trackElement = null) {
  if (trackElement && state.trackDropIndicatorElement !== trackElement) return;
  if (!state.trackDropIndicatorElement) return;

  state.trackDropIndicatorElement.classList.remove('drag-over-track', 'drag-before-track', 'drag-after-track');
  state.trackDropIndicatorElement = null;
  state.trackDropIndicatorAfter = false;
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

  const undo = captureUndo('调整图片顺序');
  if (!moveArrayItem(targetTrack.images, sourceIndex, targetIndex)) return true;
  saveProject({ silent: true });
  commitUndo(undo);
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
    if (!state.projectPath || !image.relativePath) return;

    state.draggedExportImage = true;
    showImageDragCancelZone();
    const imageUrl = fileUrlFromRelativePath(image.relativePath);
    const mimeType = imageMimeFromName(image.fileName);
    event.dataTransfer.setData('DownloadURL', `${mimeType}:${image.fileName}:${imageUrl}`);
  };

  thumbButton.addEventListener('contextmenu', handleContextMenu);
  imageElement.addEventListener('contextmenu', handleContextMenu);
  imageElement.addEventListener('dragstart', handleDragStart);
  imageElement.addEventListener('dragend', () => {
    state.draggedExportImage = false;
    clearImageDragCancelZone();
  });
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

  const projectPath = state.projectPath;
  try {
    await enqueueCurrentProjectOperation(projectPath, async () => {
      const undo = captureUndo('重命名图片');
      const result = await window.imageRail.renameImageFile({
        projectPath,
        project: cloneProject(),
        trackId,
        imageId: image.id,
        newImageName: cleanName
      });
      setProjectFromResult(result);
      commitUndo(undo);
    });
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

  const projectPath = state.projectPath;
  try {
    const clipboardImage = await readClipboardImage();
    if (clipboardImage.blob.size > MAX_RAW_IMAGE_BYTES) {
      throw new Error('剪切板图片超过 100 MB，已停止导入');
    }
    const extension = fileExtensionFromMime(clipboardImage.mimeType);
    const fileData = await clipboardImage.blob.arrayBuffer();
    await flushScheduledProjectSave();
    await enqueueCurrentProjectOperation(projectPath, async () => {
      const undo = captureUndo('粘贴图片');
      const result = await window.imageRail.addImageRawFileDataToTrack({
        projectPath,
        project: cloneProject(),
        trackId,
        fileName: `clipboard_${Date.now()}${extension}`,
        mimeType: clipboardImage.mimeType,
        fileData
      });

      state.project = result.project;
      state.tracksToScrollEnd.add(trackId);
      commitUndo(undo);
      render();
    });
  } catch (error) {
    showAppMessage(getErrorText(error, '粘贴图片失败'));
  }
}

async function deleteContextMenuImage() {
  const image = state.contextMenuImage;
  const trackId = state.contextMenuTrackId;
  closeContextMenu();

  if (!image || !trackId) return;

  const projectPath = state.projectPath;
  try {
    await enqueueCurrentProjectOperation(projectPath, async () => {
      const undo = captureUndo('删除图片', { preserveTrash: true });
      const result = await window.imageRail.deleteImageFile({
        projectPath,
        project: cloneProject(),
        trackId,
        imageId: image.id
      });
      if (state.selectedImageId === image.id) state.selectedImageId = '';
      if (state.pinnedCompareImageId === image.id) state.pinnedCompareImageId = '';
      setProjectFromResult(result);
      commitUndo(undo);
    });
  } catch (error) {
    showAppMessage(getRenameErrorMessage(error, '删除图片失败'));
  }
}

async function revealContextMenuImage() {
  const image = state.contextMenuImage;
  closeContextMenu();

  if (!image) return;

  await revealImageInFolder(image);
}

async function revealImageInFolder(image) {
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
  button.dataset.defaultLabel ||= button.textContent;
  button.textContent = isConfirming ? '确定' : button.dataset.defaultLabel;
  button.classList.toggle('confirm-delete', isConfirming);
}

function resetInlineDeleteConfirmations(exceptButton) {
  document.querySelectorAll('.confirm-delete').forEach((button) => {
    if (button === exceptButton) return;
    setInlineConfirmState(button, false);
  });
}

function isPendingDelete(type, id) {
  return state.pendingDelete.type === type && state.pendingDelete.id === id;
}

function clearPendingDelete() {
  state.pendingDelete.type = '';
  state.pendingDelete.id = '';
}

function cancelInlineDeleteConfirmations() {
  if (!state.pendingDelete.type) return;

  clearPendingDelete();
  resetInlineDeleteConfirmations();
}

function markInlineDeleteConfirmation(button, type, id) {
  resetInlineDeleteConfirmations(button);
  state.pendingDelete.type = type;
  state.pendingDelete.id = id;
  setInlineConfirmState(button, true);
}

async function importImageFileToTrack(file, trackId) {
  const projectPath = state.projectPath;
  if (!file.path && file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error('图片超过 100 MB，已停止导入');
  }
  const fileData = file.path ? null : await file.arrayBuffer();
  if (!file.path) await flushScheduledProjectSave();
  await enqueueCurrentProjectOperation(projectPath, async () => {
    const result = file.path
      ? await window.imageRail.addImageToTrack({
          projectPath,
          project: cloneProject(),
          trackId,
          sourcePath: file.path
        })
      : await window.imageRail.addImageRawFileDataToTrack({
          projectPath,
          project: cloneProject(),
          trackId,
          fileName: file.name,
          mimeType: file.type,
          fileData
        });

    state.project = result.project;
  });
}

async function handleDrop(event, trackId) {
  if (!state.projectPath || !state.project) return;

  const droppedFiles = Array.from(event.dataTransfer.files || []);
  const fallbackFiles = droppedFiles.length
    ? []
    : Array.from(event.dataTransfer.items || [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter(Boolean);
  const files = droppedFiles.length ? droppedFiles : fallbackFiles;
  const imageUrl = getDraggedImageUrl(event.dataTransfer);

  await waitForProjectOperations();
  rememberTrackScrollPositions();
  const undo = captureUndo('导入图片');
  let importedCount = 0;

  for (const file of files) {
    try {
      await importImageFileToTrack(file, trackId);
      importedCount += 1;
    } catch (error) {
      showAppMessage(getErrorText(error, '导入图片失败'));
    }
  }

  if (importedCount === 0 && imageUrl) {
    try {
      const projectPath = state.projectPath;
      await enqueueCurrentProjectOperation(projectPath, async () => {
        const result = await window.imageRail.addImageUrlToTrack({
          projectPath,
          project: cloneProject(),
          trackId,
          url: imageUrl
        });
        state.project = result.project;
      });
      importedCount += 1;
    } catch (error) {
      showAppMessage(getErrorText(error, '从网页导入图片失败'));
    }
  }

  if (importedCount === 0) {
    showAppMessage('没有识别到可导入的图片。请拖入 png、jpg、jpeg、webp、gif、bmp 或 avif 图片。');
  } else {
    state.tracksToScrollEnd.add(trackId);
    commitUndo(undo);
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

  const undo = captureUndo('新建轨道');
  const index = state.project.tracks.length;
  const letter = getTrackLetter(index);
  state.project.tracks.push({
    id: makeId('track'),
    letter,
    prefix: letter,
    folderName: `track_${letter}`,
    name: `轨道 ${letter}`,
    collapsed: false,
    images: []
  });

  saveProject();
  commitUndo(undo);
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

  const projectPath = state.projectPath;
  try {
    await enqueueCurrentProjectOperation(projectPath, async () => {
      const undo = captureUndo('重命名轨道');
      const result = await window.imageRail.renameTrackFolder({
        projectPath,
        project: cloneProject(),
        trackId,
        newTrackName: cleanName
      });
      setProjectFromResult(result);
      commitUndo(undo);
    });
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

  const projectPath = state.projectPath;
  try {
    await enqueueCurrentProjectOperation(projectPath, async () => {
      const undo = captureUndo('重命名图片前缀');
      const result = await window.imageRail.renameTrackPrefix({
        projectPath,
        project: cloneProject(),
        trackId,
        newPrefix: cleanPrefix
      });
      setProjectFromResult(result);
      commitUndo(undo);
    });
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
  const card = elements.tracks.querySelector(`.image-card[data-image-id="${CSS.escape(imageId)}"]`);
  if (card) {
    card.dataset.renderKey = imageCardRenderKey(trackId, image);
    if (patch.status) {
      const statusSelect = card.querySelector('.card-status-select');
      if (statusSelect) statusSelect.value = image.status;
    }
  }
  if (Object.hasOwn(patch, 'note')) {
    scheduleProjectSave({ silent: true });
  } else {
    saveProject({ silent: true });
  }
  renderComparePanel();
}

async function deleteImageFile(trackId, imageId, button) {
  const track = findTrack(trackId);
  if (!track) return;

  const image = track.images.find((item) => item.id === imageId);
  if (!image) return;

  if (!isPendingDelete('image', imageId)) {
    markInlineDeleteConfirmation(button, 'image', imageId);
    return;
  }

  const projectPath = state.projectPath;
  try {
    rememberTrackScrollPositions();
    await enqueueCurrentProjectOperation(projectPath, async () => {
      const undo = captureUndo('删除图片', { preserveTrash: true });
      const result = await window.imageRail.deleteImageFile({
        projectPath,
        project: cloneProject(),
        trackId,
        imageId
      });
      clearPendingDelete();
      state.projectPath = result.projectPath || state.projectPath;
      state.project = result.project;
      commitUndo(undo);
      if (state.selectedImageId === imageId) state.selectedImageId = '';
      if (state.pinnedCompareImageId === imageId) state.pinnedCompareImageId = '';
      render();
    });
  } catch (error) {
    clearPendingDelete();
    resetInlineDeleteConfirmations();
    showAppMessage(getRenameErrorMessage(error, '删除图片失败'));
  }
}

async function removeTrackRecord(trackId, button) {
  const track = findTrack(trackId);
  if (!track) return;

  if (!isPendingDelete('track', trackId)) {
    markInlineDeleteConfirmation(button, 'track', trackId);
    return;
  }

  const removedImageIds = new Set(track.images.map((image) => image.id));
  const projectPath = state.projectPath;
  try {
    await enqueueCurrentProjectOperation(projectPath, async () => {
      const undo = captureUndo('删除轨道', { preserveTrash: true });
      const result = await window.imageRail.deleteTrackFolder({
        projectPath,
        project: cloneProject(),
        trackId
      });
      if (removedImageIds.has(state.selectedImageId)) {
        state.selectedImageId = '';
      }
      if (removedImageIds.has(state.pinnedCompareImageId)) {
        state.pinnedCompareImageId = '';
      }
      clearPendingDelete();
      setProjectFromResult(result);
      commitUndo(undo);
    });
  } catch (error) {
    clearPendingDelete();
    resetInlineDeleteConfirmations();
    showAppMessage(getRenameErrorMessage(error, '删除轨道文件夹失败'));
  }
}

async function saveProject(options = {}) {
  if (!state.projectPath || !state.project) return;

  const projectPath = state.projectPath;
  const saveTask = enqueueCurrentProjectOperation(projectPath, () => (
    window.imageRail.saveProject({
      projectPath,
      project: cloneProject()
    })
  ));
  state.savePromise = saveTask;

  try {
    const result = await saveTask;
    if (state.savePromise === saveTask && state.projectPath === projectPath) {
      state.project = result.project;
      if (!options.silent) render();
    }
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
  clearPendingDelete();
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
  updateCompareModeButtons(hasProject);
  renderComparePanel();
}

function updateCompareModeButtons(hasProject = Boolean(state.projectPath && state.project)) {
  const isCompareMode = state.compareMode === 'compare';
  const hasComparePair = Boolean(
    isCompareMode &&
    state.pinnedCompareImageId &&
    state.selectedImageId &&
    state.pinnedCompareImageId !== state.selectedImageId
  );

  elements.compareViewButton.disabled = !hasProject || (!state.selectedImageId && !isCompareMode);
  elements.compareViewButton.classList.toggle('active', isCompareMode);
  elements.compareViewButton.setAttribute('aria-pressed', String(isCompareMode));
  elements.zoomOutButton.hidden = isCompareMode;
  elements.zoomInButton.hidden = isCompareMode;
  elements.syncPanButton.hidden = !isCompareMode;
  elements.syncZoomButton.hidden = !isCompareMode;
  elements.syncPanButton.disabled = !hasComparePair;
  elements.syncZoomButton.disabled = !hasComparePair;
  elements.syncPanButton.classList.toggle('active', state.syncComparePan);
  elements.syncZoomButton.classList.toggle('active', state.syncCompareZoom);
  elements.syncPanButton.setAttribute('aria-pressed', String(state.syncComparePan));
  elements.syncZoomButton.setAttribute('aria-pressed', String(state.syncCompareZoom));
}

function toggleComparePanSync() {
  state.syncComparePan = !state.syncComparePan;

  if (state.syncComparePan) {
    const source = getActiveCompareViewport();
    const pan = getViewportPan(source);
    getCompareViewports().forEach((viewport) => applyViewportPan(viewport, pan.x, pan.y));
  }

  updateCompareModeButtons();
}

function toggleCompareZoomSync() {
  state.syncCompareZoom = !state.syncCompareZoom;

  if (state.syncCompareZoom) {
    const source = getActiveCompareViewport();
    const zoom = getViewportZoom(source);
    getCompareViewports().forEach((viewport) => applyViewportZoom(viewport, zoom));
  }

  updateCompareModeButtons();
}

function setCompareMode(mode) {
  if (mode === state.compareMode) return;

  if (mode === 'compare') {
    if (!state.selectedImageId) return;
    state.compareMode = 'compare';
    state.pinnedCompareImageId = state.selectedImageId;
  } else {
    state.compareMode = 'single';
    state.pinnedCompareImageId = '';
    state.syncComparePan = false;
    state.syncCompareZoom = false;
  }

  render();
}

function changeViewportZoom(viewport, delta) {
  if (!viewport) return;
  const nextZoom = Number((getViewportZoom(viewport) + delta).toFixed(2));
  setViewportZoom(viewport, nextZoom);
}

function changeActiveCompareZoom(delta) {
  if (state.compareMode === 'compare') return;
  const viewport = getActiveCompareViewport();
  activateCompareViewport(viewport);
  changeViewportZoom(viewport, delta);
}

function compareItemSignature(item) {
  if (!item) return '';
  return [
    item.track.id,
    item.track.name,
    item.image.id,
    item.image.fileName,
    item.image.relativePath,
    item.image.version,
    item.image.status,
    imageCacheKey(item.image)
  ].join('|');
}

function closeCompareStatusMenus(exceptMenu = null) {
  document.querySelectorAll('.compare-status-menu:not([hidden])').forEach((menu) => {
    if (menu === exceptMenu) return;
    menu.hidden = true;
    menu.closest('.compare-status-control')?.querySelector('.compare-status-button')
      ?.setAttribute('aria-expanded', 'false');
  });
}

function renderComparePanel() {
  const selected = findSelectedImage();
  let pinned = state.compareMode === 'compare' ? findImageById(state.pinnedCompareImageId) : null;
  if (state.compareMode === 'compare' && !pinned && selected) {
    state.pinnedCompareImageId = selected.image.id;
    pinned = selected;
  } else if (state.compareMode === 'compare' && !pinned) {
    state.compareMode = 'single';
    state.syncComparePan = false;
    state.syncCompareZoom = false;
    updateCompareModeButtons();
  }
  const isCompareMode = Boolean(pinned);
  const secondImage = selected?.image.id === pinned?.image.id ? null : selected;
  const detailsItem = secondImage || pinned || selected;
  const signature = detailsItem
    ? `${state.compareMode}::${compareItemSignature(pinned)}::${compareItemSignature(secondImage || selected)}`
    : `empty::${state.projectPath ? 'project' : 'no-project'}`;

  if (elements.compareContent.dataset.signature === signature) {
    updateCompareZoomButtons();
    return;
  }

  elements.compareContent.dataset.signature = signature;
  elements.compareContent.replaceChildren();

  if (!detailsItem) {
    elements.compareDetails.hidden = true;
    elements.compareContent.className = 'compare-empty';
    elements.compareContent.textContent = state.projectPath
      ? '点击任意图片卡片后，这里会显示大图。'
      : '选择项目文件夹并点击图片后，这里会显示大图。';
    return;
  }

  elements.compareDetails.hidden = isCompareMode;
  if (!isCompareMode) {
    elements.compareDimensionsText.textContent = '读取中';
    elements.compareSizeText.textContent = '读取中';
    elements.compareNoteInput.value = selected.image.note || '';
    elements.compareNoteInput.dataset.trackId = selected.track.id;
    elements.compareNoteInput.dataset.imageId = selected.image.id;
    elements.compareRevealButton.dataset.imageId = selected.image.id;
  }

  elements.compareContent.className = isCompareMode ? 'compare-stack' : 'compare-single';

  if (isCompareMode) {
    elements.compareContent.appendChild(createComparePane(pinned, true));
    elements.compareContent.appendChild(
      secondImage
        ? createComparePane(secondImage)
        : createComparePlaceholder()
    );
    updateCompareZoomButtons();
    return;
  }

  const pane = createComparePane(selected);
  elements.compareContent.appendChild(pane);
  updateCompareDetailsMetadata(selected, pane, signature);
  updateCompareZoomButtons();
}

function createComparePane(item, isPinned = false) {
  const pane = document.createElement('section');
  pane.className = `compare-pane ${isPinned ? 'compare-pane-pinned' : 'compare-pane-current'}`;

  const heading = document.createElement('div');
  heading.className = 'compare-pane-heading';

  const archiveTag = document.createElement('div');
  archiveTag.className = 'compare-archive-tag';
  archiveTag.textContent = item.image.fileName;
  archiveTag.title = item.image.fileName;

  const path = document.createElement('div');
  path.className = 'compare-image-path';
  path.textContent = `${item.track.name} > 版本 ${item.image.version}`;
  path.title = path.textContent;

  heading.append(archiveTag, path);

  const statusValue = item.image.status || 'pending';
  const statusLabel = STATUS_OPTIONS.find((option) => option.value === statusValue)?.label || '待定';
  const statusControl = document.createElement('div');
  statusControl.className = `compare-status-control status-${statusValue}`;

  const statusButton = document.createElement('button');
  statusButton.type = 'button';
  statusButton.className = 'compare-status-button';
  statusButton.setAttribute('aria-label', `修改 ${item.image.fileName} 的状态`);
  statusButton.setAttribute('aria-haspopup', 'menu');
  statusButton.setAttribute('aria-expanded', 'false');

  const statusButtonLabel = document.createElement('span');
  statusButtonLabel.textContent = statusLabel;

  const statusCaret = document.createElement('span');
  statusCaret.className = 'compare-status-caret';
  statusCaret.textContent = '⌄';
  statusButton.append(statusButtonLabel, statusCaret);

  const statusMenu = document.createElement('div');
  statusMenu.className = 'compare-status-menu';
  statusMenu.setAttribute('role', 'menu');
  statusMenu.hidden = true;

  STATUS_OPTIONS.forEach((option) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = `compare-status-option${option.value === statusValue ? ' active' : ''}`;
    optionButton.setAttribute('role', 'menuitemradio');
    optionButton.setAttribute('aria-checked', String(option.value === statusValue));

    const dot = document.createElement('span');
    dot.className = `compare-status-dot status-${option.value}`;

    const label = document.createElement('span');
    label.textContent = option.label;
    optionButton.append(dot, label);
    optionButton.addEventListener('click', (event) => {
      event.stopPropagation();
      closeCompareStatusMenus();
      if (option.value === statusValue) return;

      const undo = captureUndo('修改图片状态');
      updateImage(item.track.id, item.image.id, { status: option.value });
      commitUndo(undo);
    });
    statusMenu.appendChild(optionButton);
  });

  statusButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = statusMenu.hidden;
    closeCompareStatusMenus(statusMenu);
    statusMenu.hidden = !willOpen;
    statusButton.setAttribute('aria-expanded', String(willOpen));
  });
  statusControl.append(statusButton, statusMenu);

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

  pane.append(heading, statusControl, imageButton);
  return pane;
}

function updateCompareDetailsMetadata(item, pane, signature) {
  const isCurrent = () => (
    state.compareMode === 'single'
    && elements.compareContent.dataset.signature === signature
    && elements.compareNoteInput.dataset.imageId === item.image.id
  );
  const image = pane.querySelector('img');
  const showDimensions = () => {
    if (!isCurrent()) return;
    elements.compareDimensionsText.textContent = image?.naturalWidth && image?.naturalHeight
      ? `${image.naturalWidth} × ${image.naturalHeight}`
      : '无法读取';
  };

  if (image?.complete) {
    showDimensions();
  } else {
    image?.addEventListener('load', showDimensions, { once: true });
    image?.addEventListener('error', showDimensions, { once: true });
  }

  window.imageRail.getImageFileMetadata({
    projectPath: state.projectPath,
    relativePath: item.image.relativePath
  }).then((metadata) => {
    if (isCurrent()) elements.compareSizeText.textContent = formatFileSize(metadata.sizeBytes);
  }).catch(() => {
    if (isCurrent()) elements.compareSizeText.textContent = '无法读取';
  });
}

function createComparePlaceholder() {
  const pane = document.createElement('section');
  pane.className = 'compare-pane compare-pane-placeholder';

  const title = document.createElement('div');
  title.className = 'compare-archive-tag';
  title.textContent = '等待选择图片';

  const sideMarker = document.createElement('div');
  sideMarker.className = 'compare-side-marker status-empty';
  sideMarker.textContent = '待选择';

  const message = document.createElement('div');
  message.className = 'compare-placeholder-message';
  message.textContent = '点击轨道中的另一张图片';

  pane.append(title, sideMarker, message);
  return pane;
}

function setupCompareImagePanZoom(viewport) {
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let panX = getViewportPan(viewport).x;
  let panY = getViewportPan(viewport).y;

  const applyPan = () => {
    const targets = state.compareMode === 'compare' && state.syncComparePan
      ? [...new Set([viewport, ...getCompareViewports()])]
      : [viewport];
    targets.forEach((target) => applyViewportPan(target, panX, panY));
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
    const currentPan = getViewportPan(viewport);
    panX = currentPan.x;
    panY = currentPan.y;
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
elements.scrollBoardTopButton.addEventListener('click', () => {
  elements.railBoard.scrollTo({ top: 0, behavior: 'smooth' });
});
elements.scrollBoardBottomButton.addEventListener('click', () => {
  elements.railBoard.scrollTo({ top: elements.railBoard.scrollHeight, behavior: 'smooth' });
});
elements.railBoard.addEventListener('scroll', updateBoardNavigationButtons);
window.addEventListener('resize', updateBoardNavigationButtons);
elements.undoButton.addEventListener('click', undoLastAction);
elements.compareViewButton.addEventListener('click', () => {
  setCompareMode(state.compareMode === 'compare' ? 'single' : 'compare');
});
elements.syncPanButton.addEventListener('click', toggleComparePanSync);
elements.syncZoomButton.addEventListener('click', toggleCompareZoomSync);
elements.zoomInButton.addEventListener('click', () => changeActiveCompareZoom(COMPARE_ZOOM_STEP));
elements.zoomOutButton.addEventListener('click', () => changeActiveCompareZoom(-COMPARE_ZOOM_STEP));
elements.compareNoteInput.addEventListener('focus', () => {
  state.compareNoteUndo = captureUndo('编辑图片备注');
});
elements.compareNoteInput.addEventListener('input', () => {
  const imageId = elements.compareNoteInput.dataset.imageId;
  const trackId = elements.compareNoteInput.dataset.trackId;
  const item = findImageById(imageId);
  if (!item || item.track.id !== trackId) return;

  if (state.compareNoteUndo) {
    commitUndo(state.compareNoteUndo);
    state.compareNoteUndo = null;
  }
  updateImage(trackId, imageId, { note: elements.compareNoteInput.value });
});
elements.compareNoteInput.addEventListener('blur', () => {
  state.compareNoteUndo = null;
  flushScheduledProjectSave();
});
elements.compareRevealButton.addEventListener('click', () => {
  const item = findImageById(elements.compareRevealButton.dataset.imageId);
  if (item) revealImageInFolder(item.image);
});
elements.minimizeWindowButton.addEventListener('click', () => window.imageRail?.minimizeWindow?.());
elements.maximizeWindowButton.addEventListener('click', () => window.imageRail?.toggleMaximizeWindow?.());
elements.closeWindowButton.addEventListener('click', closeApplication);
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
elements.comparePanel.addEventListener('dragenter', (event) => {
  if (!isAnyImageDragActive()) return;
  event.preventDefault();
  elements.comparePanel.classList.add('cancel-drop-active');
});
elements.comparePanel.addEventListener('dragover', (event) => {
  if (!isAnyImageDragActive()) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
});
elements.comparePanel.addEventListener('dragleave', (event) => {
  if (event.relatedTarget && elements.comparePanel.contains(event.relatedTarget)) return;
  elements.comparePanel.classList.remove('cancel-drop-active');
});
elements.comparePanel.addEventListener('drop', (event) => {
  if (!isAnyImageDragActive()) return;
  event.preventDefault();
  event.stopPropagation();
  state.draggedImage = null;
  state.draggedExportImage = false;
  clearImageDropIndicator();
  clearTrackLaneDropHighlights();
  clearImageDragCancelZone();
});
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  closeContextMenu();
});
document.addEventListener('pointerdown', (event) => {
  if (!elements.contextMenu.hidden && !event.target.closest('.context-menu')) {
    closeContextMenu();
  }

  if (!event.target.closest('.compare-status-control')) {
    closeCompareStatusMenus();
  }

  if (!event.target.closest('.confirm-delete')) {
    cancelInlineDeleteConfirmations();
  }
});
document.addEventListener('dragend', () => {
  state.draggedExportImage = false;
  clearTrackDropIndicator();
  clearTrackLaneDropHighlights();
  clearImageDropIndicator();
  clearImageDragCancelZone();
});
document.addEventListener('drop', () => {
  state.draggedExportImage = false;
  clearTrackDropIndicator();
  clearTrackLaneDropHighlights();
  clearImageDropIndicator();
  clearImageDragCancelZone();
});
window.addEventListener('blur', () => {
  flushScheduledProjectSave();
  state.draggedExportImage = false;
  closeContextMenu();
  clearTrackDropIndicator();
  clearTrackLaneDropHighlights();
  clearImageDropIndicator();
  clearImageDragCancelZone();
});
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  const isReloadShortcut = key === 'f5' || ((event.ctrlKey || event.metaKey) && key === 'r');

  if (isReloadShortcut) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'z') {
    event.preventDefault();
    undoLastAction();
    return;
  }

  if (event.key === 'Escape' && !elements.contextMenu.hidden) {
    closeContextMenu();
  }

  if (event.key === 'Escape') {
    closeCompareStatusMenus();
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
}, true);

window.imageRail?.onCloseRequested?.(closeApplication).catch(() => {});

render();
