import "./style.css";
import { TrackPlayer } from "../../../audio/track-player";
import { fetchGameFiles } from "../../../data/game-files";
import { FixedStepClock } from "../../../engine/clock";
import { h } from "../../../ui/dom";
import { MissingFilesError, fetchBytes } from "../../../ui/files";
import { mountGameShell } from "../../../ui/game-shell";
import { paletteToLut, IndexedPresenter } from "../../../ui/indexed-canvas";
import { localStorageStore } from "../../../ui/local-storage";
import { bindKeyboard } from "../../../ui/pointer";
import { SoundPrefs, soundPrefKey } from "../../../ui/sound-prefs";
import { mountTouchControls } from "../../../ui/touch-controls";
import { MusicSystem, SoundSystem, WebAudioSoundSink } from "../audio";
import { copy } from "../copy";
import { parseBd } from "../data/bd";
import { parseGlobal } from "../data/global";
import { parseLevel } from "../data/level";
import { parseSoundBank } from "../data/sounds";
import { World, loadModels } from "../engine/world";
import { createRenderAssets } from "../render/assets";
import { createRenderer } from "../render/renderer";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/view";
import { Controls } from "./controls";
import { SoundBridge } from "./sound-bridge";
import { ViewBuilder } from "./view";

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `/swiv3d`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Niveau à jouer (`TERRAN00` par défaut ; `TERRAN01`…`TERRAN03`, `DEMO`). */
  level?: string;
  /** Expose `window.__swiv3d` (monde, commandes, mesures) et affiche les mesures sous l'écran (page de dev). */
  debug?: boolean;
}

const GAME_ID = "swiv3d";
const DEFAULT_LEVEL = "TERRAN00";
/** Pas de la simulation : 25 ms (40 Hz, `docs/swiv3d/player.md` §1). */
const TICK_MS = 25;
/** Ticks rattrapés au plus en une image : au-delà (machine lente), le temps perdu est abandonné. */
const MAX_CATCH_UP_TICKS = 5;
/**
 * Le tampon fait 320×400 (mode X double ligne) mais s'affiche en 4:3 (pixels non carrés) : le shell dimensionne le canvas d'après
 * un cadre logique 320×240, la hauteur du tampon est posée ensuite.
 */
const DISPLAY_HEIGHT = 240;

/** Mesures de la page de dev (`window.__swiv3d.stats`). */
export interface AppStats {
  /** Moyenne glissante du temps de rendu (ms). */
  renderMs: number;
  /** Moyenne glissante du temps d'une image du navigateur (ms). */
  frameMs: number;
  /** Ticks simulés depuis le début. */
  ticks: number;
}

/**
 * Monte le jeu dans la page commune des jeux sur canvas (`ui/game-shell.ts`) : niveau, hélicoptère piloté à 40 Hz, caméra de
 * poursuite, rendu logiciel à chaque image du navigateur, son (moteur, événements) et musique du niveau. Pause quand l'onglet est masqué
 * ou sur la touche Pause. La vague J y mettra l'écran titre et les menus devant.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  const levelName = (options.level ?? DEFAULT_LEVEL).toUpperCase();
  const controls = new Controls();
  const touch = mountTouchControls({
    sink: controls.touchSink,
    stick: { label: copy.stickLabel },
    buttons: [
      { id: "fire", label: copy.fire },
      { id: "special", label: copy.special },
      { id: "next", label: copy.weaponNext },
      { id: "brake", label: copy.brake },
    ],
  });
  const pauseOverlay = h("div", { class: "game-shell-overlay sw3-pause", role: "status" }, h("p", {}, copy.paused), h("p", { class: "sw3-pause-hint" }, copy.resumeHint));
  pauseOverlay.style.display = "none";
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: DISPLAY_HEIGHT,
    copy,
    backLabel: options.backLabel,
    classes: { root: "sw3", stage: "sw3-stage", canvas: "sw3-canvas" },
    stageChildren: [touch.element, pauseOverlay],
  });
  shell.canvas.height = SCREEN_HEIGHT;
  const store = localStorageStore();

  let world: World;
  let renderer: ReturnType<typeof createRenderer>;
  let sound: SoundSystem | null = null;
  let audio: AudioContext | null = null;
  let music: MusicSystem | null = null;
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    const files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    const slvPath = files.resolve(`${levelName}.SLV`);
    if (!slvPath) throw new Error(`${copy.unknownLevel} ${levelName}`);
    const read = (name: string): Promise<Uint8Array> => {
      const path = files.resolve(name);
      if (!path) throw new MissingFilesError(`${name} : absent de files.json`);
      return fetchBytes(options.base, path);
    };
    const [globalBytes, levelBytes, soundBytes] = await Promise.all([read("GLOBAL.BD"), fetchBytes(options.base, slvPath), read("SOUNDS.BD")]);

    const level = parseLevel(levelBytes, levelName);
    const models = loadModels(levelBytes, levelName);
    const global = parseGlobal(parseBd(globalBytes, "GLOBAL.BD"));
    renderer = createRenderer(createRenderAssets({ level, models: [...models.values()], global }));
    // Lissage de la caméra à chaque image du navigateur (`updateCamera`), pas à chaque tick.
    world = World.load(level, models, { cameraFps: 0 });

    try {
      audio = new AudioContext();
      sound = new SoundSystem(parseSoundBank(soundBytes), new WebAudioSoundSink(audio));
      music = new MusicSystem(new TrackPlayer(), options.base);
    } catch (error) {
      // Pas de Web Audio : le jeu reste jouable en silence.
      console.warn(error);
    }
  } catch (error) {
    touch.dispose();
    shell.fail(error, "load");
    return;
  }

  const bridge = sound ? new SoundBridge(sound, music) : null;
  bridge?.attach(world, levelName);

  // --- Pause : onglet masqué ou touche Pause. Le son est suspendu, le jeu repart au même point (pas de rattrapage).
  const clock = new FixedStepClock({ tickMs: TICK_MS, maxCatchUpTicks: MAX_CATCH_UP_TICKS });
  let tabHidden = false;
  let userPaused = false;
  let wasPaused = false;
  const isPaused = (): boolean => tabHidden || userPaused;
  const applyPause = (): void => {
    const paused = isPaused();
    pauseOverlay.style.display = userPaused ? "" : "none";
    if (paused === wasPaused) return;
    wasPaused = paused;
    if (paused) {
      controls.clear();
      touch.reset();
      void audio?.suspend();
      music?.suspend();
    } else {
      void audio?.resume();
      music?.resume();
      clock.resync();
    }
  };
  pauseOverlay.addEventListener("pointerdown", () => {
    userPaused = false;
    applyPause();
    shell.focusCanvas();
  });

  // Débloque le son à chaque geste tant que le jeu n'est pas en pause.
  const unlock = (): void => {
    if (isPaused()) return;
    void audio?.resume();
    music?.unlock();
  };
  unlock();
  const muteTarget = {
    setMuted: (muted: boolean): void => {
      if (sound) sound.muted = muted;
      if (music) music.muted = muted;
    },
  };
  const prefs = new SoundPrefs(store, muteTarget, GAME_ID);
  shell.canvas.addEventListener("pointerdown", unlock);
  const detachKeyboard = bindKeyboard(
    shell.canvas,
    {
      keyDown: (event) => controls.keyDown(event),
      keyUp: (event) => controls.keyUp(event),
      blur: () => controls.clear(),
    },
    unlock,
  );

  // --- Mesures (page de dev)
  const stats: AppStats = { renderMs: 0, frameMs: 0, ticks: 0 };
  const statsLine = options.debug ? h("span", { class: "sw3-stats" }) : null;
  if (statsLine) shell.footer.append(statsLine);
  if (options.debug) (window as unknown as { __swiv3d: unknown }).__swiv3d = { world, controls, stats, renderer, sound, music, audio };

  const presenter = IndexedPresenter.forCanvas(shell.canvas, SCREEN_WIDTH, SCREEN_HEIGHT);
  const palette = paletteToLut(renderer.palette);
  const framebuffer = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  const views = new ViewBuilder();
  let lastNow = 0;

  shell.start({
    onPause: (hidden) => {
      tabHidden = hidden;
      applyPause();
    },
    sound: { prefs, storageKey: soundPrefKey(GAME_ID), unlock },
    onDispose: () => {
      detachKeyboard();
      touch.dispose();
      sound?.stopAll();
      music?.stop();
      void audio?.close();
    },
    onFrame: (now) => {
      const dt = lastNow === 0 ? 0 : now - lastNow;
      lastNow = now;
      if (dt > 0 && dt < 500) stats.frameMs = stats.frameMs === 0 ? dt : stats.frameMs * 0.95 + dt * 0.05;
      if (tabHidden) return;
      controls.poll();
      if (controls.takePauseRequest()) {
        userPaused = !userPaused;
        applyPause();
      }
      if (userPaused) return;

      clock.update(now);
      while (clock.consume()) {
        world.tick(controls.sample());
        stats.ticks++;
      }
      // Cadence d'image estimée pour le lissage de la caméra (`k = max(1, fps / 4)`, bornée comme l'exe : au moins 5).
      world.updateCamera(Math.max(5, Math.min(240, stats.frameMs > 0 ? 1000 / stats.frameMs : 60)));
      bridge?.handle(world.drainEvents());

      const view = views.build(world);
      const start = performance.now();
      renderer.render(view, framebuffer);
      const renderMs = performance.now() - start;
      stats.renderMs = stats.renderMs === 0 ? renderMs : stats.renderMs * 0.95 + renderMs * 0.05;
      presenter.present(framebuffer, palette);
      bridge?.update(view.camera);
      if (statsLine) statsLine.textContent = `rendu ${stats.renderMs.toFixed(1)} ms · image ${stats.frameMs.toFixed(1)} ms · ${stats.ticks} ticks`;
    },
  });
}
