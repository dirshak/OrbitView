import { describe, it, expect } from "vitest";
import { parseTleText, EMBEDDED_FALLBACK_TLES } from "./tle";

const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00012345  00000-0  22000-3 0  9990
2 25544  51.6400 100.0000 0006000  90.0000 270.0000 15.50000000300000`;

describe("parseTleText", () => {
  it("parses a single ISS TLE into a satellite record", () => {
    const records = parseTleText(ISS_TLE, {
      category: "iss",
      dataSource: "test",
      operator: "NASA",
    });

    expect(records).toHaveLength(1);
    const iss = records[0];
    expect(iss.noradId).toBe(25544);
    expect(iss.name).toBe("ISS (ZARYA)");
    expect(iss.category).toBe("iss");
    expect(iss.operator).toBe("NASA");
    expect(iss.dataSource).toBe("test");
    // mean motion 15.5 rev/day at inclination 51.64 -> low Earth orbit
    expect(iss.orbitType).toBe("LEO");
    expect(iss.tleLine1).toMatch(/^1 25544U/);
    expect(iss.tleLine2).toMatch(/^2 25544/);
  });

  it("classifies a near-geostationary object (low mean motion) as GEO", () => {
    const geo = `SOME GEO SAT
1 99999U 20001A   24001.50000000  .00000000  00000-0  00000-0 0  9990
2 99999  00.0500 100.0000 0006000  90.0000 270.0000 01.00270000300000`;

    const [rec] = parseTleText(geo, {
      category: "communication",
      dataSource: "test",
    });
    expect(rec.orbitType).toBe("GEO");
  });

  it("ignores malformed input that lacks valid TLE line prefixes", () => {
    const records = parseTleText("not a tle\njust some text\nmore text", {
      category: "other",
      dataSource: "test",
    });
    expect(records).toHaveLength(0);
  });

  it("skips a dangling name line with no element lines following it", () => {
    const records = parseTleText(`${ISS_TLE}\nDANGLING NAME`, {
      category: "iss",
      dataSource: "test",
    });
    expect(records).toHaveLength(1);
  });
});

describe("EMBEDDED_FALLBACK_TLES", () => {
  it("includes the ISS as an offline fallback object", () => {
    const iss = EMBEDDED_FALLBACK_TLES.find((s) => s.noradId === 25544);
    expect(iss).toBeDefined();
    expect(iss?.name).toContain("ISS");
  });

  it("provides every fallback record with both TLE lines", () => {
    for (const sat of EMBEDDED_FALLBACK_TLES) {
      expect(sat.tleLine1.startsWith("1 ")).toBe(true);
      expect(sat.tleLine2.startsWith("2 ")).toBe(true);
    }
  });
});
