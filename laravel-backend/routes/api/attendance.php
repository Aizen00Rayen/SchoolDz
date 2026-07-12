<?php

use App\Http\Controllers\Api\AttendanceController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->prefix('attendance')->group(function () {
    Route::get('/session/{sessionId}', [AttendanceController::class, 'forSession']);
    Route::post('/session/{sessionId}', [AttendanceController::class, 'bulkMark']);
    Route::get('/student/{studentId}', [AttendanceController::class, 'forStudent']);
});
