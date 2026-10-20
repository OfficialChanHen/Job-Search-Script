/* Static game data for the hunter village. Sprites are emoji for now; once the
   sprite pack is in, each hunter, monster and boss gets a sprite id here.    */

export type ClassKey = "guardian" | "striker" | "swift" | "sniper";
export type OriginKey = "arrays" | "structs" | "recursion" | "text" | "data";
export type TraitKey = ClassKey | OriginKey;
export type Quirk = "" | "ghost" | "armor" | "enrage" | "slam" | "regen" | "frost" | "thorns";
export type BuildingKey = "inn" | "kitchen" | "forge" | "market";

export interface HunterDef { k: string; name: string; tier: 1 | 2 | 3; origin: OriginKey; cls: ClassKey }

// LeetCode topic → the adventurer who trains on it (the topic stays in the UI as "Trains on …")
export const HUNTERS: Record<string, Omit<HunterDef, "k">> = {
  hashing:        { name: "Sir Aldric",     tier: 1, origin: "arrays",    cls: "guardian" },
  two_pointers:   { name: "Kael the Duelist",    tier: 1, origin: "arrays",    cls: "striker" },
  sliding_window: { name: "Ren the Blade",   tier: 2, origin: "arrays",    cls: "striker" },
  binary_search:  { name: "Lyra the Scout",   tier: 2, origin: "arrays",    cls: "swift" },
  intervals:      { name: "Finn the Archer", tier: 2, origin: "arrays",    cls: "sniper" },
  matrix:         { name: "Mira the Runecaster",     tier: 2, origin: "arrays",    cls: "sniper" },
  stack:          { name: "Brann Ironwall",     tier: 1, origin: "structs",   cls: "guardian" },
  linked_list:    { name: "Wren the Rogue",      tier: 1, origin: "structs",   cls: "swift" },
  heap:           { name: "Thora Shieldmaiden",      tier: 2, origin: "structs",   cls: "guardian" },
  design:         { name: "Lord Cedric",       tier: 3, origin: "structs",   cls: "guardian" },
  trees:          { name: "Brother Oren",     tier: 2, origin: "recursion", cls: "guardian" },
  graphs:         { name: "Vex the Spellblade",    tier: 3, origin: "recursion", cls: "striker" },
  backtracking:   { name: "Shade", tier: 3, origin: "recursion", cls: "sniper" },
  dp:             { name: "Master Kenji",         tier: 3, origin: "recursion", cls: "striker" },
  strings:        { name: "Elowen the Enchanter",     tier: 1, origin: "text",      cls: "sniper" },
  parsing:        { name: "Rook the Ranger",      tier: 2, origin: "text",      cls: "swift" },
  js:             { name: "Ember the Pyromancer",          tier: 1, origin: "text",      cls: "striker" },
  sql:            { name: "Maeve the Oracle",      tier: 1, origin: "data",      cls: "guardian" },
  pandas:         { name: "Bao the Wanderer",      tier: 1, origin: "data",      cls: "swift" },
  math:           { name: "Morrow the Mage",        tier: 1, origin: "data",      cls: "sniper" },
};
export const TIER_NAME = ["", "Common", "Rare", "Epic"];

export const CLASSES: Record<ClassKey, { name: string; atk: number; hp: number; spd: number; crit: number; note: string }> = {
  guardian: { name: "Guardian", atk: 0.7,  hp: 1.6,  spd: 1,   crit: 0,    note: "Tough. Put them in the front row." },
  striker:  { name: "Striker",  atk: 1.35, hp: 0.85, spd: 1,   crit: 0,    note: "Hits hard." },
  swift:    { name: "Swift",    atk: 0.8,  hp: 0.9,  spd: 1.4, crit: 0,    note: "Attacks fast and never misses." },
  sniper:   { name: "Sniper",   atk: 1,    hp: 0.8,  spd: 1,   crit: 0.15, note: "Lands more critical hits." },
};

export interface TraitDef { name: string; at: number[]; fx: number[]; what: string }
export const TRAITS: Record<TraitKey, TraitDef> = {
  arrays:    { name: "Arrays",     at: [2, 4, 6], fx: [0.10, 0.25, 0.45], what: "Whole party deals {} more damage" },
  structs:   { name: "Structures", at: [2, 4],    fx: [0.15, 0.35],       what: "Whole party has {} more HP" },
  recursion: { name: "Recursion",  at: [2, 4],    fx: [0.10, 0.25],       what: "Whole party gets {} more crit chance" },
  text:      { name: "Text",       at: [2, 3],    fx: [0.12, 0.25],       what: "Whole party attacks {} faster" },
  data:      { name: "Data",       at: [2, 3],    fx: [0.15, 0.35],       what: "Hunting earns {} more gold" },
  guardian:  { name: "Guardian",   at: [2, 4],    fx: [0.30, 0.70],       what: "Guardians get {} more HP" },
  striker:   { name: "Striker",    at: [2, 4],    fx: [0.25, 0.60],       what: "Strikers deal {} more damage" },
  swift:     { name: "Swift",      at: [2, 4],    fx: [0.30, 0.70],       what: "Swift hunters attack {} faster" },
  sniper:    { name: "Sniper",     at: [2, 4],    fx: [0.60, 1.40],       what: "Sniper crits hit {} harder" },
};

/* Ranks never stop: each needs more training (solves + spaced reviews) than the last and
   multiplies the hunter's stats by 1.6. Reviews come back forever, so a topic keeps growing. */
export const RANK_AT = Array.from({ length: 40 }, (_, i) => i < 4 ? [1, 3, 8, 16][i] : Math.round(16 + 7 * (i - 3) * (i - 2) / 2 + 6 * (i - 3)));
export const RANK_MULT = [0, ...Array.from({ length: 40 }, (_, i) => Math.pow(1.6, i))];
const ROMAN: [number, string][] = [[40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export const roman = (n: number) => { let s = ""; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; };
export const RANK_NAME = ["", ...Array.from({ length: 40 }, (_, i) => roman(i + 1))];

// [label, what it does, what beats it]
export const QUIRKS: Record<Quirk, [string, string, string]> = {
  "":     ["No tricks", "A straight fight.", "a bigger party"],
  ghost:  ["Elusive", "30% of attacks miss. Swift hunters never miss.", "Swift hunters"],
  armor:  ["Armored", "Normal hits deal 40% less. Critical hits ignore armor.", "crits from Snipers and Recursion"],
  enrage: ["Timed", "You get 15 seconds instead of 30.", "raw damage from Strikers, Arrays and weapons"],
  slam:   ["Slam", "Every 3rd attack hits the whole party.", "HP from Guardians, Structures and armor"],
  regen:  ["Regen", "Heals 2.5% of its max HP every second.", "burst damage from Strikers and Snipers"],
  frost:  ["Frost", "Your party attacks 30% slower.", "Swift and Text hunters"],
  thorns: ["Thorns", "Every hit reflects 20% of its damage back.", "HP from Guardians, Structures and armor"],
};

export interface ZoneDef { name: string; boss: { name: string; quirk: Quirk } }
export const LAP_NAMES = ["", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const ZONES: ZoneDef[] = [
  { name: "Application Fields", boss: { name: "Recruiter Gatekeeper", quirk: "slam" } },
  { name: "Ghostwood", boss: { name: "The Ghoster", quirk: "ghost" } },
  { name: "OA Caverns", boss: { name: "HackerRank Hydra", quirk: "enrage" } },
  { name: "Keyword Desert", boss: { name: "Keyword Filter Golem", quirk: "armor" } },
  { name: "Phone Screen Pass", boss: { name: "The Hiring Freeze", quirk: "frost" } },
  { name: "Whiteboard Ruins", boss: { name: "The 5+ Years Required Ogre", quirk: "thorns" } },
  { name: "Behavioral Bog", boss: { name: "Edge Case Swarm", quirk: "regen" } },
  { name: "System Design Spire", boss: { name: "System Design Titan", quirk: "armor" } },
  { name: "Hiring Committee Keep", boss: { name: "Hiring Committee Dragon", quirk: "slam" } },
];

/** How much more each Market level makes real work pay. */
export const MARKET_STEP = 0.1;
export const BUILDINGS: Record<BuildingKey, { name: string; max: number; base: number; g: number; what: (lv: number) => string }> = {
  inn:     { name: "Inn",     max: 18, base: 40, g: 2.2, what: lv => `${2 + lv} hunters can be on duty` },
  kitchen: { name: "Kitchen", max: 8, base: 30, g: 2.4, what: lv => lv > 1 ? `Food lasts ${Math.round(25 * (lv - 1))}% longer` : "Food lasts the normal time" },
  forge:   { name: "Forge",   max: 999, base: 35, g: 2.3, what: lv => `Gear can reach level ${8 * lv}` },
  market:  { name: "Market",  max: 999, base: 50, g: 2.2, what: lv => lv > 1 ? `Real work pays ${Math.round(100 * MARKET_STEP * (lv - 1))}% more gold` : "Real work pays the base rate" },
};
export const BUILDING_ORDER: BuildingKey[] = ["inn", "kitchen", "forge", "market"];

// [sprite, name]: the weekly world bosses borrow zone bosses' recolors
export const RAID_BOSSES: [string, string][] = [["boss:2", "The Hiring Freeze"], ["boss:3:alt", "The Layoff Kraken"], ["boss:6:alt", "The Ghost Job Hydra"],
  ["boss:9:alt", "The Recession Storm"], ["boss:8:alt", "The Final Round"]];

/** Food each real action gives, in hours of hunting. Each action also pays this many hours of wages in gold. */
export const FOOD = { app: 4, solve: 2, review: 1, outreach: 2, followUp: 2, questClear: 6, daHour: 1 };

/* ── materials: hunting gathers them, and they only buy cosmetics (never gear or stats) ── */
export type Mat = "wood" | "stone" | "gems";
export type Mats = Record<Mat, number>;
export const MAT_KEYS: Mat[] = ["wood", "stone", "gems"];
export const MATS: Record<Mat, { name: string; sprite: string }> = {
  wood: { name: "Wood", sprite: "res:wood" }, stone: { name: "Stone", sprite: "res:stone" }, gems: { name: "Gems", sprite: "res:gem" },
};
/** What an hour of hunting gathers at full efficiency in zone 1. Harder zones gather a little more. */
export const MAT_RATE: Mats = { wood: 5, stone: 3, gems: 0.4 };

export type CosKind = "deco" | "aura" | "pennant" | "theme";
export interface CosDef { id: string; kind: CosKind; name: string; cost: Partial<Mats>; sprite?: string; color?: string; note?: string }
export const COS_KINDS: Record<CosKind, string> = { deco: "Decorations", aura: "Auras", pennant: "Pennants", theme: "Map themes" };
export const COSMETICS: CosDef[] = [
  // decorations stand in the town on the map
  { id: "flowers",  kind: "deco", name: "Flower bed",   cost: { wood: 8 }, sprite: "prop:sunflowers" },
  { id: "campfire", kind: "deco", name: "Fire pit",     cost: { wood: 20 } },
  { id: "lantern",  kind: "deco", name: "Lantern",      cost: { wood: 15, stone: 5 } },
  { id: "banner",   kind: "deco", name: "Banner",       cost: { wood: 25, gems: 1 } },
  { id: "olive",    kind: "deco", name: "Olive tree",   cost: { wood: 30 }, sprite: "prop:oliveTree" },
  { id: "cherry",   kind: "deco", name: "Cherry tree",  cost: { wood: 40, gems: 1 }, sprite: "prop:pinktree" },
  { id: "well",     kind: "deco", name: "Orb shrine",     cost: { stone: 45 } },
  { id: "cottage",  kind: "deco", name: "Cottage",      cost: { wood: 90, stone: 40 }, sprite: "bld:house1" },
  { id: "statue",   kind: "deco", name: "Stone idol",  cost: { stone: 90, gems: 3 } },
  { id: "manor",    kind: "deco", name: "Manor",        cost: { wood: 200, stone: 140, gems: 6 }, sprite: "bld:house2" },
  // hunter looks: unlock once, give to any hunter
  { id: "aura-gold",   kind: "aura", name: "Golden aura",   cost: { gems: 2 },             color: "#FFD166" },
  { id: "aura-frost",  kind: "aura", name: "Frost aura",    cost: { stone: 20, gems: 2 },  color: "#8FD3FF" },
  { id: "aura-ember",  kind: "aura", name: "Ember aura",    cost: { wood: 30, gems: 2 },   color: "#FF8A5B" },
  { id: "aura-void",   kind: "aura", name: "Void aura",     cost: { stone: 40, gems: 5 },  color: "#B79CFF" },
  { id: "pen-red",     kind: "pennant", name: "Red pennant",    cost: { wood: 12 },            color: "#E0675A" },
  { id: "pen-blue",    kind: "pennant", name: "Blue pennant",   cost: { wood: 12 },            color: "#5B8DEF" },
  { id: "pen-green",   kind: "pennant", name: "Green pennant",  cost: { wood: 12 },            color: "#5FBF7F" },
  { id: "pen-royal",   kind: "pennant", name: "Royal pennant",  cost: { wood: 30, gems: 2 },   color: "#9B6BE0" },
  // map themes change how the town looks
  { id: "autumn",  kind: "theme", name: "Autumn",         cost: { wood: 60, stone: 20 },           note: "Warm leaves drift over the village" },
  { id: "blossom", kind: "theme", name: "Cherry blossom", cost: { wood: 80, gems: 3 },             note: "Pink trees and falling petals" },
  { id: "snow",    kind: "theme", name: "Winter",         cost: { stone: 80, gems: 2 },            note: "Snow on the ground and snowfall" },
  { id: "night",   kind: "theme", name: "Night",          cost: { wood: 50, stone: 50, gems: 4 },  note: "Moonlight, with lanterns and windows glowing" },
];
export const cosmetic = (id: string) => COSMETICS.find(c => c.id === id);
/** A trophy of a beaten zone boss, for the trophy shelf. Later bosses cost more. */
export const trophyCost = (z: number): Partial<Mats> => ({ stone: 12 + 6 * (z - 1), gems: 1 + Math.floor((z - 1) / 2) });

/* ── equipment you can see: weapons step up a tier as their level rises, armor shows as a rim ── */
export const GEAR_TIERS = [0, 5, 15, 30, 60];          // level where each tier starts
export const gearTier = (lv: number) => GEAR_TIERS.filter(t => lv >= t).length - 1;
// [sprite name, display name] per tier, by class
export const WEAPONS: Record<ClassKey, [string, string][]> = {
  guardian: [["Club", "Wooden club"], ["Hammer", "War hammer"], ["Axe", "Battle axe"], ["Lance", "Knight's lance"], ["Lance2", "Dragon lance"]],
  striker:  [["Stick", "Training stick"], ["Sword", "Iron sword"], ["Katana", "Katana"], ["BigSword", "Greatsword"], ["Sword2", "Hero's blade"]],
  swift:    [["Sai", "Sai"], ["Ninjaku", "Ninjaku"], ["Rapier", "Rapier"], ["Katana", "Moon katana"], ["Sword2", "Hero's blade"]],
  sniper:   [["Bow", "Short bow"], ["Bow2", "Long bow"], ["MagicWand", "Magic wand"], ["Book", "Spell tome"], ["Book", "Archmage's tome"]],
};
export const ARMOR: { name: string; color: string }[] = [
  { name: "Traveler's cloth", color: "" }, { name: "Bronze mail", color: "#C0823F" }, { name: "Silver mail", color: "#C9D2DC" },
  { name: "Gold plate", color: "#E8BE4E" }, { name: "Starforged plate", color: "#A88BF0" },
];
export const weaponFor = (cls: ClassKey, lv: number) => WEAPONS[cls][gearTier(lv)];
export const armorFor = (lv: number) => ARMOR[gearTier(lv)];
// each zone's two field monsters, as the hunters' status lines name them (matches tools/build_sprites.py)
export const MOB_NAMES: [string, string][] = [["slime", "mushroom"], ["skull", "floating eye"], ["bat", "mole"], ["snake", "lizard"],
  ["beast", "owl"], ["cyclops", "reptile"], ["kappa", "octopus"], ["lantern spirit", "flame spirit"], ["dragon", "bear"]];
