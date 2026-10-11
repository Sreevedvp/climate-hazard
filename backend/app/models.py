from datetime import date
import hashlib
import json
from pydantic import BaseModel, ConfigDict, Field, model_validator

VERSION = 'heatwave-v1-era5-utc-1981-2010'

class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    start_year: int = Field(ge=1950)
    end_year: int = Field(ge=1950)

    @model_validator(mode='after')
    def validate_range(self):
        if not self.start_year <= self.end_year <= date.today().year - 1:
            raise ValueError('Use an ordered range of complete years, ending before the current year')
        if self.end_year - self.start_year > 40:
            raise ValueError('Select at most 41 years')
        self.latitude = round(self.latitude, 3)
        self.longitude = round(self.longitude, 3)
        return self

    @property
    def key(self):
        return hashlib.sha256((VERSION + json.dumps(self.model_dump(), sort_keys=True)).encode()).hexdigest()

    @property
    def location_key(self):
        return f'{VERSION}:{self.latitude:.3f}:{self.longitude:.3f}'

class JobView(BaseModel):
    id: str
    status: str
    progress: str
    request: AnalysisRequest
    result: dict | None = None
    error: str | None = None
