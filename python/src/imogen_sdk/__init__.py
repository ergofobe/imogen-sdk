"""Python client for the imogen photo library API.

>>> import asyncio
>>> from imogen_sdk import AssetQuery, ImogenClient
>>>
>>> async def main() -> None:                                        # doctest: +SKIP
...     async with ImogenClient("https://photos.example.com", token="…") as imogen:
...         page = await imogen.assets.list(AssetQuery(q="harbour", limit=50))
...         for asset in page.items:
...             print(asset.id, asset.original_filename)
"""

from .client import ImogenClient
from .errors import ImogenError
from .http import HttpClient, TokenProvider, backoff_delay
from .models import *  # noqa: F403 — the contract is the public surface.
from .models import __all__ as _model_names
from .oauth import OAuthClient, OAuthError, PairedDevice, PendingAuthorization, StoredTokens
from .resources import (
    Admin,
    Albums,
    Assets,
    Auth,
    BulkUploadResult,
    Pairing,
    People,
    UploadProgress,
    Vault,
)

__version__ = "0.1.0"

__all__ = [
    "Admin",
    "Albums",
    "Assets",
    "Auth",
    "BulkUploadResult",
    "HttpClient",
    "ImogenClient",
    "ImogenError",
    "OAuthClient",
    "OAuthError",
    "PairedDevice",
    "Pairing",
    "PendingAuthorization",
    "People",
    "StoredTokens",
    "TokenProvider",
    "UploadProgress",
    "Vault",
    "__version__",
    "backoff_delay",
    *_model_names,
]
