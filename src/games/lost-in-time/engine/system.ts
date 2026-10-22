import { CdAudio } from "./audio/cd";
import type { CdBackend, SoundBackend, SoundSource } from "./audio/backend";
import { SoundEngine } from "./audio/sound";
import { DEFAULT_SOUND_FLAGS } from "./game";
import { GraphicsSystems, installGraphics } from "./graphics";
import { Hotspots } from "./hotspots";
import type {
  CdSystem,
  CursorSystem,
  DrawSystem,
  GoblinSystem,
  Host,
  HotspotSystem,
  MultSystem,
  PaletteSystem,
  SaveSystem,
  SoundSystem,
  Subsystems,
  VideoSystem,
  VmContext,
} from "./host";
import { installMult } from "./mult";
import { GameSaves, type KeyValueStore } from "./saves";
import { installVideo } from "./video";

/** Lost in Time n'utilise pas les gobelins : le sous-système ne fait rien. */
const NO_GOBLINS: GoblinSystem = {
  freeObjects() {},
  loadMapObjects() {},
  moveGoblin() {},
  writeGoblinPos() {},
  stopGoblin() {},
  setGoblinState() {},
  placeGoblin() {},
};

class RealSubsystems implements Subsystems {
  draw!: DrawSystem;
  cursor!: CursorSystem;
  palette!: PaletteSystem;
  mult!: MultSystem;
  goblin: GoblinSystem = NO_GOBLINS;
  sound!: SoundSystem;
  cd!: CdSystem;
  video!: VideoSystem;
  saves!: SaveSystem;
  hotspots!: HotspotSystem;
  attach?: (vm: VmContext) => void;
}

export interface SystemOptions {
  host: Host;
  soundBackend: SoundBackend;
  cdBackend: CdBackend;
  store: KeyValueStore;
  /** Fichier ordinaire déjà chargé par l'hôte (LOST.LIC n'est dans aucune archive). */
  peekFile?(name: string): Uint8Array | undefined;
}

export interface System {
  sys: Subsystems;
  gfx: GraphicsSystems;
  hotspots: Hotspots;
  sound: SoundEngine;
  cd: CdAudio;
  saves: GameSaves;
}

/** Ajoute `fn` à la chaîne des `attach` (appelés quand la machine virtuelle est construite). */
function onAttach(sys: Subsystems, fn: (vm: VmContext) => void): void {
  const previous = sys.attach?.bind(sys);
  sys.attach = (vm) => {
    previous?.(vm);
    fn(vm);
  };
}

/**
 * Construit tous les sous-systèmes réels (affichage, zones, animations, vidéo, son, CD, sauvegardes)
 * et les relie entre eux. À passer à `new Game(host, sys)`.
 */
export function createSystem(options: SystemOptions): System {
  const { host } = options;
  const sys = new RealSubsystems();
  let vm: VmContext | null = null;
  onAttach(sys, (v) => (vm = v));

  const gfx = installGraphics(sys);
  installMult(sys, gfx);
  installVideo(sys, gfx);

  const source: SoundSource = {
    getFile: (name) => vm?.getFile(name),
    getResource: (id) => vm?.resources?.getResource(id)?.data ?? null,
  };
  const sound = new SoundEngine({
    backend: options.soundBackend,
    host,
    source,
    shouldQuit: () => vm?.quit ?? false,
    soundFlags: DEFAULT_SOUND_FLAGS,
  });
  sys.sound = sound;

  const cd = new CdAudio({
    backend: options.cdBackend,
    now: () => host.now(),
    getFile: (name) => vm?.getFile(name) ?? options.peekFile?.(name),
  });
  sys.cd = cd;

  const hotspots = new Hotspots(sys);
  sys.hotspots = hotspots;
  onAttach(sys, (v) => hotspots.attach(v));
  // Le curseur sous la souris dépend des zones actives.
  gfx.cursor.findCursor = (x, y) => hotspots.findCursor(x, y);

  const saves = new GameSaves(gfx, options.store);
  sys.saves = saves;
  onAttach(sys, (v) => saves.attach(v));

  return { sys, gfx, hotspots, sound, cd, saves };
}
