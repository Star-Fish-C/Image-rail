const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const DEFAULT_IMAGES_FOLDER = 'images';
const DEFAULT_APP_NAME = 'ImageRail';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'ImageRail / 画轨',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createApplicationMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭窗口', role: 'close' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 ImageRail',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 ImageRail',
              message: 'ImageRail / 画轨',
              detail: '图片版本管理工具'
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createApplicationMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function getAppStorageRoot() {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
}

function getProjectDataDir() {
  return path.join(getAppStorageRoot(), 'project-data', 'projects');
}

function sanitizeFileName(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 60) || 'project';
}

function getProjectJsonPath(projectPath) {
  const projectName = sanitizeFileName(path.basename(projectPath));
  const projectHash = crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 10);
  return path.join(getProjectDataDir(), `${projectName}_${projectHash}.json`);
}

function getLegacyProjectJsonPath(projectPath) {
  return path.join(projectPath, 'project.json');
}

function createEmptyProject() {
  return {
    appName: DEFAULT_APP_NAME,
    projectName: '',
    imagesFolderName: DEFAULT_IMAGES_FOLDER,
    version: 1,
    updatedAt: new Date().toISOString(),
    tracks: []
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function normalizePathForCompare(filePath) {
  return path.resolve(filePath).toLowerCase();
}

async function readSavedProjectRecords() {
  try {
    const entries = await fs.readdir(getProjectDataDir(), { withFileTypes: true });
    const records = [];

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;

      try {
        const raw = await fs.readFile(path.join(getProjectDataDir(), entry.name), 'utf8');
        const project = normalizeProject(JSON.parse(raw));
        const projectPath = project.projectFolderPath;

        if (projectPath) {
          records.push({ projectPath, project });
        }
      } catch {
        // Ignore old or broken project data files so one bad file does not block folder selection.
      }
    }

    return records;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function listProjectSummaries() {
  const records = await readSavedProjectRecords();

  records.sort((a, b) => new Date(b.project.updatedAt || 0) - new Date(a.project.updatedAt || 0));

  return records.map(({ projectPath, project }) => ({
    projectPath,
    projectName: project.projectName || path.basename(projectPath),
    imagesFolderName: project.imagesFolderName || DEFAULT_IMAGES_FOLDER,
    trackCount: project.tracks.length,
    imageCount: project.tracks.reduce((total, track) => total + track.images.length, 0),
    updatedAt: project.updatedAt || ''
  }));
}

async function readProject(projectPath) {
  const projectJsonPath = getProjectJsonPath(projectPath);

  try {
    const raw = await fs.readFile(projectJsonPath, 'utf8');
    const project = JSON.parse(raw);
    return normalizeProject(project);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;

    const legacyProjectJsonPath = getLegacyProjectJsonPath(projectPath);

    try {
      const legacyRaw = await fs.readFile(legacyProjectJsonPath, 'utf8');
      const legacyProject = normalizeProject(JSON.parse(legacyRaw));
      await saveProject(projectPath, legacyProject);
      return legacyProject;
    } catch (legacyError) {
      if (legacyError.code !== 'ENOENT') throw legacyError;

      const project = createEmptyProject();
      await saveProject(projectPath, project);
      return project;
    }
  }
}

function normalizeProject(project) {
  return {
    appName: project.appName || DEFAULT_APP_NAME,
    projectName: project.projectName || '',
    imagesFolderName: project.imagesFolderName || DEFAULT_IMAGES_FOLDER,
    version: project.version || 1,
    projectFolderPath: project.projectFolderPath || '',
    updatedAt: project.updatedAt || new Date().toISOString(),
    tracks: Array.isArray(project.tracks)
      ? project.tracks.map((track, index) => normalizeTrack(track, index))
      : []
  };
}

function normalizeTrack(track, index) {
  const letter = track.letter || getTrackLetter(index);

  return {
    ...track,
    letter,
    prefix: track.prefix || letter,
    folderName: track.folderName || `track_${letter}`,
    name: track.name || `轨道 ${letter}`,
    images: Array.isArray(track.images) ? track.images : []
  };
}

async function saveProject(projectPath, project) {
  const projectToSave = {
    ...normalizeProject(project),
    projectFolderPath: projectPath,
    updatedAt: new Date().toISOString()
  };

  await ensureDir(path.join(projectPath, projectToSave.imagesFolderName));
  await ensureDir(getProjectDataDir());
  await fs.writeFile(getProjectJsonPath(projectPath), JSON.stringify(projectToSave, null, 2), 'utf8');
  return projectToSave;
}

function getTrackLetter(trackIndex) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (trackIndex < alphabet.length) return alphabet[trackIndex];
  return `T${trackIndex + 1}`;
}

function getImageVersion(imageIndex) {
  return `1.${imageIndex}`;
}

function sanitizeImagePrefix(value) {
  const trimmed = String(value || '').trim();
  return sanitizeFileName(trimmed).replace(/\s+/g, '_') || 'image';
}

function sanitizeFolderName(value) {
  const trimmed = String(value || '').trim();
  return sanitizeFileName(trimmed) || 'folder';
}

function getTrackFolderName(track, trackIndex) {
  return track.folderName || `track_${track.letter || getTrackLetter(trackIndex)}`;
}

function getProjectImagesDir(projectPath, project) {
  return path.join(projectPath, project.imagesFolderName || DEFAULT_IMAGES_FOLDER);
}

function getTrackDir(projectPath, project, track, trackIndex) {
  return path.join(getProjectImagesDir(projectPath, project), getTrackFolderName(track, trackIndex));
}

function updateImageFolderInRelativePath(relativePath, imagesFolderName, fallbackFileName) {
  const normalizedRelativePath = String(relativePath || '').replace(/\\/g, '/');
  const pathParts = normalizedRelativePath.split('/').filter(Boolean);
  const restParts = pathParts.length > 1 ? pathParts.slice(1) : [fallbackFileName];
  return path.posix.join(imagesFolderName, ...restParts);
}

async function findNextImageName(trackDir, track, trackPrefix, extension) {
  let index = Array.isArray(track.images) ? track.images.length : 0;

  while (true) {
    const version = getImageVersion(index);
    const fileName = `${trackPrefix}_${version}${extension}`;
    const destinationPath = path.join(trackDir, fileName);
    const usedInProject = Array.isArray(track.images)
      ? track.images.some((image) => image.fileName === fileName || image.version === version)
      : false;

    if (!usedInProject && !(await fileExists(destinationPath))) {
      return { version, fileName, destinationPath };
    }

    index += 1;
  }
}

async function renameTrackImageFiles(projectPath, project, trackId, newPrefix) {
  const workingProject = normalizeProject(project);
  const track = workingProject.tracks.find((item) => item.id === trackId);

  if (!track) {
    throw new Error('没有找到目标轨道');
  }

  const cleanPrefix = sanitizeImagePrefix(newPrefix);
  const renameJobs = track.images.map((image) => {
    const oldRelativePath = image.relativePath;
    const oldAbsolutePath = path.join(projectPath, oldRelativePath);
    const extension = path.extname(image.fileName) || path.extname(oldRelativePath) || '.png';
    const newFileName = `${cleanPrefix}_${image.version}${extension}`;
    const newRelativePath = path.posix.join(path.posix.dirname(oldRelativePath.replace(/\\/g, '/')), newFileName);
    const newAbsolutePath = path.join(projectPath, newRelativePath);

    return {
      image,
      oldAbsolutePath,
      newAbsolutePath,
      newFileName,
      newRelativePath
    };
  });

  for (const job of renameJobs) {
    if (job.oldAbsolutePath !== job.newAbsolutePath && (await fileExists(job.newAbsolutePath))) {
      throw new Error(`已经存在同名文件：${job.newFileName}`);
    }
  }

  for (const job of renameJobs) {
    if (job.oldAbsolutePath !== job.newAbsolutePath) {
      await fs.rename(job.oldAbsolutePath, job.newAbsolutePath);
    }

    job.image.fileName = job.newFileName;
    job.image.relativePath = job.newRelativePath;
  }

  track.prefix = cleanPrefix;
  const savedProject = await saveProject(projectPath, workingProject);
  return savedProject;
}

async function renameTrackFolder(projectPath, project, trackId, newTrackName) {
  const workingProject = normalizeProject(project);
  const trackIndex = workingProject.tracks.findIndex((item) => item.id === trackId);

  if (trackIndex === -1) {
    throw new Error('Track not found');
  }

  const track = workingProject.tracks[trackIndex];
  const cleanName = String(newTrackName || '').trim();
  const cleanFolderName = sanitizeFolderName(cleanName);
  const oldFolderName = getTrackFolderName(track, trackIndex);
  const imagesDir = getProjectImagesDir(projectPath, workingProject);
  const oldFolderPath = path.join(imagesDir, oldFolderName);
  const newFolderPath = path.join(imagesDir, cleanFolderName);

  if (newFolderPath !== oldFolderPath && (await fileExists(newFolderPath))) {
    throw new Error(`Already exists: ${cleanFolderName}`);
  }

  await ensureDir(imagesDir);

  if (await fileExists(oldFolderPath)) {
    if (newFolderPath !== oldFolderPath) {
      await fs.rename(oldFolderPath, newFolderPath);
    }
  } else {
    await ensureDir(newFolderPath);
  }

  track.name = cleanName || cleanFolderName;
  track.folderName = cleanFolderName;
  track.images = track.images.map((image) => ({
    ...image,
    relativePath: path.posix.join(workingProject.imagesFolderName, cleanFolderName, path.posix.basename(image.relativePath.replace(/\\/g, '/')))
  }));

  workingProject.tracks[trackIndex] = track;
  const savedProject = await saveProject(projectPath, workingProject);
  return savedProject;
}

async function renameImagesFolder(projectPath, project, newFolderName) {
  const workingProject = normalizeProject(project);
  const cleanFolderName = sanitizeFolderName(newFolderName);
  const oldFolderName = workingProject.imagesFolderName || DEFAULT_IMAGES_FOLDER;
  const oldFolderPath = path.join(projectPath, oldFolderName);
  const newFolderPath = path.join(projectPath, cleanFolderName);

  if (newFolderPath !== oldFolderPath && (await fileExists(newFolderPath))) {
    throw new Error(`Already exists: ${cleanFolderName}`);
  }

  if (await fileExists(oldFolderPath)) {
    if (newFolderPath !== oldFolderPath) {
      await fs.rename(oldFolderPath, newFolderPath);
    }
  } else {
    await ensureDir(newFolderPath);
  }

  workingProject.imagesFolderName = cleanFolderName;
  workingProject.tracks = workingProject.tracks.map((track) => ({
    ...track,
    images: track.images.map((image) => ({
      ...image,
      relativePath: updateImageFolderInRelativePath(image.relativePath, cleanFolderName, image.fileName)
    }))
  }));

  const savedProject = await saveProject(projectPath, workingProject);
  return savedProject;
}

async function renameProject(projectPath, project, newProjectName) {
  const cleanName = String(newProjectName || '').trim();
  if (!cleanName) {
    throw new Error('Project name cannot be empty');
  }

  const workingProject = {
    ...normalizeProject(project),
    projectName: cleanName
  };

  return saveProject(projectPath, workingProject);
}

async function deleteProjectRecord(projectPath) {
  const projectJsonPath = getProjectJsonPath(projectPath);

  if (await fileExists(projectJsonPath)) {
    await fs.unlink(projectJsonPath);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

ipcMain.handle('project:choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择文件夹创建 ImageRail 项目',
    buttonLabel: '创建项目',
    message: '请选择一个外层文件夹。ImageRail 会在这个文件夹里创建图片总文件夹。',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const projectPath = result.filePaths[0];
  const project = await readProject(projectPath);
  await ensureDir(getProjectImagesDir(projectPath, project));
  return { projectPath, project };
});

ipcMain.handle('project:list', async () => {
  return listProjectSummaries();
});

ipcMain.handle('project:open-existing', async (_event, projectPath) => {
  const project = await readProject(projectPath);
  await ensureDir(getProjectImagesDir(projectPath, project));
  return { projectPath, project };
});

ipcMain.handle('project:save', async (_event, { projectPath, project }) => {
  const savedProject = await saveProject(projectPath, project);
  return { projectPath, project: savedProject };
});

ipcMain.handle('track:rename-folder', async (_event, { projectPath, project, trackId, newTrackName }) => {
  const savedProject = await renameTrackFolder(projectPath, project, trackId, newTrackName);
  return { projectPath, project: savedProject };
});

ipcMain.handle('project:rename-images-folder', async (_event, { projectPath, project, newFolderName }) => {
  const savedProject = await renameImagesFolder(projectPath, project, newFolderName);
  return { projectPath, project: savedProject };
});

ipcMain.handle('project:rename', async (_event, { projectPath, project, newProjectName }) => {
  const savedProject = await renameProject(projectPath, project, newProjectName);
  return { projectPath, project: savedProject };
});

ipcMain.handle('project:delete-record', async (_event, projectPath) => {
  await deleteProjectRecord(projectPath);
  return { projectPath };
});

ipcMain.handle('image:add-to-track', async (_event, { projectPath, project, trackId, sourcePath }) => {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('只能拖入图片文件：png、jpg、jpeg、webp、gif、bmp');
  }

  const workingProject = normalizeProject(project);
  const trackIndex = workingProject.tracks.findIndex((track) => track.id === trackId);
  if (trackIndex === -1) {
    throw new Error('没有找到目标轨道');
  }

  const track = workingProject.tracks[trackIndex];
  const trackLetter = track.letter || getTrackLetter(trackIndex);
  const trackPrefix = sanitizeImagePrefix(track.prefix || trackLetter);
  const trackDir = getTrackDir(projectPath, workingProject, track, trackIndex);
  await ensureDir(trackDir);

  const { version, destinationPath } = await findNextImageName(trackDir, track, trackPrefix, extension);
  await fs.copyFile(sourcePath, destinationPath);

  const imageRecord = {
    id: `img_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    fileName: path.basename(destinationPath),
    version,
    relativePath: path.relative(projectPath, destinationPath).replace(/\\/g, '/'),
    note: '',
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  track.images = Array.isArray(track.images) ? track.images : [];
  track.images.push(imageRecord);
  workingProject.tracks[trackIndex] = track;
  const savedProject = await saveProject(projectPath, workingProject);

  return { projectPath, project: savedProject, image: imageRecord };
});

ipcMain.handle('image:rename-track-prefix', async (_event, { projectPath, project, trackId, newPrefix }) => {
  const savedProject = await renameTrackImageFiles(projectPath, project, trackId, newPrefix);
  return { projectPath, project: savedProject };
});
