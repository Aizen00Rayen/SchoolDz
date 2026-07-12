<?php

namespace App\Models;

use App\Concerns\HasUuid;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Student extends Model
{
    use HasFactory, HasUuid;

    protected $fillable = [
        'tenant_id', 'parent_id', 'first_name', 'last_name', 'gender', 'birth_date',
        'email', 'phone', 'address', 'emergency_contact', 'medical_notes', 'photo_url',
        'status', 'notes', 'student_code', 'enrollment_date',
    ];

    protected $casts = [
        'birth_date' => 'date',
        'enrollment_date' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $student) {
            $student->enrollment_date ??= now();
        });
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function guardian(): BelongsTo
    {
        return $this->belongsTo(Guardian::class, 'parent_id');
    }

    public function groups(): BelongsToMany
    {
        return $this->belongsToMany(Group::class, 'group_student');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function attendance(): HasMany
    {
        return $this->hasMany(Attendance::class);
    }
}
