// netlify/functions/geocode.js

export async function handler(event) {
    try {
        const q = event.queryStringParameters?.q || "";

        if (!q) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "query param 'q' required" }),
            };
        }

        // 1) 환경변수 + 디버그 (필요하면 하드코딩 fallback도 추가)
        const NAVER_CLIENT_ID =
            process.env.NAVER_CLIENT_ID || "i6my73bw6a"; // <- 디버깅용: 네 Client ID
        const NAVER_CLIENT_SECRET =
            process.env.NAVER_CLIENT_SECRET || "wl3h5URAJOKAgcyE3qUda9mS5khNqZCV7ADqc01M";

        console.log("NAVER KEYS CHECK", {
            hasId: !!process.env.NAVER_CLIENT_ID,
            hasSecret: !!process.env.NAVER_CLIENT_SECRET,
            idFromEnv: process.env.NAVER_CLIENT_ID,
            secretLen: process.env.NAVER_CLIENT_SECRET
                ? process.env.NAVER_CLIENT_SECRET.length
                : 0,
        });

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
        console.log("Naver status:", resp.status, "body:", text);

        return {
            statusCode: resp.status,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
            },
            body: text,
        };
    } catch (e) {
        console.error("geocode function error", e);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "internal error" }),
        };
    }
}
