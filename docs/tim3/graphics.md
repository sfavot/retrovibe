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
| `parts.ts` | ordre et dessin des pièces | 42d5a8, 42d54a, 42da3e, 42deab, 42dcec, 43e74b, 445ce0, 442a75, 442ab8 |
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
- Bac : panneau, puis les pièces du bac empilées. **Icône d'une pièce au bac** (4171c9) : image `type` de la suite des images de `ICONS1.BMP` … `ICONS10.BMP` (28 + 27 + 28 + 27 + 22 + 32 + 25 + 29 + 36 + 27 = 281, une par type ; au-delà, la première), dessinée telle quelle (456270, sans retournement) ; ce n'est jamais une image de `PART<n>.ANM` (la courroie 8 n'en a aucune, la corde 49 et le type 127 n'ont pas d'ANM, et l'image 0 des autres est le sprite en taille réelle, souvent plus large que la colonne). Icônes de 9 à 51 pixels de haut, jusqu'à 56 de large (64 pour le type 26). Mise en page (417264) : case = icône + 4, + 12 pour le nombre de pièces sauf dans les modes 1 et 6 (palette illimitée) ; cases en lignes dans une fenêtre défilante, centrées dans leur ligne. Nombre (4183e7) : « %d » en `MEMOFNT8.PFT`, couleur 0x14 (413388), en (x + l/2 − 6, y + h − 3) depuis le coin de l'icône, affiché même pour 1. Le port empile les cases dans la colonne de `PB_LIST` (`binLayout`, `drawBinOverlay`, `RenderAssets.binIcon`) et laisse les icônes déborder sur le cadre (54 pixels de large seulement). 42d26c dessine aussi l'icône de la pièce 0x481194 centrée sur le pointeur, depuis la boucle 432e05 quand le compteur 0x481590 n'est pas nul (usage exact à établir ; `ui/play.ts` dessine encore l'image 0 de l'ANM pour une corde ou une courroie tenue hors de l'aire, ce qui n'affiche rien pour la courroie 8 : `drawBinIcon` est prêt pour la remplacer).
- Barre de but : texte du but dans le cadre (rectangle plein de couleur 15 → blanc), police `GOALFONT.PFT`, noir. Le portrait du professeur, les indices et les compteurs des duels ne sont pas dessinés (vague U).
- Texte : FNT (1 bit) et PFT (8 bits, 0xFF = encre) teintés d'un seul index ; **PFT : le glyphe du code c est `glyphs[c − 1]`** (correction de `data/font.ts`, `firstChar` = 1). Pas de lissage ni de couleurs multiples.
- Curseurs : `CURSORS.BMP` (47 images), point chaud dans `CURSOR.RES`. Seul le sens de l'image 0 (flèche) est établi ; les images 1 à 3 sont des mains (supposé).

## Fenêtres `.ITF` (`itf-draw.ts`, lu dans TIMWIN.EXE)

- **Ordre** : les contrôles d'un ITF vont de l'avant vers le fond ; on les dessine à l'envers (le décor de la fenêtre est le dernier).
- **Décor** (genre 0, sans image, valeur < 20) : style de cadre (421d43). Valeur → première pièce de `CORNERS.BMP` / couleur du fond :
  0 → 0 / 15, 1 → 32 / 5, 2 → 40 / 5, 3 → 48 / 15 (PUZZSOLV), 4 → 8 / 15 (GENERIC), 6 → 56 / 7, 7 → 64 / 5, 8 → 72 / 5, 9 → 80 / 15,
  10 → 88 / 15, 11 → 16 / 15, 12 → 96 / 11, 13 → 104 / 15, 14 → 112 / 11, 15 → 120 / 9, 16 → 128 / 2, 19 → 136 / 9 ; 5 (texte
  global), 17 (rien), 18 (appel 42b072) ne sont pas portés.
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
- **Zones de texte** (genre 4) : rectangle, couleur et drapeaux de l'ITF (1024, 1026, 1536 = 0x400 avec 0x2 ou 0x200 ; 0x400 non
  décodé), style plat (supposé : le chemin de dessin du genre 4 n'a pas été suivi).
- **Images** (`image = 1`, 410dcb) : image de l'état `valeur` de l'ANM, origine en (x + `unknown12`, y + `unknown14`) ; les images
  suivantes de l'état défilent (44f0a8). Enfoncé = image suivante de l'état (supposé, comme la barre d'outils) ; le port ne fait pas
  défiler les reflets.
- **Grisé** : non trouvé (le jeu cache les boutons, drapeau 8 de 45064c) ; le port pose une trame d'un pixel sur deux à la couleur
  du fond de la fenêtre.

## Ce qui n'est pas rendu (ou douteux)

- Faisceaux des lasers (types 91 à 93, 95 : 43cd22, polyligne tracée pièce par pièce depuis une structure du moteur) ; les lasers eux-mêmes (corps) sont dessinés.
- Détails des types 30 (loupe), 127 (bloc de couleur), 136 (ordinateur de messages).
- Rectangle de découpage de 42d934 (pièces qui ne se recouvrent pas : redessin partiel) : sans objet pour un redessin complet.
- Effets (explosions, étincelles, feux d'artifice) : les pièces sont dessinées par leur image ; les sprites annexes (`SPARKS.BMP`, `FLAMES.BMP`, `LITENING.BMP`, `TWINKLE.BMP`) relèvent des handlers de la vague Φ2.
- Rendu comparé à l'œil à la mise en page attendue, jamais à une capture du jeu d'origine : les sommes de contrôle de `screen.test.ts` figent le rendu du port, pas celui de l'exe.

## Besoins signalés au moteur (aucun champ manquant à ce jour)

`Part.px/py/frame/flags10/flags14/shapeW/shapeH/frameW/frameH`, `RopeData.ends`, `BeltData.pos`, `World.animFlags`, `World.statics/mobiles/bin`, `TypeDescriptor.f20`. À maintenir tels quels : le rendu en dépend.
