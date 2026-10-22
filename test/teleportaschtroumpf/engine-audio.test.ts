import { describe, expect, it } from "vitest";
import { MAX_VOLUME, VoiceChannel } from "../../src/games/teleportaschtroumpf/audio/voice";
import { FakeAudio } from "./engine-test-host";

/** Son de `seconds` secondes à 1000 Hz (valeur d'échantillon = `tag`, pour le reconnaître). */
const sound = (seconds: number, tag: number) => ({ samples: new Uint8Array(seconds * 1000).fill(tag), sampleRate: 1000 });

function setup() {
  let now = 0;
  const backend = new FakeAudio(() => now);
  const voice = new VoiceChannel(backend);
  return {
    backend,
    voice,
    advance(ms: number) {
      now += ms;
      voice.update();
    },
  };
}

describe("VoiceChannel", () => {
  it("une seule voie : lancer un son coupe le précédent", () => {
    const { backend, voice } = setup();
    voice.play(sound(5, 1));
    voice.play(sound(5, 2));
    expect(backend.plays.map((p) => p.sound.samples[0])).toEqual([1, 2]);
    expect(voice.voicePlaying).toBe(true);
  });

  it("la musique démarre en boucle dès que rien ne joue et repart au début après une voix", () => {
    const { backend, voice, advance } = setup();
    voice.setMusic(sound(10, 9));
    advance(16);
    expect(backend.plays).toHaveLength(1);
    expect(backend.plays[0].loop).toBe(true);
    expect(voice.playing).toBe(true);
    advance(5000);
    expect(backend.plays).toHaveLength(1); // elle boucle sans être relancée

    voice.play(sound(1, 3)); // la voix coupe la musique
    expect(backend.plays).toHaveLength(2);
    expect(voice.voicePlaying).toBe(true);
    advance(500);
    expect(backend.plays).toHaveLength(2); // la voix joue encore
    advance(600);
    // Voix finie : la musique reprend, depuis le début (nouveau lancement, pas de reprise de position).
    expect(backend.plays).toHaveLength(3);
    expect(backend.plays[2].sound.samples[0]).toBe(9);
    expect(backend.plays[2].loop).toBe(true);
    expect(voice.position).toBeLessThan(0.1);
  });

  it("holdMusic retient la musique (vidéo) puis la relâche", () => {
    const { backend, voice, advance } = setup();
    voice.setMusic(sound(10, 9));
    voice.holdMusic(true);
    advance(100);
    expect(backend.plays).toHaveLength(0);
    voice.holdMusic(false);
    advance(16);
    expect(backend.plays).toHaveLength(1);
    voice.holdMusic(true); // coupe la musique en cours
    expect(voice.playing).toBe(false);
  });

  it("stop coupe tout ; la musique repart ensuite à l'update", () => {
    const { backend, voice, advance } = setup();
    voice.setMusic(sound(10, 9));
    advance(16);
    voice.stop();
    expect(voice.playing).toBe(false);
    advance(16);
    expect(backend.plays).toHaveLength(2);
    voice.setMusic(null);
    expect(voice.playing).toBe(false);
    advance(16);
    expect(backend.plays).toHaveLength(2);
  });

  it("trois bips préchargés sur la même voie", () => {
    const { backend, voice } = setup();
    voice.setBeeps([sound(1, 11), sound(1, 12), sound(1, 13)]);
    voice.playBeep(1);
    voice.playBeep(2);
    voice.playBeep(7); // inexistant : ignoré
    expect(backend.plays.map((p) => p.sound.samples[0])).toEqual([12, 13]);
    expect(backend.plays.every((p) => !p.loop)).toBe(true);
  });

  it("volume de 0 à 15, transmis en gain 0–1", () => {
    const { backend, voice } = setup();
    expect(voice.volume).toBe(MAX_VOLUME);
    expect(backend.gain).toBe(1);
    voice.setVolume(5);
    expect(backend.gain).toBeCloseTo(5 / 15);
    voice.setVolume(99);
    expect(voice.volume).toBe(15);
    voice.setVolume(-3);
    expect(voice.volume).toBe(0);
    expect(backend.gain).toBe(0);
  });

  it("sortie verrouillée : rien ne joue, la musique est retentée à chaque update", () => {
    const { backend, voice, advance } = setup();
    backend.enabled = false;
    voice.setMusic(sound(10, 9));
    advance(16);
    expect(voice.playing).toBe(false);
    backend.enabled = true; // déblocage au premier geste
    advance(16);
    expect(voice.playing).toBe(true);
    expect(backend.plays).toHaveLength(1);
  });
});
