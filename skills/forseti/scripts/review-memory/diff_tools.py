import re
from collections import namedtuple

DiffLine = namedtuple("DiffLine", "old new kind text")

CONTEXT_RADIUS = 5
ANCHOR_RADIUS = 10
MIN_ANCHOR_CHARS = 4
_HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")
_MARKER = {"+": "+", "-": "-", "=": " "}


def parse_diff(diff):
    rows = (diff or "").split("\n")
    if rows and rows[-1] == "":
        rows.pop()
    lines = []
    old = new = 0
    for raw in rows:
        header = _HUNK_HEADER.match(raw)
        if header:
            old, new = int(header.group(1)), int(header.group(2))
        elif raw.startswith("\\"):
            continue
        elif raw.startswith("+"):
            lines.append(DiffLine(None, new, "+", raw[1:]))
            new += 1
        elif raw.startswith("-"):
            lines.append(DiffLine(old, None, "-", raw[1:]))
            old += 1
        else:
            lines.append(DiffLine(old, new, "=", raw[1:] if raw.startswith(" ") else raw))
            old += 1
            new += 1
    return lines


def file_lines(version, path):
    for entry in version.get("diffs", []):
        if entry.get("new_path") == path or entry.get("old_path") == path:
            return parse_diff(entry.get("diff", ""))
    return None


def _number(line, side):
    return line.new if side == "new" else line.old


def _indexes(lines, start, end, side):
    return [
        i for i, line in enumerate(lines)
        if _number(line, side) is not None and start <= _number(line, side) <= end
    ]


def snippet(lines, start, end, side, radius=CONTEXT_RADIUS):
    found = _indexes(lines, start, end, side)
    if not found:
        return ""
    chosen = lines[max(0, found[0] - radius): found[-1] + radius + 1]
    return "\n".join(_MARKER[line.kind] + line.text for line in chosen)


def addressed_and_fix(before, after, start, end, side):
    commented_indexes = _indexes(before, start, end, side)
    commented = [before[i].text.strip() for i in commented_indexes if before[i].text.strip()]
    if not commented:
        return False, None
    if after is None:
        return True, None
    if not after:
        return False, None
    wanted = ("+", "=") if side == "new" else ("-",)
    present = {line.text.strip() for line in after if line.kind in wanted}
    if all(text in present for text in commented):
        return False, None
    skip = set(commented_indexes)
    anchors = {
        before[i].text.strip()
        for i in _indexes(before, start - ANCHOR_RADIUS, end + ANCHOR_RADIUS, side)
        if i not in skip and len(before[i].text.strip()) >= MIN_ANCHOR_CHARS
    }
    matched = sorted(line.new for line in after if line.new is not None and line.text.strip() in anchors)
    if not matched:
        return True, None
    center = matched[len(matched) // 2]
    return True, snippet(after, center, center, "new")


def analyze_position(position, versions):
    path = position.get("new_path") or position.get("old_path")
    line_range = position.get("line_range") or {}
    start_point = line_range.get("start") or {}
    end_point = line_range.get("end") or {}
    side = "new" if (position.get("new_line") or start_point.get("new_line")) else "old"
    key = "new_line" if side == "new" else "old_line"
    start = start_point.get(key) or position.get(key)
    end = end_point.get(key) or position.get(key) or start
    result = {"line_range": [start, end], "code": "", "addressed": False, "fix": None}
    if start is None:
        return result
    index = next((i for i, v in enumerate(versions)
                  if v.get("head_commit_sha") == position.get("head_sha")), None)
    if index is None:
        return result
    before = file_lines(versions[index], path)
    if not before:
        return result
    result["code"] = snippet(before, start, end, side)
    if index + 1 < len(versions):
        after = file_lines(versions[index + 1], path)
        result["addressed"], result["fix"] = addressed_and_fix(before, after, start, end, side)
    return result
