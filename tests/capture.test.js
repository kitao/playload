import test from 'node:test';
import assert from 'node:assert/strict';
import { Capture } from '../src/app/capture.js';
import { WebMBuffer, exportWebM } from '../src/app/webm.js';

// Minimal WebM structure with three keyframes and 20 ms Opus packets.
const header = Buffer.from(
  '1a45dfa38018538067ff1549a966872ad7b1830f4240' + '1654ae6b90ae86d78101838101ae86d78102838102',
  'hex',
);
const blocks = Buffer.from(
  '1f43b67592e78100a38581000080aaa38682000080f800' +
    '1f43b67593e78203e8a38581000080bba38682000080f800' +
    '1f43b67593e78207d0a38581000080cca38682000080f800',
  'hex',
);
const recording = Buffer.concat([header, blocks]);
// Chrome's final output when a recorder stops before its first frame.
const emptyRecording = Buffer.concat([
  Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810442858102', 'hex'),
  Buffer.alloc(74),
]);

function setup(t) {
  const previous = globalThis.MediaRecorder,
    previousReader = globalThis.FileReader,
    recorders = [];
  globalThis.FileReader = class {
    readAsArrayBuffer(data) {
      this.readyState = 1;
      Promise.resolve()
        .then(() => data.arrayBuffer())
        .then(
          (result) => {
            if (this.readyState !== 1) return;
            this.result = ArrayBuffer.isView(result)
              ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength)
              : result;
            this.readyState = 2;
            this.onload();
          },
          (error) => {
            if (this.readyState !== 1) return;
            this.error = error;
            this.readyState = 2;
            this.onerror();
          },
        );
    }
    abort() {
      if (this.readyState !== 1) return;
      this.readyState = 2;
      this.aborted = true;
      this.onabort();
    }
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported() {
      return true;
    }
    constructor() {
      this.state = 'inactive';
      recorders.push(this);
    }
    start() {
      this.state = 'recording';
    }
    pause() {
      this.state = 'paused';
    }
    resume() {
      this.state = 'recording';
    }
    requestData() {}
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob() });
        this.onstop();
      });
    }
    emit(data) {
      this.ondataavailable({ data });
    }
  };
  const audioTracks = [],
    capture = new Capture(
      {
        captureStream: () => ({
          getAudioTracks: () => audioTracks,
          addTrack: (track) => audioTracks.push(track),
        }),
      },
      null,
      () => {},
    );
  let now = 0;
  Object.defineProperty(capture, 'now', { get: () => now });
  capture.start();
  t.after(() => {
    capture.clear();
    globalThis.MediaRecorder = previous;
    globalThis.FileReader = previousReader;
  });
  return {
    capture,
    recorders,
    time(value) {
      now = value;
    },
  };
}

test('partial WebM elements retain encoded blocks and export whole audio packets', async () => {
  const buffer = new WebMBuffer();
  buffer.begin(0);
  for (const byte of recording) buffer.append(Uint8Array.of(byte));
  assert.equal(buffer.pending.length, 0);
  assert.deepEqual(
    buffer.frames.map((frame) => [frame.time, frame.kind]),
    [
      [0, 1],
      [0, 2],
      [1000, 1],
      [1000, 2],
      [2000, 1],
      [2000, 2],
    ],
  );
  const saved = new WebMBuffer();
  saved.begin(0);
  saved.append(new Uint8Array(await exportWebM(buffer, 'video/webm', 2010).arrayBuffer()));
  assert.deepEqual(
    saved.frames.filter((frame) => frame.kind === 1).map((frame) => frame.data.at(-1)),
    [0xaa, 0xbb, 0xcc],
  );
  assert.deepEqual(
    saved.frames.filter((frame) => frame.kind === 2).map((frame) => frame.time),
    [0, 1000],
  );
});

test('WebM timestamps retain a nondefault time scale through export', async () => {
  const source = Buffer.from(recording),
    scale = source.indexOf(Buffer.from('2ad7b1830f4240', 'hex'));
  assert.notEqual(scale, -1);
  source.writeUIntBE(500000, scale + 4, 3);

  const buffer = new WebMBuffer();
  buffer.begin(0);
  buffer.append(source);
  assert.deepEqual(
    buffer.frames.map((frame) => [frame.time, frame.kind]),
    [
      [0, 1],
      [0, 2],
      [500, 1],
      [500, 2],
      [1000, 1],
      [1000, 2],
    ],
  );

  const exported = Buffer.from(await exportWebM(buffer, 'video/webm', 1010).arrayBuffer());
  assert(exported.includes(Buffer.from('2ad7b18307a120', 'hex')));
  const saved = new WebMBuffer();
  saved.begin(0);
  saved.append(exported);
  assert.deepEqual(
    saved.frames.map((frame) => [frame.time, frame.kind]),
    [
      [0, 1],
      [0, 2],
      [500, 1],
      [500, 2],
      [1000, 1],
    ],
  );
});

test('restarted WebM remaps retained packets to the latest track numbers', async () => {
  const restarted = Buffer.from(
    recording
      .toString('hex')
      .replaceAll('d78101838101', 'd78103838101')
      .replaceAll('d78102838102', 'd78104838102')
      .replaceAll('a38581000080', 'a38583000080')
      .replaceAll('a38682000080', 'a38684000080'),
    'hex',
  );
  const buffer = new WebMBuffer();
  buffer.begin(0);
  buffer.append(recording);
  buffer.begin(3000);
  buffer.append(restarted);

  const exported = Buffer.from(await exportWebM(buffer, 'video/webm', 6000).arrayBuffer());
  // The first retained packets must use tracks 3/4 while keeping their payloads.
  assert(exported.includes(Buffer.from('a38583000080aa', 'hex')));
  assert(exported.includes(Buffer.from('a38684000080f800', 'hex')));
  assert(!exported.includes(Buffer.from('a38581000080aa', 'hex')));
  assert(!exported.includes(Buffer.from('a38682000080f800', 'hex')));

  const saved = new WebMBuffer();
  saved.begin(0);
  saved.append(exported);
  assert.deepEqual(
    saved.frames.map((frame) => [frame.time, frame.kind]),
    Array.from({ length: 6 }, (_, i) => [
      [i * 1000, 1],
      [i * 1000, 2],
    ]).flat(),
  );
  assert.deepEqual(
    saved.frames.filter((frame) => frame.kind === 1).map((frame) => frame.data.at(-1)),
    [0xaa, 0xbb, 0xcc, 0xaa, 0xbb, 0xcc],
  );
});

test('the rolling video buffer advances to a keyframe within the latest ten seconds', () => {
  const buffer = new WebMBuffer();
  buffer.frames = Array.from({ length: 13 }, (_, i) => ({
    time: i * 1000,
    keyframe: true,
    data: Uint8Array.of(i),
  }));
  buffer.trim(10000);
  assert.equal(buffer.seconds(10000), 10);
  assert.equal(buffer.frames[0].time, 0);
  buffer.trim(10250);
  assert.equal(buffer.seconds(10250), 9.25);
  assert.equal(buffer.frames[0].time, 1000);
  buffer.trim(12250);
  assert.equal(buffer.seconds(12250), 9.25);
  assert.equal(buffer.frames[0].time, 3000);
});

test('the 64 MiB buffer discards dependent frames with the oldest keyframe', () => {
  const buffer = new WebMBuffer(),
    mib = 1024 * 1024;
  buffer.pending = Uint8Array.of(1, 2, 3, 4);
  buffer.frames = [
    { time: 0, keyframe: true, data: { length: 40 * mib } },
    { time: 500, keyframe: false, data: { length: 20 * mib } },
    { time: 1000, keyframe: true, data: { length: 16 * mib } },
  ];
  buffer.trim(2000);
  assert.equal(buffer.frames.length, 1);
  assert.equal(buffer.frames[0].time, 1000);
  assert.equal(buffer.bytes, 16 * mib + 4);
});

test('reference reading suspends the clip clock and preserves buffered play', () => {
  const capture = Object.create(Capture.prototype),
    now = performance.now();
  capture.buffer = new WebMBuffer();
  capture.buffer.frames = [{ time: now - 9000, keyframe: true, data: Uint8Array.of(1) }];
  capture.recorder = {
    state: 'recording',
    requestData() {},
    pause() {
      this.state = 'paused';
    },
    resume() {
      this.state = 'recording';
    },
  };
  capture.session = { requests: [] };
  capture.suspend(true);
  const seconds = capture.seconds;
  // Model a long reference visit without making this test wait a minute.
  capture.suspendedAt -= 70000;
  capture.heldTime = -70000;
  capture.buffer.trim(capture.now);
  assert.ok(Math.abs(capture.seconds - seconds) < 0.01);
  assert.equal(capture.buffer.frames.length, 1);
  assert.equal(capture.recorder.state, 'paused');
  capture.suspend(false);
  assert.equal(capture.recorder.state, 'recording');
  assert.ok(Math.abs(capture.seconds - seconds) < 0.1);
});

test('save waits for ordered Blob reads and leaves the same recorder running', async (t) => {
  const { capture, recorders, time } = setup(t),
    recorder = recorders[0];
  time(1200);
  capture.flush();
  time(2500);
  const pending = capture.save();
  let release;
  const first = new Promise((resolve) => {
    release = resolve;
  });
  recorder.emit({ arrayBuffer: () => first });
  recorder.emit(new Blob([recording.subarray(50)]));
  await new Promise((resolve) => setImmediate(resolve));
  release(recording.subarray(0, 50));
  const saved = await pending;
  assert.ok(saved.size > 0);
  assert.equal(capture.buffer.frames.filter((frame) => frame.keyframe).length, 3);
  assert.equal(capture.recorder, recorder);
  assert.equal(recorder.state, 'recording');
  assert.equal(recorders.length, 1);
});

test('saving before the first frame fails without preventing a later save', async (t) => {
  const { capture, recorders, time } = setup(t),
    recorder = recorders[0];
  const early = capture.save();
  recorder.emit(new Blob([header]));
  await assert.rejects(early, /No video frames were received/);
  assert.equal(capture.error, null);
  time(2500);
  const pending = capture.save();
  recorder.emit(new Blob([blocks]));
  assert.ok((await pending).size > 0);
  assert.equal(recorder.state, 'recording');
});

test('suspending flushes a short clip before the first timer tick', async (t) => {
  const { capture, recorders, time } = setup(t),
    recorder = recorders[0];
  assert.equal(capture.seconds, 0);
  time(250);
  capture.suspend(true);
  assert.equal(recorder.state, 'paused');
  assert.equal(capture.session.requests.length, 1);
  recorder.emit(new Blob([recording]));
  await capture.session.pending;
  assert.equal(capture.seconds, 0.25);

  const pending = capture.save();
  recorder.emit(new Blob());
  assert.ok((await pending).size > 0);
  capture.start();
  assert.equal(capture.seconds, 0);
});

test('empty recorder data does not require a Blob read or prevent a later save', async (t) => {
  const { capture, recorders, time } = setup(t),
    read = globalThis.FileReader.prototype.readAsArrayBuffer;
  globalThis.FileReader.prototype.readAsArrayBuffer = function (data) {
    if (data.size === 0) throw new Error('Cannot load blob');
    return read.call(this, data);
  };
  capture.flush();
  recorders[0].emit(new Blob());
  await capture.session.pending;
  assert.equal(capture.error, null);
  assert.equal(capture.seconds, 0);

  time(2500);
  const pending = capture.save();
  recorders[0].emit(new Blob([recording]));
  assert.ok((await pending).size > 0);
});

test('a new clip rejects its unfinished save and ignores old recorder errors', async (t) => {
  const { capture, recorders, time } = setup(t),
    old = recorders[0],
    pending = capture.save();
  capture.start();
  await assert.rejects(pending, /Recording was replaced/);
  old.onerror();
  assert.equal(capture.error, null);
  time(2500);
  const saved = capture.save();
  recorders[1].emit(new Blob([recording]));
  assert.ok((await saved).size > 0);
  assert.equal(recorders[1].state, 'recording');
});

test('closed and replaced clips do not read late or queued recording Blobs', async (t) => {
  const { capture, recorders } = setup(t);
  let reads = 0;
  const data = {
    arrayBuffer() {
      reads++;
      return Promise.reject(new Error('Expired Blob'));
    },
  };
  const closed = capture.session;
  capture.clear();
  recorders[0].emit(data);
  await closed.pending;
  assert.equal(reads, 0);

  capture.start();
  const replaced = capture.session,
    old = recorders[1];
  capture.flush();
  old.emit(data);
  capture.start();
  old.emit(data);
  await replaced.pending;
  assert.equal(reads, 0);
  assert.equal(capture.error, null);
  assert.equal(capture.buffer.bytes, 0);
});

test('an open recorder ignores unrequested data and still saves an explicit flush', async (t) => {
  const { capture, recorders, time } = setup(t),
    recorder = recorders[0];
  let reads = 0;
  recorder.emit({
    arrayBuffer() {
      reads++;
      return Promise.reject(new Error('Unrequested Blob'));
    },
  });
  await capture.session.pending;
  assert.equal(reads, 0);
  assert.equal(capture.error, null);
  assert.equal(capture.buffer.bytes, 0);
  assert.equal(recorder.state, 'recording');
  time(2500);
  const pending = capture.save();
  recorder.emit(new Blob([recording]));
  assert.ok((await pending).size > 0);
});

test('ending or replacing a clip aborts an in-progress Blob read', async (t) => {
  const { capture, recorders, time } = setup(t);
  for (const replace of [false, true]) {
    if (capture.closed) capture.start();
    const session = capture.session,
      recorder = capture.recorder,
      pending = capture.save();
    let release;
    recorder.emit({
      arrayBuffer: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const reader = session.reader;
    assert.equal(reader.readyState, 1);
    if (replace) capture.start();
    else capture.clear();
    await assert.rejects(pending, /Recording was replaced/);
    assert.equal(reader.aborted, true);
    await session.pending;
    release(recording);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(capture.error, null);
    assert.equal(capture.buffer.bytes, 0);
  }
  time(2500);
  const saved = capture.save();
  recorders.at(-1).emit(new Blob([recording]));
  assert.ok((await saved).size > 0);
});

test('navigation defers queued reads and retains partial WebM data after history restoration', async (t) => {
  const { capture, recorders, time } = setup(t),
    recorder = recorders[0];
  capture.flush();
  recorder.emit(new Blob([recording.subarray(0, 50)]));
  await capture.session.pending;
  assert.ok(capture.buffer.pending.length > 0);

  capture.leave(true);
  time(2500);
  const pending = capture.save();
  let reads = 0;
  recorder.emit({
    arrayBuffer() {
      reads++;
      return Promise.resolve(recording.subarray(50));
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 0);
  assert.equal(capture.error, null);
  assert.equal(recorder.state, 'recording');

  capture.leave(false);
  assert.ok((await pending).size > 0);
  assert.equal(reads, 1);
  assert.equal(capture.buffer.pending.length, 0);
  assert.deepEqual(
    capture.buffer.frames.filter((frame) => frame.keyframe).map((frame) => frame.data.at(-1)),
    [0xaa, 0xbb, 0xcc],
  );
});

test('navigation aborts an active read and retries the same Blob after restoration', async (t) => {
  const { capture, recorders, time } = setup(t);
  time(2500);
  const pending = capture.save();
  let reads = 0,
    release;
  recorders[0].emit({
    arrayBuffer() {
      reads++;
      if (reads > 1) return Promise.resolve(recording);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const reader = capture.session.reader;
  capture.leave(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reader.aborted, true);
  assert.equal(reads, 1);

  capture.leave(false);
  assert.ok((await pending).size > 0);
  assert.equal(reads, 2);
  release(recording);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(capture.buffer.frames.length, 6);
  assert.equal(capture.error, null);
});

test('closing during navigation releases a deferred read without reading the Blob', async (t) => {
  const { capture, recorders } = setup(t);
  capture.leave(true);
  const session = capture.session,
    pending = capture.save();
  let reads = 0;
  recorders[0].emit({
    arrayBuffer() {
      reads++;
      return Promise.resolve(recording);
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  capture.clear();
  await assert.rejects(pending, /Recording was replaced/);
  await session.pending;
  assert.equal(reads, 0);
  assert.equal(capture.buffer.bytes, 0);
  assert.equal(capture.leaving, false);
});

test('late audio restarts once and a save waits for the replacement recorder', async (t) => {
  const { capture, recorders, time } = setup(t),
    old = recorders[0],
    stream = { getAudioTracks: () => [{}] };
  time(2500);
  capture.flush();
  old.emit(new Blob([recording]));
  await capture.session.pending;
  capture.audio(stream);
  const pending = capture.save();
  await capture.restart;
  old.onerror();
  assert.equal(capture.error, null);
  recorders[1].emit(new Blob([recording]));
  assert.ok((await pending).size > 0);
  capture.audio(stream);
  assert.equal(recorders.length, 2);
  assert.equal(capture.stream.getAudioTracks().length, 1);
  assert.equal(recorders[1].state, 'recording');
});

test('late audio discards unfinished output from an empty stopped recorder', async (t) => {
  const { capture, recorders, time } = setup(t),
    old = recorders[0];
  old.stop = function () {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.emit(new Blob([emptyRecording]));
      this.onstop();
    });
  };
  capture.audio({ getAudioTracks: () => [{}] });
  const pending = capture.save();
  await capture.restart;
  assert.equal(capture.error, null);
  assert.equal(recorders.length, 2);
  assert.equal(capture.buffer.bytes, 0);
  time(2500);
  recorders[1].emit(new Blob([recording]));
  assert.ok((await pending).size > 0);
  assert.equal(capture.buffer.frames.length, 6);
});

for (const mode of ['current save', 'ordinary flush during restart', 'recorded stop']) {
  test(`invalid WebM still fails during ${mode}`, async (t) => {
    const { capture, recorders, time } = setup(t),
      old = recorders[0];
    time(2500);
    let pending;
    if (mode === 'current save') {
      pending = capture.save();
      old.emit(new Blob([emptyRecording]));
    } else {
      if (mode === 'recorded stop') {
        capture.flush();
        old.emit(new Blob([recording]));
        await capture.session.pending;
        old.stop = function () {
          this.state = 'inactive';
          queueMicrotask(() => {
            this.emit(new Blob([emptyRecording]));
            this.onstop();
          });
        };
      } else {
        capture.flush();
        old.emit(new Blob([emptyRecording]));
      }
      capture.audio({ getAudioTracks: () => [{}] });
      pending = capture.save();
    }
    await assert.rejects(pending, /Invalid WebM element/);
    assert.match(capture.error.message, /Invalid WebM element/);
  });
}
