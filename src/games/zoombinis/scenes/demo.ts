/**
 * Écran de démonstration provisoire (remplacé en vague G) : le fond de `BASECAMP.MHK` (tBMP et SHPL 1000) animé par ses 32 `SCRB`
 * (1100–1115 sur la planche 1100, 1200–1215 sur la planche 1200) comme `10b0:0027`, la musique 30000, et un clic qui fait défiler les
 * curseurs `curs1` à `curs5` puis `system` en jouant un son de l'archive. Cinq Zoombinis variés (`scenes/snoid.ts`) entrent un à un par la gauche,
 * suivent le chemin 1 de `NODE` / `PATH` 1000 (nœuds 1, 2 et 7) à la file, puis s'arrêtent en pose d'attente. Aucun texte.
 * Il sert à vérifier le moteur de bout en bout dans le navigateur : archive, palette, surface, features, présentation, curseurs, son et MIDI.
 */
import { TAG_SND } from "../../../data/mohawk/mohawk";
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import { Surface } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import { FEATURES, FeatureFlag, type Features } from "../engine/features";
import { GRAPHICS, SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/services";
import type { CursorKind } from "../engine/host";
import type { Scene, SceneContext } from "../engine/scene";
import { node, path } from "../engine/resources";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { traitsFromIndex, type WalkMap } from "../data/zoombini";
import { createSnoid, type Snoid } from "./snoid";

const ARCHIVE = "BASECAMP.MHK";
const BACKGROUND_ID = 1000;
const MUSIC_ID = 30000;
/** Les sons de l'archive d'un écran commencent à 1000 (`sound.ts`). */
const FIRST_SCREEN_SOUND = 1000;
/** Ordre des curseurs au clic. */
const CURSOR_CYCLE: readonly CursorKind[] = [
  "curs1",
  "curs2",
  "curs3",
  "curs4",
  "curs5",
  "system",
];

/** Groupes de formes et plages de scripts de l'écran (`11a0:0000(0, 0, 1100)`, `(0, 1, 1200)`, `11a8:14ab(16, 1100)`, `11a8:15a6(0, 16, 1200)`). */
const MAIN_FIRST = 1100;
const NEXT_FIRST = 1200;
const SCRIPTS_PER_RANGE = 16;
/** Délai des features que `10b0:0027` ne crée pas à cet endroit (1105, et 1111–1115 : les champignons cliquables du camp, voir `camp.ts`) : valeur des autres décors, non relevée. */
const DEFAULT_DELAY = 6;
/** Bit de `10b0:0027` (feature 1107) que `11a0:033a` et `11a8:1be6` ne lisent pas. */
const UNREAD_FLAG_1000 = 0x1000;
/** Bits des features 1110 (`0x50180000`) que `11a0:033a` et `11a8:1be6` ne lisent pas. */
const UNREAD_FLAGS_1110 = 0x50000000;

/** Zoombinis de la démo (numéros 0 à 624 de `traitsIndex`) : cheveux, yeux, nez et pieds tous différents d'un Zoombini à l'autre. */
const DEMO_ZOOMBINIS = [0, 3 * 125 + 25 + 2 * 5 + 4, 125 + 4 * 25 + 1, 4 * 125 + 2 * 25 + 4 * 5 + 2, 2 * 125 + 5 + 3] as const;
const NODE_PATH_ID = 1000;
/** Numéro (à partir de 0) du chemin suivi dans `PATH` 1000 : nœuds 1, 2 et 7. */
const DEMO_PATH = 1;
/** Ticks entre l'entrée de deux Zoombinis, et écart en pixels entre leurs places d'arrêt (à la file, le premier en tête). */
const SNOID_SPACING_TICKS = 14;
const SNOID_SPACING_PX = 34;
/** Distance hors de l'écran, à gauche du premier nœud, où un Zoombini apparaît. */
const SNOID_ENTRY_OFFSET = 40;

interface FeatureParams {
  script: number;
  delay: number;
  flags: number;
}

/** Les appels de `11a8:0ad6` de `10b0:0027`, dans l'ordre de création (donc de profondeur), puis les scripts qu'il ne crée pas. */
function baseCampFeatures(): FeatureParams[] {
  const {
    staticFirst,
    stopAtEnd,
    noReplay,
    random,
    queueScript,
    active,
    firstImage,
  } = FeatureFlag;
  const list: FeatureParams[] = [];
  for (let i = 0; i < SCRIPTS_PER_RANGE; i++) {
    list.push({
      script: NEXT_FIRST + i,
      delay: 7,
      flags: staticFirst | noReplay | active | firstImage,
    });
  }
  list.push(
    { script: 1106, delay: 6, flags: staticFirst | stopAtEnd | noReplay },
    { script: 1108, delay: 6, flags: staticFirst | stopAtEnd | noReplay },
    { script: 1109, delay: 6, flags: stopAtEnd | noReplay },
    { script: 1110, delay: 6, flags: UNREAD_FLAGS_1110 | stopAtEnd | noReplay },
    {
      script: 1107,
      delay: 6,
      flags: staticFirst | stopAtEnd | UNREAD_FLAG_1000,
    },
    { script: 1104, delay: 6, flags: random | queueScript },
  );
  for (let id = MAIN_FIRST; id < MAIN_FIRST + 4; id++)
    list.push({ script: id, delay: 0, flags: 0 });
  for (let id = MAIN_FIRST; id < MAIN_FIRST + SCRIPTS_PER_RANGE; id++) {
    if (!list.some((params) => params.script === id))
      list.push({ script: id, delay: DEFAULT_DELAY, flags: 0 });
  }
  return list;
}

function createFeatures(features: Features, archive: Archive): void {
  features.setArchive(archive);
  features.defineGroup(0, MAIN_FIRST);
  features.defineGroup(1, NEXT_FIRST);
  features.setScripts(MAIN_FIRST, SCRIPTS_PER_RANGE);
  features.addScripts(NEXT_FIRST, SCRIPTS_PER_RANGE);
  for (const params of baseCampFeatures()) features.create(params);
}

export function createDemoScene(): Scene {
  let archive: Archive;
  let soundId: number | undefined;
  let map: WalkMap;
  const snoids: Snoid[] = [];
  /** Tick d'entrée du prochain Zoombini. */
  let nextEntry = 0;
  /** Position dans `CURSOR_CYCLE` du curseur affiché ; -1 = le curseur de départ (`system`). */
  let cursorIndex = -1;

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(ARCHIVE);
      soundId = archive.ids(TAG_SND).find((id) => id >= FIRST_SCREEN_SOUND);
      map = { nodes: node(archive, NODE_PATH_ID), paths: [path(archive, NODE_PATH_ID)[DEMO_PATH]!] };
    },
    enter(ctx: SceneContext) {
      const { screen, palette } = ctx.services.get(GRAPHICS);
      const sound = ctx.services.get(ZOOMBINIS_SOUND);
      const features = ctx.services.get(FEATURES);
      palette.loadShpl(archive.shpl(BACKGROUND_ID));
      const background = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
      drawShape(background, archive.tbmp(BACKGROUND_ID), 0, 0, 0);
      drawShape(screen, archive.tbmp(BACKGROUND_ID), 0, 0, 0);
      features.setBackground(background);
      createFeatures(features, archive);
      sound.setScreenArchive(archive);
      sound.queue(MUSIC_ID);
      snoids.length = 0;
      nextEntry = ctx.clock.ticks;
      ctx.requestPresent();
    },
    leave(ctx: SceneContext) {
      ctx.services.get(FEATURES).clear();
      ctx.services.get(ZOOMBINIS_SOUND).setScreenArchive(null);
      ctx.setCursor("system");
    },
    tick(ctx: SceneContext) {
      if (snoids.length < DEMO_ZOOMBINIS.length && ctx.clock.ticks >= nextEntry) {
        const index = snoids.length;
        const first = map.nodes[map.paths[0]![0]! - 1]!;
        const last = map.nodes[map.paths[0]![map.paths[0]!.length - 1]! - 1]!;
        const snoid = createSnoid(ctx, traitsFromIndex(DEMO_ZOOMBINIS[index]!), {
          position: { x: first.x - SNOID_ENTRY_OFFSET, y: first.y },
        });
        snoid.walkTo({ x: last.x - index * SNOID_SPACING_PX, y: last.y }, map);
        snoids.push(snoid);
        nextEntry += SNOID_SPACING_TICKS;
      }
      for (const event of ctx.input.buttonEvents) {
        if (!event.down || event.button !== "left") continue;
        cursorIndex = (cursorIndex + 1) % CURSOR_CYCLE.length;
        ctx.setCursor(CURSOR_CYCLE[cursorIndex]!);
        if (soundId !== undefined)
          ctx.services.get(ZOOMBINIS_SOUND).queue(soundId);
      }
    },
  };
}
