import { MAX_FRAME_STEPS } from './runtime.js';
import { Capture } from './capture.js';

// Game, sound and recording clocks share a lifetime, but have different pause rules.
export class Playback {
  constructor({
    canvas,
    audio,
    runtime,
    render,
    isActive = () => true,
    onReady = () => {},
    onChange = () => {},
    onSoundError = () => {},
    onVideoError = () => {},
    createCapture = (...args) => new Capture(...args),
    document = globalThis.document,
  }) {
    Object.assign(this, {
      canvas,
      audio,
      runtime,
      render,
      isActive,
      onReady,
      onChange,
      onSoundError,
      onVideoError,
      createCapture,
      document,
    });
    this.running = false;
    this.paused = false;
    this.awaitingStart = false;
    this.revision = 0;
    this.lastFrame = null;
    this.paintedFrame = false;
    this.lastCaptureFrame = 0;
  }

  sync() {
    const active = this.isActive();
    if (!this.running || this.paused || this.document.hidden || !active) this.lastFrame = null;
    // Hidden pages keep playing sound; only game updates and recording stop.
    this.audio.pause(!this.running || this.paused || !active);
    this.capture?.suspend(this.document.hidden || !this.running || !active || this.awaitingStart);
  }

  async frame(pixels, sounds, ready) {
    this.render(pixels, ready);
    this.audio.play(sounds);
    if (!ready) return;
    this.running = true;
    this.sync();
    this.onReady();
    const version = this.revision;
    try {
      await this.audio.init();
    } catch {
      this.onSoundError();
    }
    if (version !== this.revision || !this.running) return;
    if (this.audio.context)
      this.audio.context.onstatechange = () => {
        if (this.audio.context.state === 'running')
          this.capture?.audio(this.audio.destination?.stream);
      };
    try {
      if (!this.capture) {
        this.capture = this.createCapture(
          this.canvas,
          this.audio.context?.state === 'running' ? this.audio.destination?.stream : null,
          this.onChange,
        );
        this.capture.start();
        this.paintedFrame = false;
        this.sync();
      }
    } catch (error) {
      this.capture?.close();
      this.capture = null;
      this.onVideoError(error);
    }
    this.onChange();
  }

  advance(time) {
    if (this.running && !this.document.hidden && !this.paused && this.isActive()) {
      const interval = 1000 / 60;
      if (this.lastFrame === null) this.lastFrame = time;
      const elapsed = time - this.lastFrame;
      if (elapsed >= interval - 0.5) {
        // Catch up short stalls, bound the work, and discard long gaps.
        const steps =
          elapsed > 250 ? 1 : Math.min(MAX_FRAME_STEPS, Math.floor((elapsed + 0.5) / interval));
        if (this.runtime.frame(steps))
          this.lastFrame =
            elapsed > interval * MAX_FRAME_STEPS ? time : this.lastFrame + steps * interval;
      }
    } else this.lastFrame = null;
    if (
      this.capture?.stream &&
      !this.capture.suspended &&
      this.running &&
      !this.document.hidden &&
      time - this.lastCaptureFrame >= 1000 / 30
    ) {
      // Static and paused pictures still need fresh recording timestamps.
      if (!this.paintedFrame) this.canvas.getContext('2d').drawImage(this.canvas, 0, 0);
      this.paintedFrame = false;
      this.lastCaptureFrame = time;
    }
  }

  pagehide(persisted) {
    if (persisted) {
      this.capture?.leave(true);
      this.runtime.suspend(true);
      this.audio.pause(true);
      this.capture?.suspend(true);
    } else {
      this.revision++;
      this.runtime.stop();
      this.audio.close();
      this.capture?.close();
    }
  }

  pageshow(persisted) {
    if (!persisted) return;
    this.lastFrame = null;
    this.capture?.leave(false);
    this.runtime.suspend(this.document.hidden);
    this.sync();
    if (!this.document.hidden) this.audio.unlock();
  }

  navigate() {
    this.revision++;
    this.capture?.leave(true);
  }
}
