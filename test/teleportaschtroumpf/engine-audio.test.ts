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
    expect(voice.musicHeld).toBe(true);
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

describe("VoiceChannel : canal de bruitages mélangé (`348d:0b42`)", () => {
  it("un bruitage ne coupe ni la voix ni la musique", () => {
    const { backend, voice, advance } = setup();
    voice.setMusic(sound(10, 9));
    advance(16);
    voice.playEffect(sound(1, 5));
    expect(backend.effects.map((e) => e.sound.samples[0])).toEqual([5]);
    expect(backend.plays).toHaveLength(1); // la musique n'a pas été relancée
    expect(backend.stops).toBe(0);
    expect(voice.playing).toBe(true);
    expect(voice.effectPlaying).toBe(true);

    voice.play(sound(5, 3)); // une voix sur la voie, pendant le bruitage
    voice.playEffect(sound(1, 6));
    expect(voice.voicePlaying).toBe(true);
    expect(backend.plays.map((p) => p.sound.samples[0])).toEqual([9, 3]);
  });

  it("un seul emplacement : un second bruitage remplace le premier, qui s'arrête de sonner sur la sortie", () => {
    const { backend, voice, advance } = setup();
    voice.playEffect(sound(5, 1));
    advance(1000);
    voice.playEffect(sound(2, 2));
    expect(backend.effects.map((e) => e.sound.samples[0])).toEqual([1, 2]);
    advance(1500);
    expect(voice.effectPlaying).toBe(true); // c'est le second, depuis 1,5 s sur 2 s
    advance(600);
    expect(voice.effectPlaying).toBe(false); // fini : plus rien ne sonne (`0b42(1, 0) == 0`)
  });

  it("la fin d'un bruitage ne touche pas la voie ; stopEffect ne coupe que le bruitage", () => {
    const { backend, voice, advance } = setup();
    voice.setMusic(sound(10, 9));
    advance(16);
    voice.playEffect(sound(1, 5));
    advance(1500);
    expect(voice.effectPlaying).toBe(false);
    expect(voice.playing).toBe(true);
    voice.playEffect(sound(5, 5));
    voice.stopEffect();
    expect(voice.effectPlaying).toBe(false);
    expect(voice.playing).toBe(true);
    expect(backend.stops).toBe(0);
    voice.stop(); // couper la voie ne dit rien du bruitage
    voice.playEffect(sound(5, 7));
    voice.stop();
    expect(voice.effectPlaying).toBe(true);
  });

  it("le volume s'applique au bruitage comme à la voie (même gain)", () => {
    const { backend, voice } = setup();
    voice.setVolume(5);
    voice.playEffect(sound(1, 5));
    expect(backend.gain).toBeCloseTo(5 / 15);
    voice.setVolume(0);
    expect(backend.gain).toBe(0);
  });

  it("sortie verrouillée : aucun bruitage ne sonne", () => {
    const { backend, voice } = setup();
    backend.enabled = false;
    voice.playEffect(sound(1, 5));
    expect(voice.effectPlaying).toBe(false);
    expect(backend.effects).toHaveLength(0);
  });
});
