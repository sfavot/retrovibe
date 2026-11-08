import { FileStore, loadInto } from "../../../ui/file-store";
import { MissingFilesError } from "../../../ui/files";
import { type PointClickAppOptions, type PointClickGame, mountPointClickApp, sumSizes } from "../../../ui/point-click-app";
import { FotaqAudio, createSoundPrefs } from "../audio/audio";
import { createWebMusicOutput } from "../audio/web-music";
import { copy } from "../copy";
import { fetchGameFiles } from "../data/files";
import { MAX_CATCH_UP_TICKS, TICK_MS } from "../engine/cadence";
import { FotaqEngine } from "../engine/loop";
import { roomFiles } from "../engine/room";
import type { SaveData } from "../engine/save";
import { fotaqScript } from "../engine/specials";
import { BrowserHost, createSoundFiles } from "./browser-host";
import { renderHelp } from "./help";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./input";
import { keyAction } from "./keys";
import { RoomFiles, baseFiles, neighbourRooms } from "./preload";
import { SAVE_PREFIX, createSaveSlots, loadFromSlot, resultMessage, saveToSlot, summarizeSlots } from "./saves";

/** `debug` expose `window.__fotaq` (`engine`, `host`, `rooms`, `slots`, `step(n)`) pour la console (page de dev). */
export type AppOptions = PointClickAppOptions<SaveData>;

/**
 * Ce qui est propre à Flight of the Amazon Queen dans la page des jeux de pointer-et-cliquer (`ui/point-click-app.ts`). Les données
 * (banques de sprites, dialogues, cinématiques) sont chargées avant de construire le moteur, qui les lit en synchrone ; les décors se
 * chargent par pièce (le moteur attend leur arrivée), les voix à la demande. Le moteur tourne par ticks de 100 ms.
 */
const fotaq: PointClickGame<SaveData> = {
  id: "fotaq",
  copy,
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  tickMs: TICK_MS,
  maxCatchUpTicks: MAX_CATCH_UP_TICKS,
  renderHelp,
  async load(ctx) {
    const { options, store, fetcher } = ctx;
    const files = await ctx.manifest(fetchGameFiles);
    const fileStore = new FileStore();
    const rooms = new RoomFiles(fileStore, files, fetcher);
    const base = baseFiles(files);
    // La musique d'abord : le son se débloque dans le geste qui a lancé le jeu (le chargement peut durer plus que la validité du geste).
    const musicPath = files.resolve("AQBANK.MUS");
    if (musicPath === undefined) throw new MissingFilesError("AQBANK.MUS");
    await loadInto(fileStore, files, [musicPath], fetcher);
    const audio = new FotaqAudio({
      now: () => performance.now(),
      files: createSoundFiles(files, fetcher),
      musicData: fileStore.get("AQBANK.MUS") as Uint8Array,
      music: createWebMusicOutput(),
    });
    audio.unlock();
    const total = Math.max(sumSizes(files, base), 1);
    await loadInto(fileStore, files, base, fetcher, (done) => ctx.setPercent(done / total));
    const host = new BrowserHost({
      files: fileStore,
      gameFiles: files,
      rooms,
      audio,
      storage: ctx.slotsStorage(SAVE_PREFIX),
      present: (pixels, palette) => ctx.presenter.present(pixels, palette),
      onExit: ctx.exit,
      onJournal: ctx.openMenu,
    });
    ctx.restoreVolume(host);
    const engine = ctx.buildEngine(() => new FotaqEngine(host, { script: fotaqScript, restore: options.restore }));
    const slots = createSaveSlots(host.storage);
    // Page de dev : `step(n)` avance de `n` ticks à la main et repeint (un onglet masqué ou ralenti ne reçoit pas toutes les images).
    const step = (ticks = 1): void => {
      for (let i = 0; i < ticks; i++) engine.tick();
      engine.render();
      host.update();
    };
    /** Pièce dont les voisines ont été demandées au chargement de fond. */
    let prefetchedRoom = 0;

    return {
      engine,
      host,
      prefs: createSoundPrefs(store, audio),
      slots: {
        summaries: () => summarizeSlots(slots),
        save(slot) {
          const result = saveToSlot(engine, slots, slot, Date.now());
          return { ok: result === "saved", message: resultMessage(result, "save") };
        },
        load(slot) {
          // Le moteur est à l'arrêt (fenêtre ouverte) : le chargement se fait bien entre deux ticks.
          const result = loadFromSlot(engine, slots, slot);
          return { ok: result === "loaded", message: resultMessage(result, "load") };
        },
      },
      skip: () => host.input.action("skipCutaway"),
      tap(button, x, y) {
        // Pendant une réplique parlée, un toucher la passe (le doigt n'a pas de touche Entrée) ; hors réplique, c'est un clic.
        if (button === 0 && engine.speechPending) host.input.action("skipText");
        else host.input.tap(button, x, y);
      },
      key(event) {
        const action = keyAction(event);
        if (!action) return undefined;
        return action.type === "engine" ? { engine: () => host.input.action(action.action) } : { command: action.command };
      },
      debug: { engine, host, rooms, slots, step },
      failure: () => rooms.failure,
      beforeTicks() {
        host.waitingForRoom = false;
        return true;
      },
      afterTicks(ui) {
        host.update();
        // Le moteur attend le décor d'une pièce (réseau lent) : pastille de chargement ; sinon on prépare les pièces voisines.
        if (host.waitingForRoom) {
          ui.showLoading(copy.loadingRoom);
        } else {
          ui.hideLoading();
          if (engine.state.room !== prefetchedRoom) {
            prefetchedRoom = engine.state.room;
            rooms.prefetch(neighbourRooms(engine.data, prefetchedRoom).flatMap((room) => roomFiles(engine.data, room, (name) => files.has(name))));
          }
        }
      },
    };
  },
};

/** Monte Flight of the Amazon Queen dans la page des jeux de pointer-et-cliquer. */
export function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  return mountPointClickApp(container, options, fotaq);
}
