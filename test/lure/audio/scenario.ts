import { parseSong } from "../../../src/audio/smf";
import { AdlibMultisourceDriver, type OplInstrument } from "../../../src/games/lure/audio/adlib-multisource";
import { LureAdlibDriver } from "../../../src/games/lure/audio/lure-adlib";
import { SmfPlayer, type SmfPlayback } from "../../../src/games/lure/audio/smf-player";

/** Une écriture de registre OPL datée par tick de 4 ms. */
export interface RegisterWrite {
  tick: number;
  reg: number;
  value: number;
}

/** Enregistreur d'écritures OPL2 : `beginTick` date les suivantes. */
export class RecordingSink {
  readonly writes: RegisterWrite[] = [];
  private tick = 0;
  beginTick(tick: number): void {
    this.tick = tick;
  }
  write(reg: number, value: number): void {
    this.writes.push({ tick: this.tick, reg, value });
  }
  /** Format du harnais de référence de ScummVM : `tick registre valeur` par ligne. */
  toLines(): string[] {
    return this.writes.map((w) => `${w.tick} ${w.reg} ${w.value}`);
  }
}

const hex = (text: string): number[] =>
  text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => parseInt(t, 16));

/**
 * Rejoue un scénario du harnais de référence (le vrai pilote de ScummVM compilé hors dépôt, qui journalise `tick registre valeur`) :
 *   `<tick> play <source> <nom> <boucle>` | `<tick> stop <source>` | `<tick> raw <source> <octets hex>` | `<tick> meta <source> <type hex> <octets hex>`
 *   | `<tick> stopall` | `end <tick>` ; `driver lure|generic|generic-static` en tête ; `bank <programme> <30 octets hex>` pour le pilote générique.
 * À chaque tick : les ordres du tick, puis la minuterie de chaque morceau (dans l'ordre où ils ont été lancés).
 */
export function runScenario(text: string, files: Record<string, Uint8Array>): RecordingSink {
  const sink = new RecordingSink();
  const commands: { tick: number; words: string[] }[] = [];
  let end = 0;
  let autoExtra = -1;
  let generic = false;
  let staticMode = false;
  const bank: OplInstrument[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const words = line.split(/\s+/);
    if (words[0] === "end") {
      if (words[1] === "auto") {
        autoExtra = Number(words[2]);
        end = 100_000_000;
      } else end = Number(words[1]);
    }
    else if (words[0] === "driver") {
      generic = words[1] !== "lure";
      staticMode = words[1] === "generic-static";
    }
    else if (words[0] === "bank") bank[Number(words[1])] = bnkOf(hex(words.slice(2).join(" ")));
    else commands.push({ tick: Number(words[0]), words: words.slice(1) });
  }
  sink.beginTick(0);
  let driver: AdlibMultisourceDriver | LureAdlibDriver;
  if (generic) {
    driver = new AdlibMultisourceDriver(sink, { instrumentBank: bank, allocationMode: staticMode ? "static" : "dynamic" });
    driver.open();
  } else {
    driver = new LureAdlibDriver(sink);
  }
  const player = new SmfPlayer(driver);
  const playing = new Map<number, SmfPlayback>();
  let idle = 0;
  for (let tick = 1; tick <= end; tick++) {
    sink.beginTick(tick);
    for (const { tick: at, words } of commands) {
      if (at !== tick) continue;
      switch (words[0]) {
        case "play": {
          const source = Number(words[1]);
          const old = playing.get(source);
          if (old) player.remove(old);
          playing.set(source, player.start(parseSong(files[words[2]!]!), source, words[3] === "1"));
          break;
        }
        case "stop": {
          const source = Number(words[1]);
          const old = playing.get(source);
          if (old) player.remove(old);
          playing.delete(source);
          break;
        }
        case "raw": {
          const b = hex(words.slice(2).join(" "));
          driver.send(Number(words[1]), b[0]!, b[1] ?? 0, b[2] ?? 0);
          break;
        }
        case "meta":
          driver.metaEvent(Number(words[1]), parseInt(words[2]!, 16), Uint8Array.from(hex(words.slice(3).join(" "))));
          break;
        case "stopall":
          driver.stopAllNotes();
          break;
        case "srcvol":
          driver.setSourceVolume(Number(words[1]), Number(words[2]));
          break;
        case "fade":
          driver.startFade(Number(words[1]), Number(words[2]));
          break;
        case "uservol":
          driver.setUserVolumes(Number(words[1]), Number(words[2]));
          break;
      }
    }
    driver.updateFading();
    player.tick();
    if (autoExtra >= 0) {
      const maxCommand = Math.max(0, ...commands.map((c) => c.tick));
      const any = [...playing.values()].some((p) => p.playing);
      if (!any && tick >= maxCommand) {
        if (++idle > autoExtra) break;
      } else idle = 0;
    }
  }
  return sink;
}

import { bnkToInstrument } from "../../../src/games/lure/audio/adlib-multisource";
function bnkOf(bytes: number[]): OplInstrument {
  return bnkToInstrument(Uint8Array.from(bytes));
}
