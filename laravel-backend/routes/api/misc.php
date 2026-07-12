<?php

use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\SearchController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/dashboard/summary', [DashboardController::class, 'summary']);
    Route::get('/search', SearchController::class);

    Route::prefix('admin')->group(function () {
        Route::get('/platform-summary', [AdminController::class, 'platformSummary']);
        Route::patch('/tenants/{id}/status', [AdminController::class, 'setTenantStatus']);
        Route::delete('/tenants/{id}', [AdminController::class, 'destroyTenant']);
    });
});
