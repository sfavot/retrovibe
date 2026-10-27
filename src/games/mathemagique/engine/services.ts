/**
 * Câblage des services du moteur (tâche G1) : surface de jeu + palette, son, lecteur de scripts, gadgets, pointeur.
 *
 * `installServices(engine)` est à appeler une fois, après `new Engine(host)` et avant `engine.start()` (G2). Il
 *  - crée la surface 576×432 (`GRAPHICS.screen`, le port de travail visible) et la palette, et branche `engine.setFrameSource` ;
 *  - enregistre les services (`GRAPHICS`, `SOUND`, `SCR_PLAYER`, `GADGETS`, `POINTER`) dans `engine.services` ;
 *  - ajoute **un** crochet de tick, dans cet ordre : palette (fondus, cycles) → séquenceur MIDI → lecteur de scripts (interruptions, étapes,
 *    composition) → entrées (événements bouton dans l'ordre : le pointeur d'abord, qui capte tout pendant qu'une pièce est portée, puis les
 *    gadgets ; suivi de la pièce et du survol) → clignotements et dessin des gadgets ; il demande la présentation quand l'image a changé ;
 *  - ajoute le gestionnaire de touche `before` des gadgets (Tab, Maj+Tab, Entrée), gelé pendant une animation bloquante.
 * Pendant une animation `blocking`, le crochet ne traite ni gadgets ni pointeur (comme la boucle d'attente `1090:111c`).
 *
 * Contrat des scènes : dans `enter`, `services.useArchive(archive)` (formes et sons des gadgets), création des groupes, `captureBackground` ;
 * dans `leave`, `services.endScene()` (arrête les animations, vide les gadgets, abandonne la pièce portée, coupe les sons).
 */
import type { Engine } from "./engine";
import { GADGETS, GadgetManager } from "./gadgets";
import { Palette, PALETTE_BYTES } from "./graphics/palette";
import type { Frame } from "./graphics/frame";
import { Surface } from "./graphics/surface";
import { POINTER, PointerService } from "./pointer";
import { SCR_PLAYER, ScrPlayer } from "./scr-player";
import { defineService } from "./scene";
import { SOUND, SoundService, type WaveArchive } from "./sound";
import { TAG_SHAP } from "../../../data/mohawk/mohawk";
import type { Shape } from "../../../data/mohawk/shap";

export interface GraphicsService {
  /** Surface de jeu 576×432 : ce que `host.present` reçoit. Les scènes y dessinent (ou y copient leur propre surface). */
  readonly screen: Surface;
  readonly palette: Palette;
}

export const GRAPHICS = defineService<GraphicsService>("mathemagique.graphics");

/** Archive que les services lisent pour les formes et les sons des gadgets (`Archive` convient). */
export interface SceneArchive extends WaveArchive {
  has(tag: string, id: number): boolean;
  shap(id: number): Shape;
}

export interface MathServices {
  readonly graphics: GraphicsService;
  readonly sound: SoundService;
  readonly scr: ScrPlayer;
  readonly gadgets: GadgetManager;
  readonly pointer: PointerService;
  /** Archive de la scène pour les formes et sons des gadgets (appelé dans `enter`). */
  useArchive(archive: SceneArchive | null): void;
  /**
   * Sortie de scène (à appeler dans `leave`) : animations arrêtées sans rappel, gadgets vidés, pièce portée abandonnée, curseur remis à la
   * flèche, cycles de palette arrêtés, sons coupés (`keepMusic` : la musique continue d'une scène à l'autre).
   */
  endScene(options?: { keepMusic?: boolean }): void;
}

export function installServices(engine: Engine): MathServices {
  const { ctx } = engine;
  const screen = new Surface();
  const palette = new Palette();
  const graphics: GraphicsService = { screen, palette };
  const frame: Frame = { pixels: screen.pixels, palette: new Uint8Array(PALETTE_BYTES) };
  const scratch = new Uint8Array(PALETTE_BYTES);

  const sound = new SoundService(ctx.host.audio, { ambientEnabled: () => ctx.roster.roster.ambient });
  const scr = new ScrPlayer({ surface: screen, sound, onDirty: () => ctx.requestPresent() });
  const gadgets = new GadgetManager();
  const pointer = new PointerService({
    mode: () => (ctx.roster.roster.clickAndStick ? "clickAndStick" : "drag"),
    setCursor: (cursor) => ctx.setCursor(cursor),
  });

  engine.setFrameSource(() => {
    palette.output(frame.palette);
    return frame;
  });

  const services = engine.services;
  services.provide(GRAPHICS, graphics);
  services.provide(SOUND, sound);
  services.provide(SCR_PLAYER, scr);
  services.provide(GADGETS, gadgets);
  services.provide(POINTER, pointer);

  engine.addTickHook((c) => {
    // Palette : un fondu ou un cycle qui change l'affichage doit être présenté même si rien n'a été redessiné.
    palette.tick();
    palette.output(scratch);
    if (!sameBytes(scratch, frame.palette)) {
      frame.palette.set(scratch);
      c.requestPresent();
    }
    sound.tick();
    scr.tick(c.input);
    if (!scr.blockedThisTick) {
      for (const event of c.input.buttonEvents) if (!pointer.handleButton(event)) gadgets.handleButton(event);
      pointer.tick(c.input);
      // Une pièce portée capte la souris : pas de survol de bouton.
      if (pointer.capturesClicks) gadgets.updatePointer(-1, -1);
      else gadgets.updatePointer(c.input.mouseX, c.input.mouseY, (button) => c.input.isButtonDown(button));
    }
    gadgets.tick();
    if (gadgets.draw(screen)) c.requestPresent();
  });

  engine.addKeyHandler("before", (event) => !scr.blocking && gadgets.handleKey(event));

  return {
    graphics,
    sound,
    scr,
    gadgets,
    pointer,
    useArchive(archive) {
      gadgets.configure({
        shape: archive ? (id) => (archive.has(TAG_SHAP, id) ? archive.shap(id) : undefined) : undefined,
        playSound: archive ? (id) => void sound.playSound(archive, id) : undefined,
      });
    },
    endScene(options = {}) {
      scr.stopAll();
      gadgets.clear();
      gadgets.configure({ shape: undefined, playSound: undefined });
      pointer.reset();
      // Les couleurs tournées par un cycle en cours reviennent à leur état d'origine (la scène suivante ne doit pas hériter d'une rotation).
      palette.stopCycles(true);
      if (options.keepMusic) sound.stopAll();
      else sound.releaseAll();
    },
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
