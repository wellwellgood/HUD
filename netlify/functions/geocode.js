// netlify/functions/geocode.js

exports.handler = async (event, context) => {
    // CORS 헤더 - 모든 응답에 포함
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json; charset=utf-8",
    };

    // 1) 환경변수에서 API 키 가져오기 (없으면 테스트용 하드코드)
    const NAVER_CLIENT_ID =
        process.env.NAVER_CLIENT_ID || "i6my73bw6a";
    const NAVER_CLIENT_SECRET =
        process.env.NAVER_CLIENT_SECRET || "wl3h5URAJOKAgcyE3qUda9mS5khNqZCV7ADqc01M";

    console.log("NAVER_ENV_CHECK", {
        hasId: !!process.env.NAVER_CLIENT_ID,
        hasSecret: !!process.env.NAVER_CLIENT_SECRET,
        idSample: NAVER_CLIENT_ID.slice(0, 4),
        secretLen: NAVER_CLIENT_SECRET.length,
    });

    // 2) OPTIONS 요청 (CORS preflight) 처리
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 204,
            headers,
            body: "",
        };
    }

    // 3) GET 요청만 허용
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

        console.log("Geocoding request:", { query: q });

        const url =
            "https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=" +
            encodeURIComponent(q);

        const resp = await fetch(url, {
            method: "GET",
            headers: {
                "X-NCP-APIGW-API-KEY-ID": NAVER_CLIENT_ID,
                "X-NCP-APIGW-API-KEY": NAVER_CLIENT_SECRET,
            },
        });

        const data = await resp.text();

        console.log("Naver API Response:", {
            status: resp.status,
            ok: resp.ok,
        });

        return {
            statusCode: resp.ok ? 200 : resp.status,
            headers,
            body: data,
        };
    } catch (e) {
        console.error("Geocode function error:", e);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: "Internal server error",
                message: e.message,
            }),
        };
    }
};
