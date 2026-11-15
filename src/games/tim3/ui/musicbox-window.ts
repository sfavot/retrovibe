/**
 * Guitare : `MUSICBOX.ITF` (ouverture 4234ec, procédure 423587, clics 423999), pour tous les modes.
 *
 * - Musique (`MUSIC.RES`, textes 3001…) : ▲ (15004) précédente, ▼ (15005) suivante, en boucle ; sans CD, les morceaux 1007, 1005,
 *   1014 et 1015 sont sautés. La musique en cours s'arrête tout de suite et la nouvelle part 5 passes plus tard (`[0x47f970]`,
 *   423893). MB_MUSIC (15002) la redemande ; l'interrupteur 15003 coupe ou rallume la musique.
 * - Son (`SOUND.RES`, 22 effets) : ▲ (15010) / ▼ (15011) en boucle, l'effet choisi est joué 5 passes plus tard ; MB_SOUND (15020)
 *   le rejoue ; l'interrupteur 15009 coupe ou rallume les effets. Le choix est gardé d'une ouverture à l'autre.
 * - Titres (rappel 423d43) : rectangle du cadre décalé de 2 pixels vers le bas, couleur 15, centré (0x302), nom après le numéro.
 * - Interrupteurs (423dca) : image 0 = marche, dernière image = arrêt. Écart : le jeu affiche toujours le son « marche » à l'ouverture
 *   (4115e6(0, −1)) ; le port montre l'état réel.
 * - Volume (`[0x47796c]`, 0 à 15) : ▲ / ▼ vont au palier suivant de {0, 3, 5, 8, 10, 13, 15} (0x472b00), sans boucler ; MB_SPEAKER montre
 *   le nombre de paliers atteints (423e18). Musique et effets, pas les voix.
 * - Labo : la musique choisie devient celle du Labo (`[0x477950]`, Labo modifié) ; en Jeu, elle dure jusqu'au prochain puzzle.
 * - MB_HELP (`TIMHELP.EXE` 4169c8(7)) : non porté, grisé.
 * - **Ajout du site** : une bande « Voix du professeur » sous le volume (cadre de style 3, interrupteur de l'état 14 comme ceux de la
 *   musique et du son, libellé en `SYS12.PFT`) ; le cadre de la fenêtre grandit d'autant.
 */
import { readItf, type Itf, type ItfControl } from "../data/itf";
import type { IdText } from "../data/text";
import type { RenderAssets } from "../render/assets";
import type { Rect } from "../render/editor-overlay";
import { ITF_DEFAULT_FONT, drawTextBox, imageOfState, stateLength } from "../render/itf-draw";
import type { Surface } from "../render/surface";
import { copy } from "../copy";
import { openItfWindow, type ItfWindowHandle, type ItfWindowOptions, type ItfHost } from "./itf-window";

export const MUSICBOX = {
  sound: 15020,
  help: 15019,
  speaker: 15018,
  done: 15017,
  volumeDown: 15015,
  volumeUp: 15014,
  soundTitle: 15012,
  soundNext: 15011,
  soundPrevious: 15010,
  soundSwitch: 15009,
  musicTitle: 15006,
  musicNext: 15005,
  musicPrevious: 15004,
  musicSwitch: 15003,
  music: 15002,
  frame: 15000,
  /** Bande ajoutée par le site. */
  voicePanel: 15900,
  voiceSwitch: 15901,
  voiceLabel: 15902,
} as const;
/** Morceaux du CD audio, sautés sans CD (423a82, `[0x477ab8]` = 0). */
export const CD_TRACKS: readonly number[] = [1007, 1005, 1014, 1015];
/** Paliers du volume (0x472b00). */
export const VOLUME_STEPS: readonly number[] = [0, 3, 5, 8, 10, 13, 15];
/** Passes avant de jouer le morceau ou l'effet choisi (`[0x47f970]` = 5, 423893). */
export const PLAY_DELAY = 5;
/** Hauteur de la bande « Voix du professeur ». */
const VOICE_BAND = 62;

export interface MusicboxState {
  /** Musique courante (1000…), 0 : aucune. */
  music: number;
  musicOn: boolean;
  effectsOn: boolean;
  volume: number;
  voicesOn: boolean;
  /** Effet choisi (index dans `SOUND.RES`), gardé d'une ouverture à l'autre. */
  effect: number;
}

export interface MusicboxOptions {
  musicList: readonly IdText[];
  soundList: readonly IdText[];
  initial: MusicboxState;
  /** Joue le morceau (après le délai) ; 0 arrête. */
  playMusic(id: number): void;
  stopMusic(): void;
  playEffect(id: number): void;
  stopEffect(id: number): void;
  setMusicOn(on: boolean): void;
  setEffectsOn(on: boolean): void;
  setVolume(v: number): void;
  setVoices(on: boolean): void;
  /** Le morceau choisi change (Labo : il devient celui du Labo). */
  musicChosen(id: number): void;
  /** L'effet choisi (gardé par l'appelant). */
  effectChosen(index: number): void;
}

/** MUSICBOX.ITF avec la bande « Voix du professeur » sous le volume (cadre agrandi). */
export function withVoiceBand(itf: Itf): Itf {
  const controls = itf.controls.map((c) => ({ ...c }));
  const frame = controls.find((c) => c.id === MUSICBOX.frame);
  const back = itf.controls.find((c) => c.id === 15013);
  const toggle = itf.controls.find((c) => c.id === MUSICBOX.soundSwitch);
  if (!frame || !back || !toggle) return itf;
  frame.height += VOICE_BAND;
  const y = back.y + back.height + 4;
  const extra: ItfControl[] = [
    { ...toggle, id: MUSICBOX.voiceSwitch, x: back.x + 24, y: y + Math.trunc((VOICE_BAND - 4 - toggle.height) / 2) },
    { kind: 0, id: MUSICBOX.voiceLabel, unknown04: -3, x: back.x + 56, y: y + 4, width: back.width - 64, height: VOICE_BAND - 14, image: 0, value: 21000, unknown12: 0, unknown14: 0 },
    { ...back, id: MUSICBOX.voicePanel, y, height: VOICE_BAND - 4 },
  ];
  // Devant le décor de fond (dernier contrôle), derrière tout le reste.
  controls.splice(controls.length - 1, 0, ...extra);
  return { ...itf, controls };
}

/** Image de MB_SPEAKER : paliers non nuls atteints (423e18). */
export function speakerFrame(volume: number): number {
  return VOLUME_STEPS.slice(1).filter((s) => s <= volume).length;
}

export function volumeStep(volume: number, up: boolean): number {
  if (up) return VOLUME_STEPS.find((s) => s > volume) ?? volume;
  return [...VOLUME_STEPS].reverse().find((s) => s < volume) ?? volume;
}

export function musicboxWindow(assets: RenderAssets, baseItf: Itf, o: MusicboxOptions): { itf: Itf; options: ItfWindowOptions } {
  const itf = withVoiceBand(baseItf);
  const s = { ...o.initial };
  const playable = o.musicList.filter((m) => !CD_TRACKS.includes(m.id));
  let musicIndex = Math.max(0, playable.findIndex((m) => m.id === s.music));
  /** Passes avant de jouer : morceau, effet (−1 : rien en attente). */
  let musicDelay = -1;
  let effectDelay = -1;
  let playingEffect = -1;
  const anm = itf.anm ? assets.anm(itf.anm) : null;
  const frameCount = (id: number): number => {
    const c = itf.controls.find((k) => k.id === id);
    const first = c && anm ? imageOfState(anm, c.value) : -1;
    return anm && first >= 0 ? stateLength(anm, first) : 1;
  };
  const switchFrame = (on: boolean, id: number): number => (on ? 0 : frameCount(id) - 1);
  const frames = (): Record<number, number> => ({
    [MUSICBOX.musicSwitch]: switchFrame(s.musicOn, MUSICBOX.musicSwitch),
    [MUSICBOX.soundSwitch]: switchFrame(s.effectsOn, MUSICBOX.soundSwitch),
    [MUSICBOX.voiceSwitch]: switchFrame(s.voicesOn, MUSICBOX.voiceSwitch),
    [MUSICBOX.speaker]: speakerFrame(s.volume),
  });
  const title = (text: () => string) => (surface: Surface, r: Rect): void => {
    const font = assets.font(ITF_DEFAULT_FONT);
    if (font) drawTextBox(surface, font, text(), { ...r, y: r.y + 2 }, { mode: 0, color: 15, flags: 0x302, font: ITF_DEFAULT_FONT });
  };
  const musicName = (): string => playable[musicIndex]?.text ?? "";
  const effectName = (): string => o.soundList[s.effect]?.text ?? "";
  const state: NonNullable<ItfWindowOptions["state"]> = {
    disabled: [MUSICBOX.help],
    texts: { [MUSICBOX.voiceLabel]: copy.voiceBand },
    frames: frames(),
    draw: { [MUSICBOX.musicTitle]: title(musicName), [MUSICBOX.soundTitle]: title(effectName) },
  };
  const update = (): void => {
    state.frames = frames();
  };
  const chooseMusic = (step: number): void => {
    if (playable.length === 0) return;
    musicIndex = (musicIndex + step + playable.length) % playable.length;
    o.stopMusic();
    const id = playable[musicIndex]!.id;
    o.musicChosen(id);
    musicDelay = PLAY_DELAY;
  };
  const chooseEffect = (step: number): void => {
    const n = o.soundList.length;
    if (n === 0) return;
    s.effect = (s.effect + step + n) % n;
    o.effectChosen(s.effect);
    effectDelay = PLAY_DELAY;
  };
  return {
    itf,
    options: {
      title: copy.musicboxTitle,
      state,
      defaultId: MUSICBOX.done,
      cancelId: MUSICBOX.done,
      // Noms du calque : les infobulles du jeu (« Relancer » deux fois, « On/Off »…) ne disent pas de quoi il s'agit.
      labels: {
        [MUSICBOX.music]: copy.musicReplay,
        [MUSICBOX.musicSwitch]: copy.musicSwitch,
        [MUSICBOX.musicPrevious]: copy.musicPrevious,
        [MUSICBOX.musicNext]: copy.musicNext,
        [MUSICBOX.sound]: copy.effectReplay,
        [MUSICBOX.soundSwitch]: copy.effectsSwitch,
        [MUSICBOX.soundPrevious]: copy.effectPrevious,
        [MUSICBOX.soundNext]: copy.effectNext,
        [MUSICBOX.voiceSwitch]: copy.voices,
      },
      checked: (id) => (id === MUSICBOX.musicSwitch ? s.musicOn : id === MUSICBOX.soundSwitch ? s.effectsOn : id === MUSICBOX.voiceSwitch ? s.voicesOn : undefined),
      status: () => copy.musicboxStatus(musicName(), effectName(), s.volume),
      tick: () => {
        // 4238e7 : `PlaySound(choix, 0, 0)`, sans le drapeau « ne pas relancer » : le morceau repart du début, même s'il jouait déjà
        // (MB_MUSIC, 423a29, force ce départ).
        if (musicDelay >= 0 && --musicDelay < 0 && s.musicOn) {
          o.stopMusic();
          o.playMusic(playable[musicIndex]?.id ?? 0);
        }
        if (effectDelay >= 0 && --effectDelay < 0) {
          if (playingEffect >= 0) o.stopEffect(playingEffect);
          playingEffect = o.soundList[s.effect]?.id ?? -1;
          if (playingEffect >= 0) o.playEffect(playingEffect);
        }
        return false;
      },
      choose: (id) => {
        switch (id) {
          case MUSICBOX.musicPrevious:
            chooseMusic(-1);
            return true;
          case MUSICBOX.musicNext:
            chooseMusic(1);
            return true;
          case MUSICBOX.music:
            musicDelay = PLAY_DELAY;
            return true;
          case MUSICBOX.musicSwitch:
            s.musicOn = !s.musicOn;
            o.setMusicOn(s.musicOn);
            if (s.musicOn) musicDelay = PLAY_DELAY;
            break;
          case MUSICBOX.soundPrevious:
            chooseEffect(-1);
            return true;
          case MUSICBOX.soundNext:
            chooseEffect(1);
            return true;
          case MUSICBOX.sound:
            effectDelay = PLAY_DELAY;
            return true;
          case MUSICBOX.soundSwitch:
            s.effectsOn = !s.effectsOn;
            o.setEffectsOn(s.effectsOn);
            break;
          case MUSICBOX.voiceSwitch:
            s.voicesOn = !s.voicesOn;
            o.setVoices(s.voicesOn);
            break;
          case MUSICBOX.volumeUp:
          case MUSICBOX.volumeDown:
            s.volume = volumeStep(s.volume, id === MUSICBOX.volumeUp);
            o.setVolume(s.volume);
            break;
          default:
            if (playingEffect >= 0) o.stopEffect(playingEffect);
            return false;
        }
        update();
        return true;
      },
    },
  };
}

export function openMusicboxWindow(host: ItfHost, o: MusicboxOptions & { onClose?(): void }): ItfWindowHandle {
  const w = musicboxWindow(host.assets, readItf(host.assets.index.get("MUSICBOX.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}
