#!/usr/bin/env python3
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_MODEL = "zai/glm-5.2"
API_URL = "https://api.cline.bot/api/v1/chat/completions"


def load_auth() -> dict:
    providers_path = Path.home() / ".cline" / "data" / "settings" / "providers.json"
    try:
        with providers_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data["providers"]["cline"]["settings"]["auth"]
    except Exception as exc:
        raise SystemExit(f"failed to read Cline auth from {providers_path}: {exc}") from exc


def warn_if_expired(auth: dict) -> None:
    expires_at = auth.get("expiresAt")
    if not isinstance(expires_at, (int, float)):
        return

    expires_seconds = expires_at / 1000 if expires_at > 10_000_000_000 else expires_at
    if time.time() >= expires_seconds:
        expires_local = time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(expires_seconds))
        print(
            f"[warn] Cline access token expired at {expires_local}. "
            "Refresh auth in Cline, then retry.",
            file=sys.stderr,
        )


def ask(prompt: str, model: str) -> str:
    auth = load_auth()
    access_token = auth.get("accessToken")
    if not access_token:
        raise SystemExit("missing Cline accessToken in providers.json")

    warn_if_expired(auth)

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"request failed: {exc}") from exc

    data = json.loads(raw)
    text = extract_text(data)
    return text if text else raw


def extract_text(data: dict) -> str:
    if isinstance(data.get("data"), dict):
        data = data["data"]

    choices = data.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""

    choice = choices[0]
    message = choice.get("message")
    if isinstance(message, dict):
        text = content_to_text(message.get("content"))
        if text:
            return text

    text = content_to_text(choice.get("text"))
    if text:
        return text

    delta = choice.get("delta")
    if isinstance(delta, dict):
        return content_to_text(delta.get("content"))

    return ""


def content_to_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                value = item.get("text") or item.get("content")
                if isinstance(value, str):
                    parts.append(value)
        return "".join(parts)
    if isinstance(content, dict):
        value = content.get("text") or content.get("content")
        return value if isinstance(value, str) else ""
    return ""


def main() -> None:
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        raise SystemExit(f"usage: {sys.argv[0]} PROMPT [MODEL]")

    prompt = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) == 3 else DEFAULT_MODEL
    print(ask(prompt, model))


if __name__ == "__main__":
    main()
