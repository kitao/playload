import { video } from './video.js';

export class Capture {
  constructor(canvas, audioStream, onChange) {
    this.onChange = onChange;
    this.mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus'].find(type => globalThis.MediaRecorder?.isTypeSupported(type));
    if (!this.mime || !canvas.captureStream) return;
    this.stream = canvas.captureStream(60);
    for (const track of audioStream?.getAudioTracks() ?? []) this.stream.addTrack(track);
    this.intervals = [];
  }
  get now() { return (this.suspended ? this.suspendedAt : performance.now()) - (this.heldTime ?? 0); }
  suspend(active) {
    if (!!this.suspended === active) return;
    if (active) {
      this.suspendedAt = performance.now(); this.suspended = true;
      if (this.recorder?.state === 'recording') this.recorder.pause();
    } else {
      this.heldTime = (this.heldTime ?? 0) + performance.now() - this.suspendedAt; this.suspended = false;
      if (this.recorder?.state === 'paused') this.recorder.resume();
    }
    this.onChange?.();
  }
  start() {
    if (!this.stream) return;
    this.clear(); this.intervals = []; this.closed = false; this.begin();
    this.timer = setInterval(() => { if (!this.suspended) { this.rotate(); this.trim(); this.onChange(); } }, 5000);
    this.onChange();
  }
  begin() {
    if (this.nextAudio && !this.stream.getAudioTracks().length) for (const track of this.nextAudio.getAudioTracks()) this.stream.addTrack(track);
    this.nextAudio = null;
    const interval = { start: this.now, chunks: [], bytes: 0 };
    const recorder = new MediaRecorder(this.stream, { mimeType: this.mime });
    interval.ready = new Promise((resolve, reject) => { interval.resolve = resolve; interval.reject = reject; });
    // Errors can occur before a Save requests this interval.
    interval.ready.catch(() => {});
    recorder.ondataavailable = ({ data }) => {
      if (data.size) { interval.chunks.push(data); interval.bytes += data.size; }
      if (recorder === this.recorder && interval.bytes > 64 * 1024 * 1024) { this.rotate(); this.trim(); }
    };
    recorder.onstop = () => {
      interval.blob = new Blob(interval.chunks, { type: this.mime }); interval.chunks = []; interval.resolve();
      if (recorder === this.recorder && this.rotating && !this.closed) { this.rotating = false; this.begin(); this.onChange(); }
    };
    recorder.onerror = () => { interval.reject(new Error('Video recording failed')); this.onChange(); };
    this.current = interval; this.recorder = recorder; recorder.start(1000);
    if (this.suspended) recorder.pause();
  }
  rotate() {
    if (!['recording', 'paused'].includes(this.recorder?.state)) return;
    const interval = this.current; interval.end = this.now;
    this.rotating = true; this.recorder.stop(); this.intervals.push(interval);
  }
  audio(stream) {
    if (!stream || !this.stream || this.stream.getAudioTracks().length) return;
    this.nextAudio = stream; this.rotate();
  }
  trim() {
    const cutoff = this.now - 60000;
    if (['recording', 'paused'].includes(this.recorder?.state) && this.current.start < cutoff) this.rotate();
    while (this.intervals[0]?.start < cutoff) this.intervals.shift();
    const currentBytes = ['recording', 'paused'].includes(this.recorder?.state) ? this.current?.bytes ?? 0 : 0;
    let bytes = this.intervals.reduce((sum, interval) => sum + interval.bytes, currentBytes);
    while (bytes > 64 * 1024 * 1024 && this.intervals.length) bytes -= this.intervals.shift().bytes;
  }
  get seconds() { this.trim(); return !this.closed && this.current ? (this.now - (this.intervals[0]?.start ?? this.current.start)) / 1000 : 0; }
  async save() {
    if (this.saveRequest) throw new Error('Video is already being saved');
    if (!this.rotating && !['recording', 'paused'].includes(this.recorder?.state)) throw new Error('Video is not available');
    this.trim(); this.rotate(); const intervals = [...this.intervals], request = {}; this.saveRequest = request;
    let timer;
    try {
      if (!intervals.length) throw new Error('No video frames were received');
      await Promise.race([
        Promise.all(intervals.map(interval => interval.ready)),
        new Promise((_, reject) => { request.reject = reject; timer = setTimeout(() => reject(new Error('No video frames were received')), 10000); })
      ]);
      if (this.saveRequest !== request) throw new Error('Recording was replaced');
      return await video(intervals, this.mime);
    } finally { clearTimeout(timer); if (this.saveRequest === request) this.saveRequest = null; }
  }
  clear() {
    this.closed = true; this.rotating = false;
    clearInterval(this.timer); this.saveRequest?.reject(new Error('Recording was replaced')); this.saveRequest = null;
    if (['recording', 'paused'].includes(this.recorder?.state)) this.recorder.stop();
  }
  close() { this.clear(); for (const track of this.stream?.getVideoTracks() ?? []) track.stop(); }
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
