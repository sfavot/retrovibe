import "../../../ui/style.css";
import { mountApp } from "./app";

/**
 * Page de développement : monte le jeu seul, hors de l'application (ouverte à `/src/games/croisiere/ui/dev.html`). `window.__croisiere`
 * expose `engine()` (le `CroisiereEngine` courant), `loop`, `host`, `slots` et `step(n)`.
 */
void mountApp(document.getElementById("app")!, { base: `${import.meta.env.BASE_URL}croisiere`, debug: true });
