"""Return eligibility and records, independent of the Odoo RPC transport."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

from app.core.bookings import CONFIRMED_TAG
from app.core.record_metadata import read_metadata
from app.verticals.car_rental.states import PICKED_UP_TAG, is_active_booking

RETURN_RECORD_KEY = "rental_return"
OperationalState = Literal["Nettoyage", "Disponible", "Maintenance"]


class ReturnInspection(BaseModel):
    body_checked: bool = False
    interior_checked: bool = False
    fuel_keys_checked: bool = False
    approved: bool = False

    def complete(self) -> bool:
        return self.body_checked and self.interior_checked and self.fuel_keys_checked


class ReturnCondition(BaseModel):
    inspection: ReturnInspection | None = None
    damaged: bool = Field(default=False, strict=True)
    damage_notes: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def valid_condition(self):
        if self.damaged and not self.damage_notes.strip():
            raise ValueError("Describe the vehicle damage before saving.")
        if self.inspection and self.inspection.approved and (not self.inspection.complete() or self.damaged):
            raise ValueError("Complete the basic checks and resolve damage before approving the vehicle condition.")
        return self


class ReturnRecord(ReturnCondition):
    status: Literal["pending", "completed"]
    order_id: int = Field(gt=0)
    vehicle_id: int = Field(gt=0)
    returned_at: datetime
    odometer: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    previous_odometer: float = Field(ge=0, allow_inf_nan=False)
    odometer_unit: Literal["kilometers", "miles"]
    next_state: OperationalState
    return_notes: str = Field(default="", max_length=4000)
    inspected_at: datetime | None = None


def return_record(note: str | None) -> ReturnRecord | None:
    value = read_metadata(note, RETURN_RECORD_KEY)
    if value is None:
        return None
    try:
        return ReturnRecord.model_validate(value)
    except ValidationError:
        return None


def can_return(order: dict) -> bool:
    if not is_active_booking(order):
        return False
    note = order.get("note") or ""
    # Older rentals predate explicit handover markers; retain their return path.
    if PICKED_UP_TAG in note:
        return True
    start = (order.get("date_order") or "")[:10]
    return bool(CONFIRMED_TAG not in note and start and start <= date.today().isoformat())
