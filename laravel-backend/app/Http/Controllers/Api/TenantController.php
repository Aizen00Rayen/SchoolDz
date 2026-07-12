<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class TenantController extends Controller
{
    /** Public branding fields only — used pre-login on the /login and /register pages. */
    private const PUBLIC_FIELDS = [
        'id', 'name', 'slug', 'center_type', 'status', 'logo_url',
        'primary_color', 'accent_color', 'language',
    ];

    /** Settings a tenant owner may edit themselves; plan/quota/status are billing-controlled. */
    private const OWNER_EDITABLE = [
        'name', 'center_type', 'logo_url', 'primary_color', 'accent_color',
        'language', 'currency', 'timezone', 'invoice_prefix', 'student_prefix',
    ];

    private const MAX_LOGO_BYTES = 3 * 1024 * 1024;

    private const ALLOWED_LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    public function bySlug(string $slug)
    {
        $tenant = Tenant::where('slug', strtolower($slug))->first();
        if (! $tenant) {
            abort(404, 'Tenant not found');
        }

        return response()->json($tenant->only(self::PUBLIC_FIELDS));
    }

    public function index(Request $request)
    {
        if (! $request->user()->isSuperAdmin()) {
            abort(403, 'Forbidden');
        }
        $items = Tenant::all();

        return response()->json(['items' => $items, 'total' => $items->count()]);
    }

    public function store(Request $request)
    {
        if (! $request->user()->isSuperAdmin()) {
            abort(403, 'Forbidden');
        }

        $data = $request->validate([
            'name' => 'required|string',
            'slug' => 'required|string',
            'owner_email' => 'required|email',
            'owner_password' => 'required|string|min:8|max:128',
            'owner_name' => 'required|string',
            'center_type' => 'nullable|string',
        ]);

        $slug = strtolower($data['slug']);
        if (! preg_match(AuthController::SLUG_PATTERN, $slug)) {
            abort(400, 'Invalid slug');
        }
        if (Tenant::where('slug', $slug)->exists()) {
            abort(409, 'Slug already taken');
        }
        $email = strtolower($data['owner_email']);
        if (User::where('email', $email)->exists()) {
            abort(409, 'Owner email already registered');
        }

        $tenant = Tenant::create([
            'name' => $data['name'],
            'slug' => $slug,
            'center_type' => $data['center_type'] ?: 'tutoring',
            'status' => 'active',
        ]);

        $owner = User::create([
            'tenant_id' => $tenant->id,
            'email' => $email,
            'name' => $data['owner_name'],
            'role' => User::ROLE_OWNER,
            'email_verified' => true,
            'password' => Hash::make($data['owner_password']),
        ]);

        return response()->json(['tenant' => $tenant, 'owner' => $owner]);
    }

    public function update(Request $request, string $id)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && $user->role !== User::ROLE_OWNER) {
            abort(403, 'Forbidden');
        }
        if (! $user->isSuperAdmin() && $user->tenant_id !== $id) {
            abort(403, 'Cannot edit another tenant');
        }

        $tenant = Tenant::find($id);
        if (! $tenant) {
            abort(404, 'Not found');
        }

        $payload = $request->all();
        if ($user->isSuperAdmin()) {
            $updates = collect($payload)->except(['id', 'created_at', 'slug'])->toArray();
        } else {
            $updates = collect($payload)->only(self::OWNER_EDITABLE)->toArray();
        }

        if (! $updates) {
            abort(400, 'No editable fields in payload');
        }

        $tenant->update($updates);

        return response()->json($tenant->fresh());
    }

    public function uploadLogo(Request $request, string $id)
    {
        $user = $request->user();
        if (! $user->isSuperAdmin() && $user->role !== User::ROLE_OWNER) {
            abort(403, 'Forbidden');
        }
        if (! $user->isSuperAdmin() && $user->tenant_id !== $id) {
            abort(403, 'Cannot edit another tenant');
        }

        $request->validate(['file' => 'required|file']);
        $file = $request->file('file');

        if (! in_array($file->getMimeType(), self::ALLOWED_LOGO_MIMES, true)) {
            abort(400, 'Only PNG, JPEG, WEBP or GIF images are allowed');
        }
        if ($file->getSize() > self::MAX_LOGO_BYTES) {
            abort(400, 'Logo must be under 3MB');
        }

        $tenant = Tenant::find($id);
        if (! $tenant) {
            abort(404, 'Tenant not found');
        }

        $ext = match ($file->getMimeType()) {
            'image/png' => 'png',
            'image/jpeg' => 'jpg',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
        };
        // Random filename: never trust the client-supplied name for a filesystem path.
        $filename = $id.'-'.Str::random(12).'.'.$ext;

        $uploadDir = public_path('uploads/logos');
        if (! is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }
        $file->move($uploadDir, $filename);

        // Best-effort cleanup of the previous logo so uploads don't accumulate forever.
        if ($tenant->logo_url && str_starts_with($tenant->logo_url, '/uploads/logos/')) {
            $oldPath = public_path(ltrim($tenant->logo_url, '/'));
            if (is_file($oldPath)) {
                @unlink($oldPath);
            }
        }

        $tenant->update(['logo_url' => "/uploads/logos/$filename"]);

        return response()->json($tenant->fresh());
    }
}
