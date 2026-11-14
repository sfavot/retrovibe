import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { BassEngine } from "../../../src/games/bass/engine/game";
import { mcodeNumber } from "../../../src/games/bass/engine/mcodes";
import { BassScreenRenderer } from "../../../src/games/bass/render/screen";
import { makeEngine } from "../engine/helpers";

export const fixturePath = (name: string): string => resolve(import.meta.dirname, "fixtures", name);

/** Empreinte d'une image du banc : les 64 000 indices puis les 240 premières couleurs (le reste de la palette de la machine ne bouge pas). */
export function frameHash(pixels: Uint8Array, palette: Uint8Array): string {
  return createHash("sha1").update(pixels.subarray(0, 64000)).update(palette.subarray(0, 720)).digest("hex");
}

/** Image de référence enregistrée (`cy-N.bin.gz` : 64 000 indices puis 768 octets de palette). */
export function readReferenceFrame(name: string): { pixels: Uint8Array; palette: Uint8Array } {
  const data = new Uint8Array(gunzipSync(readFileSync(fixturePath(`cycles/${name}.bin.gz`))));
  return { pixels: data.subarray(0, 64000), palette: data.subarray(64000, 64768) };
}

/** Moteur sur les vrais fichiers, branché sur l'écran, parti après l'introduction (comme le banc après Échap). */
export class RenderedGame {
  readonly renderer = new BassScreenRenderer();
  readonly engine: BassEngine;

  constructor() {
    const { engine } = makeEngine({ screen: (e) => this.renderer.attach(e) });
    this.engine = engine;
    engine.startAfterIntro();
  }

  /** Un tick de 20 ms ; le tour terminé est composé par le moteur (`BassEngine.cycle`). */
  tick(): void {
    this.engine.tick();
  }

  /** Avance jusqu'à ce que `n` tours soient terminés (et composés). */
  runTo(n: number): void {
    while (this.engine.completedCycles < n) this.tick();
  }

  hash(): string {
    return frameHash(this.renderer.frame.pixels, this.renderer.frame.palette);
  }

  /**
   * `Logic::fnExec` du banc (`SKY_EXEC`) au début du tour `n` : termine le tour `n - 1`, appelle le mcode, puis rend l'empreinte de
   * chaque image présentée pendant l'effet (un tick par pas, comme les captures `SKY_STEP_SHOTS` de ScummVM) ; la dernière image est celle
   * du tick qui termine le tour (image finale d'un défilement).
   */
  execAtCycle(n: number, mcode: string, a: number, b: number): string[] {
    this.runTo(n - 1);
    const number = mcodeNumber(mcode);
    if (number < 0) throw new Error(`mcode inconnu : ${mcode}`);
    this.engine.logic.mcode(number, a, b, 0);
    const hashes: string[] = [];
    // Le banc capture l'image à la fin de l'effet, avant la composition qui clôt le tour : on prend l'empreinte à l'entrée de `compose`.
    const compose = this.renderer.compose.bind(this.renderer);
    let beforeCompose: string | null = null;
    this.renderer.compose = () => {
      beforeCompose ??= this.hash();
      compose();
    };
    try {
      while (this.engine.completedCycles < n) {
        beforeCompose = null;
        this.engine.tick();
        if (this.engine.blocked) hashes.push(this.hash());
        else if (this.engine.completedCycles >= n) hashes.push(beforeCompose ?? this.hash());
      }
    } finally {
      this.renderer.compose = compose;
    }
    return hashes;
  }
}
