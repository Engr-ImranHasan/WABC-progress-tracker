import { PipeDia, ShaftRecord, WbNodeRecord, WbSectionData, WcGeoNode, WcSectionData } from '../types';

export const RAW_WA_COORDS: Array<[string, number, number]> = [
  ['WA-1', 23.7585602, 90.4137276],
  ['WA-2', 23.7583174, 90.4141384],
  ['WA-3', 23.7583407, 90.4157532],
  ['WA-4', 23.7583946, 90.4171098],
  ['WA-5', 23.7586616, 90.4181422],
  ['WA-6', 23.7591365, 90.4196716],
  ['WA-7', 23.7581958, 90.4214719],
  ['WA-8', 23.7577041, 90.4223643],
  ['WA-9', 23.7568686, 90.4239724],
  ['WA-10', 23.7558828, 90.4258397],
  ['WA-11', 23.7551821, 90.4271254],
  ['WA-12', 23.7542693, 90.42881],
  ['WA-13', 23.753204, 90.4308277],
  ['WA-14', 23.7525311, 90.4324509],
  ['WA-15', 23.7517619, 90.4323557],
  ['WA-16', 23.7500356, 90.4326835],
  ['WA-17', 23.7484938, 90.4332435],
  ['WA-18', 23.747409, 90.4335341],
  ['WA-19', 23.7458404, 90.4337975],
  ['WA-20', 23.744198, 90.4340195],
  ['WA-21', 23.7430311, 90.4341834],
  ['WA-22', 23.7407569, 90.4349376],
  ['WA-23', 23.7386511, 90.4357143],
  ['WA-24', 23.7366807, 90.4354206],
  ['WA-24.1', 23.7343263, 90.4350698],
  ['WA-25', 23.7328192, 90.434828],
  ['WA-26', 23.7311847, 90.4345924],
  ['WA-27', 23.7287133, 90.4342162],
  ['WA-28', 23.727115, 90.4339755],
  ['WA-29', 23.725717, 90.4338584],
  ['WA-30', 23.7256443, 90.4337595],
  ['WA-31', 23.7243029, 90.433572],
  ['WA-32', 23.7225791, 90.4333518],
  ['WA-33', 23.7224866, 90.4326649],
  ['WA-34', 23.7208713, 90.4321709],
  ['WA-35', 23.7196238, 90.4319089],
  ['WA-36', 23.7194332, 90.432792],
];

export const INITIAL_WA_GEO_NODES: Array<{ id: string; lat: number; lon: number }> =
  RAW_WA_COORDS.map(([id, lat, lon]) => ({ id, lat, lon }));

export const GOLAPBAG_SPS_COORD = { lat: 23.72032, lon: 90.43282 };
export const DEFAULT_WASHOUT_COORD = { lat: 23.7174873, lon: 90.43072 };
export const DEFAULT_AIR_VALVE_COORD = { lat: 23.71053, lon: 90.4245374 };

const RAW_WB_COORDS: Array<[string, number, number]> = [
  ['WB1', 23.7195161, 90.4326567],
  ['WB2', 23.7194497, 90.4326549],
  ['WB3', 23.7194403, 90.4326315],
  ['WB4', 23.719453, 90.4325341],
  ['WB5', 23.7195833, 90.4320413],
  ['WB6', 23.7195382, 90.4319246],
  ['WB7', 23.7193042, 90.4318811],
  ['WB8', 23.7185772, 90.431805],
  ['WB9', 23.7181241, 90.4315499],
  ['WB10', 23.7177338, 90.4313069],
  ['WB11', 23.7176371, 90.4312251],
  ['WB12', 23.7174873, 90.4310573],
  ['WB13', 23.7172845, 90.4312189],
  ['WB14', 23.7162824, 90.4310692],
  ['WB15', 23.7158164, 90.4311093],
  ['WB16', 23.7149963, 90.4310856],
  ['WB17', 23.7141716, 90.4310947],
  ['WB18', 23.7133929, 90.4308526],
  ['WB19', 23.71291, 90.430662],
  ['WB20', 23.7126574, 90.4304279],
  ['WB21', 23.712013, 90.4296912],
  ['WB22', 23.7119127, 90.4295772],
  ['WB23', 23.7118695, 90.4295271],
  ['WB24', 23.7118314, 90.4293198],
  ['WB25', 23.7114688, 90.429069],
  ['WB26', 23.7111115, 90.4286911],
  ['WB27', 23.7109261, 90.4284407],
  ['WB28', 23.7107564, 90.4278101],
  ['WB29', 23.7106713, 90.4274013],
  ['WB30', 23.7104661, 90.4267966],
  ['WB31', 23.7102367, 90.4263783],
  ['WB32', 23.7099507, 90.425814],
  ['WB33', 23.71001, 90.4255032],
  ['WB34', 23.7101013, 90.4250255],
  ['WB35', 23.7101945, 90.4245374],
  ['WB36', 23.7101236, 90.4243291],
  ['WB37', 23.7100884, 90.4242601],
  ['WB38', 23.710055, 90.4241947],
];

const RAW_WC_COORDS: Array<[string, number, number]> = [
  ['WC-1', 23.7099988, 90.4242108],
  ['WC-2', 23.7085466, 90.4251211],
  ['WC-3', 23.7086198, 90.4256652],
  ['WC-4', 23.7075169, 90.4259854],
  ['WC-5', 23.706248, 90.4267158],
  ['WC-6', 23.7044941, 90.427765],
  ['WC-7', 23.7027916, 90.4286931],
  ['WC-8', 23.7013631, 90.4294847],
  ['WC-9', 23.7004151, 90.4300251],
  ['WC-10', 23.6994332, 90.4306005],
  ['WC-11', 23.6980598, 90.4313667],
  ['WC-12', 23.6971201, 90.4317795],
  ['WC-13', 23.695597, 90.4328338],
  ['WC-14', 23.6945667, 90.4337417],
  ['WC-15', 23.6937985, 90.4344372],
  ['WC-16', 23.692193, 90.4359295],
  ['WC-17', 23.6911119, 90.4369343],
  ['WC-18', 23.6896041, 90.4383358],
  ['WC-19', 23.6881915, 90.4396457],
  ['WC-20', 23.6869, 90.4408433],
  ['WC-21', 23.6853322, 90.442297],
  ['WC-22', 23.6841979, 90.4433488],
  ['WC-23', 23.6826616, 90.4458116],
  ['WC-24', 23.6814748, 90.447714],
  ['WC-25', 23.6827229, 90.4493509],
  ['WC-26', 23.6839521, 90.4509632],
  ['WC-27', 23.6838336, 90.4511345],
];

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function createInitialWbData(): WbSectionData {
  const totalTargetM = 1650;
  const initialCompletedM = 322.9;

  const rawCum: number[] = [0];
  for (let i = 1; i < RAW_WB_COORDS.length; i++) {
    const [, lat1, lon1] = RAW_WB_COORDS[i - 1];
    const [, lat2, lon2] = RAW_WB_COORDS[i];
    rawCum.push(rawCum[i - 1] + haversineMeters(lat1, lon1, lat2, lon2));
  }
  const rawTotal = rawCum[rawCum.length - 1] || 1;
  const scale = totalTargetM / rawTotal;

  const nodes: WbNodeRecord[] = RAW_WB_COORDS.map(([id, lat, lon], i) => {
    const ch = Number((rawCum[i] * scale).toFixed(1));
    // Match A0 PDF (~322.9m completed ending just past WB11)
    const status =
      ch <= initialCompletedM ? 'complete' : i === 11 ? 'ongoing' : 'remaining';
    return {
      id,
      index: i + 1,
      lat,
      lon,
      chainageM: ch,
      status,
      sDate: '',
      eDate: '',
      note: '',
    };
  });

  return {
    pipeDia: 'DN1200 GRP',
    method: 'Open Cut',
    totalLengthM: totalTargetM,
    completedLengthM: initialCompletedM,
    nodes,
    washoutCoord: { ...DEFAULT_WASHOUT_COORD },
    airValveCoord: { ...DEFAULT_AIR_VALVE_COORD },
    customPoints: [],
    customKmlLines: [],
  };
}

export function createInitialWcData(): WcSectionData {
  const totalTargetM = 4500;
  const segLens: number[] = [];
  let sumH = 0;
  for (let i = 0; i < RAW_WC_COORDS.length - 1; i++) {
    const [, lat1, lon1] = RAW_WC_COORDS[i];
    const [, lat2, lon2] = RAW_WC_COORDS[i + 1];
    const d = haversineMeters(lat1, lon1, lat2, lon2);
    segLens.push(d);
    sumH += d;
  }
  const scale = totalTargetM / (sumH || 1);

  // Build 27 blank WC shafts matching WA schematic (0% / Remaining / Blank dates)
  const shafts: ShaftRecord[] = RAW_WC_COORDS.map(([id], idx) => {
    const isLast = idx === RAW_WC_COORDS.length - 1;
    const nextId = isLast ? 'Outfall' : RAW_WC_COORDS[idx + 1][0];
    const spanM = isLast ? 0 : Number((segLens[idx] * scale).toFixed(1));
    const dia: PipeDia = idx >= 18 ? 'DN2600' : idx >= 6 ? 'DN2400' : 'DN1800';
    const isDriving = idx % 2 === 0;
    const totalLayers = 8;

    return {
      index: idx + 1,
      id,
      nextId,
      shaftSize: isDriving ? '7200X4000' : 'Ø4800',
      shaftType: isDriving ? 'Driving' : 'Receiving',
      netHeightMm: 7950,
      bottomSlabMm: 600,
      sheetPileStyle: false,
      totalLayers,
      layerFlags: Array(totalLayers).fill(false),
      bottomSlabDone: false,
      shaftSDate: '',
      shaftEDate: '',
      castingPct: 0,
      precastPct: 0,
      manholeSDate: '',
      manholeEDate: '',
      pipeDia: dia,
      tunnelLengthM: spanM,
      tunnelPct: 0,
      tunnelSDate: '',
      tunnelEDate: '',
    };
  });

  const geoNodes: WcGeoNode[] = RAW_WC_COORDS.map(([id, lat, lon]) => ({
    id,
    lat,
    lon,
  }));

  return {
    shafts,
    geoNodes,
    customPoints: [],
    customKmlLines: [],
  };
}
