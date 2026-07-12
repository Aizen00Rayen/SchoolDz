<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\ClassSession;
use App\Models\Course;
use App\Models\Group;
use App\Models\Guardian;
use App\Models\Payment;
use App\Models\Student;
use App\Models\Teacher;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Http\Request;

class AdminController extends Controller
{
    private function requireSuperAdmin(Request $request): void
    {
        if (! $request->user()->isSuperAdmin()) {
            abort(403, 'Forbidden');
        }
    }

    public function platformSummary(Request $request)
    {
        $this->requireSuperAdmin($request);

        $revenue = (float) Payment::where('status', 'paid')
            ->selectRaw('COALESCE(SUM(amount - discount), 0) as total')
            ->value('total');

        $tenants = Tenant::orderByDesc('created_at')->limit(200)->get()->map(function (Tenant $t) {
            $data = $t->toArray();
            $data['users_count'] = User::where('tenant_id', $t->id)->count();
            $data['students_count'] = Student::where('tenant_id', $t->id)->count();

            return $data;
        });

        return response()->json([
            'kpis' => [
                'tenants_total' => Tenant::count(),
                'tenants_active' => Tenant::where('status', 'active')->count(),
                'tenants_trial' => Tenant::where('status', 'trial')->count(),
                'tenants_suspended' => Tenant::where('status', 'suspended')->count(),
                'users_total' => User::count(),
                'students_total' => Student::count(),
                'payments_total' => Payment::count(),
                'platform_revenue' => round($revenue, 2),
            ],
            'tenants' => $tenants,
        ]);
    }

    public function setTenantStatus(Request $request, string $id)
    {
        $this->requireSuperAdmin($request);

        $data = $request->validate(['status' => 'required|in:active,trial,suspended']);

        $tenant = Tenant::find($id);
        if (! $tenant) {
            abort(404, 'Not found');
        }
        $tenant->update(['status' => $data['status']]);

        return response()->json($tenant->fresh());
    }

    public function destroyTenant(Request $request, string $id)
    {
        $this->requireSuperAdmin($request);

        $tenant = Tenant::find($id);
        if (! $tenant) {
            return response()->json(['ok' => true]);
        }

        User::where('tenant_id', $id)->delete();
        Student::where('tenant_id', $id)->delete();
        Guardian::where('tenant_id', $id)->delete();
        Teacher::where('tenant_id', $id)->delete();
        Course::where('tenant_id', $id)->delete();
        Group::where('tenant_id', $id)->delete();
        ClassSession::where('tenant_id', $id)->delete();
        Attendance::where('tenant_id', $id)->delete();
        Payment::where('tenant_id', $id)->delete();

        $logoUrl = $tenant->logo_url;
        $tenant->delete();

        if ($logoUrl && str_starts_with($logoUrl, '/uploads/logos/')) {
            $path = public_path(ltrim($logoUrl, '/'));
            if (is_file($path)) {
                @unlink($path);
            }
        }

        return response()->json(['ok' => true]);
    }
}
