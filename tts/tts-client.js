// Pocket TTS Client - thin wrapper around reference inference-worker.js
const SAMPLE_RATE = 24000;

export class PocketTTSClient {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.worker = null;
        this.audioContext = null;
        this.audioBuffer = [];
        this.isGenerating = false;
        this.currentAudioUrl = null;
        this.startTime = 0;
        this.firstChunkTime = null;
        this.init();
    }

    async init() {
        try {
            const statusResponse = await fetch('/api/tts-status');
            const statusData = await statusResponse.json();
            if (!statusData.available) {
                this.callbacks.onStatus?.('TTS models not available', 'error');
                return;
            }

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });

            // Load the reference worker as a module worker (not blob)
            this.worker = new Worker('/tts/inference-worker.js', { type: 'module' });

            this.worker.onmessage = (e) => {
                const { type, data, error, status, state, voices, defaultVoice, metrics } = e.data;

                switch (type) {
                    case 'status':
                        this.callbacks.onStatus?.(status || data?.status, state || data?.state);
                        break;
                    case 'voices_loaded':
                        this.callbacks.onVoicesLoaded?.(voices, defaultVoice);
                        break;
                    case 'loaded':
                        this.callbacks.onReady?.();
                        break;
                    case 'audio_chunk':
                        this.audioBuffer.push(new Float32Array(data));
                        this.callbacks.onAudioChunk?.();
                        if (!this.firstChunkTime) {
                            this.firstChunkTime = performance.now();
                            const ttfb = this.firstChunkTime - this.startTime;
                            this.callbacks.onMetrics?.({ ttfb });
                        }
                        if (metrics) {
                            const elapsed = (performance.now() - this.startTime) / 1000;
                            const audioDur = this.audioBuffer.reduce((s, b) => s + b.length, 0) / SAMPLE_RATE;
                            if (elapsed > 0) this.callbacks.onMetrics?.({ rtfx: audioDur / elapsed });
                        }
                        break;
                    case 'stream_ended':
                        this.finalizeAudio();
                        break;
                    case 'error':
                        console.error('TTS Worker error:', error);
                        this.callbacks.onStatus?.('Error: ' + error, 'error');
                        this.callbacks.onComplete?.(null);
                        break;
                }
            };

            this.worker.postMessage({ type: 'load' });
        } catch (err) {
            console.error('TTS init error:', err);
            this.callbacks.onStatus?.('Failed to initialize TTS: ' + err.message, 'error');
        }
    }

    async generate(text, voiceName) {
        if (!this.worker) return;
        this.audioBuffer = [];
        this.isGenerating = true;
        this.startTime = performance.now();
        this.firstChunkTime = null;
        if (this.currentAudioUrl) {
            URL.revokeObjectURL(this.currentAudioUrl);
            this.currentAudioUrl = null;
        }
        if (voiceName && voiceName !== 'custom') {
            this.worker.postMessage({ type: 'set_voice', data: { voiceName } });
        }
        this.worker.postMessage({ type: 'generate', data: { text, voice: voiceName } });
    }

    stop() {
        this.isGenerating = false;
        this.worker?.postMessage({ type: 'stop' });
    }

    async uploadVoice(file) {
        if (!this.worker || !this.audioContext) return;
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        let audioData = audioBuffer.getChannelData(0);
        if (audioBuffer.sampleRate !== SAMPLE_RATE) {
            audioData = this.resample(audioData, audioBuffer.sampleRate, SAMPLE_RATE);
        }
        this.worker.postMessage({ type: 'encode_voice', data: { audio: audioData } });
    }

    resample(data, fromRate, toRate) {
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

    downloadAudio() {
        if (this.currentAudioUrl) {
            const a = document.createElement('a');
            a.href = this.currentAudioUrl;
            a.download = 'tts-output.wav';
            a.click();
        }
    }

    finalizeAudio() {
        this.isGenerating = false;
        if (this.audioBuffer.length === 0) {
            this.callbacks.onComplete?.(null);
            return;
        }
        const totalLen = this.audioBuffer.reduce((s, b) => s + b.length, 0);
        const merged = new Float32Array(totalLen);
        let off = 0;
        for (const buf of this.audioBuffer) { merged.set(buf, off); off += buf.length; }

        // Create WAV
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
        view.setUint32(24, SAMPLE_RATE, true);
        view.setUint32(28, SAMPLE_RATE * 2, true);
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
        this.callbacks.onComplete?.(this.currentAudioUrl);
    }
}
