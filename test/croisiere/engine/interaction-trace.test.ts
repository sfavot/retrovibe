/**
 * Interaction comparée tour par tour au banc ScummVM (`cruise-replay.sh fixtures/<scénario>.in DIR STOP 2`, `KEYS=` pour les touches ;
 * graine 1, temps virtuel, contournement de la protection), avec les vrais niveaux de souris : `processInput`, `findObject`, menus
 * d'objet, verbes, inventaire, messages, menu joueur, pause, sorties. Les 3 500 premiers tours, sans entrée, sont ceux de
 * `bench-first-room-l2.trace.gz` ; la suite est dans `bench-<scénario>-l2.trace.gz`, lignes `SC` comprises : l'image présentée (menus,
 * bandeau, messages) et la palette y sont comparées en fin de chaque tour de `mainLoop`.
 */
import { describe, expect, it } from "vitest";
import { replayBench } from "./replay";
import { hasOriginalFiles } from "./support";

const SCENARIOS: { name: string; last: number; keys?: boolean; what: string }[] = [
  { name: "look-s33", last: 3900, what: "menus d'objet, verbe REL (gros plan et sortie), survol, fermeture, message" },
  { name: "inv-s33", last: 4000, what: "inventaire (clic droit), verbes d'un objet d'inventaire, fermetures, plan du bateau" },
  { name: "menu-s33", last: 4400, keys: true, what: "menu joueur (F10, deux boutons), pause, porte vers S36, Recommencer" },
];

describe.skipIf(!hasOriginalFiles)("trace du banc (interaction)", () => {
  for (const s of SCENARIOS) {
    it(`${s.name} : ${s.what}, identique jusqu'au tour ${s.last}`, () => {
      const { engine, mismatch } = replayBench(["bench-first-room-l2.trace.gz", `bench-${s.name}-l2.trace.gz`], `${s.name}.in`, s.keys ? `${s.name}.keys` : null, s.last, 3501);
      if (mismatch) throw new Error(mismatch);
      expect(engine.frameNumber).toBe(s.last);
    });
  }
});
