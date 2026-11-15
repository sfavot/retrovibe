/**
 * Son du moteur, d'après ScummVM (`engines/gob/sound/sound.cpp`, `sounddesc.cpp`, `soundblaster.cpp`,
 * `soundmixer.cpp`, `pcspeaker.cpp` ; GPL v3+).
 */
import { parseSnd } from "../data/snd";
import type { FrameTimer, Host, SoundLoadArgs, SoundSystem } from "../host";
import type { AdlibOutput, SoundBackend, SoundSource } from "./backend";
import { parseAdl } from "./adlib/adl-player";
import { PcSpeaker } from "./pcspeaker";

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
    // sounddesc.cpp : `_size` est un uint32, la fréquence (int16) est convertie en non signé : une fréquence
    // négative (scripts de Ween) donne 0
    if (frequency === 0) return 0;
    return Math.trunc(((10 * Math.trunc(this.size / 2)) >>> 0) / (frequency >>> 0)) << 16 >> 16;
  }

  /** calcLength : durée en ms de `repCount` lectures, moins la moitié si `fade` (arithmétique uint32 du C++). */
  length(repCount: number, frequency: number, fade: boolean): number {
    if (frequency === 0) return 0;
    const fadeSize = fade ? Math.trunc(this.size / 2) : 0;
    const total = Math.imul(Math.imul(this.size, repCount) - fadeSize, 1000) >>> 0;
    return Math.trunc(total / (frequency >>> 0)) >>> 0;
  }

  /** PCM signé prêt pour le backend (SND uniquement). */
  pcm(): Int8Array {
    const d = this.data!;
    return new Int8Array(d.buffer, d.byteOffset, d.length);
  }
}

/**
 * Le canal unique du mixeur (SoundBlaster) : un son, éventuellement en fondu de sortie, compté en trames du
 * mixeur de ScummVM (`OUTPUT_RATE` par seconde ; positions absolues, voir `SoundEngine.mixFrame`).
 */
interface Voice {
  /** Trame du flux où commence l'échantillon en cours. */
  startFrame: number;
  /** Trame où SoundMixer::readBuffer constate la fin (`_offset >= _length`), Infinity en boucle. */
  endFrame: number;
  /** Première trame après le fondu de sortie (endFade), null sans fondu. */
  fadeEndFrame: number | null;
}

/** Fréquence de sortie du mixeur de ScummVM (SdlMixerManager, 44 100 Hz par défaut). */
const OUTPUT_RATE = 44100;
/** Le convertisseur de fréquence lit le flux par blocs de 512 trames (`audio/rate.cpp`, `_buffer[512]`). */
const MIX_BLOCK = 512;

/**
 * État du lecteur ADL côté moteur (ADLPlayer/AdLib de ScummVM). Le lecteur vit dans `AdlibOutput`, qui signale la fin
 * du morceau ; sans sortie, une musique joue jusqu'à son arrêt.
 */
class AdlState {
  index = -1;
  loaded = false;
  playing = false;
  repeating = 0;
}

export interface SoundEngineOptions {
  backend: SoundBackend;
  host: Pick<Host, "now" | "nextFrame" | "delay">;
  source: SoundSource;
  /** Vrai quand le jeu doit s'arrêter (interrompt waitEndPlay). */
  shouldQuit?: () => boolean;
  /** Cadence du jeu (points d'image et longDelay de waitEndPlay) ; sans elle, attente par images de l'hôte. */
  timer?: () => Pick<FrameTimer, "markImage" | "longDelay"> | undefined;
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
  /** Trame du flux jusqu'où le convertisseur a déjà lu (lecture par blocs, en avance sur la sortie). */
  private readFrame = 0;
  private readonly environments = new Map<number, SoundDesc[]>();
  /** Mixeur de ScummVM à la trame près (horloge exacte du banc, `Host.delay`) plutôt que temps continu. */
  private readonly exactMixer: boolean;
  /** Haut-parleur du PC (état sur l'horloge du jeu, sortie du backend s'il en a une). */
  readonly speaker: PcSpeaker;

  constructor(private readonly options: SoundEngineOptions) {
    this.backend = options.backend;
    this.exactMixer = options.host.delay !== undefined;
    this.adlibOut = options.backend.adlib ?? null;
    this.speaker = new PcSpeaker(() => this.now, options.backend.speaker ?? null);
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

  /**
   * Horloge du mixeur en trames. Sur l'horloge exacte du banc, le mixeur de ScummVM est tiré par trames entières ;
   * ailleurs, temps continu (le vrai mixeur est celui de l'hôte).
   */
  private mixFrame(ms: number): number {
    const frames = (ms * OUTPUT_RATE) / 1000;
    return this.exactMixer ? Math.floor(frames) : frames;
  }

  /**
   * Un événement du flux (fin de son, de fondu) à la trame `frame` est-il visible ? ScummVM : le convertisseur lit le
   * flux par blocs de 512 trames dès qu'il lui manque une trame à sortir, donc dès que le bloc qui le contient est lu.
   */
  private visible(frame: number, target: number): boolean {
    if (!this.exactMixer) return target >= frame;
    const blockStart = this.readFrame + Math.floor((frame - this.readFrame) / MIX_BLOCK) * MIX_BLOCK;
    return target > blockStart;
  }

  /** Position de lecture du flux une fois la sortie servie jusqu'à `target`. */
  private readPosition(target: number): number {
    if (!this.exactMixer) return Math.max(this.readFrame, target);
    if (target <= this.readFrame) return this.readFrame;
    return this.readFrame + Math.ceil((target - this.readFrame) / MIX_BLOCK) * MIX_BLOCK;
  }

  /**
   * Fait avancer le canal jusqu'à maintenant, comme le mixeur de ScummVM (`soundmixer.cpp` readBuffer, checkEndSample,
   * endFade ; `soundblaster.cpp` nextCompositionPos) : fins de sons et de fondus, enchaînement des compositions dans
   * le même flux.
   */
  private sync(): void {
    const target = this.mixFrame(this.now);
    for (let guard = 0; this.voice && guard < 1000; guard++) {
      const v = this.voice;
      const fadeEnd = v.fadeEndFrame ?? Infinity;
      if (!this.visible(Math.min(fadeEnd, v.endFrame), target)) {
        this.readFrame = this.readPosition(target);
        return;
      }
      if (fadeEnd <= v.endFrame) {
        // endFade : fin du fondu de sortie
        this.readFrame = fadeEnd;
        this.compositionPos = -1;
        this.curDesc = null;
        this.voice = null;
      } else if (this.compositionPos !== -1) this.nextCompositionPos(v.endFrame);
      else {
        this.readFrame = v.endFrame;
        this.voice = null;
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
    this.startSample(sample, repCount, frequency, this.streamStart());
  }

  /**
   * SoundMixer::setSample. `repCount` est déjà « répétitions - 1 » : -1 = boucle infinie, sinon la
   * lecture compte max(1, repCount) passes (le test `_repCount - 1 > 0` de checkEndSample).
   */
  private startSample(sample: SoundDesc, repCount: number, frequency: number, startFrame: number): void {
    if (frequency <= 0) frequency = sample.frequency;
    sample.frequency = frequency;
    const passes = repCount === -1 ? Infinity : Math.max(1, repCount);
    // ScummVM : pas de lecture `_offsetInc` = (fréquence << 16) / sortie, tronqué, donc ⌈taille × 65536 / pas⌉
    // trames par passe ; sinon taille / fréquence exactement.
    const inc = Math.trunc((frequency * 65536) / OUTPUT_RATE);
    const frames = !this.exactMixer
      ? frequency > 0 ? (sample.size * OUTPUT_RATE) / frequency : 0
      : inc > 0 ? Math.ceil((sample.size * 65536) / inc) : Infinity;
    this.curDesc = sample;
    this.voice = { startFrame, endFrame: startFrame + (sample.size === 0 ? 0 : frames * passes), fadeEndFrame: null };
    this.backend.playSample(sample.pcm(), frequency, passes);
  }

  /**
   * Trame où commence le flux d'un son lancé maintenant : ScummVM sort d'abord ce que le convertisseur garde encore
   * du son précédent.
   */
  private streamStart(): number {
    const now = this.mixFrame(this.now);
    this.readFrame = this.exactMixer ? Math.max(this.readFrame, now) : now;
    return this.readFrame;
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
    // SoundMixer::stop : fondu sur `fadeLength` dixièmes de seconde de trames, à partir de ce que le convertisseur
    // n'a pas encore lu ; la composition en cours finit son échantillon, sans suite
    this.voice.fadeEndFrame = this.readFrame + Math.trunc((fadeLength * OUTPUT_RATE) / 10);
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
    this.nextCompositionPos(this.streamStart());
  }

  private blasterStopComposition(): void {
    if (this.compositionPos !== -1) {
      this.blasterStop(0);
      this.compositionPos = -1;
    }
  }

  /** nextCompositionPos : lance le prochain SND valide de la liste, à la trame `startFrame` du flux. */
  private nextCompositionPos(startFrame: number): void {
    while (++this.compositionPos < 50) {
      const raw = this.composition[this.compositionPos];
      const slot = raw === undefined ? -1 : (raw << 24) >> 24; // int8 dans ScummVM
      if (slot === -1) break;
      const sample = this.slot(slot);
      if (sample && !sample.empty && sample.type === "snd") {
        this.startSample(sample, 1, 0, startFrame);
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
    // Sound::blasterWaitEndPlay (sound.cpp:522-540) : un point d'image et longDelay(200) par tour.
    while (this.isPlaying() && !this.options.shouldQuit?.()) {
      const timer = this.options.timer?.();
      if (!timer) {
        await this.delay(200);
        continue;
      }
      timer.markImage();
      await timer.longDelay(200);
    }
    this.blasterStop(0);
  }

  private async delay(ms: number): Promise<void> {
    const start = this.now;
    do await this.options.host.nextFrame();
    while (this.now - start < ms);
  }

  // --- AdLib ---------------------------------------------------------------------------------
  // Le lecteur tourne dans `AdlibOutput` (`OplAdlibOutput` sur la sortie OPL commune dans le navigateur) : la fin d'un
  // morceau (sans répétition restante) revient par `onStopped`, comme `_playing` de AdLib::onTimer.

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
    this.adlibOut?.setRepeating(this.adl.repeating);
    this.adlibOut?.play();
    // après les appels : une fin signalée pendant leur rattrapage de ticks (`OplAdlibOutput.update`) est celle d'avant
    this.adl.playing = true;
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

  // --- Haut-parleur du PC (sound.cpp:160-184) ------------------------------------------------

  speakerOn(frequency: number, length: number): void {
    this.speaker.speakerOn(frequency, length);
  }

  speakerOff(): void {
    this.speaker.speakerOff();
  }

  speakerOnUpdate(millis: number): void {
    this.speaker.onUpdate(millis);
  }

  // --- Infogrames : versions Amiga / Atari seulement (sound.cpp:185-200, sans objet sous DOS) --
  infogramesLoadInstruments(): void {}
  infogramesLoadSong(): void {}
  infogramesPlay(): void {}
  infogramesStop(): void {}
}
