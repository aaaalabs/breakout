// Procedural sound effects via Web Audio API. Zero asset weight.
// Each effect is a short shaped envelope on an oscillator → tasteful, minimal,
// distinct enough that kids hear "thing happened" without being noisy.

interface Sample {
    buffer: AudioBuffer | null;
    pending: Promise<AudioBuffer> | null;
    url: string;
}

const SAMPLE_URLS = {
    'game-start': '/audio/game-start.mp3',
    'match-start': '/audio/match-start.mp3',
    'win': '/audio/win.mp3',
    'combo': '/audio/combo.mp3',
    'applause': '/audio/applause.mp3',
    'buzzer': '/audio/buzzer.mp3',
    'fail': '/audio/fail.mp3',
    'drumroll': '/audio/drumroll.mp3',
} as const;
export type SampleKey = keyof typeof SAMPLE_URLS;

class SfxEngine {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private mutedFlag = this.loadMuteState();
    private samples: Record<SampleKey, Sample> = Object.fromEntries(
        Object.entries(SAMPLE_URLS).map(([k, url]) => [k, { buffer: null, pending: null, url }])
    ) as Record<SampleKey, Sample>;
    private comboTimes: number[] = [];

    private ensureContext(): AudioContext | null {
        if (this.ctx) return this.ctx;
        try {
            const Ctx = (window.AudioContext ||
                (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)!;
            this.ctx = new Ctx();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.55;
            this.master.connect(this.ctx.destination);
        } catch {
            return null;
        }
        return this.ctx;
    }

    /** Resume context if suspended — must be called from a user-gesture handler. */
    unlock() {
        const ctx = this.ensureContext();
        if (ctx?.state === 'suspended') void ctx.resume();
        // Eagerly start sample loading so they're ready when needed
        void this.preloadAll();
    }

    private async preloadAll() {
        await Promise.all((Object.keys(this.samples) as SampleKey[]).map((k) => this.loadSample(k)));
    }

    private async loadSample(key: SampleKey): Promise<AudioBuffer | null> {
        const ctx = this.ensureContext();
        if (!ctx) return null;
        const slot = this.samples[key];
        if (slot.buffer) return slot.buffer;
        if (slot.pending) return slot.pending;
        slot.pending = (async () => {
            const res = await fetch(slot.url);
            const arr = await res.arrayBuffer();
            const buf = await ctx.decodeAudioData(arr);
            slot.buffer = buf;
            return buf;
        })();
        try {
            return await slot.pending;
        } catch {
            slot.pending = null;
            return null;
        }
    }

    /** Play a preloaded MP3 sample. Lazy-loads on first call. */
    playSample(key: SampleKey, opts: { volume?: number; loop?: boolean } = {}) {
        const ctx = this.ensureContext();
        if (!ctx || !this.master || this.mutedFlag) return null;
        const slot = this.samples[key];
        if (!slot.buffer) {
            // Trigger load and skip this play (next time will work)
            void this.loadSample(key);
            return null;
        }
        const src = ctx.createBufferSource();
        src.buffer = slot.buffer;
        src.loop = !!opts.loop;
        const g = ctx.createGain();
        g.gain.value = opts.volume ?? 0.6;
        src.connect(g);
        g.connect(this.master);
        src.start();
        return src;
    }

    /** Quickly fire combo.mp3 if multiple bricks broken in short window. */
    maybeCombo() {
        const now = (this.ctx?.currentTime ?? 0);
        this.comboTimes = this.comboTimes.filter((t) => now - t < 0.6);
        this.comboTimes.push(now);
        if (this.comboTimes.length === 4) {
            this.playSample('combo', { volume: 0.45 });
            this.comboTimes = [];
        }
    }

    get muted(): boolean { return this.mutedFlag; }

    setMuted(v: boolean) {
        this.mutedFlag = v;
        try { localStorage.setItem('breakout.muted', v ? '1' : '0'); } catch { /* ignore */ }
        if (this.master) this.master.gain.value = v ? 0 : 0.55;
    }

    toggleMute(): boolean {
        this.setMuted(!this.mutedFlag);
        return this.mutedFlag;
    }

    private loadMuteState(): boolean {
        try { return localStorage.getItem('breakout.muted') === '1'; } catch { return false; }
    }

    // ---- Voices ----------------------------------------------------------

    /** Paddle deflection. Intensity 0..1 from contact angle. */
    paddleHit(intensity = 0.5) {
        this.tone({
            type: 'square',
            startFreq: 380 + intensity * 220,
            endFreq: 220,
            duration: 0.07,
            gain: 0.18 + intensity * 0.08,
            attack: 0.002,
        });
    }

    /** Brick break — bright pop with downward sweep. */
    brickBreak() {
        this.tone({ type: 'triangle', startFreq: 920, endFreq: 380, duration: 0.10, gain: 0.20, attack: 0.001 });
        // Tiny noise click for texture
        this.noiseBurst(0.03, 0.06);
    }

    /** Wall ricochet — subtle low click. */
    wallHit() {
        this.tone({ type: 'sine', startFreq: 220, endFreq: 180, duration: 0.04, gain: 0.10, attack: 0.001 });
    }

    /** Ball launch / serve. */
    launch() {
        this.tone({ type: 'sine', startFreq: 200, endFreq: 520, duration: 0.16, gain: 0.18, attack: 0.005 });
    }

    /** Countdown pip (3, 2, 1). */
    countdownPip() {
        this.tone({ type: 'sine', startFreq: 660, endFreq: 660, duration: 0.10, gain: 0.18, attack: 0.005 });
    }

    /** GO! — brighter, slightly higher. */
    countdownGo() {
        this.tone({ type: 'triangle', startFreq: 880, endFreq: 1100, duration: 0.20, gain: 0.22, attack: 0.005 });
    }

    /** Victory stinger — uses sampled MP3 if loaded, else procedural arpeggio. */
    win() {
        const played = this.playSample('win', { volume: 0.7 });
        if (played) return;
        // Fallback: procedural arpeggio
        const ctx = this.ensureContext();
        if (!ctx) return;
        const t0 = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
        notes.forEach((freq, i) => {
            this.toneAt(t0 + i * 0.10, { type: 'triangle', startFreq: freq, endFreq: freq, duration: 0.18, gain: 0.20, attack: 0.005 });
        });
    }

    /** Solo game-start jingle (sampled). */
    soloStart() {
        this.playSample('game-start', { volume: 0.55 });
    }

    /** Multiplayer match-start jingle (sampled). */
    matchStart() {
        this.playSample('match-start', { volume: 0.55 });
    }

    /** Cheer / applause — for big moments (high combo, win, dominant play). */
    applause(volume = 0.5) { this.playSample('applause', { volume }); }

    /** Buzzer — negative event (curse cast on you, missed last brick, foul). */
    buzzer(volume = 0.55) { this.playSample('buzzer', { volume }); }

    /** Fail / fall — ball lost / scored against. */
    fail(volume = 0.55) { this.playSample('fail', { volume }); }

    /** Drumroll — tension build (countdown, garbage incoming, big serve). */
    drumroll(volume = 0.45) { this.playSample('drumroll', { volume }); }

    /** Defeat sting — short descending. */
    lose() {
        const ctx = this.ensureContext();
        if (!ctx) return;
        const t0 = ctx.currentTime;
        const notes = [392, 311.13, 246.94]; // G4 Eb4 B3
        notes.forEach((freq, i) => {
            this.toneAt(t0 + i * 0.12, { type: 'sawtooth', startFreq: freq, endFreq: freq, duration: 0.22, gain: 0.16, attack: 0.005 });
        });
    }

    /** Lose-life dim thud (between launches). */
    loseLife() {
        this.tone({ type: 'sawtooth', startFreq: 220, endFreq: 110, duration: 0.18, gain: 0.18, attack: 0.005 });
    }

    /** Lobby button hover/click — gentle blip. */
    uiClick() {
        this.tone({ type: 'sine', startFreq: 720, endFreq: 920, duration: 0.06, gain: 0.10, attack: 0.002 });
    }

    // ---- Internals -------------------------------------------------------

    private tone(opts: { type: OscillatorType; startFreq: number; endFreq: number; duration: number; gain: number; attack: number }) {
        const ctx = this.ensureContext();
        if (!ctx) return;
        this.toneAt(ctx.currentTime, opts);
    }

    private toneAt(time: number, opts: { type: OscillatorType; startFreq: number; endFreq: number; duration: number; gain: number; attack: number }) {
        const ctx = this.ensureContext();
        if (!ctx || !this.master) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = opts.type;
        osc.frequency.setValueAtTime(opts.startFreq, time);
        if (opts.endFreq !== opts.startFreq) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), time + opts.duration);
        }
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(opts.gain, time + opts.attack);
        g.gain.exponentialRampToValueAtTime(0.0001, time + opts.duration);
        osc.connect(g);
        g.connect(this.master);
        osc.start(time);
        osc.stop(time + opts.duration + 0.02);
    }

    private noiseBurst(duration: number, gain: number) {
        const ctx = this.ensureContext();
        if (!ctx || !this.master) return;
        const sampleCount = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < sampleCount; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        g.gain.value = gain;
        // Low-pass for warmth
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1200;
        src.connect(filter);
        filter.connect(g);
        g.connect(this.master);
        src.start();
    }
}

export const sfx = new SfxEngine();
