import { palette, createEngine } from '../engine/engine.js';
import { glyphs } from '../engine/glyphs.js';
import { encode, decode, gameURL, MAX_COMPRESSED_BYTES, MAX_URL_LENGTH } from '../payload.js';
import { Runtime, Sound, MAX_FRAME_STEPS } from './runtime.js';
import { Capture, download } from './capture.js';
import { createDisplay } from './display.js';
import { createCRT } from './crt.js';
import { highlightJavaScript } from './editor-highlighter.js';
import { EditorHistory } from './editor-history.js';
import { starter, exampleLinks } from './examples.js';

const stylesheet = document.querySelector('link[rel="stylesheet"]');
if (!stylesheet.sheet)
  await new Promise((resolve, reject) => {
    stylesheet.addEventListener('load', resolve, { once: true });
    stylesheet.addEventListener(
      'error',
      () => reject(new Error('The stylesheet could not load.')),
      {
        once: true,
      },
    );
  });

const $ = (id) => document.getElementById(id);
let editorHistory;
const initialHash = location.hash;
const canvas = $('display'),
  context = canvas.getContext('2d');
const screenBackground = getComputedStyle($('viewport')).getPropertyValue('--face').trim();
if (!screenBackground) throw new Error('The stylesheet could not load.');
const display = createDisplay(palette, canvas.width, canvas.height);
const image = new ImageData(display.render(new Uint8Array(160 * 144)), canvas.width, canvas.height);
let screenPixels = new Uint8Array(160 * 144);
let paintedFrame = false,
  lastCaptureFrame = 0;
let crtDisplay;
let pendingSource = '',
  pendingFocus,
  filename = '',
  loadedSource = starter,
  declinedFileSource = null,
  reading = false,
  running = false,
  paused = false,
  crt = true;
let view = 'play',
  reference = 'about',
  capture,
  payload,
  revision = 0,
  columns = 12;
let category = 'emoji',
  lastFrame = null;
let editRevision = 0,
  focusRevision = 0,
  fileRequest,
  fileHandle;
let checkingFile = false,
  fileError = '';
let formatting = false;
let editorErrorLine = null,
  gameError = '',
  urlError = '';
let touch = touchLayout();
let compact = touch;
let editorOpen = !touch && innerWidth >= 600;
let toolsOpen = false,
  awaitingStart = false;
let focusedPane = 'screen';
let pointers = new Map(),
  directions = new Set(),
  keys = new Map(),
  startKeys = new Set();
let gamepadMask = 0;
const audio = new Sound((message) => status('Sound: ' + message));
const runtime = new Runtime(frame, (error) => {
  running = false;
  awaitingStart = false;
  syncPlayback();
  release();
  gameError = error.message || 'Game error';
  updateError();
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
    setView('play');
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

function updateError() {
  const message = gameError || urlError;
  $('error').textContent = message;
  $('error').hidden = !message;
  $('error-notice').hidden = !message;
  if (!gameError) $('error-line').hidden = true;
}

let statusTimer,
  copyRevision = 0;
function status(text = '', target = null) {
  clearTimeout(statusTimer);
  const notice = $('status'),
    copied = text === 'Copied' && !!target;
  for (const animation of notice.getAnimations()) animation.cancel();
  notice.toggleAttribute('data-copy', copied);
  notice.textContent = text;
  if (copied) {
    const source = target.getBoundingClientRect(),
      { width, height } = notice.getBoundingClientRect(),
      x = source.x + source.width / 2,
      overlap = target.classList.contains('glyph') ? 5 : 0,
      top = source.bottom - overlap;
    notice.style.left = Math.max(8, Math.min(innerWidth - width - 8, x - width / 2)) + 'px';
    notice.style.top =
      (top + height <= innerHeight - 8 ? top : source.top - height + overlap) + 'px';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      notice.animate([{ opacity: 1 }, { opacity: 0 }], {
        delay: 500,
        duration: 300,
        easing: 'ease-out',
        fill: 'forwards',
      });
  } else {
    notice.style.removeProperty('left');
    notice.style.removeProperty('top');
  }
  if (text === 'Copied') statusTimer = setTimeout(() => status(), 800);
}
function dismissCopy() {
  copyRevision++;
  if ($('status').hasAttribute('data-copy')) status();
}
document.addEventListener('scroll', dismissCopy, true);
function controls() {
  $('workspace-toolbar').hidden = view === 'info' || (compact && !toolsOpen);
  $('tools-toggle').hidden = !compact || view === 'info';
  $('tools-toggle').setAttribute('aria-expanded', String(toolsOpen));
  $('start-game').hidden = !awaitingStart;
  $('size').hidden = !payload;
  $('pause').disabled = !running || awaitingStart;
  $('screenshot').disabled = !running;
  $('run').disabled = reading;
  $('format').disabled = reading || formatting;
  $('pause').firstChild.textContent = paused && !awaitingStart ? 'Resume' : 'Pause';
  $('record').disabled = !running || !capture?.stream || !!capture?.saveRequest;
  $('video').disabled =
    !running ||
    !capture?.seconds ||
    (!capture?.restarting && !['recording', 'paused'].includes(capture?.recorder?.state)) ||
    !!capture?.saveRequest;
  $('load').disabled = reading;
  $('filename').textContent = filename;
  $('filename').title = filename;
  for (const button of document.querySelectorAll('[data-input]'))
    button.disabled = !running && !awaitingStart;
}
function syncPlayback() {
  if (!running || paused || document.hidden || view === 'info' || (compact && toolsOpen))
    lastFrame = null;
  audio.pause(!running || paused || view === 'info' || (compact && toolsOpen));
  capture?.suspend(
    document.hidden || !running || view === 'info' || awaitingStart || (compact && toolsOpen),
  );
}
function setView(next) {
  dismissCopy();
  if ($('catalog').clientHeight) catalogScroll = $('catalog').scrollTop;
  view = next;
  document.body.dataset.view = next;
  for (const id of ['play', 'info']) $(id).hidden = id !== view;
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-selected', String(button.dataset.view === view));
    button.tabIndex = button.dataset.view === view ? 0 : -1;
  }
  release();
  syncPlayback();
  controls();
  if (view === 'play' && editorOpen && innerWidth >= 600) setSplit(split);
  requestAnimationFrame(fitGame);
  if (view === 'info' && reference === 'characters') renderCharacters();
}
function render(pixels, force = false) {
  let changed = force;
  for (let i = 0; !changed && i < pixels.length; i++) changed = pixels[i] !== screenPixels[i];
  screenPixels = pixels;
  if (changed) paint();
}
function paint() {
  paintedFrame = true;
  canvas.dataset.crt = String(crt);
  if (crt && crtDisplay === undefined) {
    try {
      crtDisplay = createCRT(palette, canvas.width, canvas.height, screenBackground);
      crtDisplay?.canvas.addEventListener('webglcontextlost', () => {
        disableCRT();
        paint();
      });
    } catch {
      crtDisplay = null;
    }
  }
  if (crt && crtDisplay?.render(screenPixels)) {
    context.drawImage(crtDisplay.canvas, 0, 0);
    return;
  }
  if (crt) disableCRT();
  display.render(screenPixels);
  context.putImageData(image, 0, 0);
}
function disableCRT() {
  crt = false;
  canvas.dataset.crt = 'false';
  $('crt').disabled = true;
  $('crt').setAttribute('aria-pressed', 'false');
  $('crt').title = 'CRT is unavailable in this browser.';
}
async function frame(pixels, sounds, ready) {
  render(pixels, ready);
  audio.play(sounds);
  if (!ready) return;
  running = true;
  paused = awaitingStart;
  syncPlayback();
  gameError = '';
  updateError();
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
      paintedFrame = false;
      syncPlayback();
    }
  } catch (error) {
    capture?.close();
    capture = null;
    status('Video: ' + error.message);
  }
  controls();
}
function run(code, takeFocus = false, focusGeneration = focusRevision, waitForStart = false) {
  showPlayer();
  revision++;
  status();
  release();
  capture?.close();
  capture = null;
  audio.reset();
  awaitingStart = waitForStart;
  paused = waitForStart;
  running = false;
  syncPlayback();
  pendingSource = code;
  scheduleURL(0);
  gameError = '';
  updateError();
  editorErrorLine = null;
  updateEditorLines();
  if (compact && takeFocus && focusGeneration === focusRevision) {
    toolsOpen = false;
    $('screen').focus({ preventScroll: true });
    focusGeneration = focusRevision;
  }
  controls();
  pendingFocus = takeFocus ? { element: document.activeElement, revision: focusGeneration } : null;
  if (waitForStart) {
    runtime.stop();
    const welcome = createEngine(glyphs, () => {});
    welcome.api.put(touch ? 7 : 6, 8, touch ? 'TAP TO' : 'CLICK TO', 6);
    welcome.api.put(8, 9, 'PLAY', 6);
    render(welcome.pixels);
    focusAfterRun();
  } else {
    runtime.load(code);
    runtime.suspend(document.hidden);
  }
}
function runCurrentSource(takeFocus = false) {
  if (reading) return;
  toolsOpen = false;
  unlockSound();
  run($('editor').value, takeFocus);
}
function unlockSound() {
  audio.init().catch(() => {
    $('sound').disabled = true;
  });
  audio.unlock();
}
function startGame(takeFocus = true) {
  if (!awaitingStart) return;
  run($('editor').value, takeFocus);
  unlockSound();
  if (takeFocus) focusGame(false);
  fitGame();
}
function targetsPlayer(target) {
  return view === 'play' && !!target.closest('#game');
}
document.addEventListener(
  'pointerdown',
  (event) => {
    if (view === 'play' && !event.target.closest('#workbench, #game, #divider'))
      event.preventDefault();
    if (!awaitingStart || !targetsPlayer(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    startGame();
  },
  true,
);
for (const type of ['pointerup', 'touchend', 'click'])
  document.addEventListener(type, (event) => {
    if (event.isTrusted && pendingSource && !awaitingStart) unlockSound();
  });
function release() {
  keys.clear();
  pointers.clear();
  directions.clear();
  syncInput(0);
}
function focusEditor() {
  $('editor').focus({ preventScroll: true });
  if (compact || innerWidth < 600) window.scrollTo({ top: 0, behavior: 'instant' });
}
function focusGame(reveal = true) {
  if (view !== 'play') setView('play');
  const screen = $('screen'),
    target = touch ? $('game') : screen,
    bounds = target.getBoundingClientRect();
  screen.focus({ preventScroll: true });
  if (reveal && (bounds.top < 0 || bounds.bottom > innerHeight))
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
}
function focusPane() {
  if (view === 'play') $(editorOpen ? focusedPane : 'screen').focus({ preventScroll: true });
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
  for (const value of pointers.values()) mask |= value;
  for (const button of document.querySelectorAll('[data-input]'))
    button.dataset.held = String(!!(mask & (1 << Number(button.dataset.input))));
  runtime.input(mask);
}
function readGamepads() {
  let mask = 0;
  if (
    running &&
    !paused &&
    view === 'play' &&
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
    focusPane();
  };
const tabs = $('views');
tabs.onkeydown = (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 'play'
      : event.key === 'End'
        ? 'info'
        : view === 'play'
          ? 'info'
          : 'play';
  setView(next);
  $(next + '-tab').focus();
};
$('viewport').onpointerdown = (event) => {
  if (event.button !== 0 || event.target.closest('button, #error-notice')) return;
  if (compact && toolsOpen) $('tools-toggle').click();
  if (event.pointerType === 'mouse') event.preventDefault();
  focusGame(false);
};
$('viewport').onmousedown = (event) => {
  if (event.button === 0 && !event.target.closest('button, #error-notice')) event.preventDefault();
};
$('viewport').onclick = (event) => {
  if (event.target.closest('button, #error-notice')) return;
  if (awaitingStart) {
    startGame();
    return;
  }
  focusGame(false);
  audio.unlock();
};
$('start-game').onclick = () => startGame();
$('game').addEventListener('pointerdown', () => audio.unlock());
$('pause').onclick = () => {
  paused = !paused;
  toolsOpen = compact && paused && !editorOpen;
  release();
  audio.unlock();
  syncPlayback();
  controls();
  fitGame();
};
$('tools-toggle').onclick = () => {
  toolsOpen = !toolsOpen;
  release();
  audio.unlock();
  syncPlayback();
  controls();
  focusPane();
  fitGame();
};
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
$('screenshot').onclick = () =>
  canvas.toBlob((blob) => {
    if (blob) download(blob, 'playload.png');
  });
$('record').onclick = () => {
  try {
    capture?.start();
    status();
  } catch (error) {
    capture?.close();
    capture = null;
    status('Video: ' + error.message);
  }
  controls();
};
$('video').onclick = async () => {
  const recording = capture,
    focused = document.activeElement === $('video'),
    revision = focusRevision;
  try {
    audio.unlock();
    const promise = recording.save();
    controls();
    const blob = await promise;
    if (recording !== capture) return;
    download(blob, 'playload.webm');
    status();
  } catch (error) {
    if (recording === capture) status(error.message);
  } finally {
    controls();
    if (
      recording === capture &&
      focused &&
      revision === focusRevision &&
      document.activeElement === document.body &&
      compact &&
      toolsOpen &&
      view === 'play' &&
      !$('video').disabled
    )
      $('video').focus({ preventScroll: true });
  }
};
async function copy(text, target) {
  const version = ++copyRevision;
  let copied = false;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    // Some browsers deny clipboard access even after a tap.
  }
  if (version !== copyRevision || !target.isConnected || !target.getBoundingClientRect().height)
    return;
  if (!copied) {
    const focused = document.activeElement;
    const field = document.createElement('textarea');
    field.className = 'clipboard-field';
    field.value = text;
    field.readOnly = true;
    document.body.append(field);
    try {
      field.focus({ preventScroll: true });
      field.select();
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      field.remove();
      focused?.focus({ preventScroll: true });
    }
  }
  if (copied) status('Copied', target);
  else {
    status('Could not copy.');
    statusTimer = setTimeout(() => status(), 2000);
  }
}

function gameTitle(code) {
  for (const comment of code.matchAll(/\s*(?:\/\/([^\r\n\u2028\u2029]*)|\/\*([\s\S]*?)\*\/)/gy)) {
    const title = /^[ \t]*\*?[ \t]*@title(?:[ \t]+([^\r\n\u2028\u2029]*))?$/m.exec(
      comment[1] ?? comment[2],
    );
    if (title) return title[1]?.trim() || '';
  }
  return '';
}

let urlTimer,
  urlRevision = 0;
function scheduleURL(delay = 250) {
  clearTimeout(urlTimer);
  const version = ++urlRevision,
    code = $('editor').value,
    writeURL = !!initialHash || editRevision > 0 || code !== starter;
  const title = writeURL ? gameTitle(code) : null;
  document.title = title ? `${title} — Playload` : 'Playload';
  urlTimer = setTimeout(async () => {
    try {
      const encoded = await encode(code);
      if (version !== urlRevision || code !== $('editor').value) return;
      const url = new URL(location.href);
      url.searchParams.delete('edit');
      url.hash =
        initialHash && editRevision === 0 && code === loadedSource ? initialHash : encoded.hash;
      payload = encoded;
      $('size-current').textContent = (encoded.bytes / 1024).toFixed(2) + ' KB';
      $('size').title = encoded.bytes + ' bytes · ' + url.href.length + ' URL characters';
      urlError = '';
      if (encoded.bytes > MAX_COMPRESSED_BYTES || url.href.length > MAX_URL_LENGTH) {
        url.hash = '';
        urlError =
          encoded.bytes > MAX_COMPRESSED_BYTES
            ? 'Code exceeds 3 KB compressed.'
            : 'Bookmark URL exceeds 4,096 characters.';
      }
      updateError();
      if (writeURL) history.replaceState(null, '', url);
      controls();
    } catch (error) {
      if (version !== urlRevision) return;
      const url = new URL(location.href);
      url.hash = '';
      if (writeURL) history.replaceState(null, '', url);
      payload = null;
      urlError = error.message;
      updateError();
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
async function formatCurrentSource() {
  if (reading || formatting) return;
  const editor = $('editor'),
    source = editor.value,
    edit = editRevision,
    focus = focusRevision,
    start = editor.selectionStart,
    end = editor.selectionEnd,
    direction = editor.selectionDirection,
    scrollTop = editor.scrollTop,
    scrollLeft = editor.scrollLeft;
  let worker, timer;
  formatting = true;
  controls();
  try {
    const script = new URL($('format').dataset.formatter, location.href).href;
    worker = new Worker(script, { type: 'module' });
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(data));
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error('The formatter could not load.'));
      };
      timer = setTimeout(() => reject(new Error('Formatting took too long.')), 10000);
      worker.postMessage({ source, start, end });
    });
    if (edit !== editRevision || source !== editor.value) {
      status('Code changed while formatting. Your edits were kept.');
      return;
    }
    if (
      focus !== focusRevision ||
      start !== editor.selectionStart ||
      end !== editor.selectionEnd ||
      direction !== editor.selectionDirection
    ) {
      status('Formatting canceled because the editor focus or selection changed.');
      return;
    }
    if (result.source === source) return;
    editor.focus({ preventScroll: true });
    editorHistory.replace(result.source, result.start, result.end, direction);
    editor.scrollTop = scrollTop;
    editor.scrollLeft = scrollLeft;
    syncEditorScroll();
    status();
  } catch (error) {
    status('Format: ' + error.message);
  } finally {
    clearTimeout(timer);
    worker?.terminate();
    formatting = false;
    controls();
  }
}
function discard() {
  return (
    $('editor').value === loadedSource ||
    confirm('The code was edited in the browser. Replace it with a file?')
  );
}
function readRequest() {
  return { edit: editRevision };
}
async function readFile(file, request, handle = null) {
  const text = await file.text();
  if (request.edit !== editRevision) {
    status('Code changed while loading. Your edits were kept.');
    return false;
  }
  fileHandle = handle;
  fileError = '';
  declinedFileSource = null;
  loadedSource = text;
  $('editor').value = loadedSource;
  editorHistory.reset();
  filename = file.name;
  editRevision++;
  highlightEditor();
  toolsOpen = false;
  run(loadedSource);
  return true;
}
async function chooseFile(request) {
  reading = true;
  controls();
  if (!window.showOpenFilePicker) {
    fileRequest = request;
    $('file').click();
    return;
  }
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
async function refreshFile() {
  if (checkingFile || reading || !fileHandle || document.hidden) return;
  const handle = fileHandle,
    edit = editRevision,
    editor = $('editor');
  checkingFile = true;
  try {
    const file = await handle.getFile(),
      text = await file.text();
    if (reading || handle !== fileHandle || edit !== editRevision || document.hidden) return;
    if (fileError && $('status').textContent === fileError) status();
    fileError = '';
    if (text === loadedSource) {
      declinedFileSource = null;
      return;
    }
    if (editor.value !== loadedSource && editor.value !== text) {
      if (text === declinedFileSource) return;
      if (!confirm('The code was edited in the browser. Replace it with a file?')) {
        declinedFileSource = text;
        return;
      }
    }
    declinedFileSource = null;
    loadedSource = text;
    editor.value = text;
    editorHistory.reset();
    changed();
    run(text);
  } catch (error) {
    if (reading || handle !== fileHandle || edit !== editRevision) return;
    const message =
      error.name === 'NotAllowedError' ? 'Load the file again to restore access.' : error.message;
    if (message !== fileError) status(message);
    fileError = message;
    if (error.name === 'NotAllowedError') fileHandle = null;
  } finally {
    checkingFile = false;
  }
}
setInterval(refreshFile, 250);
window.addEventListener('focus', refreshFile);
$('file').oncancel = () => {
  fileRequest = null;
  reading = false;
  status();
  controls();
};
$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file) {
    $('file').oncancel();
    return;
  }
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
$('run').onclick = () => runCurrentSource();
$('format').onclick = formatCurrentSource;
$('editor').oninput = changed;
$('editor').onfocus = release;
$('workbench').onpointerdown = (event) => {
  if (!event.target.closest('button')) $('editor').focus({ preventScroll: true });
};
document.addEventListener('focusin', () => {
  focusRevision++;
  if (['editor', 'screen'].includes(document.activeElement.id))
    focusedPane = document.activeElement.id;
  if (document.activeElement !== $('screen')) release();
});
$('editor').onkeydown = (event) => {
  if (event.isComposing) return;
  if (event.code === 'KeyF' && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) formatCurrentSource();
  } else if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    document.execCommand('insertText', false, '  ');
  }
};
$('editor').value = starter;
editorHistory = new EditorHistory($('editor'));

function setReference(next) {
  dismissCopy();
  if ($('catalog').clientHeight) catalogScroll = $('catalog').scrollTop;
  const selected = next === 'characters' ? category : next,
    resetScroll = !['about', 'api', 'examples'].includes(selected) && selected !== category;
  if (resetScroll) {
    category = selected;
    catalogScroll = 0;
  }
  reference = ['about', 'api', 'examples'].includes(selected) ? selected : 'characters';
  for (const button of document.querySelectorAll('[data-ref]')) {
    const active = button.dataset.ref === selected;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const id of ['about', 'api', 'characters', 'examples']) $(id).hidden = id !== reference;
  if (reference === 'characters') {
    $('characters').setAttribute('aria-labelledby', selected + '-tab');
    renderCharacters();
  }
}
for (const entry of exampleLinks) {
  const row = document.createElement('li'),
    playLink = document.createElement('a'),
    size = document.createElement('span'),
    description = document.createElement('span');
  playLink.textContent = entry.name;
  playLink.href = gameURL(new URL('.', location.href).href, entry.hash);
  playLink.setAttribute('aria-label', 'Play ' + entry.name);
  playLink.target = '_blank';
  playLink.rel = 'noopener';
  size.className = 'example-size';
  size.textContent = (entry.bytes / 1024).toFixed(2) + ' KB';
  description.className = 'example-description';
  description.textContent = entry.description;
  row.append(playLink, size, description);
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
  catalogScroll = 0,
  catalogStart = -1,
  catalogEnd = -1,
  catalogFrame;
function renderCharacters() {
  catalogItems = glyphs.filter((g) => g.group === category);
  const catalog = $('catalog');
  const firstVisible = Math.floor(catalogScroll / 44) * columns;
  const nextColumns = Math.max(3, Math.floor((catalog.clientWidth + 4) / 72));
  const resized = nextColumns !== columns;
  columns = nextColumns;
  $('catalog-window').style.setProperty('--columns', columns);
  $('catalog-space').style.height = Math.ceil(catalogItems.length / columns) * 44 + 'px';
  catalog.scrollTop = resized ? Math.floor(firstVisible / columns) * 44 : catalogScroll;
  catalogScroll = catalog.scrollTop;
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
    button.onclick = () => copy(glyph.ch, button);
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
    if (!$('catalog').clientHeight) return;
    catalogScroll = $('catalog').scrollTop;
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
  const color = document.createElement('div'),
    swatch = document.createElement('span');
  const number = document.createElement('span'),
    detail = document.createElement('span');
  color.className = 'color';
  swatch.className = 'swatch';
  swatch.style.background = palette[index];
  number.textContent = index;
  detail.className = 'hex';
  detail.textContent = palette[index].toUpperCase();
  color.append(swatch, number, detail);
  $('palette').append(color);
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
  if (startKeys.has(event.code)) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Tab' && view === 'play') {
    event.preventDefault();
    return;
  }
  if (
    awaitingStart &&
    targetsPlayer(document.activeElement) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !['Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(event.key)
  ) {
    startGame();
    event.preventDefault();
    startKeys.add(event.code);
    return;
  }
  if (event.isComposing) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    const id = { Enter: 'run', NumpadEnter: 'run', KeyO: 'load' }[event.code];
    if (id && view === 'play' && !$(id).disabled) {
      event.preventDefault();
      if (!event.repeat) {
        if (id === 'run') runCurrentSource(true);
        else $(id).click();
      }
    }
    return;
  }
  if (view !== 'play') return;
  if (
    event.key === 'Escape' &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    if (!event.repeat && !$('pause').disabled) {
      $('pause').click();
      if (paused && editorOpen) focusEditor();
      else if (!toolsOpen) focusGame();
    }
    return;
  }
  if (editable(event.target)) return;
  const input = gameButton(event);
  if (
    document.activeElement === $('screen') &&
    (running || runtime.pending) &&
    !paused &&
    !(compact && toolsOpen) &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    input != null
  ) {
    event.preventDefault();
    audio.unlock();
    keys.set(event.code, input);
    syncInput();
  }
  if (!event.altKey || event.repeat || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const id = {
    KeyE: 'error-line',
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
  startKeys.delete(event.code);
  if (keys.delete(event.code)) {
    syncInput();
  }
});
const dpad = document.querySelector('.dpad');
function padMask(event, previous = 0) {
  const rect = dpad.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX >= rect.right ||
    event.clientY < rect.top ||
    event.clientY >= rect.bottom
  )
    return 0;
  const x = event.clientX - rect.left - rect.width / 2,
    y = event.clientY - rect.top - rect.height / 2;
  if (x === 0 && y === 0) return previous;
  // Eight equal direction sectors, including the four diagonals.
  const slope = Math.SQRT2 - 1;
  let mask = 0;
  if (Math.abs(x) > Math.abs(y) * slope) mask |= x < 0 ? 4 : 8;
  if (Math.abs(y) > Math.abs(x) * slope) mask |= y < 0 ? 1 : 2;
  return mask;
}
for (const control of [dpad, ...document.querySelectorAll('.ab [data-input]')]) {
  control.onpointerdown = (event) => {
    if (!(running || runtime.pending) || view !== 'play' || (compact && toolsOpen)) return;
    if (paused) return;
    event.preventDefault();
    focusGame(false);
    audio.unlock();
    control.setPointerCapture(event.pointerId);
    const mask = control === dpad ? padMask(event) : 1 << Number(control.dataset.input);
    pointers.set(event.pointerId, mask);
    if (control === dpad) directions.add(event.pointerId);
    syncInput();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    control.addEventListener(name, (event) => {
      pointers.delete(event.pointerId);
      directions.delete(event.pointerId);
      syncInput();
    });
}
document.addEventListener('pointermove', (event) => {
  if (!directions.has(event.pointerId)) return;
  pointers.set(event.pointerId, padMask(event, pointers.get(event.pointerId)));
  syncInput();
});
function nativeTouch(target) {
  const scroll = target.closest('.reference-scroll, #workspace-toolbar');
  return (
    target.closest('#workbench, #about, #api, #characters, #examples, #error-notice') ||
    (editorOpen && target.closest('#viewport')) ||
    (scroll &&
      (scroll.scrollWidth > scroll.clientWidth || scroll.scrollHeight > scroll.clientHeight))
  );
}
// Keep native editing and scrolling; tool chrome must not trigger iOS text gestures.
$('app').addEventListener(
  'touchstart',
  (event) => {
    if (!nativeTouch(event.target)) event.preventDefault();
  },
  { passive: false },
);
$('app').addEventListener(
  'touchend',
  (event) => {
    for (const finger of event.changedTouches) {
      if (nativeTouch(finger.target)) continue;
      event.preventDefault();
      const action = finger.target.closest('button:not([data-input]), a');
      if (
        action &&
        $('app').contains(action) &&
        !action.disabled &&
        document.elementFromPoint(finger.clientX, finger.clientY)?.closest('button, a') === action
      )
        action.click();
    }
  },
  { passive: false },
);
$('app').oncontextmenu = (event) => {
  if (
    (touch || event.pointerType === 'touch') &&
    (!nativeTouch(event.target) || event.target.closest('button'))
  )
    event.preventDefault();
};
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
  if (!touch || event.pointerType !== 'touch' || event.isPrimary || !nativeTouch(event.target))
    return;
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
window.addEventListener('blur', () => {
  startKeys.clear();
  release();
});
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
  const player = $('viewport'),
    errorRows = Math.max(1, Math.min(5, Math.floor((player.clientHeight - 8) / 20)));
  player.style.setProperty('--error-text-height', errorRows * 20 + 'px');
}
function setEditorOpen(open) {
  editorOpen = open;
  document.body.dataset.editorClosed = String(!open);
  for (const el of [$('workbench'), $('divider'), document.querySelector('.editor-status')])
    el.hidden = !open;
  $('code-toggle').setAttribute('aria-pressed', String(open));
  if (open && view === 'play' && innerWidth >= 600) setSplit(split);
  fitGame();
}
$('code-toggle').onclick = () => {
  setEditorOpen(!editorOpen);
  toolsOpen = false;
  controls();
  syncPlayback();
  focusPane();
};
function touchLayout() {
  return matchMedia('(pointer:coarse)').matches;
}
function layout() {
  touch = touchLayout();
  document.body.dataset.touch = String(touch);
  const nextCompact = touch;
  if (compact !== nextCompact) toolsOpen = false;
  compact = nextCompact;
  document.body.dataset.compact = String(compact);
  $('keyboard-controls').hidden = touch;
  $('start-game').textContent = touch ? 'Tap to play' : 'Click to play';
  controls();
  syncPlayback();
  if (view === 'play' && editorOpen && innerWidth >= 600) setSplit(split);
  else fitGame();
}
let split = 0.5,
  dragging;
function setSplit(value) {
  const area = $('play'),
    available = Math.max(1, area.clientWidth - 8);
  const min = Math.min(0.35, 140 / available),
    max = 1 - Math.min(0.6, 240 / available);
  split = Math.max(min, Math.min(max, value));
  // Keep the adjoining rectangle edges on whole pixels, including after dragging.
  area.style.setProperty('--editor-width', Math.round(available * split) + 'px');
  $('divider').setAttribute('aria-valuemin', Math.round(min * 100));
  $('divider').setAttribute('aria-valuemax', Math.round(max * 100));
  $('divider').setAttribute('aria-valuenow', Math.round(split * 100));
  fitGame();
}
$('divider').onpointerdown = (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging = event.pointerId;
  $('divider').setPointerCapture(event.pointerId);
  document.body.classList.add('resizing');
};
$('divider').onpointermove = (event) => {
  if (dragging !== event.pointerId) return;
  const rect = $('play').getBoundingClientRect();
  setSplit((event.clientX - rect.left - 4) / Math.max(1, rect.width - 8));
};
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('divider').addEventListener(name, (event) => {
    if (dragging !== event.pointerId) return;
    dragging = null;
    document.body.classList.remove('resizing');
  });
$('divider').onkeydown = (event) => {
  const change = { ArrowLeft: -0.05, ArrowRight: 0.05 }[event.key];
  if (change == null && !['Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  setSplit(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : split + change);
};
const gameLayout = new ResizeObserver(() => requestAnimationFrame(fitGame));
gameLayout.observe($('picture'));
window.addEventListener('resize', () => {
  dismissCopy();
  release();
  layout();
  if (reference === 'characters' && view === 'info') renderCharacters();
});
document.addEventListener('visibilitychange', () => {
  lastFrame = null;
  if (document.hidden) startKeys.clear();
  release();
  runtime.suspend(document.hidden);
  syncPlayback();
  if (!document.hidden) {
    audio.unlock();
    refreshFile();
  }
});
window.addEventListener('beforeunload', () => capture?.leave(true));
window.addEventListener('pagehide', (event) => {
  startKeys.clear();
  release();
  if (event.persisted) {
    capture?.leave(true);
    runtime.suspend(true);
    audio.pause(true);
    capture?.suspend(true);
  } else {
    revision++;
    runtime.stop();
    audio.close();
    capture?.close();
  }
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  lastFrame = null;
  capture?.leave(false);
  runtime.suspend(document.hidden);
  syncPlayback();
  if (!document.hidden) audio.unlock();
});
window.addEventListener('hashchange', () => {
  revision++;
  capture?.leave(true);
  location.reload();
});
function animate(time) {
  const padMask = readGamepads();
  if (padMask !== gamepadMask) syncInput(padMask);
  if (running && !document.hidden && !paused && view === 'play' && !(compact && toolsOpen)) {
    const interval = 1000 / 60;
    if (lastFrame === null) lastFrame = time;
    const elapsed = time - lastFrame;
    if (elapsed >= interval - 0.5) {
      // Catch up short rendering stalls with fixed updates and one picture.
      // Bound the work and discard long gaps, rather than queueing old input.
      const steps =
        elapsed > 250 ? 1 : Math.min(MAX_FRAME_STEPS, Math.floor((elapsed + 0.5) / interval));
      if (runtime.frame(steps))
        lastFrame = elapsed > interval * MAX_FRAME_STEPS ? time : lastFrame + steps * interval;
    }
  } else lastFrame = null;
  if (
    capture?.stream &&
    !capture.suspended &&
    running &&
    !document.hidden &&
    time - lastCaptureFrame >= 1000 / 30
  ) {
    // Static games and paused recordings still need fresh video timestamps.
    // Reuse the already-rendered picture instead of re-running the CRT shader.
    if (!paintedFrame) context.drawImage(canvas, 0, 0);
    paintedFrame = false;
    lastCaptureFrame = time;
  }
  requestAnimationFrame(animate);
}
function showPlayer() {
  fitGame();
  document.body.removeAttribute('data-loading');
}

$('app').hidden = false;
paint();
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
      loadedSource = code;
      $('editor').value = code;
      editorHistory.reset();
      highlightEditor();
      run(code, view === 'play', initialFocus, true);
    })
    .catch((error) => {
      if (initialEdit !== editRevision) return;
      gameError = error.message;
      updateError();
      showPlayer();
      if (view === 'play' && initialFocus === focusRevision) focusGame();
    });
} else run(starter, true, focusRevision, true);
