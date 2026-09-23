"""
LeetCode / interview prep suggestions per job.

prep_for(title, company) → {
    "coding": bool,           # does this role usually have a coding interview?
    "focus":  str,            # one-line summary of what the interview tests
    "problems": [(num, name, url), ...],
}

Problem picks = company-specific (commonly reported for that company's early-
career loops) first, then the role category's core list. Company notes are
"frequently reported", not guarantees — verify on LeetCode's company tags /
Glassdoor before a specific interview.
"""

import re

from job_rules import SWE_CATEGORIES, role_category

LC = "https://leetcode.com/problems/"

# num → (name, slug)
P: dict[int, tuple[str, str]] = {
    1: ("Two Sum", "two-sum"),
    3: ("Longest Substring Without Repeating Characters",
        "longest-substring-without-repeating-characters"),
    11: ("Container With Most Water", "container-with-most-water"),
    13: ("Roman to Integer", "roman-to-integer"),
    14: ("Longest Common Prefix", "longest-common-prefix"),
    15: ("3Sum", "3sum"),
    20: ("Valid Parentheses", "valid-parentheses"),
    42: ("Trapping Rain Water", "trapping-rain-water"),
    48: ("Rotate Image", "rotate-image"),
    49: ("Group Anagrams", "group-anagrams"),
    53: ("Maximum Subarray", "maximum-subarray"),
    54: ("Spiral Matrix", "spiral-matrix"),
    56: ("Merge Intervals", "merge-intervals"),
    70: ("Climbing Stairs", "climbing-stairs"),
    71: ("Simplify Path", "simplify-path"),
    102: ("Binary Tree Level Order Traversal", "binary-tree-level-order-traversal"),
    121: ("Best Time to Buy and Sell Stock", "best-time-to-buy-and-sell-stock"),
    125: ("Valid Palindrome", "valid-palindrome"),
    128: ("Longest Consecutive Sequence", "longest-consecutive-sequence"),
    133: ("Clone Graph", "clone-graph"),
    138: ("Copy List with Random Pointer", "copy-list-with-random-pointer"),
    146: ("LRU Cache", "lru-cache"),
    155: ("Min Stack", "min-stack"),
    176: ("Second Highest Salary (SQL)", "second-highest-salary"),
    178: ("Rank Scores (SQL)", "rank-scores"),
    180: ("Consecutive Numbers (SQL)", "consecutive-numbers"),
    184: ("Department Highest Salary (SQL)", "department-highest-salary"),
    185: ("Department Top Three Salaries (SQL)", "department-top-three-salaries"),
    197: ("Rising Temperature (SQL)", "rising-temperature"),
    199: ("Binary Tree Right Side View", "binary-tree-right-side-view"),
    200: ("Number of Islands", "number-of-islands"),
    206: ("Reverse Linked List", "reverse-linked-list"),
    207: ("Course Schedule", "course-schedule"),
    215: ("Kth Largest Element in an Array", "kth-largest-element-in-an-array"),
    236: ("Lowest Common Ancestor of a Binary Tree",
          "lowest-common-ancestor-of-a-binary-tree"),
    238: ("Product of Array Except Self", "product-of-array-except-self"),
    239: ("Sliding Window Maximum", "sliding-window-maximum"),
    242: ("Valid Anagram", "valid-anagram"),
    283: ("Move Zeroes", "move-zeroes"),
    295: ("Find Median from Data Stream", "find-median-from-data-stream"),
    322: ("Coin Change", "coin-change"),
    329: ("Longest Increasing Path in a Matrix", "longest-increasing-path-in-a-matrix"),
    347: ("Top K Frequent Elements", "top-k-frequent-elements"),
    355: ("Design Twitter", "design-twitter"),
    380: ("Insert Delete GetRandom O(1)", "insert-delete-getrandom-o1"),
    399: ("Evaluate Division", "evaluate-division"),
    435: ("Non-overlapping Intervals", "non-overlapping-intervals"),
    460: ("LFU Cache", "lfu-cache"),
    528: ("Random Pick with Weight", "random-pick-with-weight"),
    550: ("Game Play Analysis IV (SQL)", "game-play-analysis-iv"),
    560: ("Subarray Sum Equals K", "subarray-sum-equals-k"),
    570: ("Managers with at Least 5 Direct Reports (SQL)",
          "managers-with-at-least-5-direct-reports"),
    609: ("Find Duplicate File in System", "find-duplicate-file-in-system"),
    622: ("Design Circular Queue", "design-circular-queue"),
    680: ("Valid Palindrome II", "valid-palindrome-ii"),
    692: ("Top K Frequent Words", "top-k-frequent-words"),
    704: ("Binary Search", "binary-search"),
    706: ("Design HashMap", "design-hashmap"),
    721: ("Accounts Merge", "accounts-merge"),
    811: ("Subdomain Visit Count", "subdomain-visit-count"),
    937: ("Reorder Data in Log Files", "reorder-data-in-log-files"),
    973: ("K Closest Points to Origin", "k-closest-points-to-origin"),
    981: ("Time Based Key-Value Store", "time-based-key-value-store"),
    994: ("Rotting Oranges", "rotting-oranges"),
    1048: ("Longest String Chain", "longest-string-chain"),
    1146: ("Snapshot Array", "snapshot-array"),
    1164: ("Product Price at a Given Date (SQL)", "product-price-at-a-given-date"),
    1249: ("Minimum Remove to Make Valid Parentheses",
           "minimum-remove-to-make-valid-parentheses"),
    1321: ("Restaurant Growth (SQL window)", "restaurant-growth"),
    1396: ("Design Underground System", "design-underground-system"),
    1757: ("Recyclable and Low Fat Products (SQL)", "recyclable-and-low-fat-products"),
    2622: ("Cache With Time Limit (JS)", "cache-with-time-limit"),
    2625: ("Flatten Deeply Nested Array (JS)", "flatten-deeply-nested-array"),
    2627: ("Debounce (JS)", "debounce"),
    2694: ("Event Emitter (JS)", "event-emitter"),
    2721: ("Execute Asynchronous Functions in Parallel (JS)",
           "execute-asynchronous-functions-in-parallel"),
}

# category → (coding interview?, focus note, core problem list in priority order)
CATEGORY_PREP: dict[str, tuple[bool, str, list[int]]] = {
    "swe": (True,
        "LeetCode easy–medium: arrays/hashing, two pointers, BFS/DFS, intervals, one design-a-class problem",
        [1, 49, 347, 3, 200, 56, 146, 238, 20, 207, 102, 322]),
    "frontend": (True,
        "JS fundamentals (closures, async, DOM) + LeetCode easy–medium; often a build-a-component round in React",
        [2627, 2721, 2625, 2694, 1, 20, 49, 56, 3, 2622]),
    "mobile": (True,
        "LeetCode easy–medium + app architecture (state, lists, offline caching); React Native fits your stack",
        [1, 20, 49, 146, 200, 56, 238, 206]),
    "ml_ai": (True,
        "LeetCode medium (heaps, graphs) + ML fundamentals; may ask to code k-means / softmax / an eval loop in Python",
        [347, 215, 973, 200, 146, 56, 295, 1]),
    "data_eng": (True,
        "SQL (joins, window functions) + Python LeetCode easy–medium; pipeline/ETL design questions",
        [185, 180, 1321, 550, 176, 347, 49, 56]),
    "data_analyst": (True,
        "SQL screen (joins, GROUP BY, window functions) + a pandas/Excel case — LeetCode SQL 50 is the right study plan",
        [176, 184, 185, 180, 197, 1321, 570, 1164, 178, 1757]),
    "qa": (True,
        "LeetCode easy (strings/arrays) + writing test cases for your own code; Selenium/Playwright basics",
        [20, 125, 242, 13, 14, 283, 1, 49]),
    "devops": (True,
        "Scripting + LeetCode easy–medium (parsing logs, hash maps); Linux/networking/cloud fundamentals",
        [937, 811, 609, 71, 146, 981, 1, 347]),
    "solutions": (True,
        "Practical coding over pure algorithms: call an API, parse/transform JSON, debug; plus a customer case round",
        [811, 937, 71, 1, 49, 981, 20, 56]),
    "platform_dev": (True,
        "Light coding (Apex/JS/SQL) + platform scenarios; LeetCode easy is enough",
        [1, 20, 242, 49, 176, 184]),
    "ai_training": (True,
        "Paid screening assessment: solve + critique code (Python/JS) and explain your reasoning clearly",
        [1, 20, 49, 3, 56, 200]),
    "analyst": (False,
        "Usually no LeetCode — SQL and requirements/process questions; brush up on SQL just in case",
        [176, 184, 1757, 197]),
    "it_support": (False,
        "No LeetCode — troubleshooting scenarios (networking, AD, tickets) and customer-service behavioral questions",
        []),
}

# (company regex, note, company-specific problems) — commonly reported early-career loops
COMPANY_PREP: list[tuple[re.Pattern, str, list[int]]] = [
    (re.compile(r"\bmeta\b|facebook", re.I),
     "Meta: 2 mediums in 45 min, speed matters",
     [1249, 680, 199, 560, 236, 973, 528]),
    (re.compile(r"amazon|\baws\b", re.I),
     "Amazon: OA with 2 LeetCode mediums + Leadership Principles stories (STAR)",
     [200, 146, 937, 692, 994, 138, 973]),
    (re.compile(r"google|alphabet|waymo", re.I),
     "Google: graphs, DP, and clean code under follow-ups",
     [399, 329, 42, 1048, 239, 200]),
    (re.compile(r"microsoft|linkedin|github", re.I),
     "Microsoft: linked lists, trees, strings; mostly mediums",
     [206, 236, 54, 53, 138, 146]),
    (re.compile(r"capital one", re.I),
     "Capital One: CodeSignal General Coding Assessment (4 problems / 70 min) + case interview",
     [48, 54, 128, 3, 49, 238]),
    (re.compile(r"bloomberg", re.I),
     "Bloomberg: design-a-data-structure mediums",
     [146, 380, 155, 1396, 20, 200]),
    (re.compile(r"stripe", re.I),
     "Stripe: practical 'integration'/bug-bash rounds — parsing & transforming data, not tricky algorithms",
     [399, 981, 811, 937]),
    (re.compile(r"databricks|snowflake", re.I),
     "Databricks/Snowflake: harder mediums, design-a-store problems, concurrency",
     [981, 1146, 146, 460, 295]),
    (re.compile(r"openai|anthropic|cursor|anysphere|cognition|perplexity|harvey|sierra|decagon|scale ?ai", re.I),
     "AI labs/startups: progressive practical builds (in-memory DB/KV store with transactions, rate limiter, parser)",
     [981, 1146, 146, 460, 706, 355]),
    (re.compile(r"palantir", re.I),
     "Palantir: decomposition + debugging + LeetCode medium; FDE loops add a customer case",
     [200, 207, 56, 146, 721]),
    (re.compile(r"jane street|hudson river|\bhrt\b|imc|optiver|citadel|two sigma|jump trading|akuna|tower research|virtu", re.I),
     "Quant/trading: fast, correct mediums + probability/mental math",
     [295, 239, 560, 146, 42]),
    (re.compile(r"uber|lyft|doordash|instacart", re.I),
     "Marketplace cos: mediums with a practical twist (dispatch, intervals, grids)",
     [56, 435, 994, 200, 973, 1396]),
    (re.compile(r"target|best buy|optum|unitedhealth|u\.?s\.? bank|wells fargo|medtronic|\b3m\b|general mills|"
                r"thomson reuters|c\.?h\.? robinson|ameriprise|securian|xcel|ecolab|polaris|land o|"
                r"blue cross|travelers|ibm|deloitte|accenture|infosys|capgemini", re.I),
     "Enterprise: HackerRank OA with LeetCode easy–medium + behavioral; SQL often shows up",
     [1, 20, 121, 242, 49, 3, 176]),
    (re.compile(r"epic\b|epic systems", re.I),
     "Epic: in-house aptitude + coding test, then onsite in Verona",
     [1, 20, 13, 14, 56]),
]

MAX_PROBLEMS = 6


def prep_for(title: str, company: str = "") -> dict:
    cat = role_category(title) or "swe"
    coding, focus, core = CATEGORY_PREP.get(cat, CATEGORY_PREP["swe"])

    picks: list[int] = []
    for rx, note, extra in COMPANY_PREP:
        if company and rx.search(company):
            if coding:
                focus = f"{note}. {focus}"
                # company algorithm picks only fit algorithm-style roles;
                # analysts/solutions keep their own (SQL / practical) lists
                if cat in SWE_CATEGORIES:
                    picks.extend(extra[:3])
            break
    for n in core:
        if n not in picks:
            picks.append(n)
    picks = picks[:MAX_PROBLEMS] if coding else picks[:4]

    return {
        "coding": coding,
        "focus": focus,
        "problems": [(n, P[n][0], LC + P[n][1] + "/") for n in picks if n in P],
    }


def prep_text(prep: dict) -> str:
    """One Google Sheet cell: the interview focus, then one bullet per problem."""
    if not prep["problems"]:
        return prep["focus"]
    bullets = "\n".join(f"• #{n} {name}" for n, name, _ in prep["problems"])
    return f"{prep['focus']}\n{bullets}"
