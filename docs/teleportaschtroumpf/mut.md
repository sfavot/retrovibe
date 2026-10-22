# Mine désaffectée (S36) : fichiers MUT et PRC

Décodeur : `src/games/teleportaschtroumpf/data/mut.ts` (`parseMut`, `parsePrc`). Tests : `test/teleportaschtroumpf/mut.test.ts`.
RE : `23c9:0004` (mini-jeu), `23c9:0dbd` (chargeur), `23c9:103e` (charge un tronçon), `357c:011d` (décodeur vidéo).

## Format MUT

Little-endian. Le fichier est une suite d'enregistrements jusqu'à la fin, sans en-tête global ni compteur :

| Champ | Type | Rôle |
|---|---|---|
| flags | u16 | masque d'aiguillages et d'obstacles du tronçon (voir plus bas) |
| taille | u32 | taille des données |
| données | `taille` octets | **chunk vidéo MUX** (voir `mux.md`) |

Le « début » observé dans la tâche (`01 00 | 2c 1d 00 00 | 04 00 00 00 00 | cf 0a 00 00 | f9 1c 00 00 | ...`) se lit donc : flags = 1, taille = 7 468, puis le corps d'un chunk vidéo MUX : flags vidéo `04` (LZ, intra), position de départ 0, taille « bits » 0x0acf, taille « couleurs » 0x1cf9, suivis des données LZ. Dans les 78 enregistrements des 8 fichiers : flags vidéo toujours 4, position toujours 0.

Chaque enregistrement se décode en une image **320 x 140** (44 800 pixels, indices de palette ; palette = `S36x.PAL`, 768 octets RGB 8 bits, `parsePal` de `mcg.ts`) : un tronçon de voie ferrée de la mine vu de dessus, avec trois rails verticaux (colonnes x = 81, 161, 241), des aiguillages en diagonale et des décors (champignons, lapins, légumes selon la variante). Les tronçons s'enchaînent verticalement sans couture. `parseMut` renvoie `{ tiles: { flags, width, height, pixels }[] }`.

`mut.ts` utilise directement `MuxVideoDecoder` (`mux.ts`) : chaque enregistrement est un payload de chunk vidéo, décodé dans un tampon 320x140 propre au tronçon avec une instance de décodeur réutilisée. Pas de problème de sémantique inter : tous les tronçons sont intra et indépendants.

### Contenu des 8 fichiers

| Fichier | Tronçons | PRC (éléments, max) | Flags des tronçons |
|---|---:|---|---|
| S36E | 11 | 59, 10 | 1 1 1 4 66 136 16 36 36 20 20 |
| S36F | 10 | 61, 9 | 1 1 1 4 66 136 16 36 36 20 |
| S36G, S36K | 9 | 61 et 32 | 1 1 1 1 66 136 16 36 20 ; MUT identiques (96 720 o), PRC différents |
| S36H | 10 | 57, 9 | 1 1 1 1 1 66 136 32 36 20 |
| S36I | 9 | 69, 8 | 1 1 1 1 66 136 40 36 20 |
| S36J | 9 | 31, 8 | 1 1 1 1 66 136 36 20 64 |
| S36L | 11 | 61, 10 | 1 1 1 1 1 66 136 16 36 20 64 |

### Bits de flags (déduits de `23c9:0004`)

Trois voies : gauche (x = 0x51), centre (0xa1), droite (0xf1). Test par touche :

| Bit | Test dans le code | Sens retenu |
|---|---|---|
| 0x80 | touche « droite » (bit 8 de l'état clavier `3646:b01b`), chariot à x = 0x51 | aiguillage gauche -> centre |
| 0x10 | « droite », x = 0xa1 | aiguillage centre -> droite |
| 0x40 | touche « gauche » (bit 4), x = 0xf1 | aiguillage droite -> centre |
| 0x20 | « gauche », x = 0xa1 | aiguillage centre -> gauche |
| 0x08 / 0x04 / 0x02 | collision si le chariot est à x = 0x51 / 0xa1 / 0xf1 et dans la fenêtre verticale de l'obstacle | obstacle sur la voie gauche / centre / droite |

Vérification visuelle sur S36E : le tronçon de flags 16 a un aiguillage centre -> droite, 36 (0x24) un aiguillage centre -> gauche avec un obstacle au centre, 66 (0x42) une jonction droite -> centre avec un obstacle à droite, 136 (0x88) une jonction gauche -> centre. Le bit 0x01 seul : tronçon libre (aucun test dans le code, mais c'est la valeur des tronçons sans aiguillage).

## Format PRC

Suite de u16 little-endian (45 à 138 octets) : chaque valeur est l'**indice (base 0) d'un enregistrement du MUT** de la même variante. C'est la liste des tronçons dans l'ordre du parcours (`23c9:0dbd` la copie dans le tableau `3646:730a` et mémorise `n - 1`). Toutes les valeurs sont < nombre de tronçons du MUT (vérifié sur les 8 fichiers). Les quatre derniers éléments sont toujours identiques (remplissage). Les `.FRM` et `.TRP` du CD sont des exports texte de la même suite et d'une autre liste (non utilisés par l'EXE).

## Déroulé du mini-jeu (`23c9:0004`)

1. **Variante.** Un octet de difficulté lu dans la table des scènes (`3646:6eb6 + scène * 0x14`, 0 à 3 ; 3 si Échap) choisit une paire de variantes via le `switch` `CS:23c9:0db5`, puis `rand` tranche : 0 -> L ou G, 1 -> F ou H, 2 -> E ou I, 3 -> J ou K (la première lettre si `rand` donne 0 : L, F, E, J ; sinon G, H, I, K). Lecture : `s36a000s.hy8` (sprites du chariot : 5 animations aux indices 0 à 4), `s36a001s.hy8` (animation de choc), voix `s36a001b/002b/003b.voc`.
2. **Chargement** (`23c9:0dbd`) : le MUT est lu enregistrement par enregistrement et rangé en EMS (flags dans `3646:7436[i]`, taille dans `72c2[i]`) ; la PRC est copiée dans `730a`. Tampons : 3 images de 64 000 octets (les trois tronçons visibles), 20 000 (enregistrement compressé), 30 000 (travail LZ).
3. **Départ** : les trois premiers éléments de la PRC sont décodés (`23c9:103e` charge l'enregistrement, `357c:011d` le décode) ; chariot à x = 0xa1 (0xf1 pour la variante J), y = 100, vitesse de défilement 10 px par image, vitesse verticale 5.
4. **Boucle** : défilement vertical par des copies de lignes dans les trois tampons ; haut/bas (bits 1 et 2 de l'état clavier) déplacent le chariot en y entre 0x3c et 0xaa ; gauche/droite changent de voie si le tronçon sous le chariot a l'aiguillage correspondant et que le chariot est dans la fenêtre verticale de l'aiguillage (sinon son d'échec, sans changement) ; heurter un obstacle déclenche l'animation de choc (`s36a001s.hy8`) et l'échec. Tous les 140 px de défilement, le tronçon suivant de la PRC est décodé dans le tampon libéré.
5. **Fin** : la boucle s'arrête dès qu'on a consommé la PRC jusqu'à l'avant-dernier élément ; échec (choc) -> `s36b.mux` ; réussite -> la scène est marquée faite (`1e52:0053`) et on joue `s36c1.mux` ou `s36c2.mux` selon `1e52:0008(1)` (rôle exact non établi).

`23c9:0fc0` (sans appelant) est un code de test : affiche les 11 enregistrements d'un MUT l'un après l'autre.

## Incertitudes

- Noms des bits de flags : directions déduites du code et confirmées visuellement, pas par un texte du jeu ; le rôle du bit 0x01 est supposé.
- Correspondance exacte des bits d'état clavier (`b01b` : 1 haut, 2 bas, 4 gauche, 8 droite) non vérifiée dans le pilote d'entrée.
- Détails de la fenêtre de collision et d'aiguillage (marges de 10 et 20 px autour de `3d518`) à reprendre dans `23c9:0004` à la phase 4.
- Raison du choix entre `s36c1` et `s36c2` à la réussite, et rôle des quatre éléments de remplissage de la PRC.
