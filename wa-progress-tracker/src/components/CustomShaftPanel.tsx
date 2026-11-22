import React, { useEffect, useState } from 'react';
import { CheckSquare, Layers, SlidersHorizontal, Square } from 'lucide-react';
import { AppState, CustomShaftViewConfig } from '../types';
import {
  computeSummary,
  getShaftStatus,
  resolveDisplayContext,
} from '../utils/calculations';

interface CustomShaftPanelProps {
  state: AppState;
  selectedShaftId: string;
  onUpdateCustomView: (patch: Partial<CustomShaftViewConfig>) => void;
  onOpenShaftEditor: (shaftId: string, section: 'wa' | 'wc') => void;
}

const DEFAULT_CUSTOM_CONFIG: CustomShaftViewConfig = {
  section: 'wa',
  selectedIds: ['WA-17', 'WA-18', 'WA-19', 'WA-20', 'WA-21', 'WA-22', 'WA-23', 'WA-24'],
  showTunneling: true,
  includePumpStation: false,
};

export const CustomShaftPanel: React.FC<CustomShaftPanelProps> = ({
  state,
  selectedShaftId,
  onUpdateCustomView,
  onOpenShaftEditor,
}) => {
  const isBn = state.uiLang === 'bn';
  const cfg = state.customView || DEFAULT_CUSTOM_CONFIG;
  const ctx = resolveDisplayContext(state);

  const sourceShafts = cfg.section === 'wc' ? ctx.displayWc.shafts : ctx.displayShafts;
  const selectedSet = new Set(cfg.selectedIds);
  const selectedShafts = sourceShafts.filter((s) => selectedSet.has(s.id));
  const baselineOverride =
    cfg.section === 'wc' ? ctx.baseline.wcShafts || {} : undefined;
  const includePump =
    cfg.section === 'wa' &&
    cfg.includePumpStation &&
    selectedShafts.some((s) => s.id === 'WA-36');
  const summary = computeSummary(
    selectedShafts,
    ctx.baseline,
    includePump ? ctx.displayPump : undefined,
    baselineOverride
  );

  const firstId = selectedShafts[0]?.id || sourceShafts[0]?.id || '';
  const lastId =
    selectedShafts[selectedShafts.length - 1]?.id ||
    sourceShafts[Math.min(7, sourceShafts.length - 1)]?.id ||
    firstId;

  const [rangeFrom, setRangeFrom] = useState<string>(firstId);
  const [rangeTo, setRangeTo] = useState<string>(lastId);

  useEffect(() => {
    setRangeFrom(firstId);
    setRangeTo(lastId);
  }, [cfg.section, firstId, lastId]);

  const handleSectionChange = (nextSection: 'wa' | 'wc') => {
    if (nextSection === cfg.section) return;
    const nextList = nextSection === 'wc' ? ctx.displayWc.shafts : ctx.displayShafts;
    const defaultSlice =
      nextSection === 'wa'
        ? ['WA-17', 'WA-18', 'WA-19', 'WA-20', 'WA-21', 'WA-22', 'WA-23', 'WA-24']
        : nextList.slice(0, 8).map((s) => s.id);
    onUpdateCustomView({
      section: nextSection,
      selectedIds: defaultSlice,
    });
  };

  const handleApplyRange = () => {
    const idxA = sourceShafts.findIndex((s) => s.id === rangeFrom);
    const idxB = sourceShafts.findIndex((s) => s.id === rangeTo);
    if (idxA < 0 || idxB < 0) return;
    const start = Math.min(idxA, idxB);
    const end = Math.max(idxA, idxB);
    onUpdateCustomView({
      selectedIds: sourceShafts.slice(start, end + 1).map((s) => s.id),
    });
  };

  const toggleShaft = (id: string) => {
    const next = new Set(cfg.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const ordered = sourceShafts.filter((s) => next.has(s.id)).map((s) => s.id);
    onUpdateCustomView({ selectedIds: ordered });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white text-xs text-slate-800">
      {/* Header */}
      <div className="border-b border-slate-200 bg-orange-50 px-3 py-2.5">
        <div className="flex items-center gap-1.5 font-bold text-orange-950 text-sm">
          <SlidersHorizontal className="h-4 w-4 text-orange-600" />
          <span>{isBn ? 'কাস্টম শ্যাফট ও টানেল ভিউ' : 'Custom Shaft & Tunnel View'}</span>
        </div>
        <p className="mt-0.5 text-[11px] text-orange-900/80">
          {isBn
            ? 'WA বা WC থেকে নির্দিষ্ট শ্যাফট রেঞ্জ বা আলাদা শ্যাফট সিলেক্ট করে আলাদা A1 শিট দেখুন ও PDF করুন।'
            : 'Pick a shaft range or individual shafts from WA or WC to display a focused A1 progress sheet.'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
        {/* 1. Section Selector: WA or WC ONLY */}
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {isBn ? '১. সেকশন বেছে নিন (WA / WC)' : '1. Select Section (WA or WC Only)'}
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { id: 'wa', title: 'WA Section', sub: `${ctx.displayShafts.length} Shafts` },
                { id: 'wc', title: 'WC Section', sub: `${ctx.displayWc.shafts.length} Shafts` },
              ] as const
            ).map((opt) => {
              const active = cfg.section === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleSectionChange(opt.id)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition ${
                    active
                      ? 'border-orange-500 bg-orange-50 text-orange-950 shadow-xs ring-1 ring-orange-400'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="font-bold text-xs">{opt.title}</div>
                  <div className="text-[10px] opacity-75">{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Range Picker (From -> To) */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
          <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-600">
            {isBn ? '২. রেঞ্জ অনুযায়ী সিলেক্ট করুন (From - To)' : '2. Select By Shaft Range (From -> To)'}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">
                {isBn ? 'শুরু (From)' : 'From'}
              </span>
              <select
                aria-label="Custom Range From"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-900"
              >
                {sourceShafts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">
                {isBn ? 'শেষ (To)' : 'To'}
              </span>
              <select
                aria-label="Custom Range To"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-900"
              >
                {sourceShafts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={handleApplyRange}
            className="w-full rounded-md bg-orange-600 py-1.5 text-xs font-bold text-white hover:bg-orange-500 transition shadow-xs"
          >
            {isBn ? 'রেঞ্জ সিলেক্ট করুন (Apply Range)' : 'Apply Shaft Range'}
          </button>
        </div>

        {/* 3. Individual Shaft Multi-Select */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {isBn
                ? `৩. আলাদা শ্যাফট (${selectedShafts.length}/${sourceShafts.length})`
                : `3. Individual Shafts (${selectedShafts.length}/${sourceShafts.length})`}
            </label>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  onUpdateCustomView({ selectedIds: sourceShafts.map((s) => s.id) })
                }
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                {isBn ? 'সব' : 'All'}
              </button>
              <button
                onClick={() => onUpdateCustomView({ selectedIds: [] })}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-50"
              >
                {isBn ? 'পরিষ্কার' : 'Clear'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {sourceShafts.map((s) => {
              const checked = selectedSet.has(s.id);
              const st = getShaftStatus(s);
              const dotClass =
                st === 'complete'
                  ? 'bg-emerald-500'
                  : st === 'ongoing'
                  ? 'bg-amber-500'
                  : 'bg-rose-500';
              return (
                <button
                  key={s.id}
                  onClick={() => toggleShaft(s.id)}
                  className={`flex items-center justify-between rounded border px-1.5 py-1 text-[11px] font-bold transition ${
                    checked
                      ? 'border-orange-500 bg-orange-500 text-white shadow-xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">{s.id}</span>
                  <span
                    className={`ml-1 h-2 w-2 shrink-0 rounded-full ${
                      checked ? 'bg-white' : dotClass
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Display Options */}
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {isBn ? '৪. ডিসপ্লে অপশন' : '4. Display Options'}
          </div>
          <button
            onClick={() =>
              onUpdateCustomView({ showTunneling: !cfg.showTunneling })
            }
            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs font-semibold hover:bg-slate-50"
          >
            {cfg.showTunneling ? (
              <CheckSquare className="h-4 w-4 text-orange-600" />
            ) : (
              <Square className="h-4 w-4 text-slate-400" />
            )}
            <span>
              {isBn
                ? 'মাইক্রো-টানেলিং প্রগ্রেস বার দেখান'
                : 'Show Micro-Tunnelling Progress Bars'}
            </span>
          </button>

          {cfg.section === 'wa' && (
            <button
              onClick={() =>
                onUpdateCustomView({ includePumpStation: !cfg.includePumpStation })
              }
              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs font-semibold hover:bg-slate-50"
            >
              {cfg.includePumpStation ? (
                <CheckSquare className="h-4 w-4 text-orange-600" />
              ) : (
                <Square className="h-4 w-4 text-slate-400" />
              )}
              <span>
                {isBn
                  ? 'Golapbag SPS দেখান (যদি WA-36 থাকে)'
                  : 'Include Golapbag SPS (if WA-36 selected)'}
              </span>
            </button>
          )}
        </div>

        {/* 5. Selected Summary Card */}
        <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-blue-950">
            <Layers className="h-3.5 w-3.5 text-blue-700" />
            <span>
              {isBn ? 'সিলেক্টেড সামারি' : 'Selected Summary'} ({summary.totalShafts} Nos)
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center text-[11px] font-bold">
            <div className="rounded bg-emerald-100 py-1 text-emerald-800">
              Done: {summary.completedShafts}
            </div>
            <div className="rounded bg-amber-100 py-1 text-amber-800">
              Ong: {summary.ongoingShafts}
            </div>
            <div className="rounded bg-rose-100 py-1 text-rose-800">
              Rem: {summary.remainingShafts}
            </div>
          </div>
          <div className="text-[11px] font-semibold text-slate-700">
            Tunnel: {summary.completedTunnelLengthM.toFixed(1)}m /{' '}
            {summary.totalTunnelLengthM.toFixed(1)}m ({summary.tunnelPctOverall.toFixed(1)}%)
          </div>
          {state.viewMode !== 'overall' && (
            <div className="rounded bg-orange-100 px-2 py-1 text-[11px] font-bold text-orange-900">
              {state.viewMode === 'weekly' ? 'Weekly' : 'Monthly'} New: +
              {summary.delta.addedLayers}L | +{summary.delta.addedTunnelM.toFixed(1)}m
            </div>
          )}
        </div>

        {/* Direct Edit Shortcut */}
        {selectedShafts.length > 0 && (
          <button
            onClick={() =>
              onOpenShaftEditor(
                selectedShafts.some((s) => s.id === selectedShaftId)
                  ? selectedShaftId
                  : selectedShafts[0].id,
                cfg.section
              )
            }
            className="w-full rounded-md border border-slate-300 bg-slate-800 py-1.5 text-xs font-bold text-white hover:bg-slate-700 transition"
          >
            {isBn
              ? `${
                  selectedShafts.some((s) => s.id === selectedShaftId)
                    ? selectedShaftId
                    : selectedShafts[0].id
                } এডিট করতে যান →`
              : `Open ${
                  selectedShafts.some((s) => s.id === selectedShaftId)
                    ? selectedShaftId
                    : selectedShafts[0].id
                } in Editor →`}
          </button>
        )}
      </div>
    </div>
  );
};
