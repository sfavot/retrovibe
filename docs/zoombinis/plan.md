# L'Odyssée des Zoombinis : plan d'implémentation

Jeu : *L'Odyssée des Zoombinis* (*Logical Journey of the Zoombinis*, Broderbund / TERC, 1996, CD Windows 3.1 / 95, version 1.0FR).
Jeu de logique : on compose des groupes de 16 Zoombinis (cheveux, yeux, nez, pieds) et on les mène à travers une carte
de 12 épreuves vers Zoombiniville, à 4 niveaux de difficulté.
Moteur « Mohawk » de Broderbund, comme Mathémagique : toute la logique est compilée dans `ZOOMBINI.EXE`
(NE 16 bits, Borland C++ 1994) ; les données sont des archives Mohawk (`*.MHK`) de même version (0x100).

Ce document sert de brief commun aux sous-agents. Les références font foi sur ce plan :
`files.md` (inventaire), `re-index.md` (corpus Ghidra, régénéré par `scripts/zoombinis/re/run.sh`) et les documents
produits par les vagues ci-dessous.

## Avancement

- Phase 1 terminée (non commitée) :
  - extraction (`scripts/zoombinis-extract.sh`), inventaire (`files.md`), corpus Ghidra de `ZOOMBINI.EXE` et `BROEMIDI`
    (outillage NE / Mohawk de Mathémagique mis en commun dans `scripts/re/`) ;
  - vague A faite : lecteurs Mohawk communs dans `src/data/mohawk/` (Mathémagique migré, `decodeMacRoman`, planches `tBMP`),
    lecteurs propres au jeu dans `src/games/zoombinis/data/` (scripts `SCRB` / `SCRS`, `NODE`, `PATH`, `REGS`, `CURS`, `SYSX`),
    `formats.md`, `test/zoombinis/data.test.ts` (toutes les ressources des 22 archives), visionneuse `ui/asset-viewer.html` ;
  - vague R faite : moteur (`engine.md`), parcours et sauvegardes (`screens.md`), les 12 épreuves (`puzzles/*.md`).
- Vague F faite (non commitée) : moteur Mohawk commun (`src/engine/mohawk/`, `src/ui/mohawk/`, Mathémagique migré),
  cœur et son de Zoombinis (`engine-ts.md`), page de dev `ui/dev.html` avec un écran de démonstration provisoire.
- Vague G faite (non commitée) : parcours complet hors épreuves jouable sur la page de dev (logo, choix, carte, transitions, camps,
  Zoombiniville, menu et dialogues, raccourcis, sauvegardes), épreuves provisoires 7 à 18 (touches `R`, `1`…`9`, `E`), présentation
  du site prête (`index.ts`, `copy.ts` à valider, jaquette) mais absente du registre jusqu'à la fin de H ; saisie de texte commune
  (`src/ui/mohawk/text-input.ts`). Détail par écran : `engine-ts.md`, `screens.md`.
- Vague H : les 12 épreuves sont portées et enregistrées (kit commun `scenes/puzzle-kit.ts`, règles `game/puzzles/`, écrans `scenes/puzzles/`), et le test de partie complète `test/zoombinis/full-game.test.ts` passe par les deux chemins, avec pertes et rechargement ; copy du site validée (`copy.ts`) et jeu inscrit au registre (`src/games/registry.ts`), donc présent sur l’accueil.
- Dernier lot (portage des manques et retours de l'utilisatrice, tout commité) :
  - **portages** : Zoombiniville (habitants sans animation d'attente, mode petit `DS:239a` ; glissement d'un habitant), crédits (Zoombinis du cadre fixes, comme
    l'original), tri devant / derrière du décor des camps (`11a8:231b`), danse d'arrivée des véhibules, fondu d'entrée et de sortie de XFER, écrans cachés 19 / 20
    (tir aux Zoombinis, astéroïdes) avec leurs codes secrets et meilleurs scores, mode de test `[a43f]` (global, carte `+` / `-` / `T` puis `a` à `p`, choix) ;
  - **bit `0x1000000` des features** : vrai sens porté au moteur (`FeatureFlag.playOnly` : dessiné seulement pendant qu'il joue, `11a0:0126`), images fixes du port
    sur `FeatureFlag.still` ; corrige notamment les étagères de l'hôtel et les mouettes de la falaise ;
  - **retours de l'utilisatrice** (bugs 1 à 19) : son unique et priorités, falaise de XFER, sorties des tunnels et de la pizza, livraison de la pizza, muraille,
    gorges, bac au doigt, nizibooms (cousins dans la file), hôtel (taille des Zoombinis, repli de fin), lecture tolérante des parties enregistrées ;
  - **vague J** (tactile et robot) : dépôt au relâchement au doigt (`Host.pointerIsTouch`), bouton « Menu » tactile, robot de partie partagé et lancé sur plusieurs graines
    (`full-game-robot.ts`, `full-game-seeds.test.ts`, `touch.test.ts`).

## Parcours

Ordre de la liste `STRL` 2000 de `TEXTSTR.MHK`, qui suit le parcours ; écrans de la table `1530:14fe` (`engine.md`).

| Étape | Écran | Archive | Lieu | Étude |
|---|---:|---|---|---|
| 1 | 7 | `BRIDGE` | les gorges allergiques | `puzzles/bridge.md` |
| 1 | 8 | `TUNNELS` | les grottes de passe-clos | `puzzles/tunnels.md` |
| 1 | 9 | `PIZZA` | la hutte à pizza | `puzzles/pizza.md` |
| camp 1 | 4 | `BASECAMP` | l'abri du rocher | `screens.md` |
| 2 (chemin A) | 10 | `FERRY` | le bac du père mathieu | `puzzles/ferry.md` |
| 2 (chemin A) | 11 | `LILLY` | les têtards tatoués | `puzzles/lilly.md` |
| 2 (chemin A) | 12 | `SLIDES` | la fosse de monte-pierre | `puzzles/slides.md` |
| 2 (chemin B) | 13 | `FLEENS` | les nizibooms | `puzzles/fleens.md` |
| 2 (chemin B) | 14 | `HOTEL` | l'hôtel du temps-compté | `puzzles/hotel.md` |
| 2 (chemin B) | 15 | `NET` | la muraille de signes | `puzzles/net.md` |
| camp 2 | 5 | `BCTWO` | l'aire de grozarbre | `screens.md` |
| 3 | 16 | `CAVES` | la tanière du sphinx | `puzzles/caves.md` |
| 3 | 17 | `SMOKE` | le piège de cristal | `puzzles/smoke.md` |
| 3 | 18 | `MAZE2` | le gouffre des véhibules | `puzzles/maze2.md` |
| fin | 6 | `TOWN` | zoombiniville | `screens.md` |

Autres écrans : 2 `XFER` (transitions), 3 `PICKER` (choix des Zoombinis), `MAP` (carte) ; 19 à 22 : voir `screens.md`.

## Points à revoir des études

- `lilly.md`, `slides.md`, `smoke.md` et `maze2.md` ont été écrits par des sous-agents de second rang et n'ont pas été relus ligne à ligne.
- Noms des 4 attributs et de leurs valeurs (cheveux, yeux, nez, pieds : hypothèse) : le manuel PDF est un scan sans texte.
- Points ouverts communs : traduction des parties `SCRS` en indices de planche (rappel `+0x14`), animations et chemins de marche
  (`1168:5482`), touche `0x16f`, sons et événements non attribués ; voir la section « Points ouverts » de chaque document.

## Ce qui est connu

- **Archives** (`files.md`) : `ZOOMBINI.MHK` (commun : 555 sons, 5 curseurs, `SCRB`, `SCRS`, `REGS`), `TEXTSTR.MHK`
  (40 `STRL` : erreurs, noms des épreuves, menus, crédits, options), `MIDIMPC.MHK` (musiques), `MIDIMAP.DAT` (2 `SYSX`),
  et une archive par écran : `PICKER` (choix des Zoombinis), `TOWN` (Zoombiniville), `MAP`, `XFER` (transitions),
  `BASECAMP` / `BCTWO` (camps), et les épreuves `BRIDGE`, `CAVES`, `PIZZA`, `FERRY`, `LILLY`, `FLEENS`, `HOTEL`, `MAZE2`,
  `NET`, `SLIDES`, `SMOKE`, `TUNNELS` (correspondance avec les 12 épreuves à établir en R2).
- **Types nouveaux par rapport à Mathémagique** :
  - `SCRB` / `SCRS` : scripts (animations ? séquences de sprites) ; premiers mots plausibles : nombre d'entrées, opcodes `ff00`… ;
  - `NODE` : liste de points (u16 nombre puis paires x, y), `PATH` : suite d'indices de nœuds (le chemin des Zoombinis ?) ;
  - `REGS` : listes de régions (zones cliquables ?) ;
  - `CURS` : curseurs 16×16 monochromes (masques AND / XOR de 32 octets + point chaud).
- **Exécutable** : modules importés `GDI`, `KERNEL`, `MMSYSTEM`, `USER` seulement : WinG et QuickTime sont chargés
  dynamiquement. Vidéos QuickTime `LOGO*.MOV` (logos de démarrage ?) laissées dans `archives/` en attendant de savoir si le jeu les lit.
- **Sauvegardes** : `ZOOMBINI.WHO` (fichier des joueurs, cité par `TEXTSTR` 1030) et `ZOOMBINI.CFG` (configuration),
  dont des exemples sont dans `archives/zoombinis/setup/app/C/ZOOMBINI/`.

## Décisions

- **Code Mohawk commun** : les lecteurs partagés avec Mathémagique sont dans `src/data/mohawk/`.
- **Langue** : version française seulement (`FRENCH/`). L'anglais et l'allemand restent dans `archives/zoombinis/cd/`.
- **Moteur propre au jeu**, sur le modèle de Mathémagique (`docs/mathemagique/engine-ts.md`) : `Host` seule frontière
  avec le navigateur, tick fixe, scènes = machines à états, aucune attente bloquante dans `tick`, `TestHost` pour les tests.
- **MIDI** : comme Mathémagique, `spessasynth_lib` et une soundfont General MIDI réduite aux instruments des 18 MIDI.
- **Défauts de l'original** : reproduits par défaut ; chaque correction est décidée au cas par cas et documentée.
- **Moteur commun avec Mathémagique** (vague F, détail plus bas) : le cadre du moteur et les couches basses passent dans
  `src/engine/mohawk/` (pur) et `src/ui/mohawk/` (navigateur) ; la logique propre à chaque jeu reste dans le jeu.

## Vague F : moteur commun et cœur du moteur

### Ce qu'on partage, et pourquoi

Les études R montrent un même moteur Mohawk : écrans à handlers Enter / Exit / Tick / Key, tick de 17 ms, `SHPL` avec le même
éclaircissement, `\0SND` WAVE 8 bits 11 025 Hz, `tMID` + `MIDIMAP.DAT`, générateur `(s >>> 16) % (n + 1)` identique. Le moteur de
Mathémagique ne dépend du jeu que par quelques constantes (`SceneId`, 576 × 432, roster, Ctrl+Q). Recopier ce code ferait un 4e moteur
dupliqué (Téléportaschtroumpf, Lost in Time et Mathémagique en ont déjà chacun un) ; on le rend générique et Mathémagique l'utilise.

| Module de Mathémagique | Décision | Destination |
|---|---|---|
| `engine/engine.ts`, `scene.ts` (`Services`, `SceneManager`, `Scene`) | commun, générique sur l'identifiant d'écran et le contexte | `src/engine/mohawk/engine.ts`, `scene.ts` |
| `engine/clock.ts` (`Clock` 17 ms, `Deadline`, `Timer`), `input.ts`, `host.ts` | commun (la zone de jeu ne figure que dans les commentaires) | `src/engine/mohawk/` |
| `engine/rng.ts` (`MsvcRandom`, `NoRepeatPool`) | commun : même congruence, même sortie | `src/engine/mohawk/rng.ts` |
| `engine/resources.ts` | commun : cache par archive et `Archive.memo(tag, id, décodeur)` ; décodeurs communs (`SHPL`, `STRL` avec encodage, `\0SND`, `tMID`, `SHAP`, `tBMP`) ; le jeu ajoute les siens (`SCR` ; `SCRB`, `SCRS`, `NODE`, `PATH`, `REGS`) | `src/engine/mohawk/resources.ts` |
| `graphics/frame.ts`, `surface.ts`, `palette.ts`, `blit.ts`, `data/palette.ts` | commun : taille de surface et cadre en paramètres (576 × 432 dans 640 × 480 pour Mathémagique, 640 × 480 sans bordure pour Zoombinis) ; `tBMP` décode vers le même `Shape` que `SHAP` | `src/engine/mohawk/graphics/` |
| `audio/sink.ts`, `smf.ts`, `sequencer.ts`, `programs.ts`, `pcm.ts` | commun (WAVE, séquenceur MIDI, `SYSX`, inventaire des timbres) | `src/engine/mohawk/audio/` |
| `audio/web-sink.ts`, `render/canvas-presenter.ts`, `ui/browser-host.ts` | commun : taille du canvas, origine de la zone de jeu, curseurs et URL de la soundfont en paramètres | `src/ui/mohawk/` |
| `scripts/mathemagique/soundfont.mts` | logique commune, une soundfont réduite **par jeu** (chaque jeu sert ses fichiers depuis son dossier `original/`) | `scripts/lib/soundfont.mts` + deux scripts minces |
| `engine/sound.ts` | **propre au jeu** : Mathémagique a des canaux voix / effet et la préférence « Ambient Sounds » ; Zoombinis a deux files de 32 places, des drapeaux musique / effets et un routage par plage d'id (`engine.md` §6.2) | reste ; Zoombinis écrit le sien |
| `scr-player.ts`, `gadgets.ts`, `pointer.ts`, `roster.ts`, `graphics/fon.ts`, `text.ts`, `transitions.ts`, `audio/rhythm-rewrite.ts` | **propres à Mathémagique** : Zoombinis a les features `SCRB` / `SCRS`, les régions `REGS`, `.WHO`, et ses transitions sont un écran (`XFER`) | restent |

Hors périmètre : migrer Téléportaschtroumpf et Lost in Time sur ce moteur (d'autres y travaillent en parallèle) ; à proposer ensuite.

### Sous-tâches

| Lot | Tâche | Contenu | Fichiers modifiés | Fait quand | Modèle |
|---|---|---|---|---|---|
| F1 | F1 audio commun | `git mv` de `sink`, `smf`, `sequencer`, `programs`, `pcm` vers `src/engine/mohawk/audio/` et de `web-sink` vers `src/ui/mohawk/` ; imports mis à jour ; `scripts/lib/soundfont.mts` (`reduireSoundfont(midis, sortie, nom)`) et `scripts/mathemagique/soundfont.mts` réécrit dessus, sortie identique | ces fichiers, leurs importateurs dans `src/games/mathemagique/`, `test/mathemagique/`, `scripts/mathemagique/` | typecheck, tests, build verts ; la soundfont de Mathémagique régénérée a les mêmes presets | sonnet |
| F2 | F2 cœur commun | `git mv` de `engine`, `scene`, `clock`, `input`, `host`, `rng`, `resources`, `graphics/{frame,surface,palette,blit}`, `data/palette`, `render/canvas-presenter`, `ui/browser-host` vers `src/engine/mohawk/` et `src/ui/mohawk/`, puis généralisation : `Engine<Id, Ext>` (le jeu fournit `extend(base)` pour ses champs, ex. `roster`, l'écran de départ et `quitOnCtrlQ`, vrai par défaut) ; `Frame { width, height, pixels, palette }` ; `CursorKind` paramétré ; `BrowserHost` reçoit `{ canvas, playOrigin, cursors, soundfontUrl }` ; `Archive.memo` ; `parseStrl` avec encodage. Mathémagique : `SceneId`, `MathContext`, `createMathEngine()` dans `engine/` du jeu, comportement inchangé ; `docs/mathemagique/engine-ts.md` (carte du code) mis à jour | `src/engine/mohawk/**`, `src/ui/mohawk/**`, `src/games/mathemagique/**`, `test/mathemagique/**`, `docs/mathemagique/engine-ts.md` | les 30 fichiers de `test/mathemagique/` passent sans modifier une seule assertion ; typecheck, build ; vérification du jeu dans le navigateur (titre, hub, une épreuve, musique) | sonnet |
| F3 | F3 cœur Zoombinis | `src/games/zoombinis/engine/` : `scene.ts` (les 23 écrans de `1530:14fe`, noms de `engine.md` §2.1), `context.ts` (contexte : ressources, `Archive` avec les décodeurs du jeu, préférences musique / effets / transitions / souris aimantée), `engine.ts` (`createZoombinisEngine(host)`, départ à l'écran 0, Ctrl+Q laissé à la vague G), `host.ts` (curseurs `system` et `CURS` 1 à 5) ; `test/zoombinis/engine-test-host.ts` et `engine-core.test.ts` (ordre d'un tick, changement d'écran différé, chargement d'archive, hasard à graine fixe identique à `1080:0028`) ; `docs/zoombinis/engine-ts.md` | ces fichiers | tests verts | sonnet |
| F3 | F4 son Zoombinis | `src/games/zoombinis/engine/sound.ts` : `queue(id)` (§6.2 : file effets / voix et file musique de 32 places, routage `< 1000` et `≥ 30000` vers `ZOOMBINI.MHK` / `MIDIMPC.MHK`, `1000…19999` vers l'archive de l'écran, `≥ 20000` vers `ZOOMBINI.MHK`, id 0 = dernière musique), drapeaux musique / effets, boucle des WAVE `0xffff`, `SYSX` de `MIDIMAP.DAT` à l'init MIDI, sur `AudioSink` et `MidiPlayer` communs ; `test/zoombinis/sound.test.ts` (faux puits) | ces fichiers | tests verts ; un test sur les vrais fichiers joue `tMID` 30000 et un `\0SND` de chaque plage | sonnet |
| F4 | F5 navigateur Zoombinis | `src/games/zoombinis/ui/{app.ts,dev.html,dev.ts,style.css}` sur `src/ui/mohawk/browser-host.ts` et `game-shell` ; écran de démonstration provisoire (`BASECAMP` : fond 1000, palette, musique 30000, curseurs) remplacé en vague G ; `scripts/zoombinis/soundfont.mts` → `original/zoombinis/zoombinis-gm.sf2` + licence ; `scripts/zoombinis-extract.sh` conserve ces deux fichiers (`ec_conserver`) | ces fichiers | build vert ; page de dev vérifiée dans le navigateur (rendu, son, curseur, console) | sonnet |

Ordre : F1 → F2 (ils touchent les mêmes importateurs) → F3 et F4 en parallèle → F5. Le site ne présente pas encore Zoombinis
(registre, jaquette, `index.ts` : vague G) ; la page de dev n'affiche aucun texte nouveau.

### Risques et validation

- **Régression de Mathémagique** (jeu en ligne) : F1 et F2 ne changent aucun comportement ; filet = les tests de `test/mathemagique/`
  inchangés, plus une partie dans le navigateur après F2 (musique, curseurs, fondus, sauvegarde du roster).
- **Clé de stockage** : le roster de Mathémagique garde sa clé `localStorage` actuelle (les sauvegardes des joueurs restent lisibles).
- **Soundfont** : `zoombinis-gm.sf2` fait 3,3 Mo (12 presets) : une soundfont par jeu est retenue.
- Fin de vague : `npm run typecheck`, `npx vitest run`, `npm run build`, contrôle navigateur des deux jeux.

## Vague G : services, écrans du parcours, intégration au site

But : une partie complète **hors épreuves** jouable dans le navigateur, avec les vrais comportements :
- logo ;
- choix des Zoombinis ;
- carte ;
- transitions ;
- deux camps ;
- Zoombiniville ;
- menu et dialogues ;
- options et raccourcis ;
- sauvegardes.

Les 12 épreuves (vague H) sont remplacées par un écran provisoire qui permet de réussir ou d'échouer.

### Décisions

- **Features `SCRB` / `SCRS`** : service propre au jeu (`engine/features.ts`), fidèle à `11a0:033a` (`engine.md` §3.5).
  - Liste triée par profondeur, groupes de formes et ancres `REGS`, drapeaux, délais en ticks, rappels avant / après / événement / image, sons des terminateurs.
  - Pas de rectangles sales : l'écran entier est recomposé à chaque présentation (640 × 480, coût négligeable).
  - Aucun lien avec `scr-player.ts` de Mathémagique (formats sans rapport, décidé en F).
- **Zoombinis (snoids)** : la traduction des parties `SCRS` en indices des planches `tBMP` 3000 / 3100 / 3200 (`engine.md` §9.2) est le **chemin critique**.
  - Les Zoombinis apparaissent dans le choix, les transitions, les camps et la ville.
  - Elle est donc étudiée en premier (G1), avant tout écran qui en affiche.
- **Texte** : le jeu écrit avec `DrawText` dans la police TrueType **CornerStone** (`CORNER.TTF`). Pour le français, `1018:04a0` crée deux tailles, 13 et 16 (hauteurs `LOGFONT`).
  - L'hôte charge `CORNER.TTF` (`FontFace`) et rastérise une chaîne en masque 1 bit, sans lissage, comme GDI sur un écran 256 couleurs.
  - Le moteur pose ce masque dans la surface avec un indice de palette.
  - `TestHost` fournit une police factice à chasse fixe : les tests vérifient la mise en page, pas le dessin des glyphes.
- **État de partie** : modèle TypeScript typé (`game/state.ts`) qui reprend les champs du tampon `0xAE05` (`screens.md` §6.3), et non le tampon binaire.
  - Sérialisation JSON versionnée dans `HostStorage`.
  - Une clé pour la liste des parties (rôle du `.WHO` : 50 parties, noms de 18 caractères au plus pris dans `STRL` 1100), une clé par partie, et la partie anonyme `ZBUser`.
  - L'import des fichiers `ZOOMnnnn.txt` de l'original est hors périmètre.
- **Règles du parcours** : fonctions pures, sans rendu, testées à part (`game/route.ts`, `game/team.ts`).
  - `1108:0000` : progression, insertion de `XFER`, point de reprise.
  - `1168:36e1` : réussites, Zoombinis perdus rendus au dernier arrêt, monuments, montée de niveau.
  - Règles du choix : deux exemplaires au plus, tirage « au hasard ».
  - Réserves des camps, population de la ville.
- **Logo** : `LOGO025.MOV` du dossier français (codec `cdtoons`, 640 × 480, 139 s, son PCM 8 bits) est converti par `scripts/zoombinis-extract.sh` (ffmpeg) en `LOGO025.mp4` (H.264 + AAC) dans `original/zoombinis/`.
  - L'hôte le joue dans une vidéo posée sur le canvas.
  - Un clic ou une touche l'arrête, comme `1180:0000`.
  - Le film n'est joué qu'au premier lancement de la page, comme `[9e0c]` ; ensuite l'écran 0 passe directement à la reprise (`1160:0521`).
  - Taille cible : moins de 10 Mo. Sinon, on baisse le débit vidéo.
- **Raccourcis** (`engine.md` §7.2) : touches d'origine conservées.
  - Sous Windows et Linux, le navigateur garde `Ctrl+N`, `Ctrl+T` et `Ctrl+W`. Le menu du jeu offre les mêmes actions, et la page de présentation le dit.
  - `Ctrl+V` et `Ctrl+Y` suivent le code (`Ctrl+V` = musique, `Ctrl+Y` = voix et effets), messages compris ; seule l'indication de touche des libellés du menu est inversée dans l'original, et elle est reproduite (`screens.md` §5.2).
- **Souris aimantée** : le navigateur ne peut pas déplacer le pointeur. L'option et ses messages existent, sans effet ; l'écart est documenté.
- **Préférences** : les options font partie de la partie (`S+0x04…0x0A`, `S+0x20`), comme dans l'original. Le bouton « Son » du site reste une coupure globale à part.
- **Écrans 19 à 22** :
  - 19 à 21 sont des écrans de développement, atteints par un code secret, avec un mode de test : non portés.
  - 22 (doublon du logo, changement de langue) : sans objet.

### Sous-tâches

Les écrans s'enregistrent dans `src/games/zoombinis/scenes/index.ts`. Ce fichier, `ui/app.ts` et `engine/services.ts` sont modifiés par moi entre deux lots (une ligne par écran), jamais par deux agents à la fois.

| Lot | Tâche | Contenu | Fichiers | Fait quand | Modèle |
|---|---|---|---|---|---|
| G-a | G1 Zoombinis à l'écran | Rétro-ingénierie du rappel `+0x14` des snoids (`1168:0ba8`, `1168:4741`, `1168:4dc9`, `1168:3f76`, `1168:0755`, `1168:09f7`) : variante → indice de planche, rôle du mot de pose, ancres `REGS` 100 à 103 / 3200 / 3201, octets d'état de la fiche, voix. Marche sur `NODE` / `PATH` (`1168:2b30` : 5 secteurs, pas). Point ouvert des images de 24 parties. Résultat dans `engine.md` (§3.6, §4.2, §9) ; `data/zoombini.ts` (attributs → parties) ; tests sur tous les `SCRS` de `ZOOMBINI.MHK` | `docs/zoombinis/engine.md`, `src/games/zoombinis/data/zoombini.ts`, `test/zoombinis/zoombini.test.ts` | chaque `SCRS` commun se compose en indices de planche valides pour les 625 Zoombinis ; une planche de contrôle (PNG dans le scratchpad) montre 5 Zoombinis cohérents | sonnet (opus seulement avec ton accord, si deux essais échouent) |
| G-a | G2 lecteur de features | `engine/features.ts` : service `FEATURES` (création `11a8:0ad6`, plages `11a8:14ab` / `15a6`, groupes `11a0:0000`, interpréteur `11a0:033a`, changement de script `11a8:1be6`, accès aléatoire `11a8:216f`, tous les drapeaux connus), dessin dans la surface après le fond ; crochet pour les snoids (branché par G7 sur le résultat de G1) ; la scène de démonstration rejoue les 32 `SCRB` de `BASECAMP` | `src/games/zoombinis/engine/features.ts`, `scenes/demo.ts`, `test/zoombinis/features.test.ts` | composition des `SCRB` 1100–1115 de `BASECAMP` identique à la vérification de `engine.md` §3.2 ; boucle, arrêt à la fin, aléatoire à graine fixe, événements, sons mis en file | sonnet |
| G-a | G3 texte | `src/ui/mohawk/` : rastérisation 1 bit d'une chaîne TrueType (`FontFace` + canvas, seuil) derrière `MohawkHost.text` ; `engine/text.ts` : `DrawText` (`11e8:5d70` : drapeaux de centrage, retour à la ligne, couleur) dans la surface ; `STRL` de `TEXTSTR.MHK` (`1178:0103`) chargées une fois ; police factice dans `TestHost` | `src/ui/mohawk/font-raster.ts`, `src/engine/mohawk/host.ts` (champ optionnel), `src/games/zoombinis/engine/text.ts`, `ui/browser-host.ts`, `test/zoombinis/text.test.ts` | un nom de lieu de `STRL` 2000 s'affiche en CornerStone 16 sur la page de dev ; Mathémagique inchangé | sonnet |
| G-a | G4 état et règles | `game/state.ts` (partie, fiche de 19 octets, réserves, compteurs, monuments, options, mémoire de dialogue), `game/route.ts` (`1108:0000`, `1160:0521`, `1168:36e1`, `1168:515d`, `1108:02f9`, activation des lieux `1110:1c75`), `game/team.ts` (`1128:13a4`, `1128:143a`, `1168:0755`, réserves des camps `10b0:1ac9`), `game/saves.ts` (liste et parties sur `HostStorage`, erreurs de `STRL` 1020–1030) | ces fichiers, `test/zoombinis/{route,team,saves}.test.ts` | parcours complet simulé (choix → 12 épreuves → ville) avec pertes, deux chemins, montée de niveau, monuments, sauvegarde et reprise | sonnet |
| G-b | G5 dialogues et raccourcis | `scenes/dialog.ts` : boîte de `11a0:1737` (modes 1 à 6 : menu, charger, enregistrer avec saisie, oui / non, crédits `STRL` 2020 / 2021) en surimpression de l'écran courant ; rétro-ingénierie de son décor (`11a0:21c4`, ressource 20) ; raccourcis de `1198:05b3` et messages `STRL` 2023 ; `/` `?` ; `Ctrl+I` (à propos, `STRL` 1040) ; avertissement de retour à la carte ; confirmation de quitter | `scenes/dialog.ts`, `engine/shortcuts.ts`, `test/zoombinis/dialog.test.ts` | chaque mode s'ouvre, se ferme et agit sur l'état (G4) ; saisie limitée au jeu de `STRL` 1100 | sonnet |
| G-b | G6 logo et carte | `scenes/logo.ts` (vidéo via l'hôte, arrêt au clic, reprise `1160:0521`) ; `scenes/map.ts` (écran 1 : 16 lieux `1530:1634`, survol avec nom, légende `1110:0f5c` selon l'avancement, icônes par niveau `1110:1601`, clic en aventure / entraînement, `Maj` et touches 1 à 4, menu `DS:3fde`) ; conversion vidéo dans `scripts/zoombinis-extract.sh` | ces fichiers, `test/zoombinis/{logo,map}.test.ts` | partie neuve : logo → choix ; la carte affiche les lieux selon un état donné et envoie aux bons écrans | sonnet |
| G-b | G7 choix des Zoombinis | `scenes/picker.ts` (écran 3, `1128:*` : 20 boutons d'attributs, 6 actions, groupe de 16, retrait, au hasard, guide, mascottes, phrase d'accueil, départ par `NODE` / `PATH`) | ces fichiers, `test/zoombinis/picker.test.ts` | composer 16 Zoombinis, partir vers l'écran 7 avec la transition 1 | sonnet |
| G-b | G8 transitions | `scenes/xfer.ts` (écran 2, `11b0:*` : 16 trajets, 6 jeux de décors, marche du groupe, phrase du narrateur `S+0x28`, son d'ambiance, fin vers `[8558]`, `Ctrl+T`) | ces fichiers, `test/zoombinis/xfer.test.ts` | les 16 trajets se jouent jusqu'au bout et arrivent au bon écran | sonnet |
| G-c | G9 camps | `scenes/camp.ts` (écrans 4 et 5, code jumeau `10b0:*` / `10b8:*` : arrivée, présentoir de 5 avec flèches, glisser-déposer, 5 objets de décor, sorties, phrases d'aide) | ces fichiers, `test/zoombinis/camp.test.ts` | déposer, reprendre, compléter un groupe et partir sur chaque sortie | sonnet |
| G-c | G10 Zoombiniville | `scenes/town.ts` (écran 6, `1188:*` : population, habitants qui marchent, défilement sur 1 600 points, monuments et survol 5 lignes, objets aléatoires, fin du jeu) | ces fichiers, `test/zoombinis/town.test.ts` | ville vide, avec monuments, et fin de partie à 625 | sonnet |
| G-c | G11 épreuve provisoire | `scenes/puzzle-stub.ts` pour les écrans 7 à 18 : fond `tBMP` 1000 de l'archive, groupe affiché, touches de dev (réussir sans perte, réussir en perdant N Zoombinis, échouer) qui appellent les règles de G4 ; remplacé épreuve par épreuve en vague H | ces fichiers, `test/zoombinis/puzzle-stub.test.ts` | parcours complet jouable dans le navigateur avec la page de dev | sonnet |
| G-d | G12 site | `src/games/zoombinis/{index.ts,copy.ts}` (écran de présentation sur le modèle de Mathémagique, contrôles et raccourcis), copy du shell (chargement, erreurs), `scripts/zoombinis/cover.mts` (jaquette : fond de l'île du choix, `PICKER` `tBMP` 1000 avec sa palette), ligne dans `src/games/registry.ts` selon la décision « Accueil du site » | ces fichiers | le jeu se lance depuis son écran de présentation ; build vert | sonnet |

Ordre :
1. G-a : G1, G2, G3 et G4 en parallèle (fichiers distincts).
2. G-b : G5, G6, G7 et G8.
3. G-c : G9, G10 et G11.
4. G-d : G12.

G1 doit être fini avant G7 à G10.

### Risques et validation

- **Snoids non élucidés** (G1) : sans eux, pas de Zoombinis à l'écran. Si G1 n'aboutit pas, G7 à G10 attendent : on ne fabrique pas de rendu approximatif.
- **Fidélité du texte** : la rastérisation par le navigateur peut décaler les glyphes d'un pixel par rapport à GDI. Faute d'image de référence de l'original, c'est accepté.
- **Fichiers partagés** : `src/engine/mohawk/host.ts` (G3) et `src/games/registry.ts` (G12) sont communs à d'autres jeux, que d'autres sessions modifient. Les changements y restent additifs ; Mathémagique est revérifié après G3.
- **Poids** : la vidéo et les 60 Mo d'archives sont chargés à la demande, écran par écran, comme aujourd'hui.
- **Validation de chaque lot** : `npm run typecheck`, `npx vitest run`, `npm run build`, puis la page de dev dans le navigateur (rendu, son, curseurs, console). En fin de vague : une partie de bout en bout (logo → choix → transitions → camps → ville, sauvegarde et reprise) et une vérification mobile de la page de présentation.

### Copy à valider (vague G)

- **Dans le jeu** : aucun texte n'est écrit par nous. Ils viennent tous de `TEXTSTR.MHK`.
- **Site** (G12), avec un texte exact proposé avant livraison :
  - titre et description de la carte d'accueil ;
  - texte alternatif de la jaquette ;
  - « Jouer » ;
  - contrôles et raccourcis ;
  - chargement et erreurs.
- **Validée** : toute la copy du site (`copy.ts`), libellé du canvas et « Son » compris.

## Vague H : les 12 épreuves

But : remplacer les 12 épreuves provisoires par les vraies, fidèles aux études `puzzles/*.md` :
- règle tirée ;
- 4 niveaux ;
- glisser-déposer des Zoombinis ;
- réactions animées, voix et musique ;
- Zoombinis sauvés ou perdus ;
- boutons « go » et carte.

À la fin, Zoombinis entre sur l'accueil du site.

### Décisions

- **Découpage de chaque épreuve** : deux couches, comme le parcours en G.
  - **Règles** : `game/puzzles/<nom>.ts`, fonctions pures sans rendu : tirage de la règle, acceptation d'une pose, compteurs, fin.
    - Elles prennent `MsvcRandom` (`ctx.rng`) et suivent l'ordre des tirages de l'original quand l'étude l'établit.
    - Quand l'étude ne donne qu'une lecture « probable », elles produisent un plateau valide avec les mêmes propriétés (règle de `slides.md` §7 point 2). Chaque écart est noté.
  - **Écran** : `scenes/puzzles/<nom>.ts` : décor, features, Zoombinis, entrées, sons.
  - **Tests** : `test/zoombinis/puzzles/<nom>.test.ts`.
    - Les règles sont testées sur les 4 niveaux avec des graines fixes.
    - Un **robot** résout chaque niveau à partir de la règle connue ; il sert aussi au futur robot de partie (vague J).
    - L'écran est testé sur les vrais fichiers : entrée, une pose acceptée, une refusée, réussite et échec jusqu'à l'écran suivant.
- **Kit commun des épreuves** (H0), écrit avant toute épreuve : le segment `1168` et les appels `11a8` / `11a0` que les 12 écrans partagent. Aucune épreuve ne réécrit ces mécanismes chez elle.
  - **Arrivée du groupe** :
    - placement d'attente (`1168:2505`, `11a8:0ed9`) ;
    - ordre des départs (`1168:274e`) ;
    - départs échelonnés (`1168:2982`, 45 ticks) ;
    - compteurs `DS:9702` / `9704`.
  - **Glisser-déposer d'un Zoombini** (`1168:58c7`) :
    - clic-clic et glisser ;
    - curseur masqué pendant le transport (`hideCursorWhileCarrying`) ;
    - auto-aimantation ;
    - cible de dépôt (`1520:0000`) et retour à la place d'origine.
  - **Animations d'attente** (états 0 et 6 de `+0xf4`, scripts 130 à 145), absentes depuis G : elles se voient surtout dans les épreuves, où les Zoombinis attendent longtemps.
  - **Sortie** :
    - drapeau « sauvé » `+0x127` ;
    - bouton « go » actif selon l'épreuve, et bouton carte (`confirmLeaveToMap`) ;
    - sons 996 / 997 / 999 ;
    - voix de réussite et de regret communes (20045 à 20063) ;
    - appel de `exitPuzzle` puis `goTo`, comme l'épreuve provisoire.
  - **Enregistrement pendant l'épreuve** (`11a0:141e`) : `DIALOG.addBeforeSave` range le groupe dans la réserve de l'étape. C'est la dette de l'épreuve provisoire.
  - **Aide vocale et « moins d'action »** :
    - voix d'introduction `[a2c4]`, rejouée par la touche `0x16f` (`11a0:155e`), dont l'identité est à établir en H0 ;
    - attente de 120 ticks au lieu de 60 (`DS:908a`) avec « moins d'action ».
  - **Musique d'épreuve** : `tMID` de `MIDIMPC.MHK` lancée à l'entrée.
    - `CAVES` joue `30025 + niveau`, `SMOKE` joue `30030 + niveau` ; H0 relève les ids des 10 autres.
    - L'épreuve provisoire n'en jouait aucune, à tort.
- **Ordre des épreuves** : celui du parcours, pour qu'une partie devienne jouable de plus en plus loin. Les études relues de près et les règles simples passent d'abord.
  - Les 4 études écrites par des sous-agents de second rang (`lilly`, `slides`, `smoke`, `maze2`) et `fleens`, qui a des points ouverts majeurs, ont d'abord une tâche **règles** à part.
  - Cette tâche relit l'étude sur le corpus (`re-index.md`), tranche les points qui changent le comportement, et ne porte que les règles et le robot.
  - L'écran vient dans un lot suivant.
- **Défauts de l'original** :
  - ceux qui ne changent que le tirage (balayage de `bridge.md` §2.2, tirage `S14:0700` de `maze2.md` §8) sont reproduits ;
  - ceux qui faussent le résultat d'une partie sont à trancher (voir « Décisions à prendre ») ;
  - tout écart est noté dans l'étude et dans `engine-ts.md`.
- **Hors périmètre** :
  - restes de développement (`SCRB` et `REGS` non référencés) ; les touches de mise au point des épreuves en mode de test sont portées depuis (dernier lot, sauf
    l'incrustation `10c8:2d1c` des grottes et la ville `1188:1380`) ;
  - souris aimantée (sans effet, comme en G) ;
  - tactile complet : fait en vague J.

### Sous-tâches

Les épreuves s'enregistrent dans `scenes/index.ts`, l'une après l'autre à la place de l'épreuve provisoire. C'est moi qui modifie ce fichier, `engine/services.ts` et `src/games/registry.ts`, entre deux lots. `game/route.ts` et `snoid.ts` ne changent que dans H0. Après H0, une épreuve qui a besoin d'y toucher s'arrête et le signale.

| Lot | Tâche | Contenu | Fichiers | Fait quand | Modèle |
|---|---|---|---|---|---|
| H-a | H0 kit des épreuves | Mécanismes communs ci-dessus (arrivée, glisser-déposer, attente, sortie, enregistrement, aide vocale, « moins d'action »), relevé des musiques des 12 épreuves ; l'épreuve provisoire passe sur le kit (arrivée, glisser entre deux places, bouton carte) ; `engine.md` §3.6 / §4.2 et `engine-ts.md` complétés | `scenes/puzzle-kit.ts`, `scenes/snoid.ts` (attente), `scenes/puzzle-stub.ts`, `game/route.ts` si la sortie l'exige, `test/zoombinis/puzzle-kit.test.ts`, docs | l'épreuve provisoire montre l'arrivée échelonnée, l'attente animée, le glisser-déposer et la sortie par « go » / carte ; une partie enregistrée pendant l'épreuve retrouve son groupe | sonnet |
| H-a | H5r têtards (règles) | Relecture de `lilly.md` sur le corpus (points 1, 3, 4 : explorateur, ouverture du niveau 1, grenouilles), génération de l'étang (`10f8:5f02` / `5c1e` / `484e`), chemin d'un crapaud, fée, grenouilles, robot | `game/puzzles/lilly.ts`, test, `puzzles/lilly.md` | étang généré aux 4 niveaux avec ses propriétés (§3) ; le robot sauve tout le groupe quand c'est possible | sonnet |
| H-a | H6r monte-pierre (règles) | Relecture de `slides.md` (points 1, 2, 10), plateaux des 4 niveaux (paires, chaînes, échelle, nid d'abeilles), règle de montée, liaisons reliées, robot | `game/puzzles/slides.ts`, test, `puzzles/slides.md` | plateau toujours résoluble pour tout `n` de 1 à 16 ; le robot relie tout le groupe | sonnet |
| H-a | H7r nizibooms (règles) | Points 1, 3 et 4 de `fleens.md` : qui est « spécial » et comment le joueur le voit (décodage des `SCRS` 7000 à 7045, rendu de contrôle), limite d'essais, file de 7 ; transformation des attributs, robot | `game/puzzles/fleens.ts`, test, `puzzles/fleens.md` | règle complète, sans point ouvert qui change le jeu ; sinon l'agent s'arrête et le signale | sonnet |
| H-a | H8r cristal (règles) | Relecture de `smoke.md` (points 1, 2, 4 : générateur des cristaux simulé sur 100 000 tirages, niveau 4, images de `tBMP` 10000 via `1140:0000`), filtres, cristaux, test `1158:31e8`, robot | `game/puzzles/smoke.ts`, test, `puzzles/smoke.md` | tirage toujours résoluble aux 4 niveaux ; correspondance image ↔ valeur établie | sonnet |
| H-a | H9r véhibules (règles) | Relecture de `maze2.md` (points 1 et 8 : générateurs de traits bit à bit), lecture des 10 cartes `REGS` 16600+, types de case, trajet d'un Zoombini, robot | `game/puzzles/maze2.ts`, test, `puzzles/maze2.md` | les 10 cartes se lisent ; un trajet simulé suit les panneaux ; le robot amène le groupe à la sortie 3 | sonnet |
| H-b | H1 gorges | `bridge` complet (règle à 1 à 3 conditions, 2 ponts, 6 erreurs, éternuement, files) | `game/puzzles/bridge.ts`, `scenes/puzzles/bridge.ts`, test | jouable aux 4 niveaux dans le navigateur, réussite et fermeture des ponts | sonnet |
| H-b | H2 grottes | `tunnels` complet (1 ou 2 règles, 4 entrées, budget 16 à 22, effondrement) | idem `tunnels` | idem | sonnet |
| H-b | H3 pizza | `pizza` complet (ingrédients, 1 à 3 trolls, verdicts, budget 6 / 7, passage du groupe entier ; point 1 : ensemble aimé vide) | idem `pizza` | idem, groupe entier perdu en cas d'échec | sonnet |
| H-b | H4 bac | `ferry` complet (4 radeaux, voisinage, grenouille qui éjecte, répliques du père mathieu) | idem `ferry` | idem, radeau incomplet possible | sonnet |
| H-c | H5 têtards (écran) | Écran de `lilly` sur H5r : crapauds, saut de proche en proche, errance, fée, grenouilles | `scenes/puzzles/lilly.ts`, test | jouable aux 4 niveaux | sonnet |
| H-c | H10 hôtel | `hotel` complet (chambres apprises, 1 à 3 attributs, lumière qui baisse, 7 à 10 erreurs ; point 1 : étiquettes du niveau 2) | idem `hotel` | idem | sonnet |
| H-c | H11 muraille | `net` complet (25 ou 125 dalles, catapulte à 2 ou 3 sélecteurs, groupes cachés, munitions) | idem `net` | idem | sonnet |
| H-c | H12 sphinx | `caves` complet (20 dalles, tri par blocs, lion à 4 à 7 crans, hiéroglyphes) | idem `caves` | idem | sonnet |
| H-d | H6 monte-pierre (écran) | Écran de `slides` sur H6r : pierres qui montent, bouton « go » définitif, cycle de palette | `scenes/puzzles/slides.ts`, test | jouable aux 4 niveaux | sonnet |
| H-d | H7 nizibooms (écran) | Écran de `fleens` sur H7r : cocons, chemin, transformation visible du groupe | `scenes/puzzles/fleens.ts`, test | idem ; le groupe sort transformé | sonnet |
| H-d | H8 cristal (écran) | Écran de `smoke` sur H8r : silhouettes, filtres, cristaux, wagonnets, levier, danse de victoire | `scenes/puzzles/smoke.ts`, test | idem | sonnet |
| H-d | H9 véhibules (écran) | Écran de `maze2` sur H9r : rampes, vol, aiguillages, boutons, cases d'attente, 10 en vol au plus | `scenes/puzzles/maze2.ts`, test | idem, arrivée à Zoombiniville | sonnet |

Ordre :
1. H-a : H0 et les cinq tâches « règles », en parallèle (fichiers distincts ; les règles n'utilisent pas le kit).
2. H-b : H1 à H4. La première étape et le bac sont jouables ; H1 valide le kit sur une vraie épreuve.
3. H-c : H5, H10, H11, H12.
4. H-d : H6, H7, H8, H9.
5. Fin : ligne de Zoombinis dans `src/games/registry.ts` (par moi), partie complète, mise à jour de `plan.md` et `engine-ts.md`.

Un lot ne part que si le précédent est vert. Une tâche « règles » qui laisse un point ouvert changeant le jeu bloque son écran : on ne fabrique pas de comportement à l'aveugle.

### Risques et validation

- **Études non relues** (`lilly`, `slides`, `smoke`, `maze2`) et lectures « probables » : c'est le premier risque.
  - Les tâches « règles » passent avant les écrans pour le réduire.
  - Si une tâche « règles » échoue deux fois, je te demande avant de passer sur Opus.
- **Kit commun** : s'il est incomplet, chaque épreuve risque de le contourner.
  - H1 sert de banc d'essai.
  - Un manque découvert en H-b se corrige dans le kit, par moi ou par une tâche dédiée entre deux lots, et jamais dans une épreuve.
- **Cadence et délais** : des arguments que Ghidra a mal ordonnés rendent certains délais incertains (`lilly.md` point 11).
  - On garde les valeurs lues.
  - On les vérifie à l'œil dans le navigateur, faute d'enregistrement de l'original.
- **Sons et voix** : leur attribution est souvent déduite de leur usage. On les écoute dans le navigateur, sans pouvoir comparer à l'original.
- **Validation de chaque lot** :
  - `npm run typecheck`, `npx vitest run`, `npm run build` ;
  - chaque nouvelle épreuve est jouée dans le navigateur aux 4 niveaux, par l'entraînement de la carte (`Maj` et touches 1 à 4) : réussite, échec, perte partielle, enregistrement pendant l'épreuve ;
  - je contrôle la console et le rendu.
- **Fin de vague** :
  - une partie en aventure de bout en bout par les deux chemins, jusqu'à Zoombiniville ;
  - Mathémagique revérifié ;
  - écran de présentation contrôlé sur mobile ;
  - l'épreuve provisoire et `scenes/demo.ts` supprimés une fois inutiles.

### Copy à valider (vague H)

- **Dans le jeu** : aucun texte écrit par nous. Les épreuves n'affichent pas de texte, et les consignes sont des voix.
- **Site** : la ligne « Contrôles » de `copy.ts` mentionnera le glisser-déposer des Zoombinis. Le texte exact te sera proposé avant livraison, avec le reste de `copy.ts` encore à valider.

## Décisions à prendre

- **Manuel** (en attente) : le PDF français (175 Mo, 86 pages scannées sans couche de texte, `archives/zoombinis/manuel/`). Trois pistes : page `MANUEL.html` comme
  Mathémagique (transcription par lecture des pages, sans OCR, captures du port), PDF allégé (8 à 10 Mo), ou rien.
- **Fondus des autres écrans** (décidé, porté) : mécanisme commun (`engine/screen-fades.ts`) sur tous les écrans sauf le logo ; écran et objets gelés pendant les
  fondus ; coupés par défaut dans les tests, activés par l'application.
- **Bit `0x1000000`, quatre objets** (décidé, porté) : emplacements des camps, entrée de la grotte du choix (4110), dalles des grottes, wagonnet des grottes fumantes ne sont
  dessinés qu'au survol d'une zone de dépôt (`1168:1742`), comme l'original ; extension tactile du bug 18 sur ces zones.
- **Accueil du site** : afficher Zoombinis sur l'accueil seulement après H (décidé). La ligne du registre est ajoutée en fin de vague H.
- **Défaut du bac** (`ferry.md` §7 point 1, décidé) : un Zoombini repris sur un tabouret puis lâché sur le ponton resterait compté comme assis. Il est **corrigé** (il n'est plus compté assis) et l'écart est noté dans `ferry.md` et `engine-ts.md`, après confirmation dans le code par H4.
- **Défaut du cristal** (`smoke.md` §3.5, décidé) : quand le second Zoombini manque, `1158:5017` écrit dans la mauvaise table et rend le puzzle insoluble (2,5 % des tirages au niveau 3, 3,6 % au niveau 4). Il est **corrigé** (`bugMissingB = false` par défaut) et l'écart est noté dans `smoke.md`.

## Vagues

| Vague | Tâche | Contenu | Dépend de |
|---|---|---|---|
| A | A1 Mohawk commun | `src/data/mohawk/`, Mathémagique migré, tests verts (fait) | — |
| A | A2 formats | `tBMP` (toutes les variantes), `SCRB`, `SCRS`, `NODE`, `PATH`, `REGS`, `CURS`, `SYSX`, Mac Roman → `formats.md` et lecteurs `src/games/zoombinis/data/` avec tests sur toutes les ressources | A1 |
| A | A3 visionneuse | `ui/asset-viewer.html` (coquille `src/ui/asset-viewer/`) : images avec palettes, scripts animés, sons, MIDI, chemins et régions superposés | A2 |
| R | R1 moteur | boucle, cadence, table des écrans, chargement des archives, lecteur des scripts `SCRB` / `SCRS`, palette, transitions, curseurs → `engine.md` | corpus |
| R | R2 parcours | carte, choix des Zoombinis (`PICKER`), camps, Zoombiniville, sauvegardes `.WHO` / `.CFG`, options, crédits → `screens.md` | corpus |
| R | R3 à R6 | les 12 épreuves (règles, tirages, difficulté, animations, sons) → `puzzles/*.md`, trois épreuves par tâche | R1 |
| F | F | cœur du moteur, graphismes, son et MIDI (mutualisés avec Mathémagique si décidé) | A, R1 |
| G | G | services (scripts animés, zones, curseurs), écrans du parcours, intégration au site (`index.ts`, registre, jaquette, `dev.html`) | F, R2 |
| H | H | les 12 épreuves | G, R3-R6 |
| J | J | manuel (en attente), tactile et robot de partie (faits), revue | H |

Chaque vague se termine par `npm run typecheck`, `npm test`, `npm run build` et, dès qu'il y a un rendu, une vérification dans le navigateur.
