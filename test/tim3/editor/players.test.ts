import { describe, expect, it } from "vitest";
import { MemoryStorage, prefixedStorage, type HostStorage } from "../../../src/engine/storage";
import {
  DEFAULT_PLAYER_SOUND,
  GUEST_ID,
  MAX_PLAYERS,
  PLAYERS_KEY,
  PLAYER_NAME_MAX,
  PlayerRegistry,
  cleanPlayerName,
  migratePlayerSound,
  migratePlayers,
  playerKeys,
  readPlayerSound,
  signInDecision,
} from "../../../src/games/tim3/engine/players";
import { HomeProgress, Progress } from "../../../src/games/tim3/engine/session";

/** Le stockage du jeu tel que `app.ts` le voit (`tim3:`). */
function store(): { raw: MemoryStorage; tim3: HostStorage } {
  const raw = new MemoryStorage();
  return { raw, tim3: prefixedStorage(raw, "tim3:") };
}

const LAB_MACHINE = JSON.stringify({ version: 2, parts: { gravity: 272, pressure: 67, background: 3, music: 1000, fixedParts: [], movingParts: [], placed: [] } });

describe("joueurs : migration de la progression d'avant l'inscription", () => {
  it("la progression sans joueur devient celle de l'invité, sans perte ; les machines du Labo restent communes", () => {
    const { raw, tim3 } = store();
    raw.set("tim3:solved", "TLEV1,TLEV2,HH3");
    raw.set("tim3:last", "TLEV3");
    raw.set("tim3:homeSolved", "2@1700000000000");
    raw.set("tim3:edit:TLEV3", '{"version":2,"parts":{}}');
    raw.set("tim3:edit:lab", LAB_MACHINE);
    raw.set("tim3:slot02", '{"savedAt":1700000000000,"save":{}}');
    raw.set("tim3:music", "0");
    raw.set("retrovibe:tim3:voices", "0");

    const players = new PlayerRegistry(tim3, "Hôte");
    expect(players.migrated).toBe(true);
    expect(players.current).toBe(GUEST_ID);
    expect([...raw.data.keys()].sort()).toEqual(
      [
        "retrovibe:tim3:voices",
        "tim3:p0:music",
        "tim3:p0:edit:TLEV3",
        "tim3:p0:edit:lab",
        "tim3:p0:homeSolved",
        "tim3:p0:last",
        "tim3:p0:solved",
        "tim3:players",
        "tim3:slot02",
      ].sort(),
    );
    // Ce que lit le jeu : la même progression, par le stockage du joueur courant.
    const progress = new Progress(players.storage());
    expect(["TLEV1", "TLEV2", "HH3"].every((n) => progress.isSolved(n))).toBe(true);
    expect(progress.last).toBe("TLEV3");
    expect(new HomeProgress(players.storage()).isSolved(2, 1700000000000)).toBe(true);
    expect(players.storage().get("edit:lab")).toBe(LAB_MACHINE);
    expect(players.storage().get("edit:TLEV3")).toBe('{"version":2,"parts":{}}');
    // Une seule fois.
    expect(new PlayerRegistry(tim3, "Hôte").migrated).toBe(false);
    expect(new Progress(new PlayerRegistry(tim3, "Hôte").storage()).isSolved("TLEV1")).toBe(true);
  });

  it("premier lancement sans progression : un registre vide, l'invité seul", () => {
    const { raw, tim3 } = store();
    const players = new PlayerRegistry(tim3, "Hôte");
    expect(players.migrated).toBe(true);
    expect(players.list()).toEqual([{ id: GUEST_ID, name: null }]);
    expect(JSON.parse(raw.get("tim3:players")!)).toEqual({ version: 1, players: [] });
  });

  it("migration interrompue (registre pas écrit) : reprise à l'ouverture suivante, sans écraser ce qui est déjà copié", () => {
    const { raw, tim3 } = store();
    raw.set("tim3:solved", "TLEV1");
    raw.set("tim3:last", "TLEV2");
    // Copie faite, registre et effacement pas encore : la copie de `solved` est déjà là, plus récente.
    raw.set("tim3:p0:solved", "TLEV1,TLEV4");
    expect(migratePlayers(tim3)).toBe(true);
    expect(raw.get("tim3:p0:solved")).toBe("TLEV1,TLEV4");
    expect(raw.get("tim3:p0:last")).toBe("TLEV2");
    expect(raw.get("tim3:solved")).toBeNull();
  });

  it("stockage qui refuse d'écrire : rien n'est effacé, le registre n'est pas posé", () => {
    const raw = new MemoryStorage();
    raw.set("tim3:solved", "TLEV1");
    const failing: HostStorage = { get: (k) => raw.get(k), set: () => false, remove: (k) => raw.remove(k) };
    expect(migratePlayers(prefixedStorage(failing, "tim3:"))).toBe(false);
    expect(raw.get("tim3:solved")).toBe("TLEV1");
    expect(raw.get(`tim3:${PLAYERS_KEY}`)).toBeNull();
  });

  it("les clés déplacées : progression, aire de chaque puzzle et du Labo", () => {
    const keys = playerKeys();
    expect(keys.slice(0, 3)).toEqual(["solved", "last", "homeSolved"]);
    expect(keys).toContain("edit:TLEV1");
    expect(keys).toContain("edit:lab");
    expect(keys).toContain("music");
    expect(keys).toContain("volume");
    expect(keys).not.toContain("effects");
  });
});

describe("joueurs : réglages de son du fichier de partie (42c6d0, 42c8cb : octets +0x50 volume, +0x51 musique)", () => {
  it("partie neuve (42cf85) : musique en marche, volume 15 ; valeurs illisibles : celles d'une partie neuve", () => {
    const { tim3 } = store();
    const players = new PlayerRegistry(tim3, "Hôte");
    expect(players.sound()).toEqual(DEFAULT_PLAYER_SOUND);
    players.storage().set("volume", "abc");
    expect(players.sound().volume).toBe(15);
    players.storage().set("volume", "99");
    expect(players.sound().volume).toBe(15);
    players.storage().set("volume", "-4");
    expect(players.sound().volume).toBe(0);
  });

  it("chaque joueur garde sa musique et son volume ; changer de joueur rend les siens", () => {
    const { raw, tim3 } = store();
    const players = new PlayerRegistry(tim3, "Hôte");
    expect(players.setSound({ music: false, volume: 5 })).toBe(true);
    const r = players.create("Alice");
    if (r.status !== "created") throw new Error(r.status);
    players.select(r.player.id);
    expect(players.sound()).toEqual({ music: true, volume: 15 });
    players.setSound({ volume: 8 });
    expect(players.sound()).toEqual({ music: true, volume: 8 });
    players.select(GUEST_ID);
    expect(players.sound()).toEqual({ music: false, volume: 5 });
    expect(raw.get("tim3:p0:music")).toBe("0");
    expect(raw.get("tim3:p0:volume")).toBe("5");
    expect(raw.get("tim3:p1:volume")).toBe("8");
    // Rouvert (rechargement de la page) : l'invité au lancement, avec ses réglages.
    expect(new PlayerRegistry(tim3, "Hôte").sound()).toEqual({ music: false, volume: 5 });
  });

  it("un numéro réutilisé repart des réglages d'une partie neuve", () => {
    const { raw, tim3 } = store();
    const players = new PlayerRegistry(tim3, "Hôte");
    raw.set("tim3:p1:music", "0");
    raw.set("tim3:p1:volume", "3");
    const r = players.create("Bob");
    expect(r.status).toBe("created");
    expect(players.sound(1)).toEqual(DEFAULT_PLAYER_SOUND);
  });

  it("migration : la musique et le volume communs deviennent ceux de l'invité et des joueurs déjà inscrits, sans perte", () => {
    const { raw, tim3 } = store();
    // Un site déjà passé par l'inscription : registre avec Alice (1) et Chloé (3), réglages encore communs.
    raw.set("tim3:players", JSON.stringify({ version: 1, players: [{ id: 1, name: "Alice" }, { id: 3, name: "Chloé" }] }));
    raw.set("tim3:music", "0");
    raw.set("tim3:volume", "10");
    raw.set("tim3:effects", "0");
    raw.set("retrovibe:tim3:voices", "0");
    raw.set("retrovibe:tim3:sound", "0");
    raw.set("tim3:p3:volume", "3");
    const players = new PlayerRegistry(tim3, "Hôte");
    expect(players.sound()).toEqual({ music: false, volume: 10 });
    expect(players.sound(1)).toEqual({ music: false, volume: 10 });
    // Un réglage déjà propre au joueur n'est pas écrasé.
    expect(players.sound(3)).toEqual({ music: false, volume: 3 });
    expect(raw.get("tim3:music")).toBeNull();
    expect(raw.get("tim3:volume")).toBeNull();
    // Restent communs : l'interrupteur des effets, les voix et le bouton « Son » du site.
    expect(raw.get("tim3:effects")).toBe("0");
    expect(raw.get("retrovibe:tim3:voices")).toBe("0");
    expect(raw.get("retrovibe:tim3:sound")).toBe("0");
    // Une seule fois.
    expect(migratePlayerSound(tim3, [1, 3])).toBe(false);
    players.select(1);
    players.setSound({ volume: 13 });
    expect(new PlayerRegistry(tim3, "Hôte").sound(1).volume).toBe(13);
  });

  it("migration d'avant l'inscription : la musique et le volume suivent la progression vers l'invité", () => {
    const { raw, tim3 } = store();
    raw.set("tim3:solved", "TLEV1");
    raw.set("tim3:volume", "5");
    const players = new PlayerRegistry(tim3, "Hôte");
    expect(players.sound()).toEqual({ music: true, volume: 5 });
    expect(raw.get("tim3:volume")).toBeNull();
  });

  it("migration interrompue (écriture refusée) : rien n'est effacé, elle reprend ensuite", () => {
    const raw = new MemoryStorage();
    raw.set("tim3:players", JSON.stringify({ version: 1, players: [] }));
    raw.set("tim3:music", "0");
    let refuse = true;
    const flaky: HostStorage = { get: (k) => raw.get(k), set: (k, v) => !refuse && raw.set(k, v), remove: (k) => raw.remove(k) };
    const tim3 = prefixedStorage(flaky, "tim3:");
    expect(migratePlayerSound(tim3, [])).toBe(false);
    expect(raw.get("tim3:music")).toBe("0");
    refuse = false;
    expect(new PlayerRegistry(tim3, "Hôte").sound().music).toBe(false);
    expect(raw.get("tim3:music")).toBeNull();
    expect(readPlayerSound(prefixedStorage(raw, "tim3:p0:")).music).toBe(false);
  });
});

describe("joueurs : registre (TIM.SAV, tim01.sav … tim100.sav)", () => {
  it("inscrire : premier numéro libre ; chaque joueur a sa propre progression ; l'invité garde la sienne", () => {
    const { tim3 } = store();
    const players = new PlayerRegistry(tim3, "Hôte");
    new Progress(players.storage()).markSolved("TLEV1");
    const r = players.create("  Suzy  ");
    expect(r).toEqual({ status: "created", player: { id: 1, name: "Suzy" } });
    expect(players.list().map((p) => players.nameOf(p))).toEqual(["Hôte", "Suzy"]);
    expect(players.select(1)).toBe(true);
    const mine = new Progress(players.storage());
    expect(mine.isSolved("TLEV1")).toBe(false);
    mine.markSolved("TLEV2");
    expect(new Progress(players.storage(GUEST_ID)).isSolved("TLEV2")).toBe(false);
    // Le registre survit au rechargement ; le joueur courant non (l'invité au lancement, 43b5cc).
    const again = new PlayerRegistry(tim3, "Hôte");
    expect(again.current).toBe(GUEST_ID);
    expect(again.list()).toEqual([{ id: GUEST_ID, name: null }, { id: 1, name: "Suzy" }]);
    expect(new Progress(again.storage(1)).isSolved("TLEV2")).toBe(true);
  });

  it("noms uniques, casse ignorée (452a04), invité compris ; vides refusés ; 19 caractères", () => {
    const { tim3 } = store();
    const players = new PlayerRegistry(tim3, "Hôte");
    players.create("Léa");
    expect(players.create("LÉA")).toEqual({ status: "exists", player: { id: 1, name: "Léa" } });
    expect(players.create("hôte")).toEqual({ status: "exists", player: { id: GUEST_ID, name: null } });
    expect(players.create("   ")).toEqual({ status: "invalid" });
    expect(players.find("lea")).toBeNull();
    expect(cleanPlayerName("x".repeat(40))).toHaveLength(PLAYER_NAME_MAX);
  });

  it("cent joueurs au plus (42d10b) ; un numéro libéré reprend une partie neuve", () => {
    const { raw, tim3 } = store();
    const players = new PlayerRegistry(tim3, "Hôte");
    for (let i = 1; i <= MAX_PLAYERS; i++) expect(players.create(`J${i}`).status).toBe("created");
    expect(players.create("Un de trop")).toEqual({ status: "full" });
    expect(players.list()).toHaveLength(MAX_PLAYERS + 1);
    // Un registre abîmé à la main : le numéro 7 disparaît, ses restes ne passent pas au nouveau joueur.
    raw.set("tim3:p7:solved", "TLEV1");
    const doc = JSON.parse(raw.get("tim3:players")!) as { players: { id: number }[] };
    doc.players = doc.players.filter((p) => p.id !== 7);
    raw.set("tim3:players", JSON.stringify(doc));
    const reread = new PlayerRegistry(tim3, "Hôte");
    expect(reread.create("Nouveau")).toEqual({ status: "created", player: { id: 7, name: "Nouveau" } });
    expect(new Progress(reread.storage(7)).isSolved("TLEV1")).toBe(false);
  });

  it("registre illisible ou étranger : l'invité seul, jamais d'exception ; entrées invalides ignorées", () => {
    const { raw, tim3 } = store();
    raw.set("tim3:players", "{cassé");
    expect(new PlayerRegistry(tim3, "Hôte").list()).toEqual([{ id: GUEST_ID, name: null }]);
    raw.set("tim3:players", JSON.stringify({ version: 1, players: [{ id: 2, name: "B" }, { id: 2, name: "C" }, { id: 0, name: "X" }, { id: 101, name: "Y" }, { id: 3, name: " " }, { id: 1, name: "A" }] }));
    expect(new PlayerRegistry(tim3, "Hôte").list()).toEqual([{ id: GUEST_ID, name: null }, { id: 1, name: "A" }, { id: 2, name: "B" }]);
  });
});

describe("joueurs : « Terminé » de l'écran d'inscription (426877)", () => {
  const registry = (): PlayerRegistry => {
    const p = new PlayerRegistry(store().tim3, "Hôte");
    p.create("Suzy");
    return p;
  };

  it("un nom connu désigne son joueur, casse ignorée ; un nom inconnu demande s'il est nouveau (31174)", () => {
    const p = registry();
    expect(signInDecision(p, " suzy ", null)).toEqual({ kind: "select", player: { id: 1, name: "Suzy" } });
    expect(signInDecision(p, "HÔTE", 1)).toEqual({ kind: "select", player: { id: GUEST_ID, name: null } });
    expect(signInDecision(p, "Tom", 0)).toEqual({ kind: "ask", name: "Tom" });
  });

  it("sans nom : la rangée choisie ; sans rien, 31175", () => {
    const p = registry();
    expect(signInDecision(p, "", 1)).toEqual({ kind: "select", player: { id: 1, name: "Suzy" } });
    expect(signInDecision(p, "  ", null)).toEqual({ kind: "noName" });
    expect(signInDecision(p, "", 9)).toEqual({ kind: "noName" });
  });
});
