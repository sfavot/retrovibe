# Écrans de préparation de partie : S09, S08, S04

Comportement de l'original (RE de `21ee:01d2`, `21ee:0435`, `21ee:0c19`, `21ee:13a1`, désassemblage `disasm.txt`) et de la reproduction TypeScript (`scenes/s09-players.ts`, `s08-characters.ts`, `s04-parents.ts`, aide commune dans `scenes/setup/`). Tests : `test/teleportaschtroumpf/setup-screens.test.ts`. Les adresses sont `segment:offset` ; « sûr » = lu dans le code, « mesuré » = relevé sur les images, « adaptation » = ajout propre au web (décision souris de `plan.md`, 2026-10-22).

## Conventions d'entrée communes (sûr)

- Drapeaux de navigation `DS:4BBB` : bit 1 haut, 2 bas, 4 gauche, 8 droite ; boutons `DS:4BBD` : 1 = clic gauche (Espace), 2 = clic droit (Entrée) (engine.md §4.1).
- `1f33:03a7(f)` attend la fin du son (avec `f` ≠ 0, un clic gauche le coupe) puis le relâchement des boutons ; `1f33:00fc(n)` attend `n` centièmes ; `1f33:030e` attend le relâchement des flèches ; `13fc:03f9` recopie l'écran, `13fc:0411` restaure le fond (B → A), `12ec:037c` appelé avec `[0x30e]` puis `[0x310]` empilés recopie A → B (fige l'image courante dans le fond ; sens inverse de `13fc:0411`).
- **Bip de navigation** : `348d:0b42(2, DS:7084)` joue `s07a001b.voc` (0,26 s, chargé par `21ee:0006` / `21ee:13a1` dans `DS:7084`) à chaque déplacement de sélection ; `0b42(1, 0)` interroge la fin du son. C'est le bip des **menus** (S07 aussi : `21ee:0e8f` l'appelle à chaque haut / bas), pas une voix d'entrée. Reproduit par le **canal de bruitage mélangé** (`voice.playEffect(s07a001b.voc)`, `engine.md` §5.2 bis) : il ne coupe ni la musique ni une voix. Dans S07, S08 (boutons) et S04 le bip est lancé sans condition (il remplace un bip en cours) ; pour le choix du personnage de S08, comme dans S46, S48, S49 et la carte, seulement si aucun bruitage ne sonne (`voice.effectPlaying`). L'original attend la fin du bip (`while (0b42(1, 0))`) avant de relire les touches : non reproduit.
- Aucune musique dans S09 ; S08 et S04 relancent la musique dans leur boucle (`15f9:089f(0, 0x100000)` puis `089f(DS:6F04, 0xA00002)`), pas pendant les attentes de voix : reproduit avec `voice.holdMusic`.

## S09 : nombre de joueurs (`21ee:01d2`)

Ressources : `s09a001d.mcg` (`13fc:0150`, drapeau 1 : fondu d'entrée), `s09a000s.hy8` (sprite 0 : bonhomme coloré), voix `s09v001..011t.voc`. Sûr.

1. Fondu d'entrée, puis voix d'accueil `s09v00(1 + rand%3)` (4,1 / 4,0 / 5,1 s) ; un clic gauche la coupe (`03a7(1)`) ; pause de 15 cs ; voix `s09v004` (« 1 joueur », 0,6 s) attendue jusqu'au bout.
2. Boucle : droite = +1 (si > 4, reste 4, pas de voix), gauche = −1 (si < 1, reste 1) ; **pas de rebouclage**. Un changement joue `s09v00(3 + n)` (004 à 007) et l'attend jusqu'au bout (entrées ignorées pendant ce temps). Le nombre colore les silhouettes : n ≥ 2 pose le sprite 0 en x = 124, n ≥ 3 aussi en 174, n = 4 aussi en 224 (bord gauche), ligne du bas y = 109. La première silhouette est déjà colorée dans le MCG.
3. Clic gauche : voix de validation (`s09v008` ou `011` pour 1 joueur, `009` ou `010` sinon, `rand%2`), coupée par un clic gauche, puis retourne n.
4. Pas de clic droit, pas de voix d'aide. Écart assumé : aucun.

Souris dans l'original : le clic gauche valide le nombre courant, la position du pointeur ne compte pas. Écart du port (doigt et souris) : toucher une silhouette choisit ce nombre et le valide, un appui ailleurs ne fait rien.
Écart de confiance : attendre les voix sans lire les entrées est conservé (voix de 0,6 s à 5 s).

## S08 : personnages et niveaux (`21ee:0435` puis `21ee:0c19`)

Ressources : `s08a001d.mcg` (fondu d'entrée), `s08a000s.hy8` (`DS:7088`, chargé par `21ee:0006`), voix `s08v001..017t.voc`, `s08a002b.voc` (chargé par `21ee:0435`, `DS:707E`), `s08a001b.voc`, bip `s07a001b.voc`. Sûr.

Sprites de `s08a000s.hy8` (rendus et vérifiés) : 0 à 3 pots d'encre, 4 à 9 les six personnages, 10 à 13 la capsule de téléportation (une par emplacement), 14 à 16 boutons « Jouer », « Annuler », « Retour », 17 à 19 icônes de niveau (« facile », « moyen », « dur »).

**Emplacements** (tableaux `DS:705D/7066/706E/7076`, `21ee:04fe..06c9`), pour 1 à 4 joueurs :

| Joueurs | x des pots / personnages | pots | x icône niveau | entrée de palette | capsules |
|---|---|---|---|---|---|
| 1 | 131 | 1 | 125 | 114 | 11 |
| 2 | 131, 196 | 1, 2 | 125, 200 | 114, 115 | 11, 12 |
| 3 | 64, 131, 196 | 0, 1, 2 | 53, 125, 200 | 113 à 115 | 10 à 12 |
| 4 | 64, 131, 196, 262 | 0 à 3 | 53, 125, 200, 273 | 113 à 116 | 10 à 13 |

Pots, personnages et capsules : ligne du bas y = 100 ; icône de niveau : y = 178.

**Choix d'un joueur** (`21ee:06e4..09d5`) : une fois le fondu fini, les pots sont posés (puis figés dans le fond). Niveau de départ 1, personnage libre tiré au hasard (`rand*6/0x8000`, puis incrémenté avant de tester la disponibilité). Droite / gauche : personnage libre suivant / précédent avec rebouclage sur 6 ; haut = niveau + 1, bas = niveau − 1 (rebouclage sur 0..2) ; chaque changement joue le bip. Le niveau copie la couleur du MCG (entrée 117 + niveau : vert, orange, rouge) sur l'entrée de palette de l'emplacement (`DS:591F + 3 × niveau` → `DS:57C0 + 3 × entrée`) : c'est la couleur des étiquettes des pots et du liseré de la capsule. Niveau 1 = couleur d'origine du MCG.
Clic droit : coupe le son, voix du personnage `s08v` (`1 + DS:1E6E[i]` = 3, 1, 4, 6, 5, 2 pour les sprites 4 à 9), attente, 20 cs, voix du niveau (`s08v015..017`), attente, 20 cs.
Clic gauche : validation.

**Validation** : l'image courante (personnage et icône) est figée dans le fond ; son coupé, 5 cs, voix `s08a001b` (0,63 s) ; la capsule descend de y = 0 à 95 par pas de 5 (20 images), puis y = 100 ; `s08a002b` (0,32 s, remplace la précédente) attendue ; la capsule est figée dans le fond. Le joueur est enregistré : niveau = valeur choisie, personnage de jeu = `{4:4, 5:0, 6:5, 7:2, 8:1, 9:3}[sprite]` (`DS:6EB4/6EB6`), le personnage n'est plus libre. S'il reste des joueurs : voix `s08v(7 + rand%5)` (1,3 à 4,2 s) attendue, puis 40 cs, puis le joueur suivant (niveau 1 de nouveau).
Cadence de la capsule : l'original ne temporise pas (une recopie d'écran par image) ; une image par tick (60/s) est une estimation (**probable**), soit 0,33 s.

**Boutons** (`21ee:0c19`, retourne 0, 1 ou 2) : trois sprites 14, 15, 16 en x = 265, y = 131, 155, 179, figés dans le fond. Sélection initiale 0 ; haut / bas avec rebouclage ; bip à chaque changement ; surbrillance par palette : le texte du bouton i (entrées 121 + i) prend la couleur de l'entrée 125 du MCG (cyan 0, 203, 239) ; l'ancienne couleur est restaurée en le quittant. Clic droit : voix `s08v(12 + i)` (012, 013, 014), attendue. Clic gauche : 0 = « Jouer » → `play`, 1 = « Annuler » → `back` (retour S09), 2 = « Retour » → `menu` (S07). Les noms des boutons viennent des images.

Souris dans l'original : gauche valide, droit joue la voix, sans tenir compte de la position du pointeur. Écart du port (doigt et souris) : toucher un des trois boutons le valide, un appui ailleurs ne fait rien. Le choix du personnage et du niveau reste au clavier.

## S04 : menu parents (`21ee:13a1`)

Ressources : `s04a001d.mcg` (`13fc:0084`, palette `DS:57C0`), `s04a000s.hy8`, `s07a001b.voc` (bip), police `DS:19AD` = `s52d001f.pfn`, `c:\smurf.cfg` (remplacé par `ctx.options` / `host.storage`). Sûr.

- Trois lignes : 0 durée (0..3, `d304 = (v+1) × 0x708` s), 1 pause avant de rejouer (0..4), 2 motif d'arrêt (0..8). Valeurs initiales lues dans le fichier (3 mots).
- Affichage (un `restoreBackground` par image) : cadran de durée = sprite `6 × v` de `s04a000s.hy8` en (73, 72) ; jauge de pause = sprite `19 + v` en (192, 110) ; message = texte en (43, 180) avec `s52d001f.pfn`, indice de couleur 0 (noir), police 16 px. Messages (version française, `21ee:1fc7..2071`) : voir `END_MESSAGES`. Les versions allemande et anglaise existent (`DS:617B` = `g`, `a`) ; seule la française est reproduite.
- Libellés : les entrées de palette 119, 120, 121 (« durée », « pause », « motif d'arrêt de jeu ») ; la ligne courante prend `10 A4 CC` (copie en `DS:5925..592D`), l'ancienne couleur est restaurée.
- Boucle : haut / bas = ligne −1 / +1, **bornée à 0..2** (pas de rebouclage) ; bip seulement quand la ligne change ; droite / gauche = valeur ±1 : durée et pause **bornées**, message **reboucle** (`> 8` → 0, `< 0` → 8, `21ee:1936..19b6` : pour la ligne 2 la valeur hors bornes est remplacée par l'autre extrémité). Changement de durée = animation de 7 images (`6 × v + 0..6` en avant, `6 × v − 0..6` en arrière), boucle bloquante (aucune entrée), une image par tick (**probable**, pas de temporisation dans l'original).
- Clic gauche (Espace) : valide et quitte (`32f4:0123(font, 0x7E)` restaure la police), écrit durée, pause, message, et la date de la dernière partie telle quelle (`DS:6E9C`). **Pas de voix, pas de sortie par Échap, pas de clic droit.** Les options ne sont écrites qu'à la validation.

Pas d'adaptation souris : clavier d'origine seul (gauche = valider, droit sans effet).

## Écarts et points ouverts

- Autres menus de l'original : seul `0b42(2, DS:7084)` (bip) est prouvé pour S07, S08 (boutons) et S04 ; le recensement complet de `348d:0b42` (`engine.md` §5.2 bis) prouve aussi le bip de navigation à S49 (`1823:000c`), S48 (`269a:0007`) et S46 (`1823:0415`), lancé seulement si rien ne sonne : ajouté (`changeSound` + `changeSoundIfIdle` du `Menu`). S09 n'a aucun appel `0b42` : pas de bip.
- L'EXE contient les messages S04 en trois langues, choisis par `DS:617B` ; ici seule la version française.
- Cadence des animations (capsule, cadran) estimée : l'original n'a pas de temporisation dans ces boucles.
