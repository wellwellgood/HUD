// netlify/functions/geocode.js

exports.handler = async (event) => {
    // CORS 헤더 (모든 응답에 공통 적용)
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
    };

    // OPTIONS 요청 처리 (CORS preflight)
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers,
            body: "",
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

        // 환경변수에서 API 키 가져오기 (없으면 하드코딩된 값 사용)
        const NAVER_CLIENT_ID =
            process.env.NAVER_CLIENT_ID || "i6my73bw6a";
        const NAVER_CLIENT_SECRET =
            process.env.NAVER_CLIENT_SECRET || "wl3h5URAJOKAgcyE3qUda9mS5khNqZCV7ADqc01M";

        // 환경변수 확인 로그 (디버깅용)
        console.log("NAVER KEYS CHECK:", {
            hasId: !!process.env.NAVER_CLIENT_ID,
            hasSecret: !!process.env.NAVER_CLIENT_SECRET,
        });

        // 네이버 Geocoding API 호출
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

        // 네이버 API 응답 로그
        console.log("Naver API Response:", {
            status: resp.status,
            bodyLength: text.length,
            query: q,
        });

        // 네이버 API 응답을 그대로 클라이언트에 전달
        return {
            statusCode: resp.status,
            headers,
            body: text,
        };
    } catch (e) {
        console.error("geocode function error:", e);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: "internal error",
                message: e.message
            }),
        };
    }
};