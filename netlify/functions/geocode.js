// netlify/functions/geocode.js
exports.handler = async (event, context) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json; charset=utf-8",
    };

    // 1) 환경변수에서만 키 읽기 (하드코딩 X)
    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        console.error("NAVER keys missing", {
            hasId: !!NAVER_CLIENT_ID,
            hasSecret: !!NAVER_CLIENT_SECRET,
        });
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "NAVER keys not configured" }),
        };
    }

    // 이하 기존 로직
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

    try {
        const q = event.queryStringParameters?.q || "";
        if (!q) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: "query param 'q' required" }),
            };
        }

        const url =
            "https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=" +
            encodeURIComponent(q);

        const resp = await fetch(url, {
            headers: {
                "X-NCP-APIGW-API-KEY-ID": NAVER_CLIENT_ID,
                "X-NCP-APIGW-API-KEY": NAVER_CLIENT_SECRET,
            },
        });

        const text = await resp.text();

        return {
            statusCode: resp.status,
            headers,
            body: text,
        };
    } catch (e) {
        console.error("Geocode function error:", e);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "internal error" }),
        };
    }
};
