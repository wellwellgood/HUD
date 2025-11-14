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

        const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
        const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

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
