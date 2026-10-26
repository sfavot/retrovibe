import { FixedStepClock } from "../../../engine/clock";
import { paletteToLut } from "../../../ui/indexed-canvas";
import type { MusicSystem, SoundSystem } from "../audio";
import type { GlobalData } from "../data/global";
import { parseBd } from "../data/bd";
import { parseLevel } from "../data/level";
import type { WorldEvent } from "../engine/events";
import { World, loadDebris, loadModels } from "../engine/world";
import { createRenderAssets } from "../render/assets";
import { createHud, radarColorTable, type Hud } from "../render/hud";
import { createRenderer } from "../render/renderer";
import type { Renderer } from "../render/renderer";
import type { LevelStats } from "../screens/flow";
import { AMMO_SLOTS, type MissionState } from "../screens/pilots";
import { Controls } from "./controls";
import { HudStateBuilder } from "./hud-state";
import { SoundBridge } from "./sound-bridge";
import { ViewBuilder } from "./view";

/** Pas de la simulation : 25 ms (40 Hz, `docs/swiv3d/player.md` §1). */
export const TICK_MS = 25;
/** Ticks rattrapés au plus en une image : au-delà (machine lente), le temps perdu est abandonné. */
const MAX_CATCH_UP_TICKS = 5;

/** Mesures de la page de dev (`window.__swiv3d.stats`). */
export interface AppStats {
  /** Moyenne glissante du temps de rendu (ms). */
  renderMs: number;
  /** Moyenne glissante du temps d'une image du navigateur (ms). */
  frameMs: number;
  /** Ticks simulés depuis le début. */
  ticks: number;
}

export interface LevelEvents {
  /** Mission accomplie. */
  levelComplete: (() => void)[];
  /** Le joueur est mort. */
  gameOver: (() => void)[];
  /** Échap : demande d'abandon (c'est l'écran de confirmation qui décide). */
  quit: (() => void)[];
}

/** Ce que le niveau reçoit de l'application. */
export interface LevelServices {
  /** Lit un fichier du jeu par son nom (`TERRAN00.SLV`). */
  read(name: string): Promise<Uint8Array>;
  global: GlobalData;
  sound: SoundSystem | null;
  music: MusicSystem | null;
  audio: AudioContext | null;
  controls: Controls;
  /** Commandes tactiles : relâchées à la pause. */
  touch: { reset(): void };
  /** Le canvas reprend le focus quand la pause se ferme. */
  focusCanvas(): void;
  /** Image 320×400 dans laquelle le niveau dessine. */
  framebuffer: Uint8Array;
  stats: AppStats;
}

export interface LevelRequest {
  name: string;
  /** Points de vie de départ (variable 1 du script) et forme du véhicule (variable 0) ; absents : valeurs du jeu. */
  hitPoints?: number;
  form?: number;
  /** Score de départ (variable 2), munitions des 20 armes (variables 100-119) et niveau du canon : état d'arrivée du joueur ; absents : partie neuve. */
  score?: number;
  ammo?: readonly number[];
  cannonPower?: number;
  /** Mission (nom affiché 2 s en haut de l'écran, table 200) et langue du HUD : 0 anglais, 1 français. */
  mission?: number;
  language?: 0 | 1;
  /** Dessine le HUD (vrai par défaut ; le décor de la démo n'en a pas). */
  hud?: boolean;
}

/** Ticks pendant lesquels le nom de la mission reste affiché (`DAT_00480c68` = 0x50, `rules.md` § 7.6). */
export const MISSION_NAME_TICKS = 80;

export interface LevelSession {
  readonly world: World;
  readonly renderer: Renderer;
  /** Palette du niveau, prête pour `IndexedPresenter.present`. */
  readonly palette: Uint32Array;
  readonly events: LevelEvents;
  /** Temps de jeu écoulé, en secondes (40 ticks par seconde). */
  seconds(): number;
  /** Bilan du niveau pour l'écran de fin (scores, pourcentages) et état d'arrivée du joueur pour la mission suivante. */
  summary(): LevelStats;
  /** Une image : commandes, simulation, rendu dans `services.framebuffer`. */
  onFrame(now: number): void;
  /** Onglet masqué ou de nouveau visible. */
  onPause(hidden: boolean): void;
  /** Pause imposée par l'application (écran d'abandon) : la simulation s'arrête, sans titre « Pause ». */
  setPaused(paused: boolean): void;
  /** Pause demandée par le joueur (touche Pause, Start) : le monde est figé mais dessiné, avec le titre 3D « Pause ». */
  readonly userPaused: boolean;
  /** Ferme la pause du joueur (n'importe quelle touche, appui sur l'écran). */
  resume(): void;
  /**
   * Pause, F1 (Setup) et F12 (Tricher) sont-ils ouverts ? `gm_frame` ne les lit que hors séquence de fin (`DAT_005b0414 == 0`) : ni
   * pendant la victoire ou la mort, ni derrière l'écran de fin.
   */
  readonly menusAllowed: boolean;
  /** Table de couleurs du texte 3D de ce niveau (bloc 11003, `005bc158`) : couleurs des titres de menu devant ce niveau. */
  readonly textColors: Uint8Array;
  /** Dev : termine le niveau (F9) ou fait mourir le joueur (F8). */
  complete(): void;
  gameOver(): void;
  /** Échap. */
  requestQuit(): void;
  dispose(): void;
}

/**
 * Charge un niveau et le fait vivre : monde à 40 Hz, caméra de poursuite, rendu logiciel à chaque image du navigateur, son (moteur,
 * événements) et musique du niveau. Pause sur la touche Pause (n'importe quelle touche la ferme) ou quand l'onglet est masqué. Une fois
 * le niveau fini (mission accomplie, game over) le monde continue de tourner derrière l'écran de fin, sans clavier (manette et souris
 * seules, comme l'original).
 */
export async function startLevel(services: LevelServices, request: LevelRequest): Promise<LevelSession> {
  const name = request.name.toUpperCase();
  const levelBytes = await services.read(`${name}.SLV`);
  const level = parseLevel(levelBytes, name);
  const models = loadModels(levelBytes, name);
  const renderer = createRenderer(createRenderAssets({ level, models: [...models.values()], global: services.global }));
  // Lissage de la caméra à chaque image du navigateur (`updateCamera`), pas à chaque tick.
  const world = World.load(level, models, {
    cameraFps: 0,
    playerHitPoints: request.hitPoints,
    startForm: request.form,
    debris: loadDebris(levelBytes, name),
    craters: services.global.craters,
    ammo: request.ammo,
    cannonPower: request.cannonPower,
    score: request.score,
  });
  const language = request.language ?? 1;
  const missionName = request.mission === undefined ? "" : (services.global.strings.get(language, 200, request.mission) ?? "");
  const textColors = radarColorTable(parseBd(levelBytes, name).get(11003));
  const hud: Hud | null =
    request.hud === false
      ? null
      : createHud({
          global: services.global,
          blendTable: level.fadeTable,
          table109: level.lightTable109,
          colorMap: level.colorMap,
          radarColors: textColors,
        });
  const hudBuilder = new HudStateBuilder();

  const { controls, sound, music, audio, stats, framebuffer } = services;
  const bridge = sound ? new SoundBridge(sound, music) : null;
  bridge?.attach(world, name);

  const events: LevelEvents = { levelComplete: [], gameOver: [], quit: [] };
  const emit = (list: (() => void)[]): void => {
    for (const fn of [...list]) fn();
  };
  let finished = false;
  const finish = (kind: "levelComplete" | "gameOver"): void => {
    if (finished) return;
    finished = true;
    emit(events[kind]);
  };

  // --- Pause : onglet masqué, touche Pause ou application. Le son est suspendu, le jeu repart au même point (pas de rattrapage).
  const clock = new FixedStepClock({ tickMs: TICK_MS, maxCatchUpTicks: MAX_CATCH_UP_TICKS });
  let tabHidden = false;
  let userPaused = false;
  let hostPaused = false;
  let wasPaused = false;
  const isPaused = (): boolean => tabHidden || userPaused || hostPaused;
  const menusAllowed = (): boolean => !finished && world.game.endState === "none";
  const applyPause = (): void => {
    const paused = isPaused();
    if (paused === wasPaused) return;
    wasPaused = paused;
    if (paused) {
      controls.clear();
      services.touch.reset();
      // Un écran de l'application (abandon) a besoin du son : seule la pause de l'onglet ou de l'utilisateur suspend la sortie audio.
      if (!hostPaused || tabHidden || userPaused) {
        void audio?.suspend();
        music?.suspend();
      }
    } else {
      void audio?.resume();
      music?.resume();
      clock.resync();
    }
  };
  const resume = (): void => {
    if (!userPaused) return;
    userPaused = false;
    applyPause();
    services.focusCanvas();
  };

  const views = new ViewBuilder();
  const palette = paletteToLut(renderer.palette);
  let lastNow = 0;
  let ticksInLevel = 0;

  const handleWorldEvents = (list: readonly WorldEvent[]): void => {
    bridge?.handle(list);
    for (const e of list) {
      if (e.kind === "levelComplete") finish("levelComplete");
      else if (e.kind === "gameOver") finish("gameOver");
    }
  };

  return {
    world,
    renderer,
    palette,
    events,
    seconds: () => ticksInLevel / 40,
    summary: () => summarize(world, ticksInLevel / 40, request),
    get menusAllowed() {
      return menusAllowed();
    },
    onPause(hidden) {
      tabHidden = hidden;
      applyPause();
    },
    setPaused(paused) {
      hostPaused = paused;
      applyPause();
    },
    get userPaused() {
      return userPaused;
    },
    resume,
    textColors,
    complete: () => finish("levelComplete"),
    gameOver: () => finish("gameOver"),
    requestQuit: () => emit(events.quit),
    onFrame(now) {
      const dt = lastNow === 0 ? 0 : now - lastNow;
      lastNow = now;
      if (dt > 0 && dt < 500) stats.frameMs = stats.frameMs === 0 ? dt : stats.frameMs * 0.95 + dt * 0.05;
      if (tabHidden) return;
      // Écran de fin : le clavier est vidé à chaque image (`gm_menu_run` → `gm_clear_keys`), la manette et la souris sont relues.
      if (finished) controls.releaseKeys();
      controls.poll();
      if (!hostPaused) {
        // Pause : la touche Pause la pose (hors séquence de fin) ; une fois posée, n'importe quelle touche la ferme (`gm_screen_pause`,
        // `00419058`). Un appui hors de propos est oublié.
        const pauseKey = controls.takePauseRequest();
        const anyKey = controls.takeAnyKey();
        if (!userPaused && pauseKey && menusAllowed()) {
          userPaused = true;
          applyPause();
        } else if (userPaused && (pauseKey || anyKey)) resume();
      }

      // En pause, le monde reste dessiné (viseurs, messages) : seuls l'horloge et les ticks s'arrêtent.
      if (!hostPaused && !userPaused) {
        clock.update(now);
        while (clock.consume()) {
          // Fin de niveau : le monde continue (effets, ennemis, pilote de fin `gm_pilot_victory_*` des formes 0 à 3) ; les formes 4 et 5
          // gardent leur pilote normal (`gm_player_victory_mode` n'a pas de cas pour elles), qui lit encore la manette et la souris.
          world.tick(controls.sample());
          stats.ticks++;
          ticksInLevel++;
        }
        handleWorldEvents(world.drainEvents());
        // Cadence d'image estimée pour le lissage de la caméra (`k = max(1, fps / 4)`, bornée comme l'exe : au moins 5).
        world.updateCamera(Math.max(5, Math.min(240, stats.frameMs > 0 ? 1000 / stats.frameMs : 60)));
      }

      const view = views.build(world);
      const start = performance.now();
      renderer.render(view, framebuffer);
      hud?.draw(
        framebuffer,
        hudBuilder.build(world, view.camera, {
          missionName: world.tickCount < MISSION_NAME_TICKS ? missionName : "",
          language: language === 1 ? "fr" : "en",
          paused: userPaused,
          inMenu: finished,
        }),
      );
      const renderMs = performance.now() - start;
      stats.renderMs = stats.renderMs === 0 ? renderMs : stats.renderMs * 0.95 + renderMs * 0.05;
      bridge?.update(view.camera);
    },
    dispose() {
      sound?.stopAll();
      void audio?.resume();
      music?.resume();
    },
  };
}

const percent = (done: number, total: number): number => (total > 0 ? Math.floor((done * 100) / total) : 0);

/**
 * Bilan de fin de niveau (`gm_screen_level_complete` `004194b0`) : scores, temps, `valeur × 100 / total` en entiers, et l'état d'arrivée
 * du joueur (`FUN_0043cd14` : munitions, énergie, véhicule, score, niveau du canon) reporté sur la mission suivante.
 */
export function summarize(world: World, seconds: number, request: Pick<LevelRequest, "form"> = {}): LevelStats {
  const g = world.game;
  const form = world.player.form;
  const state: MissionState = {
    ammo: Array.from({ length: AMMO_SLOTS }, (_, k) => g.ammo[k] ?? 0),
    score: g.score,
    // Pendant la séquence de victoire le joueur peut avoir pris une forme de scénario (0x2a, 0x2b) : on garde alors celle du départ.
    form: form >= 0 && form <= 5 ? form : (request.form ?? 0),
    energy: Math.max(1, world.player.obj.hp),
    cannonPower: g.power,
  };
  return {
    seconds,
    levelScore: g.levelScore,
    score: g.score,
    objectivesPercent: percent(g.objectivesDestroyed, g.objectivesRegistered),
    bonusPercent: percent(g.pickedPlaced, g.bonusPlaced),
    secretsPercent: percent(g.pickedDropped, g.bonusDropped),
    bonusTotal: g.bonusPlaced,
    secretsTotal: g.bonusDropped,
    state,
    endCounter: g.endCounter,
  };
}
