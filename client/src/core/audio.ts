/**
 * Efek suara prosedural memakai Web Audio API — tanpa file audio.
 * AudioContext dibuat/dibuka kembali saat ada interaksi pengguna pertama.
 */
type SoundName = 'explosion' | 'fuse' | 'kentongan' | 'levelup';

const THROTTLE_MS: Record<SoundName, number> = {
  explosion: 80,
  fuse: 110,
  kentongan: 260,
  levelup: 400,
};

class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastPlayed: Record<SoundName, number> = { explosion: 0, fuse: 0, kentongan: 0, levelup: 0 };

  /** Panggil dari event pointer/klik pertama (autoplay policy browser). */
  unlock(): void {
    try {
      if (!this.context) {
        const Ctor = window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.context = new Ctor();
        this.master = this.context.createGain();
        this.master.gain.value = 0.38;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {
      // Audio bukan fitur wajib; game tetap berjalan bila diblokir browser.
    }
  }

  play(name: SoundName): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || context.state !== 'running') return;

    const now = context.currentTime;
    if ((now - this.lastPlayed[name]) * 1000 < THROTTLE_MS[name]) return;
    this.lastPlayed[name] = now;

    try {
      if (name === 'explosion') this.explosion(context, master, now);
      else if (name === 'fuse') this.fuse(context, master, now);
      else if (name === 'levelup') this.levelup(context, master, now);
      else this.kentongan(context, master, now);
    } catch {
      // Diamkan kegagalan audio daripada mengganggu gameplay.
    }
  }

  private noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) channel[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Dentuman petasan: noise lowpass + thump sinus berdesakan cepat. */
  private explosion(context: AudioContext, master: GainNode, at: number): void {
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context, 0.5);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, at);
    filter.frequency.exponentialRampToValueAtTime(160, at + 0.42);
    filter.Q.value = 0.8;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(1, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.46);

    source.connect(filter).connect(gain).connect(master);
    source.start(at);
    source.stop(at + 0.5);

    const thump = context.createOscillator();
    const thumpGain = context.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(110, at);
    thump.frequency.exponentialRampToValueAtTime(42, at + 0.28);
    thumpGain.gain.setValueAtTime(0.7, at);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    thump.connect(thumpGain).connect(master);
    thump.start(at);
    thump.stop(at + 0.31);
  }

  /** Sumbu mendesis: noise bandpass tipis dengan sedikit goyangan volume. */
  private fuse(context: AudioContext, master: GainNode, at: number): void {
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context, 0.26);

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2600, at);
    filter.frequency.linearRampToValueAtTime(4200, at + 0.24);
    filter.Q.value = 3;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.22, at + 0.03);
    gain.gain.linearRampToValueAtTime(0.12, at + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.26);

    const tremolo = context.createOscillator();
    const tremoloGain = context.createGain();
    tremolo.frequency.value = 28;
    tremoloGain.gain.value = 0.04;
    tremolo.connect(tremoloGain).connect(gain.gain);
    tremolo.start(at);
    tremolo.stop(at + 0.26);

    source.connect(filter).connect(gain).connect(master);
    source.start(at);
    source.stop(at + 0.26);
  }

  /** Kentongan: dua nada kayu pendek + klik noise. */
  private kentongan(context: AudioContext, master: GainNode, at: number): void {
    [430, 645].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 0 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.86, at + 0.22);
      gain.gain.setValueAtTime(index === 0 ? 0.55 : 0.24, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
      oscillator.connect(gain).connect(master);
      oscillator.start(at);
      oscillator.stop(at + 0.25);
    });

    const click = context.createBufferSource();
    click.buffer = this.noiseBuffer(context, 0.05);
    const clickFilter = context.createBiquadFilter();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = 1600;
    const clickGain = context.createGain();
    clickGain.gain.setValueAtTime(0.3, at);
    clickGain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    click.connect(clickFilter).connect(clickGain).connect(master);
    click.start(at);
    click.stop(at + 0.05);
  }

  /** Naik level: tangga nada kecil yang naik, mirip bunyi kentongan festival. */
  private levelup(context: AudioContext, master: GainNode, at: number): void {
    [523, 659, 784, 1047].forEach((frequency, index) => {
      const start = at + index * 0.075;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 3 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.02, start + 0.14);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(index === 3 ? 0.4 : 0.24, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      oscillator.connect(gain).connect(master);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
  }
}

export const audio = new AudioManager();
