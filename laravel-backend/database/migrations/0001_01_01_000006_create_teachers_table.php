<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('teachers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('first_name');
            $table->string('last_name');
            $table->string('email')->nullable();
            $table->string('phone')->nullable();
            $table->string('address')->nullable();
            $table->json('subjects')->nullable();
            $table->decimal('hourly_rate', 10, 2)->default(0);
            $table->decimal('monthly_salary', 10, 2)->default(0);
            $table->string('photo_url')->nullable();
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->text('notes')->nullable();
            $table->date('hire_date')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'last_name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('teachers');
    }
};
