<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public const SLUG_PATTERN = '/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/';

    /** Fields to strip before a user model goes into a JSON response. */
    private function sanitizeUser(User $user): array
    {
        return $user->only([
            'id', 'tenant_id', 'email', 'name', 'role', 'phone', 'avatar_url',
            'is_active', 'email_verified', 'auth_provider', 'google_sub',
            'created_at', 'updated_at',
        ]);
    }

    private function issueTokens(User $user): array
    {
        // Sanctum has no separate access/refresh token concept; the frontend
        // never reads `refresh_token` (verified against frontend/src/lib/auth.jsx)
        // so a single token is exposed under both keys for shape compatibility.
        $token = $user->createToken('api', ['*'], now()->addMinutes((int) env('SANCTUM_TOKEN_EXPIRATION', 20160)))->plainTextToken;

        return [
            'access_token' => $token,
            'refresh_token' => $token,
            'user' => $this->sanitizeUser($user),
        ];
    }

    public function register(Request $request)
    {
        $request->validate([
            'tenant_name' => 'required|string|max:120',
            'tenant_slug' => 'required|string',
            'center_type' => 'nullable|string',
            'name' => 'required|string|max:120',
            'email' => 'required|email',
            'password' => 'required|string|min:8|max:128',
        ]);

        $slug = strtolower(trim($request->tenant_slug));
        if (! preg_match(self::SLUG_PATTERN, $slug)) {
            abort(400, 'Invalid slug (a-z, 0-9, hyphens, 3-32 chars)');
        }
        if (Tenant::where('slug', $slug)->exists()) {
            abort(409, "This workspace URL is already taken");
        }

        $email = strtolower($request->email);
        if (User::where('email', $email)->exists()) {
            abort(409, 'Email already registered');
        }

        return DB::transaction(function () use ($request, $slug, $email) {
            $tenant = Tenant::create([
                'name' => trim($request->tenant_name),
                'slug' => $slug,
                'center_type' => $request->center_type ?: 'tutoring',
                'status' => 'trial',
                'trial_ends_at' => now()->addDays(14),
            ]);

            $user = User::create([
                'tenant_id' => $tenant->id,
                'email' => $email,
                'name' => trim($request->name),
                'role' => User::ROLE_OWNER,
                'email_verified' => true,
                'password' => Hash::make($request->password),
            ]);

            return response()->json($this->issueTokens($user));
        });
    }

    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
            'tenant_slug' => 'nullable|string',
        ]);

        $query = User::where('email', strtolower($request->email));

        if ($request->filled('tenant_slug')) {
            $tenant = Tenant::where('slug', strtolower($request->tenant_slug))->first();
            if (! $tenant) {
                abort(404, 'Workspace not found');
            }
            $query->where('tenant_id', $tenant->id);
        }

        $user = $query->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            abort(401, 'Invalid credentials');
        }
        if (! $user->is_active) {
            abort(403, 'Account disabled');
        }

        return response()->json($this->issueTokens($user));
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['ok' => true]);
    }

    public function me(Request $request)
    {
        $user = $request->user();
        $tenant = $user->tenant_id ? Tenant::find($user->tenant_id) : null;

        return response()->json([
            'user' => $this->sanitizeUser($user),
            'tenant' => $tenant,
        ]);
    }

    public function refresh(Request $request)
    {
        // No cookie-based refresh flow (the frontend sends Authorization
        // headers only — withCredentials: false — so the original
        // FastAPI cookie mechanism was never actually exercised by this
        // client). This re-issues a token for the currently authenticated
        // Sanctum session, kept only for endpoint-shape compatibility.
        $user = $request->user();
        $token = $user->createToken('api', ['*'], now()->addMinutes((int) env('SANCTUM_TOKEN_EXPIRATION', 20160)))->plainTextToken;

        return response()->json(['access_token' => $token]);
    }

    public function forgotPassword(Request $request)
    {
        $request->validate(['email' => 'required|email']);

        $user = User::where('email', strtolower($request->email))->first();

        if ($user) {
            $token = Str::random(43);
            DB::table('password_reset_tokens')->insert([
                'token' => $token,
                'user_id' => $user->id,
                'expires_at' => now()->addHour(),
                'used' => false,
                'created_at' => now(),
            ]);

            // Production sends the token by email. Returning it in the response
            // is an account-takeover primitive for anyone who knows a victim's
            // email, so it's only exposed when explicitly enabled for local dev.
            if (filter_var(env('DEV_EXPOSE_RESET_TOKENS', false), FILTER_VALIDATE_BOOLEAN)) {
                return response()->json([
                    'ok' => true,
                    'dev_token' => $token,
                    'message' => 'Reset link generated (dev mode)',
                ]);
            }
        }

        return response()->json(['ok' => true, 'message' => 'If this email exists, a reset link has been sent']);
    }

    public function resetPassword(Request $request)
    {
        $request->validate([
            'token' => 'required|string',
            'new_password' => 'required|string|min:8|max:128',
        ]);

        $row = DB::table('password_reset_tokens')->where('token', $request->token)->first();

        if (! $row || $row->used) {
            abort(400, 'Invalid or expired token');
        }
        if (now()->greaterThan($row->expires_at)) {
            abort(400, 'Token expired');
        }

        User::where('id', $row->user_id)->update(['password' => Hash::make($request->new_password)]);
        DB::table('password_reset_tokens')->where('token', $request->token)->update(['used' => true]);

        return response()->json(['ok' => true]);
    }
}
