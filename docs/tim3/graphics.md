# The Incredible Machine 3 : rendu (vague R)

Code : `src/games/tim3/render/`. Tests : `test/tim3/render/`. Page de dev : onglet « Niveaux » de `ui/asset-viewer.ts` (boutons Démarrer et Remettre à zéro, un pas toutes les 32 ms, D10). Niveaux de certitude comme dans `formats.md` : **vérifié** (désassemblage de `TIMWIN.EXE` lu et rendu comparé à l'œil sur les niveaux), **supposé**.

## Pile de rendu (vérifié)

Surface 8 bits indexée (`Surface`), palette `TIM_NEW.PAL` (index 0 transparent des sprites), conversion en RGBA par une table de 256 couleurs (`Surface.toRgba`). `composeScreen` donne l'écran 640×480, `renderPlayfield` l'aire de jeu seule. Le rendu ne dépend que de l'état du `World` : même état, même image (testé). Aucun accès au navigateur dans `render/` ; la visionneuse fait `putImageData`.

| Fichier | Rôle | Adresses de l'exe |
| --- | --- | --- |
| `surface.ts` | tampon, rectangle de découpage, rectangle plein et contour, ligne de Bresenham, copie avec retournements | 457d18, 4570c8, 456270 |
| `palette.ts` | numéro de couleur logique → index de palette | 413388 |
| `assets.ts` | BMP, ANM, polices à la demande, avec cache | |
| `anm-draw.ts` | image d'un ANM : origine, retournements, commandes | 44b094, 44b548 |
| `parts.ts` | ordre et dessin des pièces | 42d5a8, 42d54a, 42da3e, 42deab, 42dcec, 43e74b, 445ce0, 442a75, 442ab8, 43cd22, 43cdfd |
| `ropes.ts` | cordes, câbles, courroies | 42db30, 42da79, 42d757, 42d667, 42d7a9, 43a1e8 |
| `screen.ts` | mise en page 640×480, barre d'outils, bac, barre de but | |
| `itf-draw.ts` | fenêtres `.ITF` : cadres `CORNERS.BMP`, libellés et boutons `SYS12.PFT`, images d'ANM, zones de texte | 421c91, 44e8e0, 45301c, 452ed0 |
| `text.ts`, `cursors.ts` | texte (FNT et PFT), curseurs | |

## Couleurs (vérifié)

- **Numéro de couleur logique** (413388) : négatif = l'index lui-même (opposé) ; 1 à 15 = index + 15 (16 à 30) ; 0 = 20 ; au-delà de 15, inchangé. C'est ce que prennent les rectangles et lignes des ANM, et le fond du niveau.
- **`backgroundColor` du LEV (1 à 11) est une couleur unie** : 431d3f le range en 0x481394, et 4354bf, 415c2a (redessin) et 4308c9 remplissent l'aire de jeu entière avec cette couleur logique avant de dessiner les pièces. Il n'y a ni fichier de fond ni motif. Valeur 3 (172 niveaux sur 206) = index 18 = bleu ciel (123, 159, 255) ; 1 = violet, 2 = vert, 4 = rouge, 5 = noir, 6 = orange, 7 = gris, 8 = gris foncé, 9 = bleu, 10 = vert vif, 11 = bleu clair. Les 6 LEV sans champ (versions 0x111 et 0x112) : 3 par défaut (supposé).
- Les « fonds » qu'on voit (briques, ville, aquariums) sont des **décors** (types 110 à 280, plans 7 et 8), pas un fond.
- Les index 0 à 15 de la palette sont du magenta : les couleurs logiques 1 à 15 sont la seule porte d'entrée vers 16 à 30.

## Images d'ANM et retournements

- **Pièce** (42deab) : image `frame` de l'ANM du type, dessinée à `px, py` (pas `drawX/drawY`). Le retournement vient de `flags10` (**0x10 = miroir gauche-droite, 0x20 = haut-bas**, vérifié par 42deab) ; il décale l'origine de `forme − x0 − l0` (rectangle de l'image 0), puis 44b094 symétrise le rectangle de l'image dans la zone de l'ANM (`largeur − x − l`), puis 44b548 symétrise chaque commande dans l'image. Seuls les pixels d'une commande bitmap sont retournés par son propre champ `flip`, pas sa position.
- **Champ `flip` d'une commande bitmap : bit 0 = vertical, bit 1 = horizontal** (établi sur les données : dans `PART91.ANM` la lentille du laser vers le bas est posée à y = 42 − 7 − 12, symétrique de celle du laser vers le haut ; les moitiés de visage de `PROFESR2` utilisent le bit 1). **Douteux** : l'exe fait XOR ce champ avec le retournement de la pièce, et 4555c8 semble traiter le bit 0 en horizontal. Le port garde l'axe « données » pour la commande et X = bit 0 pour la pièce. À confirmer sur une pièce retournée dont le dessin n'est pas symétrique (`anm-draw.ts`, constantes `CMD_FLIP_*`).
- Rectangle (commande 3) : plein si le bit 15 de `fill` est levé (couleur = octet bas), contour dans `color`. Ligne (4) : Bresenham. Sons (5, 8) ignorés.

## Ordre de dessin (vérifié, 42d5a8)

9 plans, de 8 (fond) à 0 (devant). Octets +0x20 et +0x21 du descripteur (`f20`) : les deux plans du type (0xFF = aucun) ; la pièce est dessinée une fois par plan. Exemples : décors 7 (150 types), aplats et fonds 8, murs 4, balles 3, boîtes 5 ou 6 et 2, cordes et courroies 0. Dans un plan : les pièces posées en ordre inverse de leur liste, puis les mobiles en ordre inverse (les mobiles passent devant). Ignorées : sorties de l'aire (`flags10 & 0x2000`), en attente (`flags14 & 0x4000`) et, sans l'option d'affichage 2, les décors (`flags14 & 0x1000`) ; l'option 4 (`World.animFlags & 4`) commande les aplats. `World.animFlags` vaut 7 au démarrage.

## Taille et étirement (vérifié, 42dcec)

Pièces étirables : types 1, 46, 48, 56, 60, 82 à 85, 97, 118, 125 (murs, pentes, tuyaux, chenilles). Elles ne sont pas des images mises à l'échelle : ce sont des **tuiles** de la taille de l'image 0 de leur groupe.
- Groupe : le premier état (images 0 à n − 1) pour une pièce plus large que haute (`frameW ≥ frameH`), le deuxième (de l'image qui commence l'état 2 jusqu'au suivant) sinon. 44b19c donne l'état qui commence à une image.
- Nombre de tuiles = `largeur / tuile` (division entière, reste ignoré) : bord gauche (ou haut), motifs `1, 2, …, n − 2` en boucle, bord droit (ou bas).
- Retournement d'une pièce étirable (0x10 ou 0x20 indifféremment) : miroir en Y pour une pièce horizontale, en X pour une verticale, appliqué à chaque tuile ; les tuiles ne sont pas déplacées.
- **Aplats** (types 121 à 124, 203, 205, 271, 280, 43e74b) : l'image 0 répétée sur le rectangle de la pièce, calée sur une grille de la taille de l'image à partir de l'origine de l'aire, découpée au rectangle.
- **Seaux** (11, 17, 108) : plan arrière = image 0, plan 2 (devant) = image 1 (image 90 pour le seau percé).
- **Avant au plan 0** (types 37, 71, 77, plans 4 et 0 ; le slot 6 de chaque type choisit l'image selon le plan avant d'appeler 42deab) :
  - boîtes programmables 71 (445ce0) : plan 4 = image courante, plan 0 = image + 5 (l'avant : vitre, cadre, osier, grille) ; le contenu (plan 3, une boule par exemple) est donc **dans** la boîte. La caisse en carton (image 4) n'a pas d'arrière : rien au plan 4, image 4 au plan 0 ;
  - taille-haie 37 (442a75) : plan 0 = première image de l'état 0xB (0x481e6c, image 4 : la lame seule) si l'image courante est avant elle (comparaison non signée), rien sinon ;
  - cisailles 77 (442ab8) : plan 0 = première image de l'état 5 (0x481e7c, image 1 : la lame seule) si l'image courante est 0 (ouvertes), rien sinon.
  Les deux globales sont remplies par 442800 (slot 2) avec 44b2c0 ; le port les recalcule depuis l'ANM.
- Tailles de pièce (`frameW`, `frameH`, `shapeW`…) : lues dans le `Part` du moteur (`updateSizes`) ; la taille d'une pièce du LEV vient de `width2/height2`.

## Faisceaux des lasers (vérifié sur le désassemblage, rendu relu sur TLEV28, HLEV8, RLEV19)

Slot 6 des lasers 91, 92, 93 et du mélangeur 95 = **43cd22**, plan 3 seulement (descripteur 0xff03) ; `parts.ts`, `drawLaser` / `drawBeam`.
- **Corps** : 42deab (image courante). Lors d'un redessin partiel (0x481d2c ou animations décoratives 0x481034 & 1), l'exe saute le corps d'un laser allumé dont l'image n'a pas changé (+0x18 = +0x1C) ; sans objet pour un redessin complet. Sinon il passe par 42d934 (découpage du redessin partiel), puis dessine le faisceau.
- **Faisceau** : seulement si +0x24 ≠ 0 (allumé ; pour 95, les faisceaux reçus). Pour i de 0 à +0xFC − 1 (tronçons posés par la passe 43d013), une ligne de Bresenham 4570c8 du point i au point i + 1 du tampon +0x90 (points tracés par 43ce78, réfléchis par les miroirs 94) ; le dernier tronçon s'arrête au point d'impact (+0x54, +0x58) sauf si +0x54 = −0x1000 (rien de touché, faisceau jusqu'au bout du tronçon). Ligne d'un pixel, sans retournement ; coordonnées du tampon telles quelles (l'exe y a déjà retiré 0x481580).
- **Couleur** (43cdfd, puis 413388) : couleur logique 12 pour 91 (rouge), 10 pour 92 (vert), 9 pour 93 (bleu) ; pour 95, table **0x477d64** indexée par +0x24 (bits 4 = 91, 2 = 92, 1 = 93) : {0, 9, 10, 11, 12, 1, 14, 15}, soit 91 + 93 → 1, 92 + 93 → 11, 91 + 92 → 14, les trois → 15 (blanc). Ces couleurs concordent avec la lentille du mélangeur et l'image de la prise 96 qui répond.
- Champs du moteur lus : `Part.beam` (+0x90), `f24`, `fFC`, `vx`/`vy` (+0x54/+0x58), posés par `laserPass` (`engine/parts/mechanics/laser.ts`). Avant la première passe (pas 0), +0xFC = 0 : aucun faisceau, comme l'exe.

## Cordes, câbles, courroies (vérifié sur le désassemblage, pas encore vu animé)

Tracés comme des **lignes**, pas des sprites (`ropes.ts`).
- **Ligne de corde** (42d7a9) : trois lignes de 1 pixel, décalées de −1, +1 puis 0 en Y (ligne peu inclinée) ou en X (plus verticale que horizontale). Cinq teintes selon la couleur courante (0x84 à 0x88, table à 0x42d7dd) : {côté −1, centre, côté +1} = 0x86 corde {6, 14, 13} (orange, jaune, brun), 0x85 câble {8, 7, 5}, 0x84 courroie {7, 8, 5}. Toute autre couleur : ligne dans la couleur de fond (effacement), non rendue ici.
- **Flèche** (42d757, 42d667) : mou = longueur de la corde (`fFC` de la pièce corde pour le premier bout, `f104` pour le dernier) − distance approchée (plus grand écart + 3/8 du plus petit, 43a0dc). Si le mou dépasse 4, **Bézier quadratique à 16 segments**, point de contrôle = milieu abaissé du mou, différences finies comme l'exe (17 points, chaque segment est une ligne de corde) ; sinon ligne droite.
- **Corde** (42db30) : de la première pièce attachée à la dernière, par les poulies (7) ; couleur 0x86 (type 10) ou 0x85 (câble, 76) ; **nœud** = image 0 de l'ANM de la corde à (extrémité − 8, − 7), sauf contre une poulie ou une pièce de type 0x31. Les extrémités sont `RopeData.ends` (+0x24 … +0x30) du moteur, et celles d'une poulie `ends[2..3]` (début) et `ends[0..1]` (fin) de sa propre structure.
- **Courroie** (42da79) : deux brins droits, `BeltData.pos` = {p0 → p1} et {p2 → p3}, couleur 0x84.
- **Limites** : le mou d'une corde qui traverse des poulies est calculé comme pour une corde droite (43a1e8 distingue d'autres cas) ; tant que le moteur ne met pas à jour `ends` et `pos` (438db6, 438c70 non portés au moment de la vague R), les cordes et courroies sortent de l'état de chargement (positions d'attache) et les tests de somme de contrôle les évitent.

## Mise en page 640×480 (choix du port, supposé pour les positions)

- Le jeu d'origine écrit ses fenêtres dans un espace de 640×400 : bac = image 1 de `PARTSBIN.ANM` en (560, 0), 80×377 ; barre de but = image 1 de `GOALBAR.ANM`, 640×64 ; boutons de `WTOOLBAR.ITF` de 40×34, jointifs sur 640 de large (y = 66 dans leur fenêtre) ; `CNTRLPNL.ANM` = ancien panneau vertical de gauche (non utilisé). `TIMWIN.INI` (aire 568×378 en (7, 68), bac 432×663) décrit une fenêtre de 1024×768.
- Le port : barre d'outils en haut (0 à 34), aire de jeu 568×378 en (0, 36), barre de but en (0, 414). **Le bac recouvre les 8 derniers pixels de l'aire** (comme dans l'ANM d'origine, où l'aire ne fait que 560 de large ; des murs de niveaux s'arrêtent à 568 : 61 niveaux). À valider dans la vague U (décalage, ou aire réduite à 560).
- Barre d'outils : 15 boutons (états « relâché » de `WTOOLBAR.ANM`, image 2 × état − 1 ; l'état « enfoncé » est l'image suivante, utilisé pour l'essai en cours). Les variantes de la zone 540 (solution, démonstration) et « fin de tour » (duels) ne sont pas dessinées.
- Bac : panneau, puis les pièces du bac empilées. **Icône d'une pièce au bac** (4171c9) : image `type` de la suite des images de `ICONS1.BMP` … `ICONS10.BMP` (28 + 27 + 28 + 27 + 22 + 32 + 25 + 29 + 36 + 27 = 281, une par type ; au-delà, la première), dessinée telle quelle (456270, sans retournement) ; ce n'est jamais une image de `PART<n>.ANM` (la courroie 8 n'en a aucune, la corde 49 et le type 127 n'ont pas d'ANM, et l'image 0 des autres est le sprite en taille réelle, souvent plus large que la colonne). Icônes de 9 à 51 pixels de haut, jusqu'à 56 de large (64 pour le type 26). **Mise en page (417264, vérifié)** : la fenêtre du bac de TIMWIN est une vraie fenêtre Windows (procédure 417ada, style 0xb40000 : cadre épais, barres de défilement), redimensionnable, avec une barre de titre maison de 27 pixels (0x47c500 ; au Labo, onglets de catégorie de 30 pixels, 0x471f90) ; taille hors tout selon l'écran (table 0x471f9c : 56 × 433 en (580, 5) en 640×480, 432 × 663 en 1024×768), PARTSBIN.ANM/ITF n'y sont pas utilisés. Les cases s'empilent **en colonnes** : première icône en (8, 8), puis y += h + marge ; quand y + h + 8 ≥ hauteur de la fenêtre, colonne suivante (x += la plus large case de la colonne, y = 8), et les icônes de la colonne terminée sont centrées dans cette largeur ((l − w) / 2). Marge = 4, + 12 avec le nombre (en largeur comme en hauteur), pas de nombre dans les modes 1 et 6 (palette illimitée, Labo). Un type sans icône n'a pas de case. Contenu = 8 + somme des colonnes (0x47c518). Le code prévoit aussi un rangement en lignes (0x47c514 = 0, défilement vertical) mais 416f1d met toujours 0x47c514 à 1 : seul le rangement en colonnes sert. Défilement (417fff, WM_HSCROLL) : flèches ± 16 pixels, page ± largeur de la fenêtre, curseur, début, fin ; borné à 0 … contenu − largeur. Barre : `SetScrollRange(0, contenu − largeur)`, donc cachée quand tout tient ; jamais grisée (pas d'`EnableScrollBar`). Pas de molette (aucun WM_MOUSEWHEEL). Clic (41812b) : rectangle de l'icône seule, décalé du défilement ; en puzzle, la première pièce du bac de ce type est prise et la mise en page est refaite (417264 avec 0 : le défilement est gardé, sans être borné ; une case vidée disparaît, les suivantes remontent ; une pièce rendue retrouve sa place dans l'ordre 417133) ; au Labo, rien n'est refait. Le défilement revient à 0 aux chargements (417264 avec 1). Nombre (4183e7) : « %d » en `MEMOFNT8.PFT`, couleur 0x14 (413388), en (x + l/2 − 6, y + h − 3) depuis le coin de l'icône, affiché même pour 1 ; l'original ne marque pas la case survolée. **Port** (`render/screen.ts` : `binLayout`, `binScrollStep`, `drawBinSlots` ; `drawBinOverlay`) : même règle dans une fenêtre de 80 × 247 (largeur du panneau `PARTSBIN.ANM`, hauteur de `PB_LIST`, à y = 117), rognée à l'intérieur du cadre (564 … 636) : une colonne de la plus grande case (8 + 72) tient sans défiler. Choix du port : les flèches `PB_LEFT` / `PB_RIGHT` calent la colonne voisine à la marge (pas de barre ni de page), s'allument (états 5 et 6) quand on peut défiler de ce côté ; le défilement est borné à chaque mise en page ; la zone de prise est toute la case (colonne × icône + marge), plus large que l'icône, pour le doigt ; cadre blanc sur la case survolée à la souris. TLEV3 : une colonne ; HH17 (32 cases) : 7 colonnes ; Labo (143 types) : 27 colonnes. 42d26c dessine aussi l'icône de la pièce 0x481194 centrée sur le pointeur, depuis la boucle 432e05 quand le compteur 0x481590 n'est pas nul (usage exact à établir ; `ui/play.ts` dessine encore l'image 0 de l'ANM pour une corde ou une courroie tenue hors de l'aire, ce qui n'affiche rien pour la courroie 8 : `drawBinIcon` est prêt pour la remplacer).
- Barre de but : texte du but dans le cadre (rectangle plein de couleur 15 → blanc), police `GOALFONT.PFT`, noir. La version Windows n'y met pas de portrait du professeur (`GOALBAR.ITF` n'a que `GB_TAB`) ; les compteurs des duels ne sont pas dessinés.
- Professeur des fenêtres d'aide et de fin de catégorie (424089) : couleur logique 11 dans le contrôle, images de `PROFAMBT.ANM` ou `PROFSPCH.ANM` (corps puis bouche) **retournées de gauche à droite**, origine (x + `unknown12` − 396, y + `unknown14`) ; voir `ui.md` § Aide du professeur.
- Texte : FNT (1 bit) et PFT (8 bits, 0xFF = encre) teintés d'un seul index ; **PFT : le glyphe du code c est `glyphs[c − 1]`** (correction de `data/font.ts`, `firstChar` = 1). Pas de lissage ni de couleurs multiples.
- Curseurs : `CURSORS.BMP` (47 images), point chaud dans `CURSOR.RES`. Seul le sens de l'image 0 (flèche) est établi ; les images 1 à 3 sont des mains (supposé).

## Fenêtres `.ITF` (`itf-draw.ts`, lu dans TIMWIN.EXE)

- **Ordre** : les contrôles d'un ITF vont de l'avant vers le fond ; on les dessine à l'envers (le décor de la fenêtre est le dernier).
- **Décor** (genre 0, sans image, valeur < 20) : style de cadre (421d43). Valeur → première pièce de `CORNERS.BMP` / couleur du fond :
  0 → 0 / 15, 1 → 32 / 5, 2 → 40 / 5, 3 → 48 / 15 (PUZZSOLV), 4 → 8 / 15 (GENERIC), 6 → 56 / 7, 7 → 64 / 5, 8 → 72 / 5, 9 → 80 / 15,
  10 → 88 / 15, 11 → 16 / 15, 12 → 96 / 11, 13 → 104 / 15, 14 → 112 / 11, 15 → 120 / 9, 16 → 128 / 2, 19 → 136 / 9 ; 5 = texte
  du but (421ec1 : tampon 0x4811e8, alignement 0x400, lettres plates, couleur 5 ; le texte vient de l'appelant) ; 17 = zone vide,
  remplie par le rappel de dessin du contrôle (+0x5c, posé par 44f070 : animation d'INFO, aperçu de PROG, couleur du globe,
  professeur de BINSOLVE ; `ItfState.draw`) ; 18 = visite guidée (42b072(1), non portée : rien n'est dessiné).
- **Cadre** (44e8e0) : 8 pièces = coin haut gauche, bord haut, coin haut droit, bord gauche, bord droit, coin bas gauche, bord bas,
  coin bas droit. Fond (couleur logique, sauf −1) entre les coins haut gauche et bas droit, bords en mosaïque coupés avant le coin
  suivant, coins par-dessus.
- **Boutons à texte** (genres 1, 2, 3, 5 sans image, 421f11) : cadre pièces 16 (relâché) ou 24 (enfoncé), fond 15 ; texte 1 ou
  4 pixels plus bas.
- **Textes** (4213b9) : `2000 + valeur % 1000` dans `INTRFACE.RES` ; police `(valeur / 1000) % 10` (1 `SYS12.PFT`, 2 `10X10NOP.PFT`) ;
  style `valeur / 10000` si valeur > 10000, sinon 2 ; couleur 5. Style 2 (4136e7) : texte en 6 à (−1, −1), en 15 à (+1, +1), puis
  dans sa couleur ; style 3 (41375a) : 14 puis 15 ; autre : plat. Codes de tête (4217d7) : `~C`n couleur, `~S`n style, `~F`n police,
  `~JC` / `~JL` / `~JR` / `~JX`. Drapeaux (`0x302 ^ alignement`, 0x1000 par défaut) : 0x2 retour à la ligne, 0x100 bloc centré,
  0x200 centré en hauteur, 0x800 lignes à droite, 0x1000 lignes centrées. Mise en page 45301c : mots entiers, `\n`, seules les
  lignes entières qui tiennent ; le défilement d'une zone de texte (+0x28) est un nombre de lignes sautées.
- **Zones de texte** (genre 4, 4218d4) : cadre selon `valeur % 100` (table 0x421908, sauts 0x421918) : 2, 4, 15 → pièces 0x78,
  fond 9 (bleu) ; 14 → 0x70, fond 11 ; 5 → rectangle plein 15 ; 3 → pas de cadre, la zone du texte (x − 2, y − 1, l + 3, h + 2)
  remplie de 15 ; autre → 0x20, fond 5. Puis le texte dans le rectangle, la couleur et les drapeaux de l'ITF (1024, 1026, 1536 :
  0x400 = aligné à gauche), lettres plates. 4218d4 dessine BINSOLVE BS_TEXT (32007) même caché.
- **Valeurs dynamiques** (4213b9, `valeur % 1000`) : 98, 99 noms des joueurs (couleur 7 ou 15 selon le tour), 100 et 101 textes
  2103 et 2104, 102 couleur 14 ou 15, 116, 117, 120 et 193 format du texte appliqué à une valeur du jeu, 154 tampon 0x47e6f8,
  161 description de pièce (`INFO.RES` 7001 + type après la deuxième tabulation, couleur 15, alignement 0x400 et 0x200 tant que le
  texte n'a pas défilé), 162 nom de la pièce (0x47f5dc). Le port reçoit ces textes de l'appelant (`ItfState.texts`, `args`).
- **Défilement** (421c91) : le contrôle `[0x47f634]` saute `[0x47f638]` lignes ; 421b56 / 421b85 mesurent les lignes visibles et
  totales (`[0x47f63c]`, `[0x47f640]`, `ItfItem.lines`). La première ligne est toujours posée, même dans un cadre moins haut que la
  police (titre d'INFO, supposé).
- **Images** (`image = 1`, 410dcb) : image `valeur + décalage` (+0x4c) de l'état `valeur` de l'ANM, origine en (x + `unknown12`,
  y + `unknown14`). Le décalage est l'état du contrôle : interrupteur (423dca : 0 = marche, dernière image = arrêt), volume (423e18),
  flèche en cours d'animation. Enfoncé, sans décalage imposé : image suivante (supposé, comme la barre d'outils).
- **Rappels souris par genre** (table 0x47016c) : genre 0 → 44f0a8 (avance +0x4c modulo +0x48 à chaque appel ; le port ne s'en sert
  que pour les contrôles animés à chaque passe, drapeau 1) ; 1, 2, 5 → 44edbc ; 3 → 44efb0 ; 4 → 410154. **Flèches** (genre 5,
  44ee9d) : +0x4c avance à chaque passe tant que le bouton est saisi ; au bout de l'état, notification, puis image 1 si le bouton
  est tenu (répétition), image 0 sinon. La boucle des contrôles (4506f4) passe au plus toutes les 50 ms (412bec, `WM_ENTERIDLE`).
  Les reflets animés des boutons à image ne sont pas établis au-delà : non portés.
- **Réglettes** : horizontale (425a46) course = l(glissière) − l(bouton) − 10, bouton en x + v × course / max, glisser cranté
  (v = (gauche − x + l(bouton) / 2) × max / course) ; verticale (41cf20) course = h(glissière) − h(bouton), 0 en haut, glisser
  continu. Clic dans la glissière : bouton centré sous le pointeur ; sur le bouton : décalage gardé.
- **Grisé** : non trouvé (le jeu cache les boutons, drapeau 8 de 45064c) ; le port pose une trame d'un pixel sur deux à la couleur
  du fond de la fenêtre.

## Ce qui n'est pas rendu (ou douteux)

- Détails des types 30 (loupe), 127 (bloc de couleur), 136 (ordinateur de messages).
- Rectangle de découpage de 42d934 (pièces qui ne se recouvrent pas : redessin partiel) : sans objet pour un redessin complet.
- Effets (explosions, étincelles, feux d'artifice) : les pièces sont dessinées par leur image ; les sprites annexes (`SPARKS.BMP`, `FLAMES.BMP`, `LITENING.BMP`, `TWINKLE.BMP`) relèvent des handlers de la vague Φ2.
- Rendu comparé à l'œil à la mise en page attendue, jamais à une capture du jeu d'origine : les sommes de contrôle de `screen.test.ts` figent le rendu du port, pas celui de l'exe.

## Besoins signalés au moteur (aucun champ manquant à ce jour)

`Part.px/py/frame/flags10/flags14/shapeW/shapeH/frameW/frameH`, `Part.beam/f24/fFC/vx/vy` (lasers), `RopeData.ends`, `BeltData.pos`, `World.animFlags`, `World.statics/mobiles/bin`, `TypeDescriptor.f20`. À maintenir tels quels : le rendu en dépend.
