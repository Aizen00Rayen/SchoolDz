<?php

use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('/health', fn () => response()->json([
        'status' => 'ok',
        'service' => 'schooldz',
        'time' => now()->toIso8601String(),
    ]));

    require __DIR__.'/api/auth.php';
    require __DIR__.'/api/tenants.php';
    require __DIR__.'/api/users.php';
    require __DIR__.'/api/students.php';
    require __DIR__.'/api/parents.php';
    require __DIR__.'/api/teachers.php';
    require __DIR__.'/api/courses.php';
    require __DIR__.'/api/groups.php';
    require __DIR__.'/api/sessions.php';
    require __DIR__.'/api/attendance.php';
    require __DIR__.'/api/payments.php';
    require __DIR__.'/api/misc.php';
});
