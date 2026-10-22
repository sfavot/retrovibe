# Grand Schtroumpf : S19, S42, S11 et commentaires (E2b-3)

Adresses `segment:offset` de `SMURF.EXE` ; `DS:xxxx` = offset dans DGROUP (adresse Ghidra `0x3xxxx` − `0x36460`). Confiance : **sûr** (code lu), **probable**, **hypothèse**. Code : `scenes/grand-schtroumpf.ts` (fabrique), `scenes/grand-schtroumpf/` (`ingredients.ts` S19, `videos.ts` enchaînement de clips et voix, `commentary.ts` choix des répliques) ; appelant : `scenes/game.ts`.

## S19 : les ingrédients de l'objectif (`1e52:0324`, sûr)

Appelée par `291e:0401` au tout premier tour, après `1e52:0271` (tirage de l'objectif) et le dessin du plateau, sauf si `DS:199E` est levé (`28a3:00ad` lui fait alors forcer 1 joueur, 58 points et tous les ingrédients : mode de mise au point, jamais levé en partie normale). Pas de fond propre : elle dessine sur le plateau du joueur.

1. `s19v001t.voc` (clic gauche : coupe la voix, `1f33:03a7(1)`), pause 1 s (`1f33:00fc(100)`, centièmes).
2. Pour chaque ingrédient demandé `i` (masque `DS:19B8`, ordre 0 à 7) : icône `s01a001s.hy8` sprite `0xF + i` en (`0x50 + 0x12 × rang`, `0xB6`), voix `s19v` n° `2 + DS:1A20[i]`, pause 0,5 s. Tous sauf le dernier ; le dernier : voix n° `10 + DS:1A30[i]`, pause 1 s. `DS:1A20` = 6, 5, 0, 1, 3, 4, 2, 7 ; `DS:1A30` = 7, 6, 1, 2, 4, 5, 3, 0 (lus dans l'EXE). La boucle est un `do … while` : avec un seul ingrédient demandé, il serait dit avec la voix d'énumération (jamais le cas, 2 à 7 ingrédients).
3. `s19v018t.voc`, pause 0,5 s ; `s19v` n° `0x13 + points/10 − 1` (points de l'objectif `DS:19B9`, 10 à 50 : `s19v019..023`) ; à la fin de cette voix : texte « points du joueur / points de l'objectif » (police `s52d001f.pfn`, couleur `0x7E`, 2 chiffres pour l'objectif) en (`0x50 + 0x12 × n`, `0xA7`) et goutte vide (sprite `0x17`) à sa droite, pause 2 s, puis `1f33:0181(1)` (le chrono du tour repart) et `12ec:037c` (page).
4. Les 23 voix `s19v001..023` existent. Voix nommées : le contenu des phrases n'est pas dans l'EXE (hypothèse : 2..9 énumération, 10..17 « et … »).

Port : `IngredientsScene` (`ingredients.ts`) ; le déroulé est calculé par `ingredientsScript` (pur, testé). Avant S19 le bandeau n'a que le portrait (`Board.setGoalHidden`), `Board.redraw` rend l'objectif complet au retour. Le clic coupe la voix en cours (`Space` / clic gauche), pas la pause.

## S42 : vidéos et voix du Grand Schtroumpf

### Habillage `154c:097b(nom)` (sûr)

Joue 4 vidéos à la suite : `s42%c.mux` avec `%c = 'a' + (rand × 5000 / 0x8000) % 5` (a..e), la vidéo `nom`, `s42g.mux`, `s42%c.mux` avec `'h' + …` (h..l, second tirage). Drapeaux `179a:0673` via `154c:07c2` : `0x1040` pour les clips (pas de saut), `0x1c40` pour la vidéo (`0x400` clic, `0x800` Échap : passable). Appelée pour : avertissements de temps, fin du temps (`28a3:0438`) et répliques-vidéos de `26ee:027e`. Port : `ClipSequence` (clips d'habillage non passables, vidéo passable).

### Avertissements de temps (`291e:0401`, sûr ; règles dans `game/rules.ts`)

Après l'annonce du personnage (`26ee:006a(12)` et 0,5 s) et seulement à un tour jouable (`iRam38d04 == 99`) : reste `< 0x12D` (301 s) et drapeau `DS:75DB` pas levé → `s42a034` ou `035` (`0x22 + rand × 2`) ; reste `< 0x259` (601 s) → `s42a031..033` (`0x1f + rand × 3`), le second écrase le premier. Joués via l'habillage ci-dessus. Les drapeaux ne sont jamais remis à zéro par l'original entre deux parties (ils le sont ici : hypothèse conservée de `rules.md`). `game.ts` joue l'événement `announce` à cet endroit.

### Fin du temps (`28a3:00ad` → `28a3:0438`, sûr)

Au retour d'un tour, `elapsed ≥ DS:6EA4` et pas de victoire : `291e:000e`, `291e:125c`, tirage `N = 0x29 + DS:6EA2 + 9 × (rand × 4 / 0x8000)`, `s42a0%d.mux` (41..76) avec l'habillage, puis `21ee:1c92`, fondu `1523:01fa(0x20)`. `game/rules.ts` fait le tirage (événement `over`, `result.video`).

### Voix `s42v` (sûr pour le format, probable pour le contenu)

`15f9:0db1(buf, "s42v", code, 0)` → `s42vNNNt.voc`, jouée jusqu'au bout (clic gauche : coupe, `03a7(1)`). Fichiers présents : 1..5, 11..15, 21..25, 31..35, 41..76, 91..95, 101..108, 111..127, 130..138, 141..163, 182, 183. Le choix voix / vidéo est fait par `291e:0401` : sont des **vidéos** `s42a%03d.mux` les codes 31..35, 41..76, 131..138, 171..175, 181, 193..196 (et 201..204, 211..215 pour `0f17`) ; tout le reste est une voix. Port : `isCommentVideo`, `CommentVoiceScene`. Codes 91..95 et 31..35 en voix : jamais appelés.

## Commentaires d'avancement `26ee:0f17` (sûr)

Appelée au début du tour, **avant** le dessin du plateau, si `tour − DS:28AE > 4`, `tour > 5`, pas de reprise après pause (`cRam38d02`) et le joueur n'est pas en prison ni au siphon (`status` ≠ 2 et ≠ 4). Fondu (`1523:01fa(0x10)`), puis :

- 5 fois sur 6 (`rand × 6 / 0x8000 != 2`) : avancement de chaque joueur = (ingrédients de l'objectif possédés × 100 / (demandés × nombre de joueurs) + points × 100 / points de l'objectif) / 2 ; `meilleur` = le maximum ; `temps` = part du temps écoulé (voir ci-dessous) ;
- `meilleur < temps × 10 / 15` (en retard) : code `0xC9 + rand × 4` (201..204), s'il n'a pas déjà été dit (drapeaux `DS:7682..`, c'est-à-dire le tableau `DS:75B9[code]`) ; sinon `temps < meilleur` (en avance) : code `0xD3 + rand × 5` (211..215), idem ;
- code non nul : `DS:28AE` = tour, vidéo `s42a%d.mux` ; pour 211..215, un clip `s42%c.mux` (`'m' + rand × 6 / 0x8000`, m..r) avant **et** un autre après (`154c:0954`, drapeaux `0x12D08` : clic gauche passe) ; fondu `1523:01fa(0x10)` à la fin.

Port : `Commentary.beforeTurn` / `progressComment`, scène `{ kind: "progress", code }`.

## Répliques `26ee:027e` (partiellement décompilé, relu dans le désassemblage)

Appelée par `291e:0401` après l'annonce du personnage, à un tour jouable ou pour un tour passé (`iRam38d04 == 99 || DS:274E == 2`). `DS:274E` (`bae`) vaut 3 au départ (donnée initiale), 2 quand le joueur vient d'être pris (prison, siphon : `291e:08c7`, `291e:0928`), 3 après. Condition d'appel : `(code de temps hors 31..35) && tour − DS:28B0 > 2 && tour > 4`, ou `bae == 2` ; `DS:28B0 = tour` est **toujours** mis à jour au passage dans le bloc.

> **Constat (probable)** : comme `DS:28B0` est mis à jour à chaque tour jouable, l'écart reste ≤ 1 (≤ 2 après une libération du siphon, qui saute le bloc) : **la réplique du tour normal n'est jamais atteinte** dans l'original ; seules celles des tours passés (prison, siphon) le sont. Le port reproduit la condition telle quelle (test dédié) et garde le code du tour normal (`turnComment(…, false)`), relu et testé, pour le cas où cette lecture serait fausse.

Tirage d'entrée : `rand × bae / 0x8000 == 0` (une chance sur 2 au tour passé, sur 3 sinon), sinon `bae = 3` et rien. `temps` = `secondes × 100 / DS:6EA4` ; l'original calcule `secondes × 100` sur 16 bits (`IMUL AX,AX,0x64`), faux dès 656 s de jeu : **défaut corrigé** dans `elapsedPercent` (décision du 2026-10-22). Le tirage des répliques du tour normal, jamais atteint dans l'original, est en revanche conservé tel quel. Chaque code n'est dit qu'une fois (`DS:75B9[code]`).

**Tour passé** (`bae == 2`) : `0xAB + rand × 5` (171..175, vidéos) ; sinon, si `temps > 50` : `0xB5 + rand × 3` (181 vidéo, 182 et 183 voix) ; sinon `0xC1 + rand × 4` (193..196, vidéos) ; sinon `0x82` (voix 130) ; sinon la vidéo de l'ingrédient demandé que le joueur n'a pas (premier dans l'ordre 0..7 non encore cité, code `0x82 + DS:27A2[k]`, 131..138 ; `DS:27A2` = 6, 2, 4, 1, 3, 8, 5, 7). Rien sinon.

**Tour normal** (dans l'ordre, le premier qui parle gagne) :

1. (jamais) 21..25 : dépendent de `DS:2761`, `2783`, `2764`, `275E`, `275F`, jamais écrits dans le code : **mort** (probable) ;
2. plusieurs joueurs : `meilleur > temps` et le **dernier** joueur possède au moins un ingrédient (l'original réécrit son drapeau à chaque joueur) → 1 puis 2 ; deux joueurs à plus de 15 et à 5 points d'écart ou moins → 3 ; `temps / 2 ≥ meilleur` → 4 puis 5 ;
3. avancement du joueur `> temps` : 11, 12, puis la voix de son personnage ; `temps / 2 > avancement` : 13, 14, 15, puis la voix « en retard » du personnage. Voix par personnage (tables `CS:26ee:0f0b` / `0eff`) : en avance `0x8D, 0x9C, 0x95, 0xA0, 0x91, 0x98` + `rand × 2` ; en retard `0x8F, 0x9E, 0x97 (une seule), 0xA2, 0x93, 0x9A` (+ `rand × 2`) ; le drapeau est celui du code de base ;
4. plusieurs joueurs et `temps ≥ 30` : un ingrédient demandé que personne n'a (boucle d'origine reproduite : sortie par `k = total` qui dépend du nombre d'ingrédients × joueurs), voix 100 + `DS:2792[k]` (`DS:2792` = 0, 5, 3, 6, 2, 7, 8, 1) ;
5. plusieurs joueurs et `temps × 10 / 15 ≥ meilleur` : 0x6F puis 0x70 ;
6. `temps ≥ 30` : tout le monde à zéro → 0x71 ; sinon, avec `m = ingrédients demandés × joueurs − ceux du joueur` (l'original multiplie par le nombre de joueurs : défaut probable) : `m = 1` → 0x74 / 0x76 / 0x79 / 0x7F, 2 → 0x75 / 0x78 / 0x7E, 3 → 0x77 / 0x7D, 4 → 0x7C puis comme 5, 5 → 0x73 / 0x7B, 6 → 0x72 / 0x7A (table `CS:26ee:0edb`, sauts `0ef3`) ;
7. `temps > 20` : vidéo de l'ingrédient manquant (comme au tour passé) ;
8. `tour > 5` : comme le tour passé (`0xAB…`, `0xB5…`, `0xC1…`, `0x82`).

Les mêmes calculs d'avancement servent à `0f17` et `027e` ; le port ne réutilise pas `Game.progress()` (part exacte, extension) mais reproduit la formule d'origine (`Commentary`).

Port : `Commentary.afterAnnouncement(game, rng, { warned, skipped })`, scène `{ kind: "comment", code }` (voix ou vidéo).

## S11 : victoire (`28a3:0080`, sûr)

Au retour d'un tour, `(DS:19B8 ^ ingrédients) & DS:19B8 == 0` et `DS:19B9 ≤ points` pour le joueur qui vient de jouer : `uRam37496 = 1`, `179a:0673("s11a.mux", 0x12C84)` (65,6 s, **clic gauche** seul passe : `0x400`), puis `21ee:1c92`. Port : `VideoScene` seule, passable aussi à Échap et Espace.

## Retour au menu et options (`28a3:046c`, sûr)

Tous les chemins de fin (victoire, fin du temps, abandon) finissent par `DS:6F36 = 0` et `21ee:1c92` : `c:\smurf.cfg` réécrit (durée, pause, message, heure en minutes). Fin du temps : `1c92` une première fois, fondu `1523:01fa(0x20)`, puis la seconde. Port (`game.ts`, déjà en place) : `lastGameMinutes = ⌊unixSeconds / 60⌋` enregistré, musique coupée, retour au menu S07 (`flow.ts`).

## Écarts à l'original

- Échap passe aussi la victoire et les clips `0f17` (l'original : clic gauche seul) ; Espace aussi.
- Les drapeaux « déjà dit » sont propres à la partie (l'original ne les remet jamais à zéro : probable).
- Une vidéo ne se précharge pas pendant la précédente : un écran noir bref sépare les clips d'un habillage.
- Pas d'avertissement de temps à un tour passé (l'original en tire un, cumulable avec la réplique) : `game/rules.ts` n'en émet qu'à un tour jouable.
- La reprise après pause ne relance pas le début du tour : les conditions `cRam38d02` ne s'appliquent donc pas.
- Contenu des voix et des vidéos non transcrit : aucune copy n'est écrite dans le code.
