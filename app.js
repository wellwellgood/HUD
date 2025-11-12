// 스타일 선택
const MAP_STYLE = "https://api.maptiler.com/maps/streets-v2/style.json?key=2HioygjPVFKopzhBEhM3";  // buildings 포함

const map = new maplibregl.Map({
    container: "map",
    style: MAP_STYLE,
    center: [126.506498, 37.479726],
    zoom: 16,
    // pitch: 60,
    bearing: -20, // 회전
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

// === 제스처 확실히 활성화 ===
map.dragRotate.enable();              // 드래그 회전
map.touchZoomRotate.enable();         // 핀치 줌
map.touchZoomRotate.enableRotation(); // 두 손가락 회전
map.scrollZoom.enable();              // 휠 줌
map.keyboard.enable();                // 키보드
map.boxZoom.enable();
map.doubleClickZoom.enable();

// === 사용자가 만지는 동안 자동 팔로우가 줌/피치 덮어쓰지 않게 ===
let userInteracting = false;
let _idleT;
map.on("movestart", () => { userInteracting = true; clearTimeout(_idleT); });
map.on("moveend", () => { clearTimeout(_idleT); _idleT = setTimeout(() => userInteracting = false, 1500); });
map.on("rotateend", () => {
    if (northUp && map.getBearing() !== 0) map.easeTo({ bearing: 0, duration: 300 });
});

// 3D 빌딩 주입
map.on("styledata", () => {
    if (map.getLayer("3d-buildings")) return;
    const style = map.getStyle();
    const layers = style?.layers || [];
    const labelLayerId = layers.find(l => l.type === "symbol" && l.layout?.["text-field"])?.id;
    const base = layers.find(l => typeof l["source-layer"] === "string" && l["source-layer"].includes("building"));
    if (!base) { console.warn("No building layer found in style"); return; }
    const src = base.source;
    const srcLayer = base["source-layer"];

    map.addLayer({
        id: "3d-buildings",
        source: src,
        "source-layer": srcLayer,
        type: "fill-extrusion",
        minzoom: 17.5,
        paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#b8c1d1"],
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["to-number", ["get", "height"], 15]],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["to-number", ["get", "min_height"], 0]],
            "fill-extrusion-opacity": 0.9
        }
    }, labelLayerId);
});

// 데모 경로
const route = {
    type: "FeatureCollection",
    features: [{
        type: "Feature",
        geometry: {
            type: "LineString",
            coordinates: [
                [126.9779692, 37.566535], // 시청
                [126.983, 37.565],
                [126.990, 37.5655]
            ]
        }
    }]
};
map.on("load", () => {
    map.addSource("route", { type: "geojson", data: route });
    map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#00ffff", "line-width": 5, "line-opacity": 0.9 }
    });
});

// HUD + GPS 팔로우
const spdEl = document.getElementById("spd");
const brgEl = document.getElementById("brg");

const markerEl = document.createElement("div");
markerEl.style.cssText = "width:16px;height:16px;border-radius:50%;background:#0ff;box-shadow:0 0 8px #0ff;";
const marker = new maplibregl.Marker({ element: markerEl }).setLngLat(map.getCenter()).addTo(map);

function toKmH(ms) { return Math.round((ms || 0) * 3.6); }
function clampBearing(deg) { return ((deg % 360) + 360) % 360; }

const geoOpts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 };
const onPos = (pos) => {
    const { longitude, latitude, speed, heading } = pos.coords;
    const center = [longitude, latitude];
    lastFix = center;                                 // [NEW] 최근 좌표 저장

    marker.setLngLat(center);
    if (spdEl) spdEl.textContent = `${toKmH(speed)} km/h`;
    if (brgEl) brgEl.textContent = `${Math.round(clampBearing(heading ?? 0))}°`;

    const easeOpts = {
        center,
        bearing: northUp ? 0 : (heading ?? map.getBearing()),   // [CHANGED]
        duration: 600
    };
    if (!userInteracting) {
        easeOpts.pitch = 60;
        // zoom 강제값은 그대로 제거 상태 유지(핀치 충돌 방지). :contentReference[oaicite:1]{index=1}
    }
    map.easeTo(easeOpts);
};

if (northUp) {
    map.dragRotate.disable();
    map.touchZoomRotate.enable();       // 핀치줌 OK
    map.touchZoomRotate.disableRotation();
}

const onErr = (e) => {
    console.warn("geo error", e);
    navigator.geolocation.getCurrentPosition(onPos, console.warn, { ...geoOpts, timeout: 45000 });
};
navigator.geolocation.watchPosition(onPos, onErr, geoOpts);

// Pitch 컨트롤 유틸
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function setPitch(p) {
    const val = clamp(p, 0, 85);
    map.setPitch(val);
    const pr = document.getElementById("pitchRange");
    const pv = document.getElementById("pitchVal");
    if (pr) pr.value = String(Math.round(val));
    if (pv) pv.textContent = `${Math.round(val)}°`;
}

// 버튼/슬라이더 바인딩
const pitchRange = document.getElementById("pitchRange");
const pitchInc = document.getElementById("pitchInc");
const pitchDec = document.getElementById("pitchDec");
if (pitchRange) pitchRange.addEventListener("input", e => setPitch(+e.target.value));
if (pitchInc) pitchInc.addEventListener("click", () => setPitch(map.getPitch() + 5));
if (pitchDec) pitchDec.addEventListener("click", () => setPitch(map.getPitch() - 5));

// 초기 동기화
setPitch(map.getPitch());

// === [FIX] 모바일 충돌 제거: 커스텀 2-터치 pitch 제스처 비활성화 ===
// 기존에는 touchstart/move에서 2-손가락으로 pitch를 직접 수정했음(모바일 핀치 줌과 충돌) :contentReference[oaicite:2]{index=2}
// 해당 핸들러들을 제거하여 MapLibre의 기본 핀치 줌/회전이 단독으로 동작하도록 함.

// 키보드 단축키
window.addEventListener("keydown", (e) => {
    if (e.key === "[") setPitch(map.getPitch() - 5);
    if (e.key === "]") setPitch(map.getPitch() + 5);
});

// 유틸
function setZoom(z) {
    const v = Math.max(12, Math.min(20, z));
    map.setZoom(v);
}

// === [FIX] 제거: 2-터치 끝나면 강제 줌 변경 로직(핀치 후 줌이 튀는 원인) :contentReference[oaicite:3]{index=3}
// map.getCanvas().addEventListener("touchend", (e) => {
//   if (e.changedTouches.length === 2 && e.touches.length === 0) {
//     setZoom(map.getZoom() - 1);
//   }
// }, { passive: true });


// === Controls: Locate & North-Up ===
let northUp = true;                  // 기본: 북쪽 고정 모드 ON
let lastFix = null;                  // 최근 GPS 좌표 캐시

// HUD 위에 클릭되도록 별도 컨테이너 생성
const ctl = document.createElement("div");
ctl.style.cssText = `
position:absolute; right:12px; bottom:12px; z-index:10;
display:flex; gap:8px; pointer-events:auto;
`;
const mkBtn = (label) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = `
    padding:8px 10px; border:1px solid #2dd4bf; border-radius:8px;
    background:rgba(0,0,0,.6); color:#0ff; font:600 13px ui-monospace;
    backdrop-filter:saturate(140%) blur(6px);
    `;
    return b;
};
const btnLocate = mkBtn("📍 현위치");
const btnNorth = mkBtn("N↑ 북쪽고정");
ctl.append(btnLocate, btnNorth);
document.body.appendChild(ctl);

// 동작
btnLocate.onclick = () => {
    if (lastFix) {
        map.easeTo({ center: lastFix, duration: 600, zoom: Math.max(16, map.getZoom()) });
    } else {
        navigator.geolocation.getCurrentPosition(
            p => {
                const c = [p.coords.longitude, p.coords.latitude];
                lastFix = c;
                map.easeTo({ center: c, duration: 600, zoom: Math.max(16, map.getZoom()) });
            },
            console.warn,
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
    }
};
btnNorth.onclick = () => {
    northUp = !northUp;
    btnNorth.textContent = northUp ? "N↑ 북쪽고정" : "N↻ 헤딩회전";
    if (northUp) {
        map.setBearing(0);
        map.dragRotate.disable();
        map.touchZoomRotate.enable();       // 핀치줌은 유지
        map.touchZoomRotate.disableRotation();
    } else {
        map.dragRotate.enable();
        map.touchZoomRotate.enable();
        map.touchZoomRotate.enableRotation();
    }
};