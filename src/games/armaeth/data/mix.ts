import { BinaryReader } from "../../../data/reader";

/**
 * `A1FMIX.SYS` : annuaire et données de tout le son d'*Armaeth* (musiques et effets). Lu par
 * `gm_load_mix` (`3024:0002`) pour l'annuaire ; les données sont lues à la demande par
 * `gm_sound_play` (`2f33:000e`) avec `fseek` + `fread` (fichier d'indice 10 de `gm_open_data_file`).
 * Voir `docs/armaeth/audio.md`.
 *
 * Disposition (certain : lue dans le code puis vérifiée sur le fichier du jeu) :
 *
 * - 4 mots : nombre d'entrées de la table 1 (68), nombre d'enregistrements de la table 2 (55),
 *   taille du tampon des musiques (4 666 = la plus grande banque de classe `M`), taille du tampon
 *   des effets (2 122 = la plus grande banque des autres classes) ; le moteur alloue chaque tampon
 *   avec 10 octets de plus ;
 * - table 1 : 68 entrées de 8 octets (réglages d'un son, voir `MixTrack`) ;
 * - table 2 : 55 enregistrements de 42 octets (une banque de données par enregistrement, voir `MixBank`) ;
 * - les banques, contiguës, dans l'ordre de la table 2, jusqu'à la fin du fichier.
 */

/** Taille de l'en-tête (4 mots). */
export const MIX_HEADER_SIZE = 8;
/** Taille d'une entrée de la table 1. */
export const MIX_TRACK_SIZE = 8;
/** Taille d'un enregistrement de la table 2. */
export const MIX_BANK_SIZE = 42;
/** Nombre de clés d'effet d'un enregistrement de la table 2 (`gm_sound_select_track` parcourt 16 mots). */
export const MIX_EFFECT_KEYS = 16;

/** Décalage ajouté aux clés (`classe * 1000 + numéro + 0x218`, `2ffa:000a`, `2ffa:007e`, `2f9b:000e`). */
const KEY_BIAS = 0x218;

/**
 * Clé d'un son : `classe * 1000 + numéro + 0x218`, en arithmétique `int` 16 bits (le produit de la
 * lettre `M` = 77 déborde : 77 000 mod 65 536). `classe` est un caractère (`M`) ou son code ASCII.
 */
export function mixKey(cls: string | number, num: number): number {
  const code = typeof cls === "string" ? cls.charCodeAt(0) : cls;
  return (code * 1000 + num + KEY_BIAS) & 0xffff;
}

/**
 * Retrouve (classe, numéro) d'une clé parmi les lettres majuscules et les numéros 0 à 999 (hypothèse :
 * c'est la plage que le jeu utilise ; la clé est ambiguë au-delà). `undefined` si aucune ne convient.
 */
export function decodeMixKey(key: number): { cls: string; num: number } | undefined {
  for (let code = 0x41; code <= 0x5a; code++) {
    const num = (key - code * 1000 - KEY_BIAS) & 0xffff;
    if (num < 1000) return { cls: String.fromCharCode(code), num };
  }
  return undefined;
}

/**
 * Entrée de la table 1, cherchée par `2ffa:000a` à partir de la clé : réglages de lancement
 * transmis au pilote par `FUN_40f7_05a9` (commandes `0x400`, `0x2000` et `0x80`).
 */
export interface MixTrack {
  /** Clé `classe * 1000 + numéro + 0x218` (voir `mixKey`). */
  key: number;
  /** Tempo du pilote (commande `0x400`) : nombre de ticks de 50 Hz par pas de séquenceur (2 ou 3 en pratique). */
  tempo: number;
  /** Affaiblissement initial du volume (commande `0x2000`), 0 = plein, de 0 à 16 en pratique. */
  volume: number;
  /** Masque des voix du morceau à lancer (11 bits ; OPL2 et MIDI). */
  voiceMask: number;
  /** Piste jouée seule au haut-parleur (hypothèse forte : numéro dans la liste de pistes), 0xFF = aucune. */
  speakerTrack: number;
  /** Octet 7 : non lu par le moteur (remplissage non initialisé, il diffère entre langues). */
  padding: number;
}

/** Enregistrement de la table 2 : une banque de données sonores (voir `parseSongBank`). */
export interface MixBank {
  /** Mot 0 : identifiant de la banque (filtre de `2ffa:007e`, premier paramètre de `gm_sound_play`). */
  id: number;
  /** Mot 1 : clé du son principal de la banque (0 = pas de filtre). */
  key: number;
  /** Mots 2 à 17 : clés des effets sélectionnables pendant la lecture (`gm_sound_select_track`), 0 = libre. */
  effectKeys: number[];
  /** Taille de la banque en octets (mot 18). */
  size: number;
  /** Offset de la banque dans le fichier (mots 19 et 20 : u32, poids faible d'abord). */
  offset: number;
}

export interface Mix {
  /** Taille du tampon des musiques (classe `M`). */
  musicBufferSize: number;
  /** Taille du tampon des autres sons. */
  effectBufferSize: number;
  tracks: MixTrack[];
  banks: MixBank[];
  /** Fichier entier, d'où `bankData` extrait les banques. */
  data: Uint8Array;
}

/** Lit l'annuaire de `A1FMIX.SYS` et vérifie que tout tient dans le fichier. */
export function parseMix(data: Uint8Array): Mix {
  if (data.length < MIX_HEADER_SIZE) throw new Error("MIX invalide : fichier trop court");
  const r = new BinaryReader(data);
  const trackCount = r.u16();
  const bankCount = r.u16();
  const musicBufferSize = r.u16();
  const effectBufferSize = r.u16();
  const directoryEnd = MIX_HEADER_SIZE + trackCount * MIX_TRACK_SIZE + bankCount * MIX_BANK_SIZE;
  if (directoryEnd > data.length) throw new Error("MIX invalide : annuaire tronqué");

  const tracks: MixTrack[] = [];
  for (let i = 0; i < trackCount; i++) {
    tracks.push({
      key: r.u16(),
      tempo: r.u8(),
      volume: r.u8(),
      voiceMask: r.u16(),
      speakerTrack: r.u8(),
      padding: r.u8(),
    });
  }

  const banks: MixBank[] = [];
  for (let i = 0; i < bankCount; i++) {
    const id = r.u16();
    const key = r.u16();
    const effectKeys: number[] = [];
    for (let k = 0; k < MIX_EFFECT_KEYS; k++) effectKeys.push(r.u16());
    const size = r.u16();
    const offset = r.u16() + r.u16() * 0x10000;
    banks.push({ id, key, effectKeys, size, offset });
  }

  for (const bank of banks) {
    if (bank.offset < directoryEnd || bank.offset + bank.size > data.length) {
      throw new Error(`MIX invalide : banque ${bank.id} hors du fichier`);
    }
  }
  return { musicBufferSize, effectBufferSize, tracks, banks, data };
}

/** Entrée de la table 1 pour une clé (`2ffa:000a` : la première qui correspond). */
export function findTrack(mix: Mix, key: number): MixTrack | undefined {
  return mix.tracks.find((t) => t.key === key);
}

/**
 * Banque pour (identifiant, clé) comme `2ffa:007e` : premier enregistrement dont le mot 0 vaut `id`
 * et, si `key` n'est pas nul, dont le mot 1 vaut `key`. Plusieurs enregistrements peuvent partager une clé.
 */
export function findBank(mix: Mix, id: number, key = 0): MixBank | undefined {
  return mix.banks.find((b) => b.id === id && (key === 0 || b.key === key));
}

/** Octets d'une banque (à passer à `parseSongBank`). */
export function bankData(mix: Mix, bank: MixBank): Uint8Array {
  return mix.data.subarray(bank.offset, bank.offset + bank.size);
}
