"""
api/performance.py — Benchmark endpoints
"""

import json
import os
from fastapi import APIRouter, BackgroundTasks

router = APIRouter(tags=["Performance"])

RESULTS_PATH = os.path.join(os.path.dirname(__file__), "../performance/results.json")


@router.get("/performance/results")
def get_benchmark_results():
    """Return pre-run benchmark results for the dashboard."""
    if os.path.exists(RESULTS_PATH):
        with open(RESULTS_PATH) as f:
            return json.load(f)
    return {"message": "No benchmark results yet. Run 'make benchmark' first."}


@router.post("/performance/run")
def run_benchmarks(background_tasks: BackgroundTasks):
    """Trigger a fresh benchmark run in the background."""
    def _run():
        from performance.benchmark import run_all_benchmarks
        run_all_benchmarks()
    background_tasks.add_task(_run)
    return {"message": "Benchmark started in background. Check /performance/results in ~60 seconds."}
