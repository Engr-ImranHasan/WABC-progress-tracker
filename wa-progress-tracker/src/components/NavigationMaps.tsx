import React, { useMemo } from 'react';
import {
  CustomMapPoint,
  GeoNodeCoord,
  ShaftRecord,
  ShaftSnapshotItem,
  SheetSettings,
  ViewMode,
  WbSectionData,
  WcSectionData,
  WorkStatus,
} from '../types';
import { getShaftStatus, getTunnelStatus } from '../utils/calculations';
import {
  DEFAULT_AIR_VALVE_COORD,
  DEFAULT_WASHOUT_COORD,
  GOLAPBAG_SPS_COORD,
  INITIAL_WA_GEO_NODES,
} from '../data/wbcInitialData';
import {
  buildGeoViewport,
  computeWbPolylineSplit,
  LabelRectBox,
  layoutMapLabels,
  MapLabelInput,
  useMapTileSnapshot,
} from '../utils/geoMap';

function nodeColors(status: WorkStatus) {
  if (status === 'complete') {
    return { fill: '#16a34a', stroke: '#14532d', text: '#15803d' };
  }
  if (status === 'ongoing') {
    return { fill: '#f59e0b', stroke: '#92400e', text: '#b45309' };
  }
  return { fill: '#ffffff', stroke: '#dc2626', text: '#dc2626' };
}

interface WbMapProps {
  wb: WbSectionData;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: SheetSettings;
  viewMode: ViewMode;
  prevCompletedLengthM?: number;
  highlightColor?: string;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  compact?: boolean;
  clipIdSuffix?: string;
}

export const WbNavigationMapGroup: React.FC<WbMapProps> = ({
  wb,
  x,
  y,
  w,
  h,
  settings,
  viewMode,
  prevCompletedLengthM,
  highlightColor = '#f97316',
  selectedNodeId,
  onSelectNode,
  compact = false,
  clipIdSuffix = 'main',
}) => {
  const padTop = compact ? 19 : 26;
  const mapX = x + 4;
  const mapY = y + padTop;
  const mapW = Math.max(40, w - 8);
  const mapH = Math.max(40, h - padTop - 4);
  const clipId = `wb-map-clip-${clipIdSuffix}`;
  const isNarrow = w < 440;

  const viewport = useMemo(
    () => buildGeoViewport(wb.nodes, mapX, mapY, mapW, mapH, compact ? 0.12 : 0.1),
    [wb.nodes, mapX, mapY, mapW, mapH, compact]
  );

  const tilePxW = Math.min(1100, Math.max(480, Math.round(mapW * (compact ? 1.55 : 1.35))));
  const tilePxH = Math.min(1100, Math.max(420, Math.round(mapH * (compact ? 1.55 : 1.35))));

  const tileDataUrl = useMapTileSnapshot(
    viewport,
    settings.showMapBackground,
    settings.mapStyle,
    tilePxW,
    tilePxH
  );

  const split = useMemo(
    () =>
      computeWbPolylineSplit(
        wb.nodes,
        wb.totalLengthM,
        wb.completedLengthM,
        viewMode === 'overall' ? undefined : prevCompletedLengthM
      ),
    [wb.nodes, wb.totalLengthM, wb.completedLengthM, viewMode, prevCompletedLengthM]
  );

  const toPointsAttr = (pts: Array<{ lat: number; lon: number }>) =>
    pts
      .map((p) => {
        const pr = viewport.project(p.lat, p.lon);
        return `${pr.x.toFixed(1)},${pr.y.toFixed(1)}`;
      })
      .join(' ');

  const tipScreen = viewport.project(split.tipPoint.lat, split.tipPoint.lon);
  const pct =
    wb.totalLengthM > 0
      ? Math.min(100, (wb.completedLengthM / wb.totalLengthM) * 100)
      : 0;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={mapX} y={mapY} width={mapW} height={mapH} />
        </clipPath>
      </defs>

      {/* Outer Frame */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#ffffff"
        stroke="#1e3a8a"
        strokeWidth={1.1}
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={padTop}
        fill="#eff6ff"
        stroke="#1e3a8a"
        strokeWidth={0.8}
      />
      <rect x={x + 4} y={y + 2.5} width={compact ? 26 : 32} height={padTop - 5} rx={3} fill="#1d4ed8" />
      <text
        x={x + (compact ? 17 : 20)}
        y={y + (compact ? 13 : 17.5)}
        textAnchor="middle"
        fontSize={compact ? 9.5 : 11.5}
        fontWeight="900"
        fill="#ffffff"
      >
        WB
      </text>
      <text
        x={x + (compact ? 34 : 42)}
        y={y + (compact ? 13 : 17.5)}
        fontSize={isNarrow ? 8.2 : compact ? 9.0 : 11.5}
        fontWeight="800"
        fill="#1e3a8a"
      >
        {isNarrow ? `(${wb.pipeDia})` : `SECTION (${wb.method} ${wb.pipeDia})`}
      </text>
      <text
        x={x + w - 7}
        y={y + (compact ? 13 : 17)}
        textAnchor="end"
        fontSize={isNarrow ? 5.7 : compact ? 6.0 : 8.5}
        fontWeight="700"
        fill="#15803d"
      >
        Done: {wb.completedLengthM.toFixed(1)}m / {wb.totalLengthM}m ({pct.toFixed(1)}%)
      </text>

      {/* Map Viewport Canvas */}
      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="#f1f5f9" />

      <g clipPath={`url(#${clipId})`}>
        {/* Embedded Street Navigation Tile Image */}
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
          /* Clean CAD Geographic Coordinate Grid Fallback */
          <g>
            {Array.from({ length: 6 }).map((_, gi) => {
              const gx = mapX + ((gi + 1) / 7) * mapW;
              const gy = mapY + ((gi + 1) / 7) * mapH;
              return (
                <g key={gi}>
                  <line
                    x1={gx}
                    y1={mapY}
                    x2={gx}
                    y2={mapY + mapH}
                    stroke="#cbd5e1"
                    strokeWidth={0.5}
                    strokeDasharray="3,3"
                  />
                  <line
                    x1={mapX}
                    y1={gy}
                    x2={mapX + mapW}
                    y2={gy}
                    stroke="#cbd5e1"
                    strokeWidth={0.5}
                    strokeDasharray="3,3"
                  />
                </g>
              );
            })}
          </g>
        )}

        {/* Custom KML/KMZ Extra Lines */}
        {(wb.customKmlLines || []).map((ln, li) => (
          <polyline
            key={`kml-${li}`}
            points={ln.coords
              .map(([la, lo]) => {
                const p = viewport.project(la, lo);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
              })
              .join(' ')}
            fill="none"
            stroke="#64748b"
            strokeWidth={1.1}
            strokeDasharray="3,2"
          />
        ))}

        {/* Remaining Line (RED) */}
        {split.remainingPoints.length >= 2 && (
          <polyline
            points={toPointsAttr(split.remainingPoints)}
            fill="none"
            stroke="#dc2626"
            strokeWidth={compact ? 2.4 : 3.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Completed Line (GREEN or Prev in Weekly/Monthly) */}
        {split.prevPoints.length >= 2 && (
          <polyline
            points={toPointsAttr(split.prevPoints)}
            fill="none"
            stroke="#16a34a"
            strokeWidth={compact ? 3.2 : 5.0}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Period Newly Added Line (Amber/Cyan) */}
        {viewMode !== 'overall' && split.currPoints.length >= 2 && (
          <polyline
            points={toPointsAttr(split.currPoints)}
            fill="none"
            stroke={highlightColor}
            strokeWidth={compact ? 3.6 : 5.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Nodes WB1..WB38 with 2D collision-free cartographic label placement */}
        {(() => {
          const tipBox: LabelRectBox = {
            x: tipScreen.x + (compact ? 5 : 9),
            y: tipScreen.y - (compact ? 8 : 11),
            w: compact ? 58 : 80,
            h: compact ? 14 : 18,
          };
          const legBox: LabelRectBox = {
            x: mapX + 4,
            y: mapY + mapH - (compact ? 36 : 48),
            w: compact ? 108 : 152,
            h: compact ? 33 : 45,
          };
          const northBox: LabelRectBox = {
            x: mapX + mapW - (compact ? 31 : 43),
            y: mapY + 4,
            w: compact ? 24 : 30,
            h: compact ? 24 : 30,
          };

          const projected = wb.nodes.map((n, idx) => {
            const pt = viewport.project(n.lat, n.lon);
            const isSel = selectedNodeId === n.id;
            const r = isSel ? (compact ? 4.2 : 6.2) : compact ? 2.6 : 4.2;
            return { n, idx, pt, isSel, r };
          });

          const labelItems: MapLabelInput[] = projected
            .filter(({ idx, isSel }) => !compact || idx === 0 || idx === wb.nodes.length - 1 || isSel || idx % 3 === 0)
            .map(({ n, idx, pt, isSel, r }) => ({
              id: n.id,
              text: n.id,
              px: pt.x,
              py: pt.y,
              markerRadius: r,
              priority: isSel ? 100 : idx === 0 || idx === wb.nodes.length - 1 ? 85 : idx % 3 === 0 ? 55 : 40,
              preferredSide: idx % 2 === 0 ? 'right' : 'left',
              mustPlace: isSel,
            }));

          const placed = layoutMapLabels(
            labelItems,
            { x: mapX, y: mapY, w: mapW, h: mapH },
            {
              fontSize: compact ? 4.8 : 6.4,
              blockedBoxes: [tipBox, legBox, northBox],
              polylinePoints: projected.map((p) => p.pt),
              padding: compact ? 1.5 : 2.0,
              maxTier: compact ? 2 : 3,
            }
          );

          return (
            <g>
              {projected.map(({ n, pt, isSel, r }) => {
                const col = nodeColors(n.status);
                return (
                  <g
                    key={n.id}
                    style={{ cursor: onSelectNode ? 'pointer' : 'default' }}
                    onClick={(e) => {
                      if (onSelectNode) {
                        e.stopPropagation();
                        onSelectNode(n.id);
                      }
                    }}
                  >
                    {isSel && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={r + 3.5}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={1.6}
                      />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={r}
                      fill={col.fill}
                      stroke={col.stroke}
                      strokeWidth={compact ? 0.9 : 1.3}
                    />
                  </g>
                );
              })}

              {Array.from(placed.values()).map((lbl) => (
                <g key={`wb-lbl-${lbl.id}`} style={{ pointerEvents: 'none' }}>
                  {lbl.needsLeader && (
                    <line
                      x1={lbl.px}
                      y1={lbl.py}
                      x2={lbl.leaderX2}
                      y2={lbl.leaderY2}
                      stroke="#475569"
                      strokeWidth={0.55}
                    />
                  )}
                  <rect
                    x={lbl.boxX}
                    y={lbl.boxY}
                    width={lbl.boxW}
                    height={lbl.boxH}
                    rx={1.8}
                    fill="#ffffff"
                    fillOpacity={0.91}
                    stroke="#cbd5e1"
                    strokeWidth={0.35}
                  />
                  <text
                    x={lbl.textX}
                    y={lbl.textY}
                    textAnchor={lbl.textAnchor}
                    fontSize={compact ? 4.8 : 6.4}
                    fontWeight="700"
                    fill="#0f172a"
                  >
                    {lbl.text}
                  </text>
                </g>
              ))}
            </g>
          );
        })()}

        {/* BLUE CIRCLE MARKER AT COMPLETED TIP ("completion er mathai blue circle") */}
        <g>
          <circle
            cx={tipScreen.x}
            cy={tipScreen.y}
            r={compact ? 6.2 : 9.5}
            fill="#3b82f6"
            fillOpacity={0.28}
          />
          <circle
            cx={tipScreen.x}
            cy={tipScreen.y}
            r={compact ? 4.0 : 6.2}
            fill="#2563eb"
            stroke="#ffffff"
            strokeWidth={compact ? 1.4 : 2.0}
          />
          <rect
            x={tipScreen.x + (compact ? 6 : 10)}
            y={tipScreen.y - (compact ? 7 : 10)}
            width={compact ? 56 : 78}
            height={compact ? 12 : 16}
            rx={2}
            fill="#1e3a8a"
          />
          <text
            x={tipScreen.x + (compact ? 34 : 49)}
            y={tipScreen.y + (compact ? 1.5 : 1.5)}
            textAnchor="middle"
            fontSize={compact ? 5.2 : 7.2}
            fontWeight="700"
            fill="#ffffff"
          >
            Done: {wb.completedLengthM.toFixed(1)}m
          </text>
        </g>

        {/* Live Washout & Air Valve Pins on Mini WB Map */}
        {(() => {
          const wp = viewport.project(
            (wb.washoutCoord || DEFAULT_WASHOUT_COORD).lat,
            (wb.washoutCoord || DEFAULT_WASHOUT_COORD).lon
          );
          const ap = viewport.project(
            (wb.airValveCoord || DEFAULT_AIR_VALVE_COORD).lat,
            (wb.airValveCoord || DEFAULT_AIR_VALVE_COORD).lon
          );
          return (
            <g>
              <circle cx={wp.x} cy={wp.y} r={compact ? 4.5 : 6.5} fill="#bbf7d0" stroke="#15803d" strokeWidth={1.1} />
              <polygon points={`${wp.x},${wp.y - 3.5} ${wp.x - 3},${wp.y + 2.5} ${wp.x + 3},${wp.y + 2.5}`} fill="#16a34a" />
              <circle cx={ap.x} cy={ap.y} r={compact ? 4.5 : 6.5} fill="#bae6fd" stroke="#0369a1" strokeWidth={1.1} />
              <polygon points={`${ap.x},${ap.y - 3.5} ${ap.x - 3},${ap.y + 2.5} ${ap.x + 3},${ap.y + 2.5}`} fill="#0284c7" />
              {(wb.customPoints || []).map((cp) => {
                const cpp = viewport.project(cp.lat, cp.lon);
                return (
                  <g key={cp.id}>
                    <circle cx={cpp.x} cy={cpp.y} r={compact ? 4.2 : 5.5} fill="#f3e8ff" stroke="#7e22ce" strokeWidth={1.2} />
                    <text x={cpp.x + 6} y={cpp.y + 2} fontSize={compact ? 5.2 : 6.8} fontWeight="800" fill="#581c87">
                      {cp.name}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* North Arrow & Mini Legend inside Map */}
        <g transform={`translate(${mapX + mapW - (compact ? 20 : 28)}, ${mapY + (compact ? 18 : 24)})`}>
          <circle cx={0} cy={0} r={compact ? 9 : 13} fill="#ffffff" fillOpacity={0.88} stroke="#475569" strokeWidth={0.7} />
          <polygon points={`0,${compact ? -7 : -10} ${compact ? -3 : -4},${compact ? 3 : 4} 0,${compact ? 1 : 1.5} ${compact ? 3 : 4},${compact ? 3 : 4}`} fill="#1e3a8a" />
          <text x={0} y={compact ? 7.5 : 10.5} textAnchor="middle" fontSize={compact ? 4.5 : 6} fontWeight="700" fill="#1e3a8a">N</text>
        </g>

        {/* Bottom-left Mini Key Overlay */}
        <g transform={`translate(${mapX + 5}, ${mapY + mapH - (compact ? 34 : 46)})`}>
          <rect
            x={0}
            y={0}
            width={compact ? 105 : 148}
            height={compact ? 30 : 41}
            rx={3}
            fill="#ffffff"
            fillOpacity={0.92}
            stroke="#cbd5e1"
            strokeWidth={0.7}
          />
          <line x1={6} y1={compact ? 8 : 11} x2={22} y2={compact ? 8 : 11} stroke="#16a34a" strokeWidth={2.5} />
          <circle cx={14} cy={compact ? 8 : 11} r={2.5} fill="#2563eb" stroke="#ffffff" strokeWidth={0.6} />
          <text x={27} y={compact ? 10 : 13.5} fontSize={compact ? 4.8 : 6.4} fontWeight="700" fill="#0f172a">
            Complete + Blue End Pt
          </text>

          <line x1={6} y1={compact ? 17 : 23} x2={22} y2={compact ? 17 : 23} stroke="#dc2626" strokeWidth={2.2} />
          <text x={27} y={compact ? 19 : 25.5} fontSize={compact ? 4.8 : 6.4} fontWeight="600" fill="#991b1b">
            Remaining: {Math.max(0, wb.totalLengthM - wb.completedLengthM).toFixed(1)}m
          </text>

          <circle cx={10} cy={compact ? 25 : 34} r={2.2} fill="#f59e0b" stroke="#92400e" strokeWidth={0.6} />
          <text x={27} y={compact ? 27 : 36.5} fontSize={compact ? 4.6 : 6.2} fill="#334155">
            Complete / On-Going / Rem
          </text>
        </g>
      </g>

      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="none" stroke="#94a3b8" strokeWidth={0.6} />
    </g>
  );
};

interface WcMapProps {
  wc: WcSectionData;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: SheetSettings;
  viewMode?: ViewMode;
  baselineShafts?: Record<string, ShaftSnapshotItem>;
  highlightColor?: string;
  selectedShaftId?: string;
  onSelectShaft?: (id: string) => void;
  compact?: boolean;
  clipIdSuffix?: string;
}

export const WcNavigationMapGroup: React.FC<WcMapProps> = ({
  wc,
  x,
  y,
  w,
  h,
  settings,
  viewMode = 'overall',
  baselineShafts,
  highlightColor = '#f97316',
  selectedShaftId,
  onSelectShaft,
  compact = false,
  clipIdSuffix = 'main',
}) => {
  const padTop = compact ? 19 : 24;
  const mapX = x + 4;
  const mapY = y + padTop;
  const mapW = Math.max(40, w - 8);
  const mapH = Math.max(40, h - padTop - 4);
  const clipId = `wc-map-clip-${clipIdSuffix}`;
  const isNarrow = w < 440;
  const isTallVertical = isNarrow && mapH > 600;

  const viewport = useMemo(
    () => buildGeoViewport(wc.geoNodes, mapX, mapY, mapW, mapH, isTallVertical ? 0.11 : 0.12),
    [wc.geoNodes, mapX, mapY, mapW, mapH, isTallVertical]
  );

  const scaleFactor = Math.min(compact ? 1.55 : 1.45, 1580 / Math.max(1, mapW, mapH));
  const tilePxW = Math.max(360, Math.round(mapW * scaleFactor));
  const tilePxH = Math.max(360, Math.round(mapH * scaleFactor));

  const tileDataUrl = useMapTileSnapshot(
    viewport,
    settings.showMapBackground,
    settings.mapStyle,
    tilePxW,
    tilePxH
  );

  const shaftById = useMemo(() => {
    const m = new Map<string, ShaftRecord>();
    for (const s of wc.shafts) m.set(s.id, s);
    return m;
  }, [wc.shafts]);

  const totalLenM = wc.shafts.reduce((acc, s) => acc + s.tunnelLengthM, 0);
  const doneLenM = wc.shafts.reduce(
    (acc, s) => acc + (s.tunnelLengthM * s.tunnelPct) / 100,
    0
  );

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={mapX} y={mapY} width={mapW} height={mapH} />
        </clipPath>
      </defs>

      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#ffffff"
        stroke="#1e3a8a"
        strokeWidth={1.1}
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={padTop}
        fill="#eff6ff"
        stroke="#1e3a8a"
        strokeWidth={0.8}
      />
      <rect x={x + 4} y={y + 2.5} width={compact || isNarrow ? 26 : 32} height={padTop - 5} rx={3} fill="#7e22ce" />
      <text
        x={x + (compact || isNarrow ? 17 : 20)}
        y={y + (compact ? 13 : 16)}
        textAnchor="middle"
        fontSize={compact || isNarrow ? 9.5 : 11.5}
        fontWeight="900"
        fill="#ffffff"
      >
        WC
      </text>
      <text
        x={x + (compact || isNarrow ? 34 : 42)}
        y={y + (compact ? 13 : 16)}
        fontSize={isNarrow ? 8.2 : compact ? 9.0 : 11.2}
        fontWeight="800"
        fill="#581c87"
      >
        {isNarrow ? 'NAVIGATION MAP' : 'SECTION (MICRO-TUNNEL WC-1 TO WC-27)'}
      </text>
      <text
        x={x + w - 7}
        y={y + (compact ? 13 : 16)}
        textAnchor="end"
        fontSize={isNarrow ? 6.4 : compact ? 6.0 : 8.0}
        fontWeight="700"
        fill={doneLenM > 0 ? '#a21caf' : '#dc2626'}
      >
        {isNarrow
          ? `${(doneLenM / 1000).toFixed(2)}/${(totalLenM / 1000).toFixed(2)} km`
          : `Done: ${(doneLenM / 1000).toFixed(3)} / ${(totalLenM / 1000).toFixed(2)} km (${doneLenM > 0 ? 'Active' : 'Not Started'})`}
      </text>

      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="#f1f5f9" />

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
            {Array.from({ length: 8 }).map((_, gi) => {
              const gx = mapX + ((gi + 1) / 9) * mapW;
              const gy = mapY + ((gi + 1) / 9) * mapH;
              return (
                <g key={gi}>
                  <line x1={gx} y1={mapY} x2={gx} y2={mapY + mapH} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="3,3" />
                  <line x1={mapX} y1={gy} x2={mapX + mapW} y2={gy} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="3,3" />
                </g>
              );
            })}
          </g>
        )}

        {(wc.customKmlLines || []).map((ln, li) => (
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
            strokeWidth={1.1}
            strokeDasharray="3,2"
          />
        ))}

        {/* Segment lines WC-i -> WC-(i+1) */}
        {wc.geoNodes.slice(0, -1).map((gNode, idx) => {
          const nextNode = wc.geoNodes[idx + 1];
          const p1 = viewport.project(gNode.lat, gNode.lon);
          const p2 = viewport.project(nextNode.lat, nextNode.lon);
          const sh = shaftById.get(gNode.id);
          const mtStatus = sh ? getTunnelStatus(sh) : 'remaining';
          const prevSh = baselineShafts && sh ? baselineShafts[sh.id] : undefined;
          const hasNewTunnel =
            viewMode !== 'overall' && sh && prevSh && sh.tunnelPct > (prevSh.tunnelPct ?? 0);
          const stroke =
            mtStatus === 'complete'
              ? '#16a34a'
              : mtStatus === 'ongoing'
              ? '#2563eb'
              : '#dc2626';
          return (
            <g key={`seg-${gNode.id}`}>
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#ffffff"
                strokeWidth={isTallVertical ? 5.6 : 4.2}
                strokeLinecap="round"
              />
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={stroke}
                strokeWidth={isTallVertical ? 3.8 : compact ? 2.4 : 3.2}
                strokeDasharray={mtStatus === 'remaining' && !isTallVertical ? '4,2' : undefined}
                strokeLinecap="round"
              />
              {hasNewTunnel && (
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={highlightColor}
                  strokeWidth={isTallVertical ? 4.2 : 3.5}
                  strokeLinecap="round"
                />
              )}
            </g>
          );
        })}

        {/* Shaft Node Markers WC-1 .. WC-27 with 2D collision-free label placement */}
        {(() => {
          const blocked: LabelRectBox[] = [
            { x: mapX + mapW - 30, y: mapY + 5, w: 25, h: 25 },
          ];
          if (isTallVertical) {
            blocked.push({
              x: mapX + 5,
              y: mapY + mapH - (viewMode !== 'overall' ? 56 : 44),
              w: 118,
              h: viewMode !== 'overall' ? 50 : 38,
            });
          }

          const projected = wc.geoNodes.map((gNode, idx) => {
            const pt = viewport.project(gNode.lat, gNode.lon);
            const sh = shaftById.get(gNode.id);
            const st = sh ? getShaftStatus(sh) : 'remaining';
            const col = nodeColors(st);
            const isSel = selectedShaftId === gNode.id;
            const prevSh = baselineShafts && sh ? baselineShafts[sh.id] : undefined;
            const hasNewShaft =
              viewMode !== 'overall' &&
              sh &&
              prevSh &&
              ((sh.layerFlags || []).filter(Boolean).length > (prevSh.layerFlags || []).filter(Boolean).length ||
                sh.castingPct > (prevSh.castingPct ?? 0) ||
                sh.precastPct > (prevSh.precastPct ?? 0));
            const r = isSel ? (isTallVertical ? 5.8 : compact ? 4.0 : 5.5) : isTallVertical ? 4.4 : compact ? 2.5 : 3.5;
            return { gNode, idx, pt, col, isSel, hasNewShaft, r };
          });

          const fSize = isTallVertical ? 6.8 : compact ? 4.6 : 5.8;
          const labelItems: MapLabelInput[] = projected
            .filter(({ idx, isSel }) => isTallVertical || idx === 0 || idx === wc.geoNodes.length - 1 || isSel || (!compact ? idx % 2 === 0 : idx % 3 === 0))
            .map(({ gNode, idx, pt, isSel, r }) => ({
              id: gNode.id,
              text: gNode.id,
              px: pt.x,
              py: pt.y,
              markerRadius: r,
              priority: isSel ? 100 : idx === 0 || idx === wc.geoNodes.length - 1 ? 85 : idx % 2 === 0 ? 55 : 40,
              preferredSide: idx % 2 === 0 ? 'right' : 'left',
              mustPlace: isSel,
            }));

          const placed = layoutMapLabels(
            labelItems,
            { x: mapX, y: mapY, w: mapW, h: mapH },
            {
              fontSize: fSize,
              blockedBoxes: blocked,
              polylinePoints: projected.map((p) => p.pt),
              padding: 2.0,
              maxTier: isTallVertical ? 3 : 2,
            }
          );

          return (
            <g>
              {projected.map(({ gNode, pt, col, isSel, hasNewShaft, r }) => (
                <g
                  key={gNode.id}
                  style={{ cursor: onSelectShaft ? 'pointer' : 'default' }}
                  onClick={(e) => {
                    if (onSelectShaft) {
                      e.stopPropagation();
                      onSelectShaft(gNode.id);
                    }
                  }}
                >
                  {hasNewShaft && (
                    <circle cx={pt.x} cy={pt.y} r={r + 3.2} fill="none" stroke={highlightColor} strokeWidth={2.0} />
                  )}
                  {isSel && (
                    <circle cx={pt.x} cy={pt.y} r={r + 3} fill="none" stroke="#2563eb" strokeWidth={1.6} />
                  )}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={r}
                    fill={col.fill}
                    stroke={col.stroke}
                    strokeWidth={isTallVertical ? 1.4 : compact ? 0.9 : 1.2}
                  />
                </g>
              ))}

              {Array.from(placed.values()).map((lbl) => (
                <g key={`wc-lbl-${lbl.id}`} style={{ pointerEvents: 'none' }}>
                  {lbl.needsLeader && (
                    <line
                      x1={lbl.px}
                      y1={lbl.py}
                      x2={lbl.leaderX2}
                      y2={lbl.leaderY2}
                      stroke="#475569"
                      strokeWidth={0.6}
                    />
                  )}
                  <rect
                    x={lbl.boxX}
                    y={lbl.boxY}
                    width={lbl.boxW}
                    height={lbl.boxH}
                    rx={1.8}
                    fill="#ffffff"
                    fillOpacity={0.92}
                    stroke="#cbd5e1"
                    strokeWidth={0.38}
                  />
                  <text
                    x={lbl.textX}
                    y={lbl.textY}
                    textAnchor={lbl.textAnchor}
                    fontSize={fSize}
                    fontWeight="800"
                    fill="#0f172a"
                  >
                    {lbl.text}
                  </text>
                </g>
              ))}
            </g>
          );
        })()}

        {/* Custom Added Points on Mini WC Map */}
        {(wc.customPoints || []).map((cp) => {
          const cpp = viewport.project(cp.lat, cp.lon);
          return (
            <g key={cp.id}>
              <circle cx={cpp.x} cy={cpp.y} r={compact ? 4.2 : 5.5} fill="#f3e8ff" stroke="#7e22ce" strokeWidth={1.2} />
              <text x={cpp.x + 6} y={cpp.y + 2} fontSize={compact ? 5.2 : 6.8} fontWeight="800" fill="#581c87">
                {cp.name}
              </text>
            </g>
          );
        })}

        {/* North arrow */}
        <g transform={`translate(${mapX + mapW - 18}, ${mapY + 18})`}>
          <circle cx={0} cy={0} r={10} fill="#ffffff" fillOpacity={0.9} stroke="#475569" strokeWidth={0.8} />
          <polygon points="0,-7.5 -3.2,3 0,1 3.2,3" fill="#1e3a8a" />
          <text x={0} y={8} textAnchor="middle" fontSize={4.8} fontWeight="700" fill="#1e3a8a">N</text>
        </g>

        {/* Compact Bottom Legend for Tall Vertical Map */}
        {isTallVertical && (
          <g transform={`translate(${mapX + 6}, ${mapY + mapH - (viewMode !== 'overall' ? 54 : 42)})`}>
            <rect
              x={0}
              y={0}
              width={132}
              height={viewMode !== 'overall' ? 48 : 36}
              rx={3}
              fill="#ffffff"
              fillOpacity={0.93}
              stroke="#475569"
              strokeWidth={0.7}
            />
            <line x1={6} y1={10} x2={22} y2={10} stroke="#16a34a" strokeWidth={3.0} />
            <text x={27} y={12.5} fontSize={6.5} fontWeight="700" fill="#0f172a">Complete</text>
            <line x1={6} y1={21} x2={22} y2={21} stroke="#2563eb" strokeWidth={3.0} />
            <text x={27} y={23.5} fontSize={6.5} fontWeight="700" fill="#1e3a8a">On-Going</text>
            <line x1={6} y1={31} x2={22} y2={31} stroke="#dc2626" strokeWidth={3.0} />
            <text x={27} y={33.5} fontSize={6.5} fontWeight="700" fill="#991b1b">Remaining</text>
            {viewMode !== 'overall' && (
              <g>
                <line x1={6} y1={41} x2={22} y2={41} stroke={highlightColor} strokeWidth={3.2} />
                <text x={27} y={43.5} fontSize={6.5} fontWeight="800" fill="#ea580c">New (Compare)</text>
              </g>
            )}
          </g>
        )}
      </g>

      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="none" stroke="#94a3b8" strokeWidth={0.6} />
    </g>
  );
};

interface WaMapProps {
  shafts: ShaftRecord[];
  geoNodes?: GeoNodeCoord[];
  spsCoord?: { lat: number; lon: number };
  customPoints?: CustomMapPoint[];
  x: number;
  y: number;
  w: number;
  h: number;
  settings: SheetSettings;
  viewMode?: ViewMode;
  baselineShafts?: Record<string, ShaftSnapshotItem>;
  highlightColor?: string;
  selectedShaftId?: string;
  onSelectShaft?: (id: string) => void;
  clipIdSuffix?: string;
}

export const WaNavigationMapGroup: React.FC<WaMapProps> = ({
  shafts,
  geoNodes,
  spsCoord,
  customPoints,
  x,
  y,
  w,
  h,
  settings,
  viewMode = 'overall',
  baselineShafts,
  highlightColor = '#f97316',
  selectedShaftId,
  onSelectShaft,
  clipIdSuffix = 'wa-main',
}) => {
  const padTop = 24;
  const mapX = x + 4;
  const mapY = y + padTop;
  const mapW = Math.max(40, w - 8);
  const mapH = Math.max(40, h - padTop - 4);
  const clipId = `wa-map-clip-${clipIdSuffix}`;

  const nodes = geoNodes && geoNodes.length > 0 ? geoNodes : INITIAL_WA_GEO_NODES;
  const sps = spsCoord || GOLAPBAG_SPS_COORD;

  const viewport = useMemo(
    () => buildGeoViewport([...nodes, sps], mapX, mapY, mapW, mapH, 0.11),
    [nodes, sps, mapX, mapY, mapW, mapH]
  );

  const scaleFactor = Math.min(1.45, 1580 / Math.max(1, mapW, mapH));
  const tilePxW = Math.max(360, Math.round(mapW * scaleFactor));
  const tilePxH = Math.max(360, Math.round(mapH * scaleFactor));

  const tileDataUrl = useMapTileSnapshot(
    viewport,
    settings.showMapBackground,
    settings.mapStyle,
    tilePxW,
    tilePxH
  );

  const shaftById = useMemo(() => {
    const m = new Map<string, ShaftRecord>();
    for (const s of shafts) m.set(s.id, s);
    return m;
  }, [shafts]);

  const totalLenM = shafts.reduce((acc, s) => acc + s.tunnelLengthM, 0);
  const doneLenM = shafts.reduce(
    (acc, s) => acc + (s.tunnelLengthM * s.tunnelPct) / 100,
    0
  );
  const spsPt = viewport.project(sps.lat, sps.lon);

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={mapX} y={mapY} width={mapW} height={mapH} />
        </clipPath>
      </defs>

      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#ffffff"
        stroke="#1e3a8a"
        strokeWidth={1.1}
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={padTop}
        fill="#eff6ff"
        stroke="#1e3a8a"
        strokeWidth={0.8}
      />
      <rect x={x + 4} y={y + 2.5} width={26} height={padTop - 5} rx={3} fill="#15803d" />
      <text
        x={x + 17}
        y={y + 16}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight="900"
        fill="#ffffff"
      >
        WA
      </text>
      <text
        x={x + 34}
        y={y + 16}
        fontSize={8.2}
        fontWeight="800"
        fill="#14532d"
      >
        NAVIGATION MAP
      </text>
      <text
        x={x + w - 7}
        y={y + 16}
        textAnchor="end"
        fontSize={6.8}
        fontWeight="700"
        fill="#15803d"
      >
        {(doneLenM / 1000).toFixed(2)}/{(totalLenM / 1000).toFixed(2)} km
      </text>

      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="#f1f5f9" />

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
            {Array.from({ length: 8 }).map((_, gi) => {
              const gx = mapX + ((gi + 1) / 9) * mapW;
              const gy = mapY + ((gi + 1) / 9) * mapH;
              return (
                <g key={gi}>
                  <line x1={gx} y1={mapY} x2={gx} y2={mapY + mapH} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="3,3" />
                  <line x1={mapX} y1={gy} x2={mapX + mapW} y2={gy} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="3,3" />
                </g>
              );
            })}
          </g>
        )}

        {/* WA Micro-tunnelling segments WA-1 -> WA-36 -> Golapbag SPS */}
        {nodes.map((gNode, idx) => {
          const p1 = viewport.project(gNode.lat, gNode.lon);
          const p2 =
            idx < nodes.length - 1
              ? viewport.project(nodes[idx + 1].lat, nodes[idx + 1].lon)
              : spsPt;
          const sh = shaftById.get(gNode.id);
          const mtStatus = sh ? getTunnelStatus(sh) : 'remaining';
          const prevSh = baselineShafts && sh ? baselineShafts[sh.id] : undefined;
          const hasNewTunnel =
            viewMode !== 'overall' && sh && prevSh && sh.tunnelPct > (prevSh.tunnelPct ?? 0);
          const stroke =
            mtStatus === 'complete'
              ? '#16a34a'
              : mtStatus === 'ongoing'
              ? '#2563eb'
              : '#dc2626';
          return (
            <g key={`wa-mini-seg-${gNode.id}`}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#ffffff" strokeWidth={5.6} strokeLinecap="round" />
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={stroke} strokeWidth={3.6} strokeLinecap="round" />
              {hasNewTunnel && (
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={highlightColor} strokeWidth={4.0} strokeLinecap="round" />
              )}
            </g>
          );
        })}

        {/* Golapbag SPS marker (compact diamond/pill so WA-34/35/36 stay unobstructed) */}
        <g>
          <rect
            x={spsPt.x - 10}
            y={spsPt.y - 6}
            width={20}
            height={12}
            rx={2.5}
            fill="#fbcfe8"
            stroke="#9d174d"
            strokeWidth={1.4}
          />
          <text x={spsPt.x} y={spsPt.y + 2.2} textAnchor="middle" fontSize={6.0} fontWeight="900" fill="#831843">
            SPS
          </text>
        </g>

        {/* WA Shaft Nodes with 2D collision-free cartographic label placement */}
        {(() => {
          const blocked: LabelRectBox[] = [
            { x: spsPt.x - 12, y: spsPt.y - 8, w: 24, h: 16 },
            { x: mapX + mapW - 30, y: mapY + 5, w: 25, h: 25 },
            {
              x: mapX + 5,
              y: mapY + mapH - (viewMode !== 'overall' ? 68 : 56),
              w: 136,
              h: viewMode !== 'overall' ? 62 : 50,
            },
          ];

          const projected = nodes.map((gNode, idx) => {
            const pt = viewport.project(gNode.lat, gNode.lon);
            const sh = shaftById.get(gNode.id);
            const st = sh ? getShaftStatus(sh) : 'remaining';
            const col = nodeColors(st);
            const isSel = selectedShaftId === gNode.id;
            const prevSh = baselineShafts && sh ? baselineShafts[sh.id] : undefined;
            const hasNewShaft =
              viewMode !== 'overall' &&
              sh &&
              prevSh &&
              ((sh.layerFlags || []).filter(Boolean).length > (prevSh.layerFlags || []).filter(Boolean).length ||
                sh.castingPct > (prevSh.castingPct ?? 0) ||
                sh.precastPct > (prevSh.precastPct ?? 0));
            const r = isSel ? 5.6 : 4.1;
            return { gNode, idx, pt, col, isSel, hasNewShaft, r };
          });

          const polyPts = [...projected.map((p) => p.pt), spsPt];
          const labelItems: MapLabelInput[] = projected.map(({ gNode, idx, pt, isSel, r }) => {
            const isKey = idx === 0 || idx === nodes.length - 1 || gNode.id === 'WA-24.1';
            // In dense horizontal WA-1..WA-6 stretch prefer alternating top/bottom
            const pref: MapLabelInput['preferredSide'] =
              idx <= 5
                ? idx % 2 === 0
                  ? 'top'
                  : 'bottom'
                : idx % 2 === 0
                ? 'right'
                : 'left';
            return {
              id: gNode.id,
              text: gNode.id.replace('-', ' '),
              px: pt.x,
              py: pt.y,
              markerRadius: r,
              priority: isSel ? 100 : isKey ? 85 : idx % 2 === 0 ? 55 : 42,
              preferredSide: pref,
              mustPlace: isSel,
            };
          });

          const placed = layoutMapLabels(
            labelItems,
            { x: mapX, y: mapY, w: mapW, h: mapH },
            {
              fontSize: 6.7,
              blockedBoxes: blocked,
              polylinePoints: polyPts,
              padding: 2.0,
              maxTier: 3,
            }
          );

          return (
            <g>
              {/* Draw all WA Shaft markers first so labels/leaders never cover them */}
              {projected.map(({ gNode, pt, col, isSel, hasNewShaft, r }) => (
                <g
                  key={gNode.id}
                  style={{ cursor: onSelectShaft ? 'pointer' : 'default' }}
                  onClick={(e) => {
                    if (onSelectShaft) {
                      e.stopPropagation();
                      onSelectShaft(gNode.id);
                    }
                  }}
                >
                  {hasNewShaft && (
                    <rect
                      x={pt.x - r - 3}
                      y={pt.y - r - 3}
                      width={(r + 3) * 2}
                      height={(r + 3) * 2}
                      rx={2.5}
                      fill="none"
                      stroke={highlightColor}
                      strokeWidth={2.0}
                    />
                  )}
                  {isSel && (
                    <rect
                      x={pt.x - r - 2.8}
                      y={pt.y - r - 2.8}
                      width={(r + 2.8) * 2}
                      height={(r + 2.8) * 2}
                      rx={2.5}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth={1.6}
                    />
                  )}
                  <rect
                    x={pt.x - r}
                    y={pt.y - r}
                    width={r * 2}
                    height={r * 2}
                    rx={1.5}
                    fill="#ffffff"
                    stroke={col.stroke}
                    strokeWidth={1.6}
                  />
                  <circle cx={pt.x} cy={pt.y} r={r * 0.48} fill={col.fill} />
                </g>
              ))}

              {/* Draw collision-free WA labels + crisp hairline leaders */}
              {Array.from(placed.values()).map((lbl) => (
                <g key={`wa-lbl-${lbl.id}`} style={{ pointerEvents: 'none' }}>
                  {lbl.needsLeader && (
                    <line
                      x1={lbl.px}
                      y1={lbl.py}
                      x2={lbl.leaderX2}
                      y2={lbl.leaderY2}
                      stroke="#475569"
                      strokeWidth={0.6}
                    />
                  )}
                  <rect
                    x={lbl.boxX}
                    y={lbl.boxY}
                    width={lbl.boxW}
                    height={lbl.boxH}
                    rx={1.8}
                    fill="#ffffff"
                    fillOpacity={0.93}
                    stroke="#cbd5e1"
                    strokeWidth={0.38}
                  />
                  <text
                    x={lbl.textX}
                    y={lbl.textY}
                    textAnchor={lbl.textAnchor}
                    fontSize={6.7}
                    fontWeight="800"
                    fill="#0f172a"
                  >
                    {lbl.text}
                  </text>
                </g>
              ))}
            </g>
          );
        })()}

        {/* Custom Added Points */}
        {(customPoints || []).map((cp) => {
          const cpp = viewport.project(cp.lat, cp.lon);
          return (
            <g key={cp.id}>
              <circle cx={cpp.x} cy={cpp.y} r={4.8} fill="#fef3c7" stroke="#b45309" strokeWidth={1.3} />
              <text x={cpp.x + 6} y={cpp.y + 2} fontSize={6.8} fontWeight="800" fill="#78350f">
                {cp.name}
              </text>
            </g>
          );
        })}

        {/* North arrow */}
        <g transform={`translate(${mapX + mapW - 18}, ${mapY + 18})`}>
          <circle cx={0} cy={0} r={10} fill="#ffffff" fillOpacity={0.9} stroke="#475569" strokeWidth={0.8} />
          <polygon points="0,-7.5 -3.2,3 0,1 3.2,3" fill="#1e3a8a" />
          <text x={0} y={8} textAnchor="middle" fontSize={4.8} fontWeight="700" fill="#1e3a8a">N</text>
        </g>

        {/* Bottom-Left Compact Legend */}
        <g transform={`translate(${mapX + 6}, ${mapY + mapH - (viewMode !== 'overall' ? 66 : 54)})`}>
          <rect
            x={0}
            y={0}
            width={132}
            height={viewMode !== 'overall' ? 60 : 48}
            rx={3}
            fill="#ffffff"
            fillOpacity={0.93}
            stroke="#475569"
            strokeWidth={0.7}
          />
          <line x1={6} y1={10} x2={22} y2={10} stroke="#16a34a" strokeWidth={3.0} />
          <text x={27} y={12.5} fontSize={6.5} fontWeight="700" fill="#0f172a">Complete</text>
          <line x1={6} y1={21} x2={22} y2={21} stroke="#2563eb" strokeWidth={3.0} />
          <text x={27} y={23.5} fontSize={6.5} fontWeight="700" fill="#1e3a8a">On-Going</text>
          <line x1={6} y1={31} x2={22} y2={31} stroke="#dc2626" strokeWidth={3.0} />
          <text x={27} y={33.5} fontSize={6.5} fontWeight="700" fill="#991b1b">Remaining</text>
          <rect x={8} y={37.5} width={12} height={7} fill="#fbcfe8" stroke="#9d174d" strokeWidth={1.0} />
          <text x={27} y={43} fontSize={6.4} fontWeight="700" fill="#831843">Golapbag SPS</text>
          {viewMode !== 'overall' && (
            <g>
              <line x1={6} y1={52} x2={22} y2={52} stroke={highlightColor} strokeWidth={3.2} />
              <text x={27} y={54.5} fontSize={6.5} fontWeight="800" fill="#ea580c">New (Compare)</text>
            </g>
          )}
        </g>
      </g>

      <rect x={mapX} y={mapY} width={mapW} height={mapH} fill="none" stroke="#94a3b8" strokeWidth={0.6} />
    </g>
  );
};
