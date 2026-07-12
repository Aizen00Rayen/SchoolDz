<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Models\User;
use App\Support\TenantScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class UserController extends Controller
{
    public function index(Request $request)
    {
        $query = TenantScope::apply(User::query(), $request->user());
        if ($request->filled('role')) {
            $query->where('role', $request->query('role'));
        }
        $items = $query->orderByDesc('created_at')->limit(500)->get();

        return response()->json(['items' => $items, 'total' => $items->count()]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! in_array($user->role, User::ADMIN_ROLES, true)) {
            abort(403, 'Only owners/directors can add users');
        }

        $data = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string|min:8|max:128',
            'name' => 'required|string',
            'role' => 'required|string',
            'phone' => 'nullable|string',
        ]);

        if (! in_array($data['role'], User::TENANT_ASSIGNABLE_ROLES, true)) {
            abort(400, 'Invalid role');
        }

        if ($user->tenant_id) {
            $tenant = Tenant::find($user->tenant_id);
            $maxUsers = $tenant->max_users ?? 20;
            $current = User::where('tenant_id', $user->tenant_id)->count();
            if ($current >= $maxUsers) {
                abort(403, 'User limit reached for your plan');
            }
        }

        $email = strtolower($data['email']);
        if (User::where('email', $email)->exists()) {
            abort(409, 'Email already registered');
        }

        $newUser = User::create([
            'tenant_id' => $user->tenant_id,
            'email' => $email,
            'name' => $data['name'],
            'role' => $data['role'],
            'phone' => $data['phone'] ?? null,
            'email_verified' => true,
            'password' => Hash::make($data['password']),
        ]);

        return response()->json($newUser);
    }

    public function update(Request $request, string $id)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! in_array($user->role, User::ADMIN_ROLES, true)) {
            abort(403, 'Forbidden');
        }

        $target = TenantScope::apply(User::query(), $user)->where('id', $id)->first();
        if (! $target) {
            abort(404, 'Not found');
        }
        if ($target->role === User::ROLE_SUPER_ADMIN) {
            abort(400, 'Cannot edit a super admin account');
        }

        $data = $request->validate([
            'name' => 'sometimes|nullable|string',
            'email' => 'sometimes|nullable|email',
            'phone' => 'sometimes|nullable|string',
            'role' => 'sometimes|nullable|string',
            'is_active' => 'sometimes|nullable|boolean',
        ]);

        $updates = [];

        if (array_key_exists('name', $data) && $data['name'] !== null) {
            $name = trim($data['name']);
            if ($name === '') {
                abort(400, 'Name cannot be empty');
            }
            $updates['name'] = $name;
        }
        if (array_key_exists('phone', $data) && $data['phone'] !== null) {
            $updates['phone'] = $data['phone'];
        }
        if (array_key_exists('role', $data) && $data['role'] !== null) {
            if (! in_array($data['role'], User::TENANT_ASSIGNABLE_ROLES, true)) {
                abort(400, 'Invalid role');
            }
            $updates['role'] = $data['role'];
        }
        if (array_key_exists('is_active', $data) && $data['is_active'] !== null) {
            if ($id === $user->id && ! $data['is_active']) {
                abort(400, 'Cannot deactivate your own account');
            }
            $updates['is_active'] = $data['is_active'];
        }
        if (array_key_exists('email', $data) && $data['email'] !== null) {
            $email = strtolower($data['email']);
            if ($email !== $target->email && User::where('email', $email)->exists()) {
                abort(409, 'Email already registered');
            }
            $updates['email'] = $email;
        }

        if (! $updates) {
            abort(400, 'No editable fields in payload');
        }

        $target->update($updates);

        return response()->json($target->fresh());
    }

    public function destroy(Request $request, string $id)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! in_array($user->role, User::ADMIN_ROLES, true)) {
            abort(403, 'Forbidden');
        }
        if ($id === $user->id) {
            abort(400, 'Cannot delete yourself');
        }

        $target = TenantScope::apply(User::query(), $user)->where('id', $id)->first();
        if (! $target) {
            abort(404, 'Not found');
        }
        if ($target->role === User::ROLE_SUPER_ADMIN) {
            abort(400, 'Cannot delete a super admin account');
        }

        $target->delete();

        return response()->json(['ok' => true]);
    }
}
