<?php

namespace App\Models;

use App\Concerns\HasUuid;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Tenant extends Model
{
    use HasFactory, HasUuid;

    protected $fillable = [
        'name', 'slug', 'center_type', 'status', 'plan', 'logo_url',
        'primary_color', 'accent_color', 'language', 'currency', 'timezone',
        'invoice_prefix', 'student_prefix', 'max_students', 'max_users', 'trial_ends_at',
    ];

    // Matches the DB column defaults so a freshly `create()`d instance already
    // reflects them in memory, without needing a round-trip refetch.
    protected $attributes = [
        'center_type' => 'tutoring',
        'status' => 'trial',
        'plan' => 'free',
        'primary_color' => '#0A0A0B',
        'accent_color' => '#E53935',
        'language' => 'en',
        'currency' => 'DZD',
        'timezone' => 'UTC',
        'invoice_prefix' => 'INV-',
        'student_prefix' => 'STU-',
        'max_students' => 500,
        'max_users' => 20,
    ];

    protected $casts = [
        'trial_ends_at' => 'datetime',
        'max_students' => 'integer',
        'max_users' => 'integer',
    ];

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function students(): HasMany
    {
        return $this->hasMany(Student::class);
    }

    public function teachers(): HasMany
    {
        return $this->hasMany(Teacher::class);
    }

    public function guardians(): HasMany
    {
        return $this->hasMany(Guardian::class);
    }

    public function courses(): HasMany
    {
        return $this->hasMany(Course::class);
    }

    public function groups(): HasMany
    {
        return $this->hasMany(Group::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }
}
