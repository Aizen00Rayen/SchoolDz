<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\ClassSession;
use App\Models\Course;
use App\Models\Group;
use App\Models\Payment;
use App\Models\Student;
use App\Models\Teacher;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function summary(Request $request)
    {
        $tid = $request->user()->tenant_id;
        if (! $tid) {
            return response()->json(['error' => 'no tenant']);
        }

        $now = Carbon::now();
        $dayStart = $now->copy()->startOfDay();
        $dayEnd = $now->copy()->endOfDay();
        $monthStart = $now->copy()->startOfMonth();

        $studentsTotal = Student::where('tenant_id', $tid)->where('status', 'active')->count();
        $teachersTotal = Teacher::where('tenant_id', $tid)->where('status', 'active')->count();
        $coursesTotal = Course::where('tenant_id', $tid)->where('status', 'active')->count();
        $groupsTotal = Group::where('tenant_id', $tid)->where('status', 'active')->count();

        $todaySessions = ClassSession::where('tenant_id', $tid)
            ->whereBetween('start_at', [$dayStart, $dayEnd])
            ->orderBy('start_at')
            ->limit(50)
            ->get();

        $upcomingSessions = ClassSession::where('tenant_id', $tid)
            ->whereBetween('start_at', [$now, $now->copy()->addDays(7)])
            ->orderBy('start_at')
            ->limit(20)
            ->get();

        $revenueToday = (float) Payment::where('tenant_id', $tid)
            ->where('status', 'paid')
            ->whereBetween('paid_at', [$dayStart, $dayEnd])
            ->selectRaw('COALESCE(SUM(amount - discount), 0) as total')
            ->value('total');

        $revenueMonth = (float) Payment::where('tenant_id', $tid)
            ->where('status', 'paid')
            ->where('paid_at', '>=', $monthStart)
            ->selectRaw('COALESCE(SUM(amount - discount), 0) as total')
            ->value('total');

        $outstanding = (float) Payment::where('tenant_id', $tid)
            ->whereIn('status', ['pending', 'partial'])
            ->selectRaw('COALESCE(SUM(amount - discount), 0) as total')
            ->value('total');

        $recentStudents = Student::where('tenant_id', $tid)->orderByDesc('created_at')->limit(5)->get();
        $recentPayments = Payment::where('tenant_id', $tid)->orderByDesc('created_at')->limit(5)->get();

        $todaySessionIds = $todaySessions->pluck('id');
        $attTotal = 0;
        $attPresent = 0;
        if ($todaySessionIds->isNotEmpty()) {
            $attTotal = Attendance::where('tenant_id', $tid)->whereIn('session_id', $todaySessionIds)->count();
            $attPresent = Attendance::where('tenant_id', $tid)
                ->whereIn('session_id', $todaySessionIds)
                ->whereIn('status', ['present', 'late'])
                ->count();
        }
        $attendancePct = $attTotal ? round($attPresent / $attTotal * 100, 1) : 0;

        $trend = [];
        for ($i = 5; $i >= 0; $i--) {
            $monthDate = $now->copy()->startOfMonth()->subMonths($i);
            $monthEnd = $monthDate->copy()->addMonthNoOverflow();
            $total = (float) Payment::where('tenant_id', $tid)
                ->where('status', 'paid')
                ->whereBetween('paid_at', [$monthDate, $monthEnd])
                ->selectRaw('COALESCE(SUM(amount - discount), 0) as total')
                ->value('total');
            $trend[] = ['month' => $monthDate->format('M'), 'revenue' => round($total, 2)];
        }

        return response()->json([
            'kpis' => [
                'students_total' => $studentsTotal,
                'teachers_total' => $teachersTotal,
                'courses_total' => $coursesTotal,
                'groups_total' => $groupsTotal,
                'revenue_today' => round($revenueToday, 2),
                'revenue_month' => round($revenueMonth, 2),
                'outstanding' => round($outstanding, 2),
                'attendance_pct' => $attendancePct,
                'sessions_today' => $todaySessions->count(),
            ],
            'today_sessions' => $todaySessions,
            'upcoming_sessions' => $upcomingSessions,
            'recent_students' => $recentStudents,
            'recent_payments' => $recentPayments,
            'revenue_trend' => $trend,
        ]);
    }
}
