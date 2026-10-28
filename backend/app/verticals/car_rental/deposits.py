"""Security deposits stay in Odoo; the API never keeps a second money ledger."""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


def is_security_deposit(product: dict) -> bool:
    return (product.get("default_code") or "").strip().upper().startswith("DEP-")


class DepositSettlement(BaseModel):
    request_id: UUID
    action: Literal["refund", "retain"]
    amount: float = Field(gt=0, le=1_000_000_000, allow_inf_nan=False, strict=True)
    journal_id: int | None = Field(default=None, gt=0)
    note: str = Field(default="", max_length=4000)
