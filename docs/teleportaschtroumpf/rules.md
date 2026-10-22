# Règles du plateau du Téléportaschtroumpf (tâche 2.3)

Ce document décrit les règles de la partie reconstituées dans `SMURF.EXE` : mise en place, tour de jeu, plateau, événements, mini-jeux, victoire et fin du temps. Il accompagne le code `src/games/teleportaschtroumpf/game/` (logique pure, sans rendu : `tables.ts`, `board.ts`, `state.ts`, `rules.ts`) et les tests `test/teleportaschtroumpf/rules.test.ts`. Il complète `engine.md` (§1.4 à 1.8, §4.4, §6), dont il corrige quelques points (voir « Corrections » plus bas).

Niveaux de confiance : **sûr** (code lu et cohérent), **probable** (déduction solide non exécutée), **hypothèse** (implémentée telle quelle, marquée `hypothèse` dans le code ou ci-dessous). Les adresses sont `segment:offset` (code, comme `functions.tsv`) ou `DS:xxxx` (données DGROUP). Les globales Ghidra `iRam0003xxxx` valent `DS:(xxxx − 0x36460)`.

## Règles du jeu

### Le but

Le Grand Schtroumpf prépare le téléporteur. Il faut lui rapporter une liste d'**ingrédients** (parmi 8) et un nombre de **gouttes de rosée** (les points). La liste est tirée au hasard au début de la partie ; sa taille et le nombre de gouttes dépendent de la durée de la partie (réglée par les parents : 30, 60, 90 ou 120 minutes) et du nombre de joueurs (1 à 4). Plus il y a de joueurs, plus l'objectif de chacun est petit. Exemple pour 30 minutes : seul, 6 ingrédients et 20 gouttes ; à quatre, 2 ingrédients et 10 gouttes.

Chaque joueur doit réunir l'objectif **lui-même** : le premier qui y parvient gagne (fin gagnante), les autres ne comptent pas. Si le temps est écoulé avant, tout le monde a perdu : le Grand Schtroumpf dit que la partie est finie (le message dépend de l'option « message de fin » des parents). Il n'y a aucun classement dans le jeu original.

### La mise en place

On choisit le nombre de joueurs (1 à 4), puis, pour chaque joueur, un des 6 Schtroumpfs (Costaud, Poète, Grognon, Gourmand, Farceur, Bricoleur ; chacun ne peut être pris qu'une fois) et un niveau de difficulté (0 facile, 1 moyen, 2 difficile ; moyen au départ). Le niveau est transmis aux mini-jeux de ce joueur. Tous les pions partent de la même case : écran 1, rangée haute, tournés vers la droite.

### Le plateau

Le plateau est une rue vue de côté, en 9 écrans. Chaque écran a deux rangées (haute et basse), soit un chemin de 18 tronçons qu'on parcourt à pied : écran 1 haut, écran 1 bas, écran 2 haut, écran 2 bas… jusqu'à l'écran 9 bas. En sortant d'une rangée par la droite on arrive au début de la suivante ; par la gauche, à la fin de la précédente. Sortir par la gauche de l'écran 1 haut ou par la droite de l'écran 9 bas fait jouer une petite vidéo, le tour est perdu et le pion est remis au bord.

Il n'y a **pas de dé** ni de cases comptées : le joueur dirige son pion de la main (marche, course après quelques secondes, saut latéral de 68 pixels) et appuie sur le bouton devant une **porte**. Chaque rangée a jusqu'à trois portes (gauche, centre, droite).

### Le tour

Les joueurs jouent chacun leur tour, à tour de rôle. Un tour se termine quand le joueur entre dans une porte qui lance un mini-jeu, quand il quitte le plateau par un bord, ou quand un piège l'immobilise. À plusieurs, un tour dure au plus 36 secondes : passé ce délai, le jeu appuie à la place du joueur à l'endroit où il se trouve (ce qui peut lancer un mini-jeu ou ne rien faire). Seul, le tour est sans limite ; si le joueur ne fait rien, le Grand Schtroumpf lui donne un indice à 12 s puis à 24 s.

### Les portes

- **Mini-jeux** (S22 à S36, S40, S51) : on y joue, puis le tour passe. Huit d'entre eux donnent un **ingrédient** si on les réussit (S22, S27, S28, S31, S32, S33, S34, S36 : un ingrédient chacun) ; les autres donnent des **gouttes de rosée** (1 à 3 selon la performance, 0 en cas d'échec, jusqu'à 60 gouttes au total).
- **Le Schtroumpf à lunettes** (S38) est un coquin : seul, il vole parfois un ingrédient (ou une goutte s'il n'y a pas d'ingrédient) ; à plusieurs, il prend au mieux placé pour donner au moins bien placé. Sinon, il emmène le joueur devant un jeu au hasard.
- **L'oiseau** (S39) ne donne rien, mais indique un mini-jeu au hasard : la prochaine fois que quiconque y joue, la partie est plus facile (et le jeu « Chez Gargamel » réussit à coup sûr).
- **Le magicien** (S41) échange **3 gouttes de rosée contre un ingrédient** au choix. Il refuse si on a moins de 3 gouttes ; il est fermé si on a déjà les 8 ingrédients.
- **Le puits aux vœux** (S13) n'est ouvert que certains tours (hasard, plus souvent pour qui est en retard). Une fois sur deux (toujours si on a les 8 ingrédients) on y **voyage** : on choisit un lieu sur la carte et le pion s'y rend ; sinon on y **choisit un ingrédient manquant**, donné sans épreuve.

### Les pièges et événements

- **Pièges de Gargamel** (S15) : marcher sur certaines zones renvoie le pion ailleurs sur le plateau (le tour continue).
- **Prison de Gargamel** (S20) : rester sur certaines zones ou y appuyer enferme le joueur : son tour s'arrête et il **passe son tour suivant**, puis il est libéré.
- **Turlusiphon** (S21) : la même chose, déclenchée en marchant ou en appuyant dans certaines zones ; le joueur passe aussi un tour.
- **Pont branlant** (S16) et **lac glacé** (S18) : à la cinquième traversée (comptée pour tous les joueurs), le joueur tombe et réapparaît plus loin.
- **Fusée du Cosmoschtroumpf** (S17) et **puits** (S14) : appuyer au bon endroit envoie le joueur sur un autre écran, au hasard (le tour continue).
- Un saut permet de franchir un piège sans le déclencher.

### La fin de la partie

À la fin de chaque tour, on regarde si le joueur qui vient de jouer a son objectif : si oui il gagne tout de suite (même si le temps vient de s'écouler pendant son mini-jeu). Sinon le tour passe au suivant ; si le temps est écoulé, la partie s'arrête. On peut aussi abandonner (pause, puis écran d'abandon) : un joueur peut partir seul ; quand tout le monde est parti, la partie s'arrête sans vidéo. Dix puis cinq minutes avant la fin, le Grand Schtroumpf prévient.

---

## Détail technique

### 1. Mise en place (S09, S08, `28a3:00ad`)

| Élément | Détail | Preuve | Confiance |
|---|---|---|---|
| Nombre de joueurs | `DS:6E2C` (1 à 4), fixé par S09 `21ee:01d2` avant S08. | `engine.md` §6.2 | sûr |
| Personnage | `+0` de la structure joueur (0..5), choisi parmi 6 icônes libres dans S08 `21ee:0435` ; table `CS:21ee:0c05` : icônes 4..9 → 4, 0, 5, 2, 1, 3. | `21ee:0435` | sûr |
| Nom du personnage | `DS:1058` (6 mots) → numéro `S49_NN` : `[0, 4, 5, 1, 2, 3]` (lu par `1823:0415`). Noms de `S49A.DAT` : 1 Costaud, 2 Gourmand, 3 Farceur, 4 Bricoleur, 5 Poète, 6 Grognon, donc personnage 0 Costaud, 1 Poète, 2 Grognon, 3 Gourmand, 4 Farceur, 5 Bricoleur. | `1823:0415`, `S49A.DAT` | probable (le lien « texte S49 = personnage » est déduit) |
| Niveau | `+2` (`DS:6EB6`), 0..2 par haut/bas dans S08 (icônes `0x11..0x13`, valeur initiale 1). **Ce n'est pas une teinte** (`engine.md` §6.1) : tous les mini-jeux le lisent comme difficulté (`+2` de `199e`, `19a8`, `1bda`, `1c78`, `1ceb`, `1da0`, `1f84`, `23c9`, `24d0`, `2573`, `260f`, `2e6a`, `2ee8`, `2f87`, `1b05`). | grep `0x6eb6` | sûr |
| Structure joueur (20 o, `DS:6EB4 + 0x14 × i`) | `+0` personnage, `+2` niveau, `+4` x, `+6` y (`0x38` haute, `0x84` basse), `+8` écran 1..9, `+A` masque des ingrédients (bit i = ingrédient i), `+C` **nombre d'ingrédients possédés** (incrémenté en même temps que le bit, `1e52:0053` + `INC [+C]`), `+E` points (0..60), `+10` état du pion (0..6), `+12` regard à droite, `+13` regard à gauche. | `28a3:00ad`, `1e52:*`, `291e:0401` | sûr (`+C` : probable, c'est toujours le nombre de bits) |
| Départ | pour les 4 emplacements : écran 1, x = `0x0B`, y = `0x38`, regard droit, ingrédients 0, points 0, état 0 ; joueur courant 0, tour de plateau (`DS:8C74`) 1. | `28a3:00ad` | sûr |
| Objectif | `1e52:0271` : lit `DS:19E0` (64 o) à `16 × (durée/1800 − 1) + 4 × (joueurs − 1)` : `u16` nombre d'ingrédients, `u8` points (→ `DS:19B9`). Les ingrédients (masque `DS:19B8`) sont tirés par `rand × 8 / 0x8000`, puis suivants libres en rotation (`(r+1) % 8`). | `1e52:0271` (désassemblé) | sûr |
| Durée, message, pause | options parents : `DS:6EA4` = `(index+1) × 1800` s, `DS:6EA2` message 0..8, `DS:6EA0` pause (`engine/options.ts`). | `engine.md` §6.3 | sûr |
| Hasard | `BorlandRandom` (`engine/rng.ts`), injecté. | `1000:07a7` | sûr |

Table de l'objectif (`DS:19E0`, ingrédients / points) :

| Durée | 1 joueur | 2 | 3 | 4 |
|---|---|---|---|---|
| 30 min | 6 / 20 | 4 / 10 | 3 / 10 | 2 / 10 |
| 60 min | 7 / 30 | 6 / 20 | 5 / 10 | 4 / 10 |
| 90 min | 7 / 40 | 6 / 20 | 6 / 20 | 5 / 10 |
| 120 min | 7 / 50 | 7 / 30 | 6 / 20 | 6 / 20 |

### 2. Le plateau (S01, `291e:0401`)

**Coordonnées** (sûr). `x` 0..0x13F, `y` = `0x38` (haut) ou `0x84` (bas). Zones de porte (`2813:010b..06b4`) : gauche 7..0x6A, centre 0x6C..0xD3, droite 0xD5..0x13A ; les lignes 0x6B et 0xD4 et les bords (< 7, > 0x13A) n'ont pas de porte (l'original pousse d'abord le pion hors de la ligne, `2813:0886` : `settleX`).

**Mouvement par image** (une image = 4 ticks de 60 Hz, 15 images/s, `1f33:0348(4)`) : marche ±4 px (poses 2/3, `2bd4:0093`), course ±8 px (poses 6/7, après 5 s de marche continue : `slot 6`), **saut** ±0x44 px (poses 4/5 : déclenchées par « haut » + direction ; l'animation ajoute `0x44` à `x` à la fin, `2bd4:02bd` et `2bd4:0093`). Aucune case, aucun dé. Confiance : sûr pour les pas, probable pour l'interprétation « saut ».

**Chemin** (`291e:13f2`, sûr). Quand `x` sort de [1, 0x13E] :

| Sortie | Résultat |
|---|---|
| `x < 1`, rangée haute, écran 1 | sortie à gauche : code **100** (vidéo `s01b`), pion remis à `x = 0x0B`, regard droit |
| `x < 1`, rangée haute, écran > 1 | écran − 1, rangée basse, `x = 0x134` |
| `x < 1`, rangée basse | même écran, rangée haute, `x = 0x134` |
| `x > 0x13E`, rangée haute | même écran, rangée basse, `x = 1` puis marche jusqu'à ≥ 0x0B (`x = 0x0B` ici : probable) |
| `x > 0x13E`, rangée basse, écran < 9 | écran + 1, rangée haute, `x = 0x0B` |
| `x > 0x13E`, rangée basse, écran 9 | sortie à droite : code **101** (vidéo `s01c`), `x = 0x134`, regard gauche |

**Portes** (`2813:000d` → `0037` rangée haute / `00a1` rangée basse ; chaque fonction `2813:xxxx` renvoie un code de scène ou `0xFFFF`) :

| Écran | Haut G / C / D | Bas G / C / D |
|---|---|---|
| 1 | — | 23 / 23 / 29 |
| 2 | 35 / 38 / 14 | 40 / 33 / 25 |
| 3 | 26 / 28 / 24 | 39 / 20 / 21 |
| 4 | 38 / 51 / 14 | 34 / 15 / 18 |
| 5 | 27 / 21 / 38 | 15 / 15 / 20 |
| 6 | 14 / 15 / 30 | 39 / 17 / 21 |
| 7 | 22 / 20 / 38 | 32 / 16 / 31 |
| 8 | 15 / 15 / 15 | 20 / 41 / 38 |
| 9 | 14 / 39 / 39 | 20 / 36 / 36 |

Les codes 22 à 41 (sauf 37) et 51 sont des mini-jeux ; **14, 15 à 21 sont des événements du plateau** (voir §4) ; il n'existe aucune porte 37. Les 18 fonctions sont relues dans le test (constantes `MOV AX, imm`). Sûr.

**Quand le bouton entre-t-il dans la porte ?** `291e:0401` applique, à la fin de la boucle de marche, la table `CS:291e:11f4` (52 mots, un par zone, indice `1536 = (écran − 1) × 6 + zone + (basse ? 3 : 0)`), qui classe chaque zone en 5 cas : **D** porte ordinaire (le tour se termine), **N** pas de porte (le bouton ne fait rien : zones des pièges de marche), **W** porte du puits (seulement si `DS:79D0`, le puits ouvert), **S** (seulement si l'état du pion ≠ 0 : zones de prison/Turlusiphon, gérées par l'événement quand le pion est libre), **F** porte du magicien (inactive si le masque des ingrédients vaut `0xFF`). L'action automatique des 36 s ne passe pas par cette table (`local_9` reste nul quand `DS:79D4`, son drapeau, est levé) : elle entre toujours dans le code de la zone, y compris un code sans mini-jeu, ce qui termine le tour. Sûr pour la structure, probable pour les détails de bord.

**Hors partie** : S45 aide, S46 abandon, S48 pause, S02 carte : codes 200 (reprise) à 203, sans effet sur les règles (voir `engine.md` §1.5).

### 3. Déroulé de la partie (`28a3:00ad`)

```
mise en place (§1) ; DS:8C74 = 1 ; chrono 0 démarré
répéter
  musique aléatoire ; code = tour du joueur courant (291e:0401)
  code 14 → S13 ; 22..36, 38..41, 51 → le mini-jeu ; 100/101 → vidéo s01b/c ; 201 → S46 ; 202 → S02 ; 203 → S45 ; autres → rien
  victoire = (requis & ~ingrédients_joueur == 0) et (points_joueur ≥ DS:19B9)        // joueur courant seulement
  si code < 200 et pas de victoire : joueur suivant (retour à 0 : tour de plateau + 1)
  si victoire → S11 (28a3:0080) ; sinon si temps écoulé (chrono 0 ≥ DS:6EA4) → S42 ; sinon si abandon (S46) → rien
jusqu'à la fin
```

**Début d'un tour** (`291e:0401`, sûr sauf indication) :

1. états du pion : `1 → 3` ; `2 → 1` (tour passé) ; `6 → 5` ; `4 → 6` (tour passé) ; les tests sont successifs, sans enchaînement. Un tour « passé » prend fin dès la première image : zones de classe S (le pion est dans sa cage ou sous le Turlusiphon). États 3 et 5 : libération immédiate (animations S20 `s20c/f/i/l/o` et S21 `s21d/h/j/l`, qui rendent l'état 0 ; pour l'état 5 le pion recule de `0x14` px, vers l'arrière de son regard : `2a78:0272`, `06e5`, `0a59`). **Prison = un tour passé en plus du tour du piège** (états 2 → 1 → 3 → 0) ; Turlusiphon idem (4 → 6 → 5 → 0).
2. puits ouvert ce tour : `2daf:0adc` (voir §5).
3. avertissements du Grand Schtroumpf : avec `reste = DS:6EA4 − chrono 0`, si `reste < 0x12D` (301 s) et pas encore fait : vidéo `s42a034` ou `035` ; si `reste < 0x259` (601 s) et pas encore fait : `s42a031..033` (le second écrase le premier s'ils tombent au même tour). Les drapeaux `DS:75DB` et `DS:75D8` (`cRam3da3b`, `cRam3da38`) ne sont jamais réinitialisés par l'original (ils restent levés d'une partie à l'autre) : ici ils le sont à chaque partie (hypothèse).
4. commentaires du Grand Schtroumpf (`26ee:0f17`, `26ee:027e`, voix `s42v`, vidéos `s42a2xx/s42a211..`) : narration conditionnée par l'avancement (voir `progress()` du code), non reprise ici (le module `rules.ts` n'émet que les avertissements de temps).

**Chrono du tour** (`slot 1`, `1f33:0181(1)`) : indice vocal à 12..22 s (`s01v` n° 1) et à 24..34 s (n° 2) si le joueur n'a utilisé aucune touche de navigation (flèches/bords) depuis le début du tour ; à 36 s (`≥ 0x24`) et à plusieurs joueurs, `DS:79D4` (`cRam3de34`) lève un appui automatique (le bouton réel est `DS:79D7`) ; seul, le chrono est relancé après le 2ᵉ indice. Pendant la pause S48, `1f33:01e6/01bf` gèlent ce chrono. Sûr. Le chrono global (`slot 0`) continue pendant la pause : hypothèse (`engine.md` §8, question 4).

**Fin de tour par le temps** : `uRam3d304 ≤ chrono 0` fait lever la fin de boucle de marche (`de39`) ; `28a3:00ad` termine alors la partie (S42). Les mini-jeux jouent en temps réel (chrono 0 non gelé) : leur gain est appliqué **avant** le contrôle de victoire puis de temps. Sûr.

### 4. Événements du plateau (animations S13 à S21)

Les écrans 2 à 9 ont chacun une routine de dessin `2bd4:084c, 08e8, 0af9, 0cbc, 0e9c, 10da, 12e9, 149c` (dispatch `2bd4:0771`) qui, à chaque image, teste la position du pion et lève un drapeau (`cRam3de3b` + un drapeau propre à l'événement) ; la boucle de `291e:0401` appelle alors `2a78:00da(écran)` qui joue l'animation (`2a78:015f, 0272, 0480, 06e5, 0a59, 0d53, 0f2f, 1244`) et applique l'effet. Quatre déclencheurs, relevés pour chacun dans le code (sûr pour les plages, probable pour les bornes à ±1) :

- **marche** : le pion se trouve dans la plage (une image) ;
- **bouton** : bouton gauche (ou action automatique) dans la plage ; l'appui du Turlusiphon ne répond qu'au bouton ;
- **attente** (`db66`) : le pion est dans la plage et (bouton, action automatique, ou chrono du tour ≥ 16 s) ;
- **compté** (lac, pont) : chaque *entrée* dans la plage incrémente `DS:8D06` (lac) ou `DS:8D08` (pont) ; à la 5ᵉ (> 4) le pion tombe. Les compteurs sont communs à tous les joueurs ; après une chute ils sont remis à `rand × 4 / 0x8000` (0..3). Le compteur initial est 0 (BSS).

| Écran / rangée | Plage de `x` | Déclencheur | Effet | Scène |
|---|---|---|---|---|
| 2 haut | 0xD5..0x13A | bouton | **puits S14** : téléporté sur un écran 1..9 ≠ 2 tiré au hasard (`2a78:015f`), le tour continue | S14 |
| 3 bas | 0x94..0xC4 | attente | **prison** (état 2, pion en `x = 0xAC`) ; le tour s'arrête | S20 |
| 3 bas | 0x100..0x112 (marche) / 0xD5..0x13A (bouton), état 0 | marche, bouton | **Turlusiphon** (état 4, pion en `x = 0x109`) ; le tour s'arrête | S21 |
| 4 haut | 0xD5..0x13A, puits ouvert | bouton | animation S13, pion en `x = 0x116`, puis **fin du tour avec le code 14** (S13 interactif) | S13 |
| 4 bas | 0x95..0xC5 | marche | **piège** → écran 9 haut, `x = 0x10` | S15 |
| 4 bas | 0xF0..0x120 | compté | **lac glacé** → écran 5..9 au hasard | S18 |
| 5 haut | 0x9A..0xAC (marche) / 0x6C..0xD3 (bouton), état 0 | marche, bouton | **Turlusiphon** (`x = 0xA3`) | S21 |
| 5 bas | 0x1E..0x4E | marche | piège → écran 9 bas, `x = 0xD4` | S15 |
| 5 bas | 0x7B..0xAB | marche | piège → écran 8 bas, `x = 0xDE` | S15 |
| 5 bas | 0xEE..0x11E | attente | **prison** (`x = 0x106`) | S20 |
| 6 haut | 7..0x6A, puits ouvert | bouton | animation S13 (`x = 0x41`), code 14 | S13 |
| 6 haut | 0x91..0xC1 | marche | piège → écran 7 bas, `x = 0x10` | S15 |
| 6 bas | 0x97..0xC7 | bouton | **fusée** → écran 1..5 au hasard | S17 |
| 6 bas | 0x100..0x112 / 0xD5..0x13A, état 0 | marche, bouton | **Turlusiphon** (`x = 0x109`) | S21 |
| 7 haut | 0x98..0xC8 | attente | **prison** (`x = 0xB0`) | S20 |
| 7 bas | 0x76..0xA5 | compté | **pont branlant** → écran 8 ou 9 | S16 |
| 8 haut | 0x3A..0x6A | marche | piège → écran 7 haut, `x = 0x10` | S15 |
| 8 haut | 0x85..0xB5 | marche | piège → écran 5 haut, `x = 0x10` | S15 |
| 8 haut | 0xFF..0x12F | marche | piège → écran 3 bas, `x = 0x75` | S15 |
| 8 bas | 0x1C..0x4C | attente | **prison** (`x = 0x34`) | S20 |
| 9 haut | 7..0x6A, puits ouvert | bouton | animation S13 (`x = 0x36`), code 14 | S13 |
| 9 bas | 0x22..0x52 | attente | **prison** (`x = 0x3A`) | S20 |

Arrivée après une chute ou une fusée : `2a78:13c1` (table `CS:2a78:15bd`, un cas par écran d'arrivée) ; rangée basse si `rand × 2 == 0`, puis `x` parmi des valeurs fixes ou `0x10 + rand × 21 / 0x8000` (voir `ARRIVALS`). Sûr.

Les écrans 1 et 2 n'ont pas de prison ni de piège ; l'écran 1 n'a aucun événement. Les animations (`s15a..n`, `s16a/b`, `s17a`, `s18a/b`, `s20a..o`, `s21a..l`) sont du rendu (phase 3).

Les codes de porte 15 à 18, 20, 21 qui ne tombent pas dans une plage d'événement (appui dans la zone mais hors plage) sont sans effet ; l'action automatique de 36 s les traite comme « rien » et termine le tour (probable).

### 5. Mini-jeux, gains, bonus

**Interface**. `28a3:00ad` appelle la fonction d'entrée de la scène **sans paramètre** : un mini-jeu lit les globales : joueur courant `DS:6E2A`, niveau `DS:(joueur × 0x14 + 0x6EB6)`, personnage `+0`, nombre de joueurs `DS:6E2C`, durée restante (chrono 0 et `DS:6EA4`) et l'indice de l'oiseau `DS:6F37`. Il **écrit lui-même** son gain via `1e52:0053(joueur, n)` (+ `INC [+C]`) ou `1e52:00ad(joueur, points)` et n'a **aucun code de retour** utile (valeur ignorée). `Game.resolveMinigame(outcome)` reproduit ces écritures : le mini-jeu TS reçoit un `MinigameRequest` (scène, joueur, personnage, niveau, bonus) et renvoie un `MinigameOutcome`. Sûr.

`1e52:00ad(joueur, delta)` : `points = clamp(points + delta, 0, 60)`, et un petit son par point gagné ; un gain de plus de 2 points a une chance sur 5 de déclencher une réplique du Grand Schtroumpf (`rand × 5 == 0`). Sûr.

| Scène | Fonction | Gain | Appels / preuve | Confiance |
|---|---|---|---|---|
| 22 Dragon | `1c78:0005` | ingrédient 3 si réussi | `1e52:0053(·, 3)` sous `cRam3cd74` | sûr (condition de réussite : probable) |
| 23 Musicien | `24d0:000c` | 1 à 3 points si réussi (0 sinon) | `1e52:00ad` | sûr |
| 24 Puzzle | `2e6a:0001` | 1 à 3 points (tiers du temps) | `1e52:00ad` | sûr |
| 25 Observation | `260f:000e` | 1 à 3 points ; échec : `1e52:00a8` (stub vide) = 0 | idem | sûr |
| 26 Jeu sonore | `1ed0:000b` | 0 à 3 points | idem | probable |
| 27 Luge | `1f84:000e` | ingrédient 2 | `1e52:0053(·, 2)` | sûr |
| 28 Schtroumpfs noirs | `2573:000f` | ingrédient 6 | idem | sûr |
| 29 Anniversaire | `1da0:0009` | 1 à 3 points (score : < 10 → 3, < 20 → 2) | `1da0:07dd` | sûr |
| 30 Pont de la rivière | `2d6b:0008` | 1 à 3 points | idem | sûr |
| 31 Tortues | `2f87:0008` | ingrédient 5 | idem | sûr |
| 32 Chez Gargamel | `199e:000a` | ingrédient 4, **hasard pur** : réussite si `rand × b / 0x8000 == 0`, `b = niveau + 2` (1/2, 1/3, 1/4), `b = 1` avec le bonus | `199e:0018..29` | sûr |
| 33 Formule magique | `1ceb:000c` | ingrédient 7 | idem | sûr |
| 34 Cigogne | `1b05:000b` | ingrédient 0 | idem | sûr |
| 35 Coloriage | `1bda:0021` | 1 à 3 points (selon le temps) | idem | sûr |
| 36 Mine | `23c9:0004` | ingrédient 1 | idem | sûr |
| 38 Schtroumpf à lunettes | `1fc6:0008` | vol et redistribution, voir plus bas | `1fc6:0008..04d7` | sûr pour l'algorithme |
| 39 Oiseau | `265b:000d` | aucun gain ; pose le bonus | `DS:25F5` | sûr |
| 40 Quiz | `2ee8:000d` | 1 point si bonne réponse | `1e52:00ad(·, local_2c[3])` | sûr |
| 41 Magicien | `2143:0009` | échange 3 points contre un ingrédient | `1e52:00ad(·, 0xFFFD)` | sûr |
| 51 Cadeaux | `19a8:0006` | autant de points que de cadeaux (`iRam375e6`, voix : < 2 → 1, < 4 → 2, sinon 3) | `1e52:00ad(·, iRam375e6)` | probable (borne max inconnue) |
| 13 Puits aux vœux | `2daf:0006` | voir ci-dessous | | sûr |

Dans chaque jeu à ingrédient, l'ingrédient n'est ajouté que si le joueur ne l'a pas déjà (`1e52:0034 == 0`) ; une vidéo de fin (`sNNc1`/`c2`) diffère selon que l'ingrédient fait partie de l'objectif (`1e52:0008`).

**Correspondance ingrédient ↔ scène** : `0 → S34, 1 → S36, 2 → S27, 3 → S22, 4 → S32, 5 → S31, 6 → S28, 7 → S33`. Le nom des ingrédients n'est pas dans l'EXE (voix `s19v`, `1e52:0324` : `DS:1a20/1a30`) : hypothèse « 0..7 » conservée.

**Puits aux vœux S13** (`2daf:0006`). `iRam3e0cc` = 0 si le masque vaut `0xFF`, sinon `rand × 2 / 0x8000`. Mode **0 (voyage)** : carte S02 (`1a3c:0003`, fond `s02a007d`), retourne `k` (1 = retour : rien ; 2 à 18 : lieu) ; le pion est placé devant la porte de la scène du lieu (`CS:2daf:0aa8`, 18 entrées : les 17 lieux `k = 2..18`, plus une 18ᵉ entrée, magicien, inaccessible), regard droit. Mode **1 (ingrédient)** : 8 zones cliquables (un ingrédient chacune, table `CS:2daf:0acc` = identité) ; cliquer un ingrédient non possédé le donne et termine ; cliquer un ingrédient possédé joue une réplique ; 36 s sans choix : rien (`slot 2 > 0x23`). Sûr.

**Disponibilité du puits** (`2daf:0adc`, au début de chaque tour, sûr) : seul, `rand × 100 / 0x8000 < 33` ; à plusieurs, d'abord `> 32` (67 %), puis ouvert si les points du joueur sont `< max des points − 5`, sinon `rand × 100 / 0x8000 < 15`.

**Schtroumpf à lunettes S38** (`1fc6:0008`, sûr). Une « promenade » désigne `DI = 9 + rand × 17 / 0x8000` (25 refusé, soit 9..24) : vidéo `DI`, puis le joueur est placé devant l'une des 16 portes (`CS:1fc6:0857/084d/0843/083b`, voir `BESPECTACLED_DESTINATIONS`), regard droit. *Seul* : si ni ingrédient ni point, ou si `rand × 2 ≠ 0` : promenade ; sinon, perte d'un ingrédient possédé tiré au hasard, ou d'un point s'il n'a aucun ingrédient (aucune promenade). *À plusieurs* : `rand × 2 ≠ 0` : promenade ; sinon on prend le premier plus pauvre et le premier plus riche en ingrédients et en points (comparaisons strictes) ; rien à prendre (0 partout) : promenade ; seulement des points : le plus riche donne 1 point au plus pauvre (si tous ont autant, le joueur courant donne 1 point à un autre joueur tiré) ; seulement des ingrédients : le premier ingrédient (0..7) que le plus riche a et que le plus pauvre n'a pas passe de l'un à l'autre (si aucun : promenade) ; les deux : si `⌊max points / 2⌋ ≤ max ingrédients`, ingrédients (à défaut, points), sinon points. Le joueur courant n'est pas forcément concerné par le transfert.

**Oiseau S39** (`265b:000d`) : après une histoire en vidéos, tire `rand × 17 / 0x8000` dans `DS:25F5` (les 17 scènes : 22, 30, 31, 32, 36, 24, 26, 51, 28, 34, 27, 23, 25, 29, 33, 35, 40) et le range dans `DS:6F37` (`iRam3d397`). La prochaine scène dont la fonction compare `DS:6F37` à sa valeur la remet à 0 et se simplifie (niveau forcé à 0 dans S23, S24, S25, S29, S35, S40, S28, S31 ; à 3 dans S27, S33, S34, S36 ; S22 : niveau 0 et `iRam3cd7d = 5` ; S26 : `iRam3d3b6 = 4` ; S30 : `local_3 = 3` ; S32 : réussite certaine ; S51 : `iRam3c7a2 = 2`). **Anomalie** : S36 compare à `0x1B` (la valeur de S27) au lieu de `0x24` : un indice « mine » n'est jamais consommé (hypothèse : bug de l'original, reproduit). Le sens exact de chaque niveau interne reste à vérifier scène par scène (phase 4) : hypothèse « plus facile ».

**Magicien S41** (`2143:0009`, sûr) : si points < 3 ou masque = `0xFF` : vidéos de refus (`s41a1`+`s41c`) si le masque n'est pas plein, sinon rien ; sinon `2143:08a1` pose la question « échanger 3 gouttes de rosée contre un ingrédient ? » (`S49_12T`) ; si non : `s41e` ; si oui : `2143:01cd` : 8 zones cliquables (un ingrédient chacune ; la 9ᵉ, zone 8, est le chapeau), cliquer un ingrédient déjà possédé joue une réplique ; confirmation `2143:070c` ; retourne le choix (9 = temps écoulé). Résultat : choix 0..7 non possédé avec `points > 2` : ingrédient donné, −3 points ; choix 8 : −3 points sans ingrédient (hypothèse : tour de magie raté / le chapeau garde la rosée) ; refus ou temps écoulé : rien.

### 6. Victoire, temps, abandon

- **Victoire** (`28a3:00ad`) : `bVar3 = (DS:19B8 ^ ingrédients_joueur) & DS:19B8` ; si `bVar3 == 0` et `DS:19B9 ≤ points_joueur` : `28a3:0080` (vidéo `s11a.mux`, `0x12C84`) puis `21ee:1c92` (écriture de `c:\smurf.cfg`). Seul le joueur dont le tour vient de finir est examiné. Sûr.
- **Temps écoulé** : `chrono 0 ≥ DS:6EA4` : `291e:000e`, `291e:125c`, vidéo `s42a0N` avec `N = 0x29 + DS:6EA2 + 9 × (rand × 4 / 0x8000)` (41..76), puis `21ee:1c92`. Pas de vainqueur. Sûr.
- **Abandon S46** (`1823:0415`) : quel joueur (ou tous), confirmation S49 ; liste des joueurs compactée (`memcpy` de blocs de 0x14), nombre de joueurs − 1 ; plus personne ou abandon global : la fonction retourne non nul et la partie finit sans vidéo ; retour de 201 : le même joueur (ou le suivant dans l'indice compacté) rejoue sans avancer. Probable pour les retours.
- **Avertissements** : voir §3.
- **Multijoueur** : alternance dans l'ordre de S08 (joueur 0, 1, …) ; le tour de plateau (`DS:8C74`) s'incrémente au retour au joueur 0 ; pas de classement dans l'original. `Game.standings()` (avancement = moyenne des parts d'ingrédients requis et de points, comme `26ee:0f17`) est une extension.

### 7. API TypeScript (`src/games/teleportaschtroumpf/game/`)

- `newGame(setup, rng)` / `Game.create` : `GameSetup = { players: {character, level?}[], options?: ParentOptions }` ; lève `RangeError` si 0 ou plus de 4 joueurs, personnage répété ou invalide, niveau invalide.
- Actions du tour (phase `turn`) : `walk(dir, run?)` (l'appelant choisit la course, après 5 s de marche continue), `jump(dir)`, `press(source?)` ; temps : `tick(seconds)` ; `setPaused`, `abandon(player | "all")`.
- Mini-jeux (phase `minigame`) : événement `minigame` avec `MinigameRequest {scene, player, character, level, bonus, successChance?, wellMode?}`, puis `resolveMinigame(outcome)` (`ingredient` | `points` | `well` | `magician` | `none`). `rollChezGargamel()` tire la réussite de S32.
- Lecture : `state` (JSON pur : `GameState`, `Player`), `player`, `isOver()`, `winner()`, `goalReached(i)`, `progress(i)`, `standings()`, `canTrade(i)`.
- Les méthodes retournent les `GameEvent` produits (`turn`, `skip`, `release`, `moved`, `hazard`, `exit`, `minigame`, `nothing`, `gain`, `lose`, `bespectacled`, `bird`, `announce`, `hint`, `over`) ; `takeEvents()` purge ceux de `create`. `Game.restore(state, rng)` reprend une partie sérialisée.
- Tables (`tables.ts`) : `DOORS`, `DOOR_CLASSES`, `HAZARDS`, `ARRIVALS`, `GOAL_TABLE`, `MINIGAMES`, `SCENE_CODES`, `INGREDIENT_SCENES`, `MAP_LOCATIONS`, `MAP_CELLS`, `WISH_DESTINATIONS`, `BESPECTACLED_DESTINATIONS`, `BIRD_HINT_SCENES`, `CHARACTER_*`. Vérifiées contre l'EXE par le test : `GOAL_TABLE` (`DS:19E0`), `DOORS` (18 fonctions `2813`), `DOOR_CLASSES` (`291e:11f4`), `SCENE_CODES` (`28a3:0474`), `MAP_*` (`DS:15BA`, `DS:1470`), `BIRD_HINT_SCENES` (`DS:25F5`), `CHARACTER_TEXT_INDEX` (`DS:1058`). Les autres (plages d'événements, destinations de vœux et de S38) sont recopiées des fonctions désassemblées ; `WISH_DESTINATIONS` et `BESPECTACLED_DESTINATIONS` sont recoupées par le test avec `DOORS`.
- `ingredientCount` est toujours égal au nombre de bits de `ingredients` (invariant testé sur des parties jouées au hasard).

## Corrections apportées à `engine.md`

- `+2` de la structure joueur (`DS:6EB6`) est le **niveau de difficulté** 0..2 et non une « teinte » ; le titre de S08 « Menu Personnages et Niveaux » le confirme.
- `DS:7E18` / `DS:7E19` (objectif) sont en fait `DS:19B8` / `DS:19B9` (la notation `iRam0003xxxx` de Ghidra se convertit par `− 0x36460`).
- `+C` (`DS:6EC0`) est le nombre d'ingrédients et `+10` l'état du pion (prison, Turlusiphon) ; le « déclencheur par case » des animations S13 à S21 est donné au §4 (ce ne sont pas des cases mais des plages de `x` sur chaque écran).
- Les codes de porte 15 à 21 (absents de `28a3:0474`) ne sont pas des mini-jeux : ce sont les événements du plateau (15 pièges, 16 pont, 17 fusée, 18 lac, 20 prison, 21 Turlusiphon) ; 14 est le puits (S14 sur l'écran 2, S13 ailleurs).

## Questions ouvertes

1. **Signification exacte du bonus de l'oiseau** par scène (niveau interne 0 ou 3, variables propres) : à vérifier dans chaque mini-jeu en phase 4.
2. **Plages de bord** : les bornes `<`/`≤` des plages d'événements ont été traduites à ±1 ; l'appui exactement à `x = 0xFF` ou `0x113` (écrans 3, 5, 6) n'est géré ni par la marche ni par le bouton dans l'original (trou de 1 px), non reproduit.
3. **Animations de marche** : la distance parcourue pendant une animation de bord (`x = 0x0B` ou `0x134` après un changement de rangée), le décalage du recul du Turlusiphon (`0x14`) et la marche jusqu'à la cage sont pris à leurs valeurs finales.
4. **Pause** : le chrono global est-il gelé ? (`engine.md` §8, question 4) : non dans le code lu, donc non gelé.
5. **Choix 8 du magicien** (zone « chapeau »), sa valeur exacte (rien d'autre que −3 points dans le code) et l'usage de l'entrée 18 de `CS:2daf:0aa8`.
6. **Textes** : noms des 8 ingrédients (voix `s19v`), correspondance personnage ↔ nom (probable), message exact de l'oiseau/indice pour chaque scène : non extraits ; aucune copy n'est écrite dans le code.
7. **Borne des points de S51** (nombre de cadeaux) et conditions d'échec de S26/S23.
8. **Commentaires du Grand Schtroumpf** (`26ee:027e`, `26ee:0f17`, voix `s42v`/`s01v` par personnage et situation) : non portés ; seuls les avertissements de temps le sont. `26ee:0f17` et `27e` divisent par le nombre de joueurs × ingrédients requis (défaut probable de l'original) : le code TS calcule la part exacte.
9. **Réinitialisation des drapeaux d'avertissement** entre deux parties de la même session (non réinitialisés dans l'original).
10. **Action automatique (36 s)** : le mode de choix de la porte quand le pion est sur une zone N (`11f4`) : le code lu suggère « rien et fin de tour » ; non exécuté.
