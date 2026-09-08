// Usage: NODE_PATH=<playwright modules> IMAGERAIL_PYTHON=<python> node scripts/native-benchmark.cjs baseline|optimized label
// Launches only the isolated .perf executable, using generated data (never a user project).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const [variant = 'optimized', label = variant] = process.argv.slice(2);
if (!['baseline', 'optimized'].includes(variant) || !/^[a-z0-9-]+$/i.test(label)) throw Error('Invalid variant/label');
const appDir = path.join(root, '.perf', variant);
const project = JSON.parse(fs.readFileSync(path.join(root, '.perf/project.json')));
const records = path.join(appDir, 'project-data/projects');
fs.mkdirSync(records, { recursive: true });
fs.writeFileSync(path.join(records, project.projectDataFile), JSON.stringify(project));
const port = 9335;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const appLog = fs.openSync(path.join(root, '.perf', `${label}-app.log`), 'w');
  const app = spawn(path.join(appDir, 'imagerail.exe'), [], {
    cwd: appDir, windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: path.join(root, '.perf', `profile-${label}`) },
    stdio: ['ignore', appLog, appLog]
  });
  let browser, monitor;
  const errors = [];
  try {
    for (let attempt=0; attempt<300; attempt++) {
      if (app.exitCode !== null) throw Error(`App exited: ${app.exitCode}; see ${label}-app.log`);
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await sleep(100); }
    }
    if (!browser) throw Error('WebView2 debugger unavailable');
    const context = browser.contexts()[0];
    let page = context.pages()[0];
    if (!page) page = await context.waitForEvent('page');
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => typeof window.imageRail !== 'undefined' && typeof setProject === 'function');
    if (label === 'integration') {
      const checks = await require('./native-integration.cjs')(page, root);
      const result = { ...checks, errors };
      fs.writeFileSync(path.join(root,'.perf/integration.json'),JSON.stringify(result,null,2));
      console.log(JSON.stringify(result));
      return;
    }
    const memoryFile = path.join(root, '.perf', `${label}-memory.json`);
    monitor = spawn(process.env.IMAGERAIL_PYTHON || 'python', [path.join(__dirname, 'monitor-memory.py'), String(app.pid), memoryFile], { windowsHide: true, stdio: ['ignore', appLog, appLog], env: { ...process.env, PYTHONPATH: path.join(root,'.tools/python') } });
    const start = await page.evaluate(async project => {
      const started = performance.now();
      const result = await window.imageRail.openExistingProject({ projectPath: project.projectFolderPath, projectDataFile: project.projectDataFile });
      window.benchmarkStages = { openIpcMs: performance.now()-started };
      const renderStart = performance.now();
      setProject(result.projectPath, result.project); closeProjectModal();
      window.benchmarkStages.renderMs = performance.now()-renderStart;
      window.benchmarkFrames = [];
      let previous = performance.now();
      const frame = now => { window.benchmarkFrames.push(now-previous); previous=now; window.benchmarkRAF=requestAnimationFrame(frame); };
      window.benchmarkRAF = requestAnimationFrame(frame);
      return started;
    }, project);
    await page.waitForFunction(() => {
      const board = document.querySelector('.rail-board').getBoundingClientRect();
      const visibleTracks = [...document.querySelectorAll('.track')].filter(track => {
        const r=track.getBoundingClientRect();return r.bottom>board.top && r.top<board.bottom;
      });
      const cards = visibleTracks.flatMap(track=>[...track.querySelectorAll('.image-card')]).filter(card => {
        const r=card.getBoundingClientRect();return r.right>board.left && r.left<board.right && r.bottom>board.top && r.top<board.bottom;
      });
      return cards.length && cards.every(card => { const img=card.querySelector('img');return img.getAttribute('src') && img.complete && img.naturalWidth>0; });
    }, null, { timeout: 60000 });
    const firstScreenMs = await page.evaluate(start => performance.now()-start,start);
    const startupMaxFrameMs = await page.evaluate(() => {
      const maximum = Math.max(0, ...window.benchmarkFrames);
      window.benchmarkFrames = [];
      return maximum;
    });
    // Browse every track and sweep horizontally, with the same frame-paced path.
    await page.evaluate(async () => {
      const board=document.querySelector('.rail-board');
      for(const track of document.querySelectorAll('.track')) {
        board.scrollTop=track.offsetTop-board.offsetTop;
        const lane=track.querySelector('.track-lane');
        const max=lane.scrollWidth-lane.clientWidth;
        await new Promise(resolve => {
          let step=0;
          const advance=()=>{lane.scrollLeft=max*Math.min(++step/90,1); if(step<90) requestAnimationFrame(advance);else resolve();};requestAnimationFrame(advance);
        });
      }
      cancelAnimationFrame(window.benchmarkRAF);
    });
    const metrics = await page.evaluate(() => {
      const frames=window.benchmarkFrames.filter(v=>v>0).sort((a,b)=>a-b);
      return { ...window.benchmarkStages, frameP95Ms: frames[Math.floor(frames.length*.95)], maxFrameMs:Math.max(...frames), over200ms:frames.filter(v=>v>200).length, mountedCards:document.querySelectorAll('.image-card').length, loadedCardImages:[...document.querySelectorAll('.image-card img')].filter(img=>img.getAttribute('src')).length, thumbnailErrors:document.querySelectorAll('[data-thumbnail="error"]').length, userAgent:navigator.userAgent };
    });
    await page.screenshot({ path:path.join(root,'.perf',`${label}.png`) });
    const memory = fs.existsSync(memoryFile) ? JSON.parse(fs.readFileSync(memoryFile)) : {};
    const result={variant,label,firstScreenMs,startupMaxFrameMs,...metrics,...memory,errors};
    fs.writeFileSync(path.join(root,'.perf',`${label}.json`),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
    await page.evaluate(()=>window.imageRail.closeWindow()).catch(error => {
      if (!/closed/.test(error.message)) throw error;
    });
  } finally {
    monitor?.kill();
    await browser?.close().catch(()=>{});
    if(app.exitCode===null) app.kill();
    fs.closeSync(appLog);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
