export async function handler(event) {
    try {
        const q = event.queryStringParameters?.q || "";

        if (!q) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "query param 'q' required" }),
            };
        }

        const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
        const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

        // ✅ 1단계: 환경변수 체크
        if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
            console.error("NAVER keys missing", {
                hasId: !!NAVER_CLIENT_ID,
                hasSecret: !!NAVER_CLIENT_SECRET,
            });
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "NAVER keys not configured on server" }),
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

        // ✅ 2단계: 네이버 응답 상태/본문 로깅
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
