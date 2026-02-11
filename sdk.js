const SAMPLE_RATE_TTS = 24000;

export class STT {
  constructor(options = {}) {
    this.language = options.language || 'en';
    this.onTranscript = options.onTranscript || null;
    this.onStatus = options.onStatus || null;
    this.onPartial = options.onPartial || null;
    this.basePath = options.basePath || '';
    this.worker = null;
    this.ready = false;
    this.recorder = null;
    this.recordChunks = [];
    this._resolveStop = null;
    this._currentTranscript = '';
  }

  async init() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.basePath + '/assets/worker-BPxxCWVT.js');
        this.worker.onmessage = (e) => this._handleMessage(e.data);
        this.worker.onerror = (e) => reject(e);
        this._initResolve = resolve;
        this.worker.postMessage({ type: 'load' });
      } catch (err) {
        reject(err);
      }
    });
  }

  _handleMessage(msg) {
    switch (msg.status) {
      case 'loading':
        this.onStatus?.('loading', typeof msg.data === 'string' ? msg.data : 'Loading...');
        break;
      case 'ready':
        this.ready = true;
        this.onStatus?.('ready', 'Ready');
        this._initResolve?.();
        this._initResolve = null;
        break;
      case 'start':
        this.onStatus?.('transcribing', 'Transcribing...');
        break;
      case 'update': {
        const text = this._extractText(msg.output);
        this._currentTranscript = text;
        this.onPartial?.(text);
        break;
      }
      case 'complete': {
        const text = this._extractText(msg.output);
        this._currentTranscript = text;
        this.onTranscript?.(text);
        this.onStatus?.('ready', 'Ready');
        this._resolveStop?.(text);
        this._resolveStop = null;
        break;
      }
    }
  }

  _extractText(output) {
    if (!output) return '';
    if (Array.isArray(output)) return output.map(o => o.text || o).join('');
    return output.text || String(output);
  }

  async startRecording() {
    if (!this.ready) throw new Error('STT not initialized');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recordChunks = [];
    this.recorder = new MediaRecorder(stream);
    this.recorder.ondataavailable = (e) => this.recordChunks.push(e.data);
    this._stream = stream;
    this.recorder.start();
    this.onStatus?.('recording', 'Recording...');
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve(this._currentTranscript);
        return;
      }
      this._resolveStop = resolve;
      this.recorder.onstop = async () => {
        this._stream?.getTracks().forEach(t => t.stop());
        const blob = new Blob(this.recordChunks, { type: 'audio/webm' });
        await this._processAudio(blob);
      };
      this.recorder.stop();
    });
  }

  async transcribeBlob(blob) {
    return new Promise((resolve) => {
      this._resolveStop = resolve;
      this._processAudio(blob);
    });
  }

  async _processAudio(blob) {
    if (!this.worker || !this.ready) return;
    this.onStatus?.('transcribing', 'Transcribing...');
    const arrayBuf = await blob.arrayBuffer();
    const ctx = new AudioContext({ sampleRate: 16000 });
    const decoded = await ctx.decodeAudioData(arrayBuf);
    const audio = decoded.getChannelData(0);
    ctx.close();
    this.worker.postMessage({ type: 'generate', data: { audio, language: this.language } });
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this._stream?.getTracks().forEach(t => t.stop());
  }
}

export class TTS {
  constructor(options = {}) {
    this.voice = options.voice || null;
    this.onAudioReady = options.onAudioReady || null;
    this.onStatus = options.onStatus || null;
    this.onVoicesLoaded = options.onVoicesLoaded || null;
    this.onMetrics = options.onMetrics || null;
    this.onAudioChunk = options.onAudioChunk || null;
    this.basePath = options.basePath || '';
    this.apiBasePath = options.apiBasePath || '';
    this.worker = null;
    this.audioContext = null;
    this.audioBuffer = [];
    this.currentAudioUrl = null;
    this.startTime = 0;
    this.firstChunkTime = null;
    this.ready = false;
  }

  async init() {
    const statusUrl = this.apiBasePath + '/api/tts-status';
    const statusResponse = await fetch(statusUrl);
    const statusData = await statusResponse.json();
    if (!statusData.available) throw new Error('TTS models not available');

    this.audioContext = new (globalThis.AudioContext || globalThis.webkitAudioContext)({ sampleRate: SAMPLE_RATE_TTS });

    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.basePath + '/tts/inference-worker.js', { type: 'module' });
        this.worker.onmessage = (e) => this._handleMessage(e.data, resolve);
        this.worker.onerror = (e) => reject(e);
        this.worker.postMessage({ type: 'load' });
      } catch (err) {
        reject(err);
      }
    });
  }

  _handleMessage(msg, initResolve) {
    switch (msg.type) {
      case 'status':
        this.onStatus?.(msg.status || msg.data?.status, msg.state || msg.data?.state);
        break;
      case 'voices_loaded':
        this.onVoicesLoaded?.(msg.voices, msg.defaultVoice);
        break;
      case 'loaded':
        this.ready = true;
        initResolve?.();
        this.onStatus?.('Ready', 'ready');
        break;
      case 'audio_chunk':
        this.audioBuffer.push(new Float32Array(msg.data));
        this.onAudioChunk?.();
        if (!this.firstChunkTime) {
          this.firstChunkTime = performance.now();
          this.onMetrics?.({ ttfb: this.firstChunkTime - this.startTime });
        }
        if (msg.metrics) {
          const elapsed = (performance.now() - this.startTime) / 1000;
          const audioDur = this.audioBuffer.reduce((s, b) => s + b.length, 0) / SAMPLE_RATE_TTS;
          if (elapsed > 0) this.onMetrics?.({ rtfx: audioDur / elapsed });
        }
        break;
      case 'stream_ended':
        this._finalize();
        break;
      case 'error':
        this.onStatus?.('Error: ' + msg.error, 'error');
        this._generateReject?.(new Error(msg.error));
        this._generateReject = null;
        this._generateResolve = null;
        break;
    }
  }

  generate(text, voice) {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.ready) return reject(new Error('TTS not initialized'));
      this.audioBuffer = [];
      this.startTime = performance.now();
      this.firstChunkTime = null;
      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = null;
      }
      this._generateResolve = resolve;
      this._generateReject = reject;
      const v = voice || this.voice;
      if (v && v !== 'custom') {
        this.worker.postMessage({ type: 'set_voice', data: { voiceName: v } });
      }
      this.worker.postMessage({ type: 'generate', data: { text, voice: v } });
    });
  }

  stop() {
    this.worker?.postMessage({ type: 'stop' });
  }

  async uploadVoice(file) {
    if (!this.worker || !this.audioContext) return;
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    let audioData = audioBuffer.getChannelData(0);
    if (audioBuffer.sampleRate !== SAMPLE_RATE_TTS) {
      audioData = this._resample(audioData, audioBuffer.sampleRate, SAMPLE_RATE_TTS);
    }
    this.worker.postMessage({ type: 'encode_voice', data: { audio: audioData } });
  }

  _resample(data, fromRate, toRate) {
    const ratio = fromRate / toRate;
    const newLen = Math.round(data.length / ratio);
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const idx = i * ratio;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, data.length - 1);
      const frac = idx - lo;
      out[i] = data[lo] * (1 - frac) + data[hi] * frac;
    }
    return out;
  }

  _finalize() {
    if (this.audioBuffer.length === 0) {
      this._generateResolve?.(null);
      this._generateResolve = null;
      return;
    }
    const totalLen = this.audioBuffer.reduce((s, b) => s + b.length, 0);
    const merged = new Float32Array(totalLen);
    let off = 0;
    for (const buf of this.audioBuffer) { merged.set(buf, off); off += buf.length; }

    const wavBuf = new ArrayBuffer(44 + merged.length * 2);
    const view = new DataView(wavBuf);
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + merged.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE_TTS, true);
    view.setUint32(28, SAMPLE_RATE_TTS * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, merged.length * 2, true);
    for (let i = 0; i < merged.length; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
    this.currentAudioUrl = URL.createObjectURL(new Blob([wavBuf], { type: 'audio/wav' }));
    this.onAudioReady?.(this.currentAudioUrl);
    this._generateResolve?.(this.currentAudioUrl);
    this._generateResolve = null;
  }

  downloadAudio() {
    if (this.currentAudioUrl) {
      const a = document.createElement('a');
      a.href = this.currentAudioUrl;
      a.download = 'tts-output.wav';
      a.click();
    }
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
    this.audioContext?.close();
  }
}
