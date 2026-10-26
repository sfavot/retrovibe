import { describe, expect, it } from "vitest";
import {
  BUTTON_LEFT,
  BUTTON_RIGHT,
  type ClickTarget,
  type ExecuteOutcome,
  type InterfaceAction,
  InterfaceController,
  type InterfaceWorld,
  MESSAGE_NO_HERO,
  REFUSAL_TICKS,
  type ToolCommand,
  sectorOf,
  TOUCH_EXIT_MARGIN,
} from "../../src/games/armaeth/engine/interface";
import { slotCenterX } from "../../src/games/armaeth/engine/icons";
import { messageId } from "../../src/games/armaeth/data/text";

const L = BUTTON_LEFT;
const R = BUTTON_RIGHT;

function target(over: Partial<ClickTarget> & { num: number }): ClickTarget {
  return { kind: "object", serial: over.num * 10, x: 100, y: 100, width: 10, height: 10, ...over };
}

interface Fixture {
  world: InterfaceWorld & { lists: Record<number, ClickTarget[]>; commands: ToolCommand[]; flags: Record<string, unknown> };
  ctl: InterfaceController;
}

function fixture(over: Partial<InterfaceWorld> = {}, outcome: (c: ToolCommand) => ExecuteOutcome = () => ({ success: true })): Fixture {
  const lists: Record<number, ClickTarget[]> = { 1: [], 2: [], 3: [], 4: [] };
  const commands: ToolCommand[] = [];
  const flags: Record<string, unknown> = { walk: true, exit: true, pending: 0 };
  const world = {
    scriptRunning: false,
    heroPresent: true,
    moveEnabled: true,
    scene: { x0: 0, y0: 10, width: 320, height: 180 },
    hotspots: [],
    selected: null,
    lists,
    commands,
    flags,
    targets: (l: 1 | 2 | 3 | 4) => lists[l],
    pendingMessages: () => flags.pending as number,
    execute(c: ToolCommand) {
      commands.push(c);
      return outcome(c);
    },
    walk(x: number, y: number) {
      flags.walked = [x, y];
      return flags.walk as boolean;
    },
    exit(s: number) {
      flags.exited = s;
      return flags.exit as boolean;
    },
    hasExit: (s: number) => ((flags.exits as number[] | undefined) ?? [0, 1, 2, 3]).includes(s),
    ...over,
  } as Fixture["world"];
  return { world, ctl: new InterfaceController(world) };
}

/** Un clic complet : appui puis relâchement. */
function click(ctl: InterfaceController, x: number, y: number, buttons = L, ctrl = false): InterfaceAction[] {
  const actions = ctl.pointer(x, y, buttons, { ctrl });
  ctl.pointer(x, y, 0);
  return actions;
}

/** Clic sur le centre de l'emplacement `slot` de la barre d'icônes. */
const clickSlot = (ctl: InterfaceController, slot: number, buttons = L) => click(ctl, slotCenterX(slot), 10, buttons);

function select(ctl: InterfaceController, slot: number, buttons = L): void {
  clickSlot(ctl, slot, buttons);
}

describe("barre d'icônes : outils", () => {
  it("choisit l'outil de chaque icône des pages 0 et 1, variante gauche puis droite", () => {
    const f = fixture();
    // page 0 : 101 102 103 104 111 109 106 107 199 198
    const expected = [101, 102, 103, 104, 111, 109, 106, 107, undefined, 198];
    expected.forEach((num, slot) => {
      if (num === undefined) return;
      expect(clickSlot(f.ctl, slot, L)).toEqual([{ type: "selectTool", tool: num, variant: 0 }]);
      expect(f.ctl.tool).toEqual({ num, variant: 0 });
      expect(clickSlot(f.ctl, slot, R)).toEqual([{ type: "selectTool", tool: num, variant: 1 }]);
      expect(f.ctl.tool).toEqual({ num, variant: 1 });
    });
  });

  it("l'icône de la page 1 n'existe pas sur la page 0", () => {
    const f = fixture();
    expect(clickSlot(f.ctl, 3)).toEqual([{ type: "selectTool", tool: 104, variant: 0 }]);
    click(f.ctl, 8, 15, L); // INT 2 reste accessible
    const page = click(f.ctl, 312, 15, L);
    expect(page).toEqual([{ type: "changePage", page: 1 }]);
    expect(f.ctl.tool.num).toBe(1);
    expect(clickSlot(f.ctl, 3)).toEqual([{ type: "selectTool", tool: 105, variant: 0 }]);
  });

  it("abandonne l'objet tenu au choix d'un autre outil", () => {
    const f = fixture();
    f.world.lists[2] = [target({ num: 7, x: 28, y: 195 })];
    select(f.ctl, 2); // ouvrir
    expect(click(f.ctl, 28, 190, L, true)).toMatchObject([{ type: "holdObject" }]);
    expect(f.ctl.held?.num).toBe(7);
    select(f.ctl, 1);
    expect(f.ctl.held).toBeNull();
  });

  it("l'emblème (INT 4) rend l'outil par défaut", () => {
    const f = fixture();
    select(f.ctl, 0);
    expect(click(f.ctl, 160, 17)).toEqual([{ type: "defaultTool" }]);
    expect(f.ctl.tool.num).toBe(1);
    expect(f.ctl.cursor().kind).toBe("pointer");
  });
});

describe("barre d'icônes : pages, bouton salle et commandes", () => {
  it("INT 3 : gauche +1, droit -1, modulo 3, et remet l'outil par défaut", () => {
    const f = fixture();
    select(f.ctl, 0);
    expect(click(f.ctl, 312, 15, L)).toEqual([{ type: "changePage", page: 1 }]);
    expect(f.ctl.tool.num).toBe(1);
    expect(click(f.ctl, 312, 15, R)).toEqual([{ type: "changePage", page: 0 }]);
    expect(click(f.ctl, 312, 15, R)).toEqual([{ type: "changePage", page: 2 }]);
    expect(click(f.ctl, 312, 15, L | R)).toEqual([{ type: "changePage", page: 0 }]);
  });

  it("INT 2 : gauche = regarder la salle (verbe 5), droit = verbe 42, sans objet", () => {
    const f = fixture();
    const left = click(f.ctl, 8, 15, L);
    expect(left).toMatchObject([{ type: "roomButton", command: { verb: 22005, direct: [], indirect: [], preposition: 0 } }]);
    const right = click(f.ctl, 8, 15, R);
    expect(right).toMatchObject([{ type: "roomButton", command: { verb: 22042 } }]);
  });

  it("INT 2 sans héros : message S16", () => {
    const f = fixture({ heroPresent: false });
    expect(click(f.ctl, 8, 15)).toEqual([{ type: "message", id: MESSAGE_NO_HERO }]);
    expect(MESSAGE_NO_HERO).toBe(messageId("S", 16));
  });

  it("page 2 : les commandes système suivent les emplacements", () => {
    const f = fixture();
    click(f.ctl, 312, 15, R); // page 2
    // emplacements : 202 204 201 205 203 | 207 206 208 209 210
    const names = ["restore", "continue", "save", "restart", "quit", "score", "volume", "music", "speed", "pause"];
    names.forEach((command, slot) => {
      const actions = clickSlot(f.ctl, slot);
      expect(actions[0], command).toMatchObject({ type: "system", command });
    });
  });

  it("volume, vitesse et pause selon le bouton", () => {
    const f = fixture();
    click(f.ctl, 312, 15, R);
    expect(clickSlot(f.ctl, 6, L)).toEqual([{ type: "system", command: "volume", delta: -1 }]);
    expect(clickSlot(f.ctl, 6, R)).toEqual([{ type: "system", command: "volume", delta: 1 }]);
    expect(clickSlot(f.ctl, 8, L)).toEqual([{ type: "system", command: "speed", delta: -1 }]);
    expect(clickSlot(f.ctl, 8, R)).toEqual([{ type: "system", command: "speed", delta: 1 }]);
    expect(clickSlot(f.ctl, 9)).toEqual([{ type: "system", command: "pause", mode: "toggle" }]);
  });

  it("échelle (199) : gauche monte, droit descend ; sans effet si le déplacement est désactivé", () => {
    const f = fixture();
    expect(clickSlot(f.ctl, 8, L)).toEqual([{ type: "heroKey", dir: "climb" }]);
    expect(clickSlot(f.ctl, 8, R)).toEqual([{ type: "heroKey", dir: "descend" }]);
    const off = fixture({ moveEnabled: false });
    expect(clickSlot(off.ctl, 8)).toEqual([]);
  });
});

describe("clic sur les objets", () => {
  it("regarder un objet de la salle : même forme que la commande analysée", () => {
    const f = fixture();
    f.world.lists[1] = [target({ num: 25 })];
    select(f.ctl, 0); // œil
    const actions = click(f.ctl, 100, 95);
    expect(actions).toMatchObject([{ type: "command", success: true }]);
    expect(f.world.commands).toHaveLength(1);
    expect(f.world.commands[0]).toMatchObject({
      status: "ok",
      verb: 22005,
      preposition: 0,
      direct: [15025],
      indirect: [],
      source: "click",
    });
  });

  it("clic droit avec l'œil : regarder dans X (direct vide, indirect X, préposition dans)", () => {
    const f = fixture();
    f.world.lists[1] = [target({ num: 25 })];
    select(f.ctl, 0);
    click(f.ctl, 100, 95, R);
    expect(f.world.commands[0]).toMatchObject({ verb: 22005, preposition: 1, direct: [], indirect: [15025] });
  });

  it("un décor est désigné par son nom (4000 + Num)", () => {
    const f = fixture();
    f.world.lists[4] = [target({ kind: "decor", num: 12, serial: 0 })];
    select(f.ctl, 0);
    click(f.ctl, 100, 95);
    expect(f.world.commands[0].direct).toEqual([4012]);
  });

  it("inventaire : l'outil prendre ne le parcourt pas, regarder oui", () => {
    const f = fixture();
    f.world.lists[2] = [target({ num: 7, x: 28, y: 195 })];
    select(f.ctl, 1); // prendre
    expect(click(f.ctl, 28, 190)).toEqual([{ type: "refusal" }]);
    f.ctl.reset();
    f.ctl.tick();
    for (let i = 0; i <= REFUSAL_TICKS; i++) f.ctl.tick();
    select(f.ctl, 0);
    click(f.ctl, 28, 190);
    expect(f.world.commands[0].direct).toEqual([15007]);
  });

  it("panneau de contenu : prendre X dans l'objet sélectionné (sélectionné en direct de la phrase inversée)", () => {
    const f = fixture();
    f.world.lists[3] = [target({ num: 9, x: 160, y: 60 })];
    (f.world as { selected: ClickTarget | null }).selected = target({ num: 40 });
    select(f.ctl, 1);
    click(f.ctl, 160, 55);
    expect(f.world.commands[0]).toMatchObject({ verb: 22006, preposition: 1, direct: [15009], indirect: [15040] });
  });

  it("un seul succès par liste quand la politique est paire", () => {
    const f = fixture();
    f.world.lists[1] = [target({ num: 1 }), target({ num: 2 })];
    select(f.ctl, 1);
    click(f.ctl, 100, 95);
    expect(f.world.commands.map((c) => c.direct)).toEqual([[15001]]);
  });

  it("politique impaire : continue dans la liste, sauf la liste 4", () => {
    const f = fixture({}, () => ({ success: true, continueList: true }));
    f.world.lists[1] = [target({ num: 1 }), target({ num: 2 })];
    f.world.lists[4] = [target({ kind: "decor", num: 3, serial: 0 }), target({ kind: "decor", num: 4, serial: 0 })];
    select(f.ctl, 0);
    click(f.ctl, 100, 95);
    expect(f.world.commands.map((c) => c.direct[0])).toEqual([15001, 15002, 4003]);
  });

  it("l'ordre des listes prime sur la profondeur : la liste 1 est essayée avant la 4", () => {
    const f = fixture({}, (c) => ({ success: c.direct[0] === 4003 }));
    f.world.lists[4] = [target({ kind: "decor", num: 3, serial: 0 })];
    f.world.lists[1] = [target({ num: 1 })];
    select(f.ctl, 0);
    click(f.ctl, 100, 95);
    expect(f.world.commands.map((c) => c.direct[0])).toEqual([15001, 4003]);
  });

  it("test de recouvrement de rectangles, pas de point", () => {
    const f = fixture();
    f.world.lists[1] = [target({ num: 1, x: 100, y: 100, width: 10, height: 10 })];
    select(f.ctl, 0); // curseur œil 16×7
    // bord du cadre : le curseur (16 de large) touche la cible alors que son centre en est à 10 px
    expect(click(f.ctl, 112, 95)[0]).toMatchObject({ type: "command" });
    expect(click(f.ctl, 125, 95)).toEqual([{ type: "refusal" }]);
  });

  it("sans héros, une liste de salle donne le message S16 et rien d'autre", () => {
    const f = fixture({ heroPresent: false });
    select(f.ctl, 0);
    expect(click(f.ctl, 100, 95)).toEqual([{ type: "message", id: MESSAGE_NO_HERO }]);
  });

  it("ignore les clics pendant un script", () => {
    const f = fixture({ scriptRunning: true });
    expect(clickSlot(f.ctl, 0)).toEqual([]);
    expect(f.ctl.tool.num).toBe(1);
  });

  it("une pression maintenue ne répète pas l'action", () => {
    const f = fixture();
    expect(f.ctl.pointer(slotCenterX(0), 10, L)).toHaveLength(1);
    expect(f.ctl.pointer(slotCenterX(0), 10, L)).toEqual([]);
    f.ctl.pointer(slotCenterX(0), 10, 0);
    expect(f.ctl.pointer(slotCenterX(0), 10, L)).toHaveLength(1);
  });
});

describe("objet tenu (Ctrl + clic)", () => {
  it("prend l'objet de l'inventaire avec un outil à instrument, puis s'en sert en indirect", () => {
    const f = fixture();
    f.world.lists[2] = [target({ num: 7, x: 28, y: 195 })];
    f.world.lists[1] = [target({ num: 30 })];
    select(f.ctl, 2); // ouvrir (103)
    // sans Ctrl, c'est une cible ordinaire de la liste 2
    click(f.ctl, 28, 190);
    expect(f.world.commands.at(-1)).toMatchObject({ verb: 22003, direct: [15007] });
    f.world.commands.length = 0;
    const grab = click(f.ctl, 28, 190, L, true);
    expect(grab).toMatchObject([{ type: "holdObject", target: { num: 7 } }]);
    expect(f.world.commands).toHaveLength(0);
    expect(f.ctl.cursor()).toMatchObject({ kind: "held", sprite: { resource: "object", num: 7 } });
    const use = click(f.ctl, 100, 95);
    expect(f.world.commands[0]).toMatchObject({ verb: 22003, preposition: 7, direct: [15030], indirect: [15007] });
    expect(use.at(-1)).toEqual({ type: "releaseObject" });
    expect(f.ctl.held).toBeNull();
    expect(f.ctl.cursor().kind).toBe("tool");
  });

  it("n'agit pas si l'outil n'a pas de saisie ou si un objet est déjà tenu", () => {
    const f = fixture();
    f.world.lists[2] = [target({ num: 7, x: 28, y: 195 })];
    select(f.ctl, 0); // regarder : pas de saisie
    expect(click(f.ctl, 28, 190, L, true)[0]).toMatchObject({ type: "command" });
    select(f.ctl, 2);
    click(f.ctl, 28, 190, L, true);
    f.world.commands.length = 0;
    expect(click(f.ctl, 28, 190, L, true)[0]).toMatchObject({ type: "command" });
  });

  it("donner : l'objet tenu est le direct, le destinataire cliqué est l'indirect (préposition à)", () => {
    const f = fixture();
    f.world.lists[2] = [target({ num: 7, x: 28, y: 195 })];
    f.world.lists[1] = [target({ num: 60 })];
    clickSlot(f.ctl, 0, L);
    click(f.ctl, 312, 15, L); // page 1
    clickSlot(f.ctl, 4); // 108 donner
    click(f.ctl, 28, 190, L, true);
    click(f.ctl, 100, 95);
    expect(f.world.commands.at(-1)).toMatchObject({ verb: 22032, preposition: 8, direct: [15007], indirect: [15060] });
  });
});

describe("outil bottes et clic dans le vide", () => {
  it("clic gauche : marche vers le point relatif à la scène", () => {
    const f = fixture();
    clickSlot(f.ctl, 9);
    expect(f.ctl.tool.num).toBe(198);
    expect(click(f.ctl, 120, 80)).toEqual([{ type: "walkTo", x: 120, y: 70, ok: true }]);
    expect(f.world.flags.walked).toEqual([120, 70]);
  });

  it("clic droit : sortie par secteur", () => {
    const f = fixture();
    clickSlot(f.ctl, 9);
    expect(click(f.ctl, 310, 100, R)).toEqual([{ type: "exitBySector", sector: 1, ok: true }]);
    expect(click(f.ctl, 100, 24, R)).toEqual([{ type: "exitBySector", sector: 0, ok: true }]);
    expect(click(f.ctl, 160, 190, R)).toEqual([{ type: "exitBySector", sector: 2, ok: true }]);
    expect(click(f.ctl, 5, 100, R)).toEqual([{ type: "exitBySector", sector: 3, ok: true }]);
  });

  it("au doigt : un toucher près d'un bord où la salle a une sortie fait sortir de ce côté (écart du portage)", () => {
    const f = fixture();
    f.world.flags.exits = [1, 3];
    clickSlot(f.ctl, 9);
    const touch = (x: number, y: number) => {
      const actions = f.ctl.pointer(x, y, L, { ctrl: false, touch: true });
      f.ctl.pointer(x, y, 0);
      return actions;
    };
    // la scène va de (0, 10) à (320, 190) : bords gauche et droit à moins de TOUCH_EXIT_MARGIN
    expect(touch(320 - TOUCH_EXIT_MARGIN, 100)).toEqual([{ type: "exitBySector", sector: 1, ok: true }]);
    expect(touch(TOUCH_EXIT_MARGIN - 1, 100)).toEqual([{ type: "exitBySector", sector: 3, ok: true }]);
    // un peu plus loin du bord : marche
    expect(touch(TOUCH_EXIT_MARGIN, 100)).toEqual([{ type: "walkTo", x: TOUCH_EXIT_MARGIN, y: 90, ok: true }]);
    // bord sans sortie (bas) : marche
    expect(touch(160, 188)).toEqual([{ type: "walkTo", x: 160, y: 178, ok: true }]);
    // à la souris, le même point du bord fait marcher (comportement d'origine)
    expect(click(f.ctl, 315, 100)).toEqual([{ type: "walkTo", x: 315, y: 90, ok: true }]);
  });

  it("marche impossible : refus animé", () => {
    const f = fixture();
    f.world.flags.walk = false;
    clickSlot(f.ctl, 9);
    expect(click(f.ctl, 120, 80)).toEqual([{ type: "walkTo", x: 120, y: 70, ok: false }, { type: "refusal" }]);
  });

  it("salle sombre : message d'obscurité, sans marche", () => {
    const f = fixture({ dark: true });
    clickSlot(f.ctl, 9);
    expect(click(f.ctl, 120, 80)).toEqual([{ type: "darkRoom" }]);
    expect(f.world.flags.walked).toBeUndefined();
  });

  it("outil par défaut : aucun effet dans la salle, refus animé", () => {
    const f = fixture();
    f.world.lists[1] = [target({ num: 1 })];
    expect(click(f.ctl, 100, 95)).toEqual([{ type: "refusal" }]);
    expect(f.world.commands).toHaveLength(0);
    expect(f.world.flags.walked).toBeUndefined();
  });

  it("sectorOf range un point dans l'un des quatre secteurs diagonaux", () => {
    expect([sectorOf(160, 10, 320, 180), sectorOf(300, 90, 320, 180), sectorOf(160, 170, 320, 180), sectorOf(20, 90, 320, 180)]).toEqual([0, 1, 2, 3]);
  });

  it("outil mettre : un clic dans le vide pose l'objet tenu", () => {
    const f = fixture();
    f.world.lists[2] = [target({ num: 7, x: 28, y: 195 })];
    click(f.ctl, 312, 15, L);
    clickSlot(f.ctl, 1, R); // 102 variante 1 : mettre
    click(f.ctl, 28, 190, L, true);
    expect(f.ctl.held?.num).toBe(7);
    const actions = click(f.ctl, 200, 120);
    expect(f.world.commands.at(-1)).toMatchObject({ verb: 22015, direct: [15007], indirect: [], preposition: 0 });
    expect(actions).toContainEqual({ type: "releaseObject" });
  });
});

describe("points sensibles de la scène", () => {
  const hotspots = [
    { messageId: 9005, rect: { x0: 90, x1: 110, y0: 70, y1: 90 } },
    { messageId: 9112, rect: { x0: 100, x1: 130, y0: 80, y1: 100 } },
    { messageId: 9999, rect: null },
    { messageId: 9300, rect: { x0: 200, x1: 210, y0: 0, y1: 10 } },
  ];

  it("l'œil empile le message I<code mod 1000> de chaque point recouvert, dans l'ordre", () => {
    const f = fixture({ hotspots });
    select(f.ctl, 0);
    // souris en (105, 95) : relatif à la scène (105, 85)
    const actions = click(f.ctl, 105, 95);
    expect(actions.filter((a) => a.type === "hotspotMessage")).toEqual([
      { type: "hotspotMessage", id: 5, code: 9005, messageId: messageId("I", 5) },
      { type: "hotspotMessage", id: 112, code: 9112, messageId: messageId("I", 112) },
    ]);
    expect(actions.some((a) => a.type === "refusal")).toBe(false);
  });

  it("n'agit pas hors du rectangle ni avec un autre outil, ni si la file contient déjà un message", () => {
    const f = fixture({ hotspots });
    select(f.ctl, 0);
    expect(click(f.ctl, 105, 150)).toEqual([{ type: "refusal" }]);
    f.ctl.reset();
    select(f.ctl, 1);
    expect(click(f.ctl, 105, 95)).toEqual([{ type: "refusal" }]);
    const g = fixture({ hotspots });
    g.world.flags.pending = 1;
    select(g.ctl, 0);
    expect(click(g.ctl, 105, 95)).toEqual([]);
  });
});

describe("curseur", () => {
  it("passe du pointeur à l'outil, puis à l'objet tenu", () => {
    const f = fixture();
    expect(f.ctl.cursor()).toMatchObject({ kind: "pointer", sprite: { resource: "INT", num: 1, fig: 0 }, width: 10, height: 11, priority: 250 });
    select(f.ctl, 0, R);
    expect(f.ctl.cursor()).toMatchObject({ kind: "tool", sprite: { resource: "INT", num: 101, fig: 1 }, width: 10, height: 10 });
  });

  it("est centré sur la souris et borné à x 4..316, y 10..194", () => {
    const f = fixture();
    f.ctl.pointer(0, 0, 0);
    expect(f.ctl.cursor()).toMatchObject({ x: 4, y: 10 + 5 });
    f.ctl.pointer(999, 999, 0);
    expect(f.ctl.cursor()).toMatchObject({ x: 316, y: 194 + 5 });
  });

  it("refus : visages rouges pendant 20 passages, clics ignorés, retour à l'outil au 21e", () => {
    const f = fixture();
    select(f.ctl, 0);
    expect(click(f.ctl, 100, 95)).toEqual([{ type: "refusal" }]);
    expect(f.ctl.cursor()).toMatchObject({ kind: "refusal", sprite: { resource: "INT", num: 1, fig: 1 } });
    for (let i = 0; i < REFUSAL_TICKS; i++) {
      f.ctl.tick();
      expect(f.ctl.refusing).toBe(true);
      expect(f.ctl.pointer(slotCenterX(1), 10, L)).toEqual([]);
    }
    f.ctl.tick();
    expect(f.ctl.refusing).toBe(false);
    expect(f.ctl.cursor()).toMatchObject({ kind: "tool", sprite: { num: 101 } });
    // le bouton est encore enfoncé : on attend son relâchement
    expect(f.ctl.pointer(slotCenterX(1), 10, L)).toEqual([]);
    f.ctl.pointer(slotCenterX(1), 10, 0);
    expect(f.ctl.pointer(slotCenterX(1), 10, L)).toHaveLength(1);
  });

  it("le refus rend l'objet tenu quand il y en a un", () => {
    const f = fixture();
    f.world.lists[2] = [target({ num: 7, x: 28, y: 195 })];
    select(f.ctl, 2);
    click(f.ctl, 28, 190, L, true);
    expect(click(f.ctl, 250, 120)).toEqual([{ type: "refusal" }]);
    for (let i = 0; i <= REFUSAL_TICKS; i++) f.ctl.tick();
    expect(f.ctl.cursor().kind).toBe("held");
  });
});

describe("clavier", () => {
  const key = (f: Fixture, event: Parameters<InterfaceController["key"]>[0]) => f.ctl.key(event);

  it("un caractère imprimable ouvre la ligne ; espace, Entrée, Tab, Échap et Retour arrière non", () => {
    const f = fixture();
    expect(key(f, { type: "char", char: "p" })).toEqual([{ type: "openInputLine", char: "p" }]);
    for (const char of [" ", "\r", "\t", "\x1b", "\b"]) expect(key(f, { type: "char", char })).toEqual([]);
    expect(key(f, { type: "char", char: "\x01" })).toEqual([{ type: "openInputLine", char: "\x01" }]);
  });

  it("+ et - règlent le mouvement vertical du héros", () => {
    const f = fixture();
    expect(key(f, { type: "char", char: "+" })).toEqual([{ type: "heroKey", dir: "descend" }]);
    expect(key(f, { type: "char", char: "=" })).toEqual([{ type: "heroKey", dir: "descend" }]);
    expect(key(f, { type: "char", char: "-" })).toEqual([{ type: "heroKey", dir: "climb" }]);
    expect(key(f, { type: "char", char: "_" })).toEqual([{ type: "heroKey", dir: "climb" }]);
    expect(key(fixture({ moveEnabled: false }), { type: "char", char: "+" })).toEqual([]);
    expect(key(fixture({ heroPresent: false }), { type: "char", char: "+" })).toEqual([]);
  });

  it("les 8 directions déplacent le héros ; Inser rappelle la dernière phrase", () => {
    const f = fixture();
    for (const dir of ["home", "end", "up", "down", "left", "right", "pgup", "pgdn"] as const)
      expect(key(f, { type: "nav", key: dir })).toEqual([{ type: "heroKey", dir }]);
    expect(key(f, { type: "nav", key: "insert" })).toEqual([{ type: "openInputLine", recall: true }]);
    expect(key(fixture({ moveEnabled: false }), { type: "nav", key: "left" })).toEqual([]);
  });

  it("touches de fonction hors script", () => {
    const f = fixture();
    const commands = [1, 2, 3, 4, 5, 6, 10].map((n) => key(f, { type: "function", n })[0]);
    expect(commands).toEqual([
      { type: "functionKey", n: 1, command: "help" },
      { type: "functionKey", n: 2, command: "save" },
      { type: "functionKey", n: 3, command: "restore" },
      { type: "functionKey", n: 4, command: "continue" },
      { type: "functionKey", n: 5, command: "restart" },
      { type: "functionKey", n: 6, command: "score" },
      { type: "functionKey", n: 10, command: "inventory" },
    ]);
    expect(key(f, { type: "function", n: 9 })).toEqual([]);
    expect(key(f, { type: "function", n: 7 })).toEqual([]);
    expect(key(f, { type: "function", n: 2, modifier: "shift" })).toEqual([]);
    expect(key(fixture({ debugEnabled: true }), { type: "function", n: 7 })).toEqual([{ type: "functionKey", n: 7, command: "debug1" }]);
  });

  it("pendant un script : caractères et directions ignorés, F1 aide, autres F bip, F8 saute", () => {
    const f = fixture({ scriptRunning: true, debugEnabled: true });
    expect(key(f, { type: "char", char: "p" })).toEqual([]);
    expect(key(f, { type: "char", char: "+" })).toEqual([]);
    expect(key(f, { type: "nav", key: "left" })).toEqual([]);
    expect(key(f, { type: "nav", key: "insert" })).toEqual([]);
    expect(key(f, { type: "function", n: 1 })).toEqual([{ type: "functionKey", n: 1, command: "help" }]);
    for (const n of [2, 3, 4, 5, 6, 10]) expect(key(f, { type: "function", n })).toEqual([{ type: "bell" }]);
    expect(key(f, { type: "function", n: 8 })).toEqual([{ type: "scriptStep" }]);
    expect(key(f, { type: "function", n: 7 })).toEqual([]);
    expect(key(f, { type: "function", n: 9 })).toEqual([]);
    // `1023:0256` ne teste pas `dgs` : F8 saute même sans débogage (le moteur filtre les scripts bloquants)
    expect(key(fixture({ scriptRunning: true }), { type: "function", n: 8 })).toEqual([{ type: "scriptStep" }]);
  });

  it("Alt : vitesse et pause, actifs pendant un script", () => {
    for (const script of [false, true]) {
      const f = fixture({ scriptRunning: script });
      expect(key(f, { type: "alt", key: "A" })).toEqual([{ type: "system", command: "speed", delta: 1 }]);
      expect(key(f, { type: "alt", key: "-" })).toEqual([{ type: "system", command: "speed", delta: 1 }]);
      expect(key(f, { type: "alt", key: "z" })).toEqual([{ type: "system", command: "speed", delta: -1 }]);
      expect(key(f, { type: "alt", key: "=" })).toEqual([{ type: "system", command: "speed", delta: -1 }]);
      expect(key(f, { type: "alt", key: "P" })).toEqual([{ type: "system", command: "pause", mode: "step" }]);
      expect(key(f, { type: "alt", key: "N" })).toEqual([{ type: "system", command: "pause", mode: "normal" }]);
      expect(key(f, { type: "alt", key: "Q" })).toEqual([]);
    }
  });

  it("la ligne de saisie ouverte prend les touches", () => {
    const f = fixture({ inputLineOpen: true });
    expect(key(f, { type: "char", char: "a" })).toEqual([]);
    expect(key(f, { type: "nav", key: "left" })).toEqual([]);
  });
});
