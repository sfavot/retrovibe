import { copy as shared } from "../../ui/copy";
import type { GameDefinition } from "../types";
import { copy, mountApp } from "./ui/app";

export const teleportaschtroumpf: GameDefinition = {
  id: "teleportaschtroumpf",
  title: copy.title,
  description: copy.description,
  async start(container) {
    await mountApp(container, { base: `${import.meta.env.BASE_URL}teleportaschtroumpf`, backLabel: shared.backToGames });
  },
};
