// === 글로벌 변수 ===
let northUp = true;    // 북쪽 고정 기본값
let lastFix = null;    // 최근 위치 캐시
let userInteracting = false;
let _idleT;
let followGps = true;   // 지도 중심을 GPS에 맞춰 자동 이동할지 여부

// === 지도 생성 ===
const MAP_STYLE = "https://api.maptiler.com/maps/streets-v2/style.json?key=2HioygjPVFKopzhBEhM3";

const map = new maplibregl.Map({
    container: "map",
    style: MAP_STYLE,
    center: [126.506498, 37.479726],
    zoom: 16,
    bearing: -20,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

// === 위치버튼 + 북쪽고정버튼 ===
const ctl = document.createElement("div");
ctl.style.cssText = `
  position: fixed;
  right: calc(env(safe-area-inset-right, 0px) + 12px);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 80px);
  z-index: 9999;
  display: flex;
  gap: 8px;
  pointer-events: auto;
`;
const mkBtn = (t) => {
    const b = document.createElement("button");
    b.textContent = t;
    b.style.cssText = `
      padding: 8px 10px;
      border: 1px solid #2dd4bf;
      border-radius: 999px;
      background: rgba(0,0,0,.7);
      color: #0ff;
      font: 600 13px ui-monospace;
      box-shadow: 0 4px 12px rgba(0,0,0,.6);
      backdrop-filter: blur(8px);
    `;
    return b;
};
const btnLocate = mkBtn("📍 현위치");
const btnNorth = mkBtn("N↑ 북쪽고정");
ctl.append(btnLocate, btnNorth);
document.body.appendChild(ctl);

// === 제스처 및 사용자 상태 감지 ===
map.dragRotate.enable();
map.touchZoomRotate.enable();
map.touchZoomRotate.enableRotation();
map.scrollZoom.enable();
map.keyboard.enable();
map.on("movestart", () => { userInteracting = true; clearTimeout(_idleT); });
map.on("moveend", () => { clearTimeout(_idleT); _idleT = setTimeout(() => userInteracting = false, 1500); });
map.on("rotateend", () => { if (!northUp && map.getBearing() !== 0) map.easeTo({ bearing: 0, duration: 300 }); });

// === GeolocateControl ===
const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showAccuracyCircle: true,
    showUserHeading: true,
});
map.addControl(geolocate, "top-right");
map.on("load", () => { map.resize(); });
window.addEventListener("orientationchange", () => map.resize());
window.addEventListener("resize", () => map.resize());

// === GPS 팔로우 ===
const spdEl = document.getElementById("spd");
const brgEl = document.getElementById("brg");

const markerEl = document.createElement("div");
markerEl.style.cssText =
    "width:16px;height:16px;border-radius:50%;background:#0ff;box-shadow:0 0 8px #0ff;";
const marker = new maplibregl.Marker({ element: markerEl }).setLngLat(map.getCenter()).addTo(map);

function toKmH(ms) { return Math.round((ms || 0) * 3.6); }
function clampBearing(deg) { return ((deg % 360) + 360) % 360; }

const geoOpts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 };
const onPos = (pos) => {
    const { longitude, latitude, speed, heading } = pos.coords;
    const center = [longitude, latitude];
    lastFix = center;

    if (!followGps) return;

    marker.setLngLat(center);
    if (spdEl) spdEl.textContent = `${toKmH(speed)} km/h`;
    if (brgEl) brgEl.textContent = `${Math.round(clampBearing(heading ?? 0))}°`;

    const easeOpts = {
        center,
        bearing: northUp ? (heading ?? map.getBearing()) : 0,
        duration: 600,
    };
    if (!userInteracting) easeOpts.pitch = 60;
    map.easeTo(easeOpts);
};
const onErr = (e) => {
    console.warn("geo error", e.code, e.message);
    if (spdEl) spdEl.textContent = "위치권한 거부/실패";
    navigator.geolocation.getCurrentPosition(onPos, console.warn, { ...geoOpts, timeout: 45000 });
};
navigator.geolocation.watchPosition(onPos, onErr, geoOpts);

// === Tmap 경로용 소스/레이어 ID ===
const ROUTE_SOURCE_ID = "tmap-route-source";
const ROUTE_LAYER_ID = "tmap-route-layer";

// Tmap 응답 -> MapLibre 라인으로 그리기
function drawTmapRoute(tmapData) {
    console.log("Tmap route raw data:", tmapData);

    if (!tmapData || !Array.isArray(tmapData.features)) {
        console.warn("Tmap data has no features");
        return;
    }

    const lineCoords = [];

    for (const f of tmapData.features) {
        const geom = f.geometry;
        if (geom && geom.type === "LineString" && Array.isArray(geom.coordinates)) {
            for (const c of geom.coordinates) {
                // WGS84GEO 기준 [lng, lat]
                lineCoords.push([c[0], c[1]]);
            }
        }
    }

    console.log("Tmap route point count:", lineCoords.length);

    if (lineCoords.length === 0) {
        console.warn("No LineString found in Tmap route");
        return;
    }

    const geojson = {
        type: "Feature",
        geometry: { type: "LineString", coordinates: lineCoords },
        properties: {},
    };

    if (map.getSource(ROUTE_SOURCE_ID)) {
        map.getSource(ROUTE_SOURCE_ID).setData(geojson);
    } else {
        map.addSource(ROUTE_SOURCE_ID, {
            type: "geojson",
            data: geojson,
        });

        map.addLayer({
            id: ROUTE_LAYER_ID,
            type: "line",
            source: ROUTE_SOURCE_ID,
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-width": 6,
                "line-opacity": 0.9,
                "line-color": "#00f0ff",
            },
        });
    }

    const bounds = new maplibregl.LngLatBounds();
    lineCoords.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 80, duration: 800 });
}

// Tmap 경로 API 호출
async function requestTmapRoute(startLng, startLat, endLng, endLat) {
    try {
        const params = new URLSearchParams({
            sx: String(startLng),
            sy: String(startLat),
            ex: String(endLng),
            ey: String(endLat),
        });

        console.log("call /tmap-route with:", params.toString());

        const res = await fetch("/.netlify/functions/tmap-route?" + params.toString());
        console.log("tmap-route status:", res.status);

        if (!res.ok) {
            alert("Tmap 경로 탐색 실패(" + res.status + ")");
            return;
        }

        const data = await res.json();
        drawTmapRoute(data);

        if (data.features && data.features.length > 0) {
            const prop = data.features[0].properties || {};
            console.log("Tmap totalDistance(m):", prop.totalDistance, "totalTime(sec):", prop.totalTime);
        }
    } catch (e) {
        console.error("tmap-route fetch error:", e);
        alert("Tmap 경로 탐색 중 오류 발생");
    }
}

function applyGesturePolicy() {
    map.dragPan.enable();
    map.scrollZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
    if (northUp) {
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
    } else {
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();
    }
}
applyGesturePolicy();

btnNorth.onclick = () => {
    northUp = !northUp;
    btnNorth.textContent = northUp ? "N↑ 북쪽고정" : "🚗 진행방향";
    applyGesturePolicy();
};

const qInput = document.getElementById("q");

// === 카카오 API로 검색 (Netlify Function 사용) ===
async function doSearch() {
    const q = qInput.value.trim();
    if (!q) return;

    try {
        const res = await fetch(
            "/.netlify/functions/geocode?q=" + encodeURIComponent(q)
        );

        if (!res.ok) {
            console.error("geocode function error status:", res.status);
            alert("검색 실패(" + res.status + ")");
            return;
        }

        const data = await res.json();
        console.log("geocode result:", data);

        // 카카오 검색 구조: data.documents
        if (data.documents && data.documents.length > 0) {
            const place = data.documents[0];
            const lng = Number(place.x);
            const lat = Number(place.y);

            followGps = false;
            userInteracting = true;

            // 목적지로 지도 이동
            map.easeTo({
                center: [lng, lat],
                zoom: 16,
                duration: 800,
            });

            console.log("lastFix (current GPS):", lastFix);

            // 현위치가 잡혀 있으면 Tmap 경로 요청
            if (lastFix) {
                requestTmapRoute(lastFix[0], lastFix[1], lng, lat);
            } else {
                console.log("아직 GPS fix 없음 → Tmap 경로 API 호출 안 함");
            }
        } else {
            alert("검색 결과 없음");
        }
    } catch (e) {
        console.error("geocode fetch error:", e);
        alert("검색 중 오류 발생");
    }
}

// 엔터 키로 검색
qInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        doSearch();
    }
});

// 폼 제출 방지
if (qInput.form) {
    qInput.form.addEventListener("submit", (e) => {
        e.preventDefault();
        doSearch();
    });
}

// 버튼으로 유저 위치 찾기
btnLocate.onclick = () => {
    followGps = true;
    userInteracting = false;

    if (lastFix) {
        map.easeTo({
            center: lastFix,
            duration: 600,
            zoom: Math.max(16, map.getZoom()),
        });
    } else {
        navigator.geolocation.getCurrentPosition(
            (p) => {
                const c = [p.coords.longitude, p.coords.latitude];
                lastFix = c;

                map.easeTo({
                    center: c,
                    duration: 600,
                    zoom: Math.max(16, map.getZoom()),
                });
            },
            console.warn,
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
    }
};
