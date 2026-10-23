# Carte du Pays Schtroumpf S02 et mode libre (E2b-1)

Adresses `segment:offset` de `SMURF.EXE`. Confiance : **sûr** (code lu), **probable**, **hypothèse**. Code : `scenes/s02-map.ts` (contrat), `scenes/map/` (`view.ts` tables et géométrie, `image.ts` fond et marqueur, `map-scene.ts` la carte, `free-mode.ts` le mode libre). Tests : `test/teleportaschtroumpf/map.test.ts`.

## Appels de `1a3c:0225(p1, a, b, mode)` (sûr)

| Appelant | Appel | Sens |
|---|---|---|
| `28a3:00ad`, code 202 (pause) | `(DS:6E64 = zone du pion, 1, 0, 1)` | consultation : **mode 1**, `b = 0` |
| `1a3c:002a` (mode libre) | `(1, 1, 1, 2)` après `k = 1`, `DS:6EB3 = 0` | sélection : **mode 2**, `b = 1` |
| `1a3c:0003` (puits aux vœux S13, `2daf:0006`) | `(4, 1, 1, 2)` après `k = 2`, `DS:6EB3 = 1` | sélection, sans « retour », avec minuteries |

Le résultat est la globale `k` (`DS:63EF`, `iRam3c84f`), pas la valeur de retour. `p1` n'est lu que pour la case du marqueur en consultation (`DS:1470[p1]`) ; en sélection (`b ≠ 0`) la case est celle de `DS:15BA[k]`. `a` (redessin) vaut toujours 1.

## Rendu (sûr)

- **Cadre** : `s02a002d.mcg` (mode 1, bandeau « Retour » en bas), sinon `s02a007d.mcg` si `DS:6EB3 ≠ 0` (puits), sinon `s02a001d.mcg`. La palette est celle de ce MCG (`13fc:0084`) ; les trois fonds ont la même image hors bandeau, seule `s02a007d` a la palette exacte du fond défilant (les écarts de `001d` portent sur des teintes très proches, aucun effet visible).
- **Fond défilant** : 481 lignes de 320 pixels en mémoire EMS (`DS:C81C`), lues à la suite dans les MCG (`lseek` après 2 + 768 octets de palette) : `s02a004d` lignes 6 à 175 (170 lignes, décalage `0xA82`), `s02a005d` lignes 28 à 175 (148, `0x2602`), `s02a006d` lignes 13 à 175 (163, `0x1342`). Les raccords sont continus (vérifié sur les pixels).
- **Fenêtre** : `317b:01b9(6, 0xAA)` limite le dessin aux lignes 6 à 175 ; à chaque image `30bb:000a` copie 170 lignes (0x3520 mots doubles) du fond, à partir de la ligne `DS:C830` (le décalage), vers la ligne 6 de l'écran. Les lignes 0 à 5 et 176 à 199 sont le cadre du MCG.
- **Marqueur** : le Schtroumpf de `s02a000s.hy8` (sprites 0 et 1, images de 32 × 41, 2 sprites : la 3e colonne de `DS:1470` choisit le sprite). `31fe:0481(sprite, x − 0x1E, 0x31)` le dessine dans une bande de 50 lignes (`0x3E80` octets) copiée du fond à partir de la ligne `y − 0x45`, puis recopiée dans le fond (la bande propre est gardée en `DS:C82C` et restaurée au déplacement suivant). Sa ligne du bas tombe donc à `y − 20` sur le fond, son bord gauche à `x − 30` plus le décalage du sprite (−17 ou −8). **Sûr** pour les valeurs, **probable** pour le sens « pion posé à côté du lieu ».
- **Décalage** (`DS:C830`) initial : `0` en consultation (`b = 0`) ; en sélection selon `k` : `k < 5` → `0x137` (bas du fond) ; `5 ≤ k ≤ 16` → `y de la case − 0x78` (marqueur à peu près au centre) ; `k ≥ 17` → `0`. Il saute d'un coup à chaque changement de lieu, sans animation.
- Cadence `1f33:0348(3)` : 20 images/s, `step = 3`.

## Commandes (sûr)

Drapeaux de navigation `DS:B01B` (bit 1 haut, bit 2 bas ; clavier : flèches ou Q / A) et boutons `DS:B01D` (1 = Espace, 2 = Entrée). La souris ne désigne rien (§4.4 d'`engine.md`). Pas de gauche / droite, pas d'Échap.

- **Mode 1 (consultation)** : haut → décalage −5, bas → +5, bornés à 0 et 0x137, **tant que la touche est tenue** (100 pixels par seconde). Espace sort. Entrée ne fait rien. Le décalage de départ est 0 : le marqueur de la zone du pion est peint mais n'est visible que si on fait défiler jusqu'à lui (zones des 1res cases en bas du fond ; ordre de dessin, pas une volonté apparente).
- **Mode 2 (sélection)** : haut → `k + 1` (max 18), bas → `k − 1` (min 1 en mode libre, min 2 pour le puits). Après chaque pas `1f33:030e` attend le relâchement de la touche (au plus 5 s : pas de répétition en pratique), donc un pas par appui. Un changement (pas à la butée) rejoue un bip `s07a001b` si aucun bruitage ne sonne (`348d:0b42(1, 0)`, reproduit par `voice.effectPlaying` et `voice.playEffect`, la musique continue), puis le marqueur et le décalage suivent. Espace (`b01d == 1`) fixe `DS:C84C` et sort avec `k`.
- **Aide (mode libre seul, `DS:6EB3 = 0`)** : Entrée joue la voix `s45v` + `DS:15E0[k]` (le numéro de scène du lieu : 23, 29, 35, 40, 33…), attendue jusqu'à sa fin ou jusqu'à Espace (`1f33:03a7(1)`, qui ne valide pas). `15E0[1] = 0` : rien sur « retour » (la voix `s45v000t` n'existe pas ; **probable**).
- **Puits** : un chrono (slot 2) démarre à l'entrée ; à 16 s, une seule fois, 1 chance sur 3 (`rand × 3 == 0`) : voix `s13b` + `0x15 + rand × 3` (`s13b021..023t`), attendue en entier ; à 36 s la carte sort d'office avec `k = 1`. Pas d'aide.
- **Sortie** : son coupé (`15f9:089f` avec le drapeau 0x400000), fenêtre rétablie, `DS:6EB3 = 0`, tampons libérés. La musique de fond est relancée par la voie son dès que rien ne joue (début de boucle, `15f9:089f` 0x800000 | 0x200000 | 2).

## Mode libre `1a3c:002a` (sûr)

`k = 1`, `DS:6EB3 = 0`, un joueur (`DS:6E2C = 1`, `DS:6E2A = 0`). Boucle : fondu au noir, carte (la sélection `k` **persiste** d'un tour à l'autre : on revient sur le lieu joué) ; si `k ≥ 2` : `DS:6EB6 + 0x14 × joueur = rand × 3 / 0x8000` (niveau 0..2), scène = `CS:1a3c:0203[k − 2]`, voix d'accroche `28a3:04dc(scène)` (`sNNa` 1 ou 2, 1 pour S51), fonction d'entrée du mini-jeu (`CS:1a3c:01c7`) ; jusqu'à `k == 1`. Le plateau (`291e:0401`) n'intervient jamais : les mini-jeux sont lancés sans les effets de partie.

## Reproduit

Tout ce qui précède, dont : les trois modes, les trois cadres, le fond défilant et le marqueur, les décalages et leurs bornes, le bip, l'aide vocale, les minuteries du puits, la persistance de la sélection, le niveau tiré et la voix d'accroche, le retour à la carte après le mini-jeu. Le mode libre fabrique une partie à un joueur (`newGame`, `Game.openMinigame`) pour donner sa requête au mini-jeu (`level` tiré, personnage tiré) ; `abortMinigame` la referme au retour, l'issue du mini-jeu est ignorée.

## Écarts à l'original

- Zone 54 du pion (écran 9, bas droite) : l'original lit au-delà de `DS:1470` (octets identiques à la case 53, la mine) ; reproduit en bornant à 53.
- Personnage du joueur factice : tiré (l'original lit un enregistrement joueur resté en mémoire, valeur inconnue : **hypothèse**).
- Pendant la voix d'aide, l'original ne rend pas la main aux touches de défilement ; ici non plus (phase `voice`).
- Le fondu d'entrée et de sortie suit le moteur (16 pas) au lieu de `1523:01fa(0x10)` / `13fc:03f9`.
- Aucun texte visible nouveau : le bandeau « Retour » est dans `s02a002d.mcg`.
