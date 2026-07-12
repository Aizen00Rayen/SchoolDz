<?php

namespace App\Models;

use App\Concerns\HasUuid;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Attendance extends Model
{
    use HasFactory, HasUuid;

    public $timestamps = false;

    protected $table = 'attendance';

    protected $fillable = [
        'tenant_id', 'session_id', 'student_id', 'status', 'note',
        'marked_by', 'marked_at',
    ];

    protected $casts = [
        'marked_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $attendance) {
            $attendance->marked_at ??= now();
        });
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(ClassSession::class, 'session_id');
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(Student::class);
    }

    public function markedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'marked_by');
    }
}
