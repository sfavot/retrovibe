/**
 * Enregistrement des écrans de Zoombinis (table `1530:14fe`, `engine.md` §2.1). Un écran non encore porté n'est pas enregistré.
 */
import type { ZoombinisEngine } from "../engine/engine";
import { ScreenId } from "../engine/scene";
import { createLogoScene } from "./logo";
import { createBaseCampScene, createBcTwoScene } from "./camp";
import { createMapScene } from "./map";
import { createPickerScene } from "./picker";
import { createBridgeScene } from "./puzzles/bridge";
import { createCavesScene } from "./puzzles/caves";
import { createFerryScene } from "./puzzles/ferry";
import { createFleensScene } from "./puzzles/fleens";
import { createHotelScene } from "./puzzles/hotel";
import { createLillyScene } from "./puzzles/lilly";
import { createMaze2Scene } from "./puzzles/maze2";
import { createNetScene } from "./puzzles/net";
import { createPizzaScene } from "./puzzles/pizza";
import { createSlidesScene } from "./puzzles/slides";
import { createSmokeScene } from "./puzzles/smoke";
import { createTunnelsScene } from "./puzzles/tunnels";
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
  // Les 12 épreuves (écrans 7 à 18, vague H).
  engine.register(ScreenId.bridge, () => createBridgeScene());
  engine.register(ScreenId.tunnels, () => createTunnelsScene());
  engine.register(ScreenId.pizza, () => createPizzaScene());
  engine.register(ScreenId.ferry, () => createFerryScene());
  engine.register(ScreenId.lilly, () => createLillyScene());
  engine.register(ScreenId.slides, () => createSlidesScene());
  engine.register(ScreenId.fleens, () => createFleensScene());
  engine.register(ScreenId.hotel, () => createHotelScene());
  engine.register(ScreenId.net, () => createNetScene());
  engine.register(ScreenId.caves, () => createCavesScene());
  engine.register(ScreenId.smoke, () => createSmokeScene());
  engine.register(ScreenId.maze2, () => createMaze2Scene());
}
