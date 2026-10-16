"""Run the whole agent team on the sample match and print the trace.

    python cli_run.py
"""
import asyncio
import json
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
from pitchmind.agents import build_team  # noqa: E402
from pitchmind.orchestrator import run_match  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data" / "match_001.json"


async def emit(msg):
    t = msg["type"]
    if t == "handoff":
        print(f"  {msg['from']} -> {msg['to']}")
    elif t == "insight":
        i = msg["insight"]
        print(f"[{i['minute']}'] {i['note']}   (proof: {i['proof']})")
    elif t == "recovery":
        print("  !", msg["note"])
    elif t == "recap":
        print("\nRECAP:", json.dumps(msg["recap"], indent=2))
    elif t == "done":
        print(f"\nverified {msg['verified']}  rejected {msg['rejected']}")


async def main():
    match = json.loads(DATA.read_text(encoding="utf-8"))
    await run_match(build_team(), match, "broadcast", emit)


asyncio.run(main())
