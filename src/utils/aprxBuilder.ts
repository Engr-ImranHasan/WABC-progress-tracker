import JSZip from 'jszip';
import {
  DEFAULT_AIR_VALVE_COORD,
  DEFAULT_WASHOUT_COORD,
} from '../data/wbcInitialData';
import { AppState, WorkStatus } from '../types';
import {
  getShaftStatus,
  getTunnelStatus,
  resolveDisplayContext,
} from './calculations';
import {
  buildGeoViewport,
  computeMetersPerSvgUnit,
  computeWbPolylineSplit,
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

function computeMercatorCamera(
  pts: Array<{ lat: number; lon: number }>,
  frameW_mm: number,
  frameH_mm: number,
  padFrac = 0.14
): {
  extent: { xmin: number; ymin: number; xmax: number; ymax: number };
  x: number;
  y: number;
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
} {
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
  const cosLat = Math.max(0.2, Math.cos((meanLat * Math.PI) / 180));

  // Web Mercator projected span -> map ground scale
  const scaleX = (spanX * cosLat) / frameWm;
  const scaleY = (spanY * cosLat) / frameHm;
  const scale = Math.max(2000, Math.round(Math.max(scaleX, scaleY) * 1.08));

  const viewportWidth = frameWm * (scale / cosLat);
  const viewportHeight = frameHm * (scale / cosLat);

  return {
    extent: { xmin: minX, ymin: minY, xmax: maxX, ymax: maxY },
    x: cx,
    y: cy,
    scale,
    viewportWidth,
    viewportHeight,
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

function circlePointSymbol(r: number, g: number, b: number, sizePt = 8, strokeW = 1.1) {
  const half = sizePt / 2;
  const ring: number[][] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ring.push([
      Number((Math.cos(a) * half).toFixed(4)),
      Number((Math.sin(a) * half).toFixed(4)),
    ]);
  }
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
              geometry: {
                rings: [ring],
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
                    width: strokeW,
                    height3D: 1,
                    anchor3D: 'Center',
                    color: rgbColor(15, 23, 42, 100),
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
  halo = false
) {
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMTextSymbol',
      blockProgression: 'TTB',
      depth3D: 1,
      extrapolateBaselines: true,
      fontEffects: 'Normal',
      fontEncoding: 'Unicode',
      fontFamilyName: 'Arial',
      fontStyleName: bold ? 'Bold' : 'Regular',
      fontType: 'Unspecified',
      haloSize: halo ? 1.5 : 0,
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
      ? circlePointSymbol(22, 163, 74, 8.5, 1.0)
      : solidLineSymbol(22, 163, 74, 2.8);
  const symOngoing =
    geomType === 'Point'
      ? circlePointSymbol(37, 99, 235, 8.5, 1.0)
      : solidLineSymbol(37, 99, 235, 2.8);
  const symRemaining =
    geomType === 'Point'
      ? circlePointSymbol(220, 38, 38, 8.0, 1.0)
      : solidLineSymbol(220, 38, 38, 2.4);
  const symDefault =
    geomType === 'Point'
      ? circlePointSymbol(100, 116, 139, 7.0, 0.8)
      : solidLineSymbol(100, 116, 139, 1.8);

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
            label: 'Ongoing',
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

function buildFeatureLayerDef(opts: {
  uri: string;
  name: string;
  folderRel: string;
  dataset: string;
  displayField: string;
  labelField: string;
  geomType: 'Point' | 'Polyline';
  renderer: Record<string, unknown>;
  showLabels?: boolean;
}) {
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
    labelClasses: [
      {
        type: 'CIMLabelClass',
        expressionTitle: 'Custom',
        expression: `$feature.${opts.labelField}`,
        expressionEngine: 'Arcade',
        featuresToLabel: 'AllVisibleFeatures',
        maplexLabelPlacementProperties: {
          type: 'CIMMaplexLabelPlacementProperties',
          featureType: opts.geomType === 'Point' ? 'Point' : 'Line',
          avoidPolygonHoles: true,
          canOverrunFeature: true,
          canPlaceLabelOutsidePolygon: true,
          canRemoveOverlappingLabel: true,
          canStackLabel: true,
          centerLabelAnchorType: 'Symbol',
          connectionType: opts.geomType === 'Point' ? 'Unambiguous' : 'MinimizeLabels',
          constrainOffset: opts.geomType === 'Point' ? 'NoConstraint' : 'AboveLine',
          contourAlignmentType: 'Page',
          contourLadderType: 'Straight',
          contourMaximumAngle: 90,
          enableConnection: true,
          enablePointPlacementPriorities: true,
          featureWeight: 0,
          fontHeightReductionLimit: 4,
          fontHeightReductionStep: 0.5,
          fontWidthReductionLimit: 90,
          fontWidthReductionStep: 5,
          graticuleAlignmentType: 'Straight',
          keyNumberGroupName: 'Default',
          labelBuffer: 15,
          labelLargestPolygon: true,
          labelPriority: -1,
          minimumFeatureSizeUnit: 'Map',
          multiPartOption: 'OneLabelPerPart',
          neverRemoveLabel: false,
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
          primaryOffset: 2,
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
        name: 'Default',
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
        textSymbol: makeTextSymbol(8.5, [15, 23, 42], true, 'Left', true),
        useCodedValue: true,
        visibility: true,
        iD: -1,
      },
    ],
    labelVisibility: opts.showLabels === false ? 'None' : 'All',
    renderer: opts.renderer,
    scaleSymbols: true,
    snappable: true,
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
    backgroundColor: rgbColor(248, 250, 252, 100),
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

function makeMapFrameElement(opts: {
  name: string;
  mapUri: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pts: Array<{ lat: number; lon: number }>;
}) {
  const cam = computeMercatorCamera(opts.pts, opts.x1 - opts.x0, opts.y1 - opts.y0, 0.14);
  return {
    type: 'CIMMapFrame',
    anchor: 'BottomLeftCorner',
    name: opts.name,
    visible: true,
    rotationCenter: { x: opts.x0, y: opts.y0 },
    customProperties: [
      { type: 'CIMStringMap', key: 'SuppressCredits', value: 'false' },
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
              width: 1.2,
              height3D: 1,
              anchor3D: 'Center',
              color: rgbColor(30, 58, 138, 100),
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
  halo = false
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
      symbol: makeTextSymbol(heightPt, rgb, bold, align, halo),
    },
  };
}

function statusToRgb(st: WorkStatus): [number, number, number] {
  if (st === 'complete') return [22, 163, 74];
  if (st === 'ongoing') return [37, 99, 235];
  return [220, 38, 38];
}

/**
 * Generates a 100% self-contained pure-JSON A1 Landscape Layout (`841 x 594 mm`)
 * showing WA Map, WB Map, and WC Map side by side using native CIMGraphicElements
 * so even standalone .aprx downloads without external .shp folders render immediately!
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

  const elements: Array<Record<string, unknown>> = [];

  // Outer Neatline Border & Header Banner
  elements.push(
    makePolygonGraphicElement(
      'Page_Border',
      rectRing(8, 8, PAGE_W - 8, PAGE_H - 8),
      [255, 255, 255, 0],
      [15, 23, 42, 100],
      1.4
    )
  );
  elements.push(
    makePolygonGraphicElement(
      'Header_Banner',
      rectRing(14, PAGE_H - 40, PAGE_W - 14, PAGE_H - 12),
      [15, 23, 42, 100],
      [30, 58, 138, 100],
      0.8
    )
  );
  elements.push(
    makeTextGraphicElement(
      'Title_Main',
      `DHAKA SANITATION IMPROVEMENT PROJECT (DSIP) - PACKAGE WD-02 | WA, WB & WC PROGRESS OVERVIEW`,
      PAGE_W / 2,
      PAGE_H - 22,
      14,
      [255, 255, 255],
      true,
      'Center'
    )
  );
  elements.push(
    makeTextGraphicElement(
      'Title_Sub',
      `Report Date: ${state.settings.reportDate}  |  View: ${state.viewMode.toUpperCase()}  |  Client: ${state.settings.clientName}  |  Contractor: ${state.settings.contractorName}`,
      PAGE_W / 2,
      PAGE_H - 33,
      8.5,
      [191, 219, 254],
      false,
      'Center'
    )
  );

  // 3 Map Panel Boxes (ArcGIS Pro layout coordinates have Y=0 at bottom-left!)
  // Convert top-down screen y -> ArcGIS Pro bottom-up page y: `py = boxTop - (screenY - top)`
  const panels = [
    { id: 'WA', title: 'WA MAP: SEWER & GOLAPBAG SPS (37 SHAFTS)', x0: 14, x1: 279, y0: 44, y1: 536, accent: [21, 128, 61] as [number, number, number] },
    { id: 'WB', title: 'WB MAP: HDPE PIPELINE (38 NODES / 2,520m)', x0: 288, x1: 553, y0: 44, y1: 536, accent: [29, 78, 216] as [number, number, number] },
    { id: 'WC', title: 'WC MAP: SEWER MICROTUNNELLING (27 SHAFTS)', x0: 562, x1: 827, y0: 44, y1: 536, accent: [126, 34, 206] as [number, number, number] },
  ];

  panels.forEach((pan) => {
    const pw = pan.x1 - pan.x0;
    const ph = pan.y1 - pan.y0;
    // Panel frame background + border
    elements.push(
      makePolygonGraphicElement(
        `${pan.id}_Panel_Bg`,
        rectRing(pan.x0, pan.y0, pan.x1, pan.y1),
        [248, 250, 252, 100],
        [30, 58, 138, 100],
        1.1
      )
    );
    // Panel Header Bar
    elements.push(
      makePolygonGraphicElement(
        `${pan.id}_Panel_Header`,
        rectRing(pan.x0, pan.y1 - 18, pan.x1, pan.y1),
        [239, 246, 255, 100],
        [30, 58, 138, 100],
        0.8
      )
    );
    elements.push(
      makeTextGraphicElement(
        `${pan.id}_Panel_Title`,
        pan.title,
        pan.x0 + pw / 2,
        pan.y1 - 9,
        9.2,
        pan.accent,
        true,
        'Center'
      )
    );

    const mapX0 = pan.x0 + 6;
    const mapY0 = pan.y0 + 6;
    const mapW = pw - 12;
    const mapH = ph - 28;

    // Helper: screen-space VP (top-down 0..mapH) -> ArcGIS bottom-up page coords
    const makePanelProj = (pts: Array<{ lat: number; lon: number }>) => {
      const vp = buildGeoViewport(pts, 0, 0, mapW, mapH, 0.12);
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

    // Subtle Grid Lines
    for (let g = 1; g <= 4; g++) {
      const gx = mapX0 + (mapW * g) / 5;
      const gy = mapY0 + (mapH * g) / 5;
      elements.push(
        makeLineGraphicElement(`${pan.id}_GridV_${g}`, [[[gx, mapY0], [gx, mapY0 + mapH]]], [226, 232, 240], 0.4)
      );
      elements.push(
        makeLineGraphicElement(`${pan.id}_GridH_${g}`, [[[mapX0, gy], [mapX0 + mapW, gy]]], [226, 232, 240], 0.4)
      );
    }

    if (pan.id === 'WA') {
      const { vp, toPage, screenToPage } = makePanelProj([...waGeo, sps]);
      const shaftById = new Map(waShafts.map((s) => [s.id, s]));
      const spsP = toPage(sps.lat, sps.lon);
      // Tunnels
      waGeo.forEach((gNode, idx) => {
        const p1 = toPage(gNode.lat, gNode.lon);
        const p2 = idx < waGeo.length - 1 ? toPage(waGeo[idx + 1].lat, waGeo[idx + 1].lon) : spsP;
        const sh = shaftById.get(gNode.id);
        const rgb = statusToRgb(sh ? getTunnelStatus(sh) : 'remaining');
        elements.push(
          makeLineGraphicElement(`WA_Tun_${gNode.id}`, [[[p1.x, p1.y], [p2.x, p2.y]]], rgb, 2.6)
        );
      });
      // Shafts
      const lblInputs: MapLabelInput[] = [];
      waGeo.forEach((gNode, idx) => {
        const p = toPage(gNode.lat, gNode.lon);
        const sh = shaftById.get(gNode.id);
        const rgb = statusToRgb(sh ? getShaftStatus(sh) : 'remaining');
        elements.push(
          makePolygonGraphicElement(
            `WA_Pt_${gNode.id}`,
            rectRing(p.x - 1.9, p.y - 1.9, p.x + 1.9, p.y + 1.9),
            [rgb[0], rgb[1], rgb[2], 100],
            [15, 23, 42, 100],
            0.5
          )
        );
        lblInputs.push({
          id: gNode.id,
          text: gNode.id,
          px: p.sx,
          py: p.sy,
          markerRadius: 2.6,
          priority: idx === 0 || idx === waGeo.length - 1 ? 90 : idx % 2 === 0 ? 60 : 40,
          mustPlace: true,
        });
      });
      // Golapbag SPS box
      elements.push(
        makePolygonGraphicElement(
          'WA_SPS_Box',
          rectRing(spsP.x - 5.5, spsP.y - 3.2, spsP.x + 5.5, spsP.y + 3.2),
          [251, 207, 232, 100],
          [157, 23, 77, 100],
          0.9
        )
      );
      elements.push(
        makeTextGraphicElement('WA_SPS_Txt', 'SPS', spsP.x, spsP.y, 6.2, [131, 24, 67], true, 'Center')
      );
      // Zero-overlap labels
      const placed = layoutMapLabels(
        lblInputs,
        { x: 0, y: 0, w: mapW, h: mapH },
        { fontSize: 5.5, maxTier: 5, padding: 2.0 }
      );
      placed.forEach((lbl) => {
        const pt = screenToPage(lbl.textX, lbl.textY - 1.5);
        if (lbl.needsLeader) {
          const p0 = screenToPage(lbl.px, lbl.py);
          const p2 = screenToPage(lbl.leaderX2, lbl.leaderY2);
          elements.push(makeLineGraphicElement(`WA_Ldr_${lbl.id}`, [[[p0.x, p0.y], [p2.x, p2.y]]], [100, 116, 139], 0.4));
        }
        elements.push(
          makeTextGraphicElement(`WA_Lbl_${lbl.id}`, lbl.text, pt.x, pt.y, 5.8, [15, 23, 42], true, 'Center', true)
        );
      });
      // Scale note
      const mPerUnit = computeMetersPerSvgUnit(vp);
      const barMm = Math.min(60, Math.max(25, 500 / Math.max(0.1, mPerUnit)));
      elements.push(
        makeLineGraphicElement('WA_Scale', [[[mapX0 + mapW - barMm - 6, mapY0 + 8], [mapX0 + mapW - 6, mapY0 + 8]]], [15, 23, 42], 1.8)
      );
      elements.push(
        makeTextGraphicElement('WA_ScaleTxt', '0       500 m', mapX0 + mapW - barMm / 2 - 6, mapY0 + 12, 6, [15, 23, 42], true, 'Center')
      );
    } else if (pan.id === 'WB') {
      const wash = wb.washoutCoord || DEFAULT_WASHOUT_COORD;
      const airv = wb.airValveCoord || DEFAULT_AIR_VALVE_COORD;
      const { vp, toPage, screenToPage } = makePanelProj([...wb.nodes, wash, airv]);
      const split = computeWbPolylineSplit(wb.nodes, wb.totalLengthM, wb.completedLengthM);
      if (split.remainingPoints.length >= 2) {
        elements.push(
          makeLineGraphicElement(
            'WB_Line_Rem',
            [split.remainingPoints.map((pt) => { const q = toPage(pt.lat, pt.lon); return [q.x, q.y]; })],
            [220, 38, 38],
            2.6
          )
        );
      }
      if (split.prevPoints.length >= 2) {
        elements.push(
          makeLineGraphicElement(
            'WB_Line_Done',
            [split.prevPoints.map((pt) => { const q = toPage(pt.lat, pt.lon); return [q.x, q.y]; })],
            [22, 163, 74],
            3.2
          )
        );
      }
      const lblInputs: MapLabelInput[] = [];
      wb.nodes.forEach((n, idx) => {
        const p = toPage(n.lat, n.lon);
        const rgb = statusToRgb(n.status);
        elements.push(
          makePolygonGraphicElement(
            `WB_Pt_${n.id}`,
            rectRing(p.x - 1.8, p.y - 1.8, p.x + 1.8, p.y + 1.8),
            [rgb[0], rgb[1], rgb[2], 100],
            [15, 23, 42, 100],
            0.5
          )
        );
        lblInputs.push({
          id: n.id,
          text: n.id,
          px: p.sx,
          py: p.sy,
          markerRadius: 2.5,
          priority: idx === 0 || idx === wb.nodes.length - 1 ? 90 : idx % 2 === 0 ? 60 : 40,
          mustPlace: true,
        });
      });
      const tipP = toPage(split.tipPoint.lat, split.tipPoint.lon);
      elements.push(
        makePolygonGraphicElement(
          'WB_Tip_Marker',
          rectRing(tipP.x - 2.6, tipP.y - 2.6, tipP.x + 2.6, tipP.y + 2.6),
          [37, 99, 235, 100],
          [255, 255, 255, 100],
          0.9
        )
      );
      const placed = layoutMapLabels(
        lblInputs,
        { x: 0, y: 0, w: mapW, h: mapH },
        { fontSize: 5.4, maxTier: 5, padding: 2.0 }
      );
      placed.forEach((lbl) => {
        const pt = screenToPage(lbl.textX, lbl.textY - 1.5);
        if (lbl.needsLeader) {
          const p0 = screenToPage(lbl.px, lbl.py);
          const p2 = screenToPage(lbl.leaderX2, lbl.leaderY2);
          elements.push(makeLineGraphicElement(`WB_Ldr_${lbl.id}`, [[[p0.x, p0.y], [p2.x, p2.y]]], [100, 116, 139], 0.4));
        }
        elements.push(
          makeTextGraphicElement(`WB_Lbl_${lbl.id}`, lbl.text, pt.x, pt.y, 5.6, [15, 23, 42], true, 'Center', true)
        );
      });
      const mPerUnit = computeMetersPerSvgUnit(vp);
      const barMm = Math.min(60, Math.max(25, 500 / Math.max(0.1, mPerUnit)));
      elements.push(
        makeLineGraphicElement('WB_Scale', [[[mapX0 + mapW - barMm - 6, mapY0 + 8], [mapX0 + mapW - 6, mapY0 + 8]]], [15, 23, 42], 1.8)
      );
      elements.push(
        makeTextGraphicElement('WB_ScaleTxt', '0       500 m', mapX0 + mapW - barMm / 2 - 6, mapY0 + 12, 6, [15, 23, 42], true, 'Center')
      );
    } else {
      const { vp, toPage, screenToPage } = makePanelProj(wc.geoNodes);
      const shaftById = new Map(wc.shafts.map((s) => [s.id, s]));
      wc.geoNodes.slice(0, -1).forEach((gNode, idx) => {
        const nextNode = wc.geoNodes[idx + 1];
        const p1 = toPage(gNode.lat, gNode.lon);
        const p2 = toPage(nextNode.lat, nextNode.lon);
        const sh = shaftById.get(gNode.id);
        const rgb = statusToRgb(sh ? getTunnelStatus(sh) : 'remaining');
        elements.push(
          makeLineGraphicElement(`WC_Tun_${gNode.id}`, [[[p1.x, p1.y], [p2.x, p2.y]]], rgb, 2.6)
        );
      });
      const lblInputs: MapLabelInput[] = [];
      wc.geoNodes.forEach((gNode, idx) => {
        const p = toPage(gNode.lat, gNode.lon);
        const sh = shaftById.get(gNode.id);
        const rgb = statusToRgb(sh ? getShaftStatus(sh) : 'remaining');
        elements.push(
          makePolygonGraphicElement(
            `WC_Pt_${gNode.id}`,
            rectRing(p.x - 1.9, p.y - 1.9, p.x + 1.9, p.y + 1.9),
            [rgb[0], rgb[1], rgb[2], 100],
            [15, 23, 42, 100],
            0.5
          )
        );
        lblInputs.push({
          id: gNode.id,
          text: gNode.id,
          px: p.sx,
          py: p.sy,
          markerRadius: 2.6,
          priority: idx === 0 || idx === wc.geoNodes.length - 1 ? 90 : idx % 2 === 0 ? 60 : 40,
          mustPlace: true,
        });
      });
      const placed = layoutMapLabels(
        lblInputs,
        { x: 0, y: 0, w: mapW, h: mapH },
        { fontSize: 5.5, maxTier: 5, padding: 2.0 }
      );
      placed.forEach((lbl) => {
        const pt = screenToPage(lbl.textX, lbl.textY - 1.5);
        if (lbl.needsLeader) {
          const p0 = screenToPage(lbl.px, lbl.py);
          const p2 = screenToPage(lbl.leaderX2, lbl.leaderY2);
          elements.push(makeLineGraphicElement(`WC_Ldr_${lbl.id}`, [[[p0.x, p0.y], [p2.x, p2.y]]], [100, 116, 139], 0.4));
        }
        elements.push(
          makeTextGraphicElement(`WC_Lbl_${lbl.id}`, lbl.text, pt.x, pt.y, 5.8, [15, 23, 42], true, 'Center', true)
        );
      });
      const mPerUnit = computeMetersPerSvgUnit(vp);
      const barMm = Math.min(60, Math.max(25, 500 / Math.max(0.1, mPerUnit)));
      elements.push(
        makeLineGraphicElement('WC_Scale', [[[mapX0 + mapW - barMm - 6, mapY0 + 8], [mapX0 + mapW - 6, mapY0 + 8]]], [15, 23, 42], 1.8)
      );
      elements.push(
        makeTextGraphicElement('WC_ScaleTxt', '0       500 m', mapX0 + mapW - barMm / 2 - 6, mapY0 + 12, 6, [15, 23, 42], true, 'Center')
      );
    }

    // North Arrow N at top-right of each panel
    elements.push(
      makeTextGraphicElement(`${pan.id}_North`, 'N ▲', pan.x1 - 12, pan.y1 - 27, 8.5, [30, 58, 138], true, 'Center')
    );
  });

  // Bottom Status Legend Footer Bar
  elements.push(
    makePolygonGraphicElement(
      'Legend_Bar',
      rectRing(14, 14, PAGE_W - 14, 38),
      [248, 250, 252, 100],
      [148, 163, 184, 100],
      0.8
    )
  );
  const legItems: Array<{ label: string; rgb: [number, number, number]; x: number }> = [
    { label: 'Complete (100%)', rgb: [22, 163, 74], x: 30 },
    { label: 'On-Going / Active', rgb: [37, 99, 235], x: 185 },
    { label: 'Remaining', rgb: [220, 38, 38], x: 345 },
    { label: 'Golapbag SPS', rgb: [219, 39, 119], x: 485 },
  ];
  legItems.forEach((li) => {
    elements.push(
      makePolygonGraphicElement(
        `Leg_${li.label}`,
        rectRing(li.x, 22, li.x + 12, 30),
        [li.rgb[0], li.rgb[1], li.rgb[2], 100],
        [15, 23, 42, 100],
        0.6
      )
    );
    elements.push(
      makeTextGraphicElement(`LegTxt_${li.label}`, li.label, li.x + 16, 26, 8.5, [15, 23, 42], true, 'Left')
    );
  });
  elements.push(
    makeTextGraphicElement(
      'Footer_Note',
      'ArcGIS Pro 3.5.0 Ready | All 3 Sections (WA + WB + WC) in 1 Printable Layout | WABC Progress Studio',
      PAGE_W - 24,
      26,
      8.0,
      [71, 85, 105],
      true,
      'Right'
    )
  );

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

  const elements: Array<Record<string, unknown>> = [
    makePolygonGraphicElement(
      'Page_Border',
      rectRing(8, 8, PAGE_W - 8, PAGE_H - 8),
      [255, 255, 255, 0],
      [15, 23, 42, 100],
      1.4
    ),
    makePolygonGraphicElement(
      'Header_Banner',
      rectRing(14, PAGE_H - 40, PAGE_W - 14, PAGE_H - 12),
      [15, 23, 42, 100],
      [30, 58, 138, 100],
      0.8
    ),
    makeTextGraphicElement(
      'Title_Main',
      'DHAKA SANITATION IMPROVEMENT PROJECT (DSIP) - PACKAGE WD-02 | WA, WB & WC PROGRESS LAYOUT',
      PAGE_W / 2,
      PAGE_H - 22,
      14,
      [255, 255, 255],
      true,
      'Center'
    ),
    makeTextGraphicElement(
      'Title_Sub',
      `Report Date: ${state.settings.reportDate}  |  View: ${state.viewMode.toUpperCase()}  |  Client: ${state.settings.clientName}`,
      PAGE_W / 2,
      PAGE_H - 33,
      8.5,
      [191, 219, 254],
      false,
      'Center'
    ),
    // Panel Headers above the 3 Live Map Frames
    makePolygonGraphicElement(
      'WA_Hdr_Box',
      rectRing(14, 520, 279, 538),
      [240, 253, 244, 100],
      [21, 128, 61, 100],
      0.9
    ),
    makeTextGraphicElement('WA_Hdr_Txt', 'WA MAP (37 SHAFTS & GOLAPBAG SPS)', 146.5, 529, 9.2, [21, 128, 61], true, 'Center'),
    makeMapFrameElement({
      name: 'WA Map Frame',
      mapUri: 'CIMPATH=map_wa/map.json',
      x0: 14,
      y0: 44,
      x1: 279,
      y1: 518,
      pts: waPts,
    }),

    makePolygonGraphicElement(
      'WB_Hdr_Box',
      rectRing(288, 520, 553, 538),
      [239, 246, 255, 100],
      [29, 78, 216, 100],
      0.9
    ),
    makeTextGraphicElement('WB_Hdr_Txt', 'WB MAP (HDPE PIPELINE 2,520m)', 420.5, 529, 9.2, [29, 78, 216], true, 'Center'),
    makeMapFrameElement({
      name: 'WB Map Frame',
      mapUri: 'CIMPATH=map_wb/map.json',
      x0: 288,
      y0: 44,
      x1: 553,
      y1: 518,
      pts: wbPts,
    }),

    makePolygonGraphicElement(
      'WC_Hdr_Box',
      rectRing(562, 520, 827, 538),
      [250, 245, 255, 100],
      [126, 34, 206, 100],
      0.9
    ),
    makeTextGraphicElement('WC_Hdr_Txt', 'WC MAP (27 SHAFTS MICROTUNNELLING)', 694.5, 529, 9.2, [126, 34, 206], true, 'Center'),
    makeMapFrameElement({
      name: 'WC Map Frame',
      mapUri: 'CIMPATH=map_wc/map.json',
      x0: 562,
      y0: 44,
      x1: 827,
      y1: 518,
      pts: wcPts,
    }),

    // Bottom Legend Strip
    makePolygonGraphicElement(
      'Legend_Bar',
      rectRing(14, 14, PAGE_W - 14, 38),
      [248, 250, 252, 100],
      [148, 163, 184, 100],
      0.8
    ),
    makePolygonGraphicElement('Leg_C', rectRing(30, 22, 42, 30), [22, 163, 74, 100], [15, 23, 42, 100], 0.6),
    makeTextGraphicElement('Leg_C_Txt', 'Complete (100%)', 46, 26, 8.5, [15, 23, 42], true, 'Left'),
    makePolygonGraphicElement('Leg_O', rectRing(175, 22, 187, 30), [37, 99, 235, 100], [15, 23, 42, 100], 0.6),
    makeTextGraphicElement('Leg_O_Txt', 'On-Going / Active', 191, 26, 8.5, [15, 23, 42], true, 'Left'),
    makePolygonGraphicElement('Leg_R', rectRing(335, 22, 347, 30), [220, 38, 38, 100], [15, 23, 42, 100], 0.6),
    makeTextGraphicElement('Leg_R_Txt', 'Remaining', 351, 26, 8.5, [15, 23, 42], true, 'Left'),
    makePolygonGraphicElement('Leg_S', rectRing(455, 22, 467, 30), [219, 39, 119, 100], [15, 23, 42, 100], 0.6),
    makeTextGraphicElement('Leg_S_Txt', 'Golapbag SPS', 471, 26, 8.5, [15, 23, 42], true, 'Left'),
    makeTextGraphicElement(
      'Footer_Note',
      'Share -> Export Layout -> PDF in ArcGIS Pro 3.5.0 | WABC Progress Studio',
      PAGE_W - 24,
      26,
      8.0,
      [71, 85, 105],
      true,
      'Right'
    ),
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

function buildSinglePortraitLayout(opts: {
  name: string;
  uri: string;
  title: string;
  mapUri: string;
  frameName: string;
  pts: Array<{ lat: number; lon: number }>;
  reportDate: string;
}) {
  const PAGE_W = 594;
  const PAGE_H = 841;
  return {
    type: 'CIMLayout',
    name: opts.name,
    uRI: opts.uri,
    sourceModifiedTime: { type: 'TimeInstant' },
    useSourceMetadata: true,
    elements: [
      makePolygonGraphicElement(
        'Page_Border',
        rectRing(10, 10, PAGE_W - 10, PAGE_H - 10),
        [255, 255, 255, 0],
        [15, 23, 42, 100],
        1.4
      ),
      makePolygonGraphicElement(
        'Header_Banner',
        rectRing(16, PAGE_H - 46, PAGE_W - 16, PAGE_H - 14),
        [15, 23, 42, 100],
        [30, 58, 138, 100],
        0.8
      ),
      makeTextGraphicElement(
        'Title',
        opts.title,
        PAGE_W / 2,
        PAGE_H - 27,
        13,
        [255, 255, 255],
        true,
        'Center'
      ),
      makeTextGraphicElement(
        'Subtitle',
        `Dhaka Sanitation Improvement Project (DSIP) - WD-02 | Date: ${opts.reportDate}`,
        PAGE_W / 2,
        PAGE_H - 39,
        8.5,
        [191, 219, 254],
        false,
        'Center'
      ),
      makeMapFrameElement({
        name: opts.frameName,
        mapUri: opts.mapUri,
        x0: 16,
        y0: 20,
        x1: PAGE_W - 16,
        y1: PAGE_H - 52,
        pts: opts.pts,
      }),
    ],
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
 * Generates an ArcGIS Pro 3.3–3.5+ `.aprx` project binary (Uint8Array ZIP) containing:
 * - WA Map, WB Map, WC Map, WABC All Sections (with live Esri World Light Gray Basemap + relative Shapefile layers + UniqueValueRenderer + Maplex Labels)
 * - WABC_3Map_Layout (all 3 live MapFrames in 1 A1 Landscape layout)
 * - WABC_3Map_Vector_Layout (100% self-contained vector 3-map layout in 1 A1 Landscape sheet for standalone opening without external .shp folders)
 * - WA_Layout, WB_Layout, WC_Layout (individual A1 Portrait layouts)
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

  const waCam = computeMercatorCamera(waPts, 265, 474, 0.14);
  const wbCam = computeMercatorCamera(wbPts, 265, 474, 0.14);
  const wcCam = computeMercatorCamera(wcPts, 265, 474, 0.14);
  const allCam = computeMercatorCamera(allPts, 550, 760, 0.14);

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
  const bmWbUri = 'CIMPATH=map_wb/basemap.json';
  const bmWcUri = 'CIMPATH=map_wc/basemap.json';
  const bmAllUri = 'CIMPATH=map_wabc/basemap.json';
  zip.file('map_wa/basemap.json', JSON.stringify(buildBasemapLayer(bmWaUri)));
  zip.file('map_wb/basemap.json', JSON.stringify(buildBasemapLayer(bmWbUri)));
  zip.file('map_wc/basemap.json', JSON.stringify(buildBasemapLayer(bmWcUri)));
  zip.file('map_wabc/basemap.json', JSON.stringify(buildBasemapLayer(bmAllUri)));

  // Feature Layers (Shapefile relative connections matching 01_WA_Section..04_Combined_WABC)
  const spsRenderer = {
    type: 'CIMSimpleRenderer',
    sampleSize: 10000,
    patch: 'Default',
    symbol: circlePointSymbol(219, 39, 119, 12, 1.4),
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
        labelField: 'SHAFT_ID',
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
        renderer: statusUniqueRenderer('TUN_STAT', 'Polyline'),
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
        geomType: 'Point',
        renderer: spsRenderer,
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
        labelField: 'NODE_ID',
        geomType: 'Point',
        renderer: statusUniqueRenderer('STATUS', 'Point'),
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
      path: 'map_wc/wc_shafts.json',
      uri: 'CIMPATH=map_wc/wc_shafts.json',
      def: buildFeatureLayerDef({
        uri: 'CIMPATH=map_wc/wc_shafts.json',
        name: 'WC Shafts',
        folderRel: '03_WC_Section',
        dataset: 'WC_Shafts',
        displayField: 'SHAFT_ID',
        labelField: 'SHAFT_ID',
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
        renderer: statusUniqueRenderer('TUN_STAT', 'Polyline'),
        showLabels: false,
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
        displayField: 'LINE_ID',
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
  const bmWbNodeId = allocNode('Layer', 'map_wb/basemap.json');
  const bmWcNodeId = allocNode('Layer', 'map_wc/basemap.json');
  const bmAllNodeId = allocNode('Layer', 'map_wabc/basemap.json');

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
      'CIMPATH=map_wa/wa_sps.json',
      'CIMPATH=map_wa/wa_shafts.json',
      'CIMPATH=map_wa/wa_tunnels.json',
      bmWaUri,
    ],
    groundUri,
    extent: waCam.extent,
  });
  zip.file('map_wa/map.json', JSON.stringify(mapWaDef));
  const mapWaNodeId = allocNode(
    'Map',
    'map_wa/map.json',
    `${groundNodeId},${nodeByPath('map_wa/wa_sps.json')},${nodeByPath('map_wa/wa_shafts.json')},${nodeByPath('map_wa/wa_tunnels.json')},${bmWaNodeId}`
  );

  const mapWbDef = buildMapDef({
    name: 'WB Map',
    uri: 'CIMPATH=map_wb/map.json',
    layerUris: [
      'CIMPATH=map_wb/wb_nodes.json',
      'CIMPATH=map_wb/wb_pipeline.json',
      bmWbUri,
    ],
    groundUri,
    extent: wbCam.extent,
  });
  zip.file('map_wb/map.json', JSON.stringify(mapWbDef));
  const mapWbNodeId = allocNode(
    'Map',
    'map_wb/map.json',
    `${groundNodeId},${nodeByPath('map_wb/wb_nodes.json')},${nodeByPath('map_wb/wb_pipeline.json')},${bmWbNodeId}`
  );

  const mapWcDef = buildMapDef({
    name: 'WC Map',
    uri: 'CIMPATH=map_wc/map.json',
    layerUris: [
      'CIMPATH=map_wc/wc_shafts.json',
      'CIMPATH=map_wc/wc_tunnels.json',
      bmWcUri,
    ],
    groundUri,
    extent: wcCam.extent,
  });
  zip.file('map_wc/map.json', JSON.stringify(mapWcDef));
  const mapWcNodeId = allocNode(
    'Map',
    'map_wc/map.json',
    `${groundNodeId},${nodeByPath('map_wc/wc_shafts.json')},${nodeByPath('map_wc/wc_tunnels.json')},${bmWcNodeId}`
  );

  const mapAllDef = buildMapDef({
    name: 'WABC All Sections',
    uri: 'CIMPATH=map_wabc/map.json',
    layerUris: [
      'CIMPATH=map_wabc/all_nodes.json',
      'CIMPATH=map_wabc/all_lines.json',
      bmAllUri,
    ],
    groundUri,
    extent: allCam.extent,
  });
  zip.file('map_wabc/map.json', JSON.stringify(mapAllDef));
  allocNode(
    'Map',
    'map_wabc/map.json',
    `${groundNodeId},${nodeByPath('map_wabc/all_nodes.json')},${nodeByPath('map_wabc/all_lines.json')},${bmAllNodeId}`
  );

  // Layouts
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
        name: 'WA_Layout',
        uri: 'CIMPATH=layout_wa/layout.json',
        title: 'WA SECTION PROGRESS MAP (37 SHAFTS & GOLAPBAG SPS)',
        mapUri: 'CIMPATH=map_wa/map.json',
        frameName: 'WA Map Frame',
        pts: waPts,
        reportDate: state.settings.reportDate,
      })
    )
  );
  allocNode('Layout', 'layout_wa/layout.json', `${mapWaNodeId}`);

  zip.file(
    'layout_wb/layout.json',
    JSON.stringify(
      buildSinglePortraitLayout({
        name: 'WB_Layout',
        uri: 'CIMPATH=layout_wb/layout.json',
        title: 'WB SECTION PROGRESS MAP (HDPE TRANSMISSION PIPELINE)',
        mapUri: 'CIMPATH=map_wb/map.json',
        frameName: 'WB Map Frame',
        pts: wbPts,
        reportDate: state.settings.reportDate,
      })
    )
  );
  allocNode('Layout', 'layout_wb/layout.json', `${mapWbNodeId}`);

  zip.file(
    'layout_wc/layout.json',
    JSON.stringify(
      buildSinglePortraitLayout({
        name: 'WC_Layout',
        uri: 'CIMPATH=layout_wc/layout.json',
        title: 'WC SECTION PROGRESS MAP (27 SHAFTS MICROTUNNELLING)',
        mapUri: 'CIMPATH=map_wc/map.json',
        frameName: 'WC Map Frame',
        pts: wcPts,
        reportDate: state.settings.reportDate,
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
  const makeMapView = (uri: string, id: number, cam: ReturnType<typeof computeMercatorCamera>) => ({
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
    extent: { xmin: -30, ymin: -30, xmax: w + 30, ymax: h + 30 },
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

export async function exportArcGisProAprxFile(state: AppState): Promise<void> {
  const bytes = await buildWabcAprxUint8Array(state, { standalone: true });
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const reportDate = state.settings.reportDate || 'report';
  const a = document.createElement('a');
  a.href = url;
  a.download = `WABC-Progress-Maps-${reportDate}.aprx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
