<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

/**
 * Seeds only the platform super admin from env — mirrors seed_super_admin()
 * in the original FastAPI backend's server.py. Idempotent: safe to run on
 * every deploy. No demo/sample data (this project deliberately ships none).
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $email = strtolower(env('ADMIN_EMAIL', 'admin@schooldz.com'));
        $password = env('ADMIN_PASSWORD', 'admin123');

        if ($password === 'admin123') {
            Log::warning('ADMIN_PASSWORD is not set — the super admin uses a weak default. '.
                'Set a strong ADMIN_PASSWORD before exposing this server.');
        }

        $existing = User::where('email', $email)->first();

        if (! $existing) {
            User::create([
                'tenant_id' => null,
                'email' => $email,
                'name' => 'Platform Admin',
                'role' => User::ROLE_SUPER_ADMIN,
                'email_verified' => true,
                'password' => Hash::make($password),
            ]);
            $this->command?->info("Seeded super admin: $email");
        } elseif (! Hash::check($password, $existing->password)) {
            $existing->update([
                'password' => Hash::make($password),
                'role' => User::ROLE_SUPER_ADMIN,
            ]);
            $this->command?->info('Updated super admin password');
        }
    }
}
