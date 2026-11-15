import "../../../ui/style.css";
import { mountApp } from "./app";

/**
 * Page de développement : monte le jeu seul, hors de l'application (ouverte à `/src/games/voyageurs/ui/dev.html`). `window.__voyageurs`
 * expose `game` (`engine`, `renderer`), `loop`, `host`, `slots` et `step(n)`.
 */
void mountApp(document.getElementById("app")!, { base: `${import.meta.env.BASE_URL}voyageurs`, debug: true });
