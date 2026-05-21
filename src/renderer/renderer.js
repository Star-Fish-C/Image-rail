const STATUS_OPTIONS = [
  { value: 'usable', label: '可用' },
  { value: 'pending', label: '待定' },
  { value: 'discarded', label: '废弃' },
  { value: 'final_candidate', label: '最终候选' }
];

const state = {
  projectPath: '',
  project: null,
  selectedImageId: '',
  renameResolver: null
};

const elements = {
  projectPathText: document.querySelector('#projectPathText'),
  chooseProjectButton: document.querySelector('#chooseProjectButton'),
  renameProjectButton: document.querySelector('#renameProjectButton'),
  newTrackButton: document.querySelector('#newTrackButton'),
  saveProjectButton: document.querySelector('#saveProjectButton'),
  emptyState: document.querySelector('#emptyState'),
  tracks: document.querySelector('#tracks'),
  detailContent: document.querySelector('#detailContent'),
  previewModal: document.querySelector('#previewModal'),
  previewImage: document.querySelector('#previewImage'),
  closePreviewButton: document.querySelector('#closePreviewButton'),
  renameModal: document.querySelector('#renameModal'),
  renameForm: document.querySelector('#renameForm'),
  renameTitle: document.querySelector('#renameTitle'),
  renameDescription: document.querySelector('#renameDescription'),
  renameInput: document.querySelector('#renameInput'),
  cancelRenameButton: document.querySelector('#cancelRenameButton')
};

function getTrackLetter(index) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < alphabet.length) return alphabet[index];
  return `T${index + 1}`;
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function fileUrlFromRelativePath(relativePath) {
  if (!state.projectPath || !relativePath) return '';
  const normalizedProjectPath = state.projectPath.replace(/\\/g, '/');
  return encodeURI(`file:///${normalizedProjectPath}/${relativePath}`);
}

function setProject(projectPath, project) {
  state.projectPath = projectPath;
  state.project = project;
  state.project.projectName = state.project.projectName || getFolderName(projectPath);
  state.project.imagesFolderName = state.project.imagesFolderName || 'images';
  state.selectedImageId = '';
  render();
}

function render() {
  const hasProject = Boolean(state.projectPath && state.project);
  elements.projectPathText.textContent = hasProject
    ? `${state.project.projectName || getFolderName(state.projectPath)} · 图片文件夹：${state.project.imagesFolderName || 'images'} · ${state.projectPath}`
    : '尚未选择项目文件夹';
  elements.renameProjectButton.disabled = !hasProject;
  elements.newTrackButton.disabled = !hasProject;
  elements.saveProjectButton.disabled = !hasProject;
  elements.emptyState.hidden = hasProject && state.project.tracks.length > 0;
  elements.tracks.innerHTML = '';

  if (!hasProject) {
    renderDetail();
    return;
  }

  state.project.tracks.forEach((track, trackIndex) => {
    elements.tracks.appendChild(createTrackElement(track, trackIndex));
  });

  renderDetail();
}

function createTrackElement(track, trackIndex) {
  const trackElement = document.createElement('article');
  trackElement.className = 'track';

  const label = document.createElement('div');
  label.className = 'track-label';

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
  deleteTrackButton.addEventListener('click', () => removeTrackRecord(track.id));

  label.append(trackName, trackMeta, renameTrackButton, renamePrefixButton, deleteTrackButton);

  const lane = document.createElement('div');
  lane.className = 'track-lane';
  lane.dataset.trackId = track.id;

  lane.addEventListener('dragover', (event) => {
    event.preventDefault();
    lane.classList.add('drag-over');
  });

  lane.addEventListener('dragleave', () => {
    lane.classList.remove('drag-over');
  });

  lane.addEventListener('drop', async (event) => {
    event.preventDefault();
    lane.classList.remove('drag-over');
    await handleDrop(event, track.id);
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

  const thumbButton = document.createElement('button');
  thumbButton.type = 'button';
  thumbButton.className = 'thumb-button';
  thumbButton.addEventListener('click', (event) => {
    event.stopPropagation();
    state.selectedImageId = image.id;
    openPreview(image);
    render();
  });

  const img = document.createElement('img');
  img.src = fileUrlFromRelativePath(image.relativePath);
  img.alt = image.fileName;
  thumbButton.appendChild(img);

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
  deleteButton.textContent = '移除记录';
  deleteButton.addEventListener('click', (event) => {
    event.stopPropagation();
    removeImageRecord(trackId, image.id);
  });

  const renamePrefixButton = document.createElement('button');
  renamePrefixButton.type = 'button';
  renamePrefixButton.className = 'delete-button neutral-button';
  renamePrefixButton.textContent = '重命名前缀';
  renamePrefixButton.addEventListener('click', (event) => {
    event.stopPropagation();
    renameTrackPrefix(trackId);
  });

  actions.append(renamePrefixButton, deleteButton);
  body.append(fileName, version, note, status, actions);
  card.append(thumbButton, body);
  card.addEventListener('click', () => {
    if (state.selectedImageId === image.id) return;
    state.selectedImageId = image.id;
    render();
  });

  return card;
}

function stopCardClick(element) {
  ['click', 'mousedown', 'mouseup', 'dblclick'].forEach((eventName) => {
    element.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  });
}

async function handleDrop(event, trackId) {
  if (!state.projectPath || !state.project) return;

  const files = Array.from(event.dataTransfer.files || []);
  if (files.length === 0) return;

  for (const file of files) {
    try {
      const result = await window.imageRail.addImageToTrack({
        projectPath: state.projectPath,
        project: state.project,
        trackId,
        sourcePath: file.path
      });
      state.project = result.project;
    } catch (error) {
      alert(error.message || '导入图片失败');
    }
  }

  render();
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

async function renameProject() {
  if (!state.project) return;

  const currentName = state.project.projectName || getFolderName(state.projectPath);
  const newName = await askRenameValue({
    title: '重命名图片文件夹',
    description: `会重命名当前项目文件夹里的图片总文件夹。例如把 ${state.project.imagesFolderName || 'images'} 改成 分镜头。不会修改外层项目文件夹。`,
    value: state.project.imagesFolderName || 'images'
  });
  if (newName === null) return;

  const cleanName = cleanFilePrefix(newName);
  if (!cleanName) {
    alert('图片文件夹名称不能为空');
    return;
  }

  try {
    const result = await window.imageRail.renameImagesFolder({
      projectPath: state.projectPath,
      project: state.project,
      newFolderName: cleanName
    });
    state.project = result.project;
    render();
  } catch (error) {
    alert(getRenameErrorMessage(error, '重命名图片文件夹失败'));
  }
}

async function renameTrack(trackId) {
  const track = state.project?.tracks.find((item) => item.id === trackId);
  if (!track) return;

  const newName = await askRenameValue({
    title: '重命名轨道',
    description: `会重命名 ${state.project.imagesFolderName || 'images'} 里的轨道文件夹，并更新轨道内图片的保存路径。`,
    value: track.name
  });
  if (newName === null) return;

  const cleanName = newName.trim();
  if (!cleanName) {
    alert('轨道名称不能为空');
    return;
  }

  try {
    const result = await window.imageRail.renameTrackFolder({
      projectPath: state.projectPath,
      project: state.project,
      trackId,
      newTrackName: cleanName
    });
    state.project = result.project;
    render();
  } catch (error) {
    alert(getRenameErrorMessage(error, '重命名轨道文件夹失败'));
  }
}

async function renameTrackPrefix(trackId) {
  const track = state.project?.tracks.find((item) => item.id === trackId);
  if (!track) return;

  const currentPrefix = track.prefix || track.letter || 'image';
  const newPrefix = await askRenameValue({
    title: '重命名图片前缀',
    description: '同一条轨道里的图片文件名会一起修改，例如 hero_1.0.png、hero_1.1.png。',
    value: currentPrefix
  });
  if (newPrefix === null) return;

  const cleanPrefix = cleanFilePrefix(newPrefix);
  if (!cleanPrefix) {
    alert('图片名前缀不能为空');
    return;
  }

  try {
    const result = await window.imageRail.renameTrackPrefix({
      projectPath: state.projectPath,
      project: state.project,
      trackId,
      newPrefix: cleanPrefix
    });
    state.project = result.project;
    render();
  } catch (error) {
    alert(getRenameErrorMessage(error, '重命名图片失败'));
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
  const track = state.project.tracks.find((item) => item.id === trackId);
  if (!track) return;

  const image = track.images.find((item) => item.id === imageId);
  if (!image) return;

  Object.assign(image, patch);
  saveProject({ silent: true });
  renderDetail();
}

function removeImageRecord(trackId, imageId) {
  const track = state.project.tracks.find((item) => item.id === trackId);
  if (!track) return;

  track.images = track.images.filter((image) => image.id !== imageId);
  if (state.selectedImageId === imageId) state.selectedImageId = '';
  saveProject();
  render();
}

function removeTrackRecord(trackId) {
  const track = state.project?.tracks.find((item) => item.id === trackId);
  if (!track) return;

  const confirmed = confirm(`确定删除“${track.name}”这条轨道吗？\n\n这只会删除应用里的轨道记录，不会删除硬盘里的轨道文件夹和图片。`);
  if (!confirmed) return;

  const removedImageIds = new Set(track.images.map((image) => image.id));
  state.project.tracks = state.project.tracks.filter((item) => item.id !== trackId);

  if (removedImageIds.has(state.selectedImageId)) {
    state.selectedImageId = '';
  }

  saveProject();
  render();
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
    alert(error.message || '保存失败');
  }
}

function findSelectedImage() {
  if (!state.project || !state.selectedImageId) return null;

  for (const track of state.project.tracks) {
    const image = track.images.find((item) => item.id === state.selectedImageId);
    if (image) return { track, image };
  }

  return null;
}

function renderDetail() {
  const selected = findSelectedImage();
  if (!selected) {
    elements.detailContent.className = 'detail-empty';
    elements.detailContent.textContent = state.projectPath
      ? '点击任意图片卡片后，这里会显示详细信息。'
      : '选择一张图片后，这里会显示文件名、版本、备注和状态。';
    return;
  }

  const statusLabel = STATUS_OPTIONS.find((option) => option.value === selected.image.status)?.label || '待定';
  elements.detailContent.className = '';
  elements.detailContent.innerHTML = '';

  const preview = document.createElement('img');
  preview.className = 'detail-preview';
  preview.src = fileUrlFromRelativePath(selected.image.relativePath);
  preview.alt = selected.image.fileName;

  const fields = [
    ['轨道', selected.track.name],
    ['文件名', selected.image.fileName],
    ['版本号', selected.image.version],
    ['状态', statusLabel],
    ['备注', selected.image.note || '暂无备注']
  ];

  elements.detailContent.appendChild(preview);
  fields.forEach(([label, value]) => {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `<strong>${escapeHtml(label)}</strong>${escapeHtml(value)}`;
    elements.detailContent.appendChild(field);
  });
}

function openPreview(image) {
  elements.previewImage.src = fileUrlFromRelativePath(image.relativePath);
  elements.previewModal.hidden = false;
}

function closePreview() {
  elements.previewModal.hidden = true;
  elements.previewImage.src = '';
}

function getRenameErrorMessage(error, fallbackMessage) {
  const message = String(error?.message || '');

  if (message.includes('EBUSY') || message.includes('EPERM') || message.includes('EACCES')) {
    return `${fallbackMessage}。\n\n可能是文件或文件夹正在被占用。请关闭正在打开这个项目的窗口，例如：资源管理器、图片查看器、Photoshop、ComfyUI、浏览器下载窗口等，然后再试一次。`;
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

function cleanFilePrefix(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

elements.chooseProjectButton.addEventListener('click', async () => {
  const result = await window.imageRail.chooseProjectFolder();
  if (result) {
    setProject(result.projectPath, result.project);
  }
});

elements.renameProjectButton.addEventListener('click', renameProject);
elements.newTrackButton.addEventListener('click', createTrack);
elements.saveProjectButton.addEventListener('click', () => saveProject());
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
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.renameModal.hidden) {
    closeRenameModal(null);
  }
});

render();
