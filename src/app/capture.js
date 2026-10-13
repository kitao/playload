import { WebMBuffer, exportWebM } from './webm.js';

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
      if (this.recorder?.state === 'recording') {
        this.recorder.pause();
        if (!this.restarting) this.flush();
      }
    } else {
      this.heldTime = (this.heldTime ?? 0) + performance.now() - this.suspendedAt;
      this.suspended = false;
      if (this.recorder?.state === 'paused') this.recorder.resume();
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
      this.session?.reader?.abort();
    } else {
      this.returnResolve?.();
      this.returnResolve = null;
    }
  }
  start() {
    if (!this.stream) return;
    this.clear();
    this.buffer = new WebMBuffer();
    this.closed = false;
    this.error = null;
    this.begin();
    this.timer = setInterval(() => {
      if (!this.suspended && !this.restarting && !this.leaving) this.flush();
    }, 1000);
    this.onChange();
  }
  begin() {
    this.buffer.begin(this.now);
    const recorder = new MediaRecorder(this.stream, {
      mimeType: this.mime,
      videoKeyFrameIntervalDuration: 1000,
    });
    const session = { recorder, buffer: this.buffer, requests: [], pending: Promise.resolve() };
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
            session.buffer.append(new Uint8Array(bytes));
          } catch (error) {
            // Chrome can stop an empty recorder with an unfinished WebM header.
            if (
              request.final &&
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
          if (request.resolve) {
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
            this.error = error;
            this.saveRequest?.reject(error);
            this.onChange();
          }
          request.reject?.(error);
        });
    };
    recorder.onstop = async () => {
      await session.pending;
      if (session !== this.session || this.closed || !this.restarting) return;
      try {
        for (const track of this.nextAudio.getAudioTracks()) this.stream.addTrack(track);
        this.nextAudio = null;
        this.restarting = false;
        this.begin();
      } catch (error) {
        this.error = error;
        this.saveRequest?.reject(error);
      }
      this.restartResolve();
      this.restartResolve = null;
      this.onChange();
    };
    recorder.onerror = () => {
      if (session !== this.session || this.closed) return;
      this.error = new Error('Video recording failed');
      this.saveRequest?.reject(this.error);
      this.onChange();
    };
    this.session = session;
    this.recorder = recorder;
    recorder.start();
    if (this.suspended) recorder.pause();
  }
  flush(request = { end: this.now }) {
    if (this.error) {
      request.reject?.(this.error);
      return;
    }
    if (!['recording', 'paused'].includes(this.recorder?.state)) {
      request.reject?.(new Error('Video is not available'));
      return;
    }
    this.session.requests.push(request);
    try {
      this.recorder.requestData();
    } catch (error) {
      this.session.requests.pop();
      request.reject?.(error);
    }
  }
  stop() {
    if (!['recording', 'paused'].includes(this.recorder?.state)) return;
    this.session.requests.push({ end: this.now, final: true });
    this.recorder.stop();
  }
  audio(stream) {
    if (!stream || !this.stream || this.stream.getAudioTracks().length || this.closed || this.error)
      return;
    this.nextAudio = stream;
    if (this.restarting) return;
    this.restarting = true;
    this.restart = new Promise((resolve) => {
      this.restartResolve = resolve;
    });
    this.stop();
  }
  get seconds() {
    return this.closed ? 0 : (this.buffer?.seconds(this.now) ?? 0);
  }
  async save() {
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
    this.session?.reader?.abort();
    this.restarting = false;
    clearInterval(this.timer);
    this.saveRequest?.reject(new Error('Recording was replaced'));
    this.saveRequest = null;
    this.restartResolve?.();
    this.restartResolve = null;
    this.stop();
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
