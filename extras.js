'use strict';
/*
 * Elektron GX – Gaming-Extras
 *  • Steam-Bibliothek: installierte Spiele finden (libraryfolders.vdf + appmanifest_*.acf)
 *  • Hardware-Anzeige: Grafikkarte über nvidia-smi (NVIDIA-Treiber), CPU und RAM des ganzen PCs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// ---------------------------------------------------------------- Steam
const NOT_GAMES = /^(Steamworks Common Redistributables|Steam Linux Runtime.*|Proton.*|SteamVR.*|Steam Controller Configs|Spacewar|Source SDK.*|.*Dedicated Server.*|.*Soundtrack.*|Wallpaper Engine)$/i;
const NOT_GAME_IDS = new Set(['228980', '1070560', '1391110', '1628350', '250820', '1493710', '1826330', '2180100']);

function steamRoots() {
  const roots = [];
  if (process.platform === 'win32') {
    roots.push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'));
    roots.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'));
  } else {
    roots.push(path.join(os.homedir(), '.steam', 'steam'), path.join(os.homedir(), '.local', 'share', 'Steam'));
  }
  return roots.filter(r => { try { return fs.existsSync(path.join(r, 'steamapps')); } catch { return false; } });
}

function vdfValues(text, key) {
  const out = [];
  const re = new RegExp(`"${key}"\\s+"([^"]*)"`, 'gi');
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function libraryFolders() {
  const folders = new Set();
  for (const root of steamRoots()) {
    folders.add(path.join(root, 'steamapps'));
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const p of vdfValues(vdf, 'path')) folders.add(path.join(p.replace(/\\\\/g, '\\'), 'steamapps'));
    } catch {}
  }
  return [...folders].filter(f => { try { return fs.existsSync(f); } catch { return false; } });
}

let gamesCache = null;
function steamGames() {
  if (gamesCache && Date.now() - gamesCache.t < 60000) return gamesCache.list;
  const games = new Map();
  for (const dir of libraryFolders()) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^appmanifest_\d+\.acf$/.test(f)); } catch {}
    for (const f of files) {
      try {
        const txt = fs.readFileSync(path.join(dir, f), 'utf8');
        const appid = vdfValues(txt, 'appid')[0];
        const name = vdfValues(txt, 'name')[0];
        const last = Number(vdfValues(txt, 'LastPlayed')[0] || 0);
        if (!appid || !name || NOT_GAME_IDS.has(appid) || NOT_GAMES.test(name)) continue;
        games.set(appid, { appid, name, last });
      } catch {}
    }
  }
  const list = [...games.values()].sort((a, b) => b.last - a.last || a.name.localeCompare(b.name));
  gamesCache = { t: Date.now(), list };
  return list;
}

// ---------------------------------------------------------------- Hardware
let gpuAvailable = null;   // null = noch nicht geprüft
let gpuBusy = false;
let lastGpu = null;

function nvidiaSmi() {
  if (process.platform === 'win32') {
    const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
    if (fs.existsSync(sys)) return sys;
    const pf = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe');
    if (fs.existsSync(pf)) return pf;
    return null;
  }
  return 'nvidia-smi';
}

function readGpu() {
  return new Promise((resolve) => {
    if (gpuAvailable === false || gpuBusy) return resolve(lastGpu);
    const exe = nvidiaSmi();
    if (!exe) { gpuAvailable = false; return resolve(null); }
    gpuBusy = true;
    execFile(exe, ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed',
      '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      gpuBusy = false;
      if (err) { if (gpuAvailable === null) gpuAvailable = false; return resolve(null); }
      gpuAvailable = true;
      const p = String(stdout).split('\n')[0].split(',').map(x => x.trim());
      const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      lastGpu = { name: p[0], util: num(p[1]), temp: num(p[2]), memUsed: num(p[3]), memTotal: num(p[4]), power: num(p[5]), fan: num(p[6]) };
      resolve(lastGpu);
    });
  });
}

let prevCpu = null;
function systemCpu() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  let pct = null;
  if (prevCpu) {
    const dt = total - prevCpu.total, di = idle - prevCpu.idle;
    if (dt > 0) pct = Math.max(0, Math.min(100, (1 - di / dt) * 100));
  }
  prevCpu = { idle, total };
  return pct;
}

async function hardware() {
  const gpu = await readGpu();
  return {
    cpu: systemCpu(),
    cpuName: (os.cpus()[0] || {}).model || '',
    ramUsed: (os.totalmem() - os.freemem()) / 1048576,
    ramTotal: os.totalmem() / 1048576,
    gpu
  };
}

module.exports = { steamGames, hardware };
