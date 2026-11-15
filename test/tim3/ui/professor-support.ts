import type { VoiceRef } from "../../../src/games/tim3/audio/ids";
import { REST_POSE, type MouthPose } from "../../../src/games/tim3/audio/lipsync";
import type { ProfessorAudio } from "../../../src/games/tim3/ui/professor";

/** Son factice du professeur : voix jouées, arrêts, voix « en cours » et pose de la bouche réglables par le test. */
export interface FakeProfessorAudio extends ProfessorAudio {
  played: VoiceRef[];
  stops: number;
  active: boolean;
  pose: MouthPose;
}

export function fakeAudio(playable = true): FakeProfessorAudio {
  const a: FakeProfessorAudio = {
    played: [],
    stops: 0,
    active: false,
    pose: REST_POSE,
    playVoice(ref) {
      a.played.push(ref);
      a.active = playable;
      return playable;
    },
    stopVoice() {
      a.stops++;
      a.active = false;
    },
    get voiceActive() {
      return a.active;
    },
    mouth: () => a.pose,
  };
  return a;
}

/** Sans voix (voix désactivées). */
export const silentAudio = (): FakeProfessorAudio => fakeAudio(false);
