<?php

namespace App\Models;

use App\Concerns\HasUuid;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, HasUuid, Notifiable;

    public const ROLE_SUPER_ADMIN = 'super_admin';
    public const ROLE_OWNER = 'owner';
    public const ROLE_DIRECTOR = 'director';
    public const ROLE_SECRETARY = 'secretary';
    public const ROLE_ACCOUNTANT = 'accountant';
    public const ROLE_TEACHER = 'teacher';
    public const ROLE_PARENT = 'parent';
    public const ROLE_STUDENT = 'student';

    public const STAFF_ROLES = [
        self::ROLE_OWNER, self::ROLE_DIRECTOR, self::ROLE_SECRETARY,
        self::ROLE_ACCOUNTANT, self::ROLE_TEACHER,
    ];

    public const ADMIN_ROLES = [self::ROLE_OWNER, self::ROLE_DIRECTOR];

    // Roles a tenant admin (or super admin acting on a tenant) may assign.
    // Never super_admin — that would be a platform-level privilege escalation
    // from inside a tenant.
    public const TENANT_ASSIGNABLE_ROLES = [
        self::ROLE_OWNER, self::ROLE_DIRECTOR, self::ROLE_SECRETARY,
        self::ROLE_ACCOUNTANT, self::ROLE_TEACHER, self::ROLE_PARENT, self::ROLE_STUDENT,
    ];

    protected $fillable = [
        'tenant_id', 'email', 'name', 'role', 'phone', 'avatar_url',
        'is_active', 'email_verified', 'auth_provider', 'google_sub', 'password',
    ];

    protected $hidden = [
        'password',
    ];

    // Matches the DB column defaults so a freshly `create()`d instance already
    // reflects them in memory, without needing a round-trip refetch.
    protected $attributes = [
        'is_active' => true,
        'email_verified' => false,
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'email_verified' => 'boolean',
            'password' => 'hashed',
        ];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === self::ROLE_SUPER_ADMIN;
    }
}
