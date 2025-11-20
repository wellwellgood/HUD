// === 글로벌 상태 ===
let northUp = true;          // 북쪽 고정 모드 여부
let lastFix = null;          // 최근 GPS [lng, lat]
let userInteracting = false; // 손으로 지도 조작 중인지
let _idleTimer = null;
let followGps = true;        // GPS 따라 자동 이동 여부

// 위치 평활화용
let positionHistory = [];    // 최근 N개 위치 저장
const MAX_HISTORY = 5;       // 평활화에 사용할 샘플 수
const MAX_SPEED_MPS = 50;    // 최대 허용 속도 (m/s) - 약 180km/h
const MIN_ACCURACY = 50;     // 최소 정확도 (미터) - 이보다 부정확하면 무시

// 경로/길안내 상태
let routeLineCoords = [];    // 전체 경로 polyline 좌표들 [ [lng,lat], ... ]
let routeSteps = [];         // 안내용 포인트 배열 [{ lng, lat, turnType, description }]
let currentStepIndex = 0;
let guidanceActive = true;   // 경로 안내 ON/OFF

// 경로 요약 정보
let totalDistanceM = 0;      // 전체 거리(m)
let totalTimeSec = 0;        // 전체 시간(sec)

// HUD 엘리먼트
let navChip = null;          // 다음 턴 안내
let etaChip = null;          // 남은 시간
let distChip = null;         // 남은 거리

// C. 카메라/속도 구조용
let cameraMarkers = [];      // 단속 카메라 마커들 (데이터 연결되면 사용)

// === 유틸: 각도/거리/시간 포맷 ===
function clampBearing(deg) {
    return ((deg % 360) + 360) % 360;
}

function toKmH(ms) {
    return Math.round((ms || 0) * 3.6);
}

function toRad(deg) {
    return (deg * Math.PI) / 180;
}

// 하버사인 거리(m)
function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// 초 → "h시간 m분 s초"
function formatTime(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);

    if (h > 0) return `${h}시간 ${m}분 ${s}초`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

// turnType → 텍스트
function turnTypeToText(turnType) {
    const t = Number(turnType);
    switch (t) {
        case 11:
        case 51:
            return "직진";
        case 12:
        case 16:
        case 17:
            return "좌회전";
        case 13:
        case 18:
        case 19:
            return "우회전";
        case 14:
            return "U턴";
        case 71:
            return "첫 번째 출구";
        case 72:
            return "두 번째 출구";
        case 73:
            return "첫 번째 오른쪽 길";
        case 200:
            return "출발지";
        case 201:
            return "목적지";
        default:
            return "직진";
    }
}

// === 지도 생성 ===
const MAP_STYLE =
    "https://api.maptiler.com/maps/streets-v2/style.json?key=2HioygjPVFKopzhBEhM3";

const map = new maplibregl.Map({
    container: "map",
    style: MAP_STYLE,
    center: [126.506498, 37.479726],
    zoom: 16,
    bearing: -20,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

// === HUD / 버튼 세팅 ===
const spdEl = document.getElementById("spd");
const brgEl = document.getElementById("brg");

// HUD chip들 추가
(function setupHudChips() {
    const hud = document.querySelector(".hud");
    if (!hud) return;

    // 다음 턴 안내
    navChip = document.createElement("div");
    navChip.className = "chip";
    navChip.id = "nav";
    navChip.textContent = "경로 없음";
    hud.appendChild(navChip);

    // 남은 거리
    distChip = document.createElement("div");
    distChip.className = "chip";
    distChip.id = "dist";
    distChip.textContent = "남은 거리 없음";
    hud.appendChild(distChip);

    // 남은 시간
    etaChip = document.createElement("div");
    etaChip.className = "chip";
    etaChip.id = "eta";
    etaChip.textContent = "남은 시간 없음";
    hud.appendChild(etaChip);
})();

// 위치/북쪽 고정/경로안내 버튼
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
function mkBtn(label) {
    const b = document.createElement("button");
    b.textContent = label;
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
}
const btnLocate = mkBtn("📍 현위치");
const btnNorth = mkBtn("N↑ 북쪽고정");
const btnGuide = mkBtn("⏹ 경로안내"); // 기본 ON 상태
ctl.append(btnLocate, btnNorth, btnGuide);
document.body.appendChild(ctl);

// === 제스처/사용자 상태 ===
map.dragRotate.enable();
map.touchZoomRotate.enable();
map.touchZoomRotate.enableRotation();
map.scrollZoom.enable();
map.keyboard.enable();

map.on("movestart", () => {
    userInteracting = true;
    if (_idleTimer) clearTimeout(_idleTimer);
});
map.on("moveend", () => {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => {
        userInteracting = false;
    }, 1500);
});
map.on("rotateend", () => {
    if (!northUp && map.getBearing() !== 0) {
        map.easeTo({ bearing: 0, duration: 300 });
    }
});

// === GeolocateControl ===
const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showAccuracyCircle: true,
    showUserHeading: true,
});
map.addControl(geolocate, "top-right");

map.on("load", () => {
    map.resize();
});
window.addEventListener("orientationchange", () => map.resize());
window.addEventListener("resize", () => map.resize());

// === GPS 팔로우 / 마커 ===
const markerEl = document.createElement("div");
markerEl.style.cssText =
    "width:16px;height:16px;border-radius:50%;background:#0ff;box-shadow:0 0 8px #0ff;";
const marker = new maplibregl.Marker({ element: markerEl })
    .setLngLat(map.getCenter())
    .addTo(map);

const geoOpts = {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 30000,
};

// routeLineCoords 기준으로 남은 거리(m) 계산
function computeRemainingDistance(center) {
    if (!routeLineCoords.length) return 0;

    const [lng, lat] = center;
    let nearestIdx = 0;
    let nearestDist = Infinity;

    // 가장 가까운 polyline 점 찾기
    for (let i = 0; i < routeLineCoords.length; i++) {
        const [rlng, rlat] = routeLineCoords[i];
        const d = haversineMeters(lat, lng, rlat, rlng);
        if (d < nearestDist) {
            nearestDist = d;
            nearestIdx = i;
        }
    }

    // 그 지점부터 끝까지 거리 합산
    let remain = 0;
    for (let i = nearestIdx; i < routeLineCoords.length - 1; i++) {
        const [lng1, lat1] = routeLineCoords[i];
        const [lng2, lat2] = routeLineCoords[i + 1];
        remain += haversineMeters(lat1, lng1, lat2, lng2);
    }
    return remain;
}

function updateGuidanceForPosition(center) {
    if (!guidanceActive) return;

    // --- 남은 거리/시간 ---
    if (totalDistanceM > 0 && totalTimeSec > 0 && (etaChip || distChip)) {
        const remainingM = computeRemainingDistance(center);
        const ratio = Math.max(
            0,
            Math.min(1, remainingM / totalDistanceM)
        );
        const remainingSec = totalTimeSec * ratio;

        if (distChip) {
            let distLabel;
            if (remainingM >= 1000) {
                distLabel = `남은 ${(remainingM / 1000).toFixed(1)}km`;
            } else {
                distLabel = `남은 ${Math.round(remainingM)}m`;
            }
            distChip.textContent = distLabel;
        }

        if (etaChip) {
            etaChip.textContent = `남은 ${formatTime(Math.round(remainingSec))}`;
        }
    }

    // --- 다음 턴 안내 ---
    if (!routeSteps.length || !navChip) return;

    const [lng, lat] = center;
    let bestIdx = currentStepIndex;
    let bestDist = Infinity;

    for (let i = currentStepIndex; i < routeSteps.length; i++) {
        const s = routeSteps[i];
        const d = haversineMeters(lat, lng, s.lat, s.lng);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }

    currentStepIndex = bestIdx;
    const step = routeSteps[bestIdx];
    const turnText = step.description
        ? step.description
        : turnTypeToText(step.turnType);

    let label;
    if (Number(step.turnType) === 201) {
        label = "곧 목적지입니다";
    } else if (bestDist < 15) {
        label = "지금 " + turnText;
    } else {
        label = `${Math.round(bestDist)}m 앞 ${turnText}`;
    }

    navChip.textContent = label;
}

const onPos = (pos) => {
    const { longitude, latitude, speed, heading } = pos.coords;
    const center = [longitude, latitude];
    lastFix = center;

    marker.setLngLat(center);

    if (spdEl) spdEl.textContent = `${toKmH(speed)} km/h`;
    if (brgEl) brgEl.textContent = `${Math.round(clampBearing(heading ?? 0))}°`;

    if (followGps) {
        const easeOpts = {
            center,
            bearing: northUp ? (heading ?? map.getBearing()) : 0,
            duration: 600,
        };
        if (!userInteracting) easeOpts.pitch = 60;
        map.easeTo(easeOpts);
    }

    updateGuidanceForPosition(center);
};

const onErr = (e) => {
    console.warn("geo error", e.code, e.message);
    if (spdEl) spdEl.textContent = "위치권한 거부/실패";
    navigator.geolocation.getCurrentPosition(onPos, console.warn, {
        ...geoOpts,
        timeout: 45000,
    });
};

navigator.geolocation.watchPosition(onPos, onErr, geoOpts);

// === Tmap 경로 렌더링 ===
const ROUTE_SOURCE_ID = "tmap-route-source";
const ROUTE_LAYER_ID = "tmap-route-layer";

function drawTmapRoute(tmapData) {
    console.log("Tmap route raw data:", tmapData);

    routeLineCoords = [];
    routeSteps = [];
    totalDistanceM = 0;
    totalTimeSec = 0;
    currentStepIndex = 0;

    if (navChip) navChip.textContent = "경로 안내 준비중";
    if (distChip) distChip.textContent = "남은 거리 계산중";
    if (etaChip) etaChip.textContent = "남은 시간 계산중";

    if (!tmapData || !Array.isArray(tmapData.features)) {
        console.warn("Tmap data has no features");
        return;
    }

    let summarySet = false;

    for (const f of tmapData.features) {
        const geom = f.geometry;
        const prop = f.properties || {};

        // 전체 요약 (첫 Feature에 totalDistance/totalTime 있는 경우)
        if (!summarySet && typeof prop.totalDistance === "number") {
            totalDistanceM = prop.totalDistance;
            totalTimeSec = prop.totalTime ?? 0;
            summarySet = true;
        }

        if (geom && geom.type === "LineString" && Array.isArray(geom.coordinates)) {
            for (const c of geom.coordinates) {
                routeLineCoords.push([c[0], c[1]]);
            }
        }

        if (geom && geom.type === "Point" && geom.coordinates) {
            const [lng, lat] = geom.coordinates;
            if (typeof prop.turnType !== "undefined") {
                routeSteps.push({
                    lng,
                    lat,
                    turnType: prop.turnType,
                    description: prop.description || prop.name || "",
                });
            }
        }
    }

    console.log(
        "Tmap route line points:",
        routeLineCoords.length,
        "steps:",
        routeSteps.length,
        "totalDistance(m):",
        totalDistanceM,
        "totalTime(sec):",
        totalTimeSec
    );

    if (!routeLineCoords.length) {
        console.warn("No LineString in Tmap route");
        if (navChip) navChip.textContent = "경로 데이터 없음";
        return;
    }

    const geojson = {
        type: "Feature",
        geometry: { type: "LineString", coordinates: routeLineCoords },
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
    routeLineCoords.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 80, duration: 800 });

    if (navChip) navChip.textContent = "경로 안내 시작";
    if (distChip) distChip.textContent = "남은 거리 계산중";
    if (etaChip && totalTimeSec > 0) {
        etaChip.textContent = `총 예상 ${formatTime(totalTimeSec)}`;
    }

    guidanceActive = true;
    btnGuide.textContent = "⏹ 경로안내";
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

        console.log("call /.netlify/functions/tmap-route with:", params.toString());

        const res = await fetch(
            "/.netlify/functions/tmap-route?" + params.toString()
        );
        console.log("tmap-route status:", res.status);

        if (!res.ok) {
            if (navChip) navChip.textContent = "경로 탐색 실패";
            alert("Tmap 경로 탐색 실패(" + res.status + ")");
            return;
        }

        const data = await res.json();
        drawTmapRoute(data);
    } catch (e) {
        console.error("tmap-route fetch error:", e);
        if (navChip) navChip.textContent = "경로 오류";
        alert("Tmap 경로 탐색 중 오류 발생");
    }
}

// === C. 카메라/속도 구조 (데이터 연결 시 사용) ===

// cameraList: [{ lng, lat, type, limitSpeed }, ...]
function renderCameras(cameraList) {
    // 기존 마커 제거
    cameraMarkers.forEach((m) => m.remove());
    cameraMarkers = [];

    if (!Array.isArray(cameraList)) return;

    cameraList.forEach((cam) => {
        const el = document.createElement("div");
        el.style.cssText =
            "width:10px;height:10px;border-radius:50%;background:#ff4444;box-shadow:0 0 8px #ff4444;";
        const m = new maplibregl.Marker({ element: el })
            .setLngLat([cam.lng, cam.lat])
            .addTo(map);
        cameraMarkers.push(m);
    });
}

// TODO 예시:
// fetch("/cameras.json").then(r => r.json()).then(list => renderCameras(list));

// === 제스처 정책 ===
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

btnLocate.onclick = () => {
    followGps = true;
    userInteracting = false;

    if (lastFix) {
        map.easeTo({
            center: lastFix,
            duration: 800,
            zoom: Math.max(16, map.getZoom()),
        });
    } else {
        navigator.geolocation.getCurrentPosition(
            (p) => {
                lastFix = [p.coords.longitude, p.coords.latitude];
                map.easeTo({
                    center: lastFix,
                    duration: 600,
                    zoom: Math.max(16, map.getZoom()),
                });
            },
            console.warn,
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
        );
    }
};

// ▶ 경로안내 버튼 토글
btnGuide.onclick = () => {
    guidanceActive = !guidanceActive;
    btnGuide.textContent = guidanceActive ? "⏹ 경로안내" : "▶ 경로안내";
    if (navChip && !guidanceActive) {
        navChip.textContent = "경로 안내 일시중지";
    }
};

// === 검색 → 카카오 geocode + Tmap 경로 ===
const qInput = document.getElementById("q");

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

        if (data.documents && data.documents.length > 0) {
            const place = data.documents[0];
            const lng = Number(place.x);
            const lat = Number(place.y);

            followGps = false;
            userInteracting = true;

            map.easeTo({
                center: [lng, lat],
                zoom: 16,
                duration: 800,
            });

            console.log("lastFix (current GPS):", lastFix);

            const startRoute = () => {
                if (lastFix) {
                    requestTmapRoute(lastFix[0], lastFix[1], lng, lat);
                } else {
                    console.log("lastFix 없음 → getCurrentPosition으로 한 번 더 시도");
                    navigator.geolocation.getCurrentPosition(
                        (p) => {
                            lastFix = [p.coords.longitude, p.coords.latitude];
                            console.log("fallback geo fix:", lastFix);
                            requestTmapRoute(lastFix[0], lastFix[1], lng, lat);
                        },
                        (err) => {
                            console.warn("fallback geo error", err);
                            alert("현위치 정보를 가져올 수 없어서 경로를 그릴 수 없습니다.");
                        },
                        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
                    );
                }
            };

            startRoute();
        } else {
            alert("검색 결과 없음");
        }
    } catch (e) {
        console.error("geocode fetch error:", e);
        alert("검색 중 오류 발생");
    }
}

qInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        doSearch();
    }
});

if (qInput.form) {
    qInput.form.addEventListener("submit", (e) => {
        e.preventDefault();
        doSearch();
    });
}
