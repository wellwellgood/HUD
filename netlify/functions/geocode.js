// netlify/functions/geocode.js
exports.handler = async (event, context) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json; charset=utf-8",
    };

    // 여기서 env 제대로 읽히는지 로그 찍기
    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

    console.log("NAVER_ENV_CHECK", {
        hasId: !!NAVER_CLIENT_ID,
        hasSecret: !!NAVER_CLIENT_SECRET,
        idSample: NAVER_CLIENT_ID ? NAVER_CLIENT_ID.slice(0, 4) : null,
        secretLen: NAVER_CLIENT_SECRET ? NAVER_CLIENT_SECRET.length : 0,
    });

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
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
