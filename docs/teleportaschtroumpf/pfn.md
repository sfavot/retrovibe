# Polices `.PFN` du Téléportaschtroumpf

Décodeur : `src/games/teleportaschtroumpf/data/font.ts` (`parsePfn`, `measureText`). Tests : `test/teleportaschtroumpf/font.test.ts`.

Format établi par la RE des routines de texte du segment `32f4` (bibliothèque de police), adresses `segment:offset` de `archives/teleportaschtroumpf/re/`.

## Fichiers

9 fichiers dans `DATA/`, 5 polices distinctes (hash MD5) :

| Fichier(s) | Hauteur | Codes | Glyphes | Aspect |
|---|---|---|---|---|
| `S52D001F.PFN` | 16 | 0x20-0xFE | 223 | gothique à lettrines, 15 px max (haut de page 0xB0+ : points de remplissage) |
| `S52D1.PFN` = `S40A002F.PFN` | 10 | 0x20-0xFE | 223 | (non rendue ; même format) |
| `S52D2.PFN` | 10 | 0x20-0xFE | 223 | serif, jeu Latin-1 |
| `S40A003F.PFN` | 10 | 0x20-0xFE | 223 | variante de `S52D2` (735 octets diffèrent, même taille) : **pas** un doublon |
| `S52D0.PFN` = `S40A001F.PFN` | 12 | 0x01-0xFD | 253 | gras CP437 complet (symboles 0x01-0x1F, cadres, grec) |
| `S52D3.PFN` = `S40A004F.PFN` | 12 | 0x01-0xFD | 253 | idem, autre graisse |

Donc seuls `S52D3`/`S52D2` (init) et `S52D001F` sont réellement chargés par le jeu ; `S52D0`, `S52D1` et les `S40A00xF` ne sont référencés par aucune chaîne (`strings.tsv`), sans doute des restes de développement (le motif `s52d%d.pfn` n'apparaît pas non plus).

## Format

En-tête de 8 octets (lu par `32f4:0123`, « sélection de police ») :

| Offset | Taille | Rôle |
|---|---|---|
| 0 | u8 | code du premier caractère de la table (0x20 ou 0x01). L'octet 1 est ignoré (`XOR DH,DH` en `32f4:015f`) |
| 2 | u8 | hauteur (rangée lue en `CS:[0x92]`, compteur de lignes du dessin en `32f4:0091`) |
| 3 | u8 | octets par ligne de la bande (`stride`) ; si 0, le u16 little-endian de l'offset 4 (`32f4:0148-014f`). Toujours renseigné ici : 150, 176, 298… |
| 4 | u16 LE | stride de secours (voir ci-dessus) ; valeur redondante dans les 9 fichiers |
| 6 | u16 **BE** | offset de la table des glyphes = `8 + hauteur * stride` |

Puis :

- **Bande de pixels** (offset 8) : `hauteur` lignes de `stride` octets, 1 bit par pixel, bit de poids fort en premier. Tous les glyphes sont côte à côte sur ces lignes (`32f4:0072` : SI += abscisse/8 ; passage à la ligne suivante par `ADD SI,stride` en `32f4:00b8`, constante patchée à l'init).
- **Table** (offset `8 + hauteur*stride` jusqu'à la fin du fichier) : une entrée u16 **big-endian** par caractère, indexée par `code - premier`. 4 bits de poids fort = largeur du glyphe (0-15), 12 bits de poids faible = abscisse du glyphe en bits dans la bande (`32f4:0051-0062` pour la largeur, `32f4:0062` `AND AX,0xfff` pour l'abscisse, `32f4:0077` pour le bit de départ `abscisse & 7`). Le nombre de glyphes se déduit de la taille du fichier.

Les 4096 abscisses possibles bornent la bande à 4096 px : les fichiers font 150 à 298 octets de large, loin du maximum.

## Rendu

Le jeu ne manipule que du monochrome : `32f4:0018` (dessin du texte, coordonnées x/y + chaîne terminée par 0) écrit, pour chaque bit à 1, un pixel de **la couleur d'index passée à la sélection** (2e argument de `32f4:0123`, 0x7e ou 0x7f en pratique, patché dans le code en `CS:[0xab]`). Il n'y a donc pas de glyphes multicolores : le bitmap décodé est un masque 0/1.

- Avance horizontale : `largeur + 1` (`32f4:00c8`, immédiat 1). Largeur 0 (glyphe vide) : n'écrit rien et avance de `2 + 1` (`32f4:00d8`, immédiat 2).
- Mesure (`32f4:0192`) : même règle, avec deux paramètres réglables par `32f4:017f` (largeur du vide, espacement), dont les valeurs par défaut sont ces immédiats 2 et 1. `32f4:017f` n'a aucun appelant : les valeurs par défaut valent partout. `measureText` les reprend (`SPACE_WIDTH`, `LETTER_SPACING`).
- Les textes sont octets CP437 terminés par 0.
- Effet de contour : `154c:0214` dessine la chaîne 8 fois décalée de ±1 px (couleur 0x7e) puis une fois au centre (couleur 0x7f), centrée sur 320 px (`(0x140 - largeur) / 2`).

## Qui sert où

- `S52D001F.PFN` (16 px, gothique) : chargé par `305a:0008` (`305a:0071` à l'initialisation) dans la globale `DS:7e0d`, police courante par défaut (`32f4:0123(…, 0x7e)` dans `134d:0621`, `15f9:0be9`, `179a:0002`, `1f33:0009`, `21ee:13a1`...), et par `2ee8:000d` (quiz S40, `s40a.dat`) qui la sélectionne en `2ee8:0279` avant d'afficher questions et réponses. Les fichiers `S40A00xF.PFN` ne sont pas lus par le quiz.
- `S52D3.PFN` (12 px, gras) et `S52D2.PFN` (10 px, serif) : chargés en `154c:052e` (init de l'écran S52, `154c:05ca`/`05df` ; adresses `DS:5b14` et `DS:5b10`), utilisés par `154c:0214` pour les textes centrés avec contour (`154c:0214` choisit `S52D2` par défaut, `S52D3` quand `cRam3bf78 != 0`). Ce sont les polices des écrans de texte S52 (`s52dsphi.doc` est le fichier de textes lu par la même fonction).

## Incertitudes

- Le choix exact entre `S52D2` et `S52D3` dans `154c:0214` tient à un drapeau (`DS:bf78`) dont je n'ai pas cherché les affectations.
- Jeu de caractères : le bas de table (0x20-0x7F) est de l'ASCII ; 0x80-0x9F ressemble à du CP437 dans `S52D001F`/`S52D0`/`S52D3`, alors que `S52D2` et `S40A003F` y mêlent des lettres Latin-1 (accents à 0xC0-0xFF). Les accents du français sont donc à vérifier police par police avant de mapper des textes CP437 ; non résolu.
- Caractères hors de la table (code < premier ou > dernier) : le jeu lit n'importe quoi après la table ; `parsePfn` n'a simplement pas de glyphe, `measureText` les compte comme un vide.
- Dans `S52D001F`, les codes 0xB0-0xDF et la plupart de 0xE0+ pointent sur un glyphe d'un point : valeurs de remplissage, pas de lettre.
- Rôle de l'octet 1 de l'en-tête, toujours 0 : ignoré par le jeu.

## Rendu de contrôle

Planche de tous les glyphes (grille 32 colonnes, agrandie 3x) générée hors dépôt pour `S52D001F`, `S52D2` et `S40A001F` : les lettres, chiffres et accents sont lisibles, ce qui valide le décodage (sens des bits, abscisses, largeurs).
