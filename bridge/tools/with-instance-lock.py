#!/usr/bin/env python3
"""Hold a kernel flock in the executed process; never remove/steal the lock file."""
import fcntl
import os
import stat
import sys


def main():
    if len(sys.argv) < 3:
        raise ValueError('lock arguments required')
    path = sys.argv[1]
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        raise ValueError('lock must be a regular file')
    os.fchmod(fd, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('INSTANCE_ALREADY_RUNNING', file=sys.stderr)
        return 73
    # The fd stays in the actual Bun runtime across exec, including parent death.
    os.set_inheritable(fd, True)
    child_env = dict(os.environ)
    child_env['PHOTON_LOCK_FD'] = str(fd)
    os.execvpe(sys.argv[2], sys.argv[2:], child_env)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('INSTANCE_LOCK_UNAVAILABLE', file=sys.stderr)
        sys.exit(74)
