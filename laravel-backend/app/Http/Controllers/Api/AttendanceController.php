<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\ClassSession;
use App\Models\User;
use App\Support\TenantScope;
use Illuminate\Http\Request;

class AttendanceController extends Controller
{
    public function forSession(Request $request, string $sessionId)
    {
        $query = TenantScope::apply(Attendance::query(), $request->user())->where('session_id', $sessionId);
        $items = $query->get();

        return response()->json(['items' => $items, 'total' => $items->count()]);
    }

    public function bulkMark(Request $request, string $sessionId)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! in_array($user->role, User::STAFF_ROLES, true)) {
            abort(403, 'Forbidden');
        }

        $data = $request->validate([
            'marks' => 'required|array',
            'marks.*.student_id' => 'required|uuid',
            'marks.*.status' => 'required|in:present,absent,late,excused',
            'marks.*.note' => 'nullable|string',
        ]);

        $session = ClassSession::where('id', $sessionId)->where('tenant_id', $user->tenant_id)->first();
        if (! $session) {
            abort(404, 'Session not found');
        }

        foreach ($data['marks'] as $mark) {
            Attendance::updateOrCreate(
                [
                    'tenant_id' => $user->tenant_id,
                    'session_id' => $sessionId,
                    'student_id' => $mark['student_id'],
                ],
                [
                    'status' => $mark['status'],
                    'note' => $mark['note'] ?? null,
                    'marked_by' => $user->id,
                    'marked_at' => now(),
                ]
            );
        }

        $items = Attendance::where('tenant_id', $user->tenant_id)->where('session_id', $sessionId)->get();

        return response()->json(['items' => $items, 'total' => $items->count()]);
    }

    public function forStudent(Request $request, string $studentId)
    {
        $query = TenantScope::apply(Attendance::query(), $request->user())->where('student_id', $studentId);
        $items = $query->orderByDesc('marked_at')->limit(500)->get();

        return response()->json(['items' => $items, 'total' => $items->count()]);
    }
}
