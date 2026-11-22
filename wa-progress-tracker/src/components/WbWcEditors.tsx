import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  FileText,
  Map as MapIcon,
  MapPin,
  RotateCcw,
  Ruler,
  Search,
  Table2,
  Trash2,
  Upload,
  CheckCircle2,
  Clock,
  CircleDashed,
  Plus,
} from 'lucide-react';
import {
  AppState,
  CustomMapPoint,
  KmlOverlayLine,
  SheetSettings,
  UiLang,
  WbNodeRecord,
  WbSectionData,
  WcSectionData,
  WorkStatus,
} from '../types';
import {
  calcDurationDays,
  formatDateDisplay,
  recomputeWbChainages,
} from '../utils/calculations';
import { computeWbPolylineSplit, parseKmlOrKmzOrCsvFile } from '../utils/geoMap';
import {
  DEFAULT_AIR_VALVE_COORD,
  DEFAULT_WASHOUT_COORD,
  haversineMeters,
} from '../data/wbcInitialData';

interface CustomMapPointsBoxProps {
  section: 'wa' | 'wb' | 'wc';
  points: CustomMapPoint[];
  defaultLat: number;
  defaultLon: number;
  lang: UiLang;
  onAddPoint: (pt: CustomMapPoint) => void;
  onUpdatePoint: (id: string, patch: Partial<CustomMapPoint>) => void;
  onDeletePoint: (id: string) => void;
}

export const CustomMapPointsBox: React.FC<CustomMapPointsBoxProps> = ({
  section,
  points,
  defaultLat,
  defaultLon,
  lang,
  onAddPoint,
  onUpdatePoint,
  onDeletePoint,
}) => {
  const [name, setName] = useState('');
  const [latStr, setLatStr] = useState(defaultLat.toFixed(6));
  const [lonStr, setLonStr] = useState(defaultLon.toFixed(6));

  useEffect(() => {
    setLatStr(defaultLat.toFixed(6));
    setLonStr(defaultLon.toFixed(6));
  }, [section, defaultLat, defaultLon]);

  const handleAdd = () => {
    const cleanName = name.trim();
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!cleanName || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    onAddPoint({
      id: `pt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      section,
      name: cleanName,
      lat,
      lon,
    });
    setName('');
  };

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-2.5 space-y-2 text-xs">
      <h4 className="flex items-center justify-between font-bold text-purple-950 uppercase tracking-wide">
        <span className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-purple-600" />
          {lang === 'bn'
            ? `${section.toUpperCase()} ম্যাপে নতুন পয়েন্ট যোগ করুন`
            : `Add Custom Point on ${section.toUpperCase()} Map`}
        </span>
        <span className="text-[10px] font-semibold text-purple-700">
          {points.length} {lang === 'bn' ? 'টি' : 'pts'}
        </span>
      </h4>

      <div className="space-y-1.5 rounded border border-purple-200 bg-white p-2">
        <div>
          <label className="block text-[10px] font-semibold text-slate-600">
            {lang === 'bn' ? 'পয়েন্টের নাম (Point Name)' : 'Point Name'}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={lang === 'bn' ? 'যেমন: New Valve / Check Point' : 'e.g. New Valve / Check Point'}
            aria-label="New Map Point Name"
            className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="block text-[10px] text-slate-500">Latitude</label>
            <input
              type="number"
              step="0.000001"
              aria-label="New Map Point Latitude"
              value={latStr}
              onChange={(e) => setLatStr(e.target.value)}
              className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-[11px] font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500">Longitude</label>
            <input
              type="number"
              step="0.000001"
              aria-label="New Map Point Longitude"
              value={lonStr}
              onChange={(e) => setLonStr(e.target.value)}
              className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-[11px] font-mono"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!name.trim()}
          className="flex w-full items-center justify-center gap-1 rounded bg-purple-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-purple-700 disabled:opacity-45"
        >
          <Plus className="h-3.5 w-3.5" />
          {lang === 'bn' ? '+ ম্যাপে পয়েন্ট যোগ করুন' : '+ Add Point to Map'}
        </button>
      </div>

      {points.length > 0 && (
        <div className="space-y-1.5 max-h-44 overflow-y-auto">
          {points.map((pt) => (
            <div
              key={pt.id}
              className="rounded border border-purple-200 bg-white p-1.5 space-y-1"
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={pt.name}
                  onChange={(e) => onUpdatePoint(pt.id, { name: e.target.value })}
                  className="flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => onDeletePoint(pt.id)}
                  className="rounded border border-rose-200 bg-rose-50 p-1 text-rose-600 hover:bg-rose-100"
                  title="Delete Point"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  step="0.000001"
                  value={pt.lat}
                  onChange={(e) =>
                    onUpdatePoint(pt.id, { lat: Number(e.target.value) || pt.lat })
                  }
                  className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono"
                />
                <input
                  type="number"
                  step="0.000001"
                  value={pt.lon}
                  onChange={(e) =>
                    onUpdatePoint(pt.id, { lon: Number(e.target.value) || pt.lon })
                  }
                  className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function StatusBadge({ status }: { status: WorkStatus }) {
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

interface MapUploadPanelProps {
  sectionLabel: 'WB' | 'WC';
  settings: SheetSettings;
  overlays: KmlOverlayLine[];
  lang: UiLang;
  onUpdateSettings: (patch: Partial<SheetSettings>) => void;
  onAddOverlays: (lines: KmlOverlayLine[]) => void;
  onReplaceCoordinates: (pts: Array<{ name: string; lat: number; lon: number }>) => void;
  onClearOverlays: () => void;
}

export const MapConfigAndKmlBox: React.FC<MapUploadPanelProps> = ({
  sectionLabel,
  settings,
  overlays,
  lang,
  onUpdateSettings,
  onAddOverlays,
  onReplaceCoordinates,
  onClearOverlays,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'overlay'>('overlay');
  const [msg, setMsg] = useState<string>('');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = await parseKmlOrKmzOrCsvFile(file);
      if (importMode === 'replace') {
        if (parsed.points.length >= 2) {
          onReplaceCoordinates(parsed.points);
          setMsg(
            lang === 'bn'
              ? `${parsed.points.length}টি পয়েন্ট দিয়ে ${sectionLabel} ম্যাপ আপডেট হয়েছে!`
              : `Updated ${sectionLabel} with ${parsed.points.length} coordinates!`
          );
        } else if (parsed.lines.length > 0 && parsed.lines[0].coords.length >= 2) {
          const pts = parsed.lines[0].coords.map(([lat, lon]: [number, number], i: number) => ({
            name: `${sectionLabel}${sectionLabel === 'WC' ? '-' : ''}${i + 1}`,
            lat,
            lon,
          }));
          onReplaceCoordinates(pts);
          setMsg(
            lang === 'bn'
              ? `KML লাইন থেকে ${pts.length}টি নোড তৈরি হয়েছে!`
              : `Created ${pts.length} nodes from KML track!`
          );
        } else {
          setMsg(lang === 'bn' ? 'ফাইলে যথেষ্ট কোঅর্ডিনেট পাওয়া যায়নি।' : 'Not enough coordinates found.');
        }
      } else {
        const linesToAdd: KmlOverlayLine[] = [...parsed.lines];
        if (linesToAdd.length === 0 && parsed.points.length >= 2) {
          linesToAdd.push({
            name: file.name,
            coords: parsed.points.map((p) => [p.lat, p.lon]),
          });
        }
        if (linesToAdd.length > 0) {
          onAddOverlays(linesToAdd);
          setMsg(
            lang === 'bn'
              ? `${linesToAdd.length}টি KML/KMZ ওভারলে ম্যাপে যুক্ত হয়েছে!`
              : `Added ${linesToAdd.length} KML/KMZ overlay track(s)!`
          );
        } else {
          setMsg(lang === 'bn' ? 'কোনো পাথ বা পয়েন্ট পাওয়া যায়নি।' : 'No track/points found.');
        }
      }
      setTimeout(() => setMsg(''), 4000);
    } catch {
      setMsg(lang === 'bn' ? 'KML/KMZ/CSV ফাইলটি পড়া যায়নি।' : 'Failed to parse file.');
    }
  };

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 space-y-2.5 text-xs">
      <input
        ref={fileRef}
        type="file"
        accept=".kml,.kmz,.csv"
        className="hidden"
        onChange={handleFile}
      />

      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 font-bold text-sky-950 uppercase tracking-wide">
          <MapIcon className="h-3.5 w-3.5 text-sky-600" />
          {lang === 'bn'
            ? `${sectionLabel} নেভিগেশন ম্যাপ ও KML/KMZ`
            : `${sectionLabel} Navigation Map & KML/KMZ`}
        </h4>
        <label className="flex items-center gap-1 font-semibold text-sky-900 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.showMapBackground}
            onChange={(e) => onUpdateSettings({ showMapBackground: e.target.checked })}
            className="h-3.5 w-3.5 rounded accent-sky-600"
          />
          {lang === 'bn' ? 'ম্যাপ অন' : 'Map On'}
        </label>
      </div>

      <div className="grid grid-cols-3 gap-1">
        {(
          [
            { id: 'voyager', label: 'Road Map' },
            { id: 'light', label: 'Light Map' },
            { id: 'cad', label: 'CAD Grid' },
          ] as const
        ).map((st) => (
          <button
            key={st.id}
            onClick={() =>
              onUpdateSettings({
                mapStyle: st.id,
                showMapBackground: st.id === 'cad' ? false : true,
              })
            }
            className={`rounded border px-2 py-1 text-[11px] font-bold transition ${
              settings.mapStyle === st.id
                ? 'bg-sky-600 border-sky-700 text-white'
                : 'bg-white border-sky-200 text-sky-900 hover:bg-sky-100'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5 rounded-md border border-sky-200 bg-white p-2">
        <div className="text-[10px] font-semibold text-slate-600">
          {lang === 'bn'
            ? 'KML / KMZ / CSV ফাইল আপলোড মোড:'
            : 'KML / KMZ / CSV Upload Action:'}
        </div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <button
            onClick={() => setImportMode('overlay')}
            className={`rounded border px-2 py-1 font-semibold ${
              importMode === 'overlay'
                ? 'bg-indigo-600 border-indigo-700 text-white'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            Add Map Overlay
          </button>
          <button
            onClick={() => setImportMode('replace')}
            className={`rounded border px-2 py-1 font-semibold ${
              importMode === 'replace'
                ? 'bg-indigo-600 border-indigo-700 text-white'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            Replace {sectionLabel} Nodes
          </button>
        </div>

        <div className="flex items-center gap-1.5 pt-1">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-sky-700"
          >
            <Upload className="h-3.5 w-3.5" />
            {lang === 'bn' ? 'KML / KMZ / CSV আপলোড' : 'Upload .KML / .KMZ / .CSV'}
          </button>
          {overlays.length > 0 && (
            <button
              onClick={onClearOverlays}
              className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
              title="Clear custom overlays"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {overlays.length > 0 && (
          <div className="text-[10px] font-medium text-sky-800">
            Active KML Overlays: {overlays.length}
          </div>
        )}
        {msg && <div className="text-[10px] font-bold text-emerald-700">{msg}</div>}
      </div>
    </div>
  );
};

interface WbEditorPanelProps {
  state: AppState;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  onUpdateWb: (updater: (wb: WbSectionData) => WbSectionData) => void;
  onUpdateSettings: (patch: Partial<SheetSettings>) => void;
  onSyncTotalLengthFromGps?: () => void;
  requestedTab?: { tab: 'single' | 'table' | 'settings'; seq: number };
}

export const WbEditorPanel: React.FC<WbEditorPanelProps> = ({
  state,
  selectedNodeId,
  onSelectNode,
  onUpdateWb,
  onUpdateSettings,
  requestedTab,
}) => {
  const [tab, setTab] = useState<'single' | 'table' | 'titleblock'>('single');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WorkStatus>('all');

  useEffect(() => {
    if (requestedTab && requestedTab.seq > 0) {
      setTab(requestedTab.tab === 'settings' ? 'titleblock' : requestedTab.tab);
    }
  }, [requestedTab]);

  const wb = state.wb;
  const lang = state.uiLang;
  const isBn = lang === 'bn';

  const nodeIdx = wb.nodes.findIndex((n) => n.id === selectedNodeId);
  const currentNode = wb.nodes[nodeIdx >= 0 ? nodeIdx : 0];
  const prevNode = nodeIdx > 0 ? wb.nodes[nodeIdx - 1] : null;
  const nextNode = nodeIdx >= 0 && nodeIdx < wb.nodes.length - 1 ? wb.nodes[nodeIdx + 1] : null;

  const pct = wb.totalLengthM > 0 ? Math.min(100, (wb.completedLengthM / wb.totalLengthM) * 100) : 0;
  const remM = Math.max(0, wb.totalLengthM - wb.completedLengthM);
  const split = computeWbPolylineSplit(wb.nodes, wb.completedLengthM, 0);

  const updateNode = (id: string, patch: Partial<WbNodeRecord>) => {
    onUpdateWb((prev) => {
      const nextNodes = prev.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
      return {
        ...prev,
        nodes:
          patch.lat !== undefined || patch.lon !== undefined
            ? recomputeWbChainages(nextNodes, prev.totalLengthM)
            : nextNodes,
      };
    });
  };

  const handleSyncNodesToLength = (completedLenM: number) => {
    onUpdateWb((prev) => ({
      ...prev,
      completedLengthM: completedLenM,
      nodes: prev.nodes.map((n) => ({
        ...n,
        status:
          n.chainageM <= completedLenM + 0.05
            ? 'complete'
            : n.status === 'ongoing'
            ? 'ongoing'
            : 'remaining',
      })),
    }));
  };

  const filteredNodes = wb.nodes.filter((n) => {
    const matchText = !search.trim() || n.id.toLowerCase().includes(search.trim().toLowerCase());
    if (!matchText) return false;
    if (statusFilter === 'all') return true;
    return n.status === statusFilter;
  });

  const dur = currentNode ? calcDurationDays(currentNode.sDate, currentNode.eDate) : null;

  return (
    <aside className="no-print flex h-full flex-col border-l border-slate-200 bg-white">
      {/* Top 3 Tabs for WB */}
      <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold">
        <button
          onClick={() => setTab('single')}
          className={`flex items-center justify-center gap-1 py-2.5 border-b-2 transition ${
            tab === 'single'
              ? 'border-emerald-600 bg-white text-emerald-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <MapPin className="h-3.5 w-3.5" />
          {isBn ? 'WB এডিট' : 'WB Edit'}
        </button>
        <button
          onClick={() => setTab('table')}
          className={`flex items-center justify-center gap-1 py-2.5 border-b-2 transition ${
            tab === 'table'
              ? 'border-emerald-600 bg-white text-emerald-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Table2 className="h-3.5 w-3.5" />
          {isBn ? `সব ${wb.nodes.length}` : `Nodes (${wb.nodes.length})`}
        </button>
        <button
          onClick={() => setTab('titleblock')}
          className={`flex items-center justify-center gap-1 py-2.5 border-b-2 transition ${
            tab === 'titleblock'
              ? 'border-blue-600 bg-white text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          Title Block
        </button>
      </div>

      {tab === 'single' && currentNode && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* 1. WB COMPLETED LENGTH (GREEN -> BLUE CIRCLE TIP -> RED REMAINING) */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-emerald-950 uppercase tracking-wide">
                <Ruler className="h-3.5 w-3.5 text-emerald-600" />
                {isBn ? 'WB পাইপলাইন দৈর্ঘ্য ও নীল চিহ্ন' : 'WB Length & Blue Tip Marker'}
              </h3>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
                {pct.toFixed(1)}%
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-xs">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">
                  {isBn ? 'মোট (m)' : 'Total (m)'}
                </label>
                <input
                  type="number"
                  step="1"
                  min={1}
                  value={wb.totalLengthM}
                  onChange={(e) => {
                    const tot = Math.max(1, Number(e.target.value) || 1);
                    onUpdateWb((prev) => ({
                      ...prev,
                      totalLengthM: tot,
                      completedLengthM: Math.min(prev.completedLengthM, tot),
                      nodes: recomputeWbChainages(prev.nodes, tot),
                    }));
                  }}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-emerald-800">
                  {isBn ? 'সম্পন্ন (m)' : 'Completed (m)'}
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={wb.totalLengthM}
                  value={wb.completedLengthM}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(wb.totalLengthM, Number(e.target.value) || 0));
                    onUpdateWb((prev) => ({ ...prev, completedLengthM: val }));
                  }}
                  className="mt-0.5 w-full rounded border border-emerald-400 bg-white px-2 py-1 text-xs font-bold text-emerald-900"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-blue-800">
                  {isBn ? 'সম্পন্ন (%)' : 'Done (%)'}
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={100}
                  aria-label="WB Completed (%)"
                  value={Number(pct.toFixed(1))}
                  onChange={(e) => {
                    const p = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    const m = Number(((wb.totalLengthM * p) / 100).toFixed(1));
                    onUpdateWb((prev) => ({ ...prev, completedLengthM: m }));
                  }}
                  className="mt-0.5 w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs font-bold text-blue-900"
                />
              </div>
            </div>

            {/* Visual Green + Blue Circle Tip + Red Remaining bar */}
            <div className="space-y-1.5">
              <input
                type="range"
                min={0}
                max={wb.totalLengthM}
                step={0.5}
                value={wb.completedLengthM}
                onChange={(e) =>
                  onUpdateWb((prev) => ({ ...prev, completedLengthM: Number(e.target.value) }))
                }
                className="w-full accent-emerald-600"
              />
              <div className="grid grid-cols-5 gap-1 text-[10px]">
                {[25, 50, 100].map((inc) => (
                  <button
                    key={inc}
                    onClick={() =>
                      onUpdateWb((prev) => ({
                        ...prev,
                        completedLengthM: Math.min(prev.totalLengthM, Number((prev.completedLengthM + inc).toFixed(1))),
                      }))
                    }
                    className="rounded border border-emerald-300 bg-white py-0.5 font-bold text-emerald-800 hover:bg-emerald-100"
                  >
                    +{inc}m
                  </button>
                ))}
                <button
                  onClick={() =>
                    onUpdateWb((prev) => ({
                      ...prev,
                      completedLengthM: Number((prev.totalLengthM * 0.5).toFixed(1)),
                    }))
                  }
                  className="rounded border border-blue-300 bg-white py-0.5 font-bold text-blue-800 hover:bg-blue-50"
                >
                  50%
                </button>
                <button
                  onClick={() =>
                    onUpdateWb((prev) => ({
                      ...prev,
                      completedLengthM: prev.totalLengthM,
                    }))
                  }
                  className="rounded border border-emerald-700 bg-emerald-600 py-0.5 font-bold text-white hover:bg-emerald-700"
                >
                  100%
                </button>
              </div>
              <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-rose-500">
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-semibold">
                <span className="text-emerald-700">Done: {wb.completedLengthM.toFixed(1)} m</span>
                <span className="text-blue-700 font-bold">
                  ● Blue Tip @ {split.tipPoint ? `${split.tipPoint.chainageM.toFixed(1)}m` : '0m'}
                </span>
                <span className="text-rose-700">Rem: {remM.toFixed(1)} m</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Pipe Spec</label>
                <input
                  type="text"
                  value={wb.pipeDia}
                  onChange={(e) => onUpdateWb((p) => ({ ...p, pipeDia: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => handleSyncNodesToLength(wb.completedLengthM)}
                  className="w-full rounded border border-emerald-600 bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700"
                  title="Mark all nodes up to Blue Tip as Complete"
                >
                  {isBn ? 'টিপ পর্যন্ত নোড Complete করুন' : 'Sync Nodes ≤ Blue Tip'}
                </button>
              </div>
            </div>
          </div>

          {/* 2. INDIVIDUAL WB NODE EDITOR (WB1 - WB38) */}
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/70 p-2">
              <button
                disabled={!prevNode}
                onClick={() => prevNode && onSelectNode(prevNode.id)}
                className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <div className="flex flex-1 flex-col items-center">
                <select
                  value={currentNode.id}
                  onChange={(e) => onSelectNode(e.target.value)}
                  className="w-full rounded-md border border-blue-300 bg-white px-2.5 py-1 text-center text-sm font-bold text-blue-900"
                >
                  {wb.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.id} — {n.chainageM.toFixed(1)}m ({n.status.toUpperCase()})
                    </option>
                  ))}
                </select>
                <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                  <StatusBadge status={currentNode.status} />
                  <span className="font-semibold text-slate-600">
                    Chainage: {currentNode.chainageM.toFixed(1)} m
                  </span>
                </div>
              </div>

              <button
                disabled={!nextNode}
                onClick={() => nextNode && onSelectNode(nextNode.id)}
                className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                {isBn ? 'নোডের অবস্থা (Node Status)' : 'Node Work Status'}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['complete', 'ongoing', 'remaining'] as WorkStatus[]).map((st) => {
                  const active = currentNode.status === st;
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
                      onClick={() => updateNode(currentNode.id, { status: st })}
                      className={`rounded-md border px-2 py-1.5 text-[11px] font-bold capitalize transition ${style}`}
                    >
                      {st === 'ongoing' ? 'On-going' : st}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => handleSyncNodesToLength(currentNode.chainageM)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-[11px] font-bold text-blue-900 hover:bg-blue-100"
            >
              <Compass className="h-3.5 w-3.5 text-blue-600" />
              {isBn
                ? `${currentNode.id} (${currentNode.chainageM.toFixed(1)}m) পর্যন্ত Completed ধরুন`
                : `Set Blue Tip to ${currentNode.id} (${currentNode.chainageM.toFixed(1)} m)`}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500">S. Date</label>
                <input
                  type="date"
                  value={currentNode.sDate}
                  onChange={(e) => updateNode(currentNode.id, { sDate: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500">E. Date</label>
                <input
                  type="date"
                  value={currentNode.eDate}
                  onChange={(e) => updateNode(currentNode.id, { eDate: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 text-xs">
              <span className="text-slate-600 font-medium">Duration:</span>
              <span className="font-bold text-slate-900">
                {dur !== null ? `${dur} Days` : currentNode.status === 'ongoing' ? 'On-going' : '-'}
              </span>
            </div>

            {/* GPS Coordinates */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="block text-[10px] text-slate-500">Latitude ({currentNode.id})</label>
                <input
                  type="number"
                  step="0.000001"
                  aria-label="WB Node Latitude"
                  value={currentNode.lat}
                  onChange={(e) =>
                    updateNode(currentNode.id, { lat: Number(e.target.value) || currentNode.lat })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-[11px] font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500">Longitude ({currentNode.id})</label>
                <input
                  type="number"
                  step="0.000001"
                  aria-label="WB Node Longitude"
                  value={currentNode.lon}
                  onChange={(e) =>
                    updateNode(currentNode.id, { lon: Number(e.target.value) || currentNode.lon })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-[11px] font-mono"
                />
              </div>
            </div>
          </div>

          {/* 2B. WASHOUT & AIR VALVE COORDINATES */}
          <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-2.5 space-y-2 text-xs">
            <h4 className="flex items-center gap-1.5 font-bold text-teal-950 uppercase tracking-wide">
              <MapPin className="h-3.5 w-3.5 text-teal-600" />
              {isBn
                ? 'Washout ও Air Valve কো-অর্ডিনেট (Auto Map Update)'
                : 'Washout & Air Valve Coordinates'}
            </h4>
            {(() => {
              const wCoord = wb.washoutCoord || DEFAULT_WASHOUT_COORD;
              const aCoord = wb.airValveCoord || DEFAULT_AIR_VALVE_COORD;
              return (
                <div className="space-y-2">
                  <div className="rounded border border-emerald-200 bg-white p-2 space-y-1">
                    <div className="text-[10px] font-bold text-emerald-800">WASHOUT (Green Triangle)</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="block text-[9px] text-slate-500">Washout Lat</label>
                        <input
                          type="number"
                          step="0.000001"
                          aria-label="Washout Latitude"
                          value={wCoord.lat}
                          onChange={(e) =>
                            onUpdateWb((prev) => ({
                              ...prev,
                              washoutCoord: {
                                lat: Number(e.target.value) || wCoord.lat,
                                lon: (prev.washoutCoord || wCoord).lon,
                              },
                            }))
                          }
                          className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-slate-500">Washout Lon</label>
                        <input
                          type="number"
                          step="0.000001"
                          aria-label="Washout Longitude"
                          value={wCoord.lon}
                          onChange={(e) =>
                            onUpdateWb((prev) => ({
                              ...prev,
                              washoutCoord: {
                                lat: (prev.washoutCoord || wCoord).lat,
                                lon: Number(e.target.value) || wCoord.lon,
                              },
                            }))
                          }
                          className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-sky-200 bg-white p-2 space-y-1">
                    <div className="text-[10px] font-bold text-sky-800">AIR VALVE (Blue Triangle)</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="block text-[9px] text-slate-500">Air Valve Lat</label>
                        <input
                          type="number"
                          step="0.000001"
                          aria-label="Air Valve Latitude"
                          value={aCoord.lat}
                          onChange={(e) =>
                            onUpdateWb((prev) => ({
                              ...prev,
                              airValveCoord: {
                                lat: Number(e.target.value) || aCoord.lat,
                                lon: (prev.airValveCoord || aCoord).lon,
                              },
                            }))
                          }
                          className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-slate-500">Air Valve Lon</label>
                        <input
                          type="number"
                          step="0.000001"
                          aria-label="Air Valve Longitude"
                          value={aCoord.lon}
                          onChange={(e) =>
                            onUpdateWb((prev) => ({
                              ...prev,
                              airValveCoord: {
                                lat: (prev.airValveCoord || aCoord).lat,
                                lon: Number(e.target.value) || aCoord.lon,
                              },
                            }))
                          }
                          className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* 2C. ADD CUSTOM NAMED POINTS ON WB MAP */}
          <CustomMapPointsBox
            section="wb"
            points={wb.customPoints || []}
            defaultLat={currentNode.lat}
            defaultLon={currentNode.lon}
            lang={lang}
            onAddPoint={(pt) =>
              onUpdateWb((prev) => ({
                ...prev,
                customPoints: [...(prev.customPoints || []), pt],
              }))
            }
            onUpdatePoint={(id, patch) =>
              onUpdateWb((prev) => ({
                ...prev,
                customPoints: (prev.customPoints || []).map((p) =>
                  p.id === id ? { ...p, ...patch } : p
                ),
              }))
            }
            onDeletePoint={(id) =>
              onUpdateWb((prev) => ({
                ...prev,
                customPoints: (prev.customPoints || []).filter((p) => p.id !== id),
              }))
            }
          />

          {/* 3. MAP STYLE + KML/KMZ UPLOAD */}
          <MapConfigAndKmlBox
            sectionLabel="WB"
            settings={state.settings}
            overlays={wb.customKmlLines || []}
            lang={lang}
            onUpdateSettings={onUpdateSettings}
            onAddOverlays={(lines) =>
              onUpdateWb((prev) => ({
                ...prev,
                customKmlLines: [...(prev.customKmlLines || []), ...lines],
              }))
            }
            onClearOverlays={() =>
              onUpdateWb((prev) => ({ ...prev, customKmlLines: [] }))
            }
            onReplaceCoordinates={(pts) => {
              let rawTotal = 0;
              for (let i = 1; i < pts.length; i++) {
                rawTotal += haversineMeters(
                  pts[i - 1].lat,
                  pts[i - 1].lon,
                  pts[i].lat,
                  pts[i].lon
                );
              }
              const nextTotal = Math.round(rawTotal) || prevTotalFallback(wb.totalLengthM);
              const newNodes: WbNodeRecord[] = pts.map((p, idx) => ({
                id: p.name || `WB${idx + 1}`,
                index: idx + 1,
                lat: p.lat,
                lon: p.lon,
                chainageM: 0,
                status: 'remaining',
                sDate: '',
                eDate: '',
                note: '',
              }));
              onUpdateWb((prev) => ({
                ...prev,
                totalLengthM: nextTotal,
                completedLengthM: Math.min(prev.completedLengthM, nextTotal),
                nodes: recomputeWbChainages(newNodes, nextTotal),
              }));
            }}
          />
        </div>
      )}

      {tab === 'table' && (
        <div className="flex flex-1 flex-col overflow-hidden p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search WB1..WB38..."
                className="w-full rounded-md border border-slate-300 pl-8 pr-2 py-1.5 text-xs"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | WorkStatus)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium"
            >
              <option value="all">All ({wb.nodes.length})</option>
              <option value="complete">Complete</option>
              <option value="ongoing">On-going</option>
              <option value="remaining">Remaining</option>
            </select>
          </div>

          <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-2 py-1.5">Node</th>
                  <th className="px-1.5 py-1.5">Ch (m)</th>
                  <th className="px-1.5 py-1.5">Status</th>
                  <th className="px-1.5 py-1.5">Dates</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredNodes.map((n) => {
                  const isSel = n.id === currentNode?.id;
                  return (
                    <tr
                      key={n.id}
                      onClick={() => onSelectNode(n.id)}
                      className={`cursor-pointer hover:bg-blue-50 ${isSel ? 'bg-blue-50/90' : ''}`}
                    >
                      <td className="px-2 py-1.5 font-bold text-slate-900">{n.id}</td>
                      <td className="px-1.5 py-1.5 font-mono text-slate-600">
                        {n.chainageM.toFixed(1)}
                      </td>
                      <td className="px-1.5 py-1.5">
                        <select
                          value={n.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            updateNode(n.id, { status: e.target.value as WorkStatus })
                          }
                          className={`rounded border px-1 py-0.5 text-[10px] font-bold ${
                            n.status === 'complete'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : n.status === 'ongoing'
                              ? 'border-amber-300 bg-amber-50 text-amber-800'
                              : 'border-rose-300 bg-rose-50 text-rose-800'
                          }`}
                        >
                          <option value="complete">Done</option>
                          <option value="ongoing">On-going</option>
                          <option value="remaining">Rem</option>
                        </select>
                      </td>
                      <td className="px-1.5 py-1.5 text-[10px] text-slate-500">
                        {formatDateDisplay(n.sDate) || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'titleblock' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
          <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 space-y-2">
            <h3 className="flex items-center gap-1.5 font-bold text-blue-950 uppercase">
              <FileText className="h-3.5 w-3.5 text-blue-700" />
              Project Drawing Title Block
            </h3>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600">Project Title</label>
              <input
                type="text"
                value={state.settings.projectTitle}
                onChange={(e) => onUpdateSettings({ projectTitle: e.target.value })}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600">Header Main Title</label>
              <input
                type="text"
                value={state.settings.sectionTitle}
                onChange={(e) => onUpdateSettings({ sectionTitle: e.target.value })}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Client</label>
                <input
                  type="text"
                  value={state.settings.clientName}
                  onChange={(e) => onUpdateSettings({ clientName: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Contractor</label>
                <input
                  type="text"
                  value={state.settings.contractorName}
                  onChange={(e) => onUpdateSettings({ contractorName: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Title Block Section</label>
                <input
                  type="text"
                  placeholder={state.activeSection.toUpperCase()}
                  value={state.settings.customTitleBlockSection || ''}
                  onChange={(e) => onUpdateSettings({ customTitleBlockSection: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Date</label>
                <input
                  type="date"
                  value={state.settings.reportDate}
                  onChange={(e) => onUpdateSettings({ reportDate: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Prepared By</label>
                <input
                  type="text"
                  value={state.settings.preparedBy}
                  onChange={(e) => onUpdateSettings({ preparedBy: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Contractor Representative</label>
                <input
                  type="text"
                  aria-label="Title Block Contractor Representative"
                  value={state.settings.checkedBy}
                  onChange={(e) => onUpdateSettings({ checkedBy: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[10px] font-semibold text-slate-600">Drawing No</label>
                <input
                  type="text"
                  value={state.settings.drawingNo}
                  onChange={(e) => onUpdateSettings({ drawingNo: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600">Rev</label>
                <input
                  type="text"
                  value={state.settings.revision}
                  onChange={(e) => onUpdateSettings({ revision: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600">Sheet Format Text</label>
              <input
                type="text"
                value={state.settings.sheetFormatLabel || 'ISO A1 (841 x 594 mm)'}
                onChange={(e) => onUpdateSettings({ sheetFormatLabel: e.target.value })}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1"
              />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

function prevTotalFallback(val: number): number {
  return val > 0 ? val : 1650;
}

export function applyKmlToWc(
  prev: WcSectionData,
  pts: Array<{ name: string; lat: number; lon: number }>
): WcSectionData {
  const nextNodes = pts.map((p, i) => ({
    id: p.name.startsWith('WC') ? p.name : `WC-${i + 1}`,
    index: i + 1,
    lat: p.lat,
    lon: p.lon,
  }));
  // Also update shaft coordinates/lengths if counts match or resize smoothly
  const updatedShafts = nextNodes.map((gn, idx) => {
    const existing = prev.shafts[idx];
    const nextPt = nextNodes[idx + 1];
    const segLen =
      nextPt && existing
        ? Number(haversineMeters(gn.lat, gn.lon, nextPt.lat, nextPt.lon).toFixed(1)) ||
          existing.tunnelLengthM
        : existing?.tunnelLengthM ?? 0;

    if (existing) {
      return {
        ...existing,
        id: gn.id,
        nextId: nextPt ? nextPt.id : 'END',
        tunnelLengthM: segLen,
      };
    }
    return {
      index: idx + 1,
      id: gn.id,
      nextId: nextPt ? nextPt.id : 'END',
      shaftSize: '5000x3600',
      shaftType: idx === 0 ? ('Driving' as const) : ('Receiving/Driving' as const),
      netHeightMm: 10000,
      bottomSlabMm: 600,
      sheetPileStyle: false,
      totalLayers: 8,
      layerFlags: Array(8).fill(false),
      bottomSlabDone: false,
      shaftSDate: '',
      shaftEDate: '',
      castingPct: 0,
      precastPct: 0,
      manholeSDate: '',
      manholeEDate: '',
      pipeDia: 'DN1800' as const,
      tunnelLengthM: segLen,
      tunnelPct: 0,
      tunnelSDate: '',
      tunnelEDate: '',
      isEndNode: idx === nextNodes.length - 1,
    };
  });

  return {
    ...prev,
    geoNodes: nextNodes,
    shafts: updatedShafts,
  };
}

export { RotateCcw };
