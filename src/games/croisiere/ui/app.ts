import { type PointClickAppOptions, type PointClickGame, mountPointClickApp } from "../../../ui/point-click-app";
import { SoundPrefs } from "../../../ui/sound-prefs";
import { copy } from "../copy";
import type { CroisiereHost } from "../engine/host";
import { CroisiereEngine } from "../engine/main-loop";
import type { GameFiles } from "../engine/overlays";
import { canSave, captureSave, describeSave, parseSave, restoreSave } from "../engine/save";
import { SoundService } from "../engine/sound-service";
import { BrowserHost, SCREEN_HEIGHT, SCREEN_WIDTH } from "./browser-host";
import { renderHelp } from "./help";
import { keyAction } from "./keys";
import { CroisiereLoop, FrameQueue, STEP_MS } from "./loop";
import { fetchCroisiereFiles, loadCroisiereData } from "./preload";
import { SAVE_PREFIX, type SlotData, createSaveSlots, saveMessage, summarizeSlots, writeSlot } from "./saves";
import { createWebMusicOutput } from "./web-music";

/** `debug` expose `window.__croisiere` (`engine()`, `loop`, `host`, `slots`, `step(n)`) pour la console (page de dev). */
export type AppOptions = PointClickAppOptions<SlotData>;

/** Pas rattrapés au plus en une image d'écran (320 ms) : au-delà (onglet gelé), le temps perdu est abandonné. */
export const MAX_CATCH_UP_TICKS = 32;

/** Moteur neuf sur les fichiers du jeu, avec le rendu et le son de la page. */
function createEngine(files: GameFiles, host: CroisiereHost, frames: FrameQueue, sound: SoundService): CroisiereEngine {
  const seed = 1 + Math.floor(Math.random() * 0x7ffffffe);
  return new CroisiereEngine(host, { files, seed, renderer: frames, sound });
}

/** Ce qu'un emplacement reçoit de la partie en cours ; `null` si le jeu refuse la sauvegarde (introduction, scène, fin). */
function captureSlot(engine: CroisiereEngine): SlotData | null {
  const e = engine.state;
  return !engine.stopped && canSave(e) ? { place: describeSave(e), state: captureSave(e) } : null;
}

/** Moteur neuf dans l'état d'une sauvegarde ; lève une erreur si elle ne se rouvre pas. */
function restoredEngine(files: GameFiles, host: CroisiereHost, frames: FrameQueue, sound: SoundService, save: SlotData): CroisiereEngine {
  const state = parseSave(save.state);
  if (!state) throw new Error("sauvegarde illisible ou d'une autre version");
  const engine = createEngine(files, host, frames, sound);
  restoreSave(engine.state, state);
  return engine;
}

/**
 * Ce qui est propre à *Croisière pour un cadavre* dans la page des jeux de pointer-et-cliquer (`ui/point-click-app.ts`). Les volumes
 * (3,5 Mo) sont chargés d'un coup avant de construire le moteur. L'hôte bat à 10 ms (`STEP_MS`, l'attente active de ScummVM) ; le moteur
 * lance un tour tous les 50 ms pendant l'introduction, 100 ms ensuite (plan.md D7).
 *
 * Interface (plan.md D4) : les menus sont ceux du jeu. Toucher = clic gauche, appui long = clic droit (inventaire). Le bouton « Menu du
 * jeu » de la barre tactile (la place du bouton « Inventaire » de la page commune) et F10 ouvrent le menu joueur ; ses entrées
 * « Sauvegarde » et « Chargement » ouvrent les fenêtres du site, « Quitter » ramène à l'écran titre. Charger une partie construit un
 * moteur neuf (aucun tour suspendu dans une boucle modale ne survit au chargement).
 */
const croisiere: PointClickGame<SlotData> = {
  id: "croisiere",
  copy,
  // Le bouton « Inventaire » de la page commune ouvre ici le menu du jeu (l'inventaire est à l'appui long).
  icons: { inventory: "system" },
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  tickMs: STEP_MS,
  maxCatchUpTicks: MAX_CATCH_UP_TICKS,
  renderHelp,
  async load(ctx) {
    const { options, store } = ctx;
    // Le son se débloque dans le geste qui a lancé le jeu : la sortie est créée et débloquée avant le chargement.
    const music = createWebMusicOutput();
    music.unlock();
    const slots = createSaveSlots(ctx.slotsStorage(SAVE_PREFIX));
    const manifest = await ctx.manifest(fetchCroisiereFiles);
    const files = await loadCroisiereData(manifest, ctx.fetcher, ctx.setPercent);

    // Fenêtre du site demandée par le menu joueur : ouverte après les pas de l'image.
    let pending: "save" | "load" | undefined;
    const host = new BrowserHost({
      storage: ctx.slotsStorage(SAVE_PREFIX),
      onExit: ctx.toTitle,
      onSaveRequest: () => (pending = "save"),
      onLoadRequest: () => (pending = "load"),
    });
    host.bindAudio(music);
    ctx.restoreVolume(host);
    const sound = new SoundService(music, (name) => (files.has(name) ? files.readFile(name) : undefined));
    const frames = new FrameQueue();
    let engine = ctx.buildEngine(() =>
      options.restore ? restoredEngine(files, host, frames, sound, options.restore) : createEngine(files, host, frames, sound),
    );
    const loop = new CroisiereLoop({
      engine: () => engine,
      frames,
      present: (pixels, palette) => ctx.presenter.present(pixels, palette),
      touchMode: () => host.input.touchMode,
    });
    loop.resync();

    /** Ouvre la fenêtre demandée par le menu joueur, après les pas de l'image (ou d'un `step` de la page de dev). */
    const openPending = (): void => {
      if (!pending) return;
      const request = pending;
      pending = undefined;
      if (request === "save") ctx.openSave();
      else ctx.openLoad();
    };

    return {
      engine: loop,
      host,
      prefs: new SoundPrefs(store, music, "croisiere"),
      slots: {
        summaries: () => summarizeSlots(slots),
        save(slot) {
          const result = writeSlot(slots, slot, captureSlot(engine), Date.now());
          return { ok: result === "saved", message: saveMessage(result) };
        },
        load(slot) {
          const stored = slots.read(slot);
          if (!stored) return { ok: false, message: copy.loadEmpty };
          frames.clear();
          try {
            engine = restoredEngine(files, host, frames, sound, stored.save);
          } catch (error) {
            console.error(error);
            return { ok: false, message: copy.loadFailed };
          }
          loop.resync();
          return { ok: true, message: copy.loadDone };
        },
      },
      // « Passer » : un clic gauche sur place, qui fait avancer l'introduction ou la scène, ou disparaître le texte affiché.
      skip: () => host.input.clickInPlace(),
      // Le bouton « Inventaire » de la page commune, renommé « Menu du jeu » : le menu joueur, à la position du pointeur.
      inventory: {
        canOpen: () => loop.canOpenPlayerMenu,
        open: () => host.input.action("playerMenu"),
      },
      tap: (button, x, y) => host.input.tap(button, x, y),
      key(event) {
        const action = keyAction(event);
        if (!action) return undefined;
        if (action.type === "host") return action.command === "menu" ? { engine: () => ctx.openMenu() } : { command: "pause" };
        return { engine: () => host.input.action(action.action) };
      },
      keyUp(event) {
        if (event.key !== "Escape") return false;
        host.input.endAction("escape");
        return true;
      },
      // Page de dev : `step(n)` avance de `n` pas de 10 ms à la main, repeint et ouvre une fenêtre demandée (un onglet masqué n'a pas d'images).
      debug: {
        engine: () => engine,
        loop,
        host,
        slots,
        step: (steps = 1) => {
          for (let i = 0; i < steps; i++) loop.tick();
          loop.render();
          openPending();
        },
      },
      afterTicks: openPending,
    };
  },
};

/** Monte Croisière pour un cadavre dans la page des jeux de pointer-et-cliquer. */
export function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  return mountPointClickApp(container, options, croisiere);
}
