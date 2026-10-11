import * as THREE from "three";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { Feature, MultiLineString, MultiPolygon, Polygon, Position } from "geojson";

type CountryProps = { name: string };
type CountryTopology = Topology<{ countries: GeometryCollection<CountryProps> }>;

const OCEAN_TOP = "#0b2f5e";
const OCEAN_BOTTOM = "#082448";
const BORDER = "rgba(226, 240, 255, 0.55)";
const COAST = "rgba(160, 225, 255, 0.85)";
const GRATICULE = "rgba(120, 190, 255, 0.10)";

// Muted land palette; each country picks one by name hash so neighbours differ.
const LAND_PALETTE = ["#3f6b4a", "#4a7550", "#55784a", "#5f7f55", "#4d6e5a", "#6b7d4f"];

/**
 * Renders an equirectangular world map (countries, borders, names) onto a
 * canvas. Left edge = 180°W, matching THREE.SphereGeometry UVs and
 * geodeticToVector3 (lon 0 → +x).
 */
export async function createEarthTexture(maxTextureSize: number): Promise<THREE.CanvasTexture> {
  const topo = (await import("world-atlas/countries-50m.json")).default as unknown as CountryTopology;
  const countries = feature(topo, topo.objects.countries).features as Feature<
    Polygon | MultiPolygon,
    CountryProps
  >[];

  const width = Math.min(4096, maxTextureSize);
  const height = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const px = (lon: number) => ((lon + 180) / 360) * width;
  const py = (lat: number) => ((90 - lat) / 180) * height;

  const ocean = ctx.createLinearGradient(0, 0, 0, height);
  ocean.addColorStop(0, OCEAN_TOP);
  ocean.addColorStop(0.5, OCEAN_BOTTOM);
  ocean.addColorStop(1, OCEAN_TOP);
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, width, height);

  // 15° graticule.
  ctx.strokeStyle = GRATICULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 15) {
    ctx.moveTo(px(lon), 0);
    ctx.lineTo(px(lon), height);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    ctx.moveTo(0, py(lat));
    ctx.lineTo(width, py(lat));
  }
  ctx.stroke();

  const lineScale = width / 4096;
  const labels: { name: string; lon: number; lat: number; area: number }[] = [];

  for (const country of countries) {
    if (!country.geometry) continue;
    const polygons =
      country.geometry.type === "Polygon"
        ? [country.geometry.coordinates]
        : country.geometry.coordinates;

    ctx.beginPath();
    let largest: { ring: Position[]; area: number } | null = null;
    for (const polygon of polygons) {
      polygon.forEach((rawRing, ringIdx) => {
        const ring = unwrapRing(rawRing);
        for (const offset of wrapOffsets(ring)) traceRing(ctx, ring, offset, px, py);
        if (ringIdx === 0) {
          const area = Math.abs(ringArea(ring));
          if (!largest || area > largest.area) largest = { ring, area };
        }
      });
    }
    ctx.fillStyle = LAND_PALETTE[hash(country.properties.name) % LAND_PALETTE.length];
    ctx.fill("evenodd");

    const big = largest as { ring: Position[]; area: number } | null;
    if (big && big.area > 18) {
      const [lon, lat] = ringCentroid(big.ring);
      labels.push({ name: country.properties.name, lon: normalizeLon(lon), lat, area: big.area });
    }
  }

  // Arcs shared by two countries are borders; unshared arcs are coastlines.
  const obj = topo.objects.countries;
  strokeLines(ctx, mesh(topo, obj, (a, b) => a !== b), px, py, BORDER, 1.1 * lineScale);
  strokeLines(ctx, mesh(topo, obj, (a, b) => a === b), px, py, COAST, 0.9 * lineScale);

  // Country names, compensating for horizontal stretch at high latitudes.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of labels) {
    const size = THREE.MathUtils.clamp(Math.sqrt(l.area) * 1.1, 9, 22) * lineScale;
    const stretch = 1 / Math.max(0.25, Math.cos(THREE.MathUtils.degToRad(l.lat)));
    ctx.save();
    ctx.translate(px(l.lon), py(l.lat));
    ctx.scale(stretch, 1);
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
    ctx.lineWidth = 3 * lineScale;
    ctx.strokeStyle = "rgba(4, 12, 24, 0.7)";
    ctx.strokeText(l.name, 0, 0);
    ctx.fillStyle = "rgba(240, 248, 255, 0.92)";
    ctx.fillText(l.name, 0, 0);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** Makes longitudes continuous across the antimeridian (values may leave ±180). */
function unwrapRing(ring: Position[]): Position[] {
  const out: Position[] = [];
  for (const [lon0, lat] of ring) {
    let lon = lon0;
    if (out.length) {
      const prev = out[out.length - 1][0];
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
    }
    out.push([lon, lat]);
  }
  // A ring circling a pole (Antarctica) doesn't close in longitude; close it via the pole.
  if (isPolarRing(out)) {
    const first = out[0];
    const last = out[out.length - 1];
    const pole = averageLat(out) > 0 ? 90 : -90;
    out.push([last[0], pole], [first[0], pole]);
  }
  return out;
}

function isPolarRing(ring: Position[]): boolean {
  return Math.abs(ring[ring.length - 1][0] - ring[0][0]) > 180;
}

function wrapOffsets(ring: Position[]): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const [lon] of ring) {
    if (lon < min) min = lon;
    if (lon > max) max = lon;
  }
  const offsets = [0];
  if (min < -180) offsets.push(360);
  if (max > 180) offsets.push(-360);
  return offsets;
}

function traceRing(
  ctx: CanvasRenderingContext2D,
  ring: Position[],
  offset: number,
  px: (lon: number) => number,
  py: (lat: number) => number
): void {
  ring.forEach(([lon, lat], i) => {
    if (i === 0) ctx.moveTo(px(lon + offset), py(lat));
    else ctx.lineTo(px(lon + offset), py(lat));
  });
  ctx.closePath();
}

function strokeLines(
  ctx: CanvasRenderingContext2D,
  lines: MultiLineString,
  px: (lon: number) => number,
  py: (lat: number) => number,
  color: string,
  lineWidth: number
): void {
  ctx.beginPath();
  for (const line of lines.coordinates) {
    line.forEach(([lon, lat], i) => {
      // Lift the pen where a line hops across the antimeridian.
      if (i === 0 || Math.abs(lon - line[i - 1][0]) > 180) ctx.moveTo(px(lon), py(lat));
      else ctx.lineTo(px(lon), py(lat));
    });
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function ringArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

function ringCentroid(ring: Position[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  if (a === 0) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

function averageLat(ring: Position[]): number {
  return ring.reduce((s, p) => s + p[1], 0) / ring.length;
}

function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Text sprite for continent names, floating just above the surface. */
export function createLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `700 76px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "14px";
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(255, 214, 140, 0.95)";
  ctx.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // No depth test: the globe would clip labels near the limb. Globe.tsx hides far-side ones.
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.48, 0.075, 1);
  return sprite;
}
