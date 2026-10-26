# Armaeth : interface de jeu (barre d'icônes, curseur, souris, clavier)

Tâche R4. Étude des commandes de l'interface de `AM1.EXE` (Grandslam 1994) : la table d'outils `DGROUP:0bc2`, les trois pages d'icônes, l'objet curseur, la boucle de clic `1564:0004`, le clavier (`1023:0016`) et le protocole avec l'analyseur de commandes. Sources : décompilation et désassemblage de `archives/armaeth/re/` (`1564`, `1553`, `1504`, `1539`, `15f8`, `1023`, `2210`, `1e58`, `1db5`), octets de `AM1.EXE` (table lue à `DGROUP:0bc2`, pages à `DGROUP:0b86`), `A1FCFG.SYS` (objets `INT` de la salle 0) et `A1FINT.VGA` (rendu des 30 ressources et lecture de leur section d'animation). Les adresses sont des `segment:offset` Ghidra (segment de base `1000`, comme `engine.md`). `DGROUP:xxxx` est un offset du segment de données ; son image dans `AM1.EXE` commence à l'octet 224 624.

Confiance : **certain** = lu dans le code et recoupé par les données ; **probable** = déduit des appelants, des arguments ou des données ; **hypothèse** = lecture plausible non vérifiée. Les icônes n'ont **aucun libellé** dans le jeu (ni infobulle ni texte) : les noms ci-dessous sont des descriptions de l'image et le nom du verbe du dictionnaire que l'icône déclenche, pas du texte d'interface.

Documents voisins : `screens.md` (géométrie de l'écran de jeu, fenêtres), `engine.md` (objets, listes, déplacement), `parser.md` (analyseur, verbes, gestionnaires, file de messages), et, écrits en parallèle, `objects.md`, `characters.md`, `movement.md` (non cités ici sans nécessité).

## 0. Ce qu'il faut retenir

1. **L'interface est un système « outil actif + clic »** : cliquer une icône du haut choisit un **outil** (un verbe), dont l'image devient celle du curseur ; cliquer ensuite un objet de la salle, de l'inventaire ou du panneau de contenu **exécute ce verbe sur cet objet**, par le même chemin que la phrase tapée (gestionnaires de `parser.md` § 6.4, mais sans l'analyse du texte ni les boucles sur les candidats). L'outil **reste actif** après l'action.
2. **Le curseur par défaut ne fait rien dans la salle.** Pour marcher à la souris il faut l'outil « bottes » (icône 198) : clic gauche = marcher vers le point, clic droit = sortir par le côté visé. Le clavier (curseurs, Début/Fin/PgPrec/PgSuiv, `+`/`-`) déplace le héros sans outil (corrige `engine.md` § 8.1).
3. **Chaque icône d'outil a deux variantes** : sélectionnée au bouton gauche = image 0 et verbe 1 (par ex. regarder, prendre, ouvrir, allumer, manger, attaquer), au bouton droit = image 1 et verbe 2 (lire, mettre, fermer, éteindre, boire, tuer). La table `0bc2` a un enregistrement par couple (icône, variante).
4. **Objet « tenu »** : Ctrl + clic sur un objet de l'inventaire (si l'outil l'autorise) le prend au curseur ; il sert alors de complément (instrument, cadeau, contenant) au clic suivant. Il n'y a **ni glisser-déposer ni double-clic**.
5. **Clic = une action** : la fonction du curseur attend le relâchement de tous les boutons après chaque image (`1db5:01aa`), donc le monde est figé tant qu'un bouton reste enfoncé et rien ne se répète.
6. **Refus** : un clic qui n'a produit ni effet ni message déclenche une animation de quatre visages rouges sur le curseur (INT 1, Fig 1), pendant environ 21 images, clics ignorés.
7. Trois pages de dix icônes ; la troisième regroupe les commandes système (sauvegarde, restauration, sortie, continuer, recommencer, volume, score, musique, vitesse, pause).

## 1. Table des outils `DGROUP:0bc2` (35 enregistrements de 16 octets)

Lecture : `160c:000e` (clé = `Num` de l'outil actif + variante, lus dans le curseur : champs `+0x0C` et `+0x0E` de l'objet curseur ; abandon `gm_abort` si la clé est absente). Utilisée par `1564:0004` (liste à parcourir, clics dans le vide, points sensibles) et `1553:0004` (construction de la commande). Certain (octets lus et usages relus dans le code).

| Offset | Taille | Champ | Rôle | Lu par |
|---:|---|---|---|---|
| +0x00 | u16 | `Num` | numéro de l'icône (ressource `INT`) | `160c:000e` |
| +0x02 | u8 | `var` | variante : 0 = image 0 / bouton gauche, 1 = image 1 / bouton droit | `160c:000e` |
| +0x03 | u8 | `invDroit` | si 0 : un **clic droit** sans objet tenu **inverse** direct et indirect (voir § 5.4) ; 7 sinon | `1553:0004` |
| +0x04 | u8 | `verbe` | numéro du verbe (classe 22 du dictionnaire, 1 à 42), copié dans `DGROUP:4cba` ; 0 = aucun | `1553:0004` |
| +0x05 | u8 | `prép` | préposition (`DGROUP:4cbc`, codes 1 à 8 de `parser.md` § 4.2) : 1 dans, 3 sur, 7 avec, 8 à ; **n'est transmise que s'il y a un complément indirect** | `1553:0004` |
| +0x06 | u8 | `saisie` | 7 : **Ctrl + clic** sur un objet de l'inventaire le prend au curseur (§ 5.5) | `1564:065e` |
| +0x07..+0x0B | 5 × u8 | `L0..L4` | listes d'objets où chercher la cible, non nul = parcourue : L0 interface, L1 objets de la salle, L2 inventaire du héros, L3 contenu de l'objet sélectionné, L4 décors de la salle | `1564:06f1` |
| +0x0C | u8 | `points` | 7 : un clic sur un **point sensible** de la scène empile son message (§ 5.7) | `1564:07a0` |
| +0x0D | u8 | `vide` | 7 : traitement d'un clic **dans le vide** (outil bottes : marcher ; outil main « mettre » : poser) | `1564:084e` |
| +0x0E | u8 | `inverse` | 7 : direct = objet tenu ou sélectionné, indirect = objet cliqué (sinon l'inverse) | `1553:0004` |
| +0x0F | u8 | — | 0 partout | — |

Contenu décodé (octets de `AM1.EXE`). `L` donne les listes parcourues ; `P` = `points`, `V` = `vide`, `I` = `inverse`, `S` = `saisie`, `D` = `invDroit`.

| Num | var | verbe (n°) | prép | D | S | L0 L1 L2 L3 L4 | P | V | I | Usage |
|---:|---:|---|---|---:|---:|---|---:|---:|---:|---|
| 1 | 0 | — | — | 7 | 0 | 7 . . . . | 0 | 0 | 0 | **outil par défaut** (curseur) : seule l'interface répond |
| 2, 3, 4, 5 | 0 | 5 (regarder) pour 2, sinon 0 | 2 : dans | 0 ou 7 | 0 | . . . . . | 0 | 0 | 0 | **inutilisés** : `INT 2` à `INT 5` sont traités en dur dans `1564:0004` (§ 3.3), ces enregistrements ne sont jamais lus (probable) |
| 101 | 0 | regarder (5) | dans | 0 | 0 | 7 7 7 7 7 | 7 | 0 | 0 | œil : regarder (seul outil avec points sensibles) |
| 101 | 1 | lire (20) | — | 0 | 0 | 7 7 7 . 7 | 7 | 0 | 0 | parchemin : lire |
| 102 | 0 | prendre (6) | dans | 7 | 0 | 7 7 . 7 . | 0 | 0 | 0 | main, flèche haut : prendre (pas dans l'inventaire) |
| 102 | 1 | mettre (15) | dans | 7 | 7 | 7 7 7 . . | 0 | 7 | 7 | main, flèche bas : mettre / poser |
| 103 | 0 / 1 | ouvrir (3) / fermer (4) | avec | 7 | 7 | 7 7 7 . . | 0 | 0 | 0 | seau (deux images presque identiques) |
| 104 | 0 | allumer (1) | avec | 7 | 7 | 7 7 7 . . | 0 | 0 | 7 | torche allumée |
| 104 | 1 | éteindre (2) | — | 7 | 0 | 7 7 7 . . | 0 | 0 | 0 | torche éteinte |
| 105 | 0 / 1 | manger (11) / boire (34) | — | 7 | 0 | 7 . 7 . . | 0 | 0 | 0 | couverts / coupe |
| 106 | 0 | attaquer (21) | — | 7 | 0 | 7 7 7 . . | 0 | 0 | 0 | fouet |
| 106 | 1 | tuer (22) | — | 7 | 0 | 7 7 . . . | 0 | 0 | 0 | épée |
| 107 | 0 / 1 | embrasser (37) | — | 7 | 0 | 7 7 . . . | 0 | 0 | 0 | cœur (image unique) |
| 108 | 0 / 1 | donner (32) | à | 7 | 7 | 7 7 7 . . | 0 | 0 | 7 | cadeau (image unique) |
| 109 | 0 / 1 | parler (24) | à | 7 | 0 | 7 7 7 . . | 0 | 0 | 7 | bulle de dialogue (image unique) |
| 110 | 0 / 1 | nettoyer (26) | — | 7 | 0 | 7 7 7 . . | 0 | 0 | 0 | brosse ou éponge à étincelles (image unique) |
| 111 | 0 | pousser (19) | avec | 7 | 7 | 7 7 7 . . | 0 | 0 | 0 | deux personnages qui poussent |
| 111 | 1 | tirer (25) | — | 7 | 0 | 7 7 . . . | 0 | 0 | 0 | deux personnages qui tirent |
| 112 | 0 / 1 | briser (10) | avec | 7 | 7 | 7 7 7 . . | 0 | 0 | 0 | marteau (image unique) |
| 113 | 0 / 1 | porter (39) | — | 7 | 0 | 7 . 7 . . | 0 | 0 | 0 | visage au chapeau (variante 1 : chapeau enlevé, voir § 7, question 5) |
| 198 | 0 / 1 | — | — | 0 | 0 | 7 . . . . | 0 | 7 | 0 | **bottes : marcher** |
| 199 | 0 / 1 | — | — | 7 | 0 | . . . . . | 0 | 0 | 0 | inutilisé (échelle traitée en dur, § 3.3) |

Notes de lecture : (a) les verbes sont les **numéros de la table famille 0** de `parser.md` § 6.4 ; ceux de la table (5, 6, 15, 17, 20, 10) ont un gestionnaire propre, les autres (1-4, 11, 19, 21-26, 32, 34, 37, 39) tombent sur le gestionnaire par défaut et c'est le **gestionnaire de l'objet** qui agit ; (b) 108 et 109 ont `inverse` = 7 : le clic désigne le destinataire (indirect, préposition « à »), l'objet tenu est le direct ; (c) 101 gauche n'a pas `invDroit` : voir § 5.4 ; (d) les listes ne contiennent jamais L2 pour prendre (on ne prend pas ce qu'on porte) ni L3 pour les outils sans objet contenu.

## 2. Les trois pages d'icônes

Les objets `INT` de la salle 0 (`A1FCFG.SYS`, Typ 0, Xyp 1 au chargement, `P` = 204) sont tous créés d'avance. `DGROUP:0b86` donne **3 pages de 10 numéros** (mots) ; `15f8:000e` règle chaque objet de numéro ≥ 100 : sur la page courante `Xyp = 6`, `P = 0xCC` (204), image `Fig` rétablie ; hors page `Xyp = 6`, `P = 0xC4` (196), `Fig = 2` (image 1×1 transparente) et `+0x43` = 1. Un objet de `Fig = 2` est **ignoré par les clics** (`1564:0348`), sauf `INT 5`. Certain.

| Page | Numéros (ordre de la table) | Contenu |
|---:|---|---|
| 0 | 101 102 103 104 111 \| 109 106 107 198 199 | outils, famille « action » |
| 1 | 101 102 103 105 108 \| 112 113 110 198 199 | outils, famille « interaction » |
| 2 | 201 202 203 204 205 \| 206 207 208 209 210 | commandes système |

Les icônes se partagent dix emplacements (centre `x`, pied `y` = 15 : cases de `screens.md` 20×16 ; positions `A1FCFG.SYS`) :

| Emplacement (x) | 35 | 59 | 83 | 107 | 131 | 188 | 212 | 236 | 260 | 284 |
|---|---|---|---|---|---|---|---|---|---|---|
| Page 0 | 101 | 102 | 103 | 104 | 111 | 109 | 106 | 107 | 199 | 198 |
| Page 1 | 101 | 102 | 103 | 105 | 108 | 112 | 113 | 110 | 199 | 198 |
| Page 2 | 202 | 204 | 201 | 205 | 203 | 207 | 206 | 208 | 209 | 210 |

(Les `x` du fichier ont parfois un pixel d'écart : 82, 106, 130, 211, 235, 259.) 101, 102, 103, 198 et 199 sont communes aux pages 0 et 1 ; 198 et 199 sont aux emplacements 9 et 8.

**Changement de page** : clic sur `INT 3` (le magicien, `x = 312`, `y = 22`) : clic gauche **+1**, clic droit **-1** (les deux boutons : +1), modulo 3 (`1564:0470` → `15f8:000e`). Le numéro de page est dans le champ `+0x2D` de `INT 3` (sauvegardé avec le monde : la page est conservée par une restauration ; `15f8:000e(0)` à la fin du chargement). `15f8:000e` se termine par `1539:0084` : **changer de page remet l'outil par défaut**. Certain.

### 2.1 Les icônes une à une

Images décrites d'après le rendu des ressources `INT` (tailles en pixels, `l×h`). « Condition » : en plus de « aucun script en cours » (`DGROUP:4b34 = 0`) qui vaut pour tout clic. Un outil est **actif** jusqu'au prochain choix d'outil, au clic sur l'emblème, à un changement de page ou à un chargement.

**Outils** (pages 0 et 1) : le clic sur l'icône choisit l'outil ; l'icône prend l'image de la variante (Fig = 0 pour le bouton gauche, 1 pour le droit) ; le curseur et l'indicateur d'outil (`INT 4`) prennent cette image ; l'objet tenu est lâché. Aucune condition (même sans héros). Les actions sont décrites au § 1 (table) et au § 5.

| N° | Image 0 / image 1 | Taille | Verbe gauche / droit | Remarque |
|---:|---|---|---|---|
| 101 | œil / parchemin | 16×7 / 10×10 | regarder / lire | seul outil qui déclenche les points sensibles ; clic droit sur un objet = **regarder dans** (§ 5.4) |
| 102 | main, flèche vers le haut / main, flèche vers le bas | 14×10 / 15×10 | prendre / mettre | clic droit dans le vide avec l'outil « mettre » : pose l'objet tenu |
| 103 | seau / seau | 9×12 / 9×11 | ouvrir / fermer | « avec » : l'objet tenu est l'instrument (clef) |
| 104 | torche allumée / torche éteinte | 9×11 / 8×12 | allumer / éteindre | allumer : direct = objet tenu, indirect = cliqué |
| 105 | couverts / coupe | 10×12 / 8×10 | manger / boire | pas de cible dans la salle (L1 absent) |
| 106 | fouet / épée | 7×12 / 7×13 | attaquer / tuer | |
| 107 | cœur | 12×9 | embrasser | image unique |
| 108 | cadeau | 13×10 | donner (à) | direct = objet tenu, indirect = destinataire |
| 109 | bulle et visage | 14×12 | parler (à) | |
| 110 | brosse ou éponge à étincelles | 13×9 | nettoyer | image unique ; **n'est pas « feu »** (corrige `screens.md`) |
| 111 | personnages qui poussent / qui tirent | 15×12 | pousser (avec) / tirer | |
| 112 | marteau et éclats | 12×11 | briser (avec) | image unique |
| 113 | visage au chapeau / chapeau détaché | 9×8 / 9×12 | porter | les deux variantes donnent le verbe 39 (question 5) |
| 198 | bottes | 16×10 | marcher | image unique ; clic gauche = marcher, clic droit = sortie (§ 5.6) |

**Actions directes** (clic sur l'icône, aucun changement de curseur ; `1564:0004` branche sur le `Num` du clic) :

| N° | Image | Taille | Action | Adresse | Condition |
|---:|---|---|---|---|---|
| 199 | échelle : flèche haut / bas | 7×11 | gauche : `Ver = -1` (monter) ; droit : `Ver = +1` (descendre) ; un second clic dans le même sens arrête (`Ver = 0`) ; ferme ensuite le panneau de contenu s'il est ouvert (`1664:0004(0,0)`) | `1564:04ae` | héros présent (sinon `S16`/`S49`) **et** `DGROUP:4b50 ≠ 0` ; équivalent des touches `-` et `+` |
| 201 | disquette noire | 11×12 | sauvegarder | `23a2:0474` | — |
| 202 | disquette à languette rouge | 16×13 | restaurer | `23e9:000e` | — |
| 203 | panneau « EXIT » | 15×10 | **terminer** : `14cf:000c` (score) puis `1503:0000` (conseils `CM4`, sortie) | `2404:0002` | aucune confirmation, aucun retour |
| 204 | personnage rayonnant | 15×13 | continuer (ressusciter ou rejoindre le héros) | `23ee:000a` | — |
| 205 | visage souriant | 13×11 | recommencer | `23e9:0016` | — |
| 206 | deux notes | 12×11 | volume : gauche = -1, droit = +1 (`2fec:0000` : réactive la musique puis ajoute le pas au volume maître, bornes 0 à 63) | `2fec:0000` | — |
| 207 | tas d'or | 14×10 | score | `23f0:0010` | — |
| 208 | une note | 9×8 | musique marche / arrêt (bascule `DGROUP:529A`) | `2fe0:0026(0)` | — |
| 209 | plume bleue | 11×10 | vitesse : gauche = `4b51 - 1` (plus rapide, plancher 0), droit = `4b51 + 1` (plus lent, plafond 250) ; remet `4b52 = 0` | `1564:0570` | équivalent d'Alt-Z / Alt-A |
| 210 | sablier / sablier retourné | 10×11 | **pause** : bascule `DGROUP:4b53` (0 ↔ 7) ; l'image suit l'état (Fig 0 = marche, 1 = pause) | `1564:05a4` | équivalent d'Alt-P / Alt-N |

Effet visuel commun à toutes les icônes cliquées : une icône à deux images prend l'image 0 si le clic est gauche, 1 si le clic est droit (`1564:0435..045a`, `1a37:0002(Fig)`). Pour 210 l'état de pause force cette image. Certain pour les adresses, probable pour le sens de 206 (la variation du volume est lue d'après `2fec:0027`, voir question 4).

## 3. Objets d'interface autres que les icônes

| Objet | Position (x, pied y) | Taille | Rôle |
|---|---|---|---|
| `INT 1` | (160, 12) au chargement, puis suit la souris | 6 images (10×11 puis 4 × 11×11, 1×1) | **le curseur** (Gst 7, procédure `1564:0004`, `P = 250`) |
| `INT 2` | (8, 22) | 11×24 (elfe bleue) | bouton « salle » (§ 3.3) ; sa procédure `1537:000e` le rend statique |
| `INT 3` | (312, 22) | 11×28 (magicien) | changement de page (§ 2) |
| `INT 4` | (160, 17) | 1×1 au repos | **indicateur d'outil** : reçoit une copie de l'image du curseur à chaque choix d'outil (`1539:000e`) ; clic = outil par défaut |
| `INT 5` | créés par `1611:01de` | 9×9, 12 images | joyaux (§ 3.4) |

### 3.1 Champs de l'objet curseur (certain, usages relus)

Le curseur est un objet de 144 octets comme les autres (`engine.md` § 6.1) mais plusieurs champs sont **réutilisés** :

| Offset | Nom du dump | Rôle pour le curseur |
|---:|---|---|
| +0x0C | `Ftn` | **`Num` de l'outil actif** (1 = défaut, 101 à 113, 198) |
| +0x0E | — | **variante** de l'outil (0 gauche, 1 droit) |
| +0x20, +0x21 | `Mc1`, `Mc2` | état du bouton gauche / droit |
| +0x2D | `Ego` | non nul pendant le **refus** (visages rouges) |
| +0x2E | `Fig` | image courante : 0 = pointeur ou image de l'outil, 1 = visages rouges (refus) |
| +0x32 | `Tim` | compteur de images du refus |
| +0x36 | `Nbr` | **`Ser` de l'objet tenu** (0 = aucun) |
| +0x38 | — | `Ser` de l'icône dont l'image est copiée |
| +0x54, +0x56 | `X`, `Y` | `X` = abscisse souris ; `Y` = ordonnée souris + moitié de la hauteur (le sprite est centré sur la souris) |
| +0x58 | `P` | 250 (`1539:0084`) ; 240 seulement entre `1539:011c` et `1539:0084` au chargement |
| +0x60, +0x61 | `Hor`, `Ver` | signe du dernier déplacement de la souris (aucun usage relevé) |
| +0x70, +0x72 | `Xc`, `Yc` | position brute de la souris à l'image précédente (réutilise les champs de la cible de trajet) |

### 3.2 Animation des ressources `INT` (établi sur `A1FINT.VGA`)

La section d'animation d'une ressource `INT` a **trois enregistrements**, indexés par `Fig` : `Fig 0` image de la variante gauche, `Fig 1` image de la variante droite, `Fig 2` image « cachée » (1×1). Chaque enregistrement pointe une séquence de mots `[n, pas…]`, un pas valant `(durée << 8) | image` (bit 0x80 de la durée présent sur certaines, sens inconnu). Exemples : `INT 1` Fig 0 pointe la séquence **en miroir** (`0x8100` : image 0 retournée, bit 0x80 = miroir) et non l'image 0 telle quelle (pointeur) ; Fig 1 = images 1 à 4 de durée 2 (les quatre visages rouges, boucle) ; Fig 2 = image 5 (1×1). `INT 5` : Fig 0 = images 0 à 3 (joyaux orange, durée 6), Fig 1 = 4 à 7 (verts), Fig 2 = 8 à 11 (bleus) : c'est pourquoi `1564:0348` laisse passer `Num 5` malgré `Fig = 2`. Icône à image unique (107, 108…) : Fig 0 et Fig 1 pointent la même image, Fig 2 la 1×1. Particularité vérifiée sur les données : `INT 3` Fig 2 vise l'image 1 alors que la ressource n'en a qu'une (le moteur ne le contrôle pas). Certain pour `INT` ; à reporter dans `graphics.md`.

### 3.3 Clics sur les objets spéciaux (liste L0, `1564:0358..04ab`, certain)

| `Num` cliqué | Effet |
|---|---|
| 2 (elfe) | héros requis (sinon `S16`/`S49`) ; vide les codes (`4dba..4dc8`) ; clic gauche : verbe **5 `regarder`** sans objet (= décrire la salle, message `L<salle>`, `parser.md` § 8) ; clic droit : verbe **42 `o`** (liste des objets de la salle) ; appelle directement le gestionnaire de verbe (famille 0) ; l'image s'inverse selon le bouton |
| 3 (magicien) | changement de page (§ 2) |
| 4 (emblème) | `1539:0084` : outil par défaut, objet lâché |
| 5 (joyau) | `1611:03fc` → `1611:01de` : crée un joyau de couleur `Fig` (gauche : 1, droit ou deux boutons : 0), décale la palette (`1611:0164`) ; **inaccessible en jeu** (§ 3.4) |
| 199 | échelle (§ 2.1) |
| 201 à 210 | commandes système (§ 2.1) |
| 101 à 113, 198 | choix d'outil (§ 4) |

### 3.4 Joyaux `INT 5` : effet quasi inaccessible (probable)

`1611:01de` est appelé par `1611:03fc` (clic sur un joyau), `1611:0256` et `11dc:000c`, c'est-à-dire par les jetons `sl1`, `sl2`, `sl3` du groupe 9 (`parser.md` § 11). **Aucun de ces jetons n'apparaît dans `CM1` à `CM4`** (vérifié en les lisant) et la console `/jeton` ne laisse passer que le groupe 0 sauf `dgs` > 10 (`parser.md` § 11.2). Les joyaux ne sont donc jamais créés dans une partie normale. Sans effet à porter.

## 4. Le curseur : types et cycle de vie

Un seul objet (`INT 1`) dessiné avec `P = 250` (au-dessus de tout, `engine.md` § 6.4), centré sur la souris (X au centre, Y au pied = `y + hauteur/2`), plage de la souris `x 4..316`, `y 10..194` (`192e:0008` : `gm_mouse_set_hrange(4, 316)`, `set_vrange(10, 194)`). Sans souris (`DGROUP:4cac = 0`) l'objet curseur est **détruit** à l'initialisation (`1539:0084` → `19a6:01a5`) : tout se fait alors au clavier.

| Apparence | Quand | Image |
|---|---|---|
| **Pointeur** | état par défaut : début de partie, clic sur l'emblème, changement de page, chargement ; aussi après un choix de l'outil par défaut | `INT 1` image 0, 10×11, silhouette blanche ressemblant à un petit rongeur |
| **Image d'un outil** | après un clic sur 101-113 ou 198 ; conservée entre les actions (l'indicateur `INT 4` en garde une copie) | image 0 ou 1 de l'icône |
| **Objet tenu** | Ctrl + clic sur un objet de l'inventaire (§ 5.5) ; revient à l'image de l'outil après la première action qui réussit ou affiche un message, ou en cas de choix d'un autre outil | image de l'objet (`1539:000e`) |
| **Refus** | clic sans effet ni message : quatre visages rouges en boucle (`Fig 1`, durée 2), `Ego = 1`, 21 images (`Tim` 0 à 20) pendant lesquelles ni la souris ni les clics ne sont lus ; puis retour à l'objet tenu ou à l'image de l'outil, la souris est replacée sur la dernière position, et on attend le relâchement | `INT 1` images 1 à 4 |
| Aucun | sans souris | — |

Il n'y a **aucun changement de curseur au survol** (pas de curseur « actif sur objet », pas de texte flottant) et aucun curseur d'attente. Le curseur reste visible et mobile pendant un script, mais les clics sont ignorés. Il l'est aussi pendant la pause (la liste `INT` est mise à jour à chaque image, indépendamment du tic de monde). Certain pour le mécanisme, probable pour la durée du refus (21 images à 70 Hz, environ 0,3 s).

**Départ** : `192e:0008` termine par `15f8:000e(0)` (page), `1539:011c(160, 12, P = 240)` (souris au centre haut) puis `1539:0084` (outil par défaut : `Ftn = 1`, variante 0, objet tenu 0, `Gst = 7`, `Mob = 1`, `P = 250`).

## 5. Souris : la boucle de clic `1564:0004`

Procédure de l'objet curseur, appelée une fois par image par la boucle de la liste `INT` (`engine.md` § 4). Plan (certain, sauf mention) :

1. **Refus en cours** (`Ego ≠ 0`) : `Tim += 1` ; tant que `Tim ≤ 20` fin immédiate (le relâchement est attendu). Au 21e passage, l'image du curseur redevient celle de l'objet tenu (`+0x36`) ou celle de l'indicateur `INT 4`, la souris est replacée (`1539:011c`) et l'on attend le relâchement.
2. **Lecture de la souris** (`35cd:0006` : x, y, gauche, droit) : `Mc1`, `Mc2`, `X`, `Y`, `Hor`, `Ver` (§ 3.1). Pas de lissage, pas de file d'événements : un état par image.
3. Si un script tourne (`4b34 ≠ 0`) ou si aucun bouton n'est enfoncé : fin. **Les deux boutons ont le même rôle de déclencheur** ; leur distinction n'intervient que dans la variante de l'icône, la marche (§ 5.6) et l'inversion (§ 5.4).
4. Lire l'enregistrement de l'outil (§ 1), **vider la file de messages** (`1e58:00d8`), `4cc2 = 4cc4 = 4cc8 = 0` (compteur de succès, drapeau « bavard » des gestionnaires, réaction en attente).
5. Rectangle du curseur : `[X - Lar/2, X + Lar/2) × (Y - Hau, Y]` avec `Lar`, `Hau` de l'image courante du curseur (outil ou objet tenu) ; **le test est un recouvrement de rectangles**, pas un test de point (le « point chaud » est le centre d'une image de 7 à 16 pixels).
6. Pour `L = 0..4`, si `L` est parcourue par l'outil : (`L ≥ 1` sans héros : message `S16` si `4b67 = 0`, sinon `S49`, fin) ; parcourir la liste (§ 5.1).
7. Après les listes : points sensibles (§ 5.7), clic dans le vide (§ 5.6), réaction en attente `2363:0154` (hypothèse, `parser.md` § 6.7), puis soit message(s) à afficher / succès (curseur ramené à l'image de l'outil, objet tenu lâché), soit **refus** (§ 4).
8. Dans tous les cas, `1db5:01aa` : **attendre le relâchement de tous les boutons** (boucle bloquante sur la souris : le monde et l'affichage sont figés), `Err = 0`.

### 5.1 Ordre de test et liste parcourue

| `L` | Liste (adresse) | Décalage ajouté aux coordonnées de l'objet | Cibles exclues |
|---:|---|---|---|
| 0 | objets d'interface `INT` (`DGROUP:4c0e`, chaînage `Nxt` +0x84) | aucun | le curseur ; les icônes cachées (`Fig 2`, sauf `Num 5`) |
| 1 | objets (type 2) de la salle (`salle+0x22`, chaînage `Lis` +0x80) | origine `(x, y)` de la scène (`0xeac + 0x1e/0x20`) | le héros ; les objets invisibles (`219b:0000`, § 5.2) |
| 2 | contenu du héros (`+0x7C`) : inventaire | aucun | — (les cellules sont des objets `Xyp = 8`) |
| 3 | contenu de l'objet sélectionné (`4c12 + 0x7C`) : panneau de contenu | aucun | — |
| 4 | décors (type 1) de la salle (`salle+0x26`) | origine de la scène | les objets invisibles |

**Il n'y a aucun test par priorité d'affichage** (`P`) : l'ordre est celui des listes (0, 1, 2, 3, 4) puis celui du chaînage dans chaque liste (ordre de création). Le premier recouvrement ne gagne pas à lui seul : après chaque candidat, `1553:0004` renvoie 7 (succès) ou 0, et la politique `DGROUP:4cc6` (bit 0 du retour du gestionnaire de verbe interrogé avec `AX = 7`, `parser.md` § 6.5) décide :

- succès et politique **paire** (la plupart des verbes) : on passe à la **liste suivante** (un seul succès par liste) ;
- succès et politique **impaire** (`regarder` : 3) : on continue avec les **objets suivants de la même liste** (tous les objets sous le curseur sont décrits), sauf pour `L = 4` ;
- échec : objet suivant de la liste.

Conséquence : avec un outil à `L1` et `L4`, un objet et un décor superposés peuvent réagir tous deux au même clic.

### 5.2 Visibilité

`219b:0000(objet, héros)` : l'objet doit avoir `Inv (+0x2F) = 0` ; s'il est dans la salle courante, la salle ne doit pas être trop sombre (`197e:0272 = 0`, palette ≥ -40) ; sinon (objet hors salle) la lumière combinée `Lum(objet) + Lum(héros)` doit dépasser 31. Les objets invisibles sont sautés sans message. Voir `engine.md` § 7.5 et `parser.md` § 6.2.

### 5.3 Construction de la commande (`1553:0004`)

Pour chaque candidat atteint par le clic, `1553:0004(premier, cliqué, curseur)` construit la phrase :

1. **Premier objet** = l'objet tenu (`Ser +0x36` retrouvé par `1a7b:03d7`) ; pour `L3` c'est l'objet sélectionné ; sinon aucun.
2. **Direct / indirect** (champs `inverse` +0x0E et `invDroit` +0x03 de l'enregistrement, § 5.4) : par défaut direct = objet cliqué, indirect = objet tenu ; inversé si `inverse ≠ 0` ou, pour `invDroit = 0`, si le clic est droit sans objet tenu.
3. `4dba:4dbc` = direct, `4dbe:4dc0` = indirect (pointeurs lointains) ; `2210:011e` / `2210:021e` calculent le **code de nom** (`4dc2` / `4dc8`) : objet de type 2 → `15000 + Num` (classe 15) avec drapeaux (A = dans l'inventaire du héros, B = à portée, `2120:0075`) et recherche du gestionnaire de **famille 1** (direct) / **famille 5** (indirect) ; objet de type 1 (décor) → `4000 + Num` (classe 4), **pointeur effacé** (le décor n'est connu que par son nom, comme `regarder abeille` tapé).
4. `4cba` = verbe (champ +0x04), `4cbc` = préposition (+0x05) si un indirect existe, sinon 0.
5. `2210:0008` : interroge le gestionnaire de verbe (famille 0) pour la politique (`4cc6`), puis appelle **indirect, direct, verbe**, exactement comme `22fc:0002` (`parser.md` § 6.3) ; renvoie 7 si l'un réussit (`4cc2 += 1`).

Différences avec la phrase tapée (`22fc:0002`) : **pas de résolution de noms** ni de boucles sur plusieurs candidats (un objet à la fois) ; `4cc4 = 0` (**le message de réussite par défaut `V015` n'est donc pas affiché**, probable) ; pas de message d'incompréhension `S015` : si rien n'a été mis en file (`1e58:000a`) ni réussi, c'est le refus animé qui répond.

### 5.4 Inversion et clic droit (certain)

Condition (`1553:0004`) : le premier objet (tenu ou sélectionné) devient le **direct** et l'objet cliqué l'**indirect** si `inverse ≠ 0`, ou si le bouton droit est enfoncé, `invDroit = 0` et aucun objet n'est tenu. Seul l'outil 101 a `invDroit = 0`. Effets :

| Outil | Clic gauche sur l'objet X | Clic droit sur l'objet X |
|---|---|---|
| 101 variante 0 (œil) | `regarder X` | **`regarder dans X`** (direct vide, indirect X, préposition `dans`) : sélectionne X comme panneau de contenu si X est un conteneur à portée (`33b2:0007`, `1664:0004`) |
| 101 variante 1 (parchemin) | `lire X` | `lire` avec X en indirect, préposition 0 |
| 102 variante 1, 104 variante 0, 108, 109 (`inverse`) | tenu en direct, X en indirect (« mettre T dans X », « allumer T avec X », « donner T à X », « parler à X » si rien n'est tenu) | idem |
| autres | direct X, indirect = objet tenu (« ouvrir X avec clef », « pousser X avec T ») | idem |

C'est le chemin d'accès **aux conteneurs par l'interface** : outil œil, clic droit sur le coffre, puis clic dans le panneau de contenu avec l'outil « prendre » (L3, verbe prendre, préposition `dans`) ; probable pour la séquence complète, certain pour chaque maillon du code.

### 5.5 Objet tenu : Ctrl + clic (`1564:065e`, certain)

Sur un objet de l'inventaire (`L2`) : si l'outil a `saisie = 7` **et** qu'aucun objet n'est déjà tenu **et** que Ctrl est enfoncé (octet de statut clavier BIOS `0040:0017`, bit 2), l'objet est **pris au curseur** : `1539:000e` copie son image dans le curseur, `+0x36` = son `Ser`. L'objet ne quitte pas l'inventaire. Sinon l'objet est traité comme une cible ordinaire (L2). Au choix d'un autre outil, au clic sur l'emblème ou au changement de page, l'objet est lâché. Outils concernés : mettre, ouvrir, fermer, allumer, donner, pousser, briser (ceux qui ont un instrument ou un cadeau). **Pas de glisser-déposer** : le bouton enfoncé fige le jeu (étape 8).

### 5.6 Clic dans la salle avec l'outil « bottes » (198) et dans le vide

Seuls les enregistrements avec `vide = 7` traitent un clic qui n'a rien touché : l'outil **bottes** (`1504:0002`) et l'outil **mettre** (`1553:0004(0,0,0,0)` : poser l'objet tenu au sol, variante droite de la main seulement).

`1504:0002` (certain pour la structure, détails dans `engine.md` § 8.2) : héros requis ; si la salle est trop sombre (`197e:0272 ≠ 0`) : message d'obscurité et succès ; arrête le héros et ferme le panneau de contenu ; coordonnées relatives à la scène `(X - x0, Y - y0)` ; **clic gauche** : le point doit être dans les bornes de marche de la salle (`4ac8..4aca`, `4ace..4ad0`) et valide (héros placé provisoirement, `gm_object_behavior_main`), puis cible `Xc/Yc/Pc`, `gm_compute_path` ; succès si le trajet existe. **Clic droit** (`1504:0274`) : le point est rangé dans un des quatre **secteurs diagonaux** de la scène (haut 0, droite 1, bas 2, gauche 3), `DGROUP:4b94` = `{0, 1, 2, 3}` donne l'emplacement de sortie de la salle ; si la salle a une sortie là (`salle+10+2·slot ≠ 0`), `228e:0000` y envoie le héros. Un point invalide ou sans sortie = échec = refus animé.

### 5.7 Points sensibles de la scène (`1564:07a0..0834`, certain)

Seulement avec l'outil 101 (`points = 7`), quand la file est vide et qu'aucune réaction n'est en attente : le point brut de la souris `(Xc - x0, Yc - y0)` (le point, pas le rectangle du curseur) est testé contre les **enregistrements de 10 octets** de la scène (`DGROUP:4b14`, nombre `4b18`) : `{u16 code, x0, x1, y0, y1}` en mots signés, inclusifs. **Tous** les enregistrements recouverts empilent (`1e58:000a`, priorité 8, classe `'I'`, identifiant `code % 1000`) le message **`I<code mod 1000>`** (la description de l'élément de décor, codes 9nnn) ; la file garde 10 entrées au plus, sans doublon, et n'affiche que le plus haut niveau de priorité. Les enregistrements dont les quatre mots valent `0xFFFF` (428 sur 601 dans le jeu, `engine.md` § 5.2) ne sont **jamais** atteints par un clic (`-1 < x`). Les messages sont affichés ensuite par `1e58:009e` (une fenêtre par message, clic ou Entrée pour avancer). Sur les scènes de salles relues (233 enregistrements, 160 avec rectangle), 60 paires de rectangles se recouvrent : un clic peut afficher plusieurs messages à la suite.

### 5.8 Cas du double-clic, du glisser, du survol

- **Double-clic** : aucun code. Deux clics = deux actions.
- **Glisser** : aucun ; le seul « glisser » est Ctrl + clic puis clic (§ 5.5).
- **Survol** : aucun effet.
- **Molette / bouton du milieu** : non gérés (pilote INT 33h : gauche et droit seulement).
- **Pendant une fenêtre de message** : `1db5:003e` ignore l'interface (§ screens.md E9) : clic gauche ou droit, Entrée ou Échap ; la position de la souris est mémorisée puis rétablie.

## 6. Inventaire et panneau de contenu

- **Inventaire** (`1652:0006`) : les 12 premiers objets du héros (`DGROUP:4cb0 = 12`, constante) sont posés à `X = 28 + 24 k`, `Y = 195`, `P = 208`, `Xyp = 8` ; les suivants sont masqués (`Xyp = 0`) et **inaccessibles par la souris** (seuls F10 et les commandes tapées les atteignent). Il n'y a **aucun défilement** (la mention de `engine.md` § 8.2 est erronée).
- **Panneau de contenu** (objet sélectionné `4c12`, `1664:0057`, probable) : les objets contenus (au plus 96, `0x60`) sont rangés en grille de cellules 18×14 (+ 4 px d'espacement) : `lignes = ceil(n / 12)` (au plus 8), `colonnes = ceil(n / lignes)` (au plus 12), centrée horizontalement, haut à `y = 26` ; le fond est sauvegardé dans `A1FTMP.SCR` (`1664:0057` / `1664:06b6`). La sélection est posée par `1664:0004` (appelée par `regarder dans`, `33b2:0007`) et défaite par la marche, les touches de déplacement, l'échelle, la mort ou le départ du héros.

## 7. Clavier

Événements : `3588:0118` (`screens.md`, `parser.md` § 2.1). Répartiteur `1023:0016`, appelé à chaque image par `1023:000c` ; tout événement reconnu renvoie 7 et **force un tic de monde** (`engine.md` § 3). Les touches inconnues (`type 0`) sont ignorées. Certain (désassemblage relu, cas par cas).

| Type | Touche | Hors script | Pendant un script (`4b34 ≠ 0`) |
|---:|---|---|---|
| 1 | caractère imprimable, sauf ci-dessous | ouvre la ligne de saisie avec ce premier caractère (`1e22:0008(AX = c, DX = 2)`) | ignoré |
| 1 | `+` ou `=` | héros : `Ver` ← +1 (bascule : rappuyer arrête) | ignoré |
| 1 | `-` ou `_` | héros : `Ver` ← -1 (bascule) | ignoré |
| 1 | Espace (0x20), **Entrée** (0x0D), Retour arrière (0x08), Tab (0x09), Échap (0x1B) | ignorés : **Entrée n'ouvre pas la ligne** (les autres caractères, y compris les Ctrl-lettres, l'ouvrent) | ignorés |
| 2 | F1 | `2401:0002` aide (message `S21`) | idem |
| 2 | F2 / F3 / F4 / F5 / F6 | `23a2:0474` sauvegarder / `23e9:000e` restaurer / `23ee:000a` continuer / `23e9:0016` recommencer / `23f0:0010` score | bip (`3574:0072`) |
| 2 | F7 / F8 | `23fa:0006` / `23fa:003c` (débogage, actifs si `dgs` > 10) | F7 : rien ; F8 : `4b38 = 7`, `gm_cm_script_step(1)` (saute jusqu'au prochain `fin`) |
| 2 | F9 | rien | rien |
| 2 | F10 | `23f0:0008` inventaire (texte) | bip |
| 2 | Maj-/Ctrl-/Alt-F1..F10 (données 11-40) | ignorées | ignorées |
| 3 | Alt-A ou Alt-`-` | `4b51 + 1` (plus lent, plafond 250), `4b52 = 0` | **actif** (pas de test de script) |
| 3 | Alt-Z ou Alt-`=` | `4b51 - 1` (plancher 0), `4b52 = 0` | actif |
| 3 | Alt-P / Alt-N | `4b53 = 7` (pas à pas) / `4b53 = 0` (normal), `4b52 = 0` | actif |
| 3 | autres Alt-lettre, Alt-chiffre | ignorées | ignorées |
| 4 | Début, Fin, Haut, Bas, Gauche, Droite, PgPrec, PgSuiv (données 1 à 8) | **marche du héros** : `Hor`, `Prf` ← (-1,-1), (-1,+1), (0,-1), (0,+1), (-1,0), (+1,0), (+1,-1), (+1,+1) ; rappuyer sur la direction actuelle arrête ; `gm_reset_object_motion` puis fermeture du panneau de contenu | ignorées |
| 4 | Inser (10) | ouvre la ligne avec le rappel de la dernière phrase (`1e22:0008(AX = 0, DX = 4)`) | ignorée |
| 4 | Maj-Tab (9), Suppr (11), Ctrl-Début… (12-19) | ignorées | ignorées |

Conditions des déplacements (flèches, `+`, `-`) : héros présent (`4bfe`), `DGROUP:4b50 ≠ 0` (7 après `sys 3`, donc pas pendant les scripts de démarrage), aucun script. Sinon la touche est ignorée **sans ouvrir la ligne**. Pour un héros de classe de déplacement 4 (`Dep`, `engine.md` § 6.1), une touche horizontale annule aussi `Ver` et une verticale annule `Hor` (`1023:011f`, probable). Les flèches **remplacent** `Hor`/`Prf` (la vitesse verticale `Ver` est indépendante) : le héros continue à marcher jusqu'à ce qu'on l'arrête, il ne fait pas un pas par appui.

Pendant la ligne de saisie : automate `1e22:02c2` (`parser.md` § 2.3). Pendant une fenêtre de message : seuls Entrée et Échap (et les clics) avancent, les autres touches bipent (`screens.md` E9).

## 8. Protocole entre les icônes et l'analyseur

Les icônes **ne passent pas par `gm_parse_command` ni par `gm_execute_command`** : elles remplissent directement les emplacements de phrase puis appellent `2210:0008` (même moteur d'appel de gestionnaires, `parser.md` § 6.3-6.5).

| Emplacement (`DGROUP`) | Rempli par | Contenu |
|---|---|---|
| `4cba` | `1553:0004` | numéro du verbe (déjà « modulo 1000 » : l'analyseur le réduit lui aussi à ce stade) |
| `4cbc` | idem | préposition, uniquement s'il y a un indirect |
| `4dba:4dbc`, `4dbe:4dc0` | idem | pointeurs d'objet direct / indirect |
| `4dc2`, `4dc8` | `2210:011e`, `2210:021e` | codes de nom : `15000 + Num` ou `4000 + Num` |
| `4dc4`/`4dc6`, `4dca`/`4dcc` | idem | drapeaux A (dans l'inventaire du héros) et B (à portée) |
| `4cbe`, `4cc0` | — | non remplis (pas de liste de candidats) |
| `4cc2`, `4cc4`, `4cc8` | `1564:0004` | remis à 0 avant chaque clic |
| `4cc6` | `2210:0008` | politique du verbe, bit 0 relu par `1564:0004` (§ 5.1) |

L'icône `INT 2` (§ 3.3) est un cas à part : elle appelle le gestionnaire de verbe **directement** (famille 0, `AX = 0`), sans `2210:0008`, avec `4cba = 5` ou `42` et tous les codes de nom à 0.

**Commandes synthétisées = commandes tapées** : « prendre la clef » (outil 102 puis clic sur la clef) et `prendre clef` donnent le même appel `3371:000d` ; la différence est qu'un clic désigne **un objet précis** (pointeur), alors que le texte désigne un nom qui peut correspondre à plusieurs objets. Les gestionnaires par objet (famille 1 et 5, `parser.md` § 6.4) et les réactions (famille 9, `2363:000c`) s'exécutent à l'identique. Voir `objects.md` pour les gestionnaires par type d'objet.

## 9. Équivalents tactiles recommandés (port navigateur, sans décision)

1. **Un toucher = clic gauche** dans la salle, sur l'inventaire et sur la barre d'icônes. Traiter l'événement à l'appui (comme le jeu : action immédiate), ignorer la souris synthétisée qui suit le toucher, et ne prendre en compte un nouvel appui qu'après le relâchement (comportement de `1db5:01aa`).
2. **Appui long (environ 400 ms) = clic droit** : sur une icône d'outil = variante 1 ; sur la salle = clic droit (sortie par secteur avec les bottes, « regarder dans » avec l'œil) ; sur une icône de page 2 = sa variante droite (volume, vitesse), sur `INT 3` = page précédente. Alternative plus découvrable pour les outils : afficher les deux images de l'icône côte à côte (ou en deux demi-boutons) et traiter chaque moitié comme un bouton.
   - **Fait (écart du portage)** : avec les bottes, un **toucher** à moins de 20 px d'un bord de la scène où la salle a une sortie fait sortir de ce côté, comme le clic droit (`TOUCH_EXIT_MARGIN`, `engine/interface.ts`) ; ailleurs, ou sans sortie de ce côté, il fait marcher. Sans cela, l'appui long était le seul moyen de changer d'écran au doigt, et rien ne l'indiquait.
3. **Ctrl + clic (objet tenu)** : appui long sur une cellule d'inventaire, ou mieux **glisser** de la cellule vers la cible (le glisser remplace Ctrl puis clic ; il n'existe pas dans l'original, donc c'est un ajout lisible). Conserver la règle `saisie` : n'activer que si l'outil le permet, sinon le glisser agit comme un clic.
4. **Pas de pointeur** : afficher l'outil actif dans l'emblème (c'est déjà le rôle d'`INT 4`) et surligner l'icône sélectionnée ; rejouer l'animation de refus (quatre visages rouges) **au point touché**. Le test de recouvrement du jeu utilise un rectangle de 7 à 16 px autour du pointeur : en tactile, prendre un rectangle centré sur le doigt (par exemple 16 à 24 px logiques) avec la même règle d'ordre de listes.
5. **Cibles d'icônes** : cases du cadre 20×16 (`screens.md`) agrandies d'au moins 2,5 fois ; les 10 emplacements gardent les positions du jeu.
6. **Déplacement au clavier** : pavé directionnel à 8 directions (curseurs, Début, Fin, PgPrec, PgSuiv) et deux boutons montée/descente (`-` / `+` = icône 199), éventuellement masqués tant que `4b50 = 0`. Un tap arrête (même direction).
7. **Ligne de saisie** : un bouton qui ouvre la boîte (clavier virtuel) ; la phrase tapée reste l'accès complet aux verbes. Ajouter un bouton pour Inser (rappel).
8. **Touches de fonction** : pas besoin de les reproduire ; la page 2 de la barre d'icônes en couvre F2 à F6 et F10 par des icônes (sauvegarde, restauration, continuer, recommencer, score) ; F1 (aide) est à proposer à part ; F7 à F9 sans objet. Alt-P / Alt-A / Alt-Z = icônes 210 / 209.
9. **Sortie** : l'icône 203 termine la partie sans confirmation dans l'original ; sur écran tactile prévoir une confirmation (décision d'UX à valider).

## 10. Index des adresses

| Adresse | Rôle | Confiance |
|---|---|---|
| `1564:0004` | procédure du curseur : souris, clics, icônes, listes | certain |
| `1553:0004` | construction de la commande depuis un clic | certain |
| `1504:0002`, `1504:0274` | marche vers le clic (gauche) / sortie par secteur (droit) | certain |
| `160c:000e` | recherche dans `DGROUP:0bc2` | certain |
| `1539:000e`, `1539:0084`, `1539:011c` | image du curseur et de `INT 4` / outil par défaut / position de la souris | certain |
| `15f8:000e` | changement de page, visibilité des icônes | certain |
| `1a37:0002` | fixe `Ego` (AL) et `Fig` (DL) puis redessine (`1aba:000e`) | certain |
| `2210:0008`, `2210:011e`, `2210:021e` | appel des gestionnaires (verbe, direct, indirect) | certain |
| `219b:0000` | visibilité d'un objet | certain |
| `1e58:000a`, `1e58:009e`, `1e58:00d8`, `1e58:00f3` | file de messages : empiler, afficher, vider, compter | certain |
| `1db5:01aa`, `1db5:003e` | attente du relâchement / attente d'un clic ou d'une touche | certain |
| `1652:0006` | rangement des 12 cellules d'inventaire | certain |
| `1664:0004`, `1664:0057`, `1664:06b6` | sélection d'un objet, panneau de contenu, fichier `TMP.SCR` | certain / probable |
| `1023:0016`, `1023:027c`, `1023:02f4` | répartiteur clavier, Alt, marche au clavier | certain |
| `1611:01de`, `1611:03fc`, `1611:0164` | joyaux et décalage de palette | probable |
| `2fec:0000`, `2fe0:0026` | volume, musique marche / arrêt | probable |

## Questions ouvertes

1. **Panneau de contenu** : le rendu exact (position, cellules, limite de 96) vient d'une lecture de `1664:0057` non recoupée par une exécution ; la sélection par le clic droit de l'œil (§ 5.4) est une déduction du code, à confirmer par le comportement d'un coffre (`objects.md`).
2. **Clic droit avec l'outil `lire`** : le clic droit sur un objet donne un direct vide et un indirect cliqué sans préposition ; le gestionnaire `lire` de `parser.md` § 8.6 n'est pas confronté à ce cas.
3. **Indicateur `INT 4`** : sa copie d'image dans l'emblème central est déduite de `1539:000e` (écriture de `+0x88/+0x8A` dans l'objet `INT 4`) ; l'affichage réel (statique, redessiné par `redessinStatique`) n'a pas été observé.
4. **Volume (icône 206)** : `2fec:0027` ajoute `DX = ±1` à `DGROUP:529E` borné à 0..63 (`audio.md` : atténuation) ; le sens (gauche plus fort ou plus faible) et le rôle de `FUN_3024_0382` ne sont pas établis.
5. **Icône 113** : l'image de la variante droite montre le chapeau retiré, mais la table donne le verbe 39 (`porter`) dans les deux variantes (le verbe 40 `enlever` n'est jamais émis par une icône) ; erreur d'origine possible, à confirmer par le gestionnaire de l'objet vêtement.
6. **Durée du refus** : 21 images supposent un appel par image (70 Hz) ; l'animation boucle sur 4 pas de durée 2 (unité d'`1833:01fc`, non relevée).
7. **Message d'obscurité** de `1504:0002` : identifiant non relevé (registres perdus par la décompilation).
8. **Héros de classe `Dep` 4** : effet exact de l'annulation croisée `Hor`/`Ver` (`1023:011f`).
9. **Joyaux `INT 5`** : effet visuel exact (`1611:0164`) non rejoué ; inaccessible en jeu normal (§ 3.4).
10. **Coordonnées de la souris** : la division par 2 de `X` (`DGROUP:eac+2 = 0x0E`) et le doublement du mode 13h par le pilote INT 33h n'ont pas été vérifiés ; sans objet pour un port (les coordonnées sont celles du canvas 320×200).

## Corrections à reporter

- *(reporté)* **`engine.md` § 8.1** : « Le héros n'a pas de contrôle clavier de déplacement » est faux (`1023:0016`, type 4 → table `1023:019e`, `1023:02f4` : flèches, Début, Fin, PgPrec, PgSuiv ; `+`/`-` pour `Ver`). La classe 2 (touches de fonction) agit **aussi hors script** (F1 à F6, F10) ; la classe 4 n'est pas « ignorée » ; la classe 3 (Alt) agit aussi pendant un script. Voir § 7.
- *(reporté)* **`engine.md` § 8.2** : (a) le clic gauche dans la scène ne fait marcher le héros **qu'avec l'outil bottes (198)**, avec l'outil par défaut il ne se passe rien (refus animé) ; (b) « défilement de l'inventaire » n'existe pas ; (c) l'ordre de parcours est exact mais chaque outil choisit ses listes (§ 1) et le test est un recouvrement de rectangles ; (d) la sémantique de `DGROUP:0bc2` (question 10 de la liste d'`engine.md`) est donnée au § 1.
- *(reporté)* **`engine.md` § 6.1** (champs du curseur) : `+0x0C` est le `Num` de l'**outil actif** (pas « objet visé ») ; `+0x0E` variante ; `+0x36` `Ser` de l'**objet tenu** ; `+0x38` `Ser` de l'icône ; `+0x2D` / `+0x2E` / `+0x32` : refus ; `+0x70/+0x72` : position brute précédente de la souris (voir § 3.1).
- *(reporté)* **`screens.md` E7** : (a) l'objet `INT 4` est l'**indicateur de l'outil actif** (et le bouton « outil par défaut »), pas une simple zone 1×1 ; (b) `INT 2` : clic gauche = verbe 5 (`regarder` la salle), clic droit = verbe 42 (`o`), résolu ; (c) priorité du curseur : 250 (`0xFA`), pas 240 (valeur transitoire) ; (d) 198 = bottes (**marcher**), pas « échelle » ; (e) 110 est « nettoyer » (brosse ou éponge), pas « feu » ; (f) « un clic sur une zone sans objet fait marcher le héros » : seulement avec les bottes ; (g) noms et verbes des 15 outils : § 2.1 ; (h) `INT 5` : joyaux liés à `sl1`-`sl3`, absents des scripts `CM`, jamais atteints en jeu normal.
- *(reporté)* **`screens.md` questions 5, 6, 7** : résolues (§ 1, § 3.3, § 3.4) ; reste la question du rendu de `INT 4` (question 3 ci-dessus). Question 9 (premier caractère de la ligne) : le caractère est bien transmis (`AX = c`, `DX = 2`).
- *(reporté)* **`parser.md` § 6.3** : ajouter que les clics appellent `2210:0008` (sans `22fc:0002`) avec `4cc4 = 0` ; § 6.4 famille 7 (`DGROUP:0b70`, clés 1, 2, 5) : procédures d'objets **`INT`** (curseur, bouton désactivé, joyau) : rôle établi.
- *(reporté)* **`graphics.md`** (section d'animation des sprites `INT`) : 3 enregistrements de 12 octets indexés par `Fig` ; séquence `[n, pas…]`, pas = `(durée << 8) | image` ; `Fig 2` = image cachée (§ 3.2).
