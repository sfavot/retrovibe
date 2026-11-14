import { type PointClickAppOptions, type PointClickGame, mountPointClickApp } from "../../../ui/point-click-app";
import { createSoundPrefs } from "../audio/audio";
import { copy } from "../copy";
import { createBassEngine } from "../create";
import { type BassEngine, TICK_MS } from "../engine/game";
import { INVENTORY_TRIGGER, SF } from "../engine/ids";
import type { SaveData } from "../engine/save";
import { CursorOverlay } from "../render/cursor";
import { BrowserHost } from "./browser-host";
import { renderHelp } from "./help";
import { INVENTORY_BAR_HEIGHT, SCREEN_HEIGHT, SCREEN_WIDTH, canOpenInventory, tapKind } from "./input";
import { keyAction } from "./keys";
import { BassLoop } from "./loop";
import { createVoiceFiles, fetchBassFiles, loadBassData } from "./preload";
import { SAVE_PREFIX, createSaveSlots, loadFromSlot, resultMessage, saveToSlot, summarizeSlots } from "./saves";
import { readSettings, writeSettings } from "./settings";
import { createWebMusicOutput } from "./web-music";

/** `debug` expose `window.__bass` (`game`, `loop`, `host`, `slots`, `step(n)`) pour la console (page de dev). */
export type AppOptions = PointClickAppOptions<SaveData>;

/** Ticks rattrapés au plus en une image d'écran (320 ms) : au-delà (onglet gelé), le temps perdu est abandonné. */
export const MAX_CATCH_UP_TICKS = 16;

/**
 * Ce qui est propre à *Beneath a Steel Sky* dans la page des jeux de pointer-et-cliquer (`ui/point-click-app.ts`). `sky.dsk`, `sky.dnr`
 * et `sky.cpt` (13,7 Mo) sont chargés d'un coup avant de construire le moteur ; les voix (`voices/<id>.mp3`) sont lues à la demande. L'hôte
 * bat à 20 ms (`TICK_MS`) : l'introduction du CD, puis le moteur, qui lance un tour de jeu tous les `gameSpeed` ms.
 */
const bass: PointClickGame<SaveData> = {
  id: "bass",
  copy,
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  tickMs: TICK_MS,
  maxCatchUpTicks: MAX_CATCH_UP_TICKS,
  renderHelp,
  async load(ctx) {
    const { options, store } = ctx;
    // Le son se débloque dans le geste qui a lancé le jeu : la sortie est créée et débloquée avant le chargement, qui peut durer plus
    // que la validité du geste.
    const music = createWebMusicOutput();
    music.unlock();
    const storage = ctx.slotsStorage(SAVE_PREFIX);
    const slots = createSaveSlots(storage);
    const files = await ctx.manifest(fetchBassFiles);
    const data = await loadBassData(files, ctx.fetcher, ctx.setPercent);

    // Dialogue du site demandé par le moteur (panneau ou `fnRestoreGame`) : la fenêtre s'ouvre après les ticks de l'image.
    let pending: "save" | "restore" | undefined;
    // Une fenêtre ouverte pour le moteur : à sa fermeture, `finishDialog` rend la main au jeu (le prochain `afterTicks` suit la fermeture,
    // la page ne tourne pas tant qu'une fenêtre est ouverte).
    let dialogOpen = false;
    // « Recommencer » choisi à la fin d'une partie perdue : attend la fin du tour de logique en cours.
    let wantRestart = false;
    // Fenêtre de fin de partie à rouvrir (la restitution a été annulée).
    let reoffer = false;
    // La barre d'inventaire a été ouverte par un toucher.
    let barOpen = false;
    // Le moteur n'existe qu'après l'hôte : les boutons tenus (`Mouse.held`, que `fnLookAt` attend) lui sont transmis une fois créé.
    let engineRef: BassEngine | undefined;

    const host: BrowserHost = new BrowserHost({
      storage,
      onExit: ctx.toTitle,
      onSaveRequest: () => (pending = "save"),
      onRestoreRequest: () => (pending = "restore"),
      onSettings: (settings) => writeSettings(store, settings),
      onVolume: (level) => music.setVolume(level),
      onButtons: (mask) => {
        if (engineRef) engineRef.mouse.held = mask;
      },
    });
    ctx.restoreVolume(host);
    const seed = 1 + Math.floor(Math.random() * 0x7ffffffe);
    const game = ctx.buildEngine(() => {
      // Une partie reprise commence dans le jeu ; une nouvelle partie joue l'introduction du CD (passable).
      const created = createBassEngine(data, host, { render: true, audio: { voices: createVoiceFiles(files, ctx.fetcher), music }, intro: options.restore ? undefined : {}, seed });
      if (options.restore) {
        created.engine.startAfterIntro();
        if (!created.engine.control.load(options.restore)) throw new Error("sauvegarde illisible");
      }
      return created;
    });
    const { engine, audio } = game;
    engineRef = engine;
    if (!audio) throw new Error("son indisponible");
    host.bindAudio(audio);
    audio.unlock();
    // Réglages du panneau mémorisés : remis sans notifier l'hôte, et de nouveau quand le jeu commence (la remise à zéro du départ les écrase).
    const applySettings = (): void => {
      const saved = readSettings(store);
      if (saved) engine.control.applySettings(saved);
    };
    applySettings();
    const overlay = new CursorOverlay((id) => (data.disk.has(id) ? data.disk.load(id) : null));
    const loop = new BassLoop({
      game,
      overlay,
      present: (pixels, palette) => ctx.presenter.present(pixels, palette),
      touchMode: () => host.input.touchMode,
      onGameStart: applySettings,
    });
    if (options.restore) applySettings();

    /** Ouvre la fenêtre de fin de partie : recommencer, ou restituer une partie sauvegardée (annulée, la fenêtre revient). */
    const offerEnd = (): void => {
      if (!slots.latest()) {
        wantRestart = true;
        dialogOpen = true;
        return;
      }
      dialogOpen = true;
      ctx.openChoice({
        title: copy.endTitle,
        text: copy.endText,
        primary: copy.endRestart,
        secondary: copy.endRestore,
        choose(choice) {
          if (choice === "primary") wantRestart = true;
          else ctx.openLoad(() => (reoffer = true));
        },
        cancel: () => (wantRestart = true),
      });
    };

    return {
      engine: loop,
      host,
      prefs: createSoundPrefs(store, audio),
      slots: {
        summaries: () => summarizeSlots(slots),
        save(slot) {
          const result = saveToSlot(engine.control, slots, slot, Date.now());
          return { ok: result === "saved", message: resultMessage(result, "save") };
        },
        load(slot) {
          // Pendant l'introduction, le jeu n'a pas encore commencé : on la passe d'abord (le moteur est à l'arrêt, fenêtre ouverte).
          loop.endIntro();
          const result = loadFromSlot(engine.control, slots, slot);
          return { ok: result === "loaded", message: resultMessage(result, "load") };
        },
      },
      // « Passer » : l'introduction, sinon la réplique en cours (la touche point).
      skip: () => host.input.action(loop.introRunning ? "skip" : "skipLine"),
      // « Inventaire » : comme un toucher dans la bande du haut (pointeur sur la ligne 0 ; la barre reste ouverte jusqu'au toucher suivant
      // ailleurs). Pas pendant l'introduction, un choix de dialogue, le panneau ou un pointeur verrouillé.
      inventory: {
        canOpen: () =>
          canOpenInventory({
            introRunning: loop.introRunning,
            choosing: loop.choosing,
            frozen: engine.control.frozen,
            locked: (engine.system.systemFlags & SF.MOUSE_LOCKED) !== 0,
          }),
        open() {
          barOpen = true;
          host.input.openInventory(SCREEN_WIDTH / 2);
        },
      },
      tap(button, x, y) {
        if (loop.introRunning) {
          // Un toucher passe l'introduction, comme un clic de souris.
          host.input.action("skip");
          return;
        }
        const flags = engine.system.systemFlags;
        const nearBar = engine.pointer.y < INVENTORY_BAR_HEIGHT;
        const zone = engine.mouse.zoneAt(x, y);
        const kind = tapKind(button, y, {
          barOpen: barOpen && nearBar,
          choosing: loop.choosing,
          frozen: engine.control.frozen,
          locked: (flags & SF.MOUSE_LOCKED) !== 0,
          // La zone de 320 x 1 du haut de l'écran n'est que le déclencheur de la barre : ce n'est pas une zone « sous le doigt ».
          zoneUnder: zone !== null && zone !== INVENTORY_TRIGGER,
        });
        if (kind === "bar") {
          barOpen = true;
          host.input.openInventory(x);
          return;
        }
        // Toucher dans la barre ouverte : elle reste ouverte ; ailleurs, ce toucher la referme et agit (comme une souris).
        barOpen = y < INVENTORY_BAR_HEIGHT && barOpen;
        host.input.tap(button, x, y);
      },
      key(event) {
        const action = keyAction(event);
        if (!action) return undefined;
        if (action.type === "host") return action.command === "menu" ? { engine: () => ctx.openMenu() } : { command: "volume" };
        return { engine: () => host.input.action(action.action) };
      },
      // Page de dev : `step(n)` avance de `n` ticks à la main et repeint (un onglet masqué ou ralenti ne reçoit pas toutes les images).
      debug: {
        game,
        loop,
        host,
        slots,
        step: (ticks = 1) => {
          for (let i = 0; i < ticks; i++) loop.tick();
          loop.render();
          host.update();
        },
      },
      afterTicks() {
        host.update();
        // Une fenêtre ouverte pour le moteur vient de se fermer : le jeu reprend la main (ou la fin de partie revient).
        if (dialogOpen) {
          dialogOpen = false;
          if (reoffer) {
            reoffer = false;
            offerEnd();
          } else if (!wantRestart) engine.control.finishDialog();
        }
        // « Recommencer » après une partie perdue : seulement quand aucun tour de logique n'est en cours.
        if (wantRestart && !engine.blocked) {
          wantRestart = false;
          engine.control.restartGame();
          engine.control.finishDialog();
          applySettings();
        }
        if (pending) {
          const request = pending;
          pending = undefined;
          if (request === "save") {
            dialogOpen = true;
            ctx.openSave();
          } else if (engine.control.panelOpen) {
            // Restitution demandée par le panneau : annulée, le panneau reprend la main.
            dialogOpen = true;
            ctx.openLoad();
          } else offerEnd();
        }
      },
    };
  },
};

/** Monte Beneath a Steel Sky dans la page des jeux de pointer-et-cliquer. */
export function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  return mountPointClickApp(container, options, bass);
}
