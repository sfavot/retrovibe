import { WebSampleOutput } from "../../../audio/web-sample-output";
import { type PointClickAppOptions, type PointClickGame, mountPointClickApp } from "../../../ui/point-click-app";
import { SoundPrefs } from "../../../ui/sound-prefs";
import { digitalAudioOf } from "../audio/digital";
import { webDigitalOutput } from "../audio/web-digital";
import { copy } from "../copy";
import { gameFilesOf } from "../engine/kernel/fileio";
import { useGameClock } from "../engine/loop";
import { canSaveGame, loadFromSlot, restoreGame, saveToSlot, useSaveStorage } from "../engine/save";
import { textEntryOf } from "../engine/text-entry";
import { Vm } from "../engine/vm";
import { frameoutOf } from "../render/frameout";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/ids";
import { seqPlayerOf } from "../render/seq-player";
import { BrowserHost } from "./browser-host";
import { renderHelp } from "./help";
import { digitalFiles } from "./digital-files";
import { Gk1Loop, MAX_CATCH_UP_TICKS, TICK_MS } from "./loop";
import { movieFiles } from "./movies";
import { fetchGk1Files, loadResources } from "./preload";
import { type SaveData, SAVE_PREFIX, createSaveSlots, defaultSaveName, summarizeSlots } from "./saves";
import { mountTextEntryOverlay } from "./text-entry";

/** `debug` expose `window.__gk1` (`vm`, `frameout`, `events`, `loop`, `host`) pour la console. */
export type AppOptions = PointClickAppOptions<SaveData>;

/** Soundfont General MIDI du site : celle de Mathémagique, réutilisée par son URL (`docs/gk1/plan.md`, M4). */
const SOUNDFONT_URL = `${import.meta.env.BASE_URL}mathemagique/mathemagique-gm.sf2`;

/**
 * Ce qui est propre à *Gabriel Knight* dans la page des jeux de pointer-et-cliquer (`ui/point-click-app.ts`, `docs/gk1/plan.md`,
 * D7 à D9 et D13). La map, le volume, les patchs et `VERSION` (13,3 Mo) sont chargés avant de démarrer la machine virtuelle ; les
 * cinématiques, les voix et les sons numérisés viennent à la demande. Le jeu tourne à 60 images par seconde, une image du jeu par tick de la page.
 *
 * Tout ce que le jeu dessine est gardé : barre d'icônes, inventaire, panneau de réglages. La page n'ajoute que sa coquille (son,
 * volume, pause, plein écran, aide).
 *
 * **Sauvegardes** (D10) : les fenêtres du jeu et le menu de la page écrivent dans les mêmes emplacements (`engine/save.ts`,
 * stockage du site sous `gk1:`). « Continuer » et « Charger » de l'écran titre reprennent l'image à la place du démarrage ;
 * « Charger » du menu la reprend en place. Au toucher, le nom d'une sauvegarde se tape dans un champ posé sur celui du jeu
 * (`text-entry.ts`).
 */
const gk1: PointClickGame<SaveData> = {
  id: "gk1",
  copy,
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  tickMs: TICK_MS,
  maxCatchUpTicks: MAX_CATCH_UP_TICKS,
  renderHelp,
  async load(ctx) {
    // Le son se débloque dans le geste qui a lancé le jeu : la sortie est créée et débloquée avant le chargement, qui peut durer
    // plus que la validité du geste.
    const output = new WebSampleOutput({ now: () => performance.now() });
    output.unlock();
    const storage = ctx.slotsStorage(SAVE_PREFIX);
    const slots = createSaveSlots(storage);
    const files = await ctx.manifest(fetchGk1Files);
    const { resources, cdFiles } = await loadResources(files, ctx.fetcher, ctx.setPercent);

    const vm = ctx.buildEngine(() => {
      const created = new Vm(resources);
      useGameClock(created);
      seqPlayerOf(created).source = movieFiles(ctx.options.base);
      // Voix et sons numérisés : fichiers à la demande, sur la même sortie que la musique (bouton « Son », volume, pause).
      const digital = digitalAudioOf(created);
      digital.files = digitalFiles(ctx.options.base, files.list());
      digital.attach(webDigitalOutput(output));
      useSaveStorage(created, storage);
      // Fichiers du CD que les scripts ouvrent (`VERSION` : version affichée par le jeu et rangée dans les sauvegardes).
      for (const [name, bytes] of cdFiles) gameFilesOf(created).provide(name, bytes);
      // Une partie à reprendre remplace le démarrage ; une image incohérente lève une erreur, que la page annonce.
      if (ctx.options.restore) restoreGame(created, ctx.options.restore);
      else created.boot();
      return created;
    });
    const host = new BrowserHost({ vm, output, soundfontUrl: SOUNDFONT_URL });
    ctx.restoreVolume(host);
    const loop = new Gk1Loop({ vm, present: (pixels, palette) => ctx.presenter.present(pixels, palette), beforeFrame: () => host.music.beginFrame() });
    let shown = false;
    const unmountTextEntry = mountTextEntryOverlay({
      entry: textEntryOf(vm),
      input: host.input,
      canvas: () => document.querySelector<HTMLCanvasElement>(".pc-game .pc-canvas"),
      label: copy.textEntryLabel,
    });

    return {
      engine: loop,
      host,
      prefs: new SoundPrefs(ctx.store, output, "gk1"),
      slots: {
        summaries: () => summarizeSlots(slots),
        save(slot) {
          if (!canSaveGame(vm)) return { ok: false, message: copy.saveBusy };
          return saveToSlot(vm, slot, defaultSaveName(new Date())) ? { ok: true, message: copy.saveDone } : { ok: false, message: copy.saveFailed };
        },
        load: (slot) => (loadFromSlot(vm, slot) ? { ok: true, message: copy.loadDone } : { ok: false, message: copy.loadEmpty }),
      },
      skip: () => host.skip(),
      tap: (button, x, y) => host.tap(button, x, y),
      key: (event) => host.key(event),
      keyUp: (event) => host.keyUp(event),
      debug: { vm, frameout: frameoutOf(vm), events: host.input, loop, host },
      afterTicks() {
        // Première image affichée : la soundfont (18 Mo) se charge en tâche de fond, sans retarder le premier écran.
        if (!shown) {
          shown = true;
          host.music.load();
        }
        // « Quitter » du jeu : `play` est revenu, il n'y a plus rien à exécuter.
        if (loop.finished) {
          unmountTextEntry();
          ctx.toTitle();
        }
      },
    };
  },
};

/** Monte Gabriel Knight dans la page des jeux de pointer-et-cliquer. */
export function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  return mountPointClickApp(container, options, gk1);
}
