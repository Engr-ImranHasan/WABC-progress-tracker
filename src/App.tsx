import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  Eye,
  FileCode2,
  Files,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Languages,
  Layers,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Printer,
  Save,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AppState,
  CustomShaftViewConfig,
  PdfSheetKey,
  SavedProgressFile,
  SectionTab,
  ShaftRecord,
  ViewMode,
  WbSectionData,
} from './types';

const FIVE_PAGE_PDF_SECTIONS: PdfSheetKey[] = [
  'combined',
  'wa-map',
  'wb-map',
  'wc-map',
  'wc-status',
];
import { createInitialAppState } from './data/initialWaData';
import { createInitialWbData, createInitialWcData } from './data/wbcInitialData';
import {
  computeSummary,
  formatDateDisplay,
  getPumpLowerStatus,
  LIVE_WORKSPACE_ID,
  normalizePumpStation,
  normalizeShaftSheetPile,
  normalizeWbData,
  normalizeWcData,
  resolveDisplayContext,
  sanitizeLoadedState,
} from './utils/calculations';
import {
  exportA1VectorPdf,
  exportAutoCadDxf,
  exportExcelWorkbook,
  exportHighResPng,
  exportJsonBackup,
  exportMultiPageA1VectorPdf,
  exportSavedFileExcel,
  exportSavedFileJson,
  exportSvgFile,
  importFullExcelWorkbook,
  preloadSectionMapSnapshots,
} from './utils/exporters';
import {
  exportArcGisProPackage,
  importArcGisDataFile,
} from './utils/arcgisExport';
import { exportArcGisProAprxFile } from './utils/aprxBuilder';
import { A1SheetDrawing } from './components/A1SheetDrawing';
import { ShaftEditorPanel } from './components/ShaftEditorPanel';
import { WbEditorPanel } from './components/WbWcEditors';
import { CustomShaftPanel } from './components/CustomShaftPanel';

const STORAGE_KEY = 'wa_progress_studio_v1';

function loadInitialState(): AppState {
  const fallback = createInitialAppState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return sanitizeLoadedState(parsed, fallback);
  } catch {
    return fallback;
  }
}

export function App() {
  const [state, setState] = useState<AppState>(loadInitialState);
  const [selectedShaftId, setSelectedShaftId] = useState<string>('WA-1');
  const [selectedWbNodeId, setSelectedWbNodeId] = useState<string>('WB1');
  const [selectedWcShaftId, setSelectedWcShaftId] = useState<string>('WC-1');
  const [combinedEditorTarget, setCombinedEditorTarget] = useState<'wa' | 'wb' | 'wc'>('wa');
  const [customInspectorTab, setCustomInspectorTab] = useState<'custom' | 'edit'>('custom');
  const [focusSection, setFocusSection] = useState<'shaft' | 'manhole' | 'tunnel'>('shaft');
  const [zoom, setZoom] = useState<number>(1);
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  const [showSavedTime, setShowSavedTime] = useState<boolean>(false);
  const [showSyncPopup, setShowSyncPopup] = useState<boolean>(false);
  const [requestedEditorTab, setRequestedEditorTab] = useState<{
    tab: 'single' | 'table' | 'settings';
    seq: number;
  }>({ tab: 'single', seq: 0 });

  // Save Overall File Modal
  const [saveModalOpen, setSaveModalOpen] = useState<boolean>(false);
  const [saveFileName, setSaveFileName] = useState<string>('');
  const [saveFileDate, setSaveFileDate] = useState<string>('');
  const [saveFileNote, setSaveFileNote] = useState<string>('');

  // Saved Files Manager Modal & In-Modal Viewer
  const [filesModalOpen, setFilesModalOpen] = useState<boolean>(false);
  const [previewFile, setPreviewFile] = useState<SavedProgressFile | null>(null);
  const [previewTab, setPreviewTab] = useState<SectionTab>('combined');

  // Offscreen hidden state for multi-page A1 Vector PDF (5-Page Report / Legacy multi-page)
  const [multiPdfReq, setMultiPdfReq] = useState<{
    sourceState: AppState;
    sections: PdfSheetKey[];
    filename: string;
  } | null>(null);
  const multiSvgRefs = useRef<Record<string, SVGSVGElement | null>>({});

  const [toastMsg, setToastMsg] = useState<string>('');
  const [exportBusy, setExportBusy] = useState<string>('');

  const svgRef = useRef<SVGSVGElement>(null);
  const previewSvgRef = useRef<SVGSVGElement>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const arcgisInputRef = useRef<HTMLInputElement | null>(null);

  const isBn = state.uiLang === 'bn';

  // Instant localStorage autosave on every change
  useEffect(() => {
    try {
      const payload = { ...state, lastSavedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore quota errors
    }
  }, [state]);

  // Execute multi-page PDF capture once hidden SVGs have rendered
  useEffect(() => {
    if (!multiPdfReq) return;
    let cancelled = false;
    const run = async () => {
      try {
        await preloadSectionMapSnapshots(multiPdfReq.sourceState);
        // Wait 2 animation frames + micro-settle so all <image> hrefs paint in DOM
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80)))
        );
        if (cancelled) return;

        const els: SVGSVGElement[] = [];
        for (const sec of multiPdfReq.sections) {
          const el = multiSvgRefs.current[sec];
          if (el) els.push(el);
        }
        if (els.length > 0) {
          await exportMultiPageA1VectorPdf(els, multiPdfReq.filename);
          showToast(
            isBn
              ? `${els.length} পৃষ্ঠার A1 Vector PDF ডাউনলোড হয়েছে!`
              : `Exported ${els.length}-Page A1 Vector PDF!`
          );
        }
      } catch (err) {
        console.error(err);
        showToast(isBn ? 'মাল্টি-পেজ PDF তৈরিতে সমস্যা হয়েছে।' : 'Multi-page PDF failed.');
      } finally {
        if (!cancelled) {
          setExportBusy('');
          setMultiPdfReq(null);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [multiPdfReq, isBn]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3400);
  };

  const handleUpdateWaShaft = (id: string, patch: Partial<ShaftRecord>) => {
    setState((prev) => ({
      ...prev,
      lastSavedAt: new Date().toISOString(),
      shafts: prev.shafts.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const handleUpdateWcShaft = (id: string, patch: Partial<ShaftRecord>) => {
    setState((prev) => ({
      ...prev,
      lastSavedAt: new Date().toISOString(),
      wc: {
        ...prev.wc,
        shafts: prev.wc.shafts.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      },
    }));
  };

  const handleUpdateWb = (updater: (wb: WbSectionData) => WbSectionData) => {
    setState((prev) => ({
      ...prev,
      lastSavedAt: new Date().toISOString(),
      wb: updater(prev.wb),
    }));
  };

  const displayCtx = resolveDisplayContext(state);
  const waSummary = computeSummary(
    displayCtx.displayShafts,
    displayCtx.baseline,
    displayCtx.displayPump,
    undefined,
    state.settings.waTunnelDiaTotalsM
  );
  const wcSummary = computeSummary(displayCtx.displayWc.shafts);
  const wbPct =
    displayCtx.displayWb.totalLengthM > 0
      ? (displayCtx.displayWb.completedLengthM / displayCtx.displayWb.totalLengthM) * 100
      : 0;

  const editingFile = state.activeLoadedFileId
    ? state.savedFiles.find((f) => f.id === state.activeLoadedFileId) || null
    : null;

  const handleSwitchSection = (sec: SectionTab) => {
    setState((p) => ({ ...p, activeSection: sec }));
    if (sec === 'wa' || sec === 'wa-map') setCombinedEditorTarget('wa');
    if (sec === 'wb' || sec === 'wb-map') setCombinedEditorTarget('wb');
    if (sec === 'wc' || sec === 'wc-map') setCombinedEditorTarget('wc');
    if (sec === 'custom') {
      setCustomInspectorTab('custom');
      setShowInspector(true);
    }
  };

  const handleUpdateCustomView = (patch: Partial<CustomShaftViewConfig>) => {
    setState((prev) => ({
      ...prev,
      lastSavedAt: new Date().toISOString(),
      customView: {
        ...(prev.customView || {
          section: 'wa',
          selectedIds: ['WA-17', 'WA-18', 'WA-19', 'WA-20', 'WA-21', 'WA-22', 'WA-23', 'WA-24'],
          showTunneling: true,
          includePumpStation: false,
        }),
        ...patch,
      },
    }));
  };

  // Open Save Overall File modal
  const openSaveFileModal = () => {
    const defaultDate = state.settings.reportDate || new Date().toISOString().slice(0, 10);
    if (editingFile) {
      setSaveFileName(editingFile.name);
      setSaveFileDate(editingFile.date || defaultDate);
      setSaveFileNote(editingFile.note || '');
    } else {
      setSaveFileName(`WABC Progress (${formatDateDisplay(defaultDate)})`);
      setSaveFileDate(defaultDate);
      setSaveFileNote('');
    }
    setSaveModalOpen(true);
  };

  // Save ALL 3 SECTIONS (WA + Pump SPS + WB + WC) in ONE single SavedProgressFile
  const handleSaveFile = (mode: 'new' | 'update') => {
    const cleanName = saveFileName.trim() || `WABC Progress (${formatDateDisplay(saveFileDate)})`;
    const cleanDate = saveFileDate || state.settings.reportDate;
    const nowIso = new Date().toISOString();

    if (mode === 'update' && state.activeLoadedFileId) {
      setState((prev) => ({
        ...prev,
        lastSavedAt: nowIso,
        savedFiles: prev.savedFiles.map((f) =>
          f.id === prev.activeLoadedFileId
            ? {
                ...f,
                name: cleanName,
                date: cleanDate,
                note: saveFileNote.trim(),
                updatedAt: nowIso,
                shafts: JSON.parse(JSON.stringify(prev.shafts)),
                pumpStation: JSON.parse(JSON.stringify(prev.pumpStation)),
                wb: JSON.parse(JSON.stringify(prev.wb)),
                wc: JSON.parse(JSON.stringify(prev.wc)),
                waGeoNodes: prev.waGeoNodes ? JSON.parse(JSON.stringify(prev.waGeoNodes)) : undefined,
                spsCoord: prev.spsCoord ? { ...prev.spsCoord } : undefined,
                waCustomPoints: prev.waCustomPoints ? JSON.parse(JSON.stringify(prev.waCustomPoints)) : undefined,
              }
            : f
        ),
      }));
      setSaveModalOpen(false);
      showToast(
        isBn
          ? `"${cleanName}" (WA+WB+WC একসাথে) আপডেট সেভ হয়েছে!`
          : `Updated saved file "${cleanName}" (WA+WB+WC)!`
      );
      return;
    }

    const newFile: SavedProgressFile = {
      id: `file-${Date.now()}`,
      name: cleanName,
      date: cleanDate,
      note: saveFileNote.trim(),
      createdAt: nowIso,
      updatedAt: nowIso,
      shafts: JSON.parse(JSON.stringify(state.shafts)),
      pumpStation: JSON.parse(JSON.stringify(state.pumpStation)),
      wb: JSON.parse(JSON.stringify(state.wb)),
      wc: JSON.parse(JSON.stringify(state.wc)),
      waGeoNodes: state.waGeoNodes ? JSON.parse(JSON.stringify(state.waGeoNodes)) : undefined,
      spsCoord: state.spsCoord ? { ...state.spsCoord } : undefined,
      waCustomPoints: state.waCustomPoints ? JSON.parse(JSON.stringify(state.waCustomPoints)) : undefined,
    };

    setState((prev) => ({
      ...prev,
      lastSavedAt: nowIso,
      activeLoadedFileId: newFile.id,
      savedFiles: [newFile, ...prev.savedFiles],
    }));
    setSaveModalOpen(false);
    showToast(
      isBn
        ? `"${cleanName}" (${formatDateDisplay(cleanDate)}) — ৩টি সেকশন এক ফাইলে সেভ হয়েছে!`
        : `Saved "${cleanName}" (${formatDateDisplay(cleanDate)}) with WA, WB & WC!`
    );
  };

  // Load a saved file (all 3 sections WA + WB + WC) into workspace editor
  const handleEditSavedFile = (file: SavedProgressFile) => {
    setState((prev) => ({
      ...prev,
      lastSavedAt: new Date().toISOString(),
      viewMode: 'overall',
      activeLoadedFileId: file.id,
      shafts: JSON.parse(JSON.stringify(file.shafts)),
      pumpStation: JSON.parse(JSON.stringify(file.pumpStation)),
      wb: JSON.parse(JSON.stringify(file.wb || createInitialWbData())),
      wc: JSON.parse(JSON.stringify(file.wc || createInitialWcData())),
      waGeoNodes: file.waGeoNodes ? JSON.parse(JSON.stringify(file.waGeoNodes)) : prev.waGeoNodes,
      spsCoord: file.spsCoord ? { ...file.spsCoord } : prev.spsCoord,
      waCustomPoints: file.waCustomPoints ? JSON.parse(JSON.stringify(file.waCustomPoints)) : [],
      settings: {
        ...prev.settings,
        reportDate: file.date || prev.settings.reportDate,
      },
    }));
    setPreviewFile(null);
    setFilesModalOpen(false);
    showToast(
      isBn
        ? `"${file.name}" (WA+WB+WC) এডিট করার জন্য লোড হয়েছে!`
        : `Loaded "${file.name}" (WA+WB+WC) into editor!`
    );
  };

  const handleDeleteSavedFile = (file: SavedProgressFile) => {
    if (state.savedFiles.length <= 1) {
      showToast(
        isBn
          ? 'অন্তত একটি সেভ করা ফাইল রাখা প্রয়োজন।'
          : 'Keep at least one saved file for comparisons.'
      );
      return;
    }
    if (
      !window.confirm(
        isBn
          ? `"${file.name}" ফাইলটি কি মুছে ফেলতে চান?`
          : `Delete saved file "${file.name}"?`
      )
    ) {
      return;
    }
    setState((prev) => {
      const remaining = prev.savedFiles.filter((f) => f.id !== file.id);
      const fallbackId = remaining[0]?.id || '';
      return {
        ...prev,
        activeLoadedFileId:
          prev.activeLoadedFileId === file.id ? null : prev.activeLoadedFileId,
        weeklyCompare: {
          file1Id:
            prev.weeklyCompare.file1Id === file.id
              ? fallbackId
              : prev.weeklyCompare.file1Id,
          file2Id:
            prev.weeklyCompare.file2Id === file.id
              ? LIVE_WORKSPACE_ID
              : prev.weeklyCompare.file2Id,
        },
        monthlyCompare: {
          file1Id:
            prev.monthlyCompare.file1Id === file.id
              ? fallbackId
              : prev.monthlyCompare.file1Id,
          file2Id:
            prev.monthlyCompare.file2Id === file.id
              ? LIVE_WORKSPACE_ID
              : prev.monthlyCompare.file2Id,
        },
        savedFiles: remaining,
      };
    });
    if (previewFile?.id === file.id) setPreviewFile(null);
    showToast(isBn ? 'ফাইলটি মুছে ফেলা হয়েছে।' : 'File deleted.');
  };

  const startMultiPagePdfExport = async (
    sections: PdfSheetKey[],
    sourceState: AppState = state,
    customTag?: string
  ) => {
    setShowExportMenu(false);
    const dateTag = customTag || sourceState.settings.reportDate || 'report';
    setExportBusy(
      isBn ? `${sections.length} পৃষ্ঠার A1 PDF তৈরি হচ্ছে...` : `Building ${sections.length}-Page A1 PDF...`
    );
    try {
      await preloadSectionMapSnapshots(sourceState);
      setMultiPdfReq({
        sourceState,
        sections,
        filename: `WABC-Progress-${sections.length}Pages-A1-${dateTag}.pdf`,
      });
    } catch (err) {
      console.error(err);
      setExportBusy('');
      showToast(isBn ? 'মাল্টি-পেজ PDF তৈরিতে সমস্যা হয়েছে।' : 'Multi-page PDF failed.');
    }
  };

  const handleExport = async (
    kind: 'pdf' | 'png' | 'svg' | 'dxf' | 'xlsx' | 'json' | 'arcgis' | 'aprx' | 'print',
    customSvg?: SVGSVGElement | null,
    customLabel?: string
  ) => {
    setShowExportMenu(false);
    const dateTag = customLabel || state.settings.reportDate || 'report';
    const secTag = customLabel ? 'saved' : `${state.activeSection}-${state.viewMode}`;
    try {
      if (kind === 'print') {
        window.print();
        return;
      }
      if (kind === 'aprx') {
        setExportBusy(isBn ? 'ArcGIS Pro (.aprx) তৈরি হচ্ছে...' : 'Building ArcGIS Pro (.aprx)...');
        await exportArcGisProAprxFile(state);
        showToast(
          isBn
            ? 'ArcGIS Pro 3.5.0 প্রজেক্ট (.aprx — WA+WB+WC ৩-ম্যাপ লেআউট) ডাউনলোড হয়েছে!'
            : 'ArcGIS Pro Project (.aprx — WA+WB+WC in 1 Layout) exported!'
        );
        return;
      }
      if (kind === 'arcgis') {
        setExportBusy(isBn ? 'ArcGIS Pro প্যাকেজ তৈরি হচ্ছে...' : 'Building ArcGIS Pro Package...');
        await exportArcGisProPackage(state);
        showToast(
          isBn
            ? 'ArcGIS Pro GIS প্যাকেজ (.zip — APRX+SHP+GeoJSON) ডাউনলোড হয়েছে!'
            : 'ArcGIS Pro GIS Package (.zip — APRX+SHP+GeoJSON) exported!'
        );
        return;
      }
      if (kind === 'xlsx') {
        exportExcelWorkbook(state, `WABC-Progress-${state.viewMode}-${dateTag}.xlsx`);
        showToast(isBn ? 'Excel (.xlsx) — সব শীট ডাউনলোড হয়েছে!' : 'Multi-sheet Excel exported!');
        return;
      }
      if (kind === 'json') {
        exportJsonBackup(state, `WABC-Progress-Backup-${dateTag}.json`);
        showToast(isBn ? 'JSON ব্যাকআপ সেভ হয়েছে!' : 'JSON backup saved!');
        return;
      }
      if (kind === 'dxf') {
        const dxfTargetSvg = customSvg || svgRef.current;
        exportAutoCadDxf(state, `WABC-Progress-A1-${secTag}-${dateTag}.dxf`, dxfTargetSvg);
        showToast(isBn ? 'AutoCAD DXF এক্সপোর্ট হয়েছে!' : 'AutoCAD DXF exported!');
        return;
      }
      const targetSvg = customSvg || svgRef.current;
      if (!targetSvg) return;
      if (kind === 'svg') {
        exportSvgFile(targetSvg, `WABC-Progress-A1-${secTag}-${dateTag}.svg`);
        showToast(isBn ? 'Vector SVG ডাউনলোড হয়েছে!' : 'SVG exported!');
        return;
      }
      if (kind === 'pdf') {
        setExportBusy(isBn ? 'A1 PDF তৈরি হচ্ছে...' : 'Generating A1 Vector PDF...');
        await preloadSectionMapSnapshots(state);
        await exportA1VectorPdf(
          targetSvg,
          `WABC-Progress-A1-${secTag}-${dateTag}.pdf`
        );
        showToast(isBn ? 'A1 Vector PDF ডাউনলোড হয়েছে!' : 'A1 Vector PDF exported!');
      } else if (kind === 'png') {
        setExportBusy(isBn ? 'High-Res PNG তৈরি হচ্ছে...' : 'Rendering High-Res PNG...');
        await exportHighResPng(
          targetSvg,
          `WABC-Progress-A1-${secTag}-${dateTag}.png`
        );
        showToast(isBn ? 'High-Res PNG ডাউনলোড হয়েছে!' : 'PNG exported!');
      }
    } catch (err) {
      console.error(err);
      showToast(isBn ? 'এক্সপোর্টে সমস্যা হয়েছে, আবার চেষ্টা করুন।' : 'Export failed.');
    } finally {
      setExportBusy('');
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imported = await importFullExcelWorkbook(file, state);
      setState((prev) => ({
        ...prev,
        lastSavedAt: new Date().toISOString(),
        shafts: imported.shafts,
        wb: imported.wb,
        wc: imported.wc,
      }));
      showToast(
        isBn
          ? 'Excel থেকে WA, WB ও WC ডাটা ইমপোর্ট ও অটো-সেভ হয়েছে!'
          : 'Excel (WA/WB/WC) imported & auto-saved!'
      );
    } catch (err) {
      console.error(err);
      showToast(isBn ? 'Excel ফাইলটি পড়া যায়নি।' : 'Could not read Excel file.');
    }
  };

  const handleArcGisUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const updated = await importArcGisDataFile(file, state);
      if (updated.updatedCount === 0) {
        showToast(
          isBn
            ? 'ফাইলে WA/WB/WC-এর কোনো ম্যাচিং ID পাওয়া যায়নি।'
            : 'No matching WA/WB/WC features found in GIS file.'
        );
        return;
      }
      setState((prev) => ({
        ...prev,
        lastSavedAt: new Date().toISOString(),
        shafts: updated.shafts,
        pumpStation: updated.pumpStation,
        wb: updated.wb,
        wc: updated.wc,
        waGeoNodes: updated.waGeoNodes,
        spsCoord: updated.spsCoord,
      }));
      showToast(
        isBn
          ? `ArcGIS ফাইল থেকে ${updated.updatedCount}টি WA/WB/WC ডাটা আপডেট হয়েছে!`
          : `Updated ${updated.updatedCount} WA/WB/WC features from ArcGIS file!`
      );
    } catch (err) {
      console.error(err);
      showToast(
        isBn ? 'ArcGIS GeoJSON / CSV ফাইল পড়া যায়নি।' : 'Could not parse ArcGIS GeoJSON / CSV file.'
      );
    }
  };

  const handleJsonRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const fallback = createInitialAppState();

      // Case 1: Full AppState Backup (.json exported from Export -> Save Full Backup)
      if (Array.isArray(parsed.savedFiles) || parsed.settings) {
        const restored = sanitizeLoadedState(parsed as Partial<AppState>, fallback);
        setState(restored);
        showToast(
          isBn ? 'সম্পূর্ণ JSON ব্যাকআপ রিস্টোর হয়েছে!' : 'Full JSON backup restored!'
        );
        return;
      }

      // Case 2: Single SavedProgressFile (.json exported from Files Manager -> JSON)
      if (Array.isArray(parsed.shafts) && parsed.shafts.length > 0) {
        const rawSf = parsed as Partial<SavedProgressFile>;
        const nowIso = new Date().toISOString();
        const normPump = normalizePumpStation(rawSf.pumpStation, fallback.pumpStation);
        const normWb = normalizeWbData(rawSf.wb, fallback.wb);
        const normWc = normalizeWcData(rawSf.wc, fallback.wc);
        const importedName =
          (typeof rawSf.name === 'string' && rawSf.name.trim()) ||
          file.name.replace(/\.json$/i, '');
        const importedDate =
          (typeof rawSf.date === 'string' && rawSf.date) || state.settings.reportDate;

        const importedFile: SavedProgressFile = {
          id: `file-imp-${Date.now()}`,
          name: importedName,
          date: importedDate,
          note: typeof rawSf.note === 'string' ? rawSf.note : 'Imported from JSON',
          createdAt: rawSf.createdAt || nowIso,
          updatedAt: nowIso,
          shafts: normalizeShaftSheetPile(JSON.parse(JSON.stringify(rawSf.shafts)) as ShaftRecord[]),
          pumpStation: normPump,
          wb: normWb,
          wc: normWc,
        };

        setState((prev) => ({
          ...prev,
          lastSavedAt: nowIso,
          viewMode: 'overall',
          activeLoadedFileId: importedFile.id,
          shafts: JSON.parse(JSON.stringify(importedFile.shafts)),
          pumpStation: JSON.parse(JSON.stringify(importedFile.pumpStation)),
          wb: JSON.parse(JSON.stringify(importedFile.wb)),
          wc: JSON.parse(JSON.stringify(importedFile.wc)),
          settings: {
            ...prev.settings,
            reportDate: importedDate || prev.settings.reportDate,
          },
          savedFiles: [importedFile, ...prev.savedFiles],
        }));

        showToast(
          isBn
            ? `"${importedName}" JSON ফাইল ইমপোর্ট ও লোড হয়েছে!`
            : `Imported & loaded "${importedName}" JSON file!`
        );
        return;
      }

      showToast(isBn ? 'সঠিক JSON প্রগ্রেস ফাইল নয়।' : 'Invalid JSON progress file.');
    } catch {
      showToast(isBn ? 'সঠিক JSON ব্যাকআপ ফাইল নয়।' : 'Invalid JSON backup.');
    }
  };

  const savedTimeStr = (() => {
    try {
      return new Date(state.lastSavedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '';
    }
  })();

  const activeCompare =
    state.viewMode === 'monthly' ? state.monthlyCompare : state.weeklyCompare;

  const updateCompare = (side: 'file1Id' | 'file2Id', val: string) => {
    const key = state.viewMode === 'monthly' ? 'monthlyCompare' : 'weeklyCompare';
    setState((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [side]: val,
      },
    }));
  };

  const previewState: AppState | null = previewFile
    ? {
        ...state,
        activeSection: previewTab,
        viewMode: 'overall',
        shafts: previewFile.shafts,
        pumpStation: previewFile.pumpStation,
        wb: previewFile.wb || createInitialWbData(),
        wc: previewFile.wc || createInitialWcData(),
        waGeoNodes: previewFile.waGeoNodes || state.waGeoNodes,
        spsCoord: previewFile.spsCoord || state.spsCoord,
        waCustomPoints: previewFile.waCustomPoints || [],
        settings: {
          ...state.settings,
          reportDate: previewFile.date || state.settings.reportDate,
          sectionTitle: `${state.settings.sectionTitle} — [${previewFile.name}]`,
        },
      }
    : null;

  // Determine which right-side inspector to display
  const customSectionTarget: 'wa' | 'wc' =
    state.customView?.section === 'wc' ? 'wc' : 'wa';

  const activeInspectorMode: 'wa' | 'wb' | 'wc' =
    state.activeSection === 'wb' || state.activeSection === 'wb-map'
      ? 'wb'
      : state.activeSection === 'wc' || state.activeSection === 'wc-map'
      ? 'wc'
      : state.activeSection === 'combined'
      ? combinedEditorTarget
      : state.activeSection === 'custom'
      ? customSectionTarget
      : 'wa';

  // Active selection ring on drawing
  const activeDrawingSelectionId =
    activeInspectorMode === 'wb'
      ? selectedWbNodeId
      : activeInspectorMode === 'wc'
      ? selectedWcShaftId
      : selectedShaftId;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      {/* Hidden file inputs */}
      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleExcelUpload}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleJsonRestore}
      />
      <input
        ref={arcgisInputRef}
        type="file"
        accept=".geojson,.json,.csv"
        className="hidden"
        onChange={handleArcGisUpload}
      />

      {/* ==================== SINGLE-LINE TOP HEADER TOOLBAR ==================== */}
      <header className="no-print z-30 flex flex-nowrap items-center justify-between gap-2 border-b border-slate-700/80 bg-slate-900 px-3 py-1.5 text-white shadow-sm">
        {/* Brand & Compact Green Autosave Tick (Click to view saved timestamp) */}
        <div className="relative flex shrink-0 items-center gap-1.5">
          <div
            className="relative flex items-center"
            onMouseEnter={() => setShowSyncPopup(true)}
            onMouseLeave={() => setShowSyncPopup(false)}
          >
            <h1
              data-testid="app-brand-title"
              className="cursor-default whitespace-nowrap text-[15.5px] font-extrabold tracking-tight text-white transition hover:text-emerald-200"
            >
              WABC Progress Studio
            </h1>

            {showSyncPopup && (
              <div
                data-testid="sync-status-popup"
                className="pointer-events-none absolute left-0 top-7 z-50 w-max rounded-lg border border-emerald-500/45 bg-slate-900/95 px-3 py-2 text-[11.5px] font-medium text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-sm"
              >
                <div className="flex items-center gap-2 whitespace-nowrap py-0.5">
                  <span className="sync-dot-blink inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />
                  <span>Sync with Autodesk AutoCAD 2021</span>
                </div>
                <div className="my-1 border-t border-slate-700/70" />
                <div className="flex items-center gap-2 whitespace-nowrap py-0.5">
                  <span className="sync-dot-blink inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />
                  <span>Sync with ArcGIS Pro 3.5.0</span>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowSavedTime((v) => !v)}
            title={
              isBn
                ? `অটো-সেভড: ${savedTimeStr} (সময় দেখতে ক্লিক করুন)`
                : `Auto-saved: ${savedTimeStr} (Click to view time)`
            }
            aria-label="Auto-save status"
            className="relative z-50 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-400/70 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/35 transition"
          >
            <Check className="h-3 w-3 stroke-[2.8]" />
          </button>

          {showSavedTime && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowSavedTime(false)}
              />
              <div className="absolute left-0 top-7 z-50 whitespace-nowrap rounded-md border border-emerald-500/40 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 shadow-lg">
                ✓ {isBn ? 'অটো-সেভড:' : 'Auto-saved:'} {savedTimeStr}
              </div>
            </>
          )}
        </div>

        {/* Section Tabs: WA | WB | WC | Combined | Custom | WA Map | WB Map | WC Map */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-700/70 bg-slate-800/95 p-0.5">
          {(
            [
              { id: 'wa', label: 'WA', tip: 'WA (37 Shafts + Golapbag SPS)' },
              { id: 'wb', label: 'WB', tip: 'WB (Open Cut DN1200 GRP)' },
              { id: 'wc', label: 'WC', tip: 'WC (27 Shafts Micro-Tunnelling)' },
              { id: 'combined', label: 'Combined', tip: 'Combined (WA + WB + WC + SPS)' },
              { id: 'custom', label: 'Custom', tip: 'Custom Shaft Selection (WA / WC Only)' },
              { id: 'wa-map', label: 'WA Map', tip: 'WA Portrait GIS Map' },
              { id: 'wb-map', label: 'WB Map', tip: 'WB Portrait GIS Map' },
              { id: 'wc-map', label: 'WC Map', tip: 'WC Portrait GIS Map' },
            ] as { id: SectionTab; label: string; tip: string }[]
          ).map((tab) => {
            const active = state.activeSection === tab.id;
            const isMapTab = tab.id.endsWith('-map');
            const isCustomTab = tab.id === 'custom';
            return (
              <button
                key={tab.id}
                onClick={() => handleSwitchSection(tab.id)}
                title={tab.tip}
                className={`whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-bold transition ${
                  active
                    ? tab.id === 'combined'
                      ? 'bg-indigo-500 text-white shadow-xs'
                      : isCustomTab
                      ? 'bg-orange-500 text-white shadow-xs'
                      : isMapTab
                      ? 'bg-emerald-500 text-slate-950 shadow-xs'
                      : 'bg-blue-500 text-white shadow-xs'
                    : isCustomTab
                    ? 'text-orange-300 hover:bg-slate-700 hover:text-white'
                    : isMapTab
                    ? 'text-emerald-300 hover:bg-slate-700 hover:text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* View Mode Switcher (Overall / Weekly / Monthly — Orange highlight on comparison modes) */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-700/70 bg-slate-800/95 p-0.5">
          {(
            [
              { id: 'overall', bn: 'সামগ্রিক', en: 'Overall' },
              { id: 'weekly', bn: 'সাপ্তাহিক', en: 'Weekly' },
              { id: 'monthly', bn: 'মাসিক', en: 'Monthly' },
            ] as { id: ViewMode; bn: string; en: string }[]
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => setState((p) => ({ ...p, viewMode: m.id }))}
              className={`whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                state.viewMode === m.id
                  ? m.id === 'overall'
                    ? 'bg-emerald-500 text-slate-950 shadow-xs'
                    : 'bg-orange-500 text-white shadow-xs'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {isBn ? m.bn : m.en}
            </button>
          ))}
        </div>

        {/* Compact Right Actions: Save File | Files | Export | Lang Icon | Inspector Toggle */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={openSaveFileModal}
            className="flex whitespace-nowrap items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400 transition"
            title={
              editingFile
                ? `${isBn ? 'এডিটিং:' : 'Editing:'} ${editingFile.name}`
                : isBn
                ? 'WA, WB ও WC — ৩টি পেজ একসাথে নাম ও তারিখ দিয়ে সেভ করুন'
                : 'Save all 3 sections (WA+WB+WC) into one file'
            }
          >
            <Save className="h-3.5 w-3.5 shrink-0" />
            <span>{isBn ? 'ফাইল সেভ' : 'Save File'}</span>
          </button>

          <button
            onClick={() => setFilesModalOpen(true)}
            title={
              editingFile
                ? `${isBn ? 'বর্তমান ফাইল:' : 'Loaded:'} ${editingFile.name}`
                : isBn
                ? 'সেভ করা সব ফাইল দেখুন'
                : 'View all saved files'
            }
            className="flex whitespace-nowrap items-center gap-1 rounded-md border border-indigo-400/50 bg-indigo-600/90 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500 transition"
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span>{isBn ? `ফাইল (${state.savedFiles.length})` : `Files (${state.savedFiles.length})`}</span>
          </button>

          {/* Export / Import Menu */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={Boolean(exportBusy)}
              className="flex whitespace-nowrap items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-700 disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>{exportBusy || (isBn ? 'এক্সপোর্ট' : 'Export')}</span>
            </button>

            {showExportMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowExportMenu(false)}
                />
                <div className="absolute right-0 mt-1.5 z-50 w-72 rounded-lg border border-slate-200 bg-white py-1.5 text-slate-800 shadow-xl text-xs">
                  <div className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">
                    {isBn ? 'A1 প্রিন্ট ও ড্রয়িং এক্সপোর্ট' : 'A1 Drawing Exports'}
                  </div>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 font-semibold text-blue-700"
                  >
                    <FileText className="h-4 w-4" /> Current A1 Sheet PDF (841×594mm)
                  </button>
                  <button
                    onClick={() => startMultiPagePdfExport(FIVE_PAGE_PDF_SECTIONS)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50 font-semibold text-indigo-700"
                  >
                    <Files className="h-4 w-4" /> 5-Page A1 PDF (Comb+Maps+WC)
                  </button>
                  <button
                    onClick={() => startMultiPagePdfExport(['wa', 'wb', 'wc', 'combined'])}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50 text-indigo-700"
                  >
                    <Layers className="h-4 w-4" /> 4-Page A1 PDF (WA+WB+WC+Combined)
                  </button>
                  <button
                    onClick={() => handleExport('print')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <Printer className="h-4 w-4 text-slate-600" /> Print A1 Page (Ctrl+P)
                  </button>
                  <button
                    onClick={() => handleExport('png')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <ImageIcon className="h-4 w-4 text-emerald-600" /> High-Res PNG Image
                  </button>
                  <button
                    onClick={() => handleExport('svg')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <FileCode2 className="h-4 w-4 text-indigo-600" /> Vector SVG File
                  </button>
                  <button
                    onClick={() => handleExport('dxf')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <FileCode2 className="h-4 w-4 text-amber-600" /> AutoCAD (.dxf) File
                  </button>

                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">
                    {isBn ? 'ArcGIS Pro ও GIS লেয়ার (WA+WB+WC)' : 'ArcGIS Pro & GIS (WA+WB+WC)'}
                  </div>
                  <button
                    onClick={() => handleExport('aprx')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sky-50 text-sky-900 font-bold"
                  >
                    <Globe className="h-4 w-4 text-emerald-600 shrink-0" /> ArcGIS Pro Project (.aprx — 3 Maps Layout)
                  </button>
                  <button
                    onClick={() => handleExport('arcgis')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sky-50 text-sky-800 font-semibold"
                  >
                    <Globe className="h-4 w-4 text-sky-600 shrink-0" /> ArcGIS Pro Package (.zip: APRX+SHP+GeoJSON)
                  </button>
                  <button
                    onClick={() => {
                      setShowExportMenu(false);
                      arcgisInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sky-50 text-sky-800 font-medium"
                  >
                    <Upload className="h-4 w-4 text-sky-600 shrink-0" /> Update from ArcGIS (.geojson/.csv)
                  </button>

                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">
                    {isBn ? 'Excel ও ব্যাকআপ (WA+WB+WC)' : 'Excel & Data Backup (WA+WB+WC)'}
                  </div>
                  <button
                    onClick={() => handleExport('xlsx')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-emerald-50 text-emerald-800 font-medium"
                  >
                    <FileSpreadsheet className="h-4 w-4" /> Export Excel (5 Sheets .xlsx)
                  </button>
                  <button
                    onClick={() => {
                      setShowExportMenu(false);
                      excelInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-emerald-50 text-emerald-800 font-medium"
                  >
                    <Upload className="h-4 w-4" /> Import Excel (.xlsx)
                  </button>
                  <button
                    onClick={() => handleExport('json')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <Save className="h-4 w-4 text-slate-600" /> Save Full Backup (.json)
                  </button>
                  <button
                    onClick={() => {
                      setShowExportMenu(false);
                      jsonInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50 text-indigo-800 font-medium"
                  >
                    <Upload className="h-4 w-4 text-indigo-600" /> Import / Restore JSON (.json)
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Language Toggle Icon Only */}
          <button
            onClick={() =>
              setState((p) => ({ ...p, uiLang: p.uiLang === 'bn' ? 'en' : 'bn' }))
            }
            aria-label="Toggle Language"
            title={isBn ? 'Switch to English' : 'বাংলায় পরিবর্তন করুন'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white transition"
          >
            <Languages className="h-3.5 w-3.5" />
          </button>

          {/* Toggle Editor */}
          <button
            onClick={() => setShowInspector(!showInspector)}
            aria-label="Toggle Inspector"
            title={showInspector ? 'Hide Side Panel' : 'Show Side Panel'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white transition"
          >
            {showInspector ? (
              <PanelRightClose className="h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </header>

      {/* ==================== 2-FILE COMPARISON BAR (WEEKLY / MONTHLY) ==================== */}
      {state.viewMode !== 'overall' && (
        <div
          className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-orange-200 bg-orange-50/95 px-3 py-2 text-xs text-orange-950"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold uppercase tracking-wide">
              {state.viewMode === 'weekly'
                ? isBn
                  ? 'সাপ্তাহিক তুলনা (২টি ফাইল):'
                  : 'Weekly 2-File Compare:'
                : isBn
                ? 'মাসিক তুলনা (২টি ফাইল):'
                : 'Monthly 2-File Compare:'}
            </span>

            <div className="flex items-center gap-1.5">
              <label className="font-semibold">
                {state.viewMode === 'weekly' ? '1st (Prev Week):' : '1st (Prev Month):'}
              </label>
              <select
                value={activeCompare.file1Id}
                onChange={(e) => updateCompare('file1Id', e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900 shadow-xs"
              >
                {state.savedFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {formatDateDisplay(f.date)}
                  </option>
                ))}
              </select>
            </div>

            <ArrowRight className="h-4 w-4 text-slate-500" />

            <div className="flex items-center gap-1.5">
              <label className="font-semibold">
                {state.viewMode === 'weekly' ? '2nd (Last Week):' : '2nd (Final Report):'}
              </label>
              <select
                value={activeCompare.file2Id}
                onChange={(e) => updateCompare('file2Id', e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900 shadow-xs"
              >
                <option value={LIVE_WORKSPACE_ID}>
                  ★ {isBn ? 'বর্তমান চলমান কাজ (Live Workspace)' : 'Current Live Workspace'}
                </option>
                {state.savedFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {formatDateDisplay(f.date)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2.5 py-0.5 font-bold border border-slate-300 text-slate-900">
              WA: +{waSummary.delta.addedLayers}L · +{waSummary.delta.addedTunnelM.toFixed(1)}m | WB: +
              {Math.max(0, displayCtx.displayWb.completedLengthM - (displayCtx.baseline.wbCompletedLengthM ?? 0)).toFixed(1)}m
            </span>
          </div>
        </div>
      )}

      {/* ==================== LIVE KPI & ZOOM SUB-BAR ==================== */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1">
            <span className="font-bold text-slate-700">WA:</span>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800">
              {waSummary.completedShafts}/37 Done
            </span>
            <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 font-bold text-fuchsia-800">
              {(waSummary.completedTunnelLengthM / 1000).toFixed(2)}/{(waSummary.totalTunnelLengthM / 1000).toFixed(2)} km
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span className="font-bold text-slate-700">SPS:</span>
            <span className="rounded bg-teal-100 px-1.5 py-0.5 font-bold text-teal-800">
              {displayCtx.displayPump.layers.filter((l) => l.status === 'complete').length}/5 · Sink: {displayCtx.displayPump.sinkingStatus.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span className="font-bold text-slate-700">WB:</span>
            <span className="rounded bg-blue-100 px-1.5 py-0.5 font-bold text-blue-800">
              {displayCtx.displayWb.completedLengthM.toFixed(1)}/{displayCtx.displayWb.totalLengthM}m ({wbPct.toFixed(1)}%)
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span className="font-bold text-slate-700">WC:</span>
            <span className="rounded bg-purple-100 px-1.5 py-0.5 font-bold text-purple-800">
              {wcSummary.completedShafts}/{wcSummary.totalShafts} ({wcSummary.tunnelPctOverall.toFixed(1)}%)
            </span>
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.2).toFixed(2))))}
            className="rounded border border-slate-200 p-1 hover:bg-slate-100"
            title="Zoom Out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-12 text-center font-bold text-slate-700">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(3.5, Number((z + 0.2).toFixed(2))))}
            className="rounded border border-slate-200 p-1 hover:bg-slate-100"
            title="Zoom In"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="ml-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-semibold hover:bg-slate-100"
          >
            {zoom === 1 ? (
              <Maximize2 className="h-3 w-3 inline mr-1" />
            ) : (
              <Minimize2 className="h-3 w-3 inline mr-1" />
            )}
            Fit A1
          </button>
        </div>
      </div>

      {/* ==================== MAIN SPLIT WORKSPACE ==================== */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left/Center: A1 Vector Drawing Viewport */}
        <main className="flex-1 overflow-auto bg-slate-300/70 p-4">
          <div
            className="print-sheet-wrapper mx-auto origin-top-left bg-white shadow-2xl ring-1 ring-slate-400/50 transition-all"
            style={{
              width: `${zoom * 100}%`,
              minWidth: zoom > 1 ? `${zoom * 100}%` : undefined,
            }}
          >
            <A1SheetDrawing
              state={state}
              selectedShaftId={activeDrawingSelectionId}
              onSelectShaft={(id, focus) => {
                if (id.startsWith('WC-')) {
                  setSelectedWcShaftId(id);
                  setCombinedEditorTarget('wc');
                } else {
                  setSelectedShaftId(id);
                  setCombinedEditorTarget('wa');
                }
                if (focus) setFocusSection(focus);
                if (!showInspector) setShowInspector(true);
              }}
              onSelectWbNode={(nodeId) => {
                setSelectedWbNodeId(nodeId);
                setCombinedEditorTarget('wb');
                if (!showInspector) setShowInspector(true);
              }}
              onSelectTitleBlock={() => {
                setRequestedEditorTab((prev) => ({ tab: 'settings', seq: prev.seq + 1 }));
                if (!showInspector) setShowInspector(true);
              }}
              svgRef={svgRef}
            />
          </div>
          <div className="no-print mt-2 text-center text-[11px] text-slate-600">
            {isBn
              ? 'টিপস: যেকোনো WA Shaft, Pump Station, WB নোড, WC Shaft অথবা Title Block-এ ক্লিক করে ডান পাশ থেকে এডিট করুন। সব পরিবর্তন অটো-সেভ হয়।'
              : 'Tip: Click any WA Shaft, Pump Station, WB Node, WC Shaft, or Title Block on the A1 drawing to edit. All edits auto-save.'}
          </div>
        </main>

        {/* Right: Contextual Section Editor (WA / WB / WC) */}
        {showInspector && (
          <div className="no-print flex w-full max-w-[395px] shrink-0 h-full flex-col border-l border-slate-200 bg-white">
            {/* In Combined Mode show quick 3-pill target switcher on top of editor */}
            {state.activeSection === 'combined' && (
              <div className="grid grid-cols-3 gap-1 border-b border-slate-200 bg-indigo-50 p-1.5 text-[11px] font-bold">
                {(
                  [
                    { id: 'wa', label: 'Edit WA + SPS' },
                    { id: 'wb', label: 'Edit WB OpenCut' },
                    { id: 'wc', label: 'Edit WC (27)' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setCombinedEditorTarget(item.id)}
                    className={`rounded py-1 transition ${
                      combinedEditorTarget === item.id
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-white text-indigo-900 border border-indigo-200 hover:bg-indigo-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {/* In Custom Mode show quick 2-pill switcher: Custom Selection vs Edit Shaft */}
            {state.activeSection === 'custom' && (
              <div className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-orange-50 p-1.5 text-[11px] font-bold">
                <button
                  onClick={() => setCustomInspectorTab('custom')}
                  className={`rounded py-1 transition ${
                    customInspectorTab === 'custom'
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'bg-white text-orange-950 border border-orange-200 hover:bg-orange-100'
                  }`}
                >
                  {isBn ? 'কাস্টম সিলেকশন' : 'Select Shafts / Range'}
                </button>
                <button
                  onClick={() => setCustomInspectorTab('edit')}
                  className={`rounded py-1 transition ${
                    customInspectorTab === 'edit'
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'bg-white text-orange-950 border border-orange-200 hover:bg-orange-100'
                  }`}
                >
                  {isBn
                    ? `এডিট (${customSectionTarget === 'wc' ? selectedWcShaftId : selectedShaftId})`
                    : `Edit (${customSectionTarget === 'wc' ? selectedWcShaftId : selectedShaftId})`}
                </button>
              </div>
            )}

            <div className="flex-1 overflow-hidden">
              {state.activeSection === 'custom' && customInspectorTab === 'custom' ? (
                <CustomShaftPanel
                  state={state}
                  selectedShaftId={
                    customSectionTarget === 'wc' ? selectedWcShaftId : selectedShaftId
                  }
                  onUpdateCustomView={handleUpdateCustomView}
                  onOpenShaftEditor={(shaftId, sec) => {
                    if (sec === 'wc') setSelectedWcShaftId(shaftId);
                    else setSelectedShaftId(shaftId);
                    setCustomInspectorTab('edit');
                  }}
                />
              ) : activeInspectorMode === 'wb' ? (
                <WbEditorPanel
                  state={state}
                  selectedNodeId={selectedWbNodeId}
                  onSelectNode={(id) => setSelectedWbNodeId(id)}
                  onUpdateWb={handleUpdateWb}
                  requestedTab={requestedEditorTab}
                  onUpdateSettings={(patch) =>
                    setState((prev) => ({
                      ...prev,
                      lastSavedAt: new Date().toISOString(),
                      settings: { ...prev.settings, ...patch },
                    }))
                  }
                />
              ) : (
                <ShaftEditorPanel
                  state={state}
                  sectionTarget={activeInspectorMode === 'wc' ? 'wc' : 'wa'}
                  selectedShaftId={
                    activeInspectorMode === 'wc' ? selectedWcShaftId : selectedShaftId
                  }
                  onSelectShaft={(id) =>
                    activeInspectorMode === 'wc'
                      ? setSelectedWcShaftId(id)
                      : setSelectedShaftId(id)
                  }
                  onUpdateShaft={
                    activeInspectorMode === 'wc' ? handleUpdateWcShaft : handleUpdateWaShaft
                  }
                  onUpdateState={(updater) =>
                    setState((prev) => ({
                      ...updater(prev),
                      lastSavedAt: new Date().toISOString(),
                    }))
                  }
                  focusSection={focusSection}
                  requestedTab={requestedEditorTab}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ==================== OFFSCREEN MULTI-PAGE A1 RENDERER FOR 5-PAGE PDF ==================== */}
      {multiPdfReq && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: '-99999px',
            top: 0,
            width: '1682px',
            height: '1188px',
            pointerEvents: 'none',
            opacity: 0,
          }}
        >
          {multiPdfReq.sections.map((sec) => (
            <A1SheetDrawing
              key={sec}
              state={multiPdfReq.sourceState}
              forceSection={sec}
              selectedShaftId=""
              onSelectShaft={() => {}}
              svgRef={(el: SVGSVGElement | null) => {
                multiSvgRefs.current[sec] = el;
              }}
            />
          ))}
        </div>
      )}

      {/* ==================== SAVE OVERALL FILE MODAL (WA + WB + WC IN 1 FILE) ==================== */}
      {saveModalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Save className="h-4 w-4 text-emerald-600" />
                {isBn
                  ? 'ফাইল সেভ করুন (WA + WB + WC একসাথে)'
                  : 'Save Unified File (WA + WB + WC)'}
              </h2>
              <button
                onClick={() => setSaveModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {isBn
                ? 'এই একটি ফাইলের ভেতরে WA, WB ও WC — তিনটি পেজের সব তথ্য একসাথে সেভ থাকবে এবং Weekly/Monthly তুলনা ও ৫-পেজ PDF এক্সপোর্টে ব্যবহার করা যাবে।'
                : 'Saves WA, WB, Pump Station, and WC all inside one single file for viewing, editing, 5-Page PDF export, and Weekly/Monthly comparison.'}
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">
                  {isBn ? 'ফাইলের নাম (File Name):' : 'File Name:'}
                </label>
                <input
                  type="text"
                  value={saveFileName}
                  onChange={(e) => setSaveFileName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-medium"
                  placeholder="e.g. Week 46 Report / Nov Final"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">
                  {isBn ? 'তারিখ (Date):' : 'Date:'}
                </label>
                <input
                  type="date"
                  value={saveFileDate}
                  onChange={(e) => setSaveFileDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-medium"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">
                  {isBn ? 'মন্তব্য / নোট (ঐচ্ছিক):' : 'Note (optional):'}
                </label>
                <input
                  type="text"
                  value={saveFileNote}
                  onChange={(e) => setSaveFileNote(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  placeholder={isBn ? 'যেমন: মিটিংয়ের পর আপডেট' : 'e.g. Site inspection update'}
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                onClick={() => setSaveModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {isBn ? 'বাতিল' : 'Cancel'}
              </button>
              {editingFile && (
                <button
                  onClick={() => {
                    setState((p) => ({ ...p, activeLoadedFileId: null }));
                    setSaveModalOpen(false);
                  }}
                  className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  {isBn ? 'ফাইল ডিসকানেক্ট' : 'Detach File'}
                </button>
              )}
              {editingFile && (
                <button
                  onClick={() => handleSaveFile('update')}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  {isBn ? 'আগের ফাইলে আপডেট' : 'Update Existing File'}
                </button>
              )}
              <button
                onClick={() => handleSaveFile('new')}
                className="flex items-center gap-1 rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Plus className="h-3.5 w-3.5" />
                {isBn ? 'নতুন ফাইল সেভ করুন' : 'Save New File'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== SAVED FILES MANAGER MODAL (VIEW / EDIT / DOWNLOAD) ==================== */}
      {filesModalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-3 text-white">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-indigo-300" />
                <h2 className="text-sm font-bold">
                  {previewFile
                    ? `${isBn ? 'ফাইল প্রিভিউ:' : 'Previewing:'} ${previewFile.name} (${formatDateDisplay(previewFile.date)})`
                    : isBn
                    ? `সেভ করা সব ফাইল (${state.savedFiles.length}টি — WA+WB+WC)`
                    : `All Saved Unified Files (${state.savedFiles.length} — WA+WB+WC)`}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {previewFile && (
                  <button
                    onClick={() => setPreviewFile(null)}
                    className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-semibold hover:bg-slate-700"
                  >
                    ← {isBn ? 'সব ফাইল তালিকা' : 'Back to Files List'}
                  </button>
                )}
                <button
                  onClick={() => {
                    setPreviewFile(null);
                    setFilesModalOpen(false);
                  }}
                  className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {previewFile && previewState ? (
              <div className="flex flex-1 flex-col overflow-hidden bg-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-white px-4 py-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    {(['wa', 'wb', 'wc', 'combined'] as SectionTab[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setPreviewTab(t)}
                        className={`rounded px-2.5 py-1 font-bold uppercase ${
                          previewTab === t
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleEditSavedFile(previewFile)}
                      className="flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 font-bold text-white hover:bg-indigo-700"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {isBn ? 'এডিট করুন' : 'Edit'}
                    </button>
                    <button
                      onClick={() =>
                        startMultiPagePdfExport(
                          FIVE_PAGE_PDF_SECTIONS,
                          previewState,
                          `${previewFile.date}-${previewFile.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}`
                        )
                      }
                      className="flex items-center gap-1 rounded bg-blue-700 px-2.5 py-1 font-bold text-white hover:bg-blue-800"
                    >
                      <Files className="h-3.5 w-3.5" /> 5-Page PDF
                    </button>
                    <button
                      onClick={() =>
                        handleExport(
                          'pdf',
                          previewSvgRef.current,
                          `${previewFile.date}-${previewFile.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}`
                        )
                      }
                      className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 font-bold text-white hover:bg-blue-700"
                    >
                      <FileText className="h-3.5 w-3.5" /> Current PDF
                    </button>
                    <button
                      onClick={() =>
                        exportSavedFileExcel(
                          previewFile,
                          state.settings,
                          `WABC-${previewFile.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${previewFile.date}.xlsx`
                        )
                      }
                      className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-bold text-white hover:bg-emerald-700"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Excel (.xlsx)
                    </button>
                    <button
                      onClick={() =>
                        exportSavedFileJson(
                          previewFile,
                          `WABC-${previewFile.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${previewFile.date}.json`
                        )
                      }
                      className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" /> JSON
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <div className="mx-auto max-w-[1400px] bg-white shadow-xl">
                    <A1SheetDrawing
                      state={previewState}
                      forceSection={previewTab}
                      selectedShaftId=""
                      onSelectShaft={() => {}}
                      svgRef={previewSvgRef}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  <span>
                    {isBn
                      ? 'প্রতিটি সেভ করা ফাইলের ভেতর WA, WB ও WC — তিনটি পেজই সংরক্ষিত আছে। যেকোনো ফাইল View, Edit বা 5-Page PDF/Excel ডাউনলোড করতে পারেন।'
                      : 'Each saved file stores all 3 sections (WA + WB + WC) together. View, Edit, or Download 5-Page PDF / Multi-sheet Excel.'}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => jsonInputRef.current?.click()}
                      className="flex items-center gap-1 rounded border border-indigo-300 bg-white px-2.5 py-1 font-bold text-indigo-800 hover:bg-indigo-100"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {isBn ? 'JSON ইমপোর্ট করুন' : 'Import JSON'}
                    </button>
                    <button
                      onClick={() => {
                        setFilesModalOpen(false);
                        openSaveFileModal();
                      }}
                      className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-bold text-white hover:bg-emerald-700"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {isBn ? 'বর্তমান অবস্থা সেভ করুন' : 'Save Current Workspace'}
                    </button>
                  </div>
                </div>

                {state.savedFiles.map((file) => {
                  const fSum = computeSummary(
                    file.shafts,
                    undefined,
                    file.pumpStation,
                    undefined,
                    state.settings.waTunnelDiaTotalsM
                  );
                  const fWb = file.wb || createInitialWbData();
                  const fWc = file.wc || createInitialWcData();
                  const fWcSum = computeSummary(fWc.shafts);
                  const lowerPumpDone = file.pumpStation.layers.filter(
                    (l) => l.status === 'complete'
                  ).length;
                  const isEditingThis = state.activeLoadedFileId === file.id;
                  const safeSlug = file.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'file';

                  return (
                    <div
                      key={file.id}
                      className={`rounded-xl border bg-white p-3.5 shadow-xs transition ${
                        isEditingThis ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900">
                              {file.name}
                            </h3>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                              Date: {formatDateDisplay(file.date)}
                            </span>
                            {isEditingThis && (
                              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                                {isBn ? 'বর্তমানে এডিটেড' : 'Currently Editing'}
                              </span>
                            )}
                          </div>
                          {file.note && (
                            <p className="text-xs text-slate-500">{file.note}</p>
                          )}
                          <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                            <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-semibold text-emerald-800">
                              WA: {fSum.completedShafts}/37 · {(fSum.completedTunnelLengthM / 1000).toFixed(3)} km
                            </span>
                            <span className="rounded bg-teal-50 border border-teal-200 px-2 py-0.5 font-semibold text-teal-800">
                              SPS: {lowerPumpDone}/5 · Sink: {file.pumpStation.sinkingStatus || 'ongoing'}
                            </span>
                            <span className="rounded bg-blue-50 border border-blue-200 px-2 py-0.5 font-semibold text-blue-800">
                              WB: {fWb.completedLengthM.toFixed(1)}/{fWb.totalLengthM} m
                            </span>
                            <span className="rounded bg-purple-50 border border-purple-200 px-2 py-0.5 font-semibold text-purple-800">
                              WC: {fWcSum.completedShafts}/{fWcSum.totalShafts} ({fWcSum.tunnelPctOverall.toFixed(1)}%)
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <button
                            onClick={() => {
                              setPreviewTab('combined');
                              setPreviewFile(file);
                            }}
                            className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-bold text-blue-800 hover:bg-blue-100"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            {isBn ? 'দেখুন (View)' : 'View'}
                          </button>

                          <button
                            onClick={() => handleEditSavedFile(file)}
                            className="flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 font-bold text-indigo-800 hover:bg-indigo-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {isBn ? 'এডিট (Edit)' : 'Edit'}
                          </button>

                          <button
                            onClick={() => {
                              exportSavedFileExcel(
                                file,
                                state.settings,
                                `WABC-${safeSlug}-${file.date}.xlsx`
                              );
                              showToast(
                                isBn ? `"${file.name}" Excel ডাউনলোড হয়েছে!` : 'Excel downloaded!'
                              );
                            }}
                            className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-bold text-emerald-800 hover:bg-emerald-100"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Excel
                          </button>

                          <button
                            onClick={() => {
                              exportSavedFileJson(file, `WABC-${safeSlug}-${file.date}.json`);
                              showToast(
                                isBn ? `"${file.name}" JSON ডাউনলোড হয়েছে!` : 'JSON downloaded!'
                              );
                            }}
                            className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            JSON
                          </button>

                          <button
                            onClick={() => handleDeleteSavedFile(file)}
                            className="rounded-md border border-rose-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50"
                            title={isBn ? 'মুছে ফেলুন' : 'Delete'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="no-print fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default App;
