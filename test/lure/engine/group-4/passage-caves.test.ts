/**
 * Les grottes et le monastère (de Goewin et la potion à l'arrivée dans la cave du château, pièce 42) joués par de vrais clics
 * (`test/lure/solution/zone-caves.ts`) : (a) d'une traite, (b) avec une sauvegarde et une reprise sur un moteur neuf après chaque étape.
 * La phase « Goewin ouvre la grille » est une course contre la patience de Goewin : elle se rejoue quand Goewin a abandonné.
 */
import { describe, expect, it } from "vitest";
import type { FightsManager } from "../../../../src/games/lure/engine/fights/index";
import type { LureEngine } from "../../../../src/games/lure/engine/game";
import { HotspotId, TickProc } from "../../../../src/games/lure/engine/ids";
import { captureSave, parseSave, restoreSave } from "../../../../src/games/lure/engine/save";
import { Play } from "../../solution/runner";
import type { Step } from "../../solution/runner";
import { CF, type CavesPhase, HS, ZONE_CAVES_PHASES, setupCavesStart } from "../../solution/zone-caves";
import { type TestHost, hasOriginalFiles, makeEngine } from "../test-host";

const TELL_BIT = 1 << 12;
const DOOR_MONASTERY = 0x271e;
const DOOR_WEREGATE = 0x2729;

const blocked = (engine: LureEngine, door: number): number | undefined => engine.world.getExitJoin(door)?.blocked;

/** Ce qui doit être vrai à la fin de chaque phase de la solution (les clés sont les noms de `ZONE_CAVES_PHASES`). */
const CHECKS: Record<string, (engine: LureEngine, host: TestHost, play: Play) => void> = {
  "Ultar et les gargouilles": (engine) => {
    expect(engine.room.roomNumber).toBe(15);
    expect(engine.world.fields.get(CF.TALK_INDEX)).toBe(16);
    // Les gargouilles ont un verbe « Parle à » (méthode 59) ; Ultar s'est présenté.
    expect(engine.world.requireHotspot(HS.GARGOYLE).actions & (1 << 11)).not.toBe(0);
    expect(engine.world.requireHotspot(HS.ULTAR).nameId).not.toBe(engine.world.requireHotspot(0x42a).nameId);
  },
  "Goewin ouvre la grille": (engine) => {
    expect(engine.room.roomNumber).toBe(15);
    expect(engine.world.fields.get(CF.TALK_INDEX)).toBe(19);
    expect(blocked(engine, DOOR_MONASTERY)).toBe(0);
  },
  "la grotte d'entrée": (engine) => {
    expect(engine.room.roomNumber).toBe(38);
    expect(engine.world.fields.get(CF.TALK_INDEX)).toBe(21);
    // Goewin est devenue suiveuse (méthode 41) : « Dis à » lui est permis, elle n'a plus rien d'une promeneuse.
    const goewin = engine.world.requireHotspot(HotspotId.GOEWIN);
    expect(goewin.roomNumber).toBe(38);
    expect(goewin.actions & TELL_BIT).toBe(TELL_BIT);
    expect(engine.world.requireActiveHotspot(HotspotId.GOEWIN).tickProcId).toBe(TickProc.FOLLOWER_2);
  },
  "les crânes": (engine) => {
    // La porte E est la seule ouverte ; Goewin est restée en 39, derrière les portes fermées.
    expect(engine.room.roomNumber).toBe(5);
    expect([blocked(engine, HS.DOOR_A), blocked(engine, HS.DOOR_C), blocked(engine, HS.DOOR_E)]).toEqual([1, 1, 0]);
    expect(engine.world.requireHotspot(HotspotId.GOEWIN).roomNumber).toBe(39);
  },
  "le cochon": (engine, _host, play) => {
    expect(engine.room.roomNumber).toBe(6);
    expect((engine.fights as FightsManager).isFighting).toBe(false);
    expect(play.inventory()).toEqual(expect.arrayContaining(["Hache", "Potion"]));
  },
  "le dragon": (engine, _host, play) => {
    expect(engine.room.roomNumber).toBe(41);
    expect(engine.world.fields.get(CF.TALK_INDEX)).toBe(22);
    // L'Oeil de Gethryn est au joueur, la potion est répandue, la Weregate s'ouvre.
    expect(play.inventory()).toEqual(expect.arrayContaining(["Oeil de Gethryn", "Hache"]));
    expect(play.inventory()).not.toContain("Potion");
    expect(blocked(engine, DOOR_WEREGATE)).toBe(0);
  },
  "le retour": (engine) => {
    // Le monastère : l'entrée dans la pièce 15 après le dragon passe le champ 19 à 23.
    expect(engine.room.roomNumber).toBe(15);
    expect(engine.world.fields.get(CF.TALK_INDEX)).toBe(23);
  },
  "la conversation du Skorl et d'Ewan": (engine) => {
    // Entendue à distance (le joueur est dans la pièce 19, il regarde la 35).
    expect(engine.world.fields.get(CF.TALK_INDEX)).toBe(24);
    expect(engine.world.requireHotspot(0x3f1).nameId).toBe(0x154);
  },
  "Ewan et le tonneau": (engine, host) => {
    // La séquence différée 0x2911 : le joueur est dans la cave du château, le script d'entrée de la pièce 42 a tourné (champs 61 et 19).
    expect(engine.room.roomNumber).toBe(42);
    expect(engine.world.fields.get(61)).toBe(1);
    expect(engine.world.fields.get(CF.TALK_INDEX)).toBe(0);
    expect(host.exits).toBe(0);
  },
};

interface Ctx {
  engine: LureEngine;
  host: TestHost;
  play: Play;
}

function start(seed?: number): Ctx {
  const { engine, host } = makeEngine(seed === undefined ? {} : { seed });
  engine.tick();
  setupCavesStart(engine);
  return { engine, host, play: new Play(engine, host) };
}

/**
 * Joue une phase : ses étapes une à une, par le joueur courant (`onStep` après chacune, qui peut le remplacer par un moteur repris), puis, si elle a une condition de réussite, la rejoue tant qu'elle n'est pas
 * vraie (une étape qui lève est une tentative manquée, pas une panne). Rend le nombre de tentatives.
 */
function runPhase(current: () => Ctx, phase: CavesPhase, onStep: (step: Step) => void = () => {}): number {
  const max = phase.retry?.max ?? 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      for (const step of phase.steps) {
        current().play.run([step]);
        onStep(step);
      }
      lastError = undefined;
    } catch (e) {
      if (!phase.retry) throw e;
      lastError = e;
    }
    if (!phase.retry || phase.retry.until(current().engine)) return attempt;
  }
  throw new Error(`« ${phase.name} » : ${max} tentatives manquées${lastError ? ` (${(lastError as Error).message})` : ""}`);
}

/** Un moteur neuf qui reprend `save` (pointeur rendu comme le ferait l'hôte), rejoué par un nouveau joueur. */
function resume(save: NonNullable<ReturnType<typeof captureSave>>, previous: LureEngine): Ctx {
  const { engine, host } = makeEngine();
  expect(restoreSave(engine, save)).toBe(true);
  Object.assign(engine.mouse, previous.mouse);
  engine.room.mouseX = previous.mouse.x;
  engine.room.mouseY = previous.mouse.y;
  return { engine, host, play: new Play(engine, host) };
}

describe.skipIf(!hasOriginalFiles)("les grottes et le monastère, joués de la potion de Goewin à la cave du château", () => {
  it("les phases ont toutes leurs vérifications", () => {
    expect(ZONE_CAVES_PHASES.map((p) => p.name).sort()).toEqual(Object.keys(CHECKS).sort());
  });

  it("(a) d'une traite : gargouilles, Goewin, crânes, cochon, dragon, Skorl et Ewan, cave du château", () => {
    const ctx = start();
    const attempts: Record<string, number> = {};
    for (const phase of ZONE_CAVES_PHASES) {
      attempts[phase.name] = runPhase(() => ctx, phase);
      CHECKS[phase.name]!(ctx.engine, ctx.host, ctx.play);
    }
    // Seule la course contre Goewin se rejoue, et peu.
    for (const [name, n] of Object.entries(attempts)) {
      if (!ZONE_CAVES_PHASES.find((p) => p.name === name)!.retry) expect(n, name).toBe(1);
      else expect(n, name).toBeLessThanOrEqual(3);
    }
    // Le texte du jeu a bien été lu : la grille, les crânes, le cochon, le dragon, l'oeil.
    const text = ctx.play.log.dialogs.join("\n");
    expect(text).toContain("Cela fait longtemps que j'attends de voir ce qu'il y a derrière ces portes. Je viens!");
    expect(text).toContain("A votre service!!");
    expect(text).toContain("Vous saisissez une hâche abandonnée");
    expect(text).toContain("C'est l'oeil de Gethryn");
    expect(text).toContain("Vite, le Skorl arrive! Montez dans le tonneau!");
    // Rien de non porté n'a tourné.
    expect(ctx.engine.journal.lines.filter((l) => /non port/.test(l))).toEqual([]);
  }, 120_000);

  it("la même, avec d'autres graines (le hasard des promeneurs, du cochon et de Goewin ne change pas le dénouement)", () => {
    for (const seed of [3, 4, 5]) {
      const ctx = start(seed);
      for (const phase of ZONE_CAVES_PHASES) {
        runPhase(() => ctx, phase);
        CHECKS[phase.name]!(ctx.engine, ctx.host, ctx.play);
      }
    }
  }, 240_000);

  it("(b) avec une sauvegarde et une reprise sur un moteur neuf après chaque étape", () => {
    let ctx = start();
    const dialogs: string[] = [];
    let resumes = 0;
    let refused = 0;
    let steps = 0;
    for (const phase of ZONE_CAVES_PHASES) {
      runPhase(() => ctx, phase, () => {
        steps++;
        // La sauvegarde est refusée en combat, pendant une conversation, une vue à distance ; la reprise se fait sur un moteur qui n'a jamais
        // tourné, par du vrai JSON.
        const save = captureSave(ctx.engine);
        if (save === null) {
          refused++;
          return;
        }
        const parsed = parseSave(JSON.parse(JSON.stringify(save)));
        expect(parsed).toEqual(save);
        dialogs.push(...ctx.play.log.dialogs);
        ctx = resume(parsed!, ctx.engine);
        resumes++;
      });
      CHECKS[phase.name]!(ctx.engine, ctx.host, ctx.play);
    }
    dialogs.push(...ctx.play.log.dialogs);
    expect(resumes + refused).toBe(steps);
    expect(resumes).toBeGreaterThan(40);
    expect(refused).toBeLessThan(resumes);
    expect(dialogs.join("\n")).toContain("C'est l'oeil de Gethryn");
    expect(ctx.engine.journal.lines.filter((l) => /non port/.test(l))).toEqual([]);
  }, 240_000);
});
