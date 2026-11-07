import {
  DRASCULA_BIG_FACES,
  DRUNK_HEAD,
  IgorType,
  MUSICIAN_HEAD,
  PIANIST_HEAD,
  WEREWOLF_HEAD,
  backgroundOnly,
  bartenderHead,
  bjBedHead,
  bjHead,
  blindHead,
  drasculaBigHead,
  drasculaHead,
  genericHead,
  growlHead,
  heroHead,
  igorFaces,
  igorHead,
  pendulumHead,
  phoneHead,
  roomWithoutHero,
  vonBraunHead,
} from "../render/heads";
import { nextVonBraunFrame } from "../render/actors";
import { TextColor } from "../render/palette";
import type { TalkView } from "../render/renderer";
import { pauseTicks } from "./cadence";
import type { DrasculaEngine } from "./loop";
import { type Sequence, wait, waitUntil } from "./sequence";
import { type TalkLine, speak } from "./talk";

/**
 * Les personnages qui parlent : pour chacun, la voix (`I8.als`, `d9.als`, `BJ16.als`…), le texte (`texti`, `textd`, `textbj`…), la
 * couleur, la place du sous-titre et la tête qui parle (`render/heads.ts`). Réécriture des fonctions `talk_igor`, `talk_drascula`,
 * `talk_drascula_big`, `talk_solo`, `talk_bartender`, `talk_bj`, `talk_bj_bed`, `talk_pianist`, `talk_drunk`, `talk_vonBraun`,
 * `talk_blind`, `talk_hacker`, `talk_werewolf`, `talk_mus`, `talk_pen`, `talk_htel`, `talk_trunk`, `talk_sync`, `grr` et
 * `placeVonBraun` (engines/drascula/talk.cpp, actors.cpp, ScummVM). Le héros (`talk`) est dans `DrasculaEngine`.
 *
 * Chaque fonction est une séquence ; la mise à jour de la pièce, la musique relancée et les drapeaux de fin de réplique sont ceux de
 * l'original. Le texte de la réplique `n` de `textX` est la ligne `n` ; les voix suivent le préfixe de leur famille (`formats.md`).
 * Les personnages sont accessibles par `engine.talkers`.
 */

/** `TEXTD_START` : les répliques de l'aveugle sont les lignes 67 et suivantes de `textd` (voix `d68.als`…). */
const TEXTD_START = 68;

export class Talkers {
  constructor(private readonly g: DrasculaEngine) {}

  private text(section: Parameters<DrasculaEngine["data"]["text"]>[0], index: number): string {
    return this.g.data.text(section, index);
  }

  private line(line: TalkLine): Sequence<boolean> {
    return speak(this.g, line);
  }

  /** Relance la musique de la pièce si elle est finie (fins de `talk_bartender`, `talk_drunk`, `talk_vonBraun`…). */
  private restartMusic(condition: (flags: number[], roomMusic: number) => boolean): void {
    const s = this.g.state;
    if (!this.g.host.musicPlaying() && condition(s.flags, s.roomMusic)) this.g.host.playMusic(s.roomMusic);
  }

  // --- Igor et Drascula -------------------------------------------------------------------------------------------------

  /** `talk_igor(index, type)` : `IgorType`. */
  *igor(index: number, type: number = IgorType.Right): Sequence {
    const { igor } = this.g.state;
    const at = type === IgorType.Right || type === IgorType.Front ? { x: igor.x + 26, y: igor.y } : type === IgorType.Door ? { x: 87, y: 66 } : { x: 221, y: 102 };
    yield* this.line({
      text: this.text("texti", index),
      voice: `I${index}.als`,
      ...at,
      color: TextColor.White,
      view: igorHead(type),
      faces: type === IgorType.Door ? 0 : igorFaces(type),
    });
  }

  /** `talk_drascula(index, side)` : 0 = `talk_dr_izq`, 1 = `talk_dr_dch`. */
  *drascula(index: number, side: 0 | 1 = 0): Sequence {
    const { drascula } = this.g.state;
    yield* this.line({
      text: this.text("textd", index),
      voice: `d${index}.als`,
      x: drascula.x + 19,
      y: drascula.y,
      color: TextColor.Red,
      view: drasculaHead(side),
      faces: 8,
    });
  }

  /** `talk_drascula_big(index)` : rend vrai si Échap demande de sauter l'introduction. */
  *drasculaBig(index: number): Sequence<boolean> {
    return yield* this.line({
      text: this.text("textd", index),
      voice: `d${index}.als`,
      x: 191,
      y: 69,
      color: TextColor.Red,
      view: drasculaBigHead,
      faces: DRASCULA_BIG_FACES,
      escapeSkips: true,
    });
  }

  // --- Voix off et textes seuls ------------------------------------------------------------------------------------------

  /**
   * `talk_solo(said, filename)` : le texte seul, sur l'image en cours (chapitre 1 : (156, 90) dans `colorSolo` ; 5 : (173, 92) en rouge ;
   * 6 : (213, 72) sur le décor). Aucun texte ailleurs, comme l'original.
   */
  *solo(text: string, voice: string): Sequence {
    const s = this.g.state;
    const spot = s.chapter === 1 ? { x: 156, y: 90 } : s.chapter === 6 ? { x: 213, y: 72 } : s.chapter === 5 ? { x: 173, y: 92 } : null;
    const color = s.chapter === 1 ? s.colorSolo : s.chapter === 5 ? TextColor.Red : undefined;
    yield* this.line({ text: spot ? text : "", voice, x: spot?.x ?? 0, y: spot?.y ?? 0, color, view: s.chapter === 6 ? roomWithoutHero : undefined });
  }

  /** `talk_hacker(index)` : la voix du hacker, texte jaune en bas de l'écran, sur le décor seul. */
  *hacker(index: number): Sequence {
    yield* this.line({ text: this.text("textd", index), voice: `d${index}.als`, x: 156, y: 170, color: TextColor.Yellow, view: backgroundOnly });
  }

  /** `grr()` : le grognement du chapitre 3 (`s10.als`, `textmisc[6]`). */
  *growl(): Sequence {
    yield* this.line({ text: this.text("textmisc", 6), voice: "s10.als", x: 153, y: 65, color: TextColor.DarkGreen, view: growlHead });
    this.g.updateRoom();
  }

  // --- Personnages des pièces -------------------------------------------------------------------------------------------

  /** `talk_bartender(index, type)` : 0 le barman de la taverne, 1 derrière le comptoir (la réplique 82 est celle de Drascula : `d82.als`). */
  *bartender(index: number, type: 0 | 1): Sequence {
    const s = this.g.state;
    const own = index !== 82;
    yield* this.line({
      text: own ? this.text("textt", index) : this.text("textd", index),
      voice: own ? `t${index}.als` : `d${index}.als`,
      x: 132,
      y: 45,
      color: TextColor.Maroon,
      view: bartenderHead(type),
      faces: type === 0 ? 9 : 6,
      onTurn: () => {
        if (type !== 0) return;
        if (s.chapter === 1) this.restartMusic(() => true);
        else if (s.chapter === 2) this.restartMusic((flags, music) => flags[11] === 0 && music !== 0);
      },
    });
    this.g.updateRoom();
  }

  /** `talk_bj(index)` : B.J. */
  *bj(index: number): Sequence {
    const ch5 = this.g.state.chapter === 5;
    yield* this.line({
      text: this.text("textbj", index),
      voice: `BJ${index}.als`,
      x: ch5 ? 93 : 177,
      y: ch5 ? 80 : 90,
      color: TextColor.White,
      view: bjHead,
      faces: ch5 ? 0 : 5,
    });
    this.g.updateRoom();
  }

  /** `talk_bj_bed(index)` : B.J. dans le lit. */
  *bjBed(index: number): Sequence {
    yield* this.line({ text: this.text("textbj", index), voice: `BJ${index}.als`, x: 104, y: 102, color: TextColor.White, view: bjBedHead, faces: 5 });
    this.g.updateRoom();
  }

  private *generic(text: string, voice: string, x: number, y: number, color: number, view: TalkView, faces: number): Sequence {
    yield* this.line({ text, voice, x, y, color, view, faces });
    this.g.updateRoom();
  }

  /** `talk_pianist(index)`. */
  *pianist(index: number): Sequence {
    yield* this.generic(this.text("textp", index), `P${index}.als`, 221, 128, TextColor.White, genericHead(PIANIST_HEAD), PIANIST_HEAD.columns.length);
  }

  /** `talk_werewolf(index)`. */
  *werewolf(index: number): Sequence {
    yield* this.generic(this.text("textl", index), `L${index}.als`, 203, 78, TextColor.Red, genericHead(WEREWOLF_HEAD), WEREWOLF_HEAD.columns.length);
  }

  /** `talk_mus(index)` : le musicien. */
  *musician(index: number): Sequence {
    yield* this.generic(this.text("texte", index), `E${index}.als`, 197, 64, TextColor.White, genericHead(MUSICIAN_HEAD), MUSICIAN_HEAD.columns.length);
  }

  /**
   * `talk_drunk(index)` : l'ivrogne. Au chapitre 1 sa feuille (`an11y13.alg`) remplace `front` le temps de la réplique ; le drapeau 13
   * annonce qu'il parle, et la réplique attend que le drapeau 12 (son geste) retombe.
   */
  *drunk(index: number): Sequence {
    const g = this.g;
    const s = g.state;
    if (s.chapter === 1) g.gfx.loadPic("an11y13.alg", g.gfx.front);
    s.flags[13] = 1;
    // L'original rafraîchit la pièce tant que le drapeau 12 est levé : c'est l'accroche de la pièce qui le baisse (vague P).
    yield* waitUntil(() => s.flags[12] !== 1);
    yield* this.generic(this.text("textb", index), `B${index}.als`, 181, 54, TextColor.DarkGreen, genericHead(DRUNK_HEAD), DRUNK_HEAD.columns.length);
    s.flags[13] = 0;
    if (s.chapter === 1) g.gfx.loadPic(96, g.gfx.front);
    if (s.chapter === 1) this.restartMusic((flags) => flags[11] === 0);
    else if (s.chapter === 2) this.restartMusic((flags, music) => flags[11] === 0 && music !== 0);
  }

  /** `talk_vonBraun(index, door)` : Von Braun, ou sa voix derrière la porte. */
  *vonBraun(index: number, door = false): Sequence {
    const g = this.g;
    const { vonBraun } = g.state;
    yield* this.line({
      text: this.text("textvb", index),
      voice: `VB${index}.als`,
      x: door ? 150 : vonBraun.x,
      y: door ? 80 : 66,
      color: TextColor.Brown,
      view: vonBraunHead(door),
      faces: 6,
    });
    g.updateRoom();
    this.restartMusic((flags, music) => flags[11] === 0 && music !== 0);
  }

  /** `talk_blind(index)` : l'aveugle ; la bouche suit les chiffres de `textd1[index - 1]`, un par tour de 2 pauses. */
  *blind(index: number): Sequence {
    const sync = this.text("textd1", index - 1);
    yield* this.line({
      text: this.text("textd", index + TEXTD_START - 1),
      voice: `d${index + TEXTD_START - 1}.als`,
      x: 260,
      y: 71,
      color: TextColor.Brown,
      view: blindHead(sync),
      turn: 2,
    });
  }

  /** `talk_pen(said, filename, type)` : le héros sous le pendule du chapitre 6 (0 : pièce 102, 1 : pièce 58). Le drapeau 1 est levé le temps de la réplique. */
  *pendulum(text: string, voice: string, type: 0 | 1): Sequence {
    const s = this.g.state;
    s.flags[1] = 1;
    try {
      yield* this.line({
        text,
        voice,
        x: type === 0 ? 160 : 195,
        y: type === 0 ? 105 : 107,
        color: TextColor.Yellow,
        view: pendulumHead(type),
        faces: type === 0 ? 8 : 5,
      });
    } finally {
      s.flags[1] = 0;
    }
  }

  /** `talk_htel(index)` : le visage sur l'écran du téléphone. */
  *phone(index: number): Sequence {
    yield* this.line({ text: this.text("text", index), voice: `${index}.als`, x: 90, y: 50, color: TextColor.Yellow, view: phoneHead, faces: 3, extraFaces: 3 });
  }

  /** `talk_trunk(index)` : le coffre qui parle ; le drapeau 19 alterne à chaque tour (4 pauses) et reprend sa valeur à la fin. */
  *trunk(index: number): Sequence {
    const s = this.g.state;
    const before = s.flags[19];
    try {
      yield* this.line({
        text: this.text("text", index),
        voice: `d${index}.als`,
        x: 263,
        y: 69,
        color: TextColor.Maroon,
        turn: 4,
        onTurn: (step) => {
          s.flags[19] = step % 2 === 0 ? 1 : 0;
        },
      });
    } finally {
      s.flags[19] = before;
    }
    this.g.updateRoom();
  }

  /** `talk_sync(said, filename, syncChar)` : le héros dont la bouche suit les chiffres de `sync` (un par tour). */
  *heroSync(text: string, voice: string, sync: string): Sequence {
    const g = this.g;
    yield* this.line({
      text,
      voice,
      x: g.state.hero.x,
      y: g.state.hero.y,
      color: TextColor.Yellow,
      view: heroHead({ sync: true }),
      faceAt: (step) => Number.parseInt(sync[step] ?? "", 10) || 0,
    });
    const s = g.state;
    if (s.chapter === 1) this.restartMusic((flags) => flags[11] === 0);
    if (s.chapter === 2) this.restartMusic((flags, music) => flags[11] === 0 && music !== 0);
  }

  // --- Von Braun marche --------------------------------------------------------------------------------------------------

  /**
   * `placeVonBraun(pointX)` : Von Braun marche de 5 pixels par tour de 5 pauses jusqu'à l'abscisse `pointX`, tourné vers elle, puis
   * s'arrête. Écart : un tick d'attente avant chaque pas laisse l'image se montrer (l'original dessine puis avance dans le même tour).
   */
  *placeVonBraun(pointX: number): Sequence {
    const vb = this.g.state.vonBraun;
    vb.track = pointX < vb.x ? 0 : 1;
    vb.moving = true;
    for (;;) {
      this.g.updateRoom();
      yield* wait(1);
      vb.frame = nextVonBraunFrame(vb.frame);
      if (vb.track === 0) {
        vb.x -= 5;
        if (vb.x <= pointX) break;
      } else {
        vb.x += 5;
        if (vb.x >= pointX) break;
      }
      yield* wait(Math.max(0, pauseTicks(5) - 1));
    }
    vb.moving = false;
  }
}
