// 1) 스타일 제공자 선택: MapTiler / Stadia / Mapbox(유료키) 중 택1
// 아래는 MapTiler 예시(무료키 발급 후 교체)
// 데모 말고 아래처럼 교체
const MAP_STYLE = "https://api.maptiler.com/maps/streets-v2/style.json?key=2HioygjPVFKopzhBEhM3";  // buildings 포함


const map = new maplibregl.Map({
    container: "map",
    style: MAP_STYLE,
    center: [126.506498, 37.479726],
    zoom: 16,
    // pitch: 60,
    bearing: -20,     // 회전
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

// 2) 3D 빌딩: 스타일 안에 이미 building layer가 있으면 fill-extrusion을 보장
map.on("styledata", () => {
    if (map.getLayer("3d-buildings")) return;
    const style = map.getStyle();
    const layers = style?.layers || [];
    // 텍스트 심볼 레이어(라벨) 아래로 삽입
    const labelLayerId = layers.find(l => l.type === "symbol" && l.layout?.["text-field"])?.id;
    // building이 들어간 레이어 하나 픽
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

// 3) 경로 라인(예: 서버/REST에서 받은 GeoJSON 경로를 그린다고 가정)
const route = {
    type: "FeatureCollection",
    features: [{
        type: "Feature",
        geometry: {
            type: "LineString",
            coordinates: [
                [126.9779692, 37.566535], // 시청
                [126.983, 37.565],        // 샘플 경유
                [126.990, 37.5655]        // 샘플 목적
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

// 4) GPS 트래킹: 위치 마커 + 카메라 팔로우 + 속도/방위 HUD
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
    marker.setLngLat([longitude, latitude]);
    spdEl.textContent = `${toKmH(speed)} km/h`;
    brgEl.textContent = `${Math.round(clampBearing(heading ?? 0))}°`;
    map.easeTo({
        center: [longitude, latitude],
        bearing: heading ?? map.getBearing(),
        duration: 600, pitch: 60, zoom: 17
    });
};
const onErr = (e) => {
    console.warn("geo error", e);
    // 첫 진입 실패 시 1회 현재 위치 재시도
    navigator.geolocation.getCurrentPosition(onPos, console.warn, { ...geoOpts, timeout: 45000 });
};
navigator.geolocation.watchPosition(onPos, onErr, geoOpts);


function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function setPitch(p) {
    const val = clamp(p, 0, 85);
    map.setPitch(val);                   // 성능상 setPitch가 가벼움
    document.getElementById("pitchRange").value = String(Math.round(val));
    document.getElementById("pitchVal").textContent = `${Math.round(val)}°`;
}

// 컨트롤 바인딩
const pitchRange = document.getElementById("pitchRange");
const pitchInc = document.getElementById("pitchInc");
const pitchDec = document.getElementById("pitchDec");

pitchRange.addEventListener("input", e => setPitch(+e.target.value));
pitchInc.addEventListener("click", () => setPitch(map.getPitch() + 5));
pitchDec.addEventListener("click", () => setPitch(map.getPitch() - 5));

// 초기 동기화
setPitch(map.getPitch());

let twoTouch = null;
map.getCanvas().addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
        twoTouch = { y: (e.touches[0].clientY + e.touches[1].clientY) / 2, pitch: map.getPitch() };
    }
}, { passive: true });

map.getCanvas().addEventListener("touchmove", (e) => {
    if (twoTouch && e.touches.length === 2) {
        const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const dy = twoTouch.y - y;                 // 위로 올리면 dy>0 → 더 기울임
        setPitch(twoTouch.pitch + dy * 0.1);       // 감도 0.1 조절
    }
}, { passive: true });

map.getCanvas().addEventListener("touchend", () => {
    twoTouch = null;
});

window.addEventListener("keydown", (e) => {
    if (e.key === "[") setPitch(map.getPitch() - 5);
    if (e.key === "]") setPitch(map.getPitch() + 5);
});

function setZoom(z) {
    const v = Math.max(12, Math.min(20, z));
    map.setZoom(v);                    // jumpTo/setZoom가 가장 가벼움
}

map.getCanvas().addEventListener("touchend", (e) => {
    // 제스처가 끝났는데 바로 직전에 2-터치였던 경우 간단히 감지
    if (e.changedTouches.length === 2 && e.touches.length === 0) {
        setZoom(map.getZoom() - 1);
    }
}, { passive: true });
map.dragRotate.enable();              // 마우스 드래그 회전 허용
map.touchZoomRotate.enable();         // 터치로 줌/회전 허용
map.touchZoomRotate.enableRotation(); // 두 손가락 회전 허용

// (선택) 휠로 줌 제어 부드럽게
map.scrollZoom.enable();
map.keyboard.enable();

// 모바일 제스처 민감도 보정 (선택)
map.touchZoomRotate._pitchWithRotate = false;