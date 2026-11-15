import { type PointClickAppOptions, type PointClickGame, mountPointClickApp } from "../../../ui/point-click-app";
import { TrackMusicOutput, VoyageursSound, createSoundPrefs } from "../audio/audio";
import { createWebOplOutput } from "../audio/web-output";
import { copy } from "../copy";
import { createVoyageursEngine } from "../create";
import { STEP_MS } from "../engine/game";
import type { VoyageursSave } from "../engine/save";
import { BrowserHost } from "./browser-host";
import { renderHelp } from "./help";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./input";
import { type KeyAction, keyDown, keyUp } from "./keys";
import { VoyageursLoop } from "./loop";
import { fetchVoyageursFiles, loadVoyageursFiles } from "./preload";
import { SAVE_PREFIX, createSaveSlots, loadFromSlot, resultMessage, saveToSlot, summarizeSlots } from "./saves";

/** `debug` expose `window.__voyageurs` (`game`, `loop`, `host`, `slots`, `step(n)`) pour la console (page de dev). */
export type AppOptions = PointClickAppOptions<VoyageursSave>;

/** Pas rattrapés au plus en une image d'écran (320 ms) : au-delà (onglet gelé), le temps perdu est abandonné. */
export const MAX_CATCH_UP_STEPS = 32;

/** Images d'écran pendant lesquelles une sauvegarde demandée par le menu du jeu attend que le moteur puisse la faire (environ 1 s). */
const SAVE_WAIT_FRAMES = 60;

/**
 * Ce qui est propre aux *Voyageurs du temps* dans la page des jeux de pointer-et-cliquer (`ui/point-click-app.ts`). Les six fichiers du
 * jeu (0,9 Mo) sont chargés d'un coup avant de construire le moteur ; la musique (`music/trackNN.mp3`) est lue en flux à la demande. L'hôte
 * bat à 10 ms (`STEP_MS`) : un tick de jeu dure 11 à 12 pas, plus les fondus et les attentes de clic.
 */
const voyageurs: PointClickGame<VoyageursSave> = {
  id: "voyageurs",
  copy,
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  tickMs: STEP_MS,
  maxCatchUpTicks: MAX_CATCH_UP_STEPS,
  renderHelp,
  async load(ctx) {
    const { options, store } = ctx;
    // Le son se débloque dans le geste qui a lancé le jeu : la sortie est créée et débloquée avant le chargement, qui peut durer plus
    // que la validité du geste.
    const audio = new VoyageursSound({
      now: () => performance.now(),
      music: new TrackMusicOutput({ trackUrl: (file) => `${options.base}/${file}` }),
      opl: createWebOplOutput(),
    });
    audio.unlock();
    const storage = ctx.slotsStorage(SAVE_PREFIX);
    const slots = createSaveSlots(storage);
    const files = await ctx.manifest(fetchVoyageursFiles);
    const data = await loadVoyageursFiles(files, ctx.fetcher, ctx.setPercent);

    // Demandes du menu système : le moteur les fait pendant que son menu est encore ouvert ; les fenêtres du site s'ouvrent après les pas de l'image.
    let pending: "save" | "load" | undefined;
    let saveWaited = 0;
    const host = new BrowserHost({
      files: data,
      storage,
      audio,
      onExit: ctx.toTitle,
      onSaveRequest: () => {
        pending = "save";
        saveWaited = 0;
      },
      onLoadRequest: () => (pending = "load"),
    });
    ctx.restoreVolume(host);
    const game = ctx.buildEngine(() => {
      const created = createVoyageursEngine(host, { seed: 1 + Math.floor(Math.random() * 0x7ffffffe) });
      if (options.restore) created.engine.load(options.restore);
      return created;
    });
    const { engine } = game;
    const loop = new VoyageursLoop({
      game,
      present: (pixels, palette) => ctx.presenter.present(pixels, palette),
      pointer: () => host.input.position,
      touchMode: () => host.input.touchMode,
    });
    const send = (action: KeyAction): void => {
      if (action.type === "action") host.input.action(action.action);
      else if (action.type === "walk") host.input.walk(action.dx, action.dy);
      else host.input.key(action.button, action.down);
    };

    return {
      engine: loop,
      host,
      prefs: createSoundPrefs(store, audio),
      slots: {
        summaries: () => summarizeSlots(slots),
        save(slot) {
          const result = saveToSlot(engine, slots, slot, Date.now());
          return { ok: result === "saved", message: resultMessage(result, "save") };
        },
        load(slot) {
          const result = loadFromSlot(engine, slots, slot);
          // Le moteur repart d'un état neuf : plus d'entrée en attente ni de bouton tenu dans l'hôte.
          if (result === "loaded") host.input.releaseAll();
          return { ok: result === "loaded", message: resultMessage(result, "load") };
        },
      },
      // Bouton « Système » de la barre tactile : le menu du jeu (les deux boutons de la souris, F10).
      skip: () => host.input.action("systemMenu"),
      tap: (button, x, y) => host.input.tap(button, x, y),
      key(event) {
        const action = keyDown(event);
        return action ? { engine: () => send(action) } : undefined;
      },
      keyUp(event) {
        const action = keyUp(event);
        if (action) send(action);
        return action !== null;
      },
      wheel: (delta) => host.input.action(delta < 0 ? "menuUp" : "menuDown"),
      // Page de dev : `step(n)` avance de `n` pas à la main et repeint (un onglet masqué ou ralenti ne reçoit pas toutes les images).
      debug: {
        game,
        loop,
        host,
        slots,
        step: (steps = 1) => {
          for (let i = 0; i < steps; i++) loop.tick();
          loop.render();
        },
      },
      afterTicks() {
        if (!pending) return;
        if (pending === "load") {
          pending = undefined;
          ctx.openLoad();
        } else if (loop.canSave || ++saveWaited > SAVE_WAIT_FRAMES) {
          // Le menu du jeu est fermé et le moteur attend une entrée : la partie peut être sauvegardée (sinon la page l'annonce).
          pending = undefined;
          ctx.openSave();
        }
      },
    };
  },
};

/** Monte Les Voyageurs du temps dans la page des jeux de pointer-et-cliquer. */
export function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  return mountPointClickApp(container, options, voyageurs);
}
