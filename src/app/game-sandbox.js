// The hidden document has an opaque origin and its own restrictive CSP. Its
// worker never shares the app's network permissions or persistent storage.
export class GameSandbox {
  constructor() {
    if (typeof Worker !== 'function' || typeof MessageChannel !== 'function')
      throw new Error('This browser cannot run games.');
    this.queue = [];
    this.frame = document.createElement('iframe');
    this.frame.hidden = true;
    this.frame.sandbox = 'allow-scripts';
    this.frame.referrerPolicy = 'no-referrer';
    this.frame.src = '/playload/app/sandbox/';
    this.connect = (event) => {
      if (
        event.source !== this.frame?.contentWindow ||
        event.origin !== 'null' ||
        event.data !== 'playload-sandbox-ready'
      )
        return;
      window.removeEventListener('message', this.connect);
      const channel = new MessageChannel();
      this.port = channel.port1;
      this.port.onmessage = (event) => this.onmessage?.(event);
      this.port.onmessageerror = () => this.onerror?.(new Error('Invalid game frame.'));
      this.frame.contentWindow.postMessage('playload-sandbox-connect', '*', [channel.port2]);
      for (const message of this.queue) this.port.postMessage(message);
      this.queue = [];
    };
    window.addEventListener('message', this.connect);
    try {
      document.body.append(this.frame);
    } catch (error) {
      this.terminate();
      throw error;
    }
  }

  postMessage(message) {
    if (this.port) this.port.postMessage(message);
    else this.queue.push(message);
  }

  terminate() {
    window.removeEventListener('message', this.connect);
    this.port?.close();
    this.frame?.remove();
    this.frame = this.port = null;
    this.onmessage = this.onerror = null;
    this.queue = [];
  }
}
