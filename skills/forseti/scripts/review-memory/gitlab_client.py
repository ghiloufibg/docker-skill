import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_ATTEMPTS = 4
MAX_RETRY_AFTER_SECONDS = 120
DEFAULT_RETRY_AFTER_SECONDS = 5
PER_HOST_CONCURRENCY = 4
REQUEST_TIMEOUT_SECONDS = 30
PAGE_SIZE = 100


class GitlabError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def urllib_http(url, headers):
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as error:
        return error.code, {k.lower(): v for k, v in error.headers.items()}, error.read()


class HostLimiter:
    def __init__(self, per_host=PER_HOST_CONCURRENCY):
        self._per_host = per_host
        self._slots = {}
        self._lock = threading.Lock()

    def slot(self, host):
        with self._lock:
            return self._slots.setdefault(host, threading.BoundedSemaphore(self._per_host))


class GitlabClient:
    def __init__(self, api_base, token, host, limiter, http=urllib_http, sleep=time.sleep):
        self._api_base = api_base
        self._headers = {"PRIVATE-TOKEN": token, "Accept": "application/json"}
        self._host = host
        self._limiter = limiter
        self._http = http
        self._sleep = sleep

    def _url(self, path, params):
        query = urllib.parse.urlencode(params or {})
        return f"{self._api_base}{path}" + (f"?{query}" if query else "")

    def get(self, path, params=None):
        url = self._url(path, params)
        reason = "no attempt made"
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                with self._limiter.slot(self._host):
                    status, headers, body = self._http(url, self._headers)
            except OSError as error:
                reason = f"network error: {error}"
            else:
                if 200 <= status < 300:
                    try:
                        return json.loads(body.decode("utf-8")), headers
                    except ValueError as error:
                        raise GitlabError(f"{url} returned invalid JSON: {error}", status)
                if status == 429:
                    reason = "HTTP 429"
                    self._sleep(self._retry_after(headers))
                    continue
                if status < 500:
                    raise GitlabError(f"{url} responded {status}", status)
                reason = f"HTTP {status}"
            if attempt < MAX_ATTEMPTS:
                self._sleep(2 ** (attempt - 1))
        raise GitlabError(f"{url} failed after {MAX_ATTEMPTS} attempts: {reason}")

    @staticmethod
    def _retry_after(headers):
        try:
            return min(int(headers.get("retry-after", "")), MAX_RETRY_AFTER_SECONDS)
        except ValueError:
            return DEFAULT_RETRY_AFTER_SECONDS

    def get_all(self, path, params=None):
        page = 1
        while page:
            data, headers = self.get(path, {**(params or {}), "per_page": PAGE_SIZE, "page": page})
            yield from data
            next_page = headers.get("x-next-page", "")
            page = int(next_page) if next_page.isdigit() else 0
