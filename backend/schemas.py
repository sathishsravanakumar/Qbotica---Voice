from datetime import datetime
from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum


class Vehicle(BaseModel):
    year: str
    make: str
    model: str
    vin: Optional[str] = None


class LineItem(BaseModel):
    item_type: str = Field(description="'PART' or 'LABOR'")
    description: str = Field(description="e.g., 'Front Brake Pads'")
    quantity: float = 1.0
    vendor: Optional[str] = Field(default=None, description="e.g., 'AutoZone' or 'WorldPac'")
    hours: Optional[float] = Field(default=None, description="Labor hours, only for LABOR items")


class MechanicIntent(BaseModel):
    bay_number: str
    technician_name: str
    vehicle: Vehicle
    items: List[LineItem]
    action: str = Field(description="e.g., 'SOURCE_PARTS'")


class AgentStatus(str, Enum):
    IDLE = "IDLE"
    PARSING = "PARSING"
    BROWSING = "BROWSING"
    COMPLETE = "COMPLETE"
    ERROR = "ERROR"


class ShopConfig(BaseModel):
    labor_rate: float = 150.0
    parts_markup_pct: float = 0.25
    tax_rate: float = 0.0825


class BillingLineItem(BaseModel):
    item_type: str
    description: str
    quantity: float = 1.0
    unit_cost: float = 0.0
    markup_pct: float = 0.0
    extended_price: float = 0.0
    source: Optional[str] = None
    source_url: Optional[str] = None


class BayBilling(BaseModel):
    parts_items: List[BillingLineItem] = []
    labor_items: List[BillingLineItem] = []
    parts_subtotal: float = 0.0
    labor_subtotal: float = 0.0
    subtotal: float = 0.0
    tax_rate: float = 0.0825
    tax_amount: float = 0.0
    total: float = 0.0


class ChatMessage(BaseModel):
    role: str
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    has_action: bool = False


class ChatRequest(BaseModel):
    message: str
    bay_number: str = "1"


class FitmentResult(BaseModel):
    status: str = "cleared"  # cleared | warning | halted
    issues: List[dict] = []
    clarification_needed: List[str] = []
    vehicle_details: dict = {}


class BayStatus(BaseModel):
    bay_number: str
    status: AgentStatus = AgentStatus.IDLE
    vehicle: Optional[Vehicle] = None
    technician_name: Optional[str] = None
    items: List[LineItem] = []
    all_items: List[LineItem] = []
    logs: List[str] = []
    results: dict = {}
    all_results: List[dict] = []
    billing: BayBilling = BayBilling()
    chat_history: List[ChatMessage] = []
    fitment_override: bool = False
    pending_browser_intent: Optional[dict] = None
