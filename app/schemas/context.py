"""Validated model-written summary content; ownership and versions are server-only."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class EvidenceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_id: int = Field(gt=0)
    chunk_index: int | None = Field(default=None, ge=0)


class SummaryItem(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=4000)
    status: Literal["active", "completed", "superseded", "pending"] = "active"
    verification: Literal["user_confirmed", "user_stated", "tool_observed", "assistant_inferred", "unverified"] = "unverified"
    source_message_ids: list[int] = Field(min_length=1, max_length=30)
    supersedes: list[str] = Field(default_factory=list, max_length=30)
    references: list[EvidenceRef] = Field(default_factory=list, max_length=20)


class WorkState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    completed: list[SummaryItem] = Field(default_factory=list, max_length=80)
    pending: list[SummaryItem] = Field(default_factory=list, max_length=80)
    open_questions: list[SummaryItem] = Field(default_factory=list, max_length=80)


class StructuredSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goals: list[SummaryItem] = Field(max_length=80)
    constraints: list[SummaryItem] = Field(max_length=80)
    facts: list[SummaryItem] = Field(max_length=120)
    decisions: list[SummaryItem] = Field(max_length=120)
    work_state: WorkState

    def items(self):
        yield from self.goals
        yield from self.constraints
        yield from self.facts
        yield from self.decisions
        yield from self.work_state.completed
        yield from self.work_state.pending
        yield from self.work_state.open_questions
