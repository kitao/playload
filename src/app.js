import { palette } from './engine.js';
import { glyphs } from './glyphs.js';
import { encode, decode, gameURL } from './payload.js';
import { Runtime, Sound } from './runtime.js';
import { Capture, download } from './capture.js';

const $ = id => document.getElementById(id);
const player = !!location.hash;
const starter = 'function tick() {\n  cls(0)\n  put("👾", 76, 68)\n}\n';
const canvas = $('display'), context = canvas.getContext('2d');
const raw = document.createElement('canvas'); raw.width = 160; raw.height = 144;
const rawContext = raw.getContext('2d'), image = rawContext.createImageData(160, 144);
const rgb = palette.map(hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)));
let source = '', pendingSource = '', pendingFocus, handle, filename = '', fileSource = '', reading = false, running = false, paused = false, crt = false;
let view = player ? 'game' : 'info', reference = 'characters', capture, payload, revision = 0, columns = 12, page = 0;
let categoryBeforeSearch = 'all', category = 'all', dirty = false, lastFrame = 0;
let editRevision = 0, focusRevision = 0, fileRequest;
let editorOpen = innerWidth >= 600;
try { const saved = localStorage.getItem('playload-editor-open'); if (saved != null) editorOpen = saved === 'true'; } catch { /* Optional preference. */ }
let pointers = new Map(), directions = new Set(), keys = new Set();
const audio = new Sound(message => status('Sound: ' + message));
const runtime = new Runtime(frame, error => {
  running = false; audio.pause(true); release();
  $('error').textContent = (error.line ? `Line ${error.line}: ` : '') + error.message;
  $('error').hidden = false; $('screen').hidden = true; $('empty').hidden = true; payload = null;
  $('error-line').hidden = player || !error.line || $('editor').value !== pendingSource;
  $('error-line').textContent = 'Edit line ' + error.line;
  $('error-line').onclick = () => {
    const editor = $('editor'), lines = editor.value.split('\n');
    const start = lines.slice(0, error.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
    setView('code'); setEditorOpen(true, true); editor.setSelectionRange(start, start + (lines[error.line - 1]?.length ?? 0));
    editor.focus();
    const style = getComputedStyle(editor), measure = document.createElement('div');
    measure.className = 'editor-measure';
    measure.style.width = editor.clientWidth + 'px';
    measure.style.font = style.font;
    measure.style.padding = style.padding;
    measure.style.tabSize = style.tabSize;
    measure.textContent = editor.value.slice(0, start) + '\u200b';
    document.body.append(measure);
    const lineHeight = parseFloat(style.lineHeight);
    const lineY = measure.getBoundingClientRect().height - parseFloat(style.paddingBottom) - lineHeight;
    measure.remove();
    editor.scrollTop = Math.max(0, lineY - (editor.clientHeight - lineHeight) / 2);
  };
  controls();
});

let statusTimer;
function status(text = '') {
  clearTimeout(statusTimer); $('status').textContent = text;
  if (text === 'Copied') statusTimer = setTimeout(() => { $('status').textContent = ''; }, 1800);
}
function controls() {
  document.querySelector('.game-tools').hidden = !pendingSource;
  document.querySelector('.share').hidden = !running || !payload || (!player && view === 'info');
  document.querySelector('.key-hint').hidden = !running;
  for (const id of ['pause', 'reset', 'screenshot']) $(id).disabled = !running;
  $('reset').disabled = !pendingSource;
  $('pause').firstChild.textContent = paused ? 'Resume' : 'Pause';
  $('record').disabled = !running || !capture?.stream || !!capture?.saveRequest;
  $('video').disabled = !running || (!capture?.rotating && capture?.recorder?.state !== 'recording') || !!capture?.saveRequest;
  $('share').disabled = !running || !payload || payload.bytes > 3072 || gameURL(location.href, payload.hash).length > 4096 || dirty;
  if (!player) { $('save-code').disabled = reading; $('load').disabled = reading; $('reload').disabled = !filename || reading; $('run').disabled = reading; $('filename').textContent = filename; $('filename').title = filename; }
}
function setView(next) {
  if (player) return;
  view = next; document.body.dataset.view = next;
  for (const id of ['code', 'info']) $(id).hidden = id !== view;
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-selected', String(button.dataset.view === view));
    button.tabIndex = button.dataset.view === view ? 0 : -1;
  }
  $('workspace-toolbar').hidden = view === 'info';
  release(); audio.pause(paused || view === 'info'); capture?.suspend(view === 'info'); controls();
  if (view === 'code' && editorOpen && innerWidth >= 600) setSplit(split);
  inputHint();
  requestAnimationFrame(fitGame);
  if (view === 'info' && reference === 'characters') renderCharacters();
}
function render(pixels) {
  for (let i = 0; i < pixels.length; i++) {
    const c = rgb[pixels[i]];
    image.data[i * 4] = c[0]; image.data[i * 4 + 1] = c[1]; image.data[i * 4 + 2] = c[2]; image.data[i * 4 + 3] = 255;
  }
  rawContext.putImageData(image, 0, 0);
  paint();
}
function paint() {
  context.imageSmoothingEnabled = false;
  context.drawImage(raw, 0, 0, 640, 576);
  if (crt) { context.fillStyle = 'rgba(0,0,0,.24)'; for (let y = 3; y < 576; y += 4) context.fillRect(0, y, 640, 1); }
}
async function frame(pixels, sounds, ready) {
  render(pixels); audio.play(sounds);
  if (!ready) return;
  source = pendingSource; running = true; paused = false;
  audio.pause(!player && view === 'info');
  $('screen').hidden = false; $('error').hidden = true; $('empty').hidden = true; $('error-line').hidden = true;
  controls();
  if (player || (pendingFocus && pendingFocus.element === document.activeElement && pendingFocus.revision === focusRevision)) focusGame();
  pendingFocus = null;
  const version = revision;
  try {
    const encoded = await encode(source);
    if (version !== revision) return;
    payload = encoded;
    $('size').value = (encoded.bytes / 1024).toFixed(2) + ' KB'; $('size').hidden = false;
    $('size').title = encoded.bytes + ' bytes · ' + gameURL(location.href, encoded.hash).length + ' URL characters';
    if (encoded.bytes > 3072) status('Payload exceeds 3 KB.');
    else if (gameURL(location.href, encoded.hash).length > 4096) status('URL exceeds 4,096 characters.');
    controls();
  } catch (error) { status(error.message); }
  try { await audio.init(); } catch { $('sound').disabled = true; }
  if (version !== revision) return;
  if (audio.context) audio.context.onstatechange = () => { if (audio.context.state === 'running') capture?.audio(audio.destination?.stream); };
  try { if (!capture) { capture = new Capture(canvas, audio.context?.state === 'running' ? audio.destination?.stream : null, controls); capture.start(); capture.suspend(!player && view === 'info'); } }
  catch (error) { capture?.close(); capture = null; status('Video: ' + error.message); }
  controls();
}
function run(code, keepClip = false, focusGame = false, focusGeneration = focusRevision) {
  revision++; status(); release(); if (!keepClip) { capture?.close(); capture = null; }
  audio.reset(); audio.pause(false); paused = false; running = false; payload = null;
  pendingSource = code; $('size').hidden = true; $('screen').hidden = false; $('error').hidden = true; $('empty').hidden = true; $('error-line').hidden = true;
  pendingFocus = focusGame ? { element: document.activeElement, revision: focusGeneration } : null;
  controls(); runtime.load(code);
}
function reset() { if (pendingSource) { audio.unlock(); run(pendingSource, true, true); } }
function release() { keys.clear(); pointers.clear(); directions.clear(); syncInput(); }
function focusGame() {
  if (!player && view !== 'code') setView('code');
  const screen = $('screen'), bounds = screen.getBoundingClientRect();
  screen.focus({ preventScroll: true });
  if (bounds.top < 0 || bounds.bottom > innerHeight) screen.scrollIntoView({ block: 'center', behavior: 'instant' });
}
function inputHint() {
  const active = document.activeElement === $('screen');
  $('control-hint').hidden = active;
  $('control-keys').hidden = !active;
}
function syncInput() {
  let mask = 0;
  for (const value of keys) mask |= 1 << value;
  for (const value of pointers.values()) if (value != null) mask |= 1 << value;
  for (const button of document.querySelectorAll('[data-input]')) button.dataset.held = String(!!(mask & (1 << Number(button.dataset.input))));
  runtime.input(mask);
}

for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => {
  setView(button.dataset.view);
  if (view === 'code') { if (editorOpen) $('editor').focus({ preventScroll: true }); else if (running) focusGame(); }
};
const tabs = $('views');
tabs.onkeydown = event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'code' : event.key === 'End' ? 'info' : view === 'code' ? 'info' : 'code';
  setView(next); $(next + '-tab').focus();
};
$('screen').onclick = () => { focusGame(); audio.unlock(); };
$('game').addEventListener('pointerdown', () => audio.unlock());
$('pause').onclick = () => { paused = !paused; audio.pause(paused || (!player && view === 'info')); controls(); };
document.querySelector('.game-tools').addEventListener('click', event => { if (running && event.target.closest('button:not(:disabled)')) focusGame(); });
$('reset').onclick = reset;
$('crt').onclick = () => { crt = !crt; $('crt').setAttribute('aria-pressed', String(crt)); paint(); };
$('sound').onclick = () => { audio.unlock(); audio.mute(audio.enabled); $('sound').setAttribute('aria-pressed', String(audio.enabled)); };
$('screenshot').onpointerdown = event => event.preventDefault();
$('screenshot').onclick = () => canvas.toBlob(blob => { if (blob) download(blob, 'playload.png'); });
$('record').onclick = () => { capture?.start(); controls(); };
$('video').onclick = async () => {
  try { audio.unlock(); const promise = capture.save(); controls(); const blob = await promise; download(blob, 'playload.webm'); }
  catch (error) { status(error.message); }
  finally { controls(); }
};
$('share').onclick = async () => { if (payload) await copy(gameURL(location.href, payload.hash)); };
async function copy(text, destination = $('status')) {
  try { await navigator.clipboard.writeText(text); if (destination === $('status')) status('Copied'); else destination.textContent = 'Copied'; }
  catch {
    const field = document.createElement('textarea'); field.value = text; field.readOnly = true;
    destination.replaceChildren(field); field.focus(); field.select();
  }
}

function changed() {
  editRevision++;
  dirty = true; $('run').classList.add('primary');
  $('error-line').hidden = true;
  try { localStorage.setItem('playload-code', $('editor').value); } catch { /* Editing works without storage. */ }
  controls();
}
function discard() { return (!dirty && $('editor').value === (filename ? fileSource : starter)) || confirm('Replace the code in the editor?'); }
function readRequest() { return { edit: editRevision, focus: focusRevision }; }
async function readFile(file, request) {
  const text = await file.text();
  if (request.edit !== editRevision) { status('Code changed while loading. Your edits were kept.'); return false; }
  fileSource = text; $('editor').value = fileSource; filename = file.name; editRevision++;
  dirty = false; $('run').classList.remove('primary');
  try { localStorage.setItem('playload-code', fileSource); } catch { /* Optional. */ }
  run(fileSource, false, true, request.focus);
  return true;
}
$('load').onclick = async () => {
  if (!discard()) return;
  const request = readRequest();
  if (!window.showOpenFilePicker) { fileRequest = request; $('file').click(); return; }
  reading = true; controls();
  try {
    const [selected] = await showOpenFilePicker({ types: [{ description: 'JavaScript', accept: { 'text/javascript': ['.js'] } }], multiple: false });
    if (await readFile(await selected.getFile(), request)) handle = selected;
    audio.unlock(); controls();
  } catch (error) { if (error.name !== 'AbortError') status(error.message); }
  finally { reading = false; controls(); }
};
$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file) return;
  const request = fileRequest ?? readRequest(); fileRequest = null;
  reading = true; controls();
  try { if (await readFile(file, request)) { handle = null; status('Reload selects the saved file again in this browser.'); } audio.unlock(); }
  catch (error) { status(error.message); }
  finally { $('file').value = ''; reading = false; controls(); }
};
$('reload').onclick = async () => {
  if (!discard()) return;
  const request = readRequest();
  if (!handle) { fileRequest = request; $('file').click(); return; }
  reading = true; controls();
  try { await readFile(await handle.getFile(), request); audio.unlock(); }
  catch (error) { status('Reload: ' + error.message); }
  finally { reading = false; controls(); }
};
$('run').onclick = () => { dirty = false; $('run').classList.remove('primary'); run($('editor').value, false, !editorOpen); if (editorOpen) $('editor').focus({ preventScroll: true }); audio.unlock(); };
$('save-code').onclick = () => download(new Blob([$('editor').value], { type: 'text/javascript;charset=utf-8' }), filename || 'game.js');
$('editor').oninput = changed;
$('editor').onfocus = release;
document.addEventListener('focusin', () => { focusRevision++; if (document.activeElement !== $('screen')) release(); inputHint(); });
$('editor').onkeydown = event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); $('run').click(); }
  if (event.key === 'Tab') { event.preventDefault(); document.execCommand('insertText', false, '  '); }
};
try { $('editor').value = localStorage.getItem('playload-code') ?? starter; } catch { $('editor').value = starter; }

function setReference(next) {
  reference = next;
  for (const button of document.querySelectorAll('[data-ref]')) {
    button.setAttribute('aria-selected', String(button.dataset.ref === next));
    button.tabIndex = button.dataset.ref === next ? 0 : -1;
  }
  for (const id of ['api', 'characters']) $(id).hidden = id !== next;
  if (next === 'characters') renderCharacters();
}
for (const button of document.querySelectorAll('[data-ref]')) button.onclick = () => setReference(button.dataset.ref);
document.querySelector('.reference-tabs').onkeydown = event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...document.querySelectorAll('[data-ref]')], index = buttons.findIndex(button => button.dataset.ref === reference);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  setReference(buttons[next].dataset.ref); buttons[next].focus();
};
$('copy-code').onclick = () => copy(starter);
function pattern(canvas, glyph) {
  canvas.width = canvas.height = 8; const ctx = canvas.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    ctx.fillStyle = palette[glyph.rows[y] & (128 >> x) ? glyph.ink ?? 7 : glyph.paper ?? 0]; ctx.fillRect(x, y, 1, 1);
  }
}
function renderCharacters() {
  const query = $('search').value.trim().toLowerCase();
  for (const button of document.querySelectorAll('[data-category]')) button.setAttribute('aria-pressed', String(button.dataset.category === category));
  const items = glyphs.filter(g => (category === 'all' || g.group === category) && (!query || [g.ch, g.name, g.ja ?? '', g.searchName ?? ''].join(' ').toLowerCase().includes(query)));
  if (category === 'all') items.sort((a, b) => a.ch.codePointAt(0) - b.ch.codePointAt(0));
  const catalog = $('catalog');
  if (catalog.clientWidth) columns = Math.max(3, Math.floor((catalog.clientWidth + 4) / 72));
  const remaining = $('characters').getBoundingClientRect().bottom - catalog.getBoundingClientRect().top;
  const rows = Math.max(1, Math.floor((remaining + 4) / 44));
  const size = columns * rows, pages = Math.max(1, Math.ceil(items.length / size));
  page = Math.max(0, Math.min(page, pages - 1));
  catalog.style.setProperty('--columns', columns); catalog.replaceChildren();
  $('page').value = `${page + 1} / ${pages}`; $('previous').disabled = page === 0; $('next').disabled = page === pages - 1;
  for (const glyph of items.slice(page * size, (page + 1) * size)) {
    const button = document.createElement('button'), unicode = document.createElement('span'), pixels = document.createElement('canvas');
    button.className = 'glyph'; button.dataset.glyph = glyph.ch;
    button.title = glyph.name + (glyph.ja ? ' · ' + glyph.ja : ''); button.setAttribute('aria-label', 'Copy ' + glyph.ch + ' · ' + glyph.name);
    unicode.textContent = glyph.ch; pattern(pixels, glyph); button.append(unicode, pixels);
    button.onclick = () => copy(glyph.ch); catalog.append(button);
  }
  if (!items.length) catalog.textContent = 'No match';
}
$('search').oninput = () => {
  const query = $('search').value.trim();
  if (query && category !== 'all') { categoryBeforeSearch = category; category = 'all'; }
  if (!query) category = categoryBeforeSearch;
  page = 0; renderCharacters();
};
for (const button of document.querySelectorAll('[data-category]')) button.onclick = () => {
  category = button.dataset.category; categoryBeforeSearch = category; page = 0; renderCharacters();
};
for (const [id, delta] of [['previous', -1], ['next', 1]]) $(id).onclick = () => { page += delta; renderCharacters(); };
$('catalog').onkeydown = event => {
  if (!event.target.matches('[data-glyph]')) return;
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
  if (delta == null && !['PageUp', 'PageDown'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...$('catalog').children], index = buttons.indexOf(event.target), next = index + (delta ?? 0);
  const step = event.key === 'PageDown' ? 1 : event.key === 'PageUp' ? -1 : next < 0 ? -1 : next >= buttons.length ? 1 : 0;
  if (!step) { buttons[next]?.focus(); return; }
  if ($(step > 0 ? 'next' : 'previous').disabled) return;
  page += step; renderCharacters(); const after = [...$('catalog').children];
  after[event.key.startsWith('Page') ? Math.min(index, after.length - 1) : step > 0 ? Math.max(0, next - buttons.length) : Math.max(0, after.length + next)]?.focus();
};
for (let index = 0; index < 8; index++) {
  const button = document.createElement('button'), swatch = document.createElement('span');
  const number = document.createElement('span'), detail = document.createElement('span');
  button.className = 'color'; button.setAttribute('aria-label', 'Copy color ' + index);
  button.title = index + ' · RGB ' + rgb[index].join(', ') + ' · ' + palette[index];
  swatch.className = 'swatch'; swatch.style.background = palette[index];
  number.textContent = index; detail.className = 'rgb'; detail.textContent = rgb[index].join(',');
  button.append(swatch, number, detail);
  button.onclick = () => copy(String(index)); $('palette').append(button);
}
const logo = $('logo').getContext('2d');
[...'PLAYLOAD'].forEach((ch, index) => {
  const g = glyphs.find(g => g.ch === ch);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    logo.fillStyle = palette[g.rows[y] & (128 >> x) ? index < 4 ? 6 : 1 : index < 4 ? 1 : 6]; logo.fillRect(index * 8 + x, y, 1, 1);
  }
});

const keyCodes = { ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3, KeyZ: 4, KeyX: 5 };
const editable = target => target.closest('input,textarea,select,[contenteditable]');
document.addEventListener('keydown', event => {
  if (editable(event.target) || (!player && view !== 'code')) return;
  if (document.activeElement === $('screen') && running && !event.altKey && !event.ctrlKey && !event.metaKey && keyCodes[event.code] != null) {
    event.preventDefault(); audio.unlock(); keys.add(keyCodes[event.code]); syncInput();
  }
  if (!event.altKey || event.repeat || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const id = { KeyR: player ? null : 'reload', KeyP: 'pause', Digit0: 'reset', Digit1: 'screenshot', Digit2: 'record', Digit3: 'video' }[event.code];
  if (id && !$(id).disabled) { event.preventDefault(); $(id).click(); }
});
document.addEventListener('keyup', event => { if (keyCodes[event.code] != null) { keys.delete(keyCodes[event.code]); syncInput(); } });
for (const button of document.querySelectorAll('[data-input]')) {
  button.onpointerdown = event => {
    if (!running) return;
    event.preventDefault(); focusGame(); audio.unlock(); button.setPointerCapture(event.pointerId);
    const input = Number(button.dataset.input); pointers.set(event.pointerId, input); if (input < 4) directions.add(event.pointerId); syncInput();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, event => { pointers.delete(event.pointerId); directions.delete(event.pointerId); syncInput(); });
}
document.addEventListener('pointermove', event => {
  if (!directions.has(event.pointerId)) return;
  const button = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-input]');
  pointers.set(event.pointerId, button && Number(button.dataset.input) < 4 ? Number(button.dataset.input) : null); syncInput();
});
window.addEventListener('blur', release);
function fitGame() {
  const viewport = $('viewport');
  if (!viewport.clientWidth || !viewport.clientHeight) return;
  document.querySelector('.stage').style.width = Math.floor(Math.min(viewport.clientWidth, viewport.clientHeight * 160 / 144)) + 'px';
}
function setEditorOpen(open, save = false) {
  editorOpen = open; document.body.dataset.editorClosed = String(!open);
  for (const el of [$('workbench'), $('divider'), document.querySelector('.editor-status')]) el.hidden = !open;
  $('code-toggle').setAttribute('aria-pressed', String(open));
  if (save) try { localStorage.setItem('playload-editor-open', String(open)); } catch { /* Optional preference. */ }
  if (open && view === 'code' && innerWidth >= 600) setSplit(split);
  fitGame();
}
$('code-toggle').onclick = () => {
  setEditorOpen(!editorOpen, true);
  if (editorOpen) $('editor').focus({ preventScroll: true }); else if (running) focusGame();
};
function layout() {
  const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer:coarse)').matches;
  document.body.dataset.touch = String(touch);
  document.body.dataset.phone = String(touch && innerWidth < 600);
  if (touch && innerWidth < 600) { $('touch-screenshot').append($('screenshot')); $('screenshot').firstChild.textContent = '📷'; }
  else { $('screenshot').firstChild.textContent = 'Screenshot'; document.querySelector('.capture-tools').prepend($('screenshot')); }
  if (!player && view === 'code' && editorOpen && innerWidth >= 600) setSplit(split);
  else fitGame();
}
let split = .5, dragging;
try { const saved = Number(localStorage.getItem('playload-split')); if (saved >= .15 && saved <= .85) split = saved; } catch { /* Resizing works without storage. */ }
function setSplit(value, save = false) {
  const area = $('code'), available = Math.max(1, area.clientWidth - 8);
  const min = Math.min(.35, 140 / available), max = 1 - Math.min(.6, 240 / available);
  split = Math.max(min, Math.min(max, value));
  area.style.setProperty('--split', split);
  $('divider').setAttribute('aria-valuemin', Math.round(min * 100));
  $('divider').setAttribute('aria-valuemax', Math.round(max * 100));
  $('divider').setAttribute('aria-valuenow', Math.round(split * 100));
  if (save) try { localStorage.setItem('playload-split', String(split)); } catch { /* Session layout is still retained. */ }
  fitGame();
}
$('divider').onpointerdown = event => {
  if (event.button !== 0) return;
  event.preventDefault(); dragging = event.pointerId;
  $('divider').focus(); $('divider').setPointerCapture(event.pointerId); document.body.classList.add('resizing');
};
$('divider').onpointermove = event => {
  if (dragging !== event.pointerId) return;
  const rect = $('code').getBoundingClientRect();
  setSplit((event.clientX - rect.left - 4) / Math.max(1, rect.width - 8));
};
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('divider').addEventListener(name, event => {
  if (dragging !== event.pointerId) return;
  dragging = null; document.body.classList.remove('resizing'); setSplit(split, true);
});
$('divider').onkeydown = event => {
  const change = { ArrowLeft: -.05, ArrowRight: .05 }[event.key];
  if (change == null && !['Home', 'End'].includes(event.key)) return;
  event.preventDefault(); setSplit(event.key === 'Home' ? .15 : event.key === 'End' ? .85 : split + change, true);
};
const gameLayout = new ResizeObserver(fitGame);
gameLayout.observe($('viewport'));
window.addEventListener('resize', () => { layout(); if (reference === 'characters' && view === 'info') renderCharacters(); });
window.addEventListener('pagehide', () => { runtime.stop(); audio.close(); capture?.close(); });
window.addEventListener('hashchange', () => location.reload());
function animate(time) {
  if (running && !paused && (player || view === 'code') && time - lastFrame >= 1000 / 60 - .5) { lastFrame = time; runtime.frame(); }
  if (capture?.stream && running && paused && (player || view === 'code')) paint();
  if (capture?.stream) { const seconds = Math.floor(capture.seconds); $('clip-time').value = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); }
  $('clip-time').dataset.recording = String(capture?.recorder?.state === 'recording' || !!capture?.rotating);
  requestAnimationFrame(animate);
}

if (player) {
  $('game').append(document.querySelector('.game-tools'), document.querySelector('.game-status'));
  for (const el of [$('workbench'), $('divider'), $('workspace-toolbar'), $('views'), $('info'), document.querySelector('.editor-status')]) el.remove();
  $('code').hidden = false; $('code').removeAttribute('role'); $('code').removeAttribute('aria-labelledby');
  $('empty').textContent = 'Loading…'; document.body.dataset.role = 'player';
} else {
  $('run').classList.add('primary'); $('code').style.setProperty('--split', split);
  setEditorOpen(editorOpen); setReference('characters');
}
if (/Mac/.test(navigator.userAgent)) for (const hint of document.querySelectorAll('kbd')) hint.textContent = hint.textContent.replace('Alt', 'Option').replace('Ctrl', 'Cmd');
layout(); setView(view); controls(); requestAnimationFrame(animate);
if (player) decode(location.hash).then(run).catch(error => { $('error').textContent = error.message; $('error').hidden = false; $('empty').hidden = true; $('screen').hidden = true; });
