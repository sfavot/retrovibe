import type { GameObject } from "../../src/games/armaeth/engine/state";
import { Player } from "./player";

interface Internals {
  barrier(code: number, mode: number, obj: GameObject): number;
}

/** Contretemps prévu (mort du héros, trajet fermé) qui fait recommencer un passage à hasard. */
export class RobotSetback extends Error {}

/** Emplacement opposé (le héros qui sort par l'emplacement `i` arrive par `OPPOSITE[i]`). */
const OPPOSITE = [2, 3, 0, 1, 5, 4] as const;

/** Côtés des sorties à marcher, dans l'ordre des emplacements 0 à 3 de `WorldRoom.exits`. */
const SIDES = ["up", "right", "down", "left"] as const;

/**
 * Joueur robot : en plus du `Player`, il sait traverser le monde salle par salle (recherche de plus court chemin dans le graphe des
 * sorties à marcher, puis `leave`), c'est-à-dire uniquement par des clics et des flèches, jamais par téléportation.
 */
export class Robot extends Player {
  /** Réflexe du joueur, appelé après chaque image (par exemple fouetter l'ours dès qu'il est à portée). */
  watcher: (() => void) | null = null;
  private watching = false;

  override run(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.engine.tick();
      if (this.watcher && !this.watching) {
        this.watching = true;
        try {
          this.watcher();
        } finally {
          this.watching = false;
        }
      }
    }
  }

  /** Le joueur met quelques secondes à taper : le héros a fini de réagir à son dernier trajet (`Err 0x11`) avant la commande. */
  override say(line: string, settle = 4): string[] {
    this.run(12);
    return super.say(line, settle);
  }

  /**
   * Fait passer les images (en lisant les fenêtres qui s'ouvrent) jusqu'à ce que `done()` soit vrai ; rend vrai si c'est le cas avant
   * `maxFrames`. Les messages lus vont dans `log`.
   */
  until(done: () => boolean, maxFrames = 2000): boolean {
    for (let i = 0; i < maxFrames && !done(); i++) {
      this.run(1);
      if (this.engine.windows.active) this.readWindow();
    }
    return done();
  }

  /** Une touche de direction (flèche) : elle règle la marche du héros ; la rappuyer l'arrête. */
  arrow(key: "up" | "right" | "down" | "left"): void {
    this.host.key({ type: "nav", key });
    this.run(1);
  }

  /** Le caractère `-` (monter) ou `+` / `=` (descendre) : la rappuyer arrête le mouvement vertical (`ENGINE.heroKey`). */
  vertical(key: "-" | "="): void {
    this.host.type(key);
    this.run(1);
  }

  /** Sauvegarde (F2, emplacement 1) comme le fait le joueur avant un passage dangereux. */
  save(): void {
    this.host.key({ type: "function", n: 2 });
    this.run(5);
    this.drain();
  }

  /** Restauration (F3) : l'état du monde revient à la dernière sauvegarde, le hasard continue. */
  restore(): void {
    this.host.key({ type: "function", n: 3 });
    this.run(5);
    this.drain();
    this.run(60);
    this.drain();
    this.entry = -1;
    this.failedExits.clear();
  }

  /**
   * Passage à hasard : sauvegarde, essai, et si `ok` est faux (mort du héros, ours, frelons...) restauration et nouvel essai, au
   * plus `tries` fois. Rend le numéro de l'essai réussi (1 = du premier coup) ; lève sinon.
   */
  attempt(name: string, tries: number, run: () => void, ok: () => boolean): number {
    this.save();
    for (let n = 1; n <= tries; n++) {
      try {
        run();
      } catch (error) {
        if (!(error instanceof RobotSetback)) throw error;
        if (process.env.ROBOT_DEBUG) console.log(`${name} essai ${n} : ${error.message}`);
      }
      if (this.state.hero && ok()) return n;
      if (process.env.ROBOT_DEBUG) console.log(`${name} essai ${n} : échec (héros ${this.state.hero ? "vivant" : "mort"}, salle ${this.roomId})`);
      this.restore();
    }
    throw new Error(`${name} : échec après ${tries} essais`);
  }

  /** Salle chargée. */
  get roomId(): number {
    return this.state.loadedRoom!.id;
  }

  /** Voisines à marcher de la salle `id` : `[emplacement, salle]` (sorties libres pour le héros dans l'état courant du monde). */
  neighbours(id: number): [number, number][] {
    const room = this.state.rooms.find((r) => r.id === id)!;
    const out: [number, number][] = [];
    for (let slot = 0; slot < 4; slot++) {
      const idx = room.exits[slot]!;
      const code = room.barriers[slot]!;
      // sortie fermée au héros dans l'état courant du monde (barrage de la forêt, herses, dalles)
      if (idx && (code === 0 || (this.engine as unknown as Internals).barrier(code, 0, this.hero) === 0)) out.push([slot, this.state.rooms[idx]!.id]);
    }
    return out;
  }

  /** Sorties qui ont échoué : `salle>destination@entrée` (l'emplacement par lequel le héros est arrivé, -1 au départ). */
  private readonly failedExits = new Set<string>();
  /** Emplacement de la sortie par lequel le héros est entré dans la salle courante (-1 : placement libre). */
  private entry = -1;

  /**
   * Plus court chemin (liste de salles, départ exclu) de la salle courante à `target`, en évitant les salles de `avoid` et les sorties
   * qui ont déjà échoué depuis le même point d'entrée : l'accessibilité d'une sortie dépend du côté par lequel on est arrivé (une
   * salle peut être coupée en deux par un mur, un ruisseau ou une pile de bois).
   */
  route(target: number, avoid: ReadonlySet<number> = new Set()): number[] | null {
    const start = this.roomId;
    const key = (room: number, entry: number) => `${room}@${entry}`;
    const prev = new Map<string, [string, number]>();
    const queue: [number, number][] = [[start, this.entry]];
    const seen = new Set([key(start, this.entry)]);
    let found: string | null = null;
    while (queue.length) {
      const [id, entry] = queue.shift()!;
      if (id === target) {
        found = key(id, entry);
        break;
      }
      for (const [slot, next] of this.neighbours(id)) {
        if (avoid.has(next) || this.failedExits.has(`${id}>${next}@${entry}`)) continue;
        const k = key(next, OPPOSITE[slot]!);
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, [key(id, entry), next]);
        queue.push([next, OPPOSITE[slot]!]);
      }
    }
    if (!found) return null;
    const rooms: number[] = [];
    for (let k = found; k !== key(start, this.entry); ) {
      const [from, room] = prev.get(k)!;
      rooms.unshift(room);
      k = from;
    }
    return rooms;
  }

  /** Côté de l'écran (`up`...) de la sortie de la salle chargée qui mène à `dest`, selon la permutation des côtés de la scène. */
  sideTo(dest: number): (typeof SIDES)[number] {
    const slot = this.neighbours(this.roomId).find(([, id]) => id === dest)![0];
    const terrain = (this.engine as unknown as { terrain: { permutation: number[] } }).terrain;
    return SIDES[terrain.permutation[slot]!]!;
  }

  /** Arrête le héros (il garde son élan en entrant dans une salle) : un clic des bottes sous ses pieds. */
  stop(): void {
    if (!this.state.hero) return;
    this.walkTo(this.hero.x, this.hero.y, 300);
    this.run(10);
  }

  /**
   * Sort de la salle du côté `side` de l'écran : clic droit des bottes dans le secteur (`interface.md` § 5.6) ; si le trajet n'existe
   * pas depuis la position du héros, clics des bottes au bord puis flèche (`Player.leave`). Rend vrai si la salle a changé.
   */
  exit(side: (typeof SIDES)[number], maxTicks = 3000, quick = false): boolean {
    const before = this.roomId;
    this.stop();
    this.useBoots();
    const { x, y } = this.origin;
    const spot = { up: [160, 8], right: [300, 70], down: [160, 130], left: [20, 70] }[side];
    this.click(x + spot[0], y + spot[1], 2);
    for (let i = 0; i < maxTicks && this.state.loadedRoom?.id === before && this.state.hero && this.hero.path.defined; i += 5) {
      this.run(5);
      this.drain(4);
    }
    // `quick` : le joueur presse (salle dangereuse) : il ne s'arrête pas et reprend la main dès l'arrivée
    if (quick && this.state.loadedRoom?.id !== before) return true;
    this.run(30);
    this.drain(20);
    let moved = this.state.loadedRoom?.id !== before;
    if (!moved && this.state.hero) moved = this.leave(side);
    if (moved) this.stop();
    return moved;
  }

  /** Marche jusqu'à la salle `target` par les sorties ; rend les salles traversées. Lève si aucune route ne reste. */
  goTo(target: number, avoid: ReadonlySet<number> = new Set(), quick = false): number[] {
    const visited: number[] = [];
    for (let guard = 0; this.roomId !== target && guard < 60; guard++) {
      if (!this.state.hero) throw new RobotSetback(`héros mort en route vers la salle ${target} (salle ${this.roomId})`);
      const path = this.route(target, avoid);
      if (!path) throw new Error(`aucune route de la salle ${this.roomId} à ${target}`);
      const from = this.roomId;
      const dest = path[0]!;
      const slot = this.neighbours(from).find(([, id]) => id === dest)![0];
      const side = this.sideTo(dest);
      let moved = false;
      for (let attempt = 0; attempt < 2 && !moved; attempt++) moved = this.exit(side, 3000, quick && this.roomId === from && path.length === 1);
      if (!moved) {
        this.failedExits.add(`${from}>${dest}@${this.entry}`);
        continue;
      }
      this.entry = this.roomId === dest ? OPPOSITE[slot]! : -1;
      visited.push(this.roomId);
    }
    if (this.roomId !== target) throw new Error(`salle ${target} non atteinte (en ${this.roomId})`);
    return visited;
  }
}
