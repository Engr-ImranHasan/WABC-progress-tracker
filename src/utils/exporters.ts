import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import * as XLSX from 'xlsx';
import {
  AppState,
  PipeDia,
  PumpStationData,
  SavedProgressFile,
  ShaftRecord,
  ShaftType,
  SheetSettings,
  WbSectionData,
  WcSectionData,
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
  parseDateInput,
  recomputeWbChainages,
  resizeShaftLayers,
  resolveDisplayContext,
} from './calculations';
import { buildR2007HeaderAndPrologue, buildR2007ObjectsEpilogue } from './dxfTemplate';
import {
  createInitialWbData,
  createInitialWcData,
  DEFAULT_AIR_VALVE_COORD,
  DEFAULT_WASHOUT_COORD,
  GOLAPBAG_SPS_COORD,
  INITIAL_WA_GEO_NODES,
} from './../data/wbcInitialData';
import { buildGeoViewport, ensureMapTileSnapshot } from './geoMap';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeSvgCloneForExport(svgEl: SVGSVGElement, w: string, h: string): SVGSVGElement {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.querySelectorAll('[data-selection-ring="true"]').forEach((n) => n.remove());
  return clone;
}

export async function preloadSectionMapSnapshots(state: AppState): Promise<void> {
  if (!state.settings.showMapBackground || state.settings.mapStyle === 'cad') return;
  const waNodes =
    state.waGeoNodes && state.waGeoNodes.length > 0
      ? state.waGeoNodes
      : INITIAL_WA_GEO_NODES;
  const spsCoord = state.spsCoord || GOLAPBAG_SPS_COORD;

  // Standalone WA page right-side vertical map: x=1318, y=58, w=342, h=930 -> mapX=1322, mapY=82, mapW=334, mapH=902
  const waVerticalVp = buildGeoViewport([...waNodes, spsCoord], 1322, 82, 334, 902, 0.11);
  // Standalone WB page: x=22, y=58, w=950, h=926 (padTop=26) -> mapX=26, mapY=84, mapW=942, mapH=896
  const wbFullVp = buildGeoViewport(state.wb.nodes, 26, 84, 942, 896, 0.1);
  // Combined side-by-side WB map: x=922, y=704, w=368, h=464 -> mapX=926, mapY=723, mapW=360, mapH=441
  const wbCompactVp = buildGeoViewport(state.wb.nodes, 926, 723, 360, 441, 0.12);
  // Standalone WC page right-side vertical map: x=1318, y=58, w=342, h=930 -> mapX=1322, mapY=82, mapW=334, mapH=902
  const wcFullVp = buildGeoViewport(state.wc.geoNodes, 1322, 82, 334, 902, 0.11);
  // Combined side-by-side WC map: x=1296, y=704, w=368, h=464 -> mapX=1300, mapY=723, mapW=360, mapH=441
  const wcCompactVp = buildGeoViewport(state.wc.geoNodes, 1300, 723, 360, 441, 0.12);

  // Full-A1 Portrait GIS Map Pages (Pages 2, 3, 4 in 5-Page PDF: x=44, y=86, w=1100, h=1558, padRatio=0.09, 1120x1594)
  const waFullA1Vp = buildGeoViewport(
    [...waNodes, spsCoord],
    44,
    86,
    1100,
    1558,
    0.09
  );
  const wbFullA1Vp = buildGeoViewport(
    [
      ...state.wb.nodes,
      state.wb.washoutCoord || DEFAULT_WASHOUT_COORD,
      state.wb.airValveCoord || DEFAULT_AIR_VALVE_COORD,
      spsCoord,
    ],
    44,
    86,
    1100,
    1558,
    0.09
  );
  const wcFullA1Vp = buildGeoViewport(state.wc.geoNodes, 44, 86, 1100, 1558, 0.09);

  const wbFullW = Math.min(1100, Math.max(480, Math.round(942 * 1.35)));
  const wbFullH = Math.min(1100, Math.max(420, Math.round(896 * 1.35)));
  const compactW = Math.min(1100, Math.max(480, Math.round(360 * 1.55)));
  const compactH = Math.min(1100, Math.max(420, Math.round(441 * 1.55)));
  const wcCompactScale = Math.min(1.55, 1580 / 441);
  const wcCompactW = Math.max(360, Math.round(360 * wcCompactScale));
  const wcCompactH = Math.max(360, Math.round(441 * wcCompactScale));
  const vertScale = Math.min(1.45, 1580 / 902);
  const vertW = Math.max(360, Math.round(334 * vertScale));
  const vertH = Math.max(360, Math.round(902 * vertScale));

  await Promise.all([
    ensureMapTileSnapshot(waVerticalVp, state.settings.mapStyle, vertW, vertH),
    ensureMapTileSnapshot(wbFullVp, state.settings.mapStyle, wbFullW, wbFullH),
    ensureMapTileSnapshot(wbCompactVp, state.settings.mapStyle, compactW, compactH),
    ensureMapTileSnapshot(wcFullVp, state.settings.mapStyle, vertW, vertH),
    ensureMapTileSnapshot(wcCompactVp, state.settings.mapStyle, wcCompactW, wcCompactH),
    ensureMapTileSnapshot(waFullA1Vp, state.settings.mapStyle, 1120, 1594),
    ensureMapTileSnapshot(wbFullA1Vp, state.settings.mapStyle, 1120, 1594),
    ensureMapTileSnapshot(wcFullA1Vp, state.settings.mapStyle, 1120, 1594),
  ]);
}

function getSvgPageSpec(svgEl: SVGSVGElement): {
  orientation: 'landscape' | 'portrait';
  widthMm: number;
  heightMm: number;
} {
  const vb = svgEl.getAttribute('viewBox') || '';
  const parts = vb.trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[3] > parts[2]) {
    return { orientation: 'portrait', widthMm: 594, heightMm: 841 };
  }
  return { orientation: 'landscape', widthMm: 841, heightMm: 594 };
}

export async function exportA1VectorPdf(
  svgEl: SVGSVGElement,
  filename: string
): Promise<void> {
  const spec = getSvgPageSpec(svgEl);
  const clone = sanitizeSvgCloneForExport(
    svgEl,
    String(spec.widthMm),
    String(spec.heightMm)
  );
  const pdf = new jsPDF({
    orientation: spec.orientation,
    unit: 'mm',
    format: [spec.widthMm, spec.heightMm],
    compress: true,
  });

  await svg2pdf(clone, pdf, {
    x: 0,
    y: 0,
    width: spec.widthMm,
    height: spec.heightMm,
  });

  pdf.save(filename);
}

/**
 * Exports multiple ISO A1 sheets (mixed Landscape & Portrait supported automatically)
 * into a single multi-page A1 vector PDF file.
 */
export async function exportMultiPageA1VectorPdf(
  svgEls: SVGSVGElement[],
  filename: string
): Promise<void> {
  if (svgEls.length === 0) return;
  const firstSpec = getSvgPageSpec(svgEls[0]);
  const pdf = new jsPDF({
    orientation: firstSpec.orientation,
    unit: 'mm',
    format: [firstSpec.widthMm, firstSpec.heightMm],
    compress: true,
  });

  for (let i = 0; i < svgEls.length; i++) {
    const spec = getSvgPageSpec(svgEls[i]);
    if (i > 0) {
      pdf.addPage([spec.widthMm, spec.heightMm], spec.orientation);
    }
    const clone = sanitizeSvgCloneForExport(
      svgEls[i],
      String(spec.widthMm),
      String(spec.heightMm)
    );
    await svg2pdf(clone, pdf, {
      x: 0,
      y: 0,
      width: spec.widthMm,
      height: spec.heightMm,
    });
  }

  pdf.save(filename);
}

export function exportSvgFile(svgEl: SVGSVGElement, filename: string): void {
  const spec = getSvgPageSpec(svgEl);
  const clone = sanitizeSvgCloneForExport(svgEl, `${spec.widthMm}mm`, `${spec.heightMm}mm`);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  triggerDownload(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

export async function exportHighResPng(
  svgEl: SVGSVGElement,
  filename: string
): Promise<void> {
  const spec = getSvgPageSpec(svgEl);
  const width = spec.orientation === 'portrait' ? 2970 : 4205;
  const height = spec.orientation === 'portrait' ? 4205 : 2970;
  const clone = sanitizeSvgCloneForExport(svgEl, String(width), String(height));

  const svgStr = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) triggerDownload(blob, filename);
        resolve();
      }, 'image/png');
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

export function exportJsonBackup(state: AppState, filename: string): void {
  const json = JSON.stringify(state, null, 2);
  triggerDownload(new Blob([json], { type: 'application/json;charset=utf-8' }), filename);
}

export function exportSavedFileJson(file: SavedProgressFile, filename: string): void {
  const json = JSON.stringify(file, null, 2);
  triggerDownload(new Blob([json], { type: 'application/json;charset=utf-8' }), filename);
}

function mapShaftRows(
  shafts: ShaftRecord[],
  compareInfo?: {
    baselineShafts: Record<string, { layerFlags: boolean[]; tunnelPct: number; castingPct: number; precastPct: number; bottomSlabDone: boolean }>;
  },
  geoCoords?: Array<{ id: string; lat: number; lon: number }>
) {
  const geoById = new Map<string, { lat: number; lon: number }>();
  if (geoCoords) {
    for (const g of geoCoords) geoById.set(g.id, { lat: g.lat, lon: g.lon });
  }

  return shafts.map((s) => {
    const shDone = getShaftCompletedLayersCount(s);
    const shDur = calcDurationDays(s.shaftSDate, s.shaftEDate);
    const mhDur = calcDurationDays(s.manholeSDate, s.manholeEDate);
    const mtDur = calcDurationDays(s.tunnelSDate, s.tunnelEDate);
    const prevSnap = compareInfo?.baselineShafts[s.id];
    const prevLayers = prevSnap
      ? (prevSnap.layerFlags || []).slice(0, s.totalLayers).filter(Boolean).length
      : 0;
    const coord = geoById.get(s.id);

    return {
      'No.': s.index,
      'Shaft ID': s.id,
      'Next Connection': s.nextId,
      ...(coord ? { Latitude: coord.lat, Longitude: coord.lon } : {}),
      'Shaft Size (mm)': s.shaftSize,
      'Type of Shaft': s.shaftType,
      'Net Height (mm)': s.netHeightMm,
      'Bottom Slab (mm)': s.bottomSlabMm,
      'Total Layers (6-13)': s.totalLayers,
      'Completed Layers': shDone,
      'Bottom Slab Done (Yes/No)': s.bottomSlabDone ? 'Yes' : 'No',
      'Shaft S.Date (DD/MM/YYYY)': formatDateDisplay(s.shaftSDate),
      'Shaft E.Date (DD/MM/YYYY)': formatDateDisplay(s.shaftEDate),
      'Shaft Duration (Days)': shDur ?? (getShaftStatus(s) === 'ongoing' ? 'On-going' : ''),
      'Shaft Status': getShaftStatus(s).toUpperCase(),
      'Manhole Casting (%)': s.castingPct,
      'Manhole Precast Ring (%)': s.precastPct,
      'Manhole S.Date (DD/MM/YYYY)': formatDateDisplay(s.manholeSDate),
      'Manhole E.Date (DD/MM/YYYY)': formatDateDisplay(s.manholeEDate),
      'Manhole Duration (Days)': mhDur ?? (getManholeStatus(s) === 'ongoing' ? 'On-going' : ''),
      'Manhole Status': getManholeStatus(s).toUpperCase(),
      'Pipe Dia': s.pipeDia,
      'Tunnel Length (m)': s.tunnelLengthM,
      'Tunnel Completed (%)': s.tunnelPct,
      'Tunnel Completed (m)': Number(((s.tunnelLengthM * s.tunnelPct) / 100).toFixed(2)),
      'Tunnel S.Date (DD/MM/YYYY)': formatDateDisplay(s.tunnelSDate),
      'Tunnel E.Date (DD/MM/YYYY)': formatDateDisplay(s.tunnelEDate),
      'Tunnel Duration (Days)': mtDur ?? (getTunnelStatus(s) === 'ongoing' ? 'On-going' : ''),
      'Tunnel Status': getTunnelStatus(s).toUpperCase(),
      ...(compareInfo
        ? {
            'File 1 Layers': prevLayers,
            'Added Layers': Math.max(0, shDone - prevLayers),
            'File 1 Tunnel (%)': prevSnap ? prevSnap.tunnelPct : 0,
            'Added Tunnel (%)': Math.max(0, s.tunnelPct - (prevSnap?.tunnelPct ?? 0)),
          }
        : {}),
    };
  });
}

function buildWorkbookFromData(
  shafts: ShaftRecord[],
  pumpStation: PumpStationData,
  wbData: WbSectionData,
  wcData: WcSectionData,
  reportDate: string,
  compareInfo?: {
    mode: 'weekly' | 'monthly';
    file1Label: string;
    file2Label: string;
    baselineShafts: Record<string, { layerFlags: boolean[]; tunnelPct: number; castingPct: number; precastPct: number; bottomSlabDone: boolean }>;
    baselineWcShafts?: Record<string, { layerFlags: boolean[]; tunnelPct: number; castingPct: number; precastPct: number; bottomSlabDone: boolean }>;
    prevWbCompletedM?: number;
  },
  waTunnelDiaTotalsM?: Partial<Record<PipeDia, number>>
) {
  const waRows = mapShaftRows(
    shafts,
    compareInfo ? { baselineShafts: compareInfo.baselineShafts } : undefined
  );
  const wcRows = mapShaftRows(
    wcData.shafts,
    compareInfo?.baselineWcShafts
      ? { baselineShafts: compareInfo.baselineWcShafts }
      : undefined,
    wcData.geoNodes
  );

  const wbRows = wbData.nodes.map((n, idx) => ({
    'No.': n.index,
    'Node ID': n.id,
    Latitude: n.lat,
    Longitude: n.lon,
    'Chainage (m)': Number(n.chainageM.toFixed(2)),
    Status: n.status.toUpperCase(),
    'S. Date': formatDateDisplay(n.sDate),
    'E. Date': formatDateDisplay(n.eDate),
    'Duration (Days)': calcDurationDays(n.sDate, n.eDate) ?? (n.status === 'ongoing' ? 'On-going' : ''),
    'Pipe Spec': idx === 0 ? wbData.pipeDia : '',
    'WB Total Length (m)': idx === 0 ? wbData.totalLengthM : '',
    'WB Completed Length (m)': idx === 0 ? wbData.completedLengthM : '',
    'WB Remaining Length (m)':
      idx === 0 ? Number(Math.max(0, wbData.totalLengthM - wbData.completedLengthM).toFixed(2)) : '',
  }));

  const waSummary = computeSummary(
    shafts,
    compareInfo
      ? {
          label: compareInfo.file1Label,
          date: reportDate,
          capturedAt: '',
          shafts: compareInfo.baselineShafts,
          pumpLayersDone: pumpStation.layers.map((l) => l.status === 'complete'),
          pumpMachineRoomStatus: pumpStation.machineRoom.status,
        }
      : undefined,
    pumpStation,
    undefined,
    waTunnelDiaTotalsM
  );
  const wcSummary = computeSummary(wcData.shafts);
  const wbPct = wbData.totalLengthM > 0 ? (wbData.completedLengthM / wbData.totalLengthM) * 100 : 0;

  const summaryRows = [
    { Section: 'Report', Category: 'Report Date', Metric: 'Date', Value: formatDateDisplay(reportDate), Unit: '' },
    ...(compareInfo
      ? [
          { Section: 'Compare', Category: 'Comparison', Metric: 'File 1 (Previous)', Value: compareInfo.file1Label, Unit: '' },
          { Section: 'Compare', Category: 'Comparison', Metric: 'File 2 (Current/Final)', Value: compareInfo.file2Label, Unit: '' },
          { Section: 'Compare', Category: 'WA Delta', Metric: 'Added Shaft Layers', Value: waSummary.delta.addedLayers, Unit: 'Layers' },
          { Section: 'Compare', Category: 'WA Delta', Metric: 'Added Tunnel Length', Value: Number(waSummary.delta.addedTunnelM.toFixed(2)), Unit: 'm' },
          { Section: 'Compare', Category: 'WA Delta', Metric: 'MH Cast (New Complete / On-going)', Value: `${waSummary.delta.addedCastingCompleted} / ${waSummary.delta.addedCastingOngoing}`, Unit: 'Nos' },
          { Section: 'Compare', Category: 'WA Delta', Metric: 'MH Ring (New Complete / On-going)', Value: `${waSummary.delta.addedPrecastCompleted} / ${waSummary.delta.addedPrecastOngoing}`, Unit: 'Nos' },
          {
            Section: 'Compare',
            Category: 'WB Delta',
            Metric: 'Added Open Cut Length',
            Value: Number(Math.max(0, wbData.completedLengthM - (compareInfo.prevWbCompletedM ?? 0)).toFixed(2)),
            Unit: 'm',
          },
        ]
      : []),
    { Section: 'WA', Category: 'Shafts', Metric: 'Total Shafts', Value: waSummary.totalShafts, Unit: 'Nos' },
    { Section: 'WA', Category: 'Shafts', Metric: 'Completed / On-going / Remaining', Value: `${waSummary.completedShafts} / ${waSummary.ongoingShafts} / ${waSummary.remainingShafts}`, Unit: 'Nos' },
    { Section: 'WA', Category: 'Manholes', Metric: 'Casting (Complete / On-going / Remaining)', Value: `${waSummary.castingCompleteCount} / ${waSummary.castingOngoingCount} / ${waSummary.castingRemainingCount}`, Unit: 'Nos' },
    { Section: 'WA', Category: 'Manholes', Metric: 'Ring (Complete / On-going / Remaining)', Value: `${waSummary.precastCompleteCount} / ${waSummary.precastOngoingCount} / ${waSummary.precastRemainingCount}`, Unit: 'Nos' },
    { Section: 'WA', Category: 'Micro-Tunnelling', Metric: 'Completed / Total Length', Value: `${(waSummary.completedTunnelLengthM / 1000).toFixed(3)} / ${(waSummary.totalTunnelLengthM / 1000).toFixed(3)}`, Unit: 'km' },
    { Section: 'SPS', Category: 'Pump Station', Metric: 'Lower Main Structure (L1 bottom→L5 top)', Value: `${getPumpLowerStatus(pumpStation).toUpperCase()} (${pumpStation.layers.filter((l) => l.status === 'complete').length}/5 layers)`, Unit: '' },
    { Section: 'SPS', Category: 'Pump Station', Metric: 'Sinking Status & Completed / Remaining', Value: `${pumpStation.sinkingStatus.toUpperCase()} (${pumpStation.sinkingCompletedM}m / ${pumpStation.totalHeightM}m, Rem: ${Math.max(0, Number((pumpStation.totalHeightM - pumpStation.sinkingCompletedM).toFixed(2)))}m)`, Unit: 'm' },
    { Section: 'SPS', Category: 'Pump Station', Metric: 'Upper Machine Room', Value: pumpStation.machineRoom.status.toUpperCase(), Unit: '' },
    { Section: 'WB', Category: 'Open Cut', Metric: 'Total / Completed / Remaining', Value: `${wbData.totalLengthM}m / ${wbData.completedLengthM}m / ${Math.max(0, wbData.totalLengthM - wbData.completedLengthM).toFixed(1)}m (${wbPct.toFixed(1)}%)`, Unit: 'm' },
    { Section: 'WB', Category: 'Nodes', Metric: 'Total / Complete / On-going / Remaining', Value: `${wbData.nodes.length} / ${wbData.nodes.filter((n) => n.status === 'complete').length} / ${wbData.nodes.filter((n) => n.status === 'ongoing').length} / ${wbData.nodes.filter((n) => n.status === 'remaining').length}`, Unit: 'Nos' },
    { Section: 'WC', Category: 'Shafts', Metric: 'Total / Completed / On-going / Remaining', Value: `${wcSummary.totalShafts} / ${wcSummary.completedShafts} / ${wcSummary.ongoingShafts} / ${wcSummary.remainingShafts}`, Unit: 'Nos' },
    { Section: 'WC', Category: 'Micro-Tunnelling', Metric: 'Completed / Total Length', Value: `${(wcSummary.completedTunnelLengthM / 1000).toFixed(3)} / ${(wcSummary.totalTunnelLengthM / 1000).toFixed(3)}`, Unit: 'km' },
  ];

  const pumpRows = [
    {
      Part: 'Upper Part — Machine Room',
      Item: 'Machine Room (Control / Storage / Pump House)',
      Status: pumpStation.machineRoom.status.toUpperCase(),
      'S. Date': formatDateDisplay(pumpStation.machineRoom.sDate),
      'E. Date': formatDateDisplay(pumpStation.machineRoom.eDate),
      'Duration (Days)': calcDurationDays(pumpStation.machineRoom.sDate, pumpStation.machineRoom.eDate) ?? '-',
      'Total Height (m)': '',
      'Casting Complete (m)': '',
      'Sinking Complete (m)': '',
      'Sinking Status': '',
    },
    ...[4, 3, 2, 1, 0].map((li) => {
      const ly = pumpStation.layers[li];
      return {
        Part: 'Lower Part — Main Structure (Top L5 down to Base L1)',
        Item: `L${li + 1}: ${ly.name}`,
        Status: ly.status.toUpperCase(),
        'S. Date': formatDateDisplay(ly.sDate),
        'E. Date': formatDateDisplay(ly.eDate),
        'Duration (Days)': calcDurationDays(ly.sDate, ly.eDate) ?? '-',
        'Total Height (m)': li === 0 ? pumpStation.totalHeightM : '',
        'Casting Complete (m)': li === 0 ? pumpStation.castingCompleteM : '',
        'Sinking Complete (m)': li === 0 ? pumpStation.sinkingCompletedM : '',
        'Sinking Status': li === 0 ? pumpStation.sinkingStatus.toUpperCase() : '',
      };
    }),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(waRows), 'WA_Shafts_Progress');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pumpRows), 'Pump_Station_2Part');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wbRows), 'WB_OpenCut_Nodes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wcRows), 'WC_Shafts_Progress');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  return wb;
}

export function exportSavedFileExcel(
  file: SavedProgressFile,
  settings: SheetSettings,
  filename: string
): void {
  const wb = buildWorkbookFromData(
    file.shafts,
    file.pumpStation,
    file.wb || createInitialWbData(),
    file.wc || createInitialWcData(),
    file.date,
    undefined,
    settings.waTunnelDiaTotalsM
  );
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename
  );
}

export function exportExcelWorkbook(state: AppState, filename: string): void {
  const ctx = resolveDisplayContext(state);
  const wb = buildWorkbookFromData(
    ctx.displayShafts,
    ctx.displayPump,
    ctx.displayWb,
    ctx.displayWc,
    state.settings.reportDate,
    state.viewMode === 'overall'
      ? undefined
      : {
          mode: state.viewMode,
          file1Label: ctx.file1Label,
          file2Label: ctx.file2Label,
          baselineShafts: ctx.baseline.shafts,
          baselineWcShafts: ctx.baseline.wcShafts,
          prevWbCompletedM: ctx.baseline.wbCompletedLengthM,
        },
    state.settings.waTunnelDiaTotalsM
  );
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename
  );
}

function excelCellToIsoDate(val: unknown): string {
  if (val == null || val === '') return '';
  if (typeof val === 'number') {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  return parseDateInput(String(val));
}

function mergeShaftRowsFromSheet(
  rows: Record<string, unknown>[],
  currentShafts: ShaftRecord[]
): ShaftRecord[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const rawId = String(r['Shaft ID'] || r['ID'] || '').replace(/\s+/g, '').replace('Shaft', '');
    if (rawId) byId.set(rawId.toUpperCase(), r);
  }

  return currentShafts.map((s) => {
    const row = byId.get(s.id.toUpperCase());
    if (!row) return s;

    const totalLayersRaw = Number(row['Total Layers (6-13)'] ?? s.totalLayers);
    const totalLayers = Math.max(6, Math.min(13, Number.isFinite(totalLayersRaw) ? totalLayersRaw : s.totalLayers));
    const completedLayersRaw = Number(row['Completed Layers'] ?? getShaftCompletedLayersCount(s));
    const completedLayers = Math.max(0, Math.min(totalLayers, Number.isFinite(completedLayersRaw) ? completedLayersRaw : 0));

    let flags = resizeShaftLayers(s.layerFlags, totalLayers);
    if (flags.filter(Boolean).length !== completedLayers) {
      flags = Array.from({ length: totalLayers }, (_, i) => i < completedLayers);
    }

    const bsVal = String(row['Bottom Slab Done (Yes/No)'] ?? '').toLowerCase();
    const bottomSlabDone = bsVal ? bsVal === 'yes' || bsVal === 'true' || bsVal === '1' : s.bottomSlabDone;

    const stTypeRaw = String(row['Type of Shaft'] ?? s.shaftType) as ShaftType;
    const shaftType: ShaftType = ['Driving', 'Receiving', 'Receiving/Driving'].includes(stTypeRaw)
      ? stTypeRaw
      : s.shaftType;

    const diaRaw = String(row['Pipe Dia'] ?? s.pipeDia).toUpperCase() as PipeDia;
    const pipeDia: PipeDia = ['DN900', 'DN1100', 'DN1600', 'DN1800', 'DN2400', 'DN2600'].includes(diaRaw)
      ? diaRaw
      : s.pipeDia;

    const castingRaw = Number(row['Manhole Casting (%)'] ?? s.castingPct);
    const precastRaw = Number(row['Manhole Precast Ring (%)'] ?? s.precastPct);
    const lenRaw = Number(row['Tunnel Length (m)'] ?? s.tunnelLengthM);
    const pctRaw = Number(row['Tunnel Completed (%)'] ?? s.tunnelPct);

    return {
      ...s,
      shaftSize: String(row['Shaft Size (mm)'] ?? s.shaftSize),
      shaftType,
      netHeightMm: Number(row['Net Height (mm)'] ?? s.netHeightMm) || s.netHeightMm,
      bottomSlabMm: Number(row['Bottom Slab (mm)'] ?? s.bottomSlabMm) || s.bottomSlabMm,
      totalLayers,
      layerFlags: flags,
      bottomSlabDone,
      shaftSDate: row['Shaft S.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Shaft S.Date (DD/MM/YYYY)']) : s.shaftSDate,
      shaftEDate: row['Shaft E.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Shaft E.Date (DD/MM/YYYY)']) : s.shaftEDate,
      castingPct: Math.max(0, Math.min(100, Number.isFinite(castingRaw) ? castingRaw : s.castingPct)),
      precastPct: Math.max(0, Math.min(100, Number.isFinite(precastRaw) ? precastRaw : s.precastPct)),
      manholeSDate: row['Manhole S.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Manhole S.Date (DD/MM/YYYY)']) : s.manholeSDate,
      manholeEDate: row['Manhole E.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Manhole E.Date (DD/MM/YYYY)']) : s.manholeEDate,
      pipeDia,
      tunnelLengthM: Number.isFinite(lenRaw) && lenRaw >= 0 ? lenRaw : s.tunnelLengthM,
      tunnelPct: Math.max(0, Math.min(100, Number.isFinite(pctRaw) ? pctRaw : s.tunnelPct)),
      tunnelSDate: row['Tunnel S.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Tunnel S.Date (DD/MM/YYYY)']) : s.tunnelSDate,
      tunnelEDate: row['Tunnel E.Date (DD/MM/YYYY)'] !== undefined ? excelCellToIsoDate(row['Tunnel E.Date (DD/MM/YYYY)']) : s.tunnelEDate,
    };
  });
}

export async function importExcelShafts(
  file: File,
  currentShafts: ShaftRecord[]
): Promise<ShaftRecord[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames.includes('WA_Shafts_Progress')
    ? 'WA_Shafts_Progress'
    : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);
  return mergeShaftRowsFromSheet(rows, currentShafts);
}

export async function importFullExcelWorkbook(
  file: File,
  currentState: AppState
): Promise<{ shafts: ShaftRecord[]; wb: WbSectionData; wc: WcSectionData }> {
  const buf = await file.arrayBuffer();
  const book = XLSX.read(buf, { type: 'array' });

  // 1. WA Shafts
  const waSheetName = book.SheetNames.includes('WA_Shafts_Progress')
    ? 'WA_Shafts_Progress'
    : book.SheetNames[0];
  const waRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[waSheetName]);
  const nextWaShafts = mergeShaftRowsFromSheet(waRows, currentState.shafts);

  // 2. WC Shafts
  let nextWc = currentState.wc;
  if (book.SheetNames.includes('WC_Shafts_Progress')) {
    const wcRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      book.Sheets['WC_Shafts_Progress']
    );
    nextWc = {
      ...currentState.wc,
      shafts: mergeShaftRowsFromSheet(wcRows, currentState.wc.shafts),
    };
  }

  // 3. WB Open-Cut Nodes
  let nextWb = currentState.wb;
  if (book.SheetNames.includes('WB_OpenCut_Nodes')) {
    const wbRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      book.Sheets['WB_OpenCut_Nodes']
    );
    const byNodeId = new Map<string, Record<string, unknown>>();
    let headerTotal = nextWb.totalLengthM;
    let headerComp = nextWb.completedLengthM;

    for (const r of wbRows) {
      const nid = String(r['Node ID'] || '').trim().toUpperCase();
      if (nid) byNodeId.set(nid, r);
      const tVal = Number(r['WB Total Length (m)']);
      if (Number.isFinite(tVal) && tVal > 0) headerTotal = tVal;
      const cVal = Number(r['WB Completed Length (m)']);
      if (Number.isFinite(cVal) && cVal >= 0) headerComp = cVal;
    }

    const updatedNodes = nextWb.nodes.map((n) => {
      const r = byNodeId.get(n.id.toUpperCase());
      if (!r) return n;
      const stRaw = String(r['Status'] || n.status).toLowerCase();
      const status: WorkStatus =
        stRaw === 'complete' || stRaw === 'done'
          ? 'complete'
          : stRaw === 'ongoing' || stRaw === 'on-going'
          ? 'ongoing'
          : 'remaining';
      return {
        ...n,
        status,
        sDate: r['S. Date'] !== undefined ? excelCellToIsoDate(r['S. Date']) : n.sDate,
        eDate: r['E. Date'] !== undefined ? excelCellToIsoDate(r['E. Date']) : n.eDate,
      };
    });

    nextWb = {
      ...nextWb,
      totalLengthM: headerTotal,
      completedLengthM: Math.min(headerTotal, headerComp),
      nodes: recomputeWbChainages(updatedNodes, headerTotal),
    };
  }

  return { shafts: nextWaShafts, wb: nextWb, wc: nextWc };
}

/**
 * Converts an arbitrary hex/css color to the closest AutoCAD Color Index (ACI 1..255).
 * Pure background tints return null so AutoCAD dark/light canvases stay clean.
 */
function cssColorToAci(raw: string | null | undefined, fallback = 7, isText = false): number {
  const c = (raw || '').trim().toLowerCase();
  if (!c || c === 'none' || c === 'transparent') return fallback;
  // Green family
  if (
    c === '#16c916' ||
    c === '#16a34a' ||
    c === '#15803d' ||
    c === '#14532d' ||
    c === '#166534' ||
    c === '#22c55e' ||
    c === '#0f766e'
  )
    return 3; // Green
  // Red family
  if (c === '#dc2626' || c === '#b91c1c' || c === '#991b1b' || c === '#ef4444')
    return 1; // Red
  // Orange comparison family
  if (
    c === '#f97316' ||
    c === '#ea580c' ||
    c === '#c2410c' ||
    c === '#9a3412'
  )
    return 30; // Orange
  // Amber / Yellow family
  if (
    c === '#f59e0b' ||
    c === '#d97706' ||
    c === '#b45309' ||
    c === '#fbbf24' ||
    c === '#facc15' ||
    c === '#854d0e'
  )
    return 2; // Yellow
  // Blue / Dark Blue family (bright cyan-blue on text so AutoCAD dark canvas stays 100% legible!)
  if (
    c === '#1e3a8a' ||
    c === '#2563eb' ||
    c === '#1d4ed8' ||
    c === '#1e40af' ||
    c === '#3b82f6'
  )
    return isText ? 140 : 5;
  // Cyan / Light Blue family
  if (c === '#0ea5e9' || c === '#0284c7' || c === '#0369a1' || c === '#06b6d4' || c === '#0891b2')
    return 4; // Cyan
  // Magenta / Purple family
  if (
    c === '#e11dff' ||
    c === '#a21caf' ||
    c === '#86198f' ||
    c === '#9333ea' ||
    c === '#7e22ce' ||
    c === '#6b21a8' ||
    c === '#9d174d' ||
    c === '#831843'
  )
    return 6; // Magenta
  // Grays
  if (c === '#cbd5e1' || c === '#e2e8f0') return 9;
  if (c === '#64748b' || c === '#94a3b8' || c === '#475569') return isText ? 9 : 8;
  if (c === '#ffffff' || c === '#0f172a' || c === '#1e293b' || c === '#334155' || c === '#052e16')
    return 7; // Adaptive White/Black in AutoCAD

  // General RGB hex fallback so custom user colors also map accurately
  if (/^#[0-9a-f]{6}$/.test(c)) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 28) return max > 180 || max < 65 ? 7 : 8;
    if (r >= g && r >= b) {
      if (g > 155) return 2; // yellow
      if (g > 85 && b < 90) return 30; // orange
      if (b > 130) return 6; // magenta
      return 1; // red
    }
    if (g >= r && g >= b) return b > 160 ? 4 : 3;
    if (r > 130) return 6;
    return g > 140 ? 4 : isText ? 140 : 5;
  }
  return fallback;
}

const SKIP_SOLID_BG_COLORS = new Set([
  'none',
  'transparent',
  '#ffffff',
  '#f8fafc',
  '#f1f5f9',
  '#f0fdf4',
  '#eff6ff',
  '#fffbeb',
  '#fff7ed',
  '#faf5ff',
  '#ecfeff',
  '#dbeafe',
  '#fef3c7',
  '#ffedd5',
  '#fef2f2',
  '#fee2e2',
  '#dcfce7',
  '#e2e8f0',
  '#fdf2f8',
  '#fce7f3',
  '#fbcfe8',
  '#fae8ff',
  '#f5d0fe',
  '#f3e8ff',
  '#e9d5ff',
  '#e0e7ff',
  '#e0f2fe',
  '#ecfccb',
  '#f0fdfa',
  '#fef9c3',
  '#1e3a8a', // Dark table/title header bar: outline + adaptive text keeps AutoCAD 100% legible!
  '#0f172a',
]);

function shouldSkipSolidFill(fillRaw: string, hasStroke: boolean): boolean {
  if (!fillRaw || SKIP_SOLID_BG_COLORS.has(fillRaw)) return true;
  if (hasStroke && /^#[0-9a-f]{6}$/.test(fillRaw)) {
    const r = parseInt(fillRaw.slice(1, 3), 16);
    const g = parseInt(fillRaw.slice(3, 5), 16);
    const b = parseInt(fillRaw.slice(5, 7), 16);
    // Light/pastel badge & callout fills: outline-only keeps overlaid text legible in CAD
    if (Math.min(r, g, b) >= 165 && Math.max(r, g, b) >= 210) return true;
  }
  return false;
}

type Mat2D = [number, number, number, number, number, number];
const MAT_ID: Mat2D = [1, 0, 0, 1, 0, 0];

function mulMat(m1: Mat2D, m2: Mat2D): Mat2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function parseSvgTransform(attr: string | null): Mat2D {
  if (!attr) return MAT_ID;
  let m: Mat2D = [...MAT_ID];
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attr)) !== null) {
    const fn = match[1].toLowerCase();
    const nums = match[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    let next: Mat2D = MAT_ID;
    if (fn === 'translate' && nums.length >= 1) {
      next = [1, 0, 0, 1, nums[0], nums[1] ?? 0];
    } else if (fn === 'scale' && nums.length >= 1) {
      next = [nums[0], 0, 0, nums[1] ?? nums[0], 0, 0];
    } else if (fn === 'rotate' && nums.length >= 1) {
      const rad = (nums[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      if (nums.length >= 3) {
        const cx = nums[1];
        const cy = nums[2];
        next = mulMat(
          mulMat([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]),
          [1, 0, 0, 1, -cx, -cy]
        );
      } else {
        next = [cos, sin, -sin, cos, 0, 0];
      }
    } else if (fn === 'matrix' && nums.length >= 6) {
      next = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    }
    m = mulMat(m, next);
  }
  return m;
}

function applyMat(m: Mat2D, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function sanitizeDxfText(raw: string): string {
  return raw
    .replace(/\r?\n/g, ' ')
    .replace(/\u2014|\u2013/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateArialWidthFactor(
  txt: string,
  hMm: number,
  targetWidthMm: number
): number {
  if (!txt || hMm <= 0 || targetWidthMm <= 0) return 0.88;
  let units = 0;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if ("ilIjft.,;:|!'/\\()[] ".includes(ch)) units += 0.42;
    else if ('WMmwOQDG@%&'.includes(ch)) units += 1.02;
    else if (ch >= 'A' && ch <= 'Z') units += 0.82;
    else if (ch >= '0' && ch <= '9') units += 0.72;
    else units += 0.68;
  }
  const estAt1 = Math.max(0.1, units * hMm);
  const ratio = targetWidthMm / estAt1;
  return Math.max(0.76, Math.min(0.94, ratio));
}

/**
 * Generates an AutoCAD R2007 (AC1021, UTF-8) ASCII DXF file directly from the active A1 SVG drawing
 * (841x594mm Landscape or 594x841mm Portrait) with universal TrueType Arial / Arial Bold STYLE
 * definitions (AcDbTextStyleTableRecord + ACAD XData), full UTF-8 degree/diameter/Bangla text,
 * exact rotation/alignment (72/73), and A1 VPORT/LAYOUT framing so AutoCAD, Civil 3D, TrueView,
 * BricsCAD, and LibreCAD all open with identical fonts and zero drift.
 */
export function exportAutoCadDxf(
  state: AppState,
  filename: string,
  svgEl?: SVGSVGElement | null
): void {
  const spec = svgEl
    ? getSvgPageSpec(svgEl)
    : { orientation: 'landscape' as const, widthMm: 841, heightMm: 594 };
  const W = spec.widthMm;
  const H = spec.heightMm;

  let handleSeq = 0x100;
  const allocHandle = () => (handleSeq++).toString(16).toUpperCase();

  const entityLines: string[] = [];
  const push = (...vals: (string | number)[]) => {
    for (const v of vals) entityLines.push(String(v));
  };

  push(0, 'SECTION', 2, 'ENTITIES');

  const emitLine = (
    layer: string,
    color: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dashed = false
  ) => {
    push(
      0, 'LINE',
      5, allocHandle(),
      330, '17',
      100, 'AcDbEntity',
      8, layer
    );
    if (dashed) push(6, 'DASHED');
    push(
      62, color,
      100, 'AcDbLine',
      10, x1.toFixed(3), 20, y1.toFixed(3), 30, '0.0',
      11, x2.toFixed(3), 21, y2.toFixed(3), 31, '0.0'
    );
  };

  const emitSolidQuad = (
    layer: string,
    color: number,
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number }
  ) => {
    // DXF SOLID requires Z-order (top-left, top-right, bottom-left, bottom-right)
    push(
      0, 'SOLID',
      5, allocHandle(),
      330, '17',
      100, 'AcDbEntity',
      8, layer,
      62, color,
      100, 'AcDbTrace',
      10, p0.x.toFixed(3), 20, p0.y.toFixed(3), 30, '0.0',
      11, p1.x.toFixed(3), 21, p1.y.toFixed(3), 31, '0.0',
      12, p3.x.toFixed(3), 22, p3.y.toFixed(3), 32, '0.0',
      13, p2.x.toFixed(3), 23, p2.y.toFixed(3), 33, '0.0'
    );
  };

  const emitPolyline = (
    layer: string,
    color: number,
    pts: Array<{ x: number; y: number }>,
    closed: boolean,
    dashed = false
  ) => {
    if (pts.length < 2) return;
    if (pts.length === 2 && !closed) {
      emitLine(layer, color, pts[0].x, pts[0].y, pts[1].x, pts[1].y, dashed);
      return;
    }
    push(
      0, 'LWPOLYLINE',
      5, allocHandle(),
      330, '17',
      100, 'AcDbEntity',
      8, layer
    );
    if (dashed) push(6, 'DASHED');
    push(
      62, color,
      100, 'AcDbPolyline',
      90, pts.length,
      70, closed ? 1 : 0
    );
    for (const pt of pts) {
      push(10, pt.x.toFixed(3), 20, pt.y.toFixed(3));
    }
  };

  const emitCircle = (layer: string, color: number, cx: number, cy: number, r: number) => {
    push(
      0, 'CIRCLE',
      5, allocHandle(),
      330, '17',
      100, 'AcDbEntity',
      8, layer,
      62, color,
      100, 'AcDbCircle',
      10, cx.toFixed(3), 20, cy.toFixed(3), 30, '0.0',
      40, Math.max(0.1, r).toFixed(3)
    );
  };

  const emitText = (
    layer: string,
    color: number,
    x: number,
    y: number,
    h: number,
    txt: string,
    anchor: string,
    vBase = 'auto',
    rotDeg = 0,
    isBold = false,
    widthFactor = 0.88
  ) => {
    const clean = sanitizeDxfText(txt);
    if (!clean) return;
    const hAlign = anchor === 'middle' ? 1 : anchor === 'end' ? 2 : 0;
    const vAlign =
      vBase === 'middle' || vBase === 'central'
        ? 2
        : vBase === 'hanging' || vBase === 'text-before-edge'
        ? 3
        : 0;
    const safeH = Math.max(0.75, h);
    const styleName = isBold ? 'CAD_BOLD' : 'Standard';
    push(
      0, 'TEXT',
      5, allocHandle(),
      330, '17',
      100, 'AcDbEntity',
      8, layer,
      62, color,
      100, 'AcDbText',
      10, x.toFixed(3),
      20, y.toFixed(3),
      30, '0.0',
      40, safeH.toFixed(3),
      1, clean,
      50, rotDeg.toFixed(2),
      41, widthFactor.toFixed(3),
      7, styleName
    );
    if (hAlign !== 0 || vAlign !== 0) {
      push(72, hAlign, 11, x.toFixed(3), 21, y.toFixed(3), 31, '0.0');
    }
    push(100, 'AcDbText');
    if (vAlign !== 0) {
      push(73, vAlign);
    }
  };

  if (svgEl) {
    const vbAttr = svgEl.getAttribute('viewBox') || '';
    const vb = vbAttr.trim().split(/[\s,]+/).map(Number);
    const vbX = vb.length === 4 && Number.isFinite(vb[0]) ? vb[0] : 0;
    const vbY = vb.length === 4 && Number.isFinite(vb[1]) ? vb[1] : 0;
    const vbW = vb.length === 4 && Number.isFinite(vb[2]) && vb[2] > 0 ? vb[2] : 1682;
    const vbH = vb.length === 4 && Number.isFinite(vb[3]) && vb[3] > 0 ? vb[3] : 1188;
    const sxMm = W / vbW;
    const syMm = H / vbH;

    const toMm = (mat: Mat2D, x: number, y: number) => {
      const p = applyMat(mat, x, y);
      return {
        x: (p.x - vbX) * sxMm,
        y: H - (p.y - vbY) * syMm,
      };
    };

    const walk = (el: Element, parentMat: Mat2D) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'defs' || tag === 'clippath' || el.getAttribute('data-selection-ring') === 'true') {
        return;
      }
      const localMat = parseSvgTransform(el.getAttribute('transform'));
      const mat = mulMat(parentMat, localMat);

      if (tag === 'svg' || tag === 'g') {
        for (const child of Array.from(el.children)) {
          walk(child, mat);
        }
        return;
      }

      const fillRaw = (el.getAttribute('fill') || '').trim().toLowerCase();
      const fillOpacity = Number(el.getAttribute('fill-opacity') ?? '1');
      const strokeRaw = (el.getAttribute('stroke') || '').trim().toLowerCase();
      const dash = Boolean(el.getAttribute('stroke-dasharray'));
      const hasStroke = Boolean(strokeRaw && strokeRaw !== 'none' && strokeRaw !== 'transparent');
      const strokeAci = cssColorToAci(strokeRaw, 7);
      const fillAci = cssColorToAci(fillRaw, 7);

      if (tag === 'rect') {
        const rx = Number(el.getAttribute('x') || '0');
        const ry = Number(el.getAttribute('y') || '0');
        const rw = Number(el.getAttribute('width') || '0');
        const rh = Number(el.getAttribute('height') || '0');
        if (rw <= 0 || rh <= 0) return;
        const p0 = toMm(mat, rx, ry);
        const p1 = toMm(mat, rx + rw, ry);
        const p2 = toMm(mat, rx + rw, ry + rh);
        const p3 = toMm(mat, rx, ry + rh);

        const isOuterTintBox = rw * sxMm > 140 && rh * syMm > 60;
        if (
          fillRaw &&
          !shouldSkipSolidFill(fillRaw, hasStroke) &&
          (!Number.isFinite(fillOpacity) || fillOpacity >= 0.35) &&
          !isOuterTintBox
        ) {
          emitSolidQuad('CAD_FILLS', fillAci, p0, p1, p2, p3);
        }
        if (hasStroke) {
          emitPolyline(dash ? 'CAD_GRID' : 'CAD_GEOMETRY', strokeAci, [p0, p1, p2, p3], true, dash);
        }
      } else if (tag === 'line') {
        if (!hasStroke) return;
        const x1 = Number(el.getAttribute('x1') || '0');
        const y1 = Number(el.getAttribute('y1') || '0');
        const x2 = Number(el.getAttribute('x2') || '0');
        const y2 = Number(el.getAttribute('y2') || '0');
        const p1 = toMm(mat, x1, y1);
        const p2 = toMm(mat, x2, y2);
        emitLine(dash ? 'CAD_GRID' : 'CAD_GEOMETRY', strokeAci, p1.x, p1.y, p2.x, p2.y, dash);
      } else if (tag === 'polyline' || tag === 'polygon') {
        const ptsAttr = el.getAttribute('points') || '';
        const nums = ptsAttr
          .trim()
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n));
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = 0; i + 1 < nums.length; i += 2) {
          pts.push(toMm(mat, nums[i], nums[i + 1]));
        }
        if (pts.length < 2) return;
        if (
          tag === 'polygon' &&
          fillRaw &&
          !shouldSkipSolidFill(fillRaw, hasStroke) &&
          (!Number.isFinite(fillOpacity) || fillOpacity >= 0.35)
        ) {
          if (pts.length === 3) {
            emitSolidQuad('CAD_FILLS', fillAci, pts[0], pts[1], pts[2], pts[2]);
          } else if (pts.length === 4) {
            emitSolidQuad('CAD_FILLS', fillAci, pts[0], pts[1], pts[2], pts[3]);
          }
        }
        if (hasStroke || (tag === 'polygon' && fillRaw && !shouldSkipSolidFill(fillRaw, hasStroke))) {
          emitPolyline('CAD_GEOMETRY', hasStroke ? strokeAci : fillAci, pts, tag === 'polygon', dash);
        }
      } else if (tag === 'circle') {
        const cx = Number(el.getAttribute('cx') || '0');
        const cy = Number(el.getAttribute('cy') || '0');
        const r = Number(el.getAttribute('r') || '0');
        if (r <= 0) return;
        const cPt = toMm(mat, cx, cy);
        const scaleApprox = Math.hypot(mat[0], mat[1]) * sxMm;
        emitCircle('CAD_GEOMETRY', hasStroke ? strokeAci : fillAci, cPt.x, cPt.y, r * scaleApprox);
      } else if (tag === 'path') {
        const d = el.getAttribute('d') || '';
        const tokens = d.match(/[a-zA-Z]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
        let curX = 0;
        let curY = 0;
        let startX = 0;
        let startY = 0;
        let subPts: Array<{ x: number; y: number }> = [];
        let cmd = '';
        let i = 0;
        const flushSub = (closed: boolean) => {
          if (subPts.length >= 2 && (hasStroke || !shouldSkipSolidFill(fillRaw, hasStroke))) {
            emitPolyline('CAD_GEOMETRY', hasStroke ? strokeAci : fillAci, subPts, closed, dash);
          }
          subPts = [];
        };
        while (i < tokens.length) {
          if (/^[a-zA-Z]$/.test(tokens[i])) {
            cmd = tokens[i++];
            if (cmd === 'Z' || cmd === 'z') {
              curX = startX;
              curY = startY;
              flushSub(true);
            }
            continue;
          }
          const n = () => Number(tokens[i++]);
          if (cmd === 'M') {
            flushSub(false);
            curX = n();
            curY = n();
            startX = curX;
            startY = curY;
            subPts.push(toMm(mat, curX, curY));
            cmd = 'L';
          } else if (cmd === 'm') {
            flushSub(false);
            curX += n();
            curY += n();
            startX = curX;
            startY = curY;
            subPts.push(toMm(mat, curX, curY));
            cmd = 'l';
          } else if (cmd === 'L') {
            curX = n();
            curY = n();
            subPts.push(toMm(mat, curX, curY));
          } else if (cmd === 'l') {
            curX += n();
            curY += n();
            subPts.push(toMm(mat, curX, curY));
          } else if (cmd === 'H') {
            curX = n();
            subPts.push(toMm(mat, curX, curY));
          } else if (cmd === 'h') {
            curX += n();
            subPts.push(toMm(mat, curX, curY));
          } else if (cmd === 'V') {
            curY = n();
            subPts.push(toMm(mat, curX, curY));
          } else if (cmd === 'v') {
            curY += n();
            subPts.push(toMm(mat, curX, curY));
          } else {
            // Advance safely past curve args
            i++;
          }
        }
        flushSub(false);
      } else if (tag === 'text') {
        // Skip white SVG halo outline strokes behind HaloText
        if (hasStroke && strokeRaw === '#ffffff') return;

        const cs = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
        const baseX = Number(el.getAttribute('x') || '0');
        const baseY = Number(el.getAttribute('y') || '0');
        const baseFontSize =
          Number(el.getAttribute('font-size')) ||
          (cs ? parseFloat(cs.fontSize) : 0) ||
          7;
        const baseAnchor = (
          el.getAttribute('text-anchor') ||
          cs?.textAnchor ||
          'start'
        ).toLowerCase();
        const baseDomBaseline = (
          el.getAttribute('dominant-baseline') ||
          cs?.dominantBaseline ||
          'auto'
        ).toLowerCase();
        const baseFw = String(el.getAttribute('font-weight') || cs?.fontWeight || '400');
        const baseIsBold = baseFw === 'bold' || Number(baseFw) >= 600;
        const baseTxtAci = fillRaw === '#ffffff' ? 7 : cssColorToAci(fillRaw, 7, true);

        const scaleX = Math.hypot(mat[0] * sxMm, mat[1] * syMm);
        const scaleY = Math.hypot(mat[2] * sxMm, mat[3] * syMm);
        const rotDeg =
          Math.atan2(-mat[1] * syMm, mat[0] * sxMm) * (180 / Math.PI);
        const cleanRot = Math.abs(rotDeg) < 0.05 ? 0 : rotDeg;

        const emitSingleSpan = (
          rawStr: string,
          ux: number,
          uy: number,
          fSize: number,
          anchorStr: string,
          vBaseStr: string,
          isB: boolean,
          aci: number,
          lenSource?: SVGTextContentElement | null
        ) => {
          const cleanRaw = rawStr.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
          if (!cleanRaw) return;
          const pt = toMm(mat, ux, uy);
          const hMm = Math.max(0.75, fSize * scaleY * 0.716);
          let targetW = 0;
          if (lenSource && typeof lenSource.getComputedTextLength === 'function') {
            try {
              const svgLen = lenSource.getComputedTextLength();
              if (Number.isFinite(svgLen) && svgLen > 0) {
                targetW = svgLen * scaleX;
              }
            } catch {
              // Ignore offscreen measurement errors
            }
          }
          const wf = estimateArialWidthFactor(cleanRaw, hMm, targetW);
          emitText(
            'CAD_TEXT',
            aci,
            pt.x,
            pt.y,
            hMm,
            cleanRaw,
            anchorStr,
            vBaseStr,
            cleanRot,
            isB,
            wf
          );
        };

        const tspans = Array.from(el.children).filter(
          (c) => c.tagName.toLowerCase() === 'tspan'
        );

        if (tspans.length === 0) {
          emitSingleSpan(
            el.textContent || '',
            baseX,
            baseY,
            baseFontSize,
            baseAnchor,
            baseDomBaseline,
            baseIsBold,
            baseTxtAci,
            el as unknown as SVGTextContentElement
          );
        } else {
          // Check if children split into distinct lines/positions or distinct inline styled chunks
          const hasExplicitLineOrOffset = tspans.some(
            (ts) =>
              ts.hasAttribute('x') ||
              ts.hasAttribute('y') ||
              ts.hasAttribute('dy') ||
              ts.hasAttribute('dx') ||
              ts.hasAttribute('font-size') ||
              ts.hasAttribute('fill')
          );

          if (!hasExplicitLineOrOffset) {
            const joined = Array.from(el.childNodes)
              .map((n) => (n.textContent || '').trim())
              .filter(Boolean)
              .join(' ');
            emitSingleSpan(
              joined,
              baseX,
              baseY,
              baseFontSize,
              baseAnchor,
              baseDomBaseline,
              baseIsBold,
              baseTxtAci,
              el as unknown as SVGTextContentElement
            );
          } else {
            let curX = baseX;
            let curY = baseY;
            let charOffset = 0;
            let pendingTextRaw = '';
            let pendingTextStartOffset = 0;

            const flushPendingTextNodes = () => {
              const trimmed = pendingTextRaw.replace(/\s+/g, ' ').trim();
              if (trimmed) {
                let tx = curX;
                let ty = curY;
                let anch = baseAnchor;
                let vB = baseDomBaseline;
                let customLenMm = 0;
                const svgTextEl = el as unknown as SVGTextContentElement;
                if (typeof svgTextEl.getStartPositionOfChar === 'function') {
                  try {
                    const firstNonWs = pendingTextRaw.search(/\S/);
                    const startIdx = pendingTextStartOffset + Math.max(0, firstNonWs);
                    const pos = svgTextEl.getStartPositionOfChar(startIdx);
                    tx = pos.x;
                    ty = pos.y;
                    anch = 'start';
                    vB = 'auto';
                    if (typeof svgTextEl.getSubStringLength === 'function') {
                      const trimmedLen = pendingTextRaw.trim().length;
                      if (trimmedLen > 0) {
                        const subLen = svgTextEl.getSubStringLength(startIdx, trimmedLen);
                        if (Number.isFinite(subLen) && subLen > 0) {
                          customLenMm = subLen * scaleX;
                        }
                      }
                    }
                  } catch {
                    // Fallback to cursor
                  }
                }
                const pt = toMm(mat, tx, ty);
                const hMm = Math.max(0.75, baseFontSize * scaleY * 0.716);
                const wf = estimateArialWidthFactor(trimmed, hMm, customLenMm);
                emitText(
                  'CAD_TEXT',
                  baseTxtAci,
                  pt.x,
                  pt.y,
                  hMm,
                  trimmed,
                  anch,
                  vB,
                  cleanRot,
                  baseIsBold,
                  wf
                );
              }
              pendingTextRaw = '';
            };

            for (const node of Array.from(el.childNodes)) {
              const rawNodeText = node.textContent || '';
              if (node.nodeType === Node.TEXT_NODE) {
                if (!pendingTextRaw) pendingTextStartOffset = charOffset;
                pendingTextRaw += rawNodeText;
                charOffset += rawNodeText.length;
              } else if (
                node.nodeType === Node.ELEMENT_NODE &&
                (node as Element).tagName.toLowerCase() === 'tspan'
              ) {
                flushPendingTextNodes();
                const ts = node as Element;
                const trimmed = rawNodeText.replace(/\s+/g, ' ').trim();
                const xAttr = ts.getAttribute('x');
                const yAttr = ts.getAttribute('y');
                const dxAttr = ts.getAttribute('dx');
                const dyAttr = ts.getAttribute('dy');
                if (xAttr !== null) curX = Number(xAttr);
                if (yAttr !== null) curY = Number(yAttr);
                if (dxAttr !== null) curX += Number(dxAttr) || 0;
                if (dyAttr !== null) curY += Number(dyAttr) || 0;

                const tsCs =
                  typeof window !== 'undefined' ? window.getComputedStyle(ts) : null;
                const tsSize =
                  Number(ts.getAttribute('font-size')) ||
                  (tsCs ? parseFloat(tsCs.fontSize) : 0) ||
                  baseFontSize;
                const tsAnchor = (
                  ts.getAttribute('text-anchor') ||
                  baseAnchor ||
                  'start'
                ).toLowerCase();
                const tsVBase = (
                  ts.getAttribute('dominant-baseline') ||
                  baseDomBaseline ||
                  'auto'
                ).toLowerCase();
                const tsFw = String(
                  ts.getAttribute('font-weight') || tsCs?.fontWeight || baseFw
                );
                const tsBold = tsFw === 'bold' || Number(tsFw) >= 600;
                const tsFill = (ts.getAttribute('fill') || fillRaw).trim().toLowerCase();
                const tsAci =
                  tsFill === '#ffffff' ? 7 : cssColorToAci(tsFill, baseTxtAci, true);

                let sx = curX;
                let sy = curY;
                let finalAnchor = tsAnchor;
                let finalVBase = tsVBase;
                const tsSvg = ts as unknown as SVGTextContentElement;
                if (
                  typeof tsSvg.getStartPositionOfChar === 'function' &&
                  trimmed.length > 0
                ) {
                  try {
                    const firstNonWs = rawNodeText.search(/\S/);
                    const pos = tsSvg.getStartPositionOfChar(Math.max(0, firstNonWs));
                    sx = pos.x;
                    sy = pos.y;
                    finalAnchor = 'start';
                    finalVBase = 'auto';
                  } catch {
                    // Fallback to cursor
                  }
                }
                if (trimmed) {
                  emitSingleSpan(
                    trimmed,
                    sx,
                    sy,
                    tsSize,
                    finalAnchor,
                    finalVBase,
                    tsBold,
                    tsAci,
                    tsSvg
                  );
                }
                charOffset += rawNodeText.length;
              }
            }
            flushPendingTextNodes();
          }
        }
      }
    };

    walk(svgEl, MAT_ID);
  } else {
    // Minimal structural fallback if called without SVG ref
    const summary = computeSummary(state.shafts);
    emitPolyline(
      'CAD_FRAME',
      5,
      [
        { x: 8, y: 8 },
        { x: W - 8, y: 8 },
        { x: W - 8, y: H - 8 },
        { x: 8, y: H - 8 },
      ],
      true
    );
    emitText(
      'CAD_TEXT',
      7,
      20,
      H - 24,
      4.0,
      `${state.settings.sectionTitle} | Shafts: ${summary.completedShafts}/${summary.totalShafts}`,
      'start',
      'auto',
      0,
      true,
      0.88
    );
  }

  push(0, 'ENDSEC');
  const handseedHex = allocHandle();
  const fullLines = [
    ...buildR2007HeaderAndPrologue(W, H, handseedHex),
    ...entityLines,
    ...buildR2007ObjectsEpilogue(W, H),
  ];
  const dxfBytes = fullLines.join('\r\n') + '\r\n';
  triggerDownload(new Blob([dxfBytes], { type: 'application/dxf' }), filename);
}
