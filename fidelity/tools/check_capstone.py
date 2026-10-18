#!/usr/bin/env python3
"""capstone/pefile availability for the static mission-DLL analysis."""
for mod in ('capstone', 'pefile'):
    try:
        m = __import__(mod)
        print(mod, getattr(m, '__version__', 'ok'), 'available')
    except ImportError:
        print(mod, 'missing')
