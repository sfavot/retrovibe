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
- Prochaine étape : vague F planifiée (section « Vague F »), à lancer ; puis G, H.

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
- **Soundfont** : ~18 Mo de plus dans `original/zoombinis/` (versionné) ; une soundfont commune aux deux jeux éviterait ce doublon mais
  sortirait du rangement « un dossier `original/` par jeu ».
- Fin de vague : `npm run typecheck`, `npx vitest run`, `npm run build`, contrôle navigateur des deux jeux.

## Décisions à prendre

- **Manuel** : le PDF français (175 Mo, `archives/zoombinis/manuel/`) sera transcrit en page web, textes à valider.
- **Vidéo du logo** : le jeu joue `Logo025.MOV` au démarrage (`engine.md`) ; à convertir et servir, ou à remplacer par l'écran suivant (rôle des `LOGO027*.MOV` inconnu).

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
| J | J | manuel, tactile, robot de partie, revue | H |

Chaque vague se termine par `npm run typecheck`, `npm test`, `npm run build` et, dès qu'il y a un rendu, une vérification dans le navigateur.
