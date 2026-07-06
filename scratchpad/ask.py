#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


DEFAULT_MODEL = "cline-pass/glm-5.2"
API_URL = "https://api.cline.bot/api/v1/chat/completions"
AUTH_REFRESH_URL = "https://api.cline.bot/api/v1/auth/refresh"


def providers_path() -> Path:
    return Path.home() / ".cline" / "data" / "settings" / "providers.json"


def load_auth() -> dict:
    path = providers_path()
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data["providers"]["cline"]["settings"]["auth"]
    except Exception as exc:
        raise SystemExit(f"failed to read Cline auth from {path}: {exc}") from exc


def save_auth(auth: dict) -> None:
    path = providers_path()
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("providers", {}).setdefault("cline", {}).setdefault("settings", {})["auth"] = auth
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def is_expired(auth: dict, skew_seconds: int = 60) -> bool:
    expires_at = auth.get("expiresAt")
    if not isinstance(expires_at, (int, float)):
        return False

    expires_seconds = expires_at / 1000 if expires_at > 10_000_000_000 else expires_at
    return time.time() + skew_seconds >= expires_seconds


def refresh_auth(auth: dict) -> dict:
    refresh_token = auth.get("refreshToken")
    if not refresh_token:
        raise SystemExit("Cline access token expired and providers.json has no refreshToken. Re-authenticate Cline.")

    body = json.dumps({
        "refreshToken": refresh_token,
        "grantType": "refresh_token",
    }).encode("utf-8")
    request = urllib.request.Request(
        os.environ.get("CLINE_AUTH_REFRESH_URL", AUTH_REFRESH_URL),
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Cline token refresh failed: HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Cline token refresh failed: {exc}") from exc

    token_data = data.get("data") if isinstance(data, dict) else None
    if not data.get("success") or not isinstance(token_data, dict) or not token_data.get("accessToken"):
        raise SystemExit(f"Cline token refresh failed: {data}")

    expires_at = token_data.get("expiresAt")
    try:
        expires_ms = int(datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception as exc:
        raise SystemExit(f"Cline token refresh returned invalid expiresAt: {expires_at}") from exc

    user_info = token_data.get("userInfo") if isinstance(token_data.get("userInfo"), dict) else {}
    next_auth = {
        **auth,
        "accessToken": token_data["accessToken"],
        "refreshToken": token_data.get("refreshToken") or auth.get("refreshToken"),
        "expiresAt": expires_ms,
        "accountId": user_info.get("clineUserId") or auth.get("accountId"),
        "email": user_info.get("email") or auth.get("email"),
        "metadata": {
            **(auth.get("metadata") if isinstance(auth.get("metadata"), dict) else {}),
            "provider": "cline",
            "tokenType": token_data.get("tokenType"),
            "userInfo": user_info,
        },
    }
    save_auth(next_auth)
    return next_auth


def ask(prompt: str, model: str) -> str:
    auth = load_auth()
    if is_expired(auth):
        print("[cline] access token expired or expiring; refreshing.", file=sys.stderr)
        auth = refresh_auth(auth)

    access_token = auth.get("accessToken")
    if not access_token:
        raise SystemExit("missing Cline accessToken in providers.json")

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
