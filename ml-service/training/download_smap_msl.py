"""Download the NASA SMAP/MSL spacecraft telemetry anomaly dataset.

The original JPL S3 bucket is closed and Kaggle needs a login, so this uses a
Hugging Face mirror of the original .npy files and checks it against JPL's
official label file on GitHub (every test channel's length must match).

Output: data/smap_msl/{train,test}/<channel>.npy, data/smap_msl/labeled_anomalies.csv
Usage:  python training/download_smap_msl.py
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import httpx
import numpy as np

OUT = Path(__file__).resolve().parents[1] / "data" / "smap_msl"
MIRROR = "https://huggingface.co/datasets/appleparan/telemanom/resolve/main/data/data/{split}/{chan}.npy"
LABELS = "https://raw.githubusercontent.com/khundman/telemanom/master/labeled_anomalies.csv"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=60) as client:
        labels_text = client.get(LABELS).raise_for_status().text
        (OUT / "labeled_anomalies.csv").write_text(labels_text)
        rows = list(csv.DictReader(io.StringIO(labels_text)))
        for row in rows:
            chan = row["chan_id"]
            for split in ("train", "test"):
                path = OUT / split / f"{chan}.npy"
                path.parent.mkdir(exist_ok=True)
                if not path.exists():
                    r = client.get(MIRROR.format(split=split, chan=chan)).raise_for_status()
                    path.write_bytes(r.content)
            test_len = np.load(OUT / "test" / f"{chan}.npy").shape[0]
            if test_len != int(row["num_values"]):
                raise SystemExit(f"{chan}: test length {test_len} != official {row['num_values']}")
    print(f"{len(rows)} channels downloaded and verified against the official labels")


if __name__ == "__main__":
    main()
