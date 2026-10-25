import {
  OPL_OPERATOR_OFFSETS,
  OPL_VOICE_OPERATORS_MELODIC,
  OPL_VOICE_OPERATORS_RHYTHM,
  oplFrequency,
} from "../data/music";

/**
 * Couche OPL2 du pilote musical embarqué dans `AM1.EXE` (code `40f7`, données `406e`) : image des 256
 * registres, chargement d'un instrument dans une voix, hauteur et volume d'une voix, touche, mode
 * rythme. Elle ne produit que des écritures `(registre, valeur)` dans un `OplSink` ; le séquenceur
 * (`sequencer.ts`) décide quoi écrire et quand. Détails et adresses : `docs/armaeth/audio.md`.
 *
 * Le pilote d'origine tient deux images : l'image de travail (`406e:03de`) que le séquenceur modifie
 * librement, et l'image déjà envoyée (`406e:04de`). `flush` (`40f7:00b0`) n'écrit que les registres
 * qui diffèrent, par numéro croissant. Seules la coupure de touche (`keyOff`) et l'initialisation
 * écrivent directement.
 */

/** Destination des écritures de registres OPL2 (ports `0x388`/`0x389` du pilote d'origine). */
export interface OplSink {
  write(reg: number, value: number): void;
  /** Facultatif : appelé au début de chaque tick de 50 Hz, avec son numéro (pour horodater les écritures). */
  beginTick?(tick: number): void;
}

/** Écriture horodatée : `tick` est le numéro du tick de 50 Hz (0 = initialisation). */
export interface OplWrite {
  tick: number;
  reg: number;
  value: number;
}

/** `OplSink` qui garde les écritures horodatées (tests, rendu hors ligne). */
export class OplRecorder implements OplSink {
  readonly writes: OplWrite[] = [];
  private tick = 0;

  beginTick(tick: number): void {
    this.tick = tick;
  }

  write(reg: number, value: number): void {
    this.writes.push({ tick: this.tick, reg, value });
  }

  /** Écritures du tick `tick`. */
  at(tick: number): OplWrite[] {
    return this.writes.filter((w) => w.tick === tick);
  }
}

/** Image de registres par défaut (`406e:05de`, 256 octets) ; `0xFF` = jamais écrit. */
export const OPL_DEFAULT_IMAGE: readonly number[] = [
  0x00, 0x20, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0x01, 0x01, 0x01, 0x0b, 0x0b, 0x0b, 0xff, 0xff, 0x01, 0x01, 0x01, 0x0b, 0x0b, 0x0b, 0xff, 0xff,
  0x00, 0x01, 0x04, 0x00, 0x0c, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0x4f, 0x4f, 0x4f, 0x00, 0x00, 0x00, 0xff, 0xff, 0x4f, 0x4f, 0x4f, 0x00, 0x00, 0x00, 0xff, 0xff,
  0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xf1, 0xf1, 0xf1, 0xf2, 0xf2, 0xf2, 0xff, 0xff, 0xf1, 0xf1, 0xf1, 0xf2, 0xf2, 0xf2, 0xff, 0xff,
  0xa8, 0xf7, 0xf7, 0xd6, 0xf8, 0xf5, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0x53, 0x53, 0x53, 0x74, 0x74, 0x74, 0xff, 0xff, 0x53, 0x53, 0x53, 0x74, 0x74, 0x74, 0xff, 0xff,
  0x4c, 0xb5, 0xb5, 0x4f, 0xb5, 0xb5, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x59, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x09, 0xff, 0xff, 0xff, 0xff, 0x20, 0xff, 0xff,
  0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];

/** Registre du mode rythme et des percussions. */
export const OPL_REG_RHYTHM = 0xbd;
/** Bit 5 de `BD` : mode rythme (11 voix). */
export const OPL_RHYTHM_MODE_BIT = 0x20;
/** Atténuation maximale (niveau total à 63). */
export const OPL_MAX_ATTENUATION = 0x3f;
/** Nombre de voix du morceau en mode mélodique ; tout autre nombre utilise la table du mode rythme (`40f7:0856`). */
export const MELODIC_VOICES = 9;
/** Nombre de voix du morceau en mode rythme : 6 mélodiques puis grosse caisse, caisse claire, tom, cymbale, charleston. */
export const RHYTHM_VOICES = 11;

/** Valeur de `[SI+2]` pour une voix muette : ni numéro F ni bloc, touche relâchée. */
export const OPL_NO_FREQUENCY = 0;

/**
 * Mot de fréquence d'une note (`406e:06e5`) : numéro F | bloc << 10. Pour les notes hors du tableau de
 * 96 entrées (jamais dans les données), le pilote lirait les octets suivants ; hypothèse (audio.md,
 * « Séquenceur : précisions ») : même formule, bloc tronqué à 3 bits au moment de l'écriture.
 */
export function noteFrequencyWord(note: number): number {
  return oplFrequency(note & 0xff);
}

export class OplDriver {
  /** Image de travail `406e:03de` (index = registre). */
  readonly working = new Uint8Array(256);
  /** Image déjà envoyée `406e:04de`. */
  readonly sent = new Uint8Array(256).fill(0xff);
  /** Nombre de voix du morceau (`[0x17]`) : choisit la table d'opérateurs. */
  voices: number = MELODIC_VOICES;

  constructor(private readonly sink: OplSink) {
    this.working.set(OPL_DEFAULT_IMAGE);
  }

  /**
   * Initialisation de la carte (`snd_start_isr` `40f7:0299`, puis `40f7:01af`) : registre `01` = `0x20`
   * (formes d'onde), `BD` = 0, image envoyée remplie de `0xFF`, image de travail = image par défaut,
   * puis écriture de tout ce qui diffère. La détection de la carte (`40f7:014d`, temporisateurs) n'est pas rejouée.
   */
  init(): void {
    this.sink.write(0x01, 0x20);
    this.sink.write(OPL_REG_RHYTHM, 0);
    this.sent.fill(0xff);
    this.working.set(OPL_DEFAULT_IMAGE);
    this.flush();
  }

  /**
   * Arrêt du pilote (`snd_stop_isr` → `40f7:0000`, branche OPL2) : image par défaut, niveaux
   * `40`..`54` à 63, `BD` à 0, puis écriture des différences.
   */
  silence(): void {
    this.working.set(OPL_DEFAULT_IMAGE);
    this.working.fill(OPL_MAX_ATTENUATION, 0x40, 0x40 + 0x15);
    this.working[OPL_REG_RHYTHM] = 0;
    this.flush();
  }

  /**
   * Bit de mode rythme de `BD` (`40f7:0333`, début de chaque commande) : posé si le morceau a 11 voix,
   * sinon retiré.
   */
  setRhythmMode(rhythm: boolean): void {
    if (rhythm) this.working[OPL_REG_RHYTHM] |= OPL_RHYTHM_MODE_BIT;
    else this.working[OPL_REG_RHYTHM] &= ~OPL_RHYTHM_MODE_BIT;
  }

  /**
   * Écrit les registres dont l'image de travail diffère de l'image envoyée (`40f7:00b0`). Le registre
   * `01` est toujours réécrit (l'octet envoyé est forcé à `0xFF`) ; le registre `FF` n'est jamais écrit
   * (le pilote sort de sa boucle quand le compteur tombe à 0).
   */
  flush(): void {
    this.sent[0x01] = 0xff;
    for (let reg = 0; reg < 0xff; reg++) {
      if (this.working[reg] !== this.sent[reg]) this.sink.write(reg, this.working[reg]);
    }
    this.sent.set(this.working);
  }

  /** Décalages (modulateur, porteuse) des opérateurs de la voix `voice` (`406e:03a3` / `03b5` / `03c7`). */
  operators(voice: number): [number, number] {
    const table = this.voices === MELODIC_VOICES ? OPL_VOICE_OPERATORS_MELODIC : OPL_VOICE_OPERATORS_RHYTHM;
    return [OPL_OPERATOR_OFFSETS[table[voice * 2]], OPL_OPERATOR_OFFSETS[table[voice * 2 + 1]]];
  }

  /**
   * Met le niveau total des deux opérateurs d'une voix à 63 et écrit (`40f7:0066`, à l'arrêt d'une voix).
   * Les bits KSL sont conservés ; la touche n'est pas relâchée ici (le prochain tick le fait).
   */
  muteVoice(voice: number): void {
    const [mod, car] = this.operators(voice);
    this.working[0x40 + mod] |= OPL_MAX_ATTENUATION;
    this.working[0x40 + car] |= OPL_MAX_ATTENUATION;
    this.flush();
  }

  /**
   * Relâche la touche d'une voix tout de suite, avant de la rallumer au flush suivant (`40f7:0b37`,
   * appelé après chaque commande d'instrument). Voix mélodique : `B0+voix` avec le bit 5 retiré de
   * l'image envoyée ; voix de percussion (mode rythme, voix 6 à 10) : `BD` avec le bit de la
   * percussion `1 << (10 - voix)` retiré. Écrit toujours, même si la touche était déjà relâchée.
   */
  keyOff(voice: number): void {
    if (this.voices !== MELODIC_VOICES && voice > 5) {
      this.sent[OPL_REG_RHYTHM] &= ~(1 << (10 - voice));
      this.sink.write(OPL_REG_RHYTHM, this.sent[OPL_REG_RHYTHM]);
    } else {
      const reg = 0xb0 + voice;
      this.sent[reg] &= 0xdf;
      this.sink.write(reg, this.sent[reg]);
    }
  }

  /**
   * Charge un instrument de 12 octets dans une voix (`40f7:082d`) : `C0+voix` (voix 0 à 8 seulement),
   * modulateur `20`/`40`/`60`/`80`/`E0`, puis porteuse (sauf voix 7 à 10 en mode rythme, qui n'ont
   * qu'un opérateur) dont seuls les bits KSL de `40` sont pris à l'instrument. Les octets hors de
   * `data` valent 0. Retourne `undefined` pour les voix 9 et 10 (le pilote ne touche alors pas à
   * l'indicateur de la voix) ; sinon `true` si la connexion est FM (le volume n'agit que sur la
   * porteuse), `false` si elle est additive (octet 1, bit 0).
   */
  loadInstrument(voice: number, data: Uint8Array, offset: number): boolean | undefined {
    const b = (i: number): number => data[offset + i] ?? 0;
    let fm: boolean | undefined;
    if (voice <= 8) {
      fm = (b(1) & 1) === 0;
      this.working[0xc0 + voice] = b(1);
    }
    const [mod, car] = this.operators(voice);
    this.working[0x20 + mod] = b(2);
    this.working[0x40 + mod] = b(3);
    this.working[0x60 + mod] = b(4);
    this.working[0x80 + mod] = b(5);
    this.working[0xe0 + mod] = b(6);
    if (this.voices !== MELODIC_VOICES && voice > 6) return fm;
    this.working[0x20 + car] = b(7);
    this.working[0x40 + car] = (this.working[0x40 + car] & 0x3f) | (b(8) & 0xc0);
    this.working[0x60 + car] = b(9);
    this.working[0x80 + car] = b(10);
    this.working[0xe0 + car] = b(11);
    return fm;
  }

  /**
   * Sortie d'une voix à la fin de son traitement (`40f7:0d6b`..`0e0f`) : `A0`/`B0` de la hauteur,
   * bit de percussion de `BD`, niveaux.
   *
   * - `level` : atténuation 0 à 63 écrite dans le niveau de la porteuse (et du modulateur si
   *   `modulatorToo`, c'est-à-dire connexion additive).
   * - `frequency` : numéro F | bloc << 10, ou 0 = voix muette (`A0`/`B0` à 0 : touche relâchée).
   *
   * Voix mélodique : le bit 5 de `B0` (touche) est posé si la fréquence n'est pas nulle. Voix 6 en
   * mode rythme (grosse caisse) : hauteur sans bit de touche. Voix 7 à 10 : aucune hauteur écrite
   * (`A7`/`B7`/`A8`/`B8` viennent de l'image par défaut). Percussions : le bit de `BD` est posé quand
   * la voix sonne et n'est jamais retiré ici (voir `keyOff`).
   */
  setVoiceOutput(voice: number, level: number, frequency: number, modulatorToo: boolean): void {
    if (this.voices === MELODIC_VOICES || voice <= 5) {
      this.working[0xa0 + voice] = frequency & 0xff;
      this.working[0xb0 + voice] = ((frequency >> 8) & 0xff) | (frequency !== 0 ? 0x20 : 0);
    } else {
      let word = frequency;
      if (voice <= 6) {
        word = frequency & 0x1fff;
        this.working[0xa0 + voice] = word & 0xff;
        this.working[0xb0 + voice] = word >> 8;
      }
      if (word !== 0) this.working[OPL_REG_RHYTHM] |= 1 << (10 - voice);
    }
    const [mod, car] = this.operators(voice);
    if (modulatorToo) this.working[0x40 + mod] = (this.working[0x40 + mod] & 0xc0) | (level & 0xff);
    this.working[0x40 + car] = (this.working[0x40 + car] & 0xc0) | (level & 0xff);
  }
}
