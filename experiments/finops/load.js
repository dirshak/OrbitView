// k6 workload for the OrbitView prediction service (ml-service).
// Fixed arrival rate, so a slower configuration shows up as higher latency
// and dropped iterations instead of silently sending fewer requests.
//
//   RATE      requests per second (default 50)
//   DURATION  test length (default 60s)
//   TARGET    base URL (default http://ml-service:8000)
//
// Mix: 70% single-TLE prediction (model inference), 20% forecast lookup,
//      10% watch-list query.

import http from "k6/http";
import { check } from "k6";

const TARGET = __ENV.TARGET || "http://ml-service:8000";
const tles = JSON.parse(open("./tles.json"));

export const options = {
  discardResponseBodies: true,
  scenarios: {
    mix: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 50),
      timeUnit: "1s",
      duration: __ENV.DURATION || "60s",
      preAllocatedVUs: 50,
      maxVUs: 400,
    },
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

export default function () {
  const sat = tles[Math.floor(Math.random() * tles.length)];
  const roll = Math.random();
  let res;
  if (roll < 0.7) {
    res = http.post(
      `${TARGET}/ml/reentry/predict`,
      JSON.stringify({ satellites: [sat] }),
      { headers: { "Content-Type": "application/json" }, tags: { endpoint: "predict" }, timeout: "10s" }
    );
  } else if (roll < 0.9) {
    res = http.get(`${TARGET}/ml/reentry/${sat.noradId}`, { tags: { endpoint: "lookup" }, timeout: "10s" });
  } else {
    res = http.get(`${TARGET}/ml/reentry?within_days=30&limit=50`, { tags: { endpoint: "watchlist" }, timeout: "10s" });
  }
  check(res, { "status 200": (r) => r.status === 200 });
}
