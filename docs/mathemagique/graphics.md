# Graphismes (Math Workshop)

Code : `src/games/mathemagique/engine/graphics/` (pur, testable sous node) et `src/games/mathemagique/render/canvas-presenter.ts` (navigateur). Tests : `test/mathemagique/graphics.test.ts`. Références : [shap.md](shap.md), [engine.md](engine.md) §4. « Hypothèse » marque ce que le code de `MATH` ne prouve pas.

## Graphismes

### Surface (`surface.ts`)

- `Surface(width = 576, height = 432)` : indices 8 bits (`pixels`). Rectangles `{ x, y, w, h }`.
- `fill(color, rect?)`, `copyFrom(src, srcRect?, dx, dy, transparent?)` (`transparent` = ignorer l'index 0), `get(x, y)`.
- `saveRect(rect)` / `restoreRect(saved)` : équivalents de `e2SaveRect` (`10a8:1023`) ; la restauration est exacte (sans découpe).
- Découpe : pile `pushClip(rect)` / `popClip()` (intersection, équivalent de `e2ClipRect`, `10a8:119f`) et, en plus, `mask` : `ClipMask(width, height, rects)` = union de rectangles (cellules de Hidden). Tout le dessin passe par `clip`, `clipSpan` et `visible`.
- Pas de gestion de zones « sales » : le moteur présente toute l'image à chaque tick (576×432, négligeable).

### Formes (`blit.ts`)

- `drawShape(dst, shape, x, y, mode = 8)` : mode 0 = copie, mode 8 = copie en sautant l'index 0 (`10d8:4438`, table de sauts `4517`). Les modes 1 à 7 (AND, OR, XOR, NOT…) existent dans l'original mais ne sont jamais demandés : non gérés.
- `drawMask(dst, mask, x, y, color)` : forme 1 bit en couleur unie (`10d8:494d`), p. ex. Pattern Windows `180 + c`, encre de Sticklers. Hypothèse (déjà dans shap.md) : la couleur est un paramètre du dessin.
- `hitTestShape(shape, px, py)` : pixel opaque (≠ 0) ou bit à 1, `(px, py)` relatif au coin de la forme.
- L'entrée est un `Shape` décodé par `data/shap.ts`.

### Palette (`palette.ts`)

- `Palette.colors` (768 octets) = table logique `DS:8bda`. `loadShpl` applique un SHPL avec l'éclaircissement `v + 31 − ⌊v/8⌋` (`1098:0857` : 0 → 0, 1 → 32, 8 → 38, 100 → 119, 255 → 255) ; `loadRaw` copie sans éclaircir (`tPAL`). Hypothèse : couleurs système = index 0 noir et 255 blanc (`SYSPAL_NOSTATIC`), les autres à 0 tant qu'un SHPL ne les définit pas.
- `output()` = palette affichée (768 octets), table logique + fondu. `snapshot` / `restore` pour sauvegarder une plage (`10a8:0d9c`, `0e86`).
- **Fondus** (`1088:1b25`, `1b9b`, `1cee`) : `fadeToBlack`, `fadeFromBlack`, `fadeTo(palette)`, sur la plage 10..245 par défaut. Niveau 0..256, composante = `départ + ((cible − départ) × niveau >> 8)`. **Unité de la durée établie** : 1 tick de 60 Hz (17 ms) ; `1b9b` calcule la vitesse `0xf5c29 / durée` (16.16) **par milliseconde** (`timeGetTime`), `0xf5c29 = 256 × 65536 / 16,67` : niveau 256 après `durée × 16,67 ms` (30 → 500 ms). Durée 0 = instantané. Mode « par paliers de 4 niveaux » (`quantized`, mode 0 de `1cee`). Un fondu vers une cible (noir compris) est **tenu** en fin de course jusqu'à `clearFade()` ou un autre fondu ; `fadeFromBlack` disparaît en fin de course (cible = table logique vivante).
- **Cycles** : `startCycle({ first, count, period, duration?, direction?, restore? })` renvoie un `PaletteCycler` ; `Palette.tick()` avance fondu et cycleurs (plusieurs à la fois). Usages : Pattern Windows `1060:1627` (180..194, un cran / 8 ticks, 300 ticks, `restore`), fanfare du Bowling `1010:42a2` (8 entrées), victoire de Puzzle Patterns (une plage / 7 ticks), Sticklers `1048:19bd` (4 entrées en 156, 7 ticks), palette partielle 154..185 (`loadShpl` d'un SHPL partiel). Hypothèse : le sens de rotation n'est pas établi (`direction` +1 : l'entrée `i` prend la couleur de `i + 1`) ; les plages et périodes viennent des fiches d'écran.

### Polices (`fon.ts`, `text.ts`)

- `parseFon(bytes)` : exécutable NE, ressources `RT_FONT` (type `0x8008`), FNT v2 et v3 (les cinq fichiers du jeu sont en **v2**). Chaque `NCSCLB*.FON` contient **une** police de **256 glyphes** (codes 0 à 255, caractère par défaut 96, séparateur 32), hauteur de cellule 11 / 13 / 15 / 19 / 26 pour 10 / 12 / 14 / 18 / 24 (taille nominale 25 pt pour le fichier « 24 »). Largeurs de « A » : 9 / 10 / 11 / 15 / 19. Glyphes stockés par colonnes d'octets, bit fort à gauche ; expansion en 0/1 par glyphe.
- `drawText(dst, font, text, x, y, color)` (`y` = haut de la cellule, renvoie la largeur), `measureText(font, text)` (somme des avances, sans crénage : règle des 110 px du champ de nom, `10d8:6bf0`).
- Codage : **les polices `.FON` sont en Mac Roman** (0x8E = é, 0xCB = À, 0xD6 = ÷, vérifié glyphe par glyphe) ; `encodeText` convertit une chaîne JS (Unicode) en codes de glyphe Mac Roman (table complète 0x80–0xFF, `?` pour un caractère absent) et envoie `÷` (U+00F7) vers 0xD6. Un `Ö` donne donc le glyphe Ö ; le `%d Ö %d =` de l'original est en réalité l'octet 0xD6 (glyphe ÷), à passer en `Uint8Array`. Un `Uint8Array` est accepté tel quel (octets du jeu). Les TTF (`MARKET__`, `NEWZ*`) ne servent qu'à l'impression : hors périmètre.

### Transitions (`transitions.ts`)

Machines pures : `step()` (un tick) renvoie les rectangles **nouvellement révélés**, `finish()` termine d'un coup (clic du joueur), `revealRects(dst, src, rects)` les recopie du port de travail vers l'écran. Mécanisme commun, **exact** : vitesse 16.16 `total × 65536 / ticks` (division tronquée), accumulateur initialisé à une vitesse, une vitesse de plus par tick, progression = partie entière plafonnée au total (`1018:01fd`, `0811`). Durée atteinte en `ticks` ticks pour les cas du jeu.

- **Balayage** `Wipe(rect, direction 0..3, ticks)` (`1018:0162`, `01fd`, `0275`) : 0 haut → bas, 1 bas → haut, 2 gauche → droite, 3 droite → gauche. Crédits : 30 ticks, direction `(+1) & 3` à chaque appel (`1078:04ef`).
- **Stores vénitiens** `Blinds(rect, ticks, bande = 10)` (`1018:0722`, `0785`, `0811`, `0889`, appelant `09b8`) : bandes de 10 lignes, dans chacune les lignes apparaissent de haut en bas ; appels du jeu : 15 ticks (menus, choix de puzzle) ou 30 ticks (niveau, mélange). Le rectangle d'écrêtage et le port source (`DAT_8bd6`, port de travail) sont ceux de l'appelant ; si le port source est nul, l'original rafraîchit la zone sans copie (`10d8:66d1`), non modélisé.

### Présentation (`render/canvas-presenter.ts`)

`new CanvasPresenter(canvas)` fixe le canvas à 640×480 logiques, fond noir ; `present(frame)` convertit `Frame.pixels` par la palette de la frame (table de 256 couleurs réutilisée, un `ImageData` 576×432 réutilisé) et le pose en (32, 24). Échelle entière et `image-rendering: pixelated` : CSS de l'appelant.

### Points ouverts

- Sens des cycles de palette (voir ci-dessus) ; couleurs système autres que 0 et 255.
- Origine exacte de la couleur des masques 1 bit (param du dessin, non localisée) et modes de blit 1 à 7 (inutilisés).
- Transitions : le mode « sans port source » de `0889` n'est pas reproduit.
