import {
  AppState,
  CustomMapPoint,
  GeoNodeCoord,
  PeriodBaseline,
  PumpStationData,
  SavedProgressFile,
  ShaftRecord,
  ShaftSnapshotItem,
  WbNodeRecord,
  WbSectionData,
  WcSectionData,
  WorkStatus,
} from '../types';
import {
  DEFAULT_AIR_VALVE_COORD,
  DEFAULT_WASHOUT_COORD,
  GOLAPBAG_SPS_COORD,
  haversineMeters,
  INITIAL_WA_GEO_NODES,
} from '../data/wbcInitialData';

export const LIVE_WORKSPACE_ID = '__LIVE__';

export function formatDateDisplay(iso: string): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function parseDateInput(val: string): string {
  const v = val.trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return '';
}

export function calcDurationDays(sDate: string, eDate: string): number | null {
  if (!sDate || !eDate) return null;
  const s = new Date(`${sDate}T00:00:00Z`).getTime();
  const e = new Date(`${eDate}T00:00:00Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return Math.round((e - s) / 86400000) + 1;
}

export function calcElapsedDays(sDate: string, refDate: string): number | null {
  if (!sDate || !refDate) return null;
  const s = new Date(`${sDate}T00:00:00Z`).getTime();
  const r = new Date(`${refDate}T00:00:00Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(r) || r < s) return null;
  return Math.round((r - s) / 86400000) + 1;
}

export function getShaftCompletedLayersCount(s: ShaftRecord): number {
  return s.layerFlags.slice(0, s.totalLayers).filter(Boolean).length;
}

export function getShaftStatus(s: ShaftRecord): WorkStatus {
  const doneLayers = getShaftCompletedLayersCount(s);
  const allLayersDone = doneLayers >= s.totalLayers;
  if (allLayersDone && s.bottomSlabDone && Boolean(s.shaftEDate)) {
    return 'complete';
  }
  if (allLayersDone && (s.bottomSlabDone || Boolean(s.shaftEDate))) {
    if (s.bottomSlabDone && !s.shaftSDate && !s.shaftEDate) return 'complete';
    if (Boolean(s.shaftEDate)) return 'complete';
  }
  if (doneLayers === 0 && !s.bottomSlabDone && !s.shaftSDate) {
    return 'remaining';
  }
  return 'ongoing';
}

export function getPartStatus(pct: number): WorkStatus {
  if (pct <= 0) return 'remaining';
  if (pct >= 100) return 'complete';
  return 'ongoing';
}

export function getCastingStatus(s: ShaftRecord): WorkStatus {
  if (s.castingPct >= 100) return 'complete';
  if (s.castingPct > 0 || Boolean(s.manholeSDate)) return 'ongoing';
  return 'remaining';
}

export function getRingStatus(s: ShaftRecord): WorkStatus {
  if (s.precastPct >= 100) return 'complete';
  if (s.precastPct > 0) return 'ongoing';
  return 'remaining';
}

export function getManholeStatus(s: ShaftRecord): WorkStatus {
  const c = s.castingPct;
  const p = s.precastPct;
  if (c >= 100 && p >= 100) return 'complete';
  if (c <= 0 && p <= 0 && !s.manholeSDate) return 'remaining';
  return 'ongoing';
}

export function getTunnelStatus(s: ShaftRecord): WorkStatus {
  if (s.tunnelPct >= 100) return 'complete';
  if (s.tunnelPct <= 0 && !s.tunnelSDate) return 'remaining';
  return 'ongoing';
}

export function getPumpLowerStatus(ps: PumpStationData): WorkStatus {
  const allDone = ps.layers.every((l) => l.status === 'complete');
  if (allDone) return 'complete';
  const anyStarted = ps.layers.some(
    (l) => l.status !== 'remaining' || Boolean(l.sDate)
  );
  return anyStarted ? 'ongoing' : 'remaining';
}

export function recomputeWbChainages(
  nodes: WbNodeRecord[],
  totalLengthM: number
): WbNodeRecord[] {
  if (nodes.length === 0) return [];
  const rawCum: number[] = [0];
  for (let i = 1; i < nodes.length; i++) {
    rawCum.push(
      rawCum[i - 1] +
        haversineMeters(nodes[i - 1].lat, nodes[i - 1].lon, nodes[i].lat, nodes[i].lon)
    );
  }
  const rawTotal = rawCum[rawCum.length - 1] || 1;
  const scale = totalLengthM > 0 ? totalLengthM / rawTotal : 1;
  return nodes.map((n, i) => ({
    ...n,
    index: i + 1,
    chainageM: Number((rawCum[i] * scale).toFixed(1)),
  }));
}

export function createSnapshotFromState(
  shafts: ShaftRecord[],
  pumpLayersDone: boolean[],
  label: string,
  date: string,
  pumpMachineRoomStatus?: WorkStatus,
  pumpSinkingStatus?: WorkStatus,
  wb?: WbSectionData,
  wc?: WcSectionData
): PeriodBaseline {
  const map: Record<string, ShaftSnapshotItem> = {};
  for (const s of shafts) {
    map[s.id] = {
      layerFlags: s.layerFlags.slice(0, s.totalLayers),
      bottomSlabDone: s.bottomSlabDone,
      castingPct: s.castingPct,
      precastPct: s.precastPct,
      tunnelPct: s.tunnelPct,
    };
  }
  const wcMap: Record<string, ShaftSnapshotItem> = {};
  if (wc) {
    for (const s of wc.shafts) {
      wcMap[s.id] = {
        layerFlags: s.layerFlags.slice(0, s.totalLayers),
        bottomSlabDone: s.bottomSlabDone,
        castingPct: s.castingPct,
        precastPct: s.precastPct,
        tunnelPct: s.tunnelPct,
      };
    }
  }
  const wbNodesStatus: Record<string, WorkStatus> = {};
  if (wb) {
    for (const n of wb.nodes) {
      wbNodesStatus[n.id] = n.status;
    }
  }
  return {
    label,
    date,
    capturedAt: new Date().toISOString(),
    shafts: map,
    pumpLayersDone: [...pumpLayersDone],
    pumpMachineRoomStatus,
    pumpSinkingStatus,
    wbCompletedLengthM: wb?.completedLengthM,
    wbNodesStatus,
    wcShafts: wcMap,
  };
}

export function snapshotFromSavedFile(file: SavedProgressFile): PeriodBaseline {
  return createSnapshotFromState(
    file.shafts,
    file.pumpStation.layers.map((l) => l.status === 'complete'),
    `${file.name} (${formatDateDisplay(file.date)})`,
    file.date,
    file.pumpStation.machineRoom.status,
    file.pumpStation.sinkingStatus,
    file.wb,
    file.wc
  );
}

export interface ProgressSummary {
  totalShafts: number;
  completedShafts: number;
  ongoingShafts: number;
  remainingShafts: number;

  totalManholes: number;
  completedManholes: number;
  ongoingManholes: number;
  remainingManholes: number;
  castingCompleteCount: number;
  castingOngoingCount: number;
  castingRemainingCount: number;
  precastCompleteCount: number;
  precastOngoingCount: number;
  precastRemainingCount: number;

  totalTunnelLengthM: number;
  completedTunnelLengthM: number;
  tunnelPctOverall: number;

  byDia: Record<string, { totalM: number; completedM: number }>;

  delta: {
    addedLayers: number;
    addedShaftsCompleted: number;
    addedCastingCompleted: number;
    addedCastingOngoing: number;
    addedPrecastCompleted: number;
    addedPrecastOngoing: number;
    addedTunnelM: number;
    addedPumpLayers: number;
  };
}

export function computeSummary(
  shafts: ShaftRecord[],
  baseline?: PeriodBaseline,
  pumpStation?: PumpStationData,
  baselineShaftOverride?: Record<string, ShaftSnapshotItem>,
  diaTotalsOverrideM?: Partial<Record<string, number>>
): ProgressSummary {
  let completedShafts = 0;
  let ongoingShafts = 0;
  let remainingShafts = 0;

  let completedManholes = 0;
  let ongoingManholes = 0;
  let remainingManholes = 0;
  let castingCompleteCount = 0;
  let castingOngoingCount = 0;
  let castingRemainingCount = 0;
  let precastCompleteCount = 0;
  let precastOngoingCount = 0;
  let precastRemainingCount = 0;

  let totalTunnelLengthM = 0;
  let completedTunnelLengthM = 0;

  const byDia: Record<string, { totalM: number; completedM: number }> = {
    DN900: { totalM: 0, completedM: 0 },
    DN1100: { totalM: 0, completedM: 0 },
    DN1600: { totalM: 0, completedM: 0 },
    DN1800: { totalM: 0, completedM: 0 },
    DN2400: { totalM: 0, completedM: 0 },
    DN2600: { totalM: 0, completedM: 0 },
  };

  let addedLayers = 0;
  let addedShaftsCompleted = 0;
  let addedCastingCompleted = 0;
  let addedCastingOngoing = 0;
  let addedPrecastCompleted = 0;
  let addedPrecastOngoing = 0;
  let addedTunnelM = 0;
  let addedPumpLayers = 0;

  const baseMap = baselineShaftOverride || baseline?.shafts;

  for (const s of shafts) {
    const st = getShaftStatus(s);
    if (st === 'complete') completedShafts++;
    else if (st === 'ongoing') ongoingShafts++;
    else remainingShafts++;

    const castSt = getCastingStatus(s);
    if (castSt === 'complete') castingCompleteCount++;
    else if (castSt === 'ongoing') castingOngoingCount++;
    else castingRemainingCount++;

    const ringSt = getRingStatus(s);
    if (ringSt === 'complete') precastCompleteCount++;
    else if (ringSt === 'ongoing') precastOngoingCount++;
    else precastRemainingCount++;

    const mh = getManholeStatus(s);
    if (mh === 'complete') completedManholes++;
    if (castSt === 'ongoing') ongoingManholes++;
    if (mh === 'remaining') remainingManholes++;

    const compM = (s.tunnelLengthM * s.tunnelPct) / 100;
    totalTunnelLengthM += s.tunnelLengthM;
    completedTunnelLengthM += compM;
    if (!byDia[s.pipeDia]) byDia[s.pipeDia] = { totalM: 0, completedM: 0 };
    byDia[s.pipeDia].totalM += s.tunnelLengthM;
    byDia[s.pipeDia].completedM += compM;

    if (baseMap) {
      const b = baseMap[s.id];
      if (b) {
        const curDone = s.layerFlags.slice(0, s.totalLayers).filter(Boolean).length;
        const prevDone = (b.layerFlags || []).slice(0, s.totalLayers).filter(Boolean).length;
        addedLayers += Math.max(0, curDone - prevDone);

        const prevShaftComplete = prevDone >= s.totalLayers && b.bottomSlabDone;
        if (st === 'complete' && !prevShaftComplete) {
          addedShaftsCompleted++;
        }
        if (s.castingPct >= 100 && b.castingPct < 100) addedCastingCompleted++;
        else if (s.castingPct > b.castingPct && s.castingPct < 100) addedCastingOngoing++;
        if (s.precastPct >= 100 && b.precastPct < 100) addedPrecastCompleted++;
        else if (s.precastPct > b.precastPct && s.precastPct < 100) addedPrecastOngoing++;
        addedTunnelM += Math.max(
          0,
          (s.tunnelLengthM * (s.tunnelPct - b.tunnelPct)) / 100
        );
      }
    }
  }

  // Apply explicit diameter total length overrides (e.g. DN1600 = 2630m = 2.63 km)
  if (diaTotalsOverrideM) {
    let deltaTotal = 0;
    for (const [dia, overrideVal] of Object.entries(diaTotalsOverrideM)) {
      if (typeof overrideVal === 'number' && Number.isFinite(overrideVal) && overrideVal > 0) {
        if (!byDia[dia]) byDia[dia] = { totalM: 0, completedM: 0 };
        if (byDia[dia].totalM > 0 || shafts.some((s) => s.pipeDia === dia)) {
          deltaTotal += overrideVal - byDia[dia].totalM;
          byDia[dia].totalM = overrideVal;
        }
      }
    }
    totalTunnelLengthM = Math.max(0, totalTunnelLengthM + deltaTotal);
  }

  if (baseline && pumpStation) {
    pumpStation.layers.forEach((l, i) => {
      const wasDone = Boolean(baseline.pumpLayersDone?.[i]);
      if (l.status === 'complete' && !wasDone) addedPumpLayers++;
    });
  }

  return {
    totalShafts: shafts.length,
    completedShafts,
    ongoingShafts,
    remainingShafts,
    totalManholes: shafts.length,
    completedManholes,
    ongoingManholes,
    remainingManholes,
    castingCompleteCount,
    castingOngoingCount,
    castingRemainingCount,
    precastCompleteCount,
    precastOngoingCount,
    precastRemainingCount,
    totalTunnelLengthM,
    completedTunnelLengthM,
    tunnelPctOverall:
      totalTunnelLengthM > 0
        ? (completedTunnelLengthM / totalTunnelLengthM) * 100
        : 0,
    byDia,
    delta: {
      addedLayers,
      addedShaftsCompleted,
      addedCastingCompleted,
      addedCastingOngoing,
      addedPrecastCompleted,
      addedPrecastOngoing,
      addedTunnelM,
      addedPumpLayers,
    },
  };
}

export function resizeShaftLayers(
  oldFlags: boolean[],
  newTotalLayers: number,
  minLayers = 4
): boolean[] {
  const clamped = Math.max(minLayers, Math.min(13, Math.round(newTotalLayers)));
  const res: boolean[] = [];
  for (let i = 0; i < clamped; i++) {
    res.push(Boolean(oldFlags[i]));
  }
  return res;
}

export function normalizeShaftSheetPile(shafts: ShaftRecord[]): ShaftRecord[] {
  return shafts.map((s) => {
    if ((s.id === 'WA-33' || s.id === 'WA-34') && s.sheetPileStyle && s.totalLayers === 12) {
      const done = s.layerFlags.slice(0, 12).filter(Boolean).length;
      const divDone = Math.max(0, Math.min(4, Math.round((done / 12) * 4)));
      return {
        ...s,
        totalLayers: 4,
        layerFlags: Array.from({ length: 4 }, (_, i) => i < divDone),
      };
    }
    return s;
  });
}

function normalizeBaselineSheetPile(
  base: PeriodBaseline | undefined,
  fallback: PeriodBaseline
): PeriodBaseline {
  const src = base || fallback;
  const shaftsMap: Record<string, ShaftSnapshotItem> = {};
  for (const [id, snap] of Object.entries(src.shafts || {})) {
    if ((id === 'WA-33' || id === 'WA-34') && snap.layerFlags?.length === 12) {
      const done = snap.layerFlags.filter(Boolean).length;
      const divDone = Math.max(0, Math.min(4, Math.round((done / 12) * 4)));
      shaftsMap[id] = {
        ...snap,
        layerFlags: Array.from({ length: 4 }, (_, i) => i < divDone),
      };
    } else {
      shaftsMap[id] = snap;
    }
  }
  return { ...src, shafts: shaftsMap };
}

export function normalizePumpStation(
  raw: Partial<PumpStationData> | undefined,
  fallback: PumpStationData
): PumpStationData {
  if (!raw) return JSON.parse(JSON.stringify(fallback));
  const layers =
    Array.isArray(raw.layers) && raw.layers.length > 0
      ? raw.layers.map((ly, i) => ({
          name: ly.name || `${i + 1} Layer`,
          sDate: ly.sDate || '',
          eDate: ly.eDate || '',
          status:
            ly.status ||
            (ly.done ? 'complete' : ly.sDate ? 'ongoing' : 'remaining'),
        }))
      : JSON.parse(JSON.stringify(fallback.layers));

  const totalH = Number(raw.totalHeightM ?? fallback.totalHeightM);
  const sinkM = Number(raw.sinkingCompletedM ?? fallback.sinkingCompletedM);
  const inferredSink: WorkStatus =
    sinkM >= totalH && totalH > 0
      ? 'complete'
      : sinkM > 0
      ? 'ongoing'
      : 'remaining';

  return {
    totalHeightM: totalH,
    castingCompleteM: Number(
      raw.castingCompleteM ?? raw.completedHeightM ?? fallback.castingCompleteM
    ),
    sinkingCompletedM: sinkM,
    sinkingStatus: raw.sinkingStatus || fallback.sinkingStatus || inferredSink,
    layers,
    machineRoom: {
      status: raw.machineRoom?.status || fallback.machineRoom.status,
      sDate: raw.machineRoom?.sDate ?? fallback.machineRoom.sDate,
      eDate: raw.machineRoom?.eDate ?? fallback.machineRoom.eDate,
    },
  };
}

export function normalizeWbData(
  raw: Partial<WbSectionData> | undefined,
  fallback: WbSectionData
): WbSectionData {
  if (!raw || !Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    return JSON.parse(JSON.stringify(fallback));
  }
  return {
    pipeDia: raw.pipeDia || fallback.pipeDia,
    method: raw.method || fallback.method,
    totalLengthM: Number(raw.totalLengthM ?? fallback.totalLengthM),
    completedLengthM: Number(raw.completedLengthM ?? fallback.completedLengthM),
    nodes: raw.nodes.map((n, i) => ({
      id: n.id || `WB${i + 1}`,
      index: n.index ?? i + 1,
      lat: Number(n.lat),
      lon: Number(n.lon),
      chainageM: Number(n.chainageM ?? 0),
      status: n.status || 'remaining',
      sDate: n.sDate || '',
      eDate: n.eDate || '',
      note: n.note || '',
    })),
    washoutCoord: raw.washoutCoord
      ? { lat: Number(raw.washoutCoord.lat), lon: Number(raw.washoutCoord.lon) }
      : { ...(fallback.washoutCoord || DEFAULT_WASHOUT_COORD) },
    airValveCoord: raw.airValveCoord
      ? { lat: Number(raw.airValveCoord.lat), lon: Number(raw.airValveCoord.lon) }
      : { ...(fallback.airValveCoord || DEFAULT_AIR_VALVE_COORD) },
    customPoints: Array.isArray(raw.customPoints) ? raw.customPoints : [],
    customKmlLines: Array.isArray(raw.customKmlLines) ? raw.customKmlLines : [],
  };
}

export function normalizeWcData(
  raw: Partial<WcSectionData> | undefined,
  fallback: WcSectionData
): WcSectionData {
  if (!raw || !Array.isArray(raw.shafts) || raw.shafts.length === 0) {
    return JSON.parse(JSON.stringify(fallback));
  }
  return {
    shafts: raw.shafts,
    geoNodes:
      Array.isArray(raw.geoNodes) && raw.geoNodes.length > 0
        ? raw.geoNodes
        : JSON.parse(JSON.stringify(fallback.geoNodes)),
    customPoints: Array.isArray(raw.customPoints) ? raw.customPoints : [],
    customKmlLines: Array.isArray(raw.customKmlLines) ? raw.customKmlLines : [],
  };
}

export interface DisplayContext {
  displayShafts: ShaftRecord[];
  displayPump: PumpStationData;
  displayWb: WbSectionData;
  displayWc: WcSectionData;
  displayWaGeoNodes: GeoNodeCoord[];
  displaySpsCoord: { lat: number; lon: number };
  displayWaCustomPoints: CustomMapPoint[];
  baseline: PeriodBaseline;
  file1Label: string;
  file2Label: string;
  isFrozenCompare: boolean;
}

export function resolveDisplayContext(state: AppState): DisplayContext {
  const liveWaNodes =
    state.waGeoNodes && state.waGeoNodes.length > 0
      ? state.waGeoNodes
      : INITIAL_WA_GEO_NODES;
  const liveSps = state.spsCoord || GOLAPBAG_SPS_COORD;
  const liveWaCustom = state.waCustomPoints || [];

  if (state.viewMode === 'overall') {
    return {
      displayShafts: state.shafts,
      displayPump: state.pumpStation,
      displayWb: state.wb,
      displayWc: state.wc,
      displayWaGeoNodes: liveWaNodes,
      displaySpsCoord: liveSps,
      displayWaCustomPoints: liveWaCustom,
      baseline: state.weeklyBaseline,
      file1Label: '',
      file2Label: 'Live Workspace',
      isFrozenCompare: false,
    };
  }

  const compare =
    state.viewMode === 'monthly' ? state.monthlyCompare : state.weeklyCompare;
  const fallbackBase =
    state.viewMode === 'monthly' ? state.monthlyBaseline : state.weeklyBaseline;

  const file1 = state.savedFiles.find((f) => f.id === compare?.file1Id);
  const baseline = file1 ? snapshotFromSavedFile(file1) : fallbackBase;
  const file1Label = file1
    ? `${file1.name} (${formatDateDisplay(file1.date)})`
    : fallbackBase.label;

  const file2 =
    compare?.file2Id && compare.file2Id !== LIVE_WORKSPACE_ID
      ? state.savedFiles.find((f) => f.id === compare.file2Id)
      : undefined;

  if (file2) {
    return {
      displayShafts: file2.shafts,
      displayPump: file2.pumpStation,
      displayWb: file2.wb,
      displayWc: file2.wc,
      displayWaGeoNodes:
        file2.waGeoNodes && file2.waGeoNodes.length > 0 ? file2.waGeoNodes : liveWaNodes,
      displaySpsCoord: file2.spsCoord || liveSps,
      displayWaCustomPoints: file2.waCustomPoints || liveWaCustom,
      baseline,
      file1Label,
      file2Label: `${file2.name} (${formatDateDisplay(file2.date)})`,
      isFrozenCompare: true,
    };
  }

  return {
    displayShafts: state.shafts,
    displayPump: state.pumpStation,
    displayWb: state.wb,
    displayWc: state.wc,
    displayWaGeoNodes: liveWaNodes,
    displaySpsCoord: liveSps,
    displayWaCustomPoints: liveWaCustom,
    baseline,
    file1Label,
    file2Label: `Current Workspace (${formatDateDisplay(state.settings.reportDate)})`,
    isFrozenCompare: false,
  };
}

export function sanitizeLoadedState(
  parsed: Partial<AppState>,
  fallback: AppState
): AppState {
  if (!parsed || !Array.isArray(parsed.shafts) || parsed.shafts.length === 0) {
    return fallback;
  }
  const shafts = normalizeShaftSheetPile(parsed.shafts);
  const pumpStation = normalizePumpStation(parsed.pumpStation, fallback.pumpStation);
  const wb = normalizeWbData(parsed.wb, fallback.wb);
  const wc = normalizeWcData(parsed.wc, fallback.wc);
  const waGeoNodes =
    Array.isArray(parsed.waGeoNodes) && parsed.waGeoNodes.length > 0
      ? parsed.waGeoNodes
      : INITIAL_WA_GEO_NODES.map((n) => ({ ...n }));
  const migrateLegacySps = (c?: { lat: number; lon: number }) => {
    if (!c || !Number.isFinite(Number(c.lat)) || !Number.isFinite(Number(c.lon))) {
      return { ...GOLAPBAG_SPS_COORD };
    }
    const lat = Number(c.lat);
    const lon = Number(c.lon);
    if (Math.abs(lat - 23.7195161) < 1e-6 && Math.abs(lon - 90.4326567) < 1e-6) {
      return { ...GOLAPBAG_SPS_COORD };
    }
    return { lat, lon };
  };
  const spsCoord = migrateLegacySps(parsed.spsCoord);
  const waCustomPoints = Array.isArray(parsed.waCustomPoints)
    ? parsed.waCustomPoints
    : [];

  const savedFiles: SavedProgressFile[] =
    Array.isArray(parsed.savedFiles) && parsed.savedFiles.length > 0
      ? parsed.savedFiles.map((f) => ({
          ...f,
          shafts: normalizeShaftSheetPile(f.shafts),
          pumpStation: normalizePumpStation(f.pumpStation, fallback.pumpStation),
          wb: normalizeWbData(f.wb, fallback.wb),
          wc: normalizeWcData(f.wc, fallback.wc),
          waGeoNodes:
            Array.isArray(f.waGeoNodes) && f.waGeoNodes.length > 0
              ? f.waGeoNodes
              : INITIAL_WA_GEO_NODES.map((n) => ({ ...n })),
          spsCoord: migrateLegacySps(f.spsCoord),
          waCustomPoints: Array.isArray(f.waCustomPoints) ? f.waCustomPoints : [],
        }))
      : fallback.savedFiles;

  const rawColors = { ...fallback.colors, ...(parsed.colors || {}) };
  if (rawColors.thisWeekHighlight?.toLowerCase() === '#f59e0b') {
    rawColors.thisWeekHighlight = '#f97316';
  }
  if (rawColors.thisMonthHighlight?.toLowerCase() === '#06b6d4') {
    rawColors.thisMonthHighlight = '#f97316';
  }

  return {
    ...fallback,
    ...parsed,
    shafts,
    activeSection: parsed.activeSection || fallback.activeSection,
    pumpStation,
    wb,
    wc,
    waGeoNodes,
    spsCoord,
    waCustomPoints,
    customView: parsed.customView || fallback.customView,
    savedFiles,
    activeLoadedFileId: parsed.activeLoadedFileId ?? null,
    weeklyCompare: parsed.weeklyCompare || {
      file1Id: savedFiles[0]?.id || '',
      file2Id: LIVE_WORKSPACE_ID,
    },
    monthlyCompare: parsed.monthlyCompare || {
      file1Id: savedFiles[0]?.id || '',
      file2Id: LIVE_WORKSPACE_ID,
    },
    colors: rawColors,
    settings: { ...fallback.settings, ...(parsed.settings || {}) },
    weeklyBaseline: normalizeBaselineSheetPile(parsed.weeklyBaseline, fallback.weeklyBaseline),
    monthlyBaseline: normalizeBaselineSheetPile(parsed.monthlyBaseline, fallback.monthlyBaseline),
    history: Array.isArray(parsed.history) ? parsed.history : fallback.history,
  };
}
