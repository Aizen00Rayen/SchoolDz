<?php

use App\Http\Controllers\Api\GuardianController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->prefix('parents')->group(function () {
    Route::get('/', [GuardianController::class, 'index']);
    Route::post('/', [GuardianController::class, 'store']);
    Route::get('/{id}', [GuardianController::class, 'show']);
    Route::patch('/{id}', [GuardianController::class, 'update']);
    Route::delete('/{id}', [GuardianController::class, 'destroy']);
});
