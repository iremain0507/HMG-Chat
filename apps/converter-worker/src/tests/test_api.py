from unittest.mock import patch

from fastapi.testclient import TestClient

from src.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "converter-worker"}


@patch("src.api.convert_pptx_to_pdf")
def test_convert_pptx_to_pdf_endpoint_returns_pages_and_duration(mock_convert):
    mock_convert.return_value = {"pages": 7, "duration_ms": 123}

    response = client.post(
        "/convert/pptx-to-pdf",
        json={"s3KeyIn": "uploads/in.pptx", "s3KeyOut": "artifacts/out.pdf"},
    )

    assert response.status_code == 200
    assert response.json() == {"pages": 7, "durationMs": 123}
    assert mock_convert.called


def test_convert_pptx_to_pdf_endpoint_requires_body_fields():
    response = client.post("/convert/pptx-to-pdf", json={"s3KeyIn": "uploads/in.pptx"})

    assert response.status_code == 422
