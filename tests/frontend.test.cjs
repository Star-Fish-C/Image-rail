const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { SaveController } = require('../src/renderer/save-controller.js');
const { runSequentialImport } = require('../src/renderer/import-batch.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('organize collapses mixed tracks, expands fully collapsed tracks and respects import lock', () => {
  const labels = [];
  const context = { state: {project:{tracks:[{collapsed:false},{collapsed:true}]}}, captureUndo:label=>{labels.push(label);}, requestProjectSave:()=>{}, commitUndo:()=>{}, render:()=>{} };
  vm.createContext(context);
  vm.runInContext(sourceFunction('toggleAllTracks'),context);
  context.toggleAllTracks();
  assert.ok(context.state.project.tracks.every(track=>track.collapsed));
  context.toggleAllTracks();
  assert.ok(context.state.project.tracks.every(track=>!track.collapsed));
  context.state.project.tracks[0].collapsed = true;
  context.toggleAllTracks();
  assert.ok(context.state.project.tracks.every(track=>track.collapsed));
  context.state.importBatch = {};
  context.toggleAllTracks();
  assert.ok(context.state.project.tracks.every(track=>track.collapsed));
  assert.deepEqual(labels,['收起全部轨道','展开全部轨道','收起全部轨道']);
});

test('editing during an in-flight save is drained without overwriting current state', async () => {
  let note = 'first';
  const writes = [], releases = [];
  const saves = new SaveController(() => { writes.push(note); return new Promise(r => releases.push(r)); });
  saves.markDirty();
  const pending = saves.flush();
  note = 'second'; saves.markDirty();
  note = 'latest'; saves.markDirty();
  assert.equal(saves.flush(), pending);
  releases.shift()(); await tick();
  assert.deepEqual(writes, ['first', 'latest']);
  releases.shift()(); await pending;
  assert.equal(note, 'latest');
  assert.equal(saves.dirty, false);
});

test('failed saves retain dirty state and can be retried', async () => {
  let fail = true;
  const saves = new SaveController(async () => { if (fail) throw new Error('disk full'); });
  saves.markDirty();
  await assert.rejects(saves.flush(), /disk full/);
  assert.equal(saves.dirty, true);
  fail = false;
  await saves.flush();
  assert.equal(saves.dirty, false);
});

function sourceFunction(name) {
  const source = fs.readFileSync(require.resolve('../src/renderer/renderer.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
}

test('actual close handler keeps the window open after flush failure', async () => {
  let closed = false, reported = false;
  const context = { state: {}, waitForProjectOperations: async () => { throw Error('disk full'); }, window: { imageRail: { closeWindow: async () => { closed = true; } } }, getErrorText: e => e.message, showAppMessage: () => { reported = true; } };
  vm.createContext(context);
  vm.runInContext(sourceFunction('closeApplication'), context);
  await context.closeApplication();
  assert.equal(closed, false);
  assert.equal(reported, true);
  assert.equal(context.state.closeInProgress, false);
});

test('batch cancellation finishes the current item, starts no more, and preserves successes', async () => {
  let cancelled = false, release;
  const imported = [], started = [];
  const pending = runSequentialImport([{ name: 'a' }, { name: 'b' }], {
    cancelled: () => cancelled,
    importOne: item => { started.push(item.name); return new Promise(r => release = () => r(item)); },
    onSuccess: item => imported.push(item.name), onProgress: () => {}
  });
  cancelled = true; release();
  const result = await pending;
  assert.deepEqual(started, ['a']); assert.deepEqual(imported, ['a']);
  assert.equal(result.succeeded, 1);
});

test('batch failures are collected per file while subsequent files continue', async () => {
  const progress = [], imported = [];
  const result = await runSequentialImport([{ name: 'bad' }, { name: 'good' }], {
    cancelled: () => false,
    importOne: async item => { if (item.name === 'bad') throw Error('invalid file'); return item; },
    onSuccess: item => imported.push(item.name), onProgress: done => progress.push(done)
  });
  assert.deepEqual(imported, ['good']); assert.deepEqual(progress, [1,2]);
  assert.equal(result.failures[0].name, 'bad');
});

test('metadata responses for an old preview cannot overwrite the current preview', async () => {
  let resolve;
  const elements = { compareContent: { dataset: { signature: 'old' } }, compareNoteInput: { dataset: { imageId: 'old' } }, compareSizeText: { textContent: 'new size' }, compareDimensionsText: {} };
  const context = { elements, state: { compareMode: 'single', projectPath: 'test' }, window: { imageRail: { getImageFileMetadata: () => new Promise(r => resolve = r) } }, formatFileSize: String };
  vm.createContext(context); vm.runInContext(sourceFunction('updateCompareDetailsMetadata'), context);
  context.updateCompareDetailsMetadata({ image: { id: 'old', relativePath: 'old.png' } }, { querySelector: () => ({ complete: true, naturalWidth: 10, naturalHeight: 10 }) }, 'old');
  elements.compareContent.dataset.signature = 'new'; elements.compareNoteInput.dataset.imageId = 'new';
  resolve({ sizeBytes: 100 }); await tick();
  assert.equal(elements.compareSizeText.textContent, 'new size');
});

// PR #1's allocation scenarios, applied to the integrated production functions.
for (const [name, tracks, expected] of [
  ['deleted middle track', [{letter:'A',folderName:'track_A'},{letter:'C',folderName:'track_C'}], 'track_D'],
  ['legacy folder default', [{letter:'B'}], 'track_C'],
  ['case insensitive folder', [{letter:'A',folderName:'TRACK_B'}], 'track_C'],
  ['T27 and later', Array.from({length:26}, (_,i)=>({letter:String.fromCharCode(65+i),folderName:i===0?'TRACK_t27':'track_'+String.fromCharCode(65+i)})), 'track_T28']
]) {
  test('PR #1: unique track allocation: '+name, () => {
    const context = { state: { project: { tracks: tracks.map((track,i)=>({...track,id:String(i),images:[]})) } }, captureUndo:()=>null, makeId:()=> 'new', requestProjectSave:()=>{}, commitUndo:()=>{}, render:()=>{} };
    vm.createContext(context);
    vm.runInContext(sourceFunction('getTrackLetter')+'\n'+sourceFunction('createTrack'), context);
    context.createTrack();
    assert.equal(context.state.project.tracks.at(-1).folderName,expected);
  });
}

test('failed save cannot be hidden by a later successful cleanup operation', async () => {
  const saves = new SaveController(async()=>{throw Error('disk full');});
  saves.markDirty();
  await assert.rejects(saves.flush());
  const context = { state:{ projectOperationPromise: Promise.resolve() }, flushScheduledProjectSave:()=>saves.flush() };
  vm.createContext(context); vm.runInContext(sourceFunction('waitForProjectOperations'),context);
  await assert.rejects(context.waitForProjectOperations(),/disk full/);
});

test('thumbnail scheduling is bounded, skips collapsed tracks and releases stale results', async () => {
  const releases = [], requests = [];
  const api = {
    getImageThumbnail: payload => new Promise(resolve => requests.push({payload,resolve})),
    releaseImageThumbnails: async ids => releases.push(...ids), fileUrlFromPath: value=>value
  };
  const context = { crypto:{randomUUID:()=> 'test'}, IntersectionObserver: class {observe(){} unobserve(){} disconnect(){}}, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/renderer/thumbnails.js'),'utf8')+'\nglobalThis.Loader=ThumbnailLoader;',context);
  const loader = new context.Loader({clientWidth:800,clientHeight:600},api);
  const lane={isConnected:true};
  const cards = Array.from({length:4},()=>({isConnected:true,dataset:{},closest:selector=>selector==='.track-lane'?lane:null,querySelector:()=>({})}));
  const imgs = cards.map(()=>({removeAttribute(){delete this.src;},decode:async()=>{}}));
  for(let i=0;i<cards.length;i++) {
    loader.observe(cards[i],imgs[i],'project',`image-${i}.png`);
    const entry=loader.entries.get(cards[i]);entry.vertical=entry.horizontal=true;loader.update(entry);
  }
  assert.equal(requests.length,2);
  cards.forEach(card=>card.isConnected=false);loader.clear();
  requests.forEach(request=>request.resolve({cachePath:'cache.png'}));
  await tick();await tick();
  assert.equal(requests.length,2);assert.equal(releases.length,2);
  assert.ok(imgs.every(img=>!img.src));
  const collapsed={isConnected:true,dataset:{},closest:selector=>selector==='.track-lane'?lane:{},querySelector:()=>({})};
  loader.observe(collapsed,{removeAttribute(){}},'project','collapsed.png');
  const entry=loader.entries.get(collapsed);entry.vertical=entry.horizontal=true;loader.update(entry);
  assert.equal(requests.length,2);
});
