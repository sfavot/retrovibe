# Super Sticklers (scène 6, `STICKLER.DAT`)

Étude de rétro-ingénierie de l'activité « Super Sticklers » de Math Workshop (Broderbund 1994, v1.01, CD Win16). Adresses `sélecteur:offset` de la décompilation de `MATH` ([re-index.md](re-index.md)) ; segment de code `1048` (handlers `scene_sticklers_*`, `Enter` `1048:0000`), segment de données `1108`. « Hypothèse » marque ce qui n'est pas prouvé par le code. Les rendus de contrôle citées viennent de lecteurs TS de `src/games/mathemagique/data/` (palette de jeu reconstruite comme au §2.3).

**Résumé.** Ce n'est pas un jeu de logique à indices : c'est un **puzzle de lignes** (« Sticky Lines »). Un dessin au trait est découpé en 7 à 14 fragments de ligne (masques 1 bit, noirs) éparpillés à droite d'un chevalet ; l'enfant les glisse sur un **gabarit** (lignes blanches, ou silhouette selon le niveau), les fait tourner avec Espace / bouton Rotate, et chaque fragment bien placé (à ≤ 10 px, bonne orientation) se **colle définitivement**. Quand tous sont collés, une animation de récompense propre au puzzle se joue dans le chevalet (cliquable pour la rejouer). Aucun score, aucune erreur, aucun chronomètre, **aucune écriture du masque de réussites** du roster.

## 1. Règles

### 1.1 Déroulé (vérifié)

1. `Enter` (`1048:0000`) : fond `SHPL` 104, menu du niveau vert (`592c = 0` : **le niveau n'est pas mémorisé**, on repart toujours du vert), animation d'accueil `SCR` 1000 (voix `SND` 13105), musique MIDI 100 si la préférence musique (`2d64`) est active.
2. **Menu de puzzles** : 9 vignettes 72×72 (grille 3×3 dans le chevalet) du niveau courant. Un clic sur une vignette lance le puzzle (`1048:0556`, rappel du groupe 2).
3. **Puzzle** : les fragments sont tirés au hasard à droite (§1.4). Le gabarit est dessiné dans le chevalet. L'enfant saisit un fragment, le déplace, le lâche.
4. **Collage** (`1048:0b83` → `0c36`) : au relâchement, si le fragment n'est pas déjà collé, que ses deux coins (haut-gauche et bas-droite) sont dans le rectangle du chevalet agrandi de 20 px (`17,6,313,302`), que son orientation vaut 0, et que son centre est à ≤ 10 px en x **et** en y du centre cible (`|dx| ≤ 10 && |dy| ≤ 10`, comparaisons `JG 10` → 10 inclus) : il est **recentré exactement** sur la cible, marqué collé (`+4 = 1`) et retiré des zones cliquables (`8376 |= 1`). Sinon il reste où il est lâché (même sur le chevalet). Pas de sanction, pas de son d'erreur, pas de sortie forcée.
5. **Fin** (`1048:17a7`) : dès que les `n` fragments ont `+4 = 1` : arrêt du MIDI et du son `594e`, désactivation du groupe des fragments, puis `1048:192e` : joue l'animation de récompense (`SCR`/`SHPL` `8000 + 50 × (9 × niveau + puzzle)`) **découpée sur le rectangle du chevalet** `(37,26,293,282)`, bloquante, puis relance la musique 100 si `2d64 ≠ 0`. Le groupe 3 (clic sur le chevalet, `1048:0684` → `192e`) est alors activé : cliquer rejoue l'animation (manuel : « Replay »). Aucun passage automatique au puzzle suivant : l'enfant choisit autre chose (boutons de niveau = retour au menu).

### 1.2 Concept mathématique

Raisonnement spatial : reconnaissance de forme, rotations (0°/90°/180°/270°), positionnement. Aucune arithmétique. Difficulté = quantité d'aide du gabarit :

| Niveau (bouton « Level Brothers », `592c`) | Gabarit (`SHAP` 1 de la `SHPL` du puzzle, 250×250 à `(40,29)`) | Aide |
|---|---|---|
| 0 vert (puzzles `2100`–`2900`) | image couleur avec **toutes les lignes en blanc** (index 154 = lignes, 155 = fond) | tracé complet à recouvrir |
| 1 orange (`3000`–`3800`) | moitié du dessin déjà tracée en noir dans le gabarit, le reste en silhouette blanche ; les fragments à poser sont dans la moitié droite | silhouette |
| 2 rouge (`3900`–`4700`) | silhouette blanche seule + **miniature 100×100 du dessin fini** (`SHAP` 2, dessinée à `(300,30)`, mode 0, `1048:17f9`) | miniature de référence |

(Constaté en recomposant les 27 puzzles : toutes les cibles tombent exactement sur les lignes du gabarit.)

### 1.3 Sélection du puzzle

Pas de hasard : l'enfant choisit. Ids `PUZZ`/`SHPL` = `2100 + 900 × niveau + 100 × (vignette − 1)` (`1048:0556`, `IMUL 0x384`, `IMUL 0x64`, `+0x834`). Vignette `k` (1–9) = rang dans la grille 3×3, ligne par ligne.

### 1.4 Éparpillement initial (`1048:0cf8`, aussi appelé par Reset)

Pour chaque fragment `i` (ordre du `PUZZ`) :

- forme de base : `shapeBase = 1` (niveaux 0, 1) ou `2` (niveau 2), puis `shapeBase += a_i` (nombre d'orientations de chaque fragment précédent) ; index 0-based dans la `SHPL` (`shapeBase = 1` = `SHAP` n° 2).
- `w, h` = largeur/hauteur de la forme ; au **premier** éparpillement (`5968 = 0` à la sortie du `PUZZ`) la cible devient un centre : `cx += w/2`, `cy += h/2` (`SAR 1`), puis `5968 = 1` (un Reset ne la décale plus).
- orientation tirée : `rand(4)` applications de `rotation` (§1.5), soit `k mod a` ; si `w > 280` (`1df4 − 1df0`), une rotation de plus.
- zone des centres : rectangle `(295,2,575,379)` rétréci de `w/2+1` à gauche/droite et `h/2+1` en haut/bas. Jusqu'à **20 candidats** : centre = `gauche + rand(largeur)`, `haut + rand(hauteur)` ; score = nombre de fragments déjà posés (indices `< i`) que le rectangle chevauche (`IntersectRect`) ; arrêt à score 0, sinon on garde le **premier** candidat de score minimal. Au niveau 2, tout candidat qui chevauche la miniature `(295,25,395,125)` est rejeté et retiré **sans compter** (boucle potentiellement longue). Cas « grand fragment » du niveau 2 (`w ≥ 180` et `h ≥ 254`, coin bas-droite) : jamais atteint avec les données (hypothèse).
- `rand(n)` = `10a8:14c1(n)` ∈ [0, n[.

### 1.5 Rotation (`1048:1701`, `1048:1509`)

`orientation = (orientation + 1) & (a − 1)` avec `a ∈ {1, 2, 4}` (pas de rotation si `a = 1`). Les formes de rotation sont consécutives dans la `SHPL` (pour `a = 4` : 0°, 90°, 180°, 270° sous forme `w×h`, `h×w`, `w×h`, `h×w` ; vérifié sur les tailles). Le centre ne change pas ; la forme est recalée dans l'écran (centre borné à `(0,0,576,432)` rétréci de `h/2`, `w/2`).
Déclencheurs : touche **Espace** (`1048:1914` → `1509`, retourne « consommée » pour `0x20` uniquement) ou bouton Rotate (`0458(6)`). Conditions (`1509`) : pas d'animation Poly active (`32c2 = 0`), groupe fragments actif (`31ce` bit 0 = 0), et fragment « courant » (case 0) non collé (`8376` bit 0 = 0). Joue `SND` 2005. S'applique au fragment **tenu**, ou, si rien n'est tenu, au dernier fragment saisi (case 0) : il pivote sur place puis `0b83` est rejoué (il peut donc se coller en tournant).

### 1.6 Saisie, entrée, ordre d'empilement

- **Mode de souris** `02b8` (préférences du roster, « mouse control » du manuel) :
  - `0` = **glisser** (`1048:02be` case 0) : on appuie sur le fragment (`0965` : joue 2012, `593e = bouton`), le tick le suit tant que le bouton qui a saisi est enfoncé (`1098:0437(593e)` = `GetAsyncKeyState`), lâcher = `0b83`.
  - `≠ 0` = **cliquer-poser** : 1er clic = saisie (2012), le fragment suit la souris (hook `1048:1119` appelé par le gestionnaire de gadgets), 2e clic = pose (2013 puis `0b83`).
- Hit-test des fragments (`1048:1119`) : **au pixel** sur le masque 1 bit de la forme courante (fragments fins : il faut viser le trait), avec hystérésis : si la dernière cible (`5954` = `shapeBase`, `5956` = point) est la même et que le point est à `< 20` px en x et en y, c'est un succès sans test pixel. Les fragments collés sont exclus (`flags` bit 0 de leur entrée `8364 + 0x14 × i`, offset `+0x12`).
- Pas de collision entre fragments. Pose sur la zone des boutons `(37,282,293,368)` : le fragment est repoussé (`0b83`, au plus petit déplacement : vers la droite jusqu'à `x = 293`, ou vers le haut jusqu'à `y = 282`).
- Le déplacement (`1048:135c`) borne le centre à l'écran moins demi-fragment, sauvegarde/restaure le fond sous le fragment (tampon `592e`, « back port » e2).
- Empilement : le fragment saisi passe à l'indice 0 du tableau (`09df` décale les autres, copie `0x18` octets) ; il est dessiné **en dernier** quand on le tient ; le redessin (`09df`) trace les indices `1..n−1` dans l'ordre. Le hit-test teste l'indice 0 d'abord. Conséquence (hypothèse sur le rendu exact) : après redessin, le fragment le plus récemment manipulé est en dessous des autres alors qu'il est prioritaire au clic.
- Survol (vtable `3182`) : le fragment sous la souris est redessiné en **couleur d'accent** (ink `183`/`0xb7` = bleu, vert, etc. selon le puzzle) par `1048:1292` ; `12f7` le repasse en noir (ink `245`/`0xf5` = noir). Seulement si rien n'est tenu.

### 1.7 Retours, aides, niveaux, score

- Pas de score, pas de compteur de coups, pas de message de réussite (hors animation).
- **Aide (Poly)** : bouton 4 (`0458` → `19f4`). Voir §5.4. Pas d'indice de placement.
- **Reset** (bouton 5, `0458`) : si un puzzle est affiché : son 2004, attente `1088:10d2(0x1e,0)` (hypothèse : attente de fin de son), puis `0cf8` : tous les fragments sont recollés à zéro et réparpillés (nouveaux tirages).
- **Boutons de niveau 1–3** : si un puzzle est affiché (`5940 ≠ 0`) ou si le niveau change, retour au menu du niveau choisi (`0816`). Cliquer le niveau déjà affiché depuis le menu ne fait rien.
- **Exit** (bouton 7) : `scene_sticklers_exit` (§5.5).
- Fin de manche : aucune ; le puzzle terminé reste affiché et rejouable.

## 2. Formats

### 2.1 `PUZZ` (27 ressources, ids `2100`…`4700` par 100)

Tableau de `u16` **big-endian**, copié en `DS:5966` par `10a8:058c(.., taille −1)` puis converti par `1050:00fa(1, 5966, 1e3c)` : la définition `1e3c` décrit **un** champ de 49 `u16` (98 octets) ; le chargement lit seulement la longueur de la ressource, le reste du tampon garde sa valeur précédente (zéro). Longueur de la ressource = `8 + 6 n` octets (56 pour `n = 8`, …, 98 pour `n = 15`).

| Offset | Variable | Contenu |
|---|---|---|
| 0 | `5966` | `n` = nombre de fragments (7 à 15) |
| 2 | `5968` | toujours 0 : drapeau « cibles = coins haut-gauche » (devient 1 après le 1er éparpillement) |
| 4 | `596a` | `x` du gabarit : 40 (37, 38, 39 pour 4 puzzles) |
| 6 | `596c` | `y` du gabarit : 29 (26, 27 pour 3 puzzles) ; `1048:17f9` : `draw(SHAP 1, x, y, mode 8)` |
| 8 + 6 i | `596e` | `a_i` : nombre d'orientations (1, 2 ou 4) |
| 10 + 6 i | `5970` | `x` coin haut-gauche de la position finale du fragment (écran) |
| 12 + 6 i | `5972` | `y` idem |

Remarque : le gabarit (`596a/596c`) est dessiné au coin `(40,29)` alors que le chevalet commence à `(37,26)` ; les cibles sont en coordonnées écran absolues (premier fragment du puzzle 2100 : `(49,41)`, forme 233×231).

Exemple décodé (`2100`, niveau vert, basket) : `00 08 | 00 00 | 00 28 | 00 1d | (1,49,41) (4,59,109) (4,122,52) (4,188,49) (4,66,88) (4,136,131) (4,178,115) (4,200,106)`. Le fragment 0 (`a = 1`, 233×231 = le contour) est fixe en orientation ; les 7 autres tournent par 4.
Autre : `4700` (rouge, 15 fragments, 98 octets) : `(2,110,74) (2,160,53) (2,212,67) (4,104,46) …`.

Stats : `n` = 7 (1 puzzle, `3400`), 8 (12), 9 (7), 10 (3), 12 (2), 13 (1), 15 (1) ; niveau vert 8–10, orange 7–9, rouge 8–15.

**`PUZZ` partagé ?** Non : `HIDDEN.DAT` (ids `1000+`, 121 octets) et `PATTERNS.DAT` (`6600`–`7900`, 40 octets) ont d'autres ids et d'autres tailles (engine.md §8.4, §9) ; seul le **nombre** (27) est commun.

### 2.2 `SHPL` / `SHAP` d'un puzzle (`2100 + 100 k`, 24 à 56 formes, palette 10–245)

Vérifié par recomposition sur les 27 puzzles (nombre de formes = formes utilisées, cibles exactes) :

| Index 1-based | Contenu |
|---|---|
| 1 | gabarit 250×250, 8 bits (indices 154 et 155 : 2 couleurs) |
| 2 | **niveau rouge seulement** : miniature 100×100 8 bits |
| ensuite | fragments, `a_i` formes consécutives par fragment, **1 bit** (masques dessinés à l'encre `245`, noir) ; pour `a = 4` : `w×h, h×w, w×h, h×w` |

`SHPL` du menu `2020`, `2030`, `2040` (niveaux 0, 1, 2) : 9 vignettes 72×72 8 bits + forme 10 = masque 80×80 1 bit (cadre de survol). `SHPL` 2000 : 14 formes = 7 boutons × (normal, appuyé) : `33×32/31×31` (boutons 1–4, 6), `42×32/40×30` (bouton 5), `41×32/39×30` (bouton 7). `SHPL` 104 : fond 576×432 (chevalet sur un mur de briques). `SHPL` 1000 : 13 formes (bandeau 105×36 + 12 visages 33×32).

### 2.3 Palette

Seules les entrées **154 à 185** (32 entrées) de la `SHPL` du puzzle/menu sont poussées à l'écran (`10a8:0dc4(0x20, 0x9a, 0x8e42)` : `1048:0556`, `0816`). Le reste de la `SHPL` (143,143,143) est du remplissage ignoré ; le fond (104) garde ses couleurs. Entrées utiles par puzzle : 154 (blanc, lignes du gabarit), 155 (couleur de fond du gabarit), 183 (survol), 163–165 (cadre de survol des vignettes, §3.4), 245 (noir, issue de la `SHPL` 104). **Ne pas appliquer toute la palette d'un puzzle** : le fond deviendrait gris (piège de rendu).

### 2.4 Texte incrusté (traduction)

**Aucun texte** dans les formes de cette activité (gabarits, fragments, vignettes et boutons sont des dessins : pas de lettres). Textes parlés : voix de Poly dans `POLLY.DAT` (anglais), voix `SND` 13105 et animations 16xxx (§4). Les noms/titres des 27 puzzles n'existent pas à l'écran (pas de `STRL`). Seule localisation éventuelle : audio.

## 3. Mise en page (repère 576×432, rectangles `(gauche, haut, droite, bas)`)

### 3.1 Fond et zones (`1108:1de0`–`1e30`)

- Fond `SHPL` 104. Chevalet (zone de jeu) `(37,26,293,282)` (`1df8`) ; bandeau de boutons sous le chevalet `(37,282,293,368)` (`1e00`, zone d'exclusion des fragments).
- Zone d'éparpillement `(295,2,575,379)` (`1df0`). Miniature (rouge) `(295,25,395,125)` (`1de8`), dessinée à `(300,30)`.
- Bandes de fond sauvegardées au début (`10a8:1023`, 4 « map saves » `5910`–`591c`) puis restaurées par `17f9` pour effacer les fragments : `(0,0,576,26)`, `(0,26,37,368)`, `(293,26,576,368)`, `(0,368,576,432)`.
- Poly : `(311,280,388,432)` (`1dd8`, zone cliquable pendant l'aide ; dessinée en bas à droite), cadre d'animation `(238,269,576,432)` (`1e28`, hypothèse : zone du texte de Poly).

### 3.2 Boutons (groupe 1, rectangles `1d68`, forme `SHPL` 2000, rappel `0458(i)`)

| i | Rect | Rôle (`0458`) | Formes |
|---|---|---|---|
| 1 | `(45,291,78,323)` | niveau vert | 1/2 |
| 2 | `(80,291,113,323)` | niveau orange | 3/4 |
| 3 | `(115,291,148,323)` | niveau rouge | 5/6 |
| 4 | `(200,291,233,323)` | **Help** (Poly) | 7/8 |
| 5 | `(169,333,211,365)` | **Reset** | 9/10 |
| 6 | `(250,291,283,323)` | **Rotate** | 11/12 |
| 7 | `(122,333,163,365)` | **Exit** | 13/14 |

Chaque entrée du tableau source fait 16 octets (2 rectangles : le second, décalé de `(+2,+1)`, est le rectangle « appuyé »). Les 4 premiers boutons ont les sons `2000`–`2003` (`8490`–`849c`, hypothèse : son de clic par bouton ; le code d'émission est dans le gestionnaire de gadgets `1038:01af`, non lu). Ctrl+Entrée/Tab : navigation clavier des gadgets (engine.md §5.2).

### 3.3 Groupes de gadgets (`10a0:0000(3216, 4, 0xc000)`)

| Groupe | Descripteur | Rects | Rappel | Rôle | Actif quand |
|---|---|---|---|---|---|
| 0 | `31c4` (`A` = vtable `3182`, `B` = `8364`, 20 octets/entrée) | `n` entrées (`31cc = 5966`) | `1048:0965(i)` | fragments | puzzle affiché et non terminé (`31ce` bit 0 = 0) |
| 1 | `31de` (`B` = `84ac`, `8490` = sons) | 7 | `1048:0458(i)` | boutons | toujours |
| 2 | `31f6` (`B` = `8538`, vtable `30fe`) | 9 | `1048:0556(i)` | vignettes | menu affiché (`3200` bit 0 = 0) |
| 3 | `3206` (`B` = `85ec` = copie de `1df8`) | 1 | `1048:0684` → `192e` | clic sur le chevalet = rejouer | puzzle terminé (`3210` bit 0 = 0) |

Bit 0 de l'octet de drapeaux (`31ce`, `3200`, `3210`) = groupe désactivé. Entrée : `3200 |= 1`, `31ce |= 1`, `3210 |= 1` ; `0816` : `3200 &= ~1`, `31ce |= 1` ; `0cf8` : `31ce &= ~1` ; `192e` : `3210 &= ~1` ; `0458` (sauf 5, 6) : `3210 |= 1`.

### 3.4 Vignettes du menu (`1c75` : `07bf(local_e, local_a)` appliqué à `(0,0,72,72)`)

`x ∈ {50, 130, 210}`, `y ∈ {38, 118, 198}`, 72×72, vignette `k` = ligne `⌊(k−1)/3⌋`, colonne `(k−1) mod 3`. Dessin : `10a8:0ce4(SHPL menu, forme k, x, y, mode 0)`. Survol (vtable `30fe`) : `1048:188f` (son `2010`, cadre = forme 10 de la `SHPL` menu, encre `163 + niveau`, rect agrandi de 4 : `18c8` → `10a8:0d27`) ; `18b6` efface (encre `11`, blanc).

### 3.5 Sprites et animations

- `SCR` 1000 (`1090:0ff9(329e)` à l'entrée, `SNDL` 1000 = son 13105, 210 ticks, 13 images) : trois visages (vert, orange, rouge) sur le bandeau qui s'animent = **accueil/boutons de niveau** (rendu de contrôle : bandeau 105×36 et 12 visages ; hypothèse sur le rôle précis des visages vs. boutons statiques `SHPL` 2000).
- `SCR` `8000 + 50 k` (`k = 9 × niveau + puzzle`, 27 scripts, `SHPL` et `SNDL` de même id, 12 à 130 images, 595–910+ ticks) : animations de récompense, une par puzzle (ex. `8000` = le ballon de basket entre dans le panier). Palette : `SHPL` 10–245 ou 156–169 (14 entrées) selon le script ; zone d'écrêtage = chevalet.
- Bascule de palette `156–159` (`1048:19bd`, hook 0 des scripts : `arg = 0` démarre, sinon arrête ; tick case 1 : toutes les 7 ticks rotation de 4 entrées en `156`, `10a8:0dc4`) : cyclage de couleurs pour certaines animations.
- Poly : `POLLY.DAT` §5.4.
- Transitions : `1018:09b8(1,0,10,15|30, rect)` (volet/fondu 15 ticks sur le chevalet, 30 sur l'écran entier ; hypothèse sur la nature de l'effet) : menu → puzzle et retour. Fondu d'entrée palette `1088:1b25(0x1e0001…)`.

## 4. Sons

Lus dans `STICKLER.DAT` (WAVE 11025 Hz 8 bits mono ; MIDI `100`/`101`). Émissions vérifiées dans le segment `1048` :

| `SND` | Durée | Événement |
|---|---|---|
| 100 | MIDI | musique de l'activité (bouclée ?, hypothèse) : joue à l'entrée et après la récompense si `2d64 ≠ 0` ; coupée pendant l'animation de récompense (`1090:111c` sans bit 1) et à `17a7` |
| 101 | MIDI | non référencé dans `1048` (hypothèse : variante, inutilisé) |
| 2000–2003 | 0,5–0,8 s | clics boutons 1–4 (hypothèse) |
| 2004 | 1,3 s | Reset (`0458(5)`) |
| 2005 | 0,15 s | rotation (`1509`) |
| 2010 (`7da`) | 25 ms | survol d'une vignette (`188f`), chargé avec `0816` |
| 2011 (`7db`) | 97 ms | chargé avec `0816` ; arrêté/libéré dans `0556` (rôle de lecture non trouvé) |
| 2012 (`7dc`) | 68 ms | saisie d'un fragment / clic vignette (`0965`) |
| 2013 (`7dd`) | 24 ms | pose en mode cliquer-poser (`0965`) |
| 2020–2023 (`7e4+r`) | 2–3,2 s | `r = rand(4)` tiré à chaque début de puzzle (`594e`), chargé ; **lecture non trouvée** dans `1048` (libéré à la sortie/`0816`, arrêté à `17a7`) : hypothèse, bruitage de fond joué par un code non lu |
| 13105 | 3,1 s | voix de l'animation d'accueil (`SNDL` 1000) |
| 16000–16068 | 0,15–19,6 s | pistes des animations de récompense (`SNDL` `8000+50k` : 1 à 14 pistes chacune ; durées longues = chansons/voix, courtes = bruitages, hypothèse) ; `SCR` 9000 en enchaîne 14 |

Les indices exacts `SNDL` → animation sont dans les tables `SNDL` (un son par bruitage). Les voix « indices » n'existent pas : **aucune consigne parlée de puzzle** ; la parole est celle de Poly (§5.4).

## 5. Progression

### 5.1 Variables roster (`MWRoster`)

Une seule : `DS:5946` (u16, octet 5418 de l'enregistrement du joueur, voir engine.md §7.1), le **« Poly a déjà expliqué »** : `0` = jamais ; mis à `1` par `19f4`. `1048:1bf9` (définition de la variable) la remet à 0 à la création d'un joueur. À la sortie, `scene_sticklers_leave` appelle `1050:0302` (sauvegarde) seulement si `5944 ≠ 0` (cette visite a joué la longue explication). **Écart** : engine.md la présente comme « niveau/progression (hypothèse) » : c'est un drapeau d'aide.

### 5.2 Masque de réussites

**Rien n'est écrit** : aucun appel de `1010:3fdf` (écriture du masque `5×opération+niveau`) ni de `1078:0a55` depuis `1048`. Le suivi (Tracking, 1997) et le Hall of Fame ne comptent pas cette activité en v1. Niveau courant `592c` : non sauvegardé.

### 5.3 Sélecteur de niveau

Trois boutons (1–3) = niveaux vert/orange/rouge, puzzles libres d'accès (pas de déverrouillage). Pas de marque « déjà fait » sur les vignettes.

### 5.4 Aide de Poly (`19f4`, `0690`, `1ae5`, `1bc3`, `1c3c`)

Ouvre `POLLY.DAT`, remplace les groupes par un seul (`3286`, 4 sous-descripteurs `3246` Poly, `3256` fragments, `3266` boutons, `3276` chevalet : indice global 1 = Poly, `2..n+1` fragments, puis 7 boutons, puis le chevalet). Anim `30000` (Poly arrive, silencieux) puis `30100` (1re fois : 11 clips ≈ 18 s) ou `30250` (suivantes : 6 clips ≈ 8 s). Ensuite, **chaque élément cliqué** fait parler Poly (`0690`) : fragment `30900`, boutons de niveau `30650`, Help `30600`, Reset `30750`, Rotate `30800`, Exit `30500`, chevalet `30850` (menu affiché) ou `30550` ; encadré par `30150` (avant, sauf Exit/fragment) et `30200` (après, sauf Exit/Help). Si l'intro était la courte et que rien n'est cliqué pendant **300 ticks** (`594a`, tick case 2), `1bc3` joue la longue (`30100`). Cliquer Poly (indice 1) → `1ae5` : une interjection `32000 + 50 × rand(13)` (0,4–1,2 s), `30050` (Poly part), restauration des groupes et de la musique.
Le curseur « ? » (`1088:0e3a/0e48`) remplace la flèche au survol.

### 5.5 Sortie

Bouton 7 → `1048:0422` : curseur normal, `8732 = 0`, `Leave` (`0155`) : libère SHPL/SND/animation/préchargement, restaure l'archive, fondu de palette, `1b20 = 0` (retour au hub).

## 6. Clavier / souris

- **Espace** = Rotate (§1.5) ; aucune autre touche propre (`1048:1914`). Tab/Maj+Tab/Entrée : gadgets (engine.md §5.2). Ctrl+Q global.
- Souris : bouton gauche (ou celui qui a saisi, en mode glisser). Pas de bouton droit propre (`593e` mémorise le bouton ayant saisi).
- Préférence `02b8` : glisser ↔ cliquer-poser (§1.6). Préférence `2d64` : musique.

## 7. Différences avec le manuel 1997 (pp. 21–22)

Le manuel (v2 Deluxe) correspond au code v1 pour le fond : Puzzle Menu (9 images), Level Brothers (3), Exit, Help, Rotate, Reset, Sticky Easel, rotation par Espace, « Replay » en cliquant le puzzle fini. Différences/ajouts à noter :

- Le manuel place Super Sticklers au **niveau 1 / « Downstairs »** du hub (deux étages) ; la v1 n'a qu'un écran de hub (engine.md §8.1) : zone `6` (chevalet).
- Le manuel dit « drop the piece and click Rotate » : conforme (rotation du dernier fragment, §1.5), mais il ne dit pas que Rotate agit aussi sur un fragment non collé laissé sur le chevalet ni qu'il peut le coller.
- Le manuel ne décrit pas les trois niveaux de gabarit (§1.2), ni la tolérance de 10 px, ni la miniature rouge, ni l'aide interactive de Poly.
- « Preferences : mouse control » (1997) = `02b8` (glisser / cliquer-poser) ; v1 : variable présente dans le roster (engine.md §7.1, `u16 DS:02b8`), sans écran de préférences identifié.

## 8. Plan d'implémentation TS

Cibles : `src/games/mathemagique/logic/sticklers.ts` (pur, sans DOM/canvas), `src/games/mathemagique/scenes/sticklers.ts` (machine à états + rendu), tests `test/mathemagique/sticklers.test.ts`.

### 8.1 Module pur

```ts
parsePuzz(bytes): { count; templateX; templateY; pieces: {orientations: 1|2|4; x; y}[] }   // §2.1
puzzId(level, puzzle) = 2100 + 900*level + 100*puzzle        // puzzle 0..8
rewardId(level, puzzle) = 8000 + 50*(9*level + puzzle)
firstShapeIndex(level) = level === 2 ? 2 : 1                  // 0-based dans la SHPL
shapeBases(pieces, level): number[]                           // cumul des orientations
rotate(orientation, a) = (orientation + 1) & (a - 1)
layoutPieces(puzz, sizesOf, level, rng): Piece[]              // §1.4 (rng.next(n) ∈ [0,n[)
snapTarget(piece, easelRect): center | null                   // §1.1 point 4
isSolved(pieces) = pieces.every(p => p.placed)
```

`Piece = {id, shapeBase, placed, orientation, cx, cy, w, h}`. Cibles = `(x + w₀/2, y + h₀/2)` avec `w₀,h₀` de l'orientation 0 (`>> 1`, division entière).

### 8.2 Machine à états de scène

`MENU(level)` → clic vignette → `PLAY` (sous-états `IDLE`, `HOLD` avec bouton/mode de souris) → `SOLVED` (animation, puis `REPLAYABLE`). Transverse : `HELP` (Poly, désactive tout sauf Poly), `EXIT`. Boutons : 1–3 → `MENU`, 5 → re-layout (même rng), 6 → rotate, 4 → `HELP`, 7 → sortie.

### 8.3 Services moteur nécessaires

Lecteurs existants (`mohawk`, `shap`, `shpl`, `palette`, `scr`, `sndl`, `wave`) + : lecteur `PUZZ` (nouveau, trivial) ; blit 1 bit teinté (encre palette) ; poussée partielle de palette (entrées 154–185) ; lecteur d'animations `\0SCR` clippé à un rect avec cyclage de palette (hook 0) ; son WAVE/MIDI (musique 100 bouclée, préférence) ; hit-test pixel sur masque 1 bit ; roster (1 `u16`) ; Poly (`POLLY.DAT`) ; RNG `[0,n[`.

### 8.4 Tests (valeurs issues du code/données)

- `parsePuzz(2100)` : `n=8`, template `(40,29)`, pièces `[(1,49,41),(4,59,109),(4,122,52),…]`; `4700` : `n=15`, 98 octets ; longueur = `8 + 6n` pour les 27.
- `puzzId(1,2) = 3200`, `puzzId(2,8) = 4700`, `rewardId(0,0) = 8000`, `rewardId(2,8) = 9300` ; ids `SCR` 8000…9300 existent.
- Somme des orientations + `firstShapeIndex` = nombre de formes de la `SHPL` pour les 27 puzzles (déjà vérifié : égalité exacte).
- `rotate` : `a=4` : 0→1→2→3→0 ; `a=2` : 0→1→0 ; `a=1` : 0.
- `snapTarget` : tolérance 10 inclusive (`dx=10, dy=10` oui ; 11 non), orientation ≠ 0 non, déjà collé non, coin hors `(17,6,313,302)` non.
- `layoutPieces` : centres dans `(295,2,575,379)` rétréci ; niveau 2 : aucun chevauchement avec `(295,25,395,125)`.

## 9. Questions ouvertes

1. Lecture des sons `2020`–`2023` (`594e`) et `2011` : non trouvée dans `1048` (probablement dans `1088:10d2`/`18c6` ou le gestionnaire de gadgets).
2. Rôle des sons `2000`–`2003` (tableau `8490`) et de `SND` 101 ; sémantique exacte de `1038:01af` (construction des boutons, animation « appuyé »).
3. Nature des transitions `1018:09b8(…15|30…)` et de `10d8:66d1` (effacement du chevalet : couleur ?).
4. Valeur exacte du « 4 » de l'entrée de groupe d'aide (`328a`), des drapeaux `0x2068/0x8040/0xc000`, des sous-descripteurs `3256–3276` (hypothèse du §5.4 : indice global).
5. Rôle de `SND` 16000–16068 (voix ou bruitages) : à écouter ; rôle de `SCR` 1000 vs boutons.
6. Rendu exact de l'empilement après redessin (§1.6).
7. Existence d'un écran de préférences pour `02b8`/`2d64` (v1) ; critère du « cas grand fragment » niveau 2.
8. Copy visible nouvelle : aucune dans cette activité (aucun texte) ; la localisation éventuelle concerne l'audio. Toute copy ajoutée (ex. libellés d'accessibilité des boutons) est « à valider ».

## Écarts avec engine.md / re-index.md

- engine.md §9 : `PUZZ` Stickler « 56 octets » : c'est la taille du premier (8 fragments) ; la taille varie de 50 à 98 octets (`8 + 6n`).
- engine.md §7.1 : `5946`/octet 5418 « niveau/progression (hypothèse) » : en réalité drapeau « intro de Poly vue » (§5.1).
- engine.md §8.4 : « 2100–4700 par 100 » exact ; précisé : `2100 + 900 × niveau + 100 × k`, niveaux = Level Brothers.
- engine.md §5.3 : Espace « hypothèse puzzle suivant / aide » : en fait **Rotate** (`1048:1509`).
- engine.md §8.2 : ids `20100`/`20250` pour Poly : `1048:19f4` pose `32de = 0x7594`/`0x762a` soit `30100`/`30250` (ids présents dans `POLLY.DAT`) ; à recouper avec le décalage d'id du descripteur.
- engine.md §2.4 : « SHPL 2000 + … » : en réalité `SHPL` 104 = fond, 2000 = boutons, 2020/2030/2040 = menus, 2100+ = puzzles, 1000 = accueil, 8000+ = récompenses.
