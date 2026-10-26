/**
 * Pont entre le monde et le son : événements du monde -> `SoundSystem`, auditeur = caméra de la vue, boucle du moteur du joueur
 * (`gm_player_set_form` : 5000 hélicoptère, 5001 véhicules 1, 2, 4 à 11 000 Hz, 5002 forme 3 ; arrêtée à la mort), musique du niveau.
 */
import type { EmitterState, Listener, MusicContext, SoundRequest } from "../audio";
import { MUSIC_CONTEXTS } from "../audio";
import type { WorldEvent } from "../engine/events";
import type { World } from "../engine/world";
import type { RenderCamera } from "../render/view";

/** Ce que le pont utilise de `SoundSystem`. */
export interface SoundPort {
  play(request: SoundRequest): boolean;
  startLoop(request: SoundRequest, frequency?: number): boolean;
  stopLoop(sound: number, objectId?: number): void;
  stopAll(): void;
  update(): void;
  setListener(listener: Listener): void;
  setEmitterResolver(resolver: ((objectId: number) => EmitterState | undefined) | null): void;
}

/** Ce que le pont utilise de `MusicSystem`. */
export interface MusicPort {
  setContext(context: MusicContext): void;
}

/** Unités Q8 -> unités monde (les sons sont demandés en unités monde). */
const UNIT = 1 / 256;
/** Fréquence de lecture des boucles de moteur des véhicules (`objet+0x190`). */
const VEHICLE_ENGINE_HZ = 11000;

/** Boucle de moteur d'une forme du joueur, ou `null` (démo, mort). */
export function engineLoop(form: number): { sound: number; frequency?: number } | null {
  if (form === 0) return { sound: 5000 };
  if (form === 3) return { sound: 5002 };
  if (form === 1 || form === 2 || form === 4 || form === 5) return { sound: 5001, frequency: VEHICLE_ENGINE_HZ };
  return null;
}

/** Contexte musical d'un niveau (`level:TERRAN00`…), `silent` pour un niveau sans piste (la démo). */
export function musicContextOf(levelName: string): MusicContext {
  const context = `level:${levelName.toUpperCase()}` as MusicContext;
  return MUSIC_CONTEXTS.includes(context) ? context : "silent";
}

/**
 * Auditeur d'après la caméra de la vue : position, cap en radians (0 = +z, croissant vers +x) et base exacte (vecteurs unitaires,
 * tangage compris) comme le jeu qui prend `F = trunc(256·f)` et `R = trunc(256·r)` de la base de la caméra.
 */
export function listenerOf(camera: RenderCamera): Listener {
  const yaw = (camera.yaw * 2 * Math.PI) / 512;
  const pitch = (camera.pitch * 2 * Math.PI) / 512;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return {
    x: camera.x,
    y: camera.y,
    z: camera.z,
    yaw,
    forward: [sy * Math.cos(pitch), -Math.sin(pitch), cy * Math.cos(pitch)],
    right: [cy, 0, -sy],
  };
}

export class SoundBridge {
  private engine: { sound: number; objectId: number } | null = null;
  private world: World | null = null;

  constructor(
    private readonly sound: SoundPort,
    private readonly music: MusicPort | null = null,
  ) {}

  /** Lie un niveau : émetteur du joueur, boucle de moteur de sa forme de départ (l'événement initial n'est pas émis), musique. */
  attach(world: World, levelName: string): void {
    this.world = world;
    const player = world.player.obj;
    this.sound.setEmitterResolver((objectId) => {
      if (objectId !== player.slot) return undefined;
      const loop = engineLoop(world.player.form);
      return { x: player.x * UNIT, y: player.y * UNIT, z: player.z * UNIT, frequency: loop?.frequency };
    });
    this.startEngine(world.player.form);
    this.music?.setContext(musicContextOf(levelName));
  }

  /** Événements du monde d'une image : sons ponctuels, changement de forme (moteur), mort du joueur. */
  handle(events: readonly WorldEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case "sound":
          this.sound.play({ sound: e.id, x: e.x * UNIT, y: e.y * UNIT, z: e.z * UNIT });
          break;
        case "formChanged":
          this.startEngine(e.form);
          break;
        case "playerDied":
          this.stopEngine();
          break;
        default:
          break;
      }
    }
  }

  /** À chaque image : auditeur = caméra de la vue, puis volume et panoramique de toutes les voix. */
  update(camera: RenderCamera): void {
    this.sound.setListener(listenerOf(camera));
    this.sound.update();
  }

  private startEngine(form: number): void {
    this.stopEngine();
    const loop = engineLoop(form);
    if (!loop || !this.world) return;
    const objectId = this.world.player.obj.slot;
    const player = this.world.player.obj;
    this.sound.startLoop({ sound: loop.sound, x: player.x * UNIT, y: player.y * UNIT, z: player.z * UNIT, objectId }, loop.frequency);
    this.engine = { sound: loop.sound, objectId };
  }

  private stopEngine(): void {
    if (!this.engine) return;
    this.sound.stopLoop(this.engine.sound, this.engine.objectId);
    this.engine = null;
  }
}
