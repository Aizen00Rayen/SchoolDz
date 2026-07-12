<?php

namespace App\Models;

use App\Concerns\HasUuid;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Teacher extends Model
{
    use HasFactory, HasUuid;

    protected $fillable = [
        'tenant_id', 'user_id', 'first_name', 'last_name', 'email', 'phone',
        'address', 'subjects', 'hourly_rate', 'monthly_salary', 'photo_url',
        'status', 'notes', 'hire_date',
    ];

    protected $casts = [
        'subjects' => 'array',
        'hourly_rate' => 'float',
        'monthly_salary' => 'float',
        'hire_date' => 'date',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function groups(): HasMany
    {
        return $this->hasMany(Group::class);
    }
}
