import { encodeCp850 } from "../../../data/cp850";
import { advance, type PfnFont } from "../../../engine/infogrames/data/font";
import { AnimationPlayer } from "../../../engine/infogrames/sprites";
import { parseCredits, type CreditsLine } from "../data/credits";
import { intro } from "./boot";
import { playGame } from "./game";
import { idefix as idefixGame } from "./minigames/m34";
import { DOWN, LEFT, RIGHT, Runtime, UP, VOICES, colorBounds, type Script, type Zone } from "./runtime";
import type { GameSave } from "./save";
import { confirm } from "./screens";

/**
 * Menu principal M07 (dans `main`, `19e2:030c`), règle du jeu M44 (`15d7:0e8b`) et générique M47 (`15d7:0369`) :
 * `docs/asterix/engine.md` §1.3 et §12.
 */

/** Zone restaurée et redessinée autour d'Idéfix à chaque image : (0x1c, 0x62), 0x37 × 0x4b. */
const IDEFIX = { x: 0x1c, y: 0x62, width: 0x37, height: 0x4b };
/** Choix du menu : les quatre pancartes, puis Idéfix. */
const CHOICE_IDEFIX = 4;
/** Partie « longue » : au retour d'une partie de plus de 20 tours de table, Panoramix dit `K63TE08`. */
const LONG_GAME_ROUNDS = 20;
/** Délai de la validation `1a93:02a5(60)` du menu : sans clic, la démonstration commence. */
const DEMO_DELAY = 60;

/**
 * `15d7:0e8b` : les trois vidéos de la règle du jeu, chacune sautée d'un clic. En démo, une entrée réelle arrête la suite
 * (`15d7:0ec3`, `15d7:0f01`) : les vidéos restantes et le fondu final ne sont pas joués.
 */
function* rules(rt: Runtime): Script {
  yield* rt.fadeOut();
  for (const name of ["M44AB.mux", "M44AC.mux", "M44AD.mux"]) {
    yield* rt.video(name, { skip: "buttons" });
    while (rt.buttonHeld || rt.ctx.input.pressed("skip")) yield;
    if (rt.demoStopped) return;
  }
  yield* rt.fadeOut();
}

/** Texte d'une ligne du générique, caractère par caractère (`15d7:0139`) : chaque lettre avance de sa largeur plus `spacing`. */
function drawCreditsLine(rt: Runtime, font: PfnFont, text: string, y: number, spacing: number): void {
  const bytes = encodeCp850(text);
  let width = 0;
  for (const code of bytes) width += advance(font, code) + spacing;
  const left = Math.trunc((320 - width) / 2);
  // Ombre en couleur 0x7e décalée de (1, 1), puis le texte en couleur 0x7d (`15d7:0187`).
  for (const [dx, dy, color] of [
    [1, 1, 0x7e],
    [0, 0, 0x7d],
  ] as const) {
    let x = left + dx;
    for (const code of bytes) {
      rt.ctx.surface.drawText(font, Uint8Array.of(code), x, y + dy, color);
      x += advance(font, code) + spacing;
    }
  }
}

/**
 * `15d7:0369` : générique, joué une seule fois à la sortie du programme. Le texte `m47.dat` défile d'une ligne (12 pas
 * d'un pixel, un par tick) jusqu'à la balise `@2`, puis jusqu'à `@3` ; un clic ou Échap saute à la fin de la phase en
 * cours. La page finale reste 200 cs, puis fondu au noir de 64 pas.
 */
function* credits(rt: Runtime): Script {
  const { resources, surface } = rt.ctx;
  yield* rt.fadeOut();
  const background = yield* rt.load(resources.picture("m47da000.mcg"));
  const titleFont = yield* rt.load(resources.pfn("m52d3.pfn"));
  const textFont = yield* rt.load(resources.pfn("m52d2.pfn"));
  const lines: CreditsLine[] = parseCredits(yield* rt.load(resources.bytes("m47.dat")));
  const music = yield* rt.load(resources.sound("m47m.voc"));
  rt.draw(background, 1);
  // La musique est lancée sans boucle.
  rt.ctx.voice.play(music);
  yield* rt.fadeIn();
  let top = 0;
  // `15d7:0249(décalage)` : 15 lignes à y = 14, 26, …, 182, moins le décalage ; seules les lignes d'écran 20 à 179 sont recopiées.
  const page = (shift: number): void => {
    surface.work.set(background.pixels);
    for (let row = 0; row < 15; row++) {
      const line = lines[top + row];
      if (!line || line.text === "") continue;
      const title = line.style === 1;
      drawCreditsLine(rt, title ? titleFont : textFont, line.text, 0xe + row * 0xc - shift, title ? -1 : 0);
    }
    surface.work.set(background.pixels.subarray(0, 20 * 320));
    surface.work.set(background.pixels.subarray(180 * 320), 180 * 320);
  };
  // `DS:0153` : 1 tant qu'un bouton ou Échap est tenu, 2 à son relâchement (le saut est pris alors).
  let skip = 0;
  const scrollLine = function* (): Script {
    for (let shift = 0; shift < 12; shift++) {
      page(shift);
      if (rt.buttonHeld || rt.ctx.input.pressed("skip") || rt.ctx.input.anyJustPressed("validate", "cancel", "skip")) skip = 1;
      else if (skip === 1) skip = 2;
      else yield;
    }
    top++;
  };
  const scrollTo = function* (tag: number): Script {
    skip = 0;
    while (top < lines.length && lines[top].style !== tag && skip !== 2) yield* scrollLine();
    if (skip === 2) while (top < lines.length && lines[top].style !== tag) top++;
  };
  rt.screen = "credits";
  yield* scrollLine();
  yield* scrollTo(2);
  yield* scrollTo(3);
  page(0);
  yield* rt.wait(200);
  yield* rt.fadeOut(64);
  rt.stopSound();
  rt.screen = "";
}

/**
 * Boucle du menu principal : JOUER, REJOUER, REGLE, FIN et Idéfix (son jeu hors partie, `23d1:09c1(0)`). Rend la main
 * quand le joueur a confirmé FIN.
 *
 * Démonstration (§1.3) : après 60 s sans clic (chrono lancé une fois à l'entrée du menu, la navigation ne le relance
 * pas), le menu lance lui-même le choix `rotation` (`[BP−4]` de `main`) en mode démo (`19e2:08d9`) : le jeu d'Idéfix,
 * puis la règle du jeu, puis une partie, et ainsi de suite. La démo s'arrête à l'entrée suivante dans le menu
 * (`19e2:05c3`).
 */
function* mainMenu(rt: Runtime): Script {
  const { palette, resources, surface, voice } = rt.ctx;
  let longGame = false;
  // `[BP−4]` : prochain choix de la démo. Il survit aux retours au menu, et suit aussi les choix faits au clic.
  let rotation = CHOICE_IDEFIX;
  for (;;) {
    rt.voiceKey = VOICES.panoramix;
    yield* rt.fadeOut();
    const picture = yield* rt.load(resources.picture("M07da000.MCC"));
    const idefix = yield* rt.load(resources.hy8("M07s.HY8"));
    rt.draw(picture, 1);
    rt.ctx.surface.commitBackground();
    // Les quatre pancartes (couleurs 122 à 125) sont éteintes.
    for (let color = 122; color <= 125; color++) palette.setColor(color, 0x19, 0x19, 0x19);
    yield* rt.fadeIn();
    let state = 0;
    let animation = new AnimationPlayer(idefix, state);
    const animate = (next: number): void => {
      state = next;
      animation = new AnimationPlayer(idefix, next);
    };
    const drawIdefix = (width: number): void => {
      rt.copyRect(surface.background, IDEFIX.x, IDEFIX.y, IDEFIX.x, IDEFIX.y, width, IDEFIX.height);
      const frame = animation.frame;
      if (frame) surface.drawFrame(idefix, frame, 0x23, 0xad);
    };
    if (longGame) {
      // Au retour d'une partie de démo, la voix n'est pas dite (`19e2:0597`).
      if (!rt.demo) yield* rt.voice(7);
      longGame = false;
    }
    yield* rt.music("m07m.voc");
    // `19e2:05c3` : la démo est finie.
    rt.endDemo();
    // Zones (D11) : les pancartes par leur couleur, et Idéfix.
    const zones: (Zone | null)[] = [122, 123, 124, 125].map((color) => colorBounds(picture.pixels, [color], 4));
    zones.push({ x1: IDEFIX.x, y1: IDEFIX.y, x2: IDEFIX.x + IDEFIX.width, y2: IDEFIX.y + IDEFIX.height });
    let choice = 0;
    let refresh = true;
    let clicked = false;
    // Clic de cette lecture : sur une zone (D11), il choisit d'abord l'option visée. Rend vrai s'il valide.
    const readClick = (): boolean => {
      const click = rt.click(zones);
      if (typeof click === "number" && click !== choice) {
        choice = click;
        refresh = true;
        if (click === CHOICE_IDEFIX) animate(3);
        else if (state >= 3) animate(0);
      }
      return click !== null;
    };
    rt.screen = "menu";
    rt.startChrono(0);
    for (;;) {
      const directions = rt.dirs();
      let moved = false;
      const select = (next: number): void => {
        refresh = true;
        choice = next;
        rt.effect("menuMove");
      };
      if (directions & UP) {
        moved = true;
        if (choice > 0 && choice !== CHOICE_IDEFIX) select(choice - 1);
      }
      if (directions & DOWN && !moved) {
        moved = true;
        if (choice < 3) select(choice + 1);
      }
      if (directions & LEFT && !moved && choice !== CHOICE_IDEFIX) {
        select(CHOICE_IDEFIX);
        while (voice.effectPlaying) yield;
        animate(3);
        rt.effect("idefix");
      }
      if (directions & RIGHT && !moved && choice === CHOICE_IDEFIX) {
        select(0);
        animate(0);
      }
      let pressed = readClick();
      if (refresh) {
        refresh = false;
        // L'option choisie devient blanche.
        for (let i = 0; i < 4; i++) {
          const level = i === choice ? 0xe6 : 0x19;
          palette.setColor(122 + i, level, level, level);
        }
      }
      animation.advance();
      drawIdefix(IDEFIX.width);
      if (animation.looped) {
        if (state === 1) animate(0);
        if (state === 4) {
          animate(3);
          rt.effect("idefix");
        }
      }
      // Animation d'attente : une chance sur 200 à chaque image.
      if (rt.rnd() % 200 === 0) {
        if (state === 0) animate(1);
        else if (state === 3) {
          animate(4);
          rt.effect("bark");
        }
      }
      // Cadence du menu : 4 ticks, 15 images par seconde.
      for (let tick = 0; tick < 4 && !pressed; tick++) {
        yield;
        if (tick < 3) pressed = readClick();
      }
      if (moved) yield* rt.wait(0x1e);
      // Validation `1a93:02a5(60)` : un clic gauche, ou 60 s au chrono 0.
      if (pressed) {
        clicked = true;
        break;
      }
      if (rt.timedOut(DEMO_DELAY)) break;
    }
    rt.screen = "";
    yield* rt.music(null);
    rt.stopSound();
    voice.stopEffect();
    if (!clicked) {
      // `19e2:08d9` : sans clic, le choix est celui de la rotation et la démo commence, sans son de validation.
      choice = rotation;
      rt.startDemo();
    } else if (choice !== CHOICE_IDEFIX) rt.sound("menuValidate");
    yield* rt.waitRelease();
    if (choice === CHOICE_IDEFIX) {
      // Animation de départ d'Idéfix, avec son aboiement.
      yield* rt.wait(10);
      animate(2);
      rt.sound("bark");
      do {
        animation.advance();
        drawIdefix(0x78);
        yield* rt.ticks(4);
      } while (!animation.looped);
    }
    yield* rt.waitSound();
    yield* rt.wait(0x19);
    yield* rt.cleanup();
    // Aiguillage `19e2:0b14` ; la rotation de la démo avance que le choix vienne d'un clic ou de la démo.
    if (choice === 0 || choice === 1) {
      yield* rt.fadeOut();
      if ((yield* playGame(rt, choice === 1)) && rt.game.round > LONG_GAME_ROUNDS) longGame = true;
      // `19e2:0a53`.
      rotation = CHOICE_IDEFIX;
    } else if (choice === 2) {
      yield* rules(rt);
      // `19e2:0a9b`.
      if (rotation === 2) rotation = 0;
    } else if (choice === CHOICE_IDEFIX) {
      // `19e2:0ac0` : le jeu d'Idéfix hors partie (argument 0 : aucun gain).
      yield* rt.fadeOut();
      yield* idefixGame(rt, null);
      rotation = 2;
    } else if (choice === 3) {
      // FIN : question `K63TE44` ; l'image de la question n'est pas passée par l'original (hypothèse : celle d'Astérix).
      if (yield* confirm(rt, 0x2b, 0)) return;
      yield* rt.cleanup();
    }
    yield* rt.fadeOut(32);
  }
}

/**
 * Script racine du jeu (`main`, `19e2:030c`) : préchargements, logos et introduction, menu principal, puis générique et
 * sortie. `resume` : reprise directe d'une partie sauvegardée, sans logos ni introduction.
 */
export function* main(rt: Runtime, resume: GameSave | null, skipIntro = false): Script {
  yield rt.preload();
  if (resume) {
    yield* playGame(rt, false, resume);
    yield* rt.fadeOut(32);
  } else if (!skipIntro) {
    yield* intro(rt);
  }
  yield* mainMenu(rt);
  yield* credits(rt);
  rt.ctx.host.exit();
}
