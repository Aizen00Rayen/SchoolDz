<?php

use App\Http\Controllers\Api\TenantController;
use Illuminate\Support\Facades\Route;

// Public — used pre-login on the marketing/login/register pages.
Route::get('tenants/by-slug/{slug}', [TenantController::class, 'bySlug']);

Route::middleware('auth:sanctum')->prefix('tenants')->group(function () {
    Route::get('/', [TenantController::class, 'index']);
    Route::post('/', [TenantController::class, 'store']);
    Route::patch('/{id}', [TenantController::class, 'update']);
    Route::post('/{id}/logo', [TenantController::class, 'uploadLogo']);
});
