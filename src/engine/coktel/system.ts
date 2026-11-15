/**
 * Assemblage des sous-systèmes réels (ce que GobEngine::initGameParts fait dans `gob.cpp:558-633`), d'après
 * le descripteur du jeu : sauvegardes et CD viennent de lui.
 */
import type { HostStorage } from "../storage";
import type { CdBackend, SoundBackend, SoundSource } from "./audio/backend";
import { SoundEngine } from "./audio/sound";
import type { CoktelGameDefinition, GameSaveSystem } from "./definition";
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
import { installVideo } from "./video";

/** Gobelins et carte (Gobliins 2, Goblins 3) non portés : Ween et Lost in Time ne s'en servent pas. */
const NO_GOBLINS: GoblinSystem = {
  freeObjects() {},
  loadMapObjects() {},
  moveGoblin() {},
  writeGoblinPos() {},
  stopGoblin() {},
  setGoblinState() {},
  placeGoblin() {},
};

/** Sans CD (ScummVM sans lecteur, `sound/cdrom.cpp`) : rien ne joue, aucune piste en cours. */
const NO_CD: CdSystem = {
  loadLic() {},
  unloadLic() {},
  play() {},
  stop() {},
  getTrackPos: () => -1,
  getCurrentTrack: () => "",
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
  definition: CoktelGameDefinition;
  soundBackend: SoundBackend;
  /** Sortie du CD, pour un jeu qui en a un (`createCd`). */
  cdBackend?: CdBackend;
  /** Stockage des sauvegardes. */
  store: HostStorage;
  /** Fichier ordinaire déjà chargé par l'hôte (un fichier hors archive lu de façon synchrone). */
  peekFile?(name: string): Uint8Array | undefined;
}

export interface System {
  sys: Subsystems;
  gfx: GraphicsSystems;
  hotspots: Hotspots;
  sound: SoundEngine;
  cd: CdSystem;
  saves: GameSaveSystem;
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
 * et les relie entre eux. À passer à `new Game(host, sys, definition)`.
 */
export function createSystem(options: SystemOptions): System {
  const { host, definition } = options;
  const sys = new RealSubsystems();
  let vm: VmContext | null = null;
  onAttach(sys, (v) => (vm = v));

  const gfx = installGraphics(sys);
  installMult(sys, gfx);
  installVideo(sys, gfx, {
    videosWithCursor: definition.videosWithCursor,
    restrictPalette: definition.restrictVideoPalette ?? false,
  });

  const source: SoundSource = {
    getFile: (name) => vm?.getFile(name),
    getResource: (id) => vm?.resources?.getResource(id)?.data ?? null,
  };
  const sound = new SoundEngine({
    backend: options.soundBackend,
    host,
    source,
    shouldQuit: () => vm?.quit ?? false,
    timer: () => vm?.timer,
    soundFlags: DEFAULT_SOUND_FLAGS,
  });
  sys.sound = sound;

  const { cdBackend } = options;
  const cd =
    definition.createCd && cdBackend
      ? definition.createCd({
          backend: cdBackend,
          now: () => host.now(),
          getFile: (name) => vm?.getFile(name) ?? options.peekFile?.(name),
        })
      : NO_CD;
  sys.cd = cd;

  const hotspots = new Hotspots(sys);
  sys.hotspots = hotspots;
  onAttach(sys, (v) => hotspots.attach(v));
  // Le curseur sous la souris dépend des zones actives.
  gfx.cursor.findCursor = (x, y) => hotspots.findCursor(x, y);

  const saves = definition.createSaves({ gfx, store: options.store });
  sys.saves = saves;
  if (saves.attach) onAttach(sys, (v) => saves.attach!(v));

  return { sys, gfx, hotspots, sound, cd, saves };
}
