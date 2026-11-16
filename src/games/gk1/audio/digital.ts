/**
 * Audio numérique de Gabriel Knight : voix (audio36, clé `module, noun, verb, cond, seq`) et sons numérotés (`audio/<n>`),
 * joués par `DoAudio` et, pour les sons qu'un objet `Sound` désigne, par `DoSound` (`docs/gk1/plan.md` vague A2, D3).
 *
 * Référence : `engines/sci/sound/audio32.cpp` de ScummVM (`Audio32::play`, `stop`, `pause`, `resume`, `getPosition`,
 * `findChannelById`, `freeUnusedChannels`, `readBuffer` pour les paliers de volume de SCI2), GPL v3 ou ultérieure, lu puis
 * réécrit.
 *
 * - **Canal** : un son en cours, désigné par sa ressource et, pour un son de `DoSound`, par son objet. Rejouer une ressource
 *   déjà en cours ne la relance pas : le canal en pause reprend, et la durée est rendue.
 * - **Durée** : `play` rend la durée en ticks de 1/60 s, lue dans `voices/<module>/index.json` ou `audio/index.json`
 *   (`samplesToTicks`), 0 si la ressource n'existe pas. Elle ne dépend ni du décodage ni de la sortie.
 * - **Position** : ticks écoulés depuis le début du canal, −1 s'il n'existe plus. Sans canal désigné : ticks écoulés depuis
 *   le début du premier son lancé quand rien ne jouait (c'est ce que lit la synchronisation des lèvres), −1 si rien ne joue.
 * - **Fin** : un canal qui ne boucle pas disparaît quand sa durée est écoulée ; `Narrator::doit` ferme alors la réplique.
 * - **Volume** : 0 à 127. SCI2 ne connaît que cinq niveaux (0 ; 1 à 42 ; 43 à 84 ; 85 à 126 ; 127).
 *
 * Écarts volontaires :
 * - **l'horloge est celle du jeu** (`clock`, les ticks de la machine virtuelle), jamais celle du son : sans sortie (tests,
 *   audio indisponible), tout se passe de la même façon, en silence. ScummVM retire un canal quand son flux est épuisé ;
 * - **les fichiers arrivent à la demande** (MP3 décodé par le navigateur) : le canal existe dès `play`, mais son temps ne
 *   commence qu'à l'arrivée du son, pour que les lèvres et la fin de la réplique suivent ce qu'on entend. Un fichier perdu,
 *   illisible ou en retard de plus de `LOAD_TIMEOUT_TICKS` compte comme un silence commencé à la demande : rien ne bloque ;
 * - les sons décodés sont gardés par la banque commune (`src/audio/voice-bank.ts`), qui oublie les plus anciens ;
 * - pas de limite au nombre de canaux (ScummVM : 5 en SCI2), pas de canal « surveillé », pas de robot.
 */
import { VoiceBank } from "../../../audio/voice-bank";
import type { Sample } from "../../../audio/web-sample-output";
import { AUDIO_INDEX_PATH, audioPath, parseDurationJson, samplesToTicks, TICKS_PER_SECOND, voiceClipName, voiceIndexPath, type VoiceKey, voicePath } from "../data/audio-index";
import type { Vm } from "../engine/vm";
import type { SampleOutput } from "./sound-manager";

/** Réponse de `DigitalFiles.text` pour un fichier demandé mais pas encore arrivé. */
export const DIGITAL_LOADING = Symbol("gk1.digital.loading");
export type DigitalLoading = typeof DIGITAL_LOADING;

/** Fichiers de `original/gk1/` vus par l'audio numérique, fournis par l'hôte (chemins relatifs, `docs/gk1/files.md`). */
export interface DigitalFiles {
  /** Le fichier existe-t-il (manifeste du jeu, réponse immédiate) ? */
  has(path: string): boolean;
  /** Texte d'un fichier JSON (`index.json`, `sync.json`) : `undefined` s'il manque, `DIGITAL_LOADING` s'il est en route. */
  text(path: string): string | undefined | DigitalLoading;
  /** Octets d'un fichier MP3. */
  load(path: string): Promise<Uint8Array>;
}

/** Son en cours de lecture sur la sortie. */
export interface DigitalVoice {
  stop(): void;
  /** Gain de 0 à 1. */
  setVolume(gain: number): void;
  pause(paused: boolean): void;
}

/** Sortie des sons : décodage et lecture (`audio/web-digital.ts` pour le navigateur). */
export interface DigitalOutput {
  decode(bytes: Uint8Array): Promise<Sample>;
  play(sample: Sample, options: { loop: boolean; volume: number }): DigitalVoice;
}

/** Ressource audio : une voix (audio36) ou un son numéroté. */
export type DigitalId = { readonly voice: VoiceKey } | { readonly sound: number };

export interface DigitalPlayOptions {
  loop?: boolean;
  /** 0 à 127 ; hors de ces bornes : 127. */
  volume?: number;
  /** Objet `Sound` qui joue ce son par `DoSound` (0 : aucun). */
  owner?: number;
}

export const DIGITAL_VOLUME_MAX = 127;
/** Réponse de `position` et de `stop` quand le canal n'existe pas. */
export const NO_POSITION = -1;
/** Plus grande position rendue aux scripts. */
const POSITION_MAX = 65534;
/** Attente maximale d'un fichier, en ticks du jeu, avant de le tenir pour perdu. */
export const LOAD_TIMEOUT_TICKS = 5 * TICKS_PER_SECOND;

/** Paliers de volume de SCI2 : borne haute (comprise) → niveau entendu. */
const VOLUME_STEPS: readonly (readonly [number, number])[] = [
  [0, 0],
  [42, 15],
  [84, 31],
  [DIGITAL_VOLUME_MAX - 1, 63],
];

/** Gain (0 à 1) d'un volume de 0 à 127, par les paliers de SCI2. */
export function volumeToGain(volume: number): number {
  const clamped = Math.max(0, Math.min(DIGITAL_VOLUME_MAX, volume));
  const level = VOLUME_STEPS.find(([limit]) => clamped <= limit)?.[1] ?? DIGITAL_VOLUME_MAX;
  return level / DIGITAL_VOLUME_MAX;
}

interface Channel {
  readonly resource: string;
  readonly path: string;
  readonly owner: number;
  readonly duration: number;
  loop: boolean;
  volume: number;
  /** Tick de la demande. */
  readonly requestedAt: number;
  /** Tick où le son a commencé ; `undefined` tant que le fichier n'est pas arrivé. */
  startedAt: number | undefined;
  /** Tick de la mise en pause, ou `undefined`. */
  pausedAt: number | undefined;
  voice: DigitalVoice | undefined;
}

function resourceName(id: DigitalId): string {
  return "voice" in id ? `voice ${id.voice.module}/${voiceClipName(id.voice)}` : `audio ${id.sound}`;
}

function pathOf(id: DigitalId): string {
  return "voice" in id ? voicePath(id.voice) : audioPath(id.sound);
}

function indexPathOf(id: DigitalId): string {
  return "voice" in id ? voiceIndexPath(id.voice.module) : AUDIO_INDEX_PATH;
}

const NO_FILES: DigitalFiles = { has: () => false, text: () => undefined, load: () => Promise.reject(new Error("GK1 : aucun fichier audio")) };

/** Ce qu'une sauvegarde garde des canaux numériques (`DigitalAudio.saveState`) : du JSON simple. */
export interface DigitalState {
  channels: {
    resource: string;
    path: string;
    owner: number;
    duration: number;
    loop: boolean;
    volume: number;
    requestedAt: number;
    startedAt: number | null;
    pausedAt: number | null;
  }[];
  /** Indice du premier canal ouvert, −1 s'il n'y en a pas. */
  first: number;
  allPausedAt: number | null;
}

export class DigitalAudio {
  /** Fichiers du jeu ; sans eux aucune ressource n'existe (texte seul, musique MIDI). */
  files: DigitalFiles = NO_FILES;
  /** Avertissements (index illisible), une fois chacun. */
  warn: (message: string) => void = () => {};
  private output: DigitalOutput | undefined;
  private channels: Channel[] = [];
  /** Canal lancé quand rien ne jouait : origine de la position « tous canaux ». */
  private first: Channel | undefined;
  private allPausedAt: number | undefined;
  private readonly durations = new Map<string, Map<string, number> | undefined>();
  /** Sons décodés pour la sortie branchée. */
  private bank: VoiceBank<string> | undefined;

  /** `clock` : horloge du jeu, en ticks de 1/60 s. */
  constructor(private readonly clock: () => number) {}

  /** Branche la sortie des sons, ou la retire (`undefined`) : les canaux en cours continuent en silence. */
  attach(output: DigitalOutput | undefined): void {
    if (output === this.output) return;
    for (const channel of this.channels) {
      channel.voice?.stop();
      channel.voice = undefined;
    }
    this.output = output;
    this.bank = output && new VoiceBank<string>({ has: (path) => this.files.has(path), load: (path) => this.files.load(path) }, output);
  }

  /** Nombre de canaux en cours. */
  get activeCount(): number {
    this.release();
    return this.channels.length;
  }

  /** La ressource existe-t-elle parmi les fichiers du jeu ? */
  has(id: DigitalId): boolean {
    return this.files.has(pathOf(id));
  }

  /**
   * Durée de la ressource en ticks : 0 si elle n'existe pas (ou si son index est illisible), `DIGITAL_LOADING` tant que
   * l'index de son module est en route.
   */
  duration(id: DigitalId): number | DigitalLoading {
    if (!this.has(id)) return 0;
    const path = indexPathOf(id);
    if (!this.durations.has(path)) {
      const text = this.files.text(path);
      if (text === DIGITAL_LOADING) return DIGITAL_LOADING;
      let parsed: Map<string, number> | undefined;
      if (text === undefined) this.warn(`audio : ${path} introuvable`);
      else {
        try {
          parsed = parseDurationJson(text);
        } catch {
          this.warn(`audio : ${path} illisible`);
        }
      }
      this.durations.set(path, parsed);
    }
    const samples = this.durations.get(path)?.get("voice" in id ? voiceClipName(id.voice) : String(id.sound));
    return samples === undefined ? 0 : samplesToTicks(samples);
  }

  /**
   * Lance la ressource et rend sa durée en ticks ; 0 si elle n'existe pas. Un index encore en route compte comme absent :
   * l'appelant qui peut attendre interroge d'abord `duration`.
   */
  play(id: DigitalId, options: DigitalPlayOptions = {}): number {
    this.release();
    const duration = this.duration(id);
    if (duration === DIGITAL_LOADING || duration === 0) return 0;
    const owner = options.owner ?? 0;
    const existing = this.find(id, owner);
    if (existing) {
      this.resumeChannel(existing);
      return Math.min(POSITION_MAX, duration);
    }
    const volume = options.volume ?? DIGITAL_VOLUME_MAX;
    const now = this.clock();
    const channel: Channel = {
      resource: resourceName(id),
      path: pathOf(id),
      owner,
      duration,
      loop: options.loop ?? false,
      volume: volume < 0 || volume > DIGITAL_VOLUME_MAX ? DIGITAL_VOLUME_MAX : volume,
      requestedAt: now,
      startedAt: undefined,
      pausedAt: undefined,
      voice: undefined,
    };
    this.channels.push(channel);
    if (this.channels.length === 1) {
      this.first = channel;
      if (this.allPausedAt !== undefined) this.allPausedAt = now;
    }
    this.start(channel);
    return duration;
  }

  /** Arrête un canal, ou tous sans `id` ; rend le nombre de canaux d'avant, 0 si le canal n'existe pas. */
  stop(id?: DigitalId, owner = 0): number {
    this.release();
    const count = this.channels.length;
    if (!id) {
      for (const channel of [...this.channels]) this.remove(channel);
      return count;
    }
    const channel = this.find(id, owner);
    if (!channel) return 0;
    this.remove(channel);
    return count;
  }

  /** Position en ticks d'un canal, ou de l'ensemble sans `id` ; `NO_POSITION` si rien ne joue. */
  position(id?: DigitalId, owner = 0): number {
    this.release();
    if (this.channels.length === 0) return NO_POSITION;
    const channel = id ? this.find(id, owner) : this.first;
    if (id && !channel) return NO_POSITION;
    // Sans `id` : depuis le début du premier canal, même s'il a fini avant les autres.
    if (channel?.startedAt === undefined) return 0;
    const until = channel.pausedAt ?? this.allPausedAt ?? this.clock();
    return Math.max(0, Math.min(POSITION_MAX, until - channel.startedAt));
  }

  /** Met en pause ou relance un canal, ou tous sans `id`. */
  pause(paused: boolean, id?: DigitalId, owner = 0): void {
    this.release();
    if (id) {
      const channel = this.find(id, owner);
      if (!channel) return;
      if (paused) this.pauseChannel(channel);
      else this.resumeChannel(channel);
      return;
    }
    const now = this.clock();
    if (paused) {
      if (this.allPausedAt !== undefined) return;
      this.allPausedAt = now;
      for (const channel of this.channels) if (channel.pausedAt === undefined) channel.voice?.pause(true);
    } else if (this.allPausedAt !== undefined) {
      const away = now - this.allPausedAt;
      this.allPausedAt = undefined;
      for (const channel of this.channels) {
        if (channel.pausedAt !== undefined) continue;
        if (channel.startedAt !== undefined) channel.startedAt += away;
        channel.voice?.pause(false);
      }
    }
  }

  /** Volume (0 à 127) d'un canal ; rend faux s'il n'existe pas. */
  setVolume(volume: number, id: DigitalId, owner = 0): boolean {
    const channel = this.find(id, owner);
    if (!channel) return false;
    this.applyVolume(channel, volume);
    return true;
  }

  /** Volume d'un canal, ou `undefined`. */
  volume(id: DigitalId, owner = 0): number | undefined {
    return this.find(id, owner)?.volume;
  }

  /** Sons numérisés de `DoSound` : un canal par objet `Sound` (`engine/kernel/sound.ts`). */
  readonly soundOutput: SampleOutput = {
    has: (resourceId) => this.has({ sound: resourceId }),
    play: (key, resourceId, loop, volume) => {
      this.stopOwner(key);
      this.play({ sound: resourceId }, { loop, volume, owner: key });
    },
    stop: (key) => this.stopOwner(key),
    pause: (key, paused) => {
      const channel = this.owned(key);
      if (!channel) return;
      if (paused) this.pauseChannel(channel);
      else this.resumeChannel(channel);
    },
    setVolume: (key, volume) => {
      const channel = this.owned(key);
      if (channel) this.applyVolume(channel, volume);
    },
    finished: (key) => this.owned(key) === undefined,
  };

  private owned(owner: number): Channel | undefined {
    this.release();
    return this.channels.find((channel) => channel.owner === owner);
  }

  private stopOwner(owner: number): void {
    const channel = this.owned(owner);
    if (channel) this.remove(channel);
  }

  /** Canal de cette ressource : pour un son de `DoSound`, celui de son objet ; sans objet, le premier trouvé. */
  private find(id: DigitalId, owner: number): Channel | undefined {
    const resource = resourceName(id);
    return this.channels.find((channel) => channel.resource === resource && (owner === 0 || channel.owner === owner));
  }

  private remove(channel: Channel): void {
    channel.voice?.stop();
    channel.voice = undefined;
    this.channels = this.channels.filter((other) => other !== channel);
    if (this.channels.length === 0) this.first = undefined;
  }

  private applyVolume(channel: Channel, volume: number): void {
    channel.volume = Math.max(0, Math.min(DIGITAL_VOLUME_MAX, volume));
    channel.voice?.setVolume(volumeToGain(channel.volume));
  }

  private pauseChannel(channel: Channel): void {
    if (channel.pausedAt !== undefined) return;
    channel.pausedAt = this.clock();
    channel.voice?.pause(true);
  }

  private resumeChannel(channel: Channel): void {
    if (channel.pausedAt === undefined) return;
    if (channel.startedAt !== undefined) channel.startedAt += this.clock() - channel.pausedAt;
    channel.pausedAt = undefined;
    if (this.allPausedAt === undefined) channel.voice?.pause(false);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Sauvegarde
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Canaux en cours (sans leur voix de sortie) et pauses, pour `engine/save.ts`. */
  saveState(): DigitalState {
    return {
      channels: this.channels.map((channel) => ({
        resource: channel.resource,
        path: channel.path,
        owner: channel.owner,
        duration: channel.duration,
        loop: channel.loop,
        volume: channel.volume,
        requestedAt: channel.requestedAt,
        startedAt: channel.startedAt ?? null,
        pausedAt: channel.pausedAt ?? null,
      })),
      first: this.first ? this.channels.indexOf(this.first) : -1,
      allPausedAt: this.allPausedAt ?? null,
    };
  }

  /**
   * Reprend les canaux d'une sauvegarde : mêmes ressources, mêmes instants, donc mêmes positions rendues aux scripts. Une
   * boucle (ambiance) repart du début ; un son joué une fois (réplique) **finit en silence**, la sortie ne sachant pas partir du
   * milieu d'un échantillon.
   */
  loadState(state: DigitalState): void {
    for (const channel of this.channels) channel.voice?.stop();
    this.channels = state.channels.map((saved) => ({ ...saved, startedAt: saved.startedAt ?? undefined, pausedAt: saved.pausedAt ?? undefined, voice: undefined }));
    this.first = state.first >= 0 ? this.channels[state.first] : undefined;
    this.allPausedAt = state.allPausedAt ?? undefined;
    for (const channel of this.channels) {
      if (channel.startedAt === undefined) this.start(channel);
      else if (channel.loop) this.restart(channel);
    }
  }

  /** Relance la voix d'un canal repris sans toucher à son instant de départ. */
  private restart(channel: Channel): void {
    const { output, bank } = this;
    if (!output || !bank) return;
    const startedAt = channel.startedAt;
    void bank.sample(channel.path).then((sample) => {
      if (!sample || this.output !== output || !this.channels.includes(channel) || channel.voice) return;
      this.sound(channel, output, sample);
      channel.startedAt = startedAt;
    });
  }

  /** Retire les canaux finis, et tient pour un silence les fichiers trop lents. */
  private release(): void {
    if (this.allPausedAt !== undefined) return;
    const now = this.clock();
    for (const channel of [...this.channels]) {
      if (channel.startedAt === undefined) {
        if (now - channel.requestedAt < LOAD_TIMEOUT_TICKS) continue;
        channel.startedAt = channel.requestedAt;
      }
      if (!channel.loop && channel.pausedAt === undefined && now - channel.startedAt >= channel.duration) this.remove(channel);
    }
  }

  /** Demande le fichier et lance la voix à son arrivée ; sans sortie, le canal commence aussitôt, en silence. */
  private start(channel: Channel): void {
    const { output, bank } = this;
    if (!output || !bank) {
      channel.startedAt = channel.requestedAt;
      return;
    }
    const cached = bank.peek(channel.path);
    if (cached) {
      this.sound(channel, output, cached);
      return;
    }
    void bank.sample(channel.path).then((sample) => {
      // Arrêté, ou tenu pour perdu entre-temps : le son n'est plus attendu.
      if (!this.channels.includes(channel) || channel.startedAt !== undefined) return;
      if (sample && this.output === output) this.sound(channel, output, sample);
      else channel.startedAt = channel.requestedAt;
    });
  }

  private sound(channel: Channel, output: DigitalOutput, sample: Sample): void {
    channel.startedAt = this.clock();
    try {
      channel.voice = output.play(sample, { loop: channel.loop, volume: volumeToGain(channel.volume) });
      if (channel.pausedAt !== undefined || this.allPausedAt !== undefined) channel.voice.pause(true);
    } catch {
      channel.voice = undefined;
    }
  }
}

const instances = new WeakMap<Vm, DigitalAudio>();

/**
 * Audio numérique de cette machine virtuelle (créé au premier appel), sur l'horloge du jeu. L'hôte y branche les fichiers
 * (`files`) et la sortie (`attach`) ; sans eux le jeu tourne en texte seul et en musique MIDI.
 */
export function digitalAudioOf(vm: Vm): DigitalAudio {
  let digital = instances.get(vm);
  if (!digital) {
    digital = new DigitalAudio(() => vm.ticks);
    digital.warn = (message) => vm.warn(message);
    instances.set(vm, digital);
  }
  return digital;
}
