from fastapi import FastAPI

from src.api import router

app = FastAPI(title="WChat converter-worker")
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "converter-worker"}
