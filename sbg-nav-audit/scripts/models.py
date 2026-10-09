from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HoldingsMetadata(BaseModel):
    last_ir_update: str
    source_url: str
    ir_usd_jpy: float = Field(gt=0)


class IRBenchmarks(BaseModel):
    total_nav: float
    equity_value_total: float
    net_debt: float
    nav_per_share_jpy: float
    shares_outstanding_m: float = Field(gt=0)
    ltv_ratio: float = Field(ge=0, le=1)


class Holding(BaseModel):
    asset_id: str
    ticker: str | None = None
    shares_owned: float | None = Field(default=None, ge=0)
    ownership_ratio: float | None = Field(default=None, ge=0, le=1)
    ir_valuation_jpy: float | None = Field(default=None, ge=0)
    valuation_method: Literal["MARKET_PRICE", "IR_FIXED"]
    source_url: str


class NetDebt(BaseModel):
    value_jpy_t: float
    last_verified_at: str
    source_url: str


class HoldingsConfig(BaseModel):
    metadata: HoldingsMetadata
    ir_benchmarks: IRBenchmarks
    holdings: list[Holding]
    net_debt: NetDebt


class AnomalyThresholds(BaseModel):
    nav_delta_limit: float = Field(ge=0)
    fx_delta_limit: float = Field(ge=0)
    asset_contribution_max: float = Field(ge=0)
    min_market_cap: float = Field(ge=0)


class ThresholdConfig(BaseModel):
    anomalies: AnomalyThresholds


class FXSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    usd_jpy: float = Field(alias="USDJPY", gt=0)


class PriceSnapshot(BaseModel):
    timestamp: datetime
    source: str
    prices: dict[str, float]
    fx: FXSnapshot
    metadata: dict[str, float] = Field(default_factory=dict)
