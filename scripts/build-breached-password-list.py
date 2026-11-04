#!/usr/bin/env python3
"""Builds apps/api/data/breached-passwords.bin (Task D5).

The list of passwords known from data leaks comes from SecLists
(https://github.com/danielmiessler/SecLists, MIT licence), commit e55e2fb23eeafed6d158fb06a83c0f8cee85b313,
folder Passwords/Common-Credentials. Only passwords our rules would otherwise accept are kept
(12 to 128 characters). Each is lower-cased and stored as the first 6 bytes of its SHA-256,
sorted, so the file holds no readable passwords and the API can look one up by binary search.
A different password matching by chance is about 1 in 380 million per check.

Usage: python3 scripts/build-breached-password-list.py <path to SecLists checkout>
"""
import hashlib
import sys
from pathlib import Path

SOURCES = [
    "Pwdb_top-10000000.txt",
    "xato-net-10-million-passwords-1000000.txt",
    "100k-most-used-passwords-NCSC.txt",
    "darkweb2017_top-10000.txt",
    "probable-v2_top-12000.txt",
]
PREFIX_BYTES = 6


def main() -> None:
    root = Path(sys.argv[1]) / "Passwords" / "Common-Credentials"
    words = set()
    for name in SOURCES:
        for raw in (root / name).read_bytes().split(b"\n"):
            word = raw.rstrip(b"\r").decode("utf-8", errors="replace")
            if "�" in word or any(ord(c) < 32 for c in word):
                continue
            if 12 <= len(word) <= 128:
                words.add(word.lower())
    prefixes = sorted({hashlib.sha256(w.encode("utf-8")).digest()[:PREFIX_BYTES] for w in words})
    out = Path(__file__).resolve().parent.parent / "apps" / "api" / "data" / "breached-passwords.bin"
    out.write_bytes(b"".join(prefixes))
    print(f"{len(words)} passwords -> {len(prefixes)} entries, {out.stat().st_size} bytes: {out}")


if __name__ == "__main__":
    main()
