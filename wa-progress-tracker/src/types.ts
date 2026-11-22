export type WorkStatus = 'remaining' | 'ongoing' | 'complete';
export type ViewMode = 'overall' | 'weekly' | 'monthly';
export type SectionTab =
  | 'wa'
  | 'wb'
  | 'wc'
  | 'combined'
  | 'custom'
  | 'wa-map'
  | 'wb-map'
  | 'wc-map';
export type PdfSheetKey = SectionTab | 'wc-status';
export type LayoutMode = '10col' | '12col';
export type UiLang = 'bn' | 'en';
export type PipeDia =
  | 'DN900'
  | 'DN1100'
  | 'DN1200'
  | 'DN1600'
  | 'DN1800'
  | 'DN2400'
  | 'DN2600';
export type ShaftType = 'Driving' | 'Receiving' | 'Receiving/Driving';

export interface ShaftRecord {
  index: number;
  id: string; // e.g. 'WA-1', 'WA-24.1', 'WC-1'
  nextId: string; // e.g. 'WA-2', 'Pump Station', 'WC-2', 'Outfall'
  shaftSize: string;
  shaftType: ShaftType;
  netHeightMm: number;
  bottomSlabMm: number;
  sheetPileStyle: boolean;
  totalLayers: number; // 6 to 13
  layerFlags: boolean[]; // length = totalLayers (true = completed)
  bottomSlabDone: boolean;
  shaftSDate: string; // YYYY-MM-DD
  shaftEDate: string; // YYYY-MM-DD

  // Manhole in 2 parts: lower Casting + upper Precast Ring
  castingPct: number; // 0..100
  precastPct: number; // 0..100
  manholeSDate: string;
  manholeEDate: string;

  // Connection to nextId
  pipeDia: PipeDia;
  tunnelLengthM: number;
  tunnelPct: number; // 0..100
  tunnelSDate: string;
  tunnelEDate: string;
}

export interface PumpLayer {
  name: string;
  sDate: string;
  eDate: string;
  status: WorkStatus;
  done?: boolean; // legacy compat
}

export interface PumpMachineRoomData {
  status: WorkStatus;
  sDate: string;
  eDate: string;
}

export interface PumpStationData {
  totalHeightM: number;
  castingCompleteM: number;
  sinkingCompletedM: number;
  sinkingStatus: WorkStatus;
  completedHeightM?: number; // legacy compat
  layers: PumpLayer[];
  machineRoom: PumpMachineRoomData;
}

export interface WbNodeRecord {
  id: string; // 'WB1'..'WB38'
  index: number; // 1..38
  lat: number;
  lon: number;
  chainageM: number; // cumulative meters from WB1
  status: WorkStatus;
  sDate: string;
  eDate: string;
  note?: string;
}

export interface KmlOverlayLine {
  name: string;
  coords: Array<[number, number]>; // [lat, lon]
}

export interface GeoNodeCoord {
  id: string;
  lat: number;
  lon: number;
}

export interface CustomMapPoint {
  id: string;
  section: 'wa' | 'wb' | 'wc';
  name: string;
  lat: number;
  lon: number;
}

export interface WbSectionData {
  pipeDia: string;
  method: string;
  totalLengthM: number;
  completedLengthM: number;
  nodes: WbNodeRecord[];
  washoutCoord?: { lat: number; lon: number };
  airValveCoord?: { lat: number; lon: number };
  customPoints?: CustomMapPoint[];
  customKmlLines?: KmlOverlayLine[];
}

export interface WcGeoNode {
  id: string; // 'WC-1'..'WC-27'
  lat: number;
  lon: number;
}

export interface WcSectionData {
  shafts: ShaftRecord[];
  geoNodes: WcGeoNode[];
  customPoints?: CustomMapPoint[];
  customKmlLines?: KmlOverlayLine[];
}

export interface SavedProgressFile {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  note?: string;
  createdAt: string;
  updatedAt: string;
  shafts: ShaftRecord[];
  pumpStation: PumpStationData;
  wb: WbSectionData;
  wc: WcSectionData;
  waGeoNodes?: GeoNodeCoord[];
  spsCoord?: { lat: number; lon: number };
  waCustomPoints?: CustomMapPoint[];
}

export interface ShaftSnapshotItem {
  layerFlags: boolean[];
  bottomSlabDone: boolean;
  castingPct: number;
  precastPct: number;
  tunnelPct: number;
}

export interface PeriodBaseline {
  label: string;
  date: string; // YYYY-MM-DD
  capturedAt: string;
  shafts: Record<string, ShaftSnapshotItem>;
  pumpLayersDone: boolean[];
  pumpMachineRoomStatus?: WorkStatus;
  pumpSinkingStatus?: WorkStatus;
  wbCompletedLengthM?: number;
  wbNodesStatus?: Record<string, WorkStatus>;
  wcShafts?: Record<string, ShaftSnapshotItem>;
}

export interface HistoryArchiveEntry {
  id: string;
  type: 'weekly' | 'monthly';
  label: string;
  date: string;
  capturedAt: string;
  summary: {
    completedShafts: number;
    ongoingShafts: number;
    completedManholes: number;
    ongoingManholes: number;
    tunnelCompletedKm: number;
  };
  snapshot: PeriodBaseline;
}

export interface ComparePairSelection {
  file1Id: string; // 1st file (Previous Week / Previous Month)
  file2Id: string; // 2nd file (Last/Current Week or '__LIVE__')
}

export interface ColorPalette {
  overallShaft: string;
  overallCasting: string;
  overallPrecast: string;
  overallTunnel: string;
  remainingOutline: string;

  prevWeekShaft: string;
  prevWeekManhole: string;
  prevWeekTunnel: string;
  thisWeekHighlight: string;

  prevMonthShaft: string;
  prevMonthManhole: string;
  prevMonthTunnel: string;
  thisMonthHighlight: string;
}

export interface SheetSettings {
  projectTitle: string;
  sectionTitle: string;
  customTitleBlockSection?: string;
  sheetFormatLabel?: string;
  drawingNo: string;
  revision: string;
  reportDate: string; // YYYY-MM-DD
  preparedBy: string;
  checkedBy: string;
  clientName: string;
  contractorName: string;
  layoutMode: LayoutMode;
  showPumpStation: boolean;
  showMapBackground: boolean;
  mapStyle: 'voyager' | 'light' | 'cad';
  waTunnelDiaTotalsM?: Partial<Record<PipeDia, number>>;
}

export interface CustomShaftViewConfig {
  section: 'wa' | 'wc';
  selectedIds: string[];
  showTunneling: boolean;
  includePumpStation: boolean;
}

export interface AppState {
  version: number;
  lastSavedAt: string;
  activeSection: SectionTab;
  viewMode: ViewMode;
  uiLang: UiLang;
  currentWeekLabel: string;
  currentMonthLabel: string;
  shafts: ShaftRecord[];
  pumpStation: PumpStationData;
  wb: WbSectionData;
  wc: WcSectionData;
  waGeoNodes?: GeoNodeCoord[];
  spsCoord?: { lat: number; lon: number };
  waCustomPoints?: CustomMapPoint[];
  customView?: CustomShaftViewConfig;
  savedFiles: SavedProgressFile[];
  activeLoadedFileId: string | null;
  weeklyCompare: ComparePairSelection;
  monthlyCompare: ComparePairSelection;
  weeklyBaseline: PeriodBaseline;
  monthlyBaseline: PeriodBaseline;
  history: HistoryArchiveEntry[];
  colors: ColorPalette;
  settings: SheetSettings;
}
