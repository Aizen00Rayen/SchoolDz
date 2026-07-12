<?php

namespace App\Http\Controllers\Api;

use App\Models\Payment;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Http\Request;

class PaymentController extends TenantScopedApiController
{
    protected string $model = Payment::class;

    protected function applyFilters($query, Request $request): void
    {
        if ($request->filled('student_id')) {
            $query->where('student_id', $request->query('student_id'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && ! in_array($user->role, User::STAFF_ROLES, true)) {
            abort(403, 'Forbidden');
        }

        $data = $request->validate([
            'student_id' => 'required|uuid',
            'course_id' => 'nullable|uuid',
            'group_id' => 'nullable|uuid',
            'kind' => 'nullable|in:registration,monthly,course,installment,other',
            'amount' => 'required|numeric',
            'discount' => 'nullable|numeric',
            'method' => 'nullable|in:cash,card,bank_transfer,cheque,other',
            'status' => 'nullable|in:paid,pending,partial,refunded,cancelled',
            'due_date' => 'nullable|date',
            'paid_at' => 'nullable|date',
            'reference' => 'nullable|string',
            'notes' => 'nullable|string',
        ]);

        $tenant = Tenant::find($user->tenant_id);
        $count = Payment::where('tenant_id', $user->tenant_id)->count();
        $data['tenant_id'] = $user->tenant_id;
        $data['invoice_number'] = ($tenant->invoice_prefix ?? 'INV-').str_pad($count + 1, 6, '0', STR_PAD_LEFT);

        if (($data['status'] ?? 'paid') === 'paid' && empty($data['paid_at'])) {
            $data['paid_at'] = now();
        }

        return response()->json(Payment::create($data));
    }
}
