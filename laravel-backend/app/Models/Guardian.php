<?php

namespace App\Models;

use App\Concerns\HasUuid;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A student's parent/guardian. Named `Guardian` (not `Parent`, which is a
 * reserved word in PHP) — maps to the `parents` table.
 */
class Guardian extends Model
{
    use HasFactory, HasUuid;

    protected $table = 'parents';

    protected $fillable = [
        'tenant_id', 'name', 'email', 'phone', 'address', 'occupation',
        'relationship', 'emergency_contact',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function students(): HasMany
    {
        return $this->hasMany(Student::class, 'parent_id');
    }
}
