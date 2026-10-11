"""Experiments 7 (right-sizing) and 8 (FinOps instance comparison).

For each configuration the ml-service container is recreated with CPU/memory
limits (and a worker count), then measured:
  - online load: k6 at a fixed request rate for 60 s (latency, errors, drops)
  - resource use: `docker stats` sampled every ~1 s during the load test
  - batch job:   scoring a 500-TLE subset in one request, x3

A small local simulation: requests use a 200-TLE subset, the batch job a
500-TLE subset. Results are real measurements on this machine; instance types
are simulated with Docker CPU quotas and memory limits. No cloud resources are
used - list prices are only applied afterwards in analyze.py.

Usage (from the repo root, with the stack running):
  ml-service/.venv/Scripts/python experiments/finops/run_experiments.py [exp7|exp8|all]
"""

from __future__ import annotations

import json
import math
import random
import re
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RESULTS = HERE / "results"
OVERRIDE = RESULTS / "_override.yml"
CONTAINER = "astrotrack-ml-service-1"
NETWORK = "astrotrack_default"
K6_IMAGE = "grafana/k6:0.54.0"
ML_URL = "http://localhost:5090"
BACKEND_URL = "http://localhost:5080"
LOAD_SECONDS = 30
# A fresh container is slow for its first ~10-20 s of traffic (cold start), so
# warm up at the test rate, then pause, before measuring.
WARMUP_SECONDS = 20
SETTLE_SECONDS = 5
BATCH_SIZE = 500
BATCH_REPEATS = 3

# Experiment 8: AWS instance shapes (vCPU, memory). Workers = vCPUs.
# "baseline" variants emulate a T3 in standard mode once CPU credits are spent:
# sustained CPU is capped at the instance's baseline (vCPUs x baseline %).
EXP8 = [
    {"name": "t3.nano (burst)", "instance": "t3.nano", "cpus": 2.0, "mem": "512m", "workers": 2},
    {"name": "t3.micro (burst)", "instance": "t3.micro", "cpus": 2.0, "mem": "1g", "workers": 2},
    {"name": "t3.micro (baseline)", "instance": "t3.micro", "cpus": 0.2, "mem": "1g", "workers": 2},
    {"name": "t3.small (burst)", "instance": "t3.small", "cpus": 2.0, "mem": "2g", "workers": 2},
    {"name": "t3.small (baseline)", "instance": "t3.small", "cpus": 0.4, "mem": "2g", "workers": 2},
    {"name": "t3.medium (burst)", "instance": "t3.medium", "cpus": 2.0, "mem": "4g", "workers": 2},
    {"name": "t3.medium (baseline)", "instance": "t3.medium", "cpus": 0.4, "mem": "4g", "workers": 2},
    {"name": "c6i.large", "instance": "c6i.large", "cpus": 2.0, "mem": "4g", "workers": 2},
    {"name": "m6i.large", "instance": "m6i.large", "cpus": 2.0, "mem": "8g", "workers": 2},
    {"name": "c6i.xlarge", "instance": "c6i.xlarge", "cpus": 4.0, "mem": "8g", "workers": 4},
]
EXP8_RATE = 20  # one worker saturates at ~15-18 req/s, so this needs >1 worker

# Experiment 7: the as-deployed service (1 worker) on a generous allocation,
# then right-sized from what it actually used.
EXP7_BEFORE = {"name": "before: over-provisioned", "cpus": 4.0, "mem": "8g", "workers": 1}
EXP7_UNDER = {"name": "too small", "cpus": 0.25, "mem": "256m", "workers": 1}
EXP7_RATE = 10
HEADROOM = 1.3


def sh(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)


def compose(*args: str) -> subprocess.CompletedProcess:
    files = ["-f", "docker-compose.yml", "-f", "docker-compose.override.yml"]
    if OVERRIDE.exists():
        files += ["-f", str(OVERRIDE)]
    return sh(["docker", "compose", *files, *args], cwd=ROOT)


def apply_config(cfg: dict) -> None:
    OVERRIDE.write_text(
        "services:\n"
        "  ml-service:\n"
        f"    cpus: {cfg['cpus']}\n"
        f"    mem_limit: {cfg['mem']}\n"
        f"    memswap_limit: {cfg['mem']}\n"
        "    environment:\n"
        f"      WEB_CONCURRENCY: \"{cfg['workers']}\"\n"
    )
    out = compose("up", "-d", "--force-recreate", "--no-deps", "ml-service")
    if out.returncode != 0:
        raise RuntimeError(out.stderr)


def restore_default() -> None:
    OVERRIDE.unlink(missing_ok=True)
    compose("up", "-d", "--force-recreate", "--no-deps", "ml-service")


def container_state() -> dict:
    out = sh(["docker", "inspect", CONTAINER, "--format", "{{json .State}}"])
    return json.loads(out.stdout) if out.returncode == 0 else {}


def wait_ready(workers: int, timeout: float = 600) -> tuple[bool, float, str]:
    """Ready when every worker has finished both startup scoring passes."""
    start = time.time()
    while time.time() - start < timeout:
        state = container_state()
        if state.get("OOMKilled") or state.get("Status") in ("exited", "dead"):
            return False, time.time() - start, f"container {state.get('Status')} (OOMKilled={state.get('OOMKilled')})"
        logs = sh(["docker", "logs", CONTAINER]).stderr + sh(["docker", "logs", CONTAINER]).stdout
        if logs.count("Scored ") >= 2 * workers:
            return True, time.time() - start, "ready"
        time.sleep(3)
    return False, timeout, "timeout waiting for startup scoring"


class StatsSampler(threading.Thread):
    """Streams `docker stats` (≈1 sample/s) into a list of (cpu_cores, mem_mib)."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.samples: list[tuple[float, float]] = []
        self.proc = subprocess.Popen(
            ["docker", "stats", "--format", "{{json .}}", CONTAINER],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
        )

    def run(self) -> None:
        for line in self.proc.stdout:  # type: ignore[union-attr]
            m = re.search(r"\{.*\}", line)
            if not m:
                continue
            try:
                d = json.loads(m.group(0))
                cpu = float(d["CPUPerc"].rstrip("%")) / 100.0
                self.samples.append((cpu, _to_mib(d["MemUsage"].split("/")[0])))
            except (KeyError, ValueError):
                continue

    def stop(self) -> None:
        self.proc.terminate()


def _to_mib(s: str) -> float:
    m = re.match(r"\s*([\d.]+)\s*([KMG]i?B|B)", s.strip())
    if not m:
        return math.nan
    value, unit = float(m.group(1)), m.group(2)
    return value * {"B": 1 / 2**20, "KiB": 1 / 1024, "KB": 1 / 1024, "MiB": 1, "MB": 1, "GiB": 1024, "GB": 1024}[unit]


def run_k6(rate: int, seconds: int, tag: str) -> dict:
    summary = f"results/k6_{tag}.json"
    sh([
        "docker", "run", "--rm", "--network", NETWORK, "-v", f"{HERE}:/work", "-w", "/work",
        "-e", f"RATE={rate}", "-e", f"DURATION={seconds}s",
        K6_IMAGE, "run", "--quiet", "--summary-export", summary, "load.js",
    ])
    data = json.loads((HERE / summary).read_text())["metrics"]
    dur = data["http_req_duration"]
    reqs = data["http_reqs"]["count"]
    dropped = data.get("dropped_iterations", {}).get("count", 0)
    return {
        "rate_target": rate,
        "requests": reqs,
        "achieved_rps": data["http_reqs"]["rate"],
        "dropped": dropped,
        "error_rate": data["http_req_failed"]["value"],
        "lat_avg_ms": dur["avg"], "lat_p50_ms": dur["med"], "lat_p95_ms": dur["p(95)"],
        "lat_p99_ms": dur["p(99)"], "lat_max_ms": dur["max"],
    }


def run_batch(catalog_body: dict) -> list[float]:
    times = []
    with httpx.Client(timeout=600) as client:
        for _ in range(BATCH_REPEATS):
            t = time.perf_counter()
            try:
                r = client.post(f"{ML_URL}/ml/reentry/predict", json=catalog_body)
                r.raise_for_status()
                times.append(time.perf_counter() - t)
            except httpx.HTTPError:
                times.append(math.nan)
    return times


def measure(cfg: dict, rate: int, catalog_body: dict, tag: str) -> dict:
    print(f"\n=== {cfg['name']}: {cfg['cpus']} vCPU, {cfg['mem']}, {cfg['workers']} worker(s), {rate} req/s", flush=True)
    result = {**cfg, "rate": rate}
    apply_config(cfg)
    startup = StatsSampler(); startup.start()
    ok, ready_s, why = wait_ready(cfg["workers"])
    startup.stop()
    result["startup_s"] = round(ready_s, 1)
    result["startup_mem_max_mib"] = max((m for _, m in startup.samples), default=math.nan)
    if not ok:
        result |= {"failed": why}
        print("   FAILED:", why, flush=True)
        return result

    time.sleep(2)
    idle = StatsSampler(); idle.start(); time.sleep(5); idle.stop()
    result["idle_mem_mib"] = max((m for _, m in idle.samples), default=math.nan)

    warm = run_k6(rate, WARMUP_SECONDS, f"{tag}_warmup")
    result["warmup_p95_ms"] = warm["lat_p95_ms"]
    time.sleep(SETTLE_SECONDS)
    sampler = StatsSampler(); sampler.start()
    load = run_k6(rate, LOAD_SECONDS, tag)
    sampler.stop()
    cpus = [c for c, _ in sampler.samples]
    mems = [m for _, m in sampler.samples]
    result |= load
    result |= {
        "cpu_avg_cores": statistics.fmean(cpus) if cpus else math.nan,
        "cpu_p95_cores": sorted(cpus)[int(0.95 * (len(cpus) - 1))] if cpus else math.nan,
        "cpu_max_cores": max(cpus, default=math.nan),
        "mem_max_mib": max(mems, default=math.nan),
        "stats_samples": len(cpus),
    }

    batch = BatchRun(catalog_body)
    result["batch_s"] = batch.times
    result["batch_mem_max_mib"] = batch.mem_max
    state = container_state()
    result["oom_killed"] = bool(state.get("OOMKilled"))
    result["status_after"] = state.get("Status")
    print(
        f"   p95={load['lat_p95_ms']:.0f} ms  err={load['error_rate']:.1%}  dropped={load['dropped']}  "
        f"cpu avg={result['cpu_avg_cores']:.2f} p95={result['cpu_p95_cores']:.2f} cores  "
        f"mem max={result['mem_max_mib']:.0f} MiB  batch={[round(t, 1) for t in batch.times]} s",
        flush=True,
    )
    return result


class BatchRun:
    def __init__(self, body: dict) -> None:
        sampler = StatsSampler(); sampler.start()
        self.times = [round(t, 2) for t in run_batch(body)]
        sampler.stop()
        self.mem_max = max((m for _, m in sampler.samples), default=math.nan)


def ceil_to(x: float, step: float) -> float:
    return math.ceil(x / step) * step


def main(which: str) -> None:
    RESULTS.mkdir(exist_ok=True)
    catalog = httpx.get(f"{BACKEND_URL}/api/satellites", timeout=60).json()
    subset = random.Random(42).sample(catalog, BATCH_SIZE)
    body = {"satellites": [{k: s[k] for k in ("noradId", "name", "tleLine1", "tleLine2")} for s in subset]}
    host = sh(["docker", "info", "--format", "{{.NCPU}} CPUs, {{.MemTotal}} bytes, {{.KernelVersion}}"]).stdout.strip()
    try:
        if which in ("exp7", "all"):
            before = measure(EXP7_BEFORE, EXP7_RATE, body, "exp7_before")
            # Right-size from measured peaks plus 30% headroom.
            cpus = max(0.25, ceil_to(before["cpu_p95_cores"] * HEADROOM, 0.25))
            peak_mem = max(before["mem_max_mib"], before["batch_mem_max_mib"], before["startup_mem_max_mib"])
            mem_mib = max(256, ceil_to(peak_mem * HEADROOM, 64))
            after_cfg = {"name": "after: right-sized", "cpus": cpus, "mem": f"{int(mem_mib)}m", "workers": 1}
            after = measure(after_cfg, EXP7_RATE, body, "exp7_after")
            under = measure(EXP7_UNDER, EXP7_RATE, body, "exp7_too_small")
            (RESULTS / "exp7.json").write_text(json.dumps({"host": host, "rate": EXP7_RATE, "headroom": HEADROOM,
                                                           "before": before, "after": after, "too_small": under}, indent=2))
        if which in ("exp8", "all"):
            runs = []
            for cfg in EXP8:
                runs.append(measure(cfg, EXP8_RATE, body, "exp8_" + re.sub(r"\W+", "_", cfg["name"]).strip("_")))
                # Save after every run so an interrupted suite keeps what it measured.
                (RESULTS / "exp8.json").write_text(json.dumps({"host": host, "rate": EXP8_RATE, "runs": runs}, indent=2))
    finally:
        restore_default()
        print("\nml-service restored to its default configuration", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "all")
