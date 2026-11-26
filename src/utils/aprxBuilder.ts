import JSZip from 'jszip';
import {
  DEFAULT_AIR_VALVE_COORD,
  DEFAULT_WASHOUT_COORD,
} from '../data/wbcInitialData';
import { AppState, WorkStatus } from '../types';
import {
  computeSummary,
  formatDateDisplay,
  getShaftStatus,
  getTunnelStatus,
  resolveDisplayContext,
} from './calculations';
import {
  buildGeoViewport,
  computeMetersPerSvgUnit,
  computeWbPolylineSplit,
  formatDms,
  layoutMapLabels,
  MapLabelInput,
} from './geoMap';

const EARTH_RADIUS = 6378137.0;

function lonLatToWebMercator(lon: number, lat: number): { x: number; y: number } {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = EARTH_RADIUS * ((lon * Math.PI) / 180);
  const y =
    EARTH_RADIUS *
    Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
  return { x, y };
}

function webMercatorToLonLat(x: number, y: number): { lon: number; lat: number } {
  const lon = ((x / EARTH_RADIUS) * 180) / Math.PI;
  const lat =
    ((2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180) / Math.PI;
  return { lon, lat };
}

interface MercatorCameraResult {
  extent: { xmin: number; ymin: number; xmax: number; ymax: number };
  x: number;
  y: number;
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
  meanLat: number;
}

/**
 * Computes Web Mercator CIMViewCamera matching ArcGIS Pro's exact rule:
 * `viewportWidth = (frameW_mm / 1000) * scale` and `viewportHeight = (frameH_mm / 1000) * scale`.
 */
function computeMercatorCamera(
  pts: Array<{ lat: number; lon: number }>,
  frameW_mm: number,
  frameH_mm: number,
  padFrac = 0.14
): MercatorCameraResult {
  const valid = pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const fallback = [{ lat: 23.72, lon: 90.43 }];
  const list = valid.length > 0 ? valid : fallback;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumLat = 0;

  for (const p of list) {
    const m = lonLatToWebMercator(p.lon, p.lat);
    if (m.x < minX) minX = m.x;
    if (m.x > maxX) maxX = m.x;
    if (m.y < minY) minY = m.y;
    if (m.y > maxY) maxY = m.y;
    sumLat += p.lat;
  }

  const meanLat = sumLat / list.length;
  const dx = Math.max(200, maxX - minX);
  const dy = Math.max(200, maxY - minY);
  minX -= dx * padFrac;
  maxX += dx * padFrac;
  minY -= dy * padFrac;
  maxY += dy * padFrac;

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const frameWm = Math.max(0.02, frameW_mm / 1000);
  const frameHm = Math.max(0.02, frameH_mm / 1000);

  const scaleX = spanX / frameWm;
  const scaleY = spanY / frameHm;
  const scale = Math.max(2000, Math.round(Math.max(scaleX, scaleY) * 1.06));

  const viewportWidth = frameWm * scale;
  const viewportHeight = frameHm * scale;

  return {
    extent: {
      xmin: cx - viewportWidth / 2,
      ymin: cy - viewportHeight / 2,
      xmax: cx + viewportWidth / 2,
      ymax: cy + viewportHeight / 2,
    },
    x: cx,
    y: cy,
    scale,
    viewportWidth,
    viewportHeight,
    meanLat,
  };
}

function rgbColor(r: number, g: number, b: number, a = 100) {
  return { type: 'CIMRGBColor', values: [r, g, b, a] };
}

function solidLineSymbol(r: number, g: number, b: number, widthPt = 2.4) {
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMLineSymbol',
      symbolLayers: [
        {
          type: 'CIMSolidStroke',
          enable: true,
          capStyle: 'Round',
          joinStyle: 'Round',
          lineStyle3D: 'Strip',
          miterLimit: 10,
          width: widthPt,
          height3D: 1,
          anchor3D: 'Center',
          color: rgbColor(r, g, b, 100),
        },
      ],
    },
  };
}

/**
 * White-haloed line symbol matching PDF pipelines & tunnel alignments over street maps.
 */
function casedLineSymbol(r: number, g: number, b: number, coreW = 3.8, casingW = 6.4) {
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMLineSymbol',
      symbolLayers: [
        {
          type: 'CIMSolidStroke',
          enable: true,
          capStyle: 'Round',
          joinStyle: 'Round',
          lineStyle3D: 'Strip',
          miterLimit: 10,
          width: coreW,
          height3D: 1,
          anchor3D: 'Center',
          color: rgbColor(r, g, b, 100),
        },
        {
          type: 'CIMSolidStroke',
          enable: true,
          capStyle: 'Round',
          joinStyle: 'Round',
          lineStyle3D: 'Strip',
          miterLimit: 10,
          width: casingW,
          height3D: 1,
          anchor3D: 'Center',
          color: rgbColor(255, 255, 255, 100),
        },
      ],
    },
  };
}

function circleRing(radius: number, segs = 12): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push([
      Number((Math.cos(a) * radius).toFixed(4)),
      Number((Math.sin(a) * radius).toFixed(4)),
    ]);
  }
  return ring;
}

/**
 * PDF-identical shaft/node marker: white-filled square with thick status outline + inner status circle dot.
 */
function squareWithDotSymbol(r: number, g: number, b: number, sizePt = 11.5) {
  const half = sizePt / 2;
  const dotR = sizePt * 0.25;
  const sqRing = [
    [-half, half],
    [half, half],
    [half, -half],
    [-half, -half],
    [-half, half],
  ];
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMPointSymbol',
      symbolLayers: [
        {
          type: 'CIMVectorMarker',
          enable: true,
          anchorPoint: { x: 0, y: 0 },
          anchorPointUnits: 'Relative',
          dominantSizeAxis3D: 'Z',
          size: sizePt,
          billboardMode3D: 'FaceNearPlane',
          frame: { xmin: -half, ymin: -half, xmax: half, ymax: half },
          markerGraphics: [
            {
              type: 'CIMMarkerGraphic',
              geometry: { rings: [sqRing] },
              symbol: {
                type: 'CIMPolygonSymbol',
                symbolLayers: [
                  {
                    type: 'CIMSolidStroke',
                    enable: true,
                    capStyle: 'Round',
                    joinStyle: 'Miter',
                    lineStyle3D: 'Strip',
                    miterLimit: 10,
                    width: 2.0,
                    height3D: 1,
                    anchor3D: 'Center',
                    color: rgbColor(r, g, b, 100),
                  },
                  {
                    type: 'CIMSolidFill',
                    enable: true,
                    color: rgbColor(255, 255, 255, 100),
                  },
                ],
                angleAlignment: 'Map',
              },
            },
            {
              type: 'CIMMarkerGraphic',
              geometry: { rings: [circleRing(dotR, 12)] },
              symbol: {
                type: 'CIMPolygonSymbol',
                symbolLayers: [
                  {
                    type: 'CIMSolidFill',
                    enable: true,
                    color: rgbColor(r, g, b, 100),
                  },
                ],
                angleAlignment: 'Map',
              },
            },
          ],
          scaleSymbolsProportionally: true,
          respectFrame: true,
        },
      ],
      haloSize: 1,
      scaleX: 1,
      angleAlignment: 'Display',
    },
  };
}

/**
 * Pink rounded square symbol for Golapbag SPS matching GIS output sample.pdf.
 */
function spsSquareSymbol(sizePt = 14) {
  const h = sizePt / 2;
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMPointSymbol',
      symbolLayers: [
        {
          type: 'CIMVectorMarker',
          enable: true,
          anchorPoint: { x: 0, y: 0 },
          anchorPointUnits: 'Relative',
          dominantSizeAxis3D: 'Z',
          size: sizePt,
          billboardMode3D: 'FaceNearPlane',
          frame: { xmin: -h, ymin: -h, xmax: h, ymax: h },
          markerGraphics: [
            {
              type: 'CIMMarkerGraphic',
              geometry: {
                rings: [[[-h, h], [h, h], [h, -h], [-h, -h], [-h, h]]],
              },
              symbol: {
                type: 'CIMPolygonSymbol',
                symbolLayers: [
                  {
                    type: 'CIMSolidStroke',
                    enable: true,
                    capStyle: 'Round',
                    joinStyle: 'Miter',
                    lineStyle3D: 'Strip',
                    miterLimit: 10,
                    width: 1.8,
                    height3D: 1,
                    anchor3D: 'Center',
                    color: rgbColor(157, 23, 77, 100),
                  },
                  {
                    type: 'CIMSolidFill',
                    enable: true,
                    color: rgbColor(251, 207, 232, 100),
                  },
                ],
                angleAlignment: 'Map',
              },
            },
          ],
          scaleSymbolsProportionally: true,
          respectFrame: true,
        },
      ],
      haloSize: 1,
      scaleX: 1,
      angleAlignment: 'Display',
    },
  };
}

/**
 * Triangle-inside-circle symbol for WB Washout (green) & Air Valve (sky blue).
 */
function triangleInCircleSymbol(
  fillBg: [number, number, number],
  triCol: [number, number, number],
  borderCol: [number, number, number],
  sizePt = 14
) {
  const r = sizePt / 2;
  const tr = r * 0.58;
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMPointSymbol',
      symbolLayers: [
        {
          type: 'CIMVectorMarker',
          enable: true,
          anchorPoint: { x: 0, y: 0 },
          anchorPointUnits: 'Relative',
          dominantSizeAxis3D: 'Z',
          size: sizePt,
          billboardMode3D: 'FaceNearPlane',
          frame: { xmin: -r, ymin: -r, xmax: r, ymax: r },
          markerGraphics: [
            {
              type: 'CIMMarkerGraphic',
              geometry: { rings: [circleRing(r, 16)] },
              symbol: {
                type: 'CIMPolygonSymbol',
                symbolLayers: [
                  {
                    type: 'CIMSolidStroke',
                    enable: true,
                    capStyle: 'Round',
                    joinStyle: 'Round',
                    lineStyle3D: 'Strip',
                    miterLimit: 10,
                    width: 1.5,
                    height3D: 1,
                    anchor3D: 'Center',
                    color: rgbColor(borderCol[0], borderCol[1], borderCol[2], 100),
                  },
                  {
                    type: 'CIMSolidFill',
                    enable: true,
                    color: rgbColor(fillBg[0], fillBg[1], fillBg[2], 96),
                  },
                ],
                angleAlignment: 'Map',
              },
            },
            {
              type: 'CIMMarkerGraphic',
              geometry: {
                rings: [[[0, tr], [tr * 0.9, -tr * 0.72], [-tr * 0.9, -tr * 0.72], [0, tr]]],
              },
              symbol: {
                type: 'CIMPolygonSymbol',
                symbolLayers: [
                  {
                    type: 'CIMSolidStroke',
                    enable: true,
                    capStyle: 'Round',
                    joinStyle: 'Round',
                    lineStyle3D: 'Strip',
                    miterLimit: 10,
                    width: 0.9,
                    height3D: 1,
                    anchor3D: 'Center',
                    color: rgbColor(255, 255, 255, 100),
                  },
                  {
                    type: 'CIMSolidFill',
                    enable: true,
                    color: rgbColor(triCol[0], triCol[1], triCol[2], 100),
                  },
                ],
                angleAlignment: 'Map',
              },
            },
          ],
          scaleSymbolsProportionally: true,
          respectFrame: true,
        },
      ],
      haloSize: 1,
      scaleX: 1,
      angleAlignment: 'Display',
    },
  };
}

function circlePointSymbol(
  r: number,
  g: number,
  b: number,
  sizePt = 8.5,
  strokeW = 1.2,
  strokeRgb: [number, number, number] = [255, 255, 255]
) {
  const half = sizePt / 2;
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMPointSymbol',
      symbolLayers: [
        {
          type: 'CIMVectorMarker',
          enable: true,
          anchorPoint: { x: 0, y: 0 },
          anchorPointUnits: 'Relative',
          dominantSizeAxis3D: 'Z',
          size: sizePt,
          billboardMode3D: 'FaceNearPlane',
          frame: { xmin: -half, ymin: -half, xmax: half, ymax: half },
          markerGraphics: [
            {
              type: 'CIMMarkerGraphic',
              geometry: { rings: [circleRing(half, 14)] },
              symbol: {
                type: 'CIMPolygonSymbol',
                symbolLayers: [
                  {
                    type: 'CIMSolidStroke',
                    enable: true,
                    capStyle: 'Round',
                    joinStyle: 'Round',
                    lineStyle3D: 'Strip',
                    miterLimit: 10,
                    width: strokeW,
                    height3D: 1,
                    anchor3D: 'Center',
                    color: rgbColor(strokeRgb[0], strokeRgb[1], strokeRgb[2], 100),
                  },
                  {
                    type: 'CIMSolidFill',
                    enable: true,
                    color: rgbColor(r, g, b, 100),
                  },
                ],
                angleAlignment: 'Map',
              },
            },
          ],
          scaleSymbolsProportionally: true,
          respectFrame: true,
        },
      ],
      haloSize: 1,
      scaleX: 1,
      angleAlignment: 'Display',
    },
  };
}

function solidPolygonSymbol(
  fillRgb: [number, number, number, number],
  strokeRgb?: [number, number, number, number],
  strokeWidth = 0.8
) {
  const layers: Array<Record<string, unknown>> = [];
  if (strokeRgb && strokeWidth > 0) {
    layers.push({
      type: 'CIMSolidStroke',
      enable: true,
      capStyle: 'Round',
      joinStyle: 'Miter',
      lineStyle3D: 'Strip',
      miterLimit: 10,
      width: strokeWidth,
      height3D: 1,
      anchor3D: 'Center',
      color: rgbColor(...strokeRgb),
    });
  }
  if (fillRgb[3] > 0) {
    layers.push({
      type: 'CIMSolidFill',
      enable: true,
      color: rgbColor(...fillRgb),
    });
  }
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMPolygonSymbol',
      symbolLayers: layers,
      angleAlignment: 'Map',
    },
  };
}

function makeTextSymbol(
  heightPt = 9,
  rgb: [number, number, number] = [15, 23, 42],
  bold = false,
  horizAlign: 'Left' | 'Center' | 'Right' = 'Left',
  halo = false,
  opts?: {
    angle?: number;
    callout?: {
      fill: [number, number, number, number];
      stroke: [number, number, number, number];
      strokeW?: number;
      padH?: number;
      padV?: number;
    };
  }
) {
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMTextSymbol',
      ...(opts?.angle ? { angle: opts.angle } : {}),
      blockProgression: 'TTB',
      ...(opts?.callout
        ? {
            callout: {
              type: 'CIMBalloonCallout',
              balloonStyle: 'RoundedRectangle',
              leaderTolerance: 2,
              leaderOffset: 2,
              margin: {
                type: 'CIMTextMargin',
                left: opts.callout.padH ?? 5,
                right: opts.callout.padH ?? 5,
                top: opts.callout.padV ?? 3,
                bottom: opts.callout.padV ?? 3,
              },
              backgroundSymbol: {
                type: 'CIMPolygonSymbol',
                symbolLayers: [
                  {
                    type: 'CIMSolidStroke',
                    enable: true,
                    capStyle: 'Round',
                    joinStyle: 'Round',
                    lineStyle3D: 'Strip',
                    miterLimit: 10,
                    width: opts.callout.strokeW ?? 1.2,
                    height3D: 1,
                    anchor3D: 'Center',
                    color: rgbColor(...opts.callout.stroke),
                  },
                  {
                    type: 'CIMSolidFill',
                    enable: true,
                    color: rgbColor(...opts.callout.fill),
                  },
                ],
                angleAlignment: 'Map',
              },
            },
          }
        : {}),
      depth3D: 1,
      extrapolateBaselines: true,
      fontEffects: 'Normal',
      fontEncoding: 'Unicode',
      fontFamilyName: 'Arial',
      fontStyleName: bold ? 'Bold' : 'Regular',
      fontType: 'Unspecified',
      haloSize: halo ? 1.8 : 0,
      ...(halo
        ? {
            haloSymbol: {
              type: 'CIMPolygonSymbol',
              symbolLayers: [
                {
                  type: 'CIMSolidFill',
                  enable: true,
                  color: rgbColor(255, 255, 255, 100),
                },
              ],
              angleAlignment: 'Map',
            },
          }
        : {}),
      height: heightPt,
      hinting: 'Default',
      horizontalAlignment: horizAlign,
      kerning: true,
      letterWidth: 100,
      ligatures: true,
      lineGapType: 'ExtraLeading',
      symbol: {
        type: 'CIMPolygonSymbol',
        symbolLayers: [
          {
            type: 'CIMSolidFill',
            enable: true,
            color: rgbColor(rgb[0], rgb[1], rgb[2], 100),
          },
        ],
        angleAlignment: 'Map',
      },
      textCase: 'Normal',
      textDirection: 'LTR',
      verticalAlignment: 'Center',
      verticalGlyphOrientation: 'Right',
      wordSpacing: 100,
      billboardMode3D: 'FaceNearPlane',
    },
  };
}

function statusUniqueRenderer(fieldName: string, geomType: 'Point' | 'Polyline') {
  const symComplete =
    geomType === 'Point'
      ? squareWithDotSymbol(22, 163, 74, 11)
      : casedLineSymbol(22, 163, 74, 3.8, 6.2);
  const symOngoing =
    geomType === 'Point'
      ? squareWithDotSymbol(37, 99, 235, 11)
      : casedLineSymbol(37, 99, 235, 3.8, 6.2);
  const symRemaining =
    geomType === 'Point'
      ? squareWithDotSymbol(220, 38, 38, 10.5)
      : casedLineSymbol(220, 38, 38, 3.4, 5.8);
  const symDefault =
    geomType === 'Point'
      ? squareWithDotSymbol(100, 116, 139, 9)
      : casedLineSymbol(100, 116, 139, 2.5, 4.5);

  return {
    type: 'CIMUniqueValueRenderer',
    fields: [fieldName],
    useDefaultSymbol: true,
    defaultLabel: 'Other',
    defaultSymbol: symDefault,
    groups: [
      {
        type: 'CIMUniqueValueGroup',
        heading: fieldName,
        classes: [
          {
            type: 'CIMUniqueValueClass',
            editable: true,
            visible: true,
            label: 'Complete',
            patch: 'Default',
            symbol: symComplete,
            values: [{ type: 'CIMUniqueValue', fieldValues: ['complete'] }],
          },
          {
            type: 'CIMUniqueValueClass',
            editable: true,
            visible: true,
            label: 'On-Going',
            patch: 'Default',
            symbol: symOngoing,
            values: [{ type: 'CIMUniqueValue', fieldValues: ['ongoing'] }],
          },
          {
            type: 'CIMUniqueValueClass',
            editable: true,
            visible: true,
            label: 'Remaining',
            patch: 'Default',
            symbol: symRemaining,
            values: [{ type: 'CIMUniqueValue', fieldValues: ['remaining'] }],
          },
        ],
      },
    ],
  };
}

function wbNodesUniqueRenderer() {
  return {
    type: 'CIMUniqueValueRenderer',
    fields: ['NODE_TYPE', 'STATUS'],
    useDefaultSymbol: true,
    defaultLabel: 'Other',
    defaultSymbol: squareWithDotSymbol(100, 116, 139, 9),
    groups: [
      {
        type: 'CIMUniqueValueGroup',
        heading: 'WB Nodes & Appurtenances',
        classes: [
          {
            type: 'CIMUniqueValueClass',
            editable: true,
            visible: true,
            label: 'Complete',
            patch: 'Default',
            symbol: squareWithDotSymbol(22, 163, 74, 10.5),
            values: [{ type: 'CIMUniqueValue', fieldValues: ['Pipeline Node', 'complete'] }],
          },
          {
            type: 'CIMUniqueValueClass',
            editable: true,
            visible: true,
            label: 'On-Going',
            patch: 'Default',
            symbol: squareWithDotSymbol(37, 99, 235, 10.5),
            values: [{ type: 'CIMUniqueValue', fieldValues: ['Pipeline Node', 'ongoing'] }],
          },
          {
            type: 'CIMUniqueValueClass',
            editable: true,
            visible: true,
            label: 'Remaining',
            patch: 'Default',
            symbol: squareWithDotSymbol(220, 38, 38, 10.0),
            values: [{ type: 'CIMUniqueValue', fieldValues: ['Pipeline Node', 'remaining'] }],
          },
          {
            type: 'CIMUniqueValueClass',
            editable: true,
            visible: true,
            label: 'Washout Valve',
            patch: 'Default',
            symbol: triangleInCircleSymbol([187, 247, 208], [22, 163, 74], [21, 128, 61], 14),
            values: [{ type: 'CIMUniqueValue', fieldValues: ['Washout Valve', 'complete'] }],
          },
          {
            type: 'CIMUniqueValueClass',
            editable: true,
            visible: true,
            label: 'Air Valve',
            patch: 'Default',
            symbol: triangleInCircleSymbol([186, 230, 253], [2, 132, 199], [3, 105, 161], 14),
            values: [{ type: 'CIMUniqueValue', fieldValues: ['Air Valve', 'complete'] }],
          },
        ],
      },
    ],
  };
}

function makeMaplexLabelClass(opts: {
  name: string;
  labelField: string;
  geomType: 'Point' | 'Polyline' | 'Polygon';
  textSymbol: Record<string, unknown>;
  whereClause?: string;
  neverRemove?: boolean;
}) {
  return {
    type: 'CIMLabelClass',
    expressionTitle: opts.name,
    expression: `$feature.${opts.labelField}`,
    expressionEngine: 'Arcade',
    featuresToLabel: 'AllVisibleFeatures',
    ...(opts.whereClause ? { whereClause: opts.whereClause } : {}),
    maplexLabelPlacementProperties: {
      type: 'CIMMaplexLabelPlacementProperties',
      featureType:
        opts.geomType === 'Point'
          ? 'Point'
          : opts.geomType === 'Polygon'
          ? 'Polygon'
          : 'Line',
      avoidPolygonHoles: true,
      canOverrunFeature: true,
      canPlaceLabelOutsidePolygon: true,
      canRemoveOverlappingLabel: !opts.neverRemove,
      canStackLabel: true,
      centerLabelAnchorType: 'Symbol',
      connectionType: opts.geomType === 'Point' ? 'Unambiguous' : 'MinimizeLabels',
      constrainOffset:
        opts.geomType === 'Point' || opts.geomType === 'Polygon'
          ? 'NoConstraint'
          : 'AboveLine',
      contourAlignmentType: 'Page',
      contourLadderType: 'Straight',
      contourMaximumAngle: 90,
      enableConnection: true,
      enablePointPlacementPriorities: true,
      featureWeight: 100,
      fontHeightReductionLimit: 4,
      fontHeightReductionStep: 0.5,
      fontWidthReductionLimit: 90,
      fontWidthReductionStep: 5,
      graticuleAlignmentType: 'Straight',
      keyNumberGroupName: 'Default',
      labelBuffer: 12,
      labelLargestPolygon: true,
      labelPriority: 1,
      minimumFeatureSizeUnit: 'Map',
      multiPartOption: 'OneLabelPerPart',
      neverRemoveLabel: Boolean(opts.neverRemove),
      offsetAlongLineProperties: {
        type: 'CIMMaplexOffsetAlongLineProperties',
        placementMethod: 'BestPositionAlongLine',
        labelAnchorPoint: 'CenterOfLabel',
        distanceUnit: 'Percentage',
        useLineDirection: true,
      },
      pointExternalZonePriorities: {
        type: 'CIMMaplexExternalZonePriorities',
        aboveLeft: 4,
        aboveCenter: 2,
        aboveRight: 1,
        centerRight: 3,
        belowRight: 5,
        belowCenter: 6,
        belowLeft: 7,
        centerLeft: 8,
      },
      pointPlacementMethod: 'AroundPoint',
      polygonFeatureType: 'General',
      polygonPlacementMethod: 'HorizontalInPolygon',
      primaryOffset: 3.5,
      primaryOffsetUnit: 'Point',
      removeExtraWhiteSpace: true,
      repetitionIntervalUnit: 'Point',
      rotationProperties: {
        type: 'CIMMaplexRotationProperties',
        rotationType: 'Arithmetic',
        alignmentType: 'Straight',
      },
      secondaryOffset: 100,
      strategyPriorities: {
        type: 'CIMMaplexStrategyPriorities',
        stacking: 1,
        overrun: 2,
        fontCompression: 3,
        fontReduction: 4,
        abbreviation: 5,
      },
      thinningDistanceUnit: 'Point',
      truncationMarkerCharacter: '.',
      truncationMinimumLength: 1,
      truncationPreferredCharacters: 'aeiou',
      truncationExcludedCharacters: '0123456789',
      polygonAnchorPointPerimeterInsetUnit: 'Point',
    },
    name: opts.name,
    priority: -1,
    standardLabelPlacementProperties: {
      type: 'CIMStandardLabelPlacementProperties',
      featureType: opts.geomType === 'Point' ? 'Point' : 'Line',
      featureWeight: 'None',
      labelWeight: 'High',
      numLabelsOption: 'OneLabelPerName',
      lineLabelPosition: {
        type: 'CIMStandardLineLabelPosition',
        above: true,
        inLine: true,
        parallel: true,
      },
      lineLabelPriorities: {
        type: 'CIMStandardLineLabelPriorities',
        aboveStart: 3,
        aboveAlong: 3,
        aboveEnd: 3,
        centerStart: 3,
        centerAlong: 3,
        centerEnd: 3,
        belowStart: 3,
        belowAlong: 3,
        belowEnd: 3,
      },
      pointPlacementMethod: 'AroundPoint',
      pointPlacementPriorities: {
        type: 'CIMStandardPointPlacementPriorities',
        aboveLeft: 2,
        aboveCenter: 2,
        aboveRight: 1,
        centerLeft: 3,
        centerRight: 2,
        belowLeft: 3,
        belowCenter: 3,
        belowRight: 2,
      },
      rotationType: 'Arithmetic',
      polygonPlacementMethod: 'AlwaysHorizontal',
    },
    textSymbol: opts.textSymbol,
    useCodedValue: true,
    visibility: true,
    iD: -1,
  };
}

function buildFeatureLayerDef(opts: {
  uri: string;
  name: string;
  folderRel: string;
  dataset: string;
  displayField: string;
  labelField: string;
  geomType: 'Point' | 'Polyline' | 'Polygon';
  renderer: Record<string, unknown>;
  showLabels?: boolean;
  labelClasses?: Array<Record<string, unknown>>;
}) {
  const defaultClasses = [
    makeMaplexLabelClass({
      name: 'Default',
      labelField: opts.labelField,
      geomType: opts.geomType,
      textSymbol: makeTextSymbol(9.5, [15, 23, 42], true, 'Left', true),
    }),
  ];

  return {
    type: 'CIMFeatureLayer',
    name: opts.name,
    uRI: opts.uri,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    description: opts.name,
    layerElevation: { type: 'CIMLayerElevationSurface' },
    expanded: true,
    layer3DProperties: {
      type: 'CIM3DLayerProperties',
      castShadows: true,
      isLayerLit: true,
      layerFaceCulling: 'None',
      maxDistance: -1,
      minDistance: -1,
      preloadTextureCutoffHigh: 0,
      preloadTextureCutoffLow: 0.25,
      textureCutoffHigh: 0.25,
      textureCutoffLow: 1,
      useCompressedTextures: true,
      verticalExaggeration: 1,
      exaggerationMode: 'ScaleZ',
      verticalUnit: { uwkid: 9001 },
      lighting: 'OneSideDataNormal',
      optimizeMarkerTransparency: true,
    },
    layerType: 'Operational',
    showLegends: true,
    visibility: true,
    displayCacheType: 'Permanent',
    maxDisplayCacheAge: 5,
    showPopups: true,
    serviceLayerID: -1,
    refreshRate: -1,
    refreshRateUnit: 'esriTimeUnitsSeconds',
    blendingMode: 'Alpha',
    allowDrapingOnIntegratedMesh: true,
    autoGenerateFeatureTemplates: true,
    featureElevationExpression: 'Shape.Z',
    featureTable: {
      type: 'CIMFeatureTable',
      displayField: opts.displayField,
      editable: true,
      dataConnection: {
        type: 'CIMStandardDataConnection',
        workspaceConnectionString: `DATABASE=.\\${opts.folderRel}`,
        workspaceFactory: 'Shapefile',
        dataset: opts.dataset,
        datasetType: 'esriDTFeatureClass',
      },
      studyAreaSpatialRel: 'esriSpatialRelUndefined',
      searchOrder: 'esriSearchOrderSpatial',
    },
    htmlPopupEnabled: true,
    selectable: true,
    featureCacheType: 'Session',
    displayFiltersType: 'ByScale',
    featureBlendingMode: 'Alpha',
    layerEffectsMode: 'Layer',
    labelClasses: opts.labelClasses || defaultClasses,
    labelVisibility: opts.showLabels === false ? 'None' : 'All',
    renderer: opts.renderer,
    scaleSymbols: true,
    snappable: true,
  };
}

function buildLandmarkLayerDef(opts: {
  uri: string;
  name: string;
  folderRel: string;
  dataset: string;
}) {
  return buildFeatureLayerDef({
    uri: opts.uri,
    name: opts.name,
    folderRel: opts.folderRel,
    dataset: opts.dataset,
    displayField: 'LABEL',
    labelField: 'LABEL',
    geomType: 'Point',
    renderer: {
      type: 'CIMSimpleRenderer',
      sampleSize: 10000,
      patch: 'Default',
      symbol: {
        type: 'CIMSymbolReference',
        symbol: {
          type: 'CIMPointSymbol',
          symbolLayers: [
            {
              type: 'CIMVectorMarker',
              enable: true,
              anchorPoint: { x: 0, y: 0 },
              anchorPointUnits: 'Relative',
              dominantSizeAxis3D: 'Z',
              size: 1,
              billboardMode3D: 'FaceNearPlane',
              frame: { xmin: -0.5, ymin: -0.5, xmax: 0.5, ymax: 0.5 },
              markerGraphics: [
                {
                  type: 'CIMMarkerGraphic',
                  geometry: { rings: [circleRing(0.5, 8)] },
                  symbol: {
                    type: 'CIMPolygonSymbol',
                    symbolLayers: [
                      {
                        type: 'CIMSolidFill',
                        enable: true,
                        color: rgbColor(180, 83, 9, 0),
                      },
                    ],
                    angleAlignment: 'Map',
                  },
                },
              ],
              scaleSymbolsProportionally: true,
              respectFrame: true,
            },
          ],
          haloSize: 0,
          scaleX: 1,
          angleAlignment: 'Display',
        },
      },
    },
    labelClasses: [
      makeMaplexLabelClass({
        name: 'STP Outfall',
        labelField: 'LABEL',
        geomType: 'Point',
        whereClause: "FEAT_TYPE = 'Landmark' AND REF_NODE = 'WC-27'",
        neverRemove: true,
        textSymbol: makeTextSymbol(9.2, [30, 58, 138], true, 'Center', false, {
          callout: {
            fill: [239, 246, 255, 96],
            stroke: [29, 78, 216, 100],
            strokeW: 1.5,
            padH: 7,
            padV: 3.5,
          },
        }),
      }),
      makeMaplexLabelClass({
        name: 'Landmarks',
        labelField: 'LABEL',
        geomType: 'Point',
        whereClause: "FEAT_TYPE = 'Landmark' AND REF_NODE <> 'WC-27'",
        neverRemove: true,
        textSymbol: makeTextSymbol(9.0, [15, 23, 42], true, 'Center', false, {
          callout: {
            fill: [255, 251, 235, 96],
            stroke: [180, 83, 9, 100],
            strokeW: 1.3,
            padH: 6,
            padV: 3.5,
          },
        }),
      }),
      makeMaplexLabelClass({
        name: 'DNCC Zones',
        labelField: 'LABEL',
        geomType: 'Point',
        whereClause: "FEAT_TYPE = 'Zone' AND REF_NODE LIKE 'ZONE-DNCC%'",
        neverRemove: true,
        textSymbol: makeTextSymbol(9.5, [120, 53, 15], true, 'Center', false, {
          callout: {
            fill: [254, 243, 199, 96],
            stroke: [180, 83, 9, 100],
            strokeW: 1.6,
            padH: 8,
            padV: 4,
          },
        }),
      }),
      makeMaplexLabelClass({
        name: 'DSCC Zones',
        labelField: 'LABEL',
        geomType: 'Point',
        whereClause: "FEAT_TYPE = 'Zone' AND REF_NODE NOT LIKE 'ZONE-DNCC%'",
        neverRemove: true,
        textSymbol: makeTextSymbol(9.5, [30, 58, 138], true, 'Center', false, {
          callout: {
            fill: [224, 231, 255, 96],
            stroke: [30, 64, 175, 100],
            strokeW: 1.6,
            padH: 8,
            padV: 4,
          },
        }),
      }),
    ],
  });
}

function buildBasemapReferenceLayer(uri: string) {
  return {
    type: 'CIMTiledServiceLayer',
    name: 'World Light Gray Reference',
    uRI: uri,
    useSourceMetadata: true,
    description: 'World Light Gray Reference (Roads & Place Labels)',
    layerElevation: { type: 'CIMLayerElevationSurface' },
    layerType: 'BasemapReference',
    showLegends: false,
    visibility: true,
    displayCacheType: 'Permanent',
    maxDisplayCacheAge: 5,
    showPopups: false,
    serviceLayerID: -1,
    refreshRate: -1,
    refreshRateUnit: 'esriTimeUnitsSeconds',
    blendingMode: 'Alpha',
    allowDrapingOnIntegratedMesh: true,
    serviceConnection: {
      type: 'CIMAGSServiceConnection',
      description: 'BaseMapReference',
      objectName: 'Canvas/World_Light_Gray_Reference',
      objectType: 'MapServer',
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer',
      serverConnection: {
        type: 'CIMInternetServerConnection',
        anonymous: true,
        hideUserProperty: true,
        url: 'https://services.arcgisonline.com/ArcGIS/services',
      },
    },
    transparentColor: rgbColor(0, 0, 0, 100),
    backgroundColor: rgbColor(255, 255, 255, 0),
  };
}

function buildBasemapLayer(uri: string) {
  return {
    type: 'CIMTiledServiceLayer',
    name: 'World Light Gray Base',
    uRI: uri,
    useSourceMetadata: true,
    description: 'World Light Gray Base',
    layerElevation: { type: 'CIMLayerElevationSurface' },
    layerType: 'BasemapBackground',
    showLegends: true,
    visibility: true,
    displayCacheType: 'Permanent',
    maxDisplayCacheAge: 5,
    showPopups: true,
    serviceLayerID: -1,
    refreshRate: -1,
    refreshRateUnit: 'esriTimeUnitsSeconds',
    blendingMode: 'Alpha',
    allowDrapingOnIntegratedMesh: true,
    serviceConnection: {
      type: 'CIMAGSServiceConnection',
      description: 'BaseMap',
      objectName: 'Canvas/World_Light_Gray_Base',
      objectType: 'MapServer',
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer',
      serverConnection: {
        type: 'CIMInternetServerConnection',
        anonymous: true,
        hideUserProperty: true,
        url: 'https://services.arcgisonline.com/ArcGIS/services',
      },
    },
    transparentColor: rgbColor(0, 0, 0, 100),
    backgroundColor: rgbColor(241, 245, 249, 100),
  };
}

function buildMapDef(opts: {
  name: string;
  uri: string;
  layerUris: string[];
  groundUri: string;
  extent: { xmin: number; ymin: number; xmax: number; ymax: number };
}) {
  const sr = {
    wkid: 102100,
    latestWkid: 3857,
    xyTolerance: 0.001,
    zTolerance: 0.001,
    mTolerance: 0.001,
    falseX: -20037700,
    falseY: -30241100,
    xyUnits: 10000,
    falseZ: -100000,
    zUnits: 10000,
    falseM: -100000,
    mUnits: 10000,
  };
  return {
    type: 'CIMMap',
    name: opts.name,
    uRI: opts.uri,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    illumination: {
      type: 'CIMIlluminationProperties',
      ambientLight: 50,
      sunPositionX: -0.61237243569579,
      sunPositionY: 0.61237243569579,
      sunPositionZ: 0.5,
      illuminationSource: 'AbsoluteSunPosition',
      sunAzimuth: 315,
      sunAltitude: 30,
      showStars: true,
      enableAmbientOcclusion: true,
      enableEyeDomeLighting: true,
    },
    layers: opts.layerUris,
    defaultViewingMode: 'Map',
    mapType: 'Map',
    groundElevationSurfaceLayer: opts.groundUri,
    defaultColorVisionDeficiencyMode: 'None',
    defaultExtent: {
      ...opts.extent,
      spatialReference: sr,
    },
    generalPlacementProperties: {
      type: 'CIMMaplexGeneralPlacementProperties',
      invertedLabelTolerance: 2,
      unplacedLabelColor: rgbColor(255, 0, 0, 100),
      keyNumberGroups: [
        {
          type: 'CIMMaplexKeyNumberGroup',
          delimiterCharacter: '.',
          horizontalAlignment: 'Left',
          maximumNumberOfLines: 20,
          minimumNumberOfLines: 2,
          name: 'Default',
          numberResetType: 'None',
          keyNumberMethod: 'PreventUnplacedLabels',
        },
      ],
      placementQuality: 'High',
    },
    snappingProperties: {
      type: 'CIMSnappingProperties',
      xYTolerance: 10,
      xYToleranceUnit: 'SnapXYToleranceUnitPixel',
      snapToSketchEnabled: true,
      snapRequestType: 'SnapRequestType_GeometricAndVisualSnapping',
      isZSnappingEnabled: true,
      snapTipDisplayParts: 3,
    },
    spatialReference: sr,
    timeDisplay: {
      type: 'CIMMapTimeDisplay',
      defaultTimeIntervalUnits: 'esriTimeUnitsUnknown',
      timeValue: { type: 'TimeExtent', start: null, end: null, empty: false },
      timeRelation: 'esriTimeRelationOverlaps',
    },
    colorModel: 'RGB',
    scaleDisplayFormat: 'Value',
    clippingMode: 'None',
    nearPlaneClipDistanceMode: 'Automatic',
    rGBColorProfile: 'sRGB IEC61966-2.1',
    cMYKColorProfile: 'U.S. Web Coated (SWOP) v2',
    autoFillFeatureCache: true,
    useMasking: true,
  };
}

function rectRing(x0: number, y0: number, x1: number, y1: number) {
  return [[[x0, y1], [x1, y1], [x1, y0], [x0, y0], [x0, y1]]];
}

function roundedRectRing(x0: number, y0: number, x1: number, y1: number, r = 2.5) {
  const rr = Math.min(r, (x1 - x0) / 3, (y1 - y0) / 3);
  if (rr <= 0.1) return rectRing(x0, y0, x1, y1);
  const k = rr * 0.55;
  const pts: number[][] = [
    [x0 + rr, y1],
    [x1 - rr, y1],
    [x1 - rr + k, y1],
    [x1, y1 - rr + k],
    [x1, y1 - rr],
    [x1, y0 + rr],
    [x1, y0 + rr - k],
    [x1 - rr + k, y0],
    [x1 - rr, y0],
    [x0 + rr, y0],
    [x0 + rr - k, y0],
    [x0, y0 + rr - k],
    [x0, y0 + rr],
    [x0, y1 - rr],
    [x0, y1 - rr + k],
    [x0 + rr - k, y1],
    [x0 + rr, y1],
  ];
  return [pts];
}

function makeMapFrameElement(opts: {
  name: string;
  mapUri: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pts: Array<{ lat: number; lon: number }>;
  padFrac?: number;
}) {
  const cam = computeMercatorCamera(
    opts.pts,
    opts.x1 - opts.x0,
    opts.y1 - opts.y0,
    opts.padFrac ?? 0.14
  );
  return {
    cam,
    element: {
      type: 'CIMMapFrame',
      anchor: 'BottomLeftCorner',
      name: opts.name,
      visible: true,
      rotationCenter: { x: opts.x0, y: opts.y0 },
      customProperties: [
        { type: 'CIMStringMap', key: 'SuppressCredits', value: 'true' },
      ],
      expanded: true,
      frame: { rings: rectRing(opts.x0, opts.y0, opts.x1, opts.y1) },
      graphicFrame: {
        type: 'CIMGraphicFrame',
        borderSymbol: {
          type: 'CIMSymbolReference',
          symbol: {
            type: 'CIMLineSymbol',
            symbolLayers: [
              {
                type: 'CIMSolidStroke',
                enable: true,
                capStyle: 'Round',
                joinStyle: 'Miter',
                lineStyle3D: 'Strip',
                miterLimit: 10,
                width: 1.5,
                height3D: 1,
                anchor3D: 'Center',
                color: rgbColor(15, 23, 42, 100),
              },
            ],
          },
        },
        shadowSymbol: {
          type: 'CIMSymbolReference',
          symbol: { type: 'CIMPolygonSymbol', angleAlignment: 'Map' },
        },
        shadowOffsetX: 10,
        shadowOffsetY: -10,
      },
      autoCamera: {
        type: 'CIMAutoCamera',
        autoCameraType: 'Extent',
        marginType: 'Percent',
        source: 'None',
      },
      uRI: opts.mapUri,
      view: {
        type: 'CIMMapView',
        viewableObjectPath: opts.mapUri,
        viewingMode: 'Map',
        camera: {
          type: 'CIMViewCamera',
          pitch: -90,
          scale: cam.scale,
          x: cam.x,
          y: cam.y,
          z: 'NaN',
          viewportHeight: cam.viewportHeight,
          viewportWidth: cam.viewportWidth,
        },
        verticalExaggerationScaleFactor: 1,
        timeDisplay: {
          type: 'CIMMapTimeDisplay',
          defaultTimeIntervalUnits: 'esriTimeUnitsUnknown',
          timeRelation: 'esriTimeRelationOverlaps',
        },
        sceneDrawingMode: 'Perspective',
        fieldOfView: 55,
        pauseAnimatedSymbols: true,
        colorVisionDeficiencyMode: 'None',
      },
      useMapBackgroundColor: true,
      extentIndicatorsExpanded: true,
      mapGridsExpanded: true,
    },
  };
}

function makePolygonGraphicElement(
  name: string,
  rings: number[][][],
  fillRgb: [number, number, number, number],
  strokeRgb?: [number, number, number, number],
  strokeWidth = 0.8
) {
  return {
    type: 'CIMGraphicElement',
    anchor: 'BottomLeftCorner',
    name,
    visible: true,
    rotationCenter: { x: rings[0][0][0], y: rings[0][0][1] },
    graphic: {
      type: 'CIMPolygonGraphic',
      polygon: { rings },
      symbol: solidPolygonSymbol(fillRgb, strokeRgb, strokeWidth),
      name,
    },
  };
}

function makeLineGraphicElement(
  name: string,
  paths: number[][][],
  rgb: [number, number, number],
  widthPt = 1.6
) {
  return {
    type: 'CIMGraphicElement',
    anchor: 'BottomLeftCorner',
    name,
    visible: true,
    rotationCenter: { x: paths[0][0][0], y: paths[0][0][1] },
    graphic: {
      type: 'CIMLineGraphic',
      line: { paths },
      symbol: solidLineSymbol(rgb[0], rgb[1], rgb[2], widthPt),
      name,
    },
  };
}

function makeTextGraphicElement(
  name: string,
  text: string,
  x: number,
  y: number,
  heightPt = 9,
  rgb: [number, number, number] = [15, 23, 42],
  bold = false,
  align: 'Left' | 'Center' | 'Right' = 'Left',
  halo = false,
  angle?: number
) {
  return {
    type: 'CIMGraphicElement',
    anchor: 'BottomLeftCorner',
    name,
    visible: true,
    rotationCenter: { x, y },
    graphic: {
      type: 'CIMTextGraphic',
      text,
      shape: { x, y },
      symbol: makeTextSymbol(heightPt, rgb, bold, align, halo, angle ? { angle } : undefined),
    },
  };
}

function makeCircleGraphicElement(
  name: string,
  cx: number,
  cy: number,
  radius: number,
  fillRgb: [number, number, number, number],
  strokeRgb?: [number, number, number, number],
  strokeW = 0.8
) {
  const ring = circleRing(radius, 20).map(([dx, dy]) => [cx + dx, cy + dy]);
  return makePolygonGraphicElement(name, [ring], fillRgb, strokeRgb, strokeW);
}

function statusToRgb(st: WorkStatus): [number, number, number] {
  if (st === 'complete') return [22, 163, 74];
  if (st === 'ongoing') return [37, 99, 235];
  return [220, 38, 38];
}

function truncStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '...' : s;
}

/**
 * 8-Point Architectural GIS Compass Rose (identical to FullPageGisMaps.tsx / GIS output sample.pdf)
 */
function buildCompassRoseGraphics(
  prefix: string,
  cx: number,
  cy: number,
  r = 16
): Array<Record<string, unknown>> {
  const inner = r * 0.27;
  const out: Array<Record<string, unknown>> = [];
  out.push(
    makeCircleGraphicElement(
      `${prefix}_Halo`,
      cx,
      cy,
      r + 6,
      [255, 255, 255, 92],
      [148, 163, 184, 100],
      0.8
    )
  );
  // N, S, E, W split star arms (bottom-up Y: +r is UP/North!)
  const poly = (nm: string, pts: number[][], fill: [number, number, number, number], sw = 0.6) =>
    makePolygonGraphicElement(
      `${prefix}_${nm}`,
      [[...pts.map(([dx, dy]) => [cx + dx, cy + dy]), [cx + pts[0][0], cy + pts[0][1]]]],
      fill,
      [15, 23, 42, 100],
      sw
    );

  // Secondary NW/NE/SE/SW arms
  const diag = r * 0.56;
  out.push(poly('NE', [[diag, diag], [inner, 0], [0, inner]], [100, 116, 139, 45], 0.4));
  out.push(poly('NW', [[-diag, diag], [0, inner], [-inner, 0]], [100, 116, 139, 45], 0.4));
  out.push(poly('SE', [[diag, -diag], [0, -inner], [inner, 0]], [100, 116, 139, 45], 0.4));
  out.push(poly('SW', [[-diag, -diag], [-inner, 0], [0, -inner]], [100, 116, 139, 45], 0.4));

  // Primary N/S/E/W arms
  out.push(poly('N_L', [[0, r], [0, 0], [-inner, inner]], [15, 23, 42, 100]));
  out.push(poly('N_R', [[0, r], [inner, inner], [0, 0]], [255, 255, 255, 100]));
  out.push(poly('S_R', [[0, -r], [0, 0], [inner, -inner]], [15, 23, 42, 100]));
  out.push(poly('S_L', [[0, -r], [-inner, -inner], [0, 0]], [255, 255, 255, 100]));
  out.push(poly('E_T', [[r, 0], [0, 0], [inner, inner]], [15, 23, 42, 100]));
  out.push(poly('E_B', [[r, 0], [inner, -inner], [0, 0]], [255, 255, 255, 100]));
  out.push(poly('W_B', [[-r, 0], [0, 0], [-inner, -inner]], [15, 23, 42, 100]));
  out.push(poly('W_T', [[-r, 0], [-inner, inner], [0, 0]], [255, 255, 255, 100]));

  out.push(makeTextGraphicElement(`${prefix}_N`, 'N', cx, cy + r + 3.2, 10.5, [15, 23, 42], true, 'Center'));
  out.push(makeTextGraphicElement(`${prefix}_S`, 'S', cx, cy - r - 3.6, 8.0, [51, 65, 85], true, 'Center'));
  out.push(makeTextGraphicElement(`${prefix}_E`, 'E', cx + r + 3.0, cy, 8.0, [51, 65, 85], true, 'Left'));
  out.push(makeTextGraphicElement(`${prefix}_W`, 'W', cx - r - 3.0, cy, 8.0, [51, 65, 85], true, 'Right'));
  return out;
}

/**
 * Clean PDF-style Header Banner (white/slate bar with colored WA/WB/WC badge, Sheet No, DSIP Title & Status Pill)
 */
function buildPdfStyleHeaderGraphics(opts: {
  prefix: string;
  pageW: number;
  pageH: number;
  sectionCode: string;
  sectionSub: string;
  sectionRgb: [number, number, number];
  sheetNoLabel: string;
  title: string;
  subtitle: string;
  periodText: string;
  clientLine: string;
  isCompareMode: boolean;
}): Array<Record<string, unknown>> {
  const { pageW, pageH } = opts;
  const headerTop = pageH - 7;
  const headerBot = pageH - 35;
  const out: Array<Record<string, unknown>> = [];

  // Crisp Outer Sheet Border (6mm margin)
  out.push(
    makePolygonGraphicElement(
      `${opts.prefix}_Outer_Border`,
      rectRing(6, 6, pageW - 6, pageH - 6),
      [255, 255, 255, 0],
      [15, 23, 42, 100],
      1.3
    )
  );
  // Subtle #f8fafc Header Banner Background
  out.push(
    makePolygonGraphicElement(
      `${opts.prefix}_Header_Bg`,
      rectRing(8, headerBot, pageW - 8, headerTop),
      [248, 250, 252, 100],
      [203, 213, 225, 100],
      0.7
    )
  );

  // Bold Colored Left Section Badge (e.g. WA / Section)
  out.push(
    makePolygonGraphicElement(
      `${opts.prefix}_Sec_Badge`,
      roundedRectRing(11, headerBot + 1.5, 62, headerTop - 1.5, 3),
      [opts.sectionRgb[0], opts.sectionRgb[1], opts.sectionRgb[2], 100],
      [opts.sectionRgb[0], opts.sectionRgb[1], opts.sectionRgb[2], 100],
      0.6
    )
  );
  out.push(
    makeTextGraphicElement(
      `${opts.prefix}_Sec_Code`,
      opts.sectionCode,
      36.5,
      headerTop - 10.5,
      opts.sectionCode.length > 2 ? 16 : 22,
      [255, 255, 255],
      true,
      'Center'
    )
  );
  out.push(
    makeTextGraphicElement(
      `${opts.prefix}_Sec_Sub`,
      opts.sectionSub,
      36.5,
      headerBot + 5.5,
      8.5,
      [241, 245, 249],
      true,
      'Center'
    )
  );

  // Sheet N of 5 Label
  out.push(
    makeTextGraphicElement(
      `${opts.prefix}_Sheet_No`,
      opts.sheetNoLabel,
      68,
      (headerTop + headerBot) / 2,
      10.5,
      opts.sectionRgb,
      true,
      'Left'
    )
  );

  // Centered Bold Map Title & DSIP Subtitle
  const titleCenterX = pageW > 700 ? pageW * 0.48 : pageW * 0.47;
  out.push(
    makeTextGraphicElement(
      `${opts.prefix}_Title_Main`,
      opts.title,
      titleCenterX,
      headerTop - 9.5,
      pageW > 700 ? 14.5 : 13.0,
      [15, 23, 42],
      true,
      'Center'
    )
  );
  out.push(
    makeTextGraphicElement(
      `${opts.prefix}_Title_Sub`,
      opts.subtitle,
      titleCenterX,
      headerBot + 7.5,
      8.5,
      [51, 65, 85],
      false,
      'Center'
    )
  );

  // Right Status Pill Box (Overall vs Weekly/Monthly)
  const pillX0 = pageW - 148;
  const pillX1 = pageW - 11;
  const pillY0 = headerBot + 4;
  const pillY1 = headerTop - 4;
  out.push(
    makePolygonGraphicElement(
      `${opts.prefix}_Status_Pill`,
      roundedRectRing(pillX0, pillY0, pillX1, pillY1, 2),
      opts.isCompareMode ? [255, 247, 237, 100] : [240, 253, 244, 100],
      opts.isCompareMode ? [234, 88, 12, 100] : [22, 163, 74, 100],
      1.0
    )
  );
  out.push(
    makeTextGraphicElement(
      `${opts.prefix}_Status_Top`,
      truncStr(opts.periodText, 38),
      (pillX0 + pillX1) / 2,
      pillY1 - 6.8,
      7.2,
      [15, 23, 42],
      true,
      'Center'
    )
  );
  out.push(
    makeTextGraphicElement(
      `${opts.prefix}_Status_Bot`,
      truncStr(opts.clientLine, 44),
      (pillX0 + pillX1) / 2,
      pillY0 + 6.2,
      6.4,
      [71, 85, 105],
      false,
      'Center'
    )
  );

  return out;
}

/**
 * Double Map Frame Neatline + Exact Lat/Lon Graticule Ticks & DMS Coordinate Labels
 */
function buildFrameNeatlineAndGraticule(
  prefix: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cam: MercatorCameraResult,
  showSideLabels = true
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  // Outer hairline border (+2mm around MapFrame)
  out.push(
    makePolygonGraphicElement(
      `${prefix}_Outer_Neatline`,
      rectRing(x0 - 2, y0 - 2, x1 + 2, y1 + 2),
      [255, 255, 255, 0],
      [51, 65, 85, 100],
      0.7
    )
  );

  const xmin = cam.x - cam.viewportWidth / 2;
  const xmax = cam.x + cam.viewportWidth / 2;
  const ymin = cam.y - cam.viewportHeight / 2;
  const ymax = cam.y + cam.viewportHeight / 2;

  const lonFracs = [0.16, 0.5, 0.84];
  const latFracs = [0.15, 0.39, 0.63, 0.87];

  lonFracs.forEach((f, idx) => {
    const px = x0 + (x1 - x0) * f;
    const mx = xmin + (xmax - xmin) * f;
    const { lon } = webMercatorToLonLat(mx, cam.y);
    const lbl = formatDms(lon, 'E', 'W');
    out.push(makeLineGraphicElement(`${prefix}_LonTop_${idx}`, [[[px, y1], [px, y1 + 2.5]]], [30, 41, 59], 0.9));
    out.push(makeLineGraphicElement(`${prefix}_LonBot_${idx}`, [[[px, y0 - 2.5], [px, y0]]], [30, 41, 59], 0.9));
    out.push(makeTextGraphicElement(`${prefix}_LonLbl_${idx}`, lbl, px, y0 - 6.0, 7.6, [51, 65, 85], true, 'Center'));
  });

  latFracs.forEach((f, idx) => {
    const py = y0 + (y1 - y0) * f;
    const my = ymin + (ymax - ymin) * f;
    const { lat } = webMercatorToLonLat(cam.x, my);
    const lbl = formatDms(lat, 'N', 'S');
    out.push(makeLineGraphicElement(`${prefix}_LatL_${idx}`, [[[x0 - 2.5, py], [x0, py]]], [30, 41, 59], 0.9));
    out.push(makeLineGraphicElement(`${prefix}_LatR_${idx}`, [[[x1, py], [x1 + 2.5, py]]], [30, 41, 59], 0.9));
    if (showSideLabels) {
      out.push(makeTextGraphicElement(`${prefix}_LatLblL_${idx}`, lbl, x0 - 6.2, py, 7.6, [51, 65, 85], true, 'Center', false, 90));
      out.push(makeTextGraphicElement(`${prefix}_LatLblR_${idx}`, lbl, x1 + 6.2, py, 7.6, [51, 65, 85], true, 'Center', false, -90));
    }
  });

  return out;
}

/**
 * Clean Alternating Black/White Kilometers Scale Bar + Esri Source Card (PDF bottom-right style)
 */
function buildScaleBarCardGraphics(
  prefix: string,
  rightX: number,
  botY: number,
  cam: MercatorCameraResult,
  compact = false
): Array<Record<string, unknown>> {
  const cosLat = Math.max(0.2, Math.cos((cam.meanLat * Math.PI) / 180));
  // 1 mm on layout = (cam.scale / 1000) Mercator meters = (cam.scale / 1000) * cosLat true ground meters
  const groundMPerMm = (cam.scale / 1000) * cosLat;
  const targetWidthMm = compact ? 48 : 96;
  const candidatesKm = [0.1, 0.2, 0.25, 0.4, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0];

  let chosenKm = 0.5;
  let bestDiff = Infinity;
  for (const c of candidatesKm) {
    const mm = (c * 1000) / groundMPerMm;
    const diff = Math.abs(mm - targetWidthMm);
    if (mm >= (compact ? 24 : 56) && mm <= (compact ? 78 : 144) && diff < bestDiff) {
      bestDiff = diff;
      chosenKm = c;
    }
  }
  const barW = Math.min(compact ? 78 : 146, Math.max(compact ? 24 : 56, (chosenKm * 1000) / groundMPerMm));
  const qW = barW / 4;

  const cardW = Math.max(barW + (compact ? 38 : 48), compact ? 104 : 172);
  const cardH = compact ? 15 : 22;
  const cx = rightX - cardW;
  const cy = botY;
  const barX = cx + (compact ? 6 : 8);
  const barY = cy + (compact ? 5.5 : 8.5);
  const barH = compact ? 2.4 : 3.5;

  const out: Array<Record<string, unknown>> = [];
  out.push(
    makePolygonGraphicElement(
      `${prefix}_Card`,
      roundedRectRing(cx, cy, cx + cardW, cy + cardH, 1.5),
      [255, 255, 255, 95],
      [100, 116, 139, 100],
      0.85
    )
  );
  const ticks = [
    { frac: 0, lbl: '0' },
    { frac: 0.25, lbl: `${(chosenKm * 0.25).toFixed(3).replace(/\.?0+$/, '')}` },
    { frac: 0.5, lbl: `${(chosenKm * 0.5).toFixed(3).replace(/\.?0+$/, '')}` },
    { frac: 1, lbl: `${chosenKm.toFixed(3).replace(/\.?0+$/, '')}` },
  ];
  ticks.forEach((t, idx) => {
    out.push(
      makeTextGraphicElement(
        `${prefix}_Tick_${idx}`,
        t.lbl,
        barX + barW * t.frac,
        barY + barH + (compact ? 2.6 : 3.8),
        compact ? 6.2 : 8.0,
        [15, 23, 42],
        true,
        'Center'
      )
    );
  });
  out.push(
    makeTextGraphicElement(
      `${prefix}_Unit`,
      'Kilometers',
      barX + barW + 3,
      barY + barH / 2,
      compact ? 6.0 : 8.0,
      [15, 23, 42],
      true,
      'Left'
    )
  );

  // Alternating Black / White Bar Segments
  out.push(makePolygonGraphicElement(`${prefix}_Seg1`, rectRing(barX, barY, barX + qW, barY + barH), [15, 23, 42, 100], [15, 23, 42, 100], 0.7));
  out.push(makePolygonGraphicElement(`${prefix}_Seg2`, rectRing(barX + qW, barY, barX + qW * 2, barY + barH), [255, 255, 255, 100], [15, 23, 42, 100], 0.7));
  out.push(makePolygonGraphicElement(`${prefix}_Seg3`, rectRing(barX + qW * 2, barY, barX + barW, barY + barH), [15, 23, 42, 100], [15, 23, 42, 100], 0.7));

  if (!compact) {
    out.push(
      makeTextGraphicElement(
        `${prefix}_Attr`,
        'Sources: Esri, TomTom, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors',
        barX,
        cy + 3.2,
        6.0,
        [71, 85, 105],
        false,
        'Left'
      )
    );
  }
  return out;
}

/**
 * Full Portrait Legend Card matching GIS output sample.pdf (`Legend — WA / WB / WC Section Progress`)
 */
function buildPortraitLegendCard(
  kind: 'wa' | 'wb' | 'wc',
  state: AppState,
  x0: number,
  y0: number
): Array<Record<string, unknown>> {
  const { settings, viewMode } = state;
  const ctx = resolveDisplayContext(state);
  const waSummary = computeSummary(
    ctx.displayShafts,
    ctx.baseline,
    ctx.displayPump,
    undefined,
    settings.waTunnelDiaTotalsM
  );
  const wcSummary = computeSummary(
    ctx.displayWc.shafts,
    ctx.baseline,
    undefined,
    ctx.baseline.wcShafts
  );
  const wb = ctx.displayWb;
  const pump = ctx.displayPump;
  const wbRemM = Math.max(0, wb.totalLengthM - wb.completedLengthM);
  const wbPct = wb.totalLengthM > 0 ? (wb.completedLengthM / wb.totalLengthM) * 100 : 0;

  const out: Array<Record<string, unknown>> = [];

  if (kind === 'wb') {
    const W = 166;
    const H = 172;
    const topY = y0 + H;
    // Shadow + Card
    out.push(makePolygonGraphicElement('Leg_Shadow', roundedRectRing(x0 + 1.2, y0 - 1.5, x0 + W + 1.2, topY - 1.5, 2.5), [15, 23, 42, 12], undefined, 0));
    out.push(makePolygonGraphicElement('Leg_Card', roundedRectRing(x0, y0, x0 + W, topY, 2.5), [255, 255, 255, 96], [30, 41, 59, 100], 1.1));
    out.push(makePolygonGraphicElement('Leg_Hdr', roundedRectRing(x0, topY - 15, x0 + W, topY, 2.5), [239, 246, 255, 100], [30, 41, 59, 100], 0.9));
    out.push(makeTextGraphicElement('Leg_Title', 'Legend — WB Section Progress', x0 + 7, topY - 7.5, 12.0, [15, 23, 42], true, 'Left'));

    out.push(makeTextGraphicElement('Leg_Sec1', 'WB Progress Status', x0 + 7, topY - 24, 9.5, [30, 58, 138], true, 'Left'));
    const statRows: Array<{ label: string; rgb: [number, number, number]; dy: number }> = [
      { label: 'Complete', rgb: [22, 163, 74], dy: 34 },
      { label: 'On-Going', rgb: [37, 99, 235], dy: 44 },
      { label: 'Remaining', rgb: [220, 38, 38], dy: 54 },
    ];
    statRows.forEach((r) => {
      const sy = topY - r.dy;
      out.push(makePolygonGraphicElement(`Leg_Sq_${r.label}`, rectRing(x0 + 8, sy - 3.5, x0 + 15, sy + 3.5), [255, 255, 255, 100], [...r.rgb, 100], 1.6));
      out.push(makeCircleGraphicElement(`Leg_Dot_${r.label}`, x0 + 11.5, sy, 1.5, [...r.rgb, 100]));
      out.push(makeTextGraphicElement(`Leg_Txt_${r.label}`, r.label, x0 + 20, sy, 9.0, [15, 23, 42], false, 'Left'));
    });

    out.push(makeLineGraphicElement('Leg_Div1', [[[x0 + 6, topY - 64], [x0 + W - 6, topY - 64]]], [203, 213, 225], 0.8));

    out.push(makeLineGraphicElement('Leg_LineC', [[[x0 + 8, topY - 74], [x0 + 24, topY - 74]]], [22, 163, 74], 4.2));
    out.push(makeTextGraphicElement('Leg_LineC_T', `WB Complete = ${wb.completedLengthM.toFixed(1)} m (${wbPct.toFixed(1)}%)`, x0 + 29, topY - 74, 8.8, [21, 128, 61], true, 'Left'));

    out.push(makeLineGraphicElement('Leg_LineR', [[[x0 + 8, topY - 85], [x0 + 24, topY - 85]]], [220, 38, 38], 4.2));
    out.push(makeTextGraphicElement('Leg_LineR_T', `WB Remaining = ${wbRemM.toFixed(1)} m`, x0 + 29, topY - 85, 8.8, [220, 38, 38], true, 'Left'));

    out.push(makeCircleGraphicElement('Leg_Tip', x0 + 16, topY - 96, 2.7, [37, 99, 235, 100], [255, 255, 255, 100], 0.9));
    out.push(makeTextGraphicElement('Leg_Tip_T', 'Completion Tip Marker', x0 + 29, topY - 96, 8.6, [30, 58, 138], false, 'Left'));

    if (viewMode !== 'overall') {
      const prevM = ctx.baseline.wbCompletedLengthM ?? wb.completedLengthM;
      out.push(makeLineGraphicElement('Leg_LineN', [[[x0 + 8, topY - 106], [x0 + 24, topY - 106]]], [249, 115, 22], 4.5));
      out.push(makeTextGraphicElement('Leg_LineN_T', `Added (${ctx.file2Label}): +${Math.max(0, wb.completedLengthM - prevM).toFixed(1)} m`, x0 + 29, topY - 106, 7.6, [234, 88, 12], true, 'Left'));
    }

    out.push(makeLineGraphicElement('Leg_Div2', [[[x0 + 6, topY - 116], [x0 + W - 6, topY - 116]]], [203, 213, 225], 0.8));
    out.push(makeTextGraphicElement('Leg_TotL', `WB Total Pipe Length = ${(wb.totalLengthM / 1000).toFixed(3)} km (${wb.totalLengthM} m)`, x0 + 7, topY - 125, 9.0, [15, 23, 42], true, 'Left'));
    out.push(makeTextGraphicElement('Leg_Spec', `Specification: ${wb.method} ${wb.pipeDia}`, x0 + 7, topY - 134, 8.2, [51, 65, 85], false, 'Left'));

    out.push(makeLineGraphicElement('Leg_Div3', [[[x0 + 6, topY - 141], [x0 + W - 6, topY - 141]]], [203, 213, 225], 0.8));
    out.push(makeTextGraphicElement('Leg_App_H', 'Appurtenances & Reference Points:', x0 + 7, topY - 149, 8.6, [30, 58, 138], true, 'Left'));

    out.push(makePolygonGraphicElement('Leg_SPS_Sw', rectRing(x0 + 8, topY - 160, x0 + 15, topY - 154), [251, 207, 232, 100], [157, 23, 77, 100], 1.2));
    out.push(makeTextGraphicElement('Leg_SPS_T', 'Golapbag SPS', x0 + 18, topY - 157, 8.0, [131, 24, 67], true, 'Left'));

    out.push(makeCircleGraphicElement('Leg_WO_Sw', x0 + 65, topY - 157, 3.6, [187, 247, 208, 100], [21, 128, 61, 100], 1.0));
    out.push(makePolygonGraphicElement('Leg_WO_Tri', [[[x0 + 65, topY - 155.0], [x0 + 66.8, topY - 158.6], [x0 + 63.2, topY - 158.6], [x0 + 65, topY - 155.0]]], [22, 163, 74, 100], [21, 128, 61, 100], 0.4));
    out.push(makeTextGraphicElement('Leg_WO_T', 'Washout', x0 + 71, topY - 157, 8.0, [20, 83, 45], true, 'Left'));

    out.push(makeCircleGraphicElement('Leg_AV_Sw', x0 + 104, topY - 157, 3.6, [186, 230, 253, 100], [3, 105, 161, 100], 1.0));
    out.push(makePolygonGraphicElement('Leg_AV_Tri', [[[x0 + 104, topY - 155.0], [x0 + 105.8, topY - 158.6], [x0 + 102.2, topY - 158.6], [x0 + 104, topY - 155.0]]], [2, 132, 199, 100], [3, 105, 161, 100], 0.4));
    out.push(makeTextGraphicElement('Leg_AV_T', 'Air Valve', x0 + 110, topY - 157, 8.0, [12, 74, 110], true, 'Left'));

    out.push(makeTextGraphicElement('Leg_EndJ', 'End Junction: Doyagonj Chowrasta (WD2 / WD3 / WC-1)', x0 + 8, y0 + 5.5, 7.6, [107, 33, 168], true, 'Left'));
    return out;
  }

  // WA or WC Portrait Legend Card
  const W = 180;
  const H = 240;
  const topY = y0 + H;
  const isWa = kind === 'wa';
  const sum = isWa ? waSummary : wcSummary;
  const secTag = isWa ? '' : 'WC ';

  out.push(makePolygonGraphicElement('Leg_Shadow', roundedRectRing(x0 + 1.2, y0 - 1.5, x0 + W + 1.2, topY - 1.5, 2.5), [15, 23, 42, 12], undefined, 0));
  out.push(makePolygonGraphicElement('Leg_Card', roundedRectRing(x0, y0, x0 + W, topY, 2.5), [255, 255, 255, 96], [30, 41, 59, 100], 1.1));
  out.push(makePolygonGraphicElement('Leg_Hdr', roundedRectRing(x0, topY - 15, x0 + W, topY, 2.5), [239, 246, 255, 100], [30, 41, 59, 100], 0.9));
  out.push(makeTextGraphicElement('Leg_Title', `Legend — ${isWa ? 'WA' : 'WC'} Section Progress`, x0 + 7, topY - 7.5, 12.2, [15, 23, 42], true, 'Left'));

  // Shaft Status
  out.push(makeTextGraphicElement('Leg_Sh_H', `${secTag}Shaft Status (${sum.totalShafts} Shafts)`, x0 + 7, topY - 24, 9.5, [30, 58, 138], true, 'Left'));
  [
    { label: `Complete (${sum.completedShafts})`, rgb: [22, 163, 74] as [number, number, number], dy: 33 },
    { label: `On-Going (${sum.ongoingShafts})`, rgb: [37, 99, 235] as [number, number, number], dy: 43 },
    { label: `Remaining (${sum.remainingShafts})`, rgb: [220, 38, 38] as [number, number, number], dy: 53 },
  ].forEach((r) => {
    const sy = topY - r.dy;
    out.push(makePolygonGraphicElement(`Leg_Sh_${r.label}`, rectRing(x0 + 8, sy - 3.3, x0 + 14.6, sy + 3.3), [255, 255, 255, 100], [...r.rgb, 100], 1.6));
    out.push(makeTextGraphicElement(`Leg_ShT_${r.label}`, r.label, x0 + 20, sy, 8.8, [15, 23, 42], false, 'Left'));
  });

  // Manhole Status
  out.push(makeTextGraphicElement('Leg_Mh_H', `${secTag}Manhole Status (${sum.totalManholes} Nos)`, x0 + 7, topY - 68, 9.5, [30, 58, 138], true, 'Left'));
  const mhCastOng = Math.max(0, sum.castingCompleteCount + sum.castingOngoingCount - sum.completedManholes);
  [
    { label: `Complete — Cast & Ring 100% (${sum.completedManholes})`, rgb: [22, 163, 74] as [number, number, number], dy: 77 },
    { label: `Cast Done / On-Going (${mhCastOng})`, rgb: [37, 99, 235] as [number, number, number], dy: 87 },
    { label: `Remaining (${sum.castingRemainingCount})`, rgb: [220, 38, 38] as [number, number, number], dy: 97 },
  ].forEach((r) => {
    const sy = topY - r.dy;
    out.push(makeCircleGraphicElement(`Leg_Mh_${r.label}`, x0 + 11.3, sy, 2.7, [...r.rgb, 100], [255, 255, 255, 100], 0.6));
    out.push(makeTextGraphicElement(`Leg_MhT_${r.label}`, r.label, x0 + 20, sy, 8.4, [15, 23, 42], false, 'Left'));
  });
  out.push(makeTextGraphicElement('Leg_Cast_Line', `Cast: ${sum.castingCompleteCount} Done | ${sum.castingOngoingCount} Ong | ${sum.castingRemainingCount} Rem`, x0 + 8, topY - 107, 7.8, [29, 78, 216], true, 'Left'));
  out.push(makeTextGraphicElement('Leg_Ring_Line', `Ring: ${sum.precastCompleteCount} Done | ${sum.precastOngoingCount} Ong | ${sum.precastRemainingCount} Rem`, x0 + 8, topY - 115, 7.8, [2, 132, 199], true, 'Left'));

  // Micro-Tunneling Status
  out.push(makeTextGraphicElement('Leg_Tun_H', `${secTag}Micro-Tunneling Status`, x0 + 7, topY - 127, 9.5, [30, 58, 138], true, 'Left'));
  [
    { label: 'Complete', rgb: [22, 163, 74] as [number, number, number], dy: 136 },
    { label: 'On-Going', rgb: [37, 99, 235] as [number, number, number], dy: 145 },
    { label: 'Remaining', rgb: [220, 38, 38] as [number, number, number], dy: 154 },
  ].forEach((r) => {
    const sy = topY - r.dy;
    out.push(makeLineGraphicElement(`Leg_Tun_${r.label}`, [[[x0 + 8, sy], [x0 + 22, sy]]], r.rgb, 3.8));
    out.push(makeTextGraphicElement(`Leg_TunT_${r.label}`, r.label, x0 + 27, sy, 8.6, [15, 23, 42], false, 'Left'));
  });

  if (isWa) {
    out.push(makePolygonGraphicElement('Leg_SPS_Sw', rectRing(x0 + 102, topY - 140, x0 + 110, topY - 132), [251, 207, 232, 100], [157, 23, 77, 100], 1.4));
    out.push(makeTextGraphicElement('Leg_SPS_T', 'Golapbag SPS', x0 + 113, topY - 136, 8.5, [131, 24, 67], true, 'Left'));
  } else {
    out.push(makePolygonGraphicElement('Leg_STP_Sw', rectRing(x0 + 102, topY - 140, x0 + 110, topY - 133), [219, 234, 254, 100], [30, 58, 138, 100], 1.3));
    out.push(makeTextGraphicElement('Leg_STP_T', 'Pagla STP', x0 + 113, topY - 136.5, 8.3, [30, 58, 138], true, 'Left'));
    out.push(makePolygonGraphicElement('Leg_Siph_Sw', rectRing(x0 + 102, topY - 149, x0 + 110, topY - 144), [30, 41, 59, 30], [15, 23, 42, 100], 1.0));
    out.push(makeTextGraphicElement('Leg_Siph_T', 'Underpass / Siphon', x0 + 113, topY - 146.5, 8.0, [15, 23, 42], true, 'Left'));
  }

  out.push(makeLineGraphicElement('Leg_Div', [[[x0 + 6, topY - 163], [x0 + W - 6, topY - 163]]], [203, 213, 225], 0.8));
  out.push(makeTextGraphicElement('Leg_TotL_L', 'TOTAL LENGTH', x0 + 7, topY - 172, 9.0, [15, 23, 42], true, 'Left'));
  out.push(makeTextGraphicElement('Leg_TotL_R', `: ${(sum.totalTunnelLengthM / 1000).toFixed(3)} km`, x0 + W - 7, topY - 172, 9.0, [15, 23, 42], true, 'Right'));
  out.push(makeTextGraphicElement('Leg_ComL_L', 'COMPLETED LENGTH', x0 + 7, topY - 181, 9.0, [21, 128, 61], true, 'Left'));
  out.push(makeTextGraphicElement('Leg_ComL_R', `: ${(sum.completedTunnelLengthM / 1000).toFixed(3)} km (${sum.tunnelPctOverall.toFixed(1)}%)`, x0 + W - 7, topY - 181, 9.0, [21, 128, 61], true, 'Right'));

  const diaRows = isWa
    ? [
        { lbl: `1. DN 900 (${(sum.byDia.DN900.totalM / 1000).toFixed(3)} km)`, done: `Done: ${(sum.byDia.DN900.completedM / 1000).toFixed(3)} km`, dy: 192 },
        { lbl: `2. DN 1100 (${(sum.byDia.DN1100.totalM / 1000).toFixed(3)} km)`, done: `Done: ${(sum.byDia.DN1100.completedM / 1000).toFixed(3)} km`, dy: 201 },
        { lbl: `3. DN 1600 (${(sum.byDia.DN1600.totalM / 1000).toFixed(3)} km)`, done: `Done: ${(sum.byDia.DN1600.completedM / 1000).toFixed(3)} km`, dy: 210 },
      ]
    : [
        { lbl: `1. DN 1800 (${(sum.byDia.DN1800.totalM / 1000).toFixed(3)} km)`, done: `Done: ${(sum.byDia.DN1800.completedM / 1000).toFixed(3)} km`, dy: 192 },
        { lbl: `2. DN 2400 (${(sum.byDia.DN2400.totalM / 1000).toFixed(3)} km)`, done: `Done: ${(sum.byDia.DN2400.completedM / 1000).toFixed(3)} km`, dy: 201 },
        { lbl: `3. DN 2600 (${(sum.byDia.DN2600.totalM / 1000).toFixed(3)} km)`, done: `Done: ${(sum.byDia.DN2600.completedM / 1000).toFixed(3)} km`, dy: 210 },
      ];
  diaRows.forEach((d, i) => {
    out.push(makeTextGraphicElement(`Leg_DiaL_${i}`, d.lbl, x0 + 7, topY - d.dy, 8.2, [51, 65, 85], true, 'Left'));
    out.push(makeTextGraphicElement(`Leg_DiaR_${i}`, d.done, x0 + W - 7, topY - d.dy, 8.2, [15, 23, 42], true, 'Right'));
  });

  // Colored Bottom Highlight Strip (Green for Golapbag SPS on WA; Purple for Corridor on WC)
  if (isWa) {
    const lowerDone = pump.layers.filter((l) => l.status === 'complete').length;
    const remM = Math.max(0, Number((pump.totalHeightM - pump.sinkingCompletedM).toFixed(2)));
    out.push(makePolygonGraphicElement('Leg_Bot_Box', roundedRectRing(x0 + 6, y0 + 5, x0 + W - 6, y0 + 25, 2), [240, 253, 244, 100], [22, 163, 74, 100], 0.9));
    out.push(makeTextGraphicElement('Leg_Bot_1', `Golapbag SPS: ${lowerDone}/5 Lower (Cast: ${pump.castingCompleteM}m) | Room: ${pump.machineRoom.status.toUpperCase()}`, x0 + 10, y0 + 18, 7.8, [22, 101, 52], true, 'Left'));
    out.push(makeTextGraphicElement('Leg_Bot_2', `Sinking: ${pump.sinkingCompletedM}m / ${pump.totalHeightM}m [${pump.sinkingStatus.toUpperCase()}${pump.sinkingStatus !== 'complete' ? ` | Rem: ${remM}m` : ''}]`, x0 + 10, y0 + 9.5, 7.8, [15, 118, 110], true, 'Left'));
  } else {
    const started = sum.completedTunnelLengthM > 0 || sum.completedShafts > 0;
    out.push(makePolygonGraphicElement('Leg_Bot_Box', roundedRectRing(x0 + 6, y0 + 5, x0 + W - 6, y0 + 25, 2), [250, 245, 255, 100], [147, 51, 234, 100], 0.9));
    out.push(makeTextGraphicElement('Leg_Bot_1', 'Corridor: Doyagonj Chowrasta (WC-1) to Pagla STP (WC-27)', x0 + 10, y0 + 18, 7.8, [107, 33, 168], true, 'Left'));
    out.push(makeTextGraphicElement('Leg_Bot_2', `Status: ${started ? 'Active Construction' : 'Not Started (All Remaining)'}`, x0 + 10, y0 + 9.5, 7.8, started ? [21, 128, 61] : [185, 28, 28], true, 'Left'));
  }

  return out;
}

/**
 * Shared PDF-style Landscape 3-Map Bottom Legend & Quantitative Summary Strip (`841 x 594 mm`)
 */
function buildLandscapeBottomLegendBar(state: AppState, pageW: number): Array<Record<string, unknown>> {
  const ctx = resolveDisplayContext(state);
  const waSummary = computeSummary(ctx.displayShafts, ctx.baseline, ctx.displayPump, undefined, state.settings.waTunnelDiaTotalsM);
  const wcSummary = computeSummary(ctx.displayWc.shafts, ctx.baseline, undefined, ctx.baseline.wcShafts);
  const wbPct = ctx.displayWb.totalLengthM > 0 ? (ctx.displayWb.completedLengthM / ctx.displayWb.totalLengthM) * 100 : 0;

  const out: Array<Record<string, unknown>> = [];
  out.push(
    makePolygonGraphicElement(
      'Legend_Bar',
      roundedRectRing(11, 10, pageW - 11, 42, 2),
      [248, 250, 252, 100],
      [148, 163, 184, 100],
      0.9
    )
  );
  // Header strip inside footer
  out.push(
    makePolygonGraphicElement(
      'Legend_Hdr',
      roundedRectRing(11, 33, pageW - 11, 42, 2),
      [239, 246, 255, 100],
      [148, 163, 184, 100],
      0.8
    )
  );
  out.push(
    makeTextGraphicElement(
      'Legend_Hdr_T',
      `CONSTRUCTION PROGRESS SUMMARY & MAP LEGEND  |  WA: ${(waSummary.completedTunnelLengthM / 1000).toFixed(3)}/${(waSummary.totalTunnelLengthM / 1000).toFixed(3)} km (${waSummary.tunnelPctOverall.toFixed(1)}%)  |  WB: ${ctx.displayWb.completedLengthM.toFixed(1)}/${ctx.displayWb.totalLengthM} m (${wbPct.toFixed(1)}%)  |  WC: ${(wcSummary.completedTunnelLengthM / 1000).toFixed(3)}/${(wcSummary.totalTunnelLengthM / 1000).toFixed(3)} km`,
      pageW / 2,
      37.5,
      8.5,
      [15, 23, 42],
      true,
      'Center'
    )
  );

  const items: Array<{ label: string; rgb: [number, number, number]; x: number; type: 'sq' | 'ln' | 'sps' | 'app' }> = [
    { label: 'Complete (100%)', rgb: [22, 163, 74], x: 22, type: 'sq' },
    { label: 'On-Going / Active', rgb: [37, 99, 235], x: 145, type: 'sq' },
    { label: 'Remaining', rgb: [220, 38, 38], x: 272, type: 'sq' },
    { label: 'Tunnel / Pipeline Align.', rgb: [22, 163, 74], x: 382, type: 'ln' },
    { label: 'Golapbag SPS', rgb: [219, 39, 119], x: 525, type: 'sps' },
    { label: 'Washout / Air Valve', rgb: [2, 132, 199], x: 635, type: 'app' },
  ];
  items.forEach((it) => {
    if (it.type === 'sq') {
      out.push(makePolygonGraphicElement(`LegSq_${it.label}`, rectRing(it.x, 18, it.x + 7, 25), [255, 255, 255, 100], [...it.rgb, 100], 1.6));
      out.push(makeCircleGraphicElement(`LegDt_${it.label}`, it.x + 3.5, 21.5, 1.4, [...it.rgb, 100]));
    } else if (it.type === 'ln') {
      out.push(makeLineGraphicElement(`LegLn_${it.label}`, [[[it.x, 21.5], [it.x + 14, 21.5]]], it.rgb, 3.8));
    } else if (it.type === 'sps') {
      out.push(makePolygonGraphicElement(`LegSps`, rectRing(it.x, 18, it.x + 8, 25), [251, 207, 232, 100], [157, 23, 77, 100], 1.2));
    } else {
      out.push(makeCircleGraphicElement(`LegApp`, it.x + 4, 21.5, 3.5, [186, 230, 253, 100], [3, 105, 161, 100], 1.0));
      out.push(makePolygonGraphicElement(`LegAppTri`, [[[it.x + 4, 23.4], [it.x + 5.7, 19.9], [it.x + 2.3, 19.9], [it.x + 4, 23.4]]], [2, 132, 199, 100], [3, 105, 161, 100], 0.4));
    }
    out.push(makeTextGraphicElement(`LegT_${it.label}`, it.label, it.x + (it.type === 'ln' ? 18 : 11), 21.5, 8.2, [15, 23, 42], true, 'Left'));
  });

  out.push(
    makeTextGraphicElement(
      'Footer_Note',
      'ArcGIS Pro 3.5.0 Layout | WABC Progress Studio',
      pageW - 18,
      21.5,
      7.6,
      [71, 85, 105],
      true,
      'Right'
    )
  );
  return out;
}

/**
 * Self-contained pure-JSON A1 Landscape 3-Map Vector Layout (`841 x 594 mm`)
 * styled identically to GIS output sample.pdf!
 */
function buildPortableVector3MapLayout(state: AppState, uri: string) {
  const PAGE_W = 841;
  const PAGE_H = 594;
  const ctx = resolveDisplayContext(state);
  const waShafts = ctx.displayShafts;
  const waGeo = ctx.displayWaGeoNodes;
  const sps = ctx.displaySpsCoord;
  const wb = ctx.displayWb;
  const wc = ctx.displayWc;

  const periodText =
    state.viewMode === 'weekly'
      ? `WEEKLY COMPARE: ${ctx.file1Label} -> ${ctx.file2Label}`
      : state.viewMode === 'monthly'
      ? `MONTHLY COMPARE: ${ctx.file1Label} -> ${ctx.file2Label}`
      : 'OVERALL CONSTRUCTION STATUS';

  const elements: Array<Record<string, unknown>> = [
    ...buildPdfStyleHeaderGraphics({
      prefix: 'Vec3',
      pageW: PAGE_W,
      pageH: PAGE_H,
      sectionCode: 'WABC',
      sectionSub: 'All Sections',
      sectionRgb: [15, 23, 42],
      sheetNoLabel: 'Sheet 1 of 5',
      title: 'Construction Progress Overview: WA, WB & WC Combined Corridor Maps',
      subtitle: `Dhaka Sanitation Improvement Project (DSIP) | Package WD-02 — As of ${formatDateDisplay(state.settings.reportDate)}`,
      periodText,
      clientLine: `Client: ${state.settings.clientName} | ${state.settings.contractorName}`,
      isCompareMode: state.viewMode !== 'overall',
    }),
  ];

  const panels = [
    { id: 'WA', badge: 'WA', title: 'WA: 37 Shafts & Golapbag SPS', x0: 14, x1: 278, y0: 48, y1: 552, accent: [21, 128, 61] as [number, number, number] },
    { id: 'WB', badge: 'WB', title: 'WB: DN1200 GRP Open-Cut (1.65 km)', x0: 288, x1: 552, y0: 48, y1: 552, accent: [29, 78, 216] as [number, number, number] },
    { id: 'WC', badge: 'WC', title: 'WC: 27 Shafts Micro-Tunnelling', x0: 562, x1: 826, y0: 48, y1: 552, accent: [126, 34, 206] as [number, number, number] },
  ];

  panels.forEach((pan) => {
    const pw = pan.x1 - pan.x0;
    const ph = pan.y1 - pan.y0;
    elements.push(
      makePolygonGraphicElement(
        `${pan.id}_Panel_Bg`,
        rectRing(pan.x0, pan.y0, pan.x1, pan.y1),
        [248, 250, 252, 100],
        [15, 23, 42, 100],
        1.2
      )
    );
    elements.push(
      makePolygonGraphicElement(
        `${pan.id}_Panel_Hdr`,
        rectRing(pan.x0, pan.y1 - 18, pan.x1, pan.y1),
        [255, 255, 255, 100],
        [15, 23, 42, 100],
        0.9
      )
    );
    elements.push(
      makePolygonGraphicElement(
        `${pan.id}_Panel_Badge`,
        roundedRectRing(pan.x0 + 3, pan.y1 - 15.5, pan.x0 + 27, pan.y1 - 2.5, 2),
        [...pan.accent, 100],
        [...pan.accent, 100],
        0.5
      )
    );
    elements.push(makeTextGraphicElement(`${pan.id}_Badge_T`, pan.badge, pan.x0 + 15, pan.y1 - 9, 9.5, [255, 255, 255], true, 'Center'));
    elements.push(makeTextGraphicElement(`${pan.id}_Title_T`, pan.title, pan.x0 + 32, pan.y1 - 9, 9.0, [15, 23, 42], true, 'Left'));

    const mapX0 = pan.x0 + 5;
    const mapY0 = pan.y0 + 5;
    const mapW = pw - 10;
    const mapH = ph - 26;

    const makePanelProj = (pts: Array<{ lat: number; lon: number }>) => {
      const vp = buildGeoViewport(pts, 0, 0, mapW, mapH, 0.13);
      return {
        vp,
        toPage: (lat: number, lon: number) => {
          const s = vp.project(lat, lon);
          return { x: mapX0 + s.x, y: mapY0 + (mapH - s.y), sx: s.x, sy: s.y };
        },
        screenToPage: (sx: number, sy: number) => ({
          x: mapX0 + sx,
          y: mapY0 + (mapH - sy),
        }),
      };
    };

    for (let g = 1; g <= 4; g++) {
      const gx = mapX0 + (mapW * g) / 5;
      const gy = mapY0 + (mapH * g) / 5;
      elements.push(makeLineGraphicElement(`${pan.id}_GridV_${g}`, [[[gx, mapY0], [gx, mapY0 + mapH]]], [226, 232, 240], 0.45));
      elements.push(makeLineGraphicElement(`${pan.id}_GridH_${g}`, [[[mapX0, gy], [mapX0 + mapW, gy]]], [226, 232, 240], 0.45));
    }

    const drawNodeSquare = (pfx: string, px: number, py: number, rgb: [number, number, number]) => {
      elements.push(makePolygonGraphicElement(`${pfx}_Sq`, rectRing(px - 2.0, py - 2.0, px + 2.0, py + 2.0), [255, 255, 255, 100], [...rgb, 100], 1.1));
      elements.push(makeCircleGraphicElement(`${pfx}_Dt`, px, py, 0.9, [...rgb, 100]));
    };

    if (pan.id === 'WA') {
      const { vp, toPage, screenToPage } = makePanelProj([...waGeo, sps]);
      const shaftById = new Map(waShafts.map((s) => [s.id, s]));
      const spsP = toPage(sps.lat, sps.lon);
      waGeo.forEach((gNode, idx) => {
        const p1 = toPage(gNode.lat, gNode.lon);
        const p2 = idx < waGeo.length - 1 ? toPage(waGeo[idx + 1].lat, waGeo[idx + 1].lon) : spsP;
        const sh = shaftById.get(gNode.id);
        const rgb = statusToRgb(sh ? getTunnelStatus(sh) : 'remaining');
        elements.push(makeLineGraphicElement(`WA_C_${gNode.id}`, [[[p1.x, p1.y], [p2.x, p2.y]]], [255, 255, 255], 4.0));
        elements.push(makeLineGraphicElement(`WA_T_${gNode.id}`, [[[p1.x, p1.y], [p2.x, p2.y]]], rgb, 2.6));
      });
      const lblInputs: MapLabelInput[] = [];
      waGeo.forEach((gNode, idx) => {
        const p = toPage(gNode.lat, gNode.lon);
        const sh = shaftById.get(gNode.id);
        drawNodeSquare(`WA_${gNode.id}`, p.x, p.y, statusToRgb(sh ? getShaftStatus(sh) : 'remaining'));
        lblInputs.push({
          id: gNode.id,
          text: gNode.id.replace(/^WA-(\d+)(\.\d+)?$/i, (_, n, suf) => `WA ${Number(n) < 10 ? '0' + n : n}${suf || ''}`),
          px: p.sx,
          py: p.sy,
          markerRadius: 2.8,
          priority: idx === 0 || idx === waGeo.length - 1 ? 90 : idx % 2 === 0 ? 60 : 40,
          mustPlace: true,
        });
      });
      elements.push(makePolygonGraphicElement('WA_SPS_Box', roundedRectRing(spsP.x - 5.5, spsP.y - 3.2, spsP.x + 5.5, spsP.y + 3.2, 1), [251, 207, 232, 100], [157, 23, 77, 100], 1.0));
      elements.push(makeTextGraphicElement('WA_SPS_Txt', 'SPS', spsP.x, spsP.y, 6.2, [131, 24, 67], true, 'Center'));
      const placed = layoutMapLabels(lblInputs, { x: 0, y: 0, w: mapW, h: mapH }, { fontSize: 5.4, maxTier: 5, padding: 2.0 });
      placed.forEach((lbl) => {
        const pt = screenToPage(lbl.textX, lbl.textY - 1.5);
        if (lbl.needsLeader) {
          const p0 = screenToPage(lbl.px, lbl.py);
          const p2 = screenToPage(lbl.leaderX2, lbl.leaderY2);
          elements.push(makeLineGraphicElement(`WA_Ldr_${lbl.id}`, [[[p0.x, p0.y], [p2.x, p2.y]]], [100, 116, 139], 0.4));
        }
        elements.push(makeTextGraphicElement(`WA_Lbl_${lbl.id}`, lbl.text, pt.x, pt.y, 5.8, [15, 23, 42], true, 'Center', true));
      });
      const waCamApprox = computeMercatorCamera([...waGeo, sps], mapW, mapH, 0.13);
      elements.push(...buildScaleBarCardGraphics('WA_Vec_Scale', pan.x1 - 4, pan.y0 + 4, waCamApprox, true));
      void vp;
      void computeMetersPerSvgUnit;
    } else if (pan.id === 'WB') {
      const wash = wb.washoutCoord || DEFAULT_WASHOUT_COORD;
      const airv = wb.airValveCoord || DEFAULT_AIR_VALVE_COORD;
      const { toPage, screenToPage } = makePanelProj([...wb.nodes, wash, airv]);
      const split = computeWbPolylineSplit(wb.nodes, wb.totalLengthM, wb.completedLengthM);
      if (split.remainingPoints.length >= 2) {
        const pts = split.remainingPoints.map((pt) => { const q = toPage(pt.lat, pt.lon); return [q.x, q.y]; });
        elements.push(makeLineGraphicElement('WB_Line_RemC', [pts], [255, 255, 255], 4.2));
        elements.push(makeLineGraphicElement('WB_Line_Rem', [pts], [220, 38, 38], 2.6));
      }
      if (split.prevPoints.length >= 2) {
        const pts = split.prevPoints.map((pt) => { const q = toPage(pt.lat, pt.lon); return [q.x, q.y]; });
        elements.push(makeLineGraphicElement('WB_Line_DoneC', [pts], [255, 255, 255], 4.6));
        elements.push(makeLineGraphicElement('WB_Line_Done', [pts], [22, 163, 74], 3.1));
      }
      const lblInputs: MapLabelInput[] = [];
      wb.nodes.forEach((n, idx) => {
        const p = toPage(n.lat, n.lon);
        drawNodeSquare(`WB_${n.id}`, p.x, p.y, statusToRgb(n.status));
        lblInputs.push({
          id: n.id,
          text: n.id.replace(/^WB(\d)$/i, 'WB0$1'),
          px: p.sx,
          py: p.sy,
          markerRadius: 2.6,
          priority: idx === 0 || idx === wb.nodes.length - 1 ? 90 : idx % 2 === 0 ? 60 : 40,
          mustPlace: true,
        });
      });
      const tipP = toPage(split.tipPoint.lat, split.tipPoint.lon);
      elements.push(makeCircleGraphicElement('WB_Tip_M', tipP.x, tipP.y, 2.4, [37, 99, 235, 100], [255, 255, 255, 100], 0.9));
      const placed = layoutMapLabels(lblInputs, { x: 0, y: 0, w: mapW, h: mapH }, { fontSize: 5.3, maxTier: 5, padding: 2.0 });
      placed.forEach((lbl) => {
        const pt = screenToPage(lbl.textX, lbl.textY - 1.5);
        if (lbl.needsLeader) {
          const p0 = screenToPage(lbl.px, lbl.py);
          const p2 = screenToPage(lbl.leaderX2, lbl.leaderY2);
          elements.push(makeLineGraphicElement(`WB_Ldr_${lbl.id}`, [[[p0.x, p0.y], [p2.x, p2.y]]], [100, 116, 139], 0.4));
        }
        elements.push(makeTextGraphicElement(`WB_Lbl_${lbl.id}`, lbl.text, pt.x, pt.y, 5.6, [15, 23, 42], true, 'Center', true));
      });
      const wbCamApprox = computeMercatorCamera([...wb.nodes, wash, airv], mapW, mapH, 0.13);
      elements.push(...buildScaleBarCardGraphics('WB_Vec_Scale', pan.x1 - 4, pan.y0 + 4, wbCamApprox, true));
    } else {
      const { toPage, screenToPage } = makePanelProj(wc.geoNodes);
      const shaftById = new Map(wc.shafts.map((s) => [s.id, s]));
      wc.geoNodes.slice(0, -1).forEach((gNode, idx) => {
        const nextNode = wc.geoNodes[idx + 1];
        const p1 = toPage(gNode.lat, gNode.lon);
        const p2 = toPage(nextNode.lat, nextNode.lon);
        const sh = shaftById.get(gNode.id);
        const rgb = statusToRgb(sh ? getTunnelStatus(sh) : 'remaining');
        elements.push(makeLineGraphicElement(`WC_C_${gNode.id}`, [[[p1.x, p1.y], [p2.x, p2.y]]], [255, 255, 255], 4.0));
        elements.push(makeLineGraphicElement(`WC_T_${gNode.id}`, [[[p1.x, p1.y], [p2.x, p2.y]]], rgb, 2.6));
      });
      const lblInputs: MapLabelInput[] = [];
      wc.geoNodes.forEach((gNode, idx) => {
        const p = toPage(gNode.lat, gNode.lon);
        const sh = shaftById.get(gNode.id);
        drawNodeSquare(`WC_${gNode.id}`, p.x, p.y, statusToRgb(sh ? getShaftStatus(sh) : 'remaining'));
        lblInputs.push({
          id: gNode.id,
          text: gNode.id,
          px: p.sx,
          py: p.sy,
          markerRadius: 2.8,
          priority: idx === 0 || idx === wc.geoNodes.length - 1 ? 90 : idx % 2 === 0 ? 60 : 40,
          mustPlace: true,
        });
      });
      const placed = layoutMapLabels(lblInputs, { x: 0, y: 0, w: mapW, h: mapH }, { fontSize: 5.4, maxTier: 5, padding: 2.0 });
      placed.forEach((lbl) => {
        const pt = screenToPage(lbl.textX, lbl.textY - 1.5);
        if (lbl.needsLeader) {
          const p0 = screenToPage(lbl.px, lbl.py);
          const p2 = screenToPage(lbl.leaderX2, lbl.leaderY2);
          elements.push(makeLineGraphicElement(`WC_Ldr_${lbl.id}`, [[[p0.x, p0.y], [p2.x, p2.y]]], [100, 116, 139], 0.4));
        }
        elements.push(makeTextGraphicElement(`WC_Lbl_${lbl.id}`, lbl.text, pt.x, pt.y, 5.8, [15, 23, 42], true, 'Center', true));
      });
      const wcCamApprox = computeMercatorCamera(wc.geoNodes, mapW, mapH, 0.13);
      elements.push(...buildScaleBarCardGraphics('WC_Vec_Scale', pan.x1 - 4, pan.y0 + 4, wcCamApprox, true));
    }

    elements.push(...buildCompassRoseGraphics(`${pan.id}_Rose`, pan.x1 - 15, pan.y1 - 32, 8.5));
  });

  elements.push(...buildLandscapeBottomLegendBar(state, PAGE_W));

  return {
    type: 'CIMLayout',
    name: 'WABC_3Map_Vector_Layout',
    uRI: uri,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    elements,
    page: {
      type: 'CIMPage',
      height: PAGE_H,
      width: PAGE_W,
      units: { uwkid: 1025 },
      showRulers: true,
      showGuides: true,
      smallestRulerDivision: 0.01,
      showMargin: true,
    },
    dateExported: { type: 'TimeInstant' },
    datePrinted: { type: 'TimeInstant' },
    colorModel: 'RGB',
    rGBColorProfile: 'sRGB IEC61966-2.1',
    cMYKColorProfile: 'U.S. Web Coated (SWOP) v2',
    defaultColorVisionDeficiencyMode: 'None',
  };
}

/**
 * Live 3-Map ArcGIS Pro Landscape Layout (`841 x 594 mm`) matching PDF header, borders, graticules,
 * 8-point compass roses, alternating scalebars, and bottom structured legend strip.
 */
function buildLive3MapLayout(state: AppState, uri: string) {
  const PAGE_W = 841;
  const PAGE_H = 594;
  const ctx = resolveDisplayContext(state);
  const waPts = [...ctx.displayWaGeoNodes, ctx.displaySpsCoord];
  const wbPts = [
    ...ctx.displayWb.nodes,
    ctx.displayWb.washoutCoord || DEFAULT_WASHOUT_COORD,
    ctx.displayWb.airValveCoord || DEFAULT_AIR_VALVE_COORD,
  ];
  const wcPts = ctx.displayWc.geoNodes;

  const periodText =
    state.viewMode === 'weekly'
      ? `WEEKLY COMPARE: ${ctx.file1Label} -> ${ctx.file2Label}`
      : state.viewMode === 'monthly'
      ? `MONTHLY COMPARE: ${ctx.file1Label} -> ${ctx.file2Label}`
      : 'OVERALL CONSTRUCTION STATUS';

  const waFrame = makeMapFrameElement({
    name: 'WA Map Frame',
    mapUri: 'CIMPATH=map_wa/map.json',
    x0: 15,
    y0: 54,
    x1: 277,
    y1: 534,
    pts: waPts,
    padFrac: 0.17,
  });
  const wbFrame = makeMapFrameElement({
    name: 'WB Map Frame',
    mapUri: 'CIMPATH=map_wb/map.json',
    x0: 290,
    y0: 54,
    x1: 552,
    y1: 534,
    pts: wbPts,
    padFrac: 0.22,
  });
  const wcFrame = makeMapFrameElement({
    name: 'WC Map Frame',
    mapUri: 'CIMPATH=map_wc/map.json',
    x0: 565,
    y0: 54,
    x1: 826,
    y1: 534,
    pts: wcPts,
    padFrac: 0.17,
  });

  const elements: Array<Record<string, unknown>> = [
    ...buildPdfStyleHeaderGraphics({
      prefix: 'Live3',
      pageW: PAGE_W,
      pageH: PAGE_H,
      sectionCode: 'WABC',
      sectionSub: 'All Sections',
      sectionRgb: [15, 23, 42],
      sheetNoLabel: 'Sheet 1 of 5',
      title: 'Construction Progress Overview: WA, WB & WC Corridor Maps',
      subtitle: `Dhaka Sanitation Improvement Project (DSIP) | Package WD-02 — As of ${formatDateDisplay(state.settings.reportDate)}`,
      periodText,
      clientLine: `Client: ${state.settings.clientName} | ${state.settings.contractorName}`,
      isCompareMode: state.viewMode !== 'overall',
    }),

    // Panel Header Strips with Colored Section Badges
    ...[
      { id: 'WA', code: 'WA', title: 'WA: Shafts, Micro-Tunnel & SPS', x0: 15, x1: 277, rgb: [21, 128, 61] as [number, number, number] },
      { id: 'WB', code: 'WB', title: 'WB: DN1200 GRP Open-Cut', x0: 290, x1: 552, rgb: [29, 78, 216] as [number, number, number] },
      { id: 'WC', code: 'WC', title: 'WC: 27 Shafts Micro-Tunnelling', x0: 565, x1: 826, rgb: [126, 34, 206] as [number, number, number] },
    ].flatMap((p) => [
      makePolygonGraphicElement(`${p.id}_Hdr_Box`, rectRing(p.x0 - 2, 536, p.x1 + 2, 554), [248, 250, 252, 100], [15, 23, 42, 100], 0.9),
      makePolygonGraphicElement(`${p.id}_Hdr_Badge`, roundedRectRing(p.x0 + 1, 538, p.x0 + 25, 552, 2), [...p.rgb, 100], [...p.rgb, 100], 0.5),
      makeTextGraphicElement(`${p.id}_Hdr_Code`, p.code, p.x0 + 13, 545, 9.5, [255, 255, 255], true, 'Center'),
      makeTextGraphicElement(`${p.id}_Hdr_Txt`, p.title, p.x0 + 30, 545, 9.2, [15, 23, 42], true, 'Left'),
    ]),

    // Live ArcGIS Pro MapFrames
    waFrame.element,
    wbFrame.element,
    wcFrame.element,

    // Double Neatlines + Lat/Lon Coordinate Ticks
    ...buildFrameNeatlineAndGraticule('WA_Grat', 15, 54, 277, 534, waFrame.cam, false),
    ...buildFrameNeatlineAndGraticule('WB_Grat', 290, 54, 552, 534, wbFrame.cam, false),
    ...buildFrameNeatlineAndGraticule('WC_Grat', 565, 54, 826, 534, wcFrame.cam, false),

    // Per-Panel 8-Point Compass Roses & Alternating Scalebars
    ...buildCompassRoseGraphics('WA_Rose', 260, 514, 9.5),
    ...buildScaleBarCardGraphics('WA_Scale', 274, 57, waFrame.cam, true),

    ...buildCompassRoseGraphics('WB_Rose', 307, 514, 9.5),
    ...buildScaleBarCardGraphics('WB_Scale', 549, 57, wbFrame.cam, true),

    ...buildCompassRoseGraphics('WC_Rose', 809, 514, 9.5),
    ...buildScaleBarCardGraphics('WC_Scale', 823, 57, wcFrame.cam, true),

    // Bottom Structured Legend & Summary Bar
    ...buildLandscapeBottomLegendBar(state, PAGE_W),
  ];

  return {
    type: 'CIMLayout',
    name: 'WABC_3Map_Layout',
    uRI: uri,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    elements,
    page: {
      type: 'CIMPage',
      height: PAGE_H,
      width: PAGE_W,
      units: { uwkid: 1025 },
      showRulers: true,
      showGuides: true,
      smallestRulerDivision: 0.01,
      showMargin: true,
    },
    dateExported: { type: 'TimeInstant' },
    datePrinted: { type: 'TimeInstant' },
    colorModel: 'RGB',
    rGBColorProfile: 'sRGB IEC61966-2.1',
    cMYKColorProfile: 'U.S. Web Coated (SWOP) v2',
    defaultColorVisionDeficiencyMode: 'None',
  };
}

/**
 * Full Portrait A1 Layout (`594 x 841 mm`) matching GIS output sample.pdf (`WA Map`, `WB Map`, `WC Map`)
 * with Section Badge Header, Lat/Lon Graticule Ticks, 8-Point Compass Rose, Frosted Structured Legend,
 * and Alternating Black/White Kilometers Scalebar.
 */
function buildSinglePortraitLayout(opts: {
  kind: 'wa' | 'wb' | 'wc';
  name: string;
  uri: string;
  mapUri: string;
  frameName: string;
  pts: Array<{ lat: number; lon: number }>;
  state: AppState;
}) {
  const PAGE_W = 594;
  const PAGE_H = 841;
  const { state } = opts;
  const ctx = resolveDisplayContext(state);

  const sectionCode = opts.kind === 'wa' ? 'WA' : opts.kind === 'wb' ? 'WB' : 'WC';
  const sectionRgb: [number, number, number] =
    opts.kind === 'wa' ? [21, 128, 61] : opts.kind === 'wb' ? [29, 78, 216] : [126, 34, 206];
  const sheetNoLabel =
    opts.kind === 'wa' ? 'Sheet 2 of 5' : opts.kind === 'wb' ? 'Sheet 3 of 5' : 'Sheet 4 of 5';
  const title =
    opts.kind === 'wa'
      ? 'Construction Progress Map: WA Shaft, Micro-Tunneling & Manhole'
      : opts.kind === 'wb'
      ? 'Construction Progress Map: WB Open-Cut Pipeline (DN1200 GRP)'
      : 'Construction Progress Map: WC Shaft, Micro-Tunneling & Manhole';

  const periodText =
    state.viewMode === 'weekly'
      ? `WEEKLY COMPARE: ${ctx.file1Label} -> ${ctx.file2Label}`
      : state.viewMode === 'monthly'
      ? `MONTHLY COMPARE: ${ctx.file1Label} -> ${ctx.file2Label}`
      : 'OVERALL CONSTRUCTION STATUS';

  // Map frame interior (`550 x 778 mm` inside coordinate graticule margins!)
  const fx0 = 22;
  const fy0 = 18;
  const fx1 = PAGE_W - 22;
  const fy1 = PAGE_H - 43;

  const mf = makeMapFrameElement({
    name: opts.frameName,
    mapUri: opts.mapUri,
    x0: fx0,
    y0: fy0,
    x1: fx1,
    y1: fy1,
    pts: opts.pts,
    padFrac: 0.11,
  });

  // Compass & Legend coordinates (WB has Top-Left Compass + Legend; WA & WC have Top-Right Compass + Bottom-Left Legend)
  const compassPos =
    opts.kind === 'wb'
      ? { cx: fx0 + 36, cy: fy1 - 30 }
      : { cx: fx1 - 30, cy: fy1 - 30 };

  const legendPos =
    opts.kind === 'wb'
      ? { x0: fx0 + 7, y0: fy1 - 234 }
      : { x0: fx0 + 7, y0: fy0 + 7 };

  const elements: Array<Record<string, unknown>> = [
    ...buildPdfStyleHeaderGraphics({
      prefix: `${sectionCode}_Hdr`,
      pageW: PAGE_W,
      pageH: PAGE_H,
      sectionCode,
      sectionSub: 'Section',
      sectionRgb,
      sheetNoLabel,
      title,
      subtitle: `Dhaka Sanitation Improvement Project (DSIP) | Package WD-02 — As of ${formatDateDisplay(state.settings.reportDate)}`,
      periodText,
      clientLine: `Client: ${state.settings.clientName} | ${state.settings.contractorName}`,
      isCompareMode: state.viewMode !== 'overall',
    }),

    // Live ArcGIS Pro MapFrame
    mf.element,

    // Double Neatline Frame + Exact DMS Lat/Lon Graticule Ticks on all sides
    ...buildFrameNeatlineAndGraticule(`${sectionCode}_Grat`, fx0, fy0, fx1, fy1, mf.cam, true),

    // Frosted Structured Legend Card (exact match to GIS output sample.pdf)
    ...buildPortraitLegendCard(opts.kind, state, legendPos.x0, legendPos.y0),

    // 8-Point Vector Compass Rose
    ...buildCompassRoseGraphics(`${sectionCode}_Rose`, compassPos.cx, compassPos.cy, 16),

    // Alternating Black/White Scale Bar & Esri Sources Card (Bottom-Right)
    ...buildScaleBarCardGraphics(`${sectionCode}_Scale`, fx1 - 7, fy0 + 7, mf.cam, false),
  ];

  return {
    type: 'CIMLayout',
    name: opts.name,
    uRI: opts.uri,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    elements,
    page: {
      type: 'CIMPage',
      height: PAGE_H,
      width: PAGE_W,
      units: { uwkid: 1025 },
      showRulers: true,
      showGuides: true,
      smallestRulerDivision: 0.01,
      showMargin: true,
    },
    dateExported: { type: 'TimeInstant' },
    datePrinted: { type: 'TimeInstant' },
    colorModel: 'RGB',
    rGBColorProfile: 'sRGB IEC61966-2.1',
    cMYKColorProfile: 'U.S. Web Coated (SWOP) v2',
    defaultColorVisionDeficiencyMode: 'None',
  };
}

function buildViewLayoutXml(views: Array<{ instanceID: number; viewType: string }>, activeInstanceId: number) {
  const docRefs = views
    .map(
      (v, i) =>
        `<UIElement xsi:type="DocumentWindowRef" UniqueId="wabc-doc-${i + 1}" />`
    )
    .join('\n\t\t\t\t\t\t');
  const docWindows = views
    .map(
      (v, i) =>
        `<DocumentWindow UniqueId="wabc-doc-${i + 1}" SerializationId="${v.viewType}_${v.instanceID}" Name="${v.viewType}_${v.instanceID}" IsOpen="true" State="Document"><Tag xsi:type="xsd:unsignedInt">${v.instanceID}</Tag></DocumentWindow>`
    )
    .join('\n\t\t');
  const activeView = views.find((v) => v.instanceID === activeInstanceId) || views[0];
  const activeUniqueIdx = views.findIndex((v) => v.instanceID === activeView.instanceID) + 1;

  const innerXml = `<DockSiteLayout xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" SerializationFormat="All" Version="2">
	<AutoHideHost />
	<Content xsi:type="SplitContainer" Orientation="Horizontal" DockedSize="1900,900">
		<UIElement xsi:type="Workspace">
			<Content xsi:type="TabbedMdiHost">
				<Content xsi:type="TabbedMdiContainer" SelectedWindowUniqueId="wabc-doc-${activeUniqueIdx}">
					${docRefs}
				</Content>
			</Content>
		</UIElement>
	</Content>
	<DocumentWindows>
		${docWindows}
	</DocumentWindows>
</DockSiteLayout>`;

  const escaped = innerXml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<esriPaneState>\r\n  <PaneState>${escaped}</PaneState>\r\n  <ActivePane>${activeView.viewType}_${activeView.instanceID}</ActivePane>\r\n</esriPaneState>`;
}

/**
 * Generates an ArcGIS Pro 3.3–3.5+ `.aprx` project binary (Uint8Array ZIP) bundled at the root
 * of the ArcGIS Pro Package (.zip) with PDF-fidelity layouts, symbology, legends, and graticules.
 */
export async function buildWabcAprxUint8Array(
  state: AppState,
  opts?: { standalone?: boolean }
): Promise<Uint8Array> {
  const zip = new JSZip();
  const standalone = Boolean(opts?.standalone);
  const ctx = resolveDisplayContext(state);

  const waPts = [...ctx.displayWaGeoNodes, ctx.displaySpsCoord];
  const wbPts = [
    ...ctx.displayWb.nodes,
    ctx.displayWb.washoutCoord || DEFAULT_WASHOUT_COORD,
    ctx.displayWb.airValveCoord || DEFAULT_AIR_VALVE_COORD,
  ];
  const wcPts = ctx.displayWc.geoNodes;
  const allPts = [...waPts, ...wbPts, ...wcPts];

  const waCam = computeMercatorCamera(waPts, 550, 780, 0.11);
  const wbCam = computeMercatorCamera(wbPts, 550, 780, 0.11);
  const wcCam = computeMercatorCamera(wcPts, 550, 780, 0.11);
  const allCam = computeMercatorCamera(allPts, 550, 780, 0.14);

  // DocumentInfo.xml (ArcGIS Pro 3.3.0 schema opens natively in 3.3 / 3.4 / 3.5.0+)
  zip.file(
    'DocumentInfo.xml',
    `<CIMDocumentInfo xsi:type='typens:CIMDocumentInfo' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:xs='http://www.w3.org/2001/XMLSchema' xmlns:typens='http://www.esri.com/schemas/ArcGIS/3.3.0'><Version>3.3.0</Version><Build>52636</Build><DocumentTitle>WABC_Progress_Maps.aprx</DocumentTitle><SavePreview>false</SavePreview><UseRelativePath>true</UseRelativePath><Antialiasing>esriBGLAntialiasingNone</Antialiasing><TextAntialiasing>esriBGLTextAAliasForce</TextAntialiasing></CIMDocumentInfo>`
  );

  // Shared Ground Elevation + Basemap
  const groundUri = 'CIMPATH=Map/ground_surface.json';
  zip.file(
    'Map/ground_surface.json',
    JSON.stringify({
      type: 'CIMElevationSurfaceLayer',
      name: 'Ground',
      uRI: groundUri,
      useSourceMetadata: true,
      description: 'Ground',
      expanded: true,
      layerType: 'Operational',
      showLegends: false,
      visibility: true,
      displayCacheType: 'Permanent',
      maxDisplayCacheAge: 5,
      showPopups: true,
      serviceLayerID: -1,
      refreshRate: -1,
      refreshRateUnit: 'esriTimeUnitsSeconds',
      blendingMode: 'Alpha',
      allowDrapingOnIntegratedMesh: true,
      elevationMode: 'BaseGlobeSurface',
      verticalExaggeration: 1,
      color: rgbColor(255, 255, 255, 100),
      surfaceTINShadingMode: 'Smooth',
    })
  );

  const bmWaUri = 'CIMPATH=map_wa/basemap.json';
  const bmWaRefUri = 'CIMPATH=map_wa/basemap_ref.json';
  const bmWbUri = 'CIMPATH=map_wb/basemap.json';
  const bmWbRefUri = 'CIMPATH=map_wb/basemap_ref.json';
  const bmWcUri = 'CIMPATH=map_wc/basemap.json';
  const bmWcRefUri = 'CIMPATH=map_wc/basemap_ref.json';
  const bmAllUri = 'CIMPATH=map_wabc/basemap.json';
  const bmAllRefUri = 'CIMPATH=map_wabc/basemap_ref.json';
  zip.file('map_wa/basemap.json', JSON.stringify(buildBasemapLayer(bmWaUri)));
  zip.file('map_wa/basemap_ref.json', JSON.stringify(buildBasemapReferenceLayer(bmWaRefUri)));
  zip.file('map_wb/basemap.json', JSON.stringify(buildBasemapLayer(bmWbUri)));
  zip.file('map_wb/basemap_ref.json', JSON.stringify(buildBasemapReferenceLayer(bmWbRefUri)));
  zip.file('map_wc/basemap.json', JSON.stringify(buildBasemapLayer(bmWcUri)));
  zip.file('map_wc/basemap_ref.json', JSON.stringify(buildBasemapReferenceLayer(bmWcRefUri)));
  zip.file('map_wabc/basemap.json', JSON.stringify(buildBasemapLayer(bmAllUri)));
  zip.file('map_wabc/basemap_ref.json', JSON.stringify(buildBasemapReferenceLayer(bmAllRefUri)));

  const spsRenderer = {
    type: 'CIMSimpleRenderer',
    sampleSize: 10000,
    patch: 'Default',
    symbol: solidPolygonSymbol([251, 207, 232, 85], [157, 23, 77, 100], 1.8),
  };

  const tipRenderer = {
    type: 'CIMSimpleRenderer',
    sampleSize: 10000,
    patch: 'Default',
    symbol: circlePointSymbol(37, 99, 235, 11, 2.0, [255, 255, 255]),
  };

  const layerFiles: Array<{
    path: string;
    uri: string;
    nodeId: number;
    def: Record<string, unknown>;
  }> = [];

  const defs = [
    {
      path: 'map_wa/wa_shafts.json',
      uri: 'CIMPATH=map_wa/wa_shafts.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wa/wa_shafts.json',
        name: 'WA Shafts',
        folderRel: '01_WA_Section',
        dataset: 'WA_Shafts',
        displayField: 'SHAFT_ID',
        labelField: 'MAP_LABEL',
        geomType: 'Point',
        renderer: statusUniqueRenderer('SHFT_STAT', 'Point'),
      }),
    },
    {
      path: 'map_wa/wa_tunnels.json',
      uri: 'CIMPATH=map_wa/wa_tunnels.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wa/wa_tunnels.json',
        name: 'WA Tunnels',
        folderRel: '01_WA_Section',
        dataset: 'WA_Tunnels',
        displayField: 'DRIVE_ID',
        labelField: 'PIPE_DIA',
        geomType: 'Polyline',
        renderer: statusUniqueRenderer('TUN_STATUS', 'Polyline'),
        showLabels: false,
      }),
    },
    {
      path: 'map_wa/wa_sps.json',
      uri: 'CIMPATH=map_wa/wa_sps.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wa/wa_sps.json',
        name: 'Golapbag SPS',
        folderRel: '01_WA_Section',
        dataset: 'WA_Golapbag_SPS',
        displayField: 'NAME',
        labelField: 'NAME',
        geomType: 'Polygon',
        renderer: spsRenderer,
        showLabels: false,
      }),
    },
    {
      path: 'map_wa/wa_landmarks.json',
      uri: 'CIMPATH=map_wa/wa_landmarks.json',
      def: buildLandmarkLayerDef({
        uri: 'CIMPATH=map_wa/wa_landmarks.json',
        name: 'WA Landmarks & Zones',
        folderRel: '01_WA_Section',
        dataset: 'WA_Landmarks',
      }),
    },
    {
      path: 'map_wb/wb_nodes.json',
      uri: 'CIMPATH=map_wb/wb_nodes.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wb/wb_nodes.json',
        name: 'WB Pipeline Nodes',
        folderRel: '02_WB_Section',
        dataset: 'WB_Nodes',
        displayField: 'NODE_ID',
        labelField: 'MAP_LABEL',
        geomType: 'Point',
        renderer: wbNodesUniqueRenderer(),
      }),
    },
    {
      path: 'map_wb/wb_pipeline.json',
      uri: 'CIMPATH=map_wb/wb_pipeline.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wb/wb_pipeline.json',
        name: 'WB HDPE Pipeline',
        folderRel: '02_WB_Section',
        dataset: 'WB_Pipeline',
        displayField: 'SEG_ID',
        labelField: 'PIPE_DIA',
        geomType: 'Polyline',
        renderer: statusUniqueRenderer('STATUS', 'Polyline'),
        showLabels: false,
      }),
    },
    {
      path: 'map_wb/wb_tip.json',
      uri: 'CIMPATH=map_wb/wb_tip.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wb/wb_tip.json',
        name: 'WB Completion Tip',
        folderRel: '02_WB_Section',
        dataset: 'WB_Completion_Tip',
        displayField: 'LABEL',
        labelField: 'LABEL',
        geomType: 'Point',
        renderer: tipRenderer,
        labelClasses: [
          makeMaplexLabelClass({
            name: 'Completion Tip',
            labelField: 'LABEL',
            geomType: 'Point',
            neverRemove: true,
            textSymbol: makeTextSymbol(9.0, [255, 255, 255], true, 'Left', false, {
              callout: {
                fill: [30, 58, 138, 100],
                stroke: [255, 255, 255, 100],
                strokeW: 1.0,
                padH: 6,
                padV: 3,
              },
            }),
          }),
        ],
      }),
    },
    {
      path: 'map_wb/wb_landmarks.json',
      uri: 'CIMPATH=map_wb/wb_landmarks.json',
      def: buildLandmarkLayerDef({
        uri: 'CIMPATH=map_wb/wb_landmarks.json',
        name: 'WB Landmarks & Zone',
        folderRel: '02_WB_Section',
        dataset: 'WB_Landmarks',
      }),
    },
    {
      path: 'map_wc/wc_shafts.json',
      uri: 'CIMPATH=map_wc/wc_shafts.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wc/wc_shafts.json',
        name: 'WC Shafts',
        folderRel: '03_WC_Section',
        dataset: 'WC_Shafts',
        displayField: 'SHAFT_ID',
        labelField: 'MAP_LABEL',
        geomType: 'Point',
        renderer: statusUniqueRenderer('SHFT_STAT', 'Point'),
      }),
    },
    {
      path: 'map_wc/wc_tunnels.json',
      uri: 'CIMPATH=map_wc/wc_tunnels.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wc/wc_tunnels.json',
        name: 'WC Tunnels',
        folderRel: '03_WC_Section',
        dataset: 'WC_Tunnels',
        displayField: 'DRIVE_ID',
        labelField: 'PIPE_DIA',
        geomType: 'Polyline',
        renderer: statusUniqueRenderer('TUN_STATUS', 'Polyline'),
        showLabels: false,
      }),
    },
    {
      path: 'map_wc/wc_landmarks.json',
      uri: 'CIMPATH=map_wc/wc_landmarks.json',
      def: buildLandmarkLayerDef({
        uri: 'CIMPATH=map_wc/wc_landmarks.json',
        name: 'WC Landmarks & Zones',
        folderRel: '03_WC_Section',
        dataset: 'WC_Landmarks',
      }),
    },
    {
      path: 'map_wabc/all_nodes.json',
      uri: 'CIMPATH=map_wabc/all_nodes.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wabc/all_nodes.json',
        name: 'WABC All Nodes',
        folderRel: '04_Combined_WABC',
        dataset: 'WABC_All_Nodes',
        displayField: 'FEAT_ID',
        labelField: 'FEAT_ID',
        geomType: 'Point',
        renderer: statusUniqueRenderer('STATUS', 'Point'),
      }),
    },
    {
      path: 'map_wabc/all_lines.json',
      uri: 'CIMPATH=map_wabc/all_lines.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wabc/all_lines.json',
        name: 'WABC All Alignments',
        folderRel: '04_Combined_WABC',
        dataset: 'WABC_All_Alignments',
        displayField: 'SEG_ID',
        labelField: 'PIPE_DIA',
        geomType: 'Polyline',
        renderer: statusUniqueRenderer('STATUS', 'Polyline'),
        showLabels: false,
      }),
    },
  ];

  // Build Index Nodes cleanly
  let nextId = 0;
  const indexNodes: Array<{
    NodeId: number;
    NodeType: string;
    FileName: string;
    ChildNodeIds: string;
  }> = [];

  const allocNode = (NodeType: string, FileName: string, ChildNodeIds = '') => {
    const NodeId = nextId++;
    indexNodes.push({ NodeId, NodeType, FileName, ChildNodeIds });
    return NodeId;
  };

  const groundNodeId = allocNode('Layer', 'Map/ground_surface.json');
  const bmWaNodeId = allocNode('Layer', 'map_wa/basemap.json');
  const bmWaRefNodeId = allocNode('Layer', 'map_wa/basemap_ref.json');
  const bmWbNodeId = allocNode('Layer', 'map_wb/basemap.json');
  const bmWbRefNodeId = allocNode('Layer', 'map_wb/basemap_ref.json');
  const bmWcNodeId = allocNode('Layer', 'map_wc/basemap.json');
  const bmWcRefNodeId = allocNode('Layer', 'map_wc/basemap_ref.json');
  const bmAllNodeId = allocNode('Layer', 'map_wabc/basemap.json');
  const bmAllRefNodeId = allocNode('Layer', 'map_wabc/basemap_ref.json');

  defs.forEach((d) => {
    zip.file(d.path, JSON.stringify(d.def));
    const nid = allocNode('Layer', d.path);
    layerFiles.push({ ...d, nodeId: nid });
  });

  const nodeByPath = (p: string) =>
    layerFiles.find((l) => l.path === p)?.nodeId ?? 0;

  // Maps
  const mapWaDef = buildMapDef({
    name: 'WA Map',
    uri: 'CIMPATH=map_wa/map.json',
    layerUris: [
      'CIMPATH=map_wa/wa_landmarks.json',
      'CIMPATH=map_wa/wa_sps.json',
      'CIMPATH=map_wa/wa_shafts.json',
      'CIMPATH=map_wa/wa_tunnels.json',
      bmWaRefUri,
      bmWaUri,
    ],
    groundUri,
    extent: waCam.extent,
  });
  zip.file('map_wa/map.json', JSON.stringify(mapWaDef));
  const mapWaNodeId = allocNode(
    'Map',
    'map_wa/map.json',
    `${groundNodeId},${nodeByPath('map_wa/wa_landmarks.json')},${nodeByPath('map_wa/wa_sps.json')},${nodeByPath('map_wa/wa_shafts.json')},${nodeByPath('map_wa/wa_tunnels.json')},${bmWaRefNodeId},${bmWaNodeId}`
  );

  const mapWbDef = buildMapDef({
    name: 'WB Map',
    uri: 'CIMPATH=map_wb/map.json',
    layerUris: [
      'CIMPATH=map_wb/wb_landmarks.json',
      'CIMPATH=map_wb/wb_tip.json',
      'CIMPATH=map_wb/wb_nodes.json',
      'CIMPATH=map_wb/wb_pipeline.json',
      bmWbRefUri,
      bmWbUri,
    ],
    groundUri,
    extent: wbCam.extent,
  });
  zip.file('map_wb/map.json', JSON.stringify(mapWbDef));
  const mapWbNodeId = allocNode(
    'Map',
    'map_wb/map.json',
    `${groundNodeId},${nodeByPath('map_wb/wb_landmarks.json')},${nodeByPath('map_wb/wb_tip.json')},${nodeByPath('map_wb/wb_nodes.json')},${nodeByPath('map_wb/wb_pipeline.json')},${bmWbRefNodeId},${bmWbNodeId}`
  );

  const mapWcDef = buildMapDef({
    name: 'WC Map',
    uri: 'CIMPATH=map_wc/map.json',
    layerUris: [
      'CIMPATH=map_wc/wc_landmarks.json',
      'CIMPATH=map_wc/wc_shafts.json',
      'CIMPATH=map_wc/wc_tunnels.json',
      bmWcRefUri,
      bmWcUri,
    ],
    groundUri,
    extent: wcCam.extent,
  });
  zip.file('map_wc/map.json', JSON.stringify(mapWcDef));
  const mapWcNodeId = allocNode(
    'Map',
    'map_wc/map.json',
    `${groundNodeId},${nodeByPath('map_wc/wc_landmarks.json')},${nodeByPath('map_wc/wc_shafts.json')},${nodeByPath('map_wc/wc_tunnels.json')},${bmWcRefNodeId},${bmWcNodeId}`
  );

  const mapAllDef = buildMapDef({
    name: 'WABC All Sections',
    uri: 'CIMPATH=map_wabc/map.json',
    layerUris: [
      'CIMPATH=map_wabc/all_nodes.json',
      'CIMPATH=map_wabc/all_lines.json',
      bmAllRefUri,
      bmAllUri,
    ],
    groundUri,
    extent: allCam.extent,
  });
  zip.file('map_wabc/map.json', JSON.stringify(mapAllDef));
  allocNode(
    'Map',
    'map_wabc/map.json',
    `${groundNodeId},${nodeByPath('map_wabc/all_nodes.json')},${nodeByPath('map_wabc/all_lines.json')},${bmAllRefNodeId},${bmAllNodeId}`
  );

  // Layouts (All styled cleanly to match GIS output sample.pdf)
  zip.file(
    'layout_wabc/layout.json',
    JSON.stringify(buildLive3MapLayout(state, 'CIMPATH=layout_wabc/layout.json'))
  );
  allocNode(
    'Layout',
    'layout_wabc/layout.json',
    `${mapWaNodeId},${mapWbNodeId},${mapWcNodeId}`
  );

  zip.file(
    'layout_wabc_vector/layout.json',
    JSON.stringify(
      buildPortableVector3MapLayout(state, 'CIMPATH=layout_wabc_vector/layout.json')
    )
  );
  allocNode('Layout', 'layout_wabc_vector/layout.json', '');

  zip.file(
    'layout_wa/layout.json',
    JSON.stringify(
      buildSinglePortraitLayout({
        kind: 'wa',
        name: 'WA_Layout',
        uri: 'CIMPATH=layout_wa/layout.json',
        mapUri: 'CIMPATH=map_wa/map.json',
        frameName: 'WA Map Frame',
        pts: waPts,
        state,
      })
    )
  );
  allocNode('Layout', 'layout_wa/layout.json', `${mapWaNodeId}`);

  zip.file(
    'layout_wb/layout.json',
    JSON.stringify(
      buildSinglePortraitLayout({
        kind: 'wb',
        name: 'WB_Layout',
        uri: 'CIMPATH=layout_wb/layout.json',
        mapUri: 'CIMPATH=map_wb/map.json',
        frameName: 'WB Map Frame',
        pts: wbPts,
        state,
      })
    )
  );
  allocNode('Layout', 'layout_wb/layout.json', `${mapWbNodeId}`);

  zip.file(
    'layout_wc/layout.json',
    JSON.stringify(
      buildSinglePortraitLayout({
        kind: 'wc',
        name: 'WC_Layout',
        uri: 'CIMPATH=layout_wc/layout.json',
        mapUri: 'CIMPATH=map_wc/map.json',
        frameName: 'WC Map Frame',
        pts: wcPts,
        state,
      })
    )
  );
  allocNode('Layout', 'layout_wc/layout.json', `${mapWcNodeId}`);

  // Index.json
  zip.file(
    'Index.json',
    JSON.stringify(
      {
        DocumentType: 'Index',
        MajorVersion: 1,
        MinorVersion: 0,
        PatchVersion: 0,
        NumberOfNodes: indexNodes.length,
        Nodes: indexNodes,
      },
      null,
      '\t'
    )
  );

  // Views & Project Items in GISProject.json
  const makeMapView = (uri: string, id: number, cam: MercatorCameraResult) => ({
    type: 'CIMMapView',
    viewableObjectPath: uri,
    viewType: 'esri_mapping_mapPane',
    instanceID: id,
    viewingMode: 'Map',
    camera: {
      type: 'CIMViewCamera',
      pitch: -90,
      scale: cam.scale,
      x: cam.x,
      y: cam.y,
      z: 'NaN',
      viewportHeight: cam.viewportHeight,
      viewportWidth: cam.viewportWidth,
    },
    verticalExaggerationScaleFactor: 1,
    timeDisplay: {
      type: 'CIMMapTimeDisplay',
      defaultTimeIntervalUnits: 'esriTimeUnitsUnknown',
      timeRelation: 'esriTimeRelationOverlaps',
    },
    sceneDrawingMode: 'Perspective',
    fieldOfView: 55,
    colorVisionDeficiencyMode: 'None',
  });

  const makeLayoutView = (
    uri: string,
    id: number,
    w: number,
    h: number,
    defaultMapFrameName = 'WA Map Frame'
  ) => ({
    type: 'CIMLayoutView',
    viewableObjectPath: uri,
    viewType: 'esri_layouts_layoutPane',
    instanceID: id,
    extent: { xmin: -25, ymin: -25, xmax: w + 25, ymax: h + 25 },
    defaultMapFrameName,
    colorVisionDeficiencyMode: 'None',
  });

  const views = [
    makeMapView('CIMPATH=map_wa/map.json', 1, waCam),
    makeMapView('CIMPATH=map_wb/map.json', 2, wbCam),
    makeMapView('CIMPATH=map_wc/map.json', 3, wcCam),
    makeLayoutView('CIMPATH=layout_wabc/layout.json', 4, 841, 594, 'WA Map Frame'),
    makeLayoutView('CIMPATH=layout_wabc_vector/layout.json', 5, 841, 594, ''),
    makeLayoutView('CIMPATH=layout_wa/layout.json', 6, 594, 841, 'WA Map Frame'),
    makeLayoutView('CIMPATH=layout_wb/layout.json', 7, 594, 841, 'WB Map Frame'),
    makeLayoutView('CIMPATH=layout_wc/layout.json', 8, 594, 841, 'WC Map Frame'),
  ];

  const activeLayoutInstanceId = standalone ? 5 : 4;
  const viewLayoutXML = buildViewLayoutXml(
    views.map((v) => ({ instanceID: v.instanceID, viewType: v.viewType })),
    activeLayoutInstanceId
  );

  const mapPropXml =
    "<PropertySet xsi:type='typens:PropertySet' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:xs='http://www.w3.org/2001/XMLSchema' xmlns:typens='http://www.esri.com/schemas/ArcGIS/3.3.0'><PropertyArray xsi:type='typens:ArrayOfPropertySetProperty'><PropertySetProperty xsi:type='typens:PropertySetProperty'><Key>ViewingMode</Key><Value xsi:type='xs:string'>Map</Value></PropertySetProperty><PropertySetProperty xsi:type='typens:PropertySetProperty'><Key>MapType</Key><Value xsi:type='xs:string'>Map</Value></PropertySetProperty></PropertyArray></PropertySet>";

  const gisProject = {
    type: 'CIMGISProject',
    views,
    viewLayoutXML,
    moduleSettings: [
      {
        type: 'CIMModuleSettings',
        moduleName: 'esri_datasourcesraster',
        settingsXML:
          '<DataSourcesRasterSettings><StereoMapping><SessionInfos></SessionInfos></StereoMapping></DataSourcesRasterSettings>',
      },
      {
        type: 'CIMModuleSettings',
        moduleName: 'esri_layouts',
        settingsXML: '<LayoutSettings />',
      },
    ],
    projectItems: [
      {
        type: 'CIMProjectItem',
        iD: '11111111-1111-4111-8111-000000000001',
        catalogPath: '.',
        pathHint: '.',
        itemType: 'FolderConnection',
        name: 'WABC_Project_Folder',
        pathSaveRelative: true,
      },
      {
        type: 'CIMProjectItem',
        iD: '11111111-1111-4111-8111-000000000002',
        catalogPath: 'ArcGIS 2D',
        itemType: 'Style',
        name: 'ArcGIS 2D',
      },
      {
        type: 'CIMProjectItem',
        iD: '11111111-1111-4111-8111-000000000003',
        catalogPath: 'ArcGIS Colors',
        itemType: 'Style',
        name: 'ArcGIS Colors',
      },
      {
        type: 'CIMProjectItem',
        iD: '22222222-2222-4222-8222-000000000001',
        catalogPath: 'CIMPATH=map_wa/map.json',
        itemType: 'Map',
        name: 'WA Map',
        propertiesXML: mapPropXml,
        sourceModifiedTime: { type: 'TimeInstant' },
      },
      {
        type: 'CIMProjectItem',
        iD: '22222222-2222-4222-8222-000000000002',
        catalogPath: 'CIMPATH=map_wb/map.json',
        itemType: 'Map',
        name: 'WB Map',
        propertiesXML: mapPropXml,
        sourceModifiedTime: { type: 'TimeInstant' },
      },
      {
        type: 'CIMProjectItem',
        iD: '22222222-2222-4222-8222-000000000003',
        catalogPath: 'CIMPATH=map_wc/map.json',
        itemType: 'Map',
        name: 'WC Map',
        propertiesXML: mapPropXml,
        sourceModifiedTime: { type: 'TimeInstant' },
      },
      {
        type: 'CIMProjectItem',
        iD: '22222222-2222-4222-8222-000000000004',
        catalogPath: 'CIMPATH=map_wabc/map.json',
        itemType: 'Map',
        name: 'WABC All Sections',
        propertiesXML: mapPropXml,
        sourceModifiedTime: { type: 'TimeInstant' },
      },
      {
        type: 'CIMProjectItem',
        iD: '33333333-3333-4333-8333-000000000001',
        catalogPath: 'CIMPATH=layout_wabc/layout.json',
        itemType: 'Layout',
        name: 'WABC_3Map_Layout',
      },
      {
        type: 'CIMProjectItem',
        iD: '33333333-3333-4333-8333-000000000002',
        catalogPath: 'CIMPATH=layout_wabc_vector/layout.json',
        itemType: 'Layout',
        name: 'WABC_3Map_Vector_Layout',
      },
      {
        type: 'CIMProjectItem',
        iD: '33333333-3333-4333-8333-000000000003',
        catalogPath: 'CIMPATH=layout_wa/layout.json',
        itemType: 'Layout',
        name: 'WA_Layout',
      },
      {
        type: 'CIMProjectItem',
        iD: '33333333-3333-4333-8333-000000000004',
        catalogPath: 'CIMPATH=layout_wb/layout.json',
        itemType: 'Layout',
        name: 'WB_Layout',
      },
      {
        type: 'CIMProjectItem',
        iD: '33333333-3333-4333-8333-000000000005',
        catalogPath: 'CIMPATH=layout_wc/layout.json',
        itemType: 'Layout',
        name: 'WC_Layout',
      },
    ],
    defaultFolder: '.',
    sourceModifiedTime: { type: 'TimeInstant' },
  };

  zip.file('GISProject.json', JSON.stringify(gisProject, null, 2));

  return zip.generateAsync({ type: 'uint8array' });
}
