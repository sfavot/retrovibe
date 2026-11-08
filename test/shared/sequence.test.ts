import { describe, expect, it } from "vitest";
import { CLICK_DELAY_TICKS, FRAME_TICKS, delayTicks, pause, pauseTicks } from "../../src/games/drascula/engine/cadence";
import { type Sequence, SequenceRunner, skippable, unskippable, wait, waitUntil } from "../../src/engine/sequence";

/** Runner piloté à la main : `skip()` dépose une demande de saut, `interrupt` demande l'abandon. */
function harness() {
  const h = {
    ticks: 0,
    skips: 0,
    interrupt: false,
    log: [] as string[],
    runner: null as unknown as SequenceRunner,
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        h.ticks++;
        h.runner.step();
      }
    },
  };
  h.runner = new SequenceRunner({
    now: () => h.ticks,
    takeSkip: () => (h.skips > 0 ? (h.skips--, true) : false),
    interrupted: () => h.interrupt,
  });
  return h;
}

describe("cadence", () => {
  it("convertit delay et pause de ScummVM en ticks de 10 ms", () => {
    expect(delayTicks(25)).toBe(5);
    expect(FRAME_TICKS).toBe(5);
    expect(CLICK_DELAY_TICKS).toBe(10);
    expect(pauseTicks(1)).toBe(3);
    expect(pauseTicks(10)).toBe(30);
    expect(delayTicks(1410)).toBe(282);
  });
});

describe("SequenceRunner", () => {
  it("attend le nombre de ticks demandé et enchaîne les attentes", () => {
    const h = harness();
    let ended = false;
    h.runner.start(
      (function* () {
        h.log.push(`a${h.ticks}`);
        yield* wait(3);
        h.log.push(`b${h.ticks}`);
        yield* pause(1);
        h.log.push(`c${h.ticks}`);
        yield* wait(0);
        h.log.push(`d${h.ticks}`);
      })(),
      () => (ended = true),
    );
    expect(h.log).toEqual(["a0"]);
    h.tick(2);
    expect(h.log).toEqual(["a0"]);
    h.tick(1);
    expect(h.log).toEqual(["a0", "b3"]);
    h.tick(3);
    expect(h.log).toEqual(["a0", "b3", "c6", "d6"]);
    expect(ended).toBe(true);
    expect(h.runner.active).toBe(false);
  });

  it("teste waitUntil tout de suite puis à chaque tick", () => {
    const h = harness();
    let ready = false;
    h.runner.start(
      (function* () {
        yield* waitUntil(() => true);
        h.log.push("immédiat");
        yield* waitUntil(() => ready);
        h.log.push(`prêt ${h.ticks}`);
      })(),
    );
    expect(h.log).toEqual(["immédiat"]);
    h.tick(5);
    ready = true;
    h.tick(1);
    expect(h.log).toEqual(["immédiat", "prêt 6"]);
  });

  it("compose les séquences par yield* et rend leurs valeurs", () => {
    const h = harness();
    function* inner(n: number): Sequence<number> {
      yield* wait(n);
      return n * 2;
    }
    let result = 0;
    h.runner.start(
      (function* () {
        result = (yield* inner(2)) + (yield* inner(3));
      })(),
    );
    h.tick(5);
    expect(result).toBe(10);
  });

  it("refuse une deuxième séquence et arrête une boucle sans attente", () => {
    const h = harness();
    h.runner.start(wait(10));
    expect(() => h.runner.start(wait(1))).toThrow(/déjà en cours/);
    h.runner.abort();
    expect(h.runner.active).toBe(false);
    // une attente de 0 tick est remplie tout de suite : une boucle qui n'attend que cela ne cède jamais
    const loop = harness();
    expect(() =>
      loop.runner.start(
        (function* () {
          for (;;) yield { kind: "ticks", count: 0 };
        })(),
      ),
    ).toThrow(/sans attente/);
    expect(loop.runner.active).toBe(false);
  });

  it("propage l'erreur d'une séquence et se libère", () => {
    const h = harness();
    h.runner.start(
      (function* () {
        yield* wait(1);
        throw new Error("boum");
      })(),
    );
    expect(() => h.tick()).toThrow("boum");
    expect(h.runner.active).toBe(false);
  });
});

describe("saut (skippable)", () => {
  function* cinematic(h: ReturnType<typeof harness>): Sequence {
    try {
      h.log.push("début");
      yield* wait(10);
      h.log.push("milieu");
      yield* wait(10);
      h.log.push("fin");
    } finally {
      h.log.push("nettoyage");
    }
  }

  it("Échap abandonne la partie sautable et la suite continue (break de ScummVM)", () => {
    const h = harness();
    let result: string | undefined = "non";
    h.runner.start(
      (function* () {
        result = yield* skippable(
          (function* (): Sequence<string> {
            yield* cinematic(h);
            return "jouée";
          })(),
        );
        h.log.push(`après ${h.ticks}`);
        yield* wait(2);
        h.log.push("état mis à jour");
      })(),
    );
    h.tick(4);
    h.skips = 1;
    h.tick(1);
    expect(result).toBeUndefined();
    expect(h.log).toEqual(["début", "nettoyage", "après 5"]);
    h.tick(2);
    expect(h.log.at(-1)).toBe("état mis à jour");
    expect(h.runner.active).toBe(false);
  });

  it("sans saut, la partie rend sa valeur ; hors partie sautable, Échap reste dans le tampon", () => {
    const h = harness();
    let result: string | undefined;
    h.runner.start(
      (function* () {
        result = yield* skippable(
          (function* (): Sequence<string> {
            yield* wait(2);
            return "jouée";
          })(),
        );
        yield* wait(5);
      })(),
    );
    h.tick(2);
    expect(result).toBe("jouée");
    h.skips = 1;
    h.tick(1);
    expect(h.skips).toBe(1);
  });

  it("parties imbriquées : seule la plus intérieure se saute", () => {
    const h = harness();
    h.runner.start(
      skippable(
        (function* () {
          yield* skippable(
            (function* () {
              yield* wait(10);
              h.log.push("intérieur fini");
            })(),
          );
          h.log.push("extérieur continue");
          yield* wait(10);
          h.log.push("extérieur fini");
        })(),
      ),
    );
    h.skips = 1;
    h.tick(1);
    expect(h.log).toEqual(["extérieur continue"]);
    h.skips = 1;
    h.tick(1);
    expect(h.log).toEqual(["extérieur continue"]);
    expect(h.runner.active).toBe(false);
  });
});

describe("attentes insensibles au saut (unskippable)", () => {
  it("Échap ne saute pas une attente protégée, même dans plusieurs parties sautables ; la touche reste pour la séquence", () => {
    const h = harness();
    h.runner.start(
      skippable(
        (function* () {
          yield* skippable(unskippable(wait(10)));
          h.log.push("réplique finie");
          yield* wait(10);
          h.log.push("jamais");
        })(),
      ),
    );
    h.skips = 1;
    h.tick(5);
    expect(h.log).toEqual([]);
    expect(h.skips).toBe(1); // jamais prise par le runner : c'est à la réplique de la lire
    h.tick(5);
    expect(h.log).toEqual(["réplique finie"]);
    // L'attente suivante, elle, se saute.
    h.tick(1);
    expect(h.runner.active).toBe(false);
    expect(h.log).toEqual(["réplique finie"]);
  });

  it("un abandon exécute les finally de la partie protégée", () => {
    const h = harness();
    h.runner.start(
      unskippable(
        (function* () {
          try {
            yield* wait(10);
          } finally {
            h.log.push("nettoyage");
          }
        })(),
      ),
    );
    h.runner.abort();
    expect(h.log).toEqual(["nettoyage"]);
  });
});

describe("abandon", () => {
  it("abort exécute les finally sans la suite", () => {
    const h = harness();
    h.runner.start(
      (function* () {
        try {
          yield* skippable(
            (function* () {
              try {
                yield* wait(10);
              } finally {
                h.log.push("intérieur");
              }
            })(),
          );
          h.log.push("suite");
        } finally {
          h.log.push("extérieur");
        }
      })(),
    );
    h.tick(2);
    h.runner.abort();
    expect(h.log).toEqual(["intérieur", "extérieur"]);
    expect(h.runner.active).toBe(false);
  });

  it("une demande d'abandon prend effet au yield suivant, jamais pendant l'exécution", () => {
    const h = harness();
    h.runner.start(
      (function* () {
        try {
          yield* wait(1);
          h.interrupt = true; // fin de chapitre demandée par le gestionnaire
          h.log.push("même tour");
          yield* wait(1);
          h.log.push("jamais");
        } finally {
          h.log.push("finally");
        }
      })(),
    );
    h.tick(1);
    expect(h.log).toEqual(["même tour", "finally"]);
    expect(h.runner.active).toBe(false);
  });
});
