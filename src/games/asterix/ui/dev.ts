import "../../../ui/style.css";
import { asterix } from "../index";
import { mountApp } from "./app";

/**
 * Page de recette d'Astérix, hors du build du site : `/src/games/asterix/ui/dev.html` (serveur de dev Vite). Le jeu n'est
 * pas encore publié (`src/games/registry.ts`, vague F) ; cette page le lance comme le fera le site, par son écran de
 * présentation (« Jouer », « Continuer »).
 *
 * Paramètres d'URL, pour la recette : `?direct` monte le jeu sans écran de présentation, `&intro=0` passe les logos et
 * l'introduction, `&seed=n` fixe la graine du hasard, `&resume` reprend la partie sauvegardée, `&minigame=22` joue
 * d'abord ce mini-jeu hors partie (`&action=0..2` et `&reflexion=0..2` : niveaux du joueur, 1 par défaut).
 */
const container = document.getElementById("app")!;
const params = new URLSearchParams(location.search);

if (params.has("direct")) {
  const seed = params.get("seed");
  const level = (name: string): number | undefined => (params.has(name) ? Number(params.get(name)) : undefined);
  void mountApp(container, {
    base: `${import.meta.env.BASE_URL}asterix`,
    resume: params.has("resume"),
    skipIntro: params.get("intro") === "0",
    seed: seed === null ? undefined : Number(seed),
    minigame: params.has("minigame") ? { module: Number(params.get("minigame")), action: level("action"), reflexion: level("reflexion") } : undefined,
  });
} else {
  void asterix.start(container);
}
