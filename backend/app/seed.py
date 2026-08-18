"""CLI seeder:  python -m app.seed

Same code path as POST /demo/seed, for when you would rather not expose the endpoint.
"""
from __future__ import annotations

import asyncio
import logging

from .config import apply_seed, settings
from .db import SessionLocal, engine
from .services.seed import seed_demo


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    apply_seed()
    async with SessionLocal() as session:
        result = await seed_demo(session)
    await engine.dispose()

    print()
    print("  NeuroTrace demo data ready")
    print(f"  database   {settings.database_url.split('@')[-1]}")
    print(f"  email      {result['email']}")
    print(f"  password   {result['password']}")
    print(f"  dashboard  /dashboard/{result['patient_id']}")
    print(f"  bands      {' -> '.join(result['bands'])}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
