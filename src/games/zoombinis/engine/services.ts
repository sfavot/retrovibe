/**
 * Câblage des services du moteur de Zoombinis (vague F5) : surface de jeu 640×480 + palette, son.
 *
 * `await installServices(engine)` est à appeler une fois, après `createZoombinisEngine(host)` et avant `engine.start()`. Il
 *  - ouvre `ZOOMBINI.MHK`, `MIDIMPC.MHK` et `MIDIMAP.DAT` (gardées toute la partie) ;
 *  - crée la surface (`GRAPHICS.screen`) et la palette, et branche `engine.setFrameSource` ;
 *  - enregistre `GRAPHICS` et `ZOOMBINIS_SOUND` dans `engine.services` ;
 *  - ajoute un crochet de tick : palette (fondus, cycles) → préférences musique / effets → son → présentation si l'image a changé.
 * Contrat des scènes : dans `enter`, `sound.setScreenArchive(archive)` ; dans `leave`, `setScreenArchive(null)`.
 */
import type { Frame } from "../../../engine/mohawk/graphics/frame";
import { Palette, PALETTE_BYTES } from "../../../engine/mohawk/graphics/palette";
import { Surface } from "../../../engine/mohawk/graphics/surface";
import { COMMON_ARCHIVE, MIDIMAP_NAME, TAG_SYSX } from "../data/archives";
import type { ZoombinisEngine } from "./engine";
import { defineService } from "./scene";
import { ZOOMBINIS_SOUND, ZoombinisSound } from "./sound";
import { installText } from "./text";
import { installFeatures, type Features } from "./features";
import { installGame, type ZoombinisGame } from "./game";
import { installDialog } from "./dialog";
import { installShortcuts } from "./shortcuts";

export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;
const MIDI_ARCHIVE = "MIDIMPC.MHK";
/** `SYSX` 1 de `MIDIMAP.DAT` (l'id 0xffff est identique, `data/sysx.ts`). */
const SYSX_ID = 1;

export interface GraphicsService {
  /** Surface de jeu 640×480 : ce que `host.present` reçoit. Les scènes y dessinent. */
  readonly screen: Surface;
  readonly palette: Palette;
}

export const GRAPHICS = defineService<GraphicsService>("zoombinis.graphics");

export interface ZoombinisServices {
  readonly graphics: GraphicsService;
  readonly sound: ZoombinisSound;
  readonly features: Features;
  readonly game: ZoombinisGame;
}

export async function installServices(engine: ZoombinisEngine): Promise<ZoombinisServices> {
  const { ctx } = engine;
  const [zoombini, midimpc, midimap] = await Promise.all([
    ctx.resources.open(COMMON_ARCHIVE, "persistent"),
    ctx.resources.open(MIDI_ARCHIVE, "persistent"),
    ctx.resources.open(MIDIMAP_NAME, "persistent"),
  ]);
  const sound = new ZoombinisSound(ctx.host.audio, { zoombini, midimpc }, { sysx: midimap.raw(TAG_SYSX, SYSX_ID) });

  const screen = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
  const palette = new Palette();
  const graphics: GraphicsService = { screen, palette };
  const frame: Frame = { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, pixels: screen.pixels, palette: new Uint8Array(PALETTE_BYTES) };
  const scratch = new Uint8Array(PALETTE_BYTES);

  engine.setFrameSource(() => {
    palette.output(frame.palette);
    return frame;
  });

  engine.services.provide(GRAPHICS, graphics);
  engine.services.provide(ZOOMBINIS_SOUND, sound);

  engine.addTickHook((c) => {
    // Un fondu ou un cycle qui change l'affichage doit être présenté même si rien n'a été redessiné.
    palette.tick();
    palette.output(scratch);
    if (!sameBytes(scratch, frame.palette)) {
      frame.palette.set(scratch);
      c.requestPresent();
    }
    // Les préférences (Ctrl+V, Ctrl+Y en vague G) pilotent les drapeaux du son ; assigner seulement au changement (couper arrête la musique).
    if (sound.musicEnabled !== c.prefs.music) sound.musicEnabled = c.prefs.music;
    if (sound.effectsEnabled !== c.prefs.effects) sound.effectsEnabled = c.prefs.effects;
    sound.tick();
  });

  await installText(engine);
  const features = installFeatures(engine);
  const game = installGame(engine);
  // Après les features et la partie : le crochet de tick de la boîte passe après les leurs.
  await installDialog(engine);
  installShortcuts(engine);
  return { graphics, sound, features, game };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
