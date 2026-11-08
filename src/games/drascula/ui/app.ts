import { type PointClickAppOptions, type PointClickGame, mountPointClickApp, sumSizes } from "../../../ui/point-click-app";
import { FileStore, loadInto } from "../../../ui/file-store";
import { DrasculaAudio, createSoundPrefs } from "../audio/audio";
import { copy } from "../copy";
import { fetchGameFiles } from "../data/files";
import { MAX_CATCH_UP_TICKS, TICK_MS } from "../engine/cadence";
import { DrasculaEngine } from "../engine/loop";
import { drasculaScript } from "../engine/rooms";
import type { SaveData } from "../engine/save";
import { BrowserHost, createSoundFiles } from "./browser-host";
import { renderHelp } from "./help";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./input";
import { keyAction } from "./keys";
import { ChapterLoader, baseFiles, chapterVideos } from "./preload";
import { SAVE_PREFIX, createSaveSlots, loadFromSlot, resultMessage, saveToSlot, summarizeSlots } from "./saves";

/** `debug` expose `window.__drascula` (`engine`, `host`, `loader`, `slots`) pour la console (page de dev). */
export type AppOptions = PointClickAppOptions<SaveData>;

/** Préférence des sous-titres (`"0"` = masqués ; affichés par défaut, comme ScummVM). */
const SUBTITLES_KEY = "retrovibe:drascula:subtitles";

/**
 * Ce qui est propre à Drascula dans la page des jeux de pointer-et-cliquer (`ui/point-click-app.ts`). Les fichiers (données, images,
 * puis les vidéos des chapitres) sont chargés avant de construire le moteur, qui les lit en synchrone ; les voix et la musique sont
 * lues à la demande. Le moteur tourne par ticks de 10 ms.
 */
const drascula: PointClickGame<SaveData> = {
  id: "drascula",
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
    const loader = new ChapterLoader(fileStore, files, fetcher);
    // Le son se débloque dans le geste qui a lancé le jeu (le chargement peut durer plus que la validité du geste).
    const audio = new DrasculaAudio({
      now: () => performance.now(),
      files: createSoundFiles(files, fetcher),
      trackUrl: (file) => `${options.base}/${file}`,
    });
    audio.unlock();
    const chapter = options.restore?.chapter ?? 1;
    const base = baseFiles(files);
    const videos = [...new Set(ChapterLoader.needed(chapter).flatMap((c) => chapterVideos(files, c)))];
    const total = Math.max(sumSizes(files, base) + sumSizes(files, videos), 1);
    const baseSize = sumSizes(files, base);
    await loadInto(fileStore, files, base, fetcher, (done) => ctx.setPercent(done / total));
    await loader.prepare(chapter, (done) => ctx.setPercent((baseSize + done) / total));
    const host = new BrowserHost({
      files: fileStore,
      audio,
      storage: ctx.slotsStorage(SAVE_PREFIX),
      present: (pixels, palette) => ctx.presenter.present(pixels, palette),
      onExit: ctx.exit,
    });
    ctx.restoreVolume(host);
    const engine = ctx.buildEngine(() => new DrasculaEngine(host, { script: drasculaScript, restore: options.restore }));
    engine.subtitlesEnabled = store.get(SUBTITLES_KEY) !== "0";
    const slots = createSaveSlots(host.storage);

    /** Chapitre dont les vidéos sont en cours de chargement (pastille « chargement du chapitre suivant »). */
    let preparing = false;
    let loadFailure: unknown;
    // Les vidéos des chapitres suivants se chargent en fond dès le départ (8 Mo en tout) : le chapitre 1 et son introduction durent plus longtemps.
    void (async () => {
      try {
        for (let next = chapter + 1; next <= 6; next++) await loader.prepare(next);
      } catch (error) {
        loadFailure = error;
      }
    })();

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
        async load(slot) {
          const stored = slots.read(slot);
          if (!stored) return { ok: false, message: copy.loadEmpty };
          // Les vidéos du chapitre de la sauvegarde doivent être là avant de le rouvrir (le moteur les lit en synchrone).
          try {
            await loader.prepare(stored.save.chapter);
          } catch (error) {
            console.error(error);
            return { ok: false, message: copy.loadFailed };
          }
          const result = loadFromSlot(engine, slots, slot);
          return { ok: result === "loaded", message: resultMessage(result, "load") };
        },
      },
      skip: () => host.input.key("Escape"),
      tap(button, x, y) {
        // Pendant une réplique, un toucher la coupe (ScummVM ne le fait qu'au clavier : une touche) ; hors réplique, c'est un clic.
        if (button === 0 && engine.subtitle !== null && engine.choices === null) host.input.key("Enter");
        else host.input.tap(button, x, y);
      },
      key(event) {
        const action = keyAction(event);
        if (!action) return undefined;
        return action.type === "engine" ? { engine: () => host.input.key(action.key) } : { command: action.command };
      },
      subtitles: {
        enabled: () => engine.subtitlesEnabled,
        toggle() {
          engine.subtitlesEnabled = !engine.subtitlesEnabled;
          store.set(SUBTITLES_KEY, engine.subtitlesEnabled ? "1" : "0");
          return engine.subtitlesEnabled ? copy.subtitlesOn : copy.subtitlesOff;
        },
      },
      debug: { engine, host, loader, slots },
      failure: () => loadFailure,
      beforeTicks(ui) {
        if (!loader.runnable(engine.chapter)) {
          // Le chapitre suivant n'est pas encore là (réseau lent après un début de partie très rapide) : le jeu attend.
          if (!preparing) {
            preparing = true;
            loader.prepare(engine.chapter).then(
              () => {
                preparing = false;
                ui.resync();
              },
              (error: unknown) => {
                loadFailure = error;
              },
            );
          }
          ui.showLoading(copy.loadingChapter);
          return false;
        }
        ui.hideLoading();
        return true;
      },
    };
  },
};

/** Monte Drascula dans la page des jeux de pointer-et-cliquer. */
export function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  return mountPointClickApp(container, options, drascula);
}
