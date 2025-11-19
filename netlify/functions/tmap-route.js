// netlify/functions/tmap-route.js
exports.handler = async (event, context) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json; charset=utf-8",
    };

    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers, body: "" };
    }

    if (event.httpMethod !== "GET") {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: "Method not allowed" }),
        };
    }

    const TMAP_APP_KEY = process.env.TMAP_APP_KEY;
    if (!TMAP_APP_KEY) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "TMAP_APP_KEY missing" }),
        };
    }

    const qs = event.queryStringParameters || {};
    const sx = qs.sx;
    const sy = qs.sy;
    const ex = qs.ex;
    const ey = qs.ey;

    if (!sx || !sy || !ex || !ey) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
                error: "sx, sy, ex, ey 쿼리 파라미터가 필요합니다.",
            }),
        };
    }

    try {
        // 자동차차 경로 안내 API 사용
        // POST https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json :contentReference[oaicite:1]{index=1}
        const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
        const body = JSON.stringify({
            startX: sx,
            startY: sy,
            endX: ex,
            endY: ey,
            reqCoordType: "WGS84GEO",
            resCoordType: "WGS84GEO",
            searchOption: "0",   // 0=빠른길, 1=무료도로, 2=최단거리, 4=고속도로 우선 등
            trafficInfo: "Y",     // "Y" 하면 교통정보 포함(경로 형태 달라짐)
            directionOption: 1,
            tollgateFareOption: 16,
            roadType: 32,
            endRpFlag: G,
            gpsTime: 20191125153000,
            speed: 10,
            uncetaintyP: 1,
            uncetaintyA: 1,
            uncetaintyAP: 1,
            carType: 0,
            startName: "%EC%9D%84%EC%A7%80%EB%A1%9C%20%EC%9E%85%EA%B5%AC%EC%97%AD",
            endName: "%ED%97%A4%EC%9D%B4%EB%A6%AC",
            passList: "127.38454163183215,36.35127257501252",
            gpsInfoList: "126.939376564495,37.470947057194365,120430,20,50,5,2,12,1_126.939376564495,37.470947057194365,120430,20,50,5,2,12,1",
            detailPosFlag: '2',
            sort: index
        });

        const resp = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                appKey: TMAP_APP_KEY,
            },
            body,
        });

        const text = await resp.text();

        return {
            statusCode: resp.status,
            headers,
            body: text,
        };
    } catch (e) {
        console.error("Tmap route error:", e);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "internal error", message: e.message }),
        };
    }
};
