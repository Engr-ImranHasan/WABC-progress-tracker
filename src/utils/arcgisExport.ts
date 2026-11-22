import JSZip from 'jszip';
import {
  AppState,
  GeoNodeCoord,
  PipeDia,
  PumpStationData,
  ShaftRecord,
  ShaftType,
  WbSectionData,
  WcSectionData,
  WorkStatus,
} from '../types';
import {
  GOLAPBAG_SPS_COORD,
  INITIAL_WA_GEO_NODES,
  DEFAULT_AIR_VALVE_COORD,
  DEFAULT_WASHOUT_COORD,
} from '../data/wbcInitialData';
import {
  getManholeStatus,
  getShaftCompletedLayersCount,
  getShaftStatus,
  getTunnelStatus,
  resolveDisplayContext,
} from './calculations';
import { formatDms } from './geoMap';
import { buildWabcAprxUint8Array } from './aprxBuilder';

const WGS84_PRJ_WKT =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

const textEncoder = new TextEncoder();

function formatDmsLatLon(lat: number, lon: number): string {
  return `${formatDms(lat, 'N', 'S')}, ${formatDms(lon, 'E', 'W')}`;
}

export interface DbfFieldSpec {
  name: string; // Max 10 ASCII chars
  type: 'C' | 'N' | 'F';
  length: number;
  decimals?: number;
}

function encodeAscii(str: string, maxBytes: number): Uint8Array {
  const out = new Uint8Array(maxBytes);
  for (let i = 0; i < Math.min(str.length, maxBytes); i++) {
    out[i] = str.charCodeAt(i) & 0x7f;
  }
  return out;
}

function encodeUtf8Fixed(val: unknown, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  out.fill(0x20); // space padded
  const str = val === null || val === undefined ? '' : String(val);
  const raw = textEncoder.encode(str);
  const copyLen = Math.min(raw.length, byteLen);
  // Avoid cutting mid UTF-8 multi-byte sequence
  let safeLen = copyLen;
  if (raw.length > byteLen) {
    while (safeLen > 0 && (raw[safeLen] & 0xc0) === 0x80) {
      safeLen--;
    }
  }
  out.set(raw.subarray(0, safeLen), 0);
  return out;
}

function encodeDbfNumeric(
  val: unknown,
  len: number,
  decimals = 0
): Uint8Array {
  const out = new Uint8Array(len);
  out.fill(0x20);
  const num = Number(val);
  const safeNum = Number.isFinite(num) ? num : 0;
  const formatted =
    decimals > 0 ? safeNum.toFixed(decimals) : String(Math.round(safeNum));
  const clipped =
    formatted.length > len ? formatted.slice(formatted.length - len) : formatted;
  const start = len - clipped.length;
  for (let i = 0; i < clipped.length; i++) {
    out[start + i] = clipped.charCodeAt(i) & 0x7f;
  }
  return out;
}

function buildDbfBytes(
  fields: DbfFieldSpec[],
  rows: Array<Record<string, unknown>>
): Uint8Array {
  const numFields = fields.length;
  const numRecords = rows.length;
  const headerLength = 32 + numFields * 32 + 1;
  const recordLength =
    1 + fields.reduce((acc, f) => acc + Math.max(1, Math.min(254, f.length)), 0);
  const totalBytes = headerLength + numRecords * recordLength + 1;

  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const now = new Date();
  view.setUint8(0, 0x03); // dBASE III+ without DBT
  view.setUint8(1, Math.min(255, Math.max(0, now.getFullYear() - 1900)));
  view.setUint8(2, now.getMonth() + 1);
  view.setUint8(3, now.getDate());
  view.setUint32(4, numRecords, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  view.setUint8(29, 0x00); // Language driver = 0 (paired with .cpg UTF-8)

  // Field descriptors
  for (let fi = 0; fi < numFields; fi++) {
    const f = fields[fi];
    const base = 32 + fi * 32;
    const fLen = Math.max(1, Math.min(254, f.length));
    const nameBytes = encodeAscii(f.name.slice(0, 10), 10);
    bytes.set(nameBytes, base);
    bytes[base + 10] = 0x00;
    bytes[base + 11] = f.type.charCodeAt(0);
    bytes[base + 16] = fLen;
    bytes[base + 17] = f.type === 'C' ? 0 : f.decimals ?? 0;
  }
  bytes[headerLength - 1] = 0x0d; // Header terminator

  // Records
  let offset = headerLength;
  for (let ri = 0; ri < numRecords; ri++) {
    const row = rows[ri];
    bytes[offset] = 0x20; // Not deleted
    let fOff = offset + 1;
    for (let fi = 0; fi < numFields; fi++) {
      const f = fields[fi];
      const fLen = Math.max(1, Math.min(254, f.length));
      const val = row[f.name];
      const encoded =
        f.type === 'C'
          ? encodeUtf8Fixed(val, fLen)
          : encodeDbfNumeric(val, fLen, f.decimals ?? 0);
      bytes.set(encoded, fOff);
      fOff += fLen;
    }
    offset += recordLength;
  }

  bytes[totalBytes - 1] = 0x1a; // EOF marker
  return bytes;
}

interface ShpPointFeature {
  lat: number;
  lon: number;
  props: Record<string, unknown>;
}

interface ShpPolylineFeature {
  coords: Array<[number, number]>; // [lat, lon]
  props: Record<string, unknown>;
}

function writeShpHeader(
  view: DataView,
  wordLength: number,
  shapeType: 1 | 3,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
) {
  view.setInt32(0, 9994, false); // Big-endian file code
  view.setInt32(24, wordLength, false); // Big-endian length in 16-bit words
  view.setInt32(28, 1000, true); // Little-endian version
  view.setInt32(32, shapeType, true); // 1 = Point, 3 = PolyLine
  view.setFloat64(36, minX, true);
  view.setFloat64(44, minY, true);
  view.setFloat64(52, maxX, true);
  view.setFloat64(60, maxY, true);
  view.setFloat64(68, 0, true);
  view.setFloat64(76, 0, true);
  view.setFloat64(84, 0, true);
  view.setFloat64(92, 0, true);
}

function buildPointShapefileFiles(
  features: ShpPointFeature[],
  fields: DbfFieldSpec[]
): {
  shp: Uint8Array;
  shx: Uint8Array;
  dbf: Uint8Array;
  prj: string;
  cpg: string;
} {
  const n = features.length;
  const contentWords = 10; // 4 (shapeType) + 8 (X) + 8 (Y) = 20 bytes = 10 words
  const recBytes = 8 + contentWords * 2; // 28 bytes
  const shpBytes = 100 + n * recBytes;
  const shxBytes = 100 + n * 8;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of features) {
    if (f.lon < minX) minX = f.lon;
    if (f.lon > maxX) maxX = f.lon;
    if (f.lat < minY) minY = f.lat;
    if (f.lat > maxY) maxY = f.lat;
  }
  if (!Number.isFinite(minX)) {
    minX = 90.4;
    maxX = 90.45;
    minY = 23.69;
    maxY = 23.77;
  }

  const shpBuf = new ArrayBuffer(shpBytes);
  const shpView = new DataView(shpBuf);
  writeShpHeader(shpView, shpBytes / 2, 1, minX, minY, maxX, maxY);

  const shxBuf = new ArrayBuffer(shxBytes);
  const shxView = new DataView(shxBuf);
  writeShpHeader(shxView, shxBytes / 2, 1, minX, minY, maxX, maxY);

  for (let i = 0; i < n; i++) {
    const f = features[i];
    const shpOff = 100 + i * recBytes;
    const shxOff = 100 + i * 8;

    shpView.setInt32(shpOff, i + 1, false);
    shpView.setInt32(shpOff + 4, contentWords, false);
    shpView.setInt32(shpOff + 8, 1, true);
    shpView.setFloat64(shpOff + 12, f.lon, true);
    shpView.setFloat64(shpOff + 20, f.lat, true);

    shxView.setInt32(shxOff, shpOff / 2, false);
    shxView.setInt32(shxOff + 4, contentWords, false);
  }

  const dbf = buildDbfBytes(
    fields,
    features.map((f) => f.props)
  );
  return {
    shp: new Uint8Array(shpBuf),
    shx: new Uint8Array(shxBuf),
    dbf,
    prj: WGS84_PRJ_WKT,
    cpg: 'UTF-8',
  };
}

function buildPolylineShapefileFiles(
  features: ShpPolylineFeature[],
  fields: DbfFieldSpec[]
): {
  shp: Uint8Array;
  shx: Uint8Array;
  dbf: Uint8Array;
  prj: string;
  cpg: string;
} {
  const valid = features.filter((f) => f.coords.length >= 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  let totalContentBytes = 0;
  for (const f of valid) {
    for (const [la, lo] of f.coords) {
      if (lo < minX) minX = lo;
      if (lo > maxX) maxX = lo;
      if (la < minY) minY = la;
      if (la > maxY) maxY = la;
    }
    // 4 (shapeType) + 32 (box) + 4 (numParts=1) + 4 (numPts) + 4 (parts[0]=0) + 16*N
    totalContentBytes += 48 + f.coords.length * 16;
  }
  if (!Number.isFinite(minX)) {
    minX = 90.4;
    maxX = 90.45;
    minY = 23.69;
    maxY = 23.77;
  }

  const shpBytes = 100 + valid.length * 8 + totalContentBytes;
  const shxBytes = 100 + valid.length * 8;

  const shpBuf = new ArrayBuffer(shpBytes);
  const shpView = new DataView(shpBuf);
  writeShpHeader(shpView, shpBytes / 2, 3, minX, minY, maxX, maxY);

  const shxBuf = new ArrayBuffer(shxBytes);
  const shxView = new DataView(shxBuf);
  writeShpHeader(shxView, shxBytes / 2, 3, minX, minY, maxX, maxY);

  let shpOff = 100;
  for (let i = 0; i < valid.length; i++) {
    const f = valid[i];
    const numPts = f.coords.length;
    const contentBytes = 48 + numPts * 16;
    const contentWords = contentBytes / 2;

    let bMinX = Infinity;
    let bMinY = Infinity;
    let bMaxX = -Infinity;
    let bMaxY = -Infinity;
    for (const [la, lo] of f.coords) {
      if (lo < bMinX) bMinX = lo;
      if (lo > bMaxX) bMaxX = lo;
      if (la < bMinY) bMinY = la;
      if (la > bMaxY) bMaxY = la;
    }

    const shxOff = 100 + i * 8;
    shxView.setInt32(shxOff, shpOff / 2, false);
    shxView.setInt32(shxOff + 4, contentWords, false);

    shpView.setInt32(shpOff, i + 1, false);
    shpView.setInt32(shpOff + 4, contentWords, false);
    shpView.setInt32(shpOff + 8, 3, true); // PolyLine
    shpView.setFloat64(shpOff + 12, bMinX, true);
    shpView.setFloat64(shpOff + 20, bMinY, true);
    shpView.setFloat64(shpOff + 28, bMaxX, true);
    shpView.setFloat64(shpOff + 36, bMaxY, true);
    shpView.setInt32(shpOff + 44, 1, true); // NumParts
    shpView.setInt32(shpOff + 48, numPts, true); // NumPoints
    shpView.setInt32(shpOff + 52, 0, true); // Parts[0] = 0

    let ptOff = shpOff + 56;
    for (const [la, lo] of f.coords) {
      shpView.setFloat64(ptOff, lo, true);
      shpView.setFloat64(ptOff + 8, la, true);
      ptOff += 16;
    }
    shpOff += 8 + contentBytes;
  }

  const dbf = buildDbfBytes(
    fields,
    valid.map((f) => f.props)
  );
  return {
    shp: new Uint8Array(shpBuf),
    shx: new Uint8Array(shxBuf),
    dbf,
    prj: WGS84_PRJ_WKT,
    cpg: 'UTF-8',
  };
}

function addShapefileSetToZip(
  zip: JSZip,
  basePath: string,
  bundle: {
    shp: Uint8Array;
    shx: Uint8Array;
    dbf: Uint8Array;
    prj: string;
    cpg: string;
  }
) {
  zip.file(`${basePath}.shp`, bundle.shp);
  zip.file(`${basePath}.shx`, bundle.shx);
  zip.file(`${basePath}.dbf`, bundle.dbf);
  zip.file(`${basePath}.prj`, bundle.prj);
  zip.file(`${basePath}.cpg`, bundle.cpg);
}

const SHAFT_POINT_FIELDS: DbfFieldSpec[] = [
  { name: 'SECTION', type: 'C', length: 6 },
  { name: 'SHAFT_ID', type: 'C', length: 14 },
  { name: 'SHAFT_NO', type: 'N', length: 6, decimals: 0 },
  { name: 'SHAFT_SIZE', type: 'C', length: 18 },
  { name: 'SHAFT_TYPE', type: 'C', length: 22 },
  { name: 'TOT_LAYERS', type: 'N', length: 4, decimals: 0 },
  { name: 'DONE_LAYRS', type: 'N', length: 4, decimals: 0 },
  { name: 'SHAFT_PCT', type: 'F', length: 8, decimals: 2 },
  { name: 'SHFT_STAT', type: 'C', length: 12 },
  { name: 'MH_CAST_PC', type: 'F', length: 8, decimals: 2 },
  { name: 'MH_RING_PC', type: 'F', length: 8, decimals: 2 },
  { name: 'MH_STATUS', type: 'C', length: 12 },
  { name: 'TUN_LEN_M', type: 'F', length: 10, decimals: 2 },
  { name: 'TUN_PCT', type: 'F', length: 8, decimals: 2 },
  { name: 'TUN_DONE_M', type: 'F', length: 10, decimals: 2 },
  { name: 'PIPE_DIA', type: 'C', length: 12 },
  { name: 'TUN_STATUS', type: 'C', length: 12 },
  { name: 'NET_HT_MM', type: 'N', length: 8, decimals: 0 },
  { name: 'BTM_SLB_MM', type: 'N', length: 6, decimals: 0 },
  { name: 'SLAB_DONE', type: 'C', length: 6 },
  { name: 'NEW_PROG', type: 'C', length: 6 },
  { name: 'LATITUDE', type: 'F', length: 12, decimals: 6 },
  { name: 'LONGITUDE', type: 'F', length: 12, decimals: 6 },
  { name: 'DMS_COORD', type: 'C', length: 34 },
  { name: 'RPT_DATE', type: 'C', length: 12 },
  { name: 'REMARKS', type: 'C', length: 80 },
];

const TUNNEL_LINE_FIELDS: DbfFieldSpec[] = [
  { name: 'SECTION', type: 'C', length: 6 },
  { name: 'DRIVE_ID', type: 'C', length: 28 },
  { name: 'FROM_NODE', type: 'C', length: 14 },
  { name: 'TO_NODE', type: 'C', length: 16 },
  { name: 'PIPE_DIA', type: 'C', length: 12 },
  { name: 'TOT_LEN_M', type: 'F', length: 10, decimals: 2 },
  { name: 'TUN_PCT', type: 'F', length: 8, decimals: 2 },
  { name: 'DONE_LEN_M', type: 'F', length: 10, decimals: 2 },
  { name: 'REM_LEN_M', type: 'F', length: 10, decimals: 2 },
  { name: 'TUN_STATUS', type: 'C', length: 12 },
  { name: 'NEW_PROG', type: 'C', length: 6 },
  { name: 'START_DATE', type: 'C', length: 12 },
  { name: 'END_DATE', type: 'C', length: 12 },
  { name: 'RPT_DATE', type: 'C', length: 12 },
];

const SPS_POINT_FIELDS: DbfFieldSpec[] = [
  { name: 'SECTION', type: 'C', length: 6 },
  { name: 'FACIL_ID', type: 'C', length: 16 },
  { name: 'NAME', type: 'C', length: 36 },
  { name: 'TOT_HT_M', type: 'F', length: 8, decimals: 2 },
  { name: 'CAST_M', type: 'F', length: 8, decimals: 2 },
  { name: 'SINK_M', type: 'F', length: 8, decimals: 2 },
  { name: 'SINK_STAT', type: 'C', length: 12 },
  { name: 'LOWER_DONE', type: 'N', length: 4, decimals: 0 },
  { name: 'UPPER_STAT', type: 'C', length: 12 },
  { name: 'LATITUDE', type: 'F', length: 12, decimals: 6 },
  { name: 'LONGITUDE', type: 'F', length: 12, decimals: 6 },
  { name: 'DMS_COORD', type: 'C', length: 34 },
  { name: 'RPT_DATE', type: 'C', length: 12 },
];

const WB_NODE_FIELDS: DbfFieldSpec[] = [
  { name: 'SECTION', type: 'C', length: 6 },
  { name: 'NODE_ID', type: 'C', length: 16 },
  { name: 'NODE_TYPE', type: 'C', length: 16 },
  { name: 'CHAINAGE_M', type: 'F', length: 10, decimals: 2 },
  { name: 'PIPE_DIA', type: 'C', length: 14 },
  { name: 'METHOD', type: 'C', length: 16 },
  { name: 'STATUS', type: 'C', length: 12 },
  { name: 'START_DATE', type: 'C', length: 12 },
  { name: 'END_DATE', type: 'C', length: 12 },
  { name: 'LATITUDE', type: 'F', length: 12, decimals: 6 },
  { name: 'LONGITUDE', type: 'F', length: 12, decimals: 6 },
  { name: 'DMS_COORD', type: 'C', length: 34 },
  { name: 'RPT_DATE', type: 'C', length: 12 },
  { name: 'REMARKS', type: 'C', length: 80 },
];

const WB_LINE_FIELDS: DbfFieldSpec[] = [
  { name: 'SECTION', type: 'C', length: 6 },
  { name: 'SEG_ID', type: 'C', length: 24 },
  { name: 'FROM_NODE', type: 'C', length: 14 },
  { name: 'TO_NODE', type: 'C', length: 14 },
  { name: 'FROM_CH_M', type: 'F', length: 10, decimals: 2 },
  { name: 'TO_CH_M', type: 'F', length: 10, decimals: 2 },
  { name: 'SEG_LEN_M', type: 'F', length: 10, decimals: 2 },
  { name: 'PIPE_DIA', type: 'C', length: 14 },
  { name: 'METHOD', type: 'C', length: 16 },
  { name: 'STATUS', type: 'C', length: 12 },
  { name: 'DONE_LEN_M', type: 'F', length: 10, decimals: 2 },
  { name: 'NEW_PROG', type: 'C', length: 6 },
  { name: 'RPT_DATE', type: 'C', length: 12 },
];

const UNIFIED_NODE_FIELDS: DbfFieldSpec[] = [
  { name: 'SECTION', type: 'C', length: 6 },
  { name: 'FEAT_ID', type: 'C', length: 18 },
  { name: 'FEAT_TYPE', type: 'C', length: 18 },
  { name: 'CHAINAGE_M', type: 'F', length: 10, decimals: 2 },
  { name: 'PIPE_DIA', type: 'C', length: 14 },
  { name: 'STATUS', type: 'C', length: 12 },
  { name: 'PCT_DONE', type: 'F', length: 8, decimals: 2 },
  { name: 'SHFT_STAT', type: 'C', length: 12 },
  { name: 'DONE_LAYRS', type: 'N', length: 4, decimals: 0 },
  { name: 'TOT_LAYERS', type: 'N', length: 4, decimals: 0 },
  { name: 'MH_CAST_PC', type: 'F', length: 8, decimals: 2 },
  { name: 'MH_RING_PC', type: 'F', length: 8, decimals: 2 },
  { name: 'TUN_LEN_M', type: 'F', length: 10, decimals: 2 },
  { name: 'TUN_PCT', type: 'F', length: 8, decimals: 2 },
  { name: 'NEW_PROG', type: 'C', length: 6 },
  { name: 'LATITUDE', type: 'F', length: 12, decimals: 6 },
  { name: 'LONGITUDE', type: 'F', length: 12, decimals: 6 },
  { name: 'DMS_COORD', type: 'C', length: 34 },
  { name: 'RPT_DATE', type: 'C', length: 12 },
  { name: 'REMARKS', type: 'C', length: 80 },
];

const UNIFIED_LINE_FIELDS: DbfFieldSpec[] = [
  { name: 'SECTION', type: 'C', length: 6 },
  { name: 'SEG_ID', type: 'C', length: 28 },
  { name: 'FROM_NODE', type: 'C', length: 14 },
  { name: 'TO_NODE', type: 'C', length: 16 },
  { name: 'METHOD', type: 'C', length: 18 },
  { name: 'PIPE_DIA', type: 'C', length: 14 },
  { name: 'LEN_M', type: 'F', length: 10, decimals: 2 },
  { name: 'PCT_DONE', type: 'F', length: 8, decimals: 2 },
  { name: 'DONE_LEN_M', type: 'F', length: 10, decimals: 2 },
  { name: 'STATUS', type: 'C', length: 12 },
  { name: 'NEW_PROG', type: 'C', length: 6 },
  { name: 'RPT_DATE', type: 'C', length: 12 },
];

function makeShaftDatasets(
  section: 'WA' | 'WC',
  shafts: ShaftRecord[],
  geoNodes: GeoNodeCoord[],
  baselineMap: Record<string, { layerFlags?: boolean[]; castingPct?: number; precastPct?: number; tunnelPct?: number }>,
  viewMode: AppState['viewMode'],
  reportDate: string,
  endTargetCoord?: { id: string; lat: number; lon: number }
) {
  const shaftMap = new Map(shafts.map((s) => [s.id, s]));
  const points: ShpPointFeature[] = [];
  const lines: ShpPolylineFeature[] = [];

  for (let i = 0; i < geoNodes.length; i++) {
    const g = geoNodes[i];
    const s = shaftMap.get(g.id);
    if (!s) continue;
    const doneLayers = getShaftCompletedLayersCount(s);
    const totLayers = s.totalLayers || 5;
    const shaftPct = totLayers > 0 ? (doneLayers / totLayers) * 100 : 0;
    const shStat = getShaftStatus(s);
    const mhStat = getManholeStatus(s);
    const tunStat = getTunnelStatus(s);
    const tunDoneM = (s.tunnelLengthM * s.tunnelPct) / 100;
    const bSnap = baselineMap[s.id];
    const hasNew =
      viewMode !== 'overall' &&
      bSnap &&
      (doneLayers > (bSnap.layerFlags || []).filter(Boolean).length ||
        s.castingPct > (bSnap.castingPct ?? 0) ||
        s.precastPct > (bSnap.precastPct ?? 0) ||
        s.tunnelPct > (bSnap.tunnelPct ?? 0));

    points.push({
      lat: g.lat,
      lon: g.lon,
      props: {
        SECTION: section,
        SHAFT_ID: s.id,
        SHAFT_NO: s.index,
        SHAFT_SIZE: s.shaftSize,
        SHAFT_TYPE: s.shaftType,
        TOT_LAYERS: totLayers,
        DONE_LAYRS: doneLayers,
        SHAFT_PCT: Number(shaftPct.toFixed(2)),
        SHFT_STAT: shStat,
        MH_CAST_PC: s.castingPct,
        MH_RING_PC: s.precastPct,
        MH_STATUS: mhStat,
        TUN_LEN_M: s.tunnelLengthM,
        TUN_PCT: s.tunnelPct,
        TUN_DONE_M: Number(tunDoneM.toFixed(2)),
        PIPE_DIA: s.pipeDia,
        TUN_STATUS: tunStat,
        NET_HT_MM: s.netHeightMm,
        BTM_SLB_MM: s.bottomSlabMm,
        SLAB_DONE: s.bottomSlabDone ? 'YES' : 'NO',
        NEW_PROG: hasNew ? 'YES' : 'NO',
        LATITUDE: Number(g.lat.toFixed(6)),
        LONGITUDE: Number(g.lon.toFixed(6)),
        DMS_COORD: formatDmsLatLon(g.lat, g.lon),
        RPT_DATE: reportDate,
        REMARKS: `Next: ${s.nextId} | Height: ${s.netHeightMm}mm`,
      },
    });

    // Outgoing Micro-Tunnel PolyLine segment
    const nextGeo =
      i < geoNodes.length - 1
        ? { id: geoNodes[i + 1].id, lat: geoNodes[i + 1].lat, lon: geoNodes[i + 1].lon }
        : endTargetCoord;
    if (nextGeo) {
      const hasNewTun =
        viewMode !== 'overall' && bSnap && s.tunnelPct > (bSnap.tunnelPct ?? 0);
      lines.push({
        coords: [
          [g.lat, g.lon],
          [nextGeo.lat, nextGeo.lon],
        ],
        props: {
          SECTION: section,
          DRIVE_ID: `${s.id} -> ${nextGeo.id}`,
          FROM_NODE: s.id,
          TO_NODE: nextGeo.id,
          PIPE_DIA: s.pipeDia,
          TOT_LEN_M: s.tunnelLengthM,
          TUN_PCT: s.tunnelPct,
          DONE_LEN_M: Number(tunDoneM.toFixed(2)),
          REM_LEN_M: Number(Math.max(0, s.tunnelLengthM - tunDoneM).toFixed(2)),
          TUN_STATUS: tunStat,
          NEW_PROG: hasNewTun ? 'YES' : 'NO',
          START_DATE: s.tunnelSDate || '',
          END_DATE: s.tunnelEDate || '',
          RPT_DATE: reportDate,
        },
      });
    }
  }

  return { points, lines };
}

function toGeoJsonFeatureCollection(
  features: Array<
    | {
        geometryType: 'Point';
        coords: [number, number]; // [lon, lat]
        properties: Record<string, unknown>;
      }
    | {
        geometryType: 'LineString';
        coords: Array<[number, number]>; // [[lon, lat], ...]
        properties: Record<string, unknown>;
      }
  >,
  layerName: string
) {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: layerName,
      crs: {
        type: 'name',
        properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
      },
      features: features.map((f, idx) => ({
        type: 'Feature',
        id: idx + 1,
        geometry: {
          type: f.geometryType,
          coordinates: f.coords,
        },
        properties: f.properties,
      })),
    },
    null,
    2
  );
}

function buildCsvContent(
  headers: string[],
  rows: Array<Record<string, unknown>>
): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

function buildArcPyLoaderScript(): string {
  return `# -*- coding: utf-8 -*-
"""
WABC Progress Studio — ArcGIS Pro Auto-Loader & Symbology Script
Project: Dhaka Sanitation Improvement Project (DSIP Package WD-02)

HOW TO USE IN ARCGIS PRO:
1. Extract this ZIP folder completely (e.g. C:/GIS/WABC_Package).
2. Open ArcGIS Pro -> View -> Python Window (or Insert -> New Notebook).
3. Run:
     import os, sys
     exec(open(r"C:/GIS/WABC_Package/06_ArcGIS_Pro_Tools/Load_WABC_Layers_ArcGIS_Pro.py", encoding="utf-8").read())
   (Or open this file directly in ArcGIS Pro Notebook and click Run.)
"""
import os
import arcpy

def load_wabc_package():
    aprx = arcpy.mp.ArcGISProject("CURRENT")
    m = aprx.activeMap
    if m is None:
        raise RuntimeError("Please open a Map view in ArcGIS Pro before running this script.")

    try:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    except NameError:
        # Fallback when pasted directly into ArcGIS Pro Python Window
        base_dir = os.getcwd()

    layers_to_add = [
        ("01_WA_Section", "WA_Tunnels.shp"),
        ("01_WA_Section", "WA_Shafts.shp"),
        ("01_WA_Section", "WA_Golapbag_SPS.shp"),
        ("02_WB_Section", "WB_Pipeline.shp"),
        ("02_WB_Section", "WB_Nodes.shp"),
        ("03_WC_Section", "WC_Tunnels.shp"),
        ("03_WC_Section", "WC_Shafts.shp"),
        ("04_Combined_WABC", "WABC_All_Alignments.shp"),
        ("04_Combined_WABC", "WABC_All_Nodes.shp"),
    ]

    status_colors = {
        "complete": {"RGB": [22, 163, 74, 100]},
        "ongoing": {"RGB": [37, 99, 235, 100]},
        "remaining": {"RGB": [220, 38, 38, 100]},
    }

    added = []
    for sub, shp_name in layers_to_add:
        shp_path = os.path.join(base_dir, sub, shp_name)
        if not os.path.exists(shp_path):
            continue
        lyr = m.addDataFromPath(shp_path)
        added.append(lyr)

        # Configure Unique Value Symbology by status field
        field_names = [f.name for f in arcpy.ListFields(lyr)]
        sym_field = (
            "SHFT_STAT" if "SHFT_STAT" in field_names
            else "TUN_STATUS" if "TUN_STATUS" in field_names
            else "STATUS" if "STATUS" in field_names
            else None
        )
        if sym_field:
            sym = lyr.symbology
            if hasattr(sym, "updateRenderer"):
                sym.updateRenderer("UniqueValueRenderer")
                sym.renderer.fields = [sym_field]
                for grp in sym.renderer.groups:
                    for item in grp.items:
                        val = str(item.values[0][0]).lower()
                        if val in status_colors:
                            item.symbol.color = status_colors[val]
                lyr.symbology = sym

        # Enable clean ID labels
        lbl_field = (
            "SHAFT_ID" if "SHAFT_ID" in field_names
            else "NODE_ID" if "NODE_ID" in field_names
            else "FEAT_ID" if "FEAT_ID" in field_names
            else None
        )
        if lbl_field and lyr.supports("SHOWLABELS"):
            lyr.showLabels = True
            for lc in lyr.listLabelClasses():
                lc.expression = f"$feature.{lbl_field}"

    print(f"Loaded {len(added)} WABC layers into ArcGIS Pro map '{m.name}'.")

if __name__ == "__main__":
    load_wabc_package()
`;
}

function buildReadmeGuide(state: AppState): string {
  return `===============================================================================
WABC PROGRESS STUDIO — ARCGIS PRO PROFESSIONAL GIS PACKAGE
Project : ${state.settings.projectTitle}
Drawing : ${state.settings.drawingNo} (${state.settings.revision})
Date    : ${state.settings.reportDate}
Mode    : ${state.viewMode.toUpperCase()}
Coord   : GCS_WGS_1984 (EPSG:4326) | UTF-8
===============================================================================

1. FOLDER STRUCTURE
-------------------
  WABC_Progress_Maps.aprx  <- DOUBLE-CLICK TO OPEN IN ARCGIS PRO 3.x!
                              Includes 4 Maps (WA Map, WB Map, WC Map, WABC All Sections)
                              + 5 Print Layouts (WABC_3Map_Layout, WABC_3Map_Vector_Layout,
                                WA_Layout, WB_Layout, WC_Layout) with World Topographic
                                Basemap, Shapefile symbology, Maplex labels & scalebars.

  01_WA_Section/
    - WA_Shafts.shp        (Point: 37 shafts WA-1..WA-36 + WA-24.1)
    - WA_Tunnels.shp       (Polyline: 37 micro-tunnel drives to Golapbag SPS)
    - WA_Golapbag_SPS.shp  (Point: Golapbag Pump Station Lower + Upper Room)

  02_WB_Section/
    - WB_Nodes.shp         (Point: WB1..WB38 + Washout + Air Valve)
    - WB_Pipeline.shp      (Polyline: 37 Open-Cut DN1200 GRP segments)

  03_WC_Section/
    - WC_Shafts.shp        (Point: 27 shafts WC-1..WC-27)
    - WC_Tunnels.shp       (Polyline: 26 micro-tunnel drives WC-1..WC-27)

  04_Combined_WABC/
    - WABC_All_Nodes.shp       (Unified Point Layer with SECTION = WA/WB/WC)
    - WABC_All_Alignments.shp  (Unified Polyline Layer with SECTION = WA/WB/WC)

  05_GeoJSON/
    - Full-field RFC 7946 GeoJSON layers for ArcGIS Pro / QGIS / round-trip
      import back into WABC Progress Studio.

  06_ArcGIS_Pro_Tools/
    - Load_WABC_Layers_ArcGIS_Pro.py        (One-click ArcPy Map + Symbology loader)
    - WABC_Editable_Master_Attributes.csv   (Editable master attribute spreadsheet)

2. HOW TO OPEN & EDIT FIELDS IN ARCGIS PRO
------------------------------------------
  A) Direct One-Click Project Open (Recommended):
     - Extract the entire ZIP archive to a folder (keeping WABC_Progress_Maps.aprx
       alongside 01_WA_Section/, 02_WB_Section/, 03_WC_Section/, 04_Combined_WABC/).
     - Double-click WABC_Progress_Maps.aprx to open in ArcGIS Pro 3.x:
       * 'WABC_3Map_Layout' displays WA, WB, and WC side-by-side over Esri World
         Topographic Basemap with scalebars, north arrow, legend, and live layers.
       * 'WABC_3Map_Vector_Layout' contains native CIM graphic elements & labels.
       * 'WA_Layout', 'WB_Layout', and 'WC_Layout' open full portrait A1 layouts.
     - Or use Map -> Add Data -> Data to add individual Shapefiles directly.

  B) Editable Fields (WA / WB / WC):
     - WA & WC Shafts:
         SECTION, SHAFT_ID, SHAFT_NO, SHAFT_SIZE, SHAFT_TYPE,
         TOT_LAYERS, DONE_LAYRS, SHAFT_PCT, SHFT_STAT ('complete'|'ongoing'|'remaining'),
         MH_CAST_PC (0-100), MH_RING_PC (0-100), MH_STATUS,
         TUN_LEN_M, TUN_PCT (0-100), TUN_DONE_M, PIPE_DIA, TUN_STATUS,
         NEW_PROG ('YES'|'NO'), LATITUDE, LONGITUDE, REMARKS
     - WA & WC Tunnels:
         SECTION, DRIVE_ID, FROM_NODE, TO_NODE, PIPE_DIA, TOT_LEN_M,
         TUN_PCT, DONE_LEN_M, REM_LEN_M, TUN_STATUS, NEW_PROG, START_DATE, END_DATE
     - WB Open-Cut Nodes & Pipeline:
         SECTION, NODE_ID, NODE_TYPE, CHAINAGE_M, PIPE_DIA, METHOD,
         STATUS ('complete'|'ongoing'|'remaining'), LATITUDE, LONGITUDE, REMARKS
     - Combined Table (WABC_All_Nodes):
         Filter by SECTION ('WA', 'WB', or 'WC') and edit any progress or coordinate field!

  C) Editing & Updating in ArcGIS Pro:
     - Select rows or features -> Edit tab -> Attributes pane (or Calculate Field
       in the Attribute Table). Save edits via Edit -> Save.
     - To prevent label collisions in ArcGIS Pro: Layer -> Labeling -> More ->
       Use Maplex Label Engine (enable "Never remove (place overlapping)" = OFF).

  D) Syncing Edits Back to WABC Progress Studio:
     - Export edited layer from ArcGIS Pro using Geoprocessing -> Features To JSON
       (check "Output to GeoJSON"), or edit any file in 05_GeoJSON/.
     - In WABC Progress Studio: Export -> Import ArcGIS GeoJSON (.geojson) to apply
       all WA / WB / WC field updates immediately!
`;
}

export async function exportArcGisProPackage(state: AppState): Promise<void> {
  const {
    displayShafts: waShafts,
    displayPump: pump,
    displayWb: wb,
    displayWc: wc,
    displayWaGeoNodes: waGeoNodes,
    displaySpsCoord: spsCoord,
    displayWaCustomPoints: waCustomPoints,
    baseline,
  } = resolveDisplayContext(state);

  const reportDate = state.settings.reportDate || new Date().toISOString().slice(0, 10);
  const viewMode = state.viewMode;

  const waData = makeShaftDatasets(
    'WA',
    waShafts,
    waGeoNodes.length > 0 ? waGeoNodes : INITIAL_WA_GEO_NODES,
    baseline.shafts,
    viewMode,
    reportDate,
    { id: 'GOLAPBAG-SPS', lat: spsCoord.lat, lon: spsCoord.lon }
  );
  const wcData = makeShaftDatasets(
    'WC',
    wc.shafts,
    wc.geoNodes,
    baseline.wcShafts || {},
    viewMode,
    reportDate
  );

  // WA Golapbag SPS Point
  const spsFeature: ShpPointFeature = {
    lat: spsCoord.lat,
    lon: spsCoord.lon,
    props: {
      SECTION: 'WA',
      FACIL_ID: 'GOLAPBAG-SPS',
      NAME: 'Golapbag SPS (Pump Station)',
      TOT_HT_M: pump.totalHeightM,
      CAST_M: pump.castingCompleteM,
      SINK_M: pump.sinkingCompletedM,
      SINK_STAT: pump.sinkingStatus,
      LOWER_DONE: pump.layers.filter((l) => l.status === 'complete').length,
      UPPER_STAT: pump.machineRoom.status,
      LATITUDE: Number(spsCoord.lat.toFixed(6)),
      LONGITUDE: Number(spsCoord.lon.toFixed(6)),
      DMS_COORD: formatDmsLatLon(spsCoord.lat, spsCoord.lon),
      RPT_DATE: reportDate,
    },
  };

  // WB Nodes + Appurtenances
  const washCoord = wb.washoutCoord || DEFAULT_WASHOUT_COORD;
  const airCoord = wb.airValveCoord || DEFAULT_AIR_VALVE_COORD;
  const wbPoints: ShpPointFeature[] = [
    ...wb.nodes.map((n) => ({
      lat: n.lat,
      lon: n.lon,
      props: {
        SECTION: 'WB',
        NODE_ID: n.id,
        NODE_TYPE: 'Pipeline Node',
        CHAINAGE_M: n.chainageM,
        PIPE_DIA: wb.pipeDia,
        METHOD: wb.method,
        STATUS: n.status,
        START_DATE: n.sDate || '',
        END_DATE: n.eDate || '',
        LATITUDE: Number(n.lat.toFixed(6)),
        LONGITUDE: Number(n.lon.toFixed(6)),
        DMS_COORD: formatDmsLatLon(n.lat, n.lon),
        RPT_DATE: reportDate,
        REMARKS: n.note || '',
      },
    })),
    {
      lat: washCoord.lat,
      lon: washCoord.lon,
      props: {
        SECTION: 'WB',
        NODE_ID: 'WASHOUT',
        NODE_TYPE: 'Washout Valve',
        CHAINAGE_M: 0,
        PIPE_DIA: wb.pipeDia,
        METHOD: wb.method,
        STATUS: 'complete',
        START_DATE: '',
        END_DATE: '',
        LATITUDE: Number(washCoord.lat.toFixed(6)),
        LONGITUDE: Number(washCoord.lon.toFixed(6)),
        DMS_COORD: formatDmsLatLon(washCoord.lat, washCoord.lon),
        RPT_DATE: reportDate,
        REMARKS: 'Washout Chamber',
      },
    },
    {
      lat: airCoord.lat,
      lon: airCoord.lon,
      props: {
        SECTION: 'WB',
        NODE_ID: 'AIR-VALVE',
        NODE_TYPE: 'Air Valve',
        CHAINAGE_M: 0,
        PIPE_DIA: wb.pipeDia,
        METHOD: wb.method,
        STATUS: 'complete',
        START_DATE: '',
        END_DATE: '',
        LATITUDE: Number(airCoord.lat.toFixed(6)),
        LONGITUDE: Number(airCoord.lon.toFixed(6)),
        DMS_COORD: formatDmsLatLon(airCoord.lat, airCoord.lon),
        RPT_DATE: reportDate,
        REMARKS: 'Air Valve Chamber',
      },
    },
  ];

  // WB Pipeline Segments
  const wbLines: ShpPolylineFeature[] = [];
  for (let i = 0; i < wb.nodes.length - 1; i++) {
    const a = wb.nodes[i];
    const b = wb.nodes[i + 1];
    const segLen = Math.max(0, b.chainageM - a.chainageM);
    const segDone =
      wb.completedLengthM >= b.chainageM
        ? segLen
        : wb.completedLengthM <= a.chainageM
        ? 0
        : wb.completedLengthM - a.chainageM;
    const segStat: WorkStatus =
      segDone >= segLen - 0.01 && segLen > 0
        ? 'complete'
        : segDone > 0 || a.status === 'ongoing' || b.status === 'ongoing'
        ? 'ongoing'
        : 'remaining';
    const hasNew =
      viewMode !== 'overall' &&
      baseline.wbCompletedLengthM !== undefined &&
      wb.completedLengthM > baseline.wbCompletedLengthM &&
      b.chainageM > baseline.wbCompletedLengthM &&
      a.chainageM < wb.completedLengthM;

    wbLines.push({
      coords: [
        [a.lat, a.lon],
        [b.lat, b.lon],
      ],
      props: {
        SECTION: 'WB',
        SEG_ID: `${a.id}->${b.id}`,
        FROM_NODE: a.id,
        TO_NODE: b.id,
        FROM_CH_M: a.chainageM,
        TO_CH_M: b.chainageM,
        SEG_LEN_M: Number(segLen.toFixed(2)),
        PIPE_DIA: wb.pipeDia,
        METHOD: wb.method,
        STATUS: segStat,
        DONE_LEN_M: Number(segDone.toFixed(2)),
        NEW_PROG: hasNew ? 'YES' : 'NO',
        RPT_DATE: reportDate,
      },
    });
  }

  // Unified WABC Nodes (WA + WB + WC + Golapbag SPS + Custom Points)
  const unifiedPoints: ShpPointFeature[] = [
    ...waData.points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      props: {
        SECTION: 'WA',
        FEAT_ID: p.props.SHAFT_ID,
        FEAT_TYPE: `Shaft (${p.props.SHAFT_TYPE})`,
        CHAINAGE_M: 0,
        PIPE_DIA: p.props.PIPE_DIA,
        STATUS: p.props.SHFT_STAT,
        PCT_DONE: p.props.SHAFT_PCT,
        SHFT_STAT: p.props.SHFT_STAT,
        DONE_LAYRS: p.props.DONE_LAYRS,
        TOT_LAYERS: p.props.TOT_LAYERS,
        MH_CAST_PC: p.props.MH_CAST_PC,
        MH_RING_PC: p.props.MH_RING_PC,
        TUN_LEN_M: p.props.TUN_LEN_M,
        TUN_PCT: p.props.TUN_PCT,
        NEW_PROG: p.props.NEW_PROG,
        LATITUDE: p.props.LATITUDE,
        LONGITUDE: p.props.LONGITUDE,
        DMS_COORD: p.props.DMS_COORD,
        RPT_DATE: reportDate,
        REMARKS: p.props.REMARKS,
      },
    })),
    {
      lat: spsFeature.lat,
      lon: spsFeature.lon,
      props: {
        SECTION: 'WA',
        FEAT_ID: 'GOLAPBAG-SPS',
        FEAT_TYPE: 'Pump Station',
        CHAINAGE_M: 0,
        PIPE_DIA: 'SPS',
        STATUS: pump.sinkingStatus,
        PCT_DONE: Number(
          (
            (pump.sinkingCompletedM / Math.max(0.1, pump.totalHeightM)) *
            100
          ).toFixed(2)
        ),
        SHFT_STAT: pump.sinkingStatus,
        DONE_LAYRS: pump.layers.filter((l) => l.status === 'complete').length,
        TOT_LAYERS: 5,
        MH_CAST_PC: Number(
          ((pump.castingCompleteM / Math.max(0.1, pump.totalHeightM)) * 100).toFixed(2)
        ),
        MH_RING_PC: pump.machineRoom.status === 'complete' ? 100 : 0,
        TUN_LEN_M: 0,
        TUN_PCT: 0,
        NEW_PROG: 'NO',
        LATITUDE: spsFeature.props.LATITUDE,
        LONGITUDE: spsFeature.props.LONGITUDE,
        DMS_COORD: spsFeature.props.DMS_COORD,
        RPT_DATE: reportDate,
        REMARKS: `Lower Cast ${pump.castingCompleteM}m | Sink ${pump.sinkingCompletedM}/${pump.totalHeightM}m`,
      },
    },
    ...wbPoints.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      props: {
        SECTION: 'WB',
        FEAT_ID: p.props.NODE_ID,
        FEAT_TYPE: p.props.NODE_TYPE,
        CHAINAGE_M: p.props.CHAINAGE_M,
        PIPE_DIA: p.props.PIPE_DIA,
        STATUS: p.props.STATUS,
        PCT_DONE: p.props.STATUS === 'complete' ? 100 : p.props.STATUS === 'ongoing' ? 50 : 0,
        SHFT_STAT: p.props.STATUS,
        DONE_LAYRS: 0,
        TOT_LAYERS: 0,
        MH_CAST_PC: 0,
        MH_RING_PC: 0,
        TUN_LEN_M: 0,
        TUN_PCT: 0,
        NEW_PROG: 'NO',
        LATITUDE: p.props.LATITUDE,
        LONGITUDE: p.props.LONGITUDE,
        DMS_COORD: p.props.DMS_COORD,
        RPT_DATE: reportDate,
        REMARKS: p.props.REMARKS,
      },
    })),
    ...wcData.points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      props: {
        SECTION: 'WC',
        FEAT_ID: p.props.SHAFT_ID,
        FEAT_TYPE: `Shaft (${p.props.SHAFT_TYPE})`,
        CHAINAGE_M: 0,
        PIPE_DIA: p.props.PIPE_DIA,
        STATUS: p.props.SHFT_STAT,
        PCT_DONE: p.props.SHAFT_PCT,
        SHFT_STAT: p.props.SHFT_STAT,
        DONE_LAYRS: p.props.DONE_LAYRS,
        TOT_LAYERS: p.props.TOT_LAYERS,
        MH_CAST_PC: p.props.MH_CAST_PC,
        MH_RING_PC: p.props.MH_RING_PC,
        TUN_LEN_M: p.props.TUN_LEN_M,
        TUN_PCT: p.props.TUN_PCT,
        NEW_PROG: p.props.NEW_PROG,
        LATITUDE: p.props.LATITUDE,
        LONGITUDE: p.props.LONGITUDE,
        DMS_COORD: p.props.DMS_COORD,
        RPT_DATE: reportDate,
        REMARKS: p.props.REMARKS,
      },
    })),
  ];

  // Unified WABC Alignments (WA + WB + WC)
  const unifiedLines: ShpPolylineFeature[] = [
    ...waData.lines.map((l) => ({
      coords: l.coords,
      props: {
        SECTION: 'WA',
        SEG_ID: l.props.DRIVE_ID,
        FROM_NODE: l.props.FROM_NODE,
        TO_NODE: l.props.TO_NODE,
        METHOD: 'Micro-Tunnelling',
        PIPE_DIA: l.props.PIPE_DIA,
        LEN_M: l.props.TOT_LEN_M,
        PCT_DONE: l.props.TUN_PCT,
        DONE_LEN_M: l.props.DONE_LEN_M,
        STATUS: l.props.TUN_STATUS,
        NEW_PROG: l.props.NEW_PROG,
        RPT_DATE: reportDate,
      },
    })),
    ...wbLines.map((l) => ({
      coords: l.coords,
      props: {
        SECTION: 'WB',
        SEG_ID: l.props.SEG_ID,
        FROM_NODE: l.props.FROM_NODE,
        TO_NODE: l.props.TO_NODE,
        METHOD: String(l.props.METHOD || 'Open Cut'),
        PIPE_DIA: l.props.PIPE_DIA,
        LEN_M: l.props.SEG_LEN_M,
        PCT_DONE:
          Number(l.props.SEG_LEN_M) > 0
            ? Number(
                ((Number(l.props.DONE_LEN_M) / Number(l.props.SEG_LEN_M)) * 100).toFixed(2)
              )
            : 0,
        DONE_LEN_M: l.props.DONE_LEN_M,
        STATUS: l.props.STATUS,
        NEW_PROG: l.props.NEW_PROG,
        RPT_DATE: reportDate,
      },
    })),
    ...wcData.lines.map((l) => ({
      coords: l.coords,
      props: {
        SECTION: 'WC',
        SEG_ID: l.props.DRIVE_ID,
        FROM_NODE: l.props.FROM_NODE,
        TO_NODE: l.props.TO_NODE,
        METHOD: 'Micro-Tunnelling',
        PIPE_DIA: l.props.PIPE_DIA,
        LEN_M: l.props.TOT_LEN_M,
        PCT_DONE: l.props.TUN_PCT,
        DONE_LEN_M: l.props.DONE_LEN_M,
        STATUS: l.props.TUN_STATUS,
        NEW_PROG: l.props.NEW_PROG,
        RPT_DATE: reportDate,
      },
    })),
  ];

  const zip = new JSZip();

  // Shapefiles (.shp + .shx + .dbf + .prj + .cpg)
  addShapefileSetToZip(
    zip,
    '01_WA_Section/WA_Shafts',
    buildPointShapefileFiles(waData.points, SHAFT_POINT_FIELDS)
  );
  addShapefileSetToZip(
    zip,
    '01_WA_Section/WA_Tunnels',
    buildPolylineShapefileFiles(waData.lines, TUNNEL_LINE_FIELDS)
  );
  addShapefileSetToZip(
    zip,
    '01_WA_Section/WA_Golapbag_SPS',
    buildPointShapefileFiles([spsFeature], SPS_POINT_FIELDS)
  );
  addShapefileSetToZip(
    zip,
    '02_WB_Section/WB_Nodes',
    buildPointShapefileFiles(wbPoints, WB_NODE_FIELDS)
  );
  addShapefileSetToZip(
    zip,
    '02_WB_Section/WB_Pipeline',
    buildPolylineShapefileFiles(wbLines, WB_LINE_FIELDS)
  );
  addShapefileSetToZip(
    zip,
    '03_WC_Section/WC_Shafts',
    buildPointShapefileFiles(wcData.points, SHAFT_POINT_FIELDS)
  );
  addShapefileSetToZip(
    zip,
    '03_WC_Section/WC_Tunnels',
    buildPolylineShapefileFiles(wcData.lines, TUNNEL_LINE_FIELDS)
  );
  addShapefileSetToZip(
    zip,
    '04_Combined_WABC/WABC_All_Nodes',
    buildPointShapefileFiles(unifiedPoints, UNIFIED_NODE_FIELDS)
  );
  addShapefileSetToZip(
    zip,
    '04_Combined_WABC/WABC_All_Alignments',
    buildPolylineShapefileFiles(unifiedLines, UNIFIED_LINE_FIELDS)
  );

  // Full-Field GeoJSON Layers
  zip.file(
    '05_GeoJSON/WA_Shafts.geojson',
    toGeoJsonFeatureCollection(
      waData.points.map((p) => ({
        geometryType: 'Point' as const,
        coords: [p.lon, p.lat] as [number, number],
        properties: p.props,
      })),
      'WA_Shafts'
    )
  );
  zip.file(
    '05_GeoJSON/WA_Tunnels.geojson',
    toGeoJsonFeatureCollection(
      waData.lines.map((l) => ({
        geometryType: 'LineString' as const,
        coords: l.coords.map(([la, lo]) => [lo, la] as [number, number]),
        properties: l.props,
      })),
      'WA_Tunnels'
    )
  );
  zip.file(
    '05_GeoJSON/WA_Golapbag_SPS.geojson',
    toGeoJsonFeatureCollection(
      [
        {
          geometryType: 'Point' as const,
          coords: [spsFeature.lon, spsFeature.lat] as [number, number],
          properties: spsFeature.props,
        },
      ],
      'WA_Golapbag_SPS'
    )
  );
  zip.file(
    '05_GeoJSON/WB_Nodes.geojson',
    toGeoJsonFeatureCollection(
      wbPoints.map((p) => ({
        geometryType: 'Point' as const,
        coords: [p.lon, p.lat] as [number, number],
        properties: p.props,
      })),
      'WB_Nodes'
    )
  );
  zip.file(
    '05_GeoJSON/WB_Pipeline.geojson',
    toGeoJsonFeatureCollection(
      wbLines.map((l) => ({
        geometryType: 'LineString' as const,
        coords: l.coords.map(([la, lo]) => [lo, la] as [number, number]),
        properties: l.props,
      })),
      'WB_Pipeline'
    )
  );
  zip.file(
    '05_GeoJSON/WC_Shafts.geojson',
    toGeoJsonFeatureCollection(
      wcData.points.map((p) => ({
        geometryType: 'Point' as const,
        coords: [p.lon, p.lat] as [number, number],
        properties: p.props,
      })),
      'WC_Shafts'
    )
  );
  zip.file(
    '05_GeoJSON/WC_Tunnels.geojson',
    toGeoJsonFeatureCollection(
      wcData.lines.map((l) => ({
        geometryType: 'LineString' as const,
        coords: l.coords.map(([la, lo]) => [lo, la] as [number, number]),
        properties: l.props,
      })),
      'WC_Tunnels'
    )
  );
  zip.file(
    '05_GeoJSON/WABC_All_Nodes.geojson',
    toGeoJsonFeatureCollection(
      unifiedPoints.map((p) => ({
        geometryType: 'Point' as const,
        coords: [p.lon, p.lat] as [number, number],
        properties: p.props,
      })),
      'WABC_All_Nodes'
    )
  );
  zip.file(
    '05_GeoJSON/WABC_All_Alignments.geojson',
    toGeoJsonFeatureCollection(
      unifiedLines.map((l) => ({
        geometryType: 'LineString' as const,
        coords: l.coords.map(([la, lo]) => [lo, la] as [number, number]),
        properties: l.props,
      })),
      'WABC_All_Alignments'
    )
  );

  // Optional Custom Points GeoJSON
  const allCustomPts = [
    ...waCustomPoints.map((p) => ({ ...p, section: 'WA' })),
    ...(wb.customPoints || []).map((p) => ({ ...p, section: 'WB' })),
    ...(wc.customPoints || []).map((p) => ({ ...p, section: 'WC' })),
  ];
  if (allCustomPts.length > 0) {
    zip.file(
      '05_GeoJSON/Custom_Points.geojson',
      toGeoJsonFeatureCollection(
        allCustomPts.map((cp) => ({
          geometryType: 'Point' as const,
          coords: [cp.lon, cp.lat] as [number, number],
          properties: {
            SECTION: cp.section,
            POINT_ID: cp.id,
            NAME: cp.name,
            LATITUDE: cp.lat,
            LONGITUDE: cp.lon,
          },
        })),
        'Custom_Points'
      )
    );
  }

  // Direct ArcGIS Pro 3.5.0 Project (.aprx) at root with WA/WB/WC Maps + 3-Map Layout
  const aprxBytes = await buildWabcAprxUint8Array(state, { standalone: false });
  zip.file('WABC_Progress_Maps.aprx', aprxBytes);

  // ArcGIS Pro Automation Script & Master CSV & Guide
  zip.file('06_ArcGIS_Pro_Tools/Load_WABC_Layers_ArcGIS_Pro.py', buildArcPyLoaderScript());
  zip.file(
    '06_ArcGIS_Pro_Tools/WABC_Editable_Master_Attributes.csv',
    buildCsvContent(
      UNIFIED_NODE_FIELDS.map((f) => f.name),
      unifiedPoints.map((p) => p.props)
    )
  );
  zip.file('README_ArcGIS_Pro.txt', buildReadmeGuide(state));

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `WABC-DSIP-WD02-ArcGIS-Pro-Package-${reportDate}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function normStatusVal(raw: unknown): WorkStatus | null {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'complete' || s === 'completed' || s === 'done') return 'complete';
  if (s === 'ongoing' || s === 'on-going' || s === 'in progress' || s === 'in-progress') return 'ongoing';
  if (s === 'remaining' || s === 'not started' || s === 'pending') return 'remaining';
  return null;
}

function clampPctVal(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Number(n.toFixed(2))));
}

function isValidBdLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= 20 &&
    lat <= 27 &&
    lon >= 87 &&
    lon <= 94
  );
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export async function importArcGisDataFile(
  file: File,
  currentState: AppState
): Promise<{
  shafts: ShaftRecord[];
  pumpStation: PumpStationData;
  wb: WbSectionData;
  wc: WcSectionData;
  waGeoNodes: GeoNodeCoord[];
  spsCoord: { lat: number; lon: number };
  updatedCount: number;
}> {
  const text = (await file.text()).replace(/^\uFEFF/, '');
  const lower = file.name.toLowerCase();

  let features: Array<{
    geometry?: { type?: string; coordinates?: unknown } | null;
    properties?: Record<string, unknown> | null;
  }> = [];

  if (lower.endsWith('.csv')) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      throw new Error('CSV file has no data rows');
    }
    const headers = parseCsvRow(lines[0]).map((h) => h.trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvRow(lines[i]);
      const props: Record<string, unknown> = {};
      headers.forEach((h, hi) => {
        props[h] = cols[hi] ?? '';
      });
      const la = Number(props.LATITUDE ?? props.lat ?? props.Lat);
      const lo = Number(props.LONGITUDE ?? props.lon ?? props.Lon);
      features.push({
        geometry:
          isValidBdLatLon(la, lo)
            ? { type: 'Point', coordinates: [lo, la] }
            : null,
        properties: props,
      });
    }
  } else {
    const json = JSON.parse(text) as {
      type?: string;
      features?: Array<{
        geometry?: { type?: string; coordinates?: unknown } | null;
        properties?: Record<string, unknown> | null;
      }>;
    };

    if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
      throw new Error('Not a valid GeoJSON FeatureCollection');
    }
    features = json.features;
  }

  const nextShafts: ShaftRecord[] = JSON.parse(JSON.stringify(currentState.shafts));
  const nextPump: PumpStationData = JSON.parse(JSON.stringify(currentState.pumpStation));
  const nextWb: WbSectionData = JSON.parse(JSON.stringify(currentState.wb));
  const nextWc: WcSectionData = JSON.parse(JSON.stringify(currentState.wc));
  const nextWaGeo: GeoNodeCoord[] = JSON.parse(
    JSON.stringify(
      currentState.waGeoNodes && currentState.waGeoNodes.length > 0
        ? currentState.waGeoNodes
        : INITIAL_WA_GEO_NODES
    )
  );
  let nextSpsCoord = { ...(currentState.spsCoord || GOLAPBAG_SPS_COORD) };

  let updatedCount = 0;

  const applyShaftProps = (
    target: ShaftRecord,
    props: Record<string, unknown>
  ) => {
    const prevDone = getShaftCompletedLayersCount(target);
    const doneLayersRaw = props.DONE_LAYRS ?? props.completedLayers;
    const shStatRaw = normStatusVal(props.SHFT_STAT ?? props.shaftStatus ?? props.STATUS);
    const parsedDone =
      doneLayersRaw !== undefined &&
      doneLayersRaw !== null &&
      String(doneLayersRaw).trim() !== '' &&
      Number.isFinite(Number(doneLayersRaw))
        ? Math.max(0, Math.min(target.totalLayers, Math.round(Number(doneLayersRaw))))
        : null;

    if (parsedDone !== null && parsedDone !== prevDone) {
      target.layerFlags = Array.from({ length: target.totalLayers }, (_, idx) => idx < parsedDone);
    } else if (shStatRaw === 'complete') {
      target.layerFlags = Array.from({ length: target.totalLayers }, () => true);
    } else if (shStatRaw === 'remaining') {
      target.layerFlags = Array.from({ length: target.totalLayers }, () => false);
    } else if (parsedDone !== null) {
      target.layerFlags = Array.from({ length: target.totalLayers }, (_, idx) => idx < parsedDone);
    }

    if (shStatRaw === 'complete') {
      target.bottomSlabDone = true;
    } else if (shStatRaw === 'remaining') {
      target.bottomSlabDone = false;
    }
    const slabFlag = String(props.SLAB_DONE || '').trim().toUpperCase();
    if (slabFlag === 'YES' || slabFlag === 'TRUE' || slabFlag === '1') {
      target.bottomSlabDone = true;
    } else if (slabFlag === 'NO' || slabFlag === 'FALSE' || slabFlag === '0') {
      target.bottomSlabDone = false;
    }

    const mhCast = clampPctVal(props.MH_CAST_PC ?? props.manholeCastingPct);
    if (mhCast !== null) target.castingPct = mhCast;

    const mhRing = clampPctVal(props.MH_RING_PC ?? props.manholeRingPct);
    if (mhRing !== null) target.precastPct = mhRing;

    const tunPct = clampPctVal(props.TUN_PCT ?? props.tunnelPct ?? props.PCT_DONE);
    if (tunPct !== null && (props.TUN_PCT !== undefined || props.tunnelPct !== undefined || props.DRIVE_ID !== undefined)) {
      target.tunnelPct = tunPct;
    }

    const tunLen = Number(props.TUN_LEN_M ?? props.TOT_LEN_M ?? props.LEN_M);
    if (Number.isFinite(tunLen) && tunLen > 0) target.tunnelLengthM = tunLen;

    const dia = props.PIPE_DIA ?? props.pipeDia;
    if (
      typeof dia === 'string' &&
      (['DN900', 'DN1100', 'DN1200', 'DN1600', 'DN1800', 'DN2400', 'DN2600'] as string[]).includes(dia.trim())
    ) {
      target.pipeDia = dia.trim() as PipeDia;
    }

    if (typeof props.SHAFT_SIZE === 'string' && props.SHAFT_SIZE.trim()) {
      target.shaftSize = props.SHAFT_SIZE.trim();
    }
    if (typeof props.SHAFT_TYPE === 'string') {
      const stStr = props.SHAFT_TYPE.trim();
      if (stStr === 'Driving' || stStr === 'Receiving' || stStr === 'Receiving/Driving') {
        target.shaftType = stStr as ShaftType;
      }
    }
  };

  for (const feat of features) {
    const props = feat.properties || {};
    const section = String(props.SECTION || props.section || '').trim().toUpperCase();
    const fid = String(
      props.SHAFT_ID || props.NODE_ID || props.FEAT_ID || props.FROM_NODE || ''
    ).trim();
    const geom = feat.geometry;
    let ptLon: number | null = null;
    let ptLat: number | null = null;
    if (
      geom?.type === 'Point' &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates.length >= 2
    ) {
      const lo = Number(geom.coordinates[0]);
      const la = Number(geom.coordinates[1]);
      if (isValidBdLatLon(la, lo)) {
        ptLat = la;
        ptLon = lo;
      }
    } else if (props.LATITUDE !== undefined && props.LONGITUDE !== undefined) {
      const la = Number(props.LATITUDE);
      const lo = Number(props.LONGITUDE);
      if (isValidBdLatLon(la, lo)) {
        ptLat = la;
        ptLon = lo;
      }
    }

    if (fid === 'GOLAPBAG-SPS' || props.FACIL_ID === 'GOLAPBAG-SPS') {
      if (ptLat !== null && ptLon !== null) {
        nextSpsCoord = { lat: Number(ptLat.toFixed(6)), lon: Number(ptLon.toFixed(6)) };
      }
      const sinkM = Number(props.SINK_M);
      if (Number.isFinite(sinkM) && sinkM >= 0) nextPump.sinkingCompletedM = sinkM;
      const castM = Number(props.CAST_M);
      if (Number.isFinite(castM) && castM >= 0) nextPump.castingCompleteM = castM;
      const sinkStat = normStatusVal(props.SINK_STAT ?? props.STATUS);
      if (sinkStat) nextPump.sinkingStatus = sinkStat;
      const upperStat = normStatusVal(props.UPPER_STAT);
      if (upperStat) nextPump.machineRoom.status = upperStat;
      updatedCount++;
      continue;
    }

    if (section === 'WA' || /^WA-/i.test(fid)) {
      const sh = nextShafts.find((s) => s.id.toUpperCase() === fid.toUpperCase());
      if (sh) {
        applyShaftProps(sh, props);
        if (ptLat !== null && ptLon !== null) {
          const g = nextWaGeo.find((gn) => gn.id.toUpperCase() === sh.id.toUpperCase());
          if (g) {
            g.lat = Number(ptLat.toFixed(6));
            g.lon = Number(ptLon.toFixed(6));
          }
        }
        updatedCount++;
        continue;
      }
    }

    if (section === 'WC' || /^WC-/i.test(fid)) {
      const sh = nextWc.shafts.find((s) => s.id.toUpperCase() === fid.toUpperCase());
      if (sh) {
        applyShaftProps(sh, props);
        if (ptLat !== null && ptLon !== null) {
          const g = nextWc.geoNodes.find((gn) => gn.id.toUpperCase() === sh.id.toUpperCase());
          if (g) {
            g.lat = Number(ptLat.toFixed(6));
            g.lon = Number(ptLon.toFixed(6));
          }
        }
        updatedCount++;
        continue;
      }
    }

    if (section === 'WB' || /^WB\d+/i.test(fid)) {
      const wn = nextWb.nodes.find((n) => n.id.toUpperCase() === fid.toUpperCase());
      if (wn) {
        const st = normStatusVal(props.STATUS ?? props.status);
        if (st) wn.status = st;
        const ch = Number(props.CHAINAGE_M);
        if (Number.isFinite(ch) && ch >= 0) wn.chainageM = ch;
        if (typeof props.REMARKS === 'string') wn.note = props.REMARKS;
        if (ptLat !== null && ptLon !== null) {
          wn.lat = Number(ptLat.toFixed(6));
          wn.lon = Number(ptLon.toFixed(6));
        }
        updatedCount++;
      } else if (props.SEG_ID || props.FROM_NODE) {
        // Segment feature update -> update completed nodes/length cleanly if present
        const doneLen = Number(props.DONE_LEN_M);
        const toCh = Number(props.TO_CH_M);
        const st = normStatusVal(props.STATUS);
        if (st === 'complete' && Number.isFinite(toCh) && toCh > nextWb.completedLengthM) {
          nextWb.completedLengthM = Math.min(nextWb.totalLengthM, toCh);
          updatedCount++;
        } else if (Number.isFinite(doneLen) && doneLen > 0 && Number.isFinite(Number(props.FROM_CH_M))) {
          const candidateEnd = Number(props.FROM_CH_M) + doneLen;
          if (candidateEnd > nextWb.completedLengthM) {
            nextWb.completedLengthM = Math.min(nextWb.totalLengthM, candidateEnd);
          }
          updatedCount++;
        }
      }
    }
  }

  // Recompute WB completedLengthM consistently from WB nodes if nodes were marked complete
  let maxCompleteCh = 0;
  for (const n of nextWb.nodes) {
    if (n.status === 'complete' && n.chainageM > maxCompleteCh) {
      maxCompleteCh = n.chainageM;
    } else if (n.status !== 'complete') {
      break;
    }
  }
  if (maxCompleteCh > 0) {
    nextWb.completedLengthM = Math.min(nextWb.totalLengthM, maxCompleteCh);
  }

  return {
    shafts: nextShafts,
    pumpStation: nextPump,
    wb: nextWb,
    wc: nextWc,
    waGeoNodes: nextWaGeo,
    spsCoord: nextSpsCoord,
    updatedCount,
  };
}
