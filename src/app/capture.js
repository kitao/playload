import { WebMBuffer, exportWebM, MAX_RECORDING_BYTES, recordingTooLarge } from './webm.js';

export class Capture {
  constructor(canvas, audioStream, onChange) {
    this.onChange = onChange;
    this.mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus'].find((type) =>
      globalThis.MediaRecorder?.isTypeSupported(type),
    );
    if (!this.mime || !canvas.captureStream) return;
    this.stream = canvas.captureStream(60);
    for (const track of audioStream?.getAudioTracks() ?? []) this.stream.addTrack(track);
  }
  get now() {
    return (this.suspended ? this.suspendedAt : performance.now()) - (this.heldTime ?? 0);
  }
  suspend(active) {
    if (!!this.suspended === active) return;
    if (active) {
      this.suspendedAt = performance.now();
      this.suspended = true;
      for (const session of this.sessions())
        if (session.recorder.state === 'recording') session.recorder.pause();
      if (!this.restarting || this.split) this.flush();
    } else {
      this.heldTime = (this.heldTime ?? 0) + performance.now() - this.suspendedAt;
      this.suspended = false;
      for (const session of this.sessions())
        if (session.recorder.state === 'paused') session.recorder.resume();
    }
    this.onChange?.();
  }
  leave(active) {
    if (!!this.leaving === active) return;
    this.leaving = active;
    if (active) {
      this.returned = new Promise((resolve) => {
        this.returnResolve = resolve;
      });
      for (const session of this.sessions()) session.reader?.abort();
    } else {
      this.returnResolve?.();
      this.returnResolve = null;
    }
  }
  start() {
    if (!this.stream) return;
    const audio = this.nextAudio;
    this.clear();
    for (const track of audio?.getAudioTracks() ?? []) this.stream.addTrack(track);
    this.buffer = new WebMBuffer();
    this.closed = false;
    this.error = null;
    this.rollover = false;
    this.begin();
    this.timer = setInterval(() => {
      if (this.error || this.closed || this.suspended || this.restarting || this.leaving) return;
      this.flush();
      // Allow for the few milliseconds spent starting the previous recorder.
      if (this.rollover && this.now - this.session.start >= 1900) this.restartVideo();
    }, 1000);
    this.onChange();
  }
  sessions() {
    return [this.session, this.audioSession].filter(Boolean);
  }
  begin(audio = false) {
    let intervalSupported = false;
    const options = {
      // Request only codecs with an input track; an unused Opus encoder can
      // prevent Firefox from finishing a video-only recording.
      mimeType: this.stream.getAudioTracks().length ? this.mime : this.mime.replace(',opus', ''),
      get videoKeyFrameIntervalDuration() {
        intervalSupported = true;
        return 1000;
      },
    };
    let recorder;
    if (this.split === undefined) {
      recorder = new MediaRecorder(this.stream, options);
      this.split = !intervalSupported;
    }
    if (this.split) {
      // A continuous audio encoder avoids Opus padding at video joins. Only
      // the video recorder restarts if encoded keyframes remain too far apart.
      const tracks = audio ? this.stream.getAudioTracks() : this.stream.getVideoTracks();
      recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: audio ? 'audio/webm;codecs=opus' : this.mime.replace(',opus', ''),
      });
    } else recorder ??= new MediaRecorder(this.stream, options);
    const parser = this.split ? new WebMBuffer() : this.buffer;
    parser.begin(this.now);
    const session = {
      recorder,
      parser,
      start: this.now,
      buffer: this.buffer,
      requests: [],
      pending: Promise.resolve(),
    };
    recorder.ondataavailable = ({ data }) => {
      const request = session.requests.shift();
      if (!request) return;
      // Blob reads can finish out of order; parse each flush in event order.
      session.pending = session.pending
        .then(async () => {
          let bytes;
          do {
            if (this.leaving) await this.returned;
            if (session.buffer !== this.buffer || this.closed) return;
            bytes = await new Promise((resolve, reject) => {
              if (data.size === 0) {
                resolve(new ArrayBuffer(0));
                return;
              }
              const reader = (session.reader = new FileReader());
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.onabort = () => resolve(null);
              reader.readAsArrayBuffer(data);
            }).finally(() => {
              session.reader = null;
            });
          } while (bytes === null);
          if (session.buffer !== this.buffer || this.closed) return;
          try {
            session.parser.append(new Uint8Array(bytes));
            if (this.split) {
              if (session === this.session && !this.rollover)
                for (const frame of session.parser.frames) {
                  if (frame.keyframe) session.lastKeyframe = frame.time;
                  if (
                    frame.kind === 1 &&
                    session.lastKeyframe !== undefined &&
                    frame.time - session.lastKeyframe > 2100
                  )
                    this.rollover = true;
                }
              session.buffer.merge(session.parser);
            }
          } catch (error) {
            // Chrome can stop an empty recorder with an unfinished WebM header.
            if (
              request.final &&
              !this.split &&
              this.restarting &&
              session === this.session &&
              !session.buffer.frames.length
            ) {
              this.buffer = new WebMBuffer();
              return;
            }
            throw error;
          }
          session.buffer.trim(request.end);
          if (
            this.split &&
            session.buffer.bytes +
              this.sessions().reduce((sum, active) => sum + active.parser.bytes, 0) >
              MAX_RECORDING_BYTES
          )
            throw recordingTooLarge();
          if (request.done) request.done();
          else if (request.resolve) {
            try {
              request.resolve(exportWebM(session.buffer, this.mime, request.end));
            } catch (error) {
              request.reject(error);
            }
          }
          this.onChange();
        })
        .catch((error) => {
          if (session.buffer === this.buffer && !this.closed) {
            this.fail(error);
          }
          request.reject?.(error);
        });
    };
    recorder.onstop = async () => {
      await session.pending;
      // fail() clears restarting, so an errored capture never restarts here.
      if (session !== this.session || this.closed || !this.restarting) return;
      try {
        for (const track of this.nextAudio?.getAudioTracks() ?? []) this.stream.addTrack(track);
        this.nextAudio = null;
        this.restarting = false;
        this.begin();
      } catch (error) {
        this.fail(error);
      }
      this.restartResolve?.();
      this.restartResolve = null;
      this.onChange();
    };
    recorder.onerror = () => {
      if (!this.sessions().includes(session) || this.closed) return;
      this.fail(new Error('Video recording failed'));
    };
    if (audio) this.audioSession = session;
    else {
      this.session = session;
      this.recorder = recorder;
    }
    recorder.start();
    if (this.suspended) recorder.pause();
    if (this.split && !audio && !this.audioSession && this.stream.getAudioTracks().length)
      this.begin(true);
  }
  flush(request = { end: this.now }) {
    const sessions = this.sessions();
    if (this.split && request.resolve) {
      let remaining = sessions.length;
      const done = () => {
        if (--remaining) return;
        try {
          request.resolve(exportWebM(this.buffer, this.mime, request.end));
        } catch (error) {
          request.reject(error);
        }
      };
      for (const session of sessions)
        this.flushSession(session, { end: request.end, done, reject: request.reject });
    } else for (const session of sessions) this.flushSession(session, { ...request });
  }
  flushSession(session, request) {
    if (this.error) {
      request.reject?.(this.error);
      return;
    }
    if (!['recording', 'paused'].includes(session.recorder.state)) {
      request.reject?.(new Error('Video is not available'));
      return;
    }
    session.requests.push(request);
    try {
      session.recorder.requestData();
    } catch (error) {
      session.requests.pop();
      request.reject?.(error);
    }
  }
  stop(session = this.session) {
    if (!['recording', 'paused'].includes(session?.recorder.state)) return;
    session.requests.push({ end: this.now, final: true });
    session.recorder.stop();
  }
  audio(stream) {
    if (!stream || !this.stream || this.stream.getAudioTracks().length || this.closed || this.error)
      return;
    if (this.split) {
      try {
        for (const track of stream.getAudioTracks()) this.stream.addTrack(track);
        this.begin(true);
      } catch (error) {
        this.fail(error);
      }
      return;
    }
    this.nextAudio = stream;
    this.restartVideo();
  }
  restartVideo() {
    if (this.restarting || this.error || this.closed) return;
    this.restarting = true;
    this.restart = new Promise((resolve) => {
      this.restartResolve = resolve;
    });
    this.stop();
  }
  fail(error) {
    if (this.closed || this.error) return;
    this.error = error;
    clearInterval(this.timer);
    this.saveRequest?.reject(error);
    this.restarting = false;
    this.restartResolve?.();
    this.restartResolve = null;
    for (const session of this.sessions()) this.stop(session);
    this.onChange();
  }
  get seconds() {
    return this.closed ? 0 : (this.buffer?.seconds(this.now) ?? 0);
  }
  async save() {
    if (this.error) throw this.error;
    if (this.saveRequest) throw new Error('Video is already being saved');
    const request = {};
    this.saveRequest = request;
    let timer;
    try {
      const blob = await new Promise((resolve, reject) => {
        request.resolve = resolve;
        request.reject = reject;
        timer = setTimeout(() => reject(new Error('No video frames were received')), 10000);
        const flush = () => {
          if (this.saveRequest !== request) return;
          request.end = this.now;
          this.flush(request);
        };
        if (this.restarting) this.restart.then(flush);
        else flush();
      });
      if (this.saveRequest !== request) throw new Error('Recording was replaced');
      return blob;
    } finally {
      clearTimeout(timer);
      if (this.saveRequest === request) this.saveRequest = null;
    }
  }
  clear() {
    this.closed = true;
    this.leave(false);
    for (const session of this.sessions()) session.reader?.abort();
    this.restarting = false;
    clearInterval(this.timer);
    this.saveRequest?.reject(new Error('Recording was replaced'));
    this.saveRequest = null;
    this.restartResolve?.();
    this.restartResolve = null;
    this.nextAudio = null;
    for (const session of this.sessions()) this.stop(session);
    this.audioSession = null;
  }
  close() {
    this.clear();
    for (const track of this.stream?.getVideoTracks() ?? []) track.stop();
  }
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
