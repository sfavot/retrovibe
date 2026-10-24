# Moteur TypeScript de Math Workshop (tâche F1)

Cœur du moteur propre au jeu, sur le modèle du Téléportaschtroumpf (`docs/teleportaschtroumpf/engine-ts.md`). Comportement d'origine : `engine.md` (§1 démarrage et scènes, §4.6 temps, §5 entrées, §7 roster) et `screens/*.md`. Ce document décrit le code : où est quoi, comment écrire une scène, ce que les vagues suivantes viennent brancher.

## Carte du code

Tout est sous `src/games/mathemagique/engine/` (hors `graphics/`, vague F2).

| Fichier | Rôle |
|---|---|
| `host.ts` | `Host` : seule frontière avec l'extérieur (fichiers, temps, entrées, audio, stockage, présentation, curseur, sortie), `HostStorage`, `CursorKind`. |
| `input.ts` | `Input` : position du pointeur (zone de jeu 576×432), files d'événements bouton et clavier, états tenus. Aucune logique de gadget. |
| `clock.ts` | `Clock` (tick fixe de 17 ms), `Deadline` (échéance en ticks), `Timer` (chrono gelable). |
| `scene.ts` | `SceneId`, `Scene`, `SceneContext`, `SceneManager` (changement différé), `Services` (point d'extension). |
| `engine.ts` | `Engine` : assemble le tout, `frame(now)`, ordre d'un tick, présentation, curseur, pause. |
| `rng.ts` | `MsvcRandom` (congruentiel du jeu) et `NoRepeatPool` (tirage sans remise `10a8:13af`). Pur. |
| `resources.ts` | `Resources` (cache d'archives Mohawk par nom) et `Archive` (ressources décodées et mémorisées). |
| `roster.ts` | `Roster` (`MWRoster` : 41 × 5424 octets), règles de noms, masque et rang, `RosterStore` (base64 dans `HostStorage`), `RosterState` (joueur courant). Pur. |

Tests : `test/mathemagique/engine-core.test.ts`, avec `test/mathemagique/engine-test-host.ts` (hôte de test). Les tests qui lisent les vrais `.DAT` sont ignorés sans `original/mathemagique/` (`hasOriginalFiles`).

## La frontière : `Host`

Le moteur ne touche ni au DOM, ni à `fetch`, ni à `Date`, ni à `localStorage`. L'hôte fournit :

- `loadFile(path)` : chemin relatif à `original/mathemagique/` (`BOWLING.DAT`, `MPC/PVG.MHK`), résolution insensible à la casse par `GameFiles.resolve` (l'EXE demande `nim.DAT`, `PatFill.DAT`, `milkyway.dat`). Rejette si le fichier manque.
- `now()` (ms monotones), `unixMillis()` (horloge murale, graine du hasard).
- `input` (un objet `Input` que l'hôte alimente), `audio` (`AudioSink`, `audio/sink.ts`), `storage`.
- `present(frame)` (`Frame` de `graphics/frame.ts`, tampons réutilisés : copier pour garder), `setCursor(kind)` (`arrow`, `busy`, `help`, `hidden`), `exit()`.

## Temps : tick de 17 ms

L'original arme `timeSetEvent(17 ms)` : son tick global avance de 17 ms (58,8 par seconde), pas de 1000/60. Choix : **17 ms** (`TICK_MS`). Toutes les durées du jeu sont en ticks (compte à rebours, scripts `SCR`, 10 800 ticks du Bowling), elles s'écoulent ainsi à la vitesse d'origine. Conséquence assumée : sur un écran à 60 Hz, une image sur 50 environ ne joue aucun tick ; la logique ne dépend jamais du nombre d'images.

`Clock.update(now)` accumule les millisecondes ; `consume()` rend un tick dû. Le rattrapage est borné à 15 ticks (`MAX_CATCH_UP_TICKS`) : le reste est abandonné (onglet masqué). `resync()` oublie l'absence (reprise après pause). Les attentes bloquantes de l'original deviennent des états de scène : `clock.deadline(n)` → `expired` / `remaining`, `clock.createTimer()` pour un chrono avec `freeze()` / `resume()`. **Jamais de boucle bloquante ni de `await` dans `tick`.**

Remarque : les 10 800 ticks du Bowling valent 180 s dans la doc (compte à 60 ticks/s, champ du moniteur en secondes × 60) mais 183,6 s réelles avec des ticks de 17 ms. Le roster garde « secondes × 60 » comme l'original ; à trancher en vague I (Bowling) si l'on veut la durée affichée exacte.

## Scènes

Les 11 scènes de `MATH` ont les identifiants de `1108:1b20` : `SceneId.hub = 0`, `bowling`, `rhythm`, `patternWindows`, `hidden`, `patterns`, `sticklers`, `rockets`, `title = 8`, `credits`, `trophy = 10` (`SCENE_NAMES` donne les noms).

```ts
interface Scene {
  load?(ctx): Promise<void>;          // ouvre les archives (ctx.resources.open) ; l'ancienne scène est gelée
  enter(ctx): void;                   // construit l'écran
  leave(ctx): void;                   // libère ce qui n'est pas dans Resources
  tick(ctx): void;                    // un tick de 17 ms
  exit?(ctx): void;                   // demande de sortie (bouton Quitter, fermeture) ; absent = ignorée
  key?(event, ctx): boolean;          // vrai si la touche est consommée
}
```

`Enter`, `Leave`, `Tick`, `Exit` et `Key` sont les cinq champs du descripteur d'origine (`+0x00`, `+0x04`, `+0x08`, `+0x0c`, `+0x10`). Écart : l'original appelle `Leave` depuis la scène elle-même ; ici le gestionnaire l'appelle toujours, avant l'`enter` de la suivante. Les méthodes reçoivent toutes `ctx`.

**Changement différé** (comme `1108:1b20` consommé par `1038:0000`) : `ctx.scenes.request(id)` ne fait que noter la scène voulue ; la bascule a lieu au début du tick suivant, jamais au milieu d'un tick. Une demande faite dans `enter` attend le tick d'après. Déroulé :

1. `step()` (début de tick) voit la demande et crée la scène par sa fabrique (`engine.register(id, () => new MaScene())`) ;
2. sans `load` : `leave` de l'ancienne, libération de ses archives, `enter` de la nouvelle, le tout dans ce tick ;
3. avec `load` : l'ancienne scène est **gelée** (plus de `tick`, son dernier écran reste affiché), le curseur passe à `busy` ; quand `load` est réglé, `leave`, libération, `enter` dans un même tick ;
4. si `load` échoue : l'ancienne scène reprend, `Engine.error` et `EngineOptions.onError` portent l'erreur ; si c'est la première scène, `Engine.failed` est vrai et le moteur s'arrête sans exception ;
5. une demande reçue pendant un chargement est gardée (la dernière l'emporte) et traitée ensuite ;
6. la bascule vide les files d'entrée (`input.flush()`) : un clic fait pendant l'ancienne scène n'agit pas sur la nouvelle.

Une scène non enregistrée est une erreur de programmation (exception explicite).

## Ordre d'un tick (`Engine`)

1. `scenes.step()` : bascule ou avancement du chargement ;
2. `input.beginTick()` ;
3. touches, une par une : gestionnaires `before` (`addKeyHandler("before", …)` : gadgets, `10a0:098e`), `Scene.key`, gestionnaires `after` (historique des séquences secrètes `1018:03fd`), puis Ctrl+Q → `host.exit()` ;
4. crochets de tick des services (`addTickHook`) : gadgets (souris), lecteur de scripts, séquenceur, fondus ;
5. `Scene.tick`.

En fin d'image (`frame`), si une scène a appelé `ctx.requestPresent()` (ou vient d'entrer) et qu'une source d'image est branchée (`setFrameSource`), `host.present(frame)`. Sans demande, rien n'est présenté. Pause : `setPaused(true)` suspend l'audio et les ticks ; à la reprise l'absence n'est pas rattrapée. `requestExit()` transmet à `Scene.exit`.

## Entrées

`Input` est alimenté par l'hôte : `moveMouse`, `mouseDown` / `mouseUp` (`"left" | "right" | "middle"` ; `mouseButtonFromDom` convertit `MouseEvent.button`), `keyDown({ code, key, ctrl, shift, alt, repeat })`, `keyUp`, `reset` (perte du focus).

- Position : vivante, arrondie, en coordonnées de la zone de jeu (576×432), **peut sortir de la zone** (négatif ou au-delà).
- Boutons et touches : **files d'événements**. Tout ce qui arrive entre deux ticks est remis au tick suivant (`buttonEvents`, avec la position au moment de l'événement ; `keyEvents`). Un clic plus court qu'une image, ou plusieurs clics dans la même image, ne sont donc jamais perdus ni fusionnés. `justPressed(b)` / `justReleased(b)` sont des raccourcis sur la liste du tick. Les files sont bornées à 64 événements.
- États tenus, lisibles à tout moment : `isButtonDown(b)`, `isHeld(code)`, `ctrl`, `shift`, `alt`, `space`.

La vague G1 construit par-dessus (zones cliquables, cliquer-poser / glisser selon `roster.clickAndStick`, pièce portée) sans toucher à ce fichier : elle lit `buttonEvents` dans un crochet de tick.

## Contexte et services (point d'extension)

`SceneContext` : `host`, `clock`, `rng`, `resources`, `roster`, `input`, `scenes`, `services`, `requestPresent()`, `setCursor(kind)`.

Les couches des vagues suivantes ne modifient pas le contexte : chacune définit une **clé typée** dans son module, l'enregistre au démarrage, et les scènes la lisent.

```ts
export const GRAPHICS = defineService<Graphics>("graphics");   // module de la couche (F2)
engine.services.provide(GRAPHICS, new Graphics(...));          // démarrage (G2)
const gfx = ctx.services.get(GRAPHICS);                        // dans une scène
```

| Vague | Branche |
|---|---|
| F2 graphismes | service `graphics` (surfaces, palette, polices) ; `engine.setFrameSource(() => frame)` ; un crochet de tick pour les fondus et cycles de palette |
| F3 audio | `host.audio` existe déjà (`AudioSink`) ; service de lecture (WAVE par SNDL, MIDI à marqueurs) et crochet de tick pour le séquenceur |
| G1 services | lecteur `SCR`, gadgets (crochet de tick lisant `input.buttonEvents`, gestionnaire de touches `before` pour Tab / Entrée), curseurs (`ctx.setCursor`) |
| G2 intégration | hôte navigateur (implémente `Host`), `index.ts`, enregistrement des 11 fabriques de scène, `requestAnimationFrame` → `engine.frame`, `setPaused` sur onglet caché, Ctrl+V |
| G3 Poly | service d'aide de Poly (ouvre `POLLY.DAT` temporairement : `resources.open` puis `release`) |

## Ressources

`ctx.resources.open("BOWLING.DAT")` (dans `Scene.load`) charge l'archive via `host.loadFile`, l'analyse (`MohawkArchive`) et la garde sous un nom en minuscules : une seconde ouverture rend le même objet (les ouvertures simultanées sont fusionnées). L'`Archive` rendue décode à la demande et **mémorise** : `shap(id)`, `shpl(id)`, `scr(id)`, `sndl(id)`, `strl(id)`, `wave(id)`, `midi(id)`, plus `raw(tag, id)`, `sndBytes(id)`, `has`, `ids`. Les objets sont partagés : ne pas les modifier. Après `load`, une scène relit son archive en synchrone avec `resources.require(nom)`.

Portées : `"scene"` (défaut, libérée quand la scène quitte) et `"persistent"` (`MILKYWAY.DAT`, gardée jusqu'à `release(nom)`). Pendant le chargement de la scène suivante, les archives qu'elle ouvre lui appartiennent ; celles de l'ancienne sont libérées à la bascule, sauf les archives que la nouvelle a rouvertes (partagées). Un échec d'ouverture n'est pas gardé : on peut réessayer.

## Hasard

`MsvcRandom` (`rng.ts`) : `s ← s × 0x343FD + 0x269EC3 (mod 2³²)`, `rand(n) = (s >>> 16) % (n + 1)` (16 bits hauts complets, sans `& 0x7FFF` ; `n ≤ 0` renvoie 0 sans avancer), `rand1(n) = rand(n − 1)` ([0, n[ ; Bowling, Sticklers, Patterns), `below(n)` (synonyme), `range(lo, hi) = lo + rand(hi − lo)` (Rockets, Pattern Windows), `seed(x)` / `current` pour sauvegarder et reprendre. Le moteur le graine avec les 32 bits bas de `host.unixMillis()` (l'original : l'heure système, non reproductible) ; `EngineOptions.seed` fixe la graine pour les tests.

`NoRepeatPool(size, mask = 0)` : port de `10a8:13af`, sondage linéaire (pas uniforme parmi les restants), `state` persistant et partageable, remise au masque quand tout est pris, erreur si le masque occupe toutes les valeurs.

Vecteurs des docs vérifiés par les tests, **tous conformes à la formule** : graine 0 `rand(4)`×8 = 3,4,1,2,3,2,0,0 ; `rand(100)`×8 = 38,43,72,13,11,81,83,66 ; `rand(5)`×8 = 2,3,0,1,1,1,1,5 ; graine 1 `rand(4)`×8 = 1,0,4,3,2,4,3,3 ; graine 1 `rand(9)`×5 = 1,5,4,8,7 ; graine 0 `rand1(4)`×5 = 2,3,2,1,3 ; premier état 0x269EC3 ; premier `rand(14)` = 8 ; `NoRepeatPool(3)`×7 = 2,0,1,1,2,0,1 et `(12)`×13 = 2,3,6,1,7,4,5,8,9,0,10,11,10 (graine 0). L'hypothèse « `14c1(n) = rand(n − 1)` » utilisée par `13af` est cohérente avec ces vecteurs.

## Roster

`Roster` garde les 222 384 octets du fichier `MWRoster` (rien n'est perdu à l'aller-retour) et expose une API typée.

- En-tête (enregistrement 0, gros-boutiste) : version `0x20`, nombre de joueurs, timer du Bowling en ticks (10 800 par défaut ; `bowlingSeconds` / `setBowlingSeconds` n'acceptent que 1 à 999 s, secondes × 60), `clickAndStick`, `ambient`.
- Joueurs : 40 entrées de 37 octets (`utilisé`, `nom[32]`, masque `u32` petit-boutiste). `addPlayer(raw)` → `{ ok, id, name }` ou `{ ok: false, reason: "empty" | "invalid" | "duplicate" | "full" }` ; `removePlayer`, `renamePlayer`, `players()` (ordre alphabétique insensible à la casse : hypothèse, `1080:1ab8` n'a pas été relu), `getPlayer`. Identifiants 1 à 40 (1-based ; 0 = personne dans `RosterState.currentPlayerId`).
- Noms (`common.md` §3.4) : lettres, chiffres, espace, point ; premier caractère lettre ou chiffre ; 28 caractères au plus ; mise en forme à la validation (1re lettre et lettre après une espace en majuscule, pas de rognage) ; doublon par comparaison exacte du nom mis en forme ; nom vide ignoré ; 41e joueur refusé. `canAppendNameChar(current, c, fitsWidth?)` sert la saisie caractère par caractère ; la règle de largeur (< 110 px en `NCSclB10`) se branche par `fitsWidth`, fournie par la couche graphique. Ces règles excluent les accents : une saisie plus large est une décision de la vague H.
- Masque et rang : `achievementBit(op, niveau) = 5 × op + niveau` (op 0 à 5, niveau 0 à 4, 4 = bonus), `hasAchievement`, `setAchievement`, `grade(id) = 1 + bits de niveau 0 à 3` (1 à 25, bonus exclu).
- Variables de scènes : `ROSTER_FIELDS` (décalage, type, nombre) pour les 17 variables d'`engine.md` §7.1, contiguës de 0 à 5422 ; `getVar(id, nom, index)`, `setVar`, `bytesOf` (vue sur les tableaux d'octets : vitrail de Pattern Windows, compteurs du Rhythm Shop), `resetVars`. Valeur par défaut 0 (enregistrement vide du modèle livré ; création d'un joueur : tout à zéro).
- Écart : `removePlayer` efface aussi le nom, le masque et les variables (l'original ne vide que l'octet « utilisé » ; sans effet observable, ces données étant écrasées à la création suivante).
- Persistance (`RosterStore`) : clé `retrovibe:mathemagique:roster`, valeur = le fichier entier en base64 (environ 297 000 caractères). `load()` → `{ roster, status: "ok" | "missing" | "invalid" }` ; un contenu illisible donne un roster neuf **sans écraser le stockage** tant qu'on n'appelle pas `save()` (que dire au joueur : décision de la vague H). `RosterState` (`ctx.roster`) porte le roster, le joueur courant et `save()`.

À écrire aux mêmes moments que l'original : en-tête à la fermeture du moniteur et à chaque niveau réussi, variables du joueur à la sortie des activités, à la création d'un joueur et à la fin de l'accueil du hub (`common.md` §3.5). L'original ne semble rien écrire sur le chemin de sortie (Ctrl+Q) : les scènes devront sauvegarder avant `host.exit()` si l'on corrige ce défaut (à décider ; défauts reproduits par défaut).

Piste d'optimisation si 300 Ko écrits à chaque niveau réussi gênent : ne stocker que les enregistrements utilisés. Non faite : le format suit la consigne (fichier entier en base64).

## Tester sans navigateur

`test/mathemagique/engine-test-host.ts` : `TestHost` (temps simulé `time`, `unix`, `input` avec raccourcis `click(x, y, button)` et `press(code, mods)`, `audio` factice `FakeAudio` qui enregistre les WAVE et les messages MIDI et simule la lecture, `storage` en mémoire, `frames` capturées, `cursors`, `exited`, `loaded`). `loadFile` lit d'abord `virtualFiles` (fichiers synthétiques), puis `original/mathemagique/` sur disque.

```ts
const host = new TestHost();
const engine = new Engine(host, { seed: 0 });
engine.register(SceneId.title, () => new MaScene());
engine.start();
await runFor(engine, host, 1000);                          // images à 60 Hz ; attend les chargements
await runUntil(engine, host, () => engine.scenes.currentId === SceneId.hub);
```

Pour un chargement qui ne se règle que sur commande, piloter `engine.frame(...)` à la main et attendre `engine.whenLoaded` (voir le test « load asynchrone »).

## Dette et points ouverts

- Le moteur (`Host`, horloge, scènes, pause sur onglet caché) est dupliqué entre Téléportaschtroumpf, Lost in Time et ce jeu ; une version commune demanderait de refactorer les deux autres (hors périmètre, déjà noté dans `plan.md`).
- Ctrl+V (boîte « À propos ») : pas implémenté ici (il faut le rendu de texte) ; à brancher en vague G/H via `addKeyHandler("after", …)`.
- Durée réelle du timer du Bowling : voir « Temps ».
