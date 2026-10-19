#!/usr/bin/env python3
"""
Copy the village's sprites out of the Ninja Adventure asset pack and write
public/sprites/manifest.json.

The pack (CC0, by Pixel-boy, https://pixel-boy.itch.io/ninja-adventure-asset-pack)
lives unzipped in assets/ninja-adventure/ (gitignored, 112 MB). Only what the
game uses is copied, so the deploy stays small. Re-run after changing a pick:

    python3 tools/build_sprites.py

Actor ids the scene asks for:
    hunter:<topic>        a LeetCode topic's hunter (4 directions, walk/idle/attack)
    mob:<zone 1-9>:<0|1>  the zone's two field monsters (4 directions, walk)
    boss:<zone 1-9>       the zone boss (idle + hit strips); boss:<zone>:alt on repeat laps
    bld:<inn|kitchen|forge|market>, prop:<name>, npc:you, fx:<name>, emote:<name>
"""
import json
import shutil
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / "assets" / "ninja-adventure"
OUT = ROOT / "public" / "sprites"

# LeetCode topic → adventurer sprite folder (Actor/Character/<name>/SpriteSheet.png)
HUNTERS = {
    "hashing": "Knight",
    "two_pointers": "FighterRed",
    "sliding_window": "Samurai",
    "binary_search": "NinjaYellow",
    "intervals": "Hunter",
    "matrix": "SorcererOrange",
    "stack": "GladiatorBlue",
    "linked_list": "NinjaBlue",
    "heap": "RedGladiator",
    "design": "KnightGold",
    "trees": "Monk",
    "graphs": "NinjaMageBlack",
    "backtracking": "NinjaDark",
    "dp": "Master",
    "strings": "NinjaMageOrange",
    "parsing": "CamouflageGreen",
    "js": "NinjaFire",
    "sql": "Shaman",
    "pandas": "Monk2",
    "math": "SorcererBlack",
}
# zone (1-9) → its two field monsters, and the variants used on harder repeat laps
MOBS = {
    1: ["Slime", "Mushroom"], 2: ["Skull", "Eye"], 3: ["BlueBat", "Mole"], 4: ["Snake", "Lizard"],
    5: ["Beast", "Owl"], 6: ["Cyclope", "Reptile"], 7: ["KappaGreen", "Octopus"], 8: ["LanternRed", "Flam"],
    9: ["Dragon", "Bear"],
}
MOBS_ALT = {
    1: ["Slime2", "Mushroom2"], 2: ["SkullBlue", "Eye2"], 3: ["BlueBat", "Mole2"], 4: ["Snake2", "Lizard2"],
    5: ["Beast2", "Owl2"], 6: ["Cyclope2", "Reptile2"], 7: ["KappaRed", "Octopus2"], 8: ["LanternGreen", "Flam2"],
    9: ["DragonYellow", "Grey"],
}
# zone → boss folder (Idle + Hit strips), and the recolour for repeat laps
BOSSES = {
    1: ("GiantRedSamurai", "GiantBlueSamurai"), 2: ("GiantSpirit", "GiantFlam"), 3: ("SquidGreen", "SquidRed"),
    4: ("GiantBamboo", "GiantBamboo2"), 5: ("GiantSlime", "GiantSlime2"), 6: ("DemonCyclop", "DemonCyclop2"),
    7: ("GiantFrog", "GiantFrog2"), 8: ("GiantRacoon", "GiantRacoonGold"), 9: ("TenguRed", "TenguBlue"),
}
# ground per zone: rows of fill tiles in Backgrounds/Tilesets/TilesetFloor.png (first is the plain one)
GROUND = {
    "grass": [(0, 192), (16, 192), (32, 192), (48, 192), (64, 192)],
    "darkgrass": [(176, 192), (192, 192), (208, 192), (224, 192), (240, 192)],
    "sand": [(0, 80), (16, 80), (32, 80), (48, 80), (64, 80)],
    "pinksand": [(176, 80), (192, 80), (208, 80), (224, 80), (240, 80)],
    "snow": [(0, 304), (16, 304), (32, 304), (48, 304), (64, 304)],
    "stone": [(176, 304), (192, 304), (208, 304), (224, 304), (240, 304)],
}
# pixel rects in TilesetHouse.png / TilesetNature.png
BUILDINGS = {"inn": (192, 0, 64, 48), "kitchen": (368, 0, 48, 48), "forge": (304, 0, 64, 48), "market": (256, 0, 48, 48),
             "house1": (0, 0, 64, 48), "house2": (128, 0, 64, 48)}
PROPS = {
    "tree": (0, 0, 32, 32), "pine": (32, 0, 32, 32), "deadtree": (64, 0, 32, 32), "roundtree": (96, 0, 32, 32),
    "snowtree": (128, 0, 32, 32), "snowpine": (160, 0, 32, 32), "pinktree": (224, 0, 32, 32), "oliveTree": (288, 0, 32, 32),
    "rocks": (193, 83, 61, 44), "greyrocks": (257, 83, 61, 44), "rock": (210, 132, 29, 27), "greyrock": (258, 132, 29, 27),
    "stump": (1, 134, 30, 23),
}
EMOTES = {"sleep": 28, "heart": 27, "alert": 22, "star": 29}


def png_size(p: Path) -> tuple[int, int]:
    with open(p, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def png_alpha_columns(p: Path) -> list[bool]:
    """Which columns have any opaque pixel (8-bit RGBA / RGB / palette PNGs)."""
    data = p.read_bytes()
    pos, idat, w, h, ctype, plte, trns = 8, b"", 0, 0, 6, b"", b""
    while pos < len(data):
        ln, = struct.unpack(">I", data[pos:pos + 4]); typ = data[pos + 4:pos + 8]; body = data[pos + 8:pos + 8 + ln]; pos += 12 + ln
        if typ == b"IHDR": w, h, _, ctype = struct.unpack(">IIBB", body[:10])
        elif typ == b"IDAT": idat += body
        elif typ == b"PLTE": plte = body
        elif typ == b"tRNS": trns = body
    ch = {6: 4, 2: 3, 3: 1, 0: 1, 4: 2}[ctype]
    raw, stride = zlib.decompress(idat), w * ch
    cols, prev, i = [False] * w, bytearray(stride), 0
    for _ in range(h):
        f = raw[i]; i += 1; line = bytearray(raw[i:i + stride]); i += stride
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0; b = prev[x]; c = prev[x - ch] if x >= ch else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        for x in range(w):
            if ctype == 6: o = line[x * 4 + 3] > 0
            elif ctype == 4: o = line[x * 2 + 1] > 0
            elif ctype == 3: k = line[x]; o = (trns[k] if k < len(trns) else 255) > 0
            else: o = True
            cols[x] = cols[x] or o
        prev = line
    return cols


def strip_frames(p: Path) -> tuple[int, int, int]:
    """A horizontal animation strip: (frames, frame width, height), counted by the gaps between figures."""
    w, h = png_size(p)
    runs, last = 0, False
    for o in png_alpha_columns(p):
        if o and not last: runs += 1
        last = o
    n = min((d for d in range(1, 25) if w % d == 0), key=lambda d: abs(d - runs))
    return n, w // n, h


def copy(src: Path, rel: str) -> str:
    if not src.exists():
        sys.exit(f"missing in the pack: {src.relative_to(PACK)}")
    dst = OUT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    return "/sprites/" + rel


def char4(src: str, rows: int) -> dict:
    """Pack layout: columns face down, up, left, right; rows 0-3 walk, row 4 attack (characters only)."""
    anims = {}
    for col, d in enumerate(["down", "up", "left", "right"]):
        anims["walk_" + d] = {"frames": [[col, r] for r in range(4)], "fps": 8}
        anims["idle_" + d] = {"frames": [[col, 0]], "fps": 1}
        if rows > 4:
            anims["attack_" + d] = {"frames": [[col, 4]], "fps": 1}
    return {"src": src, "fw": 16, "fh": 16, "anims": anims}


def monster_sheet(folder: Path) -> Path:
    for name in (folder.name + ".png", "SpriteSheet.png"):
        if (folder / name).exists():
            return folder / name
    pngs = [p for p in folder.glob("*.png") if p.name != "Faceset.png"]
    if not pngs:
        sys.exit(f"no sheet in {folder}")
    return pngs[0]


def strip_anim(path: Path, rel: str, fps: int) -> dict:
    n, fw, fh = strip_frames(path)
    return {"src": copy(path, rel), "fw": fw, "fh": fh, "frames": [[i, 0] for i in range(n)], "fps": fps}


def main() -> None:
    if not PACK.exists():
        sys.exit(f"Unzip the asset pack to {PACK} first")
    if OUT.exists():
        shutil.rmtree(OUT)
    actors: dict[str, dict] = {}
    faces: dict[str, str] = {}

    for topic, name in HUNTERS.items():
        folder = PACK / "Actor" / "Character" / name
        actors["hunter:" + topic] = char4(copy(folder / "SpriteSheet.png", f"hunters/{topic}.png"), 7)
        faces["hunter:" + topic] = copy(folder / "Faceset.png", f"faces/{topic}.png")
    you = PACK / "Actor" / "Character" / "Boy"
    actors["npc:you"] = char4(copy(you / "SpriteSheet.png", "npc/you.png"), 7)

    for z in MOBS:
        for i, (name, alt) in enumerate(zip(MOBS[z], MOBS_ALT[z])):
            for key, mob in ((f"mob:{z}:{i}", name), (f"mob:{z}:{i}:alt", alt)):
                folder = PACK / "Actor" / "Monster" / mob
                if not folder.exists():
                    continue
                actors[key] = char4(copy(monster_sheet(folder), f"mobs/{mob}.png"), 4)
                faces[key] = copy(folder / "Faceset.png", f"faces/mob-{mob}.png")

    for z, pair in BOSSES.items():
        for key, name in ((f"boss:{z}", pair[0]), (f"boss:{z}:alt", pair[1])):
            folder = PACK / "Actor" / "Boss" / name
            idle = next(p for p in (folder / "Idle.png", folder / "Idle40x40.png") if p.exists())
            anims = {"idle": strip_anim(idle, f"bosses/{name}-idle.png", 6)}
            if (folder / "Hit.png").exists():
                anims["hurt"] = strip_anim(folder / "Hit.png", f"bosses/{name}-hit.png", 10)
            first = anims["idle"]
            actors[key] = {"src": first["src"], "fw": first["fw"], "fh": first["fh"], "anims": anims}
            faces[key] = copy(folder / "Faceset.png", f"faces/boss-{name}.png")

    tiles = PACK / "Backgrounds" / "Tilesets"
    house = copy(tiles / "TilesetHouse.png", "town/house.png")
    nature = copy(tiles / "TilesetNature.png", "town/nature.png")
    floor = copy(tiles / "TilesetFloor.png", "town/floor.png")
    for k, (x, y, w, h) in BUILDINGS.items():
        actors["bld:" + k] = {"src": house, "fw": w, "fh": h, "anims": {"idle": {"frames": [[x, y, w, h]], "fps": 1}}}
    for k, (x, y, w, h) in PROPS.items():
        actors["prop:" + k] = {"src": nature, "fw": w, "fh": h, "anims": {"idle": {"frames": [[x, y, w, h]], "fps": 1}}}

    fx = PACK / "FX"
    for key, path, fps in (("fx:slash", fx / "Slash" / "SpriteSheetSlash01.png", 20), ("fx:smoke", fx / "Smoke" / "Smoke" / "SpriteSheet.png", 14),
                           ("fx:spark", fx / "Particle" / "Spark.png", 16)):
        a = strip_anim(path, f"fx/{path.parent.name}-{path.name}", fps)
        actors[key] = {"src": a["src"], "fw": a["fw"], "fh": a["fh"], "anims": {"idle": a}}
    coin = strip_anim(PACK / "Items" / "Treasure" / "Coin2.png", "fx/coin.png", 10)
    actors["fx:coin"] = {"src": coin["src"], "fw": coin["fw"], "fh": coin["fh"], "anims": {"idle": coin}}
    for k, n in EMOTES.items():
        src = copy(PACK / "Ui" / "Emote" / f"emote{n}.png", f"emote/{k}.png")
        actors["emote:" + k] = {"src": src, "fw": 14, "fh": 13, "anims": {"idle": {"frames": [[0, 0]], "fps": 1}}}

    manifest = {
        "credit": "Ninja Adventure asset pack by Pixel-boy and AAA, CC0 (https://pixel-boy.itch.io/ninja-adventure-asset-pack)",
        "ground": {k: {"src": floor, "rects": [[x, y, 16, 16] for x, y in v]} for k, v in GROUND.items()},
        "actors": actors,
        "faces": faces,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
    (OUT / "CREDITS.md").write_text(
        "# Sprite credits\n\nAll sprites in this folder come from the **Ninja Adventure** asset pack by Pixel-boy and AAA,\n"
        "released under CC0 1.0 (public domain): https://pixel-boy.itch.io/ninja-adventure-asset-pack\n\n"
        "Generated by `tools/build_sprites.py` from the pack in `assets/ninja-adventure/`.\n")
    size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"{len(actors)} actors, {len(faces)} faces, {size / 1024:.0f} KB in {OUT}")


if __name__ == "__main__":
    main()
