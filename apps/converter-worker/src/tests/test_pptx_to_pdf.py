import subprocess
from unittest.mock import patch

import pytest

from src.pptx_to_pdf import ConversionError, convert_pptx_to_pdf


def _mock_completed(returncode: int, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=["soffice"], returncode=returncode, stdout="", stderr=stderr)


@patch("src.pptx_to_pdf.subprocess.run")
def test_convert_pptx_to_pdf_success(mock_run):
    mock_run.return_value = _mock_completed(0)

    result = convert_pptx_to_pdf("/tmp/in.pptx", "/tmp/out.pdf")

    assert mock_run.called
    args, kwargs = mock_run.call_args
    invoked = args[0]
    assert "soffice" in invoked
    assert "--headless" in invoked
    assert "/tmp/in.pptx" in invoked
    assert set(result.keys()) == {"pages", "duration_ms"}
    assert result["pages"] >= 1
    assert result["duration_ms"] >= 0


@patch("src.pptx_to_pdf.subprocess.run")
def test_convert_pptx_to_pdf_libreoffice_failure_raises(mock_run):
    mock_run.return_value = _mock_completed(1, stderr="soffice: command failed")

    with pytest.raises(ConversionError):
        convert_pptx_to_pdf("/tmp/in.pptx", "/tmp/out.pdf")
