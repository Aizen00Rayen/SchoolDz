<?php

namespace App\Http\Controllers\Api;

use App\Models\Group;
use App\Models\User;
use Illuminate\Http\Request;

class GroupController extends TenantScopedApiController
{
    protected string $model = Group::class;

    protected function applyFilters($query, Request $request): void
    {
        if ($request->filled('course_id')) {
            $query->where('course_id', $request->query('course_id'));
        }
    }

    public function index(Request $request)
    {
        $query = \App\Support\TenantScope::apply(Group::query(), $request->user());
        $this->applyFilters($query, $request);
        $groups = $query->with('students:id')->orderByDesc('created_at')->limit(500)->get();

        $items = $groups->map(function (Group $group) {
            $data = $group->toArray();
            $data['student_ids'] = $group->students->pluck('id')->values();
            unset($data['students']);

            return $data;
        });

        return response()->json(['items' => $items, 'total' => $items->count()]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! in_array($user->role, User::STAFF_ROLES, true)) {
            abort(403, 'Forbidden');
        }

        $data = $request->validate([
            'course_id' => 'required|uuid',
            'name' => 'required|string',
            'teacher_id' => 'nullable|uuid',
            'room' => 'nullable|string',
            'capacity' => 'nullable|integer',
            'schedule' => 'nullable|string',
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'status' => 'nullable|in:active,completed,cancelled',
        ]);

        $data['tenant_id'] = $user->tenant_id;

        return response()->json($this->withStudentIds(Group::create($data)));
    }

    public function show(Request $request, string $id)
    {
        $group = $this->findOrFail($request, $id);

        return response()->json($this->withStudentIds($group));
    }

    public function update(Request $request, string $id)
    {
        $group = $this->findOrFail($request, $id);
        $updates = collect($request->all())->except($this->protectedFields)->toArray();
        $group->update($updates);

        return response()->json($this->withStudentIds($group->fresh()));
    }

    public function enroll(Request $request, string $id)
    {
        $request->validate(['student_id' => 'required|uuid']);
        $group = $this->findOrFail($request, $id);
        $group->students()->syncWithoutDetaching([$request->student_id]);

        return response()->json($this->withStudentIds($group->fresh()));
    }

    public function unenroll(Request $request, string $id)
    {
        $request->validate(['student_id' => 'required|uuid']);
        $group = $this->findOrFail($request, $id);
        $group->students()->detach($request->student_id);

        return response()->json($this->withStudentIds($group->fresh()));
    }

    /** Frontend expects `student_ids` (a flat array), matching the old Mongo document shape. */
    private function withStudentIds(Group $group): array
    {
        $data = $group->toArray();
        $data['student_ids'] = $group->students()->pluck('students.id')->values();

        return $data;
    }
}
