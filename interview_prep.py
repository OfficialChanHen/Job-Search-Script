"""
LeetCode / interview prep suggestions per job.

prep_for(title, company, topics=[], seed="") → {
    "coding": bool,           # does this role usually have a coding interview?
    "focus":  str,            # one-line summary of what the interview tests
    "problems": [(num, name, url), ...],
}

How problems are picked (so two jobs rarely get the same list):
  1. company-specific picks (commonly reported early-career loops), rotated
  2. topics the posting itself emphasizes (enrich.py detects them from the
     description — e.g. "logistics / routing" → graphs, "real-time" → heaps)
  3. the role category's topic plan (SWE, frontend JS, SQL for data roles…)
Each topic has a pool of problems; the job's seed rotates which one is used.
Company notes are "frequently reported", not guarantees — check LeetCode's
company tags / Glassdoor before a specific interview.
"""

import hashlib
import re

from job_rules import SWE_CATEGORIES, role_category

LC = "https://leetcode.com/problems/"

# topic → [(num, name, slug), ...]   (all free problems)
POOLS: dict[str, list[tuple[int, str, str]]] = {
    "hashing": [
        (1, "Two Sum", "two-sum"), (49, "Group Anagrams", "group-anagrams"),
        (128, "Longest Consecutive Sequence", "longest-consecutive-sequence"),
        (242, "Valid Anagram", "valid-anagram"), (347, "Top K Frequent Elements", "top-k-frequent-elements"),
        (217, "Contains Duplicate", "contains-duplicate"), (36, "Valid Sudoku", "valid-sudoku"),
        (560, "Subarray Sum Equals K", "subarray-sum-equals-k"),
        (438, "Find All Anagrams in a String", "find-all-anagrams-in-a-string"),
        (238, "Product of Array Except Self", "product-of-array-except-self"),
    ],
    "two_pointers": [
        (125, "Valid Palindrome", "valid-palindrome"), (15, "3Sum", "3sum"),
        (11, "Container With Most Water", "container-with-most-water"),
        (167, "Two Sum II - Input Array Is Sorted", "two-sum-ii-input-array-is-sorted"),
        (42, "Trapping Rain Water", "trapping-rain-water"), (283, "Move Zeroes", "move-zeroes"),
        (88, "Merge Sorted Array", "merge-sorted-array"), (680, "Valid Palindrome II", "valid-palindrome-ii"),
    ],
    "sliding_window": [
        (3, "Longest Substring Without Repeating Characters", "longest-substring-without-repeating-characters"),
        (121, "Best Time to Buy and Sell Stock", "best-time-to-buy-and-sell-stock"),
        (424, "Longest Repeating Character Replacement", "longest-repeating-character-replacement"),
        (567, "Permutation in String", "permutation-in-string"),
        (76, "Minimum Window Substring", "minimum-window-substring"),
        (239, "Sliding Window Maximum", "sliding-window-maximum"),
        (209, "Minimum Size Subarray Sum", "minimum-size-subarray-sum"),
    ],
    "stack": [
        (20, "Valid Parentheses", "valid-parentheses"), (155, "Min Stack", "min-stack"),
        (150, "Evaluate Reverse Polish Notation", "evaluate-reverse-polish-notation"),
        (739, "Daily Temperatures", "daily-temperatures"),
        (1249, "Minimum Remove to Make Valid Parentheses", "minimum-remove-to-make-valid-parentheses"),
        (394, "Decode String", "decode-string"),
        (84, "Largest Rectangle in Histogram", "largest-rectangle-in-histogram"),
        (227, "Basic Calculator II", "basic-calculator-ii"),
    ],
    "binary_search": [
        (704, "Binary Search", "binary-search"),
        (33, "Search in Rotated Sorted Array", "search-in-rotated-sorted-array"),
        (153, "Find Minimum in Rotated Sorted Array", "find-minimum-in-rotated-sorted-array"),
        (74, "Search a 2D Matrix", "search-a-2d-matrix"), (875, "Koko Eating Bananas", "koko-eating-bananas"),
        (34, "Find First and Last Position of Element in Sorted Array",
         "find-first-and-last-position-of-element-in-sorted-array"),
        (1011, "Capacity To Ship Packages Within D Days", "capacity-to-ship-packages-within-d-days"),
    ],
    "linked_list": [
        (206, "Reverse Linked List", "reverse-linked-list"), (21, "Merge Two Sorted Lists", "merge-two-sorted-lists"),
        (141, "Linked List Cycle", "linked-list-cycle"),
        (19, "Remove Nth Node From End of List", "remove-nth-node-from-end-of-list"),
        (143, "Reorder List", "reorder-list"), (2, "Add Two Numbers", "add-two-numbers"),
        (138, "Copy List with Random Pointer", "copy-list-with-random-pointer"),
        (23, "Merge k Sorted Lists", "merge-k-sorted-lists"),
    ],
    "trees": [
        (226, "Invert Binary Tree", "invert-binary-tree"), (104, "Maximum Depth of Binary Tree", "maximum-depth-of-binary-tree"),
        (102, "Binary Tree Level Order Traversal", "binary-tree-level-order-traversal"),
        (199, "Binary Tree Right Side View", "binary-tree-right-side-view"),
        (98, "Validate Binary Search Tree", "validate-binary-search-tree"),
        (230, "Kth Smallest Element in a BST", "kth-smallest-element-in-a-bst"),
        (236, "Lowest Common Ancestor of a Binary Tree", "lowest-common-ancestor-of-a-binary-tree"),
        (543, "Diameter of Binary Tree", "diameter-of-binary-tree"),
        (297, "Serialize and Deserialize Binary Tree", "serialize-and-deserialize-binary-tree"),
        (572, "Subtree of Another Tree", "subtree-of-another-tree"),
    ],
    "graphs": [
        (200, "Number of Islands", "number-of-islands"), (133, "Clone Graph", "clone-graph"),
        (207, "Course Schedule", "course-schedule"), (210, "Course Schedule II", "course-schedule-ii"),
        (994, "Rotting Oranges", "rotting-oranges"), (695, "Max Area of Island", "max-area-of-island"),
        (417, "Pacific Atlantic Water Flow", "pacific-atlantic-water-flow"), (127, "Word Ladder", "word-ladder"),
        (399, "Evaluate Division", "evaluate-division"), (721, "Accounts Merge", "accounts-merge"),
        (743, "Network Delay Time", "network-delay-time"),
        (1091, "Shortest Path in Binary Matrix", "shortest-path-in-binary-matrix"),
    ],
    "heap": [
        (215, "Kth Largest Element in an Array", "kth-largest-element-in-an-array"),
        (973, "K Closest Points to Origin", "k-closest-points-to-origin"),
        (295, "Find Median from Data Stream", "find-median-from-data-stream"),
        (621, "Task Scheduler", "task-scheduler"), (692, "Top K Frequent Words", "top-k-frequent-words"),
        (1046, "Last Stone Weight", "last-stone-weight"),
        (703, "Kth Largest Element in a Stream", "kth-largest-element-in-a-stream"),
    ],
    "intervals": [
        (56, "Merge Intervals", "merge-intervals"), (57, "Insert Interval", "insert-interval"),
        (435, "Non-overlapping Intervals", "non-overlapping-intervals"),
        (452, "Minimum Number of Arrows to Burst Balloons", "minimum-number-of-arrows-to-burst-balloons"),
        (986, "Interval List Intersections", "interval-list-intersections"), (1094, "Car Pooling", "car-pooling"),
    ],
    "dp": [
        (70, "Climbing Stairs", "climbing-stairs"), (198, "House Robber", "house-robber"),
        (322, "Coin Change", "coin-change"), (300, "Longest Increasing Subsequence", "longest-increasing-subsequence"),
        (139, "Word Break", "word-break"), (62, "Unique Paths", "unique-paths"),
        (1143, "Longest Common Subsequence", "longest-common-subsequence"),
        (53, "Maximum Subarray", "maximum-subarray"), (152, "Maximum Product Subarray", "maximum-product-subarray"),
        (91, "Decode Ways", "decode-ways"),
    ],
    "backtracking": [
        (78, "Subsets", "subsets"), (46, "Permutations", "permutations"), (39, "Combination Sum", "combination-sum"),
        (79, "Word Search", "word-search"),
        (17, "Letter Combinations of a Phone Number", "letter-combinations-of-a-phone-number"),
        (22, "Generate Parentheses", "generate-parentheses"), (131, "Palindrome Partitioning", "palindrome-partitioning"),
    ],
    "strings": [
        (208, "Implement Trie (Prefix Tree)", "implement-trie-prefix-tree"),
        (211, "Design Add and Search Words Data Structure", "design-add-and-search-words-data-structure"),
        (1268, "Search Suggestions System", "search-suggestions-system"),
        (14, "Longest Common Prefix", "longest-common-prefix"),
        (5, "Longest Palindromic Substring", "longest-palindromic-substring"),
        (13, "Roman to Integer", "roman-to-integer"), (68, "Text Justification", "text-justification"),
        (151, "Reverse Words in a String", "reverse-words-in-a-string"),
    ],
    "design": [
        (146, "LRU Cache", "lru-cache"), (981, "Time Based Key-Value Store", "time-based-key-value-store"),
        (380, "Insert Delete GetRandom O(1)", "insert-delete-getrandom-o1"), (1146, "Snapshot Array", "snapshot-array"),
        (706, "Design HashMap", "design-hashmap"), (622, "Design Circular Queue", "design-circular-queue"),
        (1396, "Design Underground System", "design-underground-system"), (355, "Design Twitter", "design-twitter"),
        (460, "LFU Cache", "lfu-cache"), (1603, "Design Parking System", "design-parking-system"),
    ],
    "matrix": [
        (48, "Rotate Image", "rotate-image"), (54, "Spiral Matrix", "spiral-matrix"),
        (73, "Set Matrix Zeroes", "set-matrix-zeroes"), (289, "Game of Life", "game-of-life"),
        (329, "Longest Increasing Path in a Matrix", "longest-increasing-path-in-a-matrix"),
    ],
    "math": [
        (136, "Single Number", "single-number"), (191, "Number of 1 Bits", "number-of-1-bits"),
        (268, "Missing Number", "missing-number"), (50, "Pow(x, n)", "powx-n"), (202, "Happy Number", "happy-number"),
        (528, "Random Pick with Weight", "random-pick-with-weight"),
    ],
    "parsing": [
        (937, "Reorder Data in Log Files", "reorder-data-in-log-files"),
        (811, "Subdomain Visit Count", "subdomain-visit-count"),
        (609, "Find Duplicate File in System", "find-duplicate-file-in-system"),
        (71, "Simplify Path", "simplify-path"), (468, "Validate IP Address", "validate-ip-address"),
        (8, "String to Integer (atoi)", "string-to-integer-atoi"), (722, "Remove Comments", "remove-comments"),
    ],
    "js": [
        (2627, "Debounce (JS)", "debounce"), (2623, "Memoize (JS)", "memoize"),
        (2625, "Flatten Deeply Nested Array (JS)", "flatten-deeply-nested-array"),
        (2694, "Event Emitter (JS)", "event-emitter"),
        (2721, "Execute Asynchronous Functions in Parallel (JS)", "execute-asynchronous-functions-in-parallel"),
        (2622, "Cache With Time Limit (JS)", "cache-with-time-limit"), (2637, "Promise Time Limit (JS)", "promise-time-limit"),
        (2715, "Timeout Cancellation (JS)", "timeout-cancellation"), (2631, "Group By (JS)", "group-by"),
        (2677, "Chunk Array (JS)", "chunk-array"), (2705, "Compact Object (JS)", "compact-object"),
        (2629, "Function Composition (JS)", "function-composition"),
    ],
    "sql": [
        (175, "Combine Two Tables (SQL)", "combine-two-tables"), (176, "Second Highest Salary (SQL)", "second-highest-salary"),
        (177, "Nth Highest Salary (SQL)", "nth-highest-salary"), (178, "Rank Scores (SQL)", "rank-scores"),
        (180, "Consecutive Numbers (SQL)", "consecutive-numbers"),
        (181, "Employees Earning More Than Their Managers (SQL)", "employees-earning-more-than-their-managers"),
        (183, "Customers Who Never Order (SQL)", "customers-who-never-order"),
        (184, "Department Highest Salary (SQL)", "department-highest-salary"),
        (185, "Department Top Three Salaries (SQL)", "department-top-three-salaries"),
        (197, "Rising Temperature (SQL)", "rising-temperature"), (550, "Game Play Analysis IV (SQL)", "game-play-analysis-iv"),
        (570, "Managers with at Least 5 Direct Reports (SQL)", "managers-with-at-least-5-direct-reports"),
        (585, "Investments in 2016 (SQL)", "investments-in-2016"), (626, "Exchange Seats (SQL)", "exchange-seats"),
        (1164, "Product Price at a Given Date (SQL)", "product-price-at-a-given-date"),
        (1174, "Immediate Food Delivery II (SQL)", "immediate-food-delivery-ii"),
        (1193, "Monthly Transactions I (SQL)", "monthly-transactions-i"),
        (1321, "Restaurant Growth (SQL window)", "restaurant-growth"), (1341, "Movie Rating (SQL)", "movie-rating"),
        (1934, "Confirmation Rate (SQL)", "confirmation-rate"), (1907, "Count Salary Categories (SQL)", "count-salary-categories"),
    ],
    "pandas": [
        (2880, "Select Data (Pandas)", "select-data"), (2882, "Drop Duplicate Rows (Pandas)", "drop-duplicate-rows"),
        (2883, "Drop Missing Data (Pandas)", "drop-missing-data"), (2889, "Reshape Data: Pivot (Pandas)", "reshape-data-pivot"),
        (2890, "Reshape Data: Melt (Pandas)", "reshape-data-melt"), (2887, "Fill Missing Data (Pandas)", "fill-missing-data"),
    ],
}

TOPIC_LABEL = {
    "hashing": "hash maps", "two_pointers": "two pointers", "sliding_window": "sliding window",
    "stack": "stacks", "binary_search": "binary search", "linked_list": "linked lists", "trees": "trees",
    "graphs": "graphs/BFS", "heap": "heaps", "intervals": "intervals", "dp": "dynamic programming",
    "backtracking": "backtracking", "strings": "strings/tries", "design": "design-a-class",
    "matrix": "grids/matrices", "math": "math/bits", "parsing": "parsing/text processing",
    "js": "JavaScript", "sql": "SQL", "pandas": "pandas",
}

# Posting keywords → topics worth emphasizing (enrich.py stores the matches)
TOPIC_HINTS: list[tuple[str, re.Pattern]] = [
    ("graphs",   re.compile(r"graph|network|routing|route optim|logistic|supply chain|dependenc|social|topolog|maps?\b|geospatial", re.I)),
    ("heap",     re.compile(r"real[- ]time|streaming|priority|schedul|ranking|recommend|top[- ]k|leaderboard", re.I)),
    ("strings",  re.compile(r"\bsearch\b|autocomplete|\bnlp\b|natural language|document|text\b|\bllm", re.I)),
    ("dp",       re.compile(r"optimi[sz]|pricing|forecast|trading|quantitative|probabilit|portfolio", re.I)),
    ("intervals", re.compile(r"calendar|scheduling|booking|reservation|time[- ]series|shift|appointment", re.I)),
    ("design",   re.compile(r"distributed|caching|\bcache|scalab|microservice|high[- ]throughput|low[- ]latency|system design|api design", re.I)),
    ("sql",      re.compile(r"\bsql\b|database|data warehouse|\betl\b|postgres|snowflake|bigquery|redshift", re.I)),
    ("js",       re.compile(r"react|javascript|typescript|front[- ]?end|\bui\b|browser|next\.js|vue|angular", re.I)),
    ("matrix",   re.compile(r"image|computer vision|pixel|\bgrid\b|game dev|robot|simulation", re.I)),
    ("trees",    re.compile(r"hierarch|\btrees?\b|\bdom\b|file system|org chart|\bjson\b|\bxml\b", re.I)),
    ("parsing",  re.compile(r"\blogs?\b|logging|pars(e|ing)|config|\bcli\b|scripting|automation|linux|bash", re.I)),
    ("linked_list", re.compile(r"embedded|firmware|low[- ]level|\bc\+\+|\bc\b|kernel|memory management", re.I)),
    ("pandas",   re.compile(r"pandas|dataframe|jupyter|numpy", re.I)),
]


def detect_topics(text: str, limit: int = 3) -> list[str]:
    """Topics a posting emphasizes, most-mentioned first."""
    counts = [(len(rx.findall(text or "")), t) for t, rx in TOPIC_HINTS]
    return [t for n, t in sorted(counts, key=lambda x: -x[0]) if n][:limit]


# category → (coding interview?, focus, topic plan in priority order)
CATEGORY_PREP: dict[str, tuple[bool, str, list[str]]] = {
    "swe": (True, "LeetCode easy–medium: arrays/hashing, two pointers, BFS/DFS, intervals, one design-a-class problem",
            ["hashing", "sliding_window", "graphs", "trees", "two_pointers", "stack", "intervals", "dp",
             "design", "heap", "binary_search", "linked_list", "backtracking"]),
    "frontend": (True, "JS fundamentals (closures, async, DOM) + LeetCode easy–medium; often a build-a-component round in React",
                 ["js", "js", "js", "hashing", "stack", "strings", "trees", "sliding_window"]),
    "mobile": (True, "LeetCode easy–medium + app architecture (state, lists, offline caching); React Native fits your stack",
               ["hashing", "stack", "trees", "design", "intervals", "strings", "graphs"]),
    "ml_ai": (True, "LeetCode medium (heaps, graphs) + ML fundamentals; may ask to code k-means / softmax / an eval loop in Python",
              ["heap", "hashing", "graphs", "matrix", "dp", "design", "binary_search"]),
    "data_eng": (True, "SQL (joins, window functions) + Python LeetCode easy–medium; pipeline/ETL design questions",
                 ["sql", "sql", "sql", "hashing", "intervals", "heap", "design"]),
    "data_analyst": (True, "SQL screen (joins, GROUP BY, window functions) + a pandas/Excel case — LeetCode SQL 50 is the right study plan",
                     ["sql", "sql", "sql", "sql", "pandas", "sql"]),
    "qa": (True, "LeetCode easy (strings/arrays) + writing test cases for your own code; Selenium/Playwright basics",
           ["strings", "two_pointers", "hashing", "stack", "math", "matrix"]),
    "devops": (True, "Scripting + LeetCode easy–medium (parsing logs, hash maps); Linux/networking/cloud fundamentals",
               ["parsing", "parsing", "hashing", "design", "graphs", "heap"]),
    "solutions": (True, "Practical coding over pure algorithms: call an API, parse/transform JSON, debug; plus a customer case round",
                  ["parsing", "hashing", "design", "strings", "intervals", "sql"]),
    "platform_dev": (True, "Light coding (Apex/JS/SQL) + platform scenarios; LeetCode easy is enough",
                     ["hashing", "strings", "sql", "stack", "sql"]),
    "ai_training": (True, "Paid screening assessment: solve + critique code (Python/JS) and explain your reasoning clearly",
                    ["hashing", "strings", "dp", "trees", "graphs", "sliding_window"]),
    "analyst": (False, "Usually no LeetCode — SQL and requirements/process questions; brush up on SQL just in case",
                ["sql", "sql", "sql"]),
    "it_support": (False, "No LeetCode — troubleshooting scenarios (networking, AD, tickets) and customer-service behavioral questions",
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
     [399, 329, 42, 1143, 239, 200]),
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

BY_NUM: dict[int, tuple[str, str]] = {n: (name, slug) for pool in POOLS.values() for n, name, slug in pool}
MAX_PROBLEMS = 6


def _seed(s: str) -> int:
    return int(hashlib.md5((s or "").encode()).hexdigest()[:8], 16)


def prep_for(title: str, company: str = "", topics: list[str] | None = None, seed: str = "") -> dict:
    cat = role_category(title) or "swe"
    coding, focus, plan = CATEGORY_PREP.get(cat, CATEGORY_PREP["swe"])
    rot = _seed(seed or f"{title}|{company}")
    picks: list[int] = []

    for rx, note, extra in COMPANY_PREP:
        if company and rx.search(company):
            if coding:
                focus = f"{note}. {focus}"
                # company algorithm picks only fit algorithm-style roles;
                # analysts/solutions keep their own (SQL / practical) lists
                if cat in SWE_CATEGORIES:
                    start = rot % len(extra)
                    picks.extend((extra[start:] + extra[:start])[:2])
            break

    # Posting-emphasized topics first (only ones that make sense for the role),
    # then the category plan starting at a job-specific offset.
    hinted = [t for t in (topics or []) if t in POOLS and (cat in SWE_CATEGORIES or t in plan)]
    if plan:
        k = rot % len(plan)
        rotated = plan[k:] + plan[:k] if cat in ("swe", "mobile", "ml_ai", "qa", "ai_training") else plan
    else:
        rotated = []
    slots = hinted[:2] + rotated
    limit = MAX_PROBLEMS if coding else 3

    used_per_topic: dict[str, int] = {}
    for i, topic in enumerate(slots):
        if len(picks) >= limit:
            break
        pool = POOLS[topic]
        j = used_per_topic.get(topic, 0)
        for step in range(len(pool)):
            n = pool[(rot // 7 + j + step * 3 + i) % len(pool)][0]
            if n not in picks:
                picks.append(n)
                break
        used_per_topic[topic] = j + 1

    if hinted and coding:
        focus += ". This posting mentions work that leans on " + " & ".join(TOPIC_LABEL[t] for t in hinted[:2])

    return {
        "coding": coding,
        "focus": focus,
        "problems": [(n, BY_NUM[n][0], LC + BY_NUM[n][1] + "/") for n in picks if n in BY_NUM],
    }


def prep_text(prep: dict) -> str:
    """One Google Sheet cell: the interview focus, then one bullet per problem."""
    if not prep["problems"]:
        return prep["focus"]
    bullets = "\n".join(f"• #{n} {name}" for n, name, _ in prep["problems"])
    return f"{prep['focus']}\n{bullets}"
