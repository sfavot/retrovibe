# SWIV 3D : le rendu logiciel de `SWIV_WIN.EXE` (R4)

Spécification du rastériseur 8 bits de `SWIV_WIN.EXE` (PE32 Win95, Watcom, version « logiciel / MMX »), assez précise pour le porter en TypeScript dans une image indexée présentée par `IndexedPresenter` (`src/ui/indexed-canvas.ts`) avec le même aspect. Sources : `archives/swiv3d/re/decomp/*.c` (noms `gm_*` de `scripts/swiv3d/re/keyfuncs.def.tsv`) et `disasm.txt` (les boucles internes sont lues dans le désassemblage, MMX compris). Contexte : `plan.md`, `re-index.md`, `slv.md`, `models.md`, `global-bd.md`.

Légende : **confirmé** = lu dans le code (adresse citée) et, pour le terrain, les modèles et les ombres, reproduit par un prototype dont le rendu a été regardé ; **hypothèse** = déduit ; **ouvert** = non élucidé. Toutes les adresses sont linéaires (`004xxxxx` code, `005xxxxx` données/BSS). Les entiers sont des `int32` C : `>>` est arithmétique, `/` tronque vers zéro, `Math.imul` est nécessaire pour les produits qui débordent 2^53 en TS (aucun ici n'excède 2^31 sauf mention).

## 0. Résumé

| Sujet | Établi |
| --- | --- |
| Écran | **VGA mode X 320×400, 8 bits, 4 plans** (pas de DirectDraw dans cet exécutable), double page VRAM par adresse de départ CRTC. Pixels non carrés : affichés en 4:3, la projection verticale vaut 5/3 de l'horizontale. |
| Palette | `SLV 11003` (VGA 6 bits) passée à travers une table de gamma 4×64. Tous les graphismes du niveau sont des **numéros de palette**. Le noir de « ciel » est l'indice 0. |
| Lumière | `table[lumière][texel]` : 128 lignes de 256 octets recopiées du bloc 12xxx (`+0x100`). Lumière du terrain et des modèles plafonnée à **110 (0x6e)**, plancher 15 pour le terrain. Brouillard = plafond de lumière `(2000 - profondeur) >> 2`. |
| Caméra | poursuite 3e personne, matrice 3×3 en 8.8 construite en flottants, division perspective par `profondeur + 0x19`. Plans proche/lointain : profondeur 101 à 1999. |
| Terrain | **grille de sommets projetés rangée par rangée, tracée en bandes verticales par colonne d'écran** (pas de triangles), du proche au lointain, avec une « ligne d'horizon » par colonne pour l'occlusion. ≈ 30 rangées, 1 cellule d'écart jusqu'à la profondeur 1200 puis 2 cellules. Texture de sol = 32 tuiles 64×64 du bloc 12000 choisies par `carte102 >> 3`. |
| Objets | collecte dans les compartiments de 512 unités, transformation en entiers, **triangles** empilés dans une file triée par profondeur décroissante (painter), tracés en colonnes avec découpe par les lignes d'horizon du terrain. |
| Niveaux de détail | `Detail Level` (0 à 255, 240 par défaut) et `Screen Size` (0 à 255, 255 par défaut) ne sont réglables que **sans MMX** ; avec MMX le jeu les force à 240 et 255 à chaque image. Il n'y a pas d'option « Fog » en mode logiciel (voir §5). |
| Couleur d'ambiance (script 600) | **inutilisée par le rendu logiciel** : `0x00484650` n'est qu'écrit (3 écritures, 0 lecture dans l'exécutable). |

Points ouverts à la fin (§12). Un prototype jetable (hors dépôt) rend le terrain, l'eau animée, des modèles éclairés et texturés, l'ombre du joueur et le flou du rotor ; voir §11.

## 1. Écran, page, palette

**Confirmé.** Aucun import `DDRAW` (`imports.tsv` : GDI32, KERNEL32, USER32, WINMM, DPLAYX, `dsound`, `smackw32`, DLL32). `gm_enter_fullscreen` (`00410068`) appelle `_FullScreen32` de `DLL32.DLL` avec `0x8041`, `0x4040`, `0x8041`, borne le curseur à 320×240, puis programme le VGA directement par `OUT` (`0042fe44` si l'écran est déjà actif, `0042fec4` avec palette noire) :

| Port | Valeur | Effet |
| --- | --- | --- |
| `3c4h` | `0x0604` | séquenceur : chaîne 4 coupée (mode X « non chaîné ») |
| `3d4h` | `0x0014`, `0xe317`, `0x0009` | CRTC : mode double mot coupé, mode octet, `max scan line = 0` → **400 lignes** réelles |
| `3c4h` | `0x0f02` | masque de plans = tous (effacement de `A0000h`, `0x3fff` dwords) |
| `3c8h`/`3c9h` | 768 octets | palette DAC (voir plus bas) |

- Résolution : **320×400**, 8 bits, 80 octets par ligne et par plan ; le pixel `x` est dans le plan `x & 3`, à l'octet `y*80 + (x >> 2)`. C'est aussi le format des écrans plein cadre 1001-1005 (`global-bd.md`). Le jeu n'a pas d'autre résolution logicielle (`DAT_0048464c == 0`) ; 640×480 et plus relèvent des variantes 3Dfx/D3D.
- **Tampon de travail** en mémoire : 4 plans de `0x8000` octets à `005882e8 + p * 0x8000` (32 000 octets utiles par plan). La table `004da418[x] = 005882e8 + (x & 3) * 0x8000 + (x >> 2)` donne l'adresse de la colonne `x` ; on avance d'une ligne en ajoutant `0x50`. Pour le port : un `Uint8Array(320*400)` linéaire suffit (les écritures du jeu débordent parfois d'une ou deux lignes dans les 768 octets d'écart entre plans ; à ignorer).
- **Présentation** (`gm_present_flip`, `0042ff5c`, appelée en fin de `gm_frame`) : copie chaque plan (`8000` dwords) vers la VRAM avec le masque de plan `1 << p` (`out 3c4h, 0x0102/0x0202/0x0402/0x0802`), page 0 à `A0000h` ou page 1 à `A8000h` (`0x8000` d'écart), puis fixe l'adresse de départ CRTC `0x0c` à `0x00` ou `0x80` (`out 3d4h, 0x000c` / `0x800c`) et bascule `004811b8`. Pas d'attente de retour de balayage dans cette fonction.
- **Palette** (`0042fddc`) : écran effacé, puis `out 3c8h, 0` et 768 `out 3c9h, gamma[niveau][v]` avec `gamma = 00587fb8` (4 × 64 octets, `gm_gamma_build` `0042469c`) : `gamma[0][i] = i`, `gamma[k][i] = trunc(63 * pow(i/63, 1 - k/8))` pour `k = 1..3` ; `niveau = DAT_00484644` (menu « Gamma Correction », 0 par défaut). L'argument est la palette du niveau : **les 768 premiers octets du bloc `SLV 11003`** (VGA 6 bits, valeurs 0..63). Le port peut ignorer le gamma (niveau 0) et convertir en 8 bits comme `vga6ToRgb8`.
- **Aspect** : 320×400 est affiché en 4:3, donc un pixel est 1,67 fois plus haut que large ; le jeu corrige par `sy = sx * 5 / 3` dans la projection (§4). Le port doit étirer l'image à 4:3 (l'artefact visible est un facteur 1,2 vertical sur 640×480).
- **Partage écran / HUD** : la même image 320×400 reçoit la vue 3D, puis le radar (`gm_draw_overlay_sw`), le HUD (`gm_draw_hud`) et le texte 3D des missions (`00424454`). Le rectangle 3D dépend de `Screen Size` `s` (0..255) ; avec `s = 255` il couvre tout l'écran :

```ts
function viewport(s: number) {                       // 0042b31c, DAT_005876d0/ec/cc/f4
  const left = 0x9f - ((s + 0x40) >> 1);              // 0 pour s = 255
  const top = 199 - (((s + 0x40) * 0xa0) >> 8);       // 0 pour s = 255
  return { left, right: 0x13f - left, top, bottom: 399 - top, clipTop: top - 1 };
}
// largeur = right - left (319) ; cx = (largeur >> 1) + left (159) ; cy = ((bottom - clipTop) >> 1) + clipTop (199)
```

## 2. Palette runtime et tables de teinte

**Confirmé.** À l'arrivée dans un niveau, `gm_slv_load` (`004545a8`) et `gm_slv_setup_tiles` (`00453ed4`) publient :

| Pointeur | Contenu | Usage |
| --- | --- | --- |
| `005b1f98` | `SLV 11003` (palette 6 bits `0x300`, puis `005bc158` = table d'attributs `+0x300`) | palette DAC ; `005bc158[i]` = octet de palette à utiliser pour un type de point radar / de ligne laser (`0043607c` lit `[0x300 + 0x107f]` → indice 109 dans TERRAN00 ; couleur des lignes de type `0x2a`) |
| `005b0690[t]`, `005b1950[t]` (t = 0..199) | tuile de texture et **table de lumière** du modèle/tuile `t` | voir ci-dessous |
| `005bc13c` | `SLV 109` (128 × 256) | tables de teinte : sprites 504/505/506 et faces de type 5 ; `dst' = t109[texel << 8 | dst]` |
| `005bc180` | `SLV 108` en jeu (`GLOBAL 800` hors niveau, `gm_play_smacker` `0046edb8` le remplace) | blitters RLE du HUD/radar : `dst' = t108[(banque + teinte) << 8 | dst]` |
| `005b1fa4` | `SLV 106` (64 lignes × 256) | **terrain de faible détail** : `couleur = t106[(lumière >> 1) << 8 | carte102]` |
| `005b1f9c` | `SLV 110` (256×256, valeurs 0..31) | **silhouettes d'ombres** projetées au sol |
| `005b1f74` | `SLV 500` (48 × 256) | lignes 0..31 : table d'assombrissement `dst' = t500[s << 8 | dst]` ; lignes 32..47 : image 64×64 de flou du rotor (valeurs 0..31) |
| `005bc144`, `005bc15c`, `005bc12c` | `GLOBAL 504`, `505`, `506` | sprites d'explosion / réticule (§9) |

**Tables de lumière.** Chaque bloc `12000..12004` porte, à `+0x100`, 128 lignes de 256 octets ; `gm_slv_setup_tiles` la recopie à une adresse alignée sur 256 pour que `ptr = base + (lumière << 8) | texel` soit une simple concaténation d'octets. Pour les blocs 12001-12004, la colonne 0 de chaque ligne est remise à 0 (le texel 0 devient le noir). La ligne `L` donne, pour un texel d'atlas `i`, l'indice de la **palette 11003** de luminosité environ `L / 128` de la couleur d'atlas (mesuré sur 12001 : luminosité moyenne de la ligne 16 = 0,12, ligne 64 = 0,49, ligne 100 = 0,77, ligne 110 = 0,855, ligne 126 ≈ 0,98 de la palette RGB 8 bits stockée après l'atlas ; la ligne 127 est atypique). Conséquences :

- La palette « de queue » des blocs 12xxx (RGB 8 bits après les pixels) n'est **pas lue** par le rendu logiciel. `gm_slv_setup_tiles` fabrique à la place une palette de texture `005b1c70` (RGB 8 bits, `11003[ligne100[i]] << 2`, indice 0 = magenta pour 12001-12004) que rien ne lit dans les chemins logiciels (hypothèse : téléversement des textures des versions accélérées) ; la visionneuse utilise la palette de queue. Les pixels d'atlas sont des indices de cette palette de queue ; le rendu logiciel les envoie à travers `table[lumière][texel]` vers des indices de la palette 11003.
- La lumière maximale utilisée (`0x6e` = 110) correspond donc à 86 % de la luminosité de l'atlas ; rien n'est jamais pleinement éclairé. Une lumière plancher de 15 (terrain) donne 12 % : le brouillard va vers le noir quasi total, d'où un horizon sombre sur ciel noir (indice 0).
- Les emplacements `t` : `t = 0..199` pointent d'abord sur 12000 (pixels à `+0x8100`, table de lumière de 12000) ; les 16 emplacements `16n .. 16n + 15` (n = 1..4, soit t = 16..79) sont ensuite remplacés par la tuile `k` du bloc `12000 + n` : pixels à `+0x8100 + (k >> 2) * 0x4000 + (k & 3) * 0x40`, **pas de ligne 256** (voir `slv.md`). Les modèles utilisent `t` ; le terrain n'utilise que `005b0690[0]` et `005b1950[0]` (`DAT_0058369c`, `DAT_005876c4`).

**Tables 108/109/800 (confirmé pour le sens, hypothèse pour les teintes).** Ce sont des tables de mélange « ligne × pixel » : `108` (65 536 octets) a la ligne `0xf0` identité, les lignes `0xe0..0xef` fondent progressivement vers l'indice `93` (blanc) ; `109` (128 lignes) a la ligne 0 identité, la ligne 127 constante `93` (blanc), la ligne 126 constante `88`, les autres des teintes (explosions) ; `GLOBAL 800` est la version « palette des menus » de `108` (les deux diffèrent de 64 688 octets sur 65 536, chacune est calée sur sa palette).

**Couleur d'ambiance de l'élément `600` du script** (`gm_main_game` `00421614`, valeur `0x646478` = (100, 100, 120) par défaut, (170, 50, 50) sur MARS, (0, 0, 0) sur LUNAR01) : **aucune lecture** dans `SWIV_WIN.EXE` (`grep 484650` dans `disasm.txt` : 3 écritures). Hypothèse : couleur de fond/brouillard des exécutables 3Dfx/D3D. En rendu logiciel le « brouillard » est la lumière (§6.3) et le ciel est l'indice 0 : **rien à porter**.

## 3. Ordre d'une image

`gm_frame` (`0042f64c`) pour chacune des 4 vues actives (`00480e74`, 26 dwords chacune) : `gm_render_view` (`0042b31c`). Ordre dans `gm_render_view` :

1. rectangle, caméra, matrices, constantes de projection (§4) ;
2. `gm_render_terrain` (`0042718c`, en fait la **collecte des objets**, §7) : transforme les modèles et empile des faces dans la file ;
3. initialisation des 321 enregistrements de colonne, construction des rangées (`00429e1c`), effacement du ciel (`0041406c`, MMX seulement), **tracé du terrain** par bandes (§6) ;
4. `EMMS`, puis parcours de la file triée du plus lointain au plus proche avec le rastériseur choisi par type de face et par `Detail Level` (§8) ;
5. réticules (`00437c38`), relissage de la position des réticules ;
6. restauration du rectangle (le HUD réutilise les variables).

Puis `gm_frame` dessine le radar (`gm_draw_overlay_sw`), le HUD, remet la file à zéro (`00422eac`), empile et trace le texte 3D (`00424454` → `00423974` → `004359c8`) et appelle `gm_present_flip`. Les compteurs d'animation sont avancés par la boucle de jeu (`0042a084` en solo, `0042a940` en réseau : `00481154 += 1`, `00481150 += 10` par pas de simulation) et lus par le rendu.

**Sans MMX** (`DAT_00484620 == 0`), `gm_frame` efface tout le tampon (`0042fd8c`, `0x8000` dwords) avant les vues ; **avec MMX** seule la zone au-dessus de l'horizon est effacée (§6.7). `DAT_00484620` est mis à 1 par `0042fcac` si le bit 23 du CPUID (MMX) est présent et `DAT_00484624 = DAT_00484620` ; la touche de balayage `0x43` maintenue coupe le chemin MMX en cours de jeu (`gm_frame`, hypothèse sur le nom de la touche : F9).

## 4. Vue, caméra et projection

### 4.1 Enregistrement de vue (`00480e74`, pas `0x68`)

| Champ (i32) | Sens | Établi |
| --- | --- | --- |
| `[0]` | objet suivi (0 = vue inactive ; remis à 0 si `obj[1] == 0`, objet mort) | confirmé |
| `[1]` | objet suivi à l'image précédente (sert à détecter un changement de cible) | confirmé |
| `[2]` | drapeau : 0 = caméra qui suit en lissant ; sinon la position caméra n'est pas lissée sauf rappel si l'écart dépasse `0x4a559f80` | confirmé |
| `[3]` | décalage de cap de la caméra (touches `±6` par image) | confirmé |
| `[4]` | élévation en pas de 1/512 de tour, bornée à **15..100** (30 au départ ; touches `±6`) | confirmé |
| `[5]` | distance, bornée à **200..800** (550 au départ) | confirmé |
| `[6..8]` | cible lissée (3 flottants) | confirmé |
| `[10..12]` | caméra lissée (3 flottants) | confirmé |
| `[13]` | gîte (flottant, ±0,5) | confirmé |
| `[14..17]` | rectangle (gauche, haut, droite, bas) | confirmé |
| `[19..21]`, `[22..24]` | position écran lissée et image des deux réticules | confirmé |
| `[25]` | cap du radar | confirmé |

### 4.2 Construction de la caméra (confirmé, `0042b31c` `0042b3c6` à `0042c026`)

Les positions d'objet sont en 8.8 (`obj+0x1c/0x20/0x24` = x, y, z ; cap = `obj+0x34`, tangage `obj+0x38`, roulis `obj+0x3c`). Tables : `SIN[i] = round(256 sin(2π i/512))` à `00483188`, `COS` à `00483988`, `SIN320`/`COS320` (même formule avec 320) à `00483588` / `00483d88`, 512 entrées `int16` ; un cercle = 512.

```ts
const cap = obj.yaw & 511;                                          // obj+0x34
const T = [ (obj.x >> 8) + (SIN[cap] >> 1),  obj.y >> 8,  (obj.z >> 8) + (COS[cap] >> 1) ]; // 0x499cc8
const bank = clamp(-obj.roll * (1/75), -0.5, 0.5);                  // _DAT_00577644, lissé par /DAT_00481190
const a = (cap + view.yawOffset) & 511;
const horiz = (COS[view.elev] * view.dist) >> 8;
let C = [ T[0] - ((SIN[a] * horiz) >> 8),
          T[1] + ((SIN[view.elev] * view.dist) >> 8),
          T[2] - ((COS[a] * horiz) >> 8) ];                          // 0x52cad8
// déformation du terrain active (DAT_00587704 != 0, §10) : C.y += 900 (_DAT_00480388) et C.x/z reculent une seconde fois de la même quantité.
// garde-fou : C.y >= max(hauteur terrain en 5 points) / 256 + 120   (centre et ±30000 en x puis en z, en 8.8)
```

Lissage (si `view[1] == obj`, sinon réinitialisation instantanée) : `K = DAT_00481190` (14 au départ ; la boucle de jeu le recalcule tous les 120 pas : `max(5, imagesRendues / 3)`, hypothèse sur le sens exact) et `k = trunc(K / 4)` (3 pour 14) ; `view[6..8] += (T - view[6..8]) / k` ; `view[10..12] += (C - view[10..12]) / k` ; `view[13] += (bank - view[13]) / K`. Les écarts de plus de 20000 (en x ou z) entre la valeur lissée et la nouvelle sont ramenés de ±32768 (monde torique de 512 × 64). Flottants 32 bits (`Math.fround`). Le port peut lisser une fois par pas de simulation et ne se préoccuper de `K` que pour la vitesse.

Base de la caméra (flottants, `0042faf0` normalise, `0042fba8` produit vectoriel `a × b = (a1b2 - a2b1, a2b0 - a0b2, a0b1 - a1b0)`) :

```ts
f = normalize(Tlisse - Clisse);
r = normalize(cross([0, 1, 0], f));  r[1] = view.bank;  r = normalize(r);
if (Math.abs(f[1]) > 0.9) { f = normalize(f + 0.4 * r);  r = normalize(cross([0, 1, 0], f)); r[1] = view.bank; r = normalize(r); }
up = normalize(cross(f, r));
r = normalize(cross(up, f));
```

### 4.3 Constantes de projection (confirmé)

```ts
const width = right - left;                    // 319
let Sx = width;                                 // DAT_0048116c
let Sy = Math.trunc(width * 5 / 3);             // DAT_00577614 = 531
Sx = ((zoom + 0x20) * Sx) >> 7;                 // zoom = DAT_00480c78 = 96 → facteur 1 (seul le menu de capture le modifie)
Sy = ((zoom + 0x20) * Sy) >> 7;
const camInt = C.map(Math.trunc);               // 005774e8/ec/f0
const R = [r.x, r.y, r.z].map(v => Math.trunc(Sx * v));   // 005775ec/f0/f4
const U = [up.x, up.y, up.z].map(v => Math.trunc(Sy * v)); // 005775f8/fc/600
const F = [f.x, f.y, f.z].map(v => Math.trunc(256 * v));   // 00577618/1c/20
// aussi 005775e0.. (256 * up), 00577604.. (256 * r), 00577624/28 = trunc(256 * (fx, fz) / |(fx,fz)|) pour les objets « face caméra »
```

`FUN_00470cc8` (Watcom `__CHP`) **tronque vers zéro** (`FRNDINT` avec RC = 11). Pour un point monde `P` :

```ts
const d = P - camInt;                                            // entiers
const X = d.x*R[0] + d.y*R[1] + d.z*R[2];
const Y = d.x*U[0] + d.y*U[1] + d.z*U[2];
const D = ((d.x*F[0] + d.y*F[1] + d.z*F[2]) >> 8) + 0x19;       // profondeur ; 0x19 = 25 unités de recul
if (D > 0) { sx = Math.trunc(X / D) + cx; sy = cy - Math.trunc(Y / D); }  // sinon x, y inchangés (valeurs de l'appel précédent)
```

Avec l'écran plein : `cx = 159`, `cy = 199`, `Sx = 319`, `Sy = 531` ; champ de vue ≈ 53° horizontal, 41° vertical. **Plans** : un sommet de terrain est « visible » si `101 <= D <= 1999` et `left <= sx <= right` (§6.4) ; un objet est retenu si `-10 < D - 0x19 < 2000` et `|sx - cx| < largeur + 0x14`, `|sy - cy| < 400 + 0x1e` (hauteur `DAT_005876f0`). Pas de plan proche géométrique : les faces à `D <= 0` envoient leurs sommets à `(right, bottom)`.

## 5. Réglages, détail et brouillard

Menu Setup (`gm_menu_setup`, `0041b03c`, chaînes `GLOBAL 100` table 2) : **« Screen Size »** (id 16, fr. « Taille de l'écran », variable `00480c88`) et **« Detail Level »** (id 17, fr. « Résolution », variable `00480c64`), affichés si `DAT_0048464c == 0` et `DAT_00484624 == 0` (pas de MMX). Avec MMX `gm_frame` écrit `00480c88 = 0xff` et `00480c64 = 0xf0` en tête d'image : le port peut fixer `screenSize = 255`, `detail = 240`. « Fog [%s] » (id 101) n'existe que pour `DAT_0048464c == 1` (accéléré) : en logiciel le brouillard est toujours actif et vaut la formule du §6.3.

Seuils de `detail` (confirmé, `gm_render_view`) :

| Élément | `detail <= 0x40` | `0x41 .. 0x80` | `> 0x80` |
| --- | --- | --- | --- |
| Faces de type 0 et 2 | plat (`00430f40`) | plat | Gouraud (`00430380`, plat si les 3 lumières sont égales) |
| Faces de type 4 | plat, **opaque** | plat, opaque | à clé de transparence, non éclairé (`004329b4`) |
| Faces de type 0x28 (ombres) | polygone noir (`00432264`) | ombre texturée (`00433f64`) | ombre texturée |

| Élément | `detail < 0xaa` | `detail >= 0xaa` | `detail == 0xf0` |
| --- | --- | --- | --- |
| Terrain | couleur plate `t106[(lum >> 1) << 8 \| carte102]` (`004147df`) | texturé (`004141d0`, ou `004144fb` avec MMX) | + animation de la tuile d'eau (`00437b64`) |

Les types 1 (rotor), 5, `0x2a`, `0x2d`, `0x2e` sont tracés de la même façon à tout niveau. Le port ne gère que le niveau maximal (240, MMX) ; les autres sont décrits pour référence.

## 6. Terrain

### 6.1 Données et conventions (confirmé)

- Hauteur `SLV 100` (512×512 octets, `005b1fc4`), couleur de sol `SLV 102` (`005b1fa8`), indices `& 0x1ff` (monde torique). Une cellule = 64 unités ; une unité de hauteur = 4 unités monde ; le sommet `(cx, cz)` est en `(cx*64, h*4, cz*64)`.
- Texture de sol : le bloc `12000` est lu comme **32 tuiles 64×64 contiguës** de 4096 octets (`+0x8100`, `DAT_0058369c`), tuile `t = carte102 >> 3` (et non comme un atlas de 256 colonnes : lire ligne `2 * v` d'un atlas large revient à cette tuile, d'où l'observation de `slv.md`). Valeur `< 0x20` = eau : tuiles 0 à 3, la tuile 0 est animée.
- Table de lumière du sol : celle de l'emplacement 0 (12000).
- Carte d'éclairs au sol `005624c8` (64×64 entiers, repliée : case `(cz & 63) · 64 + (cx & 63)` du sommet `(cx, cz)`, soit `pos >> 14` en Q8) (confirmé). Remise à zéro au chargement du niveau (`gm_slv_load`, `004545a8`). `gm_ground_flash_add` (`004259b4`, EAX = x, EDX = z en Q8, EBX = intensité 0..3) ajoute au **carré 3×3** centré sur la cellule `0x100 · (n + 1)` au centre, la moitié aux 4 bords, le quart aux 4 coins et aux 4 cases à distance 2 (croix), sans plafond. Seul appelant : `gm_object_explode` (`00443ac0`), avec `n` = taille d'explosion + 1 (1, 2 ou 3 selon le rayon² `< 1000`, `< 5000`, au-delà) ; l'intensité 0 n'est jamais utilisée. `gm_ground_flash_fade` (`0042fc70`), à chaque tick juste après la mise à jour des objets, retire `0x1e` à chaque case non nulle (plancher 0) : un centre de `0x400` s'éteint en 35 ticks. La valeur s'ajoute à la lumière du sommet avant l'eau et le brouillard (§6.2) : l'eau l'écrase, la borne `[15, 110]` la plafonne (sur sol plat, ≈ 103, l'éclair n'apporte que 7 niveaux ; il se voit surtout sur les pentes sombres). Port : `engine/terrain.ts` (`addGroundFlash`, `fadeGroundFlash`), `World.groundFlash`, `RenderView.groundFlash`.

### 6.2 Projection et éclairage d'un sommet (`gm_terrain_project_lit`, `00426c14`)

```ts
function projectLit(cx: number, cz: number, out: Vertex) {
  const H = (x, z) => height[((z & 511) << 9) + (x & 511)];
  const h0 = H(cx, cz);
  const v = [H(cx, cz - 1) - H(cx, cz + 1), 0x40, H(cx - 1, cz) - H(cx + 1, cz)];   // (dz, 64, dx)
  normalize256(v);                                                                   // 00415374
  let light = (v[1]*0x93 - v[0]*0x93 + v[2]*0x93) >> 9;    if (light < 0) light = 0;  light += 0x1e;
  light += flashMap[(cx & 63) + (cz & 63) * 64];
  let colour = ground[((cz & 511) << 9) + (cx & 511)];
  let hy = h0 * 4;
  if ((waterMode & 1) && (colour & 0xe0) === 0) {          // eau : sommet animé
    const w = WAVE[(cz * 4 + frame154 + SIN[(cx & 31) * 16]) & 31];
    hy += w;  light = w * 2 + 0x50;  colour = 0;
  }
  // déformations (§10) ; puis projection du §4.3 avec P = (cx*64, hy, cz*64)
  const fog = (2000 - D) >> 2;  if (fog < light) light = fog;
  light = clamp(light, 0x0f, 0x6e);
  out = { x, y, light, colour, depth: D, visible: (x >= left && x <= right && D >= 0x65 && D <= 1999) };
}
function normalize256(v) {                                   // 00415374
  let u = (v.x*v.x + v.y*v.y + v.z*v.z) >>> 11;  if (u > 4000) u = 4000;  if (u === 0) u = 4000;
  const r = RECIP_FFFF[ISQRT256[u] >> 8];                    // ISQRT256[i] = trunc(sqrt(i * 2048) * 256)
  v.x = (v.x*r) >> 8; v.y = (v.y*r) >> 8; v.z = (v.z*r) >> 8;
}
```

`RECIP_FFFF[n] = trunc(0xffff / n)` (`005836ac`, `[0] = 0xffff`, n jusqu'à 0xfff), `WAVE[i] = round(16 sin(π i / 32))`, 32 entrées (`00481050`). `waterMode = DAT_00577670` (variable 3 du script : 3 par défaut et dans TERRAN00-03, 1 dans une mission, 0 sur Lune/Mars ; bit 0 = vagues sur les sommets d'eau, bit 1 = hauteur « avec vagues » pour les objets). Lumière plate : `0x1e + (0x93 * (64 - dz + dx) normalisé) >> 9` ≈ 103 sur sol plat. La variante `gm_terrain_project_flat` (`004268fc`) ne calcule ni lumière ni couleur : même projection (vagues comprises) plus le drapeau ; elle sert à découper les rangées et met à jour l'horizon : si `D > 2000` et `y > DAT_00480c74`, `DAT_00480c74 = y`.

Le champ `[6]` de l'enregistrement (valeur de la carte de flashs, `(v & 0x3f) + 0xc0` au-delà de 255) n'est lu que par les chemins accélérés.

### 6.3 Brouillard (confirmé)

Pas de mélange de couleur : la lumière du sommet est plafonnée par `(2000 - D) >> 2` puis bornée à `[15, 110]`. Un sommet à `D >= 1940` est donc à la lumière plancher 15 ; à `D = 1000`, plafond 250 (sans effet) : la lumière naturelle (≈ 103) domine jusqu'à `D ≈ 1590`, puis décroît linéairement. Le ciel (indice 0) est noir : l'horizon est un fondu vers le noir. Aucune distance de brouillard configurable. Les objets ne reçoivent **pas** ce brouillard (leur lumière est celle des normales + ambiant, plafond 110) ; ils disparaissent à `D >= 2000`.

### 6.4 Rangées (confirmé : `0042b05c`, `00429e1c`, `00429c30`)

Le terrain n'est pas balayé en triangles mais **rangée par rangée** : une rangée est une ligne de sommets alignée sur une des 8 directions de la grille, la plus proche de l'axe horizontal de l'écran.

```ts
// 0042b05c : direction de rangée = celle des 8 qui maximise <direction, droite de la caméra> (strictement, premier maximum)
const DIRS = [ // [longX, longZ, rangeeX, rangeeZ] : pas le long d'une rangée (00577678/7c) et pas de rangée à rangée (00577680/88)
  [ 1, 0,  0, 1], [ 1,-1,  0, 1], [ 0,-1,  1, 0], [-1,-1,  1, 0],
  [-1, 0,  0,-1], [-1, 1,  0,-1], [ 0, 1, -1, 0], [ 1, 1, -1, 0] ];
let best = 0, bd = 0;
for (let k = 0; k < 8; k++) { const a = (0x80 + k * 0x40) & 511; const d = SIN[a] * R[0] + R[2] * COS[a]; if (bd < d) { best = k; bd = d; } }
```

Le pas entre rangées pointe **vers l'avant** (le sens qui augmente la profondeur). Construction :

```ts
// rangée centrale : maille de la cible lissée, déplacée par pas de rangée jusqu'à D = 0x4b0 (1200)
let g = [trunc(Tlisse.x / 64), trunc(Tlisse.z / 64)];  projectFlat(g);
while (V.depth < 0x4b0) { g += pasRangee; g += (V.x < cx) ? +pasLong : -pasLong; projectFlat(g); }   // recentre sur l'écran
while (V.depth > 0x4b0) { g -= pasRangee; g += (V.x < cx) ? +pasLong : -pasLong; projectFlat(g); }
g = [g.x & ~1, g.z & ~1];                                    // coordonnées paires
// vers la caméra : pas de 1 ; vers le fond : pas de 2
let s = g, e = g, a = 400;
do { a--; rows[a] = clipRow(s, e); s = rows[a].start - pasRangee; e = rows[a].end - pasRangee; } while (s != e);
s = e = g + 2 * pasRangee;  b = 400;
do { rows[b++] = clipRow(s, e); s = rows[b-1].start + 2*pasRangee; e = rows[b-1].end + 2*pasRangee; } while (s != e);
horizon = DAT_00480c74 + 0x14;
```

(Les boucles C imbriquées `do { do {…} while (x != x) } while (z != z)` s'arrêtent quand début et fin coïncident en x **et** en z, comme ci-dessus.) `clipRow` (`00429c30`) borne la rangée à ses sommets visibles :

```ts
// début : si invisible, avancer jusqu'au premier visible et garder le dernier invisible ; si visible, reculer jusqu'au premier invisible.
// fin   : symétrique. Une rangée dont le début rejoint la fin est vide et termine la boucle (elle est quand même rangée).
```

Chaque rangée est donc un segment de sommets `[début .. fin]` pas `pasLong`, bornes comprises, avec **un sommet de marge** de chaque côté. Le rendu parcourt `rows[a .. b-1]` du plus proche au plus lointain. Avec le plan lointain à `D = 1999`, une image compte ≈ 25 à 40 rangées et 400 à 900 segments.

### 6.5 Bande verticale par colonne (confirmé : `004144fb` MMX, `004141d0` entier, `004147df` plat)

Pour chaque rangée, pour chaque paire de sommets voisins `(V0, V1)` ; `V1.x` est ramené à `max(V1.x, V0.x)` ; `n = |V1.x - V0.x|` (+ « excédent » de la première paire quand le début est hors de l'écran à gauche : `excess = left - V0.x`, `V0.x = left`). Les valeurs sont interpolées linéairement **par colonne d'écran** entre `V0` et `V1` ; chaque colonne conserve la valeur de la rangée précédente et remplit le tronçon vertical entre les deux, de bas en haut.

Enregistrement de colonne (321 × 0x48 octets à `0052d2e8`, réinitialisé à chaque image) : `ytop` (+0x10, init `bottom` = 399), `fb` (+0x14, pointeur de ligne = `ytop + 1`), `flag` (+0x18, 0), liste d'horizon (+0x1c, vide, voir ci-dessous), `prevY` (+0x20, 99999), `curY` (+0x34, 99999), états courant/précédent (+0x00 / +0x08 en MMX ; +0x24..0x44 en scalaire). **Les états ne sont pas réinitialisés** : seul le contenu de l'image précédente (ou de la vue précédente) y traîne, ce qui influence le gradient de la première bande de chaque colonne.

```ts
// variante MMX, quatre mots de 16 bits par état : [u, v, lumière, couleur]
state0 = [ (px << 12), (pz << 12), (V0.light << 8), (V0.colour << 6) ] & 0xffff;   // px, pz = maille de V0
if (n > 1) {
  const R = RECIP_FFFF[n];
  yStep = ((V1.y - V0.y) * R) >> 8;
  step = [ ((cx - px) * R) >> 4, ((cz - pz) * R) >> 4, ((V1.light - V0.light) * R) >> 8, ((V1.colour - V0.colour) * R) >> 10 ] & 0xffff;
  if (excess > 0) { yAcc += yStep * excess; state0 += step * excess; excess = 0; }     // seulement si n > 1
}
if (V1.x > right) V1.x = right + 1;
for (x = V0.x; x < V1.x; x++) {
  const rec = col[x];  const y = yAcc >> 8;  yAcc += yStep;
  rec.state = state; const cur = state; state = (state + step) & 0xffff;  // PADDW
  rec.curY = y;
  // ligne d'horizon : détecte les crêtes
  let flag = 1;
  if (y > rec.ytop) { if (rec.flag === 1) { rec.list.unshift({ z: max(V0.depth, V1.depth), y: rec.ytop - 2 }); flag = 0; } else flag = rec.flag; }
  rec.flag = flag;
  const yc = Math.max(y, clipTop);         // clipTop = top - 1 = -1
  const n2 = rec.ytop - yc;
  if (n2 > 0) {
    const ytopOld = rec.ytop;  rec.ytop -= n2;
    const d = rec.prevY - y;  const Rr = (d > 0 && d <= 4000) ? RECIP_16[d] : 0;     // RECIP_16[d] = min(0x7ff8, 0x10000 / d), 0x57f694
    if (n2 !== 1 && ytopOld === rec.prevY) {          // cas normal : remplir de bas en haut depuis l'état précédent
      step2 = mulhw(cur - rec.prevState, Rr) ;  s = rec.prevState;  dir = -1;  firstRow = ytopOld;
    } else if (n2 !== 1) {                             // bande partiellement cachée : remplir de haut en bas depuis l'état courant
      step2 = mulhw(rec.prevState - cur, Rr);   s = cur;  dir = +1;  firstRow = yc + 1;
    } else { s = cur; step2 = MM3_obsolete; dir = -1; firstRow = ytopOld; }            // une seule ligne : pas périmé
    // pixels : ligne firstRow, firstRow + dir, … (n2 lignes)
    let L = (s[2] & 0x7fff);
    for (let i = 0; i < n2; i++) {
      L += step2[2];                                                   // la lumière avance AVANT le premier pixel
      const texel = tex0[((s[3] >> 9) & 31) << 12 | ((s[1] >> 7) & 63) << 6 | ((s[0] >> 7) & 63)];
      fb[(firstRow + dir * i) * 320 + x] = lightTable0[(((L >> 8) & 127) << 8) | texel];
      s = (s + step2) & 0xffff;                                       // u, v, lumière, couleur ensemble
    }
  }
  rec.prevY = rec.curY;  rec.prevState = rec.state;
}
// mulhw(a, r) = ((a16 * r) >> 16) + (a16 < 0 ? 1 : 0) par mot signé de 16 bits (PMULHW puis PSRLW 15) ; a16 = (a << 16) >> 16
```

Points précis :

- Les lignes écrites vont de `yc + 1` à `ytopOld` (inclus) : `ytop` est l'index de la première ligne **non** dessinée ; la ligne `y` de la crête elle-même est écrite par la bande suivante (le bas de l'écran est ligne 399, et `ytop = 399` au départ).
- La texture : colonne `(u >> 7) & 63`, ligne `(v >> 7) & 63`, tuile `(couleur >> 9) & 31`, soit `carte102 >> 3` ; `u = x * 4096`, `v = z * 4096` (mod 65536) ; une tuile couvre donc **2 × 2 cellules**.
- Interpolation de `u`, `v` entre rangées : la différence est prise modulo 16 bits, donc le raccord à la frontière de 16 cellules est correct.
- La lumière du pixel `i` est `L0 + (i + 1) * pasLumière` (un pas d'avance) ; les coordonnées de texture sont `s0 + i * pas`. Écart à l'asm : le compteur de la boucle est l'octet bas de `ECX` (`DEC CL`) : une bande de plus de 255 lignes ne dessine que `n & 0xff` lignes (256 si `n & 0xff == 0`) alors que `ytop` recule de `n` : trou visible possible quand l'horizon est à plus de 255 lignes au-dessus de la première rangée (caméra très plongeante). **À corriger dans le port** (compteur complet), l'effet n'étant qu'un défaut.
- Variante entière (`004141d0`) : mêmes formules en 32 bits (`u = x << 11`, `v = z << 11`, couleur `<< 14`, lumière `<< 16`, pas `*R >> 4/ >> 4/ >> 2/ >> 0` avec `R = 0xffff/n`), table `0x7fffffff / d` et `mulh 64 bits` pour le pas par pixel, `u` et couleur empaquetés dans un mot (`couleur << 12 | u & 0xfff`). Tuile `((c8 << 12 | u) >> 6) & 0x1f000`. Elle donne le même aspect.
- Variante plate (`004147df`, `detail < 0xaa`) : pas de texture, `pixel = t106[((lumière >> 1) << 8) | couleur]` avec interpolation entière identique.

La **ligne d'horizon** de chaque colonne (`rec.list`) est consultée par tous les rastériseurs d'objets : une entrée `(z, y)` signifie « un relief plus proche que `z` cache tout ce qui est en dessous de la ligne `y` » ; un objet de profondeur de clé `K` est découpé à `y < y_entrée` pour chaque entrée avec `z < K`.

### 6.6 Eau

- **Vagues** : sommets de couleur `< 0x20` (si `waterMode & 1`) : `hauteur += WAVE[(cz*4 + frame + SIN[(cx & 31)*16]) & 31]`, lumière `w*2 + 0x50`, couleur forcée à 0 (tuile 0).
- **Animation de la tuile** (`gm_water_animate`, `00437b64`, appelée par `gm_frame` si `waterMode != 0` et `detail == 0xf0`, avec `EAX = frame*9`, `EDX = frame*7`, `frame = 00481154`) : la tuile 0 est recalculée à partir de la tuile 1 :

```ts
for (i = 0; i < 64; i++) { A[i] = SIN[(9*frame + 8*i) & 511] >> 6;  B[i] = SIN[(7*frame + 8*i) & 511] >> 6; }
for (r = 0; r < 64; r++) for (c = 0; c < 64; c++) tex[r*64 + c] = tex[0x1000 + (((r + B[c]) & 63) << 6 | ((A[r] + c) & 63))];
```

- Hauteur « d'eau » pour les objets (`gm_terrain_height_water`, `00425c94`, si `waterMode & 2`) : interpolation bilinéaire des 4 sommets, chacun majoré de `WAVE[..] * 0x100` s'il est en eau ; sinon (`& 2 == 0`) interpolation simple (`gm_terrain_height`, `004256c0`).

### 6.7 Ciel et horizon

Pas de ciel dessiné : indice 0. MMX : `gm_fb_clear_sky` (`0041406c`) met à 0 les lignes `0 .. min(DAT_00480c74, 399) - 1` des quatre plans avant le terrain ; `DAT_00480c74` est le plus grand `y` projeté d'un sommet de profondeur `> 2000` rencontré lors de la construction des rangées, plus `0x14`. Sans MMX, tout le tampon est effacé à 0 avant le rendu. Aucune ligne d'horizon n'est tracée : la limite est celle du terrain brouillardé.

## 7. Objets : collecte et transformation (`gm_render_terrain`, `0042718c`)

### 7.1 Fenêtre 7×7

Les objets sont chaînés dans une table de 64×64 compartiments de 512 unités (`0056b2d8`, entrée `((x >> 17) & 63) + ((z >> 11) & 0xfc0)` sur les coordonnées 8.8). Pour la vue, on parcourt **7×7 compartiments centrés sur celui de l'objet suivi** (`(obj.x >> 17) - 3 .. +3`, idem z), avec décalage de ±32768 si l'indice sort de `[0, 64)` (monde torique). Distance de tirage effective : profondeur 2000.

### 7.2 Transformation d'un modèle (confirmé)

Objet : position 8.8 `obj[7..9]`, cap `obj[0xd]`, tangage `obj[0xe]`, roulis `obj[0xf]`, emplacement de modèle `obj[0x13]` (`< 10000` = modèle, voir §9 pour les sprites), indicateurs `obj+4` (bit `0x80` : face caméra), `obj+5` (bit 4 : trait vers `obj[0x17]`), `obj+6` (bit 0 : pas d'animation de texture ; bit 1 : plein feu, effacé après le tracé ; bit 4 : animation rapide). Après le test de visibilité du §4.3, pour chaque sommet `(x, y, z, mode)` du modèle (`models.md`) :

```ts
const s1 = SIN[(-pitch) & 511], c1 = COS[(-pitch) & 511], s2 = SIN[(-roll) & 511], c2 = COS[(-roll) & 511];
let s3 = SIN[(-yaw) & 511], c3 = COS[(-yaw) & 511];
if (obj.faceCamera) { s3 = -horizFwd256.x; c3 = horizFwd256.z; }         // 00577624 / 00577628
if (v.mode !== 1) {                                                         // mode 1 : sommet collé au sol, pas de tangage/roulis
  const t = (y*c1 - z*s1) >> 8;  z = (y*s1 + z*c1) >> 8;
  const x0 = x;  x = (x0*c2 - t*s2) >> 8;  y = (x0*s2 + t*c2) >> 8;
}
const z2 = (x*s3 + z*c3) >> 8;  x = (x*c3 - z*s3) >> 8;  z = z2;
x += obj.x >> 8 (+ décalage torique);  y += obj.y >> 8;  z += obj.z >> 8;
if (v.mode !== 0) { const g = groundHeightWater(x << 8, z << 8) >> 8; y = (v.mode === 1) ? g : Math.max(y, g); }
// déformations (§10) ; projection du §4.3 → (sx, sy, D) ; D < 1 → (right, bottom)
```

Il n'y a **pas de facteur d'échelle** sur les sommets : unités monde. Les trois constantes `0x93` (147) de `0048115c/58/60` ne servent qu'au vecteur lumière.

### 7.3 Éclairage de Gouraud (confirmé)

```ts
// vecteur lumière en repère modèle (147,147,147 tourné par l'orientation ; la 320 vient de l'étirement vertical ×1,25)
const ay = pitch & 511, ap = roll & 511, ar = yaw & 511;
const i4 = (COS[ay]*147 - SIN[ay]*147) >> 8,  i5 = (147*SIN[ay] + COS[ay]*147) >> 8;
const i6 = (COS320[ap]*147 - i4*SIN320[ap]) >> 8;
const L1 = (SIN320[ap]*147 + i4*COS320[ap]) >> 8;
const L0 = (COS[ar]*i6 - i5*SIN[ar]) >> 8,  L2 = (SIN[ar]*i6 + i5*COS[ar]) >> 8;
// par normale (longueur 100) :
let l = (n.z*L2 + n.y*L1 + n.x*L0) >> 8;  if (l < 0) l = 0;  l += model.ambient;  if (l > 0x6e) l = 0x6e;
// obj.fullBright (obj+6 bit 1) : toutes les intensités = 0x7f
```

Chaque sommet d'un triangle prend l'intensité de **sa propre** normale (`face.nidx[k]`). Pour `obj` à orientation nulle `L = (183, 183, 147)`.

### 7.4 Faces mises en file (confirmé)

Pour chaque triangle : sommets écran `x[3], y[3]`, `u[3] = face.u[k]`, `v[3] = face.v[k] + anim`, lumières `l[3]`, texture `t = face.tex`, type `face.type & 0xff`. `anim = (face.flags & 2) && !(obj+6 & 1) ? ((phase & 3) << 4) : 0` avec `phase = (obj+6 & 0x10) ? frame154 : frame154 >> 2`.

| Type | Mis en file si | Clé de tri | Tracé |
| --- | --- | --- | --- |
| 0 | `(x1-x0)(y2-y0) > (x2-x0)(y1-y0)` (face avant) | max des `D` des 3 sommets | Gouraud ; plat si les 3 lumières sont égales |
| 2 | toujours | idem | idem (double face) |
| 4 | toujours | idem | texel 0 transparent, sinon `t[100][texel]` (non éclairé) |
| 1 | toujours | `max D` de l'objet si face avant, `min D` sinon | disque d'hélice (§8.4) ; u, v remplacés par des points d'un cercle |
| 5 | toujours | `min D` de l'objet | `t109[texture504[obj+0x50] << 8 | dst]` |
| `0x28` | face avant | `max D` de l'objet | ombre (§8.3) |
| 3, autres | rien dessiné | | |

La file (`00423620`) : au plus **2995 entrées** (`0xbb3`, 22 dwords chacune, base `00499d88`) par image et par vue ; au-delà, les faces sont perdues. Rejet à l'insertion des types 0, 1, 2, 4 si les trois sommets sont tous à gauche, à droite, au-dessus (`clipTop`) ou au-dessous du rectangle ; pas de rejet pour 5, `0x28`, `0x2a`, `0x2d`, `0x2e`. Ordre : **clé décroissante** (le plus lointain d'abord) ; à clés égales l'élément inséré passe avant s'il est cherché vers l'avant, après sinon (l'insertion part de la dernière position utilisée) : en pratique les faces à clé égale d'un même objet sortent dans l'ordre d'insertion. Tri **par face**, pas par objet. Les ombres (clé = profondeur maximale de l'objet) sont tracées avant ses faces.

## 8. Rastériseurs de triangles (en colonnes)

Tous les tracés de triangles remplissent **colonne par colonne** (le plan mode X est organisé par colonnes), en entiers, sans sous-pixel ni correction de perspective (interpolation affine en espace écran). Découpe : rectangle `[left, right]` en x (le dernier x tracé est `right - 1`, sauf pour l'ombre `00433f64` et le rotor `00433414` : `right`), `[clipTop, bottom]` en y, plus les lignes d'horizon (§6.5).

### 8.1 Mise en place de l'arête (commune, `00430380`)

```ts
// sommet de départ v0 = x minimal (à égalité, l'indice le plus grand) ; fc = (v0+1)%3 ; f8 = (v0+2)%3
dxA = |X[fc]-X[v0]| + 1;  dxB = |X[v0]-X[f8]| + 1;
sA = trunc((Y[fc]-Y[v0]) * 256 / dxA);  sB = trunc((Y[v0]-Y[f8]) * 256 / dxB);
if (-sA !== sB && sA <= -sB) { f8 = (v0+1)%3;  fc = (v0+2)%3;  /* recalculer dxA, dxB, sA, sB avec les nouveaux fc/f8 */ }
dxC = |X[f8]-X[fc]| + 1;  sC = trunc((Y[f8]-Y[fc]) * 256 / dxC);
// attribut A ∈ {v, u, lumière} : pente bas = (A[fc]-A[v0])*256/dxA ; pente haut = (A[v0]-A[f8])*256/dxB ; pente de l'arête fermante C = (A[f8]-A[fc])*256/dxC
// accumulateurs 8.8 : yHaut = yBas = Y[v0] << 8 ; idem pour u, v, lumière
for (x = xmin; x <= xmax; x++) {
  yHaut -= penteHaut; yBas += penteBas;  vHaut -= pv_haut; uHaut -= pu_haut; lHaut -= pl_haut;  vBas += pv_bas; uBas += pu_bas; lBas += pl_bas;   // AVANT d'utiliser la colonne
  if (x === X[fc]) { penteBas = sC; pv_bas = vC; ... }     // l'arête du bas passe sur l'arête fermante
  if (x === X[f8]) { penteHaut = sC; pv_haut = vC; ... }
  if (x < left) continue;
  y0 = yHaut >> 8;  y1 = yBas >> 8;
  si !( (clipTop <= y0 || clipTop <= y1) && (y0 <= bottom || y1 < bottom) && y0 < y1 ) continue;
  n = y1 - y0 + 2;                                          // deux lignes de plus que l'écart : pas de fissure
  // découpe haut : si y0 < clipTop : n += y0 - clipTop, états += pas * (clipTop - y0), y0 = clipTop ; bas : si y1 > bottom : n -= y1 - bottom, y1 = bottom
  // lignes d'horizon : pour chaque (z, y) de col[x].list avec z < clé : si y < y0 → n = 0 ; si y < y1 → n -= y1 - y ; y1 = y
  // n pixels à partir de la ligne y0
}
```

Les arêtes se retournent à `v0`, les lignes `y0..y1+1` sont écrites (l'écriture de la ligne 400 tombe dans la marge du plan : à ignorer).

### 8.2 Triangle texturé : Gouraud, plat, à clé (`00430380`, `00430f40`, `004329b4`)

Texels : `T = tuile du modèle` (`005b0690[t]`), index `((v >> 8) & 0x3f) << 8 | ((u >> 8) & 0x3f)` (**pas de ligne 256**, ligne = `v`, colonne = `u`) ; `LT = table de lumière` (`005b1950[t]`).

```ts
// Gouraud (00430380) : u, v en 8.8 empaquetés  packed = (v << 16) + u (int32) ; pas = (Δv/n) << 16 + Δu/n ; lumière 8.8
for (i = 0; i < n; i++) {
  texel = T[(((packed >>> 24) & 0x3f) << 8) | ((packed >> 8) & 0x3f)];
  pixel = LT[((lum >> 8) << 8) | texel];                         // ligne = partie entière de la lumière
  packed += pas; lum += pasLum;
}
// plat (00430f40) : lumière = l[0] pour toute la face (ligne LT + l[0]*256) ; u et v séparés : T[((v>>8)&63)<<8 | ((u>>8)&63)]
// à clé (004329b4) : plat, texel == 0 → pixel ignoré, sinon LT[100*256 + texel]
```

`00430380` délègue à `00430f40` si `l[0] == l[1] == l[2]`. Détails : le calcul de `lHaut` n'est pas fait dans la variante plate ; à la découpe du haut `00430f40` met `lum` à jour avec une variable périmée (sans effet). La ligne de lumière peut dépasser 127 (interpolation) : dépassement non vérifié, limiter à `& 127`.

### 8.3 Ombres (`00433f64`, `00432264`)

Les faces de type `0x28` (« décalques » de `models.md` : **ce sont les ombres**) sont des quadrilatères dont tous les sommets sont de mode 1 (collés au sol), `u, v` ∈ 0..255 indiquant une silhouette dans l'image `SLV 110`. Chaque pixel du sol sous la silhouette est assombri :

```ts
// u, v accumulés en 16.16 sur les arêtes, puis >> 8 par colonne ; index de l'image 110 = ((v >> 8) & 0xff) << 8 | ((u >> 8) & 0xff)
const s = s110[idx];                         // 0..31 ; 0 = pas d'ombre, 31 = noir
fb[p] = t500[(s << 8) | fb[p]];             // la table 500 (lignes 0..31) assombrit un indice de palette
```

À `detail <= 0x40`, `00432264` remplit le polygone avec l'indice 0 (noir plein).

### 8.4 Disque de rotor, type 1 (`00433414`)

```ts
// u, v = points d'un cercle de rayon 36 centré en (32, 32) : pour k = 0..2 : i = (frame150 + k*0x55) & 0xff ;
//   u[k] = ((SIN[2*i] * 0x24) >> 8) + 0x20 ;  v[k] = ((COS[2*i] * 0x24) >> 8) + 0x20 ;   frame150 += 10 par pas
// u, v accumulés <<15, >>10 puis empaquetés (v*0x800 + u)
const idx = (((p >>> 16) & 0x3f) << 6) | ((p >> 5) & 0x3f);        // image 64x64 de flou : t500[0x2000 + idx], valeurs 0..31
const b = t500[0x2000 + idx];
fb[px] = t500[(b << 8) | fb[px]];                                  // assombrit selon le masque
```

Le grand triangle inscrit dans le disque du rotor (3 sommets à 120°) est donc recouvert par un masque tournant ; son u/v du fichier (768, 21015) est ignoré.

### 8.5 Type 5 (`004349ac`)

Même mise en place (u, v `<<15`), texture = image 64×64 `GLOBAL 504` n° `obj[0x14]` (`+ frame * 0x1000`), `pixel = t109[(texel << 8) | dst]` : le texel est un numéro de ligne de la table 109 (0 = identité, donc transparent). Utilisé pour la fumée/explosion d'objets 3D.

## 9. Sprites, lignes et réticules

Tracés de la même manière colonne par colonne, découpés par les lignes d'horizon avec la clé de la file.

| Type | Origine | Tracé |
| --- | --- | --- |
| `0x2d` (`004353f4`) | `obj[0x13]` de 10000 à 10999 | **sprite 21×35 non mis à l'échelle** de `GLOBAL 505` (96 images rangées **par colonne**, `0x2df` octets), centré en `(sx, sy)` : colonnes `sx-10..sx+10`, lignes `sy-17..sy+17`, `pixel = t109[texel << 8 | dst]`. Image choisie par la distance : `taille = clamp((Sx * 0x15) / D - 5, 0, 15)`, `image = (15 - taille) + (slot - 10000) * 16` (6 séries de 16 images décroissantes). Clé = `D`. |
| `0x2e` (`00435688`) | `obj[0x13] >= 11000` | **image 64×64** de `GLOBAL 504` (56 images, `obj[0x14] << 12`), mise à l'échelle au plus proche sur `(2w+1) × (2h+1)` pixels autour de `(sx, sy)` avec `w = Sx * W[slot-11000] / D`, `h = Sy * H[slot-11000] / D` ; table des demi-tailles à `0x481014` par paires : (15,15), (10,10), (35,35), (40,40), (23,23), (160,·)… ; `pixel = t109[texel << 8 | dst]`. Colonne `c = ((n+1) * (0x3fff / largeur)) >> 8`, ligne `r = (k * (0x3f00 / hauteur)) >> 8`. |
| `0x2a` (`00430058`) | `obj+5` bit 4 | **ligne** de l'objet vers `obj[0x17]` (tracé de pente `Δy*256/Δx`), couleur = `t11003attr[0x107f]` (`DAT_005b1fb0`, ex. indice 109), clé = `(D0 + D1) >> 1` |
| réticule (`00437c38`) | cible verrouillée (`obj+0x58`) | **sprite 28 colonnes × 40 lignes** de `GLOBAL 506` (`frame * 0x488 + col * 0x28 + ligne`), `t109`, centré en `(x, y)` lissé (`x += (cible - x) >> 1`), tracé **après** la file donc devant tout ; image = `clamp((D >> 6) - 11, 0, 15)` ; **jaune** (images 0 à 15) = la cible du joueur `+0x58`, **rouge** (images 16 à 31) = l'objectif de tête de la liste des objectifs, tracé tant que le joueur a une cible |
| texte 3D (`00424454`) | mission | lettres extrudées du bloc `GLOBAL 200` en triangles pleins (`004359c8`, couleur d'attribut `005bc158[type]`), enfilés dans la file après le HUD, sans découpe de terrain |

Radar et HUD (`gm_draw_overlay_sw` `004362b8`, `gm_draw_hud` `0042ec80`) : hors du périmètre de R4 (voir `global-bd.md` et R3). Pour le rendu : le radar est une fenêtre de 64 colonnes collée au bord gauche, qui échantillonne `SLV 103` tournée autour du joueur (64 colonnes de spans précalculés dans `0048121c`, 3 dwords par colonne), des points de 2×2 pixels pour les objets (couleurs `005bc158[0x147f/0x47f/0x107f/0x157f/0x17f]`) et des images RLE `510`, `511`, `512` posées par `FUN_00414c7e`.

## 10. Effets de déformation (`gm_deformers_apply`, `004232ac`)

Liste chaînée `DAT_00587704` de nœuds de 0x18 octets `(x, y, z, durée, type, suivant)` : `+0x00/+0x04/+0x08` position 8.8, `+0x0c` ticks restants (qui servent aussi de rayon / phase, `taille` ci-dessous), `+0x10` type, `+0x14` suivant. Si elle n'est pas vide, **tout sommet de terrain** (`gm_terrain_project_flat` `004268fc`, qui ne garde que `y`, et `gm_terrain_project_lit` `00426c14`, qui garde `y`, lumière et couleur, avant le plafond de brouillard), **tout sommet de modèle** (après le placement au sol des sommets collés, seul `y` est gardé) **et toute position de sprite** (balles, explosions) passe par `004232ac` juste avant la projection, et la caméra prend un « plan large » (§4.2). Les écarts `P - nœud` ne sont pas repliés dans le tore. Le sommet est en unités monde (`P.x = cx << 6` pour le terrain) :

```ts
for (nd of liste) {
  const dx = P.x - (nd.x >> 8), dz = P.z - (nd.z >> 8);
  if (nd.type === 0) {                                       // onde de choc (bombe)
    let u = ((dx*dx + dz*dz) >> 9) + (nd.taille - 0x14) * 0x40;
    if (0 < u && u < 0x200) P.y -= (SIN[u & 511] * nd.taille) >> 5;
    u >>= 1;  if (0 < u && u < 0x200) light += SIN[u & 511];
  } else if (nd.type === 1) {                                // « dôme » (méga-bombe) : seul dx compte
    let k = ((dx >> 2)) + (nd.taille - 0x1e) * 0x10 + 0x80;
    if (0 < k && k < 0xff) { const h = SIN[k] * 2 - 300 + (nd.y >> 8); if (P.y < h) { colour = 0; light = 1000; P.y = h; } }
  } else if (nd.type === 2) {                                // anneau lumineux (caméra 7800)
    const u = ((dx*dx + dz*dz) >> 11) + (0x19 - nd.taille) * -0x40;
    if (0 < u && u < 0x200) light += (SIN[u & 511] * nd.taille) >> 5;
  }
}
```

Formules et producteurs **confirmés** (porté : `engine/deformers.ts`, `render/deformers.ts`) :

- **Réserve** : 5 nœuds (`0056f2d8`), chaînés dans la liste libre `00587714` par `gm_level_spawn_objects` (le nœud 4 en tête), liste active vidée. Prendre un nœud = l'ôter de la tête de la liste libre et le pousser en tête de la liste active.
- **Bombe** (`gm_upd_bomb_fly`, arme 7) : au 40ᵉ tick de vol, **si la liste libre n'est pas vide**, nœud de type 0 (onde : anneau qui s'enfonce puis se relève en s'élargissant, avec un anneau de lumière), position de la bombe, `y = gm_terrain_height(bombe)`, durée 0x28 ; sinon le vol continue et le test est refait au tick suivant.
- **Méga-bombe** (`gm_upd_bomb_shockwave`, arme 17) : même condition, type 1 (dôme), durée 0x3c, `y` = la plus basse des hauteurs du sol sous la bombe et sous le joueur. Le « dôme » ne dépend que de `dx` : c'est un mur infini en `z` qui balaie l'axe des x vers les x croissants (comme les dégâts de l'onde, `rules.md`) ; les sommets qu'il soulève prennent la couleur 0 (tuile d'eau) et la lumière 1000 (bornée à 110 par le brouillard) : une vague d'eau claire.
- **Mortier** (`gm_upd_mortar`, armes 6/16) : n'éclate que si la liste libre n'est pas vide, **sans prendre de nœud**.
- **Caméra de scénario 7800** (`gm_upd_camera` `00446a7c`, types absents des niveaux livrés, non portée) : type 2 (anneau de lumière), durée 0x28, prend le nœud **sans tester** la liste libre (`y` n'est pas écrit).
- **Durée** : à la fin de `gm_game_tick` (après la boucle des joueurs), chaque nœud actif perd 1 ; ceux qui passent sous 1 retournent en tête de la liste libre, les autres en tête d'une nouvelle liste active (l'ordre s'inverse à chaque tick ; il compte, le dôme écrasant `y`).
- **Pas de physique** : seuls les trois projecteurs ci-dessus appellent `004232ac` ; `gm_terrain_height` (sol des objets, collisions, garde-sol de la caméra) ignore les déformations, et la carte 100 n'est pas modifiée. Sans lien avec les éclairs au sol (§6.1) ni avec les cratères.

## 11. Prototype de vérification

Scripts jetables hors dépôt, dans `/private/tmp/claude-501/-Users-suzy-Repositories-retrovibe/05eebc03-1c7e-4340-b149-d5424537c369/scratchpad/r4/` : `lib.mjs` (blocs `.BD`, modèles, tables lues dans l'exécutable), `render.mjs` (caméra, rangées, bandes MMX, eau), `objects.mjs` (transformation, file, triangles Gouraud/plat/clé, ombre, rotor), `run2.mjs`/`run4.mjs` (scènes) ; `terrain00.png`, `water3.png`, `dirs.png` (8 caps + 4 intermédiaires, 0 trou), `scene.png`, `scene2.png`, `best.png`. Le rendu d'une image de terrain prend 6 à 8 ms en JS non optimisé. **Ce que le prototype a établi** :

- Terrain, rivière à rives sablonneuses et herbeuses, relief, horizon qui se fond dans le noir : conforme à ce qu'attend la carte 102 + tuiles 12000 + tables de lumière.
- Les 8 directions de rangées, sans trou ni couture visible.
- Modèles (chars 10203, hélicoptère 10990) correctement orientés, éclairés par normale (Gouraud), texturés, posés sur le sol, masqués derrière les crêtes par les lignes d'horizon ; ombre au sol et masque de rotor plausibles.

Ce que le prototype **n'a pas** vérifié : l'identité bit à bit avec le jeu (aucune capture de référence), les types 5 et sprites, les déformations, l'ordre exact des clés égales, le lissage de la caméra à cadence variable.

## 12. Points ouverts et écarts avec les documents existants

- **Écarts avec `slv.md`/`models.md` à corriger par le coordinateur** : le bloc 12000 est lu comme 32 tuiles contiguës de 64×64 par le terrain (pas comme un atlas à 256 colonnes) ; le type de face `0x28` est l'**ombre** (silhouettes `SLV 110` + table `SLV 500`), pas un « décalque » ; le type 4 est à clé de transparence (texel 0) non éclairé (ligne 100) ; le type 1 est un masque de flou `SLV 500` lignes 32..47 ; `SLV 106` est une table `[lumière/2][couleur 102]` (64 × 256) pour le terrain de faible détail ; `SLV 500` lignes 0..31 est la table d'assombrissement ; `gm_render_terrain` ne dessine pas le terrain, il collecte les objets ; « grille 7×7 » = compartiments d'objets de 512 unités, pas des cellules de 64.
- **Hypothèses** : sens de `DAT_00481190` (lissage de caméra), de la touche `0x43`, de la couleur d'ambiance (accéléré), de la cadence du CRTC (70 Hz non établie), de la ligne 127 des tables de lumière.
- **Ouverts** : contenu exact des 4 ensembles de tuiles (quel `t` pour quel modèle hors 14..68) ; états de colonne non initialisés (comportement de la première bande) ; dépassement de lumière `> 127` ; `FUN_00436c28` / `FUN_0046ff3c` (chemins accélérés) ; rôle de `DAT_005bc1d4`.
- **Écarts volontaires conseillés** pour le port : compteur de bande complet (pas 8 bits), tampon linéaire sans marge, états de colonne remis à zéro, pas de gamma, étirement 4:3 à la présentation.
- **Structure conseillée** : `Framebuffer` 320×400 indexé ; `View`/`Camera` purs ; `TerrainRenderer` (rangées + bandes + lignes d'horizon, tables de lumière et tuiles passées en entrée) ; `ObjectRenderer` (transformation, file, rastériseurs) ; `Sprites` ; chaque brique sans dépendance au DOM, testée par images de référence.

## 13. Fonctions à nommer

À fusionner par le coordinateur dans `keyfuncs.def.tsv` ; noms `gm_*` proposés (confiance : **c** = certain, **p** = probable, **h** = hypothèse).

| Adresse | Nom `gm_*` | Rôle (conf.) |
| --- | --- | --- |
| `0042718c` | `gm_render_objects` (actuel `gm_render_terrain`) | collecte des objets des compartiments 7×7, transformation, Gouraud, mise en file des faces et sprites (c) |
| `0042b05c` | `gm_terrain_pick_row_dir` | direction de rangée parmi 8 d'après la droite de la caméra (c) |
| `00429e1c` | `gm_terrain_build_rows` | construit les rangées proches (pas 1) et lointaines (pas 2) (c) |
| `00429c30` | `gm_terrain_clip_row` | borne une rangée à ses sommets visibles (c) |
| `004268fc` | `gm_terrain_project_flat` | projection d'un sommet sans éclairage, drapeau visible, horizon (c) |
| `00426c14` | `gm_terrain_project_lit` | projection + éclairage + vagues d'un sommet (c) |
| `00415374` | `gm_vec3_normalize_256` | normalise (x, y, z) à la longueur 256 (c) |
| `004153db` | `gm_vec2_normalize_256` | idem en (x, z) (p) |
| `0042469c` | `gm_gamma_build` | table de gamma 4×64 `pow` (c) |
| `0042477c` | `gm_render_init_tables` | réciproques, racines, cercle du rotor (`0052cae8`), pointeurs de colonnes (c) |
| `004232ac` | `gm_deformers_apply` | déformations du terrain (onde, mur d'eau, anneau) sur un sommet (c) |
| `00423620` | `gm_queue_insert` | insertion triée dans la file des primitives, rejet hors écran (c) |
| `00422eac` | `gm_queue_reset` | file à zéro (2995 entrées) (c) |
| `00423974` | `gm_text3d_emit_glyph` | enfile les triangles d'une lettre 3D du bloc 200 (p) |
| `00424454` | `gm_text3d_draw_all` | texte 3D des missions (p) |
| `004359c8` | `gm_draw_flat_tri` | triangle de couleur unie (texte 3D) (c) |
| `00425c94` | `gm_terrain_height_water` | hauteur bilinéaire 8.8 avec vagues (c) |
| `004259b4` | `gm_ground_flash_add` | éclair d'explosion dans la carte 64×64 `005624c8` (c) |
| `0042fc70` | `gm_ground_flash_fade` | décroissance de 0x1e par pas (c) |
| `0041406c` | `gm_fb_clear_sky` | efface les lignes au-dessus de l'horizon (MMX) (c) |
| `004141d0` | `gm_terrain_strip_scalar` | bande de terrain texturée, entiers (c) |
| `004144f8` | `gm_emms` | `EMMS; RET` (c) |
| `004144fb` | `gm_terrain_strip_mmx` | bande de terrain texturée, MMX (c) |
| `004147df` | `gm_terrain_strip_flat` | bande de terrain à couleur plate (table 106) (c) |
| `00437b64` | `gm_water_animate` | tuile d'eau gauchie par des sinus (c) |
| `0042fd8c` | `gm_fb_clear_all` | efface le tampon (sans MMX) (c) |
| `0042ff5c` | `gm_present_flip` | copie du tampon vers la VRAM et bascule de page (c) |
| `0042fddc` | `gm_palette_set` | efface l'écran, charge le DAC avec gamma, mémorise la palette (c) |
| `0042fd24` | `gm_screen_load_planes` | copie un écran 320×400 planaire (bloc 100x) dans le tampon (c) |
| `0042fe44` | `gm_modex_enter` | CRTC/séquenceur mode X, efface, palette (c) |
| `0042fec4` | `gm_modex_enter_black` | idem avec palette noire (c) |
| `0042fcac` | `gm_detect_mmx` | CPUID bit 23 → `00484620`/`00484624` (c) |
| `0042faf0` | `gm_vec3_normalize_f` | normalise un vecteur flottant (c) |
| `0042fba8` | `gm_vec3_cross_f` | produit vectoriel flottant (c) |
| `00430380` | `gm_tri_gouraud` | triangle texturé, lumière interpolée (c) |
| `00430f40` | `gm_tri_flat` | triangle texturé, lumière unie (c) |
| `004329b4` | `gm_tri_keyed` | triangle à texel 0 transparent, non éclairé (c) |
| `00432264` | `gm_tri_shadow_black` | polygone noir (ombre, détail faible) (c) |
| `00433f64` | `gm_tri_shadow` | ombre : silhouette 110 × table 500 (c) |
| `00433414` | `gm_tri_rotor` | disque de rotor : masque 500 × table 500 (c) |
| `004349ac` | `gm_tri_blend504` | triangle mélangé, image 504 × table 109 (c) |
| `00430058` | `gm_draw_line` | trait coloré d'un objet à un autre (c) |
| `004353f4` | `gm_sprite_505` | sprite 21×35 d'explosion/impact (c) |
| `00435688` | `gm_sprite_504` | animation d'explosion 64×64 mise à l'échelle (c) |
| `00437c38` | `gm_draw_crosshair` | réticule 28×40 de `GLOBAL 506` (c) |
| `004362b8` | `gm_draw_overlay_sw` | radar et surimpressions (déjà nommé) |
| `0042a084`, `0042a940` | `gm_game_step_solo`, `gm_game_step_net` | pas de simulation : incrémentent `00481154`, `00481150`, mesurent la cadence (`00481190`) (p) |
| `00470cc8` | `gm_ftol_trunc` | flottant → entier par troncature (`__CHP`) (c) |
| `00470ce6` | `gm_sqrt` | racine carrée (c) |
| `00470cb8` | `gm_pow` | puissance (c) |
