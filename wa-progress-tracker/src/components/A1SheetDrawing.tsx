import React from 'react';
import {
  AppState,
  PdfSheetKey,
  PumpStationData,
  ShaftRecord,
  ShaftSnapshotItem,
  WbSectionData,
  WorkStatus,
} from '../types';
import {
  calcDurationDays,
  computeSummary,
  formatDateDisplay,
  getManholeStatus,
  getPumpLowerStatus,
  getShaftCompletedLayersCount,
  getShaftStatus,
  getTunnelStatus,
  resolveDisplayContext,
} from '../utils/calculations';
import { FullPageGisMapSheet } from './FullPageGisMaps';
import {
  WaNavigationMapGroup,
  WbNavigationMapGroup,
  WcNavigationMapGroup,
} from './NavigationMaps';

interface A1SheetDrawingProps {
  state: AppState;
  selectedShaftId: string;
  onSelectShaft: (id: string, focus?: 'shaft' | 'manhole' | 'tunnel') => void;
  onSelectWbNode?: (nodeId: string) => void;
  onSelectTitleBlock?: () => void;
  svgRef: React.Ref<SVGSVGElement>;
  forceSection?: PdfSheetKey;
}

const SHEET_W = 1682; // 841mm * 2
const SHEET_H = 1188; // 594mm * 2

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '...' : s;
}

function statusBadgeColor(st: WorkStatus) {
  if (st === 'complete') return '#16a34a';
  if (st === 'ongoing') return '#f59e0b';
  return '#dc2626';
}

export const A1SheetDrawing: React.FC<A1SheetDrawingProps> = ({
  state,
  selectedShaftId,
  onSelectShaft,
  onSelectWbNode,
  onSelectTitleBlock,
  svgRef,
  forceSection,
}) => {
  const { viewMode, colors, settings } = state;
  const activeSection: PdfSheetKey = forceSection || state.activeSection;

  if (
    activeSection === 'wa-map' ||
    activeSection === 'wb-map' ||
    activeSection === 'wc-map'
  ) {
    return (
      <FullPageGisMapSheet
        kind={activeSection}
        state={state}
        svgRef={svgRef}
        selectedShaftId={selectedShaftId}
        onSelectShaft={onSelectShaft}
        onSelectWbNode={onSelectWbNode}
      />
    );
  }

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

  const customCfg = state.customView || {
    section: 'wa' as const,
    selectedIds: ['WA-17', 'WA-18', 'WA-19', 'WA-20', 'WA-21', 'WA-22', 'WA-23', 'WA-24'],
    showTunneling: true,
    includePumpStation: false,
  };
  const customSourceShafts = customCfg.section === 'wc' ? wcData.shafts : waShafts;
  const customSelectedSet = new Set(customCfg.selectedIds);
  const customShafts = customSourceShafts.filter((s) => customSelectedSet.has(s.id));
  const customBaselineMap =
    customCfg.section === 'wc' ? baseline.wcShafts || {} : baseline.shafts;
  const customHasPump =
    customCfg.section === 'wa' &&
    customCfg.includePumpStation &&
    customShafts.some((s) => s.id === 'WA-36');
  const customSummary = computeSummary(
    customShafts,
    baseline,
    customHasPump ? pumpStation : undefined,
    customCfg.section === 'wc' ? baseline.wcShafts : undefined
  );
  const customRangeText =
    customShafts.length === 0
      ? 'NO SHAFTS SELECTED'
      : customShafts.length === 1
      ? customShafts[0].id
      : `${customShafts[0].id} TO ${customShafts[customShafts.length - 1].id} (${customShafts.length} Nos)`;

  const waSummary = computeSummary(
    waShafts,
    baseline,
    pumpStation,
    undefined,
    settings.waTunnelDiaTotalsM
  );
  const wcSummary = computeSummary(wcData.shafts, baseline, undefined, baseline.wcShafts);

  const activePeriodLabel =
    viewMode === 'weekly'
      ? `WEEKLY COMPARISON: ${file1Label}  -->  ${file2Label}`
      : viewMode === 'monthly'
      ? `MONTHLY COMPARISON: ${file1Label}  -->  ${file2Label}`
      : 'OVERALL CONSTRUCTION STATUS';

  const currHighlight =
    viewMode === 'overall'
      ? colors.thisWeekHighlight
      : viewMode === 'monthly'
      ? colors.thisMonthHighlight || '#f97316'
      : colors.thisWeekHighlight || '#f97316';

  const getLayerFill = (
    shaft: ShaftRecord,
    layerIndex: number,
    bSnap?: ShaftSnapshotItem
  ): string | null => {
    if (!shaft.layerFlags[layerIndex]) return null;
    if (viewMode === 'overall') return colors.overallShaft;
    const prevDone = Boolean(bSnap?.layerFlags?.[layerIndex]);
    if (prevDone) {
      return viewMode === 'weekly' ? colors.prevWeekShaft : colors.prevMonthShaft;
    }
    return currHighlight;
  };

  const getBottomSlabFill = (
    shaft: ShaftRecord,
    bSnap?: ShaftSnapshotItem
  ): string | null => {
    if (!shaft.bottomSlabDone) return null;
    if (viewMode === 'overall') return colors.overallShaft;
    if (bSnap?.bottomSlabDone) {
      return viewMode === 'weekly' ? colors.prevWeekShaft : colors.prevMonthShaft;
    }
    return currHighlight;
  };

  const renderTunnelBar = (
    shaft: ShaftRecord,
    xStart: number,
    yTop: number,
    totalWidth: number,
    pctFrom: number,
    pctTo: number,
    captionMode: 'full' | 'exit' | 'entry' | 'pump',
    bSnap?: ShaftSnapshotItem
  ) => {
    const safeW = Math.max(10, totalWidth);
    const prevPct =
      viewMode === 'overall'
        ? shaft.tunnelPct
        : Math.min(shaft.tunnelPct, bSnap?.tunnelPct ?? 0);
    const currPct = shaft.tunnelPct;

    const prevColor =
      viewMode === 'overall'
        ? colors.overallTunnel
        : viewMode === 'weekly'
        ? colors.prevWeekTunnel
        : colors.prevMonthTunnel;

    const spanPct = pctTo - pctFrom + 10;
    const boxCount = spanPct / 10;
    const boxW = safeW / boxCount;
    const barH = 13.5;

    const rangeStart = pctFrom - 10;
    const clampRange = (p: number) => Math.max(0, Math.min(spanPct, p - rangeStart));

    const prevW = (clampRange(prevPct) / spanPct) * safeW;
    const currW = (clampRange(currPct) / spanPct) * safeW;
    const deltaPct =
      viewMode === 'overall' ? 0 : Math.max(0, currPct - (bSnap?.tunnelPct ?? 0));

    const boxes = [];
    for (let i = 0; i < boxCount; i++) {
      const pVal = pctFrom + i * 10;
      const bx = xStart + i * boxW;
      const isDarkBg = pVal <= currPct;
      boxes.push(
        <g key={pVal}>
          <line
            x1={bx}
            y1={yTop}
            x2={bx}
            y2={yTop + barH}
            stroke="#1e3a8a"
            strokeWidth={0.6}
          />
          <text
            x={bx + boxW / 2}
            y={yTop + 9.0}
            textAnchor="middle"
            fontSize={boxW < 10 ? 3.85 : 4.4}
            fontWeight="700"
            fill={isDarkBg ? '#ffffff' : '#1e3a8a'}
          >
            {pVal}%
          </text>
        </g>
      );
    }

    const captionCenterX = xStart + safeW / 2;

    return (
      <g
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelectShaft(shaft.id, 'tunnel');
        }}
      >
        <rect
          x={xStart}
          y={yTop}
          width={safeW}
          height={barH}
          fill="#ffffff"
          stroke="#1e3a8a"
          strokeWidth={0.8}
        />
        {prevW > 0 && (
          <rect
            x={xStart}
            y={yTop + 0.4}
            width={prevW}
            height={barH - 0.8}
            fill={prevColor}
          />
        )}
        {viewMode !== 'overall' && currW > prevW && (
          <rect
            x={xStart + prevW}
            y={yTop + 0.4}
            width={currW - prevW}
            height={barH - 0.8}
            fill={currHighlight}
          />
        )}
        {boxes}
        <rect
          x={xStart}
          y={yTop}
          width={safeW}
          height={barH}
          fill="none"
          stroke="#1e3a8a"
          strokeWidth={0.8}
        />

        {captionMode === 'full' && (
          <g>
            <text
              x={captionCenterX}
              y={yTop + 21}
              textAnchor="middle"
              fontSize={4.8}
              fontWeight="600"
              fill="#1e3a8a"
            >
              {shaft.tunnelPct >= 100 ? 'Completed (%)' : 'Micro-Tunnelling (%)'}
              {deltaPct > 0 ? ` [+${deltaPct}%]` : ''}
            </text>
            <text
              x={captionCenterX}
              y={yTop + 27.8}
              textAnchor="middle"
              fontSize={5.0}
              fontWeight="700"
              fill="#1e3a8a"
            >
              ({shaft.pipeDia}: {shaft.tunnelLengthM}m)
            </text>
          </g>
        )}

        {captionMode === 'exit' && (
          <g>
            <text
              x={captionCenterX}
              y={yTop + 21}
              textAnchor="middle"
              fontSize={4.6}
              fontWeight="700"
              fill="#1e3a8a"
            >
              To {shaft.nextId}
              {deltaPct > 0 ? ` [+${deltaPct}%]` : ''}
            </text>
            <text
              x={captionCenterX}
              y={yTop + 27.8}
              textAnchor="middle"
              fontSize={4.7}
              fontWeight="700"
              fill="#1e3a8a"
            >
              ({shaft.pipeDia}: {shaft.tunnelLengthM}m)
            </text>
          </g>
        )}

        {captionMode === 'entry' && (
          <g>
            <text
              x={captionCenterX}
              y={yTop + 21}
              textAnchor="middle"
              fontSize={4.6}
              fontWeight="700"
              fill="#1e3a8a"
            >
              From {shaft.id}
            </text>
            <text
              x={captionCenterX}
              y={yTop + 27.8}
              textAnchor="middle"
              fontSize={4.5}
              fontWeight="600"
              fill="#475569"
            >
              ({shaft.pipeDia}: {shaft.tunnelLengthM}m)
            </text>
          </g>
        )}

        {captionMode === 'pump' && (
          <g>
            <text
              x={captionCenterX}
              y={yTop + 21}
              textAnchor="middle"
              fontSize={4.8}
              fontWeight="600"
              fill="#1e3a8a"
            >
              To Pump Station{deltaPct > 0 ? ` [+${deltaPct}%]` : ''}
            </text>
            <text
              x={captionCenterX}
              y={yTop + 27.8}
              textAnchor="middle"
              fontSize={5.0}
              fontWeight="700"
              fill="#1e3a8a"
            >
              ({shaft.pipeDia}: {shaft.tunnelLengthM}m)
            </text>
          </g>
        )}
      </g>
    );
  };

  /**
   * Renders a grid of shafts (works for BOTH WA 37-shafts and WC 27-shafts!)
   * Fix #1: Micro-tunnelling bar touches BOTH shaft walls flush (0 gap!)
   * Fix #3: L:X/Y placed right beside "Shaft WA-()" / "Shaft WC-()"
   */
  const renderShaftGrid = (
    shaftList: ShaftRecord[],
    baselineMap: Record<string, ShaftSnapshotItem>,
    opts: {
      cols: number;
      gridX: number;
      gridY: number;
      gridW: number;
      rowH: number;
      connectLastToPump: boolean;
      pumpStructAbsX?: number;
      showTunneling?: boolean;
      showLastOutgoingTunnel?: boolean;
    }
  ) => {
    const {
      cols,
      gridX,
      gridY,
      gridW,
      rowH,
      connectLastToPump,
      pumpStructAbsX,
      showTunneling = true,
      showLastOutgoingTunnel = false,
    } = opts;
    const colW = gridW / cols;
    const sx = colW / 158.4;

    // Shared shaft schematic coords (W1..WN centered INSIDE left wall -> zero overhang!)
    const tblW = 68 * sx;
    const wallLeftX = 76 * sx;
    const wallThick = 9.5 * sx;
    const innerX = wallLeftX + wallThick;
    const innerW = 33 * sx;
    const wallRightX = innerX + innerW;
    const shaftTopY = rowH < 224 ? 58 : 63;
    const wallH = rowH < 224 ? 108 : 116;
    const botSlabH = 6.5;
    const tunnelBarY = shaftTopY + wallH - 16.5;

    return shaftList.map((s, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cellX = gridX + col * colW;
      const cellY = gridY + row * rowH;

      const bSnap = baselineMap[s.id];
      const shStatus = getShaftStatus(s);
      const mhStatus = getManholeStatus(s);
      const mtStatus = getTunnelStatus(s);
      const shDur = calcDurationDays(s.shaftSDate, s.shaftEDate);
      const mtDur = calcDurationDays(s.tunnelSDate, s.tunnelEDate);
      const mhDur = calcDurationDays(s.manholeSDate, s.manholeEDate);
      const shDoneLayers = getShaftCompletedLayersCount(s);

      const isSelected = s.id === selectedShaftId;
      const layerH = wallH / s.totalLayers;

      // Manhole 2 parts inside shaft interior
      const mhW = 19 * sx;
      const mhX = innerX + (innerW - mhW) / 2;
      const precastY = shaftTopY + 1;
      const precastH = Math.round(wallH * 0.42);
      const castingY = precastY + precastH;
      const castingH = wallH - precastH - 2;

      const mhPrevColor =
        viewMode === 'overall'
          ? colors.overallCasting
          : viewMode === 'weekly'
          ? colors.prevWeekManhole
          : colors.prevMonthManhole;
      const precastBaseColor =
        viewMode === 'overall'
          ? colors.overallPrecast
          : viewMode === 'weekly'
          ? colors.prevWeekManhole
          : colors.prevMonthManhole;

      const prevCastPct =
        viewMode === 'overall'
          ? s.castingPct
          : Math.min(s.castingPct, bSnap?.castingPct ?? 0);
      const currCastPct = s.castingPct;

      const prevPrePct =
        viewMode === 'overall'
          ? s.precastPct
          : Math.min(s.precastPct, bSnap?.precastPct ?? 0);
      const currPrePct = s.precastPct;

      const isLastInRow = col === cols - 1;
      const isLastShaft = idx === shaftList.length - 1;
      const hasOutgoingTunnel = s.tunnelLengthM > 0;

      return (
        <g
          key={s.id}
          transform={`translate(${cellX}, ${cellY})`}
          style={{ cursor: 'pointer' }}
          onClick={() => onSelectShaft(s.id, 'shaft')}
        >
          {isSelected && (
            <rect
              data-selection-ring="true"
              x={1}
              y={1}
              width={colW - 2}
              height={rowH - 6}
              rx={4}
              fill="#eff6ff"
              fillOpacity={0.35}
              stroke="#2563eb"
              strokeWidth={1.6}
              strokeDasharray="4,2"
            />
          )}

          {/* Title + L:X/Y (or SP:X/Y for Sheet Pile) right next to Shaft ID */}
          <text
            x={colW * 0.54}
            y={13}
            textAnchor="middle"
            fontSize={9.2 * Math.max(0.86, sx)}
            fontWeight="700"
            fill="#0f172a"
          >
            Shaft {s.id}
            <tspan
              dx={5}
              fontSize={6.2 * Math.max(0.86, sx)}
              fontWeight="700"
              fill={statusBadgeColor(shStatus)}
            >
              {s.sheetPileStyle ? `SP:${shDoneLayers}/${s.totalLayers}` : `L:${shDoneLayers}/${s.totalLayers}`}
            </tspan>
          </text>

          {/* --- LEFT DESCRIPTIONS & STATUS TABLES --- */}
          <g transform={`translate(2, ${rowH < 224 ? 17 : 18})`}>
            <text
              x={tblW / 2}
              y={5}
              textAnchor="middle"
              fontSize={5.0}
              fontWeight="700"
              fill="#1e3a8a"
              textDecoration="underline"
            >
              Shaft Descriptions:
            </text>
            <rect
              x={0}
              y={7}
              width={tblW}
              height={34}
              fill="#ffffff"
              stroke="#1e3a8a"
              strokeWidth={0.65}
            />
            <line x1={29 * sx} y1={7} x2={29 * sx} y2={41} stroke="#1e3a8a" strokeWidth={0.5} />
            {[1, 2, 3].map((r) => (
              <line
                key={r}
                x1={0}
                y1={7 + r * 8.5}
                x2={tblW}
                y2={7 + r * 8.5}
                stroke="#1e3a8a"
                strokeWidth={0.5}
              />
            ))}
            <text x={2} y={13} fontSize={4.4} fill="#1e3a8a">Shaft Size</text>
            <text x={29 * sx + (tblW - 29 * sx) / 2} y={13} textAnchor="middle" fontSize={4.7} fontWeight="600" fill="#0f172a">{s.shaftSize}</text>

            <text x={2} y={21.5} fontSize={4.4} fill="#1e3a8a">Type</text>
            <text x={29 * sx + (tblW - 29 * sx) / 2} y={21.5} textAnchor="middle" fontSize={4.4} fontWeight="600" fill="#0f172a">{trunc(s.shaftType, 13)}</text>

            <text x={2} y={30} fontSize={4.4} fill="#1e3a8a">Net Height</text>
            <text x={29 * sx + (tblW - 29 * sx) / 2} y={30} textAnchor="middle" fontSize={4.7} fontWeight="600" fill="#0f172a">{s.netHeightMm}</text>

            <text x={2} y={38.5} fontSize={4.4} fill="#1e3a8a">Bot. Slab</text>
            <text x={29 * sx + (tblW - 29 * sx) / 2} y={38.5} textAnchor="middle" fontSize={4.7} fontWeight="600" fill="#0f172a">{s.bottomSlabMm}</text>

            {/* Construction Status Table */}
            <text
              x={tblW / 2}
              y={48}
              textAnchor="middle"
              fontSize={5.0}
              fontWeight="700"
              fill="#1e3a8a"
              textDecoration="underline"
            >
              Construction Status
            </text>
            <rect
              x={0}
              y={50}
              width={tblW}
              height={78}
              fill="#ffffff"
              stroke="#1e3a8a"
              strokeWidth={0.65}
            />
            <line x1={11 * sx} y1={50} x2={11 * sx} y2={128} stroke="#1e3a8a" strokeWidth={0.5} />
            <line x1={29 * sx} y1={50} x2={29 * sx} y2={128} stroke="#1e3a8a" strokeWidth={0.5} />

            {[
              {
                name: 'Shaft',
                y: 50,
                st: shStatus,
                sD: formatDateDisplay(s.shaftSDate),
                eD: s.shaftEDate ? formatDateDisplay(s.shaftEDate) : shStatus === 'ongoing' ? 'On-going' : '',
                dur: shDur !== null ? `${shDur} Days` : shStatus === 'ongoing' ? 'On-going' : 'Rem.',
              },
              {
                name: 'Tunnel',
                y: 76,
                st: mtStatus,
                sD: formatDateDisplay(s.tunnelSDate),
                eD: s.tunnelEDate ? formatDateDisplay(s.tunnelEDate) : mtStatus === 'ongoing' ? 'On-going' : '',
                dur: mtDur !== null ? `${mtDur} Days` : mtStatus === 'ongoing' ? 'On-going' : 'Rem.',
              },
              {
                name: 'Manhole',
                y: 102,
                st: mhStatus,
                sD: formatDateDisplay(s.manholeSDate),
                eD:
                  mhStatus === 'complete'
                    ? formatDateDisplay(s.manholeEDate)
                    : mhStatus === 'ongoing'
                    ? 'On-going'
                    : '',
                dur:
                  mhStatus === 'complete' && mhDur !== null
                    ? `${mhDur} Days`
                    : mhStatus === 'ongoing'
                    ? 'On-going'
                    : 'Rem.',
              },
            ].map((grp, gi) => (
              <g key={grp.name}>
                {gi > 0 && (
                  <line x1={0} y1={grp.y} x2={tblW} y2={grp.y} stroke="#1e3a8a" strokeWidth={0.75} />
                )}
                <rect x={0.5} y={grp.y + 0.5} width={2.8} height={25} fill={statusBadgeColor(grp.st)} />
                <line x1={11 * sx} y1={grp.y + 8.6} x2={tblW} y2={grp.y + 8.6} stroke="#94a3b8" strokeWidth={0.4} />
                <line x1={11 * sx} y1={grp.y + 17.3} x2={tblW} y2={grp.y + 17.3} stroke="#94a3b8" strokeWidth={0.4} />

                <text
                  x={7 * sx}
                  y={grp.y + 13}
                  textAnchor="middle"
                  fontSize={4.2}
                  fontWeight="700"
                  fill="#1e3a8a"
                  transform={`rotate(-90, ${7 * sx}, ${grp.y + 13})`}
                >
                  {grp.name}
                </text>

                <text x={12.5 * sx} y={grp.y + 6.2} fontSize={4.1} fill="#334155">S.Date</text>
                <text x={29 * sx + (tblW - 29 * sx) / 2} y={grp.y + 6.2} textAnchor="middle" fontSize={4.5} fill="#0f172a">{grp.sD}</text>

                <text x={12.5 * sx} y={grp.y + 14.8} fontSize={4.1} fill="#334155">E.Date</text>
                <text
                  x={29 * sx + (tblW - 29 * sx) / 2}
                  y={grp.y + 14.8}
                  textAnchor="middle"
                  fontSize={4.4}
                  fontWeight={grp.eD === 'On-going' ? '700' : '400'}
                  fill={grp.eD === 'On-going' ? '#d97706' : '#0f172a'}
                >
                  {grp.eD}
                </text>

                <text x={12.5 * sx} y={grp.y + 23.4} fontSize={4.1} fill="#334155">Dur.</text>
                <text
                  x={29 * sx + (tblW - 29 * sx) / 2}
                  y={grp.y + 23.4}
                  textAnchor="middle"
                  fontSize={4.4}
                  fontWeight="700"
                  fill={
                    grp.st === 'complete'
                      ? '#15803d'
                      : grp.st === 'ongoing'
                      ? '#b45309'
                      : '#94a3b8'
                  }
                >
                  {grp.dur}
                </text>
              </g>
            ))}
          </g>

          {/* --- RIGHT CROSS SECTION DIAGRAM --- */}
          <line
            x1={wallLeftX - 4}
            y1={shaftTopY}
            x2={wallRightX + wallThick + 8}
            y2={shaftTopY}
            stroke="#475569"
            strokeWidth={0.7}
          />
          <polygon
            points={`${innerX + innerW / 2 - 3},${shaftTopY - 4} ${innerX + innerW / 2 + 3},${shaftTopY - 4} ${innerX + innerW / 2},${shaftTopY}`}
            fill="#64748b"
          />
          <text
            x={innerX + innerW / 2 + 5}
            y={shaftTopY - 2}
            fontSize={4.8}
            fontWeight="700"
            fill="#334155"
          >
            Road Level
          </text>

          {/* Outer Lip (Only for concrete layer shafts, NOT sheet pile) */}
          {!s.sheetPileStyle && (
            <>
              <rect
                x={wallLeftX - 2}
                y={shaftTopY}
                width={wallThick + 2}
                height={3}
                fill={getLayerFill(s, 0, bSnap) ?? '#ffffff'}
                stroke={getLayerFill(s, 0, bSnap) ? '#14532d' : colors.remainingOutline}
                strokeWidth={0.5}
              />
              <rect
                x={wallRightX}
                y={shaftTopY}
                width={wallThick + 2}
                height={3}
                fill={getLayerFill(s, 0, bSnap) ?? '#ffffff'}
                stroke={getLayerFill(s, 0, bSnap) ? '#14532d' : colors.remainingOutline}
                strokeWidth={0.5}
              />
            </>
          )}

          {/* Shaft Walls: either Steel Sheet Pile (4 bottom-to-top divisions, NO W1..W12 labels) or Layer-based W1..WN */}
          {s.sheetPileStyle ? (
            <g>
              {(() => {
                const pileW = Math.max(5.5, wallThick * 0.6);
                const rightPileX = wallRightX + wallThick - pileW;
                const segCount = Math.max(1, s.totalLayers);
                const segH = wallH / segCount;
                const toeH = 8.5;
                const btmFill = getLayerFill(s, 0, bSnap);
                const btmStroke = btmFill ? '#14532d' : colors.remainingOutline;

                return (
                  <>
                    {/* 4 Sheet Pile Divisions counted BOTTOM -> TOP (li=0 at bottom, li=segCount-1 at top) */}
                    {Array.from({ length: segCount }).map((_, li) => {
                      const ly = shaftTopY + wallH - (li + 1) * segH;
                      const fill = getLayerFill(s, li, bSnap);
                      const stroke = fill ? '#14532d' : colors.remainingOutline;
                      return (
                        <g key={li}>
                          <rect
                            x={wallLeftX}
                            y={ly}
                            width={pileW}
                            height={segH}
                            fill={fill ?? '#ffffff'}
                            stroke={stroke}
                            strokeWidth={0.6}
                          />
                          <rect
                            x={rightPileX}
                            y={ly}
                            width={pileW}
                            height={segH}
                            fill={fill ?? '#ffffff'}
                            stroke={stroke}
                            strokeWidth={0.6}
                          />
                          {/* Interlock rib line down center of each sheet pile */}
                          <line
                            x1={wallLeftX + pileW * 0.5}
                            y1={ly}
                            x2={wallLeftX + pileW * 0.5}
                            y2={ly + segH}
                            stroke={stroke}
                            strokeWidth={0.4}
                            strokeOpacity={0.65}
                          />
                          <line
                            x1={rightPileX + pileW * 0.5}
                            y1={ly}
                            x2={rightPileX + pileW * 0.5}
                            y2={ly + segH}
                            stroke={stroke}
                            strokeWidth={0.4}
                            strokeOpacity={0.65}
                          />
                        </g>
                      );
                    })}

                    {/* Sheet Pile Toe Extensions below Bottom Slab (matches AutoCAD sheet pile drawing) */}
                    <rect
                      x={wallLeftX}
                      y={shaftTopY + wallH + botSlabH}
                      width={pileW}
                      height={toeH}
                      fill={btmFill ?? '#ffffff'}
                      stroke={btmStroke}
                      strokeWidth={0.55}
                    />
                    <rect
                      x={rightPileX}
                      y={shaftTopY + wallH + botSlabH}
                      width={pileW}
                      height={toeH}
                      fill={btmFill ?? '#ffffff'}
                      stroke={btmStroke}
                      strokeWidth={0.55}
                    />
                    <line
                      x1={wallLeftX + pileW * 0.5}
                      y1={shaftTopY + wallH + botSlabH}
                      x2={wallLeftX + pileW * 0.5}
                      y2={shaftTopY + wallH + botSlabH + toeH}
                      stroke={btmStroke}
                      strokeWidth={0.4}
                      strokeOpacity={0.65}
                    />
                    <line
                      x1={rightPileX + pileW * 0.5}
                      y1={shaftTopY + wallH + botSlabH}
                      x2={rightPileX + pileW * 0.5}
                      y2={shaftTopY + wallH + botSlabH + toeH}
                      stroke={btmStroke}
                      strokeWidth={0.4}
                      strokeOpacity={0.65}
                    />

                    {/* Horizontal Steel Strut / Waler Bracing Levels + Yellow Outer Brackets (bottom -> top) */}
                    {[...Array.from({ length: Math.max(0, segCount - 1) }).map((_, k) => shaftTopY + wallH - (k + 1) * segH), shaftTopY + 1.5].map((strutY, si) => (
                      <g key={si}>
                        {/* Yellow waler/strut bracket pads on left & right sheet piles */}
                        <rect
                          x={wallLeftX - 2}
                          y={strutY - 1.3}
                          width={pileW + 4}
                          height={2.6}
                          fill="#facc15"
                          stroke="#854d0e"
                          strokeWidth={0.35}
                        />
                        <rect
                          x={rightPileX - 2}
                          y={strutY - 1.3}
                          width={pileW + 4}
                          height={2.6}
                          fill="#facc15"
                          stroke="#854d0e"
                          strokeWidth={0.35}
                        />
                        {/* Horizontal strut beam across shaft */}
                        <line
                          x1={wallLeftX - 3.5}
                          y1={strutY}
                          x2={wallRightX + wallThick + 3.5}
                          y2={strutY}
                          stroke="#b91c1c"
                          strokeWidth={0.85}
                        />
                      </g>
                    ))}
                  </>
                );
              })()}
            </g>
          ) : (
            Array.from({ length: s.totalLayers }).map((_, li) => {
              const ly = shaftTopY + li * layerH;
              const fill = getLayerFill(s, li, bSnap);
              const stroke = fill ? '#14532d' : colors.remainingOutline;
              const labelColor =
                fill === colors.overallShaft || fill === currHighlight
                  ? '#052e16'
                  : fill
                  ? '#ffffff'
                  : '#dc2626';
              return (
                <g key={li}>
                  <rect
                    x={wallLeftX}
                    y={ly}
                    width={wallThick}
                    height={Math.max(2, layerH - 0.45)}
                    fill={fill ?? '#ffffff'}
                    stroke={stroke}
                    strokeWidth={0.55}
                  />
                  <rect
                    x={wallRightX}
                    y={ly}
                    width={wallThick}
                    height={Math.max(2, layerH - 0.45)}
                    fill={fill ?? '#ffffff'}
                    stroke={stroke}
                    strokeWidth={0.55}
                  />
                  <text
                    x={wallLeftX + wallThick / 2}
                    y={ly + layerH * 0.72}
                    textAnchor="middle"
                    fontSize={(s.totalLayers >= 11 ? 3.55 : 3.95) * Math.max(0.85, sx)}
                    fontWeight="700"
                    fill={labelColor}
                  >
                    W{li + 1}
                  </text>
                </g>
              );
            })
          )}

          {/* Bottom Slab */}
          {(() => {
            const bFill = getBottomSlabFill(s, bSnap);
            return (
              <rect
                x={wallLeftX}
                y={shaftTopY + wallH}
                width={wallThick * 2 + innerW}
                height={botSlabH}
                fill={bFill ?? '#ffffff'}
                stroke={bFill ? '#14532d' : colors.remainingOutline}
                strokeWidth={0.65}
              />
            );
          })()}

          {/* --- MANHOLE (2 PARTS: UPPER PRECAST + LOWER CASTING) --- */}
          <g
            onClick={(e) => {
              e.stopPropagation();
              onSelectShaft(s.id, 'manhole');
            }}
          >
            <rect
              x={mhX + 2.8 * sx}
              y={precastY}
              width={mhW - 5.6 * sx}
              height={precastH}
              fill="#ffffff"
              stroke={currPrePct > 0 ? '#0369a1' : colors.remainingOutline}
              strokeWidth={0.65}
            />
            {prevPrePct > 0 && (
              <rect
                x={mhX + 2.8 * sx + 0.4}
                y={precastY + precastH * (1 - prevPrePct / 100)}
                width={mhW - 5.6 * sx - 0.8}
                height={precastH * (prevPrePct / 100)}
                fill={precastBaseColor}
                fillOpacity={0.85}
              />
            )}
            {viewMode !== 'overall' && currPrePct > prevPrePct && (
              <rect
                x={mhX + 2.8 * sx + 0.4}
                y={precastY + precastH * (1 - currPrePct / 100)}
                width={mhW - 5.6 * sx - 0.8}
                height={precastH * ((currPrePct - prevPrePct) / 100)}
                fill={currHighlight}
              />
            )}
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1={mhX + 2.8 * sx}
                y1={precastY + precastH * f}
                x2={mhX + mhW - 2.8 * sx}
                y2={precastY + precastH * f}
                stroke={currPrePct > 0 ? '#ffffff' : colors.remainingOutline}
                strokeWidth={0.55}
              />
            ))}

            <rect
              x={mhX}
              y={castingY}
              width={mhW}
              height={castingH}
              fill="#ffffff"
              stroke={currCastPct > 0 ? '#1e3a8a' : colors.remainingOutline}
              strokeWidth={0.7}
            />
            {prevCastPct > 0 && (
              <rect
                x={mhX + 0.4}
                y={castingY + castingH * (1 - prevCastPct / 100)}
                width={mhW - 0.8}
                height={castingH * (prevCastPct / 100)}
                fill={mhPrevColor}
              />
            )}
            {viewMode !== 'overall' && currCastPct > prevCastPct && (
              <rect
                x={mhX + 0.4}
                y={castingY + castingH * (1 - currCastPct / 100)}
                width={mhW - 0.8}
                height={castingH * ((currCastPct - prevCastPct) / 100)}
                fill={currHighlight}
              />
            )}
            <rect
              x={mhX + 3 * sx}
              y={castingY + 3.5}
              width={mhW - 6 * sx}
              height={castingH - 7}
              fill="#ffffff"
              fillOpacity={0.88}
              stroke={currCastPct > 0 ? '#1e3a8a' : colors.remainingOutline}
              strokeWidth={0.5}
            />
            {[0.2, 0.35, 0.5, 0.65, 0.8].map((f) => (
              <line
                key={f}
                x1={mhX + 4.2 * sx}
                y1={castingY + 3.5 + (castingH - 7) * f}
                x2={mhX + mhW - 4.2 * sx}
                y2={castingY + 3.5 + (castingH - 7) * f}
                stroke="#dc2626"
                strokeWidth={0.45}
                strokeDasharray="2,1.5"
              />
            ))}
          </g>

          {/* --- TUNNEL CONNECTION BAR TO NEXT SHAFT (FLUSH AGAINST BOTH WALLS — FIX #1!) --- */}
          {showTunneling &&
            !isLastInRow &&
            !isLastShaft &&
            hasOutgoingTunnel &&
            shaftList[idx + 1]?.id === s.nextId &&
            renderTunnelBar(
              s,
              wallRightX + wallThick,
              tunnelBarY,
              colW + wallLeftX - (wallRightX + wallThick),
              10,
              100,
              'full',
              bSnap
            )}

          {/* Non-contiguous selected shafts: clean outgoing stub "To nextId" without touching an unrelated neighbor */}
          {showTunneling &&
            !isLastInRow &&
            !isLastShaft &&
            hasOutgoingTunnel &&
            shaftList[idx + 1]?.id !== s.nextId &&
            renderTunnelBar(
              s,
              wallRightX + wallThick,
              tunnelBarY,
              Math.max(46 * sx, colW + wallLeftX - (wallRightX + wallThick) - 18 * sx),
              10,
              100,
              'exit',
              bSnap
            )}

          {/* Exiting 10%..50% bar at right end of row */}
          {showTunneling &&
            isLastInRow &&
            !isLastShaft &&
            hasOutgoingTunnel &&
            renderTunnelBar(
              s,
              wallRightX + wallThick,
              tunnelBarY,
              colW - (wallRightX + wallThick) + 34,
              10,
              shaftList[idx + 1]?.id === s.nextId ? 50 : 100,
              'exit',
              bSnap
            )}

          {/* Incoming 60%..100% bar flush against left wall at start of row > 0 */}
          {showTunneling &&
            col === 0 &&
            row > 0 &&
            idx > 0 &&
            shaftList[idx - 1].tunnelLengthM > 0 &&
            shaftList[idx - 1].nextId === s.id &&
            renderTunnelBar(
              shaftList[idx - 1],
              -28,
              tunnelBarY,
              wallLeftX - -28,
              60,
              100,
              'entry',
              baselineMap[shaftList[idx - 1].id]
            )}

          {/* Last Shaft (WA-36 -> Pump Station) flush into Pump Station left caisson wall */}
          {showTunneling &&
            isLastShaft &&
            connectLastToPump &&
            hasOutgoingTunnel &&
            renderTunnelBar(
              s,
              wallRightX + wallThick,
              tunnelBarY,
              settings.showPumpStation && pumpStructAbsX
                ? Math.max(40, pumpStructAbsX - (cellX + wallRightX + wallThick))
                : 96 * sx,
              10,
              100,
              'pump',
              bSnap
            )}

          {/* Custom View: Last Selected Shaft outgoing tunnel segment (when Pump Station not shown) */}
          {showTunneling &&
            isLastShaft &&
            !connectLastToPump &&
            showLastOutgoingTunnel &&
            hasOutgoingTunnel &&
            renderTunnelBar(
              s,
              wallRightX + wallThick,
              tunnelBarY,
              114 * sx,
              10,
              100,
              'exit',
              bSnap
            )}
        </g>
      );
    });
  };

  /**
   * 2-Part Golapbag SPS Pump Station:
   * - Fix #4: Sinking status (Complete / On-going / Remaining)
   * - Fix #5: Layers counted from BOTTOM (1st Layer = L1) up to TOP (5th Layer = L5)
   * - Fix #6: "(Click to Edit)" removed completely!
   */
  const renderPumpStation = (
    ps: PumpStationData,
    x: number,
    y: number,
    w: number,
    h: number
  ) => {
    const isPumpSelected = selectedShaftId === 'PUMP_STATION';
    const compactPump = h < 224 || w < 340;
    const structX = x + 6;
    const structW = compactPump ? Math.min(108, w * 0.46) : Math.min(162, w * 0.43);

    const mrTopY = y + (compactPump ? 17 : 20);
    const mrH = compactPump ? 50 : 56;
    const groundY = mrTopY + mrH;

    const subTopY = groundY;
    const subH = compactPump ? 102 : 114;
    const shoeH = compactPump ? 14 : 16;
    const bodyH = subH - shoeH;
    const layerCount = Math.max(1, ps.layers.length);
    const layerH = bodyH / layerCount;

    const tblX = structX + structW + (compactPump ? 4 : 8);
    const tblW = Math.max(96, Math.min(compactPump ? 116 : 172, x + w - tblX - 2));

    const resolvePumpFill = (
      status: WorkStatus,
      prevDone: boolean
    ): { fill: string; stroke: string; badgeBg: string; badgeText: string } => {
      if (status === 'complete') {
        const isCompNew = viewMode !== 'overall' && !prevDone;
        const fill =
          viewMode === 'overall'
            ? colors.overallShaft
            : prevDone
            ? viewMode === 'weekly'
              ? colors.prevWeekShaft
              : colors.prevMonthShaft
            : currHighlight;
        return {
          fill,
          stroke: isCompNew ? '#9a3412' : '#14532d',
          badgeBg: isCompNew ? '#ffedd5' : '#dcfce7',
          badgeText: isCompNew ? '#c2410c' : '#15803d',
        };
      }
      if (status === 'ongoing') {
        return {
          fill: '#fbbf24',
          stroke: '#b45309',
          badgeBg: '#fef3c7',
          badgeText: '#b45309',
        };
      }
      return {
        fill: '#ffffff',
        stroke: colors.remainingOutline,
        badgeBg: '#fef2f2',
        badgeText: '#dc2626',
      };
    };

    const mrVisual = resolvePumpFill(
      ps.machineRoom.status,
      baseline.pumpMachineRoomStatus === 'complete'
    );
    const lowerStatus = getPumpLowerStatus(ps);
    const sinkVisual = resolvePumpFill(
      ps.sinkingStatus,
      baseline.pumpSinkingStatus === 'complete'
    );
    const sinkRemM = Math.max(0, Number((ps.totalHeightM - ps.sinkingCompletedM).toFixed(2)));
    const mrDur = calcDurationDays(ps.machineRoom.sDate, ps.machineRoom.eDate);

    const lvl2H = compactPump ? 21 : 24;
    const lvl1Y = mrTopY + lvl2H;
    const midX = structX + structW * 0.52;
    const leftAnnexW = compactPump ? 10 : 12;

    // Reverse layer indices for table top-down so 5th Layer (top) -> 1st Layer (bottom) matches physical elevation!
    const topDownLayers = [...ps.layers]
      .map((ly, idx) => ({ ly, idx }))
      .reverse();

    const tblRowH = compactPump ? 21 : 24;

    return (
      <g
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelectShaft('PUMP_STATION', 'shaft');
        }}
      >
        {isPumpSelected && (
          <rect
            data-selection-ring="true"
            x={x + 1}
            y={y + 1}
            width={w - 3}
            height={h - 4}
            rx={4}
            fill="#eff6ff"
            fillOpacity={0.35}
            stroke="#2563eb"
            strokeWidth={1.6}
            strokeDasharray="4,2"
          />
        )}

        <text
          x={x + w * 0.5}
          y={y + 11.5}
          textAnchor="middle"
          fontSize={compactPump ? 8.0 : 9.0}
          fontWeight="700"
          fill="#0f172a"
        >
          Pump Station (Golapbag SPS - Sec 1-1)
        </text>

        {/* UPPER PART: MACHINE ROOM */}
        <polygon
          points={`${structX - leftAnnexW},${groundY - 14} ${structX},${groundY - 19} ${structX},${groundY} ${structX - leftAnnexW},${groundY}`}
          fill={mrVisual.fill}
          fillOpacity={ps.machineRoom.status === 'remaining' ? 1 : 0.78}
          stroke={mrVisual.stroke}
          strokeWidth={0.7}
        />
        <rect
          x={structX + 6}
          y={mrTopY}
          width={structW - 6}
          height={lvl2H}
          fill={mrVisual.fill}
          fillOpacity={ps.machineRoom.status === 'remaining' ? 1 : 0.85}
          stroke={mrVisual.stroke}
          strokeWidth={0.85}
        />
        <rect
          x={structX + 4}
          y={mrTopY - 2}
          width={structW - 2}
          height={2.8}
          fill={ps.machineRoom.status === 'remaining' ? '#e2e8f0' : mrVisual.stroke}
          stroke={mrVisual.stroke}
          strokeWidth={0.5}
        />
        <rect
          x={structX}
          y={lvl1Y}
          width={structW}
          height={mrH - lvl2H}
          fill={mrVisual.fill}
          fillOpacity={ps.machineRoom.status === 'remaining' ? 1 : 0.88}
          stroke={mrVisual.stroke}
          strokeWidth={0.9}
        />
        <line x1={midX} y1={mrTopY} x2={midX} y2={groundY} stroke={mrVisual.stroke} strokeWidth={0.65} />
        <line x1={structX + 6} y1={lvl1Y} x2={midX} y2={lvl1Y} stroke={mrVisual.stroke} strokeWidth={0.75} />

        {[0.14, 0.3, 0.58, 0.74, 0.88].map((f, wi) => (
          <rect
            key={wi}
            x={structX + structW * f}
            y={mrTopY + 4.5}
            width={structW * 0.06}
            height={7.5}
            fill="#ffffff"
            fillOpacity={0.75}
            stroke={mrVisual.stroke}
            strokeWidth={0.45}
          />
        ))}
        <text x={structX + 6 + (midX - structX - 6) / 2} y={mrTopY + lvl2H - 3.5} textAnchor="middle" fontSize={3.6} fontWeight="700" fill="#0f172a">Control</text>
        <text x={midX + (structX + structW - midX) / 2} y={mrTopY + lvl2H - 3.5} textAnchor="middle" fontSize={3.6} fontWeight="700" fill="#0f172a">Food/Tea</text>
        <text x={structX + (midX - structX) / 2} y={lvl1Y + 10.5} textAnchor="middle" fontSize={3.9} fontWeight="700" fill="#0f172a">Storage</text>
        <text x={midX + (structX + structW - midX) / 2} y={lvl1Y + 10.5} textAnchor="middle" fontSize={3.9} fontWeight="700" fill="#0f172a">Pump House</text>

        <rect
          x={structX + structW * 0.12}
          y={lvl1Y + 14.5}
          width={structW * 0.76}
          height={10.5}
          rx={2}
          fill="#ffffff"
          fillOpacity={0.93}
          stroke={mrVisual.stroke}
          strokeWidth={0.55}
        />
        <text
          x={structX + structW * 0.5}
          y={lvl1Y + 21.8}
          textAnchor="middle"
          fontSize={compactPump ? 4.1 : 4.4}
          fontWeight="700"
          fill={mrVisual.badgeText}
        >
          MACHINE ROOM: {ps.machineRoom.status.toUpperCase()}
        </text>

        {/* Ground Line */}
        <line
          x1={structX - leftAnnexW - 3}
          y1={groundY}
          x2={structX + structW + 4}
          y2={groundY}
          stroke="#1e293b"
          strokeWidth={1.0}
        />
        <text x={structX - leftAnnexW - 2} y={groundY + 6} fontSize={3.5} fontWeight="700" fill="#475569">
          +7.0m
        </text>

        {/* LOWER PART: MAIN PUMP STRUCTURE — LAYERS COUNTED FROM BOTTOM (L1 = 1st Layer) TO TOP (L5 = 5th Layer) (FIX #5!) */}
        <rect x={structX} y={subTopY} width={structW} height={bodyH} fill="#f8fafc" stroke="#64748b" strokeWidth={0.5} />

        {ps.layers.map((ly, li) => {
          // li=0 (1st Layer) sits at BOTTOM above cutting shoe; li=4 (5th Layer) sits at TOP under +7.0m!
          const lyY = subTopY + bodyH - (li + 1) * layerH;
          const prevDone = Boolean(baseline.pumpLayersDone?.[li]);
          const vis = resolvePumpFill(ly.status, prevDone);
          const wallW = compactPump ? 12 : 14;
          const innerMidX = structX + structW / 2 - 4;
          const partWallX = structX + structW * 0.27;
          const lblCol =
            ly.status === 'complete' && vis.fill === colors.overallShaft
              ? '#052e16'
              : ly.status === 'remaining'
              ? '#dc2626'
              : '#0f172a';

          return (
            <g key={ly.name}>
              <rect
                x={structX + wallW}
                y={lyY}
                width={structW - wallW * 2}
                height={layerH}
                fill={vis.fill}
                fillOpacity={ly.status === 'remaining' ? 0.14 : 0.2}
              />
              <rect
                x={structX}
                y={lyY}
                width={wallW}
                height={layerH - 0.5}
                fill={vis.fill}
                stroke={vis.stroke}
                strokeWidth={0.65}
              />
              <rect
                x={structX + structW - wallW}
                y={lyY}
                width={wallW}
                height={layerH - 0.5}
                fill={vis.fill}
                stroke={vis.stroke}
                strokeWidth={0.65}
              />
              <rect
                x={innerMidX}
                y={lyY}
                width={8}
                height={layerH - 0.5}
                fill={vis.fill}
                stroke={vis.stroke}
                strokeWidth={0.55}
              />
              {(li === 0 || li === 2 || li === 4) && (
                <rect
                  x={structX + wallW}
                  y={lyY + layerH - 4}
                  width={structW - wallW * 2}
                  height={3.8}
                  fill={vis.fill}
                  stroke={vis.stroke}
                  strokeWidth={0.45}
                />
              )}
              {li <= 2 && (
                <rect
                  x={partWallX}
                  y={lyY}
                  width={4.5}
                  height={layerH - 0.5}
                  fill={vis.fill}
                  stroke={vis.stroke}
                  strokeWidth={0.45}
                />
              )}
              <line
                x1={structX}
                y1={lyY}
                x2={structX + structW}
                y2={lyY}
                stroke="#475569"
                strokeWidth={0.4}
                strokeDasharray="2,1.5"
              />
              {/* L1..L5 inside left wall so WA-36 tunnel bar connects flush without overlap! */}
              <text
                x={structX + wallW / 2}
                y={lyY + layerH * 0.66}
                textAnchor="middle"
                fontSize={4.2}
                fontWeight="700"
                fill={lblCol}
              >
                L{li + 1}
              </text>
            </g>
          );
        })}

        {/* Base Plug / Cutting Shoe (linked to bottom L1 layer) */}
        {(() => {
          const shoeY = subTopY + bodyH;
          const shoeVis = resolvePumpFill(
            ps.layers[0]?.status ?? 'remaining',
            Boolean(baseline.pumpLayersDone?.[0])
          );
          return (
            <g>
              <polygon
                points={`${structX},${shoeY} ${structX + 16},${shoeY} ${structX + 9},${shoeY + shoeH} ${structX},${shoeY + shoeH}`}
                fill={shoeVis.fill}
                stroke={shoeVis.stroke}
                strokeWidth={0.65}
              />
              <polygon
                points={`${structX + structW - 16},${shoeY} ${structX + structW},${shoeY} ${structX + structW},${shoeY + shoeH} ${structX + structW - 9},${shoeY + shoeH}`}
                fill={shoeVis.fill}
                stroke={shoeVis.stroke}
                strokeWidth={0.65}
              />
              <rect
                x={structX + 9}
                y={shoeY + 2.5}
                width={structW - 18}
                height={shoeH - 2.5}
                fill={lowerStatus === 'complete' ? '#dcfce7' : '#fee2e2'}
                stroke={lowerStatus === 'complete' ? '#15803d' : '#dc2626'}
                strokeWidth={0.65}
              />
              <text
                x={structX + structW / 2}
                y={shoeY + shoeH * 0.72}
                textAnchor="middle"
                fontSize={compactPump ? 4.0 : 4.4}
                fontWeight="700"
                fill={lowerStatus === 'complete' ? '#166534' : '#991b1b'}
              >
                BASE PLUG / CUTTING SHOE (-13.0m)
              </text>
            </g>
          );
        })()}

        {/* Captions below structure (No "Click to Edit"!) */}
        <text
          x={structX + structW / 2}
          y={subTopY + subH + 9.5}
          textAnchor="middle"
          fontSize={compactPump ? 4.7 : 5.2}
          fontWeight="700"
          fill="#1e3a8a"
        >
          Total H: {ps.totalHeightM}m | Cast: {ps.castingCompleteM}m
        </text>
        <text
          x={structX + structW / 2}
          y={subTopY + subH + 17.5}
          textAnchor="middle"
          fontSize={compactPump ? 4.35 : 4.9}
          fontWeight="700"
          fill={sinkVisual.badgeText}
        >
          Sinking: {ps.sinkingCompletedM}m [{ps.sinkingStatus.toUpperCase()}
          {ps.sinkingStatus !== 'complete' ? ` | Rem: ${sinkRemM}m` : ''}]
        </text>

        {/* RIGHT SIDE 2-PART STATUS TABLE */}
        <g>
          {/* Upper Machine Room Table */}
          <rect
            x={tblX}
            y={y + 17}
            width={tblW}
            height={compactPump ? 30 : 34}
            fill="#ffffff"
            stroke="#1e3a8a"
            strokeWidth={0.75}
          />
          <rect
            x={tblX}
            y={y + 17}
            width={tblW}
            height={11}
            fill="#eff6ff"
            stroke="#1e3a8a"
            strokeWidth={0.55}
          />
          <text x={tblX + 2.5} y={y + 24.5} fontSize={tblW < 130 ? 3.35 : tblW < 155 ? 3.8 : 4.4} fontWeight="700" fill="#1e3a8a">
            UPPER: MACHINE ROOM
          </text>
          <rect
            x={tblX + tblW - (tblW < 130 ? 29 : tblW < 155 ? 34 : 40)}
            y={y + 18.2}
            width={tblW < 130 ? 27.5 : tblW < 155 ? 32 : 37}
            height={8.5}
            rx={1.5}
            fill={mrVisual.badgeBg}
            stroke={mrVisual.badgeText}
            strokeWidth={0.45}
          />
          <text
            x={tblX + tblW - (tblW < 130 ? 15.2 : tblW < 155 ? 18 : 21.5)}
            y={y + 24.0}
            textAnchor="middle"
            fontSize={tblW < 130 ? 2.9 : tblW < 155 ? 3.4 : 3.9}
            fontWeight="700"
            fill={mrVisual.badgeText}
          >
            {ps.machineRoom.status.toUpperCase()}
          </text>
          <text x={tblX + 2.5} y={y + 36} fontSize={tblW < 130 ? 3.45 : tblW < 155 ? 3.8 : 4.4} fill="#334155">
            S: {formatDateDisplay(ps.machineRoom.sDate)} | E:{' '}
            {ps.machineRoom.eDate
              ? formatDateDisplay(ps.machineRoom.eDate)
              : ps.machineRoom.status === 'ongoing'
              ? 'On-going'
              : '-'}
          </text>
          <text x={tblX + 2.5} y={y + (compactPump ? 44 : 47)} fontSize={tblW < 130 ? 3.45 : tblW < 155 ? 3.8 : 4.4} fontWeight="700" fill={mrVisual.badgeText}>
            Dur: {mrDur !== null ? `${mrDur} Days` : ps.machineRoom.status === 'ongoing' ? 'On-going' : 'Remaining'}
          </text>

          {/* Lower 5 Layers Table (Top-down L5 -> L1 matching elevation from bottom!) */}
          <text
            x={tblX + tblW / 2}
            y={y + (compactPump ? 55 : 60)}
            textAnchor="middle"
            fontSize={tblW < 130 ? 3.65 : tblW < 155 ? 4.1 : 4.7}
            fontWeight="700"
            fill="#1e3a8a"
          >
            LOWER STRUCTURE (5 LAYERS: BTM to TOP)
          </text>
          <rect
            x={tblX}
            y={y + (compactPump ? 58 : 63)}
            width={tblW}
            height={topDownLayers.length * tblRowH}
            fill="#ffffff"
            stroke="#1e3a8a"
            strokeWidth={0.75}
          />
          {topDownLayers.map(({ ly, idx: origIdx }, rowIdx) => {
            const rowY = y + (compactPump ? 58 : 63) + rowIdx * tblRowH;
            const dur = calcDurationDays(ly.sDate, ly.eDate);
            const vis = resolvePumpFill(ly.status, Boolean(baseline.pumpLayersDone?.[origIdx]));
            const badgeW = tblW < 130 ? 26 : tblW < 155 ? 31 : 40;
            return (
              <g key={ly.name}>
                {rowIdx > 0 && (
                  <line x1={tblX} y1={rowY} x2={tblX + tblW} y2={rowY} stroke="#1e3a8a" strokeWidth={0.5} />
                )}
                <rect
                  x={tblX}
                  y={rowY}
                  width={badgeW}
                  height={tblRowH}
                  fill={vis.badgeBg}
                  stroke="#1e3a8a"
                  strokeWidth={0.45}
                />
                <text
                  x={tblX + badgeW / 2}
                  y={rowY + tblRowH * 0.58}
                  textAnchor="middle"
                  fontSize={tblW < 130 ? 3.45 : tblW < 155 ? 3.9 : 4.6}
                  fontWeight="700"
                  fill={vis.badgeText}
                >
                  {ly.name}
                </text>
                <text x={tblX + badgeW + 2.5} y={rowY + tblRowH * 0.4} fontSize={tblW < 130 ? 3.25 : tblW < 155 ? 3.6 : 4.2} fill="#334155">
                  S: {formatDateDisplay(ly.sDate)} | E:{' '}
                  {ly.eDate ? formatDateDisplay(ly.eDate) : ly.status === 'ongoing' ? 'On-going' : '-'}
                </text>
                <text x={tblX + badgeW + 2.5} y={rowY + tblRowH * 0.8} fontSize={tblW < 130 ? 3.25 : tblW < 155 ? 3.6 : 4.2} fontWeight="700" fill={vis.badgeText}>
                  Dur: {dur !== null ? `${dur}d` : '-'} ({ly.status.toUpperCase()})
                </text>
              </g>
            );
          })}

          {/* Lower Lengths & Sinking Status Summary Box (NO "Click to Edit" — Fix #6!) */}
          {(() => {
            const boxY = y + (compactPump ? 58 : 63) + topDownLayers.length * tblRowH + 3;
            return (
              <g>
                <rect
                  x={tblX}
                  y={boxY}
                  width={tblW}
                  height={compactPump ? 24 : 27}
                  fill="#f8fafc"
                  stroke="#1e3a8a"
                  strokeWidth={0.65}
                />
                <text x={tblX + 2.5} y={boxY + 9.5} fontSize={tblW < 130 ? 3.45 : tblW < 155 ? 3.9 : 4.5} fontWeight="700" fill="#1e3a8a">
                  Total H: {ps.totalHeightM}m | Casting: {ps.castingCompleteM}m
                </text>
                <text x={tblX + 2.5} y={boxY + (compactPump ? 19.5 : 21)} fontSize={tblW < 130 ? 3.25 : tblW < 155 ? 3.7 : 4.3} fontWeight="700" fill={sinkVisual.badgeText}>
                  Sinking: {ps.sinkingCompletedM}m — {ps.sinkingStatus.toUpperCase()}
                  {ps.sinkingStatus !== 'complete' ? ` (Rem: ${sinkRemM}m)` : ''}
                </text>
              </g>
            );
          })()}
        </g>
      </g>
    );
  };

  // Shared Legend & Title Block helper (compactable for Combined sheet)
  const renderLegendAndTitle = (
    legX: number,
    legY: number,
    legW: number,
    legH: number,
    titleX: number,
    titleY: number,
    titleW: number,
    titleH: number,
    includeMapKey: boolean
  ) => {
    const compact = legW < 280;
    const showCompactDelta = compact && viewMode !== 'overall';
    const actualLegH = showCompactDelta ? 114 : legH;
    const fTitle = compact ? (showCompactDelta ? 8.6 : 9.1) : 10.2;
    const fItem = compact ? (showCompactDelta ? 7.1 : 7.5) : 8.0;
    const hdrH = compact ? (showCompactDelta ? 19 : 22) : 21;
    const rowStep = compact
      ? showCompactDelta
        ? 15.5
        : includeMapKey
        ? 28
        : 30
      : includeMapKey
      ? 21
      : 24;

    const fmtMhDelta = (done: number, ong: number) => {
      if (done > 0 && ong > 0) return `+${done} Done, +${ong} Ong`;
      if (done > 0) return `+${done} Done`;
      if (ong > 0) return `+${ong} Ong`;
      return '';
    };
    const wbDeltaM =
      showCompactDelta && baseline.wbCompletedLengthM !== undefined
        ? Math.max(0, wbData.completedLengthM - baseline.wbCompletedLengthM)
        : 0;
    const deltaRows: Array<{ label: string; value: string; color: string }> = [];
    if (showCompactDelta) {
      if (waSummary.delta.addedLayers > 0) {
        deltaRows.push({
          label: 'WA Layers',
          value: `+${waSummary.delta.addedLayers}L`,
          color: '#15803d',
        });
      }
      if (waSummary.delta.addedTunnelM > 0.05) {
        deltaRows.push({
          label: 'WA Tunnel',
          value: `+${waSummary.delta.addedTunnelM.toFixed(1)} m`,
          color: '#a21caf',
        });
      }
      const waCast = fmtMhDelta(
        waSummary.delta.addedCastingCompleted,
        waSummary.delta.addedCastingOngoing
      );
      if (waCast) {
        deltaRows.push({ label: 'WA MH Cast', value: waCast, color: '#1d4ed8' });
      }
      const waRing = fmtMhDelta(
        waSummary.delta.addedPrecastCompleted,
        waSummary.delta.addedPrecastOngoing
      );
      if (waRing) {
        deltaRows.push({ label: 'WA MH Ring', value: waRing, color: '#0284c7' });
      }
      if (wbDeltaM > 0.05) {
        deltaRows.push({
          label: 'WB Open Cut',
          value: `+${wbDeltaM.toFixed(1)} m`,
          color: '#2563eb',
        });
      }
      if (wcSummary.delta.addedLayers > 0) {
        deltaRows.push({
          label: 'WC Layers',
          value: `+${wcSummary.delta.addedLayers}L`,
          color: '#7e22ce',
        });
      }
      if (wcSummary.delta.addedTunnelM > 0.05) {
        deltaRows.push({
          label: 'WC Tunnel',
          value: `+${wcSummary.delta.addedTunnelM.toFixed(1)} m`,
          color: '#9333ea',
        });
      }
      const wcCast = fmtMhDelta(
        wcSummary.delta.addedCastingCompleted,
        wcSummary.delta.addedCastingOngoing
      );
      if (wcCast) {
        deltaRows.push({ label: 'WC MH Cast', value: wcCast, color: '#1d4ed8' });
      }
      const wcRing = fmtMhDelta(
        wcSummary.delta.addedPrecastCompleted,
        wcSummary.delta.addedPrecastOngoing
      );
      if (wcRing) {
        deltaRows.push({ label: 'WC MH Ring', value: wcRing, color: '#0284c7' });
      }
    }

    const deltaY = legY + actualLegH + 4;
    const deltaH = legH - actualLegH - 4;
    const deltaHdrH = 18;
    const dCount = deltaRows.length;
    const dStep = dCount <= 5 ? 16.5 : Math.min(14.5, 86 / dCount);
    const dFont = dCount <= 5 ? 7.2 : dCount <= 7 ? 6.7 : 6.1;
    const dStartY = deltaY + deltaHdrH + (dCount <= 5 ? 14 : 11);

    return (
      <g>
        {/* COLOR LEGEND */}
        <rect x={legX} y={legY} width={legW} height={actualLegH} fill="#ffffff" stroke="#1e3a8a" strokeWidth={1.1} />
        <rect x={legX} y={legY} width={legW} height={hdrH} fill="#eff6ff" stroke="#1e3a8a" strokeWidth={0.8} />
        <text x={legX + legW / 2} y={legY + (showCompactDelta ? 12.8 : compact ? 14.5 : 14)} textAnchor="middle" fontSize={fTitle} fontWeight="700" fill="#1e3a8a">
          COLOR LEGEND ({viewMode.toUpperCase()})
        </text>

        {(viewMode === 'overall'
          ? [
              { c: colors.overallShaft, label: 'Shaft / Pump / WB Done' },
              { c: colors.overallCasting, label: 'MH Casting / Blue WB Tip' },
              { c: colors.overallPrecast, label: 'MH Upper Precast Ring' },
              { c: colors.overallTunnel, label: 'Micro-Tunnelling Done' },
              { c: '#ffffff', stroke: colors.remainingOutline, label: 'Remaining (Not Started)' },
              ...(includeMapKey ? [{ c: '#f59e0b', label: 'On-going Work / Node' }] : []),
            ]
          : [
              {
                c: viewMode === 'weekly' ? colors.prevWeekShaft : colors.prevMonthShaft,
                label: 'Done in File 1 (Prev)',
              },
              {
                c: viewMode === 'weekly' ? colors.prevWeekManhole : colors.prevMonthManhole,
                label: 'MH Done in File 1',
              },
              {
                c: viewMode === 'weekly' ? colors.prevWeekTunnel : colors.prevMonthTunnel,
                label: 'Tunnel Done in File 1',
              },
              {
                c: currHighlight,
                label: 'NEW PROGRESS (File 2)',
                bold: true,
              },
              {
                c: '#ffffff',
                stroke: colors.remainingOutline,
                label: 'Remaining Work',
              },
            ]
        ).map((item, i) => (
          <g key={item.label} transform={`translate(${legX + 9}, ${legY + (showCompactDelta ? 24 : compact ? 32 : 28) + i * rowStep})`}>
            <rect
              x={0}
              y={0}
              width={showCompactDelta ? 16 : compact ? 18 : 19}
              height={showCompactDelta ? 10.5 : compact ? 13 : 12.5}
              fill={item.c}
              stroke={item.stroke || '#334155'}
              strokeWidth={0.9}
            />
            <text
              x={showCompactDelta ? 22 : compact ? 25 : 26}
              y={showCompactDelta ? 8.3 : compact ? 10 : 9.8}
              fontSize={fItem}
              fontWeight={'bold' in item && item.bold ? '700' : '600'}
              fill={'bold' in item && item.bold ? '#ea580c' : '#0f172a'}
            >
              {item.label}
            </text>
          </g>
        ))}

        <g transform={`translate(${legX + 10}, ${legY + actualLegH - (showCompactDelta ? 6.5 : 10)})`}>
          <circle cx={4} cy={-2.5} r={showCompactDelta ? 2.8 : compact ? 3.4 : 3.0} fill="#16a34a" />
          <text x={10} y={0.5} fontSize={showCompactDelta ? 6.6 : compact ? 7.0 : 6.8} fontWeight="600" fill="#334155">Complete</text>
          <circle cx={compact ? 66 : 70} cy={-2.5} r={showCompactDelta ? 2.8 : compact ? 3.4 : 3.0} fill="#f59e0b" />
          <text x={compact ? 72 : 77} y={0.5} fontSize={showCompactDelta ? 6.6 : compact ? 7.0 : 6.8} fontWeight="600" fill="#334155">On-going</text>
          <circle cx={compact ? 130 : 138} cy={-2.5} r={showCompactDelta ? 2.8 : compact ? 3.4 : 3.0} fill="#dc2626" />
          <text x={compact ? 136 : 145} y={0.5} fontSize={showCompactDelta ? 6.6 : compact ? 7.0 : 6.8} fontWeight="600" fill="#334155">Rem.</text>
        </g>

        {/* COMPARISON DELTA BOX (ONLY IN COMPARISON MODE — ORANGE HIGHLIGHT) */}
        {showCompactDelta && (
          <g>
            <rect x={legX} y={deltaY} width={legW} height={deltaH} fill="#fff7ed" stroke="#ea580c" strokeWidth={1.1} />
            <rect x={legX} y={deltaY} width={legW} height={deltaHdrH} fill="#ffedd5" stroke="#ea580c" strokeWidth={0.8} />
            <text
              x={legX + legW / 2}
              y={deltaY + 12.2}
              textAnchor="middle"
              fontSize={8.2}
              fontWeight="700"
              fill="#9a3412"
            >
              {viewMode === 'weekly' ? 'WEEKLY DELTA (NEW)' : 'MONTHLY DELTA (NEW)'}
            </text>
            {dCount === 0 ? (
              <text
                x={legX + legW / 2}
                y={deltaY + deltaHdrH + (deltaH - deltaHdrH) / 2 + 3}
                textAnchor="middle"
                fontSize={7.2}
                fontWeight="600"
                fill="#9a3412"
              >
                No new progress recorded
              </text>
            ) : (
              deltaRows.map((row, idx) => (
                <g key={row.label}>
                  <text
                    x={legX + 8}
                    y={dStartY + idx * dStep}
                    fontSize={dFont}
                    fontWeight="600"
                    fill="#334155"
                  >
                    {row.label}
                  </text>
                  <text
                    x={legX + legW - 8}
                    y={dStartY + idx * dStep}
                    textAnchor="end"
                    fontSize={dFont}
                    fontWeight="700"
                    fill="#c2410c"
                  >
                    {row.value}
                  </text>
                </g>
              ))
            )}
          </g>
        )}

        {/* TITLE BLOCK (Click anywhere to edit Title Block fields) */}
        <g
          style={onSelectTitleBlock ? { cursor: 'pointer' } : undefined}
          onClick={
            onSelectTitleBlock
              ? (e) => {
                  e.stopPropagation();
                  onSelectTitleBlock();
                }
              : undefined
          }
        >
          <rect x={titleX} y={titleY} width={titleW} height={titleH} fill="#ffffff" stroke="#1e3a8a" strokeWidth={1.1} />
          <rect x={titleX} y={titleY} width={titleW} height={compact ? 22 : hdrH} fill="#1e3a8a" />
          <text x={titleX + titleW / 2} y={titleY + (compact ? 14.5 : 14)} textAnchor="middle" fontSize={compact ? 9.1 : fTitle} fontWeight="700" fill="#ffffff">
            PROJECT DRAWING TITLE BLOCK
          </text>
          {[
            ['Client:', settings.clientName],
            ['Contractor:', settings.contractorName],
            ['Section:', settings.customTitleBlockSection?.trim() || activeSection.toUpperCase()],
            ['Prepared:', settings.preparedBy],
            ['Contractor Representative:', settings.checkedBy],
            ['Date:', formatDateDisplay(settings.reportDate)],
            ['Dwg No:', `${settings.drawingNo}${settings.revision ? ` (${settings.revision})` : ''}`],
            ['Sheet:', settings.sheetFormatLabel?.trim() || 'ISO A1 (841 x 594 mm)'],
          ].map(([k, v], i) => {
            const titleHdrH = compact ? 22 : hdrH;
            const stepY = (titleH - titleHdrH - 2) / 8;
            const isLongKey = k.startsWith('Contractor Rep');
            return (
              <g key={k} transform={`translate(${titleX}, ${titleY + titleHdrH + i * stepY})`}>
                <line x1={0} y1={stepY} x2={titleW} y2={stepY} stroke="#cbd5e1" strokeWidth={0.55} />
                <text
                  x={5}
                  y={stepY * 0.68}
                  fontSize={compact || titleW < 285 ? (isLongKey ? 5.3 : 7.0) : isLongKey ? 6.4 : 7.6}
                  fontWeight="700"
                  fill="#475569"
                >
                  {k}
                </text>
                <text
                  x={
                    compact || titleW < 285
                      ? isLongKey
                        ? 96
                        : 88
                      : isLongKey
                      ? 108
                      : 102
                  }
                  y={stepY * 0.68}
                  fontSize={titleW < 285 ? 7.0 : compact ? 7.0 : 7.8}
                  fontWeight="600"
                  fill="#0f172a"
                >
                  {trunc(v, titleW < 285 ? 28 : compact ? 28 : 42)}
                </text>
              </g>
            );
          })}
        </g>
      </g>
    );
  };

  // ==================== HEADER STRIP SUBTITLE ====================
  const sectionLabelFull =
    activeSection === 'wc-status'
      ? 'WC SECTION — SHAFTS, MANHOLES & MICRO-TUNNELLING STATUS (WC-1 TO WC-27)'
      : activeSection === 'custom'
      ? `CUSTOM ${customCfg.section.toUpperCase()} SELECTION — SHAFTS, MANHOLES & ${
          customCfg.showTunneling ? 'MICRO-TUNNELLING' : 'STATUS'
        } (${customRangeText})`
      : settings.sectionTitle && settings.sectionTitle !== 'WA Section — Shafts, Manholes & Micro-Tunnelling'
      ? settings.sectionTitle
      : activeSection === 'combined'
      ? 'COMBINED PROGRESS REPORT (WA + WB + WC + PUMP STATION)'
      : activeSection === 'wb'
      ? 'WB SECTION — OPEN-CUT DN1200 GRP PIPELINE & NAVIGATION MAP'
      : activeSection === 'wc'
      ? 'WC SECTION — MICRO-TUNNELLING (WC-1 TO WC-27) & NAVIGATION MAP'
      : 'WA SECTION — SHAFT, MANHOLE, MICRO-TUNNELLING, GOLAPBAG SPS & NAVIGATION MAP';

  // WB Node Status counts
  const wbDoneCount = wbData.nodes.filter((n) => n.status === 'complete').length;
  const wbOngoingCount = wbData.nodes.filter((n) => n.status === 'ongoing').length;
  const wbRemCount = wbData.nodes.filter((n) => n.status === 'remaining').length;
  const wbCompletePct =
    wbData.totalLengthM > 0
      ? Math.min(100, (wbData.completedLengthM / wbData.totalLengthM) * 100)
      : 0;
  const wbPrevCompletedM =
    viewMode === 'overall' ? undefined : baseline.wbCompletedLengthM;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
      className="print-sheet-svg w-full h-auto bg-white select-none"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <rect x={0} y={0} width={SHEET_W} height={SHEET_H} fill="#ffffff" />

      {/* Outer A1 Frame */}
      <rect x={12} y={12} width={SHEET_W - 24} height={SHEET_H - 24} fill="none" stroke="#1e3a8a" strokeWidth={1.6} />
      <rect x={16} y={16} width={SHEET_W - 32} height={SHEET_H - 32} fill="none" stroke="#1e3a8a" strokeWidth={0.7} />

      {/* Top Header Strip */}
      <rect x={16} y={16} width={SHEET_W - 32} height={36} fill="#f8fafc" stroke="#1e3a8a" strokeWidth={0.8} />
      <text x={28} y={32} fontSize={11.0} fontWeight="700" fill="#0f172a">
        {sectionLabelFull}
      </text>
      <text x={28} y={45} fontSize={7.3} fontWeight="600" fill="#475569">
        {settings.projectTitle}  |  Sheet: {settings.sheetFormatLabel?.trim() || 'ISO A1 (841 x 594 mm)'}
      </text>

      {/* Active Mode Banner Pill (Orange in Weekly/Monthly comparison, Green in Overall) */}
      <rect
        x={1060}
        y={21}
        width={592}
        height={26}
        rx={3}
        fill={viewMode === 'overall' ? '#f0fdf4' : '#fff7ed'}
        stroke={viewMode === 'overall' ? '#16a34a' : '#ea580c'}
        strokeWidth={1.1}
      />
      <text x={1356} y={33} textAnchor="middle" fontSize={7.8} fontWeight="700" fill="#0f172a">
        {activePeriodLabel}
      </text>
      <text x={1356} y={43} textAnchor="middle" fontSize={6.5} fontWeight="600" fill="#475569">
        Report Date: {formatDateDisplay(settings.reportDate)} | {settings.drawingNo} ({settings.revision})
      </text>

      {/* ===================================================================== */}
      {/* VIEW 1: WA SECTION (SHAFTS + SPS ON LEFT | FULL VERTICAL MAP RIGHT)   */}
      {/* ===================================================================== */}
      {activeSection === 'wa' && (() => {
        const cols = settings.layoutMode === '12col' ? 12 : 10;
        const gridX = 32;
        const gridY = 58;
        const gridW = 1236;
        const colW = gridW / cols;
        const rowH = 232;
        const pumpX =
          settings.layoutMode === '12col' ? gridX + colW * 1.35 : gridX + colW * 7.22;
        const pumpW =
          settings.layoutMode === '12col' ? colW * 4.4 : colW * 2.78;

        return (
          <g>
            {[1, 2, 3].map((r) => (
              <line
                key={r}
                x1={20}
                y1={gridY + r * rowH - 3}
                x2={1310}
                y2={gridY + r * rowH - 3}
                stroke="#e2e8f0"
                strokeWidth={0.7}
                strokeDasharray="4,4"
              />
            ))}

            {renderShaftGrid(waShafts, baseline.shafts, {
              cols,
              gridX,
              gridY,
              gridW,
              rowH,
              connectLastToPump: true,
              pumpStructAbsX: pumpX + 6,
            })}

            {settings.showPumpStation &&
              renderPumpStation(pumpStation, pumpX, gridY + rowH * 3 + 4, pumpW, 224)}

            {/* Right-Side Vertical WA Navigation Map (above full-width bottom bar) */}
            <WaNavigationMapGroup
              shafts={waShafts}
              geoNodes={waGeoNodes}
              spsCoord={spsCoord}
              customPoints={waCustomPoints}
              x={1318}
              y={58}
              w={342}
              h={930}
              settings={settings}
              viewMode={viewMode}
              baselineShafts={baseline.shafts}
              highlightColor={currHighlight}
              selectedShaftId={selectedShaftId}
              onSelectShaft={(id) => onSelectShaft(id, 'shaft')}
              clipIdSuffix="wa-page"
            />

            {/* WA Full-Width Bottom Bar (Summary + Legend + Title Block across full A1 width) */}
            <g transform="translate(16, 996)">
              <rect x={6} y={0} width={924} height={168} fill="#ffffff" stroke="#1e3a8a" strokeWidth={1.1} />
              <rect x={6} y={0} width={924} height={22} fill="#eff6ff" stroke="#1e3a8a" strokeWidth={0.8} />
              <text x={468} y={15} textAnchor="middle" fontSize={10.5} fontWeight="700" fill="#1e3a8a">
                WA SECTION - PROGRESS SUMMARY
              </text>
              <line x1={270} y1={22} x2={270} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />
              <line x1={550} y1={22} x2={550} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />

              <text x={138} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                SHAFT PROGRESS (WA-01 to WA-36 + 24.1)
              </text>
              <text x={20} y={55} fontSize={7.6} fill="#0f172a">TOTAL SHAFT</text>
              <text x={252} y={55} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0f172a">: {waSummary.totalShafts} Nos</text>
              <text x={20} y={71} fontSize={7.6} fill="#15803d" fontWeight="600">COMPLETED SHAFT</text>
              <text x={252} y={71} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#15803d">: {String(waSummary.completedShafts).padStart(2, '0')} Nos</text>
              <text x={20} y={87} fontSize={7.6} fill="#b45309" fontWeight="600">ON-GOING SHAFT</text>
              <text x={252} y={87} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#b45309">: {String(waSummary.ongoingShafts).padStart(2, '0')} Nos</text>
              <text x={20} y={103} fontSize={7.6} fill="#dc2626">REMAINING SHAFT</text>
              <text x={252} y={103} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#dc2626">: {String(waSummary.remainingShafts).padStart(2, '0')} Nos</text>

              {viewMode === 'overall' ? (
                <g>
                  <rect x={16} y={114} width={242} height={46} rx={3} fill="#f0fdf4" stroke="#16a34a" strokeWidth={0.7} />
                  <text x={24} y={127} fontSize={6.8} fontWeight="700" fill="#166534">PUMP STATION (GOLAPBAG SPS):</text>
                  <text x={24} y={139} fontSize={6.5} fill="#0f172a">
                    - Lower: {pumpStation.layers.filter((l) => l.status === 'complete').length}/5 Layers (Cast: {pumpStation.castingCompleteM}m) | Room: {pumpStation.machineRoom.status.toUpperCase()}
                  </text>
                  <text x={24} y={151} fontSize={6.5} fontWeight="700" fill="#0f766e">
                    - Sinking: {pumpStation.sinkingCompletedM}m / {pumpStation.totalHeightM}m [{pumpStation.sinkingStatus.toUpperCase()}
                    {pumpStation.sinkingStatus !== 'complete'
                      ? ` | Rem: ${Math.max(0, Number((pumpStation.totalHeightM - pumpStation.sinkingCompletedM).toFixed(2)))}m`
                      : ''}]
                  </text>
                </g>
              ) : (
                <g>
                  <rect x={16} y={114} width={242} height={46} rx={3} fill="#fff7ed" stroke="#ea580c" strokeWidth={0.8} />
                  <text x={24} y={129} fontSize={7} fontWeight="700" fill="#9a3412">
                    {viewMode === 'weekly' ? 'WEEKLY DELTA (FILE 2 vs FILE 1):' : 'MONTHLY DELTA (FILE 2 vs FILE 1):'}
                  </text>
                  <text x={24} y={142} fontSize={7} fill="#c2410c">- Shaft Layers Added: +{waSummary.delta.addedLayers} layers</text>
                  <text x={24} y={153} fontSize={7} fill="#c2410c">- Shafts Completed: +{waSummary.delta.addedShaftsCompleted} Nos</text>
                </g>
              )}

              <text x={410} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                MANHOLE PROGRESS (CASTING & RING)
              </text>
              <text x={284} y={55} fontSize={7.5} fontWeight="700" fill="#1d4ed8">Lower Casting Complete (100%)</text>
              <text x={536} y={55} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#1d4ed8">: {String(waSummary.castingCompleteCount).padStart(2, '0')} Nos</text>
              <text x={284} y={71} fontSize={7.5} fontWeight="600" fill="#b45309">Lower Casting On-going (&lt;100%)</text>
              <text x={536} y={71} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#b45309">: {String(waSummary.castingOngoingCount).padStart(2, '0')} Nos</text>
              <text x={284} y={87} fontSize={7.5} fill="#dc2626">Lower Casting Remaining</text>
              <text x={536} y={87} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#dc2626">: {String(waSummary.castingRemainingCount).padStart(2, '0')} Nos</text>

              <line x1={284} y1={95} x2={536} y2={95} stroke="#cbd5e1" strokeWidth={0.6} />

              <text x={284} y={109} fontSize={7.5} fontWeight="700" fill="#0284c7">Upper Ring Complete (100%)</text>
              <text x={536} y={109} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#0284c7">: {String(waSummary.precastCompleteCount).padStart(2, '0')} Nos</text>
              <text x={284} y={125} fontSize={7.5} fontWeight="600" fill="#b45309">Upper Ring On-going (&lt;100%)</text>
              <text x={536} y={125} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#b45309">: {String(waSummary.precastOngoingCount).padStart(2, '0')} Nos</text>
              <text x={284} y={141} fontSize={7.5} fill="#dc2626">Upper Ring Remaining</text>
              <text x={536} y={141} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#dc2626">: {String(waSummary.precastRemainingCount).padStart(2, '0')} Nos</text>
              <text x={284} y={157} fontSize={7.1} fontWeight="600" fill="#475569">Total Manholes: {waSummary.totalManholes} Nos</text>

              <text x={740} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                MICRO-TUNNELLING PROGRESS
              </text>
              <text x={564} y={55} fontSize={7.6} fontWeight="700" fill="#0f172a">TOTAL LENGTH</text>
              <text x={914} y={55} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0f172a">: {(waSummary.totalTunnelLengthM / 1000).toFixed(3)} km</text>
              <text x={564} y={71} fontSize={7.6} fontWeight="700" fill="#a21caf">COMPLETED LENGTH</text>
              <text x={914} y={71} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#a21caf">: {(waSummary.completedTunnelLengthM / 1000).toFixed(3)} km ({waSummary.tunnelPctOverall.toFixed(1)}%)</text>
              <text x={564} y={91} fontSize={7.2} fill="#334155">1. DN 900  (Total: {(waSummary.byDia.DN900.totalM / 1000).toFixed(3)} km)</text>
              <text x={914} y={91} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(waSummary.byDia.DN900.completedM / 1000).toFixed(3)} km</text>
              <text x={564} y={107} fontSize={7.2} fill="#334155">2. DN 1100 (Total: {(waSummary.byDia.DN1100.totalM / 1000).toFixed(3)} km)</text>
              <text x={914} y={107} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(waSummary.byDia.DN1100.completedM / 1000).toFixed(3)} km</text>
              <text x={564} y={123} fontSize={7.2} fill="#334155">3. DN 1600 (Total: {(waSummary.byDia.DN1600.totalM / 1000).toFixed(3)} km)</text>
              <text x={914} y={123} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(waSummary.byDia.DN1600.completedM / 1000).toFixed(3)} km</text>

              {viewMode !== 'overall' && (
                <g>
                  <rect x={562} y={133} width={354} height={24} rx={3} fill="#fff7ed" stroke="#ea580c" strokeWidth={0.8} />
                  <text x={739} y={148} textAnchor="middle" fontSize={7.4} fontWeight="700" fill="#c2410c">
                    {viewMode === 'weekly' ? 'WEEKLY TUNNEL ADDED: ' : 'MONTHLY TUNNEL ADDED: '}
                    +{waSummary.delta.addedTunnelM.toFixed(1)} m ({(waSummary.delta.addedTunnelM / 1000).toFixed(3)} km)
                  </text>
                </g>
              )}

              {renderLegendAndTitle(938, 0, 374, 168, 1320, 0, 324, 168, false)}
            </g>
          </g>
        );
      })()}

      {/* ===================================================================== */}
      {/* VIEW 2: WB SECTION PAGE (OPEN CUT + STREET NAVIGATION MAP + 38 NODES) */}
      {/* ===================================================================== */}
      {activeSection === 'wb' && (
        <g>
          <WbNavigationMapGroup
            wb={wbData}
            x={22}
            y={58}
            w={950}
            h={926}
            settings={settings}
            viewMode={viewMode}
            prevCompletedLengthM={wbPrevCompletedM}
            highlightColor={currHighlight}
            selectedNodeId={selectedShaftId}
            onSelectNode={(id) => onSelectWbNode?.(id)}
            compact={false}
            clipIdSuffix="wb-page"
          />

          {/* Right Panel: WB Node Status Register (WB1..WB38 in 2 crisp 19-row columns) */}
          <g transform="translate(984, 58)">
            <rect x={0} y={0} width={676} height={926} fill="#ffffff" stroke="#1e3a8a" strokeWidth={1.1} />
            <rect x={0} y={0} width={676} height={26} fill="#eff6ff" stroke="#1e3a8a" strokeWidth={0.8} />
            <text x={338} y={17} textAnchor="middle" fontSize={10} fontWeight="700" fill="#1e3a8a">
              WB NODE ALIGNMENT SCHEDULE (WB1 TO WB38 — CLICK NODE TO EDIT)
            </text>

            {[0, 1].map((colIdx) => {
              const slice = wbData.nodes.slice(colIdx * 19, (colIdx + 1) * 19);
              const bx = 8 + colIdx * 334;
              const bw = 326;
              return (
                <g key={colIdx} transform={`translate(${bx}, 34)`}>
                  <rect x={0} y={0} width={bw} height={22} fill="#1e3a8a" />
                  <text x={44} y={14.5} textAnchor="middle" fontSize={7.8} fontWeight="700" fill="#ffffff">Node</text>
                  <text x={144} y={14.5} textAnchor="middle" fontSize={7.8} fontWeight="700" fill="#ffffff">Chainage</text>
                  <text x={256} y={14.5} textAnchor="middle" fontSize={7.8} fontWeight="700" fill="#ffffff">Status</text>

                  {slice.map((n, ri) => {
                    const ry = 22 + ri * 45.2;
                    const isSel = selectedShaftId === n.id;
                    const badgeFill =
                      n.status === 'complete' ? '#dcfce7' : n.status === 'ongoing' ? '#fef3c7' : '#fee2e2';
                    const badgeTxt =
                      n.status === 'complete' ? '#15803d' : n.status === 'ongoing' ? '#b45309' : '#dc2626';
                    return (
                      <g
                        key={n.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => onSelectWbNode?.(n.id)}
                      >
                        <rect
                          x={0}
                          y={ry}
                          width={bw}
                          height={45.2}
                          fill={isSel ? '#eff6ff' : ri % 2 === 0 ? '#ffffff' : '#f8fafc'}
                          stroke={isSel ? '#2563eb' : '#cbd5e1'}
                          strokeWidth={isSel ? 1.4 : 0.6}
                        />
                        <text x={44} y={ry + 25.5} textAnchor="middle" fontSize={8.8} fontWeight="700" fill="#0f172a">
                          {n.id}
                        </text>
                        <text x={144} y={ry + 25.5} textAnchor="middle" fontSize={8.4} fontWeight="600" fill="#334155">
                          {n.chainageM.toFixed(1)} m
                        </text>
                        <rect
                          x={208}
                          y={ry + 11.5}
                          width={96}
                          height={22}
                          rx={3}
                          fill={badgeFill}
                          stroke={badgeTxt}
                          strokeWidth={0.65}
                        />
                        <text x={256} y={ry + 25.5} textAnchor="middle" fontSize={7.8} fontWeight="700" fill={badgeTxt}>
                          {n.status.toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>

          {/* WB Page Footer */}
          <g transform="translate(16, 996)">
            <rect x={6} y={0} width={924} height={168} fill="#ffffff" stroke="#1e3a8a" strokeWidth={1.1} />
            <rect x={6} y={0} width={924} height={22} fill="#eff6ff" stroke="#1e3a8a" strokeWidth={0.8} />
            <text x={468} y={15} textAnchor="middle" fontSize={10.5} fontWeight="700" fill="#1e3a8a">
              WB SECTION (OPEN CUT {wbData.pipeDia}) — PROGRESS SUMMARY
            </text>
            <line x1={468} y1={22} x2={468} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />

            <text x={26} y={50} fontSize={9.0} fontWeight="700" fill="#0f172a">TOTAL PIPELINE LENGTH</text>
            <text x={440} y={50} textAnchor="end" fontSize={9.5} fontWeight="700" fill="#0f172a">
              : {(wbData.totalLengthM / 1000).toFixed(3)} km ({wbData.totalLengthM} m)
            </text>
            <text x={26} y={76} fontSize={9.0} fontWeight="700" fill="#15803d">COMPLETED LENGTH (WITH BLUE TIP)</text>
            <text x={440} y={76} textAnchor="end" fontSize={9.5} fontWeight="700" fill="#15803d">
              : {(wbData.completedLengthM / 1000).toFixed(3)} km ({wbData.completedLengthM.toFixed(1)} m)
            </text>
            <text x={26} y={102} fontSize={9.0} fontWeight="700" fill="#dc2626">REMAINING LENGTH</text>
            <text x={440} y={102} textAnchor="end" fontSize={9.5} fontWeight="700" fill="#dc2626">
              : {(Math.max(0, wbData.totalLengthM - wbData.completedLengthM) / 1000).toFixed(3)} km ({Math.max(0, wbData.totalLengthM - wbData.completedLengthM).toFixed(1)} m)
            </text>
            <text x={26} y={128} fontSize={8.5} fontWeight="700" fill="#2563eb">COMPLETION PERCENTAGE</text>
            <text x={440} y={128} textAnchor="end" fontSize={9.0} fontWeight="700" fill="#2563eb">
              : {wbData.totalLengthM > 0 ? ((wbData.completedLengthM / wbData.totalLengthM) * 100).toFixed(1) : '0.0'} %
            </text>

            <text x={490} y={50} fontSize={9.0} fontWeight="700" fill="#0f172a">TOTAL NODES</text>
            <text x={904} y={50} textAnchor="end" fontSize={9.5} fontWeight="700" fill="#0f172a">: {wbData.nodes.length} Nos (WB1–WB38)</text>
            <text x={490} y={76} fontSize={9.0} fontWeight="700" fill="#15803d">COMPLETE NODES</text>
            <text x={904} y={76} textAnchor="end" fontSize={9.5} fontWeight="700" fill="#15803d">: {wbDoneCount} Nos</text>
            <text x={490} y={102} fontSize={9.0} fontWeight="700" fill="#b45309">ON-GOING NODES</text>
            <text x={904} y={102} textAnchor="end" fontSize={9.5} fontWeight="700" fill="#b45309">: {wbOngoingCount} Nos</text>
            <text x={490} y={128} fontSize={9.0} fontWeight="700" fill="#dc2626">REMAINING NODES</text>
            <text x={904} y={128} textAnchor="end" fontSize={9.5} fontWeight="700" fill="#dc2626">: {wbRemCount} Nos</text>

            {renderLegendAndTitle(938, 0, 374, 168, 1320, 0, 324, 168, true)}
          </g>
        </g>
      )}

      {/* ===================================================================== */}
      {/* VIEW 3: WC SECTION (27 SHAFTS ON LEFT | FULL VERTICAL MAP ON RIGHT)   */}
      {/* ===================================================================== */}
      {activeSection === 'wc' && (() => {
        const cols = 9;
        const gridX = 32;
        const gridY = 64;
        const gridW = 1236;
        const rowH = 304;
        const wcBaseMap = baseline.wcShafts || {};

        return (
          <g>
            {[1, 2].map((r) => (
              <line
                key={r}
                x1={20}
                y1={gridY + r * rowH - 5}
                x2={1310}
                y2={gridY + r * rowH - 5}
                stroke="#e2e8f0"
                strokeWidth={0.7}
                strokeDasharray="4,4"
              />
            ))}

            {renderShaftGrid(wcData.shafts, wcBaseMap, {
              cols,
              gridX,
              gridY,
              gridW,
              rowH,
              connectLastToPump: false,
            })}

            {/* Right-Side Vertical WC Navigation Map (above full-width bottom bar) */}
            <WcNavigationMapGroup
              wc={wcData}
              x={1318}
              y={58}
              w={342}
              h={930}
              settings={settings}
              viewMode={viewMode}
              baselineShafts={wcBaseMap}
              highlightColor={currHighlight}
              selectedShaftId={selectedShaftId}
              onSelectShaft={(id) => onSelectShaft(id, 'shaft')}
              compact={false}
              clipIdSuffix="wc-page"
            />

            {/* WC Full-Width Bottom Bar (Summary + Legend + Title Block across full A1 width) */}
            <g transform="translate(16, 996)">
              <rect x={6} y={0} width={924} height={168} fill="#ffffff" stroke="#1e3a8a" strokeWidth={1.1} />
              <rect x={6} y={0} width={924} height={22} fill="#eff6ff" stroke="#1e3a8a" strokeWidth={0.8} />
              <text x={468} y={15} textAnchor="middle" fontSize={10.5} fontWeight="700" fill="#1e3a8a">
                WC SECTION (MICRO-TUNNELLING WC-1 TO WC-27) — PROGRESS SUMMARY
              </text>
              <line x1={300} y1={22} x2={300} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />
              <line x1={610} y1={22} x2={610} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />

              <text x={152} y={40} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                WC SHAFT PROGRESS (27 Nos)
              </text>
              <text x={22} y={62} fontSize={8.0} fill="#0f172a">TOTAL SHAFTS</text>
              <text x={280} y={62} textAnchor="end" fontSize={8.2} fontWeight="700" fill="#0f172a">: {wcSummary.totalShafts} Nos</text>
              <text x={22} y={82} fontSize={8.0} fill="#15803d" fontWeight="600">COMPLETED SHAFTS</text>
              <text x={280} y={82} textAnchor="end" fontSize={8.2} fontWeight="700" fill="#15803d">: {wcSummary.completedShafts} Nos</text>
              <text x={22} y={102} fontSize={8.0} fill="#b45309" fontWeight="600">ON-GOING SHAFTS</text>
              <text x={280} y={102} textAnchor="end" fontSize={8.2} fontWeight="700" fill="#b45309">: {wcSummary.ongoingShafts} Nos</text>
              <text x={22} y={122} fontSize={8.0} fill="#dc2626">REMAINING SHAFTS</text>
              <text x={280} y={122} textAnchor="end" fontSize={8.2} fontWeight="700" fill="#dc2626">: {wcSummary.remainingShafts} Nos</text>

              {viewMode !== 'overall' && (
                <g>
                  <rect x={16} y={130} width={270} height={30} rx={3} fill="#fff7ed" stroke="#ea580c" strokeWidth={0.8} />
                  <text x={151} y={144} textAnchor="middle" fontSize={7.0} fontWeight="700" fill="#9a3412">
                    {viewMode === 'weekly' ? 'WEEKLY WC DELTA: ' : 'MONTHLY WC DELTA: '}
                    +{wcSummary.delta.addedLayers}L | +{wcSummary.delta.addedShaftsCompleted} Shafts
                  </text>
                  <text x={151} y={155} textAnchor="middle" fontSize={6.8} fill="#c2410c">
                    Tunnel Added: +{wcSummary.delta.addedTunnelM.toFixed(1)} m
                  </text>
                </g>
              )}

              <text x={455} y={40} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                WC MANHOLE (CASTING & RING)
              </text>
              <text x={316} y={58} fontSize={7.5} fontWeight="700" fill="#1d4ed8">Lower Casting Complete (100%)</text>
              <text x={594} y={58} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#1d4ed8">: {String(wcSummary.castingCompleteCount).padStart(2, '0')} Nos</text>
              <text x={316} y={74} fontSize={7.5} fontWeight="600" fill="#b45309">Lower Casting On-going (&lt;100%)</text>
              <text x={594} y={74} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#b45309">: {String(wcSummary.castingOngoingCount).padStart(2, '0')} Nos</text>
              <text x={316} y={90} fontSize={7.5} fill="#dc2626">Lower Casting Remaining</text>
              <text x={594} y={90} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#dc2626">: {String(wcSummary.castingRemainingCount).padStart(2, '0')} Nos</text>

              <line x1={316} y1={98} x2={594} y2={98} stroke="#cbd5e1" strokeWidth={0.6} />

              <text x={316} y={112} fontSize={7.5} fontWeight="700" fill="#0284c7">Upper Ring Complete (100%)</text>
              <text x={594} y={112} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#0284c7">: {String(wcSummary.precastCompleteCount).padStart(2, '0')} Nos</text>
              <text x={316} y={128} fontSize={7.5} fontWeight="600" fill="#b45309">Upper Ring On-going (&lt;100%)</text>
              <text x={594} y={128} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#b45309">: {String(wcSummary.precastOngoingCount).padStart(2, '0')} Nos</text>
              <text x={316} y={144} fontSize={7.5} fill="#dc2626">Upper Ring Remaining</text>
              <text x={594} y={144} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#dc2626">: {String(wcSummary.precastRemainingCount).padStart(2, '0')} Nos</text>
              <text x={316} y={159} fontSize={7.1} fontWeight="600" fill="#475569">Total Manholes: {wcSummary.totalManholes} Nos</text>

              <text x={765} y={40} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                WC MICRO-TUNNELLING
              </text>
              <text x={626} y={62} fontSize={7.8} fontWeight="700" fill="#0f172a">TOTAL LENGTH</text>
              <text x={912} y={62} textAnchor="end" fontSize={8.0} fontWeight="700" fill="#0f172a">: {(wcSummary.totalTunnelLengthM / 1000).toFixed(3)} km</text>
              <text x={626} y={82} fontSize={7.8} fontWeight="700" fill="#a21caf">COMPLETED</text>
              <text x={912} y={82} textAnchor="end" fontSize={8.0} fontWeight="700" fill="#a21caf">: {(wcSummary.completedTunnelLengthM / 1000).toFixed(3)} km ({wcSummary.tunnelPctOverall.toFixed(1)}%)</text>
              <text x={626} y={104} fontSize={7.3} fill="#334155">1. DN 1800 (Total: {(wcSummary.byDia.DN1800.totalM / 1000).toFixed(3)} km)</text>
              <text x={912} y={104} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(wcSummary.byDia.DN1800.completedM / 1000).toFixed(3)} km</text>
              <text x={626} y={121} fontSize={7.3} fill="#334155">2. DN 2400 (Total: {(wcSummary.byDia.DN2400.totalM / 1000).toFixed(3)} km)</text>
              <text x={912} y={121} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(wcSummary.byDia.DN2400.completedM / 1000).toFixed(3)} km</text>
              <text x={626} y={138} fontSize={7.3} fill="#334155">3. DN 2600 (Total: {(wcSummary.byDia.DN2600.totalM / 1000).toFixed(3)} km)</text>
              <text x={912} y={138} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(wcSummary.byDia.DN2600.completedM / 1000).toFixed(3)} km</text>

              {renderLegendAndTitle(938, 0, 374, 168, 1320, 0, 324, 168, true)}
            </g>
          </g>
        );
      })()}

      {/* ===================================================================== */}
      {/* VIEW 3B: PAGE 5 WC UPDATE STATUS SHEET (WA-STYLE 27 SHAFTS 9x3 GRID)  */}
      {/* ===================================================================== */}
      {activeSection === 'wc-status' && (() => {
        const cols = 9;
        const gridX = 46;
        const gridY = 82;
        const gridW = 1584;
        const rowH = 292;
        const wcBaseMap = baseline.wcShafts || {};

        return (
          <g>
            {[1, 2].map((r) => (
              <line
                key={r}
                x1={20}
                y1={gridY + r * rowH - 6}
                x2={SHEET_W - 20}
                y2={gridY + r * rowH - 6}
                stroke="#e2e8f0"
                strokeWidth={0.8}
                strokeDasharray="4,4"
              />
            ))}

            {renderShaftGrid(wcData.shafts, wcBaseMap, {
              cols,
              gridX,
              gridY,
              gridW,
              rowH,
              connectLastToPump: false,
            })}

            {/* WC Bottom Footer (same WA-style 3-column summary + Legend + Title Block) */}
            <g transform="translate(16, 996)">
              <rect x={6} y={0} width={924} height={168} fill="#ffffff" stroke="#1e3a8a" strokeWidth={1.1} />
              <rect x={6} y={0} width={924} height={22} fill="#eff6ff" stroke="#1e3a8a" strokeWidth={0.8} />
              <text x={468} y={15} textAnchor="middle" fontSize={10.5} fontWeight="700" fill="#1e3a8a">
                WC SECTION (WC-1 TO WC-27) - PROGRESS SUMMARY
              </text>
              <line x1={270} y1={22} x2={270} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />
              <line x1={550} y1={22} x2={550} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />

              <text x={138} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                SHAFT PROGRESS (WC-1 to WC-27)
              </text>
              <text x={20} y={55} fontSize={7.6} fill="#0f172a">TOTAL SHAFT</text>
              <text x={252} y={55} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0f172a">: {wcSummary.totalShafts} Nos</text>
              <text x={20} y={71} fontSize={7.6} fill="#15803d" fontWeight="600">COMPLETED SHAFT</text>
              <text x={252} y={71} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#15803d">: {String(wcSummary.completedShafts).padStart(2, '0')} Nos</text>
              <text x={20} y={87} fontSize={7.6} fill="#b45309" fontWeight="600">ON-GOING SHAFT</text>
              <text x={252} y={87} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#b45309">: {String(wcSummary.ongoingShafts).padStart(2, '0')} Nos</text>
              <text x={20} y={103} fontSize={7.6} fill="#dc2626">REMAINING SHAFT</text>
              <text x={252} y={103} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#dc2626">: {String(wcSummary.remainingShafts).padStart(2, '0')} Nos</text>

              {viewMode === 'overall' ? (
                <g>
                  <rect x={16} y={114} width={242} height={46} rx={3} fill="#faf5ff" stroke="#9333ea" strokeWidth={0.7} />
                  <text x={24} y={128} fontSize={6.8} fontWeight="700" fill="#6b21a8">WC CORRIDOR ALIGNMENT:</text>
                  <text x={24} y={140} fontSize={6.4} fill="#0f172a">
                    - Route: Doyagonj Chowrasta (WC-1) to Pagla STP (WC-27)
                  </text>
                  <text x={24} y={152} fontSize={6.4} fontWeight="700" fill={wcSummary.completedTunnelLengthM > 0 || wcSummary.completedShafts > 0 ? '#15803d' : '#b91c1c'}>
                    - Status: {wcSummary.completedTunnelLengthM > 0 || wcSummary.completedShafts > 0 ? 'Active Construction' : 'Not Started (Blank)'}
                  </text>
                </g>
              ) : (
                <g>
                  <rect x={16} y={114} width={242} height={46} rx={3} fill="#fff7ed" stroke="#ea580c" strokeWidth={0.8} />
                  <text x={24} y={129} fontSize={7} fontWeight="700" fill="#9a3412">
                    {viewMode === 'weekly' ? 'WEEKLY WC DELTA:' : 'MONTHLY WC DELTA:'}
                  </text>
                  <text x={24} y={142} fontSize={7} fill="#c2410c">- Shaft Layers Added: +{wcSummary.delta.addedLayers} layers</text>
                  <text x={24} y={153} fontSize={7} fill="#c2410c">- Shafts Completed: +{wcSummary.delta.addedShaftsCompleted} Nos</text>
                </g>
              )}

              <text x={410} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                MANHOLE PROGRESS (CASTING & RING)
              </text>
              <text x={284} y={55} fontSize={7.5} fontWeight="700" fill="#1d4ed8">Lower Casting Complete (100%)</text>
              <text x={536} y={55} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#1d4ed8">: {String(wcSummary.castingCompleteCount).padStart(2, '0')} Nos</text>
              <text x={284} y={71} fontSize={7.5} fontWeight="600" fill="#b45309">Lower Casting On-going (&lt;100%)</text>
              <text x={536} y={71} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#b45309">: {String(wcSummary.castingOngoingCount).padStart(2, '0')} Nos</text>
              <text x={284} y={87} fontSize={7.5} fill="#dc2626">Lower Casting Remaining</text>
              <text x={536} y={87} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#dc2626">: {String(wcSummary.castingRemainingCount).padStart(2, '0')} Nos</text>

              <line x1={284} y1={95} x2={536} y2={95} stroke="#cbd5e1" strokeWidth={0.6} />

              <text x={284} y={109} fontSize={7.5} fontWeight="700" fill="#0284c7">Upper Ring Complete (100%)</text>
              <text x={536} y={109} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#0284c7">: {String(wcSummary.precastCompleteCount).padStart(2, '0')} Nos</text>
              <text x={284} y={125} fontSize={7.5} fontWeight="600" fill="#b45309">Upper Ring On-going (&lt;100%)</text>
              <text x={536} y={125} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#b45309">: {String(wcSummary.precastOngoingCount).padStart(2, '0')} Nos</text>
              <text x={284} y={141} fontSize={7.5} fill="#dc2626">Upper Ring Remaining</text>
              <text x={536} y={141} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#dc2626">: {String(wcSummary.precastRemainingCount).padStart(2, '0')} Nos</text>
              <text x={284} y={157} fontSize={7.1} fontWeight="600" fill="#475569">Total Manholes: {wcSummary.totalManholes} Nos</text>

              <text x={740} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                MICRO-TUNNELLING PROGRESS
              </text>
              <text x={564} y={55} fontSize={7.6} fontWeight="700" fill="#0f172a">TOTAL LENGTH</text>
              <text x={914} y={55} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0f172a">: {(wcSummary.totalTunnelLengthM / 1000).toFixed(3)} km</text>
              <text x={564} y={71} fontSize={7.6} fontWeight="700" fill="#a21caf">COMPLETED LENGTH</text>
              <text x={914} y={71} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#a21caf">: {(wcSummary.completedTunnelLengthM / 1000).toFixed(3)} km ({wcSummary.tunnelPctOverall.toFixed(1)}%)</text>
              <text x={564} y={91} fontSize={7.2} fill="#334155">1. DN 1800 (Total: {(wcSummary.byDia.DN1800.totalM / 1000).toFixed(3)} km)</text>
              <text x={914} y={91} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(wcSummary.byDia.DN1800.completedM / 1000).toFixed(3)} km</text>
              <text x={564} y={107} fontSize={7.2} fill="#334155">2. DN 2400 (Total: {(wcSummary.byDia.DN2400.totalM / 1000).toFixed(3)} km)</text>
              <text x={914} y={107} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(wcSummary.byDia.DN2400.completedM / 1000).toFixed(3)} km</text>
              <text x={564} y={123} fontSize={7.2} fill="#334155">3. DN 2600 (Total: {(wcSummary.byDia.DN2600.totalM / 1000).toFixed(3)} km)</text>
              <text x={914} y={123} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">Done: {(wcSummary.byDia.DN2600.completedM / 1000).toFixed(3)} km</text>

              {viewMode !== 'overall' && (
                <g>
                  <rect x={562} y={133} width={354} height={24} rx={3} fill="#fff7ed" stroke="#ea580c" strokeWidth={0.8} />
                  <text x={739} y={148} textAnchor="middle" fontSize={7.4} fontWeight="700" fill="#c2410c">
                    {viewMode === 'weekly' ? 'WEEKLY WC TUNNEL ADDED: ' : 'MONTHLY WC TUNNEL ADDED: '}
                    +{wcSummary.delta.addedTunnelM.toFixed(1)} m ({(wcSummary.delta.addedTunnelM / 1000).toFixed(3)} km)
                  </text>
                </g>
              )}

              {renderLegendAndTitle(938, 0, 374, 168, 1320, 0, 324, 168, false)}
            </g>
          </g>
        );
      })()}

      {/* ===================================================================== */}
      {/* VIEW 3C: CUSTOM WA/WC SELECTED SHAFTS & MICRO-TUNNELLING A1 SHEET      */}
      {/* ===================================================================== */}
      {activeSection === 'custom' && (() => {
        const n = customShafts.length;
        const cols =
          n === 0
            ? 1
            : n <= 8
            ? n
            : n <= 16
            ? Math.ceil(n / 2)
            : n <= 27
            ? Math.ceil(n / 3)
            : 10;
        const rows = n === 0 ? 1 : Math.ceil(n / cols);
        const colW = 158.4;
        const rowH = 232;
        const lastIdx = Math.max(0, n - 1);
        const lastCol = lastIdx % cols;
        const lastRow = Math.floor(lastIdx / cols);
        const lastShaft = n > 0 ? customShafts[lastIdx] : null;
        const needsRightTunnelRoom =
          customCfg.showTunneling && !customHasPump && Boolean(lastShaft && lastShaft.tunnelLengthM > 0);
        const pumpNeedRight = customHasPump && lastCol === cols - 1;
        const baseLeftPad = 38;
        const rightContentCols = pumpNeedRight
          ? cols + 2.3
          : customHasPump
          ? Math.max(cols, lastCol + 1 + 2.3)
          : cols;
        const baseRightPad = customHasPump ? 40 : needsRightTunnelRoom ? 140 : 26;
        const natW = baseLeftPad + rightContentCols * colW + baseRightPad;
        const natH = rows * rowH + 20;
        const uScale = n === 0 ? 1 : Math.min(1.85, 1618 / natW, 908 / natH);
        const offsetX = 24 + (1634 - natW * uScale) / 2;
        const offsetY = 60 + (922 - natH * uScale) / 2;

        const pumpRelX = baseLeftPad + (lastCol + 1) * colW + 24;
        const pumpRelY = 10 + lastRow * rowH + 4;
        const diaKeys = (
          customCfg.section === 'wc'
            ? ['DN1800', 'DN2400', 'DN2600']
            : ['DN900', 'DN1100', 'DN1600']
        ) as Array<keyof typeof customSummary.byDia>;

        return (
          <g>
            {n === 0 ? (
              <g>
                <rect
                  x={340}
                  y={420}
                  width={1000}
                  height={160}
                  rx={10}
                  fill="#f8fafc"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  strokeDasharray="6,4"
                />
                <text x={840} y={488} textAnchor="middle" fontSize={18} fontWeight="700" fill="#1e3a8a">
                  NO SHAFTS SELECTED IN CUSTOM VIEW
                </text>
                <text x={840} y={522} textAnchor="middle" fontSize={13} fontWeight="600" fill="#475569">
                  Use the Custom Range or Multi-Select panel on the right to pick WA or WC shafts (e.g. WA-17 to WA-24).
                </text>
              </g>
            ) : (
              <g transform={`translate(${offsetX}, ${offsetY}) scale(${uScale})`}>
                {Array.from({ length: Math.max(0, rows - 1) }).map((_, ri) => (
                  <line
                    key={ri}
                    x1={-12}
                    y1={10 + (ri + 1) * rowH - 3}
                    x2={natW + 12}
                    y2={10 + (ri + 1) * rowH - 3}
                    stroke="#e2e8f0"
                    strokeWidth={0.8}
                    strokeDasharray="4,4"
                  />
                ))}

                {renderShaftGrid(customShafts, customBaselineMap, {
                  cols,
                  gridX: baseLeftPad,
                  gridY: 10,
                  gridW: cols * colW,
                  rowH,
                  connectLastToPump: customHasPump,
                  pumpStructAbsX: customHasPump ? pumpRelX + 6 : undefined,
                  showTunneling: customCfg.showTunneling,
                  showLastOutgoingTunnel: customCfg.showTunneling && !customHasPump,
                })}

                {customHasPump &&
                  renderPumpStation(pumpStation, pumpRelX, pumpRelY, 340, 224)}
              </g>
            )}

            {/* Custom Page Footer (Summary + Legend + Title Block) */}
            <g transform="translate(16, 996)">
              <rect x={6} y={0} width={924} height={168} fill="#ffffff" stroke="#1e3a8a" strokeWidth={1.1} />
              <rect x={6} y={0} width={924} height={22} fill="#eff6ff" stroke="#1e3a8a" strokeWidth={0.8} />
              <text x={468} y={15} textAnchor="middle" fontSize={10.5} fontWeight="700" fill="#1e3a8a">
                CUSTOM {customCfg.section.toUpperCase()} SELECTION ({customRangeText}) - PROGRESS SUMMARY
              </text>
              <line x1={270} y1={22} x2={270} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />
              <line x1={550} y1={22} x2={550} y2={168} stroke="#1e3a8a" strokeWidth={0.7} />

              <text x={138} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                SELECTED SHAFT PROGRESS ({customSummary.totalShafts} Nos)
              </text>
              <text x={20} y={55} fontSize={7.6} fill="#0f172a">SELECTED SHAFTS</text>
              <text x={252} y={55} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0f172a">: {customSummary.totalShafts} Nos</text>
              <text x={20} y={71} fontSize={7.6} fill="#15803d" fontWeight="600">COMPLETED SHAFT</text>
              <text x={252} y={71} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#15803d">: {String(customSummary.completedShafts).padStart(2, '0')} Nos</text>
              <text x={20} y={87} fontSize={7.6} fill="#b45309" fontWeight="600">ON-GOING SHAFT</text>
              <text x={252} y={87} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#b45309">: {String(customSummary.ongoingShafts).padStart(2, '0')} Nos</text>
              <text x={20} y={103} fontSize={7.6} fill="#dc2626">REMAINING SHAFT</text>
              <text x={252} y={103} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#dc2626">: {String(customSummary.remainingShafts).padStart(2, '0')} Nos</text>

              {viewMode === 'overall' ? (
                <g>
                  <rect x={16} y={114} width={242} height={46} rx={3} fill="#f8fafc" stroke="#1e3a8a" strokeWidth={0.7} />
                  <text x={24} y={128} fontSize={6.8} fontWeight="700" fill="#1e3a8a">CUSTOM SELECTION SCOPE:</text>
                  <text x={24} y={140} fontSize={6.4} fill="#0f172a">
                    - Section: {customCfg.section.toUpperCase()} ({customShafts.map((s) => s.id.replace(/^(WA|WC)-/, '')).slice(0, 12).join(', ')}{customShafts.length > 12 ? '...' : ''})
                  </text>
                  <text x={24} y={152} fontSize={6.4} fontWeight="700" fill="#0f766e">
                    - Tunneling: {customCfg.showTunneling ? 'Included' : 'Hidden'} | SPS: {customHasPump ? 'Included' : 'Hidden'}
                  </text>
                </g>
              ) : (
                <g>
                  <rect x={16} y={114} width={242} height={46} rx={3} fill="#fff7ed" stroke="#ea580c" strokeWidth={0.8} />
                  <text x={24} y={129} fontSize={7} fontWeight="700" fill="#9a3412">
                    {viewMode === 'weekly' ? 'WEEKLY CUSTOM DELTA:' : 'MONTHLY CUSTOM DELTA:'}
                  </text>
                  <text x={24} y={142} fontSize={7} fill="#c2410c">- Shaft Layers Added: +{customSummary.delta.addedLayers} layers</text>
                  <text x={24} y={153} fontSize={7} fill="#c2410c">- Shafts Completed: +{customSummary.delta.addedShaftsCompleted} Nos</text>
                </g>
              )}

              <text x={410} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                MANHOLE PROGRESS (CASTING & RING)
              </text>
              <text x={284} y={55} fontSize={7.5} fontWeight="700" fill="#1d4ed8">Lower Casting Complete (100%)</text>
              <text x={536} y={55} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#1d4ed8">: {String(customSummary.castingCompleteCount).padStart(2, '0')} Nos</text>
              <text x={284} y={71} fontSize={7.5} fontWeight="600" fill="#b45309">Lower Casting On-going (&lt;100%)</text>
              <text x={536} y={71} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#b45309">: {String(customSummary.castingOngoingCount).padStart(2, '0')} Nos</text>
              <text x={284} y={87} fontSize={7.5} fill="#dc2626">Lower Casting Remaining</text>
              <text x={536} y={87} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#dc2626">: {String(customSummary.castingRemainingCount).padStart(2, '0')} Nos</text>

              <line x1={284} y1={95} x2={536} y2={95} stroke="#cbd5e1" strokeWidth={0.6} />

              <text x={284} y={109} fontSize={7.5} fontWeight="700" fill="#0284c7">Upper Ring Complete (100%)</text>
              <text x={536} y={109} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#0284c7">: {String(customSummary.precastCompleteCount).padStart(2, '0')} Nos</text>
              <text x={284} y={125} fontSize={7.5} fontWeight="600" fill="#b45309">Upper Ring On-going (&lt;100%)</text>
              <text x={536} y={125} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#b45309">: {String(customSummary.precastOngoingCount).padStart(2, '0')} Nos</text>
              <text x={284} y={141} fontSize={7.5} fill="#dc2626">Upper Ring Remaining</text>
              <text x={536} y={141} textAnchor="end" fontSize={7.7} fontWeight="700" fill="#dc2626">: {String(customSummary.precastRemainingCount).padStart(2, '0')} Nos</text>
              <text x={284} y={157} fontSize={7.1} fontWeight="600" fill="#475569">Total Manholes: {customSummary.totalManholes} Nos</text>

              <text x={740} y={37} textAnchor="middle" fontSize={8.2} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                MICRO-TUNNELLING (SELECTED SHAFTS)
              </text>
              <text x={564} y={55} fontSize={7.6} fontWeight="700" fill="#0f172a">SELECTED TUNNEL LENGTH</text>
              <text x={914} y={55} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#0f172a">: {(customSummary.totalTunnelLengthM / 1000).toFixed(3)} km ({customSummary.totalTunnelLengthM.toFixed(0)} m)</text>
              <text x={564} y={71} fontSize={7.6} fontWeight="700" fill="#a21caf">COMPLETED LENGTH</text>
              <text x={914} y={71} textAnchor="end" fontSize={7.8} fontWeight="700" fill="#a21caf">: {(customSummary.completedTunnelLengthM / 1000).toFixed(3)} km ({customSummary.tunnelPctOverall.toFixed(1)}%)</text>
              {diaKeys.map((dk, di) => {
                const rowInfo = customSummary.byDia[dk] || { totalM: 0, completedM: 0 };
                return (
                  <g key={dk}>
                    <text x={564} y={91 + di * 16} fontSize={7.2} fill="#334155">
                      {di + 1}. {String(dk).replace('DN', 'DN ')} (Sel: {rowInfo.totalM.toFixed(0)} m)
                    </text>
                    <text x={914} y={91 + di * 16} textAnchor="end" fontSize={7.4} fontWeight="700" fill="#0f172a">
                      Done: {rowInfo.completedM.toFixed(1)} m
                    </text>
                  </g>
                );
              })}

              {viewMode !== 'overall' && (
                <g>
                  <rect x={562} y={133} width={354} height={24} rx={3} fill="#fff7ed" stroke="#ea580c" strokeWidth={0.8} />
                  <text x={739} y={148} textAnchor="middle" fontSize={7.4} fontWeight="700" fill="#c2410c">
                    {viewMode === 'weekly' ? 'WEEKLY CUSTOM TUNNEL ADDED: ' : 'MONTHLY CUSTOM TUNNEL ADDED: '}
                    +{customSummary.delta.addedTunnelM.toFixed(1)} m ({(customSummary.delta.addedTunnelM / 1000).toFixed(3)} km)
                  </text>
                </g>
              )}

              {renderLegendAndTitle(938, 0, 374, 168, 1320, 0, 324, 168, false)}
            </g>
          </g>
        );
      })()}

      {/* ===================================================================== */}
      {/* VIEW 4: COMBINED ONE-PAGE A1 SHEET (WA TOP + WB RIGHT + WC BELOW WB) */}
      {/* ===================================================================== */}
      {activeSection === 'combined' && (() => {
        const cols = 11;
        const gridX = 46;
        const gridY = 55;
        const gridW = 1584;
        const rowH = 216; // Row 2 divider ends at 55 + 3*216 - 3 = 700; Row 3 ends at 919!
        // WA-36 right wall ends at x=594.4. Shift SPS right to x=678 so WA-36 -> Pump Station tunnel bar
        // gets 89.6px of full un-compressed spacing while staying cleanly left of WB MAP (x=922):
        const pumpX = 678;
        const pumpW = 236; // Ends at 914 (8px clean gap before WB MAP at x=922)

        return (
          <g>
            {[1, 2, 3].map((r) => (
              <line
                key={r}
                x1={20}
                y1={gridY + r * rowH - 3}
                x2={SHEET_W - 20}
                y2={gridY + r * rowH - 3}
                stroke="#e2e8f0"
                strokeWidth={0.7}
                strokeDasharray="4,4"
              />
            ))}

            {/* 1. WA SECTION TAKES MAJOR UPPER SPACE */}
            {renderShaftGrid(waShafts, baseline.shafts, {
              cols,
              gridX,
              gridY,
              gridW,
              rowH,
              connectLastToPump: true,
              pumpStructAbsX: pumpX + 6,
            })}

            {settings.showPumpStation &&
              renderPumpStation(pumpStation, pumpX, gridY + rowH * 3 + 2, pumpW, 212)}

            {/* 2. WB & WC MAPS SIDE BY SIDE (PASHAPASHI) AT EXACT POSITION (y=704..1168, h=464!) */}
            <WbNavigationMapGroup
              wb={wbData}
              x={922}
              y={704}
              w={368}
              h={464}
              settings={settings}
              viewMode={viewMode}
              prevCompletedLengthM={wbPrevCompletedM}
              highlightColor={currHighlight}
              selectedNodeId={selectedShaftId}
              onSelectNode={(id) => onSelectWbNode?.(id)}
              compact={true}
              clipIdSuffix="combined-wb"
            />

            <WcNavigationMapGroup
              wc={wcData}
              x={1296}
              y={704}
              w={368}
              h={464}
              settings={settings}
              selectedShaftId={selectedShaftId}
              onSelectShaft={(id) => onSelectShaft(id, 'shaft')}
              compact={true}
              clipIdSuffix="combined-wc"
            />

            {/* 3. LARGER-TEXT FOOTER BOXES (x=22..912, y=936..1168) */}
            <g transform="translate(22, 936)">
              {/* Combined Summary (WA + Pump + WB + WC) */}
              <rect x={0} y={0} width={442} height={232} fill="#ffffff" stroke="#1e3a8a" strokeWidth={1.1} />
              <rect x={0} y={0} width={442} height={22} fill="#eff6ff" stroke="#1e3a8a" strokeWidth={0.8} />
              <text x={221} y={14.5} textAnchor="middle" fontSize={9.4} fontWeight="700" fill="#1e3a8a">
                COMBINED PROGRESS SUMMARY (WA, WB, WC & SPS)
              </text>
              <line x1={222} y1={22} x2={222} y2={232} stroke="#1e3a8a" strokeWidth={0.7} />

              {/* Left Col: WA Shafts + Manholes + Pump Station */}
              <text x={111} y={35} textAnchor="middle" fontSize={7.8} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                WA SHAFT, MANHOLE & SPS
              </text>
              <text x={7} y={50} fontSize={7.1} fontWeight="600" fill="#0f172a">WA Shafts ({waSummary.totalShafts})</text>
              <text x={216} y={50} textAnchor="end" fontSize={7.0} fontWeight="700" fill="#15803d">
                Done:{waSummary.completedShafts} | Ong:{waSummary.ongoingShafts} | Rem:{waSummary.remainingShafts}
              </text>
              <text x={7} y={64} fontSize={7.1} fontWeight="600" fill="#0f172a">MH Cast ({waSummary.totalManholes})</text>
              <text x={216} y={64} textAnchor="end" fontSize={7.0} fontWeight="700" fill="#1d4ed8">
                Cast:{waSummary.castingCompleteCount} | Ong:{waSummary.castingOngoingCount} | Rem:{waSummary.castingRemainingCount}
              </text>
              <text x={7} y={78} fontSize={7.1} fontWeight="600" fill="#0f172a">MH Ring ({waSummary.totalManholes})</text>
              <text x={216} y={78} textAnchor="end" fontSize={7.0} fontWeight="700" fill="#0284c7">
                Ring:{waSummary.precastCompleteCount} | Ong:{waSummary.precastOngoingCount} | Rem:{waSummary.precastRemainingCount}
              </text>
              <text x={7} y={94} fontSize={7.1} fontWeight="600" fill="#0f172a">WA Tunnel</text>
              <text x={216} y={94} textAnchor="end" fontSize={7.0} fontWeight="700" fill="#a21caf">
                {(waSummary.completedTunnelLengthM / 1000).toFixed(3)} / {(waSummary.totalTunnelLengthM / 1000).toFixed(3)} km ({waSummary.tunnelPctOverall.toFixed(1)}%)
              </text>
              <text x={8} y={108} fontSize={6.4} fill="#334155">
                DN900: {(waSummary.byDia.DN900.completedM / 1000).toFixed(2)}/{(waSummary.byDia.DN900.totalM / 1000).toFixed(2)}km | DN1100: {(waSummary.byDia.DN1100.completedM / 1000).toFixed(2)}/{(waSummary.byDia.DN1100.totalM / 1000).toFixed(2)}km
              </text>
              <text x={8} y={120} fontSize={6.4} fill="#334155">
                DN1600: {(waSummary.byDia.DN1600.completedM / 1000).toFixed(2)}/{(waSummary.byDia.DN1600.totalM / 1000).toFixed(2)}km
              </text>

              <rect x={6} y={129} width={210} height={96} rx={2.5} fill="#f0fdf4" stroke="#16a34a" strokeWidth={0.65} />
              <text x={12} y={143} fontSize={7.2} fontWeight="700" fill="#166534">GOLAPBAG PUMP STATION (SPS):</text>
              <text x={12} y={159} fontSize={6.7} fill="#0f172a">
                - Lower: {pumpStation.layers.filter((l) => l.status === 'complete').length}/5 Layers (Cast: {pumpStation.castingCompleteM}m)
              </text>
              <text x={12} y={175} fontSize={6.5} fontWeight="700" fill="#0f766e">
                - Sinking: {pumpStation.sinkingCompletedM}m / {pumpStation.totalHeightM}m [{pumpStation.sinkingStatus.toUpperCase()}
                {pumpStation.sinkingStatus !== 'complete'
                  ? ` | Rem: ${Math.max(0, Number((pumpStation.totalHeightM - pumpStation.sinkingCompletedM).toFixed(2)))}m`
                  : ''}]
              </text>
              <text x={12} y={191} fontSize={6.7} fontWeight="700" fill="#1e3a8a">
                - Upper Room: {pumpStation.machineRoom.status.toUpperCase()}
              </text>

              {/* Right Col: WB Open Cut + WC Micro-Tunnelling */}
              <text x={332} y={35} textAnchor="middle" fontSize={7.8} fontWeight="700" fill="#1e3a8a" textDecoration="underline">
                WB (OPEN CUT) & WC (MICRO-TUNNEL)
              </text>
              <rect x={228} y={43} width={208} height={87} rx={2.5} fill="#eff6ff" stroke="#2563eb" strokeWidth={0.65} />
              <text x={235} y={57} fontSize={7.2} fontWeight="700" fill="#1e3a8a">WB SECTION ({wbData.method} {wbData.pipeDia}):</text>
              <text x={235} y={73} fontSize={6.9} fill="#0f172a">
                Total: {(wbData.totalLengthM / 1000).toFixed(3)} km ({wbData.totalLengthM} m)
              </text>
              <text x={235} y={88} fontSize={6.9} fontWeight="700" fill="#15803d">
                Done: {(wbData.completedLengthM / 1000).toFixed(3)} km ({wbData.completedLengthM.toFixed(1)} m)
              </text>
              <text x={235} y={103} fontSize={6.9} fontWeight="700" fill="#dc2626">
                Rem: {(Math.max(0, wbData.totalLengthM - wbData.completedLengthM) / 1000).toFixed(3)} km
              </text>
              <text x={235} y={119} fontSize={6.9} fontWeight="700" fill="#2563eb">
                Progress: {wbCompletePct.toFixed(1)}% Complete
              </text>

              <rect x={228} y={136} width={208} height={89} rx={2.5} fill="#faf5ff" stroke="#9333ea" strokeWidth={0.65} />
              <text x={235} y={149} fontSize={7.2} fontWeight="700" fill="#6b21a8">WC SECTION (MICRO-TUNNELLING):</text>
              <text x={235} y={163} fontSize={6.7} fill="#0f172a">
                Shafts ({wcSummary.totalShafts}): Done {wcSummary.completedShafts} | Ong {wcSummary.ongoingShafts} | Rem {wcSummary.remainingShafts}
              </text>
              <text x={235} y={177} fontSize={6.7} fontWeight="700" fill="#a21caf">
                Tunnel: {(wcSummary.completedTunnelLengthM / 1000).toFixed(3)} / {(wcSummary.totalTunnelLengthM / 1000).toFixed(3)} km ({wcSummary.tunnelPctOverall.toFixed(1)}%)
              </text>
              <text x={235} y={191} fontSize={6.4} fill="#1d4ed8">
                MH Cast: {wcSummary.castingCompleteCount} | Ong {wcSummary.castingOngoingCount} | Rem {wcSummary.castingRemainingCount}
              </text>
              <text x={235} y={204} fontSize={6.4} fill="#0284c7">
                MH Ring: {wcSummary.precastCompleteCount} | Ong {wcSummary.precastOngoingCount} | Rem {wcSummary.precastRemainingCount}
              </text>
              <text x={235} y={217} fontSize={6.4} fill="#475569">
                Status: {wcSummary.completedTunnelLengthM > 0 || wcSummary.completedShafts > 0 ? 'Active Construction' : 'Not Started (Blank)'}
              </text>

              {renderLegendAndTitle(448, 0, 202, 232, 656, 0, 234, 232, true)}
            </g>
          </g>
        );
      })()}
    </svg>
  );
};
