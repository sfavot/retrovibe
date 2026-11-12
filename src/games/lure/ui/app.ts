import { SoundPrefs } from "../../../ui/sound-prefs";
import { type PointClickAppOptions, type PointClickGame, mountPointClickApp } from "../../../ui/point-click-app";
import { LureAudio } from "../audio/audio";
import { createWebMusicOutput } from "../audio/web-music";
import { copy } from "../copy";
import { loadLureData } from "../data/lure-data";
import { readSoundSections } from "../data/sound";
import { Field } from "../engine/ids";
import { MAX_CATCH_UP_TICKS, TICK_MS } from "../engine/cadence";
import { LureEngine } from "../engine/game";
import { type SaveData, restoreSave } from "../engine/save";
import { LureRenderer } from "../render/renderer";
import { BrowserHost } from "./browser-host";
import { renderHelp } from "./help";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./input";
import { keyAction, keyReleaseAction } from "./keys";
import { LureLoop } from "./loop";
import { fetchLureFiles, loadLureFiles } from "./preload";
import { SAVE_PREFIX, createSaveSlots, loadFromSlot, resultMessage, saveToSlot, summarizeSlots } from "./saves";

/** `debug` expose `window.__lure` (`engine`, `loop`, `renderer`, `host`, `audio`, `slots`, `step(n)`) pour la console (page de dev). */
export type AppOptions = PointClickAppOptions<SaveData>;

/**
 * Ce qui est propre à *Lure of the Temptress* dans la page des jeux de pointer-et-cliquer (`ui/point-click-app.ts`). Les quatre
 * disques et `LURE-FR.DAT` (2,7 Mo) sont chargés d'un coup avant de construire le moteur, qui lit des données déjà décodées ; il n'y
 * a ni décor par pièce, ni voix, ni son à la demande. Le moteur tourne par ticks de 80 ms, suspendus pendant les fondus (`LureLoop`).
 */
const lure: PointClickGame<SaveData> = {
  id: "lure",
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
    const files = await ctx.manifest(fetchLureFiles);
    const data = loadLureData(await loadLureFiles(files, ctx.fetcher, ctx.setPercent));

    const engineRef: { current?: LureEngine } = {};
    const audio = new LureAudio({
      now: () => performance.now(),
      music,
      sections: readSoundSections(data.resources),
      descs: data.soundDescs,
      soundEnabled: () => engineRef.current?.soundFlag ?? true,
      preloading: () => engineRef.current?.preloadFlag ?? false,
      // Les cloches de la ville (`bellsBodge`) suivent la zone de la pièce où l'on est.
      area: {
        roomAreaFlag: () => engineRef.current?.room.roomData?.data.areaFlag,
        getAreaField: () => engineRef.current?.world.fields.get(Field.AREA_FLAG) ?? 0,
        setAreaField: (value) => engineRef.current?.world.fields.set(Field.AREA_FLAG, value),
      },
    });
    // « Sauvegarder » et « Restituer » de la barre de menus du jeu : la fenêtre s'ouvre après les ticks de l'image (le moteur est
    // alors entre deux séquences : la sauvegarde n'est plus refusée parce que le menu est encore à l'écran).
    let pendingDialog: "save" | "load" | undefined;
    // Fin de partie : comme ScummVM, rien à restituer = on recommence tout de suite ; sinon la fenêtre s'ouvre après les ticks de l'image ;
    // « Restituer » ouvre la liste des emplacements, la fermer sans charger recommence (comme le dialogue de ScummVM).
    let pendingEnd: ((restart: boolean) => void) | undefined;
    const host = new BrowserHost({
      audio,
      storage,
      onRestartRestore(answer) {
        if (slots.latest()) pendingEnd = answer;
        else answer(true);
      },
      onExit: ctx.exit,
      onSaveDialog: (save) => (pendingDialog = save ? "save" : "load"),
    });
    ctx.restoreVolume(host);
    const engine = ctx.buildEngine(() => {
      // Une partie reprise commence dans le jeu (section « jeu ») ; une nouvelle partie joue l'introduction, qui charge elle-même ses sections.
      const created = new LureEngine({ data, host, sound: audio.sound, intro: options.restore === undefined, seed: 1 + Math.floor(Math.random() * 0x7ffffffe) });
      engineRef.current = created;
      if (options.restore) {
        audio.sound.loadSection("main");
        if (!restoreSave(created, options.restore)) throw new Error("sauvegarde illisible");
      }
      return created;
    });
    const renderer = new LureRenderer(data);
    const loop = new LureLoop({ engine, renderer, present: (pixels, palette) => ctx.presenter.present(pixels, palette) });
    if (!options.restore) audio.sound.loadSection("main");

    return {
      engine: loop,
      host,
      prefs: new SoundPrefs(store, audio, "lure"),
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
      skip: () => host.input.action("escape"),
      // Toucher = clic gauche, appui long = clic droit : les menus surgissants et la barre de menus se règlent d'un clic gauche.
      tap: (button, x, y) => host.input.tap(button, x, y),
      key(event) {
        const action = keyAction(event);
        if (!action) return undefined;
        // Pavé 3 : coup de combat pendant un combat, validation d'un menu sinon.
        if (action.type === "engine") return { engine: () => host.input.action(action.orElse && !engine.fights.isFighting ? action.orElse : action.action) };
        return action.command === "menu" ? { engine: () => ctx.openMenu() } : { command: action.command };
      },
      keyUp(event) {
        const action = keyReleaseAction(event);
        if (!action) return false;
        host.input.actionEnd(action);
        return true;
      },
      wheel: (delta) => host.input.wheel(delta),
      // Page de dev : `step(n)` avance de `n` ticks à la main et repeint (un onglet masqué ou ralenti ne reçoit pas toutes les images).
      debug: { engine, loop, renderer, host, audio, slots, step: (ticks = 1) => (loop.step(ticks), host.update()) },
      afterTicks() {
        host.update();
        if (pendingEnd) {
          const answer = pendingEnd;
          pendingEnd = undefined;
          ctx.openChoice({
            title: copy.endTitle,
            text: copy.endText,
            primary: copy.endRestart,
            secondary: copy.endRestore,
            choose: (choice) => (choice === "primary" ? answer(true) : ctx.openLoad(() => answer(true))),
            cancel: () => answer(true),
          });
        }
        if (pendingDialog) {
          const dialog = pendingDialog;
          pendingDialog = undefined;
          if (dialog === "save") ctx.openSave();
          else ctx.openLoad();
        }
      },
    };
  },
};

/** Monte Lure of the Temptress dans la page des jeux de pointer-et-cliquer. */
export function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  return mountPointClickApp(container, options, lure);
}
