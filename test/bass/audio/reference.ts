/**
 * Scénarios de référence de la musique AdLib et leur empreinte : partagés par le test (`adlib-reference.test.ts`) et par le générateur du
 * banc ScummVM (`bench/sky-music/gen.mts`, hors dépôt), pour que les deux côtés calculent exactement la même chose.
 *
 * Un scénario est un script, une commande par ligne : `load S`, `play N`, `vol V`, `stop`, `tick K`, `status`. Le journal contient une ligne
 * `tick registre valeur` par écriture OPL (tick = nombre de ticks déjà joués ; les écritures des commandes portent le numéro du prochain
 * tick) et une ligne `tick S morceau joue volume` par `status`.
 */

import { createHash } from "node:crypto";
import type { OplSink } from "../../../src/audio/opl-stream";
import { AdlibMusic } from "../../../src/games/bass/audio/adlib-music";

/** Taille de la fenêtre d'empreinte, en ticks. */
export const WINDOW = 200;
/** Durée de chaque morceau comparé, en ticks de 50 Hz (4 minutes). */
export const SONG_TICKS = 12000;
export const SONGS_PER_SECTION = [2, 4, 4, 3, 11, 6, 1];

export interface Scenario {
  readonly name: string;
  readonly script: string;
  /** Journal complet conservé dans les fixtures (les autres ne gardent que les empreintes). */
  readonly full?: boolean;
}

export function scenarios(): Scenario[] {
  const list: Scenario[] = [];
  SONGS_PER_SECTION.forEach((count, section) => {
    for (let song = 1; song <= count; song++) {
      list.push({ name: `s${section}m${song}`, script: `load ${section}\nplay ${song}\ntick ${SONG_TICKS}\nstatus`, full: section === 0 || (section === 4 && song === 5) });
    }
  });
  list.push(
    { name: "volume", script: "load 4\nplay 5\ntick 700\nvol 40\ntick 600\nvol 0\ntick 200\nvol 127\ntick 300\nvol 90\ntick 1200\nstatus", full: true },
    { name: "volume-before-song", script: "load 3\nvol 64\nplay 2\ntick 1500\nstatus" },
    { name: "switch", script: "load 4\nplay 5\ntick 900\nplay 7\ntick 800\nplay 0\ntick 100\nstatus\nplay 2\ntick 500\nplay 11\ntick 700\nstatus", full: true },
    { name: "reload-active", script: "load 1\nplay 3\ntick 500\nstatus\nload 2\nstatus\ntick 50\nplay 1\ntick 800\nload 6\nplay 1\ntick 900\nstatus" },
    { name: "same-song", script: "load 5\nplay 3\ntick 300\nplay 3\ntick 300\nplay 0\ntick 5\nplay 0\ntick 5\nstatus" },
    { name: "stop", script: "load 4\nplay 5\ntick 600\nstop\nstatus\ntick 100\nplay 5\ntick 100\nplay 4\ntick 400\nstatus" },
    { name: "start-late", script: "load 3\ntick 100\nplay 1\ntick 5\nstatus\nload 3\nplay 2\nplay 3\ntick 400\nstatus" },
  );
  return list;
}

export interface Digest {
  /** Une entrée par fenêtre de `WINDOW` ticks : `écritures cumulées:empreinte SHA-1 cumulée (12 hex)`. */
  readonly windows: string[];
  readonly lines: number;
}

/** Empreintes cumulées d'un journal, une par fenêtre ; `totalTicks` = nombre de ticks joués par le script. */
export function digest(lines: readonly string[], totalTicks: number): Digest {
  const hash = createHash("sha1");
  const windows: string[] = [];
  let w = 0;
  let count = 0;
  const snapshot = (): void => {
    windows.push(`${count}:${hash.copy().digest("hex").slice(0, 12)}`);
  };
  for (const line of lines) {
    const tick = Number(line.slice(0, line.indexOf(" ")));
    const lineWindow = Math.floor(tick / WINDOW);
    while (w < lineWindow) {
      snapshot();
      w++;
    }
    hash.update(`${line}\n`);
    count++;
  }
  const last = Math.floor(totalTicks / WINDOW);
  while (w <= last) {
    snapshot();
    w++;
  }
  return { windows, lines: lines.length };
}

/** Joue un script avec le pilote TypeScript ; rend le journal et le nombre de ticks joués. */
export function runScript(script: string, loadFile: (section: number) => Uint8Array): { lines: string[]; ticks: number } {
  const lines: string[] = [];
  let ticks = 0;
  const sink: OplSink = { write: (reg, value) => void lines.push(`${ticks} ${reg} ${value}`) };
  const music = new AdlibMusic(sink, loadFile);
  for (const raw of script.split("\n")) {
    const [command = "", arg = "0"] = raw.trim().split(/\s+/);
    const n = Number(arg);
    if (command === "load") music.loadSection(n);
    else if (command === "play") music.startMusic(n);
    else if (command === "vol") music.setVolume(n);
    else if (command === "stop") music.stopMusic();
    else if (command === "tick") {
      for (let i = 0; i < n; i++) {
        music.tick();
        ticks++;
      }
    } else if (command === "status") {
      lines.push(`${ticks} S ${music.giveCurrentMusic()} ${music.musicIsPlaying() ? 1 : 0} ${music.giveVolume()}`);
    } else if (command !== "" && !command.startsWith("#")) throw new Error(`commande inconnue : ${command}`);
  }
  return { lines, ticks };
}
