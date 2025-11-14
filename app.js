// === 글로벌 변수 ===
let northUp = true;    // 북쪽 고정 기본값
let lastFix = null;    // 최근 위치 캐시
let userInteracting = false;
let _idleT;

// === 네이버 API 키 제거 (서버에서 처리) ===

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
  position:absolute; right:12px; bottom:12px; z-index:10;
  display:flex; gap:8px; pointer-events:auto;
`;
const mkBtn = (t) => {
    const b = document.createElement("button");
    b.textContent = t;
    b.style.cssText = `
    padding:8px 10px; border:1px solid #2dd4bf; border-radius:8px;
    background:rgba(0,0,0,.6); color:#0ff; font:600 13px ui-monospace;
  `;
    return b;
};
const btnLocate = mkBtn("📍 현위치");
const btnNorth = mkBtn("N↑ 북쪽고정");
ctl.append(btnLocate, btnNorth);
document.body.appendChild(ctl);

btnLocate.onclick = () => {
    if (lastFix) {
        map.easeTo({ center: lastFix, duration: 600, zoom: Math.max(16, map.getZoom()) });
    } else {
        navigator.geolocation.getCurrentPosition(
            (p) => {
                const c = [p.coords.longitude, p.coords.latitude];
                lastFix = c;
                map.easeTo({ center: c, duration: 600, zoom: Math.max(16, map.getZoom()) });
            },
            console.warn,
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
    }
};

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

// === 네이버 지오코딩으로 검색 (Netlify Function 사용) ===
async function doSearch() {
    const q = qInput.value.trim();
    if (!q) return;

    try {
        // Netlify Function 호출
        const res = await fetch(
            "/.netlify/functions/geocode?q=" + encodeURIComponent(q)
        );

        if (!res.ok) {
            console.error("geocode function error status:", res.status);
            alert("검색 실패(" + res.status + ")");
            return;
        }

        const data = await res.json();

        if (data.addresses && data.addresses.length > 0) {
            const { x, y } = data.addresses[0]; // x: 경도, y: 위도
            const lng = Number(x);
            const lat = Number(y);

            map.easeTo({
                center: [lng, lat],
                zoom: 16,
                duration: 800,
            });
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