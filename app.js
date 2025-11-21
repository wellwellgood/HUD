// === 글로벌 상태 ===
let northUp = true;          // 북쪽 고정 모드 여부
let lastFix = null;          // 최근 GPS [lng, lat]
let userInteracting = false; // 손으로 지도 조작 중인지
let idleTimer = null;
let followGps = true;        // GPS 따라 자동 이동 여부

// 경로 / 길안내 상태
let routeLineCoords = [];    // 경로 polyline 좌표들 [ [lng,lat], ... ]
let routeSteps = [];         // 안내 포인트 [{ lng, lat, turnType, description }]
let currentStepIndex = 0;
let guidanceActive = true;   // 길 안내 ON/OFF

let totalDistanceM = 0;      // 전체 거리(m)
let totalTimeSec = 0;        // 전체 시간(sec)

// 목적지 (재탐색 등에 사용 가능)
let destCoord = null;        // [lng, lat]

// HUD 엘리먼트
const spdEl = document.getElementById("spd");
const brgEl = document.getElementById("brg");
let navChip = null;          // 다음 턴 안내
let distChip = null;         // 남은 거리
let etaChip = null;          // 남은 시간

// === 유틸 ===
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

// === HUD chip들 동적 생성 (기존 spd/brg 옆에 추가) ===
(function setupHudChips() {
    const hud = document.querySelector(".hud");
    if (!hud) return;

    navChip = document.createElement("div");
    navChip.className = "chip";
    navChip.id = "nav";
    navChip.textContent = "경로 없음";
    hud.appendChild(navChip);

    distChip = document.createElement("div");
    distChip.className = "chip";
    distChip.id = "dist";
    distChip.textContent = "남은 거리 없음";
    hud.appendChild(distChip);

    etaChip = document.createElement("div");
    etaChip.className = "chip";
    etaChip.id = "eta";
    etaChip.textContent = "남은 시간 없음";
    hud.appendChild(etaChip);
})();

// === 위치/북쪽고정/경로안내 버튼 ===
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
const btnGuide = mkBtn("⏹ 경로안내"); // 기본 ON
ctl.append(btnLocate, btnNorth, btnGuide);
document.body.appendChild(ctl);

// === 제스처 / 사용자 조작 상태 ===
map.dragRotate.enable();
map.touchZoomRotate.enable();
map.touchZoomRotate.enableRotation();
map.scrollZoom.enable();
map.keyboard.enable();

map.on("movestart", () => {
    userInteracting = true;
    followGps = false; // 👈 제스처 시작 시 GPS 팔로우 비활성화
    if (idleTimer) clearTimeout(idleTimer);
});
map.on("moveend", () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        userInteracting = false;
        // followGps 상태는 변경하지 않음. '📍 현위치' 버튼을 눌러야 다시 활성화
    }, 1500);
});
map.on("rotateend", () => {
    if (northUp && map.getBearing() !== 0) {
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
map.on("load", () => map.resize());
window.addEventListener("orientationchange", () => map.resize());
window.addEventListener("resize", () => map.resize());

// === GPS 팔로우 / 마커 ===
// app.js, GPS 팔로우 / 마커 섹션 수정
const markerEl = document.createElement("div");
// ⚠️ 단순한 원 대신 삼각형/화살표 CSS 또는 SVG 사용
markerEl.style.cssText = `
    width: 0; 
    height: 0; 
    border-left: 8px solid transparent; /* 삼각형 모양 */
    border-right: 8px solid transparent;
    border-bottom: 16px solid #0ff; /* 진행 방향 색상 */
    box-shadow: 0 0 8px #0ff;
    border-radius: 100px;
    transform-origin: 50% 100%; /* 회전 중심을 아래쪽 끝으로 설정 */
    /* MapLibre가 자동으로 회전시킴 */
`;
const marker = new maplibregl.Marker({
    element: markerEl,
    anchor: 'bottom', // 마커의 '뾰족한' 부분이 정확히 좌표에 오도록 설정
}).setLngLat(map.getCenter()).addTo(map);

// polyline 기반 남은 거리(m)
function computeRemainingDistance(center) {
    if (!routeLineCoords.length) return 0;
    const [lng, lat] = center;

    // 가장 가까운 경로 지점 인덱스
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < routeLineCoords.length; i++) {
        const [rlng, rlat] = routeLineCoords[i];
        const d = haversineMeters(lat, lng, rlat, rlng);
        if (d < nearestDist) {
            nearestDist = d;
            nearestIdx = i;
        }
    }

    // 그 지점부터 끝까지 합산
    let remain = 0;
    for (let i = nearestIdx; i < routeLineCoords.length - 1; i++) {
        const [lng1, lat1] = routeLineCoords[i];
        const [lng2, lat2] = routeLineCoords[i + 1];
        remain += haversineMeters(lat1, lng1, lat2, lng2);
    }

    return { remainingM: remain, nearestIdx, nearestDist };
}

// 위치 업데이트 시 HUD 갱신
function updateGuidanceForPosition(center) {

    if (guidanceActive && routeLineCoords.length) {
        const { nearestDist } = computeRemainingDistance(center);
        const DEPARTURE_THRESHOLD = 50; // 50m 이상 이탈 시 재탐색

        if (nearestDist > DEPARTURE_THRESHOLD && destCoord) {
            console.warn("경로 이탈 감지! 재탐색 시작.");
            if (navChip) navChip.textContent = "경로 이탈! 재탐색 중...";

            // 재탐색 시작 (현재 위치 -> 목적지)
            requestTmapRoute(center[0], center[1], destCoord[0], destCoord[1]);

            // 재탐색 중 무한 루프 방지를 위해 followGps를 잠시 끔
            followGps = false;
        }
    }

    if (!guidanceActive) return;
    if (!routeLineCoords.length) return;

    const [lng, lat] = center;

    // 남은 거리/시간
    const { remainingM, nearestIdx, nearestDist } =
        computeRemainingDistance(center);

    if (totalDistanceM > 0 && totalTimeSec > 0) {
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

    // 다음 턴 안내
    if (!routeSteps.length || !navChip) return;

    // 현재 위치 기준 가장 가까운 안내 포인트 찾기
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

    // 마커 위치
    marker.setLngLat(center);

    if (!northUp) {
        marker.setRotation(heading ?? 0);
    } else {
        // 북쪽 고정 모드에서는 마커는 북쪽(0도)을 향하도록 설정
        marker.setRotation(0);
    }

    // HUD 업데이트
    if (spdEl) spdEl.textContent = `${toKmH(speed)} km/h`;
    if (brgEl) brgEl.textContent = `${Math.round(clampBearing(heading ?? 0))}°`;

    // GPS 따라가기 모드일 때만 카메라 자동 이동
    if (followGps) {
        const easeOpts = {
            center,
            // 북쪽 고정 모드일 때와 아닐 때의 방위각 처리
            bearing: northUp ? 0 : (heading ?? map.getBearing()),

            // 💡 수정: 모의주행 중이거나 사용자 조작이 없을 때 피치 60 고정
            pitch: (simActive || !userInteracting) ? 40 : map.getPitch(),

            // 내비 느낌 나게 최소 줌 보장
            zoom: Math.max(map.getZoom(), 16),

            // 💡 재수정: duration을 40ms로 설정하여 MapLibre의 자체 보간을 활용
            duration: 40, // 👈 0ms 대신 짧은 시간 설정
        };
        map.easeTo(easeOpts);

        // 길 안내 HUD (남은 거리/시간/다음 턴)
        updateGuidanceForPosition(center);
    };
    updateGuidanceForPosition(center);
};

function simulateGpsMove() {
    if (!routeLineCoords.length) {
        alert("경로가 없습니다. 목적지를 검색해 경로를 먼저 생성하세요.");
        simActive = false;
        btnSim.textContent = "🧪 모의주행";
        return;
    }

    if (simIndex >= routeLineCoords.length) {
        simActive = false;
        btnSim.textContent = "🧪 모의주행";
        alert("모의 주행 완료!");
        return;
    }

    const [lng, lat] = routeLineCoords[simIndex];

    // 속도/방위각 계산
    let heading = 0;
    if (simIndex < routeLineCoords.length - 1) {
        const [lng2, lat2] = routeLineCoords[simIndex + 1];
        heading = Math.atan2(lng2 - lng, lat2 - lat);
        heading = (heading * 180) / Math.PI;
    }

    // onPos의 형태를 그대로 흉내낸다
    const fakePos = {
        coords: {
            longitude: lng,
            latitude: lat,
            speed: 10,  // m/s = 36km/h 정도
            heading: heading,
        },
    };

    onPos(fakePos);

    simIndex++;
}
const geoOpts = {
    enableHighAccuracy: true, // 높은 정확도 요구
    timeout: 15000,           // 15초 내에 응답이 없으면 에러
    maximumAge: 5000,         // 5초 이내의 캐시된 위치 허용
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

    map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: {
            "line-cap": "round",
            "line-join": "round",
        },
        paint: {
            // 💡 수정: 경로선 두께 증가
            "line-width": 8,
            "line-opacity": 1,
            // 💡 수정: 경로색을 더 잘 보이는 파란색으로 변경하거나 테두리 추가
            "line-color": "#42a5f5", // 예시: 밝은 파란색
        },
    });

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

        // 총 거리/시간 요약 (보통 첫 feature에 들어 있음)
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
        "route points:",
        routeLineCoords.length,
        "steps:",
        routeSteps.length,
        "totalDistanceM:",
        totalDistanceM,
        "totalTimeSec:",
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
    if (etaChip && totalTimeSec > 0) {
        etaChip.textContent = `총 예상 ${formatTime(totalTimeSec)}`;
    }
    if (distChip && totalDistanceM > 0) {
        if (totalDistanceM >= 1000) {
            distChip.textContent = `전체 ${(totalDistanceM / 1000).toFixed(1)}km`;
        } else {
            distChip.textContent = `전체 ${Math.round(totalDistanceM)}m`;
        }
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

        console.log("call /tmap-route with:", params.toString());
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

// === 제스처 정책 & 버튼 동작 ===
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

    const locateAndFollow = (center) => {
        lastFix = center;
        map.easeTo({
            center: lastFix,
            duration: 0,
            zoom: Math.max(16, map.getZoom()),
        });
    };

    if (lastFix) {
        locateAndFollow(lastFix);
    } else {
        navigator.geolocation.getCurrentPosition(
            (p) => {
                locateAndFollow([p.coords.longitude, p.coords.latitude]);
            },
            console.warn,
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
    }
};

// map.on('moveend') 핸들러 수정/추가:
map.on("moveend", () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        userInteracting = false;
        followGps = true; // <-- 이 부분이 중요
    }, 1500);
});

// 경로안내 버튼: 안내만 ON/OFF (경로는 그대로)
btnGuide.onclick = () => {
    guidanceActive = !guidanceActive;

    if (!guidanceActive) {
        // 안내 끄기
        btnGuide.textContent = "▶ 경로안내";
        followGps = false; // 자동 따라가기 OFF
        if (navChip) navChip.textContent = "경로 안내 일시중지";
        return;
    }

    // 안내 켜기
    btnGuide.textContent = "⏹ 경로안내";
    followGps = true;       // GPS 따라가기 켬
    userInteracting = false; // 사용자 제스처 상태 리셋

    const activateNavView = (center) => {
        if (!center) return;
        lastFix = center;
        map.easeTo({
            center,
            zoom: 17,      // 내비 뷰 줌 (원하면 16~18 사이로 취향대로)
            pitch: 60,     // 살짝 기울여서 HUD 느낌
            bearing: northUp ? 0 : map.getBearing(),
            duration: 600,
        });
    };

    if (lastFix) {
        // 이미 GPS 한 번이라도 잡힌 상태면 그 위치 기준으로 내비뷰 전환
        activateNavView(lastFix);
    } else if (navigator.geolocation) {
        // 아직 위치 못 잡았으면 한 번 요청해서 바로 내비뷰 전환
        navigator.geolocation.getCurrentPosition(
            (p) => {
                activateNavView([p.coords.longitude, p.coords.latitude]);
            },
            (err) => {
                console.warn("경로안내용 현재 위치 가져오기 실패:", err);
                alert("현 위치를 가져올 수 없어 내비 뷰로 전환하지 못했습니다.");
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
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

            // 목적지 기억
            destCoord = [lng, lat];

            followGps = false;
            userInteracting = false;

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

// 엔터로 검색
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


//모의주행 
const btnSim = mkBtn("🧪 모의주행");
ctl.append(btnSim);

let simTimer = null;
let simIndex = 0;
let simActive = false;
let simFrame = null;
let simProgress = 0;


btnSim.onclick = () => {
    simActive = !simActive;

    if (simActive) {
        btnSim.textContent = "⏹ 모의중지";
        simIndex = 0;
        simProgress = 0;
        simFrame = requestAnimationFrame(smoothSimulate);
    } else {
        btnSim.textContent = "🧪 모의주행";
        cancelAnimationFrame(simFrame);
    }
};

function smoothSimulate() {
    if (!simActive || simIndex >= routeLineCoords.length - 1) {
        cancelAnimationFrame(simFrame);
        return;
    }

    const [lng1, lat1] = routeLineCoords[simIndex];
    const [lng2, lat2] = routeLineCoords[simIndex + 1];

    // 0~1 사이 보간값
    simProgress += 0.04;

    if (simProgress >= 1) {
        simProgress = 0;
        simIndex++;

        // 💡 추가: 모의 주행 완료 처리 (경로 끝 도달 시)
        if (simIndex >= routeLineCoords.length - 1) {
            cancelAnimationFrame(simFrame);
            simActive = false;
            btnSim.textContent = "🧪 모의주행";
            alert("모의 주행 완료!");
            return;
        }
    }

    const lng = lng1 + (lng2 - lng1) * simProgress;
    const lat = lat1 + (lat2 - lat1) * simProgress;

    // 💡 수정: 현재 세그먼트의 진행 방향(Heading) 계산 로직 추가
    // Math.atan2를 사용하여 두 지점 사이의 방위각을 계산한 후 MapLibre의 Bearing 각도로 변환합니다.
    const angleRad = Math.atan2(lat2 - lat1, lng2 - lng1);
    let heading = (angleRad * 180) / Math.PI;
    heading = 90 - heading; // 좌표계 변환
    heading = clampBearing(heading); // 0~360도 보정
    // ----------------------------------------------------

    const fakePos = {
        coords: {
            longitude: lng,
            latitude: lat,
            speed: 10,
            heading: heading, // 👈 계산된 heading 값 사용
        },
    };

    onPos(fakePos);

    simFrame = requestAnimationFrame(smoothSimulate);
}