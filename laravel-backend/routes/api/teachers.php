<?php

use App\Http\Controllers\Api\TeacherController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->prefix('teachers')->group(function () {
    Route::get('/', [TeacherController::class, 'index']);
    Route::post('/', [TeacherController::class, 'store']);
    Route::get('/{id}', [TeacherController::class, 'show']);
    Route::patch('/{id}', [TeacherController::class, 'update']);
    Route::delete('/{id}', [TeacherController::class, 'destroy']);
});
