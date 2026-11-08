import { describe, expect, it } from "vitest";
import { syncSkipButton } from "../../src/ui/point-click-touch";

function fakeButton() {
  const writes: string[] = [];
  const attributes = new Map<string, string>();
  return {
    disabled: true,
    writes,
    attributes,
    setAttribute(name: string, value: string) {
      writes.push(`${name}=${value}`);
      attributes.set(name, value);
    },
  };
}

describe("bouton « Passer » de la barre tactile", () => {
  it("est actif (disabled et aria-disabled cohérents) quand on peut passer, grisé sinon", () => {
    const button = fakeButton();
    syncSkipButton(button, true);
    expect(button.disabled).toBe(false);
    expect(button.attributes.get("aria-disabled")).toBe("false");
    syncSkipButton(button, false);
    expect(button.disabled).toBe(true);
    expect(button.attributes.get("aria-disabled")).toBe("true");
  });

  it("n'écrit que lorsque l'état change", () => {
    const button = fakeButton();
    syncSkipButton(button, false);
    expect(button.writes).toEqual([]);
    syncSkipButton(button, true);
    syncSkipButton(button, true);
    expect(button.writes).toEqual(["aria-disabled=false"]);
  });
});
