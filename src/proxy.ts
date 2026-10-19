import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL, SYNC_ENABLED } from "@/lib/supabase/env";

// Keeps the sign-in session fresh: Supabase rotates its token cookies here.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!SYNC_ENABLED) return response;
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: list => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // skip static files, images and the job data
  matcher: ["/((?!_next/static|_next/image|data/|sprites/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json)$).*)"],
};
