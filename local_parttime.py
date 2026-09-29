"""
local_parttime.py — part-time jobs near Shakopee, MN at tech-related employers.

The job itself doesn't have to be tech (Best Buy sales associate, Apple Store
Specialist, carrier-store rep, Micro Center, Amazon, Seagate…). These rows are
kept apart from the SWE list: CSV type "parttime", their own dashboard tab,
no seniority / years-of-experience rules.

Distance isn't a hard cutoff — each job gets a commute estimate from
Shakopee and, when the posting shows pay, an *effective hourly* rate:

    (pay × shift hours − driving cost) ÷ (shift hours + round-trip drive time)

so a farther job that pays more can still come out ahead.
"""

import math
import re

# ── where you'd be driving from, and what a mile costs ──────────────────────
HOME = ("Shakopee", 44.7980, -93.5269)
COST_PER_MILE = 0.22      # gas (~$3.10/gal at ~25 mpg ≈ $0.12) + tires/maintenance (~$0.10)
SHIFT_HOURS = 4           # a typical part-time shift
AVG_MPH = 38              # metro driving, highways + streets
ROAD_FACTOR = 1.25        # straight-line → road miles
MAX_MILES = 45            # past this, driving rarely pays off for part-time work
WORTH_IT_HOURLY = 13.0    # effective $/hr (after driving) we call "worth it"

# Tech-related employers (the role can be anything) — name patterns
TECH_EMPLOYERS = re.compile(
    r"best buy|geek squad|\bapple\b(?! autos)|micro ?center|microsoft|samsung|google|amazon|whole foods|"
    r"verizon|t-mobile|metro by t-mobile|at&t|\batt\b|xfinity|comcast|cricket wireless|us cellular|boost mobile|"
    r"spectrum|gamestop|ubreakifix|asurion|batteries plus|staples|dell\b|\bhp\b|hewlett|lenovo|"
    r"seagate|emerson|shutterfly|digi international|jamf|target tech|code ninjas|id tech|thecoderschool|"
    r"mathnasium|kumon|sylvan|best buy health|apple retail", re.I)
# …or a tech-flavoured part-time role at any employer
TECH_ROLES = re.compile(
    r"\bit\b|tech(nology|nical)?\b|computer|electronics|repair technician|help ?desk|support specialist|"
    r"genius|creative|expert|coding|programming|robotics|stem|data entry|web|software|digital", re.I)

LINKEDIN_QUERIES = [
    "Best Buy", "Apple", "Micro Center", "Verizon", "T-Mobile", "AT&T", "Xfinity", "GameStop",
    "Amazon", "Seagate", "Geek Squad", "uBreakiFix", "Code Ninjas", "Samsung",
    "technology sales", "electronics", "computer repair", "IT support", "tech support",
]

# Approximate centers of Twin Cities–area towns (lat, lon)
CITIES = {
    "shakopee": (44.798, -93.527), "prior lake": (44.713, -93.423), "savage": (44.779, -93.337),
    "chaska": (44.789, -93.602), "chanhassen": (44.862, -93.531), "eden prairie": (44.855, -93.471),
    "jordan": (44.667, -93.627), "burnsville": (44.768, -93.278), "bloomington": (44.841, -93.298),
    "minnetonka": (44.921, -93.468), "lakeville": (44.650, -93.243), "apple valley": (44.732, -93.218),
    "edina": (44.890, -93.350), "richfield": (44.883, -93.283), "hopkins": (44.925, -93.405),
    "st louis park": (44.948, -93.348), "saint louis park": (44.948, -93.348), "eagan": (44.804, -93.167),
    "minneapolis": (44.978, -93.265), "st paul": (44.954, -93.090), "saint paul": (44.954, -93.090),
    "plymouth": (45.010, -93.456), "maple grove": (45.073, -93.456), "wayzata": (44.974, -93.507),
    "waconia": (44.851, -93.787), "victoria": (44.859, -93.662), "excelsior": (44.903, -93.566),
    "golden valley": (45.010, -93.349), "brooklyn park": (45.094, -93.356), "brooklyn center": (45.076, -93.333),
    "roseville": (45.006, -93.157), "maplewood": (44.953, -92.995), "woodbury": (44.924, -92.959),
    "inver grove heights": (44.848, -93.043), "west st paul": (44.916, -93.101), "west saint paul": (44.916, -93.101),
    "mendota heights": (44.883, -93.138), "rosemount": (44.739, -93.126), "farmington": (44.640, -93.144),
    "northfield": (44.458, -93.162), "new prague": (44.543, -93.576), "belle plaine": (44.623, -93.768),
    "coon rapids": (45.120, -93.288), "blaine": (45.161, -93.235), "fridley": (45.086, -93.263),
    "new hope": (45.038, -93.386), "crystal": (45.033, -93.360), "robbinsdale": (45.032, -93.338),
    "osseo": (45.119, -93.402), "champlin": (45.189, -93.397), "arden hills": (45.050, -93.156),
    "shoreview": (45.079, -93.147), "mounds view": (45.105, -93.208), "new brighton": (45.066, -93.202),
    "oakdale": (44.963, -92.965), "cottage grove": (44.828, -92.944), "stillwater": (45.056, -92.806),
    "hastings": (44.744, -92.852), "st anthony": (45.020, -93.218), "medina": (45.035, -93.582),
    "orono": (44.971, -93.604), "mound": (44.937, -93.666), "elk river": (45.304, -93.567),
    "anoka": (45.198, -93.387), "andover": (45.233, -93.291), "lino lakes": (45.160, -93.089),
    "white bear lake": (45.085, -93.010), "hudson": (44.975, -92.757), "mankato": (44.164, -93.999),
    "st cloud": (45.557, -94.163), "saint cloud": (45.557, -94.163), "rochester": (44.012, -92.480),
    "owatonna": (44.084, -93.226), "faribault": (44.295, -93.269), "le sueur": (44.461, -93.915),
    "glencoe": (44.769, -94.152), "hutchinson": (44.888, -94.370), "buffalo": (45.172, -93.875),
    "monticello": (45.306, -93.794), "rogers": (45.189, -93.553), "st michael": (45.210, -93.665),
    "mall of america": (44.855, -93.242),
}
METRO_WORDS = re.compile(r"minneapolis|st\.? paul|saint paul|twin cities", re.I)


def _haversine(a, b) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(d))


def drive_miles(location: str) -> float | None:
    """One-way road miles from Shakopee (None if the town isn't recognized)."""
    loc = re.sub(r"\.", "", (location or "").lower())
    loc = re.sub(r"\bsaint\b", "st", loc)
    best = None
    for city, ll in CITIES.items():
        c = re.sub(r"\bsaint\b", "st", city)
        if re.search(rf"\b{re.escape(c)}\b", loc):
            miles = _haversine(HOME[1:], ll) * ROAD_FACTOR
            best = miles if best is None else min(best, miles)
    if best is None and METRO_WORDS.search(loc):
        best = 25.0             # "Minneapolis–St. Paul area" — assume a mid-metro drive
    return round(best, 1) if best is not None else None


def hourly_from_pay(pay: str) -> float | None:
    """'$18.50 - $22.00 per hour' → 18.5 (the low end); '$45,000/yr' → 21.6."""
    nums = [float(n.replace(",", "")) for n in re.findall(r"\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)", pay or "")]
    if not nums:
        return None
    low = min(nums)
    if re.search(r"\bk\b|\d[kK]", pay):
        low *= 1000
    if low > 1000:              # annual → hourly
        low /= 2080
    return round(low, 2) if 7 <= low <= 150 else None


def commute(location: str, pay: str = "") -> dict:
    """Commute + pay math for one job (all numbers rounded for display)."""
    miles = drive_miles(location)
    out: dict = {}
    if miles is None:
        return out
    rt_miles = 2 * miles
    cost = rt_miles * COST_PER_MILE
    drive_hrs = rt_miles / AVG_MPH
    out.update({"mi": miles, "cost": round(cost, 2), "min": round(drive_hrs * 60)})
    hourly = hourly_from_pay(pay)
    if hourly:
        eff = (hourly * SHIFT_HOURS - cost) / (SHIFT_HOURS + drive_hrs)
        out.update({"pay": hourly, "eff": round(eff, 2), "ok": eff >= WORTH_IT_HOURLY})
    return out


def is_tech_related(company: str, title: str) -> bool:
    return bool(TECH_EMPLOYERS.search(company or "") or TECH_ROLES.search(title or ""))


def worth_listing(location: str, pay: str = "") -> bool:
    """Keep if the drive is plausible, and — when pay is known — the job still
    clears the effective-hourly bar after driving."""
    c = commute(location, pay)
    if not c:
        return bool(METRO_WORDS.search(location or "")) or "mn" in (location or "").lower()
    if c["mi"] > MAX_MILES:
        return False
    return c.get("eff", WORTH_IT_HOURLY) >= WORTH_IT_HOURLY * 0.85   # a little slack; the tab shows the math
