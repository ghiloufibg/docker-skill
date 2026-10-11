import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[2]
DEFAULT_MEMORY_DIR = SKILL_DIR / "memory"
REFERENCES_DIR = SKILL_DIR / "references"
INSTRUCTIONS_DIR = Path(__file__).resolve().parent / "instructions"

CHECKS = (
    "hexagonal-boundary",
    "naming",
    "java21-idioms",
    "spring-boot3",
    "test-quality",
    "no-comments",
    "team-rules",
)
CATEGORIES = (
    "boundary",
    "naming",
    "java-idioms",
    "spring",
    "tests",
    "comments",
    "error-handling",
    "security",
    "performance",
    "other",
)
SEVERITIES = ("CRITICAL", "IMPORTANT", "RECOMMENDED")

MAX_FILE_NAME_CHARS = 120
ENV_TOOLS_DIR_VARIABLE = "COPILOT_TOOLS_DIR"

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL = re.compile(r"https?://[^\s)>\]\"']+")
_SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b(bearer|token|secret|password|passwd|api[_-]?key)\b(\s*[:=]\s*|\s+)\S+"
)
_GITLAB_TOKEN = re.compile(r"glpat-[\w-]{10,}")
_OPAQUE_STRING = re.compile(r"[A-Za-z0-9+/_-]{32,}={0,2}")
_CODE_BLOCK = re.compile(r"```.*?```", re.S)
_MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)
_MENTION = re.compile(r"@([A-Za-z0-9][\w.-]*)")
_CHATTER = re.compile(
    r"^(lgtm|\+1|nice|thanks?|thank you|looks good( to me)?|ok(ay)?|done|great|"
    r"good job|ship it|approved?|:\w+:|\W)+$",
    re.I,
)


def parse_env_file(content):
    values = {}
    for raw in content.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def load_env(environ=None):
    environ = os.environ if environ is None else environ
    tools_dir = environ.get(ENV_TOOLS_DIR_VARIABLE) or str(Path.home() / ".copilot" / "tools")
    env_file = Path(tools_dir) / ".env"
    values = {}
    if env_file.is_file():
        values.update(parse_env_file(env_file.read_text(encoding="utf-8")))
    values.update(environ)
    return values


def write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
        os.replace(temp_name, path)
    except BaseException:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
        raise


def write_json(path, data):
    write_text(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def read_json(path, default=None):
    path = Path(path)
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path):
    path = Path(path)
    if not path.is_file():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            records.append(json.loads(line))
    return records


def jsonl_text(records):
    return "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records)


def write_jsonl(path, records):
    write_text(path, jsonl_text(records))


def append_jsonl(path, records):
    path = Path(path)
    existing = path.read_text(encoding="utf-8") if path.is_file() else ""
    write_text(path, existing + jsonl_text(records))


def clean_comment(text):
    kept = [line for line in (text or "").splitlines() if not line.lstrip().startswith(">")]
    text = "\n".join(kept)
    text = _HTML_COMMENT.sub("", text)
    text = _MARKDOWN_LINK.sub(r"\1", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _scrub_opaque(match):
    token = match.group(0)
    has_digit = any(c.isdigit() for c in token)
    has_letter = any(c.isalpha() for c in token)
    return "<redacted>" if has_digit and has_letter else token


def scrub(text):
    text = _EMAIL.sub("<email>", text)
    text = _GITLAB_TOKEN.sub("<redacted>", text)
    text = _SECRET_ASSIGNMENT.sub(lambda m: f"{m.group(1)}{m.group(2)}<redacted>", text)
    text = _URL.sub("<url>", text)
    return _OPAQUE_STRING.sub(_scrub_opaque, text)


def is_chatter(text, min_chars):
    stripped = _CODE_BLOCK.sub("", text)
    stripped = _URL.sub("", stripped).strip()
    return len(stripped) < min_chars or bool(_CHATTER.match(stripped))


class Aliases:
    def __init__(self, path):
        self._path = Path(path)
        self._map = read_json(self._path, {})

    def get(self, username):
        if username not in self._map:
            self._map[username] = f"reviewer-{len(self._map) + 1:02d}"
        return self._map[username]

    def apply(self, text):
        return _MENTION.sub(lambda m: "@" + self.get(m.group(1)), text)

    def save(self):
        write_json(self._path, self._map)


def layer_of(path):
    for part in path.lower().split("/"):
        if part == "domain":
            return "domain"
        if part in ("application", "usecase", "usecases"):
            return "application"
        if part in ("adapter", "adapters"):
            return "adapter"
    return "other"


def memory_file_name(path):
    name = path
    for prefix, marker in (("src/main/java/", ""), ("src/test/java/", "test/")):
        index = name.find(prefix)
        if index != -1:
            name = marker + name[index + len(prefix):]
            break
    name = name.replace("/", "__")
    if len(name) > MAX_FILE_NAME_CHARS:
        name = name[-MAX_FILE_NAME_CHARS:]
    return name + ".jsonl"


def thread_text_for_prompt(thread):
    lines = [
        f"### id: {thread['id']}",
        f"kind: {thread['kind']}  layer: {thread.get('layer') or 'other'}",
    ]
    if thread.get("file_path"):
        lines.append(f"file: {thread['file_path']}")
    if thread.get("code"):
        lines += ["code:", "```", thread["code"], "```"]
    lines += ["comment:", thread["comment"]]
    if thread.get("replies"):
        lines += ["first reply:", thread["replies"][0]]
    if thread.get("fix"):
        lines += ["fix:", "```", thread["fix"], "```"]
    return "\n".join(lines)


def estimate_tokens(text):
    return len(text) // 4


def short_hash(text, length=8):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:length]


def load_threads(memory_dir):
    threads = []
    projects_dir = Path(memory_dir) / "projects"
    if projects_dir.is_dir():
        for project in sorted(projects_dir.iterdir()):
            threads += read_jsonl(project / "threads.jsonl")
    return threads
