/*
 * Перетворення MGRS у географічні координати WGS84.
 * Працює і в браузері (глобальний об'єкт MGRS), і в Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MGRS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
  const COLUMN_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
  const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

  // Допуск на вихід квадрата за межу зони: MGRS дозволяє невелике перекриття зон.
  const ZONE_OVERLAP_DEG = 0.5;

  const K0 = 0.9996;
  const FALSE_EASTING = 500000;
  const FALSE_NORTHING_SOUTH = 10000000;
  const A_WGS84 = 6378137;
  const F_WGS84 = 1 / 298.257223563;

  const n = F_WGS84 / (2 - F_WGS84);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;

  const RECTIFYING_RADIUS = (A_WGS84 / (1 + n)) * (1 + n2 / 4 + n4 / 64);
  const BETA = [
    n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4,
    (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4,
    (17 / 480) * n3 - (37 / 840) * n4,
    (4397 / 161280) * n4,
  ];
  const DELTA = [
    2 * n - (2 / 3) * n2 - 2 * n3 + (116 / 45) * n4,
    (7 / 3) * n2 - (8 / 5) * n3 - (227 / 45) * n4,
    (56 / 15) * n3 - (136 / 35) * n4,
    (4279 / 630) * n4,
  ];

  class MgrsError extends Error {}

  /** Обернена проєкція UTM (ряди Крюгера). Довгота повертається відносно осьового меридіана. */
  function utmToGeodetic(easting, northing, isNorth) {
    const xi = (northing - (isNorth ? 0 : FALSE_NORTHING_SOUTH)) / (K0 * RECTIFYING_RADIUS);
    const eta = (easting - FALSE_EASTING) / (K0 * RECTIFYING_RADIUS);

    let xiPrime = xi;
    let etaPrime = eta;
    BETA.forEach((beta, i) => {
      const j = 2 * (i + 1);
      xiPrime -= beta * Math.sin(j * xi) * Math.cosh(j * eta);
      etaPrime -= beta * Math.cos(j * xi) * Math.sinh(j * eta);
    });

    const chi = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
    let phi = chi;
    DELTA.forEach((delta, i) => {
      phi += delta * Math.sin(2 * (i + 1) * chi);
    });

    return {
      lat: (phi * 180) / Math.PI,
      dLon: (Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime)) * 180) / Math.PI,
    };
  }

  /** Межі зони за довготою, з винятками для Норвегії (V) та Шпіцбергена (X). */
  function zoneLongitudeRange(zone, band) {
    let west = -180 + (zone - 1) * 6;
    let east = west + 6;
    if (band === 'V' && zone === 31) east = 3;
    if (band === 'V' && zone === 32) west = 3;
    if (band === 'X') {
      if (zone === 32 || zone === 34 || zone === 36) return null;
      if (zone === 31) east = 9;
      if (zone === 33) { west = 9; east = 21; }
      if (zone === 35) { west = 21; east = 33; }
      if (zone === 37) { west = 33; east = 42; }
    }
    return { west, east };
  }

  function parse(input) {
    const text = String(input).replace(/\s+/g, '').toUpperCase();
    if (!text) throw new MgrsError('Порожнє значення.');
    if (/[Ѐ-ӿ]/.test(text)) {
      throw new MgrsError('Є кириличні літери. Введіть координату латиницею.');
    }

    const match = /^(\d{1,2})([A-Z])([A-Z])([A-Z])(\d*)$/.exec(text);
    if (!match) {
      throw new MgrsError('Неправильний формат. Очікується, наприклад, 36U UA 12345 67890.');
    }

    const [, zoneText, band, column, row, digits] = match;
    const zone = Number(zoneText);
    if (zone < 1 || zone > 60) throw new MgrsError('Номер зони має бути від 1 до 60.');
    if ('ABYZ'.includes(band)) {
      throw new MgrsError('Полярні області (смуги A, B, Y, Z) не підтримуються.');
    }
    if (!BANDS.includes(band)) throw new MgrsError(`Смуги широти ${band} не існує.`);
    if (digits.length % 2 !== 0) {
      throw new MgrsError('Кількість цифр має бути парною: порівну для сходу і півночі.');
    }
    if (digits.length > 10) throw new MgrsError('Забагато цифр: максимум 5 + 5.');

    const columnSet = COLUMN_SETS[(zone - 1) % 3];
    const columnIndex = columnSet.indexOf(column);
    if (columnIndex < 0) {
      throw new MgrsError(`Літера стовпця ${column} неможлива в зоні ${zone}.`);
    }
    const rowIndex = ROWS.indexOf(row);
    if (rowIndex < 0) throw new MgrsError(`Літери рядка ${row} не існує.`);

    const half = digits.length / 2;
    return {
      zone,
      band,
      column,
      row,
      columnIndex,
      rowIndex,
      eastDigits: digits.slice(0, half),
      northDigits: digits.slice(half),
      squareSize: Math.pow(10, 5 - half),
    };
  }

  /** Перетворює MGRS на центр позначеного квадрата. Кидає MgrsError, якщо значення хибне. */
  function toLatLon(input) {
    const p = parse(input);
    const size = p.squareSize;
    const isNorth = p.band >= 'N';
    const zoneRange = zoneLongitudeRange(p.zone, p.band);
    if (!zoneRange) throw new MgrsError(`Зони ${p.zone}${p.band} не існує.`);

    const centralMeridian = p.zone * 6 - 183;
    const bandIndex = BANDS.indexOf(p.band);
    const bandSouth = -80 + bandIndex * 8;
    const bandNorth = p.band === 'X' ? 84 : bandSouth + 8;
    const west = zoneRange.west - centralMeridian - ZONE_OVERLAP_DEG;
    const east = zoneRange.east - centralMeridian + ZONE_OVERLAP_DEG;

    const easting = (p.columnIndex + 1) * 100000 + Number(p.eastDigits || 0) * size;
    const rowOffset = p.zone % 2 === 0 ? 5 : 0;
    const baseNorthing = ((p.rowIndex - rowOffset + 20) % 20) * 100000 + Number(p.northDigits || 0) * size;

    // Літери рядків повторюються кожні 2000 км; потрібний цикл визначає смуга широти.
    for (let cycle = 0; cycle < 5; cycle++) {
      const northing = baseNorthing + cycle * 2000000;
      const corners = [
        utmToGeodetic(easting, northing, isNorth),
        utmToGeodetic(easting + size, northing, isNorth),
        utmToGeodetic(easting, northing + size, isNorth),
        utmToGeodetic(easting + size, northing + size, isNorth),
      ];
      const lats = corners.map((c) => c.lat);
      const lons = corners.map((c) => c.dLon);
      const inBand = Math.min(...lats) < bandNorth && Math.max(...lats) > bandSouth;
      const inZone = Math.min(...lons) < east && Math.max(...lons) > west;
      if (!inBand || !inZone) continue;

      const center = utmToGeodetic(easting + size / 2, northing + size / 2, isNorth);
      let lon = centralMeridian + center.dLon;
      if (lon >= 180) lon -= 360;
      if (lon < -180) lon += 360;

      return {
        lat: center.lat,
        lon,
        squareSize: size,
        mgrs: [`${p.zone}${p.band}`, p.column + p.row, p.eastDigits, p.northDigits].filter(Boolean).join(' '),
      };
    }

    throw new MgrsError(`Квадрат ${p.column}${p.row} не належить зоні ${p.zone}${p.band}.`);
  }

  /** Розбиває вставлений текст на окремі координати: новий рядок, кома або крапка з комою. */
  function splitList(text) {
    return String(text).split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
  }

  function formatDms(value, positive, negative) {
    const tenths = Math.round(Math.abs(value) * 36000);
    const degrees = Math.floor(tenths / 36000);
    const minutes = Math.floor((tenths % 36000) / 600);
    const seconds = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
    const mm = String(minutes).padStart(2, '0');
    return `${degrees}°${mm}'${seconds}"${value < 0 ? negative : positive}`;
  }

  function toDms(lat, lon) {
    return `${formatDms(lat, 'N', 'S')} ${formatDms(lon, 'E', 'W')}`;
  }

  return { toLatLon, toDms, splitList, MgrsError };
});
