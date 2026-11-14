import { describe, expect, it } from "vitest";
import { type BassInput, MouseButton } from "../../../src/games/bass/engine/host";
import { INVENTORY_BAR_HEIGHT, INVENTORY_TAP_LINES, InputQueue, SETTLE_TICKS, type TapContext, canOpenInventory, tapKind } from "../../../src/games/bass/ui/input";

/** Tout ce que le moteur lira au fil des ticks suivants (un `drain` par tick de 20 ms). */
function flush(queue: InputQueue, ticks = SETTLE_TICKS + 2): BassInput[] {
  const out: BassInput[] = [];
  for (let i = 0; i < ticks; i++) out.push(...queue.drain());
  return out;
}

describe("InputQueue : souris", () => {
  it("clic gauche = bouton 2, clic droit = bouton 1, milieu ignoré ; coordonnées bornées à l'écran", () => {
    const queue = new InputQueue();
    queue.down(0, 10.7, 20.2);
    queue.down(2, -5, 999);
    queue.down(1, 1, 1);
    expect(flush(queue)).toEqual([
      { type: "move", x: 10, y: 20 },
      { type: "click", x: 10, y: 20, button: MouseButton.Left },
      { type: "move", x: 0, y: 199 },
      { type: "click", x: 0, y: 199, button: MouseButton.Right },
    ]);
    expect(flush(queue)).toEqual([]);
  });

  it("les boutons tenus sont signalés (Mouse.held) et le relâchement est transmis", () => {
    const masks: number[] = [];
    const queue = new InputQueue((mask) => masks.push(mask));
    queue.down(0, 5, 5);
    queue.down(2, 5, 5);
    queue.up(0, 6, 7);
    queue.up(0, 6, 7); // déjà relâché : rien
    queue.up(2, 8, 9);
    expect(masks).toEqual([2, 3, 1, 0]);
    expect(flush(queue).map((e) => e.type)).toEqual(["move", "click", "click", "release", "release"]);
  });

  it("releaseAll relâche les boutons tenus et rien d'autre", () => {
    const queue = new InputQueue();
    queue.releaseAll();
    expect(flush(queue)).toEqual([]);
    queue.down(0, 1, 1);
    flush(queue);
    queue.releaseAll();
    expect(flush(queue)).toEqual([{ type: "release", x: 0, y: 0 }]);
  });

  it("un déplacement remplace le déplacement précédent, mais pas un clic entre les deux", () => {
    const queue = new InputQueue();
    queue.move(1, 1);
    queue.move(2, 2);
    queue.down(0, 2, 2);
    queue.move(3, 3);
    expect(flush(queue)).toEqual([
      { type: "move", x: 2, y: 2 },
      { type: "click", x: 2, y: 2, button: MouseButton.Left },
      { type: "move", x: 3, y: 3 },
    ]);
  });

  it("un clic qui suit de près l'arrivée du pointeur est retenu jusqu'à ce que le jeu ait survolé la zone ; un clic après un survol ne l'est pas", () => {
    const queue = new InputQueue();
    queue.move(40, 8);
    queue.down(0, 40, 8);
    queue.up(0, 40, 8);
    // Le déplacement part tout de suite, le clic et le relâchement SETTLE_TICKS plus tard, dans cet ordre.
    expect(queue.drain()).toEqual([{ type: "move", x: 40, y: 8 }]);
    for (let i = 1; i < SETTLE_TICKS; i++) expect(queue.drain()).toEqual([]);
    expect(queue.drain()).toEqual([
      { type: "click", x: 40, y: 8, button: MouseButton.Left },
      { type: "release", x: 40, y: 8 },
    ]);
    // Le pointeur est resté là depuis SETTLE_TICKS ticks : un nouveau clic au même endroit passe tout de suite.
    queue.down(0, 40, 8);
    expect(queue.drain()).toEqual([{ type: "click", x: 40, y: 8, button: MouseButton.Left }]);
  });

  it("en pause : plus rien n'entre sauf le relâchement, la file en attente est jetée et la reprise repart de zéro", () => {
    const queue = new InputQueue();
    queue.down(0, 4, 4);
    queue.setPaused(true);
    queue.move(9, 9);
    queue.down(2, 9, 9);
    queue.action("pause");
    queue.up(0, 4, 4);
    queue.setPaused(false);
    expect(flush(queue)).toEqual([]);
    queue.action("skip");
    expect(queue.drain()).toEqual([{ type: "action", action: "skip" }]);
  });

  it("la mise en pause relâche le bouton tenu avant de jeter la file", () => {
    const masks: number[] = [];
    const queue = new InputQueue((mask) => masks.push(mask));
    queue.down(0, 4, 4);
    queue.setPaused(true);
    expect(masks).toEqual([2, 0]);
  });
});

describe("InputQueue : doigt et clavier", () => {
  it("un toucher = déplacement, clic, relâchement au même endroit, sans bouton tenu ; l'appui long est un clic droit", () => {
    const masks: number[] = [];
    const queue = new InputQueue((mask) => masks.push(mask));
    queue.tap(0, 100, 50);
    queue.tap(2, 101, 51);
    expect(flush(queue, 3 * SETTLE_TICKS)).toEqual([
      { type: "move", x: 100, y: 50 },
      { type: "click", x: 100, y: 50, button: MouseButton.Left },
      { type: "release", x: 100, y: 50 },
      { type: "move", x: 101, y: 51 },
      { type: "click", x: 101, y: 51, button: MouseButton.Right },
      { type: "release", x: 101, y: 51 },
    ]);
    expect(masks).toEqual([]);
  });

  it("ouvrir l'inventaire = pointeur sur la ligne 0 sans clic", () => {
    const queue = new InputQueue();
    queue.openInventory(160);
    expect(queue.drain()).toEqual([{ type: "move", x: 160, y: 0 }]);
  });

  it("le mode doigt masque le curseur de la souris jusqu'au prochain clic de souris", () => {
    const queue = new InputQueue();
    expect(queue.touchMode).toBe(false);
    queue.tap(0, 1, 1);
    expect(queue.touchMode).toBe(true);
    queue.move(5, 5);
    expect(queue.touchMode).toBe(true);
    queue.down(0, 5, 5);
    expect(queue.touchMode).toBe(false);
  });

  it("les actions du clavier gardent leur ordre", () => {
    const queue = new InputQueue();
    queue.action("panel");
    queue.action("skipLine");
    expect(flush(queue)).toEqual([
      { type: "action", action: "panel" },
      { type: "action", action: "skipLine" },
    ]);
  });
});

describe("tapKind : toucher dans la bande du haut", () => {
  const open: TapContext = { barOpen: false, choosing: false, frozen: false, locked: false, zoneUnder: false };

  it("un toucher court dans les 12 premières lignes ouvre la barre sans cliquer", () => {
    expect(tapKind(0, 0, open)).toBe("bar");
    expect(tapKind(0, INVENTORY_TAP_LINES - 1, open)).toBe("bar");
    expect(tapKind(0, INVENTORY_TAP_LINES, open)).toBe("click");
    expect(tapKind(0, 100, open)).toBe("click");
  });

  it("un appui long (clic droit) clique toujours, même en haut", () => {
    expect(tapKind(2, 3, open)).toBe("click");
  });

  it("barre déjà ouverte : un toucher dedans est un clic (regarder une icône)", () => {
    expect(tapKind(0, 5, { ...open, barOpen: true })).toBe("click");
    expect(INVENTORY_BAR_HEIGHT).toBe(25);
  });

  it("choix de dialogue (première ligne tout en haut), panneau ou pause, pointeur verrouillé : clic ordinaire", () => {
    expect(tapKind(0, 3, { ...open, choosing: true })).toBe("click");
    expect(tapKind(0, 3, { ...open, frozen: true })).toBe("click");
    expect(tapKind(0, 3, { ...open, locked: true })).toBe("click");
  });
});

describe("tapKind : zone du jeu sous le doigt", () => {
  const open: TapContext = { barOpen: false, choosing: false, frozen: false, locked: false, zoneUnder: false };

  it("dans la bande du haut, une zone sous le doigt (sortie, objet) : le toucher agit dessus", () => {
    expect(tapKind(0, 5, { ...open, zoneUnder: true })).toBe("click");
    expect(tapKind(0, INVENTORY_TAP_LINES - 1, { ...open, zoneUnder: true })).toBe("click");
  });

  it("dans la bande du haut, sans zone : la barre s'ouvre toujours", () => {
    expect(tapKind(0, 5, { ...open, zoneUnder: false })).toBe("bar");
  });

  it("le reste ne change pas : en dessous de la bande, appui long, barre ouverte", () => {
    expect(tapKind(0, 40, { ...open, zoneUnder: true })).toBe("click");
    expect(tapKind(2, 5, { ...open, zoneUnder: true })).toBe("click");
    expect(tapKind(0, 5, { ...open, barOpen: true, zoneUnder: true })).toBe("click");
  });
});

describe("canOpenInventory : bouton « Inventaire »", () => {
  const idle = { introRunning: false, choosing: false, frozen: false, locked: false };

  it("actif en jeu", () => {
    expect(canOpenInventory(idle)).toBe(true);
  });

  it("inactif pendant l'introduction, un choix de dialogue, le panneau ou la pause, un pointeur verrouillé", () => {
    for (const key of ["introRunning", "choosing", "frozen", "locked"] as const) expect(canOpenInventory({ ...idle, [key]: true })).toBe(false);
  });

  it("ouvre la barre comme un toucher du haut : pointeur sur la ligne 0, sans clic", () => {
    const queue = new InputQueue();
    queue.openInventory(160);
    expect(flush(queue)).toEqual([{ type: "move", x: 160, y: 0 }]);
  });
});
