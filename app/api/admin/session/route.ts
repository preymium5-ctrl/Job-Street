import { z } from "zod";
import type { NextRequest } from "next/server";
import { failure, json, limitedJson, serverFailure } from "@/lib/api";
import {
  currentAdmin,
  login,
  logout,
  rateLimit,
  sameOrigin,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const admin = await currentAdmin(request);
    return json(
      admin
        ? { authenticated: true, email: admin.email }
        : { authenticated: false },
    );
  } catch (error) {
    return serverFailure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return failure("Sign in from this website.", 403);
    if (!(await rateLimit(request, "login", 10, 900)))
      return failure(
        "Too many sign-in attempts. Try again in 15 minutes.",
        429,
      );
    const parsed = z
      .object({
        email: z.string().trim().email().max(254),
        password: z.string().min(1).max(256),
      })
      .strict()
      .safeParse(await limitedJson(request, 4096));
    if (!parsed.success)
      return failure("Enter a valid email and password.", 422);
    if (
      !(await rateLimit(
        request,
        "login-email",
        10,
        900,
        parsed.data.email.toLowerCase(),
      ))
    )
      return failure(
        "Too many sign-in attempts. Try again in 15 minutes.",
        429,
      );
    const result = await login(parsed.data.email, parsed.data.password);
    if (!result) return failure("The email or password is incorrect.", 401);
    const response = json({ authenticated: true, email: result.email });
    response.cookies.set(
      SESSION_COOKIE,
      result.cookie,
      sessionCookieOptions(request),
    );
    return response;
  } catch (error) {
    if (error instanceof SyntaxError)
      return failure("Enter valid sign-in details.");
    return serverFailure(error);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    if (!sameOrigin(request))
      return failure("Sign out from this website.", 403);
    await logout(request);
    const response = json({ authenticated: false });
    response.cookies.set(SESSION_COOKIE, "", {
      ...sessionCookieOptions(request),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return serverFailure(error);
  }
}
