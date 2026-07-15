from fastapi import APIRouter
from pydantic import BaseModel

from src.pptx_to_pdf import convert_pptx_to_pdf

router = APIRouter()


class ConvertRequest(BaseModel):
    s3KeyIn: str
    s3KeyOut: str


class ConvertResponse(BaseModel):
    pages: int
    durationMs: int


@router.post("/convert/pptx-to-pdf", response_model=ConvertResponse)
def convert_pptx_to_pdf_endpoint(body: ConvertRequest) -> ConvertResponse:
    result = convert_pptx_to_pdf(body.s3KeyIn, body.s3KeyOut)
    return ConvertResponse(pages=result["pages"], durationMs=result["duration_ms"])
