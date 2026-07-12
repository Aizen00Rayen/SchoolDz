<?php

use App\Http\Controllers\Api\ClassSessionController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->prefix('sessions')->group(function () {
    Route::get('/', [ClassSessionController::class, 'index']);
    Route::post('/', [ClassSessionController::class, 'store']);
    Route::get('/{id}', [ClassSessionController::class, 'show']);
    Route::patch('/{id}', [ClassSessionController::class, 'update']);
    Route::delete('/{id}', [ClassSessionController::class, 'destroy']);
});
