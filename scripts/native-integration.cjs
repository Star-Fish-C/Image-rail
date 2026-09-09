const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function check(page, root) {
  const folder = path.join(root,'.perf','integration-'+Date.now());
  fs.mkdirSync(folder,{recursive:true});
  const project = { projectName:'Integration',projectId:'integration',projectDataFile:'project_integration.json',imagesFolderName:'',tracks:[{id:'track-a',letter:'A',prefix:'A',folderName:'track_A',name:'Track A',images:[]}] };
  await page.evaluate(async ({folder,project}) => {
    const saved = await window.imageRail.saveProject({projectPath:folder,project});
    setProject(folder,saved.project); closeProjectModal();
  },{folder,project});
  const source = path.join(root,'tests/fixtures/sample.png');
  await page.evaluate(source => {
    window.importProgressSamples=[];
    const observer=new MutationObserver(()=>window.importProgressSamples.push(document.querySelector('#importProgressText').textContent));
    observer.observe(document.querySelector('#importProgressText'),{childList:true});
    window.importCheck = importItemsToTrack(Array.from({length:50},(_,i)=>({path:source,name:`input-${i}.png`,size:200})), 'track-a');
    window.editWasLocked = document.querySelector('#newTrackButton').disabled;
    createTrack();
  },source);
  await page.evaluate(()=>window.importCheck);
  const imported = await page.evaluate(()=>({count:state.project.tracks[0].images.length,tracks:state.project.tracks.length,locked:window.editWasLocked,progress:window.importProgressSamples,files:state.project.tracks[0].images.map(i=>i.relativePath)}));
  assert.equal(imported.count,50); assert.equal(imported.tracks,1); assert.equal(imported.locked,true);
  assert.ok(imported.progress.some(s=>s.includes('50 / 50')));
  imported.files.forEach(file=>assert.ok(fs.existsSync(path.join(folder,file))));
  await page.waitForFunction(()=>document.querySelector('[data-thumbnail="ready"]'),null,{timeout:20000});

  const retained = await page.evaluate(async()=>{
    const image=state.project.tracks[0].images[0];
    selectImage(image.id); refreshSelectedImageView();
    const viewport=document.querySelector('.compare-image-button');
    const original=viewport.querySelector('img');
    await original.decode();
    applyViewportZoom(viewport,2); applyViewportPan(viewport,13,27);
    updateImage('track-a',image.id,{status:'usable'});
    await waitForProjectOperations();
    const current=document.querySelector('.compare-image-button');
    return {same:current===viewport,sameImage:current.querySelector('img')===original,zoom:current.dataset.zoom,panX:current.dataset.panX};
  });
  assert.equal(retained.same,true); assert.equal(retained.sameImage,true); assert.equal(retained.zoom,'2'); assert.equal(retained.panX,'13');

  const savedNote = await page.evaluate(async()=>{
    const real=window.imageRail.saveProject;
    let release, started;
    const begun=new Promise(resolve=>started=resolve);
    let calls=0;
    window.imageRail.saveProject=async payload=>{
      const result=await real(payload);
      if(++calls===1) { started(); await new Promise(resolve=>release=resolve); }
      return result;
    };
    const image=state.project.tracks[0].images[0];
    const pending=saveProject({silent:true}); await begun;
    updateImage('track-a',image.id,{note:'new typing during save'}); release();
    await pending; await waitForProjectOperations();
    window.imageRail.saveProject=real;
    const disk=await window.imageRail.reloadProject(state.project.projectDataFile);
    return {memory:image.note,disk:disk.tracks[0].images[0].note,calls};
  });
  assert.equal(savedNote.memory,'new typing during save'); assert.equal(savedNote.disk,savedNote.memory); assert.equal(savedNote.calls,2);

  const cancelled = await page.evaluate(async source=>{
    const real=window.imageRail.addImageToTrack;
    let started,release;
    const begun=new Promise(resolve=>started=resolve);
    window.imageRail.addImageToTrack=async payload=>{started();await new Promise(resolve=>release=resolve);return real(payload);};
    const before=state.project.tracks[0].images.length;
    const pending=importItemsToTrack(Array.from({length:5},()=>({path:source,name:'cancel.png',size:200})),'track-a');
    await begun; document.querySelector('#cancelImportButton').click();release();await pending;
    window.imageRail.addImageToTrack=real;
    return state.project.tracks[0].images.length-before;
  },source);
  assert.equal(cancelled,1);

  const partial = await page.evaluate(async ({source,folder})=>{
    const before=state.project.tracks[0].images.length;
    await importItemsToTrack([{path:folder+'/missing.png',name:'missing.png',size:1},{path:source,name:'success.png',size:200}],'track-a');
    const after=state.project.tracks[0].images.length;
    const message=document.querySelector('#appMessageText').textContent;
    closeAppMessage(); await undoLastAction();
    return {added:after-before,restored:state.project.tracks[0].images.length===before,message};
  },{source,folder});
  assert.equal(partial.added,1);assert.equal(partial.restored,true);assert.match(partial.message,/missing.png/);

  const blocked = await page.evaluate(async()=>{
    const real=window.imageRail.saveProject, realClose=window.imageRail.closeWindow;
    let closed=false;
    window.imageRail.saveProject=async()=>{throw Error('test disk full');};
    window.imageRail.closeWindow=async()=>{closed=true;};
    updateImage('track-a',state.project.tracks[0].images[0].id,{note:'preserve failure'});
    await closeApplication();
    const result={closed,dirty:projectSaves.dirty};
    window.imageRail.saveProject=real;window.imageRail.closeWindow=realClose;
    await waitForProjectOperations();closeAppMessage();
    return result;
  });
  assert.deepEqual(blocked,{closed:false,dirty:true});

  const failedImport = await page.evaluate(async source=>{
    const realSave=window.imageRail.saveProject,realImport=window.imageRail.addImageToTrack;
    let calls=0;
    window.imageRail.saveProject=async()=>{throw Error('test disk full');};
    window.imageRail.addImageToTrack=async payload=>{calls++;return realImport(payload);};
    updateImage('track-a',state.project.tracks[0].images[0].id,{note:'must survive failed import'});
    await importItemsToTrack([{path:source,name:'blocked.png',size:100}],'track-a');
    const result={calls,note:state.project.tracks[0].images[0].note};
    window.imageRail.saveProject=realSave;window.imageRail.addImageToTrack=realImport;
    await waitForProjectOperations();closeAppMessage();return result;
  },source);
  assert.deepEqual(failedImport,{calls:0,note:'must survive failed import'});

  // Raw IPC bytes and each supported format go through the real Rust importer and cache.
  const formats=[];
  for(const ext of ['png','jpg','jpeg','webp','gif','bmp','avif']) {
    const bytes=[...fs.readFileSync(path.join(root,'tests/fixtures',`sample.${ext}`))];
    const result=await page.evaluate(async({bytes,ext})=>{
      await importItemsToTrack([new File([new Uint8Array(bytes)],'sample.'+ext)],'track-a');
      const image=state.project.tracks[0].images.at(-1);
      const thumb=await window.imageRail.getImageThumbnail({projectPath:state.projectPath,relativePath:image.relativePath,leaseId:'format-'+ext});
      await window.imageRail.releaseImageThumbnails(['format-'+ext]);
      return thumb;
    },{bytes,ext});
    assert.equal(result.width,64);assert.equal(result.height,32);formats.push(ext);
  }
  const corrupt = await page.evaluate(async()=>{
    await importItemsToTrack([new File(['not an image'],'corrupt.png')],'track-a');
    const image=state.project.tracks[0].images.at(-1);
    try { await window.imageRail.getImageThumbnail({projectPath:state.projectPath,relativePath:image.relativePath,leaseId:'corrupt'});return {rejected:false}; }
    catch { return {rejected:true,path:image.relativePath}; }
  });
  assert.equal(corrupt.rejected,true);assert.ok(fs.existsSync(path.join(folder,corrupt.path)));
  const server = require('node:http').createServer((request,response)=>{
    if(request.url==='/large.png') { response.writeHead(200,{'Content-Type':'image/png','Content-Length':104857601});response.end();return; }
    if(request.url==='/missing.png') { response.writeHead(404);response.end();return; }
    response.writeHead(200,{'Content-Type':'image/png'});response.end(fs.readFileSync(source));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url='http://127.0.0.1:'+server.address().port;
    const remote = await page.evaluate(async url=>{
      const before=state.project.tracks[0].images.length;
      await importItemsToTrack(['valid.png','large.png','missing.png'].map(name=>({url:url+'/'+name,name})),'track-a');
      const result={added:state.project.tracks[0].images.length-before,message:document.querySelector('#appMessageText').textContent};
      closeAppMessage();return result;
    },url);
    assert.equal(remote.added,1);assert.match(remote.message,/100 MB/);assert.match(remote.message,/missing.png/);
  } finally { await new Promise(resolve=>server.close(resolve)); }
  const workbench = await page.evaluate(async () => {
    if (state.showImageInfo) toggleImageInfo();
    elements.toggleInfoButton.click();
    const first = state.project.tracks[0].images[0];
    const next = state.project.tracks[0].images[1];
    selectImage(first.id); refreshSelectedImageView();
    const original = document.querySelector('.compare-image-button');
    elements.toggleInfoButton.click(); elements.toggleInfoButton.click();
    const retained = document.querySelector('.compare-image-button') === original;
    state.compareMode = 'compare'; state.pinnedCompareImageId = first.id;
    selectImage(next.id); refreshSelectedImageView();
    const survivesComparison = !elements.compareDetails.hidden && elements.compareNoteInput.dataset.imageId === next.id;
    toggleAllTracks();
    await waitForProjectOperations();
    const collapsed = state.project.tracks.every(track => track.collapsed);
    await undoLastAction();
    const restored = state.project.tracks.every(track => !track.collapsed);
    const snapshot = cloneProject();
    setProject(state.projectPath, snapshot);
    const survivesProject = !elements.compareDetails.hidden && state.showImageInfo;
    selectImage(first.id); refreshSelectedImageView();
    return {retained,survivesComparison,collapsed,restored,survivesProject,persisted:localStorage.getItem('imagerail.showImageInfo'),path:elements.projectPathText.textContent===state.projectPath};
  });
  assert.deepEqual(workbench,{retained:true,survivesComparison:true,collapsed:true,restored:true,survivesProject:true,persisted:'true',path:true});
  await page.setViewportSize({width:980,height:640});
  const fits = await page.evaluate(() => {
    const toolbar = document.querySelector('.workbench-toolbar').getBoundingClientRect();
    const details = elements.compareDetails.getBoundingClientRect();
    const note = elements.compareNoteInput.getBoundingClientRect();
    return toolbar.right <= innerWidth && details.bottom <= innerHeight && note.width > 100
      && elements.compareContent.getBoundingClientRect().height > 150;
  });
  assert.equal(fits,true,'toolbar, preview and open information panel fit the minimum window');
  await require('./workbench-checks.cjs')(page);
  await page.setViewportSize({width:1280,height:820});
  await page.screenshot({path:path.join(root,'.perf/integration.png')});
  return {passed:['50 sequential imports and progress','editing lock','original viewport retained on status change','in-flight note save','cancel after current image','partial failure and undo','failed close and retry','save failure blocks import (PR #1 omission)','raw IPC and seven image formats','thumbnail failure preserves imported file','HTTP image import, oversize rejection and 404 aggregation'],formats};
};
