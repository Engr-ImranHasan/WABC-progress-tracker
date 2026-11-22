import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  CircleDot,
  ArrowRightLeft,
  Sliders,
  History,
  Table2,
  RotateCcw,
  CheckCircle2,
  Clock,
  CircleDashed,
  Search,
  Building2,
  FileText,
  MapPin,
} from 'lucide-react';
import {
  AppState,
  PipeDia,
  PumpStationData,
  ShaftRecord,
  ShaftType,
  UiLang,
  WorkStatus,
} from '../types';
import {
  calcDurationDays,
  calcElapsedDays,
  formatDateDisplay,
  getCastingStatus,
  getManholeStatus,
  getPumpLowerStatus,
  getRingStatus,
  getShaftCompletedLayersCount,
  getShaftStatus,
  getTunnelStatus,
  resizeShaftLayers,
} from '../utils/calculations';
import { DEFAULT_COLORS } from '../data/initialWaData';
import {
  createInitialWcData,
  GOLAPBAG_SPS_COORD,
  INITIAL_WA_GEO_NODES,
} from '../data/wbcInitialData';
import { applyKmlToWc, CustomMapPointsBox, MapConfigAndKmlBox } from './WbWcEditors';

interface ShaftEditorPanelProps {
  state: AppState;
  sectionTarget?: 'wa' | 'wc';
  selectedShaftId: string;
  onSelectShaft: (id: string) => void;
  onUpdateShaft: (id: string, patch: Partial<ShaftRecord>) => void;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  focusSection?: 'shaft' | 'manhole' | 'tunnel';
  requestedTab?: { tab: 'single' | 'table' | 'settings'; seq: number };
}

const LABELS = {
  bn: {
    shaftEditor: 'Shaft এডিট',
    bulkTable: 'সব ৩৭টি তালিকা',
    settingsHistory: 'সেটিংস ও হিস্টোরি',
    shaftSection: '১. Shaft ও লেয়ার (W1–W13)',
    manholeSection: '২. Manhole (Casting + Precast Ring)',
    tunnelSection: '৩. Micro-Tunnelling কানেকশন',
    totalLayers: 'মোট লেয়ার (৬–১৩টি)',
    completedLayers: 'সম্পন্ন লেয়ার',
    bottomSlab: 'Bottom Slab সম্পন্ন',
    sDate: 'শুরুর তারিখ (S. Date)',
    eDate: 'শেষের তারিখ (E. Date)',
    duration: 'সময়কাল (Duration)',
    lowerCasting: 'নিচের অংশ: In-situ Casting',
    upperPrecast: 'উপরের অংশ: Precast Ring',
    remaining: 'Remaining',
    ongoing: 'On-going',
    complete: 'Complete',
    totalLen: 'মোট দৈর্ঘ্য (m)',
    compLen: 'সম্পন্ন দৈর্ঘ্য (m)',
    compPct: 'সম্পন্ন (%)',
    pipeDia: 'পাইপ সাইজ',
    searchPlaceholder: 'Shaft খুঁজুন (যেমন WA-24)...',
    pumpStationTitle: 'Pump Station (৫ লেয়ার)',
  },
  en: {
    shaftEditor: 'Edit Shaft',
    bulkTable: 'All 37 Table',
    settingsHistory: 'Settings & History',
    shaftSection: '1. Shaft & Layers (W1–W13)',
    manholeSection: '2. Manhole (Casting + Precast Ring)',
    tunnelSection: '3. Micro-Tunnelling Connection',
    totalLayers: 'Total Layers (6–13)',
    completedLayers: 'Completed Layers',
    bottomSlab: 'Bottom Slab Completed',
    sDate: 'Start Date (S. Date)',
    eDate: 'End Date (E. Date)',
    duration: 'Duration',
    lowerCasting: 'Lower Part: In-situ Casting',
    upperPrecast: 'Upper Part: Precast Ring',
    remaining: 'Remaining',
    ongoing: 'On-going',
    complete: 'Complete',
    totalLen: 'Total Length (m)',
    compLen: 'Completed (m)',
    compPct: 'Completed (%)',
    pipeDia: 'Pipe Dia',
    searchPlaceholder: 'Search shaft (e.g. WA-24)...',
    pumpStationTitle: 'Pump Station (5 Layers)',
  },
};

function StatusChip({ status }: { status: WorkStatus }) {
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        <CheckCircle2 className="h-3 w-3" /> Complete
      </span>
    );
  }
  if (status === 'ongoing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
        <Clock className="h-3 w-3" /> On-going
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
      <CircleDashed className="h-3 w-3" /> Remaining
    </span>
  );
}

export const ShaftEditorPanel: React.FC<ShaftEditorPanelProps> = ({
  state,
  sectionTarget = 'wa',
  selectedShaftId,
  onSelectShaft,
  onUpdateShaft,
  onUpdateState,
  requestedTab,
}) => {
  const [activeTab, setActiveTab] = useState<'single' | 'table' | 'settings'>('single');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | WorkStatus>('all');
  const [showBaselineOverride, setShowBaselineOverride] = useState(false);

  // Smooth uncontrolled-while-typing drafts for tunnel Completed (%) and Completed (m)
  const [pctDraft, setPctDraft] = useState<string | null>(null);
  const [lenMDraft, setLenMDraft] = useState<string | null>(null);

  useEffect(() => {
    setPctDraft(null);
    setLenMDraft(null);
  }, [selectedShaftId, sectionTarget]);

  useEffect(() => {
    if (requestedTab && requestedTab.seq > 0) {
      setActiveTab(requestedTab.tab);
    }
  }, [requestedTab]);

  const lang: UiLang = state.uiLang;
  const L = LABELS[lang];
  const isWc = sectionTarget === 'wc';
  const shaftsList = isWc ? state.wc.shafts : state.shafts;

  const isPumpSelected = !isWc && selectedShaftId === 'PUMP_STATION';
  const idx = shaftsList.findIndex((s) => s.id === selectedShaftId);
  const shaft = shaftsList[idx >= 0 ? idx : 0];
  const prevShaft = isPumpSelected
    ? shaftsList[shaftsList.length - 1]
    : idx > 0
    ? shaftsList[idx - 1]
    : null;
  const nextShaftId = isPumpSelected
    ? null
    : idx < shaftsList.length - 1
    ? shaftsList[idx + 1].id
    : isWc
    ? null
    : 'PUMP_STATION';

  const updatePumpStation = (
    updater: (ps: PumpStationData) => PumpStationData
  ) => {
    onUpdateState((prev) => ({
      ...prev,
      pumpStation: updater(prev.pumpStation),
    }));
  };

  const activeBaseline =
    state.viewMode === 'monthly' ? state.monthlyBaseline : state.weeklyBaseline;
  const baselineMap = isWc ? (activeBaseline.wcShafts || {}) : activeBaseline.shafts;
  const bSnap = baselineMap[shaft.id];

  const shStatus = getShaftStatus(shaft);
  const mhStatus = getManholeStatus(shaft);
  const mtStatus = getTunnelStatus(shaft);
  const shDoneCount = getShaftCompletedLayersCount(shaft);
  const shDur = calcDurationDays(shaft.shaftSDate, shaft.shaftEDate);
  const shElapsed = calcElapsedDays(shaft.shaftSDate, state.settings.reportDate);
  const mhDur = calcDurationDays(shaft.manholeSDate, shaft.manholeEDate);
  const mtDur = calcDurationDays(shaft.tunnelSDate, shaft.tunnelEDate);

  const setCompletedLayersTopDown = (count: number) => {
    const clamped = Math.max(0, Math.min(shaft.totalLayers, count));
    const newFlags = Array.from(
      { length: shaft.totalLayers },
      (_, i) => i < clamped
    );
    onUpdateShaft(shaft.id, {
      layerFlags: newFlags,
      bottomSlabDone: clamped === shaft.totalLayers ? shaft.bottomSlabDone : false,
    });
  };

  const toggleSingleLayer = (li: number) => {
    const copy = [...shaft.layerFlags];
    copy[li] = !copy[li];
    onUpdateShaft(shaft.id, { layerFlags: copy });
  };

  const handleTotalLayersChange = (newTotal: number) => {
    const minL = shaft.sheetPileStyle ? 4 : 6;
    const clamped = Math.max(minL, Math.min(13, newTotal));
    const newFlags = resizeShaftLayers(shaft.layerFlags, clamped, minL);
    onUpdateShaft(shaft.id, {
      totalLayers: clamped,
      layerFlags: newFlags,
    });
  };

  const updateBaselineForSelected = (
    patch: Partial<{
      layersCount: number;
      bottomSlabDone: boolean;
      castingPct: number;
      precastPct: number;
      tunnelPct: number;
    }>
  ) => {
    const targetKey = state.viewMode === 'monthly' ? 'monthlyBaseline' : 'weeklyBaseline';
    onUpdateState((prev) => {
      const base = prev[targetKey];
      const targetMap = isWc ? (base.wcShafts || {}) : base.shafts;
      const existing = targetMap[shaft.id] || {
        layerFlags: Array(shaft.totalLayers).fill(false),
        bottomSlabDone: false,
        castingPct: 0,
        precastPct: 0,
        tunnelPct: 0,
      };
      const nextLayers =
        patch.layersCount !== undefined
          ? Array.from(
              { length: shaft.totalLayers },
              (_, i) => i < Math.max(0, Math.min(shaft.totalLayers, patch.layersCount!))
            )
          : existing.layerFlags;

      const updatedSnap = {
        ...existing,
        layerFlags: nextLayers,
        bottomSlabDone: patch.bottomSlabDone ?? existing.bottomSlabDone,
        castingPct: patch.castingPct ?? existing.castingPct,
        precastPct: patch.precastPct ?? existing.precastPct,
        tunnelPct: patch.tunnelPct ?? existing.tunnelPct,
      };

      return {
        ...prev,
        [targetKey]: {
          ...base,
          ...(isWc
            ? { wcShafts: { ...(base.wcShafts || {}), [shaft.id]: updatedSnap } }
            : { shafts: { ...base.shafts, [shaft.id]: updatedSnap } }),
        },
      };
    });
  };

  const filteredShafts = shaftsList.filter((s) => {
    const matchesSearch =
      !search.trim() ||
      s.id.toLowerCase().includes(search.trim().toLowerCase()) ||
      s.pipeDia.toLowerCase().includes(search.trim().toLowerCase());
    if (!matchesSearch) return false;
    if (filterStatus === 'all') return true;
    return (
      getShaftStatus(s) === filterStatus ||
      getManholeStatus(s) === filterStatus ||
      getTunnelStatus(s) === filterStatus
    );
  });

  return (
    <aside className="no-print flex h-full flex-col border-l border-slate-200 bg-white">
      {/* Top 3 Editor Tabs */}
      <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('single')}
          className={`flex items-center justify-center gap-1.5 py-2.5 border-b-2 transition ${
            activeTab === 'single'
              ? 'border-blue-600 bg-white text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          {isWc ? (lang === 'bn' ? 'WC Shaft এডিট' : 'Edit WC') : L.shaftEditor}
        </button>
        <button
          onClick={() => setActiveTab('table')}
          className={`flex items-center justify-center gap-1.5 py-2.5 border-b-2 transition ${
            activeTab === 'table'
              ? 'border-blue-600 bg-white text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Table2 className="h-3.5 w-3.5" />
          {lang === 'bn' ? `সব ${shaftsList.length}টি তালিকা` : `All ${shaftsList.length} Table`}
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center justify-center gap-1.5 py-2.5 border-b-2 transition ${
            activeTab === 'settings'
              ? 'border-blue-600 bg-white text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          {L.settingsHistory}
        </button>
      </div>

      {/* ==================== TAB 1: SINGLE SHAFT / PUMP STATION EDITOR ==================== */}
      {activeTab === 'single' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Shaft + Pump Station Navigator Bar */}
          <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/70 p-2">
            <button
              disabled={!prevShaft}
              onClick={() => prevShaft && onSelectShaft(prevShaft.id)}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex flex-1 flex-col items-center">
              <select
                value={isPumpSelected ? 'PUMP_STATION' : shaft.id}
                onChange={(e) => onSelectShaft(e.target.value)}
                className="w-full rounded-md border border-blue-300 bg-white px-2.5 py-1 text-center text-sm font-bold text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {shaftsList.map((s) => (
                  <option key={s.id} value={s.id}>
                    Shaft {s.id} → {s.nextId} ({s.pipeDia})
                  </option>
                ))}
                {!isWc && (
                  <option value="PUMP_STATION">
                    ★ Pump Station (Golapbag SPS — 2 Parts)
                  </option>
                )}
              </select>
              {isPumpSelected ? (
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
                  <span className="text-slate-500 font-medium">Lower:</span>
                  <StatusChip status={getPumpLowerStatus(state.pumpStation)} />
                  <span className="text-slate-500 font-medium ml-1">Sinking:</span>
                  <StatusChip status={state.pumpStation.sinkingStatus} />
                </div>
              ) : (
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
                  <span className="text-slate-500 font-medium">Shaft:</span>
                  <StatusChip status={shStatus} />
                  <span className="text-slate-500 font-medium ml-1">MH:</span>
                  <StatusChip status={mhStatus} />
                  <span className="text-slate-500 font-medium ml-1">MT:</span>
                  <StatusChip status={mtStatus} />
                </div>
              )}
            </div>

            <button
              disabled={!nextShaftId}
              onClick={() => nextShaftId && onSelectShaft(nextShaftId)}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Quick Jump Pill to Pump Station (WA only) OR WC Blank Status Notice (WC only) */}
          {!isWc && !isPumpSelected && (
            <button
              onClick={() => onSelectShaft('PUMP_STATION')}
              className="flex w-full items-center justify-between rounded-md border border-teal-200 bg-teal-50/70 px-2.5 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-100 transition"
            >
              <span className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-teal-700" />
                {lang === 'bn'
                  ? 'Pump Station এডিট করুন (২ অংশ: Main + Machine Room)'
                  : 'Edit Pump Station (Golapbag SPS — 2 Parts)'}
              </span>
              <span className="text-[11px] font-bold text-teal-700">Open →</span>
            </button>
          )}
          {isWc && (
            <div className="flex items-center justify-between rounded-md border border-purple-200 bg-purple-50/70 px-2.5 py-1.5 text-[11px] text-purple-950">
              <span className="font-semibold">
                {lang === 'bn'
                  ? 'WC সেকশন (২৭ Shaft): কাজ শুরু হলে নিচে থেকে আপডেট করুন'
                  : 'WC Section (27 Shafts): Blank baseline — update anytime below'}
              </span>
              <button
                onClick={() =>
                  onUpdateState((prev) => ({
                    ...prev,
                    wc: createInitialWcData(),
                  }))
                }
                className="rounded border border-purple-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-purple-800 hover:bg-purple-100"
              >
                Reset Blank
              </button>
            </div>
          )}

          {/* ==================== PUMP STATION 2-PART EDITOR ==================== */}
          {isPumpSelected ? (
            <div className="space-y-3">
              {/* UPPER PART: MACHINE ROOM */}
              <div className="rounded-lg border border-indigo-200 bg-white p-3 shadow-xs space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold text-indigo-950 uppercase tracking-wide">
                    <Building2 className="h-3.5 w-3.5 text-indigo-600" />
                    {lang === 'bn'
                      ? 'উপরের অংশ: Machine Room (+7.0m – +19.5m)'
                      : 'Upper Part: Machine Room (+7.0m – +19.5m)'}
                  </h3>
                  <StatusChip status={state.pumpStation.machineRoom.status} />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                    {lang === 'bn' ? 'কাজের অবস্থা (Status)' : 'Work Status'}
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['complete', 'ongoing', 'remaining'] as WorkStatus[]).map((st) => {
                      const active = state.pumpStation.machineRoom.status === st;
                      const style =
                        st === 'complete'
                          ? active
                            ? 'bg-emerald-600 text-white border-emerald-700'
                            : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                          : st === 'ongoing'
                          ? active
                            ? 'bg-amber-500 text-slate-950 border-amber-600'
                            : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
                          : active
                          ? 'bg-rose-600 text-white border-rose-700'
                          : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50';
                      return (
                        <button
                          key={st}
                          onClick={() =>
                            updatePumpStation((ps) => ({
                              ...ps,
                              machineRoom: { ...ps.machineRoom, status: st },
                            }))
                          }
                          className={`rounded-md border px-2 py-1.5 text-[11px] font-bold capitalize transition ${style}`}
                        >
                          {st === 'ongoing' ? 'On-going' : st}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500">
                      {L.sDate}
                    </label>
                    <input
                      type="date"
                      value={state.pumpStation.machineRoom.sDate}
                      onChange={(e) =>
                        updatePumpStation((ps) => ({
                          ...ps,
                          machineRoom: { ...ps.machineRoom, sDate: e.target.value },
                        }))
                      }
                      className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500">
                      {L.eDate}
                    </label>
                    <input
                      type="date"
                      value={state.pumpStation.machineRoom.eDate}
                      onChange={(e) =>
                        updatePumpStation((ps) => ({
                          ...ps,
                          machineRoom: { ...ps.machineRoom, eDate: e.target.value },
                        }))
                      }
                      className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                </div>

                {(() => {
                  const mrDur = calcDurationDays(
                    state.pumpStation.machineRoom.sDate,
                    state.pumpStation.machineRoom.eDate
                  );
                  return (
                    <div className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 text-xs">
                      <span className="text-slate-600 font-medium">{L.duration}:</span>
                      <span className="font-bold text-slate-900">
                        {mrDur !== null
                          ? `${mrDur} Days`
                          : state.pumpStation.machineRoom.status === 'ongoing'
                          ? 'On-going'
                          : 'Remaining'}
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* LOWER PART: MAIN PUMP STATION STRUCTURE (5 LAYERS + HEIGHTS) */}
              <div className="rounded-lg border border-emerald-200 bg-white p-3 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold text-emerald-950 uppercase tracking-wide">
                    <Layers className="h-3.5 w-3.5 text-emerald-600" />
                    {lang === 'bn'
                      ? 'নিচের অংশ: Main Pump Structure (৫ লেয়ার)'
                      : 'Lower Part: Main Pump Structure (5 Layers)'}
                  </h3>
                  <StatusChip status={getPumpLowerStatus(state.pumpStation)} />
                </div>

                {/* Editable Lengths: Total Height, Casting Complete, Sinking Complete */}
                <div className="grid grid-cols-3 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600">
                      Total Height (m)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      value={state.pumpStation.totalHeightM}
                      onChange={(e) =>
                        updatePumpStation((ps) => ({
                          ...ps,
                          totalHeightM: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-blue-700">
                      Casting Len (m)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      value={state.pumpStation.castingCompleteM}
                      onChange={(e) =>
                        updatePumpStation((ps) => ({
                          ...ps,
                          castingCompleteM: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="mt-0.5 w-full rounded border border-blue-300 bg-white px-2 py-1 text-xs font-bold text-blue-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-teal-700">
                      Sinking Len (m)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      value={state.pumpStation.sinkingCompletedM}
                      onChange={(e) =>
                        updatePumpStation((ps) => ({
                          ...ps,
                          sinkingCompletedM: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="mt-0.5 w-full rounded border border-teal-300 bg-white px-2 py-1 text-xs font-bold text-teal-900"
                    />
                  </div>
                </div>

                {/* Sinking Status Control (Complete / On-going / Remaining) */}
                <div className="rounded-md border border-teal-200 bg-teal-50/60 p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-teal-950">
                      {lang === 'bn' ? 'Sinking কাজের অবস্থা (Status)' : 'Sinking Work Status'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {state.pumpStation.sinkingStatus !== 'complete' && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-300">
                          Rem: {Math.max(0, Number((state.pumpStation.totalHeightM - state.pumpStation.sinkingCompletedM).toFixed(2)))}m
                        </span>
                      )}
                      <StatusChip status={state.pumpStation.sinkingStatus} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['complete', 'ongoing', 'remaining'] as WorkStatus[]).map((st) => {
                      const active = state.pumpStation.sinkingStatus === st;
                      const style =
                        st === 'complete'
                          ? active
                            ? 'bg-emerald-600 text-white border-emerald-700'
                            : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                          : st === 'ongoing'
                          ? active
                            ? 'bg-amber-400 text-slate-950 border-amber-600'
                            : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
                          : active
                          ? 'bg-rose-600 text-white border-rose-700'
                          : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50';
                      return (
                        <button
                          key={st}
                          onClick={() =>
                            updatePumpStation((ps) => ({ ...ps, sinkingStatus: st }))
                          }
                          className={`rounded-md border px-2 py-1 text-[11px] font-bold capitalize transition ${style}`}
                        >
                          {st === 'ongoing' ? 'On-going' : st}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 5 Layers Editor (Bottom-to-Top Elevation: 5th Top down to 1st Bottom) */}
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold text-slate-500">
                    {lang === 'bn'
                      ? 'লেয়ার হিসাব নিচ থেকে উপরে (1st Layer = নিচে, 5th Layer = উপরে):'
                      : 'Layers counted bottom-to-top (L1 at base → L5 at top):'}
                  </div>
                  {[4, 3, 2, 1, 0].map((li) => {
                    const ly = state.pumpStation.layers[li];
                    if (!ly) return null;
                    const dur = calcDurationDays(ly.sDate, ly.eDate);
                    const posLabel =
                      li === 0 ? 'Bottom Base' : li === 4 ? 'Top Slab' : `Level ${li + 1}`;
                    return (
                      <div
                        key={ly.name}
                        className="rounded-md border border-slate-200 bg-slate-50/70 p-2 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-800">
                            L{li + 1} · {ly.name}{' '}
                            <span className="text-[10px] font-medium text-slate-500">
                              ({posLabel})
                            </span>
                          </span>
                          <div className="flex gap-1">
                            {(['complete', 'ongoing', 'remaining'] as WorkStatus[]).map((st) => {
                              const active = ly.status === st;
                              return (
                                <button
                                  key={st}
                                  onClick={() =>
                                    updatePumpStation((ps) => ({
                                      ...ps,
                                      layers: ps.layers.map((item, idx2) =>
                                        idx2 === li ? { ...item, status: st } : item
                                      ),
                                    }))
                                  }
                                  className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                                    active
                                      ? st === 'complete'
                                        ? 'bg-emerald-600 text-white border-emerald-700'
                                        : st === 'ongoing'
                                        ? 'bg-amber-400 text-slate-950 border-amber-600'
                                        : 'bg-rose-600 text-white border-rose-700'
                                      : 'bg-white text-slate-600 border-slate-300'
                                  }`}
                                >
                                  {st === 'complete'
                                    ? 'Done'
                                    : st === 'ongoing'
                                    ? 'On-going'
                                    : 'Rem'}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[9px] text-slate-500">S. Date</label>
                            <input
                              type="date"
                              value={ly.sDate}
                              onChange={(e) =>
                                updatePumpStation((ps) => ({
                                  ...ps,
                                  layers: ps.layers.map((item, idx2) =>
                                    idx2 === li ? { ...item, sDate: e.target.value } : item
                                  ),
                                }))
                              }
                              className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] text-slate-500">E. Date</label>
                            <input
                              type="date"
                              value={ly.eDate}
                              onChange={(e) =>
                                updatePumpStation((ps) => ({
                                  ...ps,
                                  layers: ps.layers.map((item, idx2) =>
                                    idx2 === li ? { ...item, eDate: e.target.value } : item
                                  ),
                                }))
                              }
                              className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
                            />
                          </div>
                        </div>
                        <div className="text-right text-[10px] font-semibold text-slate-600">
                          Duration: {dur !== null ? `${dur} Days` : '-'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Golapbag SPS Map Coordinates */}
                {(() => {
                  const sps = state.spsCoord || GOLAPBAG_SPS_COORD;
                  return (
                    <div className="rounded-md border border-pink-200 bg-pink-50/40 p-2 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-pink-950">
                        <MapPin className="h-3.5 w-3.5 text-pink-700" />
                        {lang === 'bn'
                          ? 'Golapbag SPS ম্যাপ কো-অর্ডিনেট'
                          : 'Golapbag SPS Map Coordinates'}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] text-slate-500">SPS Latitude</label>
                          <input
                            type="number"
                            step="0.000001"
                            aria-label="Golapbag SPS Latitude"
                            value={sps.lat}
                            onChange={(e) =>
                              onUpdateState((prev) => ({
                                ...prev,
                                spsCoord: {
                                  lat: Number(e.target.value) || sps.lat,
                                  lon: (prev.spsCoord || sps).lon,
                                },
                              }))
                            }
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] text-slate-500">SPS Longitude</label>
                          <input
                            type="number"
                            step="0.000001"
                            aria-label="Golapbag SPS Longitude"
                            value={sps.lon}
                            onChange={(e) =>
                              onUpdateState((prev) => ({
                                ...prev,
                                spsCoord: {
                                  lat: (prev.spsCoord || sps).lat,
                                  lon: Number(e.target.value) || sps.lon,
                                },
                              }))
                            }
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <>

          {/* SECTION 1: SHAFT & LAYERS (6-13) */}
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wide">
                <Layers className="h-3.5 w-3.5 text-emerald-600" />
                {L.shaftSection}
              </h3>
              <StatusChip status={shStatus} />
            </div>

            {/* Total Layers (4..13 for Sheet Pile, 6..13 for Wall Layers) + Completed Stepper */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-slate-50 p-2 border border-slate-200">
                <div className="text-[11px] font-medium text-slate-600">
                  {shaft.sheetPileStyle
                    ? lang === 'bn'
                      ? 'Sheet Pile ভাগ (নিচ→উপর)'
                      : 'Sheet Pile Divisions'
                    : L.totalLayers}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <button
                    onClick={() => handleTotalLayersChange(shaft.totalLayers - 1)}
                    disabled={shaft.totalLayers <= (shaft.sheetPileStyle ? 4 : 6)}
                    className="h-7 w-7 rounded border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    -
                  </button>
                  <span className="flex-1 text-center text-sm font-bold text-slate-900">
                    {shaft.totalLayers}
                  </span>
                  <button
                    onClick={() => handleTotalLayersChange(shaft.totalLayers + 1)}
                    disabled={shaft.totalLayers >= 13}
                    className="h-7 w-7 rounded border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="rounded-md bg-emerald-50/70 p-2 border border-emerald-200">
                <div className="text-[11px] font-medium text-emerald-800">{L.completedLayers}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <button
                    onClick={() => setCompletedLayersTopDown(shDoneCount - 1)}
                    disabled={shDoneCount <= 0}
                    className="h-7 w-7 rounded border border-emerald-300 bg-white font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
                  >
                    -
                  </button>
                  <span className="flex-1 text-center text-sm font-bold text-emerald-900">
                    {shDoneCount} / {shaft.totalLayers}
                  </span>
                  <button
                    onClick={() => setCompletedLayersTopDown(shDoneCount + 1)}
                    disabled={shDoneCount >= shaft.totalLayers}
                    className="h-7 w-7 rounded border border-emerald-300 bg-white font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Individual Clickable Layer/Sheet-Pile Pills */}
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {shaft.sheetPileStyle
                    ? `Sheet Pile (Bottom 1 → Top ${shaft.totalLayers}):`
                    : `Click layers (W1–W${shaft.totalLayers}):`}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onUpdateShaft(shaft.id, {
                        layerFlags: Array(shaft.totalLayers).fill(true),
                        bottomSlabDone: true,
                      });
                    }}
                    className="text-emerald-700 font-semibold hover:underline"
                  >
                    All Complete
                  </button>
                  <button
                    onClick={() => {
                      onUpdateShaft(shaft.id, {
                        layerFlags: Array(shaft.totalLayers).fill(false),
                        bottomSlabDone: false,
                      });
                    }}
                    className="text-rose-600 font-semibold hover:underline"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: shaft.totalLayers }).map((_, li) => {
                  const done = Boolean(shaft.layerFlags[li]);
                  const prevDone = Boolean(bSnap?.layerFlags?.[li]);
                  const isNewInPeriod = state.viewMode !== 'overall' && done && !prevDone;
                  const pillLabel = shaft.sheetPileStyle ? `SP${li + 1}` : `W${li + 1}`;
                  return (
                    <button
                      key={li}
                      onClick={() => toggleSingleLayer(li)}
                      className={`rounded px-2 py-1 text-[11px] font-bold border transition ${
                        isNewInPeriod
                          ? 'bg-amber-400 border-amber-600 text-slate-950'
                          : done
                          ? 'bg-emerald-600 border-emerald-700 text-white'
                          : 'bg-white border-rose-300 text-rose-600 hover:bg-rose-50'
                      }`}
                      title={
                        isNewInPeriod
                          ? `${pillLabel}: New this period!`
                          : done
                          ? `${pillLabel}: Completed`
                          : `${pillLabel}: Remaining`
                      }
                    >
                      {pillLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Slab + Sheet Pile Checkboxes */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <label className="flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shaft.bottomSlabDone}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { bottomSlabDone: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
                {L.bottomSlab}
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shaft.sheetPileStyle}
                  onChange={(e) => {
                    const nextSp = e.target.checked;
                    if (nextSp && shaft.totalLayers > 4) {
                      const done = shaft.layerFlags.slice(0, shaft.totalLayers).filter(Boolean).length;
                      const divDone = Math.round((done / shaft.totalLayers) * 4);
                      onUpdateShaft(shaft.id, {
                        sheetPileStyle: true,
                        totalLayers: 4,
                        layerFlags: Array.from({ length: 4 }, (_, i) => i < divDone),
                      });
                    } else {
                      onUpdateShaft(shaft.id, { sheetPileStyle: nextSp });
                    }
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                Sheet Pile (4 Divs)
              </label>
            </div>

            {/* Shaft Dates & Auto Duration */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500">
                  {L.sDate}
                </label>
                <input
                  type="date"
                  value={shaft.shaftSDate}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { shaftSDate: e.target.value })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500">
                  {L.eDate}
                </label>
                <input
                  type="date"
                  value={shaft.shaftEDate}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { shaftEDate: e.target.value })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 text-xs">
              <span className="text-slate-600 font-medium">{L.duration}:</span>
              <span className="font-bold text-slate-900">
                {shDur !== null
                  ? `${shDur} Days`
                  : shStatus === 'ongoing'
                  ? `On-going (${shElapsed ? shElapsed + ' Days elapsed' : 'Active'})`
                  : 'Not Started'}
              </span>
            </div>

            {/* Shaft Physical Specs (Compact) */}
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold text-slate-500 hover:text-slate-800">
                Shaft Dimensions ({shaft.shaftSize} | {shaft.shaftType} | H:{shaft.netHeightMm}mm)
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500">Shaft Size (mm)</label>
                  <input
                    type="text"
                    value={shaft.shaftSize}
                    onChange={(e) => onUpdateShaft(shaft.id, { shaftSize: e.target.value })}
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500">Type of Shaft</label>
                  <select
                    value={shaft.shaftType}
                    onChange={(e) =>
                      onUpdateShaft(shaft.id, { shaftType: e.target.value as ShaftType })
                    }
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="Driving">Driving</option>
                    <option value="Receiving">Receiving</option>
                    <option value="Receiving/Driving">Receiving/Driving</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500">Net Height (mm)</label>
                  <input
                    type="number"
                    value={shaft.netHeightMm}
                    onChange={(e) =>
                      onUpdateShaft(shaft.id, { netHeightMm: Number(e.target.value) || 0 })
                    }
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500">Bottom Slab (mm)</label>
                  <input
                    type="number"
                    value={shaft.bottomSlabMm}
                    onChange={(e) =>
                      onUpdateShaft(shaft.id, { bottomSlabMm: Number(e.target.value) || 0 })
                    }
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </div>
              </div>
            </details>
          </div>

          {/* SECTION 2: MANHOLE (2 PARTS: CASTING + PRECAST RING) */}
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wide">
                <CircleDot className="h-3.5 w-3.5 text-blue-600" />
                {L.manholeSection}
              </h3>
              <StatusChip status={mhStatus} />
            </div>

            {/* Part 1: Lower In-situ Casting */}
            <div className="rounded-md border border-blue-100 bg-blue-50/40 p-2 space-y-1.5">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="font-semibold text-blue-900">{L.lowerCasting}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    aria-label="Casting (%)"
                    value={shaft.castingPct}
                    onChange={(e) =>
                      onUpdateShaft(shaft.id, {
                        castingPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      })
                    }
                    className="w-12 rounded border border-blue-300 bg-white px-1 py-0.5 text-right text-[11px] font-bold text-blue-800"
                  />
                  <span className="font-bold text-blue-700">%</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={shaft.castingPct}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { castingPct: Number(e.target.value) })
                  }
                  className="flex-1 accent-blue-600"
                />
                <div className="flex gap-1">
                  {[
                    { lbl: '0%', val: 0 },
                    { lbl: '50%', val: 50 },
                    { lbl: '100%', val: 100 },
                  ].map((b) => (
                    <button
                      key={b.val}
                      onClick={() => onUpdateShaft(shaft.id, { castingPct: b.val })}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${
                        shaft.castingPct === b.val
                          ? 'bg-blue-600 text-white border-blue-700'
                          : 'bg-white text-slate-600 border-slate-300'
                      }`}
                    >
                      {b.lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-slate-500">
                Status: <strong className="uppercase">{getCastingStatus(shaft)}</strong>
                {state.viewMode !== 'overall' && bSnap && (
                  <span className="ml-2 text-amber-700">
                    (Prev: {bSnap.castingPct}% → +{Math.max(0, shaft.castingPct - bSnap.castingPct)}%)
                  </span>
                )}
              </div>
            </div>

            {/* Part 2: Upper Precast Ring */}
            <div className="rounded-md border border-sky-100 bg-sky-50/40 p-2 space-y-1.5">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="font-semibold text-sky-900">{L.upperPrecast}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    aria-label="Precast Ring (%)"
                    value={shaft.precastPct}
                    onChange={(e) =>
                      onUpdateShaft(shaft.id, {
                        precastPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      })
                    }
                    className="w-12 rounded border border-sky-300 bg-white px-1 py-0.5 text-right text-[11px] font-bold text-sky-800"
                  />
                  <span className="font-bold text-sky-700">%</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={shaft.precastPct}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { precastPct: Number(e.target.value) })
                  }
                  className="flex-1 accent-sky-600"
                />
                <div className="flex gap-1">
                  {[
                    { lbl: '0%', val: 0 },
                    { lbl: '50%', val: 50 },
                    { lbl: '100%', val: 100 },
                  ].map((b) => (
                    <button
                      key={b.val}
                      onClick={() => onUpdateShaft(shaft.id, { precastPct: b.val })}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${
                        shaft.precastPct === b.val
                          ? 'bg-sky-600 text-white border-sky-700'
                          : 'bg-white text-slate-600 border-slate-300'
                      }`}
                    >
                      {b.lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-slate-500">
                Status: <strong className="uppercase">{getRingStatus(shaft)}</strong>
                {state.viewMode !== 'overall' && bSnap && (
                  <span className="ml-2 text-amber-700">
                    (Prev: {bSnap.precastPct}% → +{Math.max(0, shaft.precastPct - bSnap.precastPct)}%)
                  </span>
                )}
              </div>
            </div>

            {/* Manhole Dates */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500">
                  {L.sDate}
                </label>
                <input
                  type="date"
                  value={shaft.manholeSDate}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { manholeSDate: e.target.value })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500">
                  {L.eDate}
                </label>
                <input
                  type="date"
                  value={shaft.manholeEDate}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { manholeEDate: e.target.value })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 text-xs">
              <span className="text-slate-600 font-medium">{L.duration}:</span>
              <span className="font-bold text-slate-900">
                {mhDur !== null
                  ? `${mhDur} Days`
                  : mhStatus === 'ongoing'
                  ? 'On-going'
                  : 'Not Started'}
              </span>
            </div>
          </div>

          {/* SECTION 3: MICRO-TUNNELLING CONNECTION */}
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wide">
                <ArrowRightLeft className="h-3.5 w-3.5 text-fuchsia-600" />
                {shaft.id} → {shaft.nextId}
              </h3>
              <StatusChip status={mtStatus} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500">
                  {L.pipeDia}
                </label>
                <select
                  value={shaft.pipeDia}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { pipeDia: e.target.value as PipeDia })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                >
                  <option value="DN900">DN900</option>
                  <option value="DN1100">DN1100</option>
                  <option value="DN1600">DN1600</option>
                  <option value="DN1800">DN1800</option>
                  <option value="DN2400">DN2400</option>
                  <option value="DN2600">DN2600</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-blue-700">
                  {L.totalLen} (Editable)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={shaft.tunnelLengthM}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, {
                      tunnelLengthM: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="mt-0.5 w-full rounded border border-blue-300 bg-blue-50/40 px-2 py-1 text-xs font-bold text-slate-900"
                />
              </div>
            </div>

            {/* Completed % & Completed Meters smoothly synced */}
            <div className="rounded-md border border-fuchsia-100 bg-fuchsia-50/40 p-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-fuchsia-900">
                    {L.compPct}
                  </label>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    max={100}
                    aria-label="Tunnel Completed (%)"
                    value={
                      pctDraft !== null
                        ? pctDraft
                        : String(Number(shaft.tunnelPct.toFixed(2)))
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      setPctDraft(raw);
                      setLenMDraft(null);
                      if (raw.trim() === '') {
                        onUpdateShaft(shaft.id, { tunnelPct: 0 });
                        return;
                      }
                      const num = Number(raw);
                      if (!Number.isNaN(num)) {
                        onUpdateShaft(shaft.id, {
                          tunnelPct: Number(Math.max(0, Math.min(100, num)).toFixed(4)),
                        });
                      }
                    }}
                    onBlur={() => setPctDraft(null)}
                    className="mt-0.5 w-full rounded border border-fuchsia-300 bg-white px-2 py-1 text-xs font-bold text-fuchsia-900"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-fuchsia-900">
                    {L.compLen}
                  </label>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    max={shaft.tunnelLengthM}
                    aria-label="Tunnel Completed (m)"
                    value={
                      lenMDraft !== null
                        ? lenMDraft
                        : String(Number(((shaft.tunnelLengthM * shaft.tunnelPct) / 100).toFixed(2)))
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      setLenMDraft(raw);
                      setPctDraft(null);
                      if (raw.trim() === '') {
                        onUpdateShaft(shaft.id, { tunnelPct: 0 });
                        return;
                      }
                      const parsed = Number(raw);
                      if (!Number.isNaN(parsed)) {
                        const m = Math.max(0, Math.min(shaft.tunnelLengthM, parsed));
                        const pct =
                          shaft.tunnelLengthM > 0
                            ? Number(((m / shaft.tunnelLengthM) * 100).toFixed(4))
                            : 0;
                        onUpdateShaft(shaft.id, { tunnelPct: pct });
                      }
                    }}
                    onBlur={() => setLenMDraft(null)}
                    className="mt-0.5 w-full rounded border border-fuchsia-300 bg-white px-2 py-1 text-xs font-bold text-fuchsia-900"
                  />
                </div>
              </div>

              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={shaft.tunnelPct}
                onChange={(e) => {
                  setPctDraft(null);
                  setLenMDraft(null);
                  onUpdateShaft(shaft.id, { tunnelPct: Number(e.target.value) });
                }}
                className="w-full accent-fuchsia-600"
              />
              <div className="flex flex-wrap gap-1">
                {[0, 20, 40, 50, 60, 80, 100].map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      setPctDraft(null);
                      setLenMDraft(null);
                      onUpdateShaft(shaft.id, { tunnelPct: v });
                    }}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${
                      Math.round(shaft.tunnelPct) === v
                        ? 'bg-fuchsia-600 text-white border-fuchsia-700'
                        : 'bg-white text-slate-600 border-slate-300'
                    }`}
                  >
                    {v}%
                  </button>
                ))}
              </div>
              {state.viewMode !== 'overall' && bSnap && (
                <div className="text-[11px] font-medium text-amber-800">
                  Prev Baseline: {bSnap.tunnelPct}% → Added:{' '}
                  <strong>+{Math.max(0, shaft.tunnelPct - bSnap.tunnelPct).toFixed(1)}%</strong> (
                  +
                  {(
                    (shaft.tunnelLengthM *
                      Math.max(0, shaft.tunnelPct - bSnap.tunnelPct)) /
                    100
                  ).toFixed(1)}
                  m)
                </div>
              )}
            </div>

            {/* WA Diameter-wise Micro-Tunnelling Total Length Override (DN900 / DN1100 / DN1600) */}
            {!isWc && (
              <details className="rounded-md border border-blue-200 bg-blue-50/40 p-2 text-[11px]">
                <summary className="cursor-pointer font-bold text-blue-900">
                  {lang === 'bn'
                    ? 'WA মোট দৈর্ঘ্য এডিট (DN900 / DN1100 / DN1600)'
                    : 'WA Dia Total Lengths (DN900 / DN1100 / DN1600)'}
                </summary>
                <div className="mt-2 space-y-1.5">
                  {(['DN900', 'DN1100', 'DN1600'] as const).map((dia) => {
                    const sumM = state.shafts
                      .filter((x) => x.pipeDia === dia)
                      .reduce((a, x) => a + x.tunnelLengthM, 0);
                    const overrideVal = state.settings.waTunnelDiaTotalsM?.[dia];
                    const effectiveM = overrideVal !== undefined && overrideVal > 0 ? overrideVal : sumM;
                    return (
                      <div key={dia} className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-700 w-14">{dia}:</span>
                        <input
                          type="number"
                          step="1"
                          min={0}
                          aria-label={`WA ${dia} Total Length (m)`}
                          value={Number(effectiveM.toFixed(1))}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value) || 0);
                            onUpdateState((p) => ({
                              ...p,
                              settings: {
                                ...p.settings,
                                waTunnelDiaTotalsM: {
                                  ...(p.settings.waTunnelDiaTotalsM || {}),
                                  [dia]: val,
                                },
                              },
                            }));
                          }}
                          className="w-24 rounded border border-blue-300 bg-white px-2 py-0.5 text-right font-bold text-slate-900"
                        />
                        <span className="text-[10px] font-semibold text-blue-800 w-16 text-right">
                          {(effectiveM / 1000).toFixed(3)} km
                        </span>
                      </div>
                    );
                  })}
                  <div className="text-[10px] text-slate-500 pt-0.5">
                    {lang === 'bn'
                      ? 'টিপস: সরাসরি মিটার (যেমন DN1600 = 2630) বসালে A1 রিপোর্ট ও Excel-এ সাথে সাথে আপডেট হবে।'
                      : 'Updates A1 summary & Excel immediately (e.g. DN1600 = 2630 m = 2.63 km).'}
                  </div>
                </div>
              </details>
            )}

            {/* Tunnel Dates */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500">
                  {L.sDate}
                </label>
                <input
                  type="date"
                  value={shaft.tunnelSDate}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { tunnelSDate: e.target.value })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500">
                  {L.eDate}
                </label>
                <input
                  type="date"
                  value={shaft.tunnelEDate}
                  onChange={(e) =>
                    onUpdateShaft(shaft.id, { tunnelEDate: e.target.value })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 text-xs">
              <span className="text-slate-600 font-medium">{L.duration}:</span>
              <span className="font-bold text-slate-900">
                {mtDur !== null
                  ? `${mtDur} Days`
                  : mtStatus === 'ongoing'
                  ? 'On-going'
                  : 'Not Started'}
              </span>
            </div>
          </div>

          {/* SECTION 4: POINT MAP COORDINATES + ADD CUSTOM POINT */}
          {(() => {
            const waList =
              state.waGeoNodes && state.waGeoNodes.length > 0
                ? state.waGeoNodes
                : INITIAL_WA_GEO_NODES;
            const curGeo = isWc
              ? state.wc.geoNodes.find((g) => g.id === shaft.id) || state.wc.geoNodes[0]
              : waList.find((g) => g.id === shaft.id) || waList[0];
            return (
              <div className="space-y-3">
                {curGeo && (
                  <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-xs font-bold text-sky-950 uppercase tracking-wide">
                        <MapPin className="h-3.5 w-3.5 text-sky-600" />
                        {lang === 'bn'
                          ? `${shaft.id} ম্যাপ কো-অর্ডিনেট (Auto Update)`
                          : `${shaft.id} Map Coordinates (Auto Update)`}
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500">
                          Latitude ({shaft.id})
                        </label>
                        <input
                          type="number"
                          step="0.000001"
                          aria-label={`${shaft.id} Latitude`}
                          value={curGeo.lat}
                          onChange={(e) => {
                            const nextLat = Number(e.target.value);
                            if (!Number.isFinite(nextLat)) return;
                            if (isWc) {
                              onUpdateState((prev) => ({
                                ...prev,
                                wc: {
                                  ...prev.wc,
                                  geoNodes: prev.wc.geoNodes.map((g) =>
                                    g.id === shaft.id ? { ...g, lat: nextLat } : g
                                  ),
                                },
                              }));
                            } else {
                              onUpdateState((prev) => {
                                const base =
                                  prev.waGeoNodes && prev.waGeoNodes.length > 0
                                    ? prev.waGeoNodes
                                    : INITIAL_WA_GEO_NODES.map((x) => ({ ...x }));
                                return {
                                  ...prev,
                                  waGeoNodes: base.map((g) =>
                                    g.id === shaft.id ? { ...g, lat: nextLat } : g
                                  ),
                                };
                              });
                            }
                          }}
                          className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500">
                          Longitude ({shaft.id})
                        </label>
                        <input
                          type="number"
                          step="0.000001"
                          aria-label={`${shaft.id} Longitude`}
                          value={curGeo.lon}
                          onChange={(e) => {
                            const nextLon = Number(e.target.value);
                            if (!Number.isFinite(nextLon)) return;
                            if (isWc) {
                              onUpdateState((prev) => ({
                                ...prev,
                                wc: {
                                  ...prev.wc,
                                  geoNodes: prev.wc.geoNodes.map((g) =>
                                    g.id === shaft.id ? { ...g, lon: nextLon } : g
                                  ),
                                },
                              }));
                            } else {
                              onUpdateState((prev) => {
                                const base =
                                  prev.waGeoNodes && prev.waGeoNodes.length > 0
                                    ? prev.waGeoNodes
                                    : INITIAL_WA_GEO_NODES.map((x) => ({ ...x }));
                                return {
                                  ...prev,
                                  waGeoNodes: base.map((g) =>
                                    g.id === shaft.id ? { ...g, lon: nextLon } : g
                                  ),
                                };
                              });
                            }
                          }}
                          className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <CustomMapPointsBox
                  section={isWc ? 'wc' : 'wa'}
                  points={
                    isWc ? state.wc.customPoints || [] : state.waCustomPoints || []
                  }
                  defaultLat={curGeo ? curGeo.lat : 23.735}
                  defaultLon={curGeo ? curGeo.lon : 90.432}
                  lang={lang}
                  onAddPoint={(pt) => {
                    if (isWc) {
                      onUpdateState((p) => ({
                        ...p,
                        wc: {
                          ...p.wc,
                          customPoints: [...(p.wc.customPoints || []), pt],
                        },
                      }));
                    } else {
                      onUpdateState((p) => ({
                        ...p,
                        waCustomPoints: [...(p.waCustomPoints || []), pt],
                      }));
                    }
                  }}
                  onUpdatePoint={(id, patch) => {
                    if (isWc) {
                      onUpdateState((p) => ({
                        ...p,
                        wc: {
                          ...p.wc,
                          customPoints: (p.wc.customPoints || []).map((x) =>
                            x.id === id ? { ...x, ...patch } : x
                          ),
                        },
                      }));
                    } else {
                      onUpdateState((p) => ({
                        ...p,
                        waCustomPoints: (p.waCustomPoints || []).map((x) =>
                          x.id === id ? { ...x, ...patch } : x
                        ),
                      }));
                    }
                  }}
                  onDeletePoint={(id) => {
                    if (isWc) {
                      onUpdateState((p) => ({
                        ...p,
                        wc: {
                          ...p.wc,
                          customPoints: (p.wc.customPoints || []).filter((x) => x.id !== id),
                        },
                      }));
                    } else {
                      onUpdateState((p) => ({
                        ...p,
                        waCustomPoints: (p.waCustomPoints || []).filter((x) => x.id !== id),
                      }));
                    }
                  }}
                />
              </div>
            );
          })()}

          {/* Optional Baseline Manual Adjustment (for Weekly/Monthly mode) */}
          {state.viewMode !== 'overall' && bSnap && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 text-xs">
              <button
                onClick={() => setShowBaselineOverride(!showBaselineOverride)}
                className="flex w-full items-center justify-between font-bold text-amber-900"
              >
                <span>
                  {state.viewMode === 'weekly'
                    ? 'Previous Week Baseline Override'
                    : 'Last Monthly Meeting Baseline Override'}
                </span>
                <span>{showBaselineOverride ? '▲' : '▼'}</span>
              </button>
              {showBaselineOverride && (
                <div className="mt-2 grid grid-cols-2 gap-2 pt-2 border-t border-amber-200">
                  <div>
                    <label className="block text-[10px] text-amber-800">Prev Layers</label>
                    <input
                      type="number"
                      min={0}
                      max={shaft.totalLayers}
                      value={(bSnap.layerFlags || []).filter(Boolean).length}
                      onChange={(e) =>
                        updateBaselineForSelected({ layersCount: Number(e.target.value) })
                      }
                      className="mt-0.5 w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-amber-800">Prev Tunnel (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={bSnap.tunnelPct}
                      onChange={(e) =>
                        updateBaselineForSelected({
                          tunnelPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        })
                      }
                      className="mt-0.5 w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-amber-800">Prev Casting (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={bSnap.castingPct}
                      onChange={(e) =>
                        updateBaselineForSelected({
                          castingPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        })
                      }
                      className="mt-0.5 w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-amber-800">Prev Precast (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={bSnap.precastPct}
                      onChange={(e) =>
                        updateBaselineForSelected({
                          precastPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        })
                      }
                      className="mt-0.5 w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* WC Navigation Map & KML/KMZ Upload when editing WC */}
          {isWc && (
            <MapConfigAndKmlBox
              sectionLabel="WC"
              settings={state.settings}
              overlays={state.wc.customKmlLines || []}
              lang={lang}
              onUpdateSettings={(patch) =>
                onUpdateState((p) => ({
                  ...p,
                  settings: { ...p.settings, ...patch },
                }))
              }
              onAddOverlays={(lines) =>
                onUpdateState((p) => ({
                  ...p,
                  wc: {
                    ...p.wc,
                    customKmlLines: [...(p.wc.customKmlLines || []), ...lines],
                  },
                }))
              }
              onClearOverlays={() =>
                onUpdateState((p) => ({
                  ...p,
                  wc: { ...p.wc, customKmlLines: [] },
                }))
              }
              onReplaceCoordinates={(pts) =>
                onUpdateState((p) => ({
                  ...p,
                  wc: applyKmlToWc(p.wc, pts),
                }))
              }
            />
          )}
            </>
          )}
        </div>
      )}

      {/* ==================== TAB 2: BULK QUICK TABLE ==================== */}
      {activeTab === 'table' && (
        <div className="flex flex-1 flex-col overflow-hidden p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isWc ? 'Search WC-1..WC-27...' : L.searchPlaceholder}
                className="w-full rounded-md border border-slate-300 pl-8 pr-2 py-1.5 text-xs"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | WorkStatus)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium"
            >
              <option value="all">All ({shaftsList.length})</option>
              <option value="ongoing">On-going</option>
              <option value="complete">Complete</option>
              <option value="remaining">Remaining</option>
            </select>
          </div>

          <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-2 py-1.5">Shaft</th>
                  <th className="px-1 py-1.5">Layers</th>
                  <th className="px-1 py-1.5">Cast%</th>
                  <th className="px-1 py-1.5">Ring%</th>
                  <th className="px-1 py-1.5">Len(m)</th>
                  <th className="px-1 py-1.5">Tun%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredShafts.map((s) => {
                  const doneL = getShaftCompletedLayersCount(s);
                  const isSel = s.id === selectedShaftId;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => onSelectShaft(s.id)}
                      className={`cursor-pointer hover:bg-blue-50 ${
                        isSel ? 'bg-blue-50/80' : ''
                      }`}
                    >
                      <td className="px-2 py-1.5 font-bold text-slate-900">
                        <div>{s.id}</div>
                        <div className="text-[9px] font-normal text-slate-500">
                          {s.pipeDia}
                        </div>
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          max={s.totalLayers}
                          value={doneL}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const c = Math.max(0, Math.min(s.totalLayers, Number(e.target.value) || 0));
                            onUpdateShaft(s.id, {
                              layerFlags: Array.from({ length: s.totalLayers }, (_, i) => i < c),
                            });
                          }}
                          className="w-9 rounded border border-slate-300 px-0.5 py-0.5 text-center font-semibold"
                        />
                        <span className="ml-0.5 text-[9px] text-slate-400">/{s.totalLayers}</span>
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={10}
                          value={s.castingPct}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            onUpdateShaft(s.id, {
                              castingPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                            })
                          }
                          className="w-10 rounded border border-slate-300 px-0.5 py-0.5 text-center font-semibold"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={10}
                          value={s.precastPct}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            onUpdateShaft(s.id, {
                              precastPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                            })
                          }
                          className="w-10 rounded border border-slate-300 px-0.5 py-0.5 text-center font-semibold"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={s.tunnelLengthM}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            onUpdateShaft(s.id, {
                              tunnelLengthM: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-12 rounded border border-blue-200 bg-blue-50/40 px-0.5 py-0.5 text-center font-semibold"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="any"
                          value={Number(s.tunnelPct.toFixed(1))}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            onUpdateShaft(s.id, {
                              tunnelPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                            })
                          }
                          className="w-10 rounded border border-slate-300 px-0.5 py-0.5 text-center font-semibold"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== TAB 3: SETTINGS, TITLE BLOCK & HISTORY ==================== */}
      {activeTab === 'settings' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
          {/* PROJECT DRAWING TITLE BLOCK EDITOR (ALL FIELDS EDITABLE) */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 space-y-2">
            <h3 className="flex items-center gap-1.5 font-bold text-blue-950 uppercase">
              <FileText className="h-3.5 w-3.5 text-blue-700" />
              Project Drawing Title Block (All Editable)
            </h3>

            <div>
              <label className="block text-[10px] font-semibold text-slate-600">Project Title (Top Header Subtitle)</label>
              <input
                type="text"
                aria-label="Title Block Project Title"
                value={state.settings.projectTitle}
                onChange={(e) =>
                  onUpdateState((p) => ({
                    ...p,
                    settings: { ...p.settings, projectTitle: e.target.value },
                  }))
                }
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-600">Drawing Header Main Title</label>
              <input
                type="text"
                aria-label="Drawing Header Main Title"
                value={state.settings.sectionTitle}
                onChange={(e) =>
                  onUpdateState((p) => ({
                    ...p,
                    settings: { ...p.settings, sectionTitle: e.target.value },
                  }))
                }
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Client</label>
                <input
                  type="text"
                  aria-label="Title Block Client"
                  value={state.settings.clientName}
                  onChange={(e) =>
                    onUpdateState((p) => ({
                      ...p,
                      settings: { ...p.settings, clientName: e.target.value },
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Contractor</label>
                <input
                  type="text"
                  aria-label="Title Block Contractor"
                  value={state.settings.contractorName}
                  onChange={(e) =>
                    onUpdateState((p) => ({
                      ...p,
                      settings: { ...p.settings, contractorName: e.target.value },
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Title Block Section</label>
                <input
                  type="text"
                  aria-label="Title Block Section"
                  placeholder={state.activeSection.toUpperCase()}
                  value={state.settings.customTitleBlockSection || ''}
                  onChange={(e) =>
                    onUpdateState((p) => ({
                      ...p,
                      settings: { ...p.settings, customTitleBlockSection: e.target.value },
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Date</label>
                <input
                  type="date"
                  aria-label="Title Block Date"
                  value={state.settings.reportDate}
                  onChange={(e) =>
                    onUpdateState((p) => ({
                      ...p,
                      settings: { ...p.settings, reportDate: e.target.value },
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Prepared By</label>
                <input
                  type="text"
                  aria-label="Title Block Prepared"
                  value={state.settings.preparedBy}
                  onChange={(e) =>
                    onUpdateState((p) => ({
                      ...p,
                      settings: { ...p.settings, preparedBy: e.target.value },
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Contractor Representative</label>
                <input
                  type="text"
                  aria-label="Title Block Contractor Representative"
                  value={state.settings.checkedBy}
                  onChange={(e) =>
                    onUpdateState((p) => ({
                      ...p,
                      settings: { ...p.settings, checkedBy: e.target.value },
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[10px] font-semibold text-slate-600">Drawing No</label>
                <input
                  type="text"
                  aria-label="Title Block Drawing No"
                  value={state.settings.drawingNo}
                  onChange={(e) =>
                    onUpdateState((p) => ({
                      ...p,
                      settings: { ...p.settings, drawingNo: e.target.value },
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Rev</label>
                <input
                  type="text"
                  aria-label="Title Block Revision"
                  value={state.settings.revision}
                  onChange={(e) =>
                    onUpdateState((p) => ({
                      ...p,
                      settings: { ...p.settings, revision: e.target.value },
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-600">Sheet Format Text</label>
              <input
                type="text"
                aria-label="Title Block Sheet"
                value={state.settings.sheetFormatLabel || 'ISO A1 (841 x 594 mm)'}
                onChange={(e) =>
                  onUpdateState((p) => ({
                    ...p,
                    settings: { ...p.settings, sheetFormatLabel: e.target.value },
                  }))
                }
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
              />
            </div>
          </div>

          {/* WA Micro-Tunnelling Diameter Total Lengths */}
          <div className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-fuchsia-950 uppercase">
                WA Micro-Tunnelling Total Lengths
              </h3>
              <button
                onClick={() =>
                  onUpdateState((p) => ({
                    ...p,
                    settings: { ...p.settings, waTunnelDiaTotalsM: {} },
                  }))
                }
                className="text-[10px] font-bold text-fuchsia-700 hover:underline"
              >
                Use Raw Shaft Sum
              </button>
            </div>
            <div className="space-y-1.5">
              {(['DN900', 'DN1100', 'DN1600'] as const).map((dia) => {
                const rawSum = state.shafts
                  .filter((x) => x.pipeDia === dia)
                  .reduce((a, x) => a + x.tunnelLengthM, 0);
                const over = state.settings.waTunnelDiaTotalsM?.[dia];
                const effective = over !== undefined && over > 0 ? over : rawSum;
                return (
                  <div key={dia} className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800 w-16">{dia}</span>
                    <input
                      type="number"
                      step="1"
                      min={0}
                      value={Number(effective.toFixed(1))}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value) || 0);
                        onUpdateState((p) => ({
                          ...p,
                          settings: {
                            ...p.settings,
                            waTunnelDiaTotalsM: {
                              ...(p.settings.waTunnelDiaTotalsM || {}),
                              [dia]: v,
                            },
                          },
                        }));
                      }}
                      className="w-24 rounded border border-fuchsia-300 bg-white px-2 py-1 text-right font-bold"
                    />
                    <span className="text-[11px] font-semibold text-fuchsia-900 w-20 text-right">
                      = {(effective / 1000).toFixed(3)} km
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* A1 Layout & Map Options */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <h3 className="font-bold text-slate-800 uppercase">A1 Layout & Map Settings</h3>
            <div>
              <label className="block text-[10px] text-slate-500">A1 Grid Layout</label>
              <select
                value={state.settings.layoutMode}
                onChange={(e) =>
                  onUpdateState((p) => ({
                    ...p,
                    settings: {
                      ...p.settings,
                      layoutMode: e.target.value as '10col' | '12col',
                    },
                  }))
                }
                className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1"
              >
                <option value="10col">A1 Balanced (10 Cols)</option>
                <option value="12col">Original PDF (12 Cols)</option>
              </select>
            </div>

            <label className="flex items-center gap-2 pt-1 font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={state.settings.showPumpStation}
                onChange={(e) =>
                  onUpdateState((p) => ({
                    ...p,
                    settings: { ...p.settings, showPumpStation: e.target.checked },
                  }))
                }
                className="h-4 w-4 rounded"
              />
              Show Pump Station on A1 Sheet
            </label>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.settings.showMapBackground}
                  onChange={(e) =>
                    onUpdateState((p) => ({
                      ...p,
                      settings: { ...p.settings, showMapBackground: e.target.checked },
                    }))
                  }
                  className="h-4 w-4 rounded"
                />
                Navigation Map Tiles
              </label>
              <select
                value={state.settings.mapStyle}
                onChange={(e) =>
                  onUpdateState((p) => ({
                    ...p,
                    settings: {
                      ...p.settings,
                      mapStyle: e.target.value as 'voyager' | 'light' | 'cad',
                    },
                  }))
                }
                className="w-full rounded border border-slate-300 px-2 py-1"
              >
                <option value="voyager">Map: Street Voyager</option>
                <option value="light">Map: Clean Light</option>
                <option value="cad">Map: Vector CAD Grid</option>
              </select>
            </div>
          </div>

          {/* Color Scheme Customization */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 uppercase">
                Color Settings (Weekly / Monthly)
              </h3>
              <button
                onClick={() =>
                  onUpdateState((p) => ({ ...p, colors: { ...DEFAULT_COLORS } }))
                }
                className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['thisWeekHighlight', 'This Week Added'],
                ['prevWeekShaft', 'Prev Week (Shaft)'],
                ['prevWeekManhole', 'Prev Week (Manhole)'],
                ['prevWeekTunnel', 'Prev Week (Tunnel)'],
                ['thisMonthHighlight', 'This Month Added'],
                ['prevMonthShaft', 'Prev Meeting (Shaft)'],
                ['overallCasting', 'Overall Casting'],
                ['overallPrecast', 'Overall Precast'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1">
                  <span className="text-[11px] text-slate-700">{label}</span>
                  <input
                    type="color"
                    value={state.colors[key as keyof typeof state.colors]}
                    onChange={(e) =>
                      onUpdateState((p) => ({
                        ...p,
                        colors: { ...p.colors, [key]: e.target.value },
                      }))
                    }
                    className="h-5 w-7 cursor-pointer rounded border-0 bg-transparent"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Period History Log */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <h3 className="flex items-center gap-1.5 font-bold text-slate-800 uppercase">
              <History className="h-3.5 w-3.5 text-blue-600" />
              Saved Weekly & Monthly History ({state.history.length})
            </h3>
            {state.history.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                No locked periods yet. Use &ldquo;Close Week&rdquo; or &ldquo;Close Month&rdquo; from the top bar after updating progress!
              </p>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {state.history.map((h) => (
                  <div
                    key={h.id}
                    className="rounded border border-slate-200 bg-slate-50 p-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{h.label}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          h.type === 'weekly'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-cyan-100 text-cyan-800'
                        }`}
                      >
                        {h.type}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-600">
                      Date: {formatDateDisplay(h.date)} · Shafts: {h.summary.completedShafts}/37 ·
                      MH: {h.summary.completedManholes}/37 · Tunnel:{' '}
                      {h.summary.tunnelCompletedKm.toFixed(3)} km
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
