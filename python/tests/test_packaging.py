"""Version drift between the package and its metadata is invisible until it ships.

``__version__`` is exported, so a consumer can read it, and nothing about a wrong value
fails a build — v0.2.0 shipped with ``0.1.0`` still in ``__init__.py`` for exactly that
reason.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import imogen_sdk

# tomllib is 3.11+ and the package still supports 3.10; CI runs newer, so the check
# holds where it matters.
tomllib = pytest.importorskip("tomllib")

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def test_version_matches_pyproject() -> None:
    metadata = tomllib.loads(PYPROJECT.read_text())
    assert imogen_sdk.__version__ == metadata["project"]["version"]
