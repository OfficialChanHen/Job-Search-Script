/* Static game data for the hunter village. Sprites are emoji for now; once the
   sprite pack is in, each hunter, monster and boss gets a sprite id here.    */

export type ClassKey = "guardian" | "striker" | "swift" | "sniper";
export type OriginKey = "arrays" | "structs" | "recursion" | "text" | "data";
export type TraitKey = ClassKey | OriginKey;
export type Quirk = "" | "ghost" | "armor" | "enrage" | "slam" | "regen" | "frost" | "thorns";
export type BuildingKey = "inn" | "kitchen" | "forge" | "market";

export interface HunterDef { k: string; ico: string; name: string; tier: 1 | 2 | 3; origin: OriginKey; cls: ClassKey }

// LeetCode topic → the adventurer who trains on it (the topic stays in the UI as "Trains on …")
export const HUNTERS: Record<string, Omit<HunterDef, "k">> = {
  hashing:        { ico: "🛡️", name: "Sir Aldric",     tier: 1, origin: "arrays",    cls: "guardian" },
  two_pointers:   { ico: "⚔️", name: "Kael the Duelist",    tier: 1, origin: "arrays",    cls: "striker" },
  sliding_window: { ico: "⚔️", name: "Ren the Blade",   tier: 2, origin: "arrays",    cls: "striker" },
  binary_search:  { ico: "🗡️", name: "Lyra the Scout",   tier: 2, origin: "arrays",    cls: "swift" },
  intervals:      { ico: "🏹", name: "Finn the Archer", tier: 2, origin: "arrays",    cls: "sniper" },
  matrix:         { ico: "🏹", name: "Mira the Runecaster",     tier: 2, origin: "arrays",    cls: "sniper" },
  stack:          { ico: "🛡️", name: "Brann Ironwall",     tier: 1, origin: "structs",   cls: "guardian" },
  linked_list:    { ico: "🗡️", name: "Wren the Rogue",      tier: 1, origin: "structs",   cls: "swift" },
  heap:           { ico: "🛡️", name: "Thora Shieldmaiden",      tier: 2, origin: "structs",   cls: "guardian" },
  design:         { ico: "🛡️", name: "Lord Cedric",       tier: 3, origin: "structs",   cls: "guardian" },
  trees:          { ico: "🛡️", name: "Brother Oren",     tier: 2, origin: "recursion", cls: "guardian" },
  graphs:         { ico: "⚔️", name: "Vex the Spellblade",    tier: 3, origin: "recursion", cls: "striker" },
  backtracking:   { ico: "🏹", name: "Shade", tier: 3, origin: "recursion", cls: "sniper" },
  dp:             { ico: "⚔️", name: "Master Kenji",         tier: 3, origin: "recursion", cls: "striker" },
  strings:        { ico: "🏹", name: "Elowen the Enchanter",     tier: 1, origin: "text",      cls: "sniper" },
  parsing:        { ico: "🗡️", name: "Rook the Ranger",      tier: 2, origin: "text",      cls: "swift" },
  js:             { ico: "⚔️", name: "Ember the Pyromancer",          tier: 1, origin: "text",      cls: "striker" },
  sql:            { ico: "🛡️", name: "Maeve the Oracle",      tier: 1, origin: "data",      cls: "guardian" },
  pandas:         { ico: "🗡️", name: "Bao the Wanderer",      tier: 1, origin: "data",      cls: "swift" },
  math:           { ico: "🏹", name: "Morrow the Mage",        tier: 1, origin: "data",      cls: "sniper" },
};
export const TIER_NAME = ["", "Common", "Rare", "Epic"];

export const CLASSES: Record<ClassKey, { ico: string; name: string; atk: number; hp: number; spd: number; crit: number; note: string }> = {
  guardian: { ico: "🛡️", name: "Guardian", atk: 0.7,  hp: 1.6,  spd: 1,   crit: 0,    note: "Tough. Put them in the front row." },
  striker:  { ico: "⚔️", name: "Striker",  atk: 1.35, hp: 0.85, spd: 1,   crit: 0,    note: "Hits hard." },
  swift:    { ico: "💨", name: "Swift",    atk: 0.8,  hp: 0.9,  spd: 1.4, crit: 0,    note: "Attacks fast and never misses." },
  sniper:   { ico: "🎯", name: "Sniper",   atk: 1,    hp: 0.8,  spd: 1,   crit: 0.15, note: "Lands more critical hits." },
};

export interface TraitDef { ico: string; name: string; at: number[]; fx: number[]; what: string }
export const TRAITS: Record<TraitKey, TraitDef> = {
  arrays:    { ico: "🧮", name: "Arrays",     at: [2, 4, 6], fx: [0.10, 0.25, 0.45], what: "Whole party deals {} more damage" },
  structs:   { ico: "🧱", name: "Structures", at: [2, 4],    fx: [0.15, 0.35],       what: "Whole party has {} more HP" },
  recursion: { ico: "🌀", name: "Recursion",  at: [2, 4],    fx: [0.10, 0.25],       what: "Whole party gets {} more crit chance" },
  text:      { ico: "✒️", name: "Text",       at: [2, 3],    fx: [0.12, 0.25],       what: "Whole party attacks {} faster" },
  data:      { ico: "📊", name: "Data",       at: [2, 3],    fx: [0.15, 0.35],       what: "Hunting earns {} more gold" },
  guardian:  { ico: "🛡️", name: "Guardian",   at: [2, 4],    fx: [0.30, 0.70],       what: "Guardians get {} more HP" },
  striker:   { ico: "⚔️", name: "Striker",    at: [2, 4],    fx: [0.25, 0.60],       what: "Strikers deal {} more damage" },
  swift:     { ico: "💨", name: "Swift",      at: [2, 4],    fx: [0.30, 0.70],       what: "Swift hunters attack {} faster" },
  sniper:    { ico: "🎯", name: "Sniper",     at: [2, 4],    fx: [0.60, 1.40],       what: "Sniper crits hit {} harder" },
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
  ghost:  ["👻 Elusive", "30% of attacks miss. Swift hunters never miss.", "Swift hunters"],
  armor:  ["🛡️ Armored", "Normal hits deal 40% less. Critical hits ignore armor.", "crits from Snipers and Recursion"],
  enrage: ["⏱️ Timed", "You get 15 seconds instead of 30.", "raw damage from Strikers, Arrays and weapons"],
  slam:   ["💥 Slam", "Every 3rd attack hits the whole party.", "HP from Guardians, Structures and armor"],
  regen:  ["💚 Regen", "Heals 2.5% of its max HP every second.", "burst damage from Strikers and Snipers"],
  frost:  ["🧊 Frost", "Your party attacks 30% slower.", "Swift and Text hunters"],
  thorns: ["🌵 Thorns", "Every hit reflects 20% of its damage back.", "HP from Guardians, Structures and armor"],
};

export interface ZoneDef { name: string; mobs: string[]; boss: { ico: string; name: string; quirk: Quirk } }
export const LAP_NAMES = ["", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const ZONES: ZoneDef[] = [
  { name: "Application Fields",    mobs: ["📄", "🤖"], boss: { ico: "📞", name: "Recruiter Gatekeeper", quirk: "slam" } },
  { name: "Ghostwood",             mobs: ["👻", "🕳️"], boss: { ico: "🫥", name: "The Ghoster", quirk: "ghost" } },
  { name: "OA Caverns",            mobs: ["⏱️", "🦇"], boss: { ico: "🐍", name: "HackerRank Hydra", quirk: "enrage" } },
  { name: "Keyword Desert",        mobs: ["🔑", "🦂"], boss: { ico: "🗿", name: "Keyword Filter Golem", quirk: "armor" } },
  { name: "Phone Screen Pass",     mobs: ["☎️", "🐺"], boss: { ico: "🧊", name: "The Hiring Freeze", quirk: "frost" } },
  { name: "Whiteboard Ruins",      mobs: ["🖊️", "🐢"], boss: { ico: "👹", name: "The 5+ Years Required Ogre", quirk: "thorns" } },
  { name: "Behavioral Bog",        mobs: ["🗣️", "🐸"], boss: { ico: "🌀", name: "Edge Case Swarm", quirk: "regen" } },
  { name: "System Design Spire",   mobs: ["🧱", "🦅"], boss: { ico: "🗼", name: "System Design Titan", quirk: "armor" } },
  { name: "Hiring Committee Keep", mobs: ["⚖️", "🦉"], boss: { ico: "🐉", name: "Hiring Committee Dragon", quirk: "slam" } },
];

export const BUILDINGS: Record<BuildingKey, { ico: string; name: string; max: number; base: number; g: number; what: (lv: number) => string }> = {
  inn:     { ico: "🏨", name: "Inn",     max: 18, base: 40, g: 2.2, what: lv => `${2 + lv} hunters can be on duty` },
  kitchen: { ico: "🍲", name: "Kitchen", max: 8, base: 30, g: 2.4, what: lv => lv > 1 ? `Food lasts ${Math.round(25 * (lv - 1))}% longer` : "Food lasts the normal time" },
  forge:   { ico: "⚒️", name: "Forge",   max: 999, base: 35, g: 1.9, what: lv => `Gear can reach level ${8 * lv}` },
  market:  { ico: "🏪", name: "Market",  max: 999, base: 50, g: 2.0, what: lv => lv > 1 ? `Hunting earns ${Math.round(15 * (lv - 1))}% more gold` : "Hunting earns the base rate" },
};
export const BUILDING_ORDER: BuildingKey[] = ["inn", "kitchen", "forge", "market"];

export const RAID_BOSSES: [string, string][] = [["🧊", "The Hiring Freeze"], ["🦑", "The Layoff Kraken"], ["👾", "The Ghost Job Hydra"],
  ["🌪️", "The Recession Storm"], ["🗿", "The Final Round"]];

/** Food each real action gives, in hours of hunting. */
export const FOOD = { app: 4, solve: 2, review: 1, outreach: 2, followUp: 2, questClear: 6, daHour: 1 };
