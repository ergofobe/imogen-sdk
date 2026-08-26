"""The one exception every call raises, so a caller writes one ``except``."""

from __future__ import annotations

import json

__all__ = ["ImogenError"]


class ImogenError(Exception):
    """Every failure from the API arrives as one of these.

    A caller writes one ``except ImogenError`` rather than inspecting status codes at
    each call site.
    """

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: dict[str, list[str]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details

    @property
    def is_retryable(self) -> bool:
        """True when re-sending the same request might succeed."""
        return self.status == 429 or self.status >= 500

    @property
    def is_auth_error(self) -> bool:
        return self.status in (401, 403)

    @classmethod
    def from_response(cls, status: int, reason: str, body: str | bytes) -> ImogenError:
        """Builds the typed error from a rejection.

        A body that is not the envelope still yields an ``ImogenError``, because callers
        should never have to handle two shapes.
        """
        if isinstance(body, bytes):
            body = body.decode("utf-8", errors="replace")

        try:
            parsed = json.loads(body)
            error = parsed["error"]
            return cls(status, error["code"], error["message"], error.get("details"))
        except (ValueError, KeyError, TypeError):
            return cls(status, "http_error", f"{status} {reason}".strip())

    def __repr__(self) -> str:
        return f"ImogenError(status={self.status}, code={self.code!r}, message={self.message!r})"
