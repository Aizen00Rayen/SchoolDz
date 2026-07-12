<?php

namespace App\Http\Controllers\Api;

use App\Models\ClassSession;
use App\Models\Group;
use App\Models\User;
use App\Support\TenantScope;
use Illuminate\Http\Request;

class ClassSessionController extends TenantScopedApiController
{
    protected string $model = ClassSession::class;

    public function index(Request $request)
    {
        $query = TenantScope::apply(ClassSession::query(), $request->user());

        if ($request->filled('group_id')) {
            $query->where('group_id', $request->query('group_id'));
        }
        if ($request->filled('from_date')) {
            $query->where('start_at', '>=', $request->query('from_date'));
        }
        if ($request->filled('to_date')) {
            $query->where('start_at', '<=', $request->query('to_date'));
        }

        $items = $query->orderBy('start_at')->limit(1000)->get();

        return response()->json(['items' => $items, 'total' => $items->count()]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! in_array($user->role, User::STAFF_ROLES, true)) {
            abort(403, 'Forbidden');
        }

        $data = $request->validate([
            'group_id' => 'required|uuid',
            'teacher_id' => 'nullable|uuid',
            'room' => 'nullable|string',
            'start_at' => 'required|date',
            'end_at' => 'required|date',
            'topic' => 'nullable|string',
            'notes' => 'nullable|string',
            'homework' => 'nullable|string',
            'status' => 'nullable|in:scheduled,completed,cancelled',
        ]);

        $group = Group::where('id', $data['group_id'])->where('tenant_id', $user->tenant_id)->first();
        if (! $group) {
            abort(404, 'Group not found');
        }

        $data['tenant_id'] = $user->tenant_id;
        $data['course_id'] = $group->course_id;

        return response()->json(ClassSession::create($data));
    }
}
