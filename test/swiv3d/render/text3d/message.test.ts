import { describe, expect, it } from "vitest";
import { HOLD_LIFE, MESSAGE_POOL_SIZE, MessagePool } from "../../../../src/games/swiv3d/render/text3d";

const text = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const ticks = (pool: MessagePool, n: number): void => {
  for (let i = 0; i < n; i++) pool.tick();
};

describe("messages 3D : trajectoires de gm_message_spawn", () => {
  it("type 0 : pré-simulé de 60 ticks, passe à l'origine puis file ; vit 71 ticks en tout", () => {
    const pool = new MessagePool();
    const m = pool.spawn(text("Missiles"), 0x1000, 0)!;
    expect(m.pos).toEqual([-384000, 140000, -420000]);
    expect(m.rot).toEqual([-480 - 60 * 32, 240 - 60 * 63, 160 - 60 * 44]);
    ticks(pool, 60);
    expect(m.pos).toEqual([0, -40000, 0]);
    ticks(pool, 10);
    expect(pool.active).toHaveLength(1);
    expect(m.life).toBe(0);
    ticks(pool, 1);
    expect(pool.active).toHaveLength(0);
  });

  it("type 0 : la rotation s'arrête quand la vie tombe à 10", () => {
    const pool = new MessagePool();
    const m = pool.spawn(text("x"), 0, 0)!;
    ticks(pool, 59);
    const rot = [...m.rot];
    expect(m.life).toBe(11);
    ticks(pool, 5);
    expect(m.rot).toEqual(rot);
  });

  it("type 10 : arrive en 80 ticks au centre, puis reste figé (vie 1000) en continuant de tourner", () => {
    const pool = new MessagePool();
    const m = pool.spawn(text("Game over !"), 0x1000, 10)!;
    expect(m.yOffset).toBe(-140);
    ticks(pool, 80);
    expect(m.life).toBe(HOLD_LIFE);
    const pos = [...m.pos];
    const yaw = m.rot[1];
    ticks(pool, 500);
    expect(pool.active).toHaveLength(1);
    expect(m.pos).toEqual(pos);
    expect(m.rot[1]).toBe(yaw + 500 * 45);
  });

  it("type 11 (titre de menu) : figé après 31 ticks ; la sortie du menu le fait repartir et disparaître en 21 ticks", () => {
    const pool = new MessagePool();
    const m = pool.spawn(text("Pause"), 0x400, 11)!;
    ticks(pool, 31);
    expect(m.life).toBe(HOLD_LIFE);
    expect(m.pos).toEqual([0, 0, 0]);
    pool.releaseTitles();
    expect(m.life).toBe(HOLD_LIFE - 980);
    ticks(pool, 20);
    expect(pool.active).toHaveLength(1);
    ticks(pool, 1);
    expect(pool.active).toHaveLength(0);
  });

  it("la sortie du menu ne touche pas les messages en vol", () => {
    const pool = new MessagePool();
    const m = pool.spawn(text("x"), 0, 0)!;
    ticks(pool, 5);
    pool.releaseTitles();
    expect(m.life).toBe(65);
  });

  it("types inconnus ignorés ; pool de 50 messages", () => {
    const pool = new MessagePool();
    expect(pool.spawn(text("x"), 0, 3)).toBeNull();
    for (let i = 0; i < MESSAGE_POOL_SIZE; i++) expect(pool.spawn(text("x"), 0, 0)).not.toBeNull();
    expect(pool.spawn(text("x"), 0, 0)).toBeNull();
    pool.clear();
    expect(pool.active).toHaveLength(0);
  });
});
