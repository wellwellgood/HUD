// netlify/functions/geocode.js
exports.handler = async (event, context) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json; charset=utf-8",
    };

    // OPTIONS 요청 (CORS preflight) 처리
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

    // 환경변수에서 API 키 가져오기
    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

    console.log("NAVER_ENV_CHECK", {
        hasId: !!NAVER_CLIENT_ID,
        hasSecret: !!NAVER_CLIENT_SECRET,
    });

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "NAVER API keys not configured" }),
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
            "https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=" +
            encodeURIComponent(q);

        // ✅ 헤더 이름을 소문자로 변경
        const resp = await fetch(url, {
            method: "GET",
            headers: {
                "x-ncp-apigw-api-key-id": NAVER_CLIENT_ID,
                "x-ncp-apigw-api-key": NAVER_CLIENT_SECRET,
            },
        });

        const text = await resp.text();

        console.log("Naver API Response:", {
            status: resp.status,
            ok: resp.ok,
            query: q,
        });

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
            body: JSON.stringify({ error: "internal error", message: e.message }),
        };
    }
};