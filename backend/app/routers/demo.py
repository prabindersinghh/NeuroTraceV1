"""/demo — one-click demo dataset for the pitch.

Unauthenticated on purpose: the demo button on the login screen must work before anyone
has an account. Gated by DEMO_MODE so a real deployment can turn it off — leaving it on in
production would let anyone create the demo account.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..services.seed import seed_demo

router = APIRouter(prefix="/demo", tags=["demo"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.post("/seed")
async def seed(session: Session) -> dict:
    if not settings.demo_mode:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Demo mode is disabled on this deployment")
    return await seed_demo(session)
