# Aide de Poly et noyau des puzzles (tâche G3)

Code partagé par Hidden Picture Puzzles, Puzzle Patterns et Super Sticklers (et par l'aide de Bowling, Pattern Windows et Rockets pour Poly). Tout est sous `src/games/mathemagique/game/` ; tests : `test/mathemagique/game-kit.test.ts` (les parties qui lisent les vrais `.DAT` sont ignorées sans `original/mathemagique/`). Comportement d'origine : [screens/hidden.md](screens/hidden.md), [screens/patterns.md](screens/patterns.md), [screens/sticklers.md](screens/sticklers.md) ; services utilisés : [engine-ts.md](engine-ts.md) « Services (G1) », [graphics.md](graphics.md). Aucune copy visible : tout est audio (voix de Poly) ou dessin.

| Fichier | Rôle |
|---|---|
| `puzz.ts` | Trois analyseurs `PUZZ` typés et les formules d'identifiants. Pur. |
| `puzzle-kit.ts` | Règles communes (rectangles, niveaux, menu 3×9, rotation, tolérances, adaptateur de pièce portée) et un plateau par activité (`HiddenBoard`, `PatternsBoard`, `SticklersBoard`). Pur, sauf `attachBoard`. |
| `poly-config.ts` | Tables d'aide de Poly par activité (ids `\0SCR`, encadrement, répliques, drapeaux du roster). Données pures. |
| `poly.ts` | `PolyHelper` (machine d'états pure), ports réels (`createScrPolyPorts`), `rosterIntroFlag`, ouverture / libération de l'archive. |

## `puzz.ts`

Le tag `PUZZ` est partagé, pas la structure.

- `parseHiddenPuzz(bytes)` → `{ pieces: [{ cells: {x, y}[] }] }` : `u8 n`, puis `n` × 15 octets (`k`, 7 × `(a, b)`) ; seules les `k` premières cellules comptent (le résidu `01` de 1001 est ignoré). `hiddenPuzzId(niveau, tirage) = 1000 + 32·niveau + tirage`, `hiddenPhotoShplId = 5070 + 9·niveau + k`, `hiddenRewardId = 5100 + 900·niveau + 100·k`, `hiddenMenuShplId = 7800 + 10·niveau`.
- `parsePatternsPuzz(bytes)` → `{ orient[8], col[8], row[8] }` (8 octets puis 8 × `u16` gros-boutistes ×2). `patternsPuzzId = 6600 + 450·L + 50·k`, `patternsRewardId = 20000 + 900·L + 100·k`, `patternsThumbsShplId = 6520 + 10·L`.
- `parseSticklersPuzz(bytes)` → `{ count, templateX, templateY, pieces: [{ orientations: 1|2|4, x, y }] }` (`8 + 6 n` octets). `puzzId = 2100 + 900·L + 100·k`, `rewardId = 8000 + 50·(9·L + k)`, `sticklersMenuShplId = 2020 + 10·L`, `firstShapeIndex(niveau)` (1, ou 2 au rouge), `shapeBases(puzz, niveau)` (cumul des orientations), `expectedShapeCount` (= nombre de formes de la `SHPL`, vérifié sur les 27).

`niveau` = 0 vert, 1 orange, 2 rouge ; `k` = vignette 0 à 8, ligne par ligne. Les formules lèvent `RangeError` hors plage.

## `puzzle-kit.ts`

### Commun

- `Edges` `(gauche, haut, droite, bas)` semi-ouverts comme les `RECT` de l'original : `edgesIntersect` (`10b0:07f1`), `edgesContain` (`PtInRect`), `cornersInside` (`1018:00ae` : les deux coins), `inflate`, `offsetEdges`, `edgesToRect` (vers le `Rect {x, y, w, h}` du moteur).
- `pushOutOfBand(rect, bande)` : poussée hors d'une bande interdite par le côté de plus faible pénétration, vers la droite si `droite_bande − gauche` est **strictement** plus petit que `bas − haut_bande`, sinon vers le haut (égalité : haut). Même règle pour la bande du bas de la télé de Hidden `(0,304,298,432)`, le cartouche de Patterns `(0,354,351,432)` et le bandeau des boutons de Sticklers `(37,282,293,368)`.
- `nextRotation(r, a) = (r + 1) & (a − 1)` (quart de tour horaire ; 4 pour Hidden et Patterns, 1/2/4 pour Sticklers), `withinTolerance` / `snapToTarget` (bornes **incluses**), `snapAxis(g, origine, c)` (formule de grille de Hidden).
- Menu : `PuzzleSession` (niveau non sauvegardé, `pressLevel` renvoie « redessiner le menu » : puzzle affiché **ou** niveau différent ; `select`, `markSolved`, `reset`, `piecesEnabled` / `replayEnabled` = groupes pièces / télé), `THUMB_LAYOUTS` (Hidden `(59+78c, 56+78r)`, Patterns `(84+78c, 82+78r)`, Sticklers `{50,130,210} × {38,118,198}`), `thumbRect`, `thumbAt`, `thumbHoverFrame` (cadre de survol agrandi de 4 px).
- Pièce portée : chaque plateau implémente `CarriableBoard<T>` (`pickAt`, `lift`, `moveTo`, `drop`) ; `attachBoard(pointer, board, hooks)` branche `pointer.source` / `pointer.listener` : prise → `lift` + `hooks.picked` (la scène joue 5012 / 6512 / 2012), suivi → `moveTo` + `hooks.moved`, dépose → `moveTo` + `drop` + `hooks.dropped(piece, { placed, complete })` (son 5013 / 6513 / 2013 en cliquer-poser, test de fin, redessin). Le mode cliquer-poser / glisser vient du roster (`PointerService`). Renvoie une fonction de détachement. Les trois plateaux ont aussi `rotateLast(held)` (Espace / Rotate, `null` si la pièce est tenue) ; **les gardes sont à la scène** : Poly à l'écran (`poly.active`), pièces désactivées (`!session.piecesEnabled`), son 5005 / 6506 / 2005.

### Hidden (`HiddenBoard`, `scatterHidden`, `snapCorner`…)

- Cellule `240 / (niveau + 4)` = 60, 48, 40 px. Pièce : `cells`, `w`, `h` (cellules), centre `(cx, cy)`, `placed` ; rectangle englobant `gauche = cx − ⌊L·c/2⌋` (`1030:0e9d`). Tableau dans l'**ordre d'empilement** (indice 0 = dessus = dernière prise).
- `rotateHiddenCells` : `(a, b) → (H − 1 − b, a)` puis `w ↔ h` (`1030:16b9`) ; le centre est conservé puis ramené dans l'écran (`clampHiddenCenter`). Les côtés et coins de bordure (`SHPL` 5030) ne sont pas stockés : la scène les **recalcule** (hidden.md §2.4).
- `snapCorner(left, top, c)` = `54 + c·⌊(left − 54 + c/2 + 1)/c⌋ − 1` (y : origine 51) : la grille réelle commence en **(53, 50)**. `trySnapHidden` (`1030:0be7`) : les deux coins du rectangle dans la télé élargie de 15 px `(39,36,307,304)` **et** aucune cellule de la position alignée ne coupe une cellule d'une autre pièce (posée ou non ; la pièce portée, rang 0, n'est jamais un obstacle).
- `lift(piece)` (`08d1`) : en tête du tableau, désaimantée, puis les **autres pièces non posées** sont retestées de `n − 1` à 1. `drop()` (`0b59`) : poussée hors de la bande du bas (test **aux cellules**), aimantation, test de fin. `rotateLast(held)` : reprise, rotation, recentrage, redépose (la pièce peut s'aimanter en tournant).
- `scatterHidden(pieces, niveau, rng)` (`0c67`, aussi Reset), de `n − 1` à 0 : `rand1(4)` quarts de tour, un de plus si la largeur en pixels dépasse la pile (212), jusqu'à 10 centres `(gauche + rand1(l), haut + rand1(h))` dans la pile `(332,35,544,398)` rétrécie d'une demi-pièce + 1, **premier** de score minimal (pièces déjà placées recouvertes), arrêt dès 0.
- `HiddenSelection` : un `NoRepeatPool(9)` par niveau (tirage du découpage `13af`, non sauvegardé), `draw(niveau, rng)` → `{ draw, puzzId }` ; Reset ne retire pas de nouveau tirage. `hiddenEndJingle(rng) = 5020 + rand1(4)`.
- Prise : rectangle englobant **puis cellule** (`pickAt`).

### Patterns (`PatternsBoard`, `dealPatterns`, `trySnap`…)

- `pieceRect(cx, cy, w, h)` : `61×121` / `121×61`, `gauche = cx − ⌊(60w + 1)/2⌋`. Pièce : `id`, `placed`, `rot` 0-3, `col`/`row` (−1 si libre), `w`/`h`, centre.
- `trySnap(piece, rangs)` (`0d02`) : deux coins dans `(58,56,338,336)` (grille + 20 px) ; décalage de centre `30 − ((gauche − 78 + 30) mod 60)` (idem y, origine 76) ; rectangle décalé rétréci de 1 px à droite et en bas sans coupe avec les autres pièces de rang ≥ 1 (elles aussi rétrécies, posées ou libres ; rang 0 jamais testé) ; renvoie `{ cx, cy, col, row }`. Pas de test de « bonne case ».
- `pushOutOfToolbar(rect)` ; `rotatePatternsPiece` (`w ↔ h`, `rot + 1`), `clampPatternsCenter` (pièce entièrement à l'écran).
- `dealPatterns(puzzle, rng)` (`0d83`), **non uniforme comme l'original** : 8 échanges `a[i] ↔ a[rand1(8)]` (Fisher-Yates faussé), puis slots 7 → 0 (slot 0 au premier plan) : centre `(513 − 29·(s mod 4), [315,156][⌊s/4⌋] − 17·(s mod 4))`, `rot = orient`, 1×2, puis un `rand1(2)` par pièce pour `rot += 2`. Le tableau est dans l'ordre des rangs (indice 0 = dessus).
- `patternsSolved` : toutes posées **à la case de leur identifiant** avec `rot = 0` (deux pièces d'aspect identique ne sont pas interchangeables). `patternsEndVoice(rng) = 6520 + rand1(4)`.
- Prise : rectangle englobant (pas de pixel), le **centre** suit le curseur (`grab: "center"`).

### Sticklers (`SticklersBoard`, `scatterSticklers`, `snapTarget`…)

- `makeStickPieces(puzz, niveau, sizeOf)` : `sizeOf(indice 0-based dans la SHPL)` est fourni par l'appelant (`archive.shap(shpl.firstShapeId + i)`) ; cible = `(x + ⌊w₀/2⌋, y + ⌊h₀/2⌋)` de la forme d'orientation 0 (un Reset ne la décale plus). Forme courante = `shapeBase + rotation`.
- `scatterSticklers` (`0cf8`), dans l'ordre du `PUZZ` : `rand1(4)` rotations, une de plus si `w > 280`, zone `(295,2,575,379)` rétrécie de `w/2 + 1` / `h/2 + 1`, **20 candidats** au plus (premier de score minimal, arrêt à 0), niveau rouge : candidat coupant la miniature `(295,25,395,125)` rejeté sans compter (garde-fou de 2000 tirages, absent de l'original).
- `snapTarget` (`0b83` → `0c36`) : non collé, orientation 0, les deux coins dans `(17,6,313,302)`, centre à ≤ 10 px **inclus** en x et en y de la cible → recentré exactement. `drop()` : poussée hors du bandeau des boutons, collage, test de fin. La prise (`pickAt`) utilise le test fourni à `SticklersBoard` (la scène passe le test **au pixel** du masque, `hitShapeAt`) ; l'hystérésis de 20 px de `1048:1119` reste à la scène.

## Poly

### Configuration (`poly-config.ts`)

Une `PolyConfig` par activité (`POLY_CONFIGS`) : archive, décalage `y`, variable du roster, arrivée, présentations longue / courte, couches d'encadrement, minuterie (300 ticks), zone de fond sauvegardée, zone cliquable de Poly, **sujets** (clé de zone → `\0SCR`), sortie. `polyScriptIds(config)` liste tous les ids (contrôlés contre les archives par les tests).

`POLLY.DAT` (113 `\0SCR`) est organisé en familles de mêmes décalages : `+0` arrivée, `+50` départ, `+100` grande présentation, `+150` / `+200` encadrement avant / après, `+250` courte, `+500 … +850` explications (Exit, Help, niveaux, pièces ou fragments, Reset, Rotate, télé ou chevalet), répliques de sortie à part (par 50).

| Activité | Famille | Présentation (1re / suivantes) | Répliques | Source |
|---|---|---|---|---|
| Hidden | 25000 | 25100 / 25250 | 27000 + 50·rand(12) | hidden.md §3.7 |
| Patterns | 35000 | 35100 / 35250 | 37000 + 50·rand(13) | patterns.md §3.8 |
| Sticklers | 30000 | 30100 / 30250 | 32000 + 50·rand(13) | sticklers.md §5.4 |
| Bowling (déduit) | 20000 | 20100 / 20250 | 22000 + 50·rand(13) | bowling.md §4.3 (ids non confirmés) |
| Pattern Windows (`PATFILL.DAT`) | 1200… | 1700 / 1500 | 11 ids sans remise `{1900, 2500…3400}`, compliment 1800 | pattern-windows.md §1.7, §3.3 |
| Rockets (`NIM.DAT`) | 2000… | 1100 / 4500 | mode Poly 4300 puis 4400 ; ami {2200, 2300, 2400} puis 9700 | rockets.md §1.8 |

Clés de zone des trois puzzles : `exit`, `help`, `level` (les 3 visages), `piece` (pièce ou fragment), `reset`, `rotate`, `screen` (télé / chevalet : Hidden 25850 menu / 25650 jeu, Patterns 35850 / 35700, Sticklers 30850 / 30550) et `POLY_ZONE` (`"poly"`) pour Poly. Encadrement : avant (`+150`) sauf Exit et pièce, après (`+200`) sauf Exit et Help (exceptions lues dans sticklers.md §5.4, **appliquées par hypothèse** à Hidden et Patterns, dont les fiches disent « sauf cas particuliers » sans les détailler). Pattern Windows : l'entrée en matière `2300` précède tout sauf Help et Exit. Rockets : pas d'encadrement, chaînes « puis ». Bowling : 13 sujets `subject1…13` = 20500…21100, **ordre inconnu**.

Variables du roster : `hiddenPolyIntroSeen`, `patternsPolyIntroSeen`, `sticklersPolyIntroSeen`, `bowlingPolyIntroSeen`, `patfillPolyIntroSeen`, `rocketsHelpIntroSeen`. Rhythm Shop (`RSHELP.DAT`, drapeau `rhythmHelpSeen`) n'est pas couvert (fiche rhythm.md §153 : même principe, ids non repris ici).

### `PolyHelper` (`poly.ts`)

```
new PolyHelper(config, { ports, rng, introFlag, onFirstIntro?, onClosed? })
open(ctx?) · click(zone, ctx?) · hover(zone | null) · tick() · abort()
phase · active · firstIntroThisVisit · currentScr · idleArmed · played
```

Phases : `closed → arriving → intro → listening ⇄ explaining`, `leaving → closed`. Règles :

1. `open()` (bouton Help) : `ports.begin()` (fond sauvegardé), arrivée (non interruptible ; sautée si `ctx.polyPresent`, Rockets), puis grande présentation la 1re fois (le drapeau est posé **tout de suite**, `onFirstIntro` permet à Rockets d'enregistrer le roster ; les puzzles enregistrent à la sortie de scène si `firstIntroThisVisit`) ou courte ensuite.
2. `click(zone, ctx)` : renvoie vrai si le clic est consommé (l'aide capte tous les clics). Pendant une animation interruptible il l'**interrompt** et abandonne la suite de la séquence (« puis » seulement si la précédente est allée au bout) ; sur une non interruptible (arrivée, départ) il est avalé. À l'écoute : explication (`avant`, sujet, enchaînements, `après`) ou sortie (clic sur Poly) : réplique puis départ (non interruptible, joué même si la réplique est coupée), puis `onClosed` (la scène relance la musique, ré-installe ses groupes).
3. `hover(zone)` : « ? » (`ports.setHelpHover`) sur les éléments qui ont une explication, pas sur Poly ; désarme la minuterie.
4. `tick()` : suit l'animation, enchaîne, et si la courte a été jouée, rejoue **une fois** la longue après 300 ticks sans survol ni clic. Les ids des animations jouées sont journalisés dans `played`.
5. `active` = Poly à l'écran (`DS:32c2 ≠ 0`) : la scène ignore Espace / Rotate et ne consomme pas la touche.

Tirage des répliques : plain `rand1` pour les puzzles (les fiches ne parlent pas de tirage sans remise), `NoRepeatPool` pour Pattern Windows (`13af(0, 11, 20d0)`, historique conservé par l'instance du helper : le garder pour la durée de la scène). Le compliment de Pattern Windows suppose `ctx.variedImage` et `rng.range(0, 100) < 20`.

`createScrPolyPorts({ config, scr, archive, surface, cursor?, onDirty? })` : chaque script en mode **bloquant** (gadgets et pointeur gelés, un clic interrompt si le drapeau 8 est posé), drapeaux `saveBackground | keepMidi | waitSounds`, canal `voice`, `offsetY` de la config ; `begin` / `end` sauvegardent et rétablissent `config.backgroundZone` ; curseur « ? » via `pointer.cursor`. Scène : `await openPolyArchive(ctx.resources, config)` dans `load`, `releasePolyArchive` à la sortie, `rosterIntroFlag(ctx.roster, config.introFlag)`, `poly.tick()` à chaque tick, `poly.abort()` + `services.endScene()` dans `leave`.

## Écarts et contradictions

- **`snapCorner`** : la fiche hidden.md §8 donne `c = 60`, 83 → 53 ; son §1.5 et la **décompilation** (`1030:1779` : `(cx + c/2) − ((gauche − 54 + c/2 + 1) mod c)`) donnent 82 → 53 et **83 → 113** (seuil à `c/2 − 1`). Le code suit la décompilation (54 → 53, 84 → 113 valent dans les deux lectures).
- **Décalage +40 en y** : il vaut pour `NIM.DAT` (Rockets, `1070:1e05`, zones à `bas = 391` → 431), pas pour `POLLY.DAT` ni `PATFILL.DAT` dont les zones sont déjà en coordonnées écran (`bas = 432`). `offsetY = 0` pour les puzzles, Bowling et Pattern Windows ; 40 pour Rockets (le test compare les zones des archives).
- **Ids de Poly** (engine.md §8.2 les disait contradictoires) : suivis par fiche, tous présents dans `POLLY.DAT` ; les `20100` / `20250` d'engine.md pour Sticklers ne sont confirmés par rien (30100 / 30250). La famille 20000 est celle de **Bowling** (déduit). `SCR 35900` existe dans `POLLY.DAT` sans emploi documenté (non repris).
- **Statistiques de Sticklers** (sticklers.md §2.1) : 8 fragments pour 11 puzzles (pas 12), 10 fragments pour 4 puzzles (pas 3) ; la somme (27) est juste.
- Tirage des répliques : le brief évoquait `NoRepeatPool` ; les fiches des puzzles décrivent `rand(n)` simple, seul Pattern Windows utilise `13af`.
- Arrivée de Patterns : non citée par la fiche, 35000 par analogie (existe dans l'archive, même zone de bas d'écran).

## Hypothèses et points ouverts

- Arguments des `rand` de la dispersion de Hidden (perdus par le décompilateur) : `rand1(4)`, `rand1(largeur)`, `rand1(hauteur)` ; sens de l'ordre des arguments de `InsetRect` déduit de la cohérence (dx = largeur de la pièce). Ordre de reteste des pièces flottantes de Hidden : de `n − 1` à 1 (comme Patterns).
- Zone de jeu des pièces de Patterns (`DS:8bce`) : l'écran entier ; la pièce reste entièrement visible.
- Exceptions d'encadrement de Hidden et Patterns (voir plus haut), flags des descripteurs de Poly dans `POLLY.DAT` (ceux de Pattern Windows `0x13` + interruptible repris), enchaînement exact « avant / principal / après » (séquentiel ici, comme les « puis » de Rockets et Pattern Windows).
- Bowling : ids et ordre des sujets non relevés ; Rhythm Shop non couvert.
- Rendu : les animations de Poly s'empilent sur le fond sauvegardé à l'ouverture ; à vérifier dans le navigateur (vague H) qu'aucune trace de la pose précédente ne reste entre deux scripts.
- Dette : le test de prise « au pixel avec hystérésis de 20 px » de Sticklers et le dessin des bordures de Hidden restent à écrire dans les scènes.
