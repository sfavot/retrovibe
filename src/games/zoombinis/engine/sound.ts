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
 * Choix d'implémentation :
 *  - le service est pur : il ne lit que ses archives et le puits audio ; le moteur appelle `tick()` à chaque tick ;
 *  - la priorité de `11a8:317c` (compteur par place, niveaux non relevés) n'est pas documentée : les places sont jouées dans l'ordre
 *    d'arrivée (FIFO) ; pour la musique, chaque id remplace la précédente, donc la dernière de la file l'emporte ;
 *  - une ressource absente de l'archive visée est ignorée (aucune trace dans l'original relevée) ;
 *  - plusieurs effets / voix peuvent jouer en même temps ; une seule musique à la fois.
 */
import { isMidi, parseMidi } from "../../../data/mohawk/midi";
import { MohawkArchive, TAG_SND } from "../../../data/mohawk/mohawk";
import { isWave, parseWave } from "../../../data/mohawk/wave";
import { loadPcm } from "../../../engine/mohawk/audio/pcm";
import { MidiPlayer, parsePrograms, parseSysx, type ProgramEntry } from "../../../engine/mohawk/audio/sequencer";
import type { AudioSink, WaveHandle } from "../../../engine/mohawk/audio/sink";
import { parseSong, type Song } from "../../../engine/mohawk/audio/smf";
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
  private readonly waves = new Set<WaveHandle>();
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

  /** Archive de l'écran courant (ids 1000…19999) ; `null` entre deux écrans. */
  setScreenArchive(archive: SoundArchive | null): void {
    this.screen = archive ? mohawkOf(archive) : null;
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
    for (const id of this.effects.splice(0)) this.playEffect(id);
    for (const id of this.musics.splice(0)) this.playMusic(id);
    this.player.tick();
  }

  /** Coupe tous les effets et voix et vide leur file (la musique continue). */
  stopEffects(): void {
    this.effects.length = 0;
    for (const handle of this.waves) this.audio.stopWave(handle);
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

  private playEffect(id: number): void {
    // ≥ 20000 : « s-sound » dans l'original, probablement lu en flux ; ici joué comme un son normal.
    const archive = this.archiveOf(id);
    const bytes = archive?.find(TAG_SND, id);
    if (!archive || !bytes || !isWave(bytes)) return;
    const handle = this.audio.playWave(loadPcm(archive, id), isLooping(archive, id));
    this.waves.add(handle);
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
    for (const handle of this.waves) if (!this.audio.isWavePlaying(handle)) this.waves.delete(handle);
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
