import "./style.css";
import { TrackPlayer } from "../../../audio/track-player";
import { fetchGameFiles } from "../../../data/game-files";
import { prefixedStorage } from "../../../engine/storage";
import { h } from "../../../ui/dom";
import { MissingFilesError, fetchBytes } from "../../../ui/files";
import { leaveGame, mountGameShell } from "../../../ui/game-shell";
import { isRotated } from "../../../ui/fullscreen";
import { IndexedPresenter, paletteToLut } from "../../../ui/indexed-canvas";
import { localStorageStore } from "../../../ui/local-storage";
import { bindKeyboard, toLogical } from "../../../ui/pointer";
import { SoundPrefs, soundPrefKey } from "../../../ui/sound-prefs";
import { mountTouchControls } from "../../../ui/touch-controls";
import { MusicSystem, SoundSystem, WebAudioSoundSink } from "../audio";
import { copy } from "../copy";
import { parseBd } from "../data/bd";
import { parseGlobal } from "../data/global";
import { parseSoundBank } from "../data/sounds";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/view";
import { parseBriefing, drawBriefing, type BriefingText } from "../screens/briefing";
import { Flow, type FlowHost, type FlowView, type LevelRequest } from "../screens/flow";
import { keyLabel } from "../screens/key-names";
import { AMMO_SLOTS, PilotStore } from "../screens/pilots";
import { TextRenderer } from "../screens/text";
import { Controls, DEFAULT_KEYS, type Action } from "./controls";
import { startLevel, createPauseOverlay, type AppStats, type LevelServices, type LevelSession } from "./level-session";
import { UiInputCollector } from "./ui-input";
import { VideoPlayer } from "./video";
import { VolumeSink } from "./volume-sink";

export type { AppStats } from "./level-session";

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `/swiv3d`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Page de dev : joue ce niveau tout de suite (`TERRAN00`…`TERRAN03`, `DEMO`), sans démarrage ni menus. */
  level?: string;
  /** Page de dev : passe la séquence de démarrage (vidéos, logos) et ouvre la sélection du pilote. */
  skipBoot?: boolean;
  /** Expose `window.__swiv3d` (flux, monde, commandes, mesures), les touches F8 / F9 (game over / mission accomplie) et les mesures sous l'écran. */
  debug?: boolean;
}

const GAME_ID = "swiv3d";
/**
 * Le tampon fait 320×400 (mode X double ligne) mais s'affiche en 4:3 (pixels non carrés) : le shell dimensionne le canvas d'après
 * un cadre logique 320×240, la hauteur du tampon est posée ensuite.
 */
const DISPLAY_HEIGHT = 240;
const BLACK_PALETTE = new Uint32Array(256).fill(0xff000000);

/** Commandes du niveau de fond (menus) : rien n'est lu au clavier ni à la manette. */
class IdleControls extends Controls {
  override poll(): void {}
}

interface VideoState {
  view: Extract<FlowView, { kind: "video" }>;
  player: VideoPlayer | null;
  texts: BriefingText[];
  done: boolean;
  frame: number;
}

/**
 * Monte le jeu dans la page commune des jeux sur canvas (`ui/game-shell.ts`) : orchestre les écrans (`screens/flow.ts`) : démarrage,
 * menus sur le décor de `DEMO.SLV`, briefings en vidéo avec les textes `.SCR`, niveaux (`ui/level-session.ts`), fins de mission.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
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
  touch.element.style.display = "none";
  const pauseOverlay = createPauseOverlay(copy.paused, copy.resumeHint);
  const startButton = h("button", { type: "button", class: "primary" }, copy.startButton);
  const startOverlay = h("div", { class: "game-shell-overlay sw3-start", role: "dialog" }, h("p", {}, copy.startPrompt), startButton);
  startOverlay.style.display = "none";
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: DISPLAY_HEIGHT,
    copy,
    backLabel: options.backLabel,
    classes: { root: "sw3", stage: "sw3-stage", canvas: "sw3-canvas" },
    stageChildren: [touch.element, pauseOverlay, startOverlay],
  });
  shell.canvas.height = SCREEN_HEIGHT;
  const store = localStorageStore();
  const pilotStore = new PilotStore(prefixedStorage(store, `${GAME_ID}:`));

  // --- Chargement : fichiers communs et décor des menus ----------------------------------------------------------------
  const framebuffer = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  const stats: AppStats = { renderMs: 0, frameMs: 0, ticks: 0 };
  let files: Awaited<ReturnType<typeof fetchGameFiles>>;
  let global: ReturnType<typeof parseGlobal>;
  let audio: AudioContext | null = null;
  let sound: SoundSystem | null = null;
  let music: MusicSystem | null = null;
  let effectsSink: VolumeSink | null = null;
  let musicElement: HTMLAudioElement | null = null;
  let videoGain: GainNode | null = null;
  let demo: LevelSession;
  const read = (name: string): Promise<Uint8Array> => {
    const path = files.resolve(name);
    if (!path) throw new MissingFilesError(`${name} : absent de files.json`);
    return fetchBytes(options.base, path);
  };
  const services = (): LevelServices => ({
    read,
    global,
    sound,
    music,
    audio,
    controls,
    touch,
    pauseOverlay,
    focusCanvas: shell.focusCanvas,
    framebuffer,
    stats,
  });
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    const [globalBytes, soundBytes] = await Promise.all([read("GLOBAL.BD"), read("SOUNDS.BD")]);
    global = parseGlobal(parseBd(globalBytes, "GLOBAL.BD"));
    try {
      audio = new AudioContext();
      effectsSink = new VolumeSink(new WebAudioSoundSink(audio));
      sound = new SoundSystem(parseSoundBank(soundBytes), effectsSink);
      musicElement = new Audio();
      const element = musicElement;
      music = new MusicSystem(new TrackPlayer(() => element), options.base);
      videoGain = audio.createGain();
      videoGain.connect(audio.destination);
    } catch (error) {
      // Pas de Web Audio : le jeu reste jouable en silence.
      console.warn(error);
    }
    // Décor des menus : `DEMO.SLV`, sans son ni musique (la musique des menus vient du flux), commandes inertes.
    demo = await startLevel(
      { ...services(), sound: null, music: null, controls: new IdleControls(), pauseOverlay: document.createElement("div"), stats: { renderMs: 0, frameMs: 0, ticks: 0 } },
      { name: "DEMO", hud: false },
    );
  } catch (error) {
    touch.dispose();
    shell.fail(error, "load");
    return;
  }

  const presenter = IndexedPresenter.forCanvas(shell.canvas, SCREEN_WIDTH, SCREEN_HEIGHT);
  // Deux tables de mélange : celle de GLOBAL.BD (800) est calée sur la palette des vidéos ; devant un niveau (menus sur DEMO.SLV, écrans de
  // fin), c'est la table 108 du niveau qui va avec la palette du niveau (la 800 donnerait du bruit).
  const videoText = new TextRenderer(global.font, global.blendTable);
  const text = new TextRenderer(global.font, demo.world.level.fadeTable);
  const demoTable = demo.world.level.fadeTable;
  let frozenTable = demoTable;
  const collector = new UiInputCollector();

  // --- Volumes (§4.6) : principal × musique, principal × effets, principal pour le son des vidéos ----------------------------------
  let volumes = { master: 255, music: 255, effects: 255 };
  let muted = false;
  const applyVolumes = (v: { master: number; music: number; effects: number }): void => {
    volumes = { ...v };
    const master = v.master / 255;
    effectsSink?.setScale(master * (v.effects / 255));
    if (musicElement) musicElement.volume = master * (v.music / 255);
    if (videoGain) videoGain.gain.value = muted ? 0 : master;
  };

  // --- Niveau en cours ---------------------------------------------------------------------------------------------------------
  const frozen = new Uint8Array(framebuffer.length);
  let frozenLut: Uint32Array = BLACK_PALETTE;
  let levelLut: Uint32Array = BLACK_PALETTE;
  let levelSession: LevelSession | null = null;
  let loadToken = 0;
  let freezeAfterFrame = false;
  let flow!: Flow;

  const beginLevel = async (request: LevelRequest): Promise<void> => {
    const token = ++loadToken;
    try {
      const { vars } = request;
      const session = await startLevel(services(), {
        name: request.name,
        mission: request.mission,
        language: flow.language,
        hitPoints: vars.get(1),
        form: vars.get(0),
        score: vars.get(2),
        ammo: Array.from({ length: AMMO_SLOTS }, (_, k) => vars.get(100 + k) ?? 0),
        cannonPower: request.state?.cannonPower,
      });
      if (token !== loadToken) {
        session.dispose();
        return;
      }
      levelSession = session;
      levelLut = session.palette;
      session.events.levelComplete.push(() => {
        freezeAfterFrame = true;
        flow.levelEnded("complete", session.summary());
      });
      session.events.gameOver.push(() => {
        freezeAfterFrame = true;
        flow.levelEnded("gameOver", session.summary());
      });
      session.events.quit.push(() => flow.abortRequested());
      touch.element.style.display = "";
      shell.focusCanvas();
    } catch (error) {
      if (token !== loadToken) return;
      console.error(error);
      flow.levelFailed();
    }
  };
  const endLevel = (): void => {
    loadToken++;
    levelSession?.dispose();
    levelSession = null;
    touch.element.style.display = "none";
    controls.clear();
  };

  const host: FlowHost = {
    sound: (n) => void sound?.play({ sound: n, x: 0, y: 0, z: 0, spatial: false }),
    music: (context) => music?.setContext(context),
    musicPreference: (preference) => music?.setPreference(preference),
    volumes: applyVolumes,
    startLevel: (request) => void beginLevel(request),
    endLevel,
    pauseLevel: (paused) => {
      if (paused) {
        frozen.set(framebuffer);
        frozenLut = levelLut;
        frozenTable = levelSession?.world.level.fadeTable ?? demoTable;
      }
      levelSession?.setPaused(paused);
    },
    hasLevel: (name) => files.resolve(`${name}.SLV`) !== undefined,
    leave: () => leaveGame(options.backLabel, restart),
    askName: (current) => window.prompt(copy.namePrompt, current),
  };
  const restart = (): void => {
    shell.dispose();
    void mountApp(container, options);
  };

  flow = new Flow(
    {
      strings: global.strings,
      script: global.missions,
      text,
      store: pilotStore,
      bindingLabel: (action, language) => keyLabel(DEFAULT_KEYS[action as Action]?.[0] ?? "", language),
    },
    host,
    !options.skipBoot && !options.level,
  );
  if (options.level) {
    const pilot = pilotStore.get(0) ?? pilotStore.create("DEV", 1);
    if (pilot) flow.playLevelDirect(options.level.toUpperCase(), pilot);
  }

  // --- Vidéos et écrans fixes ------------------------------------------------------------------------------------------------
  const videoBytes = new Map<string, Promise<Uint8Array>>();
  const loadVideo = (name: string): Promise<Uint8Array> => {
    let bytes = videoBytes.get(name);
    if (!bytes) {
      bytes = read(`${name}.SMK`);
      videoBytes.set(name, bytes);
      // Une erreur de chargement ne doit pas rester en cache : la lecture suivante réessaie.
      bytes.catch(() => videoBytes.delete(name));
    }
    return bytes;
  };
  /** Les vidéos du démarrage se chargent pendant la précédente. */
  const PREFETCH: Record<string, string> = { IPLAY: "INTRO1", INTRO1: "INTRO2" };
  const videoFb = new Uint8Array(framebuffer.length);
  let videoLut: Uint32Array = BLACK_PALETTE;
  let video: VideoState | null = null;
  const screenCache = new Map<number, { pixels: Uint8Array; lut: Uint32Array }>();

  const startVideo = (view: Extract<FlowView, { kind: "video" }>): VideoState => {
    const state: VideoState = { view, player: null, texts: [], done: false, frame: 1 };
    const next = PREFETCH[view.name];
    void (async () => {
      try {
        const [bytes, scr] = await Promise.all([loadVideo(view.name), view.overlay ? read(`${view.name}.SCR`) : Promise.resolve(null)]);
        if (state.done) return;
        state.texts = scr ? parseBriefing(scr) : [];
        state.player = new VideoPlayer(bytes, audio && videoGain ? { ctx: audio, destination: videoGain } : null);
        if (next) void loadVideo(next).catch(() => {});
      } catch (error) {
        console.error(error);
        if (!state.done) {
          state.done = true;
          flow.videoEnded(true);
        }
      }
    })();
    return state;
  };

  // --- Démarrage du jeu : le navigateur n'autorise le son qu'après un geste ------------------------------------------------------
  const muteTarget = {
    setMuted: (value: boolean): void => {
      if (sound) sound.muted = value;
      if (music) music.muted = value;
      muted = value;
      if (videoGain) videoGain.gain.value = value ? 0 : volumes.master / 255;
    },
  };
  const prefs = new SoundPrefs(store, muteTarget, GAME_ID);
  let tabHidden = false;
  const unlock = (): void => {
    if (tabHidden) return;
    void audio?.resume();
    music?.unlock();
  };
  let started = options.skipBoot === true || options.level !== undefined;
  if (!started) {
    // IPLAY (8 Mo) se charge pendant que le joueur lit l'invite.
    void loadVideo("IPLAY").catch(() => {});
    startOverlay.style.display = "";
    startButton.addEventListener("click", () => {
      startOverlay.style.display = "none";
      started = true;
      unlock();
      shell.focusCanvas();
    });
  }
  unlock();

  // --- Entrées -----------------------------------------------------------------------------------------------------------------------
  shell.canvas.addEventListener("pointerdown", (event) => {
    unlock();
    if (!started || flow.view.kind === "level") return;
    const p = toLogical(event.clientX, event.clientY, shell.canvas.getBoundingClientRect(), { width: SCREEN_WIDTH, height: SCREEN_HEIGHT }, isRotated(shell.main));
    collector.tap(p.x, p.y);
  });
  const detachKeyboard = bindKeyboard(
    shell.canvas,
    {
      keyDown: (event) => {
        if (!started) return false;
        const session = flow.view.kind === "level" ? levelSession : null;
        if (!session) return collector.keyDown(event);
        if (options.debug && event.code === "F9") return void session.complete(), true;
        if (options.debug && event.code === "F8") return void session.gameOver(), true;
        if (event.code === "Escape") return void session.requestQuit(), true;
        return controls.keyDown(event);
      },
      keyUp: (event) => controls.keyUp(event),
      blur: () => controls.clear(),
    },
    unlock,
  );

  // --- Image ---------------------------------------------------------------------------------------------------------------------------
  let lastView: FlowView | null = null;
  const present = (lut: Uint32Array): void => presenter.present(framebuffer, lut);

  const renderVideo = (now: number, view: Extract<FlowView, { kind: "video" }>): void => {
    if (!video || video.view !== view) video = startVideo(view);
    const state = video;
    if (!state.player) {
      framebuffer.fill(0);
      return present(BLACK_PALETTE);
    }
    const info = state.player.update(now, videoFb);
    if (info) {
      videoLut = paletteToLut(info.palette);
      state.frame = info.number;
    }
    framebuffer.set(videoFb);
    if (state.texts.length > 0) drawBriefing(framebuffer, videoText, global.strings, flow.language, state.texts, state.frame, view.mission);
    present(videoLut);
    if (state.player.ended && !state.done) {
      state.done = true;
      flow.videoEnded(false);
    }
  };

  const renderScreen = (id: number): void => {
    let cached = screenCache.get(id);
    if (!cached) {
      const screen = global.screen(id);
      cached = { pixels: screen.pixels, lut: paletteToLut(screen.palette) };
      screenCache.set(id, cached);
    }
    framebuffer.set(cached.pixels);
    present(cached.lut);
  };

  const onFrame = (now: number): void => {
    collector.pollGamepad();
    let input = collector.take();
    if (!started) return;

    // Touche ou clic pendant une vidéo : elle s'arrête (l'appui ne sert pas deux fois).
    if (flow.view.kind === "video" && input.pressed) {
      if (!video || video.view !== flow.view) video = startVideo(flow.view);
      if (!video.done) {
        video.done = true;
        video.player?.stop();
        flow.videoEnded(true);
        input = { keys: [], chars: [], taps: [], pressed: false };
      }
    }
    flow.update(now, input);

    const view = flow.view;
    if (view !== lastView) {
      if (lastView?.kind === "video") video?.player?.stop();
      lastView = view;
    }
    switch (view.kind) {
      case "none":
        break;
      case "video":
        renderVideo(now, view);
        break;
      case "hold":
        framebuffer.set(videoFb);
        present(videoLut);
        break;
      case "screen":
        renderScreen(view.id);
        break;
      case "level":
        if (levelSession) {
          levelSession.onFrame(now);
          present(levelLut);
          // Fin de niveau détectée pendant cette image : elle sert de fond à l'écran de fin.
          if (freezeAfterFrame) {
            frozen.set(framebuffer);
            frozenLut = levelLut;
            frozenTable = levelSession.world.level.fadeTable;
            freezeAfterFrame = false;
          }
        }
        break;
      case "menu": {
        // Les aplats se mélangent à l'image déjà présente : le fond est refait à chaque image.
        text.blend = view.backdrop === "demo" ? demoTable : frozenTable;
        if (view.backdrop === "demo") {
          demo.onFrame(now);
          view.menu.draw(framebuffer);
          present(demo.palette);
        } else {
          // Fin de niveau déclenchée hors image (touche de dev) : le tampon tient encore la dernière image du niveau.
          if (freezeAfterFrame) {
            frozen.set(framebuffer);
            frozenLut = levelLut;
            frozenTable = levelSession?.world.level.fadeTable ?? frozenTable;
            freezeAfterFrame = false;
          }
          text.blend = frozenTable;
          framebuffer.set(frozen);
          view.menu.draw(framebuffer);
          present(frozenLut);
        }
        break;
      }
    }
    if (statsLine) {
      statsLine.textContent = levelSession ? `rendu ${stats.renderMs.toFixed(1)} ms · image ${stats.frameMs.toFixed(1)} ms · ${stats.ticks} ticks` : "";
    }
  };

  // --- Mesures (page de dev) ---------------------------------------------------------------------------------------------------------
  const statsLine = options.debug ? h("span", { class: "sw3-stats" }) : null;
  if (statsLine) shell.footer.append(statsLine);
  if (options.debug) {
    Object.defineProperty(window, "__swiv3d", {
      configurable: true,
      value: {
        flow,
        controls,
        stats,
        sound,
        music,
        audio,
        collector,
        get world() {
          return levelSession?.world ?? null;
        },
        get renderer() {
          return levelSession?.renderer ?? null;
        },
        get level() {
          return levelSession;
        },
        get demo() {
          return demo;
        },
      },
    });
  }

  shell.start({
    onPause: (hidden) => {
      tabHidden = hidden;
      levelSession?.onPause(hidden);
      if (hidden) {
        void audio?.suspend();
        music?.suspend();
      } else if (!levelSession) {
        void audio?.resume();
        music?.resume();
      }
    },
    sound: { prefs, storageKey: soundPrefKey(GAME_ID), unlock },
    onDispose: () => {
      detachKeyboard();
      touch.dispose();
      video?.player?.stop();
      levelSession?.dispose();
      demo.dispose();
      sound?.stopAll();
      music?.stop();
      void audio?.close();
    },
    onFrame,
  });
}
