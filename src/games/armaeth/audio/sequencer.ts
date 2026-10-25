import { findBank, findTrack, mixKey, type Mix, type MixBank, bankData } from "../data/mix";
import { EFFECT_ENTRY_SIZE, EFFECT_SLOTS, INSTRUMENT_SIZE, NOTE_DURATIONS, TRACK_SLOTS } from "../data/music";
import { MELODIC_VOICES, OPL_MAX_ATTENUATION, OplDriver, RHYTHM_VOICES, noteFrequencyWord, type OplSink } from "./opl-driver";

/**
 * Séquenceur musical d'*Armaeth* : reproduit, sur la sortie AdLib / OPL2, le pilote embarqué dans
 * `AM1.EXE` (code `40f7`, données `406e`). Il est pur (aucune API Web Audio) : il produit des écritures
 * de registres OPL2 (`OplSink`) à raison d'un appel de `tick()` par IRQ0, soit 50 Hz.
 *
 * Deux couches, comme dans le jeu :
 *
 * - `SongDriver` : le pilote (`40f7`). Un morceau chargé, des voix de musique et leurs voix d'effet
 *   jumelles, des commandes (`command`, `startEffect`) et l'interruption (`tick`, `40f7:0cf8`).
 * - `Sequencer` : le moteur son (`2f33`/`2f9b`). Choisit la banque dans `A1FMIX.SYS`
 *   (`gm_sound_play`), lance un effet de la banque courante avec priorité (`gm_sound_select_track`),
 *   arrête, coupe.
 *
 * Les adresses citées sont celles de la rétro-ingénierie (`docs/armaeth/re-index.md`), le détail du
 * comportement est dans `docs/armaeth/audio.md`. Les points non confirmés par le code sont marqués
 * « hypothèse ».
 */

/** Indicateurs d'une voix (`[voix+0x16]`). */
export const VOICE_START = 0x01;
/** Sur une voix de musique : un effet joue sur sa voix jumelle. */
export const VOICE_EFFECT = 0x02;
export const VOICE_LOOP = 0x20;
export const VOICE_STOPPED = 0x40;
const VOICE_FADE_STOP = 0x200;
const VOICE_FADE_IN = 0x100;

/** Commandes globales du pilote (table `406e:0038`, `05a9`) : le drapeau doit être égal à la valeur. */
export const CMD_GET_TEMPO = 0x08;
export const CMD_TEMPO = 0x400;
export const CMD_MASTER_VOLUME = 0x800;
export const CMD_FADE_SPEED = 0x1000;
/** Drapeaux par voix (masque de 11 bits). */
export const CMD_STOP = 0x40;
export const CMD_START = 0x80;
export const CMD_LOOP = 0x20;
export const CMD_FADE_IN = 0x100;
export const CMD_FADE_OUT = 0x200;
export const CMD_SET_VOLUME = 0x2000;
export const CMD_SET_TARGET = 0x8000;
/** Démarrage d'un effet : ne pas préempter une voix qui joue déjà un effet (`1424`, inutilisé par le jeu). */
export const CMD_KEEP_EFFECT = 0x4000;

/** Au plus 4 voix de musique portent un effet (`40f7:1424` boucle 4 fois). */
const EFFECT_VOICES = 4;
/** Garde-fou : nombre maximal d'octets de motif lus par voix et par tick (le pilote d'origine bouclerait à l'infini). */
const MAX_EVENTS_PER_TICK = 100_000;
const EMPTY = new Uint8Array(0);

/** Une voix (enregistrement de 0x36 octets à `406e:0077 + 0x36 * k`, ou voix d'effet à `406e:02c9 + 0x36 * k`). */
class Voice {
  /** Voix de musique (elle-même) pour qui lit le cache d'instrument ; pour une voix d'effet, sa voix de musique (`[+4]`). */
  owner: Voice = this;
  /** Voix d'effet jumelle d'une voix de musique (`[+0xe]`). */
  twin: Voice | null = null;
  /** Octets où lire la liste de motifs : la banque (musique) ou une liste de un motif (effet, `[+0x21]`). */
  list: Uint8Array = EMPTY;
  /** `[+0]` début de la liste ; `[+8]` position courante. */
  listStart = 0;
  listPos = 0;
  /** `[+6]` position courante dans le motif (dans la banque). */
  patternPos = 0;
  /** `[+0x10]` mot de fréquence de la note courante. */
  frequency = 0;
  /** `[+0x14]` nombre de motifs lus. */
  patternCount = 0;
  /** `[+0x16]` indicateurs. */
  flags = VOICE_STOPPED;
  /** `[+0x18]` instrument chargé (0xFF = aucun) ; lu sur `owner`. */
  instrument = 0xff;
  /** `[+0x1a]` pas restants de la note (mot) ; `[+0x1c]` durée courante. */
  delay = 0;
  duration = 0;
  /** `[+0x1e]` transposition. */
  transpose = 0;
  /** `[+0x1f]` volume courant (atténuation), `[+0x20]` compteur de fondu, `[+0x23]` volume cible. */
  volume = 0;
  fadeCount = 0;
  target = 0;
  /** `[+0x24]` : 1 = connexion FM (le volume ne touche que la porteuse). */
  fm = 0;
  /** `[+0x25]` atténuation ajoutée par les commandes `C0`-`DF` : `2v + 1`. */
  attenuation = 0;
}

/**
 * Pilote de morceau (`40f7`) : voix, commandes, interruption. Un seul morceau est chargé à la fois,
 * comme dans le jeu (un morceau d'effet de classe `E` remplace la musique en cours).
 */
export class SongDriver {
  readonly opl: OplDriver;
  /** Numéro du dernier tick (0 avant le premier `tick()`) ; sert d'horodatage aux écritures. */
  ticks = 0;
  /** Nombre de voix du morceau chargé (`[0x17]`) : 9 ou 11. */
  voiceCount = MELODIC_VOICES;
  /** Tempo (`[0x52+0x10]`) : ticks par pas. */
  tempo = 0;
  /** Volume maître (`[0x52+0x11]`) : atténuation minimale de toute voix, 0 à 63. */
  masterVolume = 0;
  /** Vitesse des fondus (`[0x52+0x12]`) : un cran de volume tous les `fadeSpeed + 1` ticks. */
  fadeSpeed = 8;
  /** Tempo des voix d'effet (`[0x52+0x1c]`), changé par `E2`. */
  effectTempo = 0;
  readonly music: Voice[] = Array.from({ length: TRACK_SLOTS }, () => new Voice());
  readonly effects: Voice[] = Array.from({ length: TRACK_SLOTS }, () => new Voice());

  private bank: Uint8Array = EMPTY;
  private base = 0;
  private patternTable = 0;
  private instrumentTable = 0;
  private effectTable = -1;
  /** `[0x52+0xf]` et `[0x52+0x1b]` : comptes à rebours du pas des voix de musique et d'effet. */
  private stepCount = 0;
  private effectStepCount = 0;
  /** `[0x52+0xe]` à 0 : le prochain tick est sauté puis remis à 1 (après un chargement sans démarrage). */
  private skipTick = false;
  /** `[0x6de]` : une commande d'instrument a été lue pendant ce traitement de voix. */
  private instrumentChanged = false;
  /** `[SI]` et `[SI+2]` : atténuation et mot de fréquence calculés pour la voix en cours. */
  private level = OPL_MAX_ATTENUATION;
  private frequency = 0;

  constructor(private readonly sink: OplSink) {
    this.opl = new OplDriver(sink);
    for (let k = 0; k < TRACK_SLOTS; k++) {
      const m = this.music[k];
      const e = this.effects[k];
      m.twin = e;
      e.owner = m;
    }
  }

  /** Initialise la carte (voir `OplDriver.init`). */
  init(): void {
    this.opl.init();
  }

  /** Arrête le pilote (voir `OplDriver.silence`). */
  shutdown(): void {
    this.opl.silence();
  }

  // ---- chargement et commandes ----

  /**
   * Charge un morceau (`40f7:05d9`, `070b`) : lit l'en-tête du sous-morceau `songIndex` de la banque, prépare
   * chaque voix (arrêtée, aucun instrument, volume 0, liste de motifs de la piste) et fixe le tempo
   * initial. Le prochain tick est sauté tant qu'aucune commande de démarrage n'arrive.
   */
  loadSong(bank: Uint8Array, songIndex = 0): void {
    this.bank = bank;
    this.base = this.u16(songIndex * 2);
    const base = this.base;
    this.skipTick = true;
    this.tempo = this.bank[base] ?? 0;
    this.stepCount = this.tempo;
    this.effectTempo = this.tempo;
    this.effectStepCount = this.tempo;
    this.voiceCount = Math.min(this.u16(base + 2) & 0xff, TRACK_SLOTS);
    this.opl.voices = this.voiceCount;
    this.patternTable = base + 0x22;
    this.instrumentTable = base + this.u16(base + 10);
    const effects = this.u16(base + 6);
    this.effectTable = effects === 0 ? -1 : base + effects;
    for (let k = 0; k < this.voiceCount; k++) {
      const v = this.music[k];
      v.list = bank;
      v.listStart = base + this.u16(base + 12 + 2 * k);
      v.flags = VOICE_STOPPED;
      v.instrument = 0xff;
      v.volume = 0;
      v.target = 0;
    }
  }

  /**
   * Commande du pilote (`40f7:05a9` → `0333`). Les commandes globales (`CMD_TEMPO`, `CMD_MASTER_VOLUME`,
   * `CMD_FADE_SPEED`, `CMD_GET_TEMPO`) sont reconnues si `flags` leur est égal ; sinon `flags` est une combinaison
   * de drapeaux appliqués à chaque voix du `mask` (11 bits ; 0 = toutes). Retourne le tempo pour `CMD_GET_TEMPO`.
   */
  command(value: number, flags: number, mask: number): number {
    this.opl.setRhythmMode(this.voiceCount === RHYTHM_VOICES);
    switch (flags) {
      case CMD_GET_TEMPO:
        return this.tempo;
      case CMD_TEMPO:
        this.tempo = value & 0xff;
        this.stepCount = value & 0xff;
        return 0;
      case CMD_MASTER_VOLUME:
        this.masterVolume = value & 0xff;
        return 0;
      case CMD_FADE_SPEED:
        this.fadeSpeed = value & 0xff;
        return 0;
    }
    let voices = mask & 0x7ff;
    if (voices === 0) voices = 0x7ff;
    let dl = value & 0xff;
    for (let k = 0; k < this.voiceCount; k++) {
      if (((voices >> k) & 1) === 0) continue;
      const v = this.music[k];
      v.instrument = 0xff;
      if (flags & CMD_SET_TARGET) {
        dl &= 0x3f;
        v.target = dl;
      }
      if (flags & CMD_SET_VOLUME) {
        v.volume = dl;
        v.target = dl;
      }
      if (flags & CMD_FADE_IN) {
        v.volume = OPL_MAX_ATTENUATION;
        v.target = this.masterVolume;
      }
      if (flags & CMD_FADE_OUT) v.target = OPL_MAX_ATTENUATION;
      if (flags & CMD_STOP) {
        v.flags |= VOICE_STOPPED;
        this.opl.muteVoice(k);
      }
      if (flags & CMD_START) {
        v.flags = CMD_START | VOICE_START;
        this.skipTick = false;
      }
      if (flags & CMD_LOOP) v.flags |= VOICE_LOOP;
    }
    return 0;
  }

  /**
   * Lance un effet de la table d'effets du morceau (`snd_start_track` `40f7:156b`, `1546`, `1424`). Chaque
   * octet de l'entrée `index` (jusqu'à `0xFF`) est un motif joué sur une voix d'effet : le premier sur la voix
   * de `mask` (un seul bit en pratique, 1), le suivant sur la voix suivante, etc. Le masque est limité aux
   * 4 premières voix ; un masque nul une fois tronqué à 4 bits vaut « les quatre » (le 5e motif d'un effet
   * joue donc sur les voix 0 à 3). `flags` et `value` comme `command` (`CMD_SET_VOLUME | CMD_START`,
   * volume). Chaque appel invalide le cache d'instrument des quatre voix de musique.
   */
  startEffect(index: number, mask: number, flags: number, value: number): void {
    if (index >= EFFECT_SLOTS || this.effectTable < 0) return;
    let voices = mask;
    for (let i = 0; ; i++) {
      const pattern = this.byte(this.effectTable + index * EFFECT_ENTRY_SIZE + i);
      if (pattern === 0xff) break;
      this.startEffectPattern(pattern, voices, flags, value);
      voices = (voices << 1) & 0xffff;
    }
  }

  private startEffectPattern(pattern: number, mask: number, flags: number, value: number): void {
    let voices = mask & 0xf;
    if (voices === 0) voices = 0xf;
    const dl = value & 0xff;
    for (let k = 0; k < EFFECT_VOICES; k++) {
      const m = this.music[k];
      m.instrument = 0xff;
      if (((voices >> k) & 1) === 0) continue;
      const e = this.effects[k];
      if (flags & CMD_SET_TARGET) e.target = dl;
      if (flags & CMD_SET_VOLUME) {
        e.volume = dl;
        e.target = dl;
      }
      if (flags & CMD_FADE_IN) {
        e.volume = 0;
        e.target = 0; // hypothèse : [voix+0x11] d'une voix d'effet n'est jamais écrit (0)
      }
      if (flags & CMD_FADE_OUT) e.flags |= VOICE_FADE_STOP;
      if (flags & CMD_STOP) {
        e.flags = VOICE_STOPPED;
        m.instrument = 0xff;
        m.flags &= ~VOICE_EFFECT;
        if (m.flags & VOICE_STOPPED) this.opl.muteVoice(k);
      }
      if (flags & CMD_START && !(flags & CMD_KEEP_EFFECT && m.flags & VOICE_EFFECT)) {
        e.list = Uint8Array.of(pattern, 0xff);
        e.listStart = 0;
        e.flags = (e.flags & ~(VOICE_LOOP | VOICE_STOPPED)) | CMD_START | VOICE_EFFECT | VOICE_START;
        m.flags |= VOICE_EFFECT;
        this.skipTick = false;
      }
      if (flags & CMD_LOOP) e.flags |= VOICE_LOOP;
    }
  }

  /** Vrai si une voix de musique du morceau n'est pas arrêtée (musique en cours). */
  isMusicActive(): boolean {
    for (let k = 0; k < this.voiceCount; k++) if (!(this.music[k].flags & VOICE_STOPPED)) return true;
    return false;
  }

  /** Vrai si un effet joue sur la voix `k` (ou sur une voix quelconque sans argument). */
  isEffectActive(k?: number): boolean {
    if (k !== undefined) return (this.music[k].flags & VOICE_EFFECT) !== 0;
    for (let i = 0; i < this.voiceCount; i++) if (this.music[i].flags & VOICE_EFFECT) return true;
    return false;
  }

  // ---- interruption ----

  /** Un tick de 50 Hz (`snd_isr_opl` `40f7:0cf8`) : traite chaque voix puis écrit les registres modifiés. */
  tick(): void {
    this.ticks++;
    this.sink.beginTick?.(this.ticks);
    if (this.skipTick) {
      this.skipTick = false;
      return;
    }
    this.stepCount = (this.stepCount - 1) & 0xff;
    this.effectStepCount = (this.effectStepCount - 1) & 0xff;
    for (let k = 0; k < this.voiceCount; k++) {
      this.level = OPL_MAX_ATTENUATION;
      this.frequency = 0;
      const m = this.music[k];
      this.stepVoice(m, k, this.stepCount);
      let active = m;
      if (m.flags & VOICE_EFFECT) {
        active = m.twin as Voice;
        this.level = OPL_MAX_ATTENUATION;
        this.frequency = 0;
        this.stepVoice(active, k, this.effectStepCount);
      }
      if (this.instrumentChanged) this.opl.keyOff(k);
      this.opl.setVoiceOutput(k, this.level, this.frequency, active.fm !== 1);
    }
    if (this.stepCount === 0) this.stepCount = this.tempo;
    if (this.effectStepCount === 0) this.effectStepCount = this.effectTempo;
    this.opl.flush();
  }

  /**
   * Traitement d'une voix pendant un tick (`40f7:096a`/`0978` pour la musique, `0919` pour un effet) :
   * fondu de volume, démarrage, décompte de la note, lecture des motifs jusqu'à la prochaine note, puis
   * calcul du niveau et de la fréquence de sortie. `stepNow` vaut 0 au tick où le décompte du pas arrive à 0.
   */
  private stepVoice(v: Voice, k: number, stepNow: number): void {
    this.instrumentChanged = false;
    if (v.flags & VOICE_STOPPED) return;

    if (v.target !== v.volume) {
      v.fadeCount++;
      if (v.fadeCount > this.fadeSpeed) {
        v.fadeCount = 0;
        if (v.target > v.volume) v.volume++;
        else v.volume--;
      }
    }

    if (v.flags & VOICE_START) {
      // 0a15 : la liste repart du début, sans toucher au décompte de la note (le motif commence par une durée)
      v.flags &= ~VOICE_START;
      v.listPos = v.listStart;
      v.patternCount = 0;
      if (!this.nextPattern(v)) return;
    } else {
      if (stepNow === 0) v.delay = (v.delay - 1) & 0xffff;
      if (v.delay !== 0) {
        this.output(v);
        return;
      }
      v.delay = v.duration;
    }

    for (let guard = 0; guard < MAX_EVENTS_PER_TICK; guard++) {
      const code = this.byte(v.patternPos++, 0xff);
      if (code === 0xff) {
        if (!this.nextPattern(v)) return;
        continue;
      }
      if (code < 0x80) {
        // note : 0 reste 0 (silence), sinon + transposition sur 8 bits (0a60)
        const note = code === 0 ? 0 : (code + v.transpose) & 0xff;
        v.frequency = noteFrequencyWord(note);
        this.output(v);
        return;
      }
      if (code === 0xe3) {
        this.loadInstrument(v, k, this.byte(v.patternPos++) & 0x7f);
      } else if (code & 0x40) {
        if (!(code & 0x20)) {
          v.attenuation = (code & 0x1f) * 2 + 1; // 0ae3
        } else {
          switch (code & 3) {
            case 0: // E0 : transposition (072c)
              v.transpose = this.byte(v.patternPos++);
              break;
            case 1: // E1 : enveloppe de hauteur (074d). hypothèse (audio.md) : toujours neutre dans les données, ignorée
              v.patternPos++;
              break;
            case 2: // E2 : tempo des voix d'effet (073b)
              this.effectTempo = this.byte(v.patternPos++);
              this.effectStepCount = this.effectTempo;
              break;
          }
        }
      } else if (code & 0x20) {
        this.loadInstrument(v, k, code & 0x1f);
      } else {
        v.duration = NOTE_DURATIONS[code & 0xf]; // 0acb
        v.delay = v.duration;
      }
    }
    v.flags |= VOICE_STOPPED; // motif sans note ni durée : le pilote d'origine bouclerait sans fin
  }

  /** Commande d'instrument (`0ab5`) : recharge si l'instrument change, et demande la coupure de touche. */
  private loadInstrument(v: Voice, k: number, index: number): void {
    const owner = v.owner;
    if (index !== owner.instrument) {
      owner.instrument = index;
      const fm = this.opl.loadInstrument(k, this.bank, this.instrumentTable + index * INSTRUMENT_SIZE);
      if (fm !== undefined) v.fm = fm ? 1 : 0;
    }
    this.instrumentChanged = true;
  }

  /**
   * Passe au motif suivant de la liste (`40f7:09d4`). Fin de liste : la piste reboucle si elle est en
   * boucle, sinon elle s'arrête (et rend la voix à la musique si c'est un effet). Retourne faux dans ce
   * dernier cas (la voix ne produit alors aucune sortie).
   */
  private nextPattern(v: Voice): boolean {
    const index = v.list[v.listPos] ?? 0xff;
    v.listPos++;
    if (index !== 0xff) {
      v.patternCount++;
      v.patternPos = this.base + this.u16(this.patternTable + index * 2);
      return true;
    }
    // une liste vide en boucle ferait boucler le pilote d'origine : on l'arrête
    if (v.flags & VOICE_LOOP && (v.list[v.listStart] ?? 0xff) !== 0xff) {
      v.listPos = v.listStart;
      v.patternCount = 0;
      return this.nextPattern(v);
    }
    const owner = v.owner;
    if (owner.flags & VOICE_EFFECT) {
      owner.instrument = 0xff;
      if (v.flags & VOICE_FADE_STOP) {
        owner.flags |= VOICE_FADE_IN;
        owner.volume = OPL_MAX_ATTENUATION;
      }
    }
    owner.flags &= ~VOICE_EFFECT;
    v.flags |= VOICE_STOPPED;
    this.level = OPL_MAX_ATTENUATION;
    return false;
  }

  /**
   * Niveau et fréquence de sortie de la voix (`40f7:0b00`) : atténuation = max(volume de la voix, volume
   * maître) + atténuation des commandes `C0`-`DF`, plafonnée à 63 ; fréquence = numéro F | bloc, ou 0
   * (silence) pour la note 0. L'enveloppe de hauteur est ignorée (voir `E1`).
   */
  private output(v: Voice): void {
    let level = v.volume;
    if (level < this.masterVolume) level = this.masterVolume;
    level += v.attenuation;
    this.level = level > OPL_MAX_ATTENUATION ? OPL_MAX_ATTENUATION : level;
    if (v.frequency === noteFrequencyWord(0)) return;
    this.frequency = v.frequency & 0x1fff;
  }

  private byte(pos: number, fallback = 0): number {
    return pos >= 0 && pos < this.bank.length ? this.bank[pos] : fallback;
  }

  private u16(pos: number): number {
    return this.byte(pos) | (this.byte(pos + 1) << 8);
  }
}

// ---- moteur son ----

/** Options de `Sequencer.play` (paramètres de `gm_sound_play`, `2f33:000e`). */
export interface PlayOptions {
  /** Musique bouclée (avant-dernier paramètre ; le jeu boucle les musiques de salle). */
  loop?: boolean;
  /** Fondu entrant (bit 1 des drapeaux). */
  fadeIn?: boolean;
  /** Fondu sortant de la musique précédente (bit 0 des drapeaux) : sans effet audible, le chargement remplace tout. */
  fadeOut?: boolean;
  /** Si faux et que ce son joue déjà, ne rien faire (`force` = 0). Vrai par défaut. */
  force?: boolean;
}

/** Résultat de `selectTrack` (`gm_sound_select_track`) : 0 introuvable ou son coupé, 1 refusé (priorité), 2 lancé. */
export type SelectResult = 0 | 1 | 2;

interface CurrentSound {
  id: number;
  cls: string;
  num: number;
  bank: MixBank;
  loop: boolean;
  /** `bank[0xf]` : vrai de la commande de démarrage jusqu'à l'arrêt. */
  playing: boolean;
}

interface EffectRequest {
  index: number;
  cls: string;
  num: number;
  priority: number;
  loop: boolean;
}

const classChar = (cls: string | number): string => (typeof cls === "number" ? String.fromCharCode(cls) : cls);

/**
 * Moteur son (`gm_sound_play`, `gm_sound_select_track`, `gm_sound_stop`, coupure) au-dessus de `SongDriver`.
 * `tick()` s'appelle à 50 Hz. Le constructeur initialise la carte (écritures de tick 0).
 */
export class Sequencer {
  readonly driver: SongDriver;
  private current: CurrentSound | null = null;
  /** Dernier effet demandé (`52d4`..`52dc`) : sa priorité reste en vigueur jusqu'à `stopEffect` ou un nouveau morceau. */
  private effect: EffectRequest | null = null;
  /** Effet bouclé mis de côté par un nouvel effet (`52e2`..`52e8`), relancé par `stopEffect`. */
  private saved: EffectRequest | null = null;
  private muted = false;

  constructor(
    private readonly mix: Mix,
    sink: OplSink,
  ) {
    this.driver = new SongDriver(sink);
    this.driver.init();
  }

  /** Appeler 50 fois par seconde. */
  tick(): void {
    this.driver.tick();
  }

  /** Volume maître (`2fec:0027`, commande `0x800`) : atténuation minimale 0 à 63, 0 = plein volume (hypothèse : valeur initiale du jeu). */
  setMasterVolume(volume: number): void {
    this.driver.command(Math.max(0, Math.min(OPL_MAX_ATTENUATION, volume)), CMD_MASTER_VOLUME, 0);
  }

  /**
   * Lance une musique ou un jingle (`gm_sound_play(id, classe, numéro, boucle, drapeaux, force)`). Charge la banque
   * (`findBank(id, clé)`), le tempo, le volume et le masque de voix viennent de la table 1 (`findTrack(clé)`).
   * Remplace la musique en cours et l'effet en cours. Retourne faux si la banque ou l'entrée de la table 1 est introuvable,
   * ou si `force` est faux et que ce son joue déjà.
   */
  play(id: number, cls: string | number, num: number, options: PlayOptions = {}): boolean {
    const c = classChar(cls);
    const key = mixKey(c, num);
    const track = findTrack(this.mix, key);
    const bank = findBank(this.mix, id, num !== 0 ? key : 0);
    if (!track || !bank) return false;
    const cur = this.current;
    if (options.force === false && cur?.playing && cur.id === id && cur.cls === c && cur.num === num) return false;

    this.stop(options.fadeOut === true);
    this.endEffect();
    this.saved = null;

    this.current = { id, cls: c, num, bank, loop: options.loop === true, playing: false };
    this.driver.loadSong(bankData(this.mix, bank));
    if (!this.muted) {
      this.driver.command(track.tempo, CMD_TEMPO, track.voiceMask);
      this.driver.command(track.volume, CMD_SET_VOLUME, track.voiceMask);
      let flags = CMD_START;
      if (options.loop) flags |= CMD_LOOP;
      if (options.fadeIn) flags |= CMD_FADE_IN;
      this.driver.command(0, flags, track.voiceMask);
      this.current.playing = true;
    }
    return true;
  }

  /**
   * Lance un effet de la banque courante (`gm_sound_select_track(classe, numéro, priorité, boucle)`).
   * L'effet est cherché parmi les 16 clés d'effet de la banque. Retourne 0 si rien n'est chargé, si
   * le son est coupé ou si la clé est absente, 1 si un effet de priorité supérieure a été demandé
   * (sa priorité reste en vigueur même après sa fin : `stopEffect` la libère), 2 si l'effet est lancé
   * ou déjà identique. Un effet bouclé en cours est mis de côté et reprendra à `stopEffect`.
   */
  selectTrack(cls: string | number, num: number, priority: number, loop = false): SelectResult {
    const cur = this.current;
    if (!cur) return 0;
    const c = classChar(cls);
    const e = this.effect;
    if (e && e.cls === c && e.num === num && e.priority === priority && e.loop === loop) return 2;
    if (priority < (e?.priority ?? 0)) return 1;
    const key = mixKey(c, num);
    const index = cur.bank.effectKeys.indexOf(key);
    if (index < 0) return 0;
    if (e?.loop) this.saved = { ...e };
    this.endEffect();
    this.effect = { index, cls: c, num, priority, loop };
    if (!this.muted) {
      const volume = findTrack(this.mix, key)?.volume ?? 0; // hypothèse : sans entrée en table 1, volume 0
      this.driver.startEffect(index, 1, CMD_SET_VOLUME | CMD_START | (loop ? CMD_LOOP : 0), volume);
    }
    return 2;
  }

  /**
   * Arrête l'effet en cours s'il est `(classe, numéro)` (ou sans argument : quel qu'il soit), puis relance
   * l'effet bouclé mis de côté (`2f9b:0375`).
   */
  stopEffect(cls?: string | number, num?: number): void {
    const e = this.effect;
    if (cls !== undefined && !(e && e.cls === classChar(cls) && e.num === num)) return;
    this.endEffect();
    const saved = this.saved;
    this.saved = null;
    if (saved) this.selectTrack(saved.cls, saved.num, saved.priority, saved.loop);
  }

  /** Arrête la musique (`gm_sound_stop`) : tout de suite, ou par un fondu sortant qui laisse les voix muettes mais actives. */
  stop(fade = false): void {
    const cur = this.current;
    if (cur?.playing) this.driver.command(0, fade ? CMD_FADE_OUT : CMD_STOP, 0);
    if (cur) cur.playing = false;
  }

  /** Arrête la musique et l'effet, et oublie l'effet mis de côté (`2fe0:0099`). */
  stopAll(): void {
    this.stop();
    this.endEffect();
    this.saved = null;
  }

  /**
   * Coupe ou rétablit le son (`2fe0:0026`) : couper arrête tout ; rétablir relance la musique
   * chargée depuis le début (`2f86:0008`). Tant que c'est coupé, `play` charge sans démarrer et `selectTrack`
   * retient la demande sans la jouer.
   */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) {
      this.stopAll();
      return;
    }
    const cur = this.current;
    if (cur) this.play(cur.id, cur.cls, cur.num, { loop: cur.loop });
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Musique en cours (une voix au moins n'est pas arrêtée). */
  isMusicPlaying(): boolean {
    return this.driver.isMusicActive();
  }

  /** Un effet joue sur une voix. */
  isEffectPlaying(): boolean {
    return this.driver.isEffectActive();
  }

  /** `2f9b:026c` sans filtre : arrête l'effet demandé en dernier et libère sa priorité. */
  private endEffect(): void {
    const e = this.effect;
    if (e && this.current && !this.muted) this.driver.startEffect(e.index, 1, CMD_STOP, 0);
    this.effect = null;
  }
}
