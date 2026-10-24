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

## Services (G1)

Couches utilisées par tous les écrans, sous `src/games/mathemagique/engine/` : `sound.ts`, `scr-player.ts`, `gadgets.ts`, `pointer.ts`, `services.ts`. Tests : `test/mathemagique/engine-services.test.ts` (scripts et archives synthétiques, plus les vraies données quand elles sont présentes). Tout est piloté par le tick du moteur : aucun minuteur, aucun `await` dans un tick.

### Mise en place (`services.ts`)

`installServices(engine)` (une fois, avant `engine.start()`) crée la surface de jeu et la palette (`GRAPHICS.screen`, `GRAPHICS.palette`), branche `engine.setFrameSource`, enregistre les cinq services (`GRAPHICS`, `SOUND`, `SCR_PLAYER`, `GADGETS`, `POINTER`) et ajoute **un crochet de tick** puis un gestionnaire de touche `before`. Il rend aussi `MathServices` (`graphics`, `sound`, `scr`, `gadgets`, `pointer`, `useArchive`, `endScene`).

Ordre du crochet : palette (`tick`, présentation si l'affichage change) → séquenceur MIDI → lecteur de scripts → entrées → gadgets (clignotements, dessin). Entrées : pour chaque événement bouton de `input.buttonEvents`, dans l'ordre, le **pointeur d'abord** (il capte tout pendant qu'une pièce est portée), sinon les gadgets ; puis suivi de la pièce et du survol. Pendant une animation **bloquante** (`scr.blockedThisTick`) ni gadgets ni pointeur ne traitent leurs événements (comme la boucle `1090:111c`, qui n'appelle pas `10a0:001b`) ; Tab / Entrée sont gelés de même.

Contrat des scènes : dans `enter`, `services.useArchive(archive)` (formes et sons des gadgets), création des groupes, `gadgets.captureBackground(screen)` après avoir peint le décor ; dans `leave`, **`services.endScene()`** (animations arrêtées sans rappel, gadgets vidés, pièce portée abandonnée, curseur remis à la flèche, cycles de palette arrêtés, sons coupés ; `{ keepMusic: true }` garde la musique). Le moteur n'offre pas de crochet de sortie de scène avant `enter` : sans cet appel, les animations et gadgets de l'ancienne scène survivent.

### Son (`sound.ts`, `SOUND`)

`SoundService(audio, { ambientEnabled, midiInit })` sur `AudioSink` et `MidiPlayer`.

- `playSound(archive, id, options)` joue un `\0SND` **sans en connaître le type** (WAVE ou MIDI, détecté à l'en-tête, comme `1088:1498`) ; `playWave` / `playMusic` si on le sait. Retourne un `SoundHandle` (ou `null` si un son `ambient` est demandé alors que « Ambient Sounds » est coupé).
- Canaux : `effect` (plusieurs en parallèle) et `voice` (une seule, la nouvelle remplace l'ancienne : Poly, Gus). `stopVoice`, `stopAll` (WAVE), `stopMusic`, `stopAmbient` (coupe ce qui est marqué `ambient` quand la préférence est décochée), `isPlaying(handle)`, `anyPlaying`, `voicePlaying`, `musicPlaying`, `releaseAll`.
- `preload(archive, ids)` / `preloadSndl(archive, sndlId)` convertissent les WAVE à l'avance (cache par archive de `pcm.ts`) et rendent un `PreloadSet` à `release()` ; les MIDI et les ids absents sont ignorés.
- MIDI : une musique à la fois, `loop` entre `setup end` / `loop start` et `loop end` ; `loadMidiMap(archive)` lit `SYSX` 1 de `MIDIMAP.DAT` (G2 l'appelle une fois, l'archive est à ouvrir). `tick()` avance le séquenceur (fait par `installServices`).
- « Ambient Sounds » : la préférence du roster (`roster.ambient`) est relue à chaque demande ; l'option `ambient: true` d'un son ou d'une musique de fond (MIDI 100, 2000–2003, 201, MIDI 65000 du hub, bavardages) le soumet à cette préférence.

### Lecteur de scripts (`scr-player.ts`, `SCR_PLAYER`)

`player.start(archive, scrId, options)` → `AnimationHandle` ; `player.tick(input)` (fait par `installServices`) ; plusieurs animations à la fois.

Options : `flags` (descripteur, `SCR_FLAG`), `offsetX` / `offsetY` (translation de la zone **et** des cellules : +40 en `y` pour les scripts de Poly), `clipOverride` (zone de remplacement, avant décalage : lancement des fusées de NIM), `shplOverride` / `sndlOverride` (sinon `resolveScrResources` : SHPL de même id ou la plus proche en dessous, SNDL de la dizaine pour le Bowling), `z`, `loop`, `blocking`, `soundChannel` (`voice` pour Poly et Gus), `ambientSounds`, `onHook(hook, arg, anim)`, `onEnd(anim)`, `deferFirstStep`.

Poignée : `state` (`running` / `done` / `interrupted`), `done`, `time`, `frameIndex`, `logicalIndex`, `duration`, `clip`, `step()`, `interrupt()`, `fastForward(logical?)`, `rewind(runFirstStep?)`, `whenEnded(cb)`.

**Chronologie** (vérifiée sur `MAINSCRN` 1000 : 13 images, fin au tick 98, et `BOWLING` 1200 : son 14300 au tick 14). `start` exécute la première étape tout de suite ; le `n`-ième `tick` suivant est le tick `n` du script. Les opcodes de cellule et les hooks s'exécutent dès qu'ils sont atteints ; `frame`, `sound` et `END` attendent la fin de l'image précédente. Une image **présente l'état des cellules à l'instant de l'opcode `frame`** (copie prise à ce moment : les opcodes qui suivent préparent l'image suivante) ; `render` n'a donc aucun effet visible ici. `END` à `time == duration` : l'animation est `done`.

**Dessin** : formes `SHAP` = `firstShapeId + indice − 1` de la SHPL, posées à `(zone.gauche + x, zone.haut + y)` avec le mode `0` (copie) ou `8` (index 0 transparent) selon le quartet bas des drapeaux de cellule (`0` → 0, tout le reste → 8), écrêtées à la zone. Une forme hors de la SHPL (POLLY 35900) est ignorée sans erreur (l'original lève une erreur). La palette de la SHPL n'est pas appliquée (les SHPL d'animation n'en ont pas) : c'est la scène qui charge la sienne.

**Drapeaux du descripteur** : 1 sauvegarde le fond de la zone et le restaure avant chaque image ; 2 ne coupe pas le MIDI (sans lui, une lecture **bloquante** appelle `stopMusic` au départ : hypothèse) ; 4 à l'interruption, avance sans attendre jusqu'à la dernière image (sans sons ni hooks) ; 8 interruptible par clic ou touche (non répétée), **seulement en mode bloquant** ; 16 attend la fin de tous les sons lancés avant de terminer ; 32 restaure le fond à la fin ou à l'interruption. Bit 6 ignoré (rôle non établi). `interrupt()` arrête aussi les sons de l'animation.

**Composition** : quand une animation a changé, le lecteur restaure les fonds sauvegardés dans l'ordre **inverse** du démarrage, puis dessine toutes les animations par `z` croissant (à égalité : ordre de démarrage). Une animation finie sans drapeau 32 laisse sa dernière image sur la surface et n'est plus redessinée : deux animations dont les zones se recouvrent et qui sauvegardent le fond doivent donc finir dans l'ordre inverse du démarrage. Une scène qui repeint le fond appelle ensuite `player.redraw()` (les fonds déjà sauvegardés ne suivent pas).

**Mode bloquant sans `await`** (« jouer jusqu'au bout », `1090:111c`). La scène garde un sous-état :

```ts
enter(ctx) {
  this.opening = scr.playBlocking(archive, 1000, { flags: SCR_FLAG.saveBackground | SCR_FLAG.interruptible },
    () => ctx.scenes.request(SceneId.bowling));      // suite exécutée du tick, à la fin ou à l'interruption
}
tick(ctx) {
  if (this.opening?.state === "running") return;     // état « lecture » : rien d'autre ne tourne
  …
}
```

Pendant la lecture, gadgets et pointeur sont gelés ; un clic ou une touche interrompt si le drapeau 8 est posé (et n'atteint pas les gadgets : le tick suivant les retrouve libres). Hors mode bloquant (animations d'ambiance du hub, quilles du Bowling, Poly), `start` sans `blocking` : la scène continue de tourner et lit `handle.state` quand elle en a besoin.

### Gadgets (`gadgets.ts`, `GADGETS`)

`GadgetManager.addGroup({ records, onActivate(index, record, activation), active, exclusive, activateOn })` (10 groupes au plus, message d'origine « too many graphic button groups »). Enregistrement (`GadgetSpec`) : `rect` (`rectFromEdges(gauche, haut, droite, bas)` pour les tables des fiches, bords `[gauche, droite[`), `shapes` (id `SHAP` par état), `shapeX/Y`, `pressSound` (id ou fonction qui tire), `hidden`, `disabled`, `selected`, `toggle`, `focusable`, `hit` (test au pixel), `blinkPeriod`. `group.record(i)` donne l'enregistrement d'indice 1 à n ; ses drapeaux `hidden` / `disabled` / `selected` sont modifiables à chaud, `group.active` de même (bit 0 des drapeaux de groupe).

- **Ordre de test** : groupes dans l'ordre d'ajout, enregistrements dans l'ordre du groupe, le premier touché gagne ; masqués, désactivés et groupes inactifs sont transparents (le plein écran du hub n'est actif que dans certains états). Hub : groupe 0 = les 14 enregistrements `DS:0c70`, groupe 1 = pupitre, etc.
- **États** : `normal`, `hover` (survol ou focus clavier), `pressed`, `selected`, `disabled` (+ `hidden`). Priorité : désactivé > Entrée clignotant > enfoncé (et souris dessus) > sélectionné > survol / focus > clignotement. Formes avec repli : pressed → selected → hover → normal ; selected → pressed → normal ; hover et disabled → normal. Pas de forme pour `normal` : la forme est cuite dans le décor.
- **Souris** : `updatePointer` suit le survol à chaque tick (pas de `mousemove`) ; `handleButton(event)` traite les événements dans l'ordre. L'appui enfonce, le **relâchement sur le même enregistrement** active (`activateOn: "release"`, défaut ; `"press"` active à l'appui : hypothèse sur l'instant exact, l'original n'est pas tranché) ; un relâchement ailleurs annule ; les trois boutons de souris font la même chose. Son d'appui joué à l'appui via `playSound(soundId)` (configuré par `useArchive`).
- **Clavier** (`handleKey`, gestionnaire `before`) : Tab / Maj+Tab parcourent les enregistrements actifs et focalisables (ordre des groupes, puis des enregistrements ; focus affiché comme survol), Entrée active le **survol, sinon le focus**, et garde l'aspect enfoncé 30 ticks (`KEYBOARD_FLASH_TICKS` ; le rappel part tout de suite : hypothèse). Ctrl / Alt : non consommé.
- `toggle` bascule `selected` à chaque activation (Click & Stick Mouse) ; `exclusive` (opérations du Bowling) sélectionne le touché et désélectionne les autres du groupe.
- **Dessin** : `captureBackground(surface)` après le décor, `draw(surface)` ne redessine que les enregistrements dont l'état a changé (restauration du fond puis forme de l'état) et dit s'il faut présenter ; `invalidate()` après un repeint du décor.
- `HotspotTable.fromEdges([[g, h, d, b], …])` : tables de rectangles simples (survol / aide `DS:1050` du hub, aides « ? » du Rhythm Shop et de Rockets) ; `hit(x, y)` rend l'indice 1-based (0 = aucune). `helpCursorAt(table, x, y, 3)` : `help` à partir de la zone 3 (les zones 1 et 2, Poly, gardent la flèche), sinon `arrow`.

### Pointeur (`pointer.ts`, `POINTER`)

`PointerService` : prise et dépose de pièces. Mode relu à chaque prise : `roster.clickAndStick` → `clickAndStick` (défaut), sinon `drag`.

- La scène donne `pointer.source = { pick(x, y, event) }` (rend `{ item, x, y, width, height, grab? }` ou `null` ; l'ordre « pièce du dessus d'abord » et le test, rectangle englobant, cellule ou pixel, sont les siens : `pickTopmost`, `hitShapeAt`) et `pointer.listener = { onPick, onMove, onDrop }` (la scène joue les sons 5012 / 5013, remonte la pièce, redessine). `pointer.carry(result, button, x, y)` démarre un port sans passer par `source` ; `drop()`, `cancel()`, `reset()`, `bounds` (zone où la pièce reste entièrement, toute la zone de jeu par défaut).
- **Cliquer-poser** : un clic (n'importe quel bouton) sur une pièce la prend ; elle suit la souris sans bouton tenu ; le clic suivant **n'importe où** la dépose ; la pièce portée **capte tous les clics** (les gadgets ne les voient pas). Le relâchement du clic de prise est ignoré.
- **Glisser** : l'appui prend, la pièce suit tant que **ce bouton** est tenu, son relâchement dépose ; un bouton perdu sans événement (perte du focus, `Input.reset`) dépose sur place au tick suivant. Une prise programmatique (`carry`) n'est pas liée au bouton.
- Suivi **par tick** (`Input.mouseX/Y`, jamais sur `mousemove`) ; la pièce garde le décalage de prise (`grab` : `{x, y}`, ou `"center"` pour Puzzle Patterns où le centre suit le curseur), ramenée dans `bounds` (`clampToBounds`). `onMove` seulement si la position change ; à la dépose la pièce est replacée à la position de l'événement.
- Écarts assumés : pendant un port, **tous** les boutons sont pris par le pointeur (même un autre bouton en glisser) ; un appui et un relâchement dans le même tick donnent une prise suivie d'une dépose sur place.
- **Curseurs** : `pointer.cursor` (`CursorController`) : `setBase(kind)` (curseur de la scène, `hidden` pour qui dessine le sien), `setHelpHover(bool)` (mode aide), `hideWhileCarrying` ; il appelle `ctx.setCursor` seulement sur changement ; le moteur impose `busy` pendant un chargement. Bitmaps `CURS` : voir formats.md « CURS » ; `loadCursorImages(milkyway)` + `cssCursor(image, fallback)` pour l'hôte navigateur (G2 : ouvrir `MILKYWAY.DAT` en `persistent` au démarrage, appliquer `busy` / `help` aux `setCursor` correspondants, `arrow` et `hidden` restant CSS).

### Écarts, hypothèses, points ouverts

- Pas de crochet moteur de sortie de scène : `endScene()` est à appeler par chaque scène dans `leave`.
- Le déclenchement des gadgets au relâchement, l'aspect « enfoncé » de 30 ticks et la focalisation affichée comme survol sont des choix (l'original est décrit au niveau des tables de fonctions, pas de la logique visuelle des boutons `10a0:001b`).
- Avance rapide (drapeau 4, `fastForward`) : état de la dernière image dessinée, sans sons ni hooks (le comportement exact de `1090:0432` n'est pas relu).
- Animations qui se recouvrent avec sauvegarde de fond : fin en ordre inverse du démarrage (voir plus haut).
- Rien de visible pour le joueur n'est écrit ici (aucune copy).
