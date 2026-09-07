const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Load the production functions without starting the desktop event bindings.
const source = readFileSync(join(__dirname, '../src/renderer/renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const startup = source.indexOf('\napplyComparePanelWidth();\n');
assert.ok(startup > 0, 'renderer startup boundary must exist');

function setup(save = async ({ project }) => ({ project })) {
  const timers = new Map();
  const messages = [];
  let nextTimer = 0;
  let closeCount = 0;
  const context = vm.createContext({
    CSS: { escape: (value) => value },
    localStorage: { getItem: () => null },
    document: { querySelector: () => null },
    window: {
      setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout(id) { timers.delete(id); },
      imageRail: {
        saveProject: save,
        closeWindow: async () => { closeCount += 1; }
      }
    },
    messages
  });
  vm.runInContext(source.slice(0, startup), context);
  vm.runInContext(`
    render = () => {};
    renderComparePanel = () => {};
    commitUndo = () => {};
    showAppMessage = (message) => messages.push(message);
    elements.tracks = { querySelector: () => null };
    state.projectPath = 'C:/project';
    state.project = {
      projectId: 'project', projectDataFile: 'project.json',
      tracks: [{ id: 'track-a', letter: 'A', folderName: 'track_A',
        images: [{ id: 'image-a', note: 'old', status: 'pending' }] }]
    };
    globalThis.model = state;
  `, context);
  return { context, state: context.model, messages, timers, get closeCount() { return closeCount; } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a delayed save cannot overwrite newer debounced notes', async () => {
  const started = deferred();
  const response = deferred();
  const payloads = [];
  const app = setup(async (payload) => {
    payloads.push(payload);
    if (payloads.length === 1) {
      started.resolve();
      await response.promise;
    }
    return { project: payload.project };
  });
  const firstSave = app.context.saveProject({ silent: true });
  await started.promise;
  app.context.updateImage('track-a', 'image-a', { note: 'new typing' });
  response.resolve();
  await firstSave;
  assert.equal(app.state.project.tracks[0].images[0].note, 'new typing');
  await app.context.waitForProjectOperations();
  assert.equal(payloads[1].project.tracks[0].images[0].note, 'new typing');
  assert.equal(app.timers.size, 0);
});

test('an unchanged project accepts normalized backend fields', async () => {
  const app = setup(async ({ project }) => ({ project: { ...project, updatedAt: '123' } }));
  await app.context.saveProject();
  assert.equal(app.state.project.updatedAt, '123');
});

test('queued saves snapshot the project after earlier operations finish', async () => {
  const app = setup();
  app.context.enqueueProjectOperation(() => { app.state.project.projectName = 'renamed'; });
  await app.context.saveProject();
  assert.equal(app.state.project.projectName, 'renamed');
});

test('failed debounced save blocks closing and preserves edits for retry', async () => {
  let fail = true;
  const app = setup(async ({ project }) => {
    if (fail) throw new Error('disk full');
    return { project };
  });
  app.context.updateImage('track-a', 'image-a', { note: 'keep me' });
  await app.context.closeApplication();
  assert.equal(app.closeCount, 0);
  assert.equal(app.state.closeInProgress, false);
  assert.equal(app.state.project.tracks[0].images[0].note, 'keep me');
  assert.ok(app.messages.some((message) => message.includes('disk full')));
  fail = false;
  await app.context.closeApplication();
  assert.equal(app.closeCount, 1);
  assert.equal(app.state.saveError, null);
});

test('a successful cleanup after a failed save does not allow project switching', async () => {
  const app = setup(async () => { throw new Error('disk full'); });
  await app.context.saveProject();
  await app.context.enqueueProjectOperation(async () => {});
  await assert.rejects(app.context.waitForProjectOperations(), /disk full/);
});

test('a save response from another project does not replace the current project', async () => {
  const started = deferred();
  const response = deferred();
  const app = setup(async ({ project }) => { started.resolve(); await response.promise; return { project }; });
  const saving = app.context.saveProject();
  await started.promise;
  app.state.projectPath = 'C:/other';
  app.state.project = { projectName: 'other', tracks: [] };
  response.resolve();
  await saving;
  assert.equal(app.state.project.projectName, 'other');
});

test('creating a track after deleting the middle track does not reuse an occupied folder', async () => {
  const app = setup();
  app.state.project.tracks = [
    { id: 'a', letter: 'A', folderName: 'track_A', images: [] },
    { id: 'c', letter: 'C', folderName: 'track_C', images: [] }
  ];
  app.context.createTrack();
  await app.context.waitForProjectOperations();
  assert.equal(app.state.project.tracks[2].folderName, 'track_D');
});

test('track allocation checks renamed folders case-insensitively and handles T27+', async () => {
  const app = setup();
  app.state.project.tracks = Array.from({ length: 26 }, (_, index) => ({
    id: String(index), letter: app.context.getTrackLetter(index), images: [],
    folderName: index === 0 ? 'TRACK_t27' : `track_${app.context.getTrackLetter(index)}`
  }));
  app.context.createTrack();
  await app.context.waitForProjectOperations();
  assert.equal(app.state.project.tracks[26].folderName, 'track_T28');
});

test('track allocation honors legacy tracks without explicit folder names', async () => {
  const app = setup();
  app.state.project.tracks = [{ id: 'b', letter: 'B', images: [] }];
  app.context.createTrack();
  await app.context.waitForProjectOperations();
  assert.equal(app.state.project.tracks[1].folderName, 'track_C');
});

test('closing waits for a save already in flight and stops if it fails', async () => {
  const started = deferred();
  const response = deferred();
  const app = setup(async () => { started.resolve(); return response.promise; });
  const saving = app.context.saveProject();
  await started.promise;
  const closing = app.context.closeApplication();
  response.reject(new Error('write failed'));
  await Promise.all([saving, closing]);
  assert.equal(app.closeCount, 0);
  assert.equal(app.state.closeInProgress, false);
});

test('reconciliation preserves unchanged cards, reorders, replaces and removes correctly', () => {
  const app = setup();
  const lane = {
    children: [],
    querySelectorAll() { return [...this.children]; },
    querySelector(selector) {
      assert.equal(selector, '.drop-hint', 'must not scan the lane once per image');
      return null;
    },
    insertBefore(card, target) {
      card.remove();
      const index = target ? this.children.indexOf(target) : this.children.length;
      this.children.splice(index, 0, card);
    }
  };
  function cardFor(trackId, image) {
    const card = {
      dataset: { imageId: image.id, renderKey: app.context.imageCardRenderKey(trackId, image) },
      classList: { toggle() {} },
      remove() {
        const index = lane.children.indexOf(card);
        if (index >= 0) lane.children.splice(index, 1);
      },
      replaceWith(replacement) { lane.children.splice(lane.children.indexOf(card), 1, replacement); }
    };
    return card;
  }
  const images = [{ id: 'a' }, { id: 'b', note: 'old' }, { id: 'deleted' }];
  const originals = images.map((image) => cardFor('track', image));
  lane.children.push(...originals);
  app.context.createImageCard = cardFor;
  app.context.reconcileTrackImages({ querySelector: () => lane }, {
    id: 'track', images: [{ id: 'b', note: 'new' }, { id: 'a' }, { id: 'added' }]
  });
  assert.deepEqual(lane.children.map((card) => card.dataset.imageId), ['b', 'a', 'added']);
  assert.equal(lane.children[1], originals[0]);
  assert.notEqual(lane.children[0], originals[1]);
  assert.ok(!lane.children.includes(originals[2]));
});
