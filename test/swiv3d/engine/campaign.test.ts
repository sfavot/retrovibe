/**
 * Robot de campagne : un pilote scripté (`robot.ts`) joue les quatre missions livrées (TERRAN00 à TERRAN03) à la suite, sans
 * navigateur, avec les armes réelles, et vérifie que chacune peut être terminée (`levelComplete`). Les missions s'enchaînent
 * par le script de `GLOBAL.BD` (`MissionScriptRunner`) et l'état d'arrivée est reporté comme le fait l'application.
 *
 * - Fumée (toujours actif, < 5 s) : chaque niveau se charge et tourne 400 ticks, joueur inactif, sans exception ni NaN.
 * - Campagne (`CAMPAIGN=1`) : mode pur (le joueur peut mourir), puis, pour les niveaux non terminés, mode « invulnérable »
 *   (l'énergie est remise à son niveau de départ à chaque tick, depuis le test : aucun accroc dans le moteur) afin de
 *   séparer « atteignable » de « survivable ». Le rapport est affiché et écrit dans `$TMPDIR/swiv3d-campaign.txt`.
 *   `CAMPAIGN_BUDGET` fixe le budget de ticks par niveau (défaut 60 000 = 25 min de jeu), `CAMPAIGN_ONLY=TERRAN02` limite aux
 *   niveaux cités (séparés par des virgules ; l'état est alors celui du script, sans report).
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBd } from "../../../src/games/swiv3d/data/bd";
import type { GlobalData } from "../../../src/games/swiv3d/data/global";
import { parseGlobal } from "../../../src/games/swiv3d/data/global";
import type { Level } from "../../../src/games/swiv3d/data/level";
import { parseMissions } from "../../../src/games/swiv3d/data/missions";
import { TORUS_Q8 } from "../../../src/games/swiv3d/engine/fixed";
import { input } from "../../../src/games/swiv3d/engine/input";
import type { GameObject } from "../../../src/games/swiv3d/engine/objects";
import { World, loadDebris } from "../../../src/games/swiv3d/engine/world";
import { MissionScriptRunner, stateVars } from "../../../src/games/swiv3d/screens/mission-script";
import { AMMO_SLOTS, type MissionState } from "../../../src/games/swiv3d/screens/pilots";
import { hasOriginalFiles, loadLevel } from "./helpers";
import { readOriginal } from "../helpers";
import { Robot, type StuckEvent } from "./robot";

const LEVELS = ["TERRAN00", "TERRAN01", "TERRAN02", "TERRAN03"] as const;

/** Les cartes du niveau (cratères) sont modifiées par le monde : chaque partie repart d'une copie. */
function freshLevel(name: string): { level: Level; models: ReturnType<typeof loadLevel>["models"] } {
  const { level, models } = loadLevel(name);
  return { level: { ...level, heightmap: level.heightmap.slice(), groundMap: level.groundMap.slice() }, models };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fumée : toujours active
// ---------------------------------------------------------------------------------------------------------------------

/** Premier champ non fini ou hors du tore d'un objet vivant, ou `null`. */
function badField(o: GameObject): string | null {
  for (const k of ["x", "y", "z", "vx", "vy", "vz", "yaw", "pitch", "roll", "hp"] as const) {
    if (!Number.isFinite(o[k])) return `${k} = ${o[k]}`;
  }
  if (o.x < 0 || o.x >= TORUS_Q8 || o.z < 0 || o.z >= TORUS_Q8) return `hors du tore (${o.x}, ${o.z})`;
  return null;
}

describe.skipIf(!hasOriginalFiles)("fumée de campagne : 400 ticks à vide", () => {
  for (const name of LEVELS) {
    it(`${name} se charge et tourne 400 ticks sans exception ni NaN`, () => {
      const { level, models } = freshLevel(name);
      const world = World.load(level, models, {});
      const idle = input();
      for (let t = 0; t < 400; t++) {
        world.tick(idle);
        world.drainEvents();
        if (t % 50 === 49) for (const o of world.liveObjects()) expect(badField(o), `${name} tick ${t} objet ${o.type}/${o.slot}`).toBeNull();
      }
      expect(world.tickCount).toBe(400);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Campagne : CAMPAIGN=1
// ---------------------------------------------------------------------------------------------------------------------

interface Anomaly {
  kind: string;
  tick: number;
  type: number;
  slot: number;
  x: number;
  y: number;
  z: number;
  detail: string;
  count: number;
}

interface LevelReport {
  name: string;
  mode: "pur" | "invulnérable";
  carried: boolean;
  form: number;
  startEnergy: number;
  completed: boolean;
  outcome: "levelComplete" | "gameOver" | "budget";
  ticks: number;
  score: number;
  energy: number;
  deaths: number;
  damage: { ground: number; contact: number; mud: number; absorbed: number };
  /** Groupes détruits, dans l'ordre, avec le tick de la dernière cible de chaque groupe. */
  groups: { group: number; tick: number }[];
  objectivesLeft: number;
  stuck: StuckEvent[];
  anomalies: Anomaly[];
  exception: string | null;
  endState: MissionState | null;
  hits: number;
  pickups: number;
  specialShots: number;
}

const BUDGET = Number(process.env.CAMPAIGN_BUDGET ?? 60000);
const ONLY = process.env.CAMPAIGN_ONLY?.split(",").map((s) => s.trim().toUpperCase());

let globalData: GlobalData | undefined;
function loadGlobalData(): GlobalData {
  globalData ??= parseGlobal(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
  return globalData;
}

/** Contrôles d'intégrité périodiques sur tous les objets vivants ; chaque (genre, type) n'est consigné qu'une fois (avec un compteur). */
function scanAnomalies(world: World, found: Map<string, Anomaly>): void {
  for (const o of world.liveObjects()) {
    let kind: string | null = null;
    let detail = "";
    const bad = badField(o);
    if (bad) {
      kind = bad.startsWith("hors") ? "hors du tore" : "NaN";
      detail = bad;
    } else {
      const ground = world.terrain.height(o.x, o.z);
      // sous le relief : tolérance de 8 unités (les cratères abaissent le sol sous les objets déjà posés)
      if (o.y < ground - 8 * 256 && o.update !== "static") {
        kind = "sous le terrain";
        detail = `modèle ${o.model}, y ${(o.y / 256).toFixed(0)} < sol ${(ground / 256).toFixed(0)}`;
      } else if (o.y / 256 > 4000) {
        kind = "altitude démesurée";
        detail = `modèle ${o.model}, y ${(o.y / 256).toFixed(0)}`;
      }
    }
    if (!kind) continue;
    const key = `${kind}|${o.type}|${o.model}`;
    const prev = found.get(key);
    if (prev) prev.count++;
    else
      found.set(key, {
        kind,
        tick: world.tickCount,
        type: o.type,
        slot: o.slot,
        x: Math.round(o.x / 256),
        y: Math.round(o.y / 256),
        z: Math.round(o.z / 256),
        detail,
        count: 1,
      });
  }
}

/** Joue un niveau jusqu'à `levelComplete`, `gameOver` ou épuisement du budget. */
function playLevel(name: string, vars: ReadonlyMap<number, number>, cannonPower: number, mode: LevelReport["mode"], carried: boolean): LevelReport {
  const { level, models } = freshLevel(name);
  const global = loadGlobalData();
  const ammo = Array.from({ length: AMMO_SLOTS }, (_, k) => vars.get(100 + k) ?? 0);
  const startEnergy = vars.get(1) ?? 496;
  const report: LevelReport = {
    name,
    mode,
    carried,
    form: vars.get(0) ?? 0,
    startEnergy,
    completed: false,
    outcome: "budget",
    ticks: 0,
    score: 0,
    energy: 0,
    deaths: 0,
    damage: { ground: 0, contact: 0, mud: 0, absorbed: 0 },
    groups: [],
    objectivesLeft: 0,
    stuck: [],
    anomalies: [],
    exception: null,
    endState: null,
    hits: 0,
    pickups: 0,
    specialShots: 0,
  };
  const found = new Map<string, Anomaly>();
  let world: World | undefined;
  try {
    world = World.load(level, models, {
      playerHitPoints: vars.get(1),
      startForm: vars.get(0),
      score: vars.get(2),
      ammo,
      cannonPower,
      debris: loadDebris(readOriginal(`${name}.SLV`), name),
      craters: global.craters,
    });
    const robot = new Robot(world);
    const invulnerable = mode === "invulnérable";
    for (let t = 0; t < BUDGET; t++) {
      if (invulnerable && world.player.obj.hp < startEnergy) {
        report.damage.absorbed += startEnergy - world.player.obj.hp;
        world.player.obj.hp = startEnergy;
      }
      world.tick(robot.decide());
      for (const e of world.drainEvents()) {
        if (e.kind === "objective" && e.groupDone) report.groups.push({ group: e.group, tick: world.tickCount });
        else if (e.kind === "playerDamaged") report.damage[e.source] += e.amount;
        else if (e.kind === "playerDied") report.deaths++;
        else if (e.kind === "levelComplete") report.outcome = "levelComplete";
        else if (e.kind === "gameOver") report.outcome = "gameOver";
      }
      if (t % 20 === 0) scanAnomalies(world, found);
      if (report.outcome !== "budget") break;
    }
    report.ticks = world.tickCount;
    report.completed = report.outcome === "levelComplete";
    report.score = world.game.score;
    report.energy = world.player.obj.hp;
    report.objectivesLeft = world.game.objectives.length;
    report.stuck = robot.stuck;
    report.pickups = robot.pickups;
    report.specialShots = robot.specialShots;
    report.hits = world.game.objectivesDestroyed;
    const form = world.player.form;
    report.endState = {
      ammo: Array.from({ length: AMMO_SLOTS }, (_, k) => world!.game.ammo[k] ?? 0),
      score: world.game.score,
      form: form >= 0 && form <= 5 ? form : (vars.get(0) ?? 0),
      energy: Math.max(1, world.player.obj.hp),
      cannonPower: world.game.power,
    };
  } catch (e) {
    report.exception = e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 4).join(" | ") : String(e);
    if (world) report.ticks = world.tickCount;
  }
  report.anomalies = [...found.values()];
  return report;
}

function format(r: LevelReport): string[] {
  const out: string[] = [];
  out.push(
    `${r.name} [${r.mode}${r.carried ? ", état reporté" : ", variables du script"}] forme ${r.form}, énergie de départ ${r.startEnergy} : ` +
      `${r.completed ? "TERMINÉ" : `NON TERMINÉ (${r.outcome})`} en ${r.ticks} ticks (${(r.ticks / 40).toFixed(0)} s), score ${r.score}, énergie ${r.energy}, ` +
      `morts ${r.deaths}, cibles détruites ${r.hits}, restantes ${r.objectivesLeft}, bonus d'énergie ramassés ${r.pickups}, tirs spéciaux ${r.specialShots}`,
  );
  out.push(`  dégâts : sol ${r.damage.ground}, contact ${r.damage.contact}, boue ${r.damage.mud}` + (r.mode === "invulnérable" ? `, absorbés ${r.damage.absorbed}` : ""));
  out.push(`  groupes détruits (ordre, tick) : ${r.groups.map((g) => `${g.group}@${g.tick}`).join(" ") || "aucun"}`);
  for (const s of r.stuck) out.push(`  blocage tick ${s.tick} en (${s.x}, ${s.z}, y ${s.y}) vers type ${s.targetType} g${s.targetGroup} (${s.targetX}, ${s.targetZ}) à ${s.distance} u`);
  for (const a of r.anomalies) out.push(`  anomalie ${a.kind} : type ${a.type} slot ${a.slot} tick ${a.tick} (${a.x}, ${a.y}, ${a.z}) ${a.detail} x${a.count}`);
  if (r.exception) out.push(`  EXCEPTION : ${r.exception}`);
  return out;
}

interface Campaign {
  reports: LevelReport[];
}

/**
 * Enchaîne les missions par le script de `GLOBAL.BD`. Un niveau perdu ou non terminé n'arrête pas la chaîne : la mission
 * suivante repart alors de l'état du script (dit « état du script » dans le rapport), pour que chaque niveau soit mesuré.
 */
function runCampaign(mode: LevelReport["mode"], only: readonly string[]): Campaign {
  const script = parseMissions(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
  const runner = new MissionScriptRunner(script);
  const reports: LevelReport[] = [];
  const states: Record<number, MissionState> = {};
  let carry: MissionState | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const step = runner.next();
    if (step.kind === "finished") break;
    if (step.kind === "mission") {
      if (carry) states[step.index] = carry;
      carry = null;
      const arrival = states[step.index];
      if (arrival) runner.seed(stateVars(arrival));
      continue;
    }
    if (step.kind !== "level") continue;
    if (!(LEVELS as readonly string[]).includes(step.name.toUpperCase())) break;
    if (!only.includes(step.name.toUpperCase())) continue;
    const arrival = states[step.mission];
    const r = playLevel(step.name.toUpperCase(), step.vars, arrival?.cannonPower ?? 0, mode, !!arrival);
    reports.push(r);
    if (r.completed && r.endState) carry = r.endState;
  }
  return { reports };
}

function publish(title: string, reports: readonly LevelReport[]): void {
  const lines = [`== ${title} ==`, ...reports.flatMap(format)];
  const text = lines.join("\n");
  console.log(text);
  try {
    writeFileSync(join(tmpdir(), `swiv3d-campaign-${title.split(" ")[0]}.txt`), text + "\n");
  } catch {
    // le rapport écrit est un confort : la sortie standard fait foi
  }
}

describe.skipIf(!hasOriginalFiles || !process.env.CAMPAIGN)("robot de campagne : les 4 missions se terminent", () => {
  const only = ONLY ?? LEVELS;

  // Rapport seulement : le robot n'esquive pas les tirs ennemis, donc le mode pur peut mourir (TERRAN01, TERRAN03) sans que le
  // niveau soit en cause. La complétion n'est donc pas assertée ici.
  it("mode pur (rapport) : le joueur peut mourir", { timeout: 1_800_000 }, () => {
    const pure = runCampaign("pur", only);
    publish("pur (le joueur peut mourir)", pure.reports);
    expect(pure.reports.map((r) => r.name)).toEqual([...only]);
    for (const r of pure.reports) expect(r.exception, `${r.name} : exception`).toBeNull();
  });

  it("mode invulnérable : chaque mission est atteignable, groupes 9 -> 0, levelComplete", { timeout: 1_800_000 }, () => {
    const camp = runCampaign("invulnérable", only);
    publish("invulnérable (énergie remise au départ à chaque tick)", camp.reports);
    expect(camp.reports.map((r) => r.name)).toEqual([...only]);
    for (const r of camp.reports) {
      expect(r.exception, `${r.name} : exception`).toBeNull();
      expect(r.completed, `${r.name} : ${r.outcome} après ${r.ticks} ticks`).toBe(true);
      const order = r.groups.map((g) => g.group);
      expect(order, `${r.name} : ordre des groupes`).toEqual([...order].sort((a, b) => b - a));
      expect(order.at(-1)).toBe(0);
      const blocking = r.anomalies.filter((a) => a.kind === "NaN" || a.kind === "hors du tore");
      expect(blocking, `${r.name} : anomalies bloquantes`).toEqual([]);
    }
  });
});
