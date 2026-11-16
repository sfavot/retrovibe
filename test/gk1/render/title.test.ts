import { describe, expect, it } from "vitest";
import { currentRoom, runFrame, useGameClock } from "../../../src/games/gk1/engine/loop";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { CelKind } from "../../../src/games/gk1/render/screen-item";
import { fnv1a, mainIndex, original } from "../data/real";

/** Pièces du démarrage : test de vitesse, logo de Sierra, écran titre. */
const SPEED_ROOM = 17;
const LOGO_ROOM = 94;
const TITLE_ROOM = 375;
const LOGO_PIC = 50;
const TITLE_PIC = 100;
const TITLE_BUTTONS_VIEW = 100;
/** Garde-fou : l'écran titre arrive vers la 840e image (14 secondes de jeu). */
const MAX_FRAMES = 2000;

describe.skipIf(!original.has)("démarrage sans tête jusqu'à l'écran titre", () => {
  it("test de vitesse, logo de Sierra, puis écran titre : images de référence", () => {
    const vm = new Vm(mainIndex());
    useGameClock(vm);
    vm.boot();
    const frameout = frameoutOf(vm);
    let frames = 0;
    const play = (until: () => boolean): void => {
      while (!until()) {
        if (++frames > MAX_FRAMES) throw new Error("écran attendu jamais atteint");
        expect(runFrame(vm)).toEqual({ status: RunStatus.Suspended, reason: "FrameOut" });
      }
    };
    const checksum = (): string => `${fnv1a(frameout.screen).toString(16)} ${fnv1a(frameout.palette.screen).toString(16)}`;
    const calls = (name: string): number => vm.kernel.journal.counts[vm.kernel.indexOf(name)];
    /** Plan du jeu : le seul visible pendant le démarrage (barre d'icônes, inventaire et réglages sont cachés, priorité −1). */
    const gamePlane = () => {
      const visible = frameout.visiblePlanes();
      expect(visible).toHaveLength(1);
      expect(frameout.planes.map((plane) => plane.priority)).toEqual([-1, -1, -1, 2]);
      return visible[0];
    };

    // Pièce 17 : une vue traverse un plan noir pour mesurer la machine ; `UpdateScreenItem` une fois par image, pas plus.
    play(() => frames === 30);
    expect(currentRoom(vm)).toBe(SPEED_ROOM);
    const updates = calls("UpdateScreenItem");
    play(() => frames === 40);
    expect(calls("UpdateScreenItem") - updates).toBe(10);
    const speed = checksum();

    // Pièce 94 : le logo de Sierra (pic 50, 320×200, dont le plan du jeu ne montre que les lignes 10 à 199). Il arrive en
    // fondu (`SetShowStyle` 14, vingt étapes de trois ticks) : la première image est noire, la référence est prise le fondu fini.
    const fading = (): boolean => frameout.transitions.showStyles.length > 0;
    const black = (): boolean => frameout.palette.screen.subarray(0, 3 * 255).every((value) => value === 0);
    play(() => currentRoom(vm) === LOGO_ROOM && gamePlane().pictureId === LOGO_PIC);
    const logoFadeFrame = frames;
    expect([fading(), black()]).toEqual([true, true]);
    play(() => !fading());
    expect(black()).toBe(false);
    const logoFrame = frames;
    expect(gamePlane().items.map((item) => item.kind)).toEqual([CelKind.Pic]);
    const logo = checksum();

    // Pièce 375 : l'écran titre (pic 100) et ses quatre boutons (vue 100, boucles 0 à 3), ancrés en haut à gauche.
    // Le logo part en fondu (type 13) : l'écran titre se compose sur une palette noire, puis arrive en fondu lui aussi.
    play(() => currentRoom(vm) === TITLE_ROOM && gamePlane().items.length === 5);
    const titleFadeFrame = frames;
    expect([fading(), black()]).toEqual([true, true]);
    play(() => !fading());
    const titleFrame = frames;
    const plane = gamePlane();
    expect([plane.pictureId, plane.gameRect]).toEqual([TITLE_PIC, { left: 0, top: 10, right: 320, bottom: 200 }]);
    const buttons = plane.items.filter((item) => item.kind === CelKind.View).sort((a, b) => a.loop - b.loop);
    expect(buttons.map((item) => [item.view, item.loop, item.cel, item.screenRect])).toEqual(
      [149, 159, 169, 179].map((top, loop) => [TITLE_BUTTONS_VIEW, loop, 0, { left: 83, top, right: 118, bottom: top + 10 }]),
    );
    const title = checksum();

    // L'écran titre est immobile : même image une seconde plus tard, sans un seul `UpdateScreenItem` (bit « à redessiner » baissé).
    const idleUpdates = calls("UpdateScreenItem");
    play(() => frames === titleFrame + 60);
    expect(checksum()).toBe(title);
    expect(calls("UpdateScreenItem")).toBe(idleUpdates);
    expect(calls("OnMe")).toBeGreaterThan(200);

    expect({ logoFadeFrame, logoFrame, titleFadeFrame, titleFrame, speed, logo, title }).toMatchInlineSnapshot(`
      {
        "logo": "dced0f66 f1517340",
        "logoFadeFrame": 123,
        "logoFrame": 183,
        "speed": "38c165c5 ec4ed5f9",
        "title": "bb836db 5fd0e89b",
        "titleFadeFrame": 961,
        "titleFrame": 1021,
      }
    `);
    expect(vm.warnings.size).toBe(0);
    for (const ported of ["SetShowStyle", "SetCursor", "PalCycle", "RemapColors", "AddPlane", "UpdatePlane", "AddScreenItem", "UpdateScreenItem", "DeleteScreenItem", "SetNowSeen", "OnMe", "CelWide", "CelHigh", "FrameOut", "IsHiRes", "Graph"]) {
      expect(vm.kernel.journal.stubs.has(ported), ported).toBe(false);
      expect(calls(ported), ported).toBeGreaterThan(0);
    }
  });
});
