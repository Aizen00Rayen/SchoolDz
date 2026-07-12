<?php

namespace App\Concerns;

use Illuminate\Support\Str;

/**
 * String UUID primary keys instead of Laravel's default auto-increment ints —
 * matches the `id` values the React frontend already expects as strings.
 */
trait HasUuid
{
    public static function bootHasUuid(): void
    {
        static::creating(function ($model) {
            if (! $model->getKey()) {
                $model->{$model->getKeyName()} = (string) Str::uuid();
            }
        });
    }

    public function initializeHasUuid(): void
    {
        $this->keyType = 'string';
        $this->incrementing = false;
    }
}
