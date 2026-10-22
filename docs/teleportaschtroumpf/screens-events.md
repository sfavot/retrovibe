# Événements du plateau S13 à S21 et puits aux vœux (E2b-2)

Adresses `segment:offset` de `SMURF.EXE` (décompilation `archives/teleportaschtroumpf/re/decomp/2a78_*.c`, `2daf_0006_fun.c`). Confiance : **sûr** (code lu), **probable**, **hypothèse**. Code : `scenes/events.ts`, `scenes/events/clips.ts` (table), `scenes/events/well.ts` (puits). Les plages de déclenchement et les effets sont dans `rules.md` §4 et `game/tables.ts` (`HAZARDS`) ; ce document décrit seulement le rendu.

## Mécanique commune `2a78:00da(écran)` (sûr)

- Aiguillage par écran 1..9 (table `CS:2a78:0145`) vers `0157` (écran 1 : rien), `015f` (2), `0272` (3), `0480` (4), `06e5` (5), `0a59` (6), `0d53` (7), `0f2f` (8), `1244` (9). Chaque routine teste des drapeaux levés par le dessin de l'écran (`2bd4:084c..149c`) et joue l'événement correspondant.
- **Marche d'approche** : le pion marche automatiquement (`2bd4:000f(écran, pose)` en boucle, pose 2 = vers la droite, 3 = vers la gauche) jusqu'à `target` (`x`), puis s'arrête (`2bd4:0093`). La vidéo est `a` si `x < target + 1` au déclenchement (il marchait vers la droite), `b` sinon. La fusée (S17) n'a pas de marche ni de côté.
- **Vidéo** `2a78:0039(fichier, écran, 1)` : `179a:0673(fichier, 0x12088, 0, 0, cb_fin = 2a78:0009)`. Les drapeaux `0x12088` ne contiennent ni `0x400` ni `0x800` : **la vidéo n'est pas passable** (ni clic ni Échap). Avant elle, `13fc:067d` sauve le bandeau (rectangle `0,0x92 / 0x13F × 0x35`) ; `cb_fin` le restaure, puis `291e:000e` redessine le décor. Les vidéos sont en 320 × 200 : elles couvrent tout l'écran ; le plateau est redessiné au retour. Sûr pour le flux, probable pour le sens exact des bits `0x2000 / 0x8`.
- **Voix** : après la vidéo, `15f9:0db1(préfixe, 1, rand × N / 0x8000)` puis `15f9:0e1c`, et `1f33:03a7(skip)` attend la fin (un clic gauche la coupe quand `skip` vaut 1). Les routines qui appellent `03a7` sans argument lisent un octet de pile quelconque : **hypothèse**, ici elles ne sont pas coupables.
- Après la voix : l'effet (position d'arrivée via `2a78:13c1`, état du pion `DS:3DE4F` = 2 prison, 4 Turlusiphon, 0 libre ; `291e:125c` redessine l'écran avec la cage) : déjà fait par `game/`.

## Table des événements déclenchés (sûr)

`a` = pion à `x ≤ target`, `b` = au-delà. Fichiers vidéo `sNN?.mux` (`DATA/SNN/SNN?/`).

| Événement | Routine | Écran | `target` | Vidéos a / b | Voix (1 + rand × N) | Arrivée |
|---|---|---|---|---|---|---|
| Puits S14 | `015f` | 2 haut | 0x104 | s14a / s14b | `s14a` N = 4, coupable | 1..9 sauf 2 |
| Prison S20 | `0272` | 3 bas | 0xAC | s20a / s20b | — | cage |
| Turlusiphon S21 | `0272` | 3 bas | 0x109 | s21a / s21c | `s21v` N = 3 | siphon |
| Puits S13 (porte) | `0480` | 4 haut | 0x116 | s13a / s13b | — | puits interactif |
| Piège → écran 9 haut | `0480` | 4 bas | 0xAD | s15a / s15b | `s15a` N = 4, coupable | `x = 0x10` |
| Lac S18 | `0480` | 4 bas | 0x106 | s18a / s18b | `s18a` N = 4 (3 fichiers), coupable | écran 5 + rand × 5 |
| Turlusiphon | `06e5` | 5 haut | 0xA3 | s21e / s21g | `s21v` N = 3 | siphon |
| Piège → 9 bas | `06e5` | 5 bas | 0x36 | s15c / s15d | `s15a` N = 4 | `x = 0xD4` |
| Piège → 8 bas | `06e5` | 5 bas | 0x93 | s15e / s15f | `s15a` N = 4 | `x = 0xDE` |
| Prison | `06e5` | 5 bas | 0x106 | s20d / s20e | — | cage |
| Puits S13 (porte) | `0a59` | 6 haut | 0x41 | s13c / s13d | — | puits interactif |
| Piège → 7 bas | `0a59` | 6 haut | 0xA9 | s15g / s15h | `s15a` N = 4, coupable | `x = 0x10` |
| Fusée S17 | `0a59` | 6 bas | (aucun) | s17a | `s17a` N = 4 (3 fichiers), coupable | écran 1 + rand × 5 |
| Turlusiphon | `0a59` | 6 bas | 0x109 | s21i / s21k | `s21v` N = 3, coupable | siphon |
| Pont S16 | `0d53` | 7 bas | 0x89 | s16a / s16b | `s16a` N = 3 | écran 8 + rand × 2 |
| Prison | `0d53` | 7 haut | 0xB0 | s20g / s20h | — | cage |
| Piège → 7 haut | `0f2f` | 8 haut | 0x52 | s15i / s15j | `s15a` N = 4 | `x = 0x10` |
| Piège → 5 haut | `0f2f` | 8 haut | 0x9D | s15k / s15l | `s15a` N = 4 | `x = 0x10` |
| Piège → 3 bas | `0f2f` | 8 haut | 0x117 | s15m / s15n | `s15a` N = 4 | `x = 0x75` |
| Prison | `0f2f` | 8 bas | 0x34 | s20j / s20k | — | cage |
| Puits S13 (porte) | `1244` | 9 haut | 0x36 | s13e / s13f | — | puits interactif |
| Prison | `1244` | 9 bas | 0x3A | s20m / s20n | — | cage |

Notes :

- Les voix des pièges `s15a001..004t` existent toutes ; `s17a004t` et `s18a004t` **n'existent pas** (3 fichiers pour un tirage 1..4) : l'original demande un fichier absent une fois sur quatre, la voix est muette (la scène rend alors la main sans attendre). Sûr pour le tirage, probable pour le silence (le code ne teste pas l'échec de `lib_open`).
- Les voix `s16a001b` (bruit du pont) et `s18a001b/002b` (bruit du lac) sont jouées par le plateau à l'entrée dans la plage comptée (`291e:0401`, voir `screens-game.md`), pas par l'animation.
- `s20AD01M.voc` (dossiers `S20A`, `S20B`) n'est référencé par aucune de ces routines : non utilisé ici.
- Prison : la voix du prisonnier (`s20v`) est dite par le plateau au tour passé (`291e:0401`), pas par l'animation de capture.
- Fusée : l'original ne fait pas marcher le pion (le bouton suffit) et la vidéo est unique.

## Libérations au début du tour (sûr)

États 3 → 0 (prison) et 5 → 0 (Turlusiphon), `291e:0401` puis `2a78:0272/06e5/0a59/0d53/0f2f/1244`. Pas de voix, pas de marche.

| Écran | Prison | Turlusiphon, regard à droite (`x −= 0x14`) | regard à gauche (`x += 0x14`) |
|---|---|---|---|
| 3 | s20c | s21b | s21d |
| 5 | s20f | s21f | s21h |
| 6 | — | s21j | s21l |
| 7 | s20i | — | — |
| 8 | s20l | — | — |
| 9 | s20o | — | — |

Le regard est `DS:3DE40` (1 = vers la droite). `game/rules.ts` applique déjà le recul de `0x14` ; la scène choisit la vidéo d'après `Player.facingRight` (le recul est donc dans la partie, pas dans la vidéo).

## Puits aux vœux S13 `2daf:0006` (sûr sauf mention)

**Ouverture** : `2daf:0adc` (déjà dans `game/`, `rollWellOpen`) ; porte du puits = animation S13 de la table ci-dessus, puis code 14. **Mode** : `DS:3E0CC` = 0 (voyage) si le joueur a les 8 ingrédients, sinon `rand × 2` ; 0 = voyage, 1 = ingrédient (ce que `Game` stocke dans `wellMode`).

### Mode voyage (mode 0)

1. Voix `s13a001t` ou `s13a002t` (`1 + rand × 2`), attente de la fin, fondu au noir.
2. Chrono 2, carte S02 `1a3c:0003()` : rend `k` (1 = retour, 2..18 = lieu).
3. `k > 1` : voix `s13b018t..020t` (`0x12 + rand × 3`), destination `WISH_DESTINATIONS[k − 2]` (table `CS:2daf:0aa8`, déjà dans `game/`) ; `k == 1` : voix `s13b024t` ou `025t` (`0x18 + rand × 2`), rien.

### Mode ingrédient (mode 1)

1. Voix `s13a003t` ou `s13a004t` (`3 + rand × 2`), fondu, palette `s13g.pal`, vidéo `s13g.mux` (flags `0x2904` : **Échap la passe** ; 40 images, 3,6 s). Voix `s13c001t..006t` (`1 + rand × 6`).
2. La dernière image de la vidéo devient le fond. Le curseur est le sprite 0 de `s13a000s.hy8` (32 × 31, couleurs 128 et 129) dessiné en (`DS:4BB9`, `DS:4BB7`) = position de la souris bornée à `x ∈ [8, 0x134]`, `y ∈ [0x0F, 0xBE]`. La vidéo laisse du magenta aux couleurs 128 et 129 : l'original charge `s13g.pal` (entrées 128 = `0,142,189`, 129 = `16,16,19`) ; sans elle le curseur est rose.
3. Huit cases de 0x20 de côté (bords exclus), une par ingrédient ; coin haut-gauche (`x`, `y`) : 0 (0x49, 0x90) ; 1 (0x8B, 0x73) ; 2 (0x3C, 0x31) ; 3 (0x89, 0x4A) ; 4 (0x28, 0x77) ; 5 (0x6D, 0x30) ; 6 (0x29, 0x4D) ; 7 (0x6E, 0x8E). Case sous le curseur : deux cadres `32af:0006` (rectangle) : (x−1, y−1)-(x+0x1F, y+0x1F) en couleur `0x7F` (clair), puis (x, y)-(x+0x20, y+0x20) en `0x7E` (sombre), puis le curseur par-dessus.
4. Changement de case (pas lors du simple retour à vide) : bip `s07a001b.voc` si aucune voix ne sort.
5. Clic gauche sur une case : si l'ingrédient est déjà possédé (`1e52:0034`), voix `s13c016t..020t` (`0x10 + rand × 5`) et on continue ; sinon choix.
6. Chrono 2 : à 16 s, une fois, une chance sur 3 : voix `s13b021t` ou `023t` (`0x15 + 2 × rand × 2`). À 36 s : fin sans choix.
7. Fin : sans choix, voix `s13b024t`/`025t` ; avec choix, voix `s13c` + `7 + T[i]`, `T = [1, 6, 3, 5, 2, 7, 8, 0]` (table `DS:2C1D`), soit `s13c008t, 013t, 010t, 012t, 009t, 014t, 015t, 007t` pour les ingrédients 0 à 7. Puis `1e52:0053(joueur, ingrédient)`, compteur +1 (appliqué par `Game.resolveMinigame`).

### Écarts à l'original

- Le curseur suit la position de la souris ; **les flèches** déplacent aussi le curseur (3 px par image, extension : l'original émule la souris par le pilote de clavier), Espace / clic gauche valide. Le bouton de l'original est testé en continu (`DS:4BBD == 1`), ici c'est un appui (front).
- La voix d'accroche et la voix de fin sont dites sur ce qui est à l'écran (plateau ou noir selon que `game.ts` empile avec ou sans fondu) : l'original n'a pas de fondu avant la voix, il fond après.
- Au retour de la carte, l'écran est noir sous la voix (`s13b0xx`) : l'original n'efface rien.
- La vidéo `s13g` est passable aussi par Espace / clic gauche (`VideoScene` ne distingue pas Échap).
- Non reproduits : la marche d'approche du pion avant la vidéo d'un événement (`approachX` donne le `x` cible pour que le plateau l'anime).
