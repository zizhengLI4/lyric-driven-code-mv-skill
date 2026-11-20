"""Filesystem alias checks for CLI inputs and outputs."""
import os
from pathlib import Path


def _canonical(path):
    return Path(path).expanduser().resolve(strict=False)


def _file_identity(path):
    try:
        info = path.stat()
    except (FileNotFoundError, NotADirectoryError):
        return None
    if not path.is_file():
        return None
    return info.st_dev, info.st_ino


def assert_no_path_aliases(inputs=(), outputs=()):
    """Raise ValueError if a write target aliases a source or another target."""
    sources = [Path(path).expanduser() for path in inputs if path is not None]
    targets = [Path(path).expanduser() for path in outputs if path is not None]
    canonical_sources = {}
    source_identities = {}
    for source in sources:
        canonical_sources.setdefault(_canonical(source), source)
        identity = _file_identity(source)
        if identity is not None:
            source_identities.setdefault(identity, source)

    seen_paths = {}
    seen_identities = {}
    for target in targets:
        canonical_target = _canonical(target)
        source = canonical_sources.get(canonical_target)
        identity = _file_identity(target)
        if source is None and identity is not None:
            source = source_identities.get(identity)
        if source is not None:
            raise ValueError(f"输出路径与输入文件冲突，为避免覆盖输入：{target} ↔ {source}")

        previous = seen_paths.get(canonical_target)
        if previous is None and identity is not None:
            previous = seen_identities.get(identity)
        if previous is not None:
            raise ValueError(f"多个输出路径指向同一文件：{previous} ↔ {target}")

        seen_paths[canonical_target] = target
        if identity is not None:
            seen_identities[identity] = target
