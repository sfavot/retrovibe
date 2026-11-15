import { describe, expect, it } from "vitest";
import { isRotated } from "../../src/ui/touch-layout";

describe("isRotated", () => {
  it("lit la classe de l'élément ou de l'un de ses ancêtres", () => {
    const hit = { closest: (selector: string) => (selector === ".is-rotated" ? {} : null) };
    const miss = { closest: () => null };
    expect(isRotated(hit as unknown as Element)).toBe(true);
    expect(isRotated(miss as unknown as Element)).toBe(false);
  });
});
