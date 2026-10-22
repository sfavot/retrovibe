import type { Subsystems } from "../host";
import type { GraphicsSystems } from "../graphics";
import { VideoPlayer, type ImdAudio } from "./player";

export { VideoPlayer, videoProps, VIDEO_SLOT_COUNT } from "./player";
export type { ImdAudio, VideoProps } from "./player";

/** Le moteur audio expose-t-il le son des vidéos (SoundEngine) ? */
function imdAudio(sound: unknown): ImdAudio | undefined {
  const s = sound as Partial<ImdAudio> | undefined;
  return s?.queueImdSlice && s.stopImdAudio ? (s as ImdAudio) : undefined;
}

/** Remplace `sys.video` par le vrai lecteur IMD ; il dessine par les sous-systèmes graphiques de `gfx`. */
export function installVideo(sys: Subsystems, gfx: GraphicsSystems): VideoPlayer {
  const player = new VideoPlayer(gfx, () => imdAudio(sys.sound));
  sys.video = player;
  const previous = sys.attach?.bind(sys);
  sys.attach = (vm) => {
    previous?.(vm);
    player.attach(vm);
  };
  return player;
}
