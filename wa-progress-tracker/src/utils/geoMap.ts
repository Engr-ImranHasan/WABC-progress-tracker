import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { KmlOverlayLine, WbNodeRecord } from '../types';

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface ProjectedViewport {
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  project: (lat: number, lon: number) => { x: number; y: number };
}

// Web Mercator normalized [0..1]
export function latLonToNorm(lat: number, lon: number): { nx: number; ny: number } {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const nx = (lon + 180) / 360;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const ny = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { nx, ny };
}

export function normToLatLon(nx: number, ny: number): { lat: number; lon: number } {
  const lon = nx * 360 - 180;
  const n = Math.PI - 2 * Math.PI * ny;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lon };
}

export function buildGeoViewport(
  points: Array<{ lat: number; lon: number }>,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  padFrac = 0.12
): ProjectedViewport {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (valid.length === 0) {
    const center = latLonToNorm(23.705, 90.435);
    return {
      boxX,
      boxY,
      boxW,
      boxH,
      minX: center.nx - 0.0001,
      maxX: center.nx + 0.0001,
      minY: center.ny - 0.0001,
      maxY: center.ny + 0.0001,
      project: () => ({ x: boxX + boxW / 2, y: boxY + boxH / 2 }),
    };
  }

  let rawMinX = Infinity;
  let rawMaxX = -Infinity;
  let rawMinY = Infinity;
  let rawMaxY = -Infinity;

  for (const p of valid) {
    const { nx, ny } = latLonToNorm(p.lat, p.lon);
    if (nx < rawMinX) rawMinX = nx;
    if (nx > rawMaxX) rawMaxX = nx;
    if (ny < rawMinY) rawMinY = ny;
    if (ny > rawMaxY) rawMaxY = ny;
  }

  const dx = Math.max(1e-6, rawMaxX - rawMinX);
  const dy = Math.max(1e-6, rawMaxY - rawMinY);

  // Add padding around points
  const padX = dx * padFrac;
  const padY = dy * padFrac;
  const pMinX = rawMinX - padX;
  const pMaxX = rawMaxX + padX;
  const pMinY = rawMinY - padY;
  const pMaxY = rawMaxY + padY;

  const spanX = pMaxX - pMinX;
  const spanY = pMaxY - pMinY;
  const targetAspect = boxW / Math.max(1, boxH);
  const dataAspect = spanX / spanY;

  let minX = pMinX;
  let maxX = pMaxX;
  let minY = pMinY;
  let maxY = pMaxY;

  if (dataAspect > targetAspect) {
    const targetSpanY = spanX / targetAspect;
    const extraY = (targetSpanY - spanY) / 2;
    minY -= extraY;
    maxY += extraY;
  } else {
    const targetSpanX = spanY * targetAspect;
    const extraX = (targetSpanX - spanX) / 2;
    minX -= extraX;
    maxX += extraX;
  }

  const finalSpanX = maxX - minX;
  const finalSpanY = maxY - minY;

  return {
    boxX,
    boxY,
    boxW,
    boxH,
    minX,
    maxX,
    minY,
    maxY,
    project: (lat: number, lon: number) => {
      const { nx, ny } = latLonToNorm(lat, lon);
      return {
        x: boxX + ((nx - minX) / finalSpanX) * boxW,
        y: boxY + ((ny - minY) / finalSpanY) * boxH,
      };
    },
  };
}

export interface WbPolylineSplit {
  prevPoints: Array<{ lat: number; lon: number }>;
  currPoints: Array<{ lat: number; lon: number }>;
  remainingPoints: Array<{ lat: number; lon: number }>;
  tipPoint: { lat: number; lon: number; chainageM: number };
}

function interpolatePointAtChainage(
  nodes: WbNodeRecord[],
  targetM: number
): { lat: number; lon: number; segIdx: number } {
  if (nodes.length === 0) return { lat: 23.715, lon: 90.43, segIdx: 0 };
  if (targetM <= 0 || nodes.length === 1) {
    return { lat: nodes[0].lat, lon: nodes[0].lon, segIdx: 0 };
  }
  const last = nodes[nodes.length - 1];
  if (targetM >= last.chainageM) {
    return { lat: last.lat, lon: last.lon, segIdx: nodes.length - 1 };
  }
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (targetM >= a.chainageM && targetM <= b.chainageM) {
      const span = b.chainageM - a.chainageM;
      const t = span > 1e-6 ? (targetM - a.chainageM) / span : 0;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        segIdx: i,
      };
    }
  }
  return { lat: last.lat, lon: last.lon, segIdx: nodes.length - 1 };
}

function sliceNodesBetween(
  nodes: WbNodeRecord[],
  startM: number,
  endM: number
): Array<{ lat: number; lon: number }> {
  if (nodes.length === 0 || endM < startM) return [];
  const startPt = interpolatePointAtChainage(nodes, startM);
  const endPt = interpolatePointAtChainage(nodes, endM);
  const out: Array<{ lat: number; lon: number }> = [
    { lat: startPt.lat, lon: startPt.lon },
  ];
  for (const n of nodes) {
    if (n.chainageM > startM && n.chainageM < endM) {
      out.push({ lat: n.lat, lon: n.lon });
    }
  }
  out.push({ lat: endPt.lat, lon: endPt.lon });
  return out;
}

export function computeWbPolylineSplit(
  nodes: WbNodeRecord[],
  totalLengthM: number,
  completedLengthM: number,
  prevCompletedLengthM?: number
): WbPolylineSplit {
  if (nodes.length === 0) {
    return {
      prevPoints: [],
      currPoints: [],
      remainingPoints: [],
      tipPoint: { lat: 23.715, lon: 90.43, chainageM: 0 },
    };
  }
  const maxCh = nodes[nodes.length - 1].chainageM || totalLengthM || 1;
  const clampedCur = Math.max(0, Math.min(maxCh, completedLengthM));
  const clampedPrev =
    prevCompletedLengthM !== undefined
      ? Math.max(0, Math.min(clampedCur, prevCompletedLengthM))
      : clampedCur;

  const tip = interpolatePointAtChainage(nodes, clampedCur);

  const prevPoints =
    clampedPrev > 0 ? sliceNodesBetween(nodes, 0, clampedPrev) : [];
  const currPoints =
    clampedCur > clampedPrev
      ? sliceNodesBetween(nodes, clampedPrev, clampedCur)
      : [];
  const remainingPoints =
    clampedCur < maxCh ? sliceNodesBetween(nodes, clampedCur, maxCh) : [];

  return {
    prevPoints,
    currPoints,
    remainingPoints,
    tipPoint: { lat: tip.lat, lon: tip.lon, chainageM: clampedCur },
  };
}

export function formatDms(deg: number, posHem: string, negHem: string): string {
  const hem = deg >= 0 ? posHem : negHem;
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const remM = (abs - d) * 60;
  const m = Math.floor(remM);
  const s = Math.round((remM - m) * 60);
  if (s === 60) {
    return `${d}°${m + 1}'0"${hem}`;
  }
  return `${d}°${m}'${s}"${hem}`;
}

export function xToLon(xNorm: number): number {
  return xNorm * 360 - 180;
}

export function yToLat(yNorm: number): number {
  const n = Math.PI - 2 * Math.PI * yNorm;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function computeMetersPerSvgUnit(vp: ProjectedViewport): number {
  const midLat = yToLat((vp.minY + vp.maxY) / 2);
  const earthCircumference = 40075016.686;
  const spanMeters =
    earthCircumference *
    Math.cos((midLat * Math.PI) / 180) *
    Math.max(1e-8, vp.maxX - vp.minX);
  return spanMeters / Math.max(1, vp.boxW);
}

/**
 * Fetches CORS-safe Esri navigation street tiles covering `viewport`
 * and bakes them into an inline PNG data URI for crisp SVG + A1 PDF output.
 */
const tileCache = new Map<string, string>();
const tilePromises = new Map<string, Promise<string | null>>();

export function getTileCacheKey(
  viewport: ProjectedViewport,
  style: 'voyager' | 'light' | 'cad',
  outW: number,
  outH: number
): string {
  return `v16|${style}|${viewport.minX.toFixed(6)}|${viewport.maxX.toFixed(6)}|${viewport.minY.toFixed(6)}|${viewport.maxY.toFixed(6)}|${outW}x${outH}`;
}

export async function ensureMapTileSnapshot(
  viewport: ProjectedViewport,
  style: 'voyager' | 'light' | 'cad',
  outW = 900,
  outH = 640
): Promise<string | null> {
  if (style === 'cad') return null;
  const key = getTileCacheKey(viewport, style, outW, outH);
  const existing = tileCache.get(key);
  if (existing) return existing;
  const inflight = tilePromises.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const spanX = Math.max(1e-7, viewport.maxX - viewport.minX);
      let z = Math.round(Math.log2(outW / (256 * spanX)));
      z = Math.max(12, Math.min(17, z));

      const worldPx = 256 * Math.pow(2, z);
      const txMin = Math.floor((viewport.minX * worldPx) / 256);
      const txMax = Math.floor((viewport.maxX * worldPx) / 256);
      const tyMin = Math.floor((viewport.minY * worldPx) / 256);
      const tyMax = Math.floor((viewport.maxY * worldPx) / 256);

      if ((txMax - txMin + 1) * (tyMax - tyMin + 1) > 64) {
        z = Math.max(12, z - 1);
      }

      const nTiles = Math.pow(2, z);
      const wPx = 256 * nTiles;
      const xStart = viewport.minX * wPx;
      const xEnd = viewport.maxX * wPx;
      const yStart = viewport.minY * wPx;
      const yEnd = viewport.maxY * wPx;

      const tX0 = Math.floor(xStart / 256);
      const tX1 = Math.floor(xEnd / 256);
      const tY0 = Math.floor(yStart / 256);
      const tY1 = Math.floor(yEnd / 256);

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, outW, outH);

      const jobs: Promise<void>[] = [];
      let loadedAny = false;

      for (let tx = tX0; tx <= tX1; tx++) {
        for (let ty = tY0; ty <= tY1; ty++) {
          const wrappedX = ((tx % nTiles) + nTiles) % nTiles;
          if (ty < 0 || ty >= nTiles) continue;
          const url =
            style === 'light'
              ? `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${ty}/${wrappedX}`
              : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${ty}/${wrappedX}`;
          jobs.push(
            new Promise<void>((resolve) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              const timer = setTimeout(() => resolve(), 5500);
              img.onload = () => {
                clearTimeout(timer);
                const tileWorldX = tx * 256;
                const tileWorldY = ty * 256;
                const dx = ((tileWorldX - xStart) / (xEnd - xStart)) * outW;
                const dy = ((tileWorldY - yStart) / (yEnd - yStart)) * outH;
                const dw = (256 / (xEnd - xStart)) * outW;
                const dh = (256 / (yEnd - yStart)) * outH;
                ctx.drawImage(img, dx, dy, dw + 0.6, dh + 0.6);
                loadedAny = true;
                resolve();
              };
              img.onerror = () => {
                clearTimeout(timer);
                resolve();
              };
              img.src = url;
            })
          );
        }
      }

      await Promise.all(jobs);
      if (loadedAny) {
        // Apply crisp professional cool-neutral cartographic grading on Esri World_Street_Map
        // so yellow/orange/red basemap tints never overpower colored pipeline overlays.
        if (style === 'voyager') {
          try {
            const imgData = ctx.getImageData(0, 0, outW, outH);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
              const r = d[i];
              const g = d[i + 1];
              const b = d[i + 2];
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              const isWater = b - r > 12 && b > 140;
              const isLabelOrOutline = lum < 135;
              if (isWater) {
                d[i] = Math.round(lum * 0.7 + 210 * 0.3);
                d[i + 1] = Math.round(lum * 0.7 + 228 * 0.3);
                d[i + 2] = Math.round(lum * 0.64 + 246 * 0.36);
              } else if (isLabelOrOutline) {
                const nr = Math.round(lum * 0.88 + r * 0.12);
                d[i] = nr;
                d[i + 1] = nr;
                d[i + 2] = Math.min(255, nr + 4);
              } else {
                const sat = 0.14;
                let nr = lum + (r - lum) * sat;
                let ng = lum + (g - lum) * sat;
                let nb = lum + (b - lum) * sat;
                nr = 255 - (255 - nr) * 0.66;
                ng = 255 - (255 - ng) * 0.65;
                nb = Math.min(255, 255 - (255 - nb) * 0.62 + 2);
                d[i] = Math.round(nr);
                d[i + 1] = Math.round(ng);
                d[i + 2] = Math.round(nb);
              }
            }
            ctx.putImageData(imgData, 0, 0);
          } catch {
            // Fallback subtle light wash if pixel read is restricted
            ctx.fillStyle = 'rgba(248, 250, 252, 0.35)';
            ctx.fillRect(0, 0, outW, outH);
          }
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.fillRect(0, 0, outW, outH);
        }
        const url = canvas.toDataURL('image/png');
        tileCache.set(key, url);
        return url;
      }
      return null;
    } catch {
      return null;
    } finally {
      tilePromises.delete(key);
    }
  })();

  tilePromises.set(key, p);
  return p;
}

export function useMapTileSnapshot(
  viewport: ProjectedViewport,
  enabled: boolean,
  style: 'voyager' | 'light' | 'cad',
  outW = 900,
  outH = 640
): string | null {
  const key = getTileCacheKey(viewport, style, outW, outH);
  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    enabled && style !== 'cad' ? tileCache.get(key) || null : null
  );

  useEffect(() => {
    if (!enabled || style === 'cad') {
      setDataUrl(null);
      return;
    }
    const cached = tileCache.get(key);
    if (cached) {
      setDataUrl(cached);
      return;
    }

    let cancelled = false;
    ensureMapTileSnapshot(viewport, style, outW, outH).then((url) => {
      if (!cancelled && url) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled, style, outW, outH, viewport]);

  return dataUrl;
}

export interface ParsedKmlResult {
  points: Array<{ name: string; lat: number; lon: number }>;
  lines: KmlOverlayLine[];
}

function parseKmlCoordString(raw: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const tokens = raw.trim().split(/\s+/);
  for (const tok of tokens) {
    const parts = tok.split(',');
    if (parts.length >= 2) {
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        out.push([lat, lon]);
      }
    }
  }
  return out;
}

export async function parseKmlOrKmzOrCsvFile(file: File): Promise<ParsedKmlResult> {
  const lower = file.name.toLowerCase();

  // Support CSV too (Name,Latitude,Longitude)
  if (lower.endsWith('.csv')) {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    const rows = text.split(/\r?\n/).filter((l) => l.trim());
    const points: Array<{ name: string; lat: number; lon: number }> = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i].split(',').map((c) => c.trim());
      if (cols.length >= 3) {
        const lat = Number(cols[1]);
        const lon = Number(cols[2]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          points.push({ name: cols[0], lat, lon });
        }
      }
    }
    return {
      points,
      lines:
        points.length >= 2
          ? [{ name: file.name, coords: points.map((p) => [p.lat, p.lon]) }]
          : [],
    };
  }

  let kmlText = '';
  if (lower.endsWith('.kmz')) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const kmlEntry =
      zip.file('doc.kml') ||
      Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml'));
    if (!kmlEntry) {
      throw new Error('No KML found inside KMZ archive');
    }
    kmlText = await kmlEntry.async('text');
  } else {
    kmlText = await file.text();
  }

  const doc = new DOMParser().parseFromString(kmlText, 'text/xml');
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
  const points: Array<{ name: string; lat: number; lon: number }> = [];
  const lines: KmlOverlayLine[] = [];

  for (const pm of placemarks) {
    const nameEl = pm.getElementsByTagName('name')[0];
    const pmName = nameEl?.textContent?.trim() || 'Point';

    const ptCoords = pm.getElementsByTagName('Point');
    for (let i = 0; i < ptCoords.length; i++) {
      const cText = ptCoords[i].getElementsByTagName('coordinates')[0]?.textContent || '';
      const parsed = parseKmlCoordString(cText);
      if (parsed.length > 0) {
        points.push({ name: pmName, lat: parsed[0][0], lon: parsed[0][1] });
      }
    }

    const lsCoords = pm.getElementsByTagName('LineString');
    for (let i = 0; i < lsCoords.length; i++) {
      const cText = lsCoords[i].getElementsByTagName('coordinates')[0]?.textContent || '';
      const parsed = parseKmlCoordString(cText);
      if (parsed.length >= 2) {
        lines.push({ name: pmName, coords: parsed });
      }
    }
  }

  return { points, lines };
}

export interface LabelRectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLabelInput {
  id: string;
  text: string;
  px: number;
  py: number;
  markerRadius: number;
  priority?: number;
  preferredSide?: 'auto' | 'right' | 'left' | 'top' | 'bottom';
  mustPlace?: boolean;
}

export interface PlacedMapLabel {
  id: string;
  text: string;
  px: number;
  py: number;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  textX: number;
  textY: number;
  textAnchor: 'start' | 'middle' | 'end';
  leaderX2: number;
  leaderY2: number;
  needsLeader: boolean;
}

function rectsOverlap(a: LabelRectBox, b: LabelRectBox, pad = 1.8): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

function distPointToSegSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return (px - ax) * (px - ax) + (py - ay) * (py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

export function layoutMapLabels(
  items: MapLabelInput[],
  bounds: LabelRectBox,
  options?: {
    fontSize?: number;
    blockedBoxes?: LabelRectBox[];
    polylinePoints?: Array<{ x: number; y: number }>;
    padding?: number;
    maxTier?: 2 | 3;
  }
): Map<string, PlacedMapLabel> {
  const fontSize = options?.fontSize ?? 6.8;
  const pad = options?.padding ?? 1.8;
  const maxTier = options?.maxTier ?? 3;
  const linePts = options?.polylinePoints ?? [];
  const charW = fontSize * 0.56;
  const boxH = fontSize + 3.4;

  // Obstacle boxes: every marker + caller-provided obstacles (legend, north arrow, SPS, etc.)
  const obstacles: LabelRectBox[] = [...(options?.blockedBoxes ?? [])];
  for (const it of items) {
    const mr = Math.max(3, it.markerRadius) + 2.0;
    obstacles.push({
      x: it.px - mr,
      y: it.py - mr,
      w: mr * 2,
      h: mr * 2,
    });
  }

  const placedBoxes: LabelRectBox[] = [];
  const result = new Map<string, PlacedMapLabel>();

  // Highest priority placed first; tie-break favors endpoints then even spread
  const ordered = [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const it of ordered) {
    const boxW = Math.max(18, it.text.length * charW + 5.2);
    const r = Math.max(3, it.markerRadius);

    interface Candidate {
      boxX: number;
      boxY: number;
      tierPenalty: number;
      dirTag: string;
    }

    const tiers = maxTier === 3 ? [r + 4.5, r + 13.5, r + 24.5] : [r + 4.5, r + 13.5];
    const candidates: Candidate[] = [];

    tiers.forEach((gap, tierIdx) => {
      const tp = tierIdx * 35;
      // Compute candidate boxes in 8 clean cartographic placements around (px, py)
      const cList: Array<{ bx: number; by: number; dir: string; prefBonus: number }> = [
        { bx: it.px + gap, by: it.py - boxH / 2, dir: 'right', prefBonus: it.preferredSide === 'right' ? -12 : 0 },
        { bx: it.px - gap - boxW, by: it.py - boxH / 2, dir: 'left', prefBonus: it.preferredSide === 'left' ? -12 : 0 },
        { bx: it.px - boxW / 2, by: it.py - gap - boxH, dir: 'top', prefBonus: it.preferredSide === 'top' ? -12 : 2 },
        { bx: it.px - boxW / 2, by: it.py + gap, dir: 'bottom', prefBonus: it.preferredSide === 'bottom' ? -12 : 2 },
        { bx: it.px + gap * 0.78, by: it.py - gap * 0.78 - boxH, dir: 'tr', prefBonus: 5 },
        { bx: it.px - gap * 0.78 - boxW, by: it.py - gap * 0.78 - boxH, dir: 'tl', prefBonus: 5 },
        { bx: it.px + gap * 0.78, by: it.py + gap * 0.78, dir: 'br', prefBonus: 6 },
        { bx: it.px - gap * 0.78 - boxW, by: it.py + gap * 0.78, dir: 'bl', prefBonus: 6 },
      ];
      for (const c of cList) {
        candidates.push({
          boxX: c.bx,
          boxY: c.by,
          tierPenalty: tp + c.prefBonus,
          dirTag: c.dir,
        });
      }
    });

    let best: { cand: Candidate; score: number; clean: boolean } | null = null;

    for (const cand of candidates) {
      const box: LabelRectBox = { x: cand.boxX, y: cand.boxY, w: boxW, h: boxH };

      // Check map boundary strict containment
      if (
        box.x < bounds.x + 2 ||
        box.y < bounds.y + 2 ||
        box.x + box.w > bounds.x + bounds.w - 2 ||
        box.y + box.h > bounds.y + bounds.h - 2
      ) {
        continue;
      }

      let overlapCount = 0;
      for (const ob of obstacles) {
        if (rectsOverlap(box, ob, pad)) overlapCount++;
      }
      for (const pb of placedBoxes) {
        if (rectsOverlap(box, pb, pad)) overlapCount++;
      }

      if (overlapCount > 0 && !it.mustPlace) continue;

      // Polyline proximity penalty so labels sit cleanly off the tunnel line
      let linePenalty = 0;
      if (linePts.length >= 2) {
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        let minD2 = Infinity;
        for (let li = 0; li < linePts.length - 1; li++) {
          const d2 = distPointToSegSq(
            cx,
            cy,
            linePts[li].x,
            linePts[li].y,
            linePts[li + 1].x,
            linePts[li + 1].y
          );
          if (d2 < minD2) minD2 = d2;
        }
        if (minD2 < 100) linePenalty = (10 - Math.sqrt(minD2)) * 2.5;
      }

      const score = overlapCount * 5000 + cand.tierPenalty + linePenalty;
      if (!best || score < best.score) {
        best = { cand, score, clean: overlapCount === 0 };
      }
    }

    if (!best) continue;
    if (!best.clean && !it.mustPlace) continue;

    const chosenBox: LabelRectBox = {
      x: best.cand.boxX,
      y: best.cand.boxY,
      w: boxW,
      h: boxH,
    };
    placedBoxes.push(chosenBox);

    const cx = chosenBox.x + chosenBox.w / 2;
    const cy = chosenBox.y + chosenBox.h / 2;
    const leaderX2 = Math.max(chosenBox.x, Math.min(chosenBox.x + chosenBox.w, it.px));
    const leaderY2 = Math.max(chosenBox.y, Math.min(chosenBox.y + chosenBox.h, it.py));
    const distFromMarker = Math.hypot(cx - it.px, cy - it.py);

    result.set(it.id, {
      id: it.id,
      text: it.text,
      px: it.px,
      py: it.py,
      boxX: chosenBox.x,
      boxY: chosenBox.y,
      boxW: chosenBox.w,
      boxH: chosenBox.h,
      textX: chosenBox.x + chosenBox.w / 2,
      textY: chosenBox.y + chosenBox.h * 0.72,
      textAnchor: 'middle',
      leaderX2,
      leaderY2,
      needsLeader: distFromMarker > r + 15,
    });
  }

  return result;
}

