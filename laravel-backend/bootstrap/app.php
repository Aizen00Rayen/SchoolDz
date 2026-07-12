<?php

use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // HandleCors ships enabled by default in Laravel's global middleware
        // stack and reads config/cors.php — nothing to add here.
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // The React frontend's error handling (frontend/src/lib/api.js,
        // formatApiErrorDetail) expects FastAPI-shaped error bodies:
        // {"detail": "message"} or {"detail": [{"msg": "..."}]}. This is
        // what keeps the already-built frontend working against this
        // backend without touching its error-handling code.
        $exceptions->render(function (ValidationException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $detail = collect($e->errors())
                ->flatten()
                ->map(fn ($msg) => ['msg' => $msg])
                ->values()
                ->all();

            return response()->json(['detail' => $detail], 422);
        });

        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json(['detail' => 'Not authenticated'], 401);
        });

        $exceptions->render(function (HttpExceptionInterface $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $status = $e->getStatusCode();
            $message = $e->getMessage() ?: match ($status) {
                404 => 'Not found',
                403 => 'Forbidden',
                405 => 'Method not allowed',
                429 => 'Too many attempts, please try again later',
                default => 'Error',
            };

            return response()->json(['detail' => $message], $status);
        });

        $exceptions->render(function (\Throwable $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $detail = config('app.debug') ? $e->getMessage() : 'Internal server error';

            return response()->json(['detail' => $detail], 500);
        });
    })->create();
