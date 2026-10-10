import { palette } from './engine.js?v=15';
import { glyphs } from './glyphs.js?v=18';
import { encode, decode, gameURL } from './payload.js?v=13';
import { Runtime, Sound } from './runtime.js?v=25';
import { Capture, download } from './capture.js?v=20';
import { createDisplay } from './display.js?v=14';
import { createCRT } from './crt.js?v=14';
import { highlightJavaScript } from './editor-highlighter.js?v=13';
import { exampleLinks } from './example-links.js?v=24';

const $ = (id) => document.getElementById(id);
const initialHash = location.hash;
const starter = `// @title My Game
let x = 76;
let y = 68;
let gx = 14;
let gy = 8;
let gems = 0;

function tick() {
  x = Math.max(0, Math.min(152, x + btn(3) - btn(2)));
  y = Math.max(0, Math.min(136, y + btn(1) - btn(0)));

  if (Math.abs(x - gx * 8) < 6 && Math.abs(y - gy * 8) < 6) {
    gems += 1;
    gx = Math.floor(Math.random() * 20);
    gy = 2 + Math.floor(Math.random() * 16);
    play(0, 'T240O6N1cG');
  }

  cls(0);
  put(1, 1, 'GEMS ' + gems);
  put(gx, gy, '💎', 4);
  spr(x, y, '👾', 6);
}
`;
const canvas = $('display'),
  context = canvas.getContext('2d');
const display = createDisplay(palette, canvas.width, canvas.height);
const image = new ImageData(display.render(new Uint8Array(160 * 144)), canvas.width, canvas.height);
let screenPixels = new Uint8Array(160 * 144);
let crtDisplay;
let pendingSource = '',
  pendingFocus,
  filename = '',
  fileSource = '',
  reading = false,
  running = false,
  paused = false,
  crt = true;
let view = 'code',
  reference = 'api',
  capture,
  payload,
  revision = 0,
  columns = 12;
let category = 'emoji',
  lastFrame = 0;
let editRevision = 0,
  focusRevision = 0,
  fileRequest,
  fileHandle;
let editorErrorLine = null;
let touch = touchLayout();
let compact = touch || innerWidth < 1280;
let editorOpen = !touch && innerWidth >= 600;
let toolsOpen = false,
  awaitingStart = false;
let pointers = new Map(),
  directions = new Set(),
  keys = new Map();
let gamepadMask = 0;
const audio = new Sound((message) => status('Sound: ' + message));
const runtime = new Runtime(frame, (error) => {
  running = false;
  awaitingStart = false;
  syncPlayback();
  release();
  $('error').textContent = error.message || 'Game error';
  $('error').hidden = false;
  $('error-notice').hidden = false;
  $('screen').hidden = false;
  $('empty').hidden = true;
  editorErrorLine = $('editor').value === pendingSource ? error.line : null;
  updateEditorLines();
  $('error-line').hidden = !error.line;
  $('error-line').disabled = $('editor').value !== pendingSource;
  $('error-line').textContent = 'Line ' + error.line;
  $('error-line').setAttribute('aria-label', 'Edit line ' + error.line);
  $('error-line').onclick = () => {
    const editor = $('editor'),
      lines = editor.value.split('\n');
    const start = lines.slice(0, error.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
    setView('code');
    setEditorOpen(true);
    editor.setSelectionRange(start, start + (lines[error.line - 1]?.length ?? 0));
    focusEditor();
    const style = getComputedStyle(editor),
      measure = document.createElement('div');
    measure.className = 'editor-measure';
    measure.style.width = editor.clientWidth + 'px';
    measure.style.font = style.font;
    measure.style.padding = style.padding;
    measure.style.tabSize = style.tabSize;
    measure.textContent = editor.value.slice(0, start) + '\u200b';
    document.body.append(measure);
    const lineHeight = parseFloat(style.lineHeight);
    const lineY =
      measure.getBoundingClientRect().height - parseFloat(style.paddingBottom) - lineHeight;
    measure.remove();
    editor.scrollTop = Math.max(0, lineY - (editor.clientHeight - lineHeight) / 2);
    editor.scrollLeft = 0;
    syncEditorScroll();
  };
  controls();
  focusAfterRun();
});

let statusTimer;
function status(text = '') {
  clearTimeout(statusTimer);
  $('status').textContent = text;
  if (text === 'Copied')
    statusTimer = setTimeout(() => {
      $('status').textContent = '';
    }, 1800);
}
function controls() {
  $('workspace-toolbar').hidden = view === 'info' || (compact && !toolsOpen);
  $('tools-toggle').hidden = !compact || view === 'info';
  $('tools-toggle').setAttribute('aria-expanded', String(toolsOpen));
  $('start-game').hidden = !running || !awaitingStart;
  $('size').hidden = !payload;
  $('pause').disabled = !running || awaitingStart;
  $('screenshot').disabled = !running;
  $('run').disabled = reading;
  $('pause').firstChild.textContent = paused && !awaitingStart ? 'Resume' : 'Pause';
  $('record').disabled = !running || !capture?.stream || !!capture?.saveRequest;
  $('video').disabled =
    !running ||
    (!capture?.restarting && !['recording', 'paused'].includes(capture?.recorder?.state)) ||
    !!capture?.saveRequest;
  $('load').disabled = reading;
  $('filename').textContent = filename;
  $('filename').title = filename;
  $('reload').disabled = reading || !filename;
  for (const button of document.querySelectorAll('[data-input]')) button.disabled = !running;
}
function syncPlayback() {
  audio.pause(!running || paused || view === 'info' || (compact && toolsOpen));
  capture?.suspend(!running || view === 'info' || awaitingStart || (compact && toolsOpen));
}
function setView(next) {
  view = next;
  document.body.dataset.view = next;
  for (const id of ['code', 'info']) $(id).hidden = id !== view;
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-selected', String(button.dataset.view === view));
    button.tabIndex = button.dataset.view === view ? 0 : -1;
  }
  release();
  syncPlayback();
  controls();
  if (view === 'code' && editorOpen && innerWidth >= 600) setSplit(split);
  requestAnimationFrame(fitGame);
  if (view === 'info' && reference === 'characters') renderCharacters();
}
function render(pixels) {
  screenPixels = pixels;
  paint();
}
function paint() {
  canvas.dataset.crt = String(crt);
  if (crt && crtDisplay === undefined) {
    try {
      crtDisplay = createCRT(palette, canvas.width, canvas.height);
    } catch {
      crtDisplay = null;
    }
  }
  if (crt && crtDisplay?.render(screenPixels)) {
    context.drawImage(crtDisplay.canvas, 0, 0);
    return;
  }
  display.render(screenPixels, crt);
  context.putImageData(image, 0, 0);
}
async function frame(pixels, sounds, ready) {
  render(pixels);
  audio.play(sounds);
  if (!ready) return;
  running = true;
  paused = awaitingStart;
  syncPlayback();
  $('screen').hidden = false;
  $('error').hidden = true;
  $('error-notice').hidden = true;
  $('empty').hidden = true;
  $('error-line').hidden = true;
  controls();
  focusAfterRun();
  const version = revision;
  try {
    await audio.init();
  } catch {
    $('sound').disabled = true;
  }
  if (version !== revision || !running) return;
  if (audio.context)
    audio.context.onstatechange = () => {
      if (audio.context.state === 'running') capture?.audio(audio.destination?.stream);
    };
  try {
    if (!capture) {
      capture = new Capture(
        canvas,
        audio.context?.state === 'running' ? audio.destination?.stream : null,
        controls,
      );
      capture.start();
      syncPlayback();
    }
  } catch (error) {
    capture?.close();
    capture = null;
    status('Video: ' + error.message);
  }
  controls();
}
function run(code, takeFocus = false, focusGeneration = focusRevision, waitForTap = false) {
  revision++;
  status();
  release();
  capture?.close();
  capture = null;
  audio.reset();
  awaitingStart = waitForTap;
  paused = waitForTap;
  running = false;
  syncPlayback();
  pendingSource = code;
  scheduleURL(0);
  $('screen').hidden = false;
  $('error').hidden = true;
  $('error-notice').hidden = true;
  $('empty').hidden = true;
  $('error-line').hidden = true;
  editorErrorLine = null;
  updateEditorLines();
  if (compact && takeFocus && focusGeneration === focusRevision) {
    toolsOpen = false;
    $('screen').focus({ preventScroll: true });
    focusGeneration = focusRevision;
  }
  controls();
  pendingFocus = takeFocus ? { element: document.activeElement, revision: focusGeneration } : null;
  runtime.load(code);
}
function runCurrentSource() {
  if (reading) return;
  toolsOpen = false;
  audio.unlock();
  run($('editor').value, true);
}
function startGame() {
  if (!running || !awaitingStart) return;
  audio.unlock();
  awaitingStart = false;
  paused = false;
  toolsOpen = false;
  syncPlayback();
  controls();
  focusGame(false);
  fitGame();
}
function release() {
  keys.clear();
  pointers.clear();
  directions.clear();
  syncInput(0);
}
function focusEditor() {
  $('editor').focus({ preventScroll: true });
  if (compact) window.scrollTo({ top: 0, behavior: 'instant' });
}
function focusGame(reveal = true) {
  if (view !== 'code') setView('code');
  const screen = $('screen'),
    target = touch ? $('game') : screen,
    bounds = target.getBoundingClientRect();
  screen.focus({ preventScroll: true });
  if (reveal && (bounds.top < 0 || bounds.bottom > innerHeight))
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
}
function focusAfterRun() {
  if (
    pendingFocus &&
    pendingFocus.element === document.activeElement &&
    pendingFocus.revision === focusRevision
  ) {
    focusGame();
    if (compact && !$('error-notice').hidden)
      $('error-notice').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  pendingFocus = null;
}
function syncInput(padMask = readGamepads()) {
  if (padMask & ~gamepadMask) audio.unlock();
  gamepadMask = padMask;
  let mask = padMask;
  for (const value of keys.values()) mask |= 1 << value;
  for (const value of pointers.values()) if (value != null) mask |= 1 << value;
  for (const button of document.querySelectorAll('[data-input]'))
    button.dataset.held = String(!!(mask & (1 << Number(button.dataset.input))));
  runtime.input(mask);
}
function readGamepads() {
  let mask = 0;
  if (
    running &&
    !paused &&
    view === 'code' &&
    !(compact && toolsOpen) &&
    document.hasFocus() &&
    document.activeElement === $('screen')
  ) {
    try {
      for (const pad of navigator.getGamepads?.() || []) {
        if (!pad?.connected || pad.mapping !== 'standard') continue;
        // Standard mapping: D-pad, left stick, bottom and right face buttons.
        for (const [id, button] of [12, 13, 14, 15, 0, 1].entries())
          if (pad.buttons[button]?.pressed) mask |= 1 << id;
        if (pad.axes[1] < -0.5) mask |= 1;
        if (pad.axes[1] > 0.5) mask |= 2;
        if (pad.axes[0] < -0.5) mask |= 4;
        if (pad.axes[0] > 0.5) mask |= 8;
      }
    } catch {
      // Some browser permission policies block access to gamepads.
    }
  }
  return mask;
}

for (const button of document.querySelectorAll('[data-view]'))
  button.onclick = () => {
    setView(button.dataset.view);
    if (view === 'code') {
      if (editorOpen) focusEditor();
      else if (running) focusGame();
    }
  };
const tabs = $('views');
tabs.onkeydown = (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 'code'
      : event.key === 'End'
        ? 'info'
        : view === 'code'
          ? 'info'
          : 'code';
  setView(next);
  $(next + '-tab').focus();
};
$('screen').onclick = () => {
  if (compact && toolsOpen) {
    $('tools-toggle').click();
    return;
  }
  if (awaitingStart) {
    startGame();
    return;
  }
  focusGame(false);
  audio.unlock();
};
$('game').addEventListener('pointerdown', () => audio.unlock());
$('pause').onclick = () => {
  paused = !paused;
  toolsOpen = false;
  release();
  audio.unlock();
  syncPlayback();
  controls();
  if (paused && editorOpen) focusEditor();
  else focusGame();
  fitGame();
};
$('tools-toggle').onclick = () => {
  toolsOpen = !toolsOpen;
  release();
  audio.unlock();
  syncPlayback();
  controls();
  if (!toolsOpen && running && !editorOpen) focusGame(false);
  fitGame();
};
document.querySelector('.game-tools').addEventListener('click', (event) => {
  const button = event.target.closest('button:not(:disabled)');
  if (
    running &&
    !(compact && toolsOpen) &&
    button &&
    !['code-toggle', 'run', 'pause'].includes(button.id)
  )
    focusGame();
});
$('crt').onclick = () => {
  crt = !crt;
  $('crt').setAttribute('aria-pressed', String(crt));
  paint();
};
$('sound').onclick = () => {
  audio.unlock();
  audio.mute(audio.enabled);
  $('sound').setAttribute('aria-pressed', String(audio.enabled));
};
$('screenshot').onpointerdown = (event) => event.preventDefault();
$('screenshot').onclick = () =>
  canvas.toBlob((blob) => {
    if (blob) download(blob, 'playload.png');
  });
$('record').onclick = () => {
  try {
    capture?.start();
  } catch (error) {
    capture?.close();
    capture = null;
    status('Video: ' + error.message);
  }
  controls();
};
$('video').onclick = async () => {
  try {
    audio.unlock();
    const promise = capture.save();
    controls();
    const blob = await promise;
    download(blob, 'playload.webm');
  } catch (error) {
    status(error.message);
  } finally {
    controls();
  }
};
let copyRevision = 0;
async function copy(text) {
  const version = ++copyRevision;
  try {
    await navigator.clipboard.writeText(text);
    if (version === copyRevision) status('Copied');
  } catch {
    if (version !== copyRevision) return;
    status();
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    $('status').replaceChildren(field);
    field.focus();
    field.select();
  }
}

let urlTimer,
  urlRevision = 0;
function scheduleURL(delay = 250) {
  clearTimeout(urlTimer);
  const version = ++urlRevision,
    code = $('editor').value,
    writeURL = !!initialHash || editRevision > 0 || code !== starter;
  const title = writeURL
    ? /^\s*\/\/[ \t]*@title[ \t]+([^\r\n\u2028\u2029]*)/.exec(code)?.[1].trim()
    : null;
  document.title = title ? `${title} — Playload` : 'Playload';
  urlTimer = setTimeout(async () => {
    try {
      const encoded = await encode(code);
      if (version !== urlRevision || code !== $('editor').value) return;
      const url = new URL(location.href);
      url.searchParams.delete('edit');
      url.hash = encoded.hash;
      payload = encoded;
      $('size-current').textContent = (encoded.bytes / 1024).toFixed(2) + ' KB';
      $('size').title = encoded.bytes + ' bytes · ' + url.href.length + ' URL characters';
      if (encoded.bytes > 3072 || url.href.length > 4096) {
        url.hash = '';
        status('Code is too large for a bookmark URL (3 KB compressed).');
      }
      if (writeURL) history.replaceState(null, '', url);
      controls();
    } catch (error) {
      if (version !== urlRevision) return;
      const url = new URL(location.href);
      url.hash = '';
      if (writeURL) history.replaceState(null, '', url);
      payload = null;
      status(error.message);
      controls();
    }
  }, delay);
}
function highlightEditor() {
  const editor = $('editor'),
    preview = $('editor-highlight');
  preview.innerHTML = highlightJavaScript(editor.value) + '\n';
  updateEditorLines();
  syncEditorScroll();
}
function updateEditorLines() {
  const count = $('editor').value.split('\n').length;
  $('workbench').style.setProperty('--line-number-digits', Math.max(2, String(count).length));
  $('editor-line-numbers').innerHTML = Array.from({ length: count }, (_, i) =>
    i + 1 === editorErrorLine ? `<span class="editor-line-error">${i + 1}</span>` : String(i + 1),
  ).join('\n');
}
function syncEditorScroll() {
  $('editor-highlight').scrollTop = $('editor').scrollTop;
  $('editor-highlight').scrollLeft = $('editor').scrollLeft;
  $('editor-line-numbers').style.transform = `translateY(${-$('editor').scrollTop}px)`;
}
$('editor').onscroll = syncEditorScroll;

function changed() {
  editRevision++;
  editorErrorLine = null;
  highlightEditor();
  scheduleURL();
  $('error-line').disabled = true;
  controls();
}
function discard() {
  return (
    $('editor').value === (filename ? fileSource : starter) ||
    confirm('Replace the code in the editor?')
  );
}
function readRequest() {
  return { edit: editRevision, focus: focusRevision };
}
async function readFile(file, request, handle = null) {
  if (request.filename && file.name !== request.filename) {
    status(`Select ${request.filename} to reload.`);
    return false;
  }
  const text = await file.text();
  if (request.edit !== editRevision) {
    status('Code changed while loading. Your edits were kept.');
    return false;
  }
  fileHandle = handle;
  fileSource = text;
  $('editor').value = fileSource;
  filename = file.name;
  editRevision++;
  highlightEditor();
  run(fileSource, true, request.focus);
  return true;
}
async function chooseFile(request) {
  if (!window.showOpenFilePicker) {
    fileRequest = request;
    $('file').click();
    return;
  }
  reading = true;
  controls();
  try {
    const [selected] = await showOpenFilePicker({
      types: [{ description: 'JavaScript', accept: { 'text/javascript': ['.js'] } }],
      multiple: false,
    });
    await readFile(await selected.getFile(), request, selected);
    audio.unlock();
    controls();
  } catch (error) {
    if (error.name !== 'AbortError') status(error.message);
  } finally {
    reading = false;
    controls();
  }
}
$('load').onclick = () => {
  if (!reading && discard()) return chooseFile(readRequest());
};
$('reload').onclick = async () => {
  if (reading || !filename || !discard()) return;
  const request = readRequest();
  if (!fileHandle) {
    status(`Select ${filename} again to reload.`);
    return chooseFile({ ...request, filename });
  }
  reading = true;
  controls();
  try {
    await readFile(await fileHandle.getFile(), request, fileHandle);
    audio.unlock();
  } catch (error) {
    status(
      error.name === 'NotAllowedError' ? 'Load the file again to restore access.' : error.message,
    );
  } finally {
    reading = false;
    controls();
  }
};
$('file').oncancel = () => {
  fileRequest = null;
  status();
};
$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file) return;
  const request = fileRequest ?? readRequest();
  fileRequest = null;
  reading = true;
  controls();
  try {
    await readFile(file, request);
    audio.unlock();
  } catch (error) {
    status(error.message);
  } finally {
    $('file').value = '';
    reading = false;
    controls();
  }
};
$('run').onclick = runCurrentSource;
$('editor').oninput = changed;
$('editor').onfocus = release;
document.addEventListener('focusin', () => {
  focusRevision++;
  if (document.activeElement !== $('screen')) release();
});
$('editor').onkeydown = (event) => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    document.execCommand('insertText', false, '  ');
  }
};
$('editor').value = starter;

function setReference(next) {
  const selected = next === 'characters' ? category : next;
  if (!['api', 'examples'].includes(selected) && selected !== category) {
    category = selected;
    $('catalog').scrollTop = 0;
  }
  reference = ['api', 'examples'].includes(selected) ? selected : 'characters';
  for (const button of document.querySelectorAll('[data-ref]')) {
    const active = button.dataset.ref === selected;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const id of ['api', 'characters', 'examples']) $(id).hidden = id !== reference;
  if (reference === 'characters') {
    $('characters').setAttribute('aria-labelledby', selected + '-tab');
    renderCharacters();
  }
}
for (const entry of exampleLinks) {
  const row = document.createElement('li'),
    playLink = document.createElement('a'),
    description = document.createElement('span');
  playLink.textContent = entry.name;
  playLink.href = gameURL(new URL('.', location.href).href, entry.hash);
  playLink.setAttribute('aria-label', 'Play ' + entry.name);
  playLink.target = '_blank';
  playLink.rel = 'noopener';
  description.textContent = entry.description;
  row.append(playLink, description);
  document.querySelector('.example-links').append(row);
}
for (const button of document.querySelectorAll('[data-ref]'))
  button.onclick = () => setReference(button.dataset.ref);
document.querySelector('.reference-tabs').onkeydown = (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...document.querySelectorAll('[data-ref]')],
    index = buttons.findIndex((button) => button.getAttribute('aria-selected') === 'true');
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  setReference(buttons[next].dataset.ref);
  buttons[next].focus();
  buttons[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
};
function pattern(canvas, glyph) {
  canvas.width = canvas.height = 8;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = palette[glyph.rows[y] & (128 >> x) ? (glyph.ink ?? 7) : (glyph.paper ?? 0)];
      ctx.fillRect(x, y, 1, 1);
    }
}
let catalogItems = [],
  catalogStart = -1,
  catalogEnd = -1,
  catalogFrame;
function renderCharacters() {
  catalogItems = glyphs.filter((g) => g.group === category);
  const catalog = $('catalog');
  const firstVisible = Math.floor(catalog.scrollTop / 44) * columns;
  const nextColumns = Math.max(3, Math.floor((catalog.clientWidth + 4) / 72));
  const resized = nextColumns !== columns;
  columns = nextColumns;
  $('catalog-window').style.setProperty('--columns', columns);
  $('catalog-space').style.height = Math.ceil(catalogItems.length / columns) * 44 + 'px';
  if (resized) catalog.scrollTop = Math.floor(firstVisible / columns) * 44;
  catalogStart = catalogEnd = -1;
  renderCatalogWindow();
}
function renderCatalogWindow() {
  const catalog = $('catalog'),
    window = $('catalog-window');
  const startRow = Math.max(0, Math.floor(catalog.scrollTop / 44) - 3);
  const start = startRow * columns;
  const end = Math.min(
    catalogItems.length,
    (Math.ceil((catalog.scrollTop + catalog.clientHeight) / 44) + 3) * columns,
  );
  if (start === catalogStart && end === catalogEnd) return;
  catalogStart = start;
  catalogEnd = end;
  const focused = document.activeElement?.dataset.index;
  window.style.top = startRow * 44 + 'px';
  const fragment = document.createDocumentFragment();
  for (let index = start; index < end; index++) {
    const glyph = catalogItems[index];
    const button = document.createElement('button'),
      unicode = document.createElement('span'),
      pixels = document.createElement('canvas');
    button.className = 'glyph';
    button.dataset.glyph = glyph.ch;
    button.dataset.index = index;
    button.title = glyph.name;
    button.setAttribute('aria-label', 'Copy ' + glyph.ch + ' · ' + glyph.name);
    unicode.textContent = glyph.ch;
    pattern(pixels, glyph);
    button.append(unicode, pixels);
    button.onclick = () => copy(glyph.ch);
    fragment.append(button);
  }
  window.replaceChildren(fragment);
  if (focused != null && end > start) {
    const firstVisible = Math.floor(catalog.scrollTop / 44) * columns;
    const lastVisible = Math.ceil((catalog.scrollTop + catalog.clientHeight) / 44) * columns - 1;
    const index = Math.min(
      end - 1,
      Math.max(start, firstVisible, Math.min(Number(focused), lastVisible)),
    );
    window.querySelector('[data-index="' + index + '"]')?.focus({ preventScroll: true });
  }
}
$('catalog').addEventListener(
  'scroll',
  () => {
    if (catalogFrame) return;
    catalogFrame = requestAnimationFrame(() => {
      catalogFrame = null;
      renderCatalogWindow();
    });
  },
  { passive: true },
);
$('catalog').onkeydown = (event) => {
  if (!event.target.matches('[data-glyph]')) return;
  const page = Math.max(1, Math.floor($('catalog').clientHeight / 44)) * columns;
  const delta = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -columns,
    ArrowDown: columns,
    PageUp: -page,
    PageDown: page,
  }[event.key];
  if (delta == null && !['Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = Math.min(
    catalogItems.length - 1,
    Math.max(
      0,
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? catalogItems.length - 1
          : Number(event.target.dataset.index) + delta,
    ),
  );
  const top = Math.floor(index / columns) * 44,
    catalog = $('catalog');
  if (top < catalog.scrollTop) catalog.scrollTop = top;
  else if (top + 40 > catalog.scrollTop + catalog.clientHeight)
    catalog.scrollTop = top + 40 - catalog.clientHeight;
  renderCatalogWindow();
  $('catalog-window')
    .querySelector('[data-index="' + index + '"]')
    ?.focus({ preventScroll: true });
};
for (let index = 0; index < 8; index++) {
  const button = document.createElement('button'),
    swatch = document.createElement('span');
  const number = document.createElement('span'),
    detail = document.createElement('span');
  button.className = 'color';
  button.setAttribute('aria-label', 'Copy color ' + index);
  button.title = index + ' · ' + palette[index].toUpperCase();
  swatch.className = 'swatch';
  swatch.style.background = palette[index];
  number.textContent = index;
  detail.className = 'hex';
  detail.textContent = palette[index].toUpperCase();
  button.append(swatch, number, detail);
  button.onclick = () => copy(String(index));
  $('palette').append(button);
}

const keyCodes = {
  ArrowUp: 0,
  ArrowDown: 1,
  ArrowLeft: 2,
  ArrowRight: 3,
  KeyW: 0,
  KeyS: 1,
  KeyA: 2,
  KeyD: 3,
  KeyZ: 4,
  KeyJ: 4,
  KeyX: 5,
  KeyK: 5,
};
function gameButton(event) {
  const key = event.key.toLowerCase();
  // Follow Latin key labels; other scripts retain the same physical positions.
  if (/^[a-z]$/.test(key)) return keyCodes['Key' + key.toUpperCase()];
  return keyCodes[event.code];
}
const editable = (target) => target.closest('input,textarea,select,[contenteditable]');
document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    const id = { Enter: 'run', NumpadEnter: 'run', KeyO: 'load' }[event.code];
    if (id && view === 'code' && !$(id).disabled) {
      event.preventDefault();
      if (!event.repeat) $(id).click();
    }
    return;
  }
  if (view !== 'code') return;
  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    ['KeyP', 'KeyR'].includes(event.code)
  ) {
    const id = event.code === 'KeyR' ? 'reload' : 'pause';
    event.preventDefault();
    if (!event.repeat && !$(id).disabled) $(id).click();
    return;
  }
  if (editable(event.target)) return;
  const input = gameButton(event);
  if (
    document.activeElement === $('screen') &&
    running &&
    (!paused || awaitingStart) &&
    !(compact && toolsOpen) &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    input != null
  ) {
    event.preventDefault();
    if (awaitingStart) startGame();
    audio.unlock();
    keys.set(event.code, input);
    syncInput();
  }
  if (!event.altKey || event.repeat || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const id = {
    KeyE: 'error-line',
    KeyP: 'pause',
    Digit1: 'screenshot',
    Digit2: 'record',
    Digit3: 'video',
  }[event.code];
  if (id && !$(id).disabled && $(id).getClientRects().length) {
    event.preventDefault();
    $(id).click();
  }
});
document.addEventListener('keyup', (event) => {
  if (keys.delete(event.code)) {
    syncInput();
  }
});
for (const button of document.querySelectorAll('[data-input]')) {
  button.onpointerdown = (event) => {
    if (!running || view !== 'code' || (compact && toolsOpen)) return;
    if (awaitingStart) startGame();
    if (paused) return;
    event.preventDefault();
    focusGame(false);
    audio.unlock();
    button.setPointerCapture(event.pointerId);
    const input = Number(button.dataset.input);
    pointers.set(event.pointerId, input);
    if (input < 4) directions.add(event.pointerId);
    syncInput();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    button.addEventListener(name, (event) => {
      pointers.delete(event.pointerId);
      directions.delete(event.pointerId);
      syncInput();
    });
}
document.addEventListener('pointermove', (event) => {
  if (!directions.has(event.pointerId)) return;
  const button = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-input]');
  pointers.set(
    event.pointerId,
    button && Number(button.dataset.input) < 4 ? Number(button.dataset.input) : null,
  );
  syncInput();
});
// A second finger does not generate a compatibility click in every browser.
let secondaryTap = null;
document.addEventListener(
  'pointerdown',
  () => {
    secondaryTap = null;
  },
  true,
);
document.addEventListener('pointerup', (event) => {
  if (!touch || event.pointerType !== 'touch' || event.isPrimary) return;
  const button = event.target.closest('button:not([data-input])');
  if (
    button &&
    !button.disabled &&
    document.elementFromPoint(event.clientX, event.clientY)?.closest('button') === button
  ) {
    secondaryTap = event.pointerId;
    button.click();
  }
});
document.addEventListener(
  'click',
  (event) => {
    if (touch && event.pointerType === 'touch' && event.pointerId === secondaryTap) {
      secondaryTap = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);
window.addEventListener('blur', release);
function fitGame() {
  const viewport = $('picture');
  if (!viewport.clientWidth || !viewport.clientHeight) return;
  const style = getComputedStyle(viewport);
  const width =
    viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height =
    viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const stage = document.querySelector('.stage'),
    size = Math.max(0, Math.floor(Math.min(width, (height * 160) / 144)));
  stage.style.width = size + 'px';
  // A miniature screen cannot fit a readable message; use the player in that case.
  const anchor = size >= 240 ? stage : $('viewport'),
    notice = $('error-notice');
  if (notice.parentElement !== anchor) anchor.append(notice);
  anchor.style.setProperty(
    '--error-text-height',
    Math.max(20, Math.min(100, Math.floor((anchor.clientHeight - 40) / 20) * 20)) + 'px',
  );
}
function setEditorOpen(open) {
  editorOpen = open;
  document.body.dataset.editorClosed = String(!open);
  for (const el of [$('workbench'), $('divider'), document.querySelector('.editor-status')])
    el.hidden = !open;
  $('code-toggle').setAttribute('aria-pressed', String(open));
  if (open && view === 'code' && innerWidth >= 600) setSplit(split);
  fitGame();
}
$('code-toggle').onclick = () => {
  setEditorOpen(!editorOpen);
  toolsOpen = false;
  controls();
  syncPlayback();
  if (editorOpen) focusEditor();
  else if (running) focusGame();
};
function touchLayout() {
  return matchMedia('(pointer:coarse)').matches;
}
function layout() {
  touch = touchLayout();
  document.body.dataset.touch = String(touch);
  const nextCompact = touch || innerWidth < 1280;
  if (compact !== nextCompact) toolsOpen = false;
  compact = nextCompact;
  document.body.dataset.compact = String(compact);
  $('start-game').textContent = touch ? 'Tap to play' : 'Click to play';
  if (touch) {
    $('touch-pause').append($('pause'));
  } else {
    document.querySelector('.play-tools').append($('pause'));
  }
  controls();
  syncPlayback();
  if (view === 'code' && editorOpen && innerWidth >= 600) setSplit(split);
  else fitGame();
}
let split = 0.5,
  dragging;
try {
  const saved = localStorage.getItem('playload-split'),
    value = Number(saved);
  if (saved !== null && saved.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 1)
    split = value;
} catch {
  /* Resizing works without storage. */
}
function setSplit(value, save = false) {
  const area = $('code'),
    available = Math.max(1, area.clientWidth - 8);
  const min = Math.min(0.35, 140 / available),
    max = 1 - Math.min(0.6, 240 / available);
  split = Math.max(min, Math.min(max, value));
  // Keep the adjoining rectangle edges on whole pixels, including after dragging.
  area.style.setProperty('--editor-width', Math.round(available * split) + 'px');
  $('divider').setAttribute('aria-valuemin', Math.round(min * 100));
  $('divider').setAttribute('aria-valuemax', Math.round(max * 100));
  $('divider').setAttribute('aria-valuenow', Math.round(split * 100));
  if (save)
    try {
      localStorage.setItem('playload-split', String(split));
    } catch {
      /* Session layout is still retained. */
    }
  fitGame();
}
$('divider').onpointerdown = (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging = event.pointerId;
  $('divider').focus();
  $('divider').setPointerCapture(event.pointerId);
  document.body.classList.add('resizing');
};
$('divider').onpointermove = (event) => {
  if (dragging !== event.pointerId) return;
  const rect = $('code').getBoundingClientRect();
  setSplit((event.clientX - rect.left - 4) / Math.max(1, rect.width - 8));
};
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('divider').addEventListener(name, (event) => {
    if (dragging !== event.pointerId) return;
    dragging = null;
    document.body.classList.remove('resizing');
    setSplit(split, true);
  });
$('divider').onkeydown = (event) => {
  const change = { ArrowLeft: -0.05, ArrowRight: 0.05 }[event.key];
  if (change == null && !['Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  setSplit(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : split + change, true);
};
const gameLayout = new ResizeObserver(fitGame);
gameLayout.observe($('picture'));
window.addEventListener('resize', () => {
  release();
  layout();
  if (reference === 'characters' && view === 'info') renderCharacters();
});
window.addEventListener('beforeunload', () => capture?.leave(true));
window.addEventListener('pagehide', (event) => {
  release();
  if (event.persisted) {
    runtime.suspend(true);
    audio.pause(true);
    capture?.suspend(true);
  } else {
    runtime.stop();
    audio.close();
    capture?.close();
  }
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  lastFrame = 0;
  capture?.leave(false);
  runtime.suspend(false);
  syncPlayback();
  audio.unlock();
});
window.addEventListener('hashchange', () => location.reload());
function animate(time) {
  const padMask = readGamepads();
  if (padMask !== gamepadMask) syncInput(padMask);
  if (
    running &&
    !paused &&
    view === 'code' &&
    !(compact && toolsOpen) &&
    time - lastFrame >= 1000 / 60 - 0.5
  ) {
    const interval = 1000 / 60;
    // Keep fractional frame time on high-refresh displays; discard long pauses.
    lastFrame = time - lastFrame > interval * 2 ? time : lastFrame + interval;
    runtime.frame();
  }
  if (capture?.stream && running && paused && view === 'code') paint();
  requestAnimationFrame(animate);
}

setEditorOpen(editorOpen);
setReference(reference);
highlightEditor();
if (/Mac/.test(navigator.userAgent))
  for (const hint of document.querySelectorAll('kbd'))
    hint.textContent = hint.textContent.replace('Alt', 'Option').replace('Ctrl', 'Cmd');
layout();
setView(view);
controls();
requestAnimationFrame(animate);
if (initialHash) {
  const initialEdit = editRevision,
    initialFocus = focusRevision;
  decode(initialHash)
    .then((code) => {
      if (initialEdit !== editRevision) return;
      $('editor').value = code;
      highlightEditor();
      run(code, view === 'code', initialFocus, touch || !editorOpen);
    })
    .catch((error) => {
      if (initialEdit !== editRevision) return;
      $('error').textContent = error.message;
      $('error').hidden = false;
      $('error-notice').hidden = false;
      $('empty').hidden = true;
      $('screen').hidden = false;
    });
} else if (touch || !editorOpen) run(starter, false, focusRevision, true);
else scheduleURL(0);
