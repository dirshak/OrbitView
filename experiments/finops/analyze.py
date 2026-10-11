"""Turn the measurements from run_experiments.py into charts and a text report.

Inputs:  results/exp7.json, results/exp8.json, prices.json
Outputs: charts/*.png, ../../EXPERIMENTS_7_8.txt (repo root)
Usage:   ml-service/.venv/Scripts/python experiments/finops/analyze.py
"""

from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RESULTS = HERE / "results"
CHARTS = HERE / "charts"
REPORT = ROOT / "EXPERIMENTS_7_8.txt"

# Performance target for experiment 8 (defined before running it).
TARGET = {"p95_ms": 300.0, "error_rate": 0.01, "drop_rate": 0.01, "batch_s": 5.0}

# Chart styling: validated reference palette, light surface.
SURFACE, INK, INK_2, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9"
BLUE, ORANGE = "#2a78d6", "#eb6834"


def style(ax) -> None:
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#c3c2b7")
    ax.tick_params(colors=MUTED, labelsize=9)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def mem_mib(spec: str) -> float:
    return float(spec[:-1]) * (1024 if spec.endswith("g") else 1)


def fargate_size(vcpu: float, mem_gib: float, valid: dict) -> tuple[float, float]:
    """Smallest valid Fargate task size with at least this CPU and memory."""
    for cpu_s in sorted(valid, key=float):
        if float(cpu_s) >= vcpu - 1e-9:
            for gb in valid[cpu_s]:
                if gb >= mem_gib - 1e-9:
                    return float(cpu_s), float(gb)
    raise ValueError("too large for Fargate")


def passes(run: dict) -> tuple[bool, str]:
    if run.get("failed"):
        return False, run["failed"]
    if run.get("oom_killed"):
        return False, "out of memory"
    reasons = []
    if run["lat_p95_ms"] > TARGET["p95_ms"]:
        reasons.append(f"p95 {run['lat_p95_ms']:.0f} ms > {TARGET['p95_ms']:.0f}")
    if run["error_rate"] >= TARGET["error_rate"]:
        reasons.append(f"errors {run['error_rate']:.1%}")
    drop = run["dropped"] / max(1, run["requests"] + run["dropped"])
    if drop >= TARGET["drop_rate"]:
        reasons.append(f"dropped {drop:.1%}")
    batch = median_batch(run)
    if math.isnan(batch) or batch > TARGET["batch_s"]:
        reasons.append(f"batch {batch:.1f} s")
    return (not reasons), ("meets target" if not reasons else "; ".join(reasons))


def median_batch(run: dict) -> float:
    vals = [t for t in run.get("batch_s", []) if t == t]  # drop NaN
    return statistics.median(vals) if vals else math.nan


def fmt_ms(x: float) -> str:
    return f"{x / 1000:.1f} s" if x >= 1000 else f"{x:.0f} ms"


def exp7(prices: dict) -> list[str]:
    data = json.loads((RESULTS / "exp7.json").read_text())
    fg = prices["fargate_linux_x86"]
    runs = [("Before (over-provisioned)", data["before"]), ("After (right-sized)", data["after"]),
            ("Too small (check)", data["too_small"])]

    def peak_mem(r: dict) -> float:
        return max(r.get("mem_max_mib", 0), r.get("batch_mem_max_mib", 0), r.get("startup_mem_max_mib", 0))

    lines = [
        "EXPERIMENT 7 - CLOUD COST OPTIMIZATION THROUGH RESOURCE RIGHT-SIZING",
        "=" * 70,
        "",
        f"Workload: {data['rate']} requests/s for 30 s (70% single-TLE re-entry predictions,",
        "20% forecast lookups, 10% watch-list queries) + a 500-TLE batch prediction job x3.",
        "Service as deployed: 1 uvicorn worker. Resource use sampled every ~1 s with docker stats.",
        f"Right-sizing rule: CPU = p95 measured CPU x {data['headroom']} (rounded up to 0.25 vCPU);",
        f"memory = peak measured memory (startup, load or batch) x {data['headroom']} (rounded up to 64 MiB, min 256).",
        "",
        f"{'':28}{'Before':>18}{'After':>18}{'Too small':>18}",
    ]

    def row(label, f):
        lines.append(f"{label:28}" + "".join(f"{f(r):>18}" for _, r in runs))

    row("Allocated vCPU", lambda r: f"{r['cpus']:g}")
    row("Allocated memory (MiB)", lambda r: f"{mem_mib(r['mem']):.0f}")
    row("CPU used, avg (cores)", lambda r: "-" if r.get("failed") else f"{r['cpu_avg_cores']:.2f}")
    row("CPU used, p95 (cores)", lambda r: "-" if r.get("failed") else f"{r['cpu_p95_cores']:.2f}")
    row("Memory peak (MiB)", lambda r: "-" if r.get("failed") else f"{peak_mem(r):.0f}")
    row("CPU utilisation (p95)", lambda r: "-" if r.get("failed") else f"{r['cpu_p95_cores'] / r['cpus']:.0%}")
    row("Memory utilisation", lambda r: "-" if r.get("failed") else f"{peak_mem(r) / mem_mib(r['mem']):.0%}")
    row("Latency p50", lambda r: "-" if r.get("failed") else fmt_ms(r["lat_p50_ms"]))
    row("Latency p95", lambda r: "-" if r.get("failed") else fmt_ms(r["lat_p95_ms"]))
    row("Latency p99", lambda r: "-" if r.get("failed") else fmt_ms(r["lat_p99_ms"]))
    row("Error rate", lambda r: "-" if r.get("failed") else f"{r['error_rate']:.1%}")
    row("Throughput (req/s)", lambda r: "-" if r.get("failed") else f"{r['achieved_rps']:.1f}")
    row("Batch 500 TLEs (median s)", lambda r: "-" if r.get("failed") else (
        "failed" if math.isnan(median_batch(r)) else f"{median_batch(r):.2f}"))

    costs = []
    for _, r in runs:
        cpu, gb = fargate_size(r["cpus"], mem_mib(r["mem"]) / 1024, fg["_valid_sizes_vcpu_to_gb"])
        hourly = cpu * fg["usd_per_vcpu_hour"] + gb * fg["usd_per_gb_hour"]
        costs.append((cpu, gb, hourly))
    row("Fargate task size", lambda r: "{:g} vCPU/{:g} GB".format(*costs[[x for _, x in runs].index(r)][:2]))
    row("Cost per month (USD)", lambda r: f"${costs[[x for _, x in runs].index(r)][2] * prices['hours_per_month']:.2f}")

    b, a = data["before"], data["after"]
    saving = 1 - costs[1][2] / costs[0][2]
    lines += [
        "",
        "Findings",
        f"- Before: {b['cpus']:g} vCPU / {mem_mib(b['mem']):.0f} MiB allocated, but the service used at most "
        f"{b['cpu_p95_cores']:.2f} cores (p95) and {peak_mem(b):.0f} MiB - "
        f"{b['cpu_p95_cores'] / b['cpus']:.0%} CPU and {peak_mem(b) / mem_mib(b['mem']):.0%} memory utilisation.",
        f"- After right-sizing to {a['cpus']:g} vCPU / {mem_mib(a['mem']):.0f} MiB, p95 latency went from "
        f"{fmt_ms(b['lat_p95_ms'])} to {fmt_ms(a['lat_p95_ms'])} with {a['error_rate']:.1%} errors at the same load.",
        f"- Monthly cost as an AWS Fargate task: ${costs[0][2] * prices['hours_per_month']:.2f} -> "
        f"${costs[1][2] * prices['hours_per_month']:.2f} ({saving:.0%} less).",
    ]
    t = data["too_small"]
    if t.get("failed"):
        lines.append(f"- Too small ({t['cpus']:g} vCPU / {t['mem']}): failed - {t['failed']}.")
    else:
        lines.append(
            f"- Too small ({t['cpus']:g} vCPU / {mem_mib(t['mem']):.0f} MiB): p95 {fmt_ms(t['lat_p95_ms'])}, "
            f"errors {t['error_rate']:.1%} - shows the floor below which right-sizing hurts users."
        )
    lines += [
        "- Why one worker can't use 4 vCPUs: a single Python process serves requests; extra cores sit idle.",
        "",
    ]

    # Chart: allocated vs used, CPU and memory.
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.4), facecolor=SURFACE)
    labels = [name.split(" (")[0] for name, _ in runs[:2]]
    for ax, title, alloc, used, unit in (
        (axes[0], "CPU (cores)", [r["cpus"] for _, r in runs[:2]], [r["cpu_p95_cores"] for _, r in runs[:2]], ""),
        (axes[1], "Memory (MiB)", [mem_mib(r["mem"]) for _, r in runs[:2]], [peak_mem(r) for _, r in runs[:2]], ""),
    ):
        style(ax)
        y = range(len(labels))
        ax.barh([i + 0.18 for i in y], alloc, height=0.32, color=BLUE, label="Allocated")
        ax.barh([i - 0.18 for i in y], used, height=0.32, color=ORANGE, label="Used (peak / p95)")
        for i, (al, us) in enumerate(zip(alloc, used)):
            ax.text(al, i + 0.18, f"  {al:g}", va="center", color=INK_2, fontsize=8)
            ax.text(us, i - 0.18, f"  {us:.2f}" if title.startswith("CPU") else f"  {us:.0f}", va="center", color=INK_2, fontsize=8)
        ax.set_yticks(list(y), labels, color=INK)
        ax.invert_yaxis()
        ax.set_title(title, loc="left", color=INK, fontsize=10)
        ax.set_xlim(0, max(alloc) * 1.18)
    axes[1].legend(frameon=False, fontsize=8, loc="lower right", labelcolor=INK_2)
    fig.suptitle("Experiment 7 - allocated vs used, before and after right-sizing", x=0.01, ha="left", color=INK, fontsize=11)
    fig.tight_layout()
    fig.savefig(CHARTS / "exp7_allocated_vs_used.png", dpi=150)
    plt.close(fig)
    return lines


def exp8(prices: dict) -> list[str]:
    data = json.loads((RESULTS / "exp8.json").read_text())
    ec2 = prices["ec2_on_demand_linux"]
    surplus_rate = prices["t3_unlimited_surplus_usd_per_vcpu_hour"]["value"]
    rows = []
    for r in data["runs"]:
        inst = ec2[r["instance"]]
        base = inst["usd_per_hour"]
        surplus = 0.0
        if "t3_baseline_per_vcpu" in inst and "(burst)" in r["name"] and not r.get("failed"):
            # T3 unlimited: sustained use above the baseline is billed per vCPU-hour.
            baseline_cores = inst["vcpu"] * inst["t3_baseline_per_vcpu"]
            surplus = max(0.0, r["cpu_avg_cores"] - baseline_cores) * surplus_rate
        hourly = base + surplus
        ok, why = passes(r)
        per_million = hourly / (r["achieved_rps"] * 3600) * 1e6 if not r.get("failed") and r.get("achieved_rps") else math.nan
        rows.append({**r, "base": base, "surplus": surplus, "hourly": hourly, "ok": ok, "why": why,
                     "monthly": hourly * prices["hours_per_month"], "per_million": per_million})

    winner = min((x for x in rows if x["ok"]), key=lambda x: x["hourly"], default=None)
    lines = [
        "EXPERIMENT 8 - FINOPS PRINCIPLES AND INSTANCE-TYPE COMPARISON",
        "=" * 70,
        "",
        f"Workload: {data['rate']} requests/s for 30 s (same mix as experiment 7) + 500-TLE batch job x3.",
        "Workers = vCPUs (2 or 4). One worker saturates at ~15-18 req/s, so this load needs at least 2.",
        f"Performance target (set before running): p95 <= {TARGET['p95_ms']:.0f} ms, errors < 1%, dropped < 1%,",
        f"batch of 500 TLEs <= {TARGET['batch_s']:.0f} s, no out-of-memory kill.",
        "Instance shapes are simulated locally with Docker CPU quotas + memory limits.",
        "'burst' = T3 running at full vCPU (unlimited mode, surplus CPU billed at $0.05/vCPU-h);",
        "'baseline' = T3 in standard mode after credits run out (CPU capped at its baseline).",
        "Costs use AWS Mumbai on-demand Linux list prices; nothing was deployed or paid for.",
        "",
        f"{'Configuration':22}{'vCPU':>5}{'Mem':>7}{'p95':>9}{'Err':>7}{'CPU avg':>8}{'Mem pk':>8}"
        f"{'Batch':>7}{'$/hour':>9}{'$/month':>9}{'$/1M req':>9}  Result",
    ]
    for x in rows:
        if x.get("failed"):
            lines.append(f"{x['name']:22}{x['cpus']:>5g}{x['mem']:>7}{'-':>9}{'-':>7}{'-':>8}{'-':>8}{'-':>7}"
                         f"{x['hourly']:>9.4f}{x['monthly']:>9.2f}{'-':>9}  FAIL: {x['why']}")
            continue
        mem_peak = max(x["mem_max_mib"], x["batch_mem_max_mib"], x["startup_mem_max_mib"])
        lines.append(
            f"{x['name']:22}{x['cpus']:>5g}{x['mem']:>7}{fmt_ms(x['lat_p95_ms']):>9}{x['error_rate']:>7.1%}"
            f"{x['cpu_avg_cores']:>8.2f}{mem_peak:>8.0f}{median_batch(x):>7.2f}{x['hourly']:>9.4f}"
            f"{x['monthly']:>9.2f}{x['per_million']:>9.3f}  {'PASS' if x['ok'] else 'FAIL'}: {x['why']}"
        )
    lines.append("")
    lines.append("$/hour for T3 burst rows = on-demand price + surplus CPU charge, assuming this load runs 24/7.")
    lines.append("")
    lines.append("Findings")
    if winner:
        lines.append(f"- Most cost-efficient option that meets the target: {winner['name']} at "
                     f"${winner['hourly']:.4f}/hour (${winner['monthly']:.2f}/month), "
                     f"of which ${winner['surplus']:.4f}/hour is surplus-CPU charge.")
    else:
        lines.append("- No configuration met the target.")
    passing = sorted((x for x in rows if x["ok"]), key=lambda x: x["hourly"])
    if len(passing) > 1:
        lines.append(f"- Most expensive passing option: {passing[-1]['name']} at ${passing[-1]['monthly']:.2f}/month "
                     f"({passing[-1]['monthly'] / passing[0]['monthly']:.1f}x the cheapest) for similar latency.")
    for x in rows:
        if not x["ok"]:
            lines.append(f"- {x['name']} fails: {x['why']}.")
    bursts = [x for x in rows if x["surplus"] > 0]
    if bursts:
        lines.append("- T3 unlimited surplus charges (sustained load above the CPU baseline) as a share of the bill:")
        for x in bursts:
            lines.append(f"    {x['name']:20} on-demand ${x['base']:.4f}/h + surplus ${x['surplus']:.4f}/h "
                         f"({x['surplus'] / x['hourly']:.0%} of ${x['hourly']:.4f}/h)")
        lines.append("  A smaller T3 has a lower baseline, so under sustained load it can cost more than the next size up.")
    lines += [
        "",
        "Caveats",
        "- Each configuration was run once (30 s measured after a 20 s warm-up), and results are reported as measured.",
        "  t3.small (burst) has the same vCPU count as t3.micro (burst) and t3.medium (burst), which passed;",
        "  with one run per configuration this outlier can't be separated from interference on the host.",
        "- Simulated instances share one host CPU model; real T3/C6i/M6i CPUs differ in speed.",
        "- Surplus-credit cost assumes the measured load runs 24/7; with idle periods T3 earns credits back.",
        "",
    ]

    # Charts: p95 latency (log scale, target line) and monthly cost (stacked).
    order = list(reversed(rows))
    names = [x["name"] for x in order]
    fig, ax = plt.subplots(figsize=(8.5, 4.6), facecolor=SURFACE)
    style(ax)
    vals = [x["lat_p95_ms"] if not x.get("failed") else math.nan for x in order]
    ax.barh(names, [v if v == v else 0 for v in vals], height=0.6, color=BLUE)
    ax.set_xscale("log")
    ax.axvline(TARGET["p95_ms"], color=INK_2, linestyle="--", linewidth=1)
    ax.text(TARGET["p95_ms"], len(names) - 0.4, f" target {TARGET['p95_ms']:.0f} ms", color=INK_2, fontsize=8)
    for i, (v, x) in enumerate(zip(vals, order)):
        label = "did not start" if v != v else f" {fmt_ms(v)}  {'PASS' if x['ok'] else 'FAIL'}"
        ax.text(v if v == v else 1, i, label, va="center", color=INK_2, fontsize=8)
    ax.set_xlabel("p95 latency (ms, log scale)", color=MUTED, fontsize=9)
    ax.tick_params(axis="y", colors=INK)
    ax.set_title(f"Experiment 8 - p95 latency at {data['rate']} req/s", loc="left", color=INK, fontsize=11)
    fig.tight_layout()
    fig.savefig(CHARTS / "exp8_latency.png", dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8.5, 4.6), facecolor=SURFACE)
    style(ax)
    base = [x["base"] * prices["hours_per_month"] for x in order]
    extra = [x["surplus"] * prices["hours_per_month"] for x in order]
    ax.barh(names, base, height=0.6, color=BLUE, label="On-demand price")
    ax.barh(names, extra, left=base, height=0.6, color=ORANGE, label="T3 surplus CPU charge")
    for i, x in enumerate(order):
        mark = "PASS" if x["ok"] else "FAIL"
        star = "  <- cheapest that meets target" if winner and x is winner else ""
        ax.text(base[i] + extra[i], i, f" ${x['monthly']:.2f}  {mark}{star}", va="center", color=INK_2, fontsize=8)
    ax.set_xlim(0, max(b + e for b, e in zip(base, extra)) * 1.6)
    ax.set_xlabel("USD per month (730 h)", color=MUTED, fontsize=9)
    ax.tick_params(axis="y", colors=INK)
    ax.legend(frameon=False, fontsize=8, loc="center right", labelcolor=INK_2)
    ax.set_title("Experiment 8 - monthly cost per configuration (Mumbai list prices)", loc="left", color=INK, fontsize=11)
    fig.tight_layout()
    fig.savefig(CHARTS / "exp8_cost.png", dpi=150)
    plt.close(fig)
    return lines


def main() -> None:
    CHARTS.mkdir(exist_ok=True)
    prices = json.loads((HERE / "prices.json").read_text())
    host = json.loads((RESULTS / "exp8.json").read_text())["host"]
    header = [
        "ORBITVIEW - CLOUD LAB EXPERIMENTS 7 AND 8 (LOCAL SIMULATION)",
        "=" * 70,
        "",
        "System under test: the OrbitView prediction service (ml-service: FastAPI + scikit-learn",
        "re-entry models), running in Docker on this PC. Load generated with k6 0.54.0 from a",
        "container on the same Docker network. Small subset of data: 200 TLEs for online",
        "requests, 500 TLEs for the batch job.",
        f"Host: {host} (Docker Desktop / WSL2).",
        "",
        "What is measured vs simulated",
        "- MEASURED on this machine: latency, errors, throughput, CPU and memory use, batch time.",
        "- SIMULATED: cloud instance types (Docker CPU quota + memory limit with the same vCPU",
        "  count and RAM). Real instances differ in CPU model, clock speed and network.",
        "- CALCULATED: costs, from public AWS Mumbai list prices (prices.json). No cloud",
        "  resources were created and nothing was paid for.",
        "",
        "Findings made while setting up the measurements (kept as results):",
        "- With no limits and model threading on all 12 host CPUs, 50 req/s made the service",
        "  burn 6 cores and time out 97% of requests (thread oversubscription). Fix: one",
        "  OpenMP thread per prediction (OMP_NUM_THREADS=1).",
        "- Re-scoring the whole catalogue blocked request handling for seconds. Fix: run it on a",
        "  worker thread.",
        "- Each prediction costs ~35 ms of CPU (4 tree-ensemble models, 400-500 trees each),",
        "  so one worker process saturates at ~15-18 req/s regardless of vCPUs.",
        "",
    ]
    text = header + exp7(prices) + exp8(prices) + [
        "Charts: experiments/finops/charts/exp7_allocated_vs_used.png, exp8_latency.png, exp8_cost.png",
        "Raw data: experiments/finops/results/*.json (k6 summaries and per-run measurements)",
        "Reproduce: ml-service/.venv/Scripts/python experiments/finops/run_experiments.py all",
        "           ml-service/.venv/Scripts/python experiments/finops/analyze.py",
    ]
    REPORT.write_text("\n".join(text) + "\n", encoding="utf-8")
    print("\n".join(text))


if __name__ == "__main__":
    main()
