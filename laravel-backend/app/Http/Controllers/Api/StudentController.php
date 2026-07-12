<?php

namespace App\Http\Controllers\Api;

use App\Models\Student;
use App\Models\Tenant;
use App\Models\User;
use App\Support\TenantScope;
use Illuminate\Http\Request;

class StudentController extends TenantScopedApiController
{
    protected string $model = Student::class;

    protected function applyFilters($query, Request $request): void
    {
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        if ($request->filled('q')) {
            $q = $request->query('q');
            $query->where(function ($w) use ($q) {
                $w->where('first_name', 'like', "%$q%")
                    ->orWhere('last_name', 'like', "%$q%")
                    ->orWhere('email', 'like', "%$q%")
                    ->orWhere('phone', 'like', "%$q%");
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
            'gender' => 'nullable|in:male,female,other',
            'birth_date' => 'nullable|date',
            'email' => 'nullable|email',
            'phone' => 'nullable|string',
            'address' => 'nullable|string',
            'parent_id' => 'nullable|uuid',
            'emergency_contact' => 'nullable|string',
            'medical_notes' => 'nullable|string',
            'photo_url' => 'nullable|string',
            'status' => 'nullable|in:active,inactive,graduated,suspended',
            'notes' => 'nullable|string',
        ]);

        $tenant = Tenant::find($user->tenant_id);
        $count = Student::where('tenant_id', $user->tenant_id)->count();
        $data['tenant_id'] = $user->tenant_id;
        $data['student_code'] = ($tenant->student_prefix ?? 'STU-').str_pad($count + 1, 5, '0', STR_PAD_LEFT);

        $student = Student::create($data);

        return response()->json($student);
    }
}
