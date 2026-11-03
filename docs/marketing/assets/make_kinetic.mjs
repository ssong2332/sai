// kinetic.html을 1/30초씩 찍어 PNG 프레임으로 저장한다 (2026-11-03).
// 쓰는 법(저장소 루트): node docs/marketing/assets/make_kinetic.mjs <프레임 폴더> [초=15] [html=docs/marketing/assets/kinetic.html]
// 그 html은 전역 render(t초)를 내놓아야 한다(launch.html · loop.html · widget.html도 같은 약속).
// 크롬 하나를 headless로 띄워 DevTools 프로토콜로 render(t) → 스크린샷을 반복한다(프레임마다 새 크롬을 띄우지 않는다).
// 이어서 make_kinetic_audio.py로 소리를 만들고 ffmpeg로 합친다(docs/marketing/README.md).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const outDir = process.argv[2];
const seconds = Number(process.argv[3] ?? 15);
const FPS = 30;
const PORT = 9333;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
mkdirSync(outDir, { recursive: true });

const page = pathToFileURL(resolve(process.argv[4] ?? 'docs/marketing/assets/kinetic.html')).href;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`, '--window-size=1080,1920',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sai-kinetic-'))}`, page,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i += 1) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((x) => x.type === 'page' && x.url.startsWith('file:'));
  } catch { /* 아직 안 떴다 */ }
}
if (!target) { chrome.kill(); throw new Error('headless 크롬에 붙지 못했다'); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { seq += 1; pending.set(seq, r); ws.send(JSON.stringify({ id: seq, method, params })); });

await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode())))', awaitPromise: true });
await sleep(300);

const total = Math.round(seconds * FPS);
for (let f = 0; f < total; f += 1) {
  const res = await send('Runtime.evaluate', { expression: `render(${f / FPS}); 1` });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 } });
  writeFileSync(join(outDir, `f${String(f).padStart(4, '0')}.png`), Buffer.from(shot.result.data, 'base64'));
}
ws.close();
chrome.kill();
console.log(`saved ${total} frames → ${outDir}`);
