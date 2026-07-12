<?php

namespace App\Models;

use App\Concerns\HasUuid;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Course extends Model
{
    use HasFactory, HasUuid;

    protected $fillable = [
        'tenant_id', 'title', 'description', 'category', 'duration_weeks',
        'price', 'max_students', 'color', 'image_url', 'status',
    ];

    protected $casts = [
        'price' => 'float',
        'duration_weeks' => 'integer',
        'max_students' => 'integer',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function groups(): HasMany
    {
        return $this->hasMany(Group::class);
    }
}
