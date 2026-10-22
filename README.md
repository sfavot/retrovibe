# retrovibe

Le but : vibecoder à l'arrache, dans le navigateur, des jeux des années 90 que j'ai aimés dans mon enfance.

Chaque jeu est une réimplémentation de son moteur en TypeScript, qui lit les fichiers du jeu original.
Ces fichiers sont versionnés dans `original/<jeu>/` et servis tels quels, ce qui permet de tout déployer sur GitHub Pages.

| Jeu | État |
| --- | --- |
| Indiana Jones and his Desktop Adventures | jouable |
| Gabriel Knight, Lost in Time… | à venir |

## Déploiement

Chaque push sur `main` lance [le workflow GitHub Actions](.github/workflows/deploy.yml) (tests, build, publication sur Pages).
Prérequis : dans les réglages du dépôt, Pages > Source = « GitHub Actions ». Les chemins sont relatifs (`base: "./"`)
et le routage se fait par hash, donc le site marche sous n'importe quel sous-dossier.

## Lancer en local

1. `npm install`
2. `npm run dev` puis ouvrir http://localhost:5173

`original/indy/` contient `DESKTOP.DAW`, `DESKADV.EXE` (pour la palette), `DESKADV.HLP` (le manuel d'origine, affiché depuis l'écran titre) et, pour le son, les `.WAV` / `.MID`.

En développement, `?seed=1234` démarre directement une partie avec cette graine et `__indy.game` est exposé dans la console.

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run build` | vérification des types + build de production (`dist/`) |
| `npm run typecheck` | vérification des types |
| `npm test` | tests (ceux qui lisent les données sont ignorés si `original/` est vide) |

Les tests d'Indy sont dans `test/indy/`. Le test de robustesse (`test/indy/fuzz.test.ts`) parcourt les 366 zones ; il est long et ne tourne qu'avec `FUZZ=1 npm test`.
Les variables `FUZZ_FROM` / `FUZZ_TO` permettent de n'en traiter qu'une plage.

`PLAY=1 npm test` lance un robot qui joue des parties générées en suivant la solution du solveur et
affiche jusqu'où il va. Il ne sait pas résoudre les énigmes internes des zones (blocs à tirer, PNJ
à aborder…) : il s'aide alors en se plaçant à côté de la cible, et le rapport liste ces aides.

## Indy Desktop Adventures

Réimplémentation du moteur d'*Indiana Jones and his Desktop Adventures* (LucasArts, 1996). Le code ne contient aucune donnée du jeu : il lit les fichiers de `original/indy/` au démarrage.

### Architecture

- `src/games/indy/data/` — lecture de `DESKTOP.DAW` (tuiles, zones, scripts, puzzles, personnages) et de la palette de l'exécutable.
- `src/games/indy/engine/` — moteur : état des zones, scripts (`script.ts`), monstres, héros, combats, sauvegarde (`game.ts`).
- `src/games/indy/engine/generation/` — génération du monde : disposition de la carte (algorithme d'origine, porté depuis WebFun),
  affectation des zones et de la chaîne de puzzles, et un solveur qui rejette toute partie impossible à terminer.
- `src/games/indy/render/` — composition de la vue 9×9 en image indexée, convertie avec la palette animée.
- `src/games/indy/audio/` — effets WAV d'origine (Web Audio) et petit synthétiseur pour les musiques MIDI.
- `src/games/` — un dossier par jeu (`src/games/<id>/`, point d'entrée `index.ts` exportant une `GameDefinition`),
  référencé dans `registry.ts`. Les routes sont `#/` (accueil) et `#/<id>` (jeu). Indy est dans `src/games/indy/`.
- `src/games/indy/ui/` — interface d'Indy (écran titre, vue de jeu, bulles, inventaire, carte). Ses textes sont dans `copy.ts`.
- `src/ui/` — éléments communs : page d'accueil, helper DOM, styles, textes de l'accueil.

## Ce qui a été reconstitué

- **Opcodes de script** : Indy n'utilise pas la même table que Yoda Stories. La table de `script.ts` a été déduite
  de l'usage de chaque opcode dans les 2 825 actions du fichier de données. Quelques opcodes rares restent sans effet
  (voir les commentaires).
- **Génération du monde** : la disposition suit l'algorithme original ; l'affectation des zones est une reconstitution
  (WebFun ne gère pas les puzzles d'Indy). Comme dans l'original, Marcus remet le premier objet de la chaîne.
- **Valeurs non présentes dans les données** : soins des objets comestibles, objet posé sur les emplacements « bonus »,
  comportements des types de déplacement ennemis.

Référence : [WebFun](https://codeberg.org/cyco/WebFun) (MIT), réimplémentation de *Yoda Stories*.
