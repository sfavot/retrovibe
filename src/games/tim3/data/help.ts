/**
 * Textes de l'aide du professeur (`HELP.RES`) et numéro de leur voix (`HELP.VOC`), lus comme `TIMWIN.EXE` les cherche.
 *
 * - 41e7e7 parcourt les chaînes 8001, 8002… de la table chargée depuis `HELP.RES` (41e6b7 → 453958 sous 8000) et garde la première dont
 *   l'identifiant (les cinq chiffres de tête, 452b80) est celui demandé ; sa voix est `4500 + rang` (rang = ligne du fichier, à partir de
 *   0), c'est-à-dire `voices/help/<rang>.mp3`. Vérifié sur les données : la durée des 184 voix suit la longueur du texte anglais de même
 *   rang (corrélation 0,89 ; 0,39 et 0,37 décalées d'une ligne). Le texte est la ligne sans ses sept premiers caractères (41e7bc).
 * - Cas d'origine : l'identifiant 15019 (« ? » de la guitare) prend le texte 13026 ; les identifiants 9001 à 9999 n'ont pas d'aide (41e7a6 :
 *   compteurs et horloges des duels ; la barre du but est demandée sous 9000).
 * - **Écart du port** : le `HELP.RES` français garde les identifiants de l'ancien panneau de commande (`CNTRLPNL`, 10002 à 11010) là où
 *   l'anglais a ceux de la barre d'outils Windows (`WTOOLBAR`, 35001 à 35022), et la ligne 184 (aide de la visite guidée) y est vide.
 *   Le jeu français cherche donc en vain l'aide des boutons de la barre (« Je suis désolé… »). Les deux fichiers ayant les mêmes lignes
 *   dans le même ordre (les voix sont communes), le port cherche le rang par l'identifiant anglais, puis par le français, et prend le
 *   texte français de ce rang.
 */
import { parseLines, unescapeNewlines } from "./text";

/** Premier numéro de voix de `HELP.VOC` (4247c0 : 4000 + 500 × archive). */
export const HELP_VOICE_BASE = 4500;
/** Aide de l'aide : « Salut! Professeur Tim à votre service… » (41907f → 41d8e8(0x5a3c)). */
export const HELP_INTRO = 23100;
/** « Je suis désolé mais il m'est impossible de vous informer sur ce sujet. » (41e71d, 41e76a : rien d'aidable sous le pointeur). */
export const HELP_NOTHING = 23200;
/** Barre du but (41e8e8) et bac (41e8c7) : fenêtres à part dans le jeu, aidées par un seul texte. */
export const HELP_GOAL = 9000;
export const HELP_BIN = 11014;

/** 41e7f2 : le « ? » de la guitare prend le texte de celui du choix du puzzle. */
const ALIASES: Readonly<Record<number, number>> = { 15019: 13026 };
/** 41e7a6 : identifiants sans aide. */
const NO_HELP_FIRST = 9001;
const NO_HELP_LAST = 9999;

export interface HelpEntry {
  /** Identifiant demandé (celui du contrôle). */
  id: number;
  /** Rang de la ligne dans `HELP.RES`, aussi index de la voix (`helpVoice(rank)`). */
  rank: number;
  text: string;
}

interface Line {
  id: number;
  text: string;
}

function readLines(bytes: Uint8Array | undefined): (Line | null)[] {
  if (!bytes) return [];
  return parseLines(bytes).map((line) => {
    // 452b80 lit l'identifiant en tête ; 41e7bc saute les sept premiers caractères (« 09000  »).
    const match = /^(\d+)/.exec(line);
    return match ? { id: Number(match[1]), text: unescapeNewlines(line.slice(7)).trim() } : null;
  });
}

export class HelpTable {
  private readonly lines: (Line | null)[];
  private readonly base: (Line | null)[];

  /** `bytes` : `HELP.RES` de la langue jouée ; `baseBytes` : celui des volumes de base (anglais), qui donne les identifiants Windows. */
  constructor(bytes: Uint8Array, baseBytes?: Uint8Array) {
    this.lines = readLines(bytes);
    this.base = baseBytes ? readLines(baseBytes) : this.lines;
  }

  /** Nombre de lignes (de rangs). */
  get size(): number {
    return this.lines.length;
  }

  /** Aide d'un contrôle, `null` s'il n'en a pas (41e7e7 rend 0). */
  find(control: number): HelpEntry | null {
    const id = ALIASES[control] ?? control;
    if (id >= NO_HELP_FIRST && id <= NO_HELP_LAST) return null;
    for (const table of [this.base, this.lines]) {
      const rank = table.findIndex((l) => l?.id === id);
      const text = rank >= 0 ? this.lines[rank]?.text : undefined;
      if (text) return { id: control, rank, text };
    }
    return null;
  }
}

/** `HELP.RES` de la langue jouée et sa version de base, depuis l'index des ressources. */
export function helpTable(index: { get(name: string): Uint8Array; base(name: string): { data: Uint8Array } | undefined }): HelpTable {
  return new HelpTable(index.get("HELP.RES"), index.base("HELP.RES")?.data);
}
