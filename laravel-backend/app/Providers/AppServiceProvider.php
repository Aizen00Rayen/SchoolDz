<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    /**
     * Sliding-window rate limits on auth endpoints — mirrors core.rate_limit()
     * call sites in the original FastAPI backend, one named limiter per scope.
     */
    public function boot(): void
    {
        $byIp = fn (int $max, int $perMinutes) => fn ($request) => Limit::perMinutes($perMinutes, $max)->by($request->ip());

        RateLimiter::for('auth-register', $byIp(5, 1));
        RateLimiter::for('auth-login', $byIp(10, 1));
        RateLimiter::for('auth-forgot', $byIp(5, 5));
        RateLimiter::for('auth-reset', $byIp(10, 5));
        RateLimiter::for('auth-google-start', $byIp(20, 1));
        RateLimiter::for('auth-google-callback', $byIp(30, 1));
        RateLimiter::for('auth-google-exchange', $byIp(20, 1));
    }
}
