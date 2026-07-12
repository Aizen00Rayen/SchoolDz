<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('courses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('title');
            $table->text('description')->nullable();
            $table->string('category')->nullable();
            $table->integer('duration_weeks')->default(12);
            $table->decimal('price', 10, 2)->default(0);
            $table->integer('max_students')->default(20);
            $table->string('color', 16)->default('#E53935');
            $table->string('image_url')->nullable();
            $table->enum('status', ['active', 'draft', 'archived'])->default('active');
            $table->timestamps();

            $table->index(['tenant_id', 'title']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('courses');
    }
};
