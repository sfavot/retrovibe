import { describe, expect, it } from "vitest";
import { isIPhone, isStandalone, shouldSuggestInstall } from "../../src/ui/standalone";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPOD = "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/15.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("isIPhone", () => {
  it("reconnaît iPhone et iPod, pas iPad (présenté comme un Mac), Android ni ordinateur", () => {
    expect(isIPhone(IPHONE)).toBe(true);
    expect(isIPhone(IPOD)).toBe(true);
    expect(isIPhone(IPAD)).toBe(false);
    expect(isIPhone(ANDROID)).toBe(false);
    expect(isIPhone(DESKTOP)).toBe(false);
  });
});

describe("isStandalone", () => {
  it("lit navigator.standalone (iOS) ou le mode d'affichage (Android, ordinateur)", () => {
    expect(isStandalone({ navigatorStandalone: true })).toBe(true);
    expect(isStandalone({ displayModeStandalone: true })).toBe(true);
    expect(isStandalone({ navigatorStandalone: false, displayModeStandalone: false })).toBe(false);
    expect(isStandalone({})).toBe(false);
  });
});

describe("shouldSuggestInstall", () => {
  it("suggère l'écran d'accueil sur iPhone dans Safari", () => {
    expect(shouldSuggestInstall(IPHONE, { navigatorStandalone: false })).toBe(true);
    expect(shouldSuggestInstall(IPHONE, {})).toBe(true);
  });

  it("se tait une fois installé, ou hors iPhone", () => {
    expect(shouldSuggestInstall(IPHONE, { navigatorStandalone: true })).toBe(false);
    expect(shouldSuggestInstall(IPHONE, { displayModeStandalone: true })).toBe(false);
    expect(shouldSuggestInstall(ANDROID, {})).toBe(false);
    expect(shouldSuggestInstall(IPAD, {})).toBe(false);
  });
});
