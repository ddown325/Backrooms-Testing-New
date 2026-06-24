// audio.ts — audio manager
// Plays menu music, level ambience loop, cutscene cues, and rare horror stingers.

export interface AudioSettings {
  master: number; // 0..1
  ambience: number; // 0..1
  music: number; // 0..1
  sfx: number; // 0..1
}

const AUDIO_BASE = 'audio/';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private ambSource: AudioBufferSourceNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;

  private buffers: Map<string, AudioBuffer> = new Map();
  private settings: AudioSettings = { master: 1, ambience: 0.8, music: 0.7, sfx: 0.9 };

  // Lazily-created AudioContext (browsers require user gesture)
  async ensureContext(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch {}
      }
      return;
    }
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctor();
    this.masterGain = this.ctx.createGain();
    this.ambGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.ambGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    this.applySettings();
  }

  setSettings(s: AudioSettings) {
    this.settings = s;
    this.applySettings();
  }

  private applySettings() {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.value = this.settings.master;
    this.ambGain!.gain.value = this.settings.ambience;
    this.musicGain!.gain.value = this.settings.music;
    this.sfxGain!.gain.value = this.settings.sfx;
  }

  private async loadBuffer(name: string, url: string): Promise<AudioBuffer> {
    if (this.buffers.has(name)) return this.buffers.get(name)!;
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const buf = await this.ctx!.decodeAudioData(arr);
    this.buffers.set(name, buf);
    return buf;
  }

  // ---- Looping sources ----

  async startMenuMusic(): Promise<void> {
    await this.ensureContext();
    if (!this.ctx) return;
    const buf = await this.loadBuffer('menu', AUDIO_BASE + 'menu_mus.ogg');
    this.stopMenuMusic();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain!);
    src.start(0);
    this.musicSource = src;
  }

  stopMenuMusic() {
    if (this.musicSource) {
      try { this.musicSource.stop(); } catch {}
      this.musicSource.disconnect();
      this.musicSource = null;
    }
  }

  async startAmbience(): Promise<void> {
    await this.ensureContext();
    if (!this.ctx) return;
    const buf = await this.loadBuffer('amb', AUDIO_BASE + 'level0_ambience.mp3');
    if (this.ambSource) {
      try { this.ambSource.stop(); } catch {}
      this.ambSource.disconnect();
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.ambGain!);
    src.start(0);
    this.ambSource = src;
  }

  stopAmbience() {
    if (this.ambSource) {
      try { this.ambSource.stop(); } catch {}
      this.ambSource.disconnect();
      this.ambSource = null;
    }
  }

  // ---- One-shot SFX ----

  async playSfx(name: 'falling_wind' | 'landing_thud' | 'horror_1' | 'horror_2'): Promise<void> {
    await this.ensureContext();
    if (!this.ctx) return;
    const url =
      name === 'falling_wind' ? 'falling_wind.mp3' :
      name === 'landing_thud' ? 'landing_thud.mp3' :
      name === 'horror_1' ? 'horror_1.mp3' :
      'horror_2.mp3';
    const buf = await this.loadBuffer(name, AUDIO_BASE + url);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.sfxGain!);
    src.start(0);
  }

  // Random horror stingers while exploring — scheduled externally.
  async playRandomHorror(): Promise<void> {
    const which = Math.random() < 0.5 ? 'horror_1' : 'horror_2';
    await this.playSfx(which);
  }

  // Fade all ambience/music out (used on death or quit)
  fadeOut(ms: number = 600) {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const cur = this.masterGain.gain.value;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(cur, now);
    this.masterGain.gain.linearRampToValueAtTime(0, now + ms / 1000);
  }

  fadeIn(ms: number = 600) {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.linearRampToValueAtTime(this.settings.master, now + ms / 1000);
  }
}
