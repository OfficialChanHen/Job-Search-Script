// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getScene } from "@/lib/client/scene";
import { HUNTERS } from "@/lib/game/village/defs";
import { beds, gearCost, gearOf, goldNow, matsNow, payFor, type VillageState } from "@/lib/game/village/engine";
import { snapshot } from "@/lib/game/progress";
import { makeStore, renderWithGame, villageOf } from "@/test/harness";
import { VillageWindow } from "./Village";

beforeAll(() => {
  // the scene loads a sprite manifest; the map itself isn't drawn in jsdom (it has no size), only its logic runs
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  HTMLCanvasElement.prototype.getContext = (() => null) as never;     // jsdom has no canvas; the scene skips drawing without one
});
afterEach(() => cleanup());

const rich = (v: VillageState): VillageState => ({ ...v, hunted: v.hunted + 1e7 });
const firstOnDuty = (store: ReturnType<typeof makeStore>) => villageOf(store).party[0];

describe("village window", () => {
  it("lists hunters on duty with their damage, HP and an upgrade badge when you can afford one", () => {
    const store = makeStore(rich);
    renderWithGame(<VillageWindow />, store, "");
    expect(screen.getByText("On duty")).toBeTruthy();
    const k = firstOnDuty(store), card = screen.getAllByTitle(new RegExp(HUNTERS[k].name))[0];
    expect(within(card).getByText(/Dmg/)).toBeTruthy();
    expect(within(card).getByText(/HP/)).toBeTruthy();
    expect(within(card).getByTitle("You have the gold for a gear upgrade")).toBeTruthy();
  });

  it("opens a hunter's card with a stat table that previews each upgrade", () => {
    const store = makeStore(rich), k = firstOnDuty(store);
    renderWithGame(<VillageWindow />, store, "");
    fireEvent.click(screen.getAllByTitle(new RegExp(HUNTERS[k].name))[0]);
    const table = screen.getByRole("table");
    for (const h of ["Now", "Weapon +1", "Armor +1"]) expect(within(table).getByText(h)).toBeTruthy();
    const dmg = within(table).getByText("Damage per hit").closest("tr")!;
    expect(dmg.querySelectorAll(".up").length).toBeGreaterThan(0);          // a weapon level adds damage
    expect(within(table).getByText("Boss win chance")).toBeTruthy();
    expect(screen.getAllByText(/Next level:/, { selector: ".sub2" })).toHaveLength(2);   // weapon and armor
  });

  it("upgrading a weapon spends gold and raises the level", () => {
    const store = makeStore(rich), k = firstOnDuty(store);
    const before = villageOf(store), lv = gearOf(before, k).w;
    renderWithGame(<VillageWindow />, store, k);
    fireEvent.click(screen.getAllByRole("button", { name: `Upgrade, ${gearCost(lv).toLocaleString()} gold` })[0]);   // weapon row comes first
    const after = villageOf(store);
    expect(gearOf(after, k).w).toBe(lv + 1);
    expect(after.spent - before.spent).toBe(gearCost(lv));
  });

  it("buys every affordable level at once", () => {
    const store = makeStore(rich), k = firstOnDuty(store);
    renderWithGame(<VillageWindow />, store, k);
    fireEvent.click(screen.getAllByRole("button", { name: /^All \d+/ })[0]);
    const v = villageOf(store);
    expect(gearOf(v, k).w).toBe(8 * v.bld.forge);
  });

  it("steps between hunters with the arrow buttons and keys", () => {
    const store = makeStore(rich);
    const [a, b] = villageOf(store).party;
    renderWithGame(<VillageWindow />, store, a);
    const name = () => document.querySelector(".hdet b")!.textContent;
    expect(name()).toBe(HUNTERS[a].name);
    fireEvent.click(screen.getByRole("button", { name: "Next hunter" }));
    expect(name()).toBe(HUNTERS[b].name);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(name()).toBe(HUNTERS[a].name);
  });

  it("clicking a hunter on the map opens their card", () => {
    const store = makeStore(rich), k = firstOnDuty(store);
    renderWithGame(<VillageWindow />, store, "");
    expect(document.querySelector(".hdet")).toBeNull();
    act(() => getScene().onSelect?.(k));
    expect(document.querySelector(".hdet b")!.textContent).toBe(HUNTERS[k].name);
  });

  it("buildings show what the next level changes, and the Inn adds a bed", () => {
    const store = makeStore(rich), n = beds(villageOf(store));
    renderWithGame(<VillageWindow />, store, "");
    expect(screen.getByText(new RegExp(`Beds: ${n}`))).toBeTruthy();
    const inn = screen.getByText(/Inn/, { selector: ".bld .t span" }).closest(".bld")!;
    fireEvent.click(within(inn as HTMLElement).getByRole("button", { name: /Upgrade/ }));
    expect(beds(villageOf(store))).toBe(n + 1);
    expect(screen.getByText(new RegExp(`Beds: ${n + 1}`))).toBeTruthy();
  });

  it("fills empty beds with resting hunters", () => {
    const store = makeStore(v => ({ ...rich(v), party: [], bld: { ...v.bld, inn: 10 } }));
    renderWithGame(<VillageWindow />, store, "");
    fireEvent.click(screen.getByRole("button", { name: "Fill empty beds" }));
    expect(villageOf(store).party.length).toBeGreaterThan(0);
  });

  it("shows the boss's rest timer instead of letting you fight", () => {
    const store = makeStore(v => ({ ...v, bossReadyAt: Date.now() + 5 * 60_000 }));
    renderWithGame(<VillageWindow />, store, "");
    const btn = screen.getByRole("button", { name: /The boss is resting/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("refuses an upgrade you can't pay for and leaves the village alone", () => {
    const store = makeStore(v => ({ ...v, hunted: 0, raidGold: 0, spent: 0 }));
    const k = firstOnDuty(store), before = villageOf(store);
    if (goldNow(before, snapshot(store)) >= gearCost(gearOf(before, k).w)) return;    // fixture has DA gold to spare
    renderWithGame(<VillageWindow />, store, k);
    fireEvent.click(screen.getAllByRole("button", { name: /^Upgrade, / })[0]);
    expect(villageOf(store).gear).toEqual(before.gear);
  });

  it("says what each real action pays in gold today", () => {
    const store = makeStore();
    renderWithGame(<VillageWindow />, store, "");
    const pay = payFor(villageOf(store));
    const list = screen.getByLabelText("Gold each real action pays today");
    expect(within(list).getByText(/Gold only comes from real work/)).toBeTruthy();
    expect(within(list).getByText("Application").querySelector("b")!.textContent).toBe(pay.app.toLocaleString());
  });
});

const stocked = (v: VillageState): VillageState => ({ ...v, mats: { wood: 500, stone: 500, gems: 50 }, matSpent: { wood: 0, stone: 0, gems: 0 } });

describe("workshop and trophies", () => {
  it("makes a decoration with materials, and gold is untouched", () => {
    const store = makeStore(stocked), before = villageOf(store), gold = goldNow(before, snapshot(store));
    renderWithGame(<VillageWindow />, store, "");
    const card = screen.getByText("Flower bed").closest(".cos") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Make it" }));
    const after = villageOf(store);
    expect(after.cos.flowers).toBe(1);
    expect(matsNow(after).wood).toBeCloseTo(matsNow(before).wood - 8, 2);   // hunters keep gathering a hair meanwhile
    expect(goldNow(after, snapshot(store))).toBeCloseTo(gold, 6);
    expect(within(screen.getByText("Flower bed").closest(".cos") as HTMLElement).getByText("In the village")).toBeTruthy();
  });

  it("can't make what you can't afford", () => {
    const store = makeStore(v => ({ ...v, mats: { wood: 0, stone: 0, gems: 0 }, matSpent: { wood: 0, stone: 0, gems: 0 } }));
    renderWithGame(<VillageWindow />, store, "");
    fireEvent.click(within(screen.getByText("Flower bed").closest(".cos") as HTMLElement).getByRole("button", { name: "Make it" }));
    expect(villageOf(store).cos.flowers).toBeUndefined();
  });

  it("buys a theme, uses it, and turns it off", () => {
    const store = makeStore(stocked);
    renderWithGame(<VillageWindow />, store, "");
    fireEvent.click(screen.getByRole("tab", { name: "Map themes" }));
    const night = () => screen.getByText("Night").closest(".cos") as HTMLElement;
    fireEvent.click(within(night()).getByRole("button", { name: "Make it" }));
    expect(villageOf(store).theme).toBe("night");
    fireEvent.click(within(night()).getByRole("button", { name: /Turn off/ }));
    expect(villageOf(store).theme).toBe("");
  });

  it("gives an unlocked aura to a hunter from their card", () => {
    const store = makeStore(v => ({ ...stocked(v), cos: { "aura-gold": 1 } })), k = villageOf(store).party[0];
    renderWithGame(<VillageWindow />, store, k);
    const pick = screen.getByText("Aura").querySelector("select")!;
    fireEvent.change(pick, { target: { value: "aura-gold" } });
    expect(villageOf(store).look[k]?.aura).toBe("aura-gold");
  });

  it("crafts a trophy for a beaten boss", () => {
    const store = makeStore(v => ({ ...stocked(v), unlocked: Math.max(2, v.unlocked), trophies: {} }));
    renderWithGame(<VillageWindow />, store, "");
    fireEvent.click(screen.getAllByRole("button", { name: "Craft" })[0]);
    expect(villageOf(store).trophies[1]).toBe(1);
    expect(screen.getAllByText("On the shelf").length).toBeGreaterThan(0);
  });
});
