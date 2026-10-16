"""Quick check that Foundry access works. Run:  python smoke_test.py"""
import asyncio

from dotenv import load_dotenv

load_dotenv()
from pitchmind.agents import make_client  # noqa: E402


async def main():
    agent = make_client().as_agent(name="Ping", instructions="Reply with the single word: ready")
    r = await agent.run("ping")
    print("Foundry says:", r.text)


asyncio.run(main())
