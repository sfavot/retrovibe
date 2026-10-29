/**
 * Enregistrement des écrans de Zoombinis (table `1530:14fe`, `engine.md` §2.1). Un écran non encore porté n'est pas enregistré.
 */
import type { ZoombinisEngine } from "../engine/engine";
import { ScreenId } from "../engine/scene";
import { createLogoScene } from "./logo";
import { createBaseCampScene, createBcTwoScene } from "./camp";
import { createMapScene } from "./map";
import { createPickerScene } from "./picker";
import { createPuzzleStubScene } from "./puzzle-stub";
import { createTownScene } from "./town";
import { createXferScene } from "./xfer";

export function registerScenes(engine: ZoombinisEngine): void {
  engine.register(ScreenId.logo, createLogoScene);
  engine.register(ScreenId.map, createMapScene);
  engine.register(ScreenId.xfer, createXferScene);
  engine.register(ScreenId.picker, createPickerScene);
  engine.register(ScreenId.baseCamp, createBaseCampScene);
  engine.register(ScreenId.bcTwo, createBcTwoScene);
  engine.register(ScreenId.town, createTownScene);
  // Épreuves provisoires (écrans 7 à 18), remplacées une à une en vague H.
  for (let screen = ScreenId.bridge; screen <= ScreenId.maze2; screen++) {
    engine.register(screen, () => createPuzzleStubScene(screen));
  }
}
