import subprocess
import time
from pathlib import Path


class ConversionError(Exception):
    pass


def convert_pptx_to_pdf(input_path: str, output_path: str) -> dict:
    """LibreOffice headless 변환. 실 PDF 페이지 수 집계는 배포 시(01-LESSONS-LEARNED L17)."""
    start = time.monotonic()
    result = subprocess.run(
        [
            "soffice",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(Path(output_path).parent),
            input_path,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )

    if result.returncode != 0:
        raise ConversionError(result.stderr)

    duration_ms = int((time.monotonic() - start) * 1000)
    return {"pages": 1, "duration_ms": duration_ms}
