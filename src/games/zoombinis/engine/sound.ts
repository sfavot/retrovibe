/**
 * Service sonore de Zoombinis (`docs/zoombinis/engine.md` §6) : deux files de lecture de 32 places, un routage des ids par plage
 * d'archive, deux drapeaux (musique, effets), au-dessus de `AudioSink` (WAVE) et de `MidiPlayer` (MIDI) communs.
 *
 * Original :
 *  - `11a0:0ee7(?, id)` met l'id dans une file de 32 places : « effets / voix » (`DS:a648`, drapeau `DS:a43a`, ids < 30000) ou
 *    « musique » (`DS:a6ca`, drapeau `DS:a43b`, ids ≥ 30000 ; l'id 0 rappelle la dernière musique, `DS:3ea6`) ;
 *  - `11a8:2d3f`, appelé à chaque `11a8:04b9` (tick), traite les files et route chaque id : < 1000 ou ≥ 30000 → archive commune
 *    (`ZOOMBINI.MHK` pour les `\0SND`, `MIDIMPC.MHK` pour les `tMID`), 1000…19999 → archive de l'écran, ≥ 20000 (et < 30000) →
 *    `ZOOMBINI.MHK`, son « s-sound » (`+0x42 = 1`, `1028:0b04`).
 *
 * - **Un seul son numérique à la fois** (`1028:0a12` → `1028:0b3d` : nombre de canaux par type `DS:0296` = 1, valeur initiale de l'exécutable, jamais
 *   écrite) : démarrer un son coupe celui qui joue sur le canal (`1028:0c0a`). Un son en boucle (`\0SND` de répétition `0xffff`, ex. les pas et
 *   roulettes 2000 / 2003 des gorges, 8500 / 8503 des grottes) ne s'arrête donc qu'au son suivant, ou à la sortie de l'écran (`1028:0e53`).
 * - **Priorité** (`11a8:317c`, appelé pour la file des effets seulement, `11a8:086b`) : à chaque tick, parmi le son qui joue encore et les ids en
 *   file, un seul est gardé, celui de plus haute priorité, le plus récent à égalité ; les autres sont retirés de la file sans être joués. La
 *   priorité d'un id (`11a8:30e7`) est `32 − i` pour la première plage `i` de la table `DS:ac00` qui le contient, 0 hors de toute plage.
 *   La table est remplie par `11a8:313a(min, max, drapeau)` : `11a8:021c` (Exit commun) la remet à [996…997], puis l'Enter de l'écran ajoute
 *   ses plages (`SCREEN_SOUND_PRIORITIES`) ; la ville et le bac la vident d'abord. 32 plages au plus.
 * - `11a8:2d3f` rend l'id du dernier son démarré, gardé en `DS:a402` (« la voix en cours » des épreuves) : `currentEffect`.
 *
 * Choix d'implémentation :
 *  - le service est pur : il ne lit que ses archives et le puits audio ; le moteur appelle `tick()` à chaque tick ;
 *  - la table des priorités vient du nom de l'archive d'écran (`setScreenArchive`) ; les écrans cachés 19 / 20, qui lisent `PICKER.MHK`, prennent
 *    donc la table du choix des Zoombinis au lieu de la table de base (écart sans effet audible connu) ;
 *  - le drapeau des plages (1 : lecture « s-sound » par `1028:0b04`) ne change rien ici : tous les sons sont lus de la même façon ;
 *  - pour la musique, chaque id remplace la précédente, donc la dernière de la file l'emporte ;
 *  - une ressource absente de l'archive visée n'est pas jouée et ne coupe pas le son en cours (`1028:0a12` sort avant `0c0a`), mais devient
 *    l'id courant (`DS:a402` est écrit avant l'appel).
 */
import { isMidi, parseMidi } from "../../../data/mohawk/midi";
import { MohawkArchive, TAG_SND } from "../../../data/mohawk/mohawk";
import { isWave, parseWave } from "../../../data/mohawk/wave";
import { loadPcm } from "../../../engine/mohawk/audio/pcm";
import { MidiPlayer, parsePrograms, parseSysx, type ProgramEntry } from "../../../engine/mohawk/audio/sequencer";
import type { AudioSink, WaveHandle } from "../../../engine/mohawk/audio/sink";
import { parseSong, type Song } from "../../../audio/smf";
import { defineService } from "../../../engine/mohawk/scene";
import { TAG_TMID } from "../data/archives";

/** Une archive Mohawk brute, ou tout ce qui en porte une (`Archive` de `resources.ts`). */
export type SoundArchive = MohawkArchive | { readonly mohawk: MohawkArchive };

const mohawkOf = (archive: SoundArchive): MohawkArchive => ("mohawk" in archive ? archive.mohawk : archive);

/** Places de chaque file (`DS:a648` et `DS:a6ca`). */
export const QUEUE_SIZE = 32;
/** Les ids à partir de là sont des musiques (`tMID` de `MIDIMPC.MHK`). */
export const MUSIC_MIN_ID = 30000;
/** Les ids de 1000 à 19999 viennent de l'archive de l'écran ; en dessous, de `ZOOMBINI.MHK`. */
export const SCREEN_MIN_ID = 1000;
export const SCREEN_MAX_ID = 19999;
/** De 20000 à 29999 : voix et dialogues de `ZOOMBINI.MHK`, « s-sound » dans l'original. */
export const STREAM_MIN_ID = 20000;

/** Plage de priorité de `11a8:313a` : ids `min` à `max` inclus. */
export interface SoundPriorityRange {
  readonly min: number;
  readonly max: number;
}

/** Nombre de plages de la table `DS:ac00` (`11a8:313a` ignore les suivantes). */
export const SOUND_PRIORITY_SLOTS = 32;

/** Plage posée par `11a8:0000` (démarrage) et `11a8:021c` (Exit commun) : le « Go » 996 et le son 997. */
export const BASE_SOUND_PRIORITIES: readonly SoundPriorityRange[] = [{ min: 996, max: 997 }];

const r = (min: number, max = min): SoundPriorityRange => ({ min, max });

/**
 * Plages ajoutées par l'Enter de chaque écran (`11a8:313a`, relevées dans l'ordre d'appel), par archive d'écran. `reset` : l'Enter vide
 * d'abord la table (`[ac00] = 0` : `1188:0142` ville, `10d8:00a2` bac). Les écrans absents (logo) gardent la table de base.
 */
export const SCREEN_SOUND_PRIORITIES: Readonly<Record<string, { readonly reset?: boolean; readonly ranges: readonly SoundPriorityRange[] }>> = {
  // `10b0:0027`, `10b8:0030`.
  "BASECAMP.MHK": { ranges: [r(20000, 29999), r(2000, 2099), r(1100, 1199)] },
  "BCTWO.MHK": { ranges: [r(20000, 29999), r(2000, 2099), r(6000, 6099)] },
  // `10c0:00e6`.
  "BRIDGE.MHK": { ranges: [r(20000, 29999), r(1200, 1201), r(1000, 1099), r(1216, 1226), r(1202, 1213), r(1214, 1215), r(175, 199)] },
  // `10c8:0000`.
  "CAVES.MHK": {
    ranges: [r(996, 997), r(20000, 29999), r(6006), r(6001), r(6008), r(6000), r(6005), r(6004), r(6003), r(6007), r(6002), r(8200, 12001), r(425, 499), r(600, 799)],
  },
  // `10d8:0071`.
  "FERRY.MHK": {
    reset: true,
    ranges: [r(1606, 1607), r(20000, 29999), r(1800, 1899), r(996, 997), r(1704, 1705), r(425, 499), r(1600, 1699), r(1900, 1999), r(1700, 1799)],
  },
  // `10e0:00ea`.
  "FLEENS.MHK": {
    ranges: [r(20000, 29999), r(1000, 1002), r(300, 324), r(425, 499), r(99), r(375, 399), r(7000, 7099), r(1800, 1899), r(1200, 4099), r(4100, 4199), r(175, 199), r(900, 944)],
  },
  // `10e8:0000`.
  "HOTEL.MHK": {
    ranges: [r(8900, 8901), r(996, 997), r(20000, 29999), r(99), r(7000, 7999), r(425, 499), r(6004, 6006), r(6000, 6099), r(9004, 9006), r(9000, 9999), r(10000, 10999)],
  },
  // `10f8:0000`.
  "LILLY.MHK": {
    ranges: [r(996, 997), r(20000, 29999), r(11000, 11001), r(12000, 12004), r(10009), r(10010), r(10011), r(10000), r(10002), r(10004), r(10003), r(10005, 10008)],
  },
  // `1110:0107`.
  "MAP.MHK": { ranges: [r(20000, 29999)] },
  // `1118:0000`.
  "MAZE2.MHK": {
    ranges: [r(996, 997), r(20000, 29999), r(11000), r(5104), r(10000), r(10002, 10004), r(9000, 9001), r(5100, 5103), r(12000), r(10001)],
  },
  // `1120:0000`.
  "NET.MHK": { ranges: [r(996, 997), r(20000, 29999), r(300, 324), r(425, 499), r(8000, 8002), r(9000, 10999), r(7000, 7999), r(10000, 10099)] },
  // `1128:006d`.
  "PICKER.MHK": { ranges: [r(20000, 29999), r(1000, 1007)] },
  // `1130:0000`.
  "PIZZA.MHK": {
    ranges: [
      r(20000, 29999), r(8024, 8029), r(15000, 15099), r(10000, 10032), r(9000, 9025), r(8000, 8023), r(996, 997), r(12000), r(7008, 7009), r(12001),
      r(475, 499), r(14000), r(425, 499), r(8030, 8999), r(9026, 9999), r(10033, 10099), r(12002), r(7000, 7007), r(12003, 12099), r(13000, 13099),
    ],
  },
  // `1158:0000` (les 15 plages des sons du cristal sont posées deux fois ; la table est pleine à 32).
  "SMOKE.MHK": {
    ranges: [
      r(996, 997), r(20000, 29999),
      ...[0, 1].flatMap(() => [r(11008, 11009), r(11001), r(11013), r(11016), r(125, 149), r(450, 474), r(11011, 11012), r(11014, 11015), r(11010), r(11002, 11004), r(11007), r(11006), r(11005), r(11000), r(11017)]),
    ],
  },
  // `1170:0000`.
  "SLIDES.MHK": { ranges: [r(7001), r(7000), r(20000, 29999), r(8000), r(8500, 8599), r(425, 499), r(7002)] },
  // `1188:0128`.
  "TOWN.MHK": { reset: true, ranges: [r(3000, 3003), r(20000, 29999), r(996, 997)] },
  // `1190:0107`.
  "TUNNELS.MHK": {
    ranges: [r(20000, 29999), r(4000, 4699), r(7000, 7099), r(425, 499), r(4700, 4799), r(6000, 6099), r(175, 199), r(99), r(8500, 8599)],
  },
  // `11b0:00c4`.
  "XFER.MHK": { ranges: [r(20000, 29999)] },
};

/** Table des priorités de l'écran dont l'archive s'appelle `name` (chemin accepté) : base puis plages de l'Enter, 32 au plus. */
export function screenSoundPriorities(name: string | null): SoundPriorityRange[] {
  const entry = name === null ? undefined : SCREEN_SOUND_PRIORITIES[name.replace(/\\/g, "/").split("/").pop()!.toUpperCase()];
  const table = [...(entry?.reset ? [] : BASE_SOUND_PRIORITIES), ...(entry?.ranges ?? [])];
  return table.slice(0, SOUND_PRIORITY_SLOTS);
}

/** Nombre de répétitions `0xffff` d'un WAVE = lecture en boucle (`wave.ts`). */
const LOOP_FOREVER = 0xffff;

export interface ZoombinisSoundArchives {
  /** `ZOOMBINI.MHK` : `\0SND` communs (voix des Zoombinis, dialogues). */
  readonly zoombini: SoundArchive;
  /** `MIDIMPC.MHK` : musiques `tMID` (ids ≥ 30000). */
  readonly midimpc: SoundArchive;
}

export interface ZoombinisSoundOptions {
  /** Ressource `SYSX` de `MIDIMAP.DAT` (octets bruts, 64 messages de 3 octets) : envoyée avant chaque musique. */
  readonly sysx?: Uint8Array;
}

const loopCache = new WeakMap<MohawkArchive, Map<number, boolean>>();

/** Vrai si le WAVE `id` se répète indéfiniment (nombre de boucles `0xffff`). */
function isLooping(archive: MohawkArchive, id: number): boolean {
  let byId = loopCache.get(archive);
  if (!byId) {
    byId = new Map();
    loopCache.set(archive, byId);
  }
  let looping = byId.get(id);
  if (looping === undefined) {
    looping = parseWave(archive.get(TAG_SND, id)).loopCount === LOOP_FOREVER;
    byId.set(id, looping);
  }
  return looping;
}

const songCache = new WeakMap<MohawkArchive, Map<number, { song: Song; programs: ProgramEntry[] }>>();

function loadSong(archive: MohawkArchive, id: number): { song: Song; programs: ProgramEntry[] } {
  let byId = songCache.get(archive);
  if (!byId) {
    byId = new Map();
    songCache.set(archive, byId);
  }
  let entry = byId.get(id);
  if (!entry) {
    const midi = parseMidi(archive.get(TAG_TMID, id));
    entry = { song: parseSong(midi.smf), programs: parsePrograms(midi.programs) };
    byId.set(id, entry);
  }
  return entry;
}

export class ZoombinisSound {
  private screen: MohawkArchive | null = null;
  private readonly effects: number[] = [];
  private readonly musics: number[] = [];
  /** Effet / voix en cours de sortie (un seul canal : au plus une entrée), avec l'id demandé (`isPlaying`). */
  private readonly waves = new Map<WaveHandle, number>();
  /** Table des priorités `DS:ac00` de l'écran courant. */
  private priorities: SoundPriorityRange[] = screenSoundPriorities(null);
  /** `DS:a402` : id du dernier effet démarré (0 = aucun). */
  private current = 0;
  private readonly player: MidiPlayer;
  private readonly zoombini: MohawkArchive;
  private readonly midimpc: MohawkArchive;
  /** `DS:3ea6` : dernière musique demandée (0 = aucune). */
  private lastMusic = 0;
  private music = false;
  private effectsOn = true;
  private musicOn = true;

  constructor(
    private readonly audio: AudioSink,
    archives: ZoombinisSoundArchives,
    options: ZoombinisSoundOptions = {},
  ) {
    this.zoombini = mohawkOf(archives.zoombini);
    this.midimpc = mohawkOf(archives.midimpc);
    this.player = new MidiPlayer(audio.midi, { now: () => audio.now(), initMessages: options.sysx ? parseSysx(options.sysx) : undefined });
  }

  /**
   * Archive de l'écran courant (ids 1000…19999) ; `null` entre deux écrans. Pose aussi la table des priorités de l'écran (`11a8:313a`, d'après le
   * nom de l'archive quand elle en a un, `SCREEN_SOUND_PRIORITIES`) ; `null` remet la table de base (`11a8:021c`).
   */
  setScreenArchive(archive: SoundArchive | null): void {
    this.screen = archive ? mohawkOf(archive) : null;
    this.priorities = screenSoundPriorities(archive && "name" in archive && typeof archive.name === "string" ? archive.name : null);
  }

  /** `DS:a402` : id du dernier effet ou de la dernière voix démarrés (0 si aucun), qu'il joue encore ou non (`isPlaying`). */
  get currentEffect(): number {
    return this.current;
  }

  /** Priorité d'un id (`11a8:30e7`) : `32 − i` pour la première plage `i` qui le contient, 0 sinon. */
  priorityOf(id: number): number {
    const i = this.priorities.findIndex((range) => id >= range.min && id <= range.max);
    return i < 0 ? 0 : SOUND_PRIORITY_SLOTS - i;
  }

  /** Drapeau `DS:a43b` (Ctrl+V dans le code). Le couper arrête la musique et vide sa file ; le rallumer ne rejoue rien (hypothèse : seul `queue(0)` rappelle la dernière). */
  get musicEnabled(): boolean {
    return this.musicOn;
  }

  set musicEnabled(on: boolean) {
    this.musicOn = on;
    if (!on) {
      this.musics.length = 0;
      this.stopMusic();
    }
  }

  /** Drapeau `DS:a43a` (Ctrl+Y). Le couper vide la file des effets sans couper ceux qui jouent (hypothèse). */
  get effectsEnabled(): boolean {
    return this.effectsOn;
  }

  set effectsEnabled(on: boolean) {
    this.effectsOn = on;
    if (!on) this.effects.length = 0;
  }

  /** Dernière musique demandée (`DS:3ea6`), 0 si aucune. */
  get lastMusicId(): number {
    return this.lastMusic;
  }

  /** Une musique joue. */
  get musicPlaying(): boolean {
    return this.music && this.player.playing;
  }

  /** Nombre d'effets / voix en cours de sortie. */
  get effectsPlaying(): number {
    this.prune();
    return this.waves.size;
  }

  /**
   * Le son `id` est-il en file ou en cours ? Effet ou voix (id < 30000) : dans la file des effets, ou une de ses lectures n'est pas finie ;
   * musique (id ≥ 30000) : dans la file des musiques, ou c'est la musique en cours. L'id 0 (« rappelle la dernière musique ») n'est jamais « en cours ».
   * Le moteur d'origine ne suit pas les ids : c'est une exactitude de plus que `effectsPlaying` / `pending`, sans rien changer à la lecture.
   */
  isPlaying(id: number): boolean {
    if (id === 0) return false;
    if (id >= MUSIC_MIN_ID) return this.musics.includes(id) || (this.musicPlaying && this.lastMusic === id);
    if (this.effects.includes(id)) return true;
    this.prune();
    for (const played of this.waves.values()) if (played === id) return true;
    return false;
  }

  /**
   * `11a0:0ee7` : met `id` dans la file de son genre (musique : id 0 ou ≥ 30000 ; sinon effets / voix). Ignoré si le drapeau du genre est
   * coupé ; file pleine : l'id est perdu (l'original affiche `Que overflow id: ` en mode de débogage).
   */
  queue(id: number): void {
    const isMusic = id === 0 || id >= MUSIC_MIN_ID;
    if (isMusic ? !this.musicOn : !this.effectsOn) return;
    const queue = isMusic ? this.musics : this.effects;
    if (queue.length >= QUEUE_SIZE) return;
    queue.push(id);
  }

  /** Nombre d'ids en attente (effets, musiques). */
  get pending(): { effects: number; musics: number } {
    return { effects: this.effects.length, musics: this.musics.length };
  }

  /** `11a8:2d3f` à chaque tick du moteur : traite les files, puis avance le séquenceur MIDI. */
  tick(): void {
    this.prune();
    this.tickEffects();
    for (const id of this.musics.splice(0)) this.playMusic(id);
    this.player.tick();
  }

  /**
   * `1028:0c0a(SND, id)` : arrête les lectures numériques de l'id `id` (celles qui jouent, pas les ids encore en file). Ne touche pas à `DS:a402` :
   * l'appelant le remet à 0 (`resetCurrentEffect`), comme `1170:4f98`.
   */
  stopSound(id: number): void {
    for (const [handle, played] of [...this.waves]) {
      if (played !== id) continue;
      this.audio.stopWave(handle);
      this.waves.delete(handle);
    }
  }

  /** `DS:a402 = 0` : plus de « voix en cours » (écrit par `1170:4f98` après `1028:0c0a`). */
  resetCurrentEffect(): void {
    this.current = 0;
  }

  /** Coupe tous les effets et voix et vide leur file (la musique continue). */
  stopEffects(): void {
    this.effects.length = 0;
    for (const handle of this.waves.keys()) this.audio.stopWave(handle);
    this.waves.clear();
  }

  /** Coupe la musique (la dernière demandée reste mémorisée pour `queue(0)`). */
  stopMusic(): void {
    this.music = false;
    this.player.stop();
  }

  /** Coupe tout et vide les deux files. */
  stopAll(): void {
    this.musics.length = 0;
    this.stopEffects();
    this.stopMusic();
  }

  // --- Lecture ---

  /** Archive qui porte l'id d'un `\0SND` (routage de `11a8:2d3f`). */
  private archiveOf(id: number): MohawkArchive | null {
    return id >= SCREEN_MIN_ID && id <= SCREEN_MAX_ID ? this.screen : this.zoombini;
  }

  /**
   * File des effets (`11a8:2d3f` avec `11a8:317c`) : parmi le son qui joue encore et les ids en file, garde celui de plus haute priorité (le plus
   * récent à égalité) ; s'il est en file, il est démarré sur l'unique canal, ce qui coupe le précédent. Les autres ids sont perdus.
   */
  private tickEffects(): void {
    if (this.effects.length === 0) return;
    const queued = this.effects.splice(0);
    let playing: number | undefined;
    for (const id of this.waves.values()) playing = id;
    let best: number | undefined = playing;
    let bestPriority = best === undefined ? -1 : this.priorityOf(best);
    let chosen: number | undefined;
    for (const id of queued) {
      const priority = this.priorityOf(id);
      if (priority >= bestPriority) {
        best = id;
        bestPriority = priority;
        chosen = id;
      }
    }
    if (chosen !== undefined) this.playEffect(chosen);
  }

  private playEffect(id: number): void {
    this.current = id;
    // ≥ 20000 : « s-sound » dans l'original, probablement lu en flux ; ici joué comme un son normal.
    const archive = this.archiveOf(id);
    const bytes = archive?.find(TAG_SND, id);
    if (!archive || !bytes || !isWave(bytes)) return;
    for (const handle of this.waves.keys()) this.audio.stopWave(handle);
    this.waves.clear();
    const handle = this.audio.playWave(loadPcm(archive, id), isLooping(archive, id));
    this.waves.set(handle, id);
  }

  private playMusic(requested: number): void {
    const id = requested === 0 ? this.lastMusic : requested;
    if (id === 0) return;
    const bytes = this.midimpc.find(TAG_TMID, id);
    if (!bytes || !isMidi(bytes)) return;
    this.lastMusic = id;
    const { song, programs } = loadSong(this.midimpc, id);
    this.music = true;
    // Boucle entre les repères `loop start` / `setup end` et `loop end` (comme Mathémagique) ; hypothèse : les musiques d'écran bouclent.
    this.player.play(song, { loop: true, programs, onEnd: () => (this.music = false) });
  }

  private prune(): void {
    for (const handle of [...this.waves.keys()]) if (!this.audio.isWavePlaying(handle)) this.waves.delete(handle);
  }
}

export const ZOOMBINIS_SOUND = defineService<ZoombinisSound>("zoombinis-sound");

// --- Sons des Zoombinis dans les scripts (`SCRS`) ---

/** Base de l'id par code de voix 0…15 (`1168:575b`) : `100 + 25 × code`, sauf les trois derniers (475, 450, 425). */
const VOICE_BASE = [100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 475, 450, 425] as const;
/** Décalage selon le type de voix 1…5 du Zoombini. */
const VOICE_TYPE_OFFSET = [0, 5, 0x14, 0x0f, 0x0a] as const;
/** Code de voix qui tire un son au hasard (1800…1814). */
export const RANDOM_VOICE_CODE = 16;
export const RANDOM_VOICE_FIRST = 1800;
export const RANDOM_VOICE_LAST = 1814;

/**
 * Id du `\0SND` d'un terminateur de `SCRS` dépendant du Zoombini (`11a8:32b2` → `1168:575b`, `engine.md` §3.7, **probable**) :
 * `base(code) + décalage(voiceType) + variant - 1`. `code` est le code de voix (`snoidVoiceCode`, 0…16), `voiceType` le type de voix
 * 1…5, `variant` la variante du Zoombini (`+0xbe`, à partir de 1). Le code 16 ignore le reste et tire `rng(14)` + 1800, `rng(n)`
 * renvoyant un entier de 0 à `n` inclus (`MsvcRandom.rand`). Renvoie `undefined` pour un code ou un type hors table.
 */
export function soundIdForSnoid(code: number, voiceType: number, variant: number, rng: (max: number) => number): number | undefined {
  if (code === RANDOM_VOICE_CODE) return RANDOM_VOICE_FIRST + rng(RANDOM_VOICE_LAST - RANDOM_VOICE_FIRST);
  const base = VOICE_BASE[code];
  const offset = VOICE_TYPE_OFFSET[voiceType - 1];
  if (base === undefined || offset === undefined) return undefined;
  return base + offset + variant - 1;
}
