#!/usr/bin/env python3
"""
Convenience CLI launcher for Zero7 Pipeline Sentinel Agent.
Usage:
    python scripts/run_sentinel.py --audit
    python scripts/run_sentinel.py --cycle
    python scripts/run_sentinel.py --continuous
"""

import sys
import os

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.ai.sentinel_agent import main

if __name__ == "__main__":
    main()
