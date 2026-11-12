'use strict';

// Short effects use Web Audio, not an HTML audio player or a media session.
class DigProSaleSound {
  constructor(url) {
    this.url = url;
    this.context = null;
    this.buffer = null;
    this.loading = null;
    this.source = null;
  }

  async arm() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('El navegador no admite efectos de sonido.');
    if (!this.context || this.context.state === 'closed') {
      this.context = new Context({ latencyHint: 'interactive' });
      this.buffer = this.loading = null;
    }
    try { if (navigator.audioSession) navigator.audioSession.type = 'transient'; } catch { /* Optional on Safari. */ }
    // Resume immediately in the tap handler, before awaiting the MP3 download.
    const resume = this.context.state !== 'running' ? this.context.resume() : Promise.resolve();
    if (!this.loading) {
      this.loading = fetch(this.url, { cache: 'force-cache' }).then(response => {
        if (!response.ok) throw new Error('No se pudo cargar el sonido.');
        return response.arrayBuffer();
      }).then(bytes => this.context.decodeAudioData(bytes)).then(buffer => { this.buffer = buffer; })
        .catch(error => { this.loading = null; throw error; });
    }
    await Promise.all([resume, this.loading]);
    return this.context.state === 'running';
  }

  play() {
    if (!this.buffer || this.context?.state !== 'running') return false;
    this.stop();
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    source.onended = () => {
      source.disconnect();
      if (this.source === source) this.source = null;
    };
    this.source = source;
    try { source.start(); }
    catch { this.source = null; source.disconnect(); return false; }
    return true;
  }

  stop() {
    if (!this.source) return;
    const source = this.source;
    this.source = null;
    try { source.stop(); } catch { /* The effect may already have ended. */ }
    source.disconnect();
  }
}
