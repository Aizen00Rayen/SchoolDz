<?php

namespace App\Http\Controllers\Api;

use App\Models\Course;
use App\Models\User;
use Illuminate\Http\Request;

class CourseController extends TenantScopedApiController
{
    protected string $model = Course::class;

    protected function applyFilters($query, Request $request): void
    {
        if ($request->filled('q')) {
            $q = $request->query('q');
            $query->where(function ($w) use ($q) {
                $w->where('title', 'like', "%$q%")
                    ->orWhere('category', 'like', "%$q%");
            });
        }
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! in_array($user->role, User::STAFF_ROLES, true)) {
            abort(403, 'Forbidden');
        }

        $data = $request->validate([
            'title' => 'required|string',
            'description' => 'nullable|string',
            'category' => 'nullable|string',
            'duration_weeks' => 'nullable|integer',
            'price' => 'nullable|numeric',
            'max_students' => 'nullable|integer',
            'color' => 'nullable|string',
            'image_url' => 'nullable|string',
            'status' => 'nullable|in:active,draft,archived',
        ]);

        $data['tenant_id'] = $user->tenant_id;

        return response()->json(Course::create($data));
    }
}
