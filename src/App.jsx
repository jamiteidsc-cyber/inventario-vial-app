import React, { useState, useEffect, useMemo } from "react";

// ============================================================================
// 1. UTILIDADES GEODÉSICAS: WGS84 Lat/Lon <-> UTM Zona 20S (EPSG:32720)
// ============================================================================
const WGS84 = {
  a: 6378137.0,
  f: 1 / 298.257223563,
  k0: 0.9996,
  e2: 0.0066943799901413165, // 2f - f^2
  ep2: 0.006739496742276434, // e2 / (1 - e2)
  lon0Rad: (-63 * Math.PI) / 180, // Meridiano central Zona 20 (-63°)
  falseEasting: 500000.0,
  falseNorthingSouth: 10000000.0,
};

function latLonToUtm20S(latDeg, lonDeg) {
  const { a, k0, e2, ep2, lon0Rad, falseEasting, falseNorthingSouth } = WGS84;
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);

  const nu = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = ep2 * cosLat * cosLat;
  const A = cosLat * (lon - lon0Rad);

  const e4 = e2 * e2;
  const e6 = e4 * e2;

  const M =
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * lat -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * lat) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * lat) -
      ((35 * e6) / 3072) * Math.sin(6 * lat));

  const A2 = A * A;
  const A3 = A2 * A;
  const A4 = A3 * A;
  const A5 = A4 * A;
  const A6 = A5 * A;

  const easting =
    falseEasting +
    k0 *
      nu *
      (A +
        ((1 - T + C) * A3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5) / 120);

  const northing =
    falseNorthingSouth +
    k0 *
      (M +
        nu *
          tanLat *
          (A2 / 2 +
            ((5 - T + 9 * C + 4 * C * C) * A4) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6) / 720));

  return {
    este: Number(easting.toFixed(2)),
    norte: Number(northing.toFixed(2)),
  };
}

function utm20SToLatLon(easting, northing) {
  const { a, k0, e2, ep2, lon0Rad, falseEasting, falseNorthingSouth } = WGS84;
  const x = Number(easting) - falseEasting;
  const y = Number(northing) - falseNorthingSouth;

  const e4 = e2 * e2;
  const e6 = e4 * e2;

  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));

  const sqrt1MinusE2 = Math.sqrt(1 - e2);
  const e1 = (1 - sqrt1MinusE2) / (1 + sqrt1MinusE2);
  const e1_2 = e1 * e1;
  const e1_3 = e1_2 * e1;
  const e1_4 = e1_3 * e1;

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1_3) / 32) * Math.sin(2 * mu) +
    ((21 * e1_2) / 16 - (55 * e1_4) / 32) * Math.sin(4 * mu) +
    ((151 * e1_3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1_4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const C1 = ep2 * cosPhi1 * cosPhi1;
  const T1 = tanPhi1 * tanPhi1;
  const denom = 1 - e2 * sinPhi1 * sinPhi1;
  const N1 = a / Math.sqrt(denom);
  const R1 = (a * (1 - e2)) / Math.pow(denom, 1.5);
  const D = x / (N1 * k0);

  const D2 = D * D;
  const D3 = D2 * D;
  const D4 = D3 * D;
  const D5 = D4 * D;
  const D6 = D5 * D;

  const latRad =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      (D2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) *
          D6) /
          720);

  const lonRad =
    lon0Rad +
    (D -
      ((1 + 2 * T1 + C1) * D3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D5) /
        120) /
      cosPhi1;

  return {
    lat: Number(((latRad * 180) / Math.PI).toFixed(7)),
    lon: Number(((lonRad * 180) / Math.PI).toFixed(7)),
  };
}

// ============================================================================
// 2. CONFIGURACIÓN DE ELEMENTOS VIALES Y CATÁLOGOS (BOLIVIA)
// ============================================================================
const STORAGE_KEY = "inventario_vial_bolivia_v1";

const ELEMENTOS = [
  "Alcantarilla",
  "Puente",
  "Muro",
  "Talud",
  "Cuneta",
  "Señal vertical",
  "Otros (A detallar)",
];

const ESTADOS = ["Bueno", "Regular", "Malo"];

const ELEMENTO_CONFIG = {
  Alcantarilla: {
    defaultGeom: "Punto",
    geomOptions: ["Punto"],
    tipos: ["Tubo TMC", "Tubo Hormigón", "Cajón H°A°", "Bóveda", "Otro"],
  },
  Puente: {
    defaultGeom: "Línea",
    geomOptions: ["Línea"],
    tipos: [
      "H°A° (Vigas)",
      "H°P° (Pretensado)",
      "Losa H°A°",
      "Metálico / Bailey",
      "Mixto",
      "Madera",
      "Otro",
    ],
  },
  Muro: {
    defaultGeom: "Línea",
    geomOptions: ["Línea"],
    tipos: [
      "Gaviones",
      "Hormigón Ciclópeo",
      "Hormigón Armado",
      "Mampostería de Piedra",
      "Tierra Armada",
      "Otro",
    ],
  },
  Talud: {
    defaultGeom: "Línea",
    geomOptions: ["Línea", "Polígono"],
    tipos: [],
  },
  Cuneta: {
    defaultGeom: "Línea",
    geomOptions: ["Línea"],
    tipos: [
      "Revestida Hormigón",
      "Mampostería de Piedra",
      "Tierra / Sin revestir",
      "Prefabricada",
      "Otro",
    ],
  },
  "Señal vertical": {
    defaultGeom: "Punto",
    geomOptions: ["Punto"],
    tipos: [
      "Preventiva (P)",
      "Reglamentaria (R)",
      "Informativa (I)",
      "Poste Kilométrico / Delineador",
      "Otro",
    ],
  },
  "Otros (A detallar)": {
    defaultGeom: "Punto",
    geomOptions: ["Punto", "Línea"],
    tipos: [],
  },
};

const createEmptyForm = (elemento = "Alcantarilla") => ({
  elemento,
  geometria: ELEMENTO_CONFIG[elemento].defaultGeom,
  este: "",
  norte: "",
  esteInicio: "",
  norteInicio: "",
  esteFin: "",
  norteFin: "",
  verticesExtra: [], // Para Talud Polígono (vértices 3..N)
  progresiva: "",
  progresivaInicio: "",
  progresivaFin: "",
  nombre: "",
  tipo: "",
  seccion: "",
  anchoCalzada: "",
  altura: "",
  longitud: "",
  numBanquinas: "",
  estado: "Bueno",
  detalleOtros: "",
  observaciones: "",
  fotoDataUrl: "",
  fotoNombre: "",
});

// ============================================================================
// 3. COMPRESIÓN DE IMAGEN (OPTIMIZADA PARA LOCALSTORAGE EN CAMPO)
// ============================================================================
function compressImage(file, maxDim = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Archivo de imagen inválido."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// 4. GENERADORES DE EXPORTACIÓN QGIS (GEOJSON WGS84 + CSV UTM EPSG:32720)
// ============================================================================
function buildNormalizedProperties(rec) {
  const isPoint = rec.geometria === "Punto";
  return {
    id: rec.id,
    fecha_hora: rec.fechaHora,
    modo_registro: rec.modoRegistro,
    elemento: rec.elemento,
    geometria: rec.geometria,
    epsg_utm: "EPSG:32720",
    este_utm: isPoint ? Number(rec.este) : Number(rec.esteInicio),
    norte_utm: isPoint ? Number(rec.norte) : Number(rec.norteInicio),
    este_inicio: isPoint ? null : Number(rec.esteInicio),
    norte_inicio: isPoint ? null : Number(rec.norteInicio),
    este_fin: isPoint ? null : Number(rec.esteFin),
    norte_fin: isPoint ? null : Number(rec.norteFin),
    progresiva: rec.progresiva || "",
    progresiva_inicio: rec.progresivaInicio || "",
    progresiva_fin: rec.progresivaFin || "",
    nombre: rec.nombre || "",
    tipo: rec.tipo || "",
    seccion: rec.seccion || "",
    ancho_calzada_m: rec.anchoCalzada !== "" ? Number(rec.anchoCalzada) : null,
    altura_m: rec.altura !== "" ? Number(rec.altura) : null,
    longitud_m: rec.longitud !== "" ? Number(rec.longitud) : null,
    num_banquinas: rec.numBanquinas !== "" ? Number(rec.numBanquinas) : null,
    estado: rec.estado || "",
    detalle_otros: rec.detalleOtros || "",
    observaciones: rec.observaciones || "",
    tiene_foto: rec.fotoDataUrl ? "Sí" : "No",
    foto_archivo: rec.fotoNombre || "",
  };
}

function getUtmRingForPolygon(rec) {
  const pts = [
    [Number(rec.esteInicio), Number(rec.norteInicio)],
    [Number(rec.esteFin), Number(rec.norteFin)],
  ];
  if (Array.isArray(rec.verticesExtra)) {
    rec.verticesExtra.forEach((v) => {
      if (v.este !== "" && v.norte !== "") {
        pts.push([Number(v.este), Number(v.norte)]);
      }
    });
  }
  // Si solo tiene Inicio y Fin, genera un polígono rectangular mínimo usando altura/longitud o ancho de 10m
  if (pts.length === 2) {
    const [e1, n1] = pts[0];
    const [e2, n2] = pts[1];
    const dx = e2 - e1;
    const dy = n2 - n1;
    const len = Math.hypot(dx, dy) || 1;
    const offset = Math.max(Number(rec.altura) || 8, 5);
    const nx = (-dy / len) * offset;
    const ny = (dx / len) * offset;
    pts.push([Number((e2 + nx).toFixed(2)), Number((n2 + ny).toFixed(2))]);
    pts.push([Number((e1 + nx).toFixed(2)), Number((n1 + ny).toFixed(2))]);
  }
  // Cerrar anillo
  pts.push([...pts[0]]);
  return pts;
}

function buildGeoJSON(records) {
  const features = records.map((rec) => {
    let geometry;

    if (rec.geometria === "Punto") {
      const { lon, lat } = utm20SToLatLon(rec.este, rec.norte);
      geometry = {
        type: "Point",
        coordinates: [lon, lat],
      };
    } else if (rec.geometria === "Polígono") {
      const utmRing = getUtmRingForPolygon(rec);
      const wgsRing = utmRing.map(([e, n]) => {
        const { lon, lat } = utm20SToLatLon(e, n);
        return [lon, lat];
      });
      geometry = {
        type: "Polygon",
        coordinates: [wgsRing],
      };
    } else {
      const p1 = utm20SToLatLon(rec.esteInicio, rec.norteInicio);
      const p2 = utm20SToLatLon(rec.esteFin, rec.norteFin);
      geometry = {
        type: "LineString",
        coordinates: [
          [p1.lon, p1.lat],
          [p2.lon, p2.lat],
        ],
      };
    }

    return {
      type: "Feature",
      geometry,
      properties: buildNormalizedProperties(rec),
    };
  });

  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: "Inventario_Vial_Bolivia_WGS84",
      crs: {
        type: "name",
        properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
      },
      features,
    },
    null,
    2
  );
}

function buildCSV(records) {
  const headers = [
    "id",
    "fecha_hora",
    "modo_registro",
    "elemento",
    "geometria",
    "epsg_utm",
    "este_utm",
    "norte_utm",
    "este_inicio",
    "norte_inicio",
    "este_fin",
    "norte_fin",
    "progresiva",
    "progresiva_inicio",
    "progresiva_fin",
    "nombre",
    "tipo",
    "seccion",
    "ancho_calzada_m",
    "altura_m",
    "longitud_m",
    "num_banquinas",
    "estado",
    "detalle_otros",
    "observaciones",
    "tiene_foto",
    "foto_archivo",
    "wkt_epsg32720",
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes('"') || str.includes(",") || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = records.map((rec) => {
    const props = buildNormalizedProperties(rec);
    let wkt = "";
    if (rec.geometria === "Punto") {
      wkt = `POINT (${rec.este} ${rec.norte})`;
    } else if (rec.geometria === "Polígono") {
      const ring = getUtmRingForPolygon(rec)
        .map(([e, n]) => `${e} ${n}`)
        .join(", ");
      wkt = `POLYGON ((${ring}))`;
    } else {
      wkt = `LINESTRING (${rec.esteInicio} ${rec.norteInicio}, ${rec.esteFin} ${rec.norteFin})`;
    }

    const values = headers.map((h) =>
      h === "wkt_epsg32720" ? escapeCsv(wkt) : escapeCsv(props[h])
    );
    return values.join(",");
  });

  // BOM UTF-8 para tildes/eñes en Excel y QGIS
  return "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// 5. ESTILOS CSS AUTOCONTENIDOS (AZUL VIAL OSCURO, BLANCO, ÁMBAR, VERDE)
// ============================================================================
const APP_STYLES = `
  :root {
    --vial-navy-950: #091324;
    --vial-navy-900: #0f1e36;
    --vial-navy-800: #162a4a;
    --vial-navy-700: #1f3c68;
    --vial-slate-50: #f1f5f9;
    --vial-slate-100: #e2e8f0;
    --vial-slate-200: #cbd5e1;
    --vial-slate-500: #64748b;
    --vial-slate-700: #334155;
    --vial-white: #ffffff;
    --vial-amber-500: #f59e0b;
    --vial-amber-600: #d97706;
    --vial-amber-100: #fef3c7;
    --vial-green-600: #059669;
    --vial-green-500: #10b981;
    --vial-green-100: #d1fae5;
    --vial-red-600: #dc2626;
    --vial-red-100: #fee2e2;
    --radius-md: 10px;
    --radius-lg: 14px;
    --shadow-sm: 0 2px 6px rgba(9, 19, 36, 0.08);
    --shadow-md: 0 8px 24px rgba(9, 19, 36, 0.14);
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
      Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
    background-color: var(--vial-slate-50);
    color: var(--vial-navy-950);
    -webkit-font-smoothing: antialiased;
  }

  .app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* HEADER VIAL OSCURO */
  .app-header {
    background: linear-gradient(135deg, var(--vial-navy-950) 0%, var(--vial-navy-800) 100%);
    color: var(--vial-white);
    padding: 16px 20px 18px;
    border-bottom: 4px solid var(--vial-amber-500);
    box-shadow: var(--shadow-md);
    position: sticky;
    top: 0;
    z-index: 40;
  }

  .header-inner {
    max-width: 1320px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .brand-box {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .brand-badge {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: var(--vial-amber-500);
    color: var(--vial-navy-950);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    font-size: 22px;
    flex-shrink: 0;
    box-shadow: 0 2px 10px rgba(245, 158, 11, 0.4);
  }

  .brand-title {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }

  .brand-sub {
    margin: 3px 0 0;
    font-size: 0.78rem;
    color: var(--vial-slate-200);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .crs-pill {
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.22);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--vial-amber-100);
  }

  /* INTERRUPTOR DOBLE MODO DE TRABAJO */
  .mode-switch-wrapper {
    background: rgba(9, 19, 36, 0.65);
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .mode-switch-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vial-amber-500);
    text-align: center;
  }

  .mode-switch-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .mode-btn {
    border: none;
    border-radius: 8px;
    padding: 11px 14px;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.18s ease;
    background: transparent;
    color: var(--vial-slate-200);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
  }

  .mode-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .mode-btn.active-mobile {
    background: var(--vial-amber-500);
    color: var(--vial-navy-950);
    box-shadow: 0 2px 10px rgba(245, 158, 11, 0.45);
  }

  .mode-btn.active-pc {
    background: var(--vial-white);
    color: var(--vial-navy-950);
    box-shadow: 0 2px 10px rgba(255, 255, 255, 0.25);
  }

  /* CONTENEDOR PRINCIPAL */
  .main-container {
    max-width: 1320px;
    width: 100%;
    margin: 20px auto 40px;
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  /* TARJETAS */
  .card {
    background: var(--vial-white);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--vial-slate-200);
    overflow: hidden;
  }

  .card-header {
    background: var(--vial-navy-900);
    color: var(--vial-white);
    padding: 14px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .card-header h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .card-body {
    padding: 20px;
  }

  /* FORMULARIO DINÁMICO */
  .element-selector-bar {
    background: var(--vial-slate-50);
    border: 2px solid var(--vial-navy-700);
    border-radius: var(--radius-md);
    padding: 14px;
    margin-bottom: 18px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 680px) {
    .element-selector-bar {
      grid-template-columns: 2fr 1fr;
      align-items: end;
    }
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
  }

  @media (min-width: 640px) {
    .form-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (min-width: 1024px) {
    .form-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .span-full {
    grid-column: 1 / -1;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--vial-navy-900);
  }

  .field-hint {
    font-size: 0.74rem;
    color: var(--vial-slate-500);
  }

  .input,
  .select,
  .textarea {
    width: 100%;
    min-height: 42px;
    padding: 9px 12px;
    font-size: 0.94rem;
    border: 1.5px solid var(--vial-slate-200);
    border-radius: 8px;
    background: var(--vial-white);
    color: var(--vial-navy-950);
    font-family: inherit;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .textarea {
    min-height: 82px;
    resize: vertical;
  }

  .input:focus,
  .select:focus,
  .textarea:focus {
    outline: none;
    border-color: var(--vial-navy-700);
    box-shadow: 0 0 0 3px rgba(31, 60, 104, 0.15);
  }

  /* CAJAS DE COORDENADAS UTM */
  .utm-section {
    grid-column: 1 / -1;
    background: #f8fafc;
    border: 1.5px solid var(--vial-slate-200);
    border-radius: var(--radius-md);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .utm-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .utm-section-title {
    font-size: 0.9rem;
    font-weight: 800;
    color: var(--vial-navy-900);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .utm-block {
    background: var(--vial-white);
    border: 1px solid var(--vial-slate-200);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .utm-block-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .utm-block-title {
    font-size: 0.82rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--vial-navy-700);
    letter-spacing: 0.04em;
  }

  .utm-pair {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  @media (min-width: 560px) {
    .utm-pair {
      grid-template-columns: 1fr 1fr;
    }
  }

  .utm-dual-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 860px) {
    .utm-dual-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  /* BOTONES */
  .btn {
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    transition: all 0.16s ease;
    min-height: 42px;
    font-family: inherit;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-gps {
    background: var(--vial-green-600);
    color: var(--vial-white);
    box-shadow: 0 2px 8px rgba(5, 150, 105, 0.28);
  }
  .btn-gps:hover:not(:disabled) {
    background: #047857;
  }

  .btn-primary {
    background: var(--vial-navy-800);
    color: var(--vial-white);
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--vial-navy-950);
  }

  .btn-amber {
    background: var(--vial-amber-500);
    color: var(--vial-navy-950);
  }
  .btn-amber:hover:not(:disabled) {
    background: var(--vial-amber-600);
    color: var(--vial-white);
  }

  .btn-export-qgis {
    background: linear-gradient(135deg, var(--vial-green-500) 0%, var(--vial-green-600) 100%);
    color: var(--vial-white);
    padding: 12px 18px;
    font-size: 0.95rem;
    box-shadow: 0 4px 14px rgba(5, 150, 105, 0.32);
  }
  .btn-export-qgis:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(5, 150, 105, 0.4);
  }

  .btn-outline {
    background: var(--vial-white);
    color: var(--vial-navy-800);
    border: 1.5px solid var(--vial-slate-200);
  }
  .btn-outline:hover:not(:disabled) {
    background: var(--vial-slate-50);
    border-color: var(--vial-navy-700);
  }

  .btn-danger-sm {
    background: var(--vial-red-100);
    color: var(--vial-red-600);
    padding: 6px 10px;
    min-height: 34px;
    font-size: 0.8rem;
  }
  .btn-danger-sm:hover {
    background: var(--vial-red-600);
    color: var(--vial-white);
  }

  .btn-edit-sm {
    background: var(--vial-amber-100);
    color: #92400e;
    padding: 6px 10px;
    min-height: 34px;
    font-size: 0.8rem;
  }
  .btn-edit-sm:hover {
    background: var(--vial-amber-500);
    color: var(--vial-navy-950);
  }

  .btn-sm {
    min-height: 34px;
    padding: 6px 11px;
    font-size: 0.8rem;
  }

  /* SUGERENCIAS RÁPIDAS */
  .quick-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .chip-btn {
    background: var(--vial-slate-100);
    color: var(--vial-navy-800);
    border: 1px solid var(--vial-slate-200);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 0.74rem;
    font-weight: 600;
    cursor: pointer;
  }
  .chip-btn:hover {
    background: var(--vial-amber-100);
    border-color: var(--vial-amber-500);
  }

  /* SECCIÓN FOTO */
  .photo-box {
    border: 2px dashed var(--vial-slate-200);
    border-radius: var(--radius-md);
    padding: 14px;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .photo-preview-wrap {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .photo-preview-img {
    width: 110px;
    height: 84px;
    object-fit: cover;
    border-radius: 8px;
    border: 2px solid var(--vial-navy-700);
    cursor: pointer;
  }

  .file-label-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--vial-navy-700);
    color: var(--vial-white);
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 0.88rem;
    font-weight: 700;
    cursor: pointer;
    min-height: 42px;
  }
  .file-label-btn:hover {
    background: var(--vial-navy-900);
  }

  /* ACCIONES DEL FORMULARIO */
  .form-actions {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--vial-slate-200);
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 10px;
  }

  /* BARRA DE REGISTROS Y EXPORTACIÓN */
  .records-toolbar {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 20px;
    background: #f8fafc;
    border-bottom: 1px solid var(--vial-slate-200);
  }

  @media (min-width: 900px) {
    .records-toolbar {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
    }
  }

  .filters-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  .filters-row .select,
  .filters-row .input {
    width: auto;
    min-width: 170px;
    min-height: 38px;
    padding: 6px 10px;
    font-size: 0.86rem;
  }

  /* PILLS DE ESTADO Y ELEMENTO */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .badge-bueno {
    background: var(--vial-green-100);
    color: #065f46;
  }

  .badge-regular {
    background: var(--vial-amber-100);
    color: #92400e;
  }

  .badge-malo {
    background: var(--vial-red-100);
    color: #991b1b;
  }

  .badge-elem {
    background: var(--vial-navy-800);
    color: var(--vial-white);
  }

  .badge-geom {
    background: var(--vial-slate-100);
    color: var(--vial-navy-800);
    border: 1px solid var(--vial-slate-200);
  }

  /* VISTA MODO CELULAR (TARJETAS) */
  .mobile-cards-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 16px;
  }

  @media (min-width: 700px) {
    .mobile-cards-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .record-card {
    border: 1.5px solid var(--vial-slate-200);
    border-radius: var(--radius-md);
    background: var(--vial-white);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: var(--shadow-sm);
  }

  .record-card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }

  .record-card-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .record-card-body {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: start;
  }

  .record-meta {
    font-size: 0.84rem;
    color: var(--vial-slate-700);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .utm-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.78rem;
    background: var(--vial-slate-50);
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--vial-slate-200);
    color: var(--vial-navy-900);
    display: inline-block;
  }

  .record-thumb {
    width: 82px;
    height: 82px;
    object-fit: cover;
    border-radius: 8px;
    border: 1.5px solid var(--vial-slate-200);
    cursor: pointer;
  }

  .record-card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 8px;
    border-top: 1px solid var(--vial-slate-100);
    gap: 8px;
  }

  /* VISTA MODO PC (TABLA AMPLIA) */
  .table-responsive {
    width: 100%;
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
    min-width: 980px;
  }

  .data-table th {
    background: var(--vial-navy-900);
    color: var(--vial-white);
    text-align: left;
    padding: 11px 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .data-table td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--vial-slate-200);
    vertical-align: top;
  }

  .data-table tr:hover td {
    background: #f8fafc;
  }

  .table-thumb {
    width: 56px;
    height: 44px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--vial-slate-200);
    cursor: pointer;
  }

  /* FEEDBACK & TOAST */
  .gps-banner {
    font-size: 0.82rem;
    padding: 8px 12px;
    border-radius: 8px;
    font-weight: 600;
  }
  .gps-banner.ok {
    background: var(--vial-green-100);
    color: #065f46;
  }
  .gps-banner.err {
    background: var(--vial-red-100);
    color: #991b1b;
  }

  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 100;
    padding: 12px 18px;
    border-radius: 10px;
    color: var(--vial-white);
    font-weight: 700;
    font-size: 0.9rem;
    box-shadow: var(--shadow-md);
    animation: slideUp 0.2s ease;
  }
  .toast.success {
    background: var(--vial-green-600);
  }
  .toast.error {
    background: var(--vial-red-600);
  }
  .toast.info {
    background: var(--vial-navy-800);
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* MODALES */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(9, 19, 36, 0.72);
    z-index: 90;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-card {
    background: var(--vial-white);
    border-radius: var(--radius-lg);
    max-width: 560px;
    width: 100%;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
  }

  .modal-header {
    background: var(--vial-navy-900);
    color: var(--vial-white);
    padding: 14px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1rem;
  }

  .modal-close {
    background: transparent;
    border: none;
    color: var(--vial-white);
    font-size: 1.4rem;
    cursor: pointer;
    line-height: 1;
  }

  .modal-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .export-option-box {
    border: 1.5px solid var(--vial-slate-200);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #f8fafc;
  }

  .qgis-tip {
    background: var(--vial-amber-100);
    border-left: 4px solid var(--vial-amber-500);
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 0.8rem;
    color: #78350f;
    line-height: 1.4;
  }

  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--vial-slate-500);
  }
`;

// ============================================================================
// 6. COMPONENTE PRINCIPAL
// ============================================================================
export default function App() {
  // Modo de trabajo inicial adaptable al dispositivo, con interruptor manual arriba
  const [workMode, setWorkMode] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "mobile" : "pc"
  );

  // Registros persistidos en localStorage
  const [records, setRecords] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [formData, setFormData] = useState(() => createEmptyForm("Alcantarilla"));
  const [editingId, setEditingId] = useState(null);

  // Filtros de visualización
  const [filterElement, setFilterElement] = useState("Todos");
  const [filterEstado, setFilterEstado] = useState("Todos");
  const [searchQuery, setSearchQuery] = useState("");

  // Estado GPS
  const [gpsLoadingTarget, setGpsLoadingTarget] = useState(null);
  const [gpsStatus, setGpsStatus] = useState(null);

  // Modales y notificaciones
  const [photoModal, setPhotoModal] = useState(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Guardar automáticamente en localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (err) {
      showToast(
        "error",
        "Almacenamiento local lleno. Exporta a QGIS y depura fotos antiguas."
      );
    }
  }, [records]);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  };

  // Cambio de elemento vial: reinicia campos manteniendo estructura limpia
  const handleElementoChange = (nuevoElemento) => {
    setFormData((prev) => ({
      ...createEmptyForm(nuevoElemento),
      observaciones: prev.observaciones,
    }));
    setGpsStatus(null);
  };

  const handleFieldChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Captura GPS en Modo Celular -> Convierte Lat/Lon a UTM WGS84 Zona 20S
  const handleCaptureGPS = (target) => {
    if (!navigator.geolocation) {
      setGpsStatus({
        ok: false,
        text: "Este navegador/dispositivo no soporta geolocalización GPS.",
      });
      return;
    }

    setGpsLoadingTarget(target);
    setGpsStatus(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const { este, norte } = latLonToUtm20S(latitude, longitude);

        setFormData((prev) => {
          if (target === "punto") {
            return { ...prev, este: String(este), norte: String(norte) };
          }
          if (target === "inicio") {
            return {
              ...prev,
              esteInicio: String(este),
              norteInicio: String(norte),
            };
          }
          if (target === "fin") {
            return { ...prev, esteFin: String(este), norteFin: String(norte) };
          }
          if (typeof target === "number") {
            const updated = [...prev.verticesExtra];
            updated[target] = { este: String(este), norte: String(norte) };
            return { ...prev, verticesExtra: updated };
          }
          return prev;
        });

        setGpsLoadingTarget(null);
        setGpsStatus({
          ok: true,
          text: `GPS capturado (Zona 20S): E ${este} m | N ${norte} m (±${accuracy.toFixed(
            1
          )} m)`,
        });
      },
      (err) => {
        setGpsLoadingTarget(null);
        let msg = "No se pudo obtener la posición GPS.";
        if (err.code === 1) msg = "Permiso de ubicación denegado en el dispositivo.";
        if (err.code === 2) msg = "Señal GPS no disponible (salga a cielo abierto).";
        if (err.code === 3) msg = "Tiempo de espera agotado al buscar satélites.";
        setGpsStatus({ ok: false, text: msg });
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  // Manejo de fotografía (cámara en celular o archivo en PC)
  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setFormData((prev) => ({
        ...prev,
        fotoDataUrl: compressed,
        fotoNombre: file.name || `foto_${Date.now()}.jpg`,
      }));
      showToast("info", "Fotografía adjuntada correctamente.");
    } catch (err) {
      showToast("error", err.message || "Error al procesar la fotografía.");
    }
    e.target.value = "";
  };

  // Calcular distancia horizontal automática entre Inicio y Fin
  const handleCalcLongitudUTM = () => {
    const e1 = parseFloat(formData.esteInicio);
    const n1 = parseFloat(formData.norteInicio);
    const e2 = parseFloat(formData.esteFin);
    const n2 = parseFloat(formData.norteFin);
    if ([e1, n1, e2, n2].some(Number.isNaN)) {
      showToast("error", "Ingrese Coordenadas Inicio y Fin válidas para calcular.");
      return;
    }
    const dist = Math.hypot(e2 - e1, n2 - n1);
    handleFieldChange("longitud", dist.toFixed(2));
  };

  // Vértices extra para Talud Polígono
  const handleAddVertex = () => {
    setFormData((prev) => ({
      ...prev,
      verticesExtra: [...prev.verticesExtra, { este: "", norte: "" }],
    }));
  };

  const handleVertexChange = (idx, key, val) => {
    setFormData((prev) => {
      const copy = [...prev.verticesExtra];
      copy[idx] = { ...copy[idx], [key]: val };
      return { ...prev, verticesExtra: copy };
    });
  };

  const handleRemoveVertex = (idx) => {
    setFormData((prev) => ({
      ...prev,
      verticesExtra: prev.verticesExtra.filter((_, i) => i !== idx),
    }));
  };

  // Guardar o actualizar registro
  const handleSubmit = (e) => {
    e.preventDefault();
    const isPoint = formData.geometria === "Punto";

    if (isPoint) {
      if (
        formData.este === "" ||
        formData.norte === "" ||
        Number.isNaN(Number(formData.este)) ||
        Number.isNaN(Number(formData.norte))
      ) {
        showToast("error", "Debe ingresar Coordenada Este y Norte (UTM Zona 20S).");
        return;
      }
    } else {
      if (
        formData.esteInicio === "" ||
        formData.norteInicio === "" ||
        formData.esteFin === "" ||
        formData.norteFin === "" ||
        [
          formData.esteInicio,
          formData.norteInicio,
          formData.esteFin,
          formData.norteFin,
        ].some((v) => Number.isNaN(Number(v)))
      ) {
        showToast(
          "error",
          "Debe ingresar Coordenadas UTM válidas de Inicio y Fin."
        );
        return;
      }
    }

    const nowStr = new Date().toLocaleString("es-BO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    if (editingId) {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === editingId
            ? {
                ...formData,
                id: editingId,
                fechaHora: r.fechaHora,
                modoRegistro:
                  workMode === "mobile" ? "Celular (Campo)" : "PC (Gabinete)",
              }
            : r
        )
      );
      setEditingId(null);
      showToast("success", "Registro vial actualizado.");
    } else {
      const newRecord = {
        ...formData,
        id: `VIAL-${Date.now().toString().slice(-6)}`,
        fechaHora: nowStr,
        modoRegistro:
          workMode === "mobile" ? "Celular (Campo)" : "PC (Gabinete)",
      };
      setRecords((prev) => [newRecord, ...prev]);
      showToast("success", `${formData.elemento} guardado en el inventario.`);
    }

    setFormData(createEmptyForm(formData.elemento));
    setGpsStatus(null);
  };

  const handleEditRecord = (rec) => {
    setEditingId(rec.id);
    setFormData({
      ...createEmptyForm(rec.elemento),
      ...rec,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("info", `Editando registro ${rec.id}`);
  };

  const handleDeleteRecord = (id) => {
    if (window.confirm("¿Eliminar este registro del inventario vial?")) {
      setRecords((prev) => prev.filter((r) => r.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setFormData(createEmptyForm(formData.elemento));
      }
      showToast("info", "Registro eliminado.");
    }
  };

  const handleClearAll = () => {
    if (
      records.length > 0 &&
      window.confirm(
        "¿Seguro que desea borrar TODOS los registros guardados localmente?"
      )
    ) {
      setRecords([]);
      setEditingId(null);
      showToast("info", "Inventario local vaciado.");
    }
  };

  // Registros filtrados
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterElement !== "Todos" && r.elemento !== filterElement) return false;
      if (filterEstado !== "Todos" && r.estado !== filterEstado) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const haystack = [
          r.id,
          r.elemento,
          r.nombre,
          r.tipo,
          r.progresiva,
          r.progresivaInicio,
          r.progresivaFin,
          r.detalleOtros,
          r.observaciones,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [records, filterElement, filterEstado, searchQuery]);

  // Resumen de atributos clave para mostrar en tarjeta / tabla
  const formatResumenAtributos = (r) => {
    const parts = [];
    if (r.nombre) parts.push(`Nombre: ${r.nombre}`);
    if (r.tipo) parts.push(`Tipo: ${r.tipo}`);
    if (r.seccion) parts.push(`Sección: ${r.seccion}`);
    if (r.anchoCalzada) parts.push(`Ancho calzada: ${r.anchoCalzada} m`);
    if (r.altura) parts.push(`Altura: ${r.altura} m`);
    if (r.longitud) parts.push(`Longitud: ${r.longitud} m`);
    if (r.numBanquinas) parts.push(`Banquinas: ${r.numBanquinas}`);
    if (r.detalleOtros) parts.push(`Detalle: ${r.detalleOtros}`);
    return parts.length ? parts.join(" • ") : "Sin atributos adicionales";
  };

  const formatProgresivaText = (r) => {
    if (r.geometria === "Punto") return r.progresiva || "—";
    if (r.progresiva && !r.progresivaInicio && !r.progresivaFin) return r.progresiva;
    const ini = r.progresivaInicio || "?";
    const fin = r.progresivaFin || "?";
    return `${ini} → ${fin}`;
  };

  // Exportación QGIS
  const handleExportGeoJSON = (onlyFiltered = false) => {
    const data = onlyFiltered ? filteredRecords : records;
    if (data.length === 0) {
      showToast("error", "No hay registros para exportar.");
      return;
    }
    const geojsonStr = buildGeoJSON(data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(
      geojsonStr,
      `inventario_vial_bolivia_${stamp}.geojson`,
      "application/geo+json"
    );
    showToast("success", `GeoJSON exportado (${data.length} elementos).`);
  };

  const handleExportCSV = (onlyFiltered = false) => {
    const data = onlyFiltered ? filteredRecords : records;
    if (data.length === 0) {
      showToast("error", "No hay registros para exportar.");
      return;
    }
    const csvStr = buildCSV(data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(
      csvStr,
      `inventario_vial_utm20s_${stamp}.csv`,
      "text/csv;charset=utf-8;"
    );
    showToast("success", `CSV UTM (EPSG:32720) exportado (${data.length} filas).`);
  };

  const configActual = ELEMENTO_CONFIG[formData.elemento];
  const isPunto = formData.geometria === "Punto";
  const isPoligono = formData.geometria === "Polígono";

  return (
    <div className="app-shell">
      <style>{APP_STYLES}</style>

      {/* =================================================================== */}
      {/* ENCABEZADO E INTERRUPTOR DE MODO DE TRABAJO                         */}
      {/* =================================================================== */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-top">
            <div className="brand-box">
              <div className="brand-badge" aria-hidden="true">
                🛣️
              </div>
              <div>
                <h1 className="brand-title">
                  Inventario Vial Georreferenciado - Bolivia
                </h1>
                <p className="brand-sub">
                  <span>Relevamiento de Infraestructura Carretera</span>
                  <span className="crs-pill">WGS84 • UTM Zona 20S (EPSG:32720)</span>
                </p>
              </div>
            </div>

            {/* INTERRUPTOR DOBLE MUY VISIBLE */}
            <div className="mode-switch-wrapper">
              <span className="mode-switch-label">Modo de Trabajo</span>
              <div className="mode-switch-buttons" role="group" aria-label="Modo de Trabajo">
                <button
                  type="button"
                  className={`mode-btn ${workMode === "mobile" ? "active-mobile" : ""}`}
                  onClick={() => setWorkMode("mobile")}
                >
                  📱 Modo Celular (Campo)
                </button>
                <button
                  type="button"
                  className={`mode-btn ${workMode === "pc" ? "active-pc" : ""}`}
                  onClick={() => setWorkMode("pc")}
                >
                  💻 Modo PC (Gabinete)
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="main-container">
        {/* ================================================================= */}
        {/* 1. FORMULARIO DINÁMICO SEGÚN ELEMENTO VIAL                        */}
        {/* ================================================================= */}
        <section className="card">
          <div className="card-header">
            <h2>
              {editingId ? `✏️ Editando Registro (${editingId})` : "📋 Nuevo Registro Vial"}
            </h2>
            <span className="badge badge-geom">
              {workMode === "mobile"
                ? "📱 GPS + Cámara en vivo"
                : "💻 Ingreso manual UTM / Garmin"}
            </span>
          </div>

          <form className="card-body" onSubmit={handleSubmit}>
            {/* SELECTOR PRINCIPAL DE ELEMENTO Y GEOMETRÍA */}
            <div className="element-selector-bar">
              <div className="field-group">
                <label className="field-label" htmlFor="select-elemento">
                  Elemento Vial *
                </label>
                <select
                  id="select-elemento"
                  className="select"
                  value={formData.elemento}
                  onChange={(e) => handleElementoChange(e.target.value)}
                >
                  {ELEMENTOS.map((el) => (
                    <option key={el} value={el}>
                      {el}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="select-geometria">
                  Geometría
                </label>
                {configActual.geomOptions.length > 1 ? (
                  <select
                    id="select-geometria"
                    className="select"
                    value={formData.geometria}
                    onChange={(e) => handleFieldChange("geometria", e.target.value)}
                  >
                    {configActual.geomOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="select-geometria"
                    className="input"
                    value={formData.geometria}
                    readOnly
                    style={{ background: "#e2e8f0", fontWeight: 700 }}
                  />
                )}
              </div>
            </div>

            <div className="form-grid">
              {/* ----------------------------------------------------------- */}
              {/* BLOQUE DE COORDENADAS UTM ZONA 20S                          */}
              {/* ----------------------------------------------------------- */}
              <div className="utm-section">
                <div className="utm-section-header">
                  <span className="utm-section-title">
                    🧭 Coordenadas UTM WGS84 - Zona 20S (metros)
                  </span>
                  {!isPunto && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={handleCalcLongitudUTM}
                      title="Calcular distancia recta entre Inicio y Fin"
                    >
                      📏 Calcular Longitud desde UTM
                    </button>
                  )}
                </div>

                {gpsStatus && (
                  <div className={`gps-banner ${gpsStatus.ok ? "ok" : "err"}`}>
                    {gpsStatus.ok ? "✅ " : "⚠️ "}
                    {gpsStatus.text}
                  </div>
                )}

                {isPunto ? (
                  <div className="utm-block">
                    <div className="utm-block-top">
                      <span className="utm-block-title">Ubicación del Punto</span>
                      {workMode === "mobile" && (
                        <button
                          type="button"
                          className="btn btn-gps"
                          disabled={gpsLoadingTarget === "punto"}
                          onClick={() => handleCaptureGPS("punto")}
                        >
                          {gpsLoadingTarget === "punto"
                            ? "⏳ Buscando satélites..."
                            : "📍 Capturar GPS UTM"}
                        </button>
                      )}
                    </div>

                    <div className="utm-pair">
                      <div className="field-group">
                        <label className="field-label">Coordenada Este (UTM) *</label>
                        <input
                          type="number"
                          step="0.01"
                          className="input"
                          placeholder="Ej: 480712.45"
                          value={formData.este}
                          onChange={(e) => handleFieldChange("este", e.target.value)}
                          required
                        />
                      </div>
                      <div className="field-group">
                        <label className="field-label">Coordenada Norte (UTM) *</label>
                        <input
                          type="number"
                          step="0.01"
                          className="input"
                          placeholder="Ej: 8033745.10"
                          value={formData.norte}
                          onChange={(e) => handleFieldChange("norte", e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="utm-dual-grid">
                    {/* INICIO */}
                    <div className="utm-block">
                      <div className="utm-block-top">
                        <span className="utm-block-title">Punto Inicio</span>
                        {workMode === "mobile" && (
                          <button
                            type="button"
                            className="btn btn-gps btn-sm"
                            disabled={gpsLoadingTarget === "inicio"}
                            onClick={() => handleCaptureGPS("inicio")}
                          >
                            {gpsLoadingTarget === "inicio"
                              ? "⏳ GPS..."
                              : "📍 Capturar GPS UTM"}
                          </button>
                        )}
                      </div>
                      <div className="utm-pair">
                        <div className="field-group">
                          <label className="field-label">Este Inicio *</label>
                          <input
                            type="number"
                            step="0.01"
                            className="input"
                            placeholder="Ej: 480700.00"
                            value={formData.esteInicio}
                            onChange={(e) =>
                              handleFieldChange("esteInicio", e.target.value)
                            }
                            required
                          />
                        </div>
                        <div className="field-group">
                          <label className="field-label">Norte Inicio *</label>
                          <input
                            type="number"
                            step="0.01"
                            className="input"
                            placeholder="Ej: 8033700.00"
                            value={formData.norteInicio}
                            onChange={(e) =>
                              handleFieldChange("norteInicio", e.target.value)
                            }
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* FIN */}
                    <div className="utm-block">
                      <div className="utm-block-top">
                        <span className="utm-block-title">Punto Fin</span>
                        {workMode === "mobile" && (
                          <button
                            type="button"
                            className="btn btn-gps btn-sm"
                            disabled={gpsLoadingTarget === "fin"}
                            onClick={() => handleCaptureGPS("fin")}
                          >
                            {gpsLoadingTarget === "fin"
                              ? "⏳ GPS..."
                              : "📍 Capturar GPS UTM"}
                          </button>
                        )}
                      </div>
                      <div className="utm-pair">
                        <div className="field-group">
                          <label className="field-label">Este Fin *</label>
                          <input
                            type="number"
                            step="0.01"
                            className="input"
                            placeholder="Ej: 480750.00"
                            value={formData.esteFin}
                            onChange={(e) =>
                              handleFieldChange("esteFin", e.target.value)
                            }
                            required
                          />
                        </div>
                        <div className="field-group">
                          <label className="field-label">Norte Fin *</label>
                          <input
                            type="number"
                            step="0.01"
                            className="input"
                            placeholder="Ej: 8033740.00"
                            value={formData.norteFin}
                            onChange={(e) =>
                              handleFieldChange("norteFin", e.target.value)
                            }
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* VÉRTICES EXTRA PARA TALUD POLÍGONO */}
                {isPoligono && (
                  <div className="utm-block">
                    <div className="utm-block-top">
                      <span className="utm-block-title">
                        Vértices adicionales del Polígono (Opcional)
                      </span>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={handleAddVertex}
                      >
                        ➕ Agregar Vértice
                      </button>
                    </div>
                    <span className="field-hint">
                      Si solo ingresa Inicio y Fin, la exportación QGIS generará
                      automáticamente un polígono envolvente usando la altura del talud.
                    </span>
                    {formData.verticesExtra.map((v, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px",
                          alignItems: "flex-end",
                        }}
                      >
                        <div className="field-group" style={{ flex: 1, minWidth: 130 }}>
                          <label className="field-label">Este V{idx + 3}</label>
                          <input
                            type="number"
                            step="0.01"
                            className="input"
                            value={v.este}
                            onChange={(e) =>
                              handleVertexChange(idx, "este", e.target.value)
                            }
                          />
                        </div>
                        <div className="field-group" style={{ flex: 1, minWidth: 130 }}>
                          <label className="field-label">Norte V{idx + 3}</label>
                          <input
                            type="number"
                            step="0.01"
                            className="input"
                            value={v.norte}
                            onChange={(e) =>
                              handleVertexChange(idx, "norte", e.target.value)
                            }
                          />
                        </div>
                        {workMode === "mobile" && (
                          <button
                            type="button"
                            className="btn btn-gps btn-sm"
                            onClick={() => handleCaptureGPS(idx)}
                          >
                            📍 GPS
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger-sm"
                          onClick={() => handleRemoveVertex(idx)}
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ----------------------------------------------------------- */}
              {/* CAMPOS ESPECÍFICOS SEGÚN ELEMENTO                           */}
              {/* ----------------------------------------------------------- */}

              {/* PROGRESIVAS */}
              {formData.elemento === "Otros (A detallar)" ? (
                isPunto ? (
                  <div className="field-group">
                    <label className="field-label">Progresivas</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Ej: 12+450"
                      value={formData.progresiva}
                      onChange={(e) => handleFieldChange("progresiva", e.target.value)}
                    />
                  </div>
                ) : (
                  <>
                    <div className="field-group">
                      <label className="field-label">Progresiva Inicio</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="Ej: 12+400"
                        value={formData.progresivaInicio}
                        onChange={(e) =>
                          handleFieldChange("progresivaInicio", e.target.value)
                        }
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label">Progresiva Fin</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="Ej: 12+520"
                        value={formData.progresivaFin}
                        onChange={(e) =>
                          handleFieldChange("progresivaFin", e.target.value)
                        }
                      />
                    </div>
                  </>
                )
              ) : isPunto ? (
                <div className="field-group">
                  <label className="field-label">Progresiva</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Ej: 04+250"
                    value={formData.progresiva}
                    onChange={(e) => handleFieldChange("progresiva", e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="field-group">
                    <label className="field-label">Progresiva Inicio</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Ej: 04+200"
                      value={formData.progresivaInicio}
                      onChange={(e) =>
                        handleFieldChange("progresivaInicio", e.target.value)
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Progresiva Fin</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Ej: 04+310"
                      value={formData.progresivaFin}
                      onChange={(e) =>
                        handleFieldChange("progresivaFin", e.target.value)
                      }
                    />
                  </div>
                </>
              )}

              {/* NOMBRE (Puente) */}
              {formData.elemento === "Puente" && (
                <div className="field-group">
                  <label className="field-label">Nombre del Puente</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Ej: Puente Río Grande"
                    value={formData.nombre}
                    onChange={(e) => handleFieldChange("nombre", e.target.value)}
                  />
                </div>
              )}

              {/* TIPO (Alcantarilla, Puente, Muro, Cuneta, Señal vertical) */}
              {configActual.tipos.length > 0 && (
                <div className="field-group">
                  <label className="field-label">Tipo</label>
                  <select
                    className="select"
                    value={formData.tipo}
                    onChange={(e) => handleFieldChange("tipo", e.target.value)}
                  >
                    <option value="">-- Seleccionar Tipo --</option>
                    {configActual.tipos.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* SECCIÓN (Alcantarilla, Cuneta) */}
              {(formData.elemento === "Alcantarilla" ||
                formData.elemento === "Cuneta") && (
                <div className="field-group">
                  <label className="field-label">Sección</label>
                  <input
                    type="text"
                    className="input"
                    placeholder={
                      formData.elemento === "Alcantarilla"
                        ? "Ej: Ø 1.00 m o 1.50 x 1.50 m"
                        : "Ej: Triangular 0.80 x 0.30 m"
                    }
                    value={formData.seccion}
                    onChange={(e) => handleFieldChange("seccion", e.target.value)}
                  />
                  <div className="quick-chips">
                    {(formData.elemento === "Alcantarilla"
                      ? ["Ø 0.80 m", "Ø 1.00 m", "Ø 1.20 m", "1.50 x 1.50 m", "2.00 x 2.00 m"]
                      : ["Triangular", "Trapezoidal", "Rectangular", "Media caña"]
                    ).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="chip-btn"
                        onClick={() => handleFieldChange("seccion", s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ANCHO DE CALZADA (Puente) */}
              {formData.elemento === "Puente" && (
                <div className="field-group">
                  <label className="field-label">Ancho de calzada (m)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    placeholder="Ej: 7.30"
                    value={formData.anchoCalzada}
                    onChange={(e) => handleFieldChange("anchoCalzada", e.target.value)}
                  />
                </div>
              )}

              {/* ALTURA (Muro, Talud) */}
              {(formData.elemento === "Muro" || formData.elemento === "Talud") && (
                <div className="field-group">
                  <label className="field-label">Altura (m)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    placeholder="Ej: 4.50"
                    value={formData.altura}
                    onChange={(e) => handleFieldChange("altura", e.target.value)}
                  />
                </div>
              )}

              {/* NÚMERO DE BANQUINAS (Talud) */}
              {formData.elemento === "Talud" && (
                <div className="field-group">
                  <label className="field-label">Número de banquinas</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    className="input"
                    placeholder="Ej: 2"
                    value={formData.numBanquinas}
                    onChange={(e) => handleFieldChange("numBanquinas", e.target.value)}
                  />
                </div>
              )}

              {/* LONGITUD (Alcantarilla, Puente, Muro, Talud, Cuneta) */}
              {["Alcantarilla", "Puente", "Muro", "Talud", "Cuneta"].includes(
                formData.elemento
              ) && (
                <div className="field-group">
                  <label className="field-label">Longitud (m)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    placeholder="Ej: 12.00"
                    value={formData.longitud}
                    onChange={(e) => handleFieldChange("longitud", e.target.value)}
                  />
                </div>
              )}

              {/* ESTADO (Todos) */}
              <div className="field-group">
                <label className="field-label">Estado *</label>
                <select
                  className="select"
                  value={formData.estado}
                  onChange={(e) => handleFieldChange("estado", e.target.value)}
                  required
                >
                  {ESTADOS.map((est) => (
                    <option key={est} value={est}>
                      {est}
                    </option>
                  ))}
                </select>
              </div>

              {/* DETALLE / OTROS ATRIBUTOS (Otros) */}
              {formData.elemento === "Otros (A detallar)" && (
                <div className="field-group span-full">
                  <label className="field-label">Detalle / Otros atributos *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Ej: Defensas metálicas (Guardarraíl), badén, pasarela peatonal, etc."
                    value={formData.detalleOtros}
                    onChange={(e) => handleFieldChange("detalleOtros", e.target.value)}
                    required
                  />
                </div>
              )}

              {/* FOTOGRAFÍA (Todos) */}
              <div className="field-group span-full">
                <label className="field-label">Fotografía del Elemento</label>
                <div className="photo-box">
                  <div className="photo-preview-wrap">
                    <label className="file-label-btn">
                      {workMode === "mobile"
                        ? "📸 Tomar Foto con Cámara"
                        : "📁 Subir Foto desde PC"}
                      {workMode === "mobile" ? (
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handlePhotoChange}
                          style={{ display: "none" }}
                        />
                      ) : (
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handlePhotoChange}
                          style={{ display: "none" }}
                        />
                      )}
                    </label>

                    {formData.fotoDataUrl ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <img
                          src={formData.fotoDataUrl}
                          alt="Vista previa"
                          className="photo-preview-img"
                          onClick={() =>
                            setPhotoModal({
                              src: formData.fotoDataUrl,
                              title: formData.fotoNombre || "Vista previa",
                            })
                          }
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span className="field-hint">{formData.fotoNombre}</span>
                          <button
                            type="button"
                            className="btn btn-danger-sm"
                            onClick={() =>
                              setFormData((p) => ({
                                ...p,
                                fotoDataUrl: "",
                                fotoNombre: "",
                              }))
                            }
                          >
                            Quitar foto
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="field-hint">
                        {workMode === "mobile"
                          ? "Abre la cámara trasera para capturar evidencia en campo."
                          : "Seleccione una imagen JPG/PNG desde su computadora."}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* OBSERVACIONES (Todos) */}
              <div className="field-group span-full">
                <label className="field-label">Observaciones</label>
                <textarea
                  className="textarea"
                  placeholder="Describa daños, sedimentación, erosión, necesidad de mantenimiento, etc."
                  value={formData.observaciones}
                  onChange={(e) => handleFieldChange("observaciones", e.target.value)}
                />
              </div>
            </div>

            <div className="form-actions">
              {editingId && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setEditingId(null);
                    setFormData(createEmptyForm(formData.elemento));
                  }}
                >
                  Cancelar Edición
                </button>
              )}
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setFormData(createEmptyForm(formData.elemento));
                  setGpsStatus(null);
                }}
              >
                Limpiar
              </button>
              <button type="submit" className="btn btn-amber">
                {editingId ? "💾 Actualizar Registro" : "💾 Guardar en Inventario"}
              </button>
            </div>
          </form>
        </section>

        {/* ================================================================= */}
        {/* 2. GESTIÓN DE REGISTROS Y EXPORTACIÓN PARA QGIS                   */}
        {/* ================================================================= */}
        <section className="card">
          <div className="card-header">
            <h2>
              🗂️ Registros Guardados ({records.length})
            </h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-export-qgis"
                onClick={() => setExportModalOpen(true)}
              >
                🗺️ Exportar para QGIS (GeoJSON / Shapefile)
              </button>
            </div>
          </div>

          {/* FILTROS */}
          <div className="records-toolbar">
            <div className="filters-row">
              <select
                className="select"
                value={filterElement}
                onChange={(e) => setFilterElement(e.target.value)}
                aria-label="Filtrar por Elemento"
              >
                <option value="Todos">Todos los Elementos</option>
                {ELEMENTOS.map((el) => (
                  <option key={el} value={el}>
                    {el}
                  </option>
                ))}
              </select>

              <select
                className="select"
                value={filterEstado}
                onChange={(e) => setFilterEstado(e.target.value)}
                aria-label="Filtrar por Estado"
              >
                <option value="Todos">Todos los Estados</option>
                {ESTADOS.map((est) => (
                  <option key={est} value={est}>
                    Estado: {est}
                  </option>
                ))}
              </select>

              <input
                type="search"
                className="input"
                placeholder="Buscar progresiva, nombre, obs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="field-hint">
                Mostrando {filteredRecords.length} de {records.length}
              </span>
              {records.length > 0 && (
                <button
                  type="button"
                  className="btn btn-danger-sm"
                  onClick={handleClearAll}
                >
                  Vaciar Todo
                </button>
              )}
            </div>
          </div>

          {/* LISTA EN TARJETAS (MODO CELULAR) O TABLA AMPLIA (MODO PC) */}
          {filteredRecords.length === 0 ? (
            <div className="empty-state">
              <p style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 6px" }}>
                No hay registros viales para mostrar
              </p>
              <p style={{ margin: 0, fontSize: "0.86rem" }}>
                Complete el formulario superior y presione &ldquo;Guardar en Inventario&rdquo;.
                Los datos se guardan automáticamente en este dispositivo.
              </p>
            </div>
          ) : workMode === "mobile" ? (
            <div className="mobile-cards-grid">
              {filteredRecords.map((r) => (
                <article key={r.id} className="record-card">
                  <div className="record-card-head">
                    <div className="record-card-badges">
                      <span className="badge badge-elem">{r.elemento}</span>
                      <span className="badge badge-geom">{r.geometria}</span>
                      <span
                        className={`badge badge-${r.estado.toLowerCase()}`}
                      >
                        {r.estado}
                      </span>
                    </div>
                    <span className="field-hint">{r.id}</span>
                  </div>

                  <div className="record-card-body">
                    <div className="record-meta">
                      <div>
                        <strong>Prog:</strong> {formatProgresivaText(r)}
                      </div>
                      <div className="utm-mono">
                        {r.geometria === "Punto" ? (
                          <>
                            E: {r.este} | N: {r.norte}
                          </>
                        ) : (
                          <>
                            Ini: {r.esteInicio}, {r.norteInicio}
                            <br />
                            Fin: {r.esteFin}, {r.norteFin}
                          </>
                        )}
                      </div>
                      <div>{formatResumenAtributos(r)}</div>
                      {r.observaciones && (
                        <div style={{ fontStyle: "italic", color: "#475569" }}>
                          &ldquo;{r.observaciones}&rdquo;
                        </div>
                      )}
                    </div>

                    {r.fotoDataUrl && (
                      <img
                        src={r.fotoDataUrl}
                        alt={r.elemento}
                        className="record-thumb"
                        onClick={() =>
                          setPhotoModal({
                            src: r.fotoDataUrl,
                            title: `${r.elemento} (${r.id})`,
                          })
                        }
                      />
                    )}
                  </div>

                  <div className="record-card-footer">
                    <span className="field-hint">{r.fechaHora}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-edit-sm"
                        onClick={() => handleEditRecord(r)}
                      >
                        ✏️ Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-sm"
                        onClick={() => handleDeleteRecord(r.id)}
                      >
                        🗑️ Eliminar
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID / Fecha</th>
                    <th>Elemento</th>
                    <th>Geometría</th>
                    <th>Progresiva(s)</th>
                    <th>Coordenadas UTM (WGS84 Z20S)</th>
                    <th>Atributos</th>
                    <th>Estado</th>
                    <th>Foto</th>
                    <th>Observaciones</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.id}</strong>
                        <div className="field-hint">{r.fechaHora}</div>
                        <div className="field-hint">{r.modoRegistro}</div>
                      </td>
                      <td>
                        <span className="badge badge-elem">{r.elemento}</span>
                      </td>
                      <td>
                        <span className="badge badge-geom">{r.geometria}</span>
                      </td>
                      <td>{formatProgresivaText(r)}</td>
                      <td>
                        <div className="utm-mono">
                          {r.geometria === "Punto" ? (
                            <>
                              E: {r.este}
                              <br />
                              N: {r.norte}
                            </>
                          ) : (
                            <>
                              <strong>Ini:</strong> {r.esteInicio}, {r.norteInicio}
                              <br />
                              <strong>Fin:</strong> {r.esteFin}, {r.norteFin}
                            </>
                          )}
                        </div>
                      </td>
                      <td style={{ maxWidth: 260 }}>
                        {formatResumenAtributos(r)}
                      </td>
                      <td>
                        <span
                          className={`badge badge-${r.estado.toLowerCase()}`}
                        >
                          {r.estado}
                        </span>
                      </td>
                      <td>
                        {r.fotoDataUrl ? (
                          <img
                            src={r.fotoDataUrl}
                            alt={r.elemento}
                            className="table-thumb"
                            onClick={() =>
                              setPhotoModal({
                                src: r.fotoDataUrl,
                                title: `${r.elemento} (${r.id})`,
                              })
                            }
                          />
                        ) : (
                          <span className="field-hint">—</span>
                        )}
                      </td>
                      <td style={{ maxWidth: 220 }}>
                        {r.observaciones || <span className="field-hint">—</span>}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-edit-sm"
                            onClick={() => handleEditRecord(r)}
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger-sm"
                            onClick={() => handleDeleteRecord(r.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* =================================================================== */}
      {/* MODAL DE EXPORTACIÓN PARA QGIS                                      */}
      {/* =================================================================== */}
      {exportModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setExportModalOpen(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🗺️ Exportar Inventario para QGIS</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setExportModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="export-option-box">
                <strong>1. GeoJSON Universal (.geojson) — Recomendado</strong>
                <span className="field-hint">
                  Incluye geometrías (Point, LineString, Polygon) proyectadas en
                  WGS84 para carga directa en QGIS sin errores, más todas las
                  columnas UTM EPSG:32720 y atributos viales.
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn btn-export-qgis"
                    onClick={() => handleExportGeoJSON(false)}
                  >
                    ⬇️ Descargar GeoJSON ({records.length} reg.)
                  </button>
                  {filteredRecords.length !== records.length && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => handleExportGeoJSON(true)}
                    >
                      Solo filtrados ({filteredRecords.length})
                    </button>
                  )}
                </div>
              </div>

              <div className="export-option-box">
                <strong>2. CSV con Coordenadas UTM + WKT (EPSG:32720)</strong>
                <span className="field-hint">
                  Ideal para Excel o para importar en QGIS mediante &ldquo;Añadir
                  capa de texto delimitado&rdquo; usando la columna{" "}
                  <code>wkt_epsg32720</code> y SRC <strong>EPSG:32720</strong>.
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleExportCSV(false)}
                  >
                    ⬇️ Descargar CSV UTM ({records.length} reg.)
                  </button>
                  {filteredRecords.length !== records.length && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => handleExportCSV(true)}
                    >
                      Solo filtrados ({filteredRecords.length})
                    </button>
                  )}
                </div>
              </div>

              <div className="qgis-tip">
                <strong>Tip para convertir a Shapefile (.shp) en QGIS:</strong>{" "}
                Arrastra el archivo <code>.geojson</code> descargado hacia QGIS →
                Clic derecho en la capa → <em>Exportar → Guardar objetos como...</em>{" "}
                → Formato: <strong>Archivo shape de ESRI</strong> → SRC:{" "}
                <strong>EPSG:32720 (WGS 84 / UTM zone 20S)</strong>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL DE VISTA PREVIA DE FOTOGRAFÍA                                 */}
      {/* =================================================================== */}
      {photoModal && (
        <div className="modal-backdrop" onClick={() => setPhotoModal(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: 680 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>📷 {photoModal.title}</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setPhotoModal(null)}
              >
                ×
              </button>
            </div>
            <div className="modal-body" style={{ alignItems: "center" }}>
              <img
                src={photoModal.src}
                alt={photoModal.title}
                style={{
                  maxWidth: "100%",
                  maxHeight: "72vh",
                  borderRadius: 8,
                  objectFit: "contain",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICACIÓN FLOTANTE */}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}