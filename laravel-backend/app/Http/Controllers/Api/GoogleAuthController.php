<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Manual Google OAuth authorization-code flow — reimplemented to match the
 * original FastAPI backend's contract exactly (same three endpoints, same
 * one-time-exchange-code handoff) so the frontend's GoogleAuthButton.jsx /
 * OAuthCallbackPage.jsx work completely unchanged against this backend.
 */
class GoogleAuthController extends Controller
{
    private const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

    private const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private function clientId(): string
    {
        $v = env('GOOGLE_CLIENT_ID', '');
        if (! $v) {
            abort(503, 'Google sign-in is not configured on this server');
        }

        return $v;
    }

    private function clientSecret(): string
    {
        $v = env('GOOGLE_CLIENT_SECRET', '');
        if (! $v) {
            abort(503, 'Google sign-in is not configured on this server');
        }

        return $v;
    }

    private function redirectUri(): string
    {
        return env('GOOGLE_REDIRECT_URI', 'http://localhost:8002/api/v1/auth/google/callback');
    }

    private function frontendUrl(): string
    {
        return rtrim(env('FRONTEND_URL', 'http://localhost:3000'), '/');
    }

    public function start(Request $request)
    {
        $intent = $request->query('intent', 'login');
        if (! in_array($intent, ['login', 'register'], true)) {
            abort(400, 'Invalid intent');
        }

        $state = ['intent' => $intent];

        if ($intent === 'register') {
            $tenantName = $request->query('tenant_name');
            $tenantSlug = $request->query('tenant_slug');
            if (! $tenantName || ! $tenantSlug) {
                abort(400, 'tenant_name and tenant_slug are required to sign up');
            }
            $slug = strtolower(trim($tenantSlug));
            if (! preg_match(AuthController::SLUG_PATTERN, $slug)) {
                abort(400, 'Invalid slug (a-z, 0-9, hyphens, 3-32 chars)');
            }
            $state['tenant_name'] = mb_substr(trim($tenantName), 0, 120);
            $state['tenant_slug'] = $slug;
            $state['center_type'] = $request->query('center_type') ?: 'tutoring';
        }

        $signedState = Crypt::encryptString(json_encode(array_merge($state, ['exp' => now()->addMinutes(10)->timestamp])));

        $params = [
            'client_id' => $this->clientId(),
            'redirect_uri' => $this->redirectUri(),
            'response_type' => 'code',
            'scope' => 'openid email profile',
            'state' => $signedState,
            'access_type' => 'online',
            'prompt' => 'select_account',
        ];

        return redirect()->away(self::GOOGLE_AUTH_URL.'?'.http_build_query($params));
    }

    private function decodeState(string $state): ?array
    {
        try {
            $payload = json_decode(Crypt::decryptString($state), true);
        } catch (\Throwable) {
            return null;
        }

        if (! is_array($payload) || ($payload['exp'] ?? 0) < now()->timestamp) {
            return null;
        }

        return $payload;
    }

    private function decodeGoogleIdToken(string $idToken, string $clientId): ?array
    {
        $parts = explode('.', $idToken);
        if (count($parts) !== 3) {
            return null;
        }

        $padded = strtr($parts[1], '-_', '+/');
        $padded .= str_repeat('=', (4 - strlen($padded) % 4) % 4);
        $payload = json_decode(base64_decode($padded), true);

        if (! is_array($payload)) {
            return null;
        }
        if (($payload['aud'] ?? null) !== $clientId) {
            return null;
        }
        if (! in_array($payload['iss'] ?? null, ['accounts.google.com', 'https://accounts.google.com'], true)) {
            return null;
        }
        if (($payload['exp'] ?? 0) < now()->timestamp) {
            return null;
        }
        if (empty($payload['email'])) {
            return null;
        }

        return $payload;
    }

    public function callback(Request $request)
    {
        $front = $this->frontendUrl();

        $code = $request->query('code');
        $state = $request->query('state');
        $error = $request->query('error');

        if ($error || ! $code || ! $state) {
            return redirect()->away("$front/oauth/callback?error=access_denied");
        }

        $statePayload = $this->decodeState($state);
        if (! $statePayload) {
            return redirect()->away("$front/oauth/callback?error=invalid_state");
        }

        try {
            $tokenResponse = Http::asForm()->post(self::GOOGLE_TOKEN_URL, [
                'code' => $code,
                'client_id' => $this->clientId(),
                'client_secret' => $this->clientSecret(),
                'redirect_uri' => $this->redirectUri(),
                'grant_type' => 'authorization_code',
            ]);
        } catch (\Throwable) {
            return redirect()->away("$front/oauth/callback?error=google_unreachable");
        }

        if (! $tokenResponse->successful()) {
            return redirect()->away("$front/oauth/callback?error=google_token_exchange_failed");
        }

        $idToken = $tokenResponse->json('id_token');
        if (! $idToken) {
            return redirect()->away("$front/oauth/callback?error=no_id_token");
        }

        $profile = $this->decodeGoogleIdToken($idToken, $this->clientId());
        if (! $profile) {
            return redirect()->away("$front/oauth/callback?error=invalid_token");
        }
        if (empty($profile['email_verified'])) {
            return redirect()->away("$front/oauth/callback?error=email_not_verified");
        }

        $email = strtolower($profile['email']);
        $user = User::where('email', $email)->first();

        if ($user) {
            if (! $user->is_active) {
                return redirect()->away("$front/oauth/callback?error=account_disabled");
            }
            if (! $user->google_sub) {
                $user->update(['google_sub' => $profile['sub'], 'auth_provider' => 'google']);
            }
        } else {
            if (($statePayload['intent'] ?? null) !== 'register') {
                $q = http_build_query(['error' => 'no_account', 'email' => $email]);

                return redirect()->away("$front/oauth/callback?$q");
            }

            $slug = $statePayload['tenant_slug'];
            if (Tenant::where('slug', $slug)->exists()) {
                return redirect()->away("$front/oauth/callback?error=slug_taken");
            }

            $user = DB::transaction(function () use ($statePayload, $slug, $email, $profile) {
                $tenant = Tenant::create([
                    'name' => $statePayload['tenant_name'],
                    'slug' => $slug,
                    'center_type' => $statePayload['center_type'] ?? 'tutoring',
                    'status' => 'trial',
                    'trial_ends_at' => now()->addDays(14),
                ]);

                return User::create([
                    'tenant_id' => $tenant->id,
                    'email' => $email,
                    'name' => $profile['name'] ?? explode('@', $email)[0],
                    'role' => User::ROLE_OWNER,
                    'email_verified' => true,
                    'google_sub' => $profile['sub'],
                    'auth_provider' => 'google',
                    // Random, never-shared password: this account only authenticates
                    // via Google unless the owner later sets a password through
                    // forgot-password.
                    'password' => Hash::make(Str::random(40)),
                ]);
            });
        }

        $token = $user->createToken('api', ['*'], now()->addMinutes((int) env('SANCTUM_TOKEN_EXPIRATION', 20160)))->plainTextToken;

        $exchangeCode = Str::random(48);
        Cache::put("oauth_exchange:$exchangeCode", [
            'access_token' => $token,
            'refresh_token' => $token,
            'user' => $user->only([
                'id', 'tenant_id', 'email', 'name', 'role', 'phone', 'avatar_url',
                'is_active', 'email_verified', 'auth_provider', 'google_sub',
                'created_at', 'updated_at',
            ]),
        ], now()->addSeconds(120));

        return redirect()->away("$front/oauth/callback?code=$exchangeCode");
    }

    public function exchange(Request $request)
    {
        $request->validate(['code' => 'required|string']);

        $payload = Cache::pull("oauth_exchange:{$request->code}");
        if (! $payload) {
            abort(400, 'Invalid or expired code');
        }

        return response()->json($payload);
    }
}
