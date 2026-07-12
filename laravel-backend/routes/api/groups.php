<?php

use App\Http\Controllers\Api\GroupController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->prefix('groups')->group(function () {
    Route::get('/', [GroupController::class, 'index']);
    Route::post('/', [GroupController::class, 'store']);
    Route::get('/{id}', [GroupController::class, 'show']);
    Route::patch('/{id}', [GroupController::class, 'update']);
    Route::delete('/{id}', [GroupController::class, 'destroy']);
    Route::post('/{id}/enroll', [GroupController::class, 'enroll']);
    Route::post('/{id}/unenroll', [GroupController::class, 'unenroll']);
});
