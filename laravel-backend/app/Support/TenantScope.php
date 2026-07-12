<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * Mirrors `tenant_filter()` from the original FastAPI backend's core.py:
 * every tenant-scoped query gets constrained to the current user's tenant,
 * unless they're a super_admin (who is only scoped if they happen to also
 * carry a tenant_id — matching the previous behavior exactly).
 */
class TenantScope
{
    public static function apply(Builder $query, User $user): Builder
    {
        if (! $user->isSuperAdmin()) {
            if (! $user->tenant_id) {
                abort(403, 'User has no tenant');
            }

            return $query->where('tenant_id', $user->tenant_id);
        }

        if ($user->tenant_id) {
            return $query->where('tenant_id', $user->tenant_id);
        }

        return $query;
    }

    /**
     * For create operations: the tenant_id a new record should be stamped with.
     */
    public static function id(User $user): ?string
    {
        return $user->tenant_id;
    }
}
