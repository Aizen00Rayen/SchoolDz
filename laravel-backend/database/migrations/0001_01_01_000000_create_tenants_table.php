<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('center_type')->default('tutoring');
            $table->enum('status', ['active', 'suspended', 'trial'])->default('trial');
            $table->enum('plan', ['free', 'starter', 'pro', 'business'])->default('free');
            $table->string('logo_url')->nullable();
            $table->string('primary_color', 16)->default('#0A0A0B');
            $table->string('accent_color', 16)->default('#E53935');
            $table->enum('language', ['en', 'fr', 'ar'])->default('en');
            $table->string('currency', 8)->default('DZD');
            $table->string('timezone')->default('UTC');
            $table->string('invoice_prefix', 16)->default('INV-');
            $table->string('student_prefix', 16)->default('STU-');
            $table->integer('max_students')->default(500);
            $table->integer('max_users')->default(20);
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenants');
    }
};
