import { parseSnd } from "../../data/snd";
import type { Host, SoundLoadArgs, SoundSystem } from "../host";
import type { AdlibOutput, SoundBackend, SoundSource } from "./backend";
import { parseAdl } from "./adlib/adl-player";

/** Nombre d'emplacements de sons (Sound::kSoundsCount). */
export const SOUND_SLOTS = 60;

type SoundType = "snd" | "adl";

/** Un emplacement (SoundDesc) ; vide tant que `type` est null. */
class SoundDesc {
  type: SoundType | null = null;
  /** SND : PCM 8 bits signé (vérifié sur les données : moyenne ≈ 0). ADL : fichier brut. */
  data: Uint8Array | null = null;
  frequency = 0;
  /** Identifiant de ressource chargée (-1 pour un fichier nommé). */
  id = 0;

  get empty(): boolean {
    return this.data === null;
  }

  get size(): number {
    return this.data?.length ?? 0;
  }

  free(): void {
    this.type = null;
    this.data = null;
    this.id = 0;
  }

  swap(other: SoundDesc): void {
    [this.type, other.type] = [other.type, this.type];
    [this.data, other.data] = [other.data, this.data];
    [this.frequency, other.frequency] = [other.frequency, this.frequency];
    [this.id, other.id] = [other.id, this.id];
  }

  /** calcFadeOutLength : durée du fondu final, en dixièmes de seconde. */
  fadeOutLength(frequency: number): number {
    return frequency === 0 ? 0 : Math.trunc((10 * Math.trunc(this.size / 2)) / frequency) | 0;
  }

  /** calcLength : durée en ms de `repCount` lectures, moins la moitié si `fade`. */
  length(repCount: number, frequency: number, fade: boolean): number {
    if (frequency === 0) return 0;
    const fadeSize = fade ? Math.trunc(this.size / 2) : 0;
    return Math.trunc(((this.size * repCount - fadeSize) * 1000) / frequency) >>> 0;
  }

  /** PCM signé prêt pour le backend (SND uniquement). */
  pcm(): Int8Array {
    const d = this.data!;
    return new Int8Array(d.buffer, d.byteOffset, d.length);
  }
}

/** Le canal unique du mixeur (SoundBlaster) : un son, éventuellement en fondu de sortie. */
interface Voice {
  startMs: number;
  /** Fin naturelle (Infinity en boucle). */
  endMs: number;
  /** Fin du fondu de sortie demandé, null sans fondu. */
  fadeEndMs: number | null;
}

/**
 * État du lecteur ADL côté moteur (ADLPlayer/AdLib de ScummVM). La synthèse vit dans `AdlibOutput`
 * (AudioWorklet) qui signale la fin du morceau ; sans sortie, une musique joue jusqu'à son arrêt.
 */
class AdlState {
  index = -1;
  loaded = false;
  playing = false;
  repeating = 0;
}

export interface SoundEngineOptions {
  backend: SoundBackend;
  host: Pick<Host, "now" | "nextFrame">;
  source: SoundSource;
  /** Vrai quand le jeu doit s'arrêter (interrompt waitEndPlay). */
  shouldQuit?: () => boolean;
  /** Global::_soundFlags ; les sons en lecture « programmée » (répétition négative) exigent >= 2. */
  soundFlags?: number;
}

/**
 * Port de gob/sound/sound.cpp, sounddesc.cpp, soundblaster.cpp et soundmixer.cpp.
 * L'état de lecture se déduit de l'horloge de l'hôte : la durée d'un son est taille / fréquence,
 * comme dans le mixeur de ScummVM. Le backend n'est qu'un haut-parleur.
 */
export class SoundEngine implements SoundSystem {
  private readonly slots: SoundDesc[] = Array.from({ length: SOUND_SLOTS }, () => new SoundDesc());
  private readonly backend: SoundBackend;
  private voice: Voice | null = null;
  /** Dernier son joué (_curSoundDesc) : seul celui-là est arrêté par stopSound(_, desc). */
  private curDesc: SoundDesc | null = null;
  private composition: number[] = [];
  private compositionPos = -1;
  private readonly adl = new AdlState();
  private readonly adlibOut: AdlibOutput | null;
  private imdEndMs = 0;
  private readonly environments = new Map<number, SoundDesc[]>();

  constructor(private readonly options: SoundEngineOptions) {
    this.backend = options.backend;
    this.adlibOut = options.backend.adlib ?? null;
    if (this.adlibOut) {
      this.adlibOut.onStopped = () => {
        this.adl.playing = false;
        this.adl.repeating = 0;
      };
    }
  }

  private get now(): number {
    return this.options.host.now();
  }

  // --- État du canal -------------------------------------------------------------------------

  /** Fait avancer le canal jusqu'à maintenant : fins de sons, fondus, enchaînement de la composition. */
  private sync(): void {
    for (let guard = 0; this.voice && guard < 100; guard++) {
      const v = this.voice;
      const now = this.now;
      if (v.fadeEndMs !== null && v.fadeEndMs <= v.endMs && now >= v.fadeEndMs) {
        // endFade : le fondu de sortie a fini son travail
        this.compositionPos = -1;
        this.curDesc = null;
        this.voice = null;
      } else if (now >= v.endMs) {
        if (this.compositionPos !== -1) this.nextCompositionPos(v.endMs);
        else this.voice = null;
      } else {
        return;
      }
    }
  }

  /** Vrai tant que le canal Sound Blaster (ou le son d'une vidéo) joue : la variable 1 des scripts. */
  isPlaying(): boolean {
    this.sync();
    return this.voice !== null || this.now < this.imdEndMs;
  }

  /** Emplacement joué sur le canal, pour les tests et le débogage. */
  get playingSlot(): number {
    this.sync();
    return this.voice && this.curDesc ? this.slots.indexOf(this.curDesc) : -1;
  }

  // --- Emplacements --------------------------------------------------------------------------

  private slot(index: number): SoundDesc | null {
    return index >= 0 && index < SOUND_SLOTS ? this.slots[index] : null;
  }

  isSlotEmpty(index: number): boolean {
    return this.slot(index)?.empty ?? true;
  }

  /** Emplacement déjà chargé avec cette ressource, -1 sinon (recherche de loadMult). */
  findSlotById(id: number): number {
    return this.slots.findIndex((s) => !s.empty && s.id === id);
  }

  /** Dernier emplacement libre (comme loadSound(search)), -1 sinon. */
  findFreeSlot(): number {
    for (let i = SOUND_SLOTS - 1; i >= 0; i--) if (this.slots[i].empty) return i;
    return -1;
  }

  /** sampleFree : un son SND est arrêté s'il joue ; un ADL n'est déchargé que si `noteAdLib`. */
  private sampleFree(desc: SoundDesc | null, noteAdLib = false, index = -1): void {
    if (!desc || desc.empty) return;
    if (desc.type === "adl") {
      if (noteAdLib && (index === -1 || this.adl.index === index)) this.adlUnload();
    } else {
      this.blasterStop(0, desc);
    }
    desc.free();
  }

  /** o2_loadSound : charge un SND/ADL dans l'emplacement depuis une ressource ou un fichier. */
  load(args: SoundLoadArgs): void {
    const desc = this.slot(args.slot);
    if (!desc) return;
    const type: SoundType = args.adlib ? "adl" : "snd";
    this.sampleFree(desc, true, args.slot);

    let bytes: Uint8Array | null | undefined;
    if (args.id === -1) {
      const base = (args.name ?? "").split("\0")[0].trim().slice(0, 9);
      bytes = this.options.source.getFile(`${base}.${type === "adl" ? "ADL" : "SND"}`);
    } else {
      bytes = this.options.source.getResource(args.id);
    }
    if (!bytes || bytes.length === 0) return;
    this.setSample(args.slot, type, bytes, args.id);
  }

  /** loadMult : clé son partagée (voir SoundSystem.loadSearch). */
  loadSearch(id: number, name: string | null): number {
    let slot = this.findSlotById(id);
    if (slot >= 0) return slot | 0x8000;
    slot = this.findFreeSlot();
    if (slot < 0) return 0;
    this.load({ slot, adlib: false, id, name });
    return this.isSlotEmpty(slot) ? 0 : slot;
  }

  /** Remplit un emplacement avec des données déjà lues (loadMult, tests). */
  setSample(slot: number, type: SoundType, bytes: Uint8Array, id: number): boolean {
    const target = this.slot(slot);
    if (!target) return false;
    target.free();
    if (type === "adl") {
      target.data = bytes;
      target.frequency = 0;
    } else {
      try {
        const snd = parseSnd(bytes);
        target.data = snd.data;
        target.frequency = snd.frequency;
      } catch {
        return false;
      }
    }
    target.type = type;
    target.id = id;
    return true;
  }

  freeSlot(slot: number): void {
    this.sampleFree(this.slot(slot));
  }

  /** Fin d'un TOT : arrête le canal et libère les SND (les ADL restent). */
  freeLoadedSamples(): void {
    for (const s of this.slots) if (s.type === "snd") this.sampleFree(s);
  }

  /** Environments::setMedia : les 10 premiers emplacements partent dans l'environnement `env`. */
  backupSlots(env: number): void {
    const saved = Array.from({ length: 10 }, () => new SoundDesc());
    for (let i = 0; i < 10; i++) saved[i].swap(this.slots[i]);
    this.environments.set(env, saved);
  }

  /** Environments::getMedia : reprend les emplacements sauvegardés, l'ancien contenu est libéré. */
  restoreSlots(env: number): void {
    const saved = this.environments.get(env);
    if (!saved) return;
    for (let i = 0; i < 10; i++) {
      saved[i].swap(this.slots[i]);
      saved[i].free();
    }
    this.environments.delete(env);
  }

  // --- Lecture -------------------------------------------------------------------------------

  /**
   * o1_playSound. `repCount` négatif : lecture dont le script coupe lui-même la fin avec un fondu
   * (le résultat donne le délai avant l'arrêt et la durée du fondu en dixièmes de seconde).
   */
  play(slot: number, repCount: number, frequency: number): { endMs: number; fadeOut: number } | null {
    const sample = this.slot(slot);
    if (!sample || sample.empty) return null;

    let result: { endMs: number; fadeOut: number } | null = null;
    if (repCount < 0) {
      if ((this.options.soundFlags ?? 2) < 2) return null;
      repCount = -repCount;
      const freq = frequency ? frequency : sample.frequency;
      const endRep = Math.max(repCount - 1, 1);
      result = { endMs: sample.length(endRep, freq, true), fadeOut: sample.fadeOutLength(freq) };
    }

    if (sample.type === "adl") {
      this.adlLoad(sample, slot);
      this.adl.repeating = repCount - 1;
      this.adlPlay();
    } else {
      this.blasterStop(0);
      this.blasterPlay(sample, repCount - 1, frequency);
    }
    return result;
  }

  /** blasterPlay : le mixeur ignore la demande si un son joue encore (jamais le cas après un arrêt). */
  private blasterPlay(sample: SoundDesc, repCount: number, frequency: number): void {
    this.blasterStopComposition();
    this.sync();
    if (this.voice) return;
    this.startSample(sample, repCount, frequency, this.now);
  }

  /**
   * SoundMixer::setSample. `repCount` est déjà « répétitions - 1 » : -1 = boucle infinie, sinon la
   * lecture compte max(1, repCount) passes (le test `_repCount - 1 > 0` de checkEndSample).
   */
  private startSample(sample: SoundDesc, repCount: number, frequency: number, startMs: number): void {
    if (frequency <= 0) frequency = sample.frequency;
    sample.frequency = frequency;
    const passes = repCount === -1 ? Infinity : Math.max(1, repCount);
    const duration = frequency > 0 ? (sample.size * passes * 1000) / frequency : 0;
    this.curDesc = sample;
    this.voice = { startMs, endMs: startMs + duration, fadeEndMs: null };
    this.backend.playSample(sample.pcm(), frequency, passes);
  }

  /** o2_stopSound (emplacement >= 0) : `fadeLength` en dixièmes de seconde. */
  stop(fadeLength: number): void {
    this.blasterStop(fadeLength);
  }

  private blasterStop(fadeLength: number, desc?: SoundDesc): void {
    this.sync();
    if (desc && desc !== this.curDesc) return;
    if (!this.voice) {
      if (fadeLength <= 0) this.curDesc = null;
      return;
    }
    if (fadeLength <= 0) {
      this.curDesc = null;
      this.voice = null;
      this.backend.stopSample(0);
      return;
    }
    // Le mixeur laisse la composition en cours finir son échantillon, sans suite
    this.voice.fadeEndMs = this.now + fadeLength * 100;
    this.backend.stopSample(fadeLength / 10);
  }

  // --- Compositions --------------------------------------------------------------------------

  /** o1_playComposition : attend la fin du son en cours, puis enchaîne les emplacements de la liste. */
  async playComposition(composition: number[], _frequency: number): Promise<void> {
    // La fréquence du script n'est pas utilisée par ScummVM : chaque son garde la sienne.
    await this.waitEndPlay();
    this.blasterStopComposition();
    this.composition = composition.slice(0, 50);
    this.compositionPos = -1;
    this.nextCompositionPos(this.now);
  }

  private blasterStopComposition(): void {
    if (this.compositionPos !== -1) {
      this.blasterStop(0);
      this.compositionPos = -1;
    }
  }

  /** nextCompositionPos : lance le prochain SND valide de la liste, à `startMs`. */
  private nextCompositionPos(startMs: number): void {
    while (++this.compositionPos < 50) {
      const raw = this.composition[this.compositionPos];
      const slot = raw === undefined ? -1 : (raw << 24) >> 24; // int8 dans ScummVM
      if (slot === -1) break;
      const sample = this.slot(slot);
      if (sample && !sample.empty && sample.type === "snd") {
        this.startSample(sample, 1, 0, startMs);
        return;
      }
      if (this.compositionPos === 49) this.compositionPos = -1;
    }
    this.compositionPos = -1;
    this.voice = null;
  }

  /** o1_waitEndPlay : termine la composition après le son courant et attend la fin du canal. */
  async waitEndPlay(): Promise<void> {
    this.compositionPos = -1; // endComposition
    while (this.isPlaying() && !this.options.shouldQuit?.()) await this.delay(200);
    this.blasterStop(0);
  }

  private async delay(ms: number): Promise<void> {
    const start = this.now;
    do await this.options.host.nextFrame();
    while (this.now - start < ms);
  }

  // --- AdLib ---------------------------------------------------------------------------------
  // Le lecteur et l'émulateur OPL2 tournent dans `AdlibOutput` (AudioWorklet) : la fin d'un morceau
  // (sans répétition restante) revient par `onStopped`, comme `_playing` de AdLib::onTimer.

  private adlLoad(sample: SoundDesc, index: number): void {
    this.adlUnload();
    // ADLPlayer::load : fichier refusé s'il fait moins de 60 octets
    if (!sample.data || !parseAdl(sample.data)) return;
    this.adl.loaded = true;
    this.adl.index = index;
    this.adlibOut?.load(sample.data);
  }

  /** ADLPlayer::unload : arrête et vide le lecteur. */
  private adlUnload(): void {
    this.adl.loaded = false;
    this.adl.playing = false;
    this.adl.repeating = 0;
    this.adl.index = -1;
    this.adlibOut?.unload();
  }

  private adlPlay(): void {
    if (!this.adl.loaded) return;
    this.adl.playing = true;
    this.adlibOut?.setRepeating(this.adl.repeating);
    this.adlibOut?.play();
  }

  stopAdlib(): void {
    this.adl.playing = false;
    this.adl.repeating = 0;
    this.adlibOut?.stop();
  }

  /** La musique ADL joue-t-elle encore ? (fin de morceau comprise ; AdLib::isPlaying) */
  get adlibPlaying(): boolean {
    return this.adl.playing;
  }

  // --- Son des vidéos IMD --------------------------------------------------------------------

  /**
   * Met en file une tranche audio d'une vidéo IMD : PCM 8 bits **non signé** (silence = 0x80) tel que
   * le lit data/imd.ts, à `rate` Hz. Les tranches se jouent à la suite ; isPlaying() reste vrai
   * jusqu'à la fin de la dernière (comme VideoPlayer::isSoundPlaying).
   */
  queueImdSlice(pcm: Uint8Array, rate: number): void {
    if (pcm.length === 0 || rate <= 0) return;
    const signed = new Int8Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) signed[i] = pcm[i] ^ 0x80;
    this.imdEndMs = Math.max(this.imdEndMs, this.now) + (pcm.length * 1000) / rate;
    this.backend.queuePcm(signed, rate);
  }

  /** Fin ou interruption de la vidéo : coupe ce qui reste en file. */
  stopImdAudio(): void {
    this.imdEndMs = 0;
    this.backend.clearQueue();
  }

  // --- Sans objet sur PC CD ------------------------------------------------------------------

  speakerOn(): void {}
  speakerOff(): void {}
  infogramesLoadInstruments(): void {}
  infogramesLoadSong(): void {}
  infogramesPlay(): void {}
  infogramesStop(): void {}
}
