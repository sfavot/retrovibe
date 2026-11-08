import { IgorType } from "../render/heads";
import type { Scene } from "../render/renderer";
import { COMPLETE_PAL, HALF_PAL, TextColor } from "../render/palette";
import type { DrasculaEngine } from "../engine/loop";
import { type Sequence, skippable, wait } from "../../../engine/sequence";
import { delay, pause } from "../engine/cadence";
import { Track } from "../engine/state";
import { animate, clearScreen, playSsn, printOnScreen, showPicture, showScene, showSurface } from "./player";

/**
 * Cinématiques de *Drascula* : les logos et l'introduction (`animation_1_1`), le début des chapitres 4 et 6 (`animation_castle`,
 * `animation_1_6`, `animation_5_6`, `activatePendulum`) et la fin du jeu (`animation_9_6`, générique). Réécriture de ces fonctions
 * (engines/drascula/animation.cpp, ScummVM), en séquences : chacune se relit contre l'original, ligne à ligne.
 *
 * **Échap** (`term_int` de ScummVM) : une cinématique à vidéos est enveloppée d'un `skippable` ; le saut l'abandonne tout entière et le
 * moteur reprend après elle (les écrans et les feuilles sont remis en état, comme après la boucle `while (term_int == 0)` de l'original).
 * Chaque vidéo se saute aussi à elle seule (`playSsn`, `animate` rendent vrai), et une réplique ne coupe que la réplique (`talk.ts`).
 * Écarts : (1) ScummVM garde `term_int` levé pour la suite du jeu (le générique final, joué par `playFLI`, ne se joue alors plus) ;
 * ici chaque saut ne concerne que ce qui joue ; (2) le texte écrit par `talk_solo` ne reste pas à l'écran après la réplique ;
 * (3) le défilement de l'introduction (180 colonnes) n'attend rien dans ScummVM, qui va aussi vite que l'écran : ici 2 ticks par colonne
 * (50 images par seconde), à mesurer ; (4) pas de synthèse vocale (`sayText`).
 *
 * Les cinématiques sont livrées dans `CINEMATICS`, que le jeu passe au moteur par `GameScript.animations` : le moteur appelle `1_1`,
 * `castle` et `1_6` à ses débuts de chapitre ; les pièces (vague P) appellent `9_6` et les autres.
 */

/** `interf_x`, `interf_y` : les sept images de l'écran qui clignote dans l'introduction (feuille `aux104.alg`). */
const SCREEN_X = [1, 65, 129, 193, 1, 65, 129];
const SCREEN_Y = [51, 51, 51, 51, 83, 83, 83];

// --- Logos et introduction ---------------------------------------------------------------------------------------------------

/**
 * Les logos : `LOGODDM.BIN` (9 tours par seconde) sur le thème 29, puis `LOGOALC.BIN` (8) sur le thème 26. Rend vrai si l'un d'eux a été sauté.
 */
export function* logos(g: DrasculaEngine): Sequence<boolean> {
  g.host.playMusic(29);
  if (yield* playSsn(g, "logoddm.bin", 9)) return true;
  yield* delay(600);
  clearScreen(g);
  yield* delay(340);
  g.host.playMusic(26);
  yield* delay(500);
  if (yield* playSsn(g, "logoalc.bin", 8)) return true;
  return false;
}

/**
 * Le ciel et l'histoire : `CIELO.ALG` (fondu depuis le noir), le titre, la bande qui défile (`SCROLLB.BIN`), les deux animations
 * `SCR2` et `SCR3`, puis `CIELO2.ALG` et fondu au noir. Rend vrai si une vidéo a été sautée.
 */
export function* introStory(g: DrasculaEngine): Sequence<boolean> {
  clearScreen(g);
  showPicture(g, "cielo.alg", "complete");
  g.black();
  yield* g.fadeFromBlack(2);
  yield* delay(900);
  printOnScreen(g, g.data.text("textmisc", 1), 160, 100, TextColor.Red);
  yield* delay(1000);
  yield* delay(1200);
  yield* playSsn(g, "scrollb.bin", 9);
  clearScreen(g);
  g.playEffect(5);
  if (yield* animate(g, "scr2.bin", 17)) return true;
  g.stopSound();
  if (yield* animate(g, "scr3.bin", 17)) return true;
  showPicture(g, "cielo2.alg", "complete");
  yield* g.fadeToBlack(1);
  clearScreen(g);
  return false;
}

/**
 * `animation_1_1` : l'introduction du chapitre 1 (les logos, l'histoire, le château de Drascula, Igor, les plans, l'éclair, puis
 * `INTRO.BIN`). Les répliques sont celles de Drascula et d'Igor (`textd`, `texti`) ; les textes des cartes sont dessinés dans les vidéos.
 */
export function* intro(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const s = g.state;
  const t = g.talkers;
  yield* skippable(
    (function* (): Sequence<true> {
      if (yield* logos(g)) return true;
      if (yield* introStory(g)) return true;

      // Le château vu de loin : le décor 103 défile vers la gauche devant la porte (104), l'écran de Drascula clignote.
      gfx.loadPic(96, gfx.front, COMPLETE_PAL);
      gfx.loadPic(103, gfx.bg, HALF_PAL);
      gfx.loadPic(104, gfx.draw3);
      gfx.loadPic("aux104.alg", gfx.draw2);
      g.host.playMusic(4);
      yield* delay(400);
      gfx.owner = "canvas";
      for (let round = 0; round < 3; round++) {
        for (let l = 0; l < 7; l++) {
          gfx.canvas.copyBackground(gfx.bg, 0, 0, 0, 0, 320, 200);
          gfx.canvas.copyBackground(gfx.draw2, SCREEN_X[l], SCREEN_Y[l], 156, 45, 63, 31);
          yield* pause(3);
        }
      }
      for (let l = 0, frame = 0, p = 0; l < 180; l++) {
        gfx.canvas.copyBackground(gfx.draw3, 0, 0, 320 - l, 0, l, 200);
        gfx.canvas.copyBackground(gfx.bg, l, 0, 0, 0, 320 - l, 200);
        gfx.canvas.copyRect(gfx.draw2, SCREEN_X[frame], SCREEN_Y[frame], 156 - l, 45, 63, 31);
        yield* wait(2);
        if (++p === 6) {
          p = 0;
          frame++;
        }
        if (frame === 7) frame = 0;
      }
      // Le dernier plan du défilement devient le décor de la scène de Drascula en gros plan.
      gfx.bg.load(gfx.canvas.pixels);
      if (yield* t.drasculaBig(1)) return true;

      // Drascula et Igor dans la salle du trône.
      clearScreen(g);
      gfx.loadPic(100, gfx.bg, HALF_PAL);
      gfx.loadPic("auxigor.alg", gfx.front);
      gfx.loadPic("auxdr.alg", gfx.back);
      s.drascula = { x: 129, y: 95, track: 0 };
      s.igor = { x: 66, y: 97, track: 1 };
      showScene(g);
      yield* t.igor(8, IgorType.Right);
      showScene(g);
      yield* t.drascula(2);
      yield* t.drascula(3);
      if (yield* animate(g, "lib.bin", 16)) return true;
      if (yield* animate(g, "lib2.bin", 16)) return true;

      // Les plans de l'armée : trois cartes, Drascula parle en voix off.
      clearScreen(g);
      s.colorSolo = TextColor.Red;
      showPicture(g, "plan1.alg", "half");
      yield* pause(10);
      yield* t.solo(g.data.text("textd", 4), "d4.als");
      showPicture(g, "plan1.alg", "half");
      yield* t.solo(g.data.text("textd", 5), "d5.als");
      if (yield* animate(g, "lib2.bin", 16)) return true;
      clearScreen(g);
      showPicture(g, "plan2.alg", "half");
      yield* pause(20);
      yield* t.solo(g.data.text("textd", 6), "d6.als");
      if (yield* animate(g, "lib2.bin", 16)) return true;
      clearScreen(g);
      showPicture(g, "plan3.alg", "half");
      yield* pause(20);
      yield* t.solo(g.data.text("textd", 7), "d7.als");
      showPicture(g, "plan3.alg", "half");
      yield* t.solo(g.data.text("textd", 8), "d8.als");

      // Retour à la salle du trône, la musique baisse.
      clearScreen(g);
      gfx.loadPic(100, gfx.bg, HALF_PAL);
      yield* g.musicFadeout();
      yield* t.igor(9, IgorType.Right);
      yield* t.drascula(9);
      yield* t.igor(10, IgorType.Right);
      g.host.playMusic(11);
      yield* t.drascula(10);
      if (yield* animate(g, "rayo1.bin", 16)) return true;
      g.playEffect(5);
      if (yield* animate(g, "rayo2.bin", 15)) return true;
      if (yield* animate(g, "frel2.bin", 16)) return true;
      if (yield* animate(g, "frel.bin", 16)) return true;
      if (yield* animate(g, "frel.bin", 16)) return true;
      g.stopSound();
      clearScreen(g);
      g.black();
      g.host.playMusic(23);
      yield* g.fadeFromBlack(0);

      // L'éclair est passé : la conversation reprend, Drascula se tourne tour à tour.
      s.drascula.track = 1;
      yield* t.igor(1, IgorType.Right);
      yield* t.drascula(11, 1);
      s.drascula.track = 3;
      showScene(g);
      yield* pause(1);
      s.drascula.track = 0;
      showScene(g);
      yield* t.drascula(12);
      s.drascula.track = 3;
      showScene(g);
      yield* pause(1);
      s.drascula.track = 1;
      showScene(g);
      yield* t.igor(2, IgorType.Right);
      yield* pause(13);
      yield* t.drascula(13, 1);
      s.drascula.track = 3;
      showScene(g);
      yield* pause(1);
      s.drascula.track = 0;
      showScene(g);
      yield* t.drascula(14);
      yield* t.igor(3, IgorType.Right);
      yield* t.drascula(15);
      yield* t.igor(4, IgorType.Right);
      yield* t.drascula(16);
      yield* t.igor(5, IgorType.Right);
      s.igor.track = 3;
      yield* t.drascula(17);
      yield* pause(18);
      yield* t.igor(6, IgorType.Front);
      yield* g.fadeToBlack(0);
      clearScreen(g);

      g.host.playMusic(2);
      yield* pause(5);
      yield* playSsn(g, "intro.bin", 12);
      return true;
    })(),
  );
  // Fin de la boucle de l'original, que l'introduction ait été vue ou sautée.
  clearScreen(g);
  gfx.loadPic(96, gfx.front, COMPLETE_PAL);
  gfx.loadPic(99, gfx.back);
}

// --- Chapitres ---------------------------------------------------------------------------------------------------------------

/**
 * `animation_castle` : début du chapitre 4, le château en cinq vues (`ANR_1` à `ANR_5`) sur un coup de tonnerre. Les cinq images
 * passent par les feuilles de héros et le décor, qu'on remet en état (`startChapter`) comme le fait la suite de `run()`.
 */
export function* castle(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  gfx.loadPic("anr_1.alg", gfx.front, HALF_PAL);
  gfx.loadPic("anr_2.alg", gfx.extra);
  gfx.loadPic("anr_3.alg", gfx.back);
  gfx.loadPic("anr_4.alg", gfx.bg);
  gfx.loadPic("anr_5.alg", gfx.draw3);
  showSurface(g, gfx.front);
  yield* pause(50);
  g.playEffect(5);
  for (const surface of [gfx.extra, gfx.back, gfx.bg, gfx.back, gfx.draw3]) {
    showSurface(g, surface);
    yield* pause(3);
  }
  showSurface(g, gfx.front);
  yield* g.finishSound();
  gfx.startChapter(4);
}

/**
 * `animation_5_6` : la manivelle (`MAN.BIN`), puis l'objet descend du haut de l'écran derrière Drascula (une colonne de `draw3`, 125
 * images de 2 pixels). Lève le drapeau 3.
 */
export function* crank(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  yield* animate(g, "man.bin", 14);
  for (let y = -125; y <= 0; y += 2) {
    g.head = {
      view: {
        draw: (scene: Scene) => {
          scene.background();
          scene.pre();
          gfx.screen.copyRect(gfx.draw3, 1, 29, 204, y, 18, 125);
          scene.post();
        },
      },
      roll: { face: 0, extra: 0, step: 0 },
    };
    gfx.owner = "room";
    yield* pause(2);
  }
  g.head = null;
  g.state.flags[3] = 1;
}

/** `activatePendulum` : arme le pendule dans la pièce 102 (le héros n'est plus visible, drapeau 1 à 2) et note l'heure. */
export function activatePendulum(g: DrasculaEngine): void {
  const gfx = g.gfx;
  const s = g.state;
  s.flags[1] = 2;
  s.hero.visible = false;
  gfx.loadPic(102, gfx.bg, HALF_PAL);
  gfx.loadPic("an_p1.alg", gfx.draw3);
  gfx.loadPic("an_p2.alg", gfx.extra);
  gfx.loadPic("an_p3.alg", gfx.front);
  gfx.draw3.copyBackground(gfx.back, 0, 171, 0, 0, 40, 25);
  s.savedTime = g.ticks;
}

/**
 * `animation_1_6` : début du chapitre 6. Dans la pièce 58, Drascula explique son plan au héros (dialogue 11), puis les deux nuits
 * (`TIME1.ALG`), la manivelle, et le héros est ligoté sous le pendule de la pièce 102.
 */
export function* pendulumStart(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const s = g.state;
  const hero = s.hero;
  const t = g.talkers;
  g.cursorVisible = false;
  hero.track = Track.Left;
  hero.x = 103;
  hero.y = 108;
  s.flags[0] = 1;
  s.room?.factors?.fill(98, 0, 200);
  gfx.loadPic("auxig2.alg", gfx.front);
  gfx.loadPic("auxdr.alg", gfx.draw2);

  yield* t.drascula(19, 1);
  yield* g.talk(247);
  yield* t.drascula(20, 1);
  yield* t.drascula(21, 1);
  yield* g.talk(248);
  yield* t.drascula(22, 1);
  yield* g.talk(249);
  yield* t.drascula(23, 1);
  yield* g.dialogs.converse(11);
  yield* t.drascula(26, 1);
  yield* animate(g, "fum.bin", 15);
  yield* t.drascula(27, 1);
  yield* g.talk(254);
  yield* t.drascula(28, 1);
  yield* g.talk(255);
  yield* t.drascula(29, 1);

  // La première nuit : fondu au noir, la carte du temps, la pièce revient sans le héros.
  yield* g.fadeToBlack(1);
  clearScreen(g);
  showPicture(g, "time1.alg");
  yield* delay(930);
  clearScreen(g);
  g.black();
  hero.visible = false;
  s.flags[0] = 0;
  g.updateRoom();
  yield* g.fadeFromBlack(1);
  yield* g.talk(256);
  yield* t.drascula(30, 1);
  yield* g.talk(257);
  // La seconde.
  yield* g.fadeToBlack(0);
  clearScreen(g);
  showPicture(g, "time1.alg");
  yield* delay(900);
  clearScreen(g);
  g.black();
  g.updateRoom();
  yield* g.fadeFromBlack(1);
  yield* g.talk(258);
  yield* t.drascula(31, 1);
  yield* crank(g);
  yield* t.drascula(32, 1);
  yield* t.igor(11, IgorType.Right);
  s.igor.track = 3;
  yield* t.drascula(33, 1);
  yield* t.igor(12, IgorType.Front);
  yield* t.drascula(34, 1);
  s.drascula.track = 0;
  yield* t.drascula(35);

  clearScreen(g);
  yield* g.enterRoom(102);
  activatePendulum(g);
}

// --- Fin du jeu --------------------------------------------------------------------------------------------------------------

/**
 * Le générique : `QPC.BIN` (« Quelle belle fin », la carte de fin, 1 tour par seconde) sur le thème 17, la musique s'éteint, puis
 * `CRD.BIN` (les crédits, 1 tour par seconde) sur le thème 3. Ces deux vidéos contiennent des textes anglais dessinés (`formats.md`).
 */
export function* credits(g: DrasculaEngine): Sequence {
  clearScreen(g);
  yield* playSsn(g, "qpc.bin", 1);
  yield* g.musicFadeout();
  clearScreen(g);
  g.host.playMusic(3);
  yield* playSsn(g, "crd.bin", 1);
  g.host.stopMusic();
}

/**
 * `animation_9_6` : la fin du jeu. `FIN.BIN` et `DRF.BIN`, la chambre de B.J. (pièce 59 sans ses mises à jour), la lettre (`NOTA.ALG`)
 * lue par B.J. en voix off, le héros répond, puis le générique. Les pièces appellent cette séquence depuis leur gestionnaire.
 */
export function* ending(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const s = g.state;
  const hero = s.hero;
  yield* animate(g, "fin.bin", 14);
  g.host.playMusic(13);
  s.flags[5] = 1;
  yield* animate(g, "drf.bin", 16);
  yield* g.fadeToBlack(0);
  clearScreen(g);
  hero.x = -1;
  s.objExit = 108;
  yield* g.enterRoom(59);
  // L'original donne à la pièce un numéro inexistant pour que ses décors animés ne reviennent pas à chaque rafraîchissement.
  gfx.roomSprites = false;
  gfx.loadPic("nota2.alg", gfx.bg, HALF_PAL);
  g.black();
  hero.track = Track.Right;
  hero.x -= 21;
  g.updateRoom();
  yield* g.fadeFromBlack(0);
  yield* pause(96);
  yield* g.walkToPoint(116, 178);
  hero.track = Track.Up;
  g.updateRoom();
  g.host.playMusic(9);
  clearScreen(g);
  gfx.loadPic("nota.alg", gfx.bg, COMPLETE_PAL);
  gfx.owner = "room";
  gfx.palette.setTextColor(TextColor.White);
  for (const n of [24, 25, 26, 27, 28]) yield* g.talkers.solo(g.data.text("textbj", n), `bj${n}.als`);
  hero.track = Track.Down;
  clearScreen(g);
  gfx.loadPic(96, gfx.front, COMPLETE_PAL);
  gfx.loadPic("nota2.alg", gfx.bg, HALF_PAL);
  gfx.owner = "room";
  yield* g.talk(296);
  yield* g.talk(297);
  yield* g.talk(298);
  hero.track = Track.Right;
  yield* g.talk(299);
  yield* g.talk(300);
  g.updateRoom();
  // `copyBackground(screen -> bg)` : la pièce telle qu'elle est devient le décor.
  const scene = gfx.scene(s);
  scene.background();
  scene.pre();
  scene.hero();
  scene.post();
  gfx.bg.load(gfx.screen.pixels);
  gfx.palette.setTextColor(TextColor.LightGreen);
  yield* g.talkers.solo(g.data.text("textmisc", 2), "s15.als");
  gfx.loadPic("nota2.alg", gfx.bg);
  hero.track = Track.Left;
  g.updateRoom();
  yield* g.talk(301);
  g.host.playMusic(17);
  yield* g.fadeToBlack(1);
  yield* credits(g);
}

/** Les cinématiques du jeu, par nom (`GameScript.animations`). */
export const CINEMATICS: Readonly<Record<string, (g: DrasculaEngine) => Sequence>> = {
  "1_1": intro,
  castle,
  "1_6": pendulumStart,
  "5_6": crank,
  "9_6": ending,
};
