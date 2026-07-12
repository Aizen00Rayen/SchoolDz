<?php

use Illuminate\Support\Facades\Route;

// This is the API-only backend (routes/api.php has everything under /api/v1).
// The root route exists only so hitting this subdomain directly returns
// something sane instead of a 404 or Laravel's default welcome page.
Route::get('/', fn () => response()->json(['service' => 'SchoolDZ API', 'version' => '1.0.0']));
