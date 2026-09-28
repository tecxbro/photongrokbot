#!/usr/bin/env python3
"""A per-task lock held until the Node owner's input pipe closes. No lease stealing."""
import fcntl
import os
import stat
import sys

try:
    fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError('private regular lock required')
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    print('CONTEXT_LOCKED', flush=True)
    while sys.stdin.buffer.read(4096):
        pass
except Exception:
    sys.exit(73)
