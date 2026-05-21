const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

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

app.whenReady().then(createWindow);

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
    appName: 'ImageRail',
    projectName: '',
    imagesFolderName: 'images',
    version: 1,
    updatedAt: new Date().toISOString(),
    tracks: []
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
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
    appName: project.appName || 'ImageRail',
    projectName: project.projectName || '',
    imagesFolderName: project.imagesFolderName || 'images',
    version: project.version || 1,
    updatedAt: project.updatedAt || new Date().toISOString(),
    tracks: Array.isArray(project.tracks)
      ? project.tracks.map((track, index) => ({
          ...track,
          letter: track.letter || getTrackLetter(index),
          prefix: track.prefix || track.letter || getTrackLetter(index),
          folderName: track.folderName || `track_${track.letter || getTrackLetter(index)}`,
          name: track.name || `轨道 ${track.letter || getTrackLetter(index)}`,
          images: Array.isArray(track.images) ? track.images : []
        }))
      : []
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

function getImagesFolderName(project) {
  return normalizeProject(project).imagesFolderName || 'images';
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
  const imagesDir = path.join(projectPath, workingProject.imagesFolderName);
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
  const oldFolderName = workingProject.imagesFolderName || 'images';
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
    images: track.images.map((image) => {
      const normalizedRelativePath = image.relativePath.replace(/\\/g, '/');
      const pathParts = normalizedRelativePath.split('/');
      const restParts = pathParts.length > 1 ? pathParts.slice(1) : [image.fileName];

      return {
        ...image,
        relativePath: path.posix.join(cleanFolderName, ...restParts)
      };
    })
  }));

  const savedProject = await saveProject(projectPath, workingProject);
  return savedProject;
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
    title: '选择 ImageRail 项目文件夹',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const projectPath = result.filePaths[0];
  const project = await readProject(projectPath);
  await ensureDir(path.join(projectPath, project.imagesFolderName || 'images'));
  return { projectPath, project };
});

ipcMain.handle('project:load', async (_event, projectPath) => {
  const project = await readProject(projectPath);
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
  const trackDir = path.join(projectPath, workingProject.imagesFolderName, getTrackFolderName(track, trackIndex));
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
