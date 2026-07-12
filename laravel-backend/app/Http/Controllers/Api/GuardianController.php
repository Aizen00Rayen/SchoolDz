<?php

namespace App\Http\Controllers\Api;

use App\Models\Guardian;
use Illuminate\Http\Request;

class GuardianController extends TenantScopedApiController
{
    protected string $model = Guardian::class;

    protected function applyFilters($query, Request $request): void
    {
        if ($request->filled('q')) {
            $q = $request->query('q');
            $query->where(function ($w) use ($q) {
                $w->where('name', 'like', "%$q%")
                    ->orWhere('email', 'like', "%$q%")
                    ->orWhere('phone', 'like', "%$q%");
            });
        }
    }

    public function store(Request $request)
    {
        // No role gate here — matches the original backend's parent-creation
        // endpoint, which any authenticated tenant user can call.
        $data = $request->validate([
            'name' => 'required|string',
            'email' => 'nullable|email',
            'phone' => 'nullable|string',
            'address' => 'nullable|string',
            'occupation' => 'nullable|string',
            'relationship' => 'nullable|in:father,mother,guardian,other',
            'emergency_contact' => 'nullable|string',
        ]);

        $data['tenant_id'] = $request->user()->tenant_id;

        return response()->json(Guardian::create($data));
    }
}
