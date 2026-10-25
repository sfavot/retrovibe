import "../../../ui/style.css";
import { mountApp } from "./app";

/** Page de développement : monte le jeu seul, hors de l'application (ouverte à `/src/games/armaeth/ui/dev.html`). */
void mountApp(document.getElementById("app")!, { base: `${import.meta.env.BASE_URL}armaeth`, debug: true });
