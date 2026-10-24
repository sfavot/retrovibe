# Hall of Fame et certificats (tâche H2b)

Code : `src/games/mathemagique/scenes/trophy/` (scène 10) et `src/games/mathemagique/scenes/certificate/` (WMF, composition, ports). Tests : `test/mathemagique/trophy.test.ts`. Comportement d'origine : [screens/common.md](screens/common.md) §6 ; décision d'impression : [plan.md](plan.md) (« vague H »), le certificat est une **image PNG à télécharger**.

## Hall of Fame (`trophy/`)

- `hall-of-fame.ts` (pur) : pages de 8 joueurs (`(n - 1) / 8` pour la dernière, pas de rebouclage), 6 cellules par ligne (quintet `masque >> 5 × opération`), un ruban par bit (0 à 4), rang `STRL 5000[grade - 1]`, première cellule active présélectionnée à chaque page, `HallOfFameModel` (page, sélection, données du certificat).
- `trophy-scene.ts` : `createTrophyScene(services, options)`. Géométrie de l'original : lignes `75 + 37 r`, cellules `(172 + 60 c, …, 51 × 30)`, nom à x = 48 (ligne de base `87 + 37 r`, police `NCSCLB10.FON`), « Rank: » à la ligne de base `101 + 37 r`, rubans `SHAP 2000–2004` à `gauche + 9 i + 2`. Le nom est découpé à 120 px.
- Boutons (rectangles de `DS:2cee` / `2cfe`) : flèches 1000/1001 et 1002/1003, « Print My Certificate » 1004/1005, EXIT 1500/1501 (la forme 2 sert au survol et à l'appui). La page est conservée d'un accès à l'autre dans la session (`DS:82b4` n'est jamais remis à 0).
- Options : `certificates` (`CertificatePort`, sans lui l'impression est inactive), `certificateEnvironment` (défaut : navigateur), `exitTo` (défaut hub), `onError`.
- Musique : MIDI 65000 de `MILKYWAY.DAT` si Ambient Sounds ; elle continue après la sortie (`endScene({ keepMusic: true })`).

## WMF (`certificate/wmf.ts`)

Les six fichiers (`BKG`, `RIB1–4`, `RIBB`) sont des WMF **placeables** (clé `0x9AC6CDD7`) : boîte 16 405 × 12 530 (haut = 2), **1 620 unités par pouce pour le fond, 1 636 pour les rubans** (donc 1 % plus petits : c'est la taille physique que calcule `1088:03ed`, boîte ÷ unités par pouce × résolution). Fenêtre logique des records : `SETWINDOWORG (-16, -15)`, `SETWINDOWEXT` 16 437 × 12 562 (fond) ou 12 525 (rubans).

| Record | BKG | RIB* | Traitement |
|---|---|---|---|
| `SETBKMODE`, `SETSTRETCHBLTMODE`, `SETBKCOLOR` (RIB1 et RIB3, BKG) | 1 chacun | 1 | lus, sans effet (pas de texte ni de motif) |
| `SETWINDOWORG`, `SETWINDOWEXT` | 1 | 1 | fenêtre logique ; transformation anisotrope vers le rectangle cible |
| `INTERSECTCLIPRECT` | 1 | 1 | découpe de la page |
| `SETPOLYFILLMODE` (1 = alterné) | 1 | 1 | `evenodd` / `nonzero` |
| `CREATEPENINDIRECT` | 544 | 17–18 | largeurs 11, 23, 45, 135 ; style 0 plein ou 5 nul (313 crayons nuls) ; coins et bouts ronds |
| `CREATEBRUSHINDIRECT` | 46 au total sur les 6 fichiers | 3 | tous pleins (style 0) ; creux géré, motifs non |
| `SELECTOBJECT`, `DELETEOBJECT` | 575, 573 | 20–21, 18–19 | table d'objets à premier emplacement libre (comme GDI) |
| `POLYGON` | 571 | 18 | remplissage puis contour |
| `POLYLINE` | 309 | 10 | contour |

Non gérés (absents des fichiers, comptés dans `DrawStats.skipped` s'ils apparaissent) : texte, bitmaps, rectangle, ellipse, `POLYPOLYGON`, crayons pointillés, pinceaux à motif. `SAVEDC` / `RESTOREDC` sont gérés mais absents des fichiers. La largeur de crayon 0 est rendue comme 1 unité.

`drawWmf(ctx, wmf, target)` prend un `WmfContext` (sous-ensemble de `CanvasRenderingContext2D`) ; `wmfPhysicalTarget(wmf, pxPerInch)` donne le rectangle à lui passer.

## Certificat (`certificate/`)

- Ordre de dessin de `1088:0a9f` : papier blanc, **textes**, `BKG.WMF`, puis les rubans des niveaux réussis (`RIB1`–`RIB4` pour les niveaux 1 à 4, `RIBB` pour le bonus), dans l'ordre des niveaux. Rien n'est imprimé sans niveau réussi (cellule inactive).
- Textes (chaînes de `MATH`) : titre « <Opération> Certificate of Merit » (+ − × ÷ = ≈ : Addition, Subtraction, Multiplication, Division, Equivalence, Estimation), nom du joueur, « this certificate is awarded to », « who has achieved the rank of », rang global (grade sur **toutes** les opérations, bonus exclu). Polices `MARKET__.TTF` (titre, nom, rang) et `NEWZURCA.TTF` (légendes), chargées par `FontFace` sous les noms « MW Market » / « MW NewZurica ».
- Mise en page : rectangles en pouces tirés des constantes `double` de `MATH` (`1108:2f77`…`30d6`, relues dans l'exécutable) : titre x 1,985 à 8,485, bas 1,513 ; les autres textes x 2,423 à 6,813, bas 2,066 (légende 1), 2,403 (nom), 2,878 (légende 2), 3,215 (rang) ; hauteur de rectangle 0,4 pouce (légendes 0,2), police 0,35 pouce (légendes 0,2). Texte centré dans son rectangle. L'attribution des constantes aux rectangles reste une **hypothèse** (le décompilateur a perdu les arguments) ; elle est cohérente avec le fond : les rectangles évitent les deux quilles du décor.
- Image : 2000 × 1528 px (page du fond, 10,13 × 7,73 pouces, ~197 ppp), PNG. `CertificateRenderer` garde en mémoire polices et WMF.

## Ports (à brancher par l'hôte)

- `CertificatePort { download(blob, filename) }` : navigateur = lien `download` sur `URL.createObjectURL`.
- `CertificateEnvironment { createCanvas, loadFont }` : `createBrowserCertificateEnvironment()` est fourni (canevas du document ou `OffscreenCanvas`, `FontFace` ajouté à `document.fonts`). Les TTF et WMF sont lus par `Host.loadFile` (`MARKET__.TTF`, `NEWZURCA.TTF`, `BKG.WMF`, `RIB*.WMF` doivent donc être servis comme les `.DAT`).
- Nom de fichier : `certificateFileName(nom, opération)` → `certificat-<opération>-<nom>.png` (⚠ copy à valider).

## Écarts

- Sortie : retour au **hub** (consigne de la vague H) ; l'original retourne au Bowling (`1b20 = 1`) et n'est accessible que depuis lui.
- Pas de date sur le certificat : l'original n'en imprime pas.
- Cadre de survol (1 px) et de sélection (2 px) noirs autour de la cellule : choix visuel (la forme exacte de `1078:0b48` n'est pas relue).
- Un nom plus large que son rectangle est réduit (jusqu'à 40 %) ; l'original ne le dit pas.
- Marges : les WMF partent du coin de la page (le décalage `SETVIEWPORTORG` de `1088:03ed` n'est pas relu) ; aucune zone imprimable d'imprimante.
- Pas de son d'appui sur les boutons (aucun `\0SND` dans `TROPHY.DAT`, ids des sons d'appui inconnus).
- Dégénérés : les polygones à 3 points alignés des rubans sont rendus avec des bouts ronds (points visibles) comme GDI avec un crayon large.
