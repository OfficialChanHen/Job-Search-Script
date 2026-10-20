/* Render real components against a real Store filled from the legacy fixture, the way App does. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { useEffect, useSyncExternalStore } from "react";
import { render } from "@testing-library/react";
import type { JobData } from "@/lib/data/types";
import { LOCAL_ONLY, NS, VERSIONED } from "@/lib/game/progress";
import { normalize, type VillageState } from "@/lib/game/village/engine";
import { importLegacy } from "@/lib/sync/importLegacy";
import { Store } from "@/lib/sync/store";
import { GameProvider, useDerived } from "@/components/GameContext";
import { UiProvider, useUi } from "@/components/UiContext";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
let cached: JobData | null = null;
export function loadData(): JobData {
  return (cached ??= {
    jobs: read("public/data/jobs.json"), preps: read("public/data/preps.json"), companies: read("public/data/companies.json"),
    topics: read("public/data/topics.json"), vocab: read("public/data/vocab.json"), meta: read("public/data/meta.json"),
  } as JobData);
}
export const fixture = read("src/lib/game/__fixtures__/legacy-backup.json");

/** A store with the fixture's progress and a village; `tweak` adjusts the village before the test. */
export function makeStore(tweak: (v: VillageState) => VillageState = v => v) {
  const store = new Store({ versioned: VERSIONED, localOnly: LOCAL_ONLY });
  importLegacy(store, fixture.backup.data);
  const existing = store.get<VillageState>(NS.village, "state");
  if (!existing) throw new Error("the fixture has no village");
  const base = normalize(existing);
  store.set(NS.village, "state", tweak({ ...base, last: Date.now() }));
  return store;
}
export const villageOf = (store: Store) => normalize(store.get<VillageState>(NS.village, "state"));

function Open({ vil }: { vil?: string | null }) {
  const { setVil } = useUi();
  useEffect(() => { if (vil !== undefined) setVil(vil); }, [vil, setVil]);
  return null;
}
function Root({ store, children, vil }: { store: Store; children: React.ReactNode; vil?: string | null }) {
  const rev = useSyncExternalStore(store.subscribe, store.getRev, store.getRev);
  const game = useDerived(loadData(), store, rev);
  return <GameProvider value={game}><UiProvider><Open vil={vil} />{children}</UiProvider></GameProvider>;
}
export function renderWithGame(ui: React.ReactNode, store: Store, vil?: string | null) {
  return render(<Root store={store} vil={vil}>{ui}</Root>);
}
