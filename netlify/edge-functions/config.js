export default async function handler(req, context) {
    // Only serve to your own origin — blocks other sites calling this
    const origin = req.headers.get("origin") || "";
    const allowed = "https://www.thebespokefoilcompany.co.uk";

    return new Response(
        JSON.stringify({
            supabaseUrl: Deno.env.get("SUPABASE_URL"),
            supabaseKey: Deno.env.get("SUPABASE_ANON_KEY"),
        }),
        {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                // Don't let CDN cache this
                "Cache-Control": "no-store",
            },
        }
    );
}

export const config = { path: "/api/config" };
