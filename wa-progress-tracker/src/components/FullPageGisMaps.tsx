import React, { useMemo } from 'react';
import {
  DEFAULT_AIR_VALVE_COORD,
  DEFAULT_WASHOUT_COORD,
} from '../data/wbcInitialData';
import {
  AppState,
  CustomMapPoint,
  ShaftRecord,
  ShaftSnapshotItem,
  WorkStatus,
} from '../types';
import {
  computeSummary,
  formatDateDisplay,
  getCastingStatus,
  getManholeStatus,
  getRingStatus,
  getShaftStatus,
  getTunnelStatus,
  resolveDisplayContext,
} from '../utils/calculations';
import {
  buildGeoViewport,
  computeMetersPerSvgUnit,
  computeWbPolylineSplit,
  formatDms,
  ProjectedViewport,
  useMapTileSnapshot,
  xToLon,
  yToLat,
} from '../utils/geoMap';

// ISO A1 Portrait geometry (594 x 841 mm -> 1188 x 1682 viewBox)
export const FULL_MAP_FRAME = {
  x: 44,
  y: 86,
  w: 1100,
  h: 1558,
  padRatio: 0.09,
  tileOutW: 1120,
  tileOutH: 1594,
};

type MapKind = 'wa-map' | 'wb-map' | 'wc-map';

interface FullPageGisMapProps {
  kind: MapKind;
  state: AppState;
  svgRef: React.Ref<SVGSVGElement>;
  selectedShaftId?: string;
  onSelectShaft?: (id: string, focus?: 'shaft' | 'manhole' | 'tunnel') => void;
  onSelectWbNode?: (id: string) => void;
}

const SHEET_W = 1188;
const SHEET_H = 1682;

const GIS_GREEN = '#16a34a';
const GIS_BLUE = '#2563eb';
const GIS_RED = '#dc2626';
const GIS_HIGHLIGHT = '#f97316';

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '...' : s;
}

function statusStroke(st: WorkStatus): string {
  if (st === 'complete') return GIS_GREEN;
  if (st === 'ongoing') return GIS_BLUE;
  return GIS_RED;
}

/**
 * Dual-text white halo compatible with svg2pdf.js (avoids CSS paintOrder issues).
 */
const HaloText: React.FC<{
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  fontWeight?: string;
  fill?: string;
  haloColor?: string;
  haloWidth?: number;
  textAnchor?: 'start' | 'middle' | 'end';
  fontStyle?: string;
}> = ({
  x,
  y,
  text,
  fontSize = 8.4,
  fontWeight = '700',
  fill = '#0f172a',
  haloColor = '#ffffff',
  haloWidth = 3.2,
  textAnchor = 'start',
  fontStyle,
}) => (
  <g>
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fontSize={fontSize}
      fontWeight={fontWeight}
      fontStyle={fontStyle}
      fill={haloColor}
      stroke={haloColor}
      strokeWidth={haloWidth}
      strokeLinejoin="round"
    >
      {text}
    </text>
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fontSize={fontSize}
      fontWeight={fontWeight}
      fontStyle={fontStyle}
      fill={fill}
    >
      {text}
    </text>
  </g>
);

interface RectBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxesOverlap(a: RectBox, b: RectBox, margin = 3): boolean {
  return !(
    a.x1 + margin < b.x0 ||
    b.x1 + margin < a.x0 ||
    a.y1 + margin < b.y0 ||
    b.y1 + margin < a.y0
  );
}

interface PlacedLabel {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  leaderNeeded: boolean;
}

function resolveSmartLabel(
  ptX: number,
  ptY: number,
  label: string,
  fontSize: number,
  occupied: RectBox[],
  bounds: RectBox,
  preferredSide: 'right' | 'left' | 'top' | 'bottom' = 'right',
  nodeDotRadius = 8
): PlacedLabel {
  const estW = Math.max(28, label.length * fontSize * 0.62 + 6);
  const estH = fontSize + 4;

  const baseOffsets: Array<[number, number, 'start' | 'middle' | 'end']> =
    preferredSide === 'left'
      ? [
          [-(nodeDotRadius + 5), 3, 'end'],
          [nodeDotRadius + 5, 3, 'start'],
          [0, -(nodeDotRadius + 5), 'middle'],
          [0, nodeDotRadius + estH + 1, 'middle'],
          [-(nodeDotRadius + 16), -12, 'end'],
          [nodeDotRadius + 16, 14, 'start'],
          [-(nodeDotRadius + 24), 14, 'end'],
          [nodeDotRadius + 24, -12, 'start'],
          [-(nodeDotRadius + 34), -2, 'end'],
          [nodeDotRadius + 34, -2, 'start'],
          [-(nodeDotRadius + 22), -24, 'end'],
          [nodeDotRadius + 22, 26, 'start'],
        ]
      : preferredSide === 'top'
      ? [
          [0, -(nodeDotRadius + 5), 'middle'],
          [0, nodeDotRadius + estH + 1, 'middle'],
          [nodeDotRadius + 5, 3, 'start'],
          [-(nodeDotRadius + 5), 3, 'end'],
          [nodeDotRadius + 14, -14, 'start'],
          [-(nodeDotRadius + 14), -14, 'end'],
          [nodeDotRadius + 24, 16, 'start'],
          [-(nodeDotRadius + 24), 16, 'end'],
          [0, -(nodeDotRadius + 22), 'middle'],
          [0, nodeDotRadius + estH + 18, 'middle'],
        ]
      : preferredSide === 'bottom'
      ? [
          [0, nodeDotRadius + estH + 1, 'middle'],
          [0, -(nodeDotRadius + 5), 'middle'],
          [nodeDotRadius + 5, 3, 'start'],
          [-(nodeDotRadius + 5), 3, 'end'],
          [nodeDotRadius + 16, 16, 'start'],
          [-(nodeDotRadius + 16), 16, 'end'],
          [nodeDotRadius + 24, -14, 'start'],
          [-(nodeDotRadius + 24), -14, 'end'],
          [0, nodeDotRadius + estH + 20, 'middle'],
        ]
      : [
          [nodeDotRadius + 5, 3, 'start'],
          [-(nodeDotRadius + 5), 3, 'end'],
          [0, -(nodeDotRadius + 5), 'middle'],
          [0, nodeDotRadius + estH + 1, 'middle'],
          [nodeDotRadius + 16, -12, 'start'],
          [-(nodeDotRadius + 16), 14, 'end'],
          [nodeDotRadius + 24, 14, 'start'],
          [-(nodeDotRadius + 24), -12, 'end'],
          [nodeDotRadius + 34, -2, 'start'],
          [-(nodeDotRadius + 34), -2, 'end'],
          [nodeDotRadius + 22, -24, 'start'],
          [-(nodeDotRadius + 22), 26, 'end'],
        ];

  const makeBox = (dx: number, dy: number, anchor: 'start' | 'middle' | 'end'): RectBox => {
    const lx = ptX + dx;
    const ly = ptY + dy;
    const x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - estW : lx - estW / 2;
    const x1 = x0 + estW;
    return { x0, y0: ly - estH + 2, x1, y1: ly + 2 };
  };

  for (let i = 0; i < baseOffsets.length; i++) {
    const [dx, dy, anchor] = baseOffsets[i];
    const box = makeBox(dx, dy, anchor);
    if (
      box.x0 < bounds.x0 + 4 ||
      box.x1 > bounds.x1 - 4 ||
      box.y0 < bounds.y0 + 4 ||
      box.y1 > bounds.y1 - 4
    ) {
      continue;
    }
    if (!occupied.some((o) => boxesOverlap(box, o, 2))) {
      occupied.push(box);
      return {
        x: ptX + dx,
        y: ptY + dy,
        anchor,
        leaderNeeded: i >= 4,
      };
    }
  }

  for (let dist = 26; dist <= 96; dist += 12) {
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      const dx = Math.round(Math.cos(rad) * dist);
      const dy = Math.round(Math.sin(rad) * dist);
      const anchor: 'start' | 'middle' | 'end' = dx > 6 ? 'start' : dx < -6 ? 'end' : 'middle';
      const box = makeBox(dx, dy, anchor);
      if (
        box.x0 < bounds.x0 + 4 ||
        box.x1 > bounds.x1 - 4 ||
        box.y0 < bounds.y0 + 4 ||
        box.y1 > bounds.y1 - 4
      ) {
        continue;
      }
      if (!occupied.some((o) => boxesOverlap(box, o, 2))) {
        occupied.push(box);
        return { x: ptX + dx, y: ptY + dy, anchor, leaderNeeded: true };
      }
    }
  }

  const [dx, dy, anchor] = baseOffsets[0];
  occupied.push(makeBox(dx, dy, anchor));
  return { x: ptX + dx, y: ptY + dy, anchor, leaderNeeded: false };
}

/**
 * Large, highlighted arrow-pointed Landmark / Infrastructure Callout Badge
 * (with explicit vector triangle arrowhead compatible with svg2pdf.js).
 */
function renderHighlightedCallout(
  targetX: number,
  targetY: number,
  text: string,
  occupied: RectBox[],
  bounds: RectBox,
  opts?: {
    preferredSide?: 'left' | 'right' | 'top' | 'bottom';
    baseOffsetX?: number;
    baseOffsetY?: number;
    fontSize?: number;
    bgFill?: string;
    borderStroke?: string;
    textFill?: string;
    arrowStroke?: string;
    stopDist?: number;
    key?: string;
  }
) {
  const fontSize = opts?.fontSize ?? 15.0;
  const stopDist = opts?.stopDist ?? 10;
  const side = opts?.preferredSide ?? 'right';
  const boxW = Math.max(112, Math.round(text.length * fontSize * 0.56 + 24));
  const boxH = Math.round(fontSize + 15);

  const prefDx = opts?.baseOffsetX ?? (side === 'left' ? -(boxW + 84) : 84);
  const prefDy = opts?.baseOffsetY ?? 0;

  const candidates: Array<[number, number]> = [
    [prefDx, prefDy],
    [prefDx, prefDy - 34],
    [prefDx, prefDy + 34],
    [side === 'left' ? -(boxW + 115) : 115, prefDy],
    [side === 'left' ? -(boxW + 76) : 76, prefDy - 54],
    [side === 'left' ? -(boxW + 76) : 76, prefDy + 54],
    [side === 'left' ? 84 : -(boxW + 84), prefDy],
    [side === 'left' ? 96 : -(boxW + 96), prefDy - 38],
    [side === 'left' ? 96 : -(boxW + 96), prefDy + 38],
  ];

  let chosenX = targetX + prefDx;
  let chosenY = targetY + prefDy - boxH / 2;

  for (const [dx, dy] of candidates) {
    const x0 = targetX + dx;
    const y0 = targetY + dy - boxH / 2;
    const rect: RectBox = { x0, y0, x1: x0 + boxW, y1: y0 + boxH };
    if (
      rect.x0 < bounds.x0 + 6 ||
      rect.x1 > bounds.x1 - 6 ||
      rect.y0 < bounds.y0 + 6 ||
      rect.y1 > bounds.y1 - 6
    ) {
      continue;
    }
    if (!occupied.some((o) => boxesOverlap(rect, o, 4))) {
      chosenX = x0;
      chosenY = y0;
      occupied.push(rect);
      break;
    }
  }

  // Clamp inside bounds cleanly if fallback hit
  chosenX = Math.max(bounds.x0 + 6, Math.min(bounds.x1 - boxW - 6, chosenX));
  chosenY = Math.max(bounds.y0 + 6, Math.min(bounds.y1 - boxH - 6, chosenY));

  const pillCx = chosenX + boxW / 2;
  const pillCy = chosenY + boxH / 2;
  // Nearest edge point of pill toward target
  const startX =
    pillCx > targetX + 12 ? chosenX : pillCx < targetX - 12 ? chosenX + boxW : pillCx;
  const startY =
    Math.abs(pillCx - targetX) < boxW / 2
      ? pillCy > targetY
        ? chosenY
        : chosenY + boxH
      : pillCy;

  const dx = targetX - startX;
  const dy = targetY - startY;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;

  // Stop arrowhead `stopDist` px before target center so surrounding-area arrows stay clearly separated from shaft dots
  const effStop = Math.min(stopDist, Math.max(8, len - 18));
  const tipX = targetX - ux * effStop;
  const tipY = targetY - uy * effStop;
  const arrowLen = 11.5;
  const arrowHalfW = 5.2;
  const baseX = tipX - ux * arrowLen;
  const baseY = tipY - uy * arrowLen;
  const px = -uy;
  const py = ux;

  // Reserve sampled arrow corridor boxes in `occupied` so node labels NEVER overlap arrow lines!
  for (let t = 0.15; t <= 0.85; t += 0.23) {
    const ax = startX + (tipX - startX) * t;
    const ay = startY + (tipY - startY) * t;
    occupied.push({ x0: ax - 10, y0: ay - 8, x1: ax + 10, y1: ay + 8 });
  }

  const bgFill = opts?.bgFill ?? '#fffbeb';
  const borderStroke = opts?.borderStroke ?? '#b45309';
  const textFill = opts?.textFill ?? '#0f172a';
  const arrowStroke = opts?.arrowStroke ?? borderStroke;

  return (
    <g key={opts?.key}>
      {/* White outer casing halo on arrow line for high contrast over streets */}
      <line
        x1={startX}
        y1={startY}
        x2={baseX}
        y2={baseY}
        stroke="#ffffff"
        strokeWidth={5.2}
        strokeLinecap="round"
      />
      <line
        x1={startX}
        y1={startY}
        x2={baseX}
        y2={baseY}
        stroke={arrowStroke}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      {/* Highlighted vector arrowhead */}
      <polygon
        points={`${tipX.toFixed(1)},${tipY.toFixed(1)} ${(baseX + px * arrowHalfW).toFixed(1)},${(baseY + py * arrowHalfW).toFixed(1)} ${(baseX - px * arrowHalfW).toFixed(1)},${(baseY - py * arrowHalfW).toFixed(1)}`}
        fill={arrowStroke}
        stroke="#ffffff"
        strokeWidth={1.0}
      />

      {/* Callout badge shadow & frosted card */}
      <rect
        x={chosenX + 1.5}
        y={chosenY + 2.0}
        width={boxW}
        height={boxH}
        rx={5}
        fill="#0f172a"
        fillOpacity={0.14}
      />
      <rect
        x={chosenX}
        y={chosenY}
        width={boxW}
        height={boxH}
        rx={5}
        fill={bgFill}
        fillOpacity={0.96}
        stroke={borderStroke}
        strokeWidth={1.6}
      />
      <text
        x={pillCx}
        y={chosenY + boxH * 0.69}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="800"
        fill={textFill}
      >
        {text}
      </text>
    </g>
  );
}

/**
 * Prominent Highlighted Administrative Zone Badge (DNCC / DSCC).
 */
function renderZoneBadge(
  cx: number,
  cy: number,
  text: string,
  variant: 'dncc' | 'dscc',
  occupied: RectBox[]
) {
  const fontSize = 14.5;
  const w = Math.max(134, Math.round(text.length * 9.5 + 28));
  const h = 32;
  const x = cx - w / 2;
  const y = cy - h / 2;
  occupied.push({ x0: x, y0: y, x1: x + w, y1: y + h });

  const fill = variant === 'dncc' ? '#fef3c7' : '#e0e7ff';
  const stroke = variant === 'dncc' ? '#b45309' : '#1e40af';
  const textCol = variant === 'dncc' ? '#78350f' : '#1e3a8a';

  return (
    <g key={`zone-${text}`}>
      <rect x={x + 1.5} y={y + 2} width={w} height={h} rx={5} fill="#0f172a" fillOpacity={0.15} />
      <rect x={x} y={y} width={w} height={h} rx={5} fill={fill} fillOpacity={0.95} stroke={stroke} strokeWidth={2.0} />
      <text
        x={cx}
        y={cy + 5.0}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="800"
        fill={textCol}
      >
        {text}
      </text>
    </g>
  );
}

function renderCompassRose(cx: number, cy: number, r = 34) {
  const inner = r * 0.27;
  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <circle
        cx={0}
        cy={0}
        r={r + 12}
        fill="#ffffff"
        fillOpacity={0.9}
        stroke="#94a3b8"
        strokeWidth={0.9}
      />
      <polygon points={`0,${-r} 0,0 ${-inner},${-inner}`} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`0,${-r} ${inner},${-inner} 0,0`} fill="#ffffff" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`0,${r} 0,0 ${inner},${inner}`} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`0,${r} ${-inner},${inner} 0,0`} fill="#ffffff" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`${r},0 0,0 ${inner},${-inner}`} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`${r},0 ${inner},${inner} 0,0`} fill="#ffffff" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`${-r},0 0,0 ${-inner},${inner}`} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`${-r},0 ${-inner},${-inner} 0,0`} fill="#ffffff" stroke="#0f172a" strokeWidth={0.7} />
      <polygon points={`${r * 0.56},${-r * 0.56} ${inner},0 0,${-inner}`} fill="#475569" fillOpacity={0.35} stroke="#475569" strokeWidth={0.4} />
      <polygon points={`${-r * 0.56},${-r * 0.56} 0,${-inner} ${-inner},0`} fill="#475569" fillOpacity={0.35} stroke="#475569" strokeWidth={0.4} />
      <polygon points={`${r * 0.56},${r * 0.56} 0,${inner} ${inner},0`} fill="#475569" fillOpacity={0.35} stroke="#475569" strokeWidth={0.4} />
      <polygon points={`${-r * 0.56},${r * 0.56} ${-inner},0 0,${inner}`} fill="#475569" fillOpacity={0.35} stroke="#475569" strokeWidth={0.4} />

      <text x={0} y={-(r + 3)} textAnchor="middle" fontSize={10.5} fontWeight="800" fill="#0f172a">
        N
      </text>
      <text x={0} y={r + 10} textAnchor="middle" fontSize={8.0} fontWeight="700" fill="#334155">
        S
      </text>
      <text x={r + 6} y={3} textAnchor="start" fontSize={8.0} fontWeight="700" fill="#334155">
        E
      </text>
      <text x={-(r + 6)} y={3} textAnchor="end" fontSize={8.0} fontWeight="700" fill="#334155">
        W
      </text>
    </g>
  );
}

/**
 * Clean Kilometers Scale Bar & Esri Source Credit ONLY (no Sheet/Contractor metadata inside map scale).
 */
function renderScaleBarAndAttribution(
  vp: ProjectedViewport,
  rightEdgeX: number,
  bottomEdgeY: number
) {
  const mPerSvg = computeMetersPerSvgUnit(vp);
  const candidatesKm = [0.2, 0.4, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0];
  let chosenKm = 0.5;
  let bestDiff = Infinity;
  for (const c of candidatesKm) {
    const px = (c * 1000) / mPerSvg;
    const diff = Math.abs(px - 220);
    if (px >= 125 && px <= 300 && diff < bestDiff) {
      bestDiff = diff;
      chosenKm = c;
    }
  }
  const barW = Math.min(310, Math.max(125, (chosenKm * 1000) / mPerSvg));
  const segCount = 4;
  const qW = barW / segCount;

  const cardW = Math.max(barW + 86, 336);
  const cardH = 44;
  const cx = rightEdgeX - cardW;
  const cy = bottomEdgeY - cardH;

  const barX = cx + 14;
  const barY = cy + 19;

  return (
    <g>
      <rect
        x={cx}
        y={cy}
        width={cardW}
        height={cardH}
        rx={3}
        fill="#ffffff"
        fillOpacity={0.94}
        stroke="#64748b"
        strokeWidth={0.85}
      />

      {[
        { frac: 0, lbl: '0' },
        { frac: 0.25, lbl: `${(chosenKm * 0.25).toFixed(3).replace(/\.?0+$/, '')}` },
        { frac: 0.5, lbl: `${(chosenKm * 0.5).toFixed(3).replace(/\.?0+$/, '')}` },
        { frac: 1, lbl: `${chosenKm.toFixed(3).replace(/\.?0+$/, '')}` },
      ].map((t) => (
        <text
          key={t.frac}
          x={barX + barW * t.frac}
          y={barY - 4}
          textAnchor="middle"
          fontSize={8.2}
          fontWeight="700"
          fill="#0f172a"
        >
          {t.lbl}
        </text>
      ))}
      <text
        x={barX + barW + 8}
        y={barY + 6}
        fontSize={8.2}
        fontWeight="700"
        fill="#0f172a"
      >
        Kilometers
      </text>

      <rect x={barX} y={barY} width={qW} height={7} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />
      <rect x={barX + qW} y={barY} width={qW} height={7} fill="#ffffff" stroke="#0f172a" strokeWidth={0.7} />
      <rect x={barX + qW * 2} y={barY} width={qW * 2} height={7} fill="#0f172a" stroke="#0f172a" strokeWidth={0.7} />

      <text x={barX} y={cy + 38} fontSize={6.5} fill="#475569">
        Sources: Esri, TomTom, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors
      </text>
    </g>
  );
}

function renderGraticuleTicks(vp: ProjectedViewport) {
  const { x: mx, y: my, w: mw, h: mh } = FULL_MAP_FRAME;
  const lonMin = xToLon(vp.minX);
  const lonMax = xToLon(vp.maxX);
  const latMax = yToLat(vp.minY);
  const latMin = yToLat(vp.maxY);

  const lonFracs = [0.16, 0.48, 0.82];
  const latFracs = [0.14, 0.38, 0.62, 0.86];

  return (
    <g>
      {lonFracs.map((f, i) => {
        const px = mx + mw * f;
        const lonVal = lonMin + (lonMax - lonMin) * f;
        const lbl = formatDms(lonVal, 'E', 'W');
        return (
          <g key={`lon-${i}`}>
            <line x1={px} y1={my - 5} x2={px} y2={my} stroke="#1e293b" strokeWidth={1.0} />
            <line x1={px} y1={my + mh} x2={px} y2={my + mh + 5} stroke="#1e293b" strokeWidth={1.0} />
            <text x={px} y={my + mh + 16} textAnchor="middle" fontSize={8.2} fontWeight="600" fill="#334155">
              {lbl}
            </text>
          </g>
        );
      })}
      {latFracs.map((f, i) => {
        const py = my + mh * f;
        const latVal = latMax - (latMax - latMin) * f;
        const lbl = formatDms(latVal, 'N', 'S');
        return (
          <g key={`lat-${i}`}>
            <line x1={mx - 5} y1={py} x2={mx} y2={py} stroke="#1e293b" strokeWidth={1.0} />
            <line x1={mx + mw} y1={py} x2={mx + mw + 5} y2={py} stroke="#1e293b" strokeWidth={1.0} />
            <text
              x={mx - 10}
              y={py + 3}
              textAnchor="middle"
              fontSize={8.2}
              fontWeight="600"
              fill="#334155"
              transform={`rotate(-90, ${mx - 10}, ${py})`}
            >
              {lbl}
            </text>
            <text
              x={mx + mw + 16}
              y={py + 3}
              textAnchor="middle"
              fontSize={8.2}
              fontWeight="600"
              fill="#334155"
              transform={`rotate(90, ${mx + mw + 16}, ${py})`}
            >
              {lbl}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function formatWaMapNodeId(id: string): string {
  const m = id.match(/^WA-(\d+)(\.\d+)?$/i);
  if (!m) return id.replace('-', ' ');
  const num = Number(m[1]);
  const suf = m[2] || '';
  return `WA ${num < 10 ? '0' + num : num}${suf}`;
}

function renderCustomMapPoints(
  points: CustomMapPoint[] | undefined,
  viewport: ProjectedViewport,
  occupied: RectBox[],
  bounds: RectBox
) {
  if (!points || points.length === 0) return null;
  return (
    <g>
      {points.map((cp) => {
        const pt = viewport.project(cp.lat, cp.lon);
        const lbl = resolveSmartLabel(pt.x, pt.y, cp.name, 10.6, occupied, bounds, 'right', 13);
        const estW = Math.max(44, cp.name.length * 6.8 + 14);
        const boxX =
          lbl.anchor === 'start'
            ? lbl.x - 4
            : lbl.anchor === 'end'
            ? lbl.x - estW + 4
            : lbl.x - estW / 2;
        return (
          <g key={`custom-pt-${cp.id}`}>
            <line x1={pt.x} y1={pt.y} x2={lbl.x} y2={lbl.y - 3} stroke="#6b21a8" strokeWidth={1.3} strokeDasharray="3,2" />
            <circle cx={pt.x} cy={pt.y} r={9.5} fill="#f3e8ff" stroke="#7e22ce" strokeWidth={2.3} />
            <polygon
              points={`${pt.x},${pt.y - 5.5} ${pt.x + 5.5},${pt.y} ${pt.x},${pt.y + 5.5} ${pt.x - 5.5},${pt.y}`}
              fill="#9333ea"
              stroke="#ffffff"
              strokeWidth={1.0}
            />
            <rect
              x={boxX}
              y={lbl.y - 12}
              width={estW}
              height={17}
              rx={3.5}
              fill="#faf5ff"
              fillOpacity={0.96}
              stroke="#7e22ce"
              strokeWidth={1.5}
            />
            <text
              x={boxX + estW / 2}
              y={lbl.y}
              textAnchor="middle"
              fontSize={10.4}
              fontWeight="800"
              fill="#581c87"
            >
              {cp.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function getDeltaProgressBadge(
  s: ShaftRecord,
  bSnap?: ShaftSnapshotItem
): { hasNewLayer: boolean; hasNewMh: boolean; hasNewTunnel: boolean } {
  if (!bSnap) return { hasNewLayer: false, hasNewMh: false, hasNewTunnel: false };
  const addedL = s.layerFlags.reduce(
    (acc, f, idx) => acc + (f && !bSnap.layerFlags?.[idx] ? 1 : 0),
    0
  );
  const hasNewMh =
    s.castingPct > (bSnap.castingPct ?? 0) || s.precastPct > (bSnap.precastPct ?? 0);
  const hasNewTunnel = s.tunnelPct > (bSnap.tunnelPct ?? 0);
  return { hasNewLayer: addedL > 0, hasNewMh, hasNewTunnel };
}

export const FullPageGisMapSheet: React.FC<FullPageGisMapProps> = ({
  kind,
  state,
  svgRef,
  selectedShaftId,
  onSelectShaft,
  onSelectWbNode,
}) => {
  const { settings, viewMode } = state;
  const {
    displayShafts: waShafts,
    displayPump: pumpStation,
    displayWb: wbData,
    displayWc: wcData,
    displayWaGeoNodes: waGeoNodes,
    displaySpsCoord: spsCoord,
    displayWaCustomPoints: waCustomPoints,
    baseline,
    file1Label,
    file2Label,
  } = resolveDisplayContext(state);

  const waSummary = computeSummary(
    waShafts,
    baseline,
    pumpStation,
    undefined,
    settings.waTunnelDiaTotalsM
  );
  const wcSummary = computeSummary(wcData.shafts, baseline, undefined, baseline.wcShafts);

  const { x: mapX, y: mapY, w: mapW, h: mapH, padRatio, tileOutW, tileOutH } =
    FULL_MAP_FRAME;

  const viewport = useMemo(() => {
    const filterNearby = (pts: CustomMapPoint[], refs: Array<{ lat: number; lon: number }>) => {
      if (!pts.length || !refs.length) return [];
      const minLa = Math.min(...refs.map((r) => r.lat));
      const maxLa = Math.max(...refs.map((r) => r.lat));
      const minLo = Math.min(...refs.map((r) => r.lon));
      const maxLo = Math.max(...refs.map((r) => r.lon));
      return pts.filter(
        (p) => p.lat >= minLa - 0.04 && p.lat <= maxLa + 0.04 && p.lon >= minLo - 0.04 && p.lon <= maxLo + 0.04
      );
    };

    if (kind === 'wa-map') {
      const basePts = [...waGeoNodes, spsCoord];
      return buildGeoViewport(
        [...basePts, ...filterNearby(waCustomPoints, basePts)],
        mapX,
        mapY,
        mapW,
        mapH,
        padRatio
      );
    }
    if (kind === 'wb-map') {
      const wash = wbData.washoutCoord || DEFAULT_WASHOUT_COORD;
      const airV = wbData.airValveCoord || DEFAULT_AIR_VALVE_COORD;
      const basePts = [...wbData.nodes, wash, airV, spsCoord];
      return buildGeoViewport(
        [...basePts, ...filterNearby(wbData.customPoints || [], wbData.nodes)],
        mapX,
        mapY,
        mapW,
        mapH,
        padRatio
      );
    }
    return buildGeoViewport(
      [...wcData.geoNodes, ...filterNearby(wcData.customPoints || [], wcData.geoNodes)],
      mapX,
      mapY,
      mapW,
      mapH,
      padRatio
    );
  }, [
    kind,
    waGeoNodes,
    spsCoord,
    waCustomPoints,
    wbData.nodes,
    wbData.washoutCoord,
    wbData.airValveCoord,
    wbData.customPoints,
    wcData.geoNodes,
    wcData.customPoints,
    mapX,
    mapY,
    mapW,
    mapH,
    padRatio,
  ]);

  const tileDataUrl = useMapTileSnapshot(
    viewport,
    settings.showMapBackground,
    settings.mapStyle,
    tileOutW,
    tileOutH
  );

  const clipId = `full-gis-clip-${kind}`;
  const mapBounds: RectBox = {
    x0: mapX + 6,
    y0: mapY + 6,
    x1: mapX + mapW - 6,
    y1: mapY + mapH - 6,
  };

  const mapTitle =
    kind === 'wa-map'
      ? 'Construction Progress Map: WA Shaft, Micro-Tunneling & Manhole'
      : kind === 'wb-map'
      ? 'Construction Progress Map: WB Open-Cut Pipeline (DN1200 GRP)'
      : 'Construction Progress Map: WC Shaft, Micro-Tunneling & Manhole';

  const sheetNoLabel =
    kind === 'wa-map'
      ? 'Sheet 2 of 5'
      : kind === 'wb-map'
      ? 'Sheet 3 of 5'
      : 'Sheet 4 of 5';

  const periodText =
    viewMode === 'weekly'
      ? `WEEKLY COMPARE: ${file1Label} -> ${file2Label}`
      : viewMode === 'monthly'
      ? `MONTHLY COMPARE: ${file1Label} -> ${file2Label}`
      : 'OVERALL CONSTRUCTION STATUS';

  const wbPrevCompletedM =
    viewMode === 'overall' ? undefined : baseline.wbCompletedLengthM;

  // Reserved Legend, Compass, and Scale Bar areas in Portrait layout (1100 x 1566)
  const legendBox: RectBox =
    kind === 'wb-map'
      ? { x0: mapX + 14, y0: mapY + 124, x1: mapX + 344, y1: mapY + 462 }
      : { x0: mapX + 14, y0: mapY + mapH - 488, x1: mapX + 368, y1: mapY + mapH - 14 };

  const compassBox: RectBox =
    kind === 'wb-map'
      ? { x0: mapX + 18, y0: mapY + 14, x1: mapX + 132, y1: mapY + 114 }
      : { x0: mapX + mapW - 114, y0: mapY + 14, x1: mapX + mapW - 10, y1: mapY + 114 };

  const scaleBox: RectBox = {
    x0: mapX + mapW - 360,
    y0: mapY + mapH - 60,
    x1: mapX + mapW - 8,
    y1: mapY + mapH - 8,
  };

  const sectionCode: 'WA' | 'WB' | 'WC' =
    kind === 'wa-map' ? 'WA' : kind === 'wb-map' ? 'WB' : 'WC';
  const sectionAccent =
    kind === 'wa-map' ? '#15803d' : kind === 'wb-map' ? '#1d4ed8' : '#7e22ce';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
      className="print-sheet-svg w-full h-auto bg-white select-none"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={mapX} y={mapY} width={mapW} height={mapH} />
        </clipPath>
      </defs>

      {/* Outer ISO A1 Portrait Page Background & Border */}
      <rect x={0} y={0} width={SHEET_W} height={SHEET_H} fill="#ffffff" />
      <rect x={12} y={12} width={SHEET_W - 24} height={SHEET_H - 24} fill="none" stroke="#0f172a" strokeWidth={1.3} />

      {/* Top Cartographic Title Banner with Bold Section Badge */}
      <rect x={16} y={14} width={SHEET_W - 32} height={56} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={0.7} />

      <rect x={22} y={17} width={104} height={50} rx={6} fill={sectionAccent} />
      <text x={74} y={44} textAnchor="middle" fontSize={27} fontWeight="900" fill="#ffffff" letterSpacing={1.4}>
        {sectionCode}
      </text>
      <text x={74} y={59} textAnchor="middle" fontSize={10.2} fontWeight="800" fill="#f1f5f9" letterSpacing={0.6}>
        Section
      </text>

      <text x={138} y={46} fontSize={11.5} fontWeight="800" fill={sectionAccent}>
        {sheetNoLabel}
      </text>

      <text x={548} y={37} textAnchor="middle" fontSize={14.0} fontWeight="800" fill="#0f172a">
        {mapTitle}
      </text>
      <text x={548} y={54} textAnchor="middle" fontSize={8.8} fontWeight="600" fill="#334155">
        Dhaka Sanitation Improvement Project (DSIP) | Package WD-02 — As of {formatDateDisplay(settings.reportDate)}
      </text>

      <rect
        x={SHEET_W - 298}
        y={22}
        width={276}
        height={40}
        rx={4}
        fill={viewMode === 'overall' ? '#f0fdf4' : '#fff7ed'}
        stroke={viewMode === 'overall' ? '#16a34a' : '#ea580c'}
        strokeWidth={1.0}
      />
      <text x={SHEET_W - 160} y={38} textAnchor="middle" fontSize={7.2} fontWeight="800" fill="#0f172a">
        {trunc(periodText, 44)}
      </text>
      <text x={SHEET_W - 160} y={52} textAnchor="middle" fontSize={6.5} fontWeight="600" fill="#475569">
        {trunc(`Client: ${settings.clientName} | ${settings.contractorName}`, 48)}
      </text>

      {/* Geographic Neatline & Lat/Lon Graticule Ticks */}
      {renderGraticuleTicks(viewport)}

      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="#f1f5f9" />

      {/* CLIPPED MAP INTERIOR */}
      <g clipPath={`url(#${clipId})`}>
        {tileDataUrl ? (
          <image
            href={tileDataUrl}
            x={mapX}
            y={mapY}
            width={mapW}
            height={mapH}
            preserveAspectRatio="none"
          />
        ) : (
          <g>
            {Array.from({ length: 12 }).map((_, gi) => {
              const gx = mapX + ((gi + 1) / 13) * mapW;
              const gy = mapY + ((gi + 1) / 13) * mapH;
              return (
                <g key={gi}>
                  <line x1={gx} y1={mapY} x2={gx} y2={mapY + mapH} stroke="#cbd5e1" strokeWidth={0.6} strokeDasharray="4,4" />
                  <line x1={mapX} y1={gy} x2={mapX + mapW} y2={gy} stroke="#cbd5e1" strokeWidth={0.6} strokeDasharray="4,4" />
                </g>
              );
            })}
          </g>
        )}

        {/* ================================================================ */}
        {/* PAGE 2: WA PROGRESS MAP (PORTRAIT)                               */}
        {/* ================================================================ */}
        {kind === 'wa-map' && (() => {
          const shaftById = new Map<string, ShaftRecord>();
          for (const s of waShafts) shaftById.set(s.id, s);

          const occupied: RectBox[] = [legendBox, compassBox, scaleBox];
          const geoById = new Map(waGeoNodes.map((g) => [g.id, g]));
          const wa35Geo = geoById.get('WA-35');
          const wa36Geo = geoById.get('WA-36');
          const wa35Pt = wa35Geo ? viewport.project(wa35Geo.lat, wa35Geo.lon) : null;
          const wa36Pt = wa36Geo ? viewport.project(wa36Geo.lat, wa36Geo.lon) : null;
          const rawSpsPt = viewport.project(spsCoord.lat, spsCoord.lon);
          const spsPt =
            wa36Pt && Math.hypot(rawSpsPt.x - wa36Pt.x, rawSpsPt.y - wa36Pt.y) < 26
              ? { x: wa36Pt.x + 2, y: wa36Pt.y - 32 }
              : rawSpsPt;

          // Pre-seed WA square markers + SPS marker + WA-35->WA-36->SPS pipe corridor + custom points
          for (const gNode of waGeoNodes) {
            const p = viewport.project(gNode.lat, gNode.lon);
            occupied.push({ x0: p.x - 10, y0: p.y - 10, x1: p.x + 10, y1: p.y + 10 });
          }
          if (wa35Pt && wa36Pt) {
            for (const t of [0.35, 0.65]) {
              const mx = wa35Pt.x + (wa36Pt.x - wa35Pt.x) * t;
              const my = wa35Pt.y + (wa36Pt.y - wa35Pt.y) * t;
              occupied.push({ x0: mx - 6, y0: my - 6, x1: mx + 6, y1: my + 6 });
            }
          }
          if (wa36Pt) {
            const mx = (wa36Pt.x + spsPt.x) / 2;
            const my = (wa36Pt.y + spsPt.y) / 2;
            occupied.push({ x0: mx - 6, y0: my - 6, x1: mx + 6, y1: my + 6 });
          }
          for (const cp of waCustomPoints) {
            const p = viewport.project(cp.lat, cp.lon);
            occupied.push({ x0: p.x - 11, y0: p.y - 11, x1: p.x + 11, y1: p.y + 11 });
          }
          occupied.push({
            x0: spsPt.x - 18,
            y0: spsPt.y - 12,
            x1: spsPt.x + 18,
            y1: spsPt.y + 12,
          });

          const zonePtDncc = viewport.project(23.7545, 90.4150);
          const zonePtDscc = viewport.project(23.7418, 90.4272);

          const waLandmarks: Array<{
            nodeId: string;
            label: string;
            side: 'left' | 'right' | 'top' | 'bottom';
            dx: number;
            dy: number;
            stopDist: number;
          }> = [
            { nodeId: 'WA-1', label: 'Mirbag (Start WA-01)', side: 'top', dx: -40, dy: -66, stopDist: 10 },
            { nodeId: 'WA-12', label: 'Moulovirtek (Rampura)', side: 'left', dx: -275, dy: 34, stopDist: 34 },
            { nodeId: 'WA-14', label: 'Sipahibag Moor', side: 'right', dx: 92, dy: -22, stopDist: 34 },
            { nodeId: 'WA-18', label: 'Goran Tempo Stand', side: 'left', dx: -250, dy: -4, stopDist: 34 },
            { nodeId: 'WA-22', label: 'East Bashaboo', side: 'left', dx: -220, dy: -14, stopDist: 34 },
            { nodeId: 'WA-23', label: 'Chayabithy', side: 'right', dx: 92, dy: 4, stopDist: 34 },
            { nodeId: 'WA-27', label: 'North Mugdapara', side: 'right', dx: 92, dy: -8, stopDist: 34 },
            { nodeId: 'WA-28', label: 'Mugdapara-Maniknogor Bridge', side: 'left', dx: -320, dy: 6, stopDist: 34 },
            { nodeId: 'WA-35', label: 'City Corp. Adarsha High School', side: 'left', dx: -315, dy: -12, stopDist: 34 },
          ];

          return (
            <g>
              {/* Highlighted Administrative Zone Badges */}
              {renderZoneBadge(zonePtDncc.x, zonePtDncc.y, 'DNCC ZONE 03', 'dncc', occupied)}
              {renderZoneBadge(zonePtDscc.x, zonePtDscc.y, 'DSCC ZONE 02', 'dscc', occupied)}

              {/* Micro-tunneling segments WA-i -> WA-(i+1) & WA-36 -> SPS */}
              {waGeoNodes.map((gNode, idx) => {
                const p1 = viewport.project(gNode.lat, gNode.lon);
                const p2 =
                  idx < waGeoNodes.length - 1
                    ? viewport.project(waGeoNodes[idx + 1].lat, waGeoNodes[idx + 1].lon)
                    : spsPt;
                const sh = shaftById.get(gNode.id);
                const mtStatus = sh ? getTunnelStatus(sh) : 'remaining';
                const col = statusStroke(mtStatus);
                const deltaInfo = sh
                  ? getDeltaProgressBadge(sh, baseline.shafts[sh.id])
                  : { hasNewLayer: false, hasNewMh: false, hasNewTunnel: false };

                return (
                  <g key={`wa-seg-${gNode.id}`}>
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#ffffff" strokeWidth={8.0} strokeLinecap="round" />
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={col} strokeWidth={5.0} strokeLinecap="round" />
                    {viewMode !== 'overall' && deltaInfo.hasNewTunnel && (
                      <line
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke={GIS_HIGHLIGHT}
                        strokeWidth={5.4}
                        strokeLinecap="round"
                      />
                    )}
                  </g>
                );
              })}

              {/* Highlighted Arrow Callouts rendered FIRST so node labels avoid arrows & badges cleanly */}
              {waLandmarks.map((lm) => {
                const g = geoById.get(lm.nodeId);
                if (!g) return null;
                const pt = viewport.project(g.lat, g.lon);
                return renderHighlightedCallout(pt.x, pt.y, lm.label, occupied, mapBounds, {
                  key: `wa-lm-${lm.nodeId}`,
                  preferredSide: lm.side,
                  baseOffsetX: lm.dx,
                  baseOffsetY: lm.dy,
                  fontSize: 15.0,
                  stopDist: lm.stopDist,
                  bgFill: '#fffbeb',
                  borderStroke: '#b45309',
                  arrowStroke: '#b45309',
                });
              })}

              {/* Prominent Highlighted Golapbag SPS Callout (positioned cleanly right of SPS above WA-36) */}
              {renderHighlightedCallout(spsPt.x, spsPt.y, 'Golapbag Pump Station (SPS)', occupied, mapBounds, {
                key: 'wa-sps-callout',
                preferredSide: 'right',
                baseOffsetX: 38,
                baseOffsetY: -18,
                fontSize: 14.8,
                stopDist: 20,
                bgFill: '#fdf2f8',
                borderStroke: '#9d174d',
                textFill: '#831843',
                arrowStroke: '#9d174d',
              })}

              {/* Golapbag SPS Building Box Marker (clearly above WA-36) */}
              <g>
                <rect
                  x={spsPt.x - 17}
                  y={spsPt.y - 10}
                  width={34}
                  height={20}
                  rx={3}
                  fill="#fbcfe8"
                  stroke="#9d174d"
                  strokeWidth={2.4}
                />
                <text x={spsPt.x} y={spsPt.y + 3.5} textAnchor="middle" fontSize={9.0} fontWeight="900" fill="#831843">
                  SPS
                </text>
              </g>

              {/* WA Shaft + Manhole Nodes & Non-Overlapping Labels */}
              {waGeoNodes.map((gNode, idx) => {
                const pt = viewport.project(gNode.lat, gNode.lon);
                const sh = shaftById.get(gNode.id);
                const shStatus = sh ? getShaftStatus(sh) : 'remaining';
                const mhStatus = sh ? getManholeStatus(sh) : 'remaining';
                const castSt = sh ? getCastingStatus(sh) : 'remaining';
                const ringSt = sh ? getRingStatus(sh) : 'remaining';
                const isSel = selectedShaftId === gNode.id;

                const outerCol = statusStroke(shStatus);
                const innerCol =
                  mhStatus === 'complete'
                    ? GIS_GREEN
                    : castSt === 'complete' || mhStatus === 'ongoing'
                    ? GIS_BLUE
                    : GIS_RED;

                const deltaInfo = sh
                  ? getDeltaProgressBadge(sh, baseline.shafts[sh.id])
                  : { hasNewLayer: false, hasNewMh: false, hasNewTunnel: false };

                const lmMatch = waLandmarks.find((l) => l.nodeId === gNode.id);
                const prefSide: 'left' | 'right' | 'top' | 'bottom' =
                  gNode.id === 'WA-1'
                    ? 'left'
                    : gNode.id === 'WA-35'
                    ? 'bottom'
                    : gNode.id === 'WA-36'
                    ? 'right'
                    : lmMatch
                    ? lmMatch.side === 'right'
                      ? 'left'
                      : 'right'
                    : idx <= 5
                    ? idx % 2 === 0
                      ? 'top'
                      : 'right'
                    : idx <= 13
                    ? idx % 2 === 0
                      ? 'left'
                      : 'right'
                    : idx % 2 === 0
                    ? 'right'
                    : 'left';

                const dispName = formatWaMapNodeId(gNode.id);
                const lblPos = resolveSmartLabel(
                  pt.x,
                  pt.y,
                  dispName,
                  14.5,
                  occupied,
                  mapBounds,
                  prefSide,
                  10.5
                );

                return (
                  <g
                    key={gNode.id}
                    style={{ cursor: onSelectShaft ? 'pointer' : 'default' }}
                    onClick={() => onSelectShaft?.(gNode.id, 'shaft')}
                  >
                    {viewMode !== 'overall' && (deltaInfo.hasNewLayer || deltaInfo.hasNewMh) && (
                      <rect x={pt.x - 12} y={pt.y - 12} width={24} height={24} rx={3} fill="none" stroke={GIS_HIGHLIGHT} strokeWidth={2.0} />
                    )}
                    {isSel && (
                      <rect x={pt.x - 13} y={pt.y - 13} width={26} height={26} rx={3} fill="none" stroke="#0284c7" strokeWidth={2.2} />
                    )}

                    <rect
                      x={pt.x - 8.2}
                      y={pt.y - 8.2}
                      width={16.4}
                      height={16.4}
                      fill="#ffffff"
                      stroke={outerCol}
                      strokeWidth={2.7}
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={4.4}
                      fill={innerCol}
                      stroke={ringSt === 'ongoing' ? '#0ea5e9' : '#ffffff'}
                      strokeWidth={0.9}
                    />

                    {lblPos.leaderNeeded && (
                      <line x1={pt.x} y1={pt.y} x2={lblPos.x} y2={lblPos.y - 2} stroke="#475569" strokeWidth={0.9} />
                    )}
                    <HaloText
                      x={lblPos.x}
                      y={lblPos.y}
                      text={dispName}
                      fontSize={14.5}
                      fontWeight="900"
                      fill="#0f172a"
                      haloWidth={4.5}
                      textAnchor={lblPos.anchor}
                    />
                  </g>
                );
              })}

              {/* Custom Added Map Points (WA) */}
              {renderCustomMapPoints(waCustomPoints, viewport, occupied, mapBounds)}

              {/* WA Bottom-Left Frosted Legend & Quantitative Table */}
              <g transform={`translate(${legendBox.x0}, ${legendBox.y0})`}>
                <rect x={2} y={3} width={354} height={474} rx={5} fill="#0f172a" fillOpacity={0.1} />
                <rect
                  x={0}
                  y={0}
                  width={354}
                  height={474}
                  rx={5}
                  fill="#ffffff"
                  fillOpacity={0.95}
                  stroke="#1e293b"
                  strokeWidth={1.2}
                />
                <rect x={0} y={0} width={354} height={29} rx={5} fill="#eff6ff" stroke="#1e293b" strokeWidth={0.9} />
                <text x={14} y={19.5} fontSize={12.8} fontWeight="800" fill="#0f172a">
                  Legend — WA Section Progress
                </text>

                <text x={14} y={48} fontSize={10.0} fontWeight="700" fill="#1e3a8a">
                  Shaft Status ({waSummary.totalShafts} Shafts)
                </text>
                {[
                  { label: `Complete (${waSummary.completedShafts})`, color: GIS_GREEN, y: 58 },
                  { label: `On-Going (${waSummary.ongoingShafts})`, color: GIS_BLUE, y: 79 },
                  { label: `Remaining (${waSummary.remainingShafts})`, color: GIS_RED, y: 100 },
                ].map((it) => (
                  <g key={it.label}>
                    <rect x={16} y={it.y} width={14} height={14} fill="#ffffff" stroke={it.color} strokeWidth={2.5} />
                    <text x={40} y={it.y + 11} fontSize={9.2} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                <text x={14} y={136} fontSize={10.0} fontWeight="700" fill="#1e3a8a">
                  Manhole Status ({waSummary.totalManholes} Nos)
                </text>
                {[
                  { label: `Complete — Cast & Ring 100% (${waSummary.completedManholes})`, color: GIS_GREEN, y: 146 },
                  {
                    label: `Cast Done / On-Going (${Math.max(0, waSummary.castingCompleteCount + waSummary.castingOngoingCount - waSummary.completedManholes)})`,
                    color: GIS_BLUE,
                    y: 166,
                  },
                  { label: `Remaining (${waSummary.castingRemainingCount})`, color: GIS_RED, y: 186 },
                ].map((it) => (
                  <g key={it.label}>
                    <circle cx={23} cy={it.y + 6} r={5.4} fill={it.color} stroke="#ffffff" strokeWidth={0.8} />
                    <text x={40} y={it.y + 9.5} fontSize={8.8} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}
                <text x={16} y={210} fontSize={8.2} fontWeight="700" fill="#1d4ed8">
                  Cast: {waSummary.castingCompleteCount} Done | {waSummary.castingOngoingCount} Ong | {waSummary.castingRemainingCount} Rem
                </text>
                <text x={16} y={225} fontSize={8.2} fontWeight="700" fill="#0284c7">
                  Ring: {waSummary.precastCompleteCount} Done | {waSummary.precastOngoingCount} Ong | {waSummary.precastRemainingCount} Rem
                </text>

                <text x={14} y={248} fontSize={10.0} fontWeight="700" fill="#1e3a8a">
                  Micro-Tunneling Status
                </text>
                {[
                  { label: 'Complete', color: GIS_GREEN, y: 260 },
                  { label: 'On-Going', color: GIS_BLUE, y: 279 },
                  { label: 'Remaining', color: GIS_RED, y: 298 },
                ].map((it) => (
                  <g key={it.label}>
                    <line x1={16} y1={it.y + 4} x2={44} y2={it.y + 4} stroke={it.color} strokeWidth={4.4} strokeLinecap="round" />
                    <text x={54} y={it.y + 7.5} fontSize={9.0} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                <rect x={202} y={258} width={15} height={15} fill="#fbcfe8" stroke="#9d174d" strokeWidth={1.8} />
                <text x={224} y={269} fontSize={8.8} fontWeight="700" fill="#831843">
                  Golapbag SPS
                </text>
                {viewMode !== 'overall' && (
                  <g>
                    <line x1={200} y1={288} x2={220} y2={288} stroke={GIS_HIGHLIGHT} strokeWidth={4.4} strokeLinecap="round" />
                    <text x={225} y={291} fontSize={7.6} fontWeight="800" fill="#ea580c">
                      {trunc(`New (${file2Label})`, 22)}
                    </text>
                  </g>
                )}

                <line x1={12} y1={317} x2={342} y2={317} stroke="#cbd5e1" strokeWidth={0.9} />

                <text x={14} y={336} fontSize={9.5} fontWeight="800" fill="#0f172a">
                  TOTAL LENGTH
                </text>
                <text x={340} y={336} textAnchor="end" fontSize={9.5} fontWeight="800" fill="#0f172a">
                  : {(waSummary.totalTunnelLengthM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={354} fontSize={9.5} fontWeight="800" fill="#15803d">
                  COMPLETED LENGTH
                </text>
                <text x={340} y={354} textAnchor="end" fontSize={9.5} fontWeight="800" fill="#15803d">
                  : {(waSummary.completedTunnelLengthM / 1000).toFixed(3)} km ({waSummary.tunnelPctOverall.toFixed(1)}%)
                </text>

                <text x={14} y={375} fontSize={8.8} fontWeight="700" fill="#334155">
                  1. DN 900 ({(waSummary.byDia.DN900.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={340} y={375} textAnchor="end" fontSize={8.8} fontWeight="700" fill="#0f172a">
                  Done: {(waSummary.byDia.DN900.completedM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={392} fontSize={8.8} fontWeight="700" fill="#334155">
                  2. DN 1100 ({(waSummary.byDia.DN1100.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={340} y={392} textAnchor="end" fontSize={8.8} fontWeight="700" fill="#0f172a">
                  Done: {(waSummary.byDia.DN1100.completedM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={409} fontSize={8.8} fontWeight="700" fill="#334155">
                  3. DN 1600 ({(waSummary.byDia.DN1600.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={340} y={409} textAnchor="end" fontSize={8.8} fontWeight="700" fill="#0f172a">
                  Done: {(waSummary.byDia.DN1600.completedM / 1000).toFixed(3)} km
                </text>

                <rect x={12} y={421} width={330} height={43} rx={3} fill="#f0fdf4" stroke="#16a34a" strokeWidth={0.9} />
                <text x={20} y={437} fontSize={8.4} fontWeight="700" fill="#166534">
                  Golapbag SPS: {pumpStation.layers.filter((l) => l.status === 'complete').length}/5 Lower (Cast: {pumpStation.castingCompleteM}m) | Room: {pumpStation.machineRoom.status.toUpperCase()}
                </text>
                <text x={20} y={454} fontSize={8.4} fontWeight="700" fill="#0f766e">
                  Sinking: {pumpStation.sinkingCompletedM}m / {pumpStation.totalHeightM}m [{pumpStation.sinkingStatus.toUpperCase()}
                  {pumpStation.sinkingStatus !== 'complete'
                    ? ` | Rem: ${Math.max(0, Number((pumpStation.totalHeightM - pumpStation.sinkingCompletedM).toFixed(2)))}m`
                    : ''}]
                </text>
              </g>

              {renderCompassRose(mapX + mapW - 60, mapY + 62, 34)}
            </g>
          );
        })()}

        {/* ================================================================ */}
        {/* PAGE 3: WB PROGRESS MAP (PORTRAIT)                               */}
        {/* ================================================================ */}
        {kind === 'wb-map' && (() => {
          const split = computeWbPolylineSplit(
            wbData.nodes,
            wbData.totalLengthM,
            wbData.completedLengthM,
            wbPrevCompletedM
          );
          const toPts = (pts: Array<{ lat: number; lon: number }>) =>
            pts
              .map((p) => {
                const pr = viewport.project(p.lat, p.lon);
                return `${pr.x.toFixed(1)},${pr.y.toFixed(1)}`;
              })
              .join(' ');

          const tipPt = viewport.project(split.tipPoint.lat, split.tipPoint.lon);
          const wbRemM = Math.max(0, wbData.totalLengthM - wbData.completedLengthM);
          const wbPct = wbData.totalLengthM > 0 ? (wbData.completedLengthM / wbData.totalLengthM) * 100 : 0;

          const occupied: RectBox[] = [legendBox, compassBox, scaleBox];
          const spsPt = viewport.project(spsCoord.lat, spsCoord.lon);
          const wbById = new Map(wbData.nodes.map((n) => [n.id, n]));

          const wb1Node = wbById.get('WB1');
          const wb1Pt = wb1Node ? viewport.project(wb1Node.lat, wb1Node.lon) : null;
          const wbSpsRawPt = viewport.project(spsCoord.lat, spsCoord.lon);
          const wbSpsY =
            wb1Pt && Math.hypot(wbSpsRawPt.x - wb1Pt.x, wbSpsRawPt.y - wb1Pt.y) < 26
              ? wb1Pt.y - 38
              : wbSpsRawPt.y - 11;

          for (const nd of wbData.nodes) {
            const p = viewport.project(nd.lat, nd.lon);
            occupied.push({ x0: p.x - 9, y0: p.y - 9, x1: p.x + 9, y1: p.y + 9 });
          }
          for (const cp of wbData.customPoints || []) {
            const p = viewport.project(cp.lat, cp.lon);
            occupied.push({ x0: p.x - 11, y0: p.y - 11, x1: p.x + 11, y1: p.y + 11 });
          }
          occupied.push({
            x0: wbSpsRawPt.x - 24,
            y0: wbSpsY - 2,
            x1: wbSpsRawPt.x + 28,
            y1: wbSpsY + 24,
          });
          occupied.push({
            x0: tipPt.x + 20,
            y0: tipPt.y - 12,
            x1: tipPt.x + 122,
            y1: tipPt.y + 12,
          });

          const washoutCoord = wbData.washoutCoord || DEFAULT_WASHOUT_COORD;
          const airValveCoord = wbData.airValveCoord || DEFAULT_AIR_VALVE_COORD;
          const wb12Node = wbById.get('WB12');
          const wb35Node = wbById.get('WB35');
          const juncNode = wbById.get('WB38');

          const washProj = viewport.project(washoutCoord.lat, washoutCoord.lon);
          const wb12Proj = wb12Node ? viewport.project(wb12Node.lat, wb12Node.lon) : washProj;
          const washOffX = Math.hypot(washProj.x - wb12Proj.x, washProj.y - wb12Proj.y) < 18 ? -24 : 0;
          const wx = washProj.x + washOffX;
          const wy = washProj.y;
          occupied.push({ x0: wx - 16, y0: wy - 16, x1: wx + 16, y1: wy + 16 });

          const airProj = viewport.project(airValveCoord.lat, airValveCoord.lon);
          const wb35Proj = wb35Node ? viewport.project(wb35Node.lat, wb35Node.lon) : airProj;
          const airOffY = Math.hypot(airProj.x - wb35Proj.x, airProj.y - wb35Proj.y) < 18 ? -26 : 0;
          const ax = airProj.x;
          const ay = airProj.y + airOffY;
          occupied.push({ x0: ax - 16, y0: ay - 16, x1: ax + 16, y1: ay + 16 });

          const wbZonePt = viewport.project(23.7145, 90.4272);

          const wbLandmarks: Array<{
            id: string;
            label: string;
            dx: number;
            dy: number;
            side: 'left' | 'right';
            targetCoord?: { lat: number; lon: number };
            stopDist: number;
          }> = [
            { id: 'WB8', label: 'Dhalpur Notun Rasta', dx: -225, dy: -36, side: 'left', targetCoord: { lat: 23.7176, lon: 90.4294 }, stopDist: 10 },
            { id: 'WB17', label: 'Boubazar Road', dx: 74, dy: 12, side: 'right', targetCoord: { lat: 23.7145, lon: 90.4314 }, stopDist: 10 },
            { id: 'WB24', label: 'Mayor Hanif Flyover', dx: 68, dy: 34, side: 'right', targetCoord: { lat: 23.7117, lon: 90.4297 }, stopDist: 10 },
            { id: 'WB27', label: 'Ideal Road', dx: -170, dy: -66, side: 'left', targetCoord: { lat: 23.7116, lon: 90.4275 }, stopDist: 10 },
            { id: 'WB32', label: 'Doyagonj Bazar Road', dx: 24, dy: 58, side: 'right', targetCoord: { lat: 23.7099, lon: 90.4266 }, stopDist: 10 },
            { id: 'WB38', label: 'Doyagonj Chowrasta (Junc. WD2 & WD3)', dx: -24, dy: 64, side: 'right', stopDist: 13 },
          ];

          return (
            <g>
              {/* DSCC Zone Highlight Pill */}
              {renderZoneBadge(wbZonePt.x, wbZonePt.y, 'DSCC ZONE 05', 'dscc', occupied)}

              {(wbData.customKmlLines || []).map((ln, li) => (
                <polyline
                  key={`wb-kml-${li}`}
                  points={ln.coords
                    .map(([la, lo]) => {
                      const p = viewport.project(la, lo);
                      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth={1.6}
                  strokeDasharray="4,3"
                />
              ))}

              {/* Remaining Segment (RED) */}
              {split.remainingPoints.length >= 2 && (
                <>
                  <polyline points={toPts(split.remainingPoints)} fill="none" stroke="#ffffff" strokeWidth={8.5} strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points={toPts(split.remainingPoints)} fill="none" stroke={GIS_RED} strokeWidth={5.2} strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}

              {/* Completed Segment (GREEN) */}
              {split.prevPoints.length >= 2 && (
                <>
                  <polyline points={toPts(split.prevPoints)} fill="none" stroke="#ffffff" strokeWidth={9.0} strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points={toPts(split.prevPoints)} fill="none" stroke={GIS_GREEN} strokeWidth={5.8} strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}

              {viewMode !== 'overall' && split.currPoints.length >= 2 && (
                <polyline
                  points={toPts(split.currPoints)}
                  fill="none"
                  stroke={GIS_HIGHLIGHT}
                  strokeWidth={6.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Golapbag SPS Pink Box */}
              <g>
                <rect
                  x={wbSpsRawPt.x - 22}
                  y={wbSpsY}
                  width={48}
                  height={22}
                  rx={3}
                  fill="#fbcfe8"
                  stroke="#9d174d"
                  strokeWidth={2.2}
                />
                <text x={wbSpsRawPt.x + 2} y={wbSpsY + 14.5} textAnchor="middle" fontSize={9.0} fontWeight="800" fill="#831843">
                  SPS
                </text>
              </g>

              {/* LARGE HIGHLIGHTED LIVE WASHOUT & AIR VALVE MARKERS + BOLD ARROWS */}
              <g>
                <circle cx={wx} cy={wy} r={14} fill="#bbf7d0" fillOpacity={0.92} stroke="#15803d" strokeWidth={2.2} />
                <polygon points={`${wx},${wy - 9} ${wx - 8},${wy + 6} ${wx + 8},${wy + 6}`} fill="#16a34a" stroke="#ffffff" strokeWidth={1.2} />
                {renderHighlightedCallout(wx, wy, 'WASHOUT', occupied, mapBounds, {
                  key: 'wb-washout-callout',
                  preferredSide: 'left',
                  baseOffsetX: -185,
                  baseOffsetY: 0,
                  fontSize: 15.5,
                  stopDist: 16,
                  bgFill: '#dcfce7',
                  borderStroke: '#15803d',
                  textFill: '#14532d',
                  arrowStroke: '#15803d',
                })}
              </g>
              <g>
                <circle cx={ax} cy={ay} r={14} fill="#bae6fd" fillOpacity={0.92} stroke="#0369a1" strokeWidth={2.2} />
                <polygon points={`${ax},${ay - 9} ${ax - 8},${ay + 6} ${ax + 8},${ay + 6}`} fill="#0284c7" stroke="#ffffff" strokeWidth={1.2} />
                {renderHighlightedCallout(ax, ay, 'AIR VALVE', occupied, mapBounds, {
                  key: 'wb-airvalve-callout',
                  preferredSide: 'top',
                  baseOffsetX: -66,
                  baseOffsetY: -78,
                  fontSize: 15.5,
                  stopDist: 16,
                  bgFill: '#e0f2fe',
                  borderStroke: '#0369a1',
                  textFill: '#0c4a6e',
                  arrowStroke: '#0369a1',
                })}
              </g>
              {juncNode && (() => {
                const jp = viewport.project(juncNode.lat, juncNode.lon);
                return <circle cx={jp.x} cy={jp.y} r={10.5} fill="none" stroke="#9333ea" strokeWidth={2.4} />;
              })()}

              {/* Highlighted Corridor Landmark & Surrounding Road Callouts */}
              {wbLandmarks.map((lm) => {
                const nd = wbById.get(lm.id);
                if (!nd && !lm.targetCoord) return null;
                const coord = lm.targetCoord || nd!;
                const pt = viewport.project(coord.lat, coord.lon);
                return renderHighlightedCallout(pt.x, pt.y, lm.label, occupied, mapBounds, {
                  key: `wb-lm-${lm.id}`,
                  preferredSide: lm.side,
                  baseOffsetX: lm.dx,
                  baseOffsetY: lm.dy,
                  fontSize: 15.0,
                  stopDist: lm.stopDist,
                  bgFill: '#fffbeb',
                  borderStroke: '#b45309',
                  arrowStroke: '#b45309',
                });
              })}

              {/* WB1 .. WB38 Points & Labels */}
              {wbData.nodes.map((n, idx) => {
                const pt = viewport.project(n.lat, n.lon);
                const col = statusStroke(n.status);
                const isSel = selectedShaftId === n.id;
                const displayLbl = n.id.replace(/^WB(\d)$/i, 'WB0$1');

                const lmMatch = wbLandmarks.find((l) => l.id === n.id);
                const prefSide: 'left' | 'right' | 'top' | 'bottom' =
                  n.id === 'WB38'
                    ? 'left'
                    : n.id === 'WB23' || n.id === 'WB24'
                    ? 'left'
                    : n.id === 'WB32'
                    ? 'top'
                    : lmMatch
                    ? lmMatch.side === 'right'
                      ? 'left'
                      : 'right'
                    : idx <= 5
                    ? idx % 2 === 0
                      ? 'bottom'
                      : 'left'
                    : idx <= 26
                    ? idx % 2 === 0
                      ? 'left'
                      : 'right'
                    : idx % 2 === 0
                    ? 'top'
                    : 'bottom';

                const lblPos = resolveSmartLabel(
                  pt.x,
                  pt.y,
                  displayLbl,
                  13.5,
                  occupied,
                  mapBounds,
                  prefSide,
                  9.8
                );

                return (
                  <g
                    key={n.id}
                    style={{ cursor: onSelectWbNode ? 'pointer' : 'default' }}
                    onClick={() => onSelectWbNode?.(n.id)}
                  >
                    {isSel && (
                      <rect x={pt.x - 11.5} y={pt.y - 11.5} width={23} height={23} rx={3} fill="none" stroke="#0284c7" strokeWidth={2.2} />
                    )}
                    <rect x={pt.x - 6.8} y={pt.y - 6.8} width={13.6} height={13.6} fill="#ffffff" stroke={col} strokeWidth={2.5} />
                    <circle cx={pt.x} cy={pt.y} r={3.2} fill={col} />
                    {lblPos.leaderNeeded && (
                      <line x1={pt.x} y1={pt.y} x2={lblPos.x} y2={lblPos.y - 2} stroke="#475569" strokeWidth={0.85} />
                    )}
                    <HaloText
                      x={lblPos.x}
                      y={lblPos.y}
                      text={displayLbl}
                      fontSize={13.5}
                      fontWeight="900"
                      fill="#0f172a"
                      haloWidth={4.2}
                      textAnchor={lblPos.anchor}
                    />
                  </g>
                );
              })}

              {/* Custom Added Map Points (WB) */}
              {renderCustomMapPoints(wbData.customPoints, viewport, occupied, mapBounds)}

              {/* Blue Completion Tip Marker */}
              <g>
                <circle cx={tipPt.x} cy={tipPt.y} r={11.5} fill="#3b82f6" fillOpacity={0.28} />
                <circle cx={tipPt.x} cy={tipPt.y} r={6.8} fill={GIS_BLUE} stroke="#ffffff" strokeWidth={2.0} />
                <line x1={tipPt.x + 7} y1={tipPt.y} x2={tipPt.x + 22} y2={tipPt.y} stroke="#1e3a8a" strokeWidth={1.6} />
                <rect x={tipPt.x + 22} y={tipPt.y - 10} width={96} height={20} rx={3.5} fill="#1e3a8a" />
                <text x={tipPt.x + 70} y={tipPt.y + 3.2} textAnchor="middle" fontSize={8.5} fontWeight="700" fill="#ffffff">
                  Done: {wbData.completedLengthM.toFixed(1)} m
                </text>
              </g>

              {/* Top-Left Compass Rose + Legend Card (NO "Node" word & NO counts next to Complete/On-Going/Remaining!) */}
              {renderCompassRose(mapX + 74, mapY + 62, 34)}

              <g transform={`translate(${legendBox.x0}, ${legendBox.y0})`}>
                <rect x={2} y={3} width={328} height={338} rx={5} fill="#0f172a" fillOpacity={0.1} />
                <rect
                  x={0}
                  y={0}
                  width={328}
                  height={338}
                  rx={5}
                  fill="#ffffff"
                  fillOpacity={0.95}
                  stroke="#1e293b"
                  strokeWidth={1.2}
                />
                <rect x={0} y={0} width={328} height={29} rx={5} fill="#eff6ff" stroke="#1e293b" strokeWidth={0.9} />
                <text x={14} y={19.5} fontSize={12.8} fontWeight="800" fill="#0f172a">
                  Legend — WB Section Progress
                </text>

                <text x={14} y={49} fontSize={10.0} fontWeight="700" fill="#1e3a8a">
                  WB Progress Status
                </text>
                {[
                  { label: 'Complete', color: GIS_GREEN, y: 59 },
                  { label: 'On-Going', color: GIS_BLUE, y: 79 },
                  { label: 'Remaining', color: GIS_RED, y: 99 },
                ].map((it) => (
                  <g key={it.label}>
                    <rect x={16} y={it.y} width={14} height={14} fill="#ffffff" stroke={it.color} strokeWidth={2.5} />
                    <circle cx={23} cy={it.y + 7} r={3.0} fill={it.color} />
                    <text x={40} y={it.y + 10.5} fontSize={9.4} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                <line x1={12} y1={124} x2={316} y2={124} stroke="#cbd5e1" strokeWidth={0.9} />
                <line x1={16} y1={144} x2={48} y2={144} stroke={GIS_GREEN} strokeWidth={4.8} strokeLinecap="round" />
                <text x={58} y={147.5} fontSize={9.2} fontWeight="700" fill="#15803d">
                  WB Complete = {wbData.completedLengthM.toFixed(1)} m ({wbPct.toFixed(1)}%)
                </text>

                <line x1={16} y1={166} x2={48} y2={166} stroke={GIS_RED} strokeWidth={4.8} strokeLinecap="round" />
                <text x={58} y={169.5} fontSize={9.2} fontWeight="700" fill="#dc2626">
                  WB Remaining = {wbRemM.toFixed(1)} m
                </text>

                <circle cx={32} cy={188} r={5.4} fill={GIS_BLUE} stroke="#ffffff" strokeWidth={1.3} />
                <text x={58} y={191.5} fontSize={9.0} fontWeight="600" fill="#1e3a8a">
                  Completion Tip Marker
                </text>

                {viewMode !== 'overall' && (
                  <g>
                    <line x1={16} y1={209} x2={48} y2={209} stroke={GIS_HIGHLIGHT} strokeWidth={5.2} strokeLinecap="round" />
                    <text x={58} y={212.5} fontSize={8.0} fontWeight="800" fill="#ea580c">
                      {trunc(`Added (${file2Label}): +${Math.max(0, wbData.completedLengthM - (wbPrevCompletedM ?? wbData.completedLengthM)).toFixed(1)} m`, 42)}
                    </text>
                  </g>
                )}

                <line x1={12} y1={226} x2={316} y2={226} stroke="#cbd5e1" strokeWidth={0.9} />
                <text x={14} y={244} fontSize={9.5} fontWeight="800" fill="#0f172a">
                  WB Total Pipe Length = {(wbData.totalLengthM / 1000).toFixed(3)} km ({wbData.totalLengthM} m)
                </text>
                <text x={14} y={261} fontSize={8.7} fontWeight="600" fill="#334155">
                  Specification: {wbData.method} {wbData.pipeDia}
                </text>

                <line x1={12} y1={273} x2={316} y2={273} stroke="#cbd5e1" strokeWidth={0.9} />
                <text x={14} y={291} fontSize={9.2} fontWeight="700" fill="#1e3a8a">
                  Appurtenances & Reference Points:
                </text>
                <rect x={16} y={300} width={14} height={12} fill="#fbcfe8" stroke="#9d174d" strokeWidth={1.6} />
                <text x={36} y={310} fontSize={8.5} fontWeight="700" fill="#831843">Golapbag SPS</text>

                <circle cx={128} cy={306} r={7.5} fill="#bbf7d0" stroke="#15803d" strokeWidth={1.4} />
                <polygon points="128,301 124,309 132,309" fill="#16a34a" />
                <text x={140} y={310} fontSize={8.5} fontWeight="700" fill="#14532d">Washout</text>

                <circle cx={204} cy={306} r={7.5} fill="#bae6fd" stroke="#0369a1" strokeWidth={1.4} />
                <polygon points="204,301 200,309 208,309" fill="#0284c7" />
                <text x={216} y={310} fontSize={8.5} fontWeight="700" fill="#0c4a6e">Air Valve</text>

                <text x={16} y={328} fontSize={8.2} fontWeight="600" fill="#6b21a8">
                  End Junction: Doyagonj Chowrasta (WD2 / WD3 / WC-1)
                </text>
              </g>
            </g>
          );
        })()}

        {/* ================================================================ */}
        {/* PAGE 4: WC PROGRESS MAP (PORTRAIT)                               */}
        {/* ================================================================ */}
        {kind === 'wc-map' && (() => {
          const shaftById = new Map<string, ShaftRecord>();
          for (const s of wcData.shafts) shaftById.set(s.id, s);

          const occupied: RectBox[] = [legendBox, compassBox, scaleBox];
          const wcGeoById = new Map(wcData.geoNodes.map((g) => [g.id, g]));

          for (const gNode of wcData.geoNodes) {
            const p = viewport.project(gNode.lat, gNode.lon);
            occupied.push({ x0: p.x - 10, y0: p.y - 10, x1: p.x + 10, y1: p.y + 10 });
          }
          for (const cp of wcData.customPoints || []) {
            const p = viewport.project(cp.lat, cp.lon);
            occupied.push({ x0: p.x - 11, y0: p.y - 11, x1: p.x + 11, y1: p.y + 11 });
          }

          const siphonNode = wcGeoById.get('WC-9');
          const bridgeNode = wcGeoById.get('WC-15');
          const stpNode = wcGeoById.get('WC-27');

          if (stpNode) {
            const tp = viewport.project(stpNode.lat, stpNode.lon);
            const stpBoxX = Math.min(tp.x - 14, mapX + mapW - 146);
            occupied.push({ x0: stpBoxX - 2, y0: tp.y + 54, x1: stpBoxX + 140, y1: tp.y + 88 });
          }

          const zone5Pt = viewport.project(23.6960, 90.4408);
          const zone10Pt = viewport.project(23.6880, 90.4455);

          const wcLandmarks: Array<{
            id: string;
            label: string;
            dx: number;
            dy: number;
            side: 'left' | 'right';
            targetCoord?: { lat: number; lon: number };
            stopDist: number;
          }> = [
            { id: 'WC-1', label: 'Doyagonj Chowrasta (Start WC-1)', dx: 90, dy: -10, side: 'right', stopDist: 10 },
            { id: 'WC-4', label: 'Shahid Faruk Road', dx: 82, dy: 12, side: 'right', targetCoord: { lat: 23.7073, lon: 90.4266 }, stopDist: 10 },
            { id: 'WC-9', label: 'Inverted Siphon & Underpass', dx: 62, dy: -8, side: 'right', stopDist: 17 },
            { id: 'WC-11', label: 'Gendaria Rail Station (West)', dx: -295, dy: 8, side: 'left', targetCoord: { lat: 23.6983, lon: 90.4309 }, stopDist: 24 },
            { id: 'WC-13', label: 'Khandakar Road', dx: 76, dy: -10, side: 'right', targetCoord: { lat: 23.6962, lon: 90.4335 }, stopDist: 10 },
            { id: 'WC-15', label: '1st BD-China Friendship Bridge Rd', dx: -295, dy: 20, side: 'left', targetCoord: { lat: 23.6939, lon: 90.4328 }, stopDist: 10 },
            { id: 'WC-17', label: 'Jurain Rail Gate / Titas Gas Rd', dx: 82, dy: -16, side: 'right', targetCoord: { lat: 23.6914, lon: 90.4372 }, stopDist: 10 },
            { id: 'WC-21', label: 'Shyampur Kadamtoli', dx: -265, dy: 12, side: 'left', stopDist: 34 },
          ];

          return (
            <g>
              {/* Highlighted DSCC Zone Ribbons */}
              {renderZoneBadge(zone5Pt.x, zone5Pt.y, 'DSCC ZONE 05', 'dscc', occupied)}
              {renderZoneBadge(zone10Pt.x, zone10Pt.y, 'DSCC ZONE 10', 'dscc', occupied)}

              {(wcData.customKmlLines || []).map((ln, li) => (
                <polyline
                  key={`wc-kml-${li}`}
                  points={ln.coords
                    .map(([la, lo]) => {
                      const p = viewport.project(la, lo);
                      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth={1.6}
                  strokeDasharray="4,3"
                />
              ))}

              {/* Micro-tunneling alignment segments WC-i -> WC-(i+1) */}
              {wcData.geoNodes.slice(0, -1).map((gNode, idx) => {
                const nextNode = wcData.geoNodes[idx + 1];
                const p1 = viewport.project(gNode.lat, gNode.lon);
                const p2 = viewport.project(nextNode.lat, nextNode.lon);
                const sh = shaftById.get(gNode.id);
                const mtStatus = sh ? getTunnelStatus(sh) : 'remaining';
                const col = statusStroke(mtStatus);
                const bSnap = baseline.wcShafts?.[gNode.id];
                const deltaInfo = sh ? getDeltaProgressBadge(sh, bSnap) : { hasNewTunnel: false };

                return (
                  <g key={`wc-seg-${gNode.id}`}>
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#ffffff" strokeWidth={8.0} strokeLinecap="round" />
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={col} strokeWidth={5.0} strokeLinecap="round" />
                    {viewMode !== 'overall' && deltaInfo.hasNewTunnel && (
                      <line
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke={GIS_HIGHLIGHT}
                        strokeWidth={5.4}
                        strokeLinecap="round"
                      />
                    )}
                  </g>
                );
              })}

              {/* Special Infrastructure Symbols */}
              {siphonNode && (() => {
                const sp = viewport.project(siphonNode.lat, siphonNode.lon);
                return (
                  <rect
                    x={sp.x - 15}
                    y={sp.y - 6}
                    width={30}
                    height={12}
                    fill="#1e293b"
                    fillOpacity={0.28}
                    stroke="#0f172a"
                    strokeWidth={1.8}
                  />
                );
              })()}
              {bridgeNode && (() => {
                const bp = viewport.project(bridgeNode.lat, bridgeNode.lon);
                return <circle cx={bp.x} cy={bp.y} r={11.5} fill="none" stroke="#0284c7" strokeWidth={2.0} strokeDasharray="3,2" />;
              })()}
              {stpNode && (() => {
                const tp = viewport.project(stpNode.lat, stpNode.lon);
                const stpBoxX = Math.min(tp.x - 14, mapX + mapW - 146);
                return (
                  <g>
                    <rect
                      x={stpBoxX}
                      y={tp.y + 56}
                      width={138}
                      height={30}
                      rx={4}
                      fill="#dbeafe"
                      stroke="#1e3a8a"
                      strokeWidth={2.0}
                    />
                    <text x={stpBoxX + 69} y={tp.y + 75} textAnchor="middle" fontSize={12.4} fontWeight="900" fill="#1e3a8a">
                      Pagla STP Outfall
                    </text>
                  </g>
                );
              })()}

              {/* Highlighted WC Landmark & Surrounding Road Callouts */}
              {wcLandmarks.map((lm) => {
                const g = wcGeoById.get(lm.id);
                if (!g && !lm.targetCoord) return null;
                const coord = lm.targetCoord || g!;
                const pt = viewport.project(coord.lat, coord.lon);
                return renderHighlightedCallout(pt.x, pt.y, lm.label, occupied, mapBounds, {
                  key: `wc-lm-${lm.id}`,
                  preferredSide: lm.side,
                  baseOffsetX: lm.dx,
                  baseOffsetY: lm.dy,
                  fontSize: 15.0,
                  stopDist: lm.stopDist,
                  bgFill: '#fffbeb',
                  borderStroke: '#b45309',
                  arrowStroke: '#b45309',
                });
              })}

              {/* WC-1 .. WC-27 Nodes */}
              {wcData.geoNodes.map((gNode, idx) => {
                const pt = viewport.project(gNode.lat, gNode.lon);
                const sh = shaftById.get(gNode.id);
                const shStatus = sh ? getShaftStatus(sh) : 'remaining';
                const mhStatus = sh ? getManholeStatus(sh) : 'remaining';
                const castSt = sh ? getCastingStatus(sh) : 'remaining';
                const ringSt = sh ? getRingStatus(sh) : 'remaining';
                const isSel = selectedShaftId === gNode.id;

                const outerCol = statusStroke(shStatus);
                const innerCol =
                  mhStatus === 'complete'
                    ? GIS_GREEN
                    : castSt === 'complete' || mhStatus === 'ongoing'
                    ? GIS_BLUE
                    : GIS_RED;

                const bSnap = baseline.wcShafts?.[gNode.id];
                const deltaInfo = sh
                  ? getDeltaProgressBadge(sh, bSnap)
                  : { hasNewLayer: false, hasNewMh: false, hasNewTunnel: false };

                const lmMatch = wcLandmarks.find((l) => l.id === gNode.id);
                const prefSide: 'left' | 'right' = lmMatch
                  ? lmMatch.side === 'right'
                    ? 'left'
                    : 'right'
                  : idx % 2 === 0
                  ? 'right'
                  : 'left';
                const lblPos = resolveSmartLabel(
                  pt.x,
                  pt.y,
                  gNode.id,
                  14.5,
                  occupied,
                  mapBounds,
                  prefSide,
                  10.5
                );

                return (
                  <g
                    key={gNode.id}
                    style={{ cursor: onSelectShaft ? 'pointer' : 'default' }}
                    onClick={() => onSelectShaft?.(gNode.id, 'shaft')}
                  >
                    {viewMode !== 'overall' && (deltaInfo.hasNewLayer || deltaInfo.hasNewMh) && (
                      <rect x={pt.x - 12} y={pt.y - 12} width={24} height={24} rx={3} fill="none" stroke={GIS_HIGHLIGHT} strokeWidth={2.0} />
                    )}
                    {isSel && (
                      <rect x={pt.x - 13} y={pt.y - 13} width={26} height={26} rx={3} fill="none" stroke="#0284c7" strokeWidth={2.2} />
                    )}
                    <rect x={pt.x - 8.2} y={pt.y - 8.2} width={16.4} height={16.4} fill="#ffffff" stroke={outerCol} strokeWidth={2.7} />
                    <circle cx={pt.x} cy={pt.y} r={4.4} fill={innerCol} stroke={ringSt === 'ongoing' ? '#0ea5e9' : '#ffffff'} strokeWidth={0.9} />
                    {lblPos.leaderNeeded && (
                      <line x1={pt.x} y1={pt.y} x2={lblPos.x} y2={lblPos.y - 2} stroke="#475569" strokeWidth={0.9} />
                    )}
                    <HaloText
                      x={lblPos.x}
                      y={lblPos.y}
                      text={gNode.id}
                      fontSize={14.5}
                      fontWeight="900"
                      fill="#0f172a"
                      haloWidth={4.5}
                      textAnchor={lblPos.anchor}
                    />
                  </g>
                );
              })}

              {/* Custom Added Map Points (WC) */}
              {renderCustomMapPoints(wcData.customPoints, viewport, occupied, mapBounds)}

              {/* WC Bottom-Left Frosted Legend & Summary Card */}
              <g transform={`translate(${legendBox.x0}, ${legendBox.y0})`}>
                <rect x={2} y={3} width={354} height={474} rx={5} fill="#0f172a" fillOpacity={0.1} />
                <rect
                  x={0}
                  y={0}
                  width={354}
                  height={474}
                  rx={5}
                  fill="#ffffff"
                  fillOpacity={0.95}
                  stroke="#1e293b"
                  strokeWidth={1.2}
                />
                <rect x={0} y={0} width={354} height={29} rx={5} fill="#eff6ff" stroke="#1e293b" strokeWidth={0.9} />
                <text x={14} y={19.5} fontSize={12.8} fontWeight="800" fill="#0f172a">
                  Legend — WC Section Progress
                </text>

                <text x={14} y={48} fontSize={10.0} fontWeight="700" fill="#1e3a8a">
                  WC Shaft Status ({wcSummary.totalShafts} Shafts)
                </text>
                {[
                  { label: `Complete (${wcSummary.completedShafts})`, color: GIS_GREEN, y: 58 },
                  { label: `On-Going (${wcSummary.ongoingShafts})`, color: GIS_BLUE, y: 79 },
                  { label: `Remaining (${wcSummary.remainingShafts})`, color: GIS_RED, y: 100 },
                ].map((it) => (
                  <g key={it.label}>
                    <rect x={16} y={it.y} width={14} height={14} fill="#ffffff" stroke={it.color} strokeWidth={2.5} />
                    <text x={40} y={it.y + 11} fontSize={9.2} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                <text x={14} y={136} fontSize={10.0} fontWeight="700" fill="#1e3a8a">
                  WC Manhole Status ({wcSummary.totalManholes} Nos)
                </text>
                {[
                  { label: `Complete — Cast & Ring 100% (${wcSummary.completedManholes})`, color: GIS_GREEN, y: 146 },
                  {
                    label: `Cast Done / On-Going (${Math.max(0, wcSummary.castingCompleteCount + wcSummary.castingOngoingCount - wcSummary.completedManholes)})`,
                    color: GIS_BLUE,
                    y: 166,
                  },
                  { label: `Remaining (${wcSummary.castingRemainingCount})`, color: GIS_RED, y: 186 },
                ].map((it) => (
                  <g key={it.label}>
                    <circle cx={23} cy={it.y + 6} r={5.4} fill={it.color} stroke="#ffffff" strokeWidth={0.8} />
                    <text x={40} y={it.y + 9.5} fontSize={8.8} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}
                <text x={16} y={210} fontSize={8.2} fontWeight="700" fill="#1d4ed8">
                  Cast: {wcSummary.castingCompleteCount} Done | {wcSummary.castingOngoingCount} Ong | {wcSummary.castingRemainingCount} Rem
                </text>
                <text x={16} y={225} fontSize={8.2} fontWeight="700" fill="#0284c7">
                  Ring: {wcSummary.precastCompleteCount} Done | {wcSummary.precastOngoingCount} Ong | {wcSummary.precastRemainingCount} Rem
                </text>

                <text x={14} y={248} fontSize={10.0} fontWeight="700" fill="#1e3a8a">
                  WC Micro-Tunneling Status
                </text>
                {[
                  { label: 'Complete', color: GIS_GREEN, y: 260 },
                  { label: 'On-Going', color: GIS_BLUE, y: 279 },
                  { label: 'Remaining', color: GIS_RED, y: 298 },
                ].map((it) => (
                  <g key={it.label}>
                    <line x1={16} y1={it.y + 4} x2={44} y2={it.y + 4} stroke={it.color} strokeWidth={4.4} strokeLinecap="round" />
                    <text x={54} y={it.y + 7.5} fontSize={9.0} fontWeight="600" fill="#0f172a">
                      {it.label}
                    </text>
                  </g>
                ))}

                <rect x={202} y={258} width={16} height={12} fill="#dbeafe" stroke="#1e3a8a" strokeWidth={1.6} />
                <text x={224} y={268} fontSize={8.6} fontWeight="700" fill="#1e3a8a">Pagla STP</text>
                <rect x={202} y={277} width={16} height={9} fill="#1e293b" fillOpacity={0.28} stroke="#0f172a" strokeWidth={1.3} />
                <text x={224} y={285} fontSize={8.4} fontWeight="700" fill="#0f172a">Underpass / Siphon</text>
                {viewMode !== 'overall' && (
                  <g>
                    <line x1={200} y1={302} x2={220} y2={302} stroke={GIS_HIGHLIGHT} strokeWidth={4.4} strokeLinecap="round" />
                    <text x={225} y={305} fontSize={7.6} fontWeight="800" fill="#ea580c">
                      {trunc(`New (${file2Label})`, 22)}
                    </text>
                  </g>
                )}

                <line x1={12} y1={317} x2={342} y2={317} stroke="#cbd5e1" strokeWidth={0.9} />

                <text x={14} y={336} fontSize={9.5} fontWeight="800" fill="#0f172a">
                  TOTAL LENGTH
                </text>
                <text x={340} y={336} textAnchor="end" fontSize={9.5} fontWeight="800" fill="#0f172a">
                  : {(wcSummary.totalTunnelLengthM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={354} fontSize={9.5} fontWeight="800" fill="#15803d">
                  COMPLETED LENGTH
                </text>
                <text x={340} y={354} textAnchor="end" fontSize={9.5} fontWeight="800" fill="#15803d">
                  : {(wcSummary.completedTunnelLengthM / 1000).toFixed(3)} km ({wcSummary.tunnelPctOverall.toFixed(1)}%)
                </text>

                <text x={14} y={375} fontSize={8.8} fontWeight="700" fill="#334155">
                  1. DN 1800 ({(wcSummary.byDia.DN1800.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={340} y={375} textAnchor="end" fontSize={8.8} fontWeight="700" fill="#0f172a">
                  Done: {(wcSummary.byDia.DN1800.completedM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={392} fontSize={8.8} fontWeight="700" fill="#334155">
                  2. DN 2400 ({(wcSummary.byDia.DN2400.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={340} y={392} textAnchor="end" fontSize={8.8} fontWeight="700" fill="#0f172a">
                  Done: {(wcSummary.byDia.DN2400.completedM / 1000).toFixed(3)} km
                </text>
                <text x={14} y={409} fontSize={8.8} fontWeight="700" fill="#334155">
                  3. DN 2600 ({(wcSummary.byDia.DN2600.totalM / 1000).toFixed(3)} km)
                </text>
                <text x={340} y={409} textAnchor="end" fontSize={8.8} fontWeight="700" fill="#0f172a">
                  Done: {(wcSummary.byDia.DN2600.completedM / 1000).toFixed(3)} km
                </text>

                <rect x={12} y={421} width={330} height={43} rx={3} fill="#faf5ff" stroke="#9333ea" strokeWidth={0.9} />
                <text x={20} y={437} fontSize={8.4} fontWeight="700" fill="#6b21a8">
                  Corridor: Doyagonj Chowrasta (WC-1) to Pagla STP (WC-27)
                </text>
                <text x={20} y={454} fontSize={8.4} fontWeight="700" fill={wcSummary.completedTunnelLengthM > 0 || wcSummary.completedShafts > 0 ? '#15803d' : '#b91c1c'}>
                  Status: {wcSummary.completedTunnelLengthM > 0 || wcSummary.completedShafts > 0 ? 'Active Construction' : 'Not Started (All Remaining)'}
                </text>
              </g>

              {renderCompassRose(mapX + mapW - 60, mapY + 62, 34)}
            </g>
          );
        })()}

        {/* Shared Bottom-Right Scale Bar + Esri Credit ONLY */}
        {renderScaleBarAndAttribution(
          viewport,
          mapX + mapW - 14,
          mapY + mapH - 14
        )}
      </g>

      {/* Double Neatline Frame */}
      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="none" stroke="#0f172a" strokeWidth={1.6} />
      <rect x={mapX - 4} y={mapY - 4} width={mapW + 8} height={mapH + 8} fill="none" stroke="#334155" strokeWidth={0.7} />
    </svg>
  );
};
