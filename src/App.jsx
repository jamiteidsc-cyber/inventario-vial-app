/**
 * INVENTARIO VIAL VEIDCON
 * Desarrollado por: MSc. Ing. Mohammed Veramendy
 *
 * REQUISITO DE INSTALACIÓN NPM:
 *   npm install @supabase/supabase-js
 *
 * NOTA: Las librerías SheetJS (xlsx) y jsPDF + jsPDF-AutoTable se cargan
 * dinámicamente desde CDN bajo demanda al momento de exportar Excel o PDF,
 * evitando errores de compilación y manteniendo la app ligera en campo.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ============================================================================
// 1. CONEXIÓN A SUPABASE (BASE DE DATOS Y STORAGE BUCKET)
// ============================================================================
const SUPABASE_URL = "https://riinqhsnjbcvettxyysq.supabase.co";
const SUPABASE_KEY = "sb_publishable_5YfQHZDl5k87JB5s1gLfYQ_HEjN43tk";
const STORAGE_BUCKET = "fotos-viales";
const TABLE_NAME = "inventario_vial";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PENDING_STORAGE_KEY = "veidcon_pending_sync_v1";
const CACHE_STORAGE_KEY = "veidcon_cloud_cache_v1";

// ============================================================================
// 2. CARGA DINÁMICA DE LIBRERÍAS CDN (EXCEL XLSX & PDF CON FOTOS)
// ============================================================================
const loadedScripts = {};

function loadExternalScript(src) {
  if (loadedScripts[src]) return loadedScripts[src];
  loadedScripts[src] = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing && existing.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      delete loadedScripts[src];
      reject(new Error(`No se pudo cargar librería externa: ${src}`));
    };
    document.head.appendChild(script);
  });
  return loadedScripts[src];
}

async function ensureXLSX() {
  if (window.XLSX) return window.XLSX;
  await loadExternalScript(
    "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"
  );
  if (!window.XLSX) throw new Error("XLSX no disponible tras carga CDN.");
  return window.XLSX;
}

async function ensureJsPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    await loadExternalScript(
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
    );
  }
  const probe = new window.jspdf.jsPDF();
  if (typeof probe.autoTable !== "function") {
    await loadExternalScript(
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js"
    );
  }
  return window.jspdf.jsPDF;
}

// ============================================================================
// 3. GEODESIA: WGS84 LAT/LON <-> UTM ZONA 20S (EPSG:32720)
// ============================================================================
const WGS84 = {
  a: 6378137.0,
  k0: 0.9996,
  e2: 0.0066943799901413165,
  ep2: 0.006739496742276434,
  lon0Rad: (-63 * Math.PI) / 180, // Meridiano central Zona 20S (-63°)
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
    este: easting.toFixed(2),
    norte: northing.toFixed(2),
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
// 4. CATÁLOGOS DE ELEMENTOS VIALES Y UTILIDADES DE IMAGEN
// ============================================================================
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
  esteInicio: "",
  norteInicio: "",
  esteFin: "",
  norteFin: "",
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
  // Galerías de hasta 3 fotografías por ubicación
  fotosInicio: [null, null, null], // { dataUrl, name }
  fotosFin: [null, null, null],
});

function compressImage(file, maxDim = 1100, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Error al leer el archivo de imagen."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Formato de imagen no válido."));
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

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(base64);
  const len = binary.length;
  const u8arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    u8arr[i] = binary.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

// Convierte URL pública o DataURL a Base64 JPEG optimizado para incrustar en jsPDF
async function imageToPdfBase64(src) {
  if (!src) return null;
  if (src.startsWith("data:image/")) return src;
  try {
    const resp = await fetch(src, { mode: "cors" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          const maxW = 640;
          let w = img.width;
          let h = img.height;
          if (w > maxW) {
            h = Math.round((h * maxW) / w);
            w = maxW;
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve({
            dataUrl: canvas.toDataURL("image/jpeg", 0.78),
            ratio: h / w,
          });
        };
        img.onerror = () => resolve(null);
        img.src = reader.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function normalizeImageForPdf(src) {
  if (!src) return null;
  if (src.startsWith("data:image/")) {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({ dataUrl: src, ratio: img.height / (img.width || 1) });
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  return await imageToPdfBase64(src);
}

const toNum = (v) =>
  v === "" || v === null || v === undefined || Number.isNaN(Number(v))
    ? null
    : Number(v);

const toInt = (v) =>
  v === "" || v === null || v === undefined || Number.isNaN(parseInt(v, 10))
    ? null
    : parseInt(v, 10);

function extractPhotosFromRecord(rec) {
  const extra = rec.atributos_extra || {};
  let inicio = Array.isArray(extra.fotos_inicio) ? [...extra.fotos_inicio] : [];
  let fin = Array.isArray(extra.fotos_fin) ? [...extra.fotos_fin] : [];
  if (inicio.length === 0 && rec.foto_url) {
    inicio = [rec.foto_url];
  }
  return { inicio, fin };
}

function downloadBlob(blob, filename) {
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
// 5. EXPORTADORES: GEOJSON (QGIS) & CSV
// ============================================================================
function buildPolygonRingUtm(rec) {
  const e1 = Number(rec.este_inicio);
  const n1 = Number(rec.norte_inicio);
  const e2 = Number(rec.este_fin);
  const n2 = Number(rec.norte_fin);
  const dx = e2 - e1;
  const dy = n2 - n1;
  const len = Math.hypot(dx, dy) || 1;
  const offset = Math.max(Number(rec.altura) || 8, 5);
  const nx = (-dy / len) * offset;
  const ny = (dx / len) * offset;
  return [
    [e1, n1],
    [e2, n2],
    [Number((e2 + nx).toFixed(2)), Number((n2 + ny).toFixed(2))],
    [Number((e1 + nx).toFixed(2)), Number((n1 + ny).toFixed(2))],
    [e1, n1],
  ];
}

function buildGeoJSON(records) {
  const features = records.map((rec) => {
    const { inicio, fin } = extractPhotosFromRecord(rec);
    let geometry;

    if (rec.geometria === "Punto") {
      const { lon, lat } = utm20SToLatLon(rec.este_inicio, rec.norte_inicio);
      geometry = { type: "Point", coordinates: [lon, lat] };
    } else if (rec.geometria === "Polígono") {
      const ringUtm = buildPolygonRingUtm(rec);
      const ringWgs = ringUtm.map(([e, n]) => {
        const { lon, lat } = utm20SToLatLon(e, n);
        return [lon, lat];
      });
      geometry = { type: "Polygon", coordinates: [ringWgs] };
    } else {
      const p1 = utm20SToLatLon(rec.este_inicio, rec.norte_inicio);
      const p2 = utm20SToLatLon(rec.este_fin, rec.norte_fin);
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
      properties: {
        id: rec.id,
        fecha: rec.created_at || "",
        elemento: rec.elemento,
        geometria: rec.geometria,
        epsg_utm: "EPSG:32720",
        este_inicio: toNum(rec.este_inicio),
        norte_inicio: toNum(rec.norte_inicio),
        este_fin: toNum(rec.este_fin),
        norte_fin: toNum(rec.norte_fin),
        progresiva_inicio: rec.progresiva_inicio || "",
        progresiva_fin: rec.progresiva_fin || "",
        nombre: rec.nombre || "",
        tipo: rec.tipo || "",
        seccion: rec.seccion || "",
        ancho_calzada_m: toNum(rec.ancho_calzada),
        altura_m: toNum(rec.altura),
        longitud_m: toNum(rec.longitud),
        num_banquinas: toInt(rec.num_banquinas),
        estado: rec.estado || "",
        detalle_otros: rec.detalle_otros || "",
        observaciones: rec.observaciones || "",
        foto_principal: rec.foto_url || inicio[0] || "",
        fotos_inicio: inicio.join(" | "),
        fotos_fin: fin.join(" | "),
        autor: "MSc. Ing. Mohammed Veramendy",
      },
    };
  });

  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: "Inventario_Vial_VEIDCON_WGS84",
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
    "created_at",
    "elemento",
    "geometria",
    "epsg_utm",
    "este_inicio",
    "norte_inicio",
    "este_fin",
    "norte_fin",
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
    "fotos_inicio_urls",
    "fotos_fin_urls",
    "wkt_epsg32720",
  ];

  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = records.map((r) => {
    const { inicio, fin } = extractPhotosFromRecord(r);
    let wkt = "";
    if (r.geometria === "Punto") {
      wkt = `POINT (${r.este_inicio} ${r.norte_inicio})`;
    } else if (r.geometria === "Polígono") {
      const ring = buildPolygonRingUtm(r)
        .map(([e, n]) => `${e} ${n}`)
        .join(", ");
      wkt = `POLYGON ((${ring}))`;
    } else {
      wkt = `LINESTRING (${r.este_inicio} ${r.norte_inicio}, ${r.este_fin} ${r.norte_fin})`;
    }

    return [
      r.id,
      r.created_at || "",
      r.elemento,
      r.geometria,
      "EPSG:32720",
      r.este_inicio ?? "",
      r.norte_inicio ?? "",
      r.este_fin ?? "",
      r.norte_fin ?? "",
      r.progresiva_inicio || "",
      r.progresiva_fin || "",
      r.nombre || "",
      r.tipo || "",
      r.seccion || "",
      r.ancho_calzada ?? "",
      r.altura ?? "",
      r.longitud ?? "",
      r.num_banquinas ?? "",
      r.estado || "",
      r.detalle_otros || "",
      r.observaciones || "",
      inicio.join(" | "),
      fin.join(" | "),
      wkt,
    ]
      .map(esc)
      .join(",");
  });

  return "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
}

// ============================================================================
// 6. ESTILOS CSS EMBEBIDOS (ALTO CONTRASTE SOLAR Y DISEÑO PROFESIONAL)
// ============================================================================
const APP_STYLES = `
  :root {
    --vial-dark-950: #0f172a;
    --vial-dark-900: #16243d;
    --vial-dark-800: #1e3a5f;
    --vial-amber-500: #f59e0b;
    --vial-amber-600: #d97706;
    --vial-amber-100: #fef3c7;
    --vial-green-600: #059669;
    --vial-green-500: #10b981;
    --vial-green-100: #d1fae5;
    --vial-red-600: #dc2626;
    --vial-red-100: #fee2e2;
    --vial-blue-600: #2563eb;
    --vial-slate-50: #f1f5f9;
    --vial-slate-100: #e2e8f0;
    --vial-slate-200: #cbd5e1;
    --vial-slate-500: #64748b;
    --vial-slate-700: #334155;
    --vial-white: #ffffff;
    --radius-md: 10px;
    --radius-lg: 14px;
    --shadow-sm: 0 2px 8px rgba(15, 23, 42, 0.08);
    --shadow-md: 0 8px 26px rgba(15, 23, 42, 0.16);
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
      Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
    background-color: var(--vial-slate-50);
    color: var(--vial-dark-950);
    -webkit-font-smoothing: antialiased;
  }

  .app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* =====================================================================
     ENCABEZADO PRINCIPAL — CONTRASTE PURO #FFFFFF SOBRE #0F172A / #1E3A5F
     ===================================================================== */
  .app-header {
    background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
    color: #ffffff;
    padding: 18px 20px;
    border-bottom: 4px solid #f59e0b;
    box-shadow: var(--shadow-md);
    position: sticky;
    top: 0;
    z-index: 40;
  }

  .header-inner {
    max-width: 1380px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .brand-box {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1;
    min-width: 280px;
  }

  .brand-badge {
    width: 52px;
    height: 52px;
    border-radius: 12px;
    background: #f59e0b;
    color: #0f172a;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    font-weight: 900;
    flex-shrink: 0;
    box-shadow: 0 4px 14px rgba(245, 158, 11, 0.45);
  }

  .brand-title {
    margin: 0;
    color: #ffffff;
    font-size: 1.42rem;
    font-weight: 900;
    letter-spacing: -0.01em;
    line-height: 1.15;
  }

  .brand-sub {
    margin: 4px 0 0;
    color: #ffffff;
    font-size: 0.84rem;
    font-weight: 500;
    line-height: 1.35;
  }

  .brand-credit-row {
    margin-top: 6px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .credit-pill {
    background: rgba(245, 158, 11, 0.18);
    border: 1.5px solid #f59e0b;
    color: #f59e0b;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 800;
  }

  .status-pill {
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 800;
  }
  .status-pill.online {
    background: rgba(16, 185, 129, 0.22);
    border: 1px solid #10b981;
    color: #ffffff;
  }
  .status-pill.offline {
    background: rgba(220, 38, 38, 0.35);
    border: 1px solid #f87171;
    color: #ffffff;
  }

  /* INTERRUPTOR MODO DE TRABAJO */
  .mode-switch-wrapper {
    background: rgba(15, 23, 42, 0.85);
    border: 2px solid rgba(255, 255, 255, 0.28);
    border-radius: 12px;
    padding: 7px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 310px;
  }

  .mode-switch-label {
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #f59e0b;
    text-align: center;
  }

  .mode-switch-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .mode-btn {
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 0.88rem;
    font-weight: 800;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all 0.16s ease;
  }

  .mode-btn.active-mobile {
    background: #f59e0b;
    color: #0f172a;
    border-color: #f59e0b;
    box-shadow: 0 2px 12px rgba(245, 158, 11, 0.5);
  }

  .mode-btn.active-pc {
    background: #ffffff;
    color: #0f172a;
    border-color: #ffffff;
    box-shadow: 0 2px 12px rgba(255, 255, 255, 0.35);
  }

  /* MAIN */
  .main-container {
    max-width: 1380px;
    width: 100%;
    margin: 20px auto 36px;
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  /* BANNER DE SINCRONIZACIÓN PENDIENTE */
  .sync-banner {
    background: #fef3c7;
    border: 2px solid #f59e0b;
    border-radius: var(--radius-md);
    padding: 14px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    color: #78350f;
    box-shadow: var(--shadow-sm);
  }

  /* CARDS */
  .card {
    background: var(--vial-white);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    border: 1.5px solid var(--vial-slate-200);
    overflow: hidden;
  }

  /* ENCABEZADOS DE SECCIÓN OSCUROS: TEXTO BLANCO PURO #FFFFFF */
  .card-header {
    background: linear-gradient(90deg, #0f172a 0%, #1e3a5f 100%);
    color: #ffffff;
    padding: 14px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    border-bottom: 3px solid #f59e0b;
  }

  .card-header h2 {
    margin: 0;
    color: #ffffff;
    font-size: 1.08rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-mode-tag {
    background: rgba(245, 158, 11, 0.2);
    border: 1.5px solid #f59e0b;
    color: #ffffff;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 800;
  }

  .card-body {
    padding: 20px;
  }

  /* SELECTOR PRINCIPAL ELEMENTO */
  .element-selector-bar {
    background: var(--vial-slate-50);
    border: 2px solid var(--vial-dark-800);
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

  /* FORM GRID */
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

  @media (min-width: 1040px) {
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
    font-size: 0.83rem;
    font-weight: 800;
    color: var(--vial-dark-950);
  }

  .field-hint {
    font-size: 0.74rem;
    color: var(--vial-slate-500);
  }

  .input,
  .select,
  .textarea {
    width: 100%;
    min-height: 44px;
    padding: 9px 12px;
    font-size: 0.94rem;
    border: 1.5px solid var(--vial-slate-200);
    border-radius: 8px;
    background: var(--vial-white);
    color: var(--vial-dark-950);
    font-family: inherit;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .textarea {
    min-height: 84px;
    resize: vertical;
  }

  .input:focus,
  .select:focus,
  .textarea:focus {
    outline: none;
    border-color: var(--vial-dark-800);
    box-shadow: 0 0 0 3px rgba(30, 58, 95, 0.16);
  }

  /* BLOQUES DE UBICACIÓN UTM + GALERÍA 3 FOTOS */
  .locations-container {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .locations-dual-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }

  @media (min-width: 920px) {
    .locations-dual-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  .location-block {
    background: #f8fafc;
    border: 2px solid var(--vial-dark-800);
    border-radius: var(--radius-md);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .location-block-header {
    background: var(--vial-dark-800);
    color: #ffffff;
    padding: 10px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .location-block-title {
    font-size: 0.88rem;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: 0.02em;
  }

  .location-block-body {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .utm-pair {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  @media (min-width: 480px) {
    .utm-pair {
      grid-template-columns: 1fr 1fr;
    }
  }

  /* GALERÍA 3 SLOTS DE FOTOGRAFÍA */
  .photo-gallery-title {
    font-size: 0.8rem;
    font-weight: 800;
    color: var(--vial-dark-950);
    margin-bottom: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .photo-slots-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .photo-slot {
    border: 2px dashed var(--vial-slate-200);
    border-radius: 8px;
    background: #ffffff;
    min-height: 112px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 6px;
    position: relative;
    text-align: center;
    transition: border-color 0.15s ease;
  }

  .photo-slot:hover {
    border-color: var(--vial-dark-800);
  }

  .photo-slot-label {
    cursor: pointer;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--vial-dark-800);
    font-size: 0.74rem;
    font-weight: 700;
  }

  .photo-slot-img {
    width: 100%;
    height: 76px;
    object-fit: cover;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid var(--vial-slate-200);
  }

  .photo-slot-actions {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 4px;
    gap: 4px;
  }

  .photo-slot-tag {
    font-size: 0.68rem;
    font-weight: 800;
    color: var(--vial-slate-700);
  }

  .photo-remove-btn {
    border: none;
    background: var(--vial-red-100);
    color: var(--vial-red-600);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.7rem;
    font-weight: 800;
    cursor: pointer;
  }
  .photo-remove-btn:hover {
    background: var(--vial-red-600);
    color: #ffffff;
  }

  /* BOTONES */
  .btn {
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 0.88rem;
    font-weight: 800;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 44px;
    font-family: inherit;
    transition: all 0.16s ease;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-sm {
    min-height: 36px;
    padding: 6px 12px;
    font-size: 0.8rem;
  }

  .btn-gps {
    background: var(--vial-green-600);
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(5, 150, 105, 0.35);
  }
  .btn-gps:hover:not(:disabled) {
    background: #047857;
  }

  .btn-amber {
    background: #f59e0b;
    color: #0f172a;
  }
  .btn-amber:hover:not(:disabled) {
    background: #d97706;
    color: #ffffff;
  }

  .btn-primary {
    background: #1e3a5f;
    color: #ffffff;
  }
  .btn-primary:hover:not(:disabled) {
    background: #0f172a;
  }

  .btn-outline {
    background: #ffffff;
    color: #0f172a;
    border: 1.5px solid var(--vial-slate-200);
  }
  .btn-outline:hover:not(:disabled) {
    border-color: #1e3a5f;
    background: var(--vial-slate-50);
  }

  .btn-danger-sm {
    background: var(--vial-red-100);
    color: var(--vial-red-600);
    min-height: 34px;
    padding: 5px 10px;
    font-size: 0.78rem;
  }
  .btn-danger-sm:hover:not(:disabled) {
    background: var(--vial-red-600);
    color: #ffffff;
  }

  /* BARRA DE EXPORTACIÓN PROFESIONAL (4 BOTONES) */
  .export-bar {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 16px 20px;
    background: #f8fafc;
    border-bottom: 1.5px solid var(--vial-slate-200);
  }

  @media (min-width: 640px) {
    .export-bar {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (min-width: 1080px) {
    .export-bar {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .btn-exp-qgis {
    background: #059669;
    color: #ffffff;
  }
  .btn-exp-qgis:hover:not(:disabled) {
    background: #047857;
  }

  .btn-exp-excel {
    background: #15803d;
    color: #ffffff;
  }
  .btn-exp-excel:hover:not(:disabled) {
    background: #166534;
  }

  .btn-exp-pdf {
    background: #b91c1c;
    color: #ffffff;
  }
  .btn-exp-pdf:hover:not(:disabled) {
    background: #991b1b;
  }

  .btn-exp-csv {
    background: #1e3a5f;
    color: #ffffff;
  }
  .btn-exp-csv:hover:not(:disabled) {
    background: #0f172a;
  }

  /* CHIPS RÁPIDOS DE SECCIÓN */
  .quick-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .chip-btn {
    background: var(--vial-slate-100);
    color: var(--vial-dark-950);
    border: 1px solid var(--vial-slate-200);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }
  .chip-btn:hover {
    background: var(--vial-amber-100);
    border-color: var(--vial-amber-500);
  }

  /* FORM ACTIONS */
  .form-actions {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1.5px solid var(--vial-slate-200);
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 10px;
  }

  /* FILTROS DE TABLA */
  .records-toolbar {
    padding: 14px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    border-bottom: 1px solid var(--vial-slate-200);
    background: #ffffff;
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
    min-width: 175px;
    min-height: 38px;
    padding: 6px 10px;
    font-size: 0.85rem;
  }

  /* TABLA EN VIVO */
  .table-responsive {
    width: 100%;
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.83rem;
    min-width: 1080px;
  }

  .data-table th {
    background: #0f172a;
    color: #ffffff;
    text-align: left;
    padding: 12px;
    font-weight: 800;
    white-space: nowrap;
    border-bottom: 2px solid #f59e0b;
  }

  .data-table td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--vial-slate-200);
    vertical-align: top;
  }

  .data-table tr:hover td {
    background: #f8fafc;
  }

  .utm-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.76rem;
    background: var(--vial-slate-50);
    border: 1px solid var(--vial-slate-200);
    padding: 4px 7px;
    border-radius: 6px;
    display: inline-block;
    color: #0f172a;
  }

  .table-thumbs-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .table-thumbs-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .thumb-mini {
    width: 44px;
    height: 36px;
    object-fit: cover;
    border-radius: 5px;
    border: 1.5px solid #1e3a5f;
    cursor: pointer;
  }

  /* BADGES */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 0.73rem;
    font-weight: 800;
    white-space: nowrap;
  }
  .badge-elem {
    background: #1e3a5f;
    color: #ffffff;
  }
  .badge-geom {
    background: var(--vial-slate-100);
    color: #0f172a;
    border: 1px solid var(--vial-slate-200);
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
  .badge-pending {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #f59e0b;
  }

  /* GPS FEEDBACK */
  .gps-banner {
    grid-column: 1 / -1;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 0.84rem;
    font-weight: 700;
  }
  .gps-banner.ok {
    background: var(--vial-green-100);
    color: #065f46;
    border: 1px solid #10b981;
  }
  .gps-banner.err {
    background: var(--vial-red-100);
    color: #991b1b;
    border: 1px solid #ef4444;
  }

  /* MODAL FOTO */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.78);
    z-index: 95;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-card {
    background: #ffffff;
    border-radius: var(--radius-lg);
    max-width: 740px;
    width: 100%;
    overflow: hidden;
    box-shadow: 0 24px 55px rgba(0, 0, 0, 0.4);
  }

  .modal-header {
    background: #0f172a;
    color: #ffffff;
    padding: 14px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px solid #f59e0b;
  }

  .modal-header h3 {
    margin: 0;
    color: #ffffff;
    font-size: 1rem;
  }

  .modal-close {
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
  }

  /* TOAST */
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 100;
    padding: 12px 18px;
    border-radius: 10px;
    color: #ffffff;
    font-weight: 800;
    font-size: 0.88rem;
    box-shadow: var(--shadow-md);
  }
  .toast.success {
    background: #059669;
  }
  .toast.error {
    background: #dc2626;
  }
  .toast.info {
    background: #1e3a5f;
  }

  /* FOOTER */
  .app-footer {
    margin-top: auto;
    background: #0f172a;
    color: #ffffff;
    text-align: center;
    padding: 16px 20px;
    font-size: 0.84rem;
    border-top: 3px solid #f59e0b;
  }

  .app-footer strong {
    color: #f59e0b;
  }

  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--vial-slate-500);
  }
`;

// ============================================================================
// 7. COMPONENTE PRINCIPAL: INVENTARIO VIAL VEIDCON
// ============================================================================
export default function App() {
  const [workMode, setWorkMode] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "mobile" : "pc"
  );

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const [cloudRecords, setCloudRecords] = useState(() => {
    try {
      const cached = localStorage.getItem(CACHE_STORAGE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });

  const [pendingRecords, setPendingRecords] = useState(() => {
    try {
      const pending = localStorage.getItem(PENDING_STORAGE_KEY);
      return pending ? JSON.parse(pending) : [];
    } catch {
      return [];
    }
  });

  const [formData, setFormData] = useState(() => createEmptyForm("Alcantarilla"));
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [gpsLoadingTarget, setGpsLoadingTarget] = useState(null);
  const [gpsStatus, setGpsStatus] = useState(null);

  const [filterElement, setFilterElement] = useState("Todos");
  const [filterEstado, setFilterEstado] = useState("Todos");
  const [searchQuery, setSearchQuery] = useState("");

  const [photoModal, setPhotoModal] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }, []);

  // Persistencia de cola offline y caché
  useEffect(() => {
    try {
      localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pendingRecords));
    } catch {
      // Silencio si cuota local excedida
    }
  }, [pendingRecords]);

  useEffect(() => {
    try {
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cloudRecords));
    } catch {
      // Silencio si cuota local excedida
    }
  }, [cloudRecords]);

  // Cargar registros en vivo desde Supabase
  const fetchCloudRecords = useCallback(async () => {
    setLoadingRecords(true);
    try {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setCloudRecords(data || []);
    } catch (err) {
      console.warn("No se pudo actualizar desde Supabase:", err.message);
    } finally {
      setLoadingRecords(false);
    }
  }, []);

  useEffect(() => {
    fetchCloudRecords();
  }, [fetchCloudRecords]);

  // Monitorear conectividad online / offline
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      fetchCloudRecords();
      showToast("info", "Conexión restablecida.");
    };
    const onOffline = () => {
      setIsOnline(false);
      showToast("error", "Sin internet: los registros se guardarán localmente.");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [fetchCloudRecords, showToast]);

  // Subir una fotografía al bucket fotos-viales y devolver su URL pública
  const uploadPhotoToSupabase = async (dataUrl, tag) => {
    const blob = dataUrlToBlob(dataUrl);
    const filePath = `veidcon/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}_${tag}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, blob, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  };

  // Cambio de elemento vial
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

  // Captura GPS en Modo Celular -> UTM WGS84 Zona 20S (2 decimales)
  const handleCaptureGPS = (target) => {
    if (!navigator.geolocation) {
      setGpsStatus({
        ok: false,
        text: "El navegador o dispositivo no soporta geolocalización GPS.",
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
          if (target === "inicio") {
            return { ...prev, esteInicio: este, norteInicio: norte };
          }
          return { ...prev, esteFin: este, norteFin: norte };
        });

        setGpsLoadingTarget(null);
        setGpsStatus({
          ok: true,
          text: `GPS ${
            target === "inicio" ? "Punto / Inicio" : "Fin"
          } (UTM Z20S): E ${este} m | N ${norte} m (±${accuracy.toFixed(1)} m)`,
        });
      },
      (err) => {
        setGpsLoadingTarget(null);
        let msg = "No se pudo obtener la señal GPS.";
        if (err.code === 1) msg = "Permiso de ubicación denegado.";
        if (err.code === 2) msg = "Posición no disponible (busque cielo abierto).";
        if (err.code === 3) msg = "Tiempo de espera GPS agotado.";
        setGpsStatus({ ok: false, text: msg });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Manejo de galería de 3 fotos por ubicación
  const handlePhotoSlotChange = async (galleryKey, slotIndex, event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      setFormData((prev) => {
        const copy = [...prev[galleryKey]];
        copy[slotIndex] = {
          dataUrl,
          name: file.name || `foto_${slotIndex + 1}.jpg`,
        };
        return { ...prev, [galleryKey]: copy };
      });
    } catch (err) {
      showToast("error", err.message || "Error al procesar fotografía.");
    }
  };

  const handleRemovePhotoSlot = (galleryKey, slotIndex) => {
    setFormData((prev) => {
      const copy = [...prev[galleryKey]];
      copy[slotIndex] = null;
      return { ...prev, [galleryKey]: copy };
    });
  };

  // Calcular distancia horizontal automática entre Inicio y Fin
  const handleCalcLongitudUTM = () => {
    const e1 = parseFloat(formData.esteInicio);
    const n1 = parseFloat(formData.norteInicio);
    const e2 = parseFloat(formData.esteFin);
    const n2 = parseFloat(formData.norteFin);
    if ([e1, n1, e2, n2].some(Number.isNaN)) {
      showToast("error", "Ingrese UTM Inicio y Fin válidas para calcular longitud.");
      return;
    }
    handleFieldChange("longitud", Math.hypot(e2 - e1, n2 - n1).toFixed(2));
  };

  // Guardar registro en Supabase (o en cola offline si no hay señal)
  const handleSubmit = async (e) => {
    e.preventDefault();
    const isPunto = formData.geometria === "Punto";

    if (
      formData.esteInicio === "" ||
      formData.norteInicio === "" ||
      Number.isNaN(Number(formData.esteInicio)) ||
      Number.isNaN(Number(formData.norteInicio))
    ) {
      showToast(
        "error",
        isPunto
          ? "Debe ingresar Coordenada Este y Norte del Punto."
          : "Debe ingresar Coordenadas UTM válidas del Punto Inicial."
      );
      return;
    }

    if (
      !isPunto &&
      (formData.esteFin === "" ||
        formData.norteFin === "" ||
        Number.isNaN(Number(formData.esteFin)) ||
        Number.isNaN(Number(formData.norteFin)))
    ) {
      showToast("error", "Debe ingresar Coordenadas UTM válidas del Punto Final.");
      return;
    }

    setSaving(true);

    const fotosInicioValidas = formData.fotosInicio.filter(Boolean);
    const fotosFinValidas = isPunto ? [] : formData.fotosFin.filter(Boolean);

    const basePayload = {
      elemento: formData.elemento,
      geometria: formData.geometria,
      este_inicio: toNum(formData.esteInicio),
      norte_inicio: toNum(formData.norteInicio),
      este_fin: isPunto ? null : toNum(formData.esteFin),
      norte_fin: isPunto ? null : toNum(formData.norteFin),
      progresiva_inicio: formData.progresivaInicio || null,
      progresiva_fin: isPunto ? null : formData.progresivaFin || null,
      nombre: formData.nombre || null,
      tipo: formData.tipo || null,
      seccion: formData.seccion || null,
      ancho_calzada: toNum(formData.anchoCalzada),
      altura: toNum(formData.altura),
      longitud: toNum(formData.longitud),
      num_banquinas: toInt(formData.numBanquinas),
      estado: formData.estado,
      detalle_otros: formData.detalleOtros || null,
      observaciones: formData.observaciones || null,
    };

    const saveOfflineFallback = () => {
      const pendingItem = {
        ...basePayload,
        id: `LOCAL-${Date.now()}`,
        created_at: new Date().toISOString(),
        _isPending: true,
        foto_url: fotosInicioValidas[0]?.dataUrl || fotosFinValidas[0]?.dataUrl || null,
        atributos_extra: {
          fotos_inicio: fotosInicioValidas.map((f) => f.dataUrl),
          fotos_fin: fotosFinValidas.map((f) => f.dataUrl),
          modo_registro:
            workMode === "mobile" ? "Celular (Campo)" : "PC (Gabinete)",
        },
      };
      setPendingRecords((prev) => [pendingItem, ...prev]);
      setFormData(createEmptyForm(formData.elemento));
      setGpsStatus(null);
      showToast(
        "info",
        "Sin señal: guardado en cola local. Use 'Sincronizar pendientes' al recuperar internet."
      );
    };

    if (!navigator.onLine) {
      saveOfflineFallback();
      setSaving(false);
      return;
    }

    try {
      // 1. Subir fotografías al bucket fotos-viales
      const urlsInicio = [];
      for (let i = 0; i < fotosInicioValidas.length; i++) {
        const url = await uploadPhotoToSupabase(
          fotosInicioValidas[i].dataUrl,
          `ini${i + 1}`
        );
        urlsInicio.push(url);
      }

      const urlsFin = [];
      for (let i = 0; i < fotosFinValidas.length; i++) {
        const url = await uploadPhotoToSupabase(
          fotosFinValidas[i].dataUrl,
          `fin${i + 1}`
        );
        urlsFin.push(url);
      }

      const payloadToInsert = {
        ...basePayload,
        foto_url: urlsInicio[0] || urlsFin[0] || null,
        atributos_extra: {
          fotos_inicio: urlsInicio,
          fotos_fin: urlsFin,
          modo_registro:
            workMode === "mobile" ? "Celular (Campo)" : "PC (Gabinete)",
        },
      };

      // 2. Insertar en tabla public.inventario_vial
      const { data: inserted, error } = await supabase
        .from(TABLE_NAME)
        .insert([payloadToInsert])
        .select()
        .single();

      if (error) throw error;

      setCloudRecords((prev) => [inserted, ...prev]);
      setFormData(createEmptyForm(formData.elemento));
      setGpsStatus(null);
      showToast("success", `${formData.elemento} guardado en Supabase.`);
    } catch (err) {
      console.error("Error guardando en Supabase, pasando a cola offline:", err);
      saveOfflineFallback();
    } finally {
      setSaving(false);
    }
  };

  // Sincronizar registros pendientes offline con Supabase
  const handleSyncPending = async () => {
    if (pendingRecords.length === 0) return;
    if (!navigator.onLine) {
      showToast("error", "Aún no hay conexión a internet para sincronizar.");
      return;
    }

    setSyncing(true);
    const remaining = [];
    let syncedCount = 0;

    for (const item of pendingRecords) {
      try {
        const extra = item.atributos_extra || {};
        const localIni = extra.fotos_inicio || [];
        const localFin = extra.fotos_fin || [];

        const urlsIni = [];
        for (let i = 0; i < localIni.length; i++) {
          const src = localIni[i];
          urlsIni.push(
            src.startsWith("data:")
              ? await uploadPhotoToSupabase(src, `sync_ini${i + 1}`)
              : src
          );
        }

        const urlsFin = [];
        for (let i = 0; i < localFin.length; i++) {
          const src = localFin[i];
          urlsFin.push(
            src.startsWith("data:")
              ? await uploadPhotoToSupabase(src, `sync_fin${i + 1}`)
              : src
          );
        }

        const insertPayload = {
          elemento: item.elemento,
          geometria: item.geometria,
          este_inicio: item.este_inicio,
          norte_inicio: item.norte_inicio,
          este_fin: item.este_fin,
          norte_fin: item.norte_fin,
          progresiva_inicio: item.progresiva_inicio,
          progresiva_fin: item.progresiva_fin,
          nombre: item.nombre,
          tipo: item.tipo,
          seccion: item.seccion,
          ancho_calzada: item.ancho_calzada,
          altura: item.altura,
          longitud: item.longitud,
          num_banquinas: item.num_banquinas,
          estado: item.estado,
          detalle_otros: item.detalle_otros,
          observaciones: item.observaciones,
          foto_url: urlsIni[0] || urlsFin[0] || null,
          atributos_extra: {
            fotos_inicio: urlsIni,
            fotos_fin: urlsFin,
            modo_registro: extra.modo_registro || "Sincronizado",
          },
        };

        const { error } = await supabase.from(TABLE_NAME).insert([insertPayload]);
        if (error) throw error;
        syncedCount++;
      } catch (err) {
        console.error("Fallo al sincronizar registro:", err);
        remaining.push(item);
      }
    }

    setPendingRecords(remaining);
    await fetchCloudRecords();
    setSyncing(false);

    if (syncedCount > 0) {
      showToast(
        "success",
        `${syncedCount} registro(s) sincronizado(s) con Supabase.`
      );
    }
    if (remaining.length > 0) {
      showToast(
        "error",
        `${remaining.length} registro(s) no pudieron sincronizarse.`
      );
    }
  };

  // Eliminar registro (Nube o Cola Offline)
  const handleDeleteRecord = async (rec) => {
    if (!window.confirm("¿Eliminar este registro del inventario vial?")) return;

    if (rec._isPending) {
      setPendingRecords((prev) => prev.filter((p) => p.id !== rec.id));
      showToast("info", "Registro pendiente eliminado localmente.");
      return;
    }

    try {
      const { error } = await supabase
        .from(TABLE_NAME)
        .delete()
        .eq("id", rec.id);
      if (error) throw error;
      setCloudRecords((prev) => prev.filter((r) => r.id !== rec.id));
      showToast("info", "Registro eliminado de Supabase.");
    } catch (err) {
      showToast("error", `No se pudo eliminar: ${err.message}`);
    }
  };

  // Lista combinada (pendientes + nube) y filtrada
  const allRecords = useMemo(
    () => [...pendingRecords, ...cloudRecords],
    [pendingRecords, cloudRecords]
  );

  const filteredRecords = useMemo(() => {
    return allRecords.filter((r) => {
      if (filterElement !== "Todos" && r.elemento !== filterElement) return false;
      if (filterEstado !== "Todos" && r.estado !== filterEstado) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = [
          r.elemento,
          r.nombre,
          r.tipo,
          r.seccion,
          r.progresiva_inicio,
          r.progresiva_fin,
          r.detalle_otros,
          r.observaciones,
        ]
          .join(" ")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [allRecords, filterElement, filterEstado, searchQuery]);

  // =========================================================================
  // EXPORTACIONES PROFESIONALES: QGIS, EXCEL, PDF CON FOTOS Y CSV
  // =========================================================================
  const handleExportGeoJSON = () => {
    if (filteredRecords.length === 0) {
      showToast("error", "No hay registros para exportar.");
      return;
    }
    const content = buildGeoJSON(filteredRecords);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(
      new Blob([content], { type: "application/geo+json" }),
      `VEIDCON_QGIS_${stamp}.geojson`
    );
    showToast("success", "Archivo GeoJSON (WGS84) descargado para QGIS.");
  };

  const handleExportCSV = () => {
    if (filteredRecords.length === 0) {
      showToast("error", "No hay registros para exportar.");
      return;
    }
    const content = buildCSV(filteredRecords);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(
      new Blob([content], { type: "text/csv;charset=utf-8;" }),
      `VEIDCON_UTM20S_${stamp}.csv`
    );
    showToast("success", "Respaldo CSV descargado.");
  };

  const handleExportExcel = async () => {
    if (filteredRecords.length === 0) {
      showToast("error", "No hay registros para exportar.");
      return;
    }
    try {
      const XLSX = await ensureXLSX();
      const fechaHoy = new Date().toLocaleString("es-BO");

      const aoa = [
        ["INVENTARIO VIAL VEIDCON — REPORTE DE INFRAESTRUCTURA CARRETERA"],
        [
          `Elaborado por: MSc. Ing. Mohammed Veramendy | Sistema: WGS84 UTM Zona 20S (EPSG:32720) | Emisión: ${fechaHoy}`,
        ],
        [],
        [
          "ID",
          "Fecha Registro",
          "Elemento Vial",
          "Geometría",
          "Progresiva Inicio / Punto",
          "Progresiva Fin",
          "Este Inicio (m)",
          "Norte Inicio (m)",
          "Este Fin (m)",
          "Norte Fin (m)",
          "Nombre",
          "Tipo",
          "Sección",
          "Ancho Calzada (m)",
          "Altura (m)",
          "Longitud (m)",
          "N° Banquinas",
          "Estado",
          "Detalle / Otros",
          "Observaciones Técnicas",
          "URLs Fotos Punto / Inicio",
          "URLs Fotos Fin",
        ],
      ];

      filteredRecords.forEach((r) => {
        const { inicio, fin } = extractPhotosFromRecord(r);
        aoa.push([
          r.id,
          r.created_at ? new Date(r.created_at).toLocaleString("es-BO") : "",
          r.elemento,
          r.geometria,
          r.progresiva_inicio || "",
          r.progresiva_fin || "",
          r.este_inicio ?? "",
          r.norte_inicio ?? "",
          r.este_fin ?? "",
          r.norte_fin ?? "",
          r.nombre || "",
          r.tipo || "",
          r.seccion || "",
          r.ancho_calzada ?? "",
          r.altura ?? "",
          r.longitud ?? "",
          r.num_banquinas ?? "",
          r.estado || "",
          r.detalle_otros || "",
          r.observaciones || "",
          inicio.join(" | "),
          fin.join(" | "),
        ]);
      });

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 21 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 21 } },
      ];
      ws["!cols"] = [
        { wch: 18 },
        { wch: 18 },
        { wch: 18 },
        { wch: 11 },
        { wch: 18 },
        { wch: 15 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 22 },
        { wch: 18 },
        { wch: 16 },
        { wch: 14 },
        { wch: 11 },
        { wch: 12 },
        { wch: 12 },
        { wch: 11 },
        { wch: 24 },
        { wch: 32 },
        { wch: 40 },
        { wch: 40 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Inventario Vial VEIDCON");
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `Inventario_Vial_VEIDCON_${stamp}.xlsx`);
      showToast("success", "Libro Excel (.xlsx) generado correctamente.");
    } catch (err) {
      showToast("error", `Error al generar Excel: ${err.message}`);
    }
  };

  const handleExportPDF = async () => {
    if (filteredRecords.length === 0) {
      showToast("error", "No hay registros para exportar al PDF.");
      return;
    }

    setExportingPdf(true);
    showToast("info", "Generando reporte PDF con fotografías incrustadas...");

    try {
      const JsPDF = await ensureJsPDF();
      const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 14;
      const contentW = pageW - margin * 2;
      const fechaEmision = new Date().toLocaleString("es-BO");

      const drawHeaderBanner = () => {
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageW, 30, "F");
        doc.setFillColor(245, 158, 11);
        doc.rect(0, 30, pageW, 2, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text("INVENTARIO VIAL VEIDCON — REPORTE TÉCNICO DE CAMPO", margin, 12);

        doc.setFontSize(9.5);
        doc.setTextColor(245, 158, 11);
        doc.text("Elaborado por: MSc. Ing. Mohammed Veramendy", margin, 19);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(255, 255, 255);
        doc.text(
          `Sistema: WGS84 UTM Zona 20S (EPSG:32720)   |   Fecha de emisión: ${fechaEmision}`,
          margin,
          25.5
        );
      };

      drawHeaderBanner();

      // Resumen estadístico inicial
      const total = filteredRecords.length;
      const buenos = filteredRecords.filter((r) => r.estado === "Bueno").length;
      const regulares = filteredRecords.filter((r) => r.estado === "Regular").length;
      const malos = filteredRecords.filter((r) => r.estado === "Malo").length;

      let y = 38;
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(margin, y, contentW, 18, 2, 2, "F");
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text("RESUMEN ESTADÍSTICO DEL RELEVAMIENTO", margin + 4, y + 6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(
        `Total Elementos: ${total}    |    Estado Bueno: ${buenos}    |    Estado Regular: ${regulares}    |    Estado Malo: ${malos}`,
        margin + 4,
        y + 13
      );

      y += 24;

      for (let idx = 0; idx < filteredRecords.length; idx++) {
        const rec = filteredRecords[idx];
        const isPunto = rec.geometria === "Punto";
        const { inicio, fin } = extractPhotosFromRecord(rec);

        if (y > pageH - 85) {
          doc.addPage();
          drawHeaderBanner();
          y = 38;
        }

        // Título de Ficha Técnica
        doc.setFillColor(30, 58, 95);
        doc.rect(margin, y, contentW, 8.5, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.text(
          `FICHA #${idx + 1}: ${rec.elemento.toUpperCase()} (${rec.geometria})`,
          margin + 3,
          y + 5.7
        );

        // Etiqueta de Estado con color
        const badgeColor =
          rec.estado === "Bueno"
            ? [5, 150, 105]
            : rec.estado === "Regular"
            ? [217, 119, 6]
            : [220, 38, 38];
        doc.setFillColor(...badgeColor);
        doc.roundedRect(pageW - margin - 26, y + 1.3, 24, 5.8, 1.5, 1.5, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.text(rec.estado || "-", pageW - margin - 14, y + 5.2, {
          align: "center",
        });

        y += 9;

        // Cuadro técnico estructurado con autoTable
        const rows = [
          [
            isPunto ? "Progresiva" : "Progresiva Inicio / Fin",
            isPunto
              ? rec.progresiva_inicio || "—"
              : `${rec.progresiva_inicio || "?"}  →  ${rec.progresiva_fin || "?"}`,
            "Fecha / ID",
            `${
              rec.created_at
                ? new Date(rec.created_at).toLocaleDateString("es-BO")
                : "Local"
            } (${String(rec.id).slice(0, 8)})`,
          ],
          [
            isPunto ? "UTM Punto (E, N)" : "UTM Inicio (E, N)",
            `${rec.este_inicio ?? "—"} m ,  ${rec.norte_inicio ?? "—"} m`,
            isPunto ? "Zona Geodésica" : "UTM Fin (E, N)",
            isPunto
              ? "WGS84 UTM 20S (EPSG:32720)"
              : `${rec.este_fin ?? "—"} m ,  ${rec.norte_fin ?? "—"} m`,
          ],
        ];

        const specs = [];
        if (rec.nombre) specs.push(`Nombre: ${rec.nombre}`);
        if (rec.tipo) specs.push(`Tipo: ${rec.tipo}`);
        if (rec.seccion) specs.push(`Sección: ${rec.seccion}`);
        if (rec.ancho_calzada != null)
          specs.push(`Ancho calzada: ${rec.ancho_calzada} m`);
        if (rec.altura != null) specs.push(`Altura: ${rec.altura} m`);
        if (rec.longitud != null) specs.push(`Longitud: ${rec.longitud} m`);
        if (rec.num_banquinas != null)
          specs.push(`Banquinas: ${rec.num_banquinas}`);
        if (rec.detalle_otros) specs.push(`Detalle: ${rec.detalle_otros}`);

        rows.push([
          "Características Técnicas",
          { content: specs.join("  |  ") || "—", colSpan: 3 },
        ]);
        rows.push([
          "Observaciones",
          { content: rec.observaciones || "Sin observaciones.", colSpan: 3 },
        ]);

        doc.autoTable({
          startY: y,
          margin: { left: margin, right: margin },
          body: rows,
          theme: "grid",
          styles: {
            fontSize: 8,
            cellPadding: 2.2,
            textColor: [15, 23, 42],
            lineColor: [203, 213, 225],
            lineWidth: 0.2,
          },
          columnStyles: {
            0: { fontStyle: "bold", fillColor: [241, 245, 249], cellWidth: 36 },
            1: { cellWidth: 55 },
            2: { fontStyle: "bold", fillColor: [241, 245, 249], cellWidth: 32 },
            3: { cellWidth: "auto" },
          },
        });

        y = doc.lastAutoTable.finalY + 4;

        // Renderizar galería de fotos incrustadas
        const renderPhotoStrip = async (urls, labelPrefix) => {
          if (!urls || urls.length === 0) return;
          if (y > pageH - 52) {
            doc.addPage();
            drawHeaderBanner();
            y = 38;
          }

          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.2);
          doc.setTextColor(30, 58, 95);
          doc.text(`${labelPrefix}:`, margin, y + 3);
          y += 5;

          const boxW = (contentW - 8) / 3;
          const boxH = 38;

          for (let i = 0; i < Math.min(urls.length, 3); i++) {
            const xPos = margin + i * (boxW + 4);
            doc.setDrawColor(203, 213, 225);
            doc.rect(xPos, y, boxW, boxH);

            const imgData = await normalizeImageForPdf(urls[i]);
            if (imgData && imgData.dataUrl) {
              const pad = 1.5;
              const maxImgW = boxW - pad * 2;
              const maxImgH = boxH - 7;
              let drawW = maxImgW;
              let drawH = drawW * imgData.ratio;
              if (drawH > maxImgH) {
                drawH = maxImgH;
                drawW = drawH / (imgData.ratio || 1);
              }
              const offsetX = xPos + (boxW - drawW) / 2;
              doc.addImage(
                imgData.dataUrl,
                "JPEG",
                offsetX,
                y + 1.5,
                drawW,
                drawH
              );
            } else {
              doc.setFontSize(7);
              doc.setTextColor(100, 116, 139);
              doc.text("Imagen no disponible", xPos + boxW / 2, y + 18, {
                align: "center",
              });
            }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(7);
            doc.setTextColor(15, 23, 42);
            doc.text(`${labelPrefix} ${i + 1}`, xPos + boxW / 2, y + boxH - 2, {
              align: "center",
            });
          }

          y += boxH + 5;
        };

        if (isPunto) {
          await renderPhotoStrip(inicio, "Fotografía Punto");
        } else {
          await renderPhotoStrip(inicio, "Fotografía Inicio");
          await renderPhotoStrip(fin, "Fotografía Fin");
        }

        y += 4;
      }

      // Pie de página en todas las hojas
      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(
          `Inventario Vial VEIDCON — MSc. Ing. Mohammed Veramendy   |   Página ${p} de ${totalPages}`,
          pageW / 2,
          pageH - 6,
          { align: "center" }
        );
      }

      const stamp = new Date().toISOString().slice(0, 10);
      doc.save(`Reporte_Tecnico_VEIDCON_${stamp}.pdf`);
      showToast("success", "Reporte PDF con fotografías descargado.");
    } catch (err) {
      console.error(err);
      showToast("error", `Error al generar PDF: ${err.message}`);
    } finally {
      setExportingPdf(false);
    }
  };

  // =========================================================================
  // RENDERIZADO DE GALERÍA MULTIFOTO (3 SLOTS POR UBICACIÓN)
  // =========================================================================
  const renderPhotoGallery = (galleryKey, titlePrefix) => {
    const slots = formData[galleryKey];
    const count = slots.filter(Boolean).length;

    return (
      <div>
        <div className="photo-gallery-title">
          <span>
            📷 {titlePrefix} (Máx. 3 fotografías)
          </span>
          <span className="field-hint">{count}/3 adjuntas</span>
        </div>
        <div className="photo-slots-grid">
          {slots.map((slot, idx) => (
            <div key={idx} className="photo-slot">
              {slot ? (
                <>
                  <img
                    src={slot.dataUrl}
                    alt={`${titlePrefix} ${idx + 1}`}
                    className="photo-slot-img"
                    onClick={() =>
                      setPhotoModal({
                        src: slot.dataUrl,
                        title: `${titlePrefix} ${idx + 1}`,
                      })
                    }
                  />
                  <div className="photo-slot-actions">
                    <span className="photo-slot-tag">Foto {idx + 1}</span>
                    <button
                      type="button"
                      className="photo-remove-btn"
                      onClick={() => handleRemovePhotoSlot(galleryKey, idx)}
                    >
                      ✕ Quitar
                    </button>
                  </div>
                </>
              ) : (
                <label className="photo-slot-label">
                  <span style={{ fontSize: "1.25rem" }}>
                    {workMode === "mobile" ? "📸" : "🖼️"}
                  </span>
                  <span>
                    {workMode === "mobile"
                      ? `Tomar Foto ${idx + 1}`
                      : `Subir Foto ${idx + 1}`}
                  </span>
                  {workMode === "mobile" ? (
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handlePhotoSlotChange(galleryKey, idx, e)}
                      style={{ display: "none" }}
                    />
                  ) : (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handlePhotoSlotChange(galleryKey, idx, e)}
                      style={{ display: "none" }}
                    />
                  )}
                </label>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const configActual = ELEMENTO_CONFIG[formData.elemento];
  const isPunto = formData.geometria === "Punto";

  return (
    <div className="app-shell">
      <style>{APP_STYLES}</style>

      {/* ================================================================= */}
      {/* 1. ENCABEZADO CORPORATIVO VEIDCON — CONTRASTE BLANCO PURO #FFFFFF */}
      {/* ================================================================= */}
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-box">
            <div className="brand-badge" aria-hidden="true">
              🛣️
            </div>
            <div>
              <h1 className="brand-title">Inventario Vial VEIDCON</h1>
              <p className="brand-sub">
                Sistema de Relevamiento Georreferenciado de Infraestructura Carretera •
                WGS84 UTM Zona 20S (EPSG:32720)
              </p>
              <div className="brand-credit-row">
                <span className="credit-pill">
                  Desarrollado por: MSc. Ing. Mohammed Veramendy
                </span>
                <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
                  {isOnline ? "🟢 En línea (Supabase)" : "🔴 Modo Offline"}
                </span>
              </div>
            </div>
          </div>

          {/* INTERRUPTOR MODO DE TRABAJO */}
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
      </header>

      <main className="main-container">
        {/* BANNER DE SINCRONIZACIÓN PENDIENTE CON SUPABASE */}
        {pendingRecords.length > 0 && (
          <div className="sync-banner">
            <div>
              <strong>
                ⚠️ Tienes {pendingRecords.length} registro(s) guardado(s)
                localmente sin subir a la nube.
              </strong>
              <div style={{ fontSize: "0.82rem", marginTop: 2 }}>
                Cuando dispongas de señal móvil o Wi-Fi, presiona sincronizar para
                enviar fotos y datos a Supabase.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={syncing || !isOnline}
              onClick={handleSyncPending}
            >
              {syncing
                ? "⏳ Sincronizando..."
                : `🔄 Sincronizar pendientes con la nube (${pendingRecords.length})`}
            </button>
          </div>
        )}

        {/* ================================================================= */}
        {/* 2. FORMULARIO DINÁMICO DE LOS 7 ELEMENTOS VIALES                  */}
        {/* ================================================================= */}
        <section className="card">
          <div className="card-header">
            <h2>📋 Nuevo Registro Vial</h2>
            <span className="header-mode-tag">
              {workMode === "mobile"
                ? "📱 GPS UTM en vivo + Cámara trasera"
                : "💻 Digitación manual UTM (Garmin) + Archivo PC"}
            </span>
          </div>

          <form className="card-body" onSubmit={handleSubmit}>
            {/* SELECTOR ELEMENTO VIAL Y GEOMETRÍA */}
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
                    style={{ background: "#e2e8f0", fontWeight: 800 }}
                  />
                )}
              </div>
            </div>

            <div className="form-grid">
              {/* ----------------------------------------------------------- */}
              {/* BLOQUES DE COORDENADAS UTM + MULTIFOTO POR UBICACIÓN        */}
              {/* ----------------------------------------------------------- */}
              <div className="locations-container">
                {gpsStatus && (
                  <div className={`gps-banner ${gpsStatus.ok ? "ok" : "err"}`}>
                    {gpsStatus.ok ? "✅ " : "⚠️ "}
                    {gpsStatus.text}
                  </div>
                )}

                {isPunto ? (
                  <div className="location-block">
                    <div className="location-block-header">
                      <span className="location-block-title">
                        📍 Ubicación del Punto (WGS84 UTM Zona 20S)
                      </span>
                      {workMode === "mobile" && (
                        <button
                          type="button"
                          className="btn btn-gps btn-sm"
                          disabled={gpsLoadingTarget === "inicio"}
                          onClick={() => handleCaptureGPS("inicio")}
                        >
                          {gpsLoadingTarget === "inicio"
                            ? "⏳ Capturando GPS..."
                            : "📍 Capturar GPS UTM Punto"}
                        </button>
                      )}
                    </div>
                    <div className="location-block-body">
                      <div className="utm-pair">
                        <div className="field-group">
                          <label className="field-label">Este (m) *</label>
                          <input
                            type="number"
                            step="0.01"
                            className="input"
                            placeholder="Ej: 480712.45"
                            value={formData.esteInicio}
                            onChange={(e) =>
                              handleFieldChange("esteInicio", e.target.value)
                            }
                            required
                          />
                        </div>
                        <div className="field-group">
                          <label className="field-label">Norte (m) *</label>
                          <input
                            type="number"
                            step="0.01"
                            className="input"
                            placeholder="Ej: 8033745.10"
                            value={formData.norteInicio}
                            onChange={(e) =>
                              handleFieldChange("norteInicio", e.target.value)
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="field-group">
                        <label className="field-label">
                          {formData.elemento === "Otros (A detallar)"
                            ? "Progresivas"
                            : "Progresiva"}
                        </label>
                        <input
                          type="text"
                          className="input"
                          placeholder="Ej: 04+250"
                          value={formData.progresivaInicio}
                          onChange={(e) =>
                            handleFieldChange("progresivaInicio", e.target.value)
                          }
                        />
                      </div>

                      {renderPhotoGallery("fotosInicio", "Foto")}
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={handleCalcLongitudUTM}
                      >
                        📏 Calcular Longitud (m) desde UTM Inicio → Fin
                      </button>
                    </div>

                    <div className="locations-dual-grid">
                      {/* BLOQUE 1: PUNTO INICIAL */}
                      <div className="location-block">
                        <div className="location-block-header">
                          <span className="location-block-title">
                            🟢 PUNTO INICIAL (Inicio del Elemento)
                          </span>
                          {workMode === "mobile" && (
                            <button
                              type="button"
                              className="btn btn-gps btn-sm"
                              disabled={gpsLoadingTarget === "inicio"}
                              onClick={() => handleCaptureGPS("inicio")}
                            >
                              {gpsLoadingTarget === "inicio"
                                ? "⏳ GPS..."
                                : "📍 Capturar GPS UTM Inicio"}
                            </button>
                          )}
                        </div>
                        <div className="location-block-body">
                          <div className="utm-pair">
                            <div className="field-group">
                              <label className="field-label">
                                Coordenada Este Inicio (m) *
                              </label>
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
                              <label className="field-label">
                                Coordenada Norte Inicio (m) *
                              </label>
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

                          {renderPhotoGallery("fotosInicio", "Foto Inicio")}
                        </div>
                      </div>

                      {/* BLOQUE 2: PUNTO FINAL */}
                      <div className="location-block">
                        <div className="location-block-header">
                          <span className="location-block-title">
                            🏁 PUNTO FINAL (Fin del Elemento)
                          </span>
                          {workMode === "mobile" && (
                            <button
                              type="button"
                              className="btn btn-gps btn-sm"
                              disabled={gpsLoadingTarget === "fin"}
                              onClick={() => handleCaptureGPS("fin")}
                            >
                              {gpsLoadingTarget === "fin"
                                ? "⏳ GPS..."
                                : "📍 Capturar GPS UTM Fin"}
                            </button>
                          )}
                        </div>
                        <div className="location-block-body">
                          <div className="utm-pair">
                            <div className="field-group">
                              <label className="field-label">
                                Coordenada Este Fin (m) *
                              </label>
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
                              <label className="field-label">
                                Coordenada Norte Fin (m) *
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                className="input"
                                placeholder="Ej: 8033745.00"
                                value={formData.norteFin}
                                onChange={(e) =>
                                  handleFieldChange("norteFin", e.target.value)
                                }
                                required
                              />
                            </div>
                          </div>

                          <div className="field-group">
                            <label className="field-label">Progresiva Fin</label>
                            <input
                              type="text"
                              className="input"
                              placeholder="Ej: 04+280"
                              value={formData.progresivaFin}
                              onChange={(e) =>
                                handleFieldChange("progresivaFin", e.target.value)
                              }
                            />
                          </div>

                          {renderPhotoGallery("fotosFin", "Foto Fin")}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* ----------------------------------------------------------- */}
              {/* CAMPOS TÉCNICOS DINÁMICOS                                   */}
              {/* ----------------------------------------------------------- */}
              {formData.elemento === "Puente" && (
                <div className="field-group">
                  <label className="field-label">Nombre del Puente</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Ej: Puente Río Piraí"
                    value={formData.nombre}
                    onChange={(e) => handleFieldChange("nombre", e.target.value)}
                  />
                </div>
              )}

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
                      ? [
                          "Ø 0.80 m",
                          "Ø 1.00 m",
                          "Ø 1.20 m",
                          "1.50 x 1.50 m",
                          "2.00 x 2.00 m",
                        ]
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
                    onChange={(e) =>
                      handleFieldChange("anchoCalzada", e.target.value)
                    }
                  />
                </div>
              )}

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
                    onChange={(e) =>
                      handleFieldChange("numBanquinas", e.target.value)
                    }
                  />
                </div>
              )}

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
                    placeholder="Ej: 15.00"
                    value={formData.longitud}
                    onChange={(e) => handleFieldChange("longitud", e.target.value)}
                  />
                </div>
              )}

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

              {formData.elemento === "Otros (A detallar)" && (
                <div className="field-group span-full">
                  <label className="field-label">Detalle / Otros atributos *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Ej: Defensa metálica flex-beam, badén de hormigón, etc."
                    value={formData.detalleOtros}
                    onChange={(e) =>
                      handleFieldChange("detalleOtros", e.target.value)
                    }
                    required
                  />
                </div>
              )}

              <div className="field-group span-full">
                <label className="field-label">Observaciones técnicas</label>
                <textarea
                  className="textarea"
                  placeholder="Describa patologías, socavación, obstrucciones, señalización faltante o requerimientos de intervención..."
                  value={formData.observaciones}
                  onChange={(e) =>
                    handleFieldChange("observaciones", e.target.value)
                  }
                />
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setFormData(createEmptyForm(formData.elemento));
                  setGpsStatus(null);
                }}
              >
                Limpiar Formulario
              </button>
              <button type="submit" className="btn btn-amber" disabled={saving}>
                {saving
                  ? "⏳ Subiendo fotos y guardando..."
                  : "💾 Guardar Elemento en la Nube"}
              </button>
            </div>
          </form>
        </section>

        {/* ================================================================= */}
        {/* 3. TABLA EN VIVO + BARRA DE EXPORTACIÓN PROFESIONAL               */}
        {/* ================================================================= */}
        <section className="card">
          <div className="card-header">
            <h2>
              📊 Registros Cargados en Tiempo Real ({filteredRecords.length})
            </h2>
            <button
              type="button"
              className="btn btn-amber btn-sm"
              onClick={fetchCloudRecords}
              disabled={loadingRecords}
            >
              {loadingRecords ? "⏳ Actualizando..." : "🔄 Recargar Supabase"}
            </button>
          </div>

          {/* BARRA DE EXPORTACIÓN PROFESIONAL (4 BOTONES) */}
          <div className="export-bar">
            <button
              type="button"
              className="btn btn-exp-qgis"
              onClick={handleExportGeoJSON}
            >
              🗺️ Exportar QGIS (.geojson)
            </button>
            <button
              type="button"
              className="btn btn-exp-excel"
              onClick={handleExportExcel}
            >
              📊 Exportar Excel (.xlsx)
            </button>
            <button
              type="button"
              className="btn btn-exp-pdf"
              disabled={exportingPdf}
              onClick={handleExportPDF}
            >
              {exportingPdf
                ? "⏳ Generando PDF..."
                : "📄 Exportar Reporte PDF (con Fotos)"}
            </button>
            <button
              type="button"
              className="btn btn-exp-csv"
              onClick={handleExportCSV}
            >
              🧾 Exportar CSV (.csv)
            </button>
          </div>

          {/* FILTROS */}
          <div className="records-toolbar">
            <div className="filters-row">
              <select
                className="select"
                value={filterElement}
                onChange={(e) => setFilterElement(e.target.value)}
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

            <span className="field-hint">
              Mostrando {filteredRecords.length} de {allRecords.length} registros
            </span>
          </div>

          {/* TABLA DETALLADA */}
          {filteredRecords.length === 0 ? (
            <div className="empty-state">
              <p style={{ fontWeight: 800, fontSize: "1rem", margin: "0 0 6px" }}>
                No hay registros viales cargados con este filtro
              </p>
              <p style={{ margin: 0, fontSize: "0.86rem" }}>
                Complete el formulario superior para registrar elementos en
                Supabase o ajuste los filtros de búsqueda.
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fecha / Estado Sync</th>
                    <th>Elemento</th>
                    <th>Progresivas</th>
                    <th>UTM Inicio / Punto (Z20S)</th>
                    <th>UTM Fin (Z20S)</th>
                    <th>Características Técnicas</th>
                    <th>Estado</th>
                    <th>Fotos Inicio / Punto</th>
                    <th>Fotos Fin</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((r) => {
                    const { inicio, fin } = extractPhotosFromRecord(r);
                    const isRecPunto = r.geometria === "Punto";
                    const specs = [];
                    if (r.nombre) specs.push(`Nombre: ${r.nombre}`);
                    if (r.tipo) specs.push(`Tipo: ${r.tipo}`);
                    if (r.seccion) specs.push(`Sección: ${r.seccion}`);
                    if (r.ancho_calzada != null)
                      specs.push(`Ancho: ${r.ancho_calzada} m`);
                    if (r.altura != null) specs.push(`Altura: ${r.altura} m`);
                    if (r.longitud != null) specs.push(`Long: ${r.longitud} m`);
                    if (r.num_banquinas != null)
                      specs.push(`Banquinas: ${r.num_banquinas}`);
                    if (r.detalle_otros) specs.push(`Detalle: ${r.detalle_otros}`);

                    return (
                      <tr key={r.id}>
                        <td>
                          <div style={{ fontWeight: 700 }}>
                            {r.created_at
                              ? new Date(r.created_at).toLocaleDateString("es-BO")
                              : "—"}
                          </div>
                          <div className="field-hint">
                            {r.created_at
                              ? new Date(r.created_at).toLocaleTimeString("es-BO", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : ""}
                          </div>
                          {r._isPending ? (
                            <span className="badge badge-pending">
                              ⏳ Pendiente Sync
                            </span>
                          ) : (
                            <span className="field-hint">☁️ En Supabase</span>
                          )}
                        </td>

                        <td>
                          <span className="badge badge-elem">{r.elemento}</span>
                          <div style={{ marginTop: 4 }}>
                            <span className="badge badge-geom">{r.geometria}</span>
                          </div>
                        </td>

                        <td>
                          {isRecPunto ? (
                            <strong>{r.progresiva_inicio || "—"}</strong>
                          ) : (
                            <div>
                              <div>
                                <strong>Ini:</strong> {r.progresiva_inicio || "—"}
                              </div>
                              <div>
                                <strong>Fin:</strong> {r.progresiva_fin || "—"}
                              </div>
                            </div>
                          )}
                        </td>

                        <td>
                          <div className="utm-mono">
                            E: {r.este_inicio ?? "—"}
                            <br />
                            N: {r.norte_inicio ?? "—"}
                          </div>
                        </td>

                        <td>
                          {isRecPunto ? (
                            <span className="field-hint">N/A (Punto)</span>
                          ) : (
                            <div className="utm-mono">
                              E: {r.este_fin ?? "—"}
                              <br />
                              N: {r.norte_fin ?? "—"}
                            </div>
                          )}
                        </td>

                        <td style={{ maxWidth: 260 }}>
                          <div>{specs.join(" • ") || "—"}</div>
                          {r.observaciones && (
                            <div
                              className="field-hint"
                              style={{ marginTop: 4, fontStyle: "italic" }}
                            >
                              Obs: {r.observaciones}
                            </div>
                          )}
                        </td>

                        <td>
                          <span
                            className={`badge badge-${(
                              r.estado || "bueno"
                            ).toLowerCase()}`}
                          >
                            {r.estado}
                          </span>
                        </td>

                        <td>
                          {inicio.length > 0 ? (
                            <div className="table-thumbs-row">
                              {inicio.map((url, idx) => (
                                <img
                                  key={idx}
                                  src={url}
                                  alt={`Inicio ${idx + 1}`}
                                  className="thumb-mini"
                                  title="Clic para ampliar"
                                  onClick={() =>
                                    setPhotoModal({
                                      src: url,
                                      title: `${r.elemento} — ${
                                        isRecPunto ? "Foto Punto" : "Foto Inicio"
                                      } ${idx + 1}`,
                                    })
                                  }
                                />
                              ))}
                            </div>
                          ) : (
                            <span className="field-hint">Sin fotos</span>
                          )}
                        </td>

                        <td>
                          {isRecPunto ? (
                            <span className="field-hint">—</span>
                          ) : fin.length > 0 ? (
                            <div className="table-thumbs-row">
                              {fin.map((url, idx) => (
                                <img
                                  key={idx}
                                  src={url}
                                  alt={`Fin ${idx + 1}`}
                                  className="thumb-mini"
                                  title="Clic para ampliar"
                                  onClick={() =>
                                    setPhotoModal({
                                      src: url,
                                      title: `${r.elemento} — Foto Fin ${idx + 1}`,
                                    })
                                  }
                                />
                              ))}
                            </div>
                          ) : (
                            <span className="field-hint">Sin fotos</span>
                          )}
                        </td>

                        <td>
                          <button
                            type="button"
                            className="btn btn-danger-sm"
                            onClick={() => handleDeleteRecord(r)}
                          >
                            🗑️ Eliminar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* PIE DE PÁGINA CORPORATIVO */}
      <footer className="app-footer">
        <strong>Inventario Vial VEIDCON</strong> • Desarrollado por:{" "}
        <strong>MSc. Ing. Mohammed Veramendy</strong> • Sistema Georreferenciado
        WGS84 UTM Zona 20S (EPSG:32720) © {new Date().getFullYear()}
      </footer>

      {/* MODAL DE VISTA AMPLIADA DE FOTOGRAFÍA */}
      {photoModal && (
        <div className="modal-backdrop" onClick={() => setPhotoModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
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
            <div style={{ padding: 16, textAlign: "center" }}>
              <img
                src={photoModal.src}
                alt={photoModal.title}
                style={{
                  maxWidth: "100%",
                  maxHeight: "74vh",
                  borderRadius: 8,
                  objectFit: "contain",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}