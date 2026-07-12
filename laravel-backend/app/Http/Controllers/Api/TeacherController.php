<?php

namespace App\Http\Controllers\Api;

use App\Models\Teacher;
use App\Models\User;
use Illuminate\Http\Request;

class TeacherController extends TenantScopedApiController
{
    protected string $model = Teacher::class;

    protected function applyFilters($query, Request $request): void
    {
        if ($request->filled('q')) {
            $q = $request->query('q');
            $query->where(function ($w) use ($q) {
                $w->where('first_name', 'like', "%$q%")
                    ->orWhere('last_name', 'like', "%$q%")
                    ->orWhere('email', 'like', "%$q%");
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
            'first_name' => 'required|string',
            'last_name' => 'required|string',
            'email' => 'nullable|email',
            'phone' => 'nullable|string',
            'address' => 'nullable|string',
            'subjects' => 'nullable|array',
            'hourly_rate' => 'nullable|numeric',
            'monthly_salary' => 'nullable|numeric',
            'photo_url' => 'nullable|string',
            'status' => 'nullable|in:active,inactive',
            'notes' => 'nullable|string',
        ]);

        $data['tenant_id'] = $user->tenant_id;
        $data['hire_date'] = now();

        return response()->json(Teacher::create($data));
    }
}
